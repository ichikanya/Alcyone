'use strict';

/* Diagnostics: server reachability and external IP checks.

   Reachability uses a plain TCP connect to the profile's own endpoint rather
   than spawning `ping`. That removes another child process, needs no root,
   works where ICMP is filtered, and — importantly — means no user-controlled
   hostname is ever passed to a process argument list.

   Concurrency is bounded so probing a large subscription cannot exhaust the
   TV's file descriptors. */

var net = require('net');
var httpClient = require('./net/http-client');
var parsers = require('./proto/parsers');

var PROBE_TIMEOUT_MS = 3000;
var MAX_PARALLEL_PROBES = 6;
/* A proxy can legitimately reach ordinary HTTPS while a particular public IP
   service is filtered, rate-limited, or returns an intermediary response. A
   single service therefore cannot be the data-plane capability check. Keep a
   small bounded set of independent HTTPS-only sources and retain strict IP
   validation below. The probe never accepts a response merely because the
   request succeeded. */
var IP_CHECK_URLS = [
  'https://ipinfo.io/ip',
  'https://api.ipify.org',
  'https://ifconfig.me/ip',
  'https://api64.ipify.org',
  'https://icanhazip.com'
];

/* Measure TCP connect latency to host:port. Never throws. */
function probeEndpoint(host, port, timeoutMs, callback) {
  var started = Date.now();
  var socket = new net.Socket();
  var settled = false;

  function finish(latency) {
    if (settled) return;
    settled = true;
    try { socket.destroy(); } catch (e) {}
    callback(latency);
  }

  socket.setTimeout(timeoutMs || PROBE_TIMEOUT_MS);
  socket.once('connect', function () { finish(Math.max(1, Date.now() - started)); });
  socket.once('timeout', function () { finish(null); });
  socket.once('error', function () { finish(null); });
  try {
    socket.connect(port, host);
  } catch (e) {
    finish(null);
  }
}

function Diagnostics(options) {
  options = options || {};
  this.store = options.store;
  this.edition = options.edition;
  this.logger = options.logger;
}

/* Probe every stored profile, bounded in parallelism.
   Returns [{id, latencyMs|null}] using opaque profile ids only. */
Diagnostics.prototype.probeProfiles = function (callback) {
  var store = this.store.read();
  var profiles = store.profiles;
  var out = [];
  var index = 0, active = 0, finished = false;

  function done() {
    if (finished) return;
    if (active === 0 && index >= profiles.length) {
      finished = true;
      callback(null, out);
    }
  }
  if (!profiles.length) return callback(null, []);

  function pump() {
    while (active < MAX_PARALLEL_PROBES && index < profiles.length) {
      (function (profile) {
        var host = '', port = 0;
        active++;
        try {
          var parsed = parsers.parseProxyLink(profile.link);
          host = parsed.host;
          port = parsed.port;
        } catch (e) {
          host = '';
        }
        if (!host || !port) {
          out.push({ id: profile.id, latencyMs: null });
          active--;
          return;
        }
        probeEndpoint(host, port, PROBE_TIMEOUT_MS, function (latency) {
          out.push({ id: profile.id, latencyMs: latency });
          active--;
          pump();
          done();
        });
      })(profiles[index++]);
    }
    done();
  }
  pump();
};

/* Fetch the current external IP through whatever route is active. */
Diagnostics.prototype.externalIp = function (callback) {
  var index = 0;

  function attempt() {
    if (index >= IP_CHECK_URLS.length) return callback(null, '');
    httpClient.fetchUrl(IP_CHECK_URLS[index++], {
      headers: { 'User-Agent': 'Alcyone' },
      deadline: Date.now() + 8000
    }, function (error, body) {
      var text = String(body || '').replace(/\s+/g, '');
      if (!error && /^[0-9a-fA-F.:]{3,45}$/.test(text)) return callback(null, text);
      attempt();
    });
  }
  attempt();
};

module.exports = {
  PROBE_TIMEOUT_MS: PROBE_TIMEOUT_MS,
  MAX_PARALLEL_PROBES: MAX_PARALLEL_PROBES,
  IP_CHECK_URLS: IP_CHECK_URLS,
  Diagnostics: Diagnostics,
  probeEndpoint: probeEndpoint
};
