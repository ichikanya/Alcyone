'use strict';

/* LAN importer HTTP server.

   Deliberately minimal and deny-by-default:

   - binds to loopback unless the user explicitly enables LAN access on the TV,
     and the LAN listener stops automatically when the window closes;
   - unauthenticated clients only ever see the pairing form;
   - every state-changing request needs both a valid session cookie and a
     matching CSRF token;
   - no wildcard CORS. Cross-origin requests are simply not enabled, and an
     Origin header from another site is rejected;
   - responses carry only sanitized display metadata; stored links, UUIDs,
     passwords and subscription URLs are never serialized here.

   The server does not manage the VPN process or system routes: it delegates to
   the store and the importer through the handlers it is given. */

var http = require('http');
var templates = require('./templates');
var validate = require('../validate');
var errors = require('../errors');
var err = errors.err;

var MAX_BODY_BYTES = 64 * 1024;
var MAX_CONNECTIONS = 16;
var HEADERS_TIMEOUT_MS = 10000;
var REQUEST_TIMEOUT_MS = 120000;
var SESSION_COOKIE = 'alcyone_session';

function securityHeaders(extra) {
  var headers = {
    'Cache-Control': 'no-store',
    /* Must not be no-referrer. Under a no-referrer policy a browser serializes
       the Origin of a form submission as the opaque value "null", so the
       importer's own pairing POST arrived looking cross-site and was refused.
       same-origin keeps the referrer off any third party — there are none, the
       page loads no external resource — while leaving a real Origin on our own
       requests, which is what the CSRF check needs to work at all. */
    'Referrer-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    /* No remote origins, no inline frames; inline script is required for the
       small importer page and is served from this origin only.
       connect-src must be stated explicitly: it falls back to default-src, so
       without it 'none' would block the page's own XHR calls to /api/*. */
    'Content-Security-Policy': "default-src 'none'; connect-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
  };
  var key;
  for (key in (extra || {})) {
    if (Object.prototype.hasOwnProperty.call(extra, key)) headers[key] = extra[key];
  }
  return headers;
}

function parseCookies(req) {
  var out = {};
  var raw = (req.headers && req.headers.cookie) || '';
  var parts = raw.split(';');
  var i, part, idx;
  for (i = 0; i < parts.length; i++) {
    part = parts[i].trim();
    idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx)] = part.slice(idx + 1);
  }
  return out;
}

/* Identify the peer for rate limiting. */
function clientKey(req) {
  var address = (req.socket && (req.socket.remoteAddress || '')) || '';
  return String(address).replace(/^::ffff:/, '') || 'unknown';
}

function readBody(req, callback) {
  var chunks = [], size = 0, aborted = false;
  req.on('data', function (chunk) {
    if (aborted) return;
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      aborted = true;
      chunks = [];
      callback(err('BODY_TOO_LARGE', 'request body too large'));
      try { req.destroy(); } catch (e) {}
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', function () {
    if (aborted) return;
    callback(null, Buffer.concat(chunks).toString('utf8'));
  });
  req.on('error', function () {
    if (!aborted) { aborted = true; callback(err('NETWORK_ERROR', 'request failed')); }
  });
}

function ImporterServer(options) {
  options = options || {};
  this.pairing = options.pairing;
  this.store = options.store;
  this.logger = options.logger;
  this.handlers = options.handlers || {};
  this.port = options.port === undefined ? 8080 : options.port;
  this.server = null;
  this.boundHost = '';
  this.boundPort = 0;
  this.exposureTimer = null;
  /* Set while a bind is in flight, so overlapping listen() calls serialize. */
  this.binding = false;
  this.pendingListen = null;
}

/* Only same-origin form posts and same-origin XHR are acceptable. There is no
   allowed cross-origin, so any foreign Origin is refused outright.

   A literal "null" Origin is the opaque serialization a browser emits for
   privacy-sensitive contexts. It is not proof of a foreign site, but it is not
   proof of our own page either, so it is only accepted when the browser also
   states the request is same-origin through Sec-Fetch-Site. That header is
   forbidden to page script and set by the browser itself, so a cross-site
   attacker cannot forge it; browsers too old to send it simply fall through to
   the strict comparison below. */
