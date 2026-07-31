'use strict';

/* Resolve proxy endpoints before route takeover.

   The result is deliberately short-lived. It is built for one connect
   attempt, passed unchanged to the core config builder and route manager, and
   never written back to the imported profile. The original hostname remains
   in the core config; only its DNS answer is pinned for bootstrap. */

var dnsResolver = require('./dns-resolver');
var ssrf = require('./ssrf');
var errors = require('../errors');
var err = errors.err;

var MAX_HOSTNAME = 253;
var MAX_LABEL = 63;
var MAX_ENDPOINTS = 32;
var MAX_ADDRESSES_PER_HOST = 8;
var MAX_BYPASS_ADDRESSES = 64;
var RESOLUTION_TIMEOUT_MS = 10000;

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function once(callback) {
  var called = false;
  return function () {
    if (called) return;
    called = true;
    callback.apply(null, arguments);
  };
}

function canonicalHost(host) {
  return String(host || '').toLowerCase();
}

function isLiteralAddress(host) {
  return !!(ssrf.parseIpv4(host) || ssrf.parseIpv6(host));
}

/* Hostnames are used as DNS questions and exact core-config keys. Keep the
   accepted grammar to RFC 1123 host labels: no whitespace, controls,
   underscores, empty labels, leading/trailing hyphens, or ambiguous malformed
   dotted-decimal addresses. Single-label names remain valid because a TV may
   use a LAN-local search domain. */
function isValidHostname(host) {
  var labels, i, label;
  if (!host || typeof host !== 'string') return false;
  if (host.length > MAX_HOSTNAME) return false;
  if (/[\s\u0000-\u001f\u007f]/.test(host)) return false;
  if (host.charAt(0) === '.' || host.charAt(host.length - 1) === '.') return false;
  if (/^[0-9.]+$/.test(host)) return false;
  labels = host.split('.');
  for (i = 0; i < labels.length; i++) {
    label = labels[i];
    if (!label.length || label.length > MAX_LABEL) return false;
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)) return false;
  }
  return true;
}

function normalizeTarget(endpoint) {
  var port = parseInt(endpoint && endpoint.port, 10);
  var network = String((endpoint && endpoint.network) || 'tcp').toLowerCase();
  if (!(port > 0 && port <= 65535)) port = 0;
  return { port: port, network: network === 'udp' ? 'udp' : 'tcp' };
}

function Result() {
  this.entries = [];
  this.addresses = [];
  /* A null-prototype map makes even a valid single-label hostname such as
     "constructor" safe to use as a key. */
  this.map = Object.create(null);
}

Result.prototype.hasMappings = function () {
  var key;
  for (key in this.map) if (own(this.map, key)) return true;
  return false;
};

function buildResult(jobs) {
  var result = new Result();
  var addressSeen = Object.create(null);
  var i, j, job, address;

  for (i = 0; i < jobs.length; i++) {
    job = jobs[i];
    result.entries.push({
      host: job.host,
      literal: job.literal,
      addresses: job.addresses.slice(0),
      targets: job.targets.slice(0)
    });
    if (!job.literal) result.map[job.key] = job.addresses.slice(0);
    for (j = 0; j < job.addresses.length; j++) {
      address = job.addresses[j];
      if (addressSeen[address]) continue;
      addressSeen[address] = true;
      result.addresses.push(address);
      if (result.addresses.length > MAX_BYPASS_ADDRESSES) {
        throw err('ENDPOINT_RESOLUTION_FAILED', 'too many endpoint addresses');
      }
    }
  }
  return result;
}

/* Resolve all unique domain endpoints once. Validation of the complete input
   happens before the first DNS call, and one global timer bounds the operation
   even if the platform resolver never returns. */
