'use strict';

/* Hardened HTTP client for subscription downloads.

   Security properties, all enforced here rather than by callers:

   - only http/https, validated by the SSRF policy before every connection;
   - names are resolved once, every answer is checked, and the connection is
     pinned to a validated address while TLS still verifies the original
     hostname (this is what closes DNS rebinding);
   - certificate validation is never disabled and there is no insecure retry:
     a TLS failure returns TLS_CERTIFICATE_INVALID to the UI;
   - redirects are re-validated with the same rules, counted, and credential
     bearing headers are dropped when the origin changes;
   - connect, read and total deadlines, plus header, body and decompressed
     size caps, bound every request. */

var http = require('http');
var https = require('https');
var zlib = require('zlib');
var fs = require('fs');
var path = require('path');
var url = require('url');
var dnsResolver = require('./dns-resolver');
var ssrf = require('./ssrf');
var errors = require('../errors');
var err = errors.err;

var CONNECT_TIMEOUT_MS = 10000;
var READ_TIMEOUT_MS = 15000;
var TOTAL_TIMEOUT_MS = 45000;
var MAX_HEADER_BYTES = 32 * 1024;
var MAX_BODY_BYTES = 2 * 1024 * 1024;
var MAX_DECOMPRESSED_BYTES = 8 * 1024 * 1024;
var MAX_CONCURRENT = 4;
var COMPAT_ECDH_CURVES = 'prime256v1:secp384r1:secp521r1';
var activeRequests = 0;
var requestQueue = [];
var bundledCa = null;

/* webOS 4 ships an old Node trust store which no longer validates many
   otherwise-correct modern certificate chains.  Use the packaged Mozilla CA
   bundle while keeping normal hostname and certificate verification enabled. */
function loadBundledCa() {
  if (bundledCa !== null) return bundledCa || null;
  try {
    /* Node 0.12 requires `ca` as an array; a concatenated PEM string is
       treated as one certificate and yields CERT_UNTRUSTED. */
    bundledCa = fs.readFileSync(path.join(__dirname, '..', '..', 'certs', 'cacert.pem'), 'utf8')
      .match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || [];
  } catch (e) {
    bundledCa = [];
  }
  return bundledCa.length ? bundledCa : null;
}

function isTlsError(error) {
  var code = String((error && (error.code || error.errno)) || '');
  var message = String((error && error.message) || '').toLowerCase();
  if (code.indexOf('CERT') >= 0 || code.indexOf('SSL') >= 0) return true;
  if (code === 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') return true;
  if (code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'SELF_SIGNED_CERT_IN_CHAIN') return true;
  if (code === 'ERR_TLS_CERT_ALTNAME_INVALID') return true;
  return message.indexOf('certificate') >= 0 || message.indexOf('issuer') >= 0 || message.indexOf('altname') >= 0;
}

/* Some webOS 5.x vendor Node builds advertise only P-256 even though their
   OpenSSL supports P-384 and P-521. ECDSA providers using P-384 then reject
   the ClientHello before sending a certificate. Node 0.12/OpenSSL 1.0.1 does
   not support curve-list syntax and already advertises a broad default, so it
   must retain that runtime default. */
function compatibleEcdhCurves() {
  var major = parseInt(String(
    process && process.versions && process.versions.node || '0'
  ).split('.')[0], 10);
  return major >= 4 ? COMPAT_ECDH_CURVES : null;
}

/* Resolve a hostname to addresses that all pass the SSRF policy. */
function resolveValidated(hostname, callback) {
  var literal = ssrf.parseIpv4(hostname) ? 4 : (hostname.indexOf(':') >= 0 ? 6 : 0);
  if (literal) {
    try {
      ssrf.assertAddressAllowed(hostname, literal);
    } catch (e) {
      return callback(e);
    }
    return callback(null, [{ address: hostname, family: literal }]);
  }
  /* Resolve every A and AAAA answer.  The helper deliberately avoids the
     dns.lookup({all:true}) API missing from the Node 0.12 runtime on webOS 4. */
  dnsResolver.resolveAll(hostname, function (lookupError, addresses) {
    if (lookupError || !addresses || !addresses.length) return callback(err('DNS_FAILED', 'lookup failed'));
    try {
      ssrf.assertResolvedAddresses(addresses);
    } catch (policyError) {
      return callback(policyError);
    }
    callback(null, addresses);
  });
}

function decodeBody(buffer, encoding, callback) {
  var normalized = String(encoding || '').toLowerCase();
  var decoder, chunks, size, settled;

  function decodeWith(createDecoder) {
    chunks = [];
    size = 0;
    settled = false;
    try {
      decoder = createDecoder();
    } catch (createError) {
      return callback(err('NETWORK_ERROR', 'malformed compressed response'));
    }
    decoder.on('data', function (chunk) {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_DECOMPRESSED_BYTES) {
        settled = true;
        chunks = [];
        try { decoder.destroy(); } catch (e) {}
        callback(err('DECOMPRESSED_TOO_LARGE', 'response too large'));
        return;
      }
      chunks.push(chunk);
    });
    decoder.on('error', function () {
      if (settled) return;
      settled = true;
      chunks = [];
      callback(err('NETWORK_ERROR', 'malformed compressed response'));
    });
    decoder.on('end', function () {
      if (settled) return;
      settled = true;
      callback(null, Buffer.concat(chunks, size).toString('utf8'));
    });
    decoder.end(buffer);
  }

  if (normalized === 'gzip') return decodeWith(function () { return zlib.createGunzip(); });
  if (normalized === 'deflate') return decodeWith(function () { return zlib.createInflate(); });
  if (buffer.length > MAX_DECOMPRESSED_BYTES) return callback(err('DECOMPRESSED_TOO_LARGE', 'response too large'));
  callback(null, buffer.toString('utf8'));
}