ImporterServer.prototype.originAllowed = function (req) {
  var headers = req.headers || {};
  var origin = headers.origin;
  var host = headers.host;
  var site = headers['sec-fetch-site'];
  if (!origin) return true; /* same-origin navigations omit Origin */
  if (!host) return false;
  if (origin === 'null') return site === 'same-origin' || site === 'none';
  return origin === 'http://' + host || origin === 'https://' + host;
};

ImporterServer.prototype.sendJson = function (res, status, payload) {
  var body = JSON.stringify(payload);
  res.writeHead(status, securityHeaders({ 'Content-Type': 'application/json; charset=utf-8' }));
  res.end(body);
};

ImporterServer.prototype.sendHtml = function (res, status, html, extraHeaders) {
  var headers = securityHeaders({ 'Content-Type': 'text/html; charset=utf-8' });
  var key;
  for (key in (extraHeaders || {})) {
    if (Object.prototype.hasOwnProperty.call(extraHeaders, key)) headers[key] = extraHeaders[key];
  }
  res.writeHead(status, headers);
  res.end(html);
};

/* Resolve the session for a request, or null when unauthenticated. */
ImporterServer.prototype.sessionFor = function (req) {
  var cookies = parseCookies(req);
  try {
    return this.pairing.validateSession(cookies[SESSION_COOKIE]);
  } catch (e) {
    return null;
  }
};

ImporterServer.prototype.handle = function (req, res) {
  var self = this;
  var url = String(req.url || '/');
  var pathname = url.split('?')[0];
  var lang = templates.langFromAcceptLanguage(req.headers['accept-language']);
  var method = req.method || 'GET';
  var session;

  /* Cross-origin requests are never enabled; do not answer preflight. */
  if (method === 'OPTIONS') {
    res.writeHead(405, securityHeaders({ Allow: 'GET, POST' }));
    return res.end();
  }
  if (method !== 'GET' && method !== 'POST') {
    res.writeHead(405, securityHeaders({ Allow: 'GET, POST' }));
    return res.end();
  }
  /* Reported separately from CSRF_FAILED: conflating the two made a rejected
     Origin indistinguishable from a bad token, which is what hid this. */
  if (!this.originAllowed(req)) {
    this.logger.warn('importer rejected a foreign origin', {
      endpoint: pathname,
      site: String(req.headers['sec-fetch-site'] || 'absent')
    });
    return this.sendJson(res, 403, { ok: false, errorCode: errors.CODES.FORBIDDEN });
  }
  /* Access must be open: either a pairing window or a live session. */
  if (!this.pairing.accessActive()) {
    return this.sendHtml(res, 403, templates.pairingPage(lang, { error: templates.t(lang, 'session.expired') }));
  }

  session = this.sessionFor(req);

  if (pathname === '/pair' && method === 'POST') return this.handlePair(req, res, lang);

  if (!session) {
    if (pathname.indexOf('/api/') === 0) {
      return this.sendJson(res, 401, { ok: false, errorCode: errors.CODES.UNAUTHORIZED });
    }
    return this.sendHtml(res, 200, templates.pairingPage(lang, {}));
  }

  if (pathname === '/' && method === 'GET') {
    return this.sendHtml(res, 200, templates.importerPage(lang, {
      profiles: this.store.sanitizedProfiles(),
      subscriptions: this.store.sanitizedSubscriptions(),
      csrf: session.csrf
    }));
  }
  if (pathname === '/api/profiles' && method === 'GET') {
    /* Sanitized display metadata only. */
    return this.sendJson(res, 200, {
      ok: true,
      profiles: this.store.sanitizedProfiles(),
      subscriptions: this.store.sanitizedSubscriptions()
    });
  }

  if (method === 'POST' && pathname.indexOf('/api/') === 0) {
    /* Every mutation is CSRF protected. */
    try {
      this.pairing.assertCsrf(session, req.headers['x-alcyone-csrf']);
    } catch (csrfError) {
      return this.sendJson(res, 403, { ok: false, errorCode: csrfError.code });
    }
    return readBody(req, function (bodyError, raw) {
      var payload;
      if (bodyError) return self.sendJson(res, 413, { ok: false, errorCode: bodyError.code });
      try {
        payload = raw ? JSON.parse(raw) : {};
      } catch (parseError) {
        return self.sendJson(res, 400, { ok: false, errorCode: errors.CODES.INVALID_PARAMS });
      }
      self.dispatch(pathname, payload, function (handlerError, result) {
        if (handlerError) {
          var diagnostic = handlerError.meta || {};
          self.logger.warn('lan importer request failed', {
            endpoint: pathname,
            code: handlerError.code || 'INTERNAL',
            stage: diagnostic.stage || 'unknown',
            redirectHop: typeof diagnostic.redirectHop === 'number' ? diagnostic.redirectHop : 0,
            protocol: diagnostic.protocol || 'unknown',
            originChanged: diagnostic.originChanged === true,
            nested: diagnostic.nested === true,
            transportErrorCode: diagnostic.transportErrorCode || 'UNKNOWN',
            transportErrorName: diagnostic.transportErrorName || 'Error',
            tlsPhase: diagnostic.tlsPhase || 'unknown'
          });
          return self.sendJson(res, 400, errors.toResult(handlerError));
        }
        result = result || {};
        result.ok = true;
        self.sendJson(res, 200, result);
      });
    });
  }

  this.sendJson(res, 404, { ok: false, errorCode: 'NOT_FOUND' });
};

