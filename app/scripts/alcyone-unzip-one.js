#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const zipPath = process.argv[2];
const destDir = process.argv[3];
const want = (process.argv[4] || '').toLowerCase();
if (!zipPath || !destDir || !want) {
  console.error('Usage: alcyone-unzip-one.js ZIP DEST basename');
  process.exit(2);
}
function u16(buf,o){ return buf.readUInt16LE(o); }
function u32(buf,o){ return buf.readUInt32LE(o); }
function ensureSafeName(name) {
  const base = path.basename(name.replace(/\\/g, '/'));
  if (!base || base === '.' || base === '..') throw new Error('bad zip entry name: ' + name);
  return base;
}
function inflate(method, data, name) {
  if (method === 0) return data;
  if (method === 8) return zlib.inflateRawSync(data);
  throw new Error('unsupported compression method ' + method + ' for ' + name);
}
function looksLikeZip(buf) {
  return buf.length >= 4 && (u32(buf,0) === 0x04034b50 || buf.includes(Buffer.from('PK\x03\x04', 'binary')));
}
const buf = fs.readFileSync(zipPath);
fs.mkdirSync(destDir, { recursive: true });
if (!looksLikeZip(buf)) {
  const head = buf.slice(0, 160).toString('utf8').replace(/\s+/g, ' ');
  throw new Error('download is not a zip file, first bytes: ' + head);
}
let extracted = [];

// Prefer central directory. It works even when local headers use data descriptors.
function extractByCentralDirectory() {
  let eocd = -1;
  const start = Math.max(0, buf.length - 0x10000 - 22);
  for (let i = buf.length - 22; i >= start; i--) {
    if (u32(buf, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return false;
  const total = u16(buf, eocd + 10);
  const cdOffset = u32(buf, eocd + 16);
  let off = cdOffset;
  for (let i = 0; i < total && off + 46 <= buf.length; i++) {
    if (u32(buf, off) !== 0x02014b50) break;
    const method = u16(buf, off + 10);
    const compSize = u32(buf, off + 20);
    const nameLen = u16(buf, off + 28);
    const extraLen = u16(buf, off + 30);
    const commentLen = u16(buf, off + 32);
    const localOff = u32(buf, off + 42);
    const name = buf.slice(off + 46, off + 46 + nameLen).toString('utf8');
    const base = path.basename(name.replace(/\\/g, '/')).toLowerCase();
    if (base === want || base.indexOf(want) >= 0) {
      if (localOff + 30 > buf.length || u32(buf, localOff) !== 0x04034b50) throw new Error('bad local header for ' + name);
      const lhNameLen = u16(buf, localOff + 26);
      const lhExtraLen = u16(buf, localOff + 28);
      const dataStart = localOff + 30 + lhNameLen + lhExtraLen;
      const dataEnd = dataStart + compSize;
      if (dataEnd > buf.length) throw new Error('zip entry is truncated: ' + name);
      const data = inflate(method, buf.slice(dataStart, dataEnd), name);
      const out = path.join(destDir, ensureSafeName(name));
      fs.writeFileSync(out, data, { mode: 0o755 });
      try { fs.chmodSync(out, 0o755); } catch (_) {}
      extracted.push(out);
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return true;
}

function extractByLocalHeaders() {
  let off = 0;
  while (off + 30 < buf.length) {
    const sig = u32(buf, off);
    if (sig !== 0x04034b50) { off++; continue; }
    const method = u16(buf, off + 8);
    const compSize = u32(buf, off + 18);
    const nameLen = u16(buf, off + 26);
    const extraLen = u16(buf, off + 28);
    const name = buf.slice(off + 30, off + 30 + nameLen).toString('utf8');
    const dataStart = off + 30 + nameLen + extraLen;
    const dataEnd = dataStart + compSize;
    if (!compSize || dataEnd > buf.length) { off = dataStart + Math.max(compSize, 0); continue; }
    const base = path.basename(name.replace(/\\/g, '/')).toLowerCase();
    if (base === want || base.indexOf(want) >= 0) {
      const data = inflate(method, buf.slice(dataStart, dataEnd), name);
      const out = path.join(destDir, ensureSafeName(name));
      fs.writeFileSync(out, data, { mode: 0o755 });
      try { fs.chmodSync(out, 0o755); } catch (_) {}
      extracted.push(out);
    }
    off = dataEnd;
  }
}

try {
  const usedCentral = extractByCentralDirectory();
  if (!usedCentral) extractByLocalHeaders();
  if (!extracted.length) {
    console.error('not found in zip: ' + want);
    process.exit(1);
  }
  console.log('extracted: ' + extracted[0]);
} catch (e) {
  console.error('zip extract failed: ' + e.message);
  process.exit(1);
}