function targetUrl(target) {
  var host = target.hostname.indexOf(':') >= 0
    ? '[' + target.hostname + ']'
    : target.hostname;
  return target.scheme + '://' + host + ':' + target.port + target.path;
}

/* Diagnostics only: security decisions continue to use ssrf.assertUrlAllowed.
   Legacy url.parse is available on Node 0.12 and lets a rejected redirect
   report whether its scheme/host/effective-port differed without retaining any
   destination text. */
function redirectOriginChanged(current, resolved) {
  var parsed;
  var scheme;
  var hostname;
  var port;
  try {
    parsed = url.parse(resolved);
    scheme = String(parsed.protocol || '').replace(/:$/, '').toLowerCase();
    hostname = String(parsed.hostname || '').toLowerCase();
    port = parsed.port ? parseInt(parsed.port, 10) : (scheme === 'https' ? 443 : 80);
    return current.origin !== scheme + '://' + hostname + ':' + port;
  } catch (e) {
    return false;
  }
}

/* Resolve one Location value using Node's legacy URL implementation (present
   on webOS Node 0.12), validate it immediately, and prohibit transport
   downgrade before another request is attempted. fetchUrlNow validates the
   same URL again and performs fresh DNS/address checks for the new hop. */
function redirectUrl(current, location) {
  var next = url.resolve(targetUrl(current), String(location || ''));
  var target;
  try {
    target = ssrf.assertUrlAllowed(next);
  } catch (policyError) {
    throw err(
      errors.isAlcyoneError(policyError) ? policyError.code : 'INVALID_URL',
      errors.isAlcyoneError(policyError) ? policyError.detail : 'invalid redirect',
      {
        stage: 'redirect',
        protocol: protocolHint(next),
        originChanged: redirectOriginChanged(current, next)
      }
    );
  }
  if (current.scheme === 'https' && target.scheme === 'http') {
    throw err('HTTPS_DOWNGRADE_REJECTED', 'https redirect downgrade', {
      stage: 'redirect',
      protocol: target.scheme,
      originChanged: !ssrf.sameOrigin(current, target)
    });
  }
  return next;
}

/* Safe, deliberately tiny request diagnostics. These values may be returned to
   the authenticated importer and written to the service log, so they never
   contain a URL component, hostname, header, body or provider identifier. */
function protocolHint(rawUrl) {
  var match = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(String(rawUrl || ''));
  var protocol = match ? match[1].toLowerCase() : '';
  return protocol === 'http' || protocol === 'https' ? protocol : 'unknown';
}

function safeDiagnosticToken(value, fallback) {
  value = String(value || '');
  return /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : fallback;
}

function transportDiagnostic(error, tlsPhase) {
  return {
    transportErrorCode: safeDiagnosticToken(
      error && (error.code || error.errno),
      'UNKNOWN'
    ),
    transportErrorName: safeDiagnosticToken(error && error.name, 'Error'),
    tlsPhase: safeDiagnosticToken(tlsPhase, 'unknown')
  };
}