/* Route an authenticated mutation to the injected handler. */
ImporterServer.prototype.dispatch = function (pathname, payload, callback) {
  var handlers = this.handlers;
  try {
    validate.requireObject(payload);
    if (pathname === '/api/import') {
      validate.rejectUnknown(payload, ['name', 'value', 'compatMode']);
      var compatMode = validate.optionalBoolean(payload, 'compatMode', false);
      var val = validate.importValue(payload, 'value');
      var displayName = validate.displayName(payload, 'name');
      if (handlers.importValue && handlers.importValue.length <= 3) {
        return handlers.importValue(val, displayName, callback);
      }
      return handlers.importValue(val, displayName, compatMode, callback);
    }
    if (pathname === '/api/subscriptions/update') {
      validate.rejectUnknown(payload, ['id']);
      return handlers.updateSubscriptions(validate.profileId(payload, 'id', false), callback);
    }
    if (pathname === '/api/subscriptions/delete') {
      validate.rejectUnknown(payload, ['id']);
      return handlers.deleteSubscription(validate.profileId(payload, 'id', true), callback);
    }
    if (pathname === '/api/profiles/delete') {
      validate.rejectUnknown(payload, ['id']);
      return handlers.deleteProfile(validate.profileId(payload, 'id', true), callback);
    }
    if (pathname === '/api/active') {
      validate.rejectUnknown(payload, ['id']);
      return handlers.setActive(validate.profileId(payload, 'id', true), callback);
    }
  } catch (validationError) {
    return callback(validationError);
  }
  callback(err('INVALID_PARAMS', 'unknown endpoint'));
};

/* Exchange a pairing code for a session cookie. */
ImporterServer.prototype.handlePair = function (req, res, lang) {
  var self = this;
  readBody(req, function (bodyError, raw) {
    var code = '', session, match;
    if (bodyError) return self.sendJson(res, 413, { ok: false, errorCode: bodyError.code });
    /* Accept both the HTML form post and a JSON body. */
    if (raw && raw.charAt(0) === '{') {
      try { code = JSON.parse(raw).code || ''; } catch (e) { code = ''; }
    } else {
      match = /(?:^|&)code=([^&]*)/.exec(String(raw || ''));
      code = match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : '';
    }
    try {
      session = self.pairing.redeem(code, clientKey(req));
    } catch (authError) {
      var message = authError.code === 'RATE_LIMITED'
        ? templates.t(lang, 'pair.limited')
        : templates.t(lang, 'pair.failed');
      return self.sendHtml(res, authError.code === 'RATE_LIMITED' ? 429 : 401,
        templates.pairingPage(lang, { error: message }));
    }
    /* HttpOnly so page script cannot read it; SameSite=Strict blocks
       cross-site submission of authenticated requests. */
    res.writeHead(303, securityHeaders({
      'Location': '/',
      'Set-Cookie': SESSION_COOKIE + '=' + session.id + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=1800'
    }));
    res.end();
  });
};

/* Start (or move) the listener. `lanEnabled` decides the bind address.

   Binding is asynchronous, so two overlapping calls can both try to own the
   port: startup() opens the loopback listener and a startPairing() arriving
   before that bind completes would tear it down and rebind while the first
   socket is still coming up, failing with EADDRINUSE. Serialize instead — while
   a bind is in flight, remember the last requested scope and apply it after. */
