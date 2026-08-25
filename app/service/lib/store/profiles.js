"use strict";
var atomic = require("../atomic"),
  parsers = require("../proto/parsers"),
  errors = require("../errors"),
  ssrf = require("../net/ssrf"),
  err = errors.err,
  MAX_PROFILES = 4096,
  MAX_SUBSCRIPTIONS = 64,
  DEFAULT_DNS_SERVER = null,
  DEFAULT_CONNECTION_MODE = "tun",
  CONNECTION_MODES = { tun: !0 };
function now() {
  return Date.now();
}
function isArray(r) {
  return "[object Array]" === Object.prototype.toString.call(r);
}
function normalizeDnsServer(r) {
  var e,
    o = String(null == r ? "" : r).trim();
  return o
    ? !(e = ssrf.parseIpv4(o)) || ssrf.blockedIpv4Reason(e)
      ? null
      : e.join(".")
    : null;
}
function validProfileId(r) {
  return (
    "string" == typeof r &&
    r.length > 0 &&
    r.length <= 64 &&
    /^[A-Za-z0-9_-]+$/.test(r)
  );
}
function normalizeProviderHwid(r) {
  var e;
  if (null == r) return "";
  if ("string" != typeof r) return null;
  e = r.trim();
  return e ? (/^[\x21-\x7e]{1,128}$/.test(e) ? e : null) : "";
}
function hasValidLink(r) {
  if (!r || "string" != typeof r.link) return !1;
  try {
    return (parsers.validateLink(r.link), !0);
  } catch (r) {
    return !1;
  }
}
function hasValidFullConfig(r) {
  var e, o, t;
  if (!r || !parsers.isFullXrayConfig(r.fullConfig)) return !1;
  for (e = r.fullConfig.outbounds, o = 0; o < e.length; o++)
    if (
      ((t = String((e[o] && e[o].protocol) || "").toLowerCase()),
      /^(vless|trojan|vmess|shadowsocks|socks|hysteria)$/.test(t))
    )
      return !0;
  return !1;
}
function makeId(r, e) {
  var o;
  try {
    o = e(4).toString("hex");
  } catch (r) {
    o = String(Math.floor(4294967295 * Math.random()).toString(16));
  }
  return (r || "p") + now().toString(36) + o;
}
function normalizeSkippedReasons(r) {
  var e,
    o,
    t,
    i = [];
  if (!isArray(r)) return i;
  for (e = 0; e < r.length; e++)
    ((o = r[e] || {}),
      (t = parseInt(o.count, 10) || 0),
      "UNSUPPORTED_TRANSPORT" === o.code &&
      ("xhttp" === o.transport || "splithttp" === o.transport) &&
      t
        ? i.push({
            code: "UNSUPPORTED_TRANSPORT",
            transport: "xhttp",
            count: t,
          })
        : "UNSUPPORTED_PROTOCOL" === o.code &&
            /^(wireguard|wg|tuic|hysteria|hysteria1)$/.test(
              String(o.protocol || "").toLowerCase(),
            ) &&
            t &&
            i.push({
              code: "UNSUPPORTED_PROTOCOL",
              protocol: String(o.protocol).toLowerCase(),
              count: t,
            }));
  return i;
}
function skippedCountFor(r) {
  var e,
    o = 0;
  for (e = 0; e < r.length; e++) o += r[e].count;
  return o;
}
function defaultStore() {
  return {
    profiles: [],
    subscriptions: [],
    activeId: null,
    autostartProfileId: null,
    autostartEnabled: !1,
    desiredConnection: !1,
    suppressedBootId: null,
    wakeGeneration: 0,
    dnsServer: DEFAULT_DNS_SERVER,
    dnsServerSet: !1,
    connectionMode: DEFAULT_CONNECTION_MODE,
    connectionModeExplicit: !1,
    updatedAt: now(),
  };
}
function normalize(r) {
  var e, o, t;
  for (
    isArray(r) &&
      (r = {
        profiles: r,
        subscriptions: [],
        activeId: (r[0] && r[0].id) || null,
      }),
      (r && "object" == typeof r) || (r = defaultStore()),
      isArray(r.profiles) || (r.profiles = []),
      isArray(r.subscriptions) || (r.subscriptions = []),
      r.autostartEnabled = !0 === r.autostartEnabled,
      r.desiredConnection = !0 === r.desiredConnection,
      "string" == typeof r.suppressedBootId || (r.suppressedBootId = null),
      r.wakeGeneration = Math.max(0, parseInt(r.wakeGeneration, 10) || 0),
      !0 !== r.dnsServerSet && "1.1.1.1" === String(r.dnsServer || "")
        ? (r.dnsServer = DEFAULT_DNS_SERVER)
        : (r.dnsServer = normalizeDnsServer(r.dnsServer) || DEFAULT_DNS_SERVER),
      r.dnsServerSet = !!r.dnsServer,
      CONNECTION_MODES[r.connectionMode] ||
        (r.connectionMode = DEFAULT_CONNECTION_MODE),
      r.connectionModeExplicit = !0 === r.connectionModeExplicit,
      "ru" !== r.lang && "en" !== r.lang && "auto" !== r.lang && delete r.lang,
      e = r.profiles.length - 1;
    e >= 0;
    e--
  )
    (validProfileId(r.profiles[e] && r.profiles[e].id) &&
      (hasValidLink(r.profiles[e]) || hasValidFullConfig(r.profiles[e]))) ||
      r.profiles.splice(e, 1);
  for (
    r.profiles.length > MAX_PROFILES && (r.profiles.length = MAX_PROFILES),
      e = 0;
    e < r.profiles.length;
    e++
  )
    (r.profiles[e].protocol || (r.profiles[e].protocol = "vless"),
      r.profiles[e].sourceType ||
        (r.profiles[e].sourceType = r.profiles[e].subscriptionId
          ? "subscription"
          : "single"),
      r.profiles[e].name &&
        (r.profiles[e].name = parsers.cleanServerLabel(r.profiles[e].name)),
      r.profiles[e].country ||
        ((t = parsers.detectCountryForProfile(r.profiles[e])) &&
          (r.profiles[e].country = t)));
  for (e = r.subscriptions.length - 1; e >= 0; e--)
    r.subscriptions[e] && r.subscriptions[e].id && r.subscriptions[e].url
      ? ((r.subscriptions[e].compatMode = !0),
        (t = normalizeProviderHwid(r.subscriptions[e].providerHwid)),
        null === t ? delete r.subscriptions[e].providerHwid : t
          ? (r.subscriptions[e].providerHwid = t)
          : delete r.subscriptions[e].providerHwid,
        (r.subscriptions[e].skippedReasons = normalizeSkippedReasons(
          r.subscriptions[e].skippedReasons,
        )),
        (r.subscriptions[e].skippedCount = skippedCountFor(
          r.subscriptions[e].skippedReasons,
        )))
      : r.subscriptions.splice(e, 1);
  if (
    (r.subscriptions.length > MAX_SUBSCRIPTIONS &&
      (r.subscriptions.length = MAX_SUBSCRIPTIONS),
    parsers.dedupeProfilesInStore(r),
    validProfileId(r.autostartProfileId) || (r.autostartProfileId = null),
    r.autostartProfileId)
  ) {
    for (o = !1, e = 0; e < r.profiles.length; e++)
      if (r.profiles[e].id === r.autostartProfileId) {
        o = !0;
        break;
      }
    o || (r.autostartProfileId = null);
  }
  if (r.activeId) {
    for (o = !1, e = 0; e < r.profiles.length; e++)
      r.profiles[e].id === r.activeId && (o = !0);
    o || (r.activeId = (r.profiles[0] && r.profiles[0].id) || null);
  }
  return (!r.activeId && r.profiles[0] && (r.activeId = r.profiles[0].id), r);
}
function ProfileStore(r) {
  ((r = r || {}),
    (this.file = r.file),
    (this.logger = r.logger || null),
    (this.randomBytes = r.randomBytes || require("crypto").randomBytes));
}
function sanitizeProfile(r, e) {
  var o = "";
  try {
    var t = parsers.parseProxyLink(r.link);
    o = t.host + ":" + t.port;
  } catch (r) {
    o = "";
  }
  return {
    id: String(r.id),
    name: parsers.cleanServerLabel(r.name || parsers.inferName(r.link)),
    protocol: String(r.protocol || "vless").toLowerCase(),
    country: r.country ? String(r.country).toLowerCase() : "",
    endpoint: o,
    transport: (function () {
      try {
        var e = parsers.parseProxyLink(r.link).params || {};
        return String(e.type || e.network || "tcp").toLowerCase();
      } catch (r) {
        return "";
      }
    })(),
    security: (function () {
      try {
        var e = parsers.parseProxyLink(r.link).params || {};
        return String(e.security || "none").toLowerCase();
      } catch (r) {
        return "";
      }
    })(),
    sourceType: "subscription" === r.sourceType ? "subscription" : "single",
    subscriptionId: r.subscriptionId ? String(r.subscriptionId) : "",
    subscriptionName: r.subscriptionName
      ? parsers.cleanServerLabel(r.subscriptionName)
      : "",
    hasFullConfig: !!r.fullConfig,
    selected: r.id === e,
  };
}
function sanitizeSubscription(r) {
  var e = "";
  try {
    var o = /^https?:\/\/([^/:?#]+)/i.exec(String(r.url || ""));
    e = o ? o[1] : "";
  } catch (r) {}
  return {
    id: String(r.id),
    name: parsers.cleanServerLabel(r.name || ""),
    host: e,
    count: parseInt(r.count, 10) || 0,
    lastUpdate: parseInt(r.lastUpdate, 10) || 0,
    hasError: !!r.error,
    compatMode: !!r.compatMode,
    hasProviderHwid: !!normalizeProviderHwid(r.providerHwid),
    skippedCount: skippedCountFor(normalizeSkippedReasons(r.skippedReasons)),
    skippedReasons: normalizeSkippedReasons(r.skippedReasons),
  };
}
((ProfileStore.prototype.read = function () {
  var t;
  if (!atomic.pathExists(this.file)) return normalize(null);
  if (((t = atomic.readJsonStrict(this.file)), !t.ok))
    throw err(
      "STORE_CORRUPT",
      "profile store is unreadable; refusing to return an empty default",
    );
  /* When only the interrupted-write sibling parsed, serve it: the next
     successful write() heals the canonical file from this content. */
  return normalize(t.value);
}),
  (ProfileStore.prototype.write = function (r) {
    r.updatedAt = now();
    try {
      atomic.writeJsonAtomic(this.file, r, atomic.FILE_MODE);
    } catch (r) {
      throw err("STORE_WRITE_FAILED", "cannot persist store");
    }
    return r;
  }),
  (ProfileStore.prototype.revision = function () {
    return atomic.fileRevision(this.file);
  }),
  (ProfileStore.prototype.newId = function (r) {
    return makeId(r, this.randomBytes);
  }),
  (ProfileStore.prototype.profileById = function (r) {
    var e,
      o = this.read();
    for (e = 0; e < o.profiles.length; e++)
      if (o.profiles[e].id === r) return o.profiles[e];
    return null;
  }),
  (ProfileStore.prototype.activeProfile = function () {
    var r,
      e = this.read();
    if (!e.activeId) return null;
    for (r = 0; r < e.profiles.length; r++)
      if (e.profiles[r].id === e.activeId) return e.profiles[r];
    return null;
  }),
  (ProfileStore.prototype.autostartProfile = function () {
    var r,
      e = this.reconcileAutostartProfile();
    if (!e.autostartProfileId) return null;
    for (r = 0; r < e.profiles.length; r++)
      if (e.profiles[r].id === e.autostartProfileId) return e.profiles[r];
    return null;
  }),
  (ProfileStore.prototype.reconcileAutostartProfile = function () {
    var r, e;
    if (!atomic.pathExists(this.file)) return normalize(null);
    if (((r = atomic.readJsonStrict(this.file)), !r.ok))
      throw err("STORE_CORRUPT", "profile store is unreadable");
    e = normalize(r.value);
    if (
      (r.value && "object" == typeof r.value && !isArray(r.value)
        ? r.value.autostartProfileId
        : null) !== e.autostartProfileId ||
      (r.value &&
        "object" == typeof r.value &&
        !isArray(r.value) &&
        void 0 === r.value.autostartProfileId)
    )
      try {
        this.write(e);
      } catch (r) {}
    return e;
  }),
  (ProfileStore.prototype.getAutostartProfileId = function () {
    return this.reconcileAutostartProfile().autostartProfileId || null;
  }),
  (ProfileStore.prototype.sanitizedProfiles = function (r) {
    var e,
      o = r || this.read(),
      t = [];
    for (e = 0; e < o.profiles.length; e++)
      t.push(sanitizeProfile(o.profiles[e], o.activeId));
    return t;
  }),
  (ProfileStore.prototype.sanitizedSubscriptions = function (r) {
    var e,
      o = r || this.read(),
      t = [];
    for (e = 0; e < o.subscriptions.length; e++)
      t.push(sanitizeSubscription(o.subscriptions[e]));
    return t;
  }),
  (ProfileStore.prototype.sanitizedStore = function (r) {
    var e = r || this.read();
    return {
      profiles: this.sanitizedProfiles(e),
      subscriptions: this.sanitizedSubscriptions(e),
      activeId: e.activeId ? String(e.activeId) : null,
      autostartProfileId: e.autostartProfileId
        ? String(e.autostartProfileId)
        : null,
      autostartEnabled: !!e.autostartEnabled,
      dnsServer: normalizeDnsServer(e.dnsServer) || DEFAULT_DNS_SERVER,
      connectionMode: CONNECTION_MODES[e.connectionMode]
        ? e.connectionMode
        : DEFAULT_CONNECTION_MODE,
      lang:
        "ru" === e.lang || "en" === e.lang || "auto" === e.lang
          ? e.lang
          : "auto",
      revision: this.revision(),
      updatedAt: parseInt(e.updatedAt, 10) || 0,
    };
  }),
  (ProfileStore.prototype.setActive = function (r) {
    var e,
      o = this.read(),
      t = !1;
    for (e = 0; e < o.profiles.length; e++) o.profiles[e].id === r && (t = !0);
    if (!t) throw err("PROFILE_NOT_FOUND", "unknown profile");
    return ((o.activeId = r), this.write(o));
  }),
  (ProfileStore.prototype.setAutostartProfile = function (r) {
    var e = this.read();
    if (null != r && "" !== r) {
      if (!validProfileId(r) || !this.hasProfile(e, r))
        throw err("PROFILE_NOT_FOUND", "unknown profile");
      e.autostartProfileId = r;
    } else e.autostartProfileId = null;
    return this.write(e);
  }),
  (ProfileStore.prototype.setAutostartEnabled = function (enabled) {
    var store = this.read();
    store.autostartEnabled = !!enabled;
    store.desiredConnection = !!enabled;
    return this.write(store);
  }),
  (ProfileStore.prototype.autostartEnabled = function () {
    return !!this.read().autostartEnabled;
  }),
  (ProfileStore.prototype.setDesiredConnection = function (desired, suppressedBootId) {
    var store = this.read();
    store.desiredConnection = !!desired;
    store.suppressedBootId = suppressedBootId || null;
    return this.write(store);
  }),
  (ProfileStore.prototype.runtimeIntent = function () {
    var store = this.read();
    return {
      desiredConnection: !!store.desiredConnection,
      suppressedBootId: store.suppressedBootId || null,
      wakeGeneration: store.wakeGeneration || 0,
    };
  }),
  (ProfileStore.prototype.setWakeGeneration = function (generation) {
    var store = this.read();
    store.wakeGeneration = Math.max(0, parseInt(generation, 10) || 0);
    return this.write(store);
  }),
  (ProfileStore.prototype.deleteProfile = function (r) {
    var e,
      o = this.read(),
      t = [],
      i = !1;
    for (e = 0; e < o.profiles.length; e++)
      o.profiles[e].id !== r ? t.push(o.profiles[e]) : (i = !0);
    if (!i) throw err("PROFILE_NOT_FOUND", "unknown profile");
    return (
      (o.profiles = t),
      o.activeId === r &&
        (o.activeId = (o.profiles[0] && o.profiles[0].id) || null),
      o.autostartProfileId === r && (o.autostartProfileId = null),
      this.write(o)
    );
  }),
  (ProfileStore.prototype.deleteSubscription = function (r) {
    var e,
      o = this.read(),
      t = [],
      i = [],
      s = !1;
    for (e = 0; e < o.subscriptions.length; e++)
      o.subscriptions[e].id !== r ? t.push(o.subscriptions[e]) : (s = !0);
    if (!s) throw err("SUBSCRIPTION_NOT_FOUND", "unknown subscription");
    for (e = 0; e < o.profiles.length; e++)
      o.profiles[e].subscriptionId !== r && i.push(o.profiles[e]);
    return (
      (o.subscriptions = t),
      (o.profiles = i),
      o.profiles.length
        ? this.hasProfile(o, o.activeId) || (o.activeId = o.profiles[0].id)
        : (o.activeId = null),
      this.hasProfile(o, o.autostartProfileId) || (o.autostartProfileId = null),
      this.write(o)
    );
  }),
  (ProfileStore.prototype.setSubscriptionHwid = function (r, e) {
    var o,
      t = normalizeProviderHwid(e),
      i = this.read(),
      s = !1;
    if (null === t)
      throw err("INVALID_PARAMS", "providerHwid contains invalid characters");
    for (o = 0; o < i.subscriptions.length; o++)
      if (i.subscriptions[o].id === r) {
        s = !0;
        if (t) i.subscriptions[o].providerHwid = t;
        else delete i.subscriptions[o].providerHwid;
        break;
      }
    if (!s) throw err("SUBSCRIPTION_NOT_FOUND", "unknown subscription");
    return this.write(i);
  }),
  (ProfileStore.prototype.hasProfile = function (r, e) {
    var o;
    if (!e) return !1;
    for (o = 0; o < r.profiles.length; o++)
      if (r.profiles[o].id === e) return !0;
    return !1;
  }),
  (ProfileStore.prototype.setLanguage = function (r) {
    var e = this.read();
    return ((e.lang = r), this.write(e));
  }),
  (ProfileStore.prototype.getDnsServer = function () {
    return normalizeDnsServer(this.read().dnsServer) || DEFAULT_DNS_SERVER;
  }),
  (ProfileStore.prototype.getConnectionMode = function () {
    var r = this.read();
    return CONNECTION_MODES[r.connectionMode]
      ? r.connectionMode
      : DEFAULT_CONNECTION_MODE;
  }),
  (ProfileStore.prototype.isConnectionModeExplicit = function () {
    return !0 === this.read().connectionModeExplicit;
  }),
  (ProfileStore.prototype.setConnectionMode = function (r, e) {
    var o;
    if (!CONNECTION_MODES[r])
      throw err("MODE_UNSUPPORTED", "system proxy mode is not supported");
    return (
      ((o = this.read()).connectionMode = r),
      (o.connectionModeExplicit = !1 !== e),
      this.write(o),
      r
    );
  }),
  (ProfileStore.prototype.setDnsServer = function (r) {
    var e = normalizeDnsServer(r);
    if (null != r && String(r).trim() && !e)
      throw err("INVALID_DNS_SERVER", "public ipv4 address required");
    var o = this.read();
    return ((o.dnsServer = e), (o.dnsServerSet = !!e), this.write(o), e);
  }),
  (ProfileStore.prototype.upsertManualProfile = function (r, e) {
    var o,
      t,
      i = this.read(),
      s = parsers.profileKeyFromLink(r),
      n = parsers.parseProxyLink(r),
      l = null;
    for (o = 0; o < i.profiles.length; o++)
      if (
        !i.profiles[o].subscriptionId &&
        parsers.profileKeyFromLink(i.profiles[o].link) === s
      ) {
        l = i.profiles[o];
        break;
      }
    if (l)
      ((l.name = parsers.cleanServerLabel(e || l.name || parsers.inferName(r))),
        (l.link = r),
        (l.protocol = n.protocol || l.protocol || "vless"),
        (l.updatedAt = now()));
    else {
      if (i.profiles.length >= MAX_PROFILES)
        throw err("STORE_WRITE_FAILED", "profile limit reached");
      ((l = {
        id: this.newId("p"),
        protocol: n.protocol || "vless",
        name: parsers.cleanServerLabel(e || parsers.inferName(r)),
        link: r,
        sourceType: "single",
        addedAt: now(),
        updatedAt: now(),
      }),
        i.profiles.push(l));
    }
    return (
      (t = parsers.detectCountry((e || "") + " " + (n.name || ""))) &&
        (l.country = t),
      (i.activeId = l.id),
      parsers.dedupeProfilesInStore(i),
      this.write(i),
      { profile: l, store: i }
    );
  }),
  (ProfileStore.prototype.applySubscription = function (r, e, o, t, i) {
    var s,
      n,
      l,
      a,
      p,
      u,
    f,
    H,
      c = this.read(),
      d = null,
      S = [],
      h = {},
      I = {},
      P = 0;
    for (t = t || {}, i = i || {}, s = 0; s < c.subscriptions.length; s++)
      c.subscriptions[s].url === r && (d = c.subscriptions[s]);
    if (!d) {
      if (c.subscriptions.length >= MAX_SUBSCRIPTIONS)
        throw err("STORE_WRITE_FAILED", "subscription limit reached");
      ((d = { id: this.newId("s"), url: r, name: "", createdAt: now() }),
        c.subscriptions.push(d));
    }
    for (
      d.name = e || parsers.profileTitleFromHeaders(t, d.name || ""),
        d.compatMode = !0,
        d.lastUpdate = now(),
        d.error = "",
        d.subscriptionUserinfo = t["subscription-userinfo"] || "",
        d.skippedReasons = normalizeSkippedReasons(i.skippedReasons),
        d.skippedCount = skippedCountFor(d.skippedReasons),
        Object.prototype.hasOwnProperty.call(i, "providerHwid") &&
          ((H = normalizeProviderHwid(i.providerHwid)),
          null === H
            ? delete d.providerHwid
            : H
              ? (d.providerHwid = H)
              : delete d.providerHwid),
        s = 0;
      s < c.profiles.length;
      s++
    )
      c.profiles[s].subscriptionId === d.id
        ? (h[parsers.profileKey(c.profiles[s])] = c.profiles[s])
        : S.push(c.profiles[s]);
    for (c.profiles = S, s = 0; s < o.length; s++)
      if (
        ((n = o[s]),
        (l = parsers.parseProxyLink(n.link)),
        !I[(a = parsers.profileKey(n))])
      ) {
        if (((I[a] = !0), P++, c.profiles.length >= MAX_PROFILES)) break;
        ((p = h[a] || null),
          (u =
            parsers.cleanServerName(n.name) ||
            parsers.importedProfileName(l, p, d.name, P)),
          ((f = {
            id: (p && p.id) || this.newId("p"),
            protocol: n.protocol || l.protocol || "vless",
            name: parsers.cleanServerLabel(u),
            link: n.link,
            sourceType: "subscription",
            subscriptionId: d.id,
            subscriptionName: d.name,
            addedAt: (p && p.addedAt) || now(),
            updatedAt: now(),
          }).country =
            parsers.detectCountry(u + " " + (l.name || "")) ||
            (p && p.country) ||
            void 0),
          n.sourceKey && (f.sourceKey = n.sourceKey),
          n.fullConfig && (f.fullConfig = n.fullConfig),
          c.profiles.push(f));
      }
    return (
      (d.count = P),
      parsers.dedupeProfilesInStore(c),
      this.hasProfile(c, c.activeId) ||
        (c.activeId = (c.profiles[0] && c.profiles[0].id) || null),
      this.hasProfile(c, c.autostartProfileId) || (c.autostartProfileId = null),
      this.write(c),
      { subscription: d, count: P, store: c }
    );
  }),
  (module.exports = {
    MAX_PROFILES: MAX_PROFILES,
    MAX_SUBSCRIPTIONS: MAX_SUBSCRIPTIONS,
    DEFAULT_DNS_SERVER: DEFAULT_DNS_SERVER,
    DEFAULT_CONNECTION_MODE: DEFAULT_CONNECTION_MODE,
    CONNECTION_MODES: CONNECTION_MODES,
    normalizeDnsServer: normalizeDnsServer,
    ProfileStore: ProfileStore,
    normalize: normalize,
    defaultStore: defaultStore,
    sanitizeProfile: sanitizeProfile,
    sanitizeSubscription: sanitizeSubscription,
    normalizeSkippedReasons: normalizeSkippedReasons,
    skippedCountFor: skippedCountFor,
    normalizeProviderHwid: normalizeProviderHwid,
  }));
