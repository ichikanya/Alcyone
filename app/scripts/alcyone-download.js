#!/usr/bin/env node
'use strict';
const fs = require('fs');
const http = require('http');
const https = require('https');
const urlMod = require('url');

const url = process.argv[2];
const out = process.argv[3];
if (!url || !out) {
  console.error('Usage: alcyone-download.js URL OUT');
  process.exit(2);
}

function requestOnce(url, redirects) {
  return new Promise((resolve, reject) => {
    const u = new urlMod.URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const opts = {
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || undefined,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { 'User-Agent': 'Alcyone-webOS/3.2.0' },
      rejectUnauthorized: false,
    };
    const req = lib.request(opts, (res) => {
      const code = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(code) && res.headers.location && redirects > 0) {
        const next = new urlMod.URL(res.headers.location, url).toString();
        res.resume();
        resolve(requestOnce(next, redirects - 1));
        return;
      }
      if (code < 200 || code >= 300) {
        res.resume();
        reject(new Error('HTTP ' + code));
        return;
      }
      const tmp = out + '.tmp';
      const file = fs.createWriteStream(tmp);
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          try {
            const st = fs.statSync(tmp);
            if (!st.size) throw new Error('empty download');
            fs.renameSync(tmp, out);
            resolve();
          } catch (e) { reject(e); }
        });
      });
      file.on('error', reject);
    });
    req.setTimeout(45000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

requestOnce(url, 8).then(() => {
  console.log('downloaded: ' + out);
}).catch((e) => {
  try { fs.unlinkSync(out + '.tmp'); } catch (_) {}
  console.error('download failed: ' + e.message);
  process.exit(1);
});