ImporterServer.prototype.listen = function (lanEnabled, callback) {
  var self = this;
  callback = callback || function () {};
  if (this.binding) {
    this.pendingListen = { lanEnabled: lanEnabled, callback: callback };
    return;
  }
  this.binding = true;
  this.bind(lanEnabled, function (error, result) {
    var next = self.pendingListen;
    self.binding = false;
    self.pendingListen = null;
    callback(error, result);
    if (next) self.listen(next.lanEnabled, next.callback);
  });
};

ImporterServer.prototype.bind = function (lanEnabled, callback) {
  var self = this;
  /* A caller cannot widen the listener by itself. LAN scope exists only while
     PairingManager proves that a temporary code window or session is active. */
  if (lanEnabled && (!this.pairing || !this.pairing.accessActive())) {
    lanEnabled = false;
  }
  var host = lanEnabled ? '0.0.0.0' : '127.0.0.1';
  var completed = false;
  callback = callback || function () {};

  if (this.server && this.boundHost === host) return callback(null, { host: host, port: this.port });

  function finish(error, result) {
    if (completed) return;
    completed = true;
    callback(error || null, result);
  }

  this.close(function () {
    var server = http.createServer(function (req, res) { self.handle(req, res); });
    self.server = server;
    server.maxConnections = MAX_CONNECTIONS;
    server.headersTimeout = HEADERS_TIMEOUT_MS;
    server.requestTimeout = REQUEST_TIMEOUT_MS;
    server.on('clientError', function (clientError, socket) {
      self.logger.warn('importer client rejected', { detail: clientError.code || 'bad request' });
      try { socket.destroy(); } catch (e) {}
    });
    server.on('error', function (listenError) {
      self.logger.error('importer listen failed', { detail: listenError.code || 'error' });
      if (self.server === server) {
        self.server = null;
        self.boundHost = '';
      }
      finish(listenError);
    });
    server.listen(self.port, host, function () {
      if (self.server !== server) return;
      var actualPort = (server.address() && server.address().port) || self.port;
      self.boundHost = host;
      self.boundPort = actualPort;
      self.logger.info('importer listening', { scope: lanEnabled ? 'lan' : 'loopback', port: actualPort });
      if (lanEnabled) self.startExposureGuard();
      finish(null, { host: host, port: actualPort });
    });
  });
};

ImporterServer.prototype.close = function (callback) {
  var server = this.server;
  var timer = null;
  var called = false;
  callback = callback || function () {};
  this.stopExposureGuard();
  this.server = null;
  this.boundHost = '';
  this.boundPort = 0;
  if (!server) return callback();

  function finish() {
    if (called) return;
    called = true;
    if (timer) clearTimeout(timer);
    callback();
  }

  try {
    server.close(finish);
    /* Do not wait on keep-alive sockets when shutting the window. */
    timer = setTimeout(finish, 250);
  } catch (e) {
    finish();
  }
};

/* A redeemed session may outlive the five-minute code window, so periodically
   close LAN exposure only after both the code and every session have expired. */
ImporterServer.prototype.startExposureGuard = function () {
  var self = this;
  if (this.exposureTimer) return;
  this.exposureTimer = setInterval(function () {
    self.enforceExposure();
  }, 15000);
  if (this.exposureTimer.unref) this.exposureTimer.unref();
};

/* Kept separate from the timer so expiry behaviour can be verified without a
   real 15-second sleep. */
ImporterServer.prototype.enforceExposure = function (callback) {
  callback = callback || function () {};
  if (!this.pairing.accessActive() && this.boundHost === '0.0.0.0') {
    return this.listen(false, callback);
  }
  callback(null, { host: this.boundHost, port: this.boundPort });
};

ImporterServer.prototype.stopExposureGuard = function () {
  if (!this.exposureTimer) return;
  clearInterval(this.exposureTimer);
  this.exposureTimer = null;
};

module.exports = {
  MAX_BODY_BYTES: MAX_BODY_BYTES,
  SESSION_COOKIE: SESSION_COOKIE,
  ImporterServer: ImporterServer,
  securityHeaders: securityHeaders,
  parseCookies: parseCookies
};
