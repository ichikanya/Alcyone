"use strict";

var errors = require("../errors");
var err = errors.err;
var TABLE_MIN = 42760;
var TABLE_MAX = 42767;
var BYPASS_PREF_MIN = 80;
var BYPASS_PREF_MAX = 99;
var TUNNEL_PREF_MIN = 100;
var TUNNEL_PREF_MAX = 127;
var DIRECT_PREFIXES = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "224.0.0.0/4",
  "240.0.0.0/4",
];

function words(value) {
  return String(value || "").trim().split(/\s+/);
}

function parseRouteGet(output, fallback) {
  var tokens = words(String(output || "").split("\n")[0]);
  var result = {
    gateway: (fallback && fallback.gateway) || "",
    device: (fallback && fallback.device) || "",
    source: "",
    table: "main",
  };
  var i;
  for (i = 0; i < tokens.length - 1; i++) {
    if (tokens[i] === "via") result.gateway = tokens[i + 1];
    if (tokens[i] === "dev") result.device = tokens[i + 1];
    if (tokens[i] === "src") result.source = tokens[i + 1];
    if (tokens[i] === "table") result.table = tokens[i + 1];
  }
  return result;
}

function usedPriorities(text) {
  var used = {};
  String(text || "").split("\n").forEach(function (line) {
    var match = /^\s*(\d+):/.exec(line);
    if (match) used[parseInt(match[1], 10)] = true;
  });
  return used;
}

function choosePriority(used, minimum, maximum) {
  var priority;
  for (priority = minimum; priority <= maximum; priority++) {
    if (!used[priority]) {
      used[priority] = true;
      return priority;
    }
  }
  return 0;
}

function validIpv4(value, allowPrefix) {
  var parts = String(value || "").split("/");
  var octets;
  var i;
  if (parts.length > (allowPrefix ? 2 : 1)) return false;
  if (parts.length === 2 && (!allowPrefix || !/^\d+$/.test(parts[1]) || parseInt(parts[1], 10) > 32))
    return false;
  octets = parts[0].split(".");
  if (octets.length !== 4) return false;
  for (i = 0; i < octets.length; i++) {
    if (!/^\d+$/.test(octets[i]) || parseInt(octets[i], 10) > 255) return false;
  }
  return true;
}

/* A policy table is consulted before main, so it must contain the real
   on-link routes of the physical NIC. A broad 192.168/16 route via the
   gateway is not equivalent: replies to a LAN controller can be hairpinned
   through the router and disappear even while the TV itself remains alive. */
function parseLinkRoutes(text, device) {
  var result = [];
  var seen = {};
  String(text || "")
    .split("\n")
    .forEach(function (line) {
      var tokens = words(line);
      var prefix = tokens[0];
      var devAt = tokens.indexOf("dev");
      var srcAt = tokens.indexOf("src");
      var source = srcAt >= 0 ? tokens[srcAt + 1] : "";
      if (
        !validIpv4(prefix, true) ||
        devAt < 0 ||
        tokens[devAt + 1] !== device ||
        tokens.indexOf("via") >= 0 ||
        (source && !validIpv4(source, false)) ||
        seen[prefix]
      )
        return;
      seen[prefix] = true;
      result.push({ prefix: prefix, device: device, source: source });
    });
  return result;
}

function PolicyRoutes(options) {
  options = options || {};
  this.ip = options.ip;
  this.persist = options.persist || function () {};
  this.logger = options.logger || null;
  this.core = options.core === "sing-box" ? "sing-box" : "xray";
  this.tunName = options.tunName || "tun0";
  this.tunIp = options.tunIp || "198.18.0.1";
  this.tunGw = options.tunGw || "198.18.0.2";
}

PolicyRoutes.prototype.run = function (args, required) {
  var result = this.ip(args);
  if (required && (!result || result.code !== 0))
    throw err("ROUTE_FAILED", "policy routing command failed");
  return result || { code: -1, stdout: "" };
};

