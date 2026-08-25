"use strict";
var fs = require("fs"),
  STREAM_KEEP_BYTES = 2048,
  FIELD_MAX = 180;
function scrub(e) {
  var r = String(null == e ? "" : e);
  return (r = (r = (r = (r = (r = r.replace(
    /[\u0000-\u001f\u007f]/g,
    " ",
  )).replace(/[a-z0-9+.-]+:\/\/\S*/gi, "[uri]")).replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    "[uuid]",
  )).replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[address]")).replace(
    /(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}/gi,
    "[hostname]",
  ));
}
function boundStream(e) {
  var r = String(null == e ? "" : e),
    t = r.length;
  return (
    t > STREAM_KEEP_BYTES && (r = r.slice(t - STREAM_KEEP_BYTES)),
    (r = scrub(r)
      .replace(/\s+/g, " ")
      .replace(/^\s+|\s+$/g, "")).length > FIELD_MAX &&
      (r = r.slice(0, FIELD_MAX) + "<clipped>"),
    { text: r || "<empty>", bytes: t, truncated: t > STREAM_KEEP_BYTES }
  );
}
function readSince(e, r, t) {
  var a,
    n,
    u,
    c,
    i = "number" == typeof r && r >= 0 ? r : 0,
    s = t || STREAM_KEEP_BYTES,
    o = null;
  if (!e) return "";
  try {
    return (a = fs.statSync(e).size) <= i
      ? ""
      : ((i = a - (n = Math.min(a - i, s))),
        (u =
          "function" == typeof Buffer.alloc ? Buffer.alloc(n) : new Buffer(n)),
        (o = fs.openSync(e, "r")),
        (c = fs.readSync(o, u, 0, n, i)),
        u.toString("utf8", 0, c > 0 ? c : 0));
  } catch (e) {
    return "";
  } finally {
    if (null !== o)
      try {
        fs.closeSync(o);
      } catch (e) {}
  }
}
function report(e, r) {
  var t,
    a = boundStream((r = r || {}).coreOutputText),
    n = [
      [
        "core diagnostics: launch",
        {
          pid: null === r.pid || void 0 === r.pid ? "" : r.pid,
          exitCode:
            null === r.exitCode || void 0 === r.exitCode ? "" : r.exitCode,
          signal: scrub(r.exitSignal || ""),
          spawnError: scrub(r.spawnErrorCode || ""),
        },
      ],
      [
        "core diagnostics: output",
        {
          stream: "stdout-stderr",
          bytes: a.bytes,
          truncated: a.truncated,
          text: a.text,
        },
      ],
      [
        "core diagnostics: stage",
        { failureStage: scrub(r.failureStage || "startup") },
      ],
    ];
  try {
    if (e) for (t = 0; t < n.length; t++) e.warn(n[t][0], n[t][1]);
  } catch (e) {}
  return { records: n, stage: r.failureStage || "startup" };
}
module.exports = {
  STREAM_KEEP_BYTES: STREAM_KEEP_BYTES,
  FIELD_MAX: FIELD_MAX,
  scrub: scrub,
  boundStream: boundStream,
  readSince: readSince,
  report: report,
};
