'use strict';

/* Subscription retrieval.

   Panels serve different payloads to different clients, so we try a small
   ordered set of client profiles and merge what they return. All fetching goes
   through the hardened HTTP client, so every attempt and every redirect is
   subject to the SSRF and TLS policy.

   Nested subscriptions (a body that is nothing but URLs) are expanded once,
   with a bounded count and a shared byte budget. */

var httpClient = require('./http-client');
var parsers = require('../proto/parsers');
var errors = require('../errors');
var err = errors.err;

var MAX_NESTED = 32;
var MAX_TOTAL_BYTES = 4 * 1024 * 1024;
var IMPORT_TIMEOUT_MS = 60 * 1000;
var MAX_PARALLEL_NESTED = 4;

function markNested(error) {
  var meta = (error && error.meta) || {};
  var nestedMeta = {
    stage: meta.stage || 'nested-fetch',
    redirectHop: typeof meta.redirectHop === 'number' ? meta.redirectHop : 0,
    protocol: meta.protocol || 'unknown',
    originChanged: meta.originChanged === true,
    nested: true
  };
  if (meta.transportErrorCode) nestedMeta.transportErrorCode = meta.transportErrorCode;
  if (meta.transportErrorName) nestedMeta.transportErrorName = meta.transportErrorName;
  if (meta.tlsPhase) nestedMeta.tlsPhase = meta.tlsPhase;
  return err((error && error.code) || 'NETWORK_ERROR', (error && error.detail) || '', nestedMeta);
}

/* Client identities. Only non-identifying headers are sent; no device or
   hardware identifiers are derived or transmitted. */
var CLIENT_PROFILES = [
  { name: 'Happ', ua: 'Happ/3.1.0/android' },
  { name: 'sing-box', ua: 'sing-box/1.13.0' },
  { name: 'v2RayTun', ua: 'v2RayTun/5.23.73' },
  { name: 'Clash Meta', ua: 'ClashMetaForAndroid/2.11.16.Meta' },
  { name: 'Browser', ua: 'Mozilla/5.0 (X11; Linux armv7l) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36' }
];

function headersFor(index, options) {
  options = options || {};
  var profile = CLIENT_PROFILES[index] || CLIENT_PROFILES[0];
  var headers = {
    'User-Agent': profile.ua,
    'Accept': '*/*'
  };
  /* Provider compatibility mode: explicitly requested by user and restricted to verified HTTPS URLs only. */
  if (options.compatMode && options.isHttps && options.hwid) {
    headers['User-Agent'] = options.ua || 'Happ/4.0.0/webOS';
    headers['X-HWID'] = options.hwid;
    headers['X-Device-OS'] = options.deviceOS || 'webOS';
    headers['X-Ver-OS'] = options.verOS || '4.0.0';
    headers['X-Device-model'] = options.deviceModel || 'TV';
  }
  return headers;
}

function profileLabel(index) {
  var profile = CLIENT_PROFILES[index] || CLIENT_PROFILES[0];
  return profile.name;
}

/* Expand a body that consists purely of subscription URLs. Mixed content is
   treated as ordinary content, since portals often include help links. */
function expandNested(body, options, callback) {
  var lines = String(body || '').split(/\r?\n/);
  var jobs = [], meaningful = 0, i, line;
  var out = lines.slice(0);
  var totalBytes = Buffer.byteLength(out.join('\n'), 'utf8');
  var active = 0, next = 0, finished = false, failure = null;

  for (i = 0; i < lines.length; i++) {
    line = parsers.safeText(lines[i], 2048);
    if (!line || line.charAt(0) === '#' || line.indexOf('//') === 0) continue;
    meaningful++;
    if (/^https?:\/\/\S+$/i.test(line)) jobs.push({ index: i, url: line });
  }
  if (!jobs.length || jobs.length !== meaningful) return callback(null, body);
  if (jobs.length > MAX_NESTED) return callback(err('TOO_MANY_NESTED', String(jobs.length)));

  function finish() {
    if (finished || active !== 0) return;
    if (!failure && next < jobs.length) return;
    finished = true;
    if (failure) return callback(failure);
    callback(null, out.join('\n'));
  }

  function pump() {
    while (!finished && !failure && active < MAX_PARALLEL_NESTED && next < jobs.length) {
      (function (job) {
        active++;
        httpClient.fetchUrl(job.url, {
          headers: options.headers,
          deadline: options.deadline
        }, function (fetchError, nestedBody) {
          active--;
          if (finished) return;
          if (fetchError) {
            failure = markNested(fetchError);
          } else {
            var decoded = parsers.safeBase64Decode(nestedBody || '');
            totalBytes = totalBytes - Buffer.byteLength(out[job.index] || '', 'utf8') +
              Buffer.byteLength(decoded, 'utf8');
            if (totalBytes > MAX_TOTAL_BYTES) failure = err('RESPONSE_TOO_LARGE', 'nested total too large');
            else out[job.index] = decoded;
          }
          pump();
        });
      })(jobs[next++]);
    }
    finish();
  }
  pump();
}

