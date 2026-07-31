'use strict';

/* Official routing databases shipped in the matching Xray release archive.

   Hashes are pinned here as a runtime trust anchor. The package builder checks
   the same values before an IPK is produced, and the service checks them again
   before copying or starting Xray. */

var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var errors = require('./errors');
var err = errors.err;

var ASSETS = {
  'geosite.dat': {
    sha256: 'adf92de0cfc70e458b399f04c5f912bf42d115ed7e37281b30e2f1c68605e4e9',
    size: 10491954
  },
  'geoip.dat': {
    sha256: '744c97b74c52bae2ac8664fef6ac481d7765cb8432a0df54f0368a88b9b4a354',
    size: 19768301
  }
};

function sha256File(file) {
  var hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function checkFile(file, name) {
  var expected = ASSETS[name];
  var stat, actual;
  if (!expected) return err('ASSET_MISSING', 'unsupported Xray asset: ' + name);
  try {
    stat = fs.statSync(file);
    if (!stat.isFile()) return err('ASSET_MISSING', 'required Xray asset missing: ' + file);
  } catch (eStat) {
    return err('ASSET_MISSING', 'required Xray asset missing: ' + file);
  }
  if (stat.size !== expected.size) {
    return err('ASSET_CORRUPT', 'Xray asset has wrong size: ' + file);
  }
  try { actual = sha256File(file); } catch (eHash) {
    return err('ASSET_CORRUPT', 'cannot verify Xray asset: ' + file);
  }
  if (actual !== expected.sha256) {
    return err('ASSET_CORRUPT', 'Xray asset checksum mismatch: ' + file);
  }
  return null;
}

function referenced(config) {
  var needed = {};

  function visit(value) {
    var i, key;
    if (typeof value === 'string') {
      if (value.indexOf('geosite:') >= 0) needed['geosite.dat'] = true;
      if (value.indexOf('geoip:') >= 0) needed['geoip.dat'] = true;
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (Object.prototype.toString.call(value) === '[object Array]') {
      for (i = 0; i < value.length; i++) visit(value[i]);
      return;
    }
    for (key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) visit(value[key]);
    }
  }

  visit(config);
  return Object.keys(needed).sort();
}

function verifyReferenced(config, assetDir) {
  var names = referenced(config);
  var i, problem;
  for (i = 0; i < names.length; i++) {
    problem = checkFile(path.join(assetDir, names[i]), names[i]);
    if (problem) return problem;
  }
  return null;
}

module.exports = {
  ASSETS: ASSETS,
  sha256File: sha256File,
  checkFile: checkFile,
  referenced: referenced,
  verifyReferenced: verifyReferenced
};