function requestError(error, stage, hop, protocol, originChanged, extra) {
  var code = errors.isAlcyoneError(error) ? error.code : 'NETWORK_ERROR';
  var detail = errors.isAlcyoneError(error)
    ? error.detail
    : String((error && error.code) || 'request failed');
  var prior = (error && error.meta) || {};
  var meta = {
    stage: String(prior.stage || stage || 'unknown'),
    redirectHop: typeof prior.redirectHop === 'number' ? prior.redirectHop : hop,
    protocol: String(prior.protocol || protocol || 'unknown'),
    originChanged: prior.originChanged === true || !!originChanged
  };
  if ((prior.nested === true) || (extra && extra.nested === true)) meta.nested = true;
  if (prior.transportErrorCode) {
    meta.transportErrorCode = safeDiagnosticToken(prior.transportErrorCode, 'UNKNOWN');
  }
  if (prior.transportErrorName) {
    meta.transportErrorName = safeDiagnosticToken(prior.transportErrorName, 'Error');
  }
  if (prior.tlsPhase) meta.tlsPhase = safeDiagnosticToken(prior.tlsPhase, 'unknown');
  return err(code, detail, meta);
}

/* Perform a single validated request, following redirects manually. */
function fetchUrlNow(rawUrl, options, callback) {
  options = options || {};
  var deadline = options.deadline || (Date.now() + TOTAL_TIMEOUT_MS);
  var redirects = options.redirects || 0;
  var headers = options.headers || {};
  var previous = options.previousTarget || null;
  var settled = false;
  var totalTimer = null;
  var target;
  var protocol = protocolHint(rawUrl);
  var originChanged = false;
  var stage = 'url-validation';
  var responseStarted = false;
  var tlsPhase = 'not-applicable';

  function done(error, body, responseHeaders) {
    if (settled) return;
    settled = true;
    if (totalTimer) {
      clearTimeout(totalTimer);
      totalTimer = null;
    }
    callback(error
      ? requestError(error, stage, redirects, protocol, originChanged)
      : null, body, responseHeaders);
  }

  if (Date.now() >= deadline) return done(err('TIMEOUT', 'deadline exceeded'));
  if (redirects > ssrf.MAX_REDIRECTS) return done(err('TOO_MANY_REDIRECTS', String(redirects)));

  try {
    target = ssrf.assertUrlAllowed(rawUrl);
  } catch (policyError) {
    return done(policyError);
  }
  protocol = target.scheme;
  originChanged = !!previous && !ssrf.sameOrigin(previous, target);

  /* Any change of origin drops credential-bearing headers. */
  if (originChanged) headers = ssrf.stripSensitiveHeaders(headers);

  stage = 'dns-validation';
  resolveValidated(target.hostname, function (resolveError, addresses) {
    if (resolveError) return done(resolveError);

    var pinned = addresses[0];
    var isHttps = target.scheme === 'https';
    var mod = isHttps ? https : http;
    var requestHeaders = {};
    var key, request;

    for (key in headers) {
      if (Object.prototype.hasOwnProperty.call(headers, key)) requestHeaders[key] = headers[key];
    }
    requestHeaders.Host = target.hostname;
    requestHeaders['Accept-Encoding'] = 'gzip, deflate';
    requestHeaders.Connection = 'close';

    var requestOptions = {
      /* Connect to the address we validated, not to a name the resolver may
         answer differently a second time. */
      host: pinned.address,
      port: target.port,
      path: target.path,
      method: 'GET',
      headers: requestHeaders,
      /* TLS still verifies the real hostname against the certificate. */
      servername: isHttps ? target.hostname : undefined,
      rejectUnauthorized: true,
      agent: false,
      maxHeaderSize: MAX_HEADER_BYTES
    };
    if (isHttps && loadBundledCa()) requestOptions.ca = bundledCa;
    if (isHttps && compatibleEcdhCurves()) {
      requestOptions.ecdhCurve = compatibleEcdhCurves();
    }

    stage = 'connect';
    if (isHttps) tlsPhase = 'tcp-connect';
    request = mod.request(requestOptions, function (response) {
      var status = response.statusCode || 0;
      var location = response.headers && response.headers.location;
      var chunks = [], received = 0;
      responseStarted = true;
      stage = 'response-status';
      if (isHttps) tlsPhase = 'verified';

      if (status >= 300 && status < 400 && location) {
        response.resume();
        if (settled) return;
        settled = true;
        stage = 'redirect';
        try {
          location = redirectUrl(target, location);
        } catch (redirectError) {
          if (totalTimer) clearTimeout(totalTimer);
          return callback(requestError(
            redirectError,
            stage,
            redirects + 1,
            protocolHint(location),
            redirectError && redirectError.meta && redirectError.meta.originChanged
          ));
        }
        if (totalTimer) clearTimeout(totalTimer);
        return fetchUrlNow(location, {
          deadline: deadline,
          redirects: redirects + 1,
          headers: headers,
          previousTarget: target
        }, callback);
      }
      if (status < 200 || status >= 300) {
        response.resume();
        if (status === 401) return done(err('PROVIDER_AUTH_FAILED', '401', { status: 401 }));
        if (status === 403) return done(err('PROVIDER_REJECTED', '403', { status: 403 }));
        return done(err('HTTP_ERROR', String(status), { status: status }));
      }

      stage = 'response-read';
      response.on('data', function (chunk) {
        if (settled) return;
        received += chunk.length;
        if (received > MAX_BODY_BYTES) {
          chunks = [];
          done(err('RESPONSE_TOO_LARGE', 'body limit exceeded'));
          try { response.destroy(); } catch (e) {}
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', function () {
        if (settled) return;
        var buffer = Buffer.concat(chunks);
        chunks = [];
        stage = 'decode';
        decodeBody(buffer, response.headers['content-encoding'], function (decodeError, text) {
          if (totalTimer) clearTimeout(totalTimer);
          if (decodeError) return done(decodeError);
          done(null, text, response.headers || {});
        });
      });
      response.on('error', function (responseError) {
        stage = 'response-read';
        done(err(
          'NETWORK_ERROR',
          (responseError && responseError.code) || 'response failed',
          transportDiagnostic(responseError, tlsPhase)
        ));
      });
      response.setTimeout(READ_TIMEOUT_MS, function () {
        stage = 'response-read';
        done(err('TIMEOUT', 'read timeout'));
        try { response.destroy(); } catch (e) {}
      });
    });

    request.on('socket', function (socket) {
      if (!isHttps || !socket || typeof socket.on !== 'function') return;
      socket.on('connect', function () { tlsPhase = 'tls-handshake'; });
      socket.on('secure', function () { tlsPhase = 'certificate-verification'; });
      socket.on('secureConnect', function () { tlsPhase = 'verified'; });
    });
    request.setTimeout(CONNECT_TIMEOUT_MS, function () {
      done(err('TIMEOUT', 'connect timeout', { tlsPhase: tlsPhase }));
      try { request.destroy(); } catch (e) {}
    });
    request.on('error', function (transportError) {
      /* No insecure retry: a certificate problem is reported, never bypassed. */
      stage = responseStarted ? 'response-read' : 'connect';
      if (isTlsError(transportError)) {
        return done(err(
          'TLS_CERTIFICATE_INVALID',
          'certificate verification failed',
          transportDiagnostic(transportError, tlsPhase)
        ));
      }
      done(err(
        'NETWORK_ERROR',
        transportError.code || 'request failed',
        transportDiagnostic(transportError, tlsPhase)
      ));
    });

    totalTimer = setTimeout(function () {
      if (!responseStarted) stage = 'connect';
      done(err('TIMEOUT', 'total timeout', { tlsPhase: tlsPhase }));
      try { request.destroy(); } catch (e) {}
    }, Math.max(1, deadline - Date.now()));

    request.end();
  });
}

function pumpQueue() {
  var job;
  while (activeRequests < MAX_CONCURRENT && requestQueue.length) {
    job = requestQueue.shift();
    if (job.options.deadline && Date.now() >= job.options.deadline) {
      job.callback(err('TIMEOUT', 'deadline exceeded'));
      continue;
    }
    activeRequests++;
    (function (current) {
      fetchUrlNow(current.url, current.options, function () {
        var args = arguments;
        activeRequests--;
        current.callback.apply(null, args);
        pumpQueue();
      });
    })(job);
  }
}

/* One process-wide limiter covers simultaneous Luna requests as well as
   nested subscription documents. Redirects retain their existing slot. */
function fetchUrl(rawUrl, options, callback) {
  requestQueue.push({ url: rawUrl, options: options || {}, callback: callback });
  pumpQueue();
}

module.exports = {
  CONNECT_TIMEOUT_MS: CONNECT_TIMEOUT_MS,
  READ_TIMEOUT_MS: READ_TIMEOUT_MS,
  TOTAL_TIMEOUT_MS: TOTAL_TIMEOUT_MS,
  MAX_HEADER_BYTES: MAX_HEADER_BYTES,
  MAX_BODY_BYTES: MAX_BODY_BYTES,
  MAX_DECOMPRESSED_BYTES: MAX_DECOMPRESSED_BYTES,
  MAX_CONCURRENT: MAX_CONCURRENT,
  fetchUrl: fetchUrl,
  resolveValidated: resolveValidated,
  isTlsError: isTlsError,
  decodeBody: decodeBody,
  loadBundledCa: loadBundledCa,
  redirectUrl: redirectUrl,
  requestError: requestError,
  protocolHint: protocolHint,
  transportDiagnostic: transportDiagnostic,
  compatibleEcdhCurves: compatibleEcdhCurves
};