function resolve(endpoints, callback, options) {
  var finish = once(callback);
  var resolver;
  var timeoutMs;
  var jobs = [];
  var byHost = Object.create(null);
  var pending = 0;
  var timer = null;
  var completed = false;
  var cancelled = false;
  var control;
  var i, endpoint, host, key, job, target, targetKey;

  options = options || {};
  resolver = options.resolver || dnsResolver;
  timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : RESOLUTION_TIMEOUT_MS;
  endpoints = endpoints || [];

  function active() {
    return !completed && !cancelled &&
      (!options.isCurrent || options.isCurrent());
  }

  function cancel() {
    if (completed || cancelled) return;
    cancelled = true;
    completed = true;
    if (timer) { clearTimeout(timer); timer = null; }
  }

  control = { cancel: cancel };

  function fail(detail) {
    if (!active()) return;
    completed = true;
    if (timer) clearTimeout(timer);
    finish(err('ENDPOINT_RESOLUTION_FAILED', detail));
  }

  function succeedIfDone() {
    var result;
    if (!active() || pending > 0) return;
    completed = true;
    if (timer) clearTimeout(timer);
    try {
      result = buildResult(jobs);
    } catch (buildError) {
      return finish(errors.isAlcyoneError(buildError)
        ? buildError
        : err('ENDPOINT_RESOLUTION_FAILED', 'invalid endpoint result'));
    }
    finish(null, result);
  }

  if (!endpoints.length || endpoints.length > MAX_ENDPOINTS) {
    fail(!endpoints.length ? 'no endpoint in profile' : 'too many endpoints');
    return control;
  }

  /* First pass: validate and deduplicate without touching DNS. */
  for (i = 0; i < endpoints.length; i++) {
    endpoint = endpoints[i] || {};
    host = String(endpoint.host || '').trim();
    if (!host) return fail('no endpoint in profile');

    if (ssrf.parseIpv6(host)) {
      /* The service installs an IPv4-only tunnel and blocks direct IPv6 to
         prevent leaks. An IPv6-only proxy endpoint therefore has no safe
         bypass route in this architecture. It is still detected as a literal,
         and is never sent to DNS. */
      fail('endpoint has no usable IPv4 address');
      return control;
    }
    if (!ssrf.parseIpv4(host) && !isValidHostname(host)) {
      fail('invalid endpoint hostname');
      return control;
    }

    key = canonicalHost(host);
    job = byHost[key];
    if (!job) {
      job = {
        host: host,
        key: key,
        literal: !!ssrf.parseIpv4(host),
        addresses: [],
        targets: [],
        targetSeen: Object.create(null)
      };
      byHost[key] = job;
      jobs.push(job);
    }
    target = normalizeTarget(endpoint);
    targetKey = target.network + ':' + target.port;
    if (!job.targetSeen[targetKey]) {
      job.targetSeen[targetKey] = true;
      job.targets.push(target);
    }
  }

  for (i = 0; i < jobs.length; i++) {
    if (jobs[i].literal) {
      jobs[i].addresses = [jobs[i].host];
    } else {
      pending++;
    }
  }
  if (!pending) {
    succeedIfDone();
    return control;
  }

  timer = setTimeout(function () {
    fail('endpoint lookup timed out');
  }, Math.max(1, timeoutMs));

  function resolveJob(current) {
    try {
      resolver.resolveAll(current.host, function (lookupError, resolved) {
        var addresses = [];
        var seen = Object.create(null);
        var j, address;
        if (!active()) return;
        if (lookupError || !resolved || !resolved.length) {
          return fail('endpoint lookup failed');
        }
        for (j = 0; j < resolved.length; j++) {
          address = String((resolved[j] && resolved[j].address) || '');
          if (!ssrf.parseIpv4(address) || seen[address]) continue;
          seen[address] = true;
          addresses.push(address);
          if (addresses.length >= MAX_ADDRESSES_PER_HOST) break;
        }
        if (!addresses.length) return fail('endpoint has no IPv4 address');
        current.addresses = addresses;
        pending--;
        succeedIfDone();
      });
    } catch (lookupException) {
      fail('endpoint lookup failed');
    }
  }

  for (i = 0; i < jobs.length; i++) {
    if (!jobs[i].literal) resolveJob(jobs[i]);
  }
  return control;
}

module.exports = {
  MAX_ENDPOINTS: MAX_ENDPOINTS,
  MAX_ADDRESSES_PER_HOST: MAX_ADDRESSES_PER_HOST,
  MAX_BYPASS_ADDRESSES: MAX_BYPASS_ADDRESSES,
  RESOLUTION_TIMEOUT_MS: RESOLUTION_TIMEOUT_MS,
  resolve: resolve,
  isValidHostname: isValidHostname,
  isLiteralAddress: isLiteralAddress,
  canonicalHost: canonicalHost
};
