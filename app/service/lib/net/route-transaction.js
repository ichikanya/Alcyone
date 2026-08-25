"use strict";

/* Route transaction journal: the ownership record for network changes.

   States: PREPARED -> APPLYING -> ACTIVE -> ROLLING_BACK -> RESTORED.
   The journal is written BEFORE the first network object is created and
   records the exact planned objects plus an owner token, so recovery can
   tell "our" objects from foreign ones and never clean blindly. */

var fs = require("fs"),
  path = require("path"),
  atomic = require("../atomic"),
  errors = require("../errors"),
  err = errors.err;

var JOURNAL_VERSION = 1,
  FILE_NAME = "route-transaction.json",
  STATES = ["PREPARED", "APPLYING", "ACTIVE", "ROLLING_BACK", "RESTORED"],
  TRANSITIONS = {
    PREPARED: ["APPLYING"],
    APPLYING: ["ACTIVE", "ROLLING_BACK"],
    ACTIVE: ["ROLLING_BACK"],
    ROLLING_BACK: ["RESTORED"],
    RESTORED: [],
  };

function fnv1a(r) {
  var e, t;
  for (t = 2166136261, e = 0; e < r.length; e++)
    ((t ^= r.charCodeAt(e)),
      (t = (t + ((t << 1) + (t << 4) + (t << 7) + (t << 8) + (t << 24))) >>> 0));
  return ("00000000" + t.toString(16)).slice(-8);
}
function makeToken(r) {
  var e, t = "";
  try {
    t = r(8).toString("hex");
  } catch (e) {
    t = String(Math.floor(4294967295 * Math.random()).toString(16));
  }
  return "tx" + Date.now().toString(36) + "-" + t;
}
function stableString(r) {
  var e, t, o, i;
  if (!r || "object" != typeof r || "[object Array]" === Object.prototype.toString.call(r))
    return JSON.stringify(r);
  for (t = Object.keys(r).sort(), o = {}, e = 0; e < t.length; e++)
    o[t[e]] = r[t[e]];
  for (i = "{", e = 0; e < t.length; e++)
    i += JSON.stringify(t[e]) + ":" + stableString(o[t[e]]) + ",";
  return i.length > 1 ? i.slice(0, -1) + "}" : "{}";
}
function copyWithoutChecksum(r) {
  var e, t = {};
  for (e in r)
    Object.prototype.hasOwnProperty.call(r, e) && "checksum" !== e && (t[e] = r[e]);
  return t;
}
function withChecksum(r) {
  return ((r.checksum = fnv1a(stableString(copyWithoutChecksum(r)))), r);
}
function checksumOk(r) {
  return (
    !!r &&
    "object" == typeof r &&
    !!r.checksum &&
    r.checksum === fnv1a(stableString(copyWithoutChecksum(r)))
  );
}

function RouteTransactionManager(r) {
  ((r = r || {}),
    (this.file = r.file),
    (this.logger = r.logger || null),
    (this.randomBytes = r.randomBytes || require("crypto").randomBytes),
    (this.now = r.now || Date.now));
}
(RouteTransactionManager.prototype.load = function () {
  var r, e;
  try {
    r = fs.readFileSync(this.file, "utf8");
  } catch (r) {
    return null;
  }
  try {
    e = JSON.parse(r);
  } catch (r) {
    /* A corrupt journal is never acted on; it is preserved as evidence. */
    return this.logger && this.logger.warn("route transaction journal corrupt"),
      null;
  }
  return checksumOk(e)
    ? -1 === STATES.indexOf(e.state)
      ? (this.logger &&
          this.logger.warn("route transaction has unknown state", {
            state: String(e.state),
          }),
        null)
      : e
    : (this.logger && this.logger.warn("route transaction checksum mismatch"),
      null);
}),
  (RouteTransactionManager.prototype.persist = function (r) {
    ((r.updatedAt = this.now()),
      atomic.writeFileAtomic(this.file, JSON.stringify(withChecksum(r), null, 2)),
      atomic.fsyncDir(path.dirname(this.file)));
  }),
  (RouteTransactionManager.prototype.create = function (r, e) {
    var t, o;
    if (((o = this.load()), o && "RESTORED" !== o.state))
      throw err(
        "ILLEGAL_STATE",
        "another route transaction is " + o.state + "; recover it first",
      );
    return (
      (t = {
        version: JOURNAL_VERSION,
        state: "PREPARED",
        token: makeToken(this.randomBytes),
        edition: r.edition || "",
        bootId: r.bootId || "",
        createdAt: this.now(),
        planned: r.planned || {},
        applied: null,
      }),
      this.persist(t),
      t
    );
  }),
  (RouteTransactionManager.prototype.mark = function (r, e, t) {
    var o, i;
    if (-1 === STATES.indexOf(r))
      throw err("ILLEGAL_STATE", "unknown state " + r);
    o = this.load();
    if (!o) throw err("ILLEGAL_STATE", "no route transaction journal to mark");
    i = TRANSITIONS[o.state] || [];
    if (-1 === i.indexOf(r))
      throw err(
        "ILLEGAL_STATE",
        "cannot move route transaction from " + o.state + " to " + r,
      );
    if (o.token !== e)
      throw err("ILLEGAL_STATE", "route transaction token mismatch");
    o.state = r;
    if ("ACTIVE" === r && t) o.applied = t;
    this.persist(o);
    if ("RESTORED" === r)
      try {
        fs.unlinkSync(this.file);
      } catch (r) {}
    return o;
  }),
  (module.exports = {
    JOURNAL_VERSION: JOURNAL_VERSION,
    FILE_NAME: FILE_NAME,
    STATES: STATES,
    TRANSITIONS: TRANSITIONS,
    fnv1a: fnv1a,
    makeToken: makeToken,
    stableString: stableString,
    withChecksum: withChecksum,
    checksumOk: checksumOk,
    RouteTransactionManager: RouteTransactionManager,
  });
