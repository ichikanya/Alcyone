'use strict';

/* DNS compatibility helper.

   webOS 4 ships Node.js 0.12, whose dns.lookup() does not support the modern
   `{ all: true }` result shape.  resolve4/resolve6 are available there and
   give us every answer, which is also what the SSRF policy needs. */

var dns = require('dns');

function resolveAll(hostname, callback) {
  var pending = 2;
  var addresses = [];
  var errors = [];
  var done = false;

  function complete(error, values, family) {
    var i;
    if (done) return;
    if (error) {
      errors.push(error);
    } else {
      for (i = 0; i < (values || []).length; i++) {
        addresses.push({ address: String(values[i]), family: family });
      }
    }
    pending--;
    if (pending > 0) return;
    done = true;
    if (!addresses.length) {
      try {
        dns.lookup(hostname, function (lookupErr, address, family) {
          if (lookupErr || !address) return callback(errors[0] || lookupErr || new Error('DNS lookup failed'));
          callback(null, [{ address: String(address), family: family || 4 }]);
        });
      } catch (eLookup) {
        callback(errors[0] || eLookup || new Error('DNS lookup failed'));
      }
      return;
    }
    /* Stable IPv4-first order keeps IPv4-only webOS tunnels and diagnostics
       from accidentally selecting a direct IPv6 path. */
    addresses.sort(function (a, b) { return a.family - b.family; });
    callback(null, addresses);
  }

  try {
    dns.resolve4(hostname, function (error, values) { complete(error, values, 4); });
  } catch (e4) {
    complete(e4, null, 4);
  }
  try {
    dns.resolve6(hostname, function (error, values) { complete(error, values, 6); });
  } catch (e6) {
    complete(e6, null, 6);
  }
}

module.exports = {
  resolveAll: resolveAll
};
