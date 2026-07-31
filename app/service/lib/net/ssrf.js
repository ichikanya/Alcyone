'use strict';

/* SSRF policy for the subscription importer.

   The importer fetches URLs the user pastes, so it is the one place where a
   remote party chooses our destination. Everything here is deny-by-default:
   only http/https, only public unicast addresses, and every redirect hop is
   re-validated with the same rules.

   Pure module: no filesystem, no sockets, no Luna, no child processes and no
   global mutable state. The HTTP client resolves names and asks this module
   for a verdict, so the policy stays unit-testable in isolation. */

var errors = require('../errors');
var err = errors.err;

var MAX_REDIRECTS = 5;

/* Names that must never be resolved, whatever DNS claims. */
var BLOCKED_HOST_SUFFIXES = [
  '.local', '.localdomain', '.internal', '.intranet', '.lan',
  '.home', '.home.arpa', '.corp', '.private', '.localhost'
];
var BLOCKED_HOST_EXACT = {
  'localhost': 1,
  'localhost.localdomain': 1,
  'ip6-localhost': 1,
  'ip6-loopback': 1,
  'metadata': 1,
  'metadata.google.internal': 1,
  'instance-data': 1
};

/* Headers that must not survive a cross-origin redirect. */
var SENSITIVE_HEADERS = [
  'authorization', 'cookie', 'proxy-authorization', 'x-hwid'
];

function parseIpv4(text) {
  var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(text || ''));
  var out = [], i, part;
  if (!m) return null;
  for (i = 1; i <= 4; i++) {
    part = m[i];
    /* Reject ambiguous zero-padded forms such as 0177.0.0.1. */
    if (part.length > 1 && part.charAt(0) === '0') return null;
    part = parseInt(part, 10);
    if (!(part >= 0 && part <= 255)) return null;
    out.push(part);
  }
  return out;
}

function inCidr4(octets, a, b, c, d, bits) {
  var value = (((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3]) >>> 0;
  var base = (((a << 24) >>> 0) + (b << 16) + (c << 8) + d) >>> 0;
  var mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((value & mask) >>> 0) === ((base & mask) >>> 0);
}

/* Reason string when an IPv4 address must not be contacted, '' when allowed. */
function blockedIpv4Reason(octets) {
  if (inCidr4(octets, 0, 0, 0, 0, 8)) return 'unspecified';
  if (inCidr4(octets, 10, 0, 0, 0, 8)) return 'private';
  if (inCidr4(octets, 100, 64, 0, 0, 10)) return 'carrier-grade-nat';
  if (inCidr4(octets, 127, 0, 0, 0, 8)) return 'loopback';
  if (inCidr4(octets, 169, 254, 0, 0, 16)) return 'link-local';
  if (inCidr4(octets, 172, 16, 0, 0, 12)) return 'private';
  if (inCidr4(octets, 192, 0, 0, 0, 24)) return 'reserved';
  if (inCidr4(octets, 192, 0, 2, 0, 24)) return 'documentation';
  if (inCidr4(octets, 192, 88, 99, 0, 24)) return 'reserved';
  if (inCidr4(octets, 192, 168, 0, 0, 16)) return 'private';
  if (inCidr4(octets, 198, 18, 0, 0, 15)) return 'benchmarking';
  if (inCidr4(octets, 198, 51, 100, 0, 24)) return 'documentation';
  if (inCidr4(octets, 203, 0, 113, 0, 24)) return 'documentation';
  if (inCidr4(octets, 224, 0, 0, 0, 4)) return 'multicast';
  if (inCidr4(octets, 240, 0, 0, 0, 4)) return 'reserved';
  return '';
}

/* Expand an IPv6 literal into 8 numeric groups, or null when malformed. */
function parseIpv6(text) {
  var input = String(text || '').trim();
  var halves, head, tail, groups, i;

  if (input.charAt(0) === '[' && input.charAt(input.length - 1) === ']') input = input.slice(1, -1);
  /* A scoped address targets a local interface; never a valid remote target. */
  if (input.indexOf('%') >= 0) return null;
  if (input.indexOf(':') < 0) return null;
  if (input.indexOf(':::') >= 0) return null;

  halves = input.split('::');
  if (halves.length > 2) return null;

  function expand(part) {
    var pieces = part === '' ? [] : part.split(':');
    var out = [], j, piece, v4;
    for (j = 0; j < pieces.length; j++) {
      piece = pieces[j];
      if (piece === '') return null;
      /* A trailing dotted quad stands for the final two groups. */
      if (piece.indexOf('.') >= 0) {
        if (j !== pieces.length - 1) return null;
        v4 = parseIpv4(piece);
        if (!v4) return null;
        out.push((v4[0] << 8) | v4[1]);
        out.push((v4[2] << 8) | v4[3]);
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(piece)) return null;
      out.push(parseInt(piece, 16));
    }
    return out;
  }

  if (halves.length === 1) {
    head = expand(halves[0]);
    return head && head.length === 8 ? head : null;
  }

  head = halves[0] === '' ? [] : expand(halves[0]);
  tail = halves[1] === '' ? [] : expand(halves[1]);
  if (!head || !tail) return null;
  if (head.length + tail.length > 7) return null;

  groups = head.slice(0);
  for (i = head.length + tail.length; i < 8; i++) groups.push(0);
  for (i = 0; i < tail.length; i++) groups.push(tail[i]);
  return groups.length === 8 ? groups : null;
}

function allZero(groups, count) {
  var i;
  for (i = 0; i < count; i++) if (groups[i] !== 0) return false;
  return true;
}

function embeddedIpv4(groups) {
  return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff];
}