PolicyRoutes.prototype.prepare = function (state) {
  var rules = this.run(["rule", "show"], true);
  var used = usedPriorities(rules.stdout);
  var table;
  var tableOutput;
  var i;
  var path;
  var bypass;
  for (table = TABLE_MIN; table <= TABLE_MAX; table++) {
    tableOutput = this.run(["route", "show", "table", String(table)], false);
    if (tableOutput.code === 0 && !String(tableOutput.stdout || "").trim()) break;
  }
  if (table > TABLE_MAX) throw err("ROUTE_FAILED", "no free routing table");
  state.schemaVersion = 2;
  state.routingBackend = "policy";
  state.policy = {
    table: table,
    tunnelPriority: choosePriority(used, TUNNEL_PREF_MIN, TUNNEL_PREF_MAX),
    endpointPaths: [],
    linkRoutes: [],
    tunnelRuleApplied: false,
    ipv6RuleApplied: false,
    tablePrepared: false,
  };
  if (!state.policy.tunnelPriority)
    throw err("ROUTE_FAILED", "no free tunnel rule priority");
  state.policy.linkRoutes = parseLinkRoutes(
    this.run(
      ["route", "show", "table", "main", "scope", "link"],
      false
    ).stdout,
    state.original.device
  );
  /* Unsupported/empty discovery falls back to legacy before takeover. It is
     safer to decline policy routing than to make LAN recovery depend on a
     router accepting same-interface hairpin traffic. */
  if (!state.policy.linkRoutes.length)
    throw err("ROUTE_FAILED", "physical link routes unavailable");
  for (i = 0; i < state.serverAddresses.length; i++) {
    path = parseRouteGet(
      this.run(["route", "get", state.serverAddresses[i]], true).stdout,
      state.original
    );
    if (!path.device || path.device === this.tunName)
      throw err("ROUTE_FAILED", "proxy endpoint has no physical route");
    bypass = choosePriority(used, BYPASS_PREF_MIN, BYPASS_PREF_MAX);
    if (!bypass) throw err("ROUTE_FAILED", "no free endpoint rule priority");
    path.address = state.serverAddresses[i];
    path.priority = bypass;
    path.ruleApplied = false;
    state.policy.endpointPaths.push(path);
  }
  this.persist(state);
  return state;
};

PolicyRoutes.prototype.endpointRouteArgs = function (path, table) {
  var args = ["route", "replace", path.address + "/32"];
  if (path.gateway) args = args.concat(["via", path.gateway]);
  args = args.concat(["dev", path.device]);
  if (path.source) args = args.concat(["src", path.source]);
  return args.concat(["table", String(table)]);
};

PolicyRoutes.prototype.linkRouteArgs = function (path, table) {
  var args = ["route", "replace", path.prefix, "dev", path.device, "scope", "link"];
  if (path.source) args = args.concat(["src", path.source]);
  return args.concat(["table", String(table)]);
};

PolicyRoutes.prototype.linkRoutesPhysical = function (state) {
  var policy = state && state.policy;
  var i;
  var result;
  if (!policy || !policy.linkRoutes || !policy.linkRoutes.length) return false;
  for (i = 0; i < policy.linkRoutes.length; i++) {
    result = this.run(
      ["route", "show", "table", String(policy.table), "exact", policy.linkRoutes[i].prefix],
      false
    );
    if (
      result.code !== 0 ||
      result.stdout.indexOf("dev " + policy.linkRoutes[i].device) < 0 ||
      result.stdout.indexOf(" via ") >= 0
    )
      return false;
  }
  return true;
};

