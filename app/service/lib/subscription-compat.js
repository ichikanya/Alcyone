"use strict";
var errors = require("./errors"),
  singbox = require("./config/singbox");
function xhttpSkip(r) {
  var t = String((r && r.meta && r.meta.transport) || "").toLowerCase();
  return (
    errors.isAlcyoneError(r) &&
    "UNSUPPORTED_TRANSPORT" === r.code &&
    ("xhttp" === t || "splithttp" === t)
  );
}
function summarizeSkipped(r) {
  return (r = parseInt(r, 10) || 0)
    ? [{ code: "UNSUPPORTED_TRANSPORT", transport: "xhttp", count: r }]
    : [];
}
function summarizeUnsupportedProtocols(r) {
  var t,
    e = [],
    o = r || {};
  for (t in o)
    Object.prototype.hasOwnProperty.call(o, t) &&
      parseInt(o[t], 10) > 0 &&
      e.push({
        code: "UNSUPPORTED_PROTOCOL",
        protocol: String(t),
        count: parseInt(o[t], 10),
      });
  return e;
}
function mergeSkippedReasons(r, t) {
  var e = [],
    o,
    i;
  for (o = 0; o < (r || []).length; o++) e.push(r[o]);
  for (i = 0; i < (t || []).length; i++) e.push(t[i]);
  return e;
}
function filterDescriptors(r, t) {
  var e,
    o = [],
    i = 0;
  if (((t = t || []), !r || "sing-box" !== r.core))
    return { imported: t.slice(0), skippedCount: 0, skippedReasons: [] };
  for (e = 0; e < t.length; e++)
    try {
      (singbox.outboundFor(t[e]), o.push(t[e]));
    } catch (r) {
      if (!xhttpSkip(r)) throw r;
      i++;
    }
  return { imported: o, skippedCount: i, skippedReasons: summarizeSkipped(i) };
}
function assertManualSupported(r, t) {
  r && "sing-box" === r.core && singbox.outboundFor(t);
}
module.exports = {
  filterDescriptors: filterDescriptors,
  assertManualSupported: assertManualSupported,
  xhttpSkip: xhttpSkip,
  summarizeSkipped: summarizeSkipped,
  summarizeUnsupportedProtocols: summarizeUnsupportedProtocols,
  mergeSkippedReasons: mergeSkippedReasons,
};