/* Reason string when an IPv6 address must not be contacted, '' when allowed. */
function blockedIpv6Reason(groups) {
  var i, nonZero = false, reason;

  for (i = 0; i < 8; i++) if (groups[i] !== 0) nonZero = true;
  if (!nonZero) return 'unspecified';
  if (allZero(groups, 7) && groups[7] === 1) return 'loopback';

  /* IPv4-mapped (::ffff:0:0/96) and IPv4-compatible: judge the inner IPv4. */
  if (allZero(groups, 5) && groups[5] === 0xffff) {
    reason = blockedIpv4Reason(embeddedIpv4(groups));
    return reason ? 'ipv4-mapped-' + reason : '';
  }
  if (allZero(groups, 6)) return 'ipv4-compatible';

  /* NAT64 well-known prefix 64:ff9b::/96 carries an IPv4 destination. */
  if (groups[0] === 0x0064 && groups[1] === 0xff9b && allZero(groups.slice(2), 4)) {
    reason = blockedIpv4Reason(embeddedIpv4(groups));
    return reason ? 'nat64-' + reason : '';
  }
  /* 6to4 2002::/16 embeds the IPv4 address in groups 1-2. */
  if (groups[0] === 0x2002) {
    reason = blockedIpv4Reason([groups[1] >> 8, groups[1] & 0xff, groups[2] >> 8, groups[2] & 0xff]);
    return reason ? '6to4-' + reason : '';
  }

  if (groups[0] === 0x0100 && allZero(groups.slice(1), 3)) return 'discard';
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return 'documentation';
  if (groups[0] === 0x2001 && groups[1] === 0x0000) return 'teredo';
  if ((groups[0] & 0xfe00) === 0xfc00) return 'unique-local';
  if ((groups[0] & 0xffc0) === 0xfe80) return 'link-local';
  if ((groups[0] & 0xff00) === 0xff00) return 'multicast';
  return '';
}

/* Classify a literal address string. Throws when the address is disallowed. */
function assertAddressAllowed(address, family) {
  var octets, groups, reason;
  if (family === 4 || parseIpv4(address)) {
    octets = parseIpv4(address);
    if (!octets) throw err('BLOCKED_ADDRESS', 'malformed ipv4');
    reason = blockedIpv4Reason(octets);
    if (reason) throw err('BLOCKED_ADDRESS', reason);
    return;
  }
  groups = parseIpv6(address);
  if (!groups) throw err('BLOCKED_ADDRESS', 'malformed address');
  reason = blockedIpv6Reason(groups);
  if (reason) throw err('BLOCKED_ADDRESS', reason);
}

function isAddressAllowed(address, family) {
  try { assertAddressAllowed(address, family); return true; } catch (e) { return false; }
}

/* Hostname policy applied before any DNS lookup happens. */
function assertHostnameAllowed(hostname) {
  var host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  var i;
  if (!host) throw err('INVALID_URL', 'empty host');
  if (BLOCKED_HOST_EXACT[host]) throw err('BLOCKED_ADDRESS', 'local hostname');
  for (i = 0; i < BLOCKED_HOST_SUFFIXES.length; i++) {
    if (host.length > BLOCKED_HOST_SUFFIXES[i].length &&
        host.slice(-BLOCKED_HOST_SUFFIXES[i].length) === BLOCKED_HOST_SUFFIXES[i]) {
      throw err('BLOCKED_ADDRESS', 'local hostname');
    }
  }
  /* A literal address in the host position is judged directly. */
  if (parseIpv4(host) || host.indexOf(':') >= 0) { assertAddressAllowed(host); return host; }
  /* Single-label names resolve through local search domains. */
  if (host.indexOf('.') < 0) throw err('BLOCKED_ADDRESS', 'single-label hostname');
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(host)) {
    throw err('INVALID_URL', 'malformed hostname');
  }
  return host;
}