PolicyRoutes.prototype.apply = function (state) {
  var policy = state.policy;
  var i;
  var path;
  var route;
  if (!policy || !policy.table) throw err("ROUTE_FAILED", "policy journal missing");
  for (i = 0; i < policy.endpointPaths.length; i++) {
    path = policy.endpointPaths[i];
    this.run(this.endpointRouteArgs(path, policy.table), true);
    this.run(["rule", "add", "priority", String(path.priority), "to", path.address + "/32", "lookup", String(path.table || "main")], true);
    path.ruleApplied = true;
    this.persist(state);
  }
  for (i = 0; i < policy.linkRoutes.length; i++)
    this.run(this.linkRouteArgs(policy.linkRoutes[i], policy.table), true);
  for (i = 0; i < DIRECT_PREFIXES.length; i++) {
    route = ["route", "replace", DIRECT_PREFIXES[i]];
    if (state.original.gateway && DIRECT_PREFIXES[i] !== "169.254.0.0/16" && DIRECT_PREFIXES[i] !== "224.0.0.0/4" && DIRECT_PREFIXES[i] !== "240.0.0.0/4")
      route = route.concat(["via", state.original.gateway]);
    this.run(route.concat(["dev", state.original.device, "table", String(policy.table)]), true);
  }
  if (!this.linkRoutesPhysical(state))
    throw err("ROUTE_FAILED", "physical link routes missing from policy table");
  if (this.core === "sing-box") {
    this.run(["addr", "add", this.tunIp + "/30", "dev", this.tunName], false);
  } else {
    this.run(["addr", "add", this.tunIp + "/30", "peer", this.tunGw, "dev", this.tunName], false);
  }
  this.run(["link", "set", this.tunName, "up"], true);
  route = ["route", "replace", "default"];
  if (this.core !== "sing-box") route = route.concat(["via", this.tunGw]);
  this.run(route.concat(["dev", this.tunName, "table", String(policy.table)]), true);
  this.run(["-6", "route", "replace", "default", "dev", this.tunName, "table", String(policy.table)], false);
  policy.tablePrepared = true;
  this.persist(state);
  for (i = 0; i < policy.endpointPaths.length; i++) {
    path = policy.endpointPaths[i];
    route = this.run(["route", "get", path.address], true);
    if (route.stdout.indexOf(this.tunName) >= 0)
      throw err("ROUTE_FAILED", "proxy endpoint would loop through tunnel");
  }
  this.run(["rule", "add", "priority", String(policy.tunnelPriority), "from", "all", "lookup", String(policy.table)], true);
  policy.tunnelRuleApplied = true;
  this.persist(state);
  if (this.run(["-6", "rule", "add", "priority", String(policy.tunnelPriority), "from", "all", "lookup", String(policy.table)], false).code === 0) {
    policy.ipv6RuleApplied = true;
    this.persist(state);
  }
  this.run(["route", "flush", "cache"], false);
  return true;
};

PolicyRoutes.prototype.rollback = function (state) {
  var policy = state && state.policy;
  var i;
  var path;
  if (!policy) return true;
  this.run(["rule", "del", "priority", String(policy.tunnelPriority)], false);
  this.run(["-6", "rule", "del", "priority", String(policy.tunnelPriority)], false);
  policy.tunnelRuleApplied = false;
  policy.ipv6RuleApplied = false;
  this.persist(state);
  for (i = 0; i < policy.endpointPaths.length; i++) {
    path = policy.endpointPaths[i];
    this.run(["rule", "del", "priority", String(path.priority)], false);
    path.ruleApplied = false;
  }
  this.run(["route", "flush", "table", String(policy.table)], false);
  this.run(["-6", "route", "flush", "table", String(policy.table)], false);
  this.run(["route", "flush", "cache"], false);
  return true;
};

PolicyRoutes.prototype.routeActive = function (state) {
  var policy = state && state.policy;
  var result;
  if (!policy || !policy.tunnelRuleApplied) return false;
  result = this.run(["route", "get", "9.9.9.9"], false);
  return result.code === 0 && result.stdout.indexOf(this.tunName) >= 0;
};

PolicyRoutes.prototype.endpointsPhysical = function (state) {
  var policy = state && state.policy;
  var i;
  var result;
  if (!policy) return false;
  for (i = 0; i < policy.endpointPaths.length; i++) {
    result = this.run(["route", "get", policy.endpointPaths[i].address], false);
    if (result.code !== 0 || result.stdout.indexOf(this.tunName) >= 0) return false;
  }
  return true;
};

module.exports = {
  TABLE_MIN: TABLE_MIN,
  TABLE_MAX: TABLE_MAX,
  BYPASS_PREF_MIN: BYPASS_PREF_MIN,
  BYPASS_PREF_MAX: BYPASS_PREF_MAX,
  TUNNEL_PREF_MIN: TUNNEL_PREF_MIN,
  TUNNEL_PREF_MAX: TUNNEL_PREF_MAX,
  parseRouteGet: parseRouteGet,
  usedPriorities: usedPriorities,
  choosePriority: choosePriority,
  parseLinkRoutes: parseLinkRoutes,
  PolicyRoutes: PolicyRoutes,
};
