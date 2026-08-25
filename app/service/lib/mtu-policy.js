"use strict";

/* MTU policy for TUN devices: prefer 1400 to keep QUIC/video datagrams
   clear of PMTU black holes on 1500-byte links, never below 1280 (IPv6
   minimum), and never above the physical MTU. Runtime MTU changes are
   forbidden; a different value requires the hardware PMTU gate. */

var MIN_MTU = 1280,
  PREFERRED_MTU = 1400,
  DEFAULT_PHYSICAL_MTU = 1500;

function mtuPolicy(r) {
  var e = parseInt(r, 10);
  return isFinite(e) && e > 0
    ? Math.max(MIN_MTU, Math.min(PREFERRED_MTU, e))
    : Math.min(PREFERRED_MTU, DEFAULT_PHYSICAL_MTU);
}

module.exports = {
  MIN_MTU: MIN_MTU,
  PREFERRED_MTU: PREFERRED_MTU,
  DEFAULT_PHYSICAL_MTU: DEFAULT_PHYSICAL_MTU,
  mtuPolicy: mtuPolicy,
};