/* Fetch one candidate and parse it into profile descriptors. */
function fetchCandidate(url, clientIndex, deadline, callback, options) {
  options = options || {};
  var isHttps = /^https:/i.test(url);
  var reqOptions = {
    compatMode: !!options.compatMode,
    hwid: options.hwid || '',
    isHttps: isHttps,
    ua: options.ua,
    deviceOS: options.deviceOS,
    verOS: options.verOS,
    deviceModel: options.deviceModel
  };
  var headers = headersFor(clientIndex, reqOptions);
  httpClient.fetchUrl(url, { headers: headers, deadline: deadline }, function (fetchError, body, responseHeaders) {
    if (fetchError) return callback(fetchError);
    expandNested(body, { headers: headers, deadline: deadline }, function (nestedError, content) {
      var merged = {}, key, imported;
      if (nestedError) return callback(nestedError);
      try {
        imported = parsers.extractSubscriptionProfiles(content);
      } catch (parseError) {
        return callback(parseError);
      }
      if (!imported.length) {
        if (/turn on HWID|enable HWID|HWID required|app not supported|application not supported/i.test(content)) {
          return callback(err('HWID_REQUIRED', 'Provider requires HWID transmission'));
        }
        return callback(parsers.looksLikeUnsupportedSubscriptionPage(content)
          ? err('NO_SERVERS_FOUND', 'client mode rejected')
          : err('NO_SERVERS_FOUND', 'no supported servers'));
      }
      for (key in (responseHeaders || {})) {
        if (Object.prototype.hasOwnProperty.call(responseHeaders, key)) {
          merged[String(key).toLowerCase()] = responseHeaders[key];
        }
      }
      /* Content-embedded headers (#profile-title:) supplement HTTP headers. */
      var contentHeaders = parsers.parseContentHeaders(content);
      for (key in contentHeaders) {
        if (!merged[key]) merged[key] = contentHeaders[key];
      }
      callback(null, { imported: imported, headers: merged, clientIndex: clientIndex });
    });
  });
}

/* Try client profiles in order and merge their results, so a panel that hides
   some servers behind a particular client string still yields a full list. */
function download(url, callback, options) {
  options = options || {};
  var deadline = Date.now() + (options.timeout || IMPORT_TIMEOUT_MS);
  var merged = [], mergedKeys = {}, labels = [];
  var best = null, lastError = null;
  var index = 0;

  function step() {
    if (index >= CLIENT_PROFILES.length || Date.now() >= deadline) {
      if (merged.length) {
        return callback(null, {
          imported: merged,
          headers: (best && best.headers) || {},
          clients: labels.join(', ')
        });
      }
      return callback(lastError || err('NO_SERVERS_FOUND', 'no supported servers'));
    }
    var current = index++;
    fetchCandidate(url, current, deadline, function (candidateError, candidate) {
      var i, descriptor, key;
      if (candidateError) {
        lastError = candidateError;
        /* A policy or certificate failure is terminal: retrying with another
           user agent cannot make an unsafe destination safe. */
        if (candidateError.code === 'BLOCKED_ADDRESS' || candidateError.code === 'BLOCKED_SCHEME' ||
            candidateError.code === 'TLS_CERTIFICATE_INVALID' || candidateError.code === 'URL_CREDENTIALS_REJECTED' ||
            candidateError.code === 'INVALID_URL' || candidateError.code === 'HTTPS_DOWNGRADE_REJECTED') {
          return callback(candidateError);
        }
        return step();
      }
      if (!best) best = candidate;
      if (labels.indexOf(profileLabel(current)) < 0) labels.push(profileLabel(current));
      for (i = 0; i < candidate.imported.length; i++) {
        descriptor = candidate.imported[i];
        key = parsers.profileKey(descriptor);
        if (mergedKeys[key]) continue;
        mergedKeys[key] = true;
        merged.push(descriptor);
      }
      /* Primary candidate agreement: return imported servers immediately once a candidate succeeds */
      if (merged.length > 0) {
        return callback(null, { imported: merged, headers: best.headers, clients: labels.join(', ') });
      }
      step();
    }, options);
  }
  step();
}

module.exports = {
  MAX_NESTED: MAX_NESTED,
  MAX_TOTAL_BYTES: MAX_TOTAL_BYTES,
  IMPORT_TIMEOUT_MS: IMPORT_TIMEOUT_MS,
  CLIENT_PROFILES: CLIENT_PROFILES,
  download: download,
  fetchCandidate: fetchCandidate,
  expandNested: expandNested,
  headersFor: headersFor
};
