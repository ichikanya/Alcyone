"use strict";
var childProcess = require("child_process"),
  fs = require("fs"),
  path = require("path"),
  atomic = require("../atomic"),
  guardianLib = require("./guardian-client"),
  policyLib = require("./policy-routes"),
  errors = require("../errors"),
  err = errors.err,
  IP_CANDIDATES = ["/sbin/ip", "/usr/sbin/ip", "/bin/ip", "/usr/bin/ip"],
  TUN_NAME = "tun0",
  TUN_IP = "198.18.0.1",
  TUN_GW = "198.18.0.2",
  TUN_MASK = "30",
  SPLIT_ROUTES = ["0.0.0.0/1", "128.0.0.0/1"],
  IPV6_BLOCK_ROUTES = ["::/1", "8000::/1"],
  DIRECT_BYPASS_ROUTES = [
    { prefix: "0.0.0.0/8", probe: "", gateway: !0 },
    { prefix: "10.0.0.0/8", probe: "10.1.2.3", gateway: !0 },
    { prefix: "100.64.0.0/10", probe: "100.64.1.2", gateway: !0 },
    { prefix: "169.254.0.0/16", probe: "169.254.1.2", gateway: !1 },
    { prefix: "172.16.0.0/12", probe: "172.16.1.2", gateway: !0 },
    { prefix: "192.168.0.0/16", probe: "192.168.1.2", gateway: !0 },
    { prefix: "224.0.0.0/4", probe: "239.255.255.250", gateway: !1 },
    { prefix: "240.0.0.0/4", probe: "240.0.0.1", gateway: !1 },
  ];