/* Strict URL policy. Returns the pieces the HTTP client needs. */
function assertUrlAllowed(rawUrl) {
  var text = String(rawUrl || '').trim();
  var m, scheme, authority, rest, hostPart, portPart, host, port, idx;

  if (!text) throw err('INVALID_URL', 'empty url');
  if (text.length > 2048) throw err('INVALID_URL', 'url too long');
  /* Control characters and whitespace enable request smuggling tricks. */
  if (/[\u0000-\u0020\u007f]/.test(text)) throw err('INVALID_URL', 'illegal character');

  m = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([\s\S]*)$/.exec(text);
  if (!m) throw err('INVALID_URL', 'malformed url');
  scheme = m[1].toLowerCase();
  authority = m[2];
  rest = m[3] || '';

  if (scheme !== 'http' && scheme !== 'https') throw err('BLOCKED_SCHEME', scheme);
  /* Credentials in the URL would be forwarded to whatever we resolve to. */
  if (authority.indexOf('@') >= 0) throw err('URL_CREDENTIALS_REJECTED', 'credentials in url');
  if (!authority) throw err('INVALID_URL', 'missing host');

  if (authority.charAt(0) === '[') {
    idx = authority.indexOf(']');
    if (idx < 0) throw err('INVALID_URL', 'malformed ipv6 literal');
    hostPart = authority.slice(1, idx);
    portPart = authority.slice(idx + 1);
    if (portPart && portPart.charAt(0) !== ':') throw err('INVALID_URL', 'malformed port');
    portPart = portPart ? portPart.slice(1) : '';
    if (!parseIpv6(hostPart)) throw err('INVALID_URL', 'malformed ipv6 literal');
  } else {
    idx = authority.lastIndexOf(':');
    if (idx >= 0 && authority.indexOf(':') === idx) {
      hostPart = authority.slice(0, idx);
      portPart = authority.slice(idx + 1);
    } else if (idx >= 0) {
      throw err('INVALID_URL', 'ambiguous authority');
    } else {
      hostPart = authority;
      portPart = '';
    }
  }

  if (portPart !== '') {
    if (!/^\d{1,5}$/.test(portPart)) throw err('INVALID_URL', 'malformed port');
    port = parseInt(portPart, 10);
    if (port < 1 || port > 65535) throw err('INVALID_URL', 'port out of range');
  } else {
    port = scheme === 'https' ? 443 : 80;
  }

  host = assertHostnameAllowed(hostPart);
  return {
    scheme: scheme,
    hostname: host,
    port: port,
    path: rest || '/',
    origin: scheme + '://' + host + ':' + port,
    isLiteralAddress: !!(parseIpv4(host) || host.indexOf(':') >= 0)
  };
}

/* Every resolved address must pass, so a name with one private answer among
   public ones cannot be used to reach the LAN. */
function assertResolvedAddresses(addresses) {
  var i, entry;
  if (!addresses || !addresses.length) throw err('DNS_FAILED', 'no addresses');
  for (i = 0; i < addresses.length; i++) {
    entry = addresses[i];
    assertAddressAllowed(entry.address, entry.family);
  }
  return addresses;
}

function sameOrigin(a, b) {
  return !!a && !!b && a.origin === b.origin;
}

/* Drop credential-bearing headers when a redirect changes origin. */
function stripSensitiveHeaders(headers) {
  var out = {}, key, lower, i, blocked = {};
  for (i = 0; i < SENSITIVE_HEADERS.length; i++) blocked[SENSITIVE_HEADERS[i]] = 1;
  for (key in headers) {
    if (!Object.prototype.hasOwnProperty.call(headers, key)) continue;
    lower = String(key).toLowerCase();
    if (blocked[lower] || lower.indexOf('x-device-') === 0) continue;
    out[key] = headers[key];
  }
  return out;
}

module.exports = {
  MAX_REDIRECTS: MAX_REDIRECTS,
  SENSITIVE_HEADERS: SENSITIVE_HEADERS,
  parseIpv4: parseIpv4,
  parseIpv6: parseIpv6,
  blockedIpv4Reason: blockedIpv4Reason,
  blockedIpv6Reason: blockedIpv6Reason,
  assertAddressAllowed: assertAddressAllowed,
  isAddressAllowed: isAddressAllowed,
  assertHostnameAllowed: assertHostnameAllowed,
  assertUrlAllowed: assertUrlAllowed,
  assertResolvedAddresses: assertResolvedAddresses,
  sameOrigin: sameOrigin,
  stripSensitiveHeaders: stripSensitiveHeaders
};