function findIpBinary() {
  return require("../supervisor").resolveExecutable(IP_CANDIDATES);
}
function RouteManager(e) {
  ((e = e || {}),
    (this.logger = e.logger),
    (this.core = "sing-box" === e.core ? "sing-box" : "xray"),
    (this.stateFile = e.stateFile),
    (this.ipBinary = e.ipBinary || findIpBinary()),
    (this.procRouteFile = e.procRouteFile || "/proc/net/route"),
    (this.applied = !1));
  this.guardian =
    e.guardian ||
    (e.stateFile
      ? new guardianLib.GuardianClient({
          logger: this.logger,
          leaseFile: path.join(
            path.dirname(e.stateFile),
            "netguard-" + this.core + ".lease",
          ),
        })
      : null);
  this.policy = new policyLib.PolicyRoutes({
    ip: this.ip.bind(this),
    persist: this.persistState.bind(this),
    logger: this.logger,
    core: this.core,
    tunName: TUN_NAME,
    tunIp: TUN_IP,
    tunGw: TUN_GW,
  });
}
function routeIdentity(e) {
  return e && e.device ? String(e.device) + "|" + String(e.gateway || "") : "";
}
function decodeProcIpv4(e) {
  var t,
    r = [];
  if (!/^[0-9A-Fa-f]{8}$/.test(String(e || ""))) return "";
  for (t = 6; t >= 0; t -= 2) r.push(parseInt(e.substr(t, 2), 16));
  return r.join(".");
}
((RouteManager.prototype.ip = function (e) {
  var t;
  return this.ipBinary
    ? {
        code:
          "number" ==
          typeof (t = childProcess.spawnSync(this.ipBinary, e, {
            shell: !1,
            encoding: "utf8",
            timeout: 5e3,
            env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin" },
          })).status
            ? t.status
            : -1,
        stdout: String(t.stdout || ""),
        stderr: String(t.stderr || ""),
      }
    : { code: -1, stdout: "", missing: !0 };
}),
  (RouteManager.prototype.persistState = function (state) {
    atomic.writeJsonAtomic(this.stateFile, state);
  }),
  (RouteManager.prototype.available = function () {
    return !!this.ipBinary;
  }),
  (RouteManager.prototype.armGuardian = function (e) {
    var t;
    if (!this.guardian || !this.guardian.enabled) return !0;
    if (!e) return !0;
    t = {
      edition: this.core,
      tunIf: TUN_NAME,
      v6Block: IPV6_BLOCK_ROUTES.slice(),
      splitV4:
        "policy" === e.routingBackend && e.policy ? [] : SPLIT_ROUTES.slice(),
    };
    "policy" === e.routingBackend &&
      e.policy &&
      e.policy.table &&
      ((t.rulePref = e.policy.tunnelPriority),
      (t.ruleTable = e.policy.table),
      (t.v6Rule = !!e.policy.ipv6RuleApplied));
    /* Rearm is a full disarm+arm: the C guardian reads its lease once. */
    this.guardian.status().armed && this.guardian.disarm();
    /* When the netguard feature is enabled, a failed arm ABORTS the
       takeover: connecting without an independent fail-open is exactly
       the failure mode this stage exists to remove. */
    try {
      this.guardian.arm(t);
    } catch (armError) {
      throw err(
        "GUARDIAN_UNAVAILABLE",
        armError && armError.code ? armError.code : "arm failed",
      );
    }
    return !0;
  }),
  (RouteManager.prototype.disarmGuardian = function () {
    return (
      !this.guardian ||
      !this.guardian.enabled ||
      (this.guardian.stopHeartbeat(), !0)
    );
  }),
  (RouteManager.prototype.readDefaultRoute = function () {
    var e,
      t,
      r,
      i,
      o = this.ip(["route", "show", "default"]).stdout.split("\n");
    for (e = 0; e < o.length; e++)
      if (
        (t = o[e]) &&
        !(t.indexOf(TUN_NAME) >= 0) &&
        ((r = /\bvia\s+(\S+)/.exec(t)), (i = /\bdev\s+(\S+)/.exec(t)))
      )
        return { gateway: r ? r[1] : "", device: i[1], raw: t.trim() };
    return this.readProcDefaultRoute();
  }),
  (RouteManager.prototype.networkChanged = function (e) {
    var t, r;
    return (
      !(!(t = (e = e || this.loadState()) && e.original) || !t.device) &&
      (!(r = this.readDefaultRoute()) || routeIdentity(r) !== routeIdentity(t))
    );
  }),
  (RouteManager.prototype.readProcDefaultRoute = function () {
    var e, t, r, i, o, a;
    try {
      e = fs.readFileSync(this.procRouteFile, "utf8");
    } catch (e) {
      return null;
    }
    for (t = e.split("\n"), r = 1; r < t.length; r++)
      if (!(
        (i = t[r].trim().split(/\s+/)).length < 8 ||
        i[0] === TUN_NAME ||
        "00000000" !== i[1] ||
        "00000000" !== i[7] ||
        0 == (1 & parseInt(i[3], 16))
      ))
        return (
          (a =
            "default" +
            ((o = decodeProcIpv4(i[2])) && "0.0.0.0" !== o ? " via " + o : "") +
            " dev " +
            i[0]),
          { gateway: "0.0.0.0" === o ? "" : o, device: i[0], raw: a }
        );
    return null;
  }),
  (RouteManager.prototype.readHostRoute = function (e) {
    var t,
      r,
      i = this.ip(["route", "show", "exact", e]).stdout.split("\n");
    for (t = 0; t < i.length; t++)
      if ((r = i[t].trim()) && r.indexOf(TUN_NAME) < 0) return r;
    return "";
  }),
  (RouteManager.prototype.readIpv4Route = function (e) {
    var t,
      r,
      i = this.ip(["route", "show", "exact", e]).stdout.split("\n");
    for (t = 0; t < i.length; t++) if ((r = i[t].trim())) return r;
    return "";
  }),
  (RouteManager.prototype.readIpv6Route = function (e) {
    var t,
      r,
      i = this.ip(["-6", "route", "show", "exact", e]).stdout.split("\n");
    for (t = 0; t < i.length; t++) if ((r = i[t].trim())) return r;
    return "";
  }),
  (RouteManager.prototype.saveState = function (e) {
    var t,
      r,
      i,
      o,
      a = this.readDefaultRoute(),
      s = {},
      n = {},
      u = {};
    if (!a || !a.device)
      throw err("ROUTE_FAILED", "physical default route unavailable");
    for (e = e || [], t = 0; t < e.length; t++)
      ((r = e[t]), (i = this.readHostRoute(r)) && (s[r] = i));
    for (t = 0; t < IPV6_BLOCK_ROUTES.length; t++)
      (i = this.readIpv6Route(IPV6_BLOCK_ROUTES[t])) &&
        (u[IPV6_BLOCK_ROUTES[t]] = i);
    for (t = 0; t < DIRECT_BYPASS_ROUTES.length; t++)
      ((o = DIRECT_BYPASS_ROUTES[t]),
        (i = this.readIpv4Route(o.prefix)) && (n[o.prefix] = i));
    var p = {
      schemaVersion: 2,
      routingBackend: "policy",
      original: a,
      serverAddresses: e,
      serverRoutes: s,
      directRoutes: n,
      ipv6Routes: u,
      core: this.core,
      savedAt: Date.now(),
    };
    try {
      this.policy.prepare(p);
    } catch (policyError) {
      p.routingBackend = "legacy";
      p.policy = null;
      this.logger &&
        this.logger.warn("policy routing unavailable, using legacy backend", {
          code: policyError.code || "ROUTE_FAILED",
        });
    }
    return (atomic.writeJsonAtomic(this.stateFile, p), p);
  }),
  (RouteManager.prototype.loadState = function () {
    return atomic.readJson(this.stateFile, null);
  }),
  (RouteManager.prototype.tunExists = function () {
    return 0 === this.ip(["link", "show", TUN_NAME]).code;
  }),
  (RouteManager.prototype.addServerBypass = function (e, t) {
    e &&
      t &&
      (t.gateway
        ? this.ip(["route", "replace", e, "via", t.gateway, "dev", t.device])
        : this.ip(["route", "replace", e, "dev", t.device]));
  }),
  (RouteManager.prototype.removeServerBypass = function (e, t, r) {
    e &&
      (t &&
        t.gateway &&
        this.ip(["route", "del", e, "via", t.gateway, "dev", t.device]),
      this.ip(["route", "del", e]),
      r && this.ip(["route", "replace"].concat(String(r).split(/\s+/))));
  }),
  (RouteManager.prototype.installDirectBypasses = function (e) {
    var t,
      r,
      i,
      o,
      a = e && e.original;
    if (!a || !a.device)
      throw err("ROUTE_FAILED", "physical default route unavailable");
    for (t = 0; t < DIRECT_BYPASS_ROUTES.length; t++)
      if (
        ((o = ["route", "replace", (r = DIRECT_BYPASS_ROUTES[t]).prefix]),
        r.gateway && a.gateway && (o = o.concat(["via", a.gateway])),
        (o = o.concat(["dev", a.device])),
        0 !== (i = this.ip(o)).code)
      )
        throw (
          this.logger &&
            this.logger.warn("direct route install failed", {
              prefix: r.prefix,
              status: i.code,
            }),
          err("ROUTE_FAILED", "direct route install failed")
        );
  }),
  (RouteManager.prototype.directRoutesActive = function (e) {
    var t,
      r,
      i,
      o,
      a = e && e.original;
    if (!a || !a.device) return !1;
    for (t = 0; t < DIRECT_BYPASS_ROUTES.length; t++)
      if (
        ((r = (o = DIRECT_BYPASS_ROUTES[t]).probe
          ? this.ip(["route", "get", o.probe])
          : this.ip(["route", "show", "exact", o.prefix])),
        (i = /\bdev\s+(\S+)/.exec(r.stdout)),
        0 !== r.code ||
          !i ||
          i[1] !== a.device ||
          r.stdout.indexOf(TUN_NAME) >= 0 ||
          r.stdout.indexOf(TUN_GW) >= 0)
      )
        return (
          this.logger &&
            this.logger.warn("direct route verification failed", {
              prefix: o.prefix,
              status: r.code,
            }),
          !1
        );
    return !0;
  }),
  (RouteManager.prototype.applyTunRoutes = function (e) {
    var t,
      r = e && e.original,
      i = (e && e.serverAddresses) || [];
    if (!this.available()) throw err("ROUTE_FAILED", "ip binary unavailable");
    /* Arm the independent fail-open BEFORE any network object exists. */
    this.armGuardian(e);
    if (e && e.routingBackend === "policy" && e.policy) {
      try {
        this.policy.apply(e);
        this.applied = !0;
        this.logger && this.logger.info("tun routes applied", { core: this.core, backend: "policy" });
        return !0;
      } catch (policyError) {
        this.policy.rollback(e);
        e.routingBackend = "legacy";
        e.policy = null;
        this.persistState(e);
        this.logger &&
          this.logger.warn("policy routing transaction rolled back", {
            code: policyError.code || "ROUTE_FAILED",
          });
        /* Backend changed: rearm with the legacy object set. */
        this.armGuardian(e);
      }
    }
    for (t = 0; t < SPLIT_ROUTES.length; t++)
      this.ip(["route", "del", SPLIT_ROUTES[t]]);
    for (t = 0; t < IPV6_BLOCK_ROUTES.length; t++)
      this.ip([
        "-6",
        "route",
        "replace",
        "unreachable",
        IPV6_BLOCK_ROUTES[t],
        "metric",
        "42760",
      ]);
    for (
      "sing-box" === this.core
        ? this.ip(["addr", "add", TUN_IP + "/" + TUN_MASK, "dev", TUN_NAME])
        : this.ip([
            "addr",
            "add",
            TUN_IP + "/" + TUN_MASK,
            "peer",
            TUN_GW,
            "dev",
            TUN_NAME,
          ]),
        this.ip(["link", "set", TUN_NAME, "up"]),
        t = 0;
      t < i.length;
      t++
    )
      this.addServerBypass(i[t], r);
    for (this.installDirectBypasses(e), t = 0; t < SPLIT_ROUTES.length; t++)
      "sing-box" === this.core
        ? this.ip(["route", "replace", SPLIT_ROUTES[t], "dev", TUN_NAME])
        : this.ip([
            "route",
            "replace",
            SPLIT_ROUTES[t],
            "via",
            TUN_GW,
            "dev",
            TUN_NAME,
          ]);
    if ((this.ip(["route", "flush", "cache"]), !this.directRoutesActive(e)))
      throw err("ROUTE_FAILED", "direct routes captured by tunnel");
    return (
      (this.applied = !0),
      this.logger &&
        this.logger.info("tun routes applied", {
          core: this.core,
          bypass: i.length,
        }),
      !0
    );
  }),
  (RouteManager.prototype.routeActive = function () {
    var e,
      t,
      r = ["9.9.9.9", "1.0.0.1", "208.67.222.222"];
    var state = this.loadState();
    if (state && state.routingBackend === "policy" && state.policy)
      return this.policy.routeActive(state);
    for (e = 0; e < r.length; e++)
      if (
        0 === (t = this.ip(["route", "get", r[e]])).code &&
        (t.stdout.indexOf(TUN_NAME) >= 0 || t.stdout.indexOf(TUN_GW) >= 0)
      )
        return !0;
    return !1;
  }),
  (RouteManager.prototype.physicalRestored = function () {
    var physical = this.readDefaultRoute();
    var publicRoute = this.ip(["route", "get", "9.9.9.9"]);
    return !!(physical && physical.device && physical.device !== TUN_NAME) &&
      publicRoute.code === 0 &&
      publicRoute.stdout.indexOf(TUN_NAME) < 0 &&
      publicRoute.stdout.indexOf(TUN_GW) < 0;
  }),
  (RouteManager.prototype.rollback = function (e) {
    e = e || {};
    var t,
      r,
      i = this.loadState(),
      o = i && i.original,
      a = (i && i.serverAddresses) || [],
      s = (i && i.serverRoutes) || {},
      n = i && i.directRoutes,
      u = (i && i.ipv6Routes) || {};
    if (!this.available()) return !1;
    if (i && i.policy) this.policy.rollback(i);
    for (t = 0; t < SPLIT_ROUTES.length; t++)
      this.ip(["route", "del", SPLIT_ROUTES[t]]);
    for (t = 0; t < IPV6_BLOCK_ROUTES.length; t++)
      (this.ip([
        "-6",
        "route",
        "del",
        "unreachable",
        IPV6_BLOCK_ROUTES[t],
        "metric",
        "42760",
      ]),
        !e.preserveCurrentNetwork &&
          u[IPV6_BLOCK_ROUTES[t]] &&
          this.ip(
            ["-6", "route", "replace"].concat(
              String(u[IPV6_BLOCK_ROUTES[t]]).split(/\s+/),
            ),
          ));
    if (!e.preserveCurrentNetwork)
      for (t = 0; t < a.length; t++)
        this.removeServerBypass(a[t], o, s[a[t]] || "");
    if (n && !e.preserveCurrentNetwork)
      for (t = 0; t < DIRECT_BYPASS_ROUTES.length; t++)
        ((r = DIRECT_BYPASS_ROUTES[t]),
          this.ip(["route", "del", r.prefix]),
          n[r.prefix] &&
            this.ip(
              ["route", "replace"].concat(String(n[r.prefix]).split(/\s+/)),
            ));
    return (
      this.ip(["route", "flush", "dev", TUN_NAME]),
      this.ip(["link", "set", TUN_NAME, "down"]),
      this.ip(["addr", "flush", "dev", TUN_NAME]),
      this.ip(["link", "delete", TUN_NAME]),
      !e.preserveCurrentNetwork &&
        o &&
        o.device &&
        null === this.readDefaultRoute() &&
        (o.gateway
          ? this.ip([
              "route",
              "replace",
              "default",
              "via",
              o.gateway,
              "dev",
              o.device,
            ])
          : this.ip(["route", "replace", "default", "dev", o.device])),
      this.ip(["route", "flush", "cache"]),
      (this.applied = !1),
      this.physicalRestored() && atomic.removeQuiet(this.stateFile),
      this.logger && this.logger.info("routes rolled back"),
      /* Disarm only after the physical path is verified: if rollback
         failed, the guardian stays armed and will fail-open on expiry. */
      this.physicalRestored()
        ? (this.guardian && this.guardian.enabled && this.guardian.disarm(),
          !0)
        : (this.logger &&
            this.logger.warn("physical route not restored, netguard stays armed"),
          !1)
    );
  }),
  (RouteManager.prototype.diagnostics = function () {
    var e = this.loadState(),
      t = this.ip(["route", "get", "9.9.9.9"]);
    return {
      core: this.core,
      routingBackend: (e && e.routingBackend) || "legacy",
      ipAvailable: this.available(),
      tunPresent: this.tunExists(),
      routeActive: this.routeActive(),
      directBypassActive: this.directRoutesActive(e),
      originalDevice: (e && e.original && e.original.device) || "",
      bypassCount: (e && e.serverAddresses && e.serverAddresses.length) || 0,
      ipv6Blocked:
        !!(e && e.routingBackend === "policy" && e.policy && e.policy.ipv6RuleApplied) ||
        this.ip(["-6", "route", "show", IPV6_BLOCK_ROUTES[0]]).stdout.indexOf("unreachable") >= 0,
      publicRouteUsesTun:
        t.stdout.indexOf(TUN_NAME) >= 0 || t.stdout.indexOf(TUN_GW) >= 0,
    };
  }),
  (module.exports = {
    TUN_NAME: TUN_NAME,
    TUN_IP: TUN_IP,
    TUN_GW: TUN_GW,
    TUN_MASK: TUN_MASK,
    SPLIT_ROUTES: SPLIT_ROUTES,
    IPV6_BLOCK_ROUTES: IPV6_BLOCK_ROUTES,
    DIRECT_BYPASS_ROUTES: DIRECT_BYPASS_ROUTES,
    IP_CANDIDATES: IP_CANDIDATES,
    RouteManager: RouteManager,
    routeIdentity: routeIdentity,
    decodeProcIpv4: decodeProcIpv4,
    findIpBinary: findIpBinary,
  }));
