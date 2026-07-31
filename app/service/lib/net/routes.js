'use strict';

/* TUN interface and routing manager.

   All network changes run through `/sbin/ip` (or `/usr/sbin/ip`) invoked with
   an argument array and no shell. Before touching anything we snapshot the
   original default route and persist it, so a crash, a failed start or a
   service restart can always restore the TV's connectivity.

   Rollback is idempotent: it may be called twice, or after a partial start,
   without producing errors. That is what keeps a failed VPN attempt from
   leaving the TV offline. */

var childProcess = require('child_process');
var fs = require('fs');
var atomic = require('../atomic');
var errors = require('../errors');
var err = errors.err;

var IP_CANDIDATES = ['/sbin/ip', '/usr/sbin/ip', '/bin/ip', '/usr/bin/ip'];

var TUN_NAME = 'tun0';
var TUN_IP = '198.18.0.1';
var TUN_GW = '198.18.0.2';
var TUN_MASK = '30';
var SPLIT_ROUTES = ['0.0.0.0/1', '128.0.0.0/1'];
var IPV6_BLOCK_ROUTES = ['::/1', '8000::/1'];
/* XRay sends these destinations through its freedom/direct outbound. They
   must therefore stay on the pre-VPN interface at the kernel layer too.
   Otherwise the split default captures the direct packet back into tun0,
   causing a recursive tun2socks -> SOCKS -> XRay -> tun0 loop.

   Loopback remains owned by the kernel's local table and IPv6 is deliberately
   blocked below because this product does not configure an IPv6 TUN address. */
var DIRECT_BYPASS_ROUTES = [
  /* `ip route get` rejects 0/8 destinations on older kernels even when the
     route is installed, so this reserved range is verified by exact listing. */
  { prefix: '0.0.0.0/8', probe: '', gateway: true },
  { prefix: '10.0.0.0/8', probe: '10.1.2.3', gateway: true },
  { prefix: '100.64.0.0/10', probe: '100.64.1.2', gateway: true },
  { prefix: '169.254.0.0/16', probe: '169.254.1.2', gateway: false },
  { prefix: '172.16.0.0/12', probe: '172.16.1.2', gateway: true },
  { prefix: '192.168.0.0/16', probe: '192.168.1.2', gateway: true },
  { prefix: '224.0.0.0/4', probe: '239.255.255.250', gateway: false },
  { prefix: '240.0.0.0/4', probe: '240.0.0.1', gateway: false }
];

function findIpBinary() {
  var supervisor = require('../supervisor');
  return supervisor.resolveExecutable(IP_CANDIDATES);
}

function RouteManager(options) {
  options = options || {};
  this.logger = options.logger;
  this.core = options.core === 'sing-box' ? 'sing-box' : 'xray';
  this.stateFile = options.stateFile;
  this.ipBinary = options.ipBinary || findIpBinary();
  this.procRouteFile = options.procRouteFile || '/proc/net/route';
  this.applied = false;
}

/* Run `ip` with a fixed argv. Returns {code, stdout}; never throws for a
   non-zero exit so cleanup can ignore "route already gone" cases. */
RouteManager.prototype.ip = function (args) {
  var result;
  if (!this.ipBinary) return { code: -1, stdout: '', missing: true };
  result = childProcess.spawnSync(this.ipBinary, args, {
    shell: false,
    encoding: 'utf8',
    timeout: 5000,
    env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin' }
  });
  return {
    code: typeof result.status === 'number' ? result.status : -1,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || '')
  };
};

RouteManager.prototype.available = function () { return !!this.ipBinary; };

/* Read the current default route so we can restore it verbatim later. */
RouteManager.prototype.readDefaultRoute = function () {
  var out = this.ip(['route', 'show', 'default']);
  var lines = out.stdout.split('\n');
  var i, line, gwMatch, devMatch;
  for (i = 0; i < lines.length; i++) {
    line = lines[i];
    if (!line || line.indexOf(TUN_NAME) >= 0) continue;
    gwMatch = /\bvia\s+(\S+)/.exec(line);
    devMatch = /\bdev\s+(\S+)/.exec(line);
    if (devMatch) {
      return { gateway: gwMatch ? gwMatch[1] : '', device: devMatch[1], raw: line.trim() };
    }
  }
  return this.readProcDefaultRoute();
};

function routeIdentity(route) {
  if (!route || !route.device) return '';
  return String(route.device) + '|' + String(route.gateway || '');
}

/* Read-only detection for a physical interface or gateway transition. */
RouteManager.prototype.networkChanged = function (state) {
  var original, current;
  state = state || this.loadState();
  original = state && state.original;
  if (!original || !original.device) return false;
  current = this.readDefaultRoute();
  return !current || routeIdentity(current) !== routeIdentity(original);
};

function decodeProcIpv4(value) {
  var out = [];
  var i;
  if (!/^[0-9A-Fa-f]{8}$/.test(String(value || ''))) return '';
  for (i = 6; i >= 0; i -= 2) out.push(parseInt(value.substr(i, 2), 16));
  return out.join('.');
}

/* `/proc/net/route` is the kernel-owned fallback when this low-resource
   runtime transiently fails to spawn `ip`. It is read-only and contains the
   same physical default facts needed for endpoint/direct bypass and rollback. */
RouteManager.prototype.readProcDefaultRoute = function () {
  var text, lines, i, fields, gateway, raw;
  try {
    text = fs.readFileSync(this.procRouteFile, 'utf8');
  } catch (readError) {
    return null;
  }
  lines = text.split('\n');
  for (i = 1; i < lines.length; i++) {
    fields = lines[i].trim().split(/\s+/);
    if (fields.length < 8 || fields[0] === TUN_NAME ||
        fields[1] !== '00000000' || fields[7] !== '00000000' ||
        (parseInt(fields[3], 16) & 1) === 0) continue;
    gateway = decodeProcIpv4(fields[2]);
    raw = 'default' + (gateway && gateway !== '0.0.0.0' ? ' via ' + gateway : '') +
      ' dev ' + fields[0];
    return {
      gateway: gateway === '0.0.0.0' ? '' : gateway,
      device: fields[0],
      raw: raw
    };
  }
  return null;
};

RouteManager.prototype.readHostRoute = function (address) {
  var out = this.ip(['route', 'show', 'exact', address]);
  var lines = out.stdout.split('\n');
  var i, line;
  for (i = 0; i < lines.length; i++) {
    line = lines[i].trim();
    if (line && line.indexOf(TUN_NAME) < 0) return line;
  }
  return '';
};

RouteManager.prototype.readIpv4Route = function (prefix) {
  var out = this.ip(['route', 'show', 'exact', prefix]);
  var lines = out.stdout.split('\n');
  var i, line;
  for (i = 0; i < lines.length; i++) {
    line = lines[i].trim();
    if (line) return line;
  }
  return '';
};

RouteManager.prototype.readIpv6Route = function (prefix) {
  var out = this.ip(['-6', 'route', 'show', 'exact', prefix]);
  var lines = out.stdout.split('\n');
  var i, line;
  for (i = 0; i < lines.length; i++) {
    line = lines[i].trim();
    if (line) return line;
  }
  return '';
};

/* Persist the pre-VPN state plus the server addresses we bypass, so a fresh
   service process after a crash can roll back correctly. */
RouteManager.prototype.saveState = function (serverAddresses) {
  var original = this.readDefaultRoute();
  var serverRoutes = {};
  var directRoutes = {};
  var ipv6Routes = {};
  var i, address, previous, route;
  if (!original || !original.device) {
    throw err('ROUTE_FAILED', 'physical default route unavailable');
  }
  serverAddresses = serverAddresses || [];
  for (i = 0; i < serverAddresses.length; i++) {
    address = serverAddresses[i];
    previous = this.readHostRoute(address);
    if (previous) serverRoutes[address] = previous;
  }
  for (i = 0; i < IPV6_BLOCK_ROUTES.length; i++) {
    previous = this.readIpv6Route(IPV6_BLOCK_ROUTES[i]);
    if (previous) ipv6Routes[IPV6_BLOCK_ROUTES[i]] = previous;
  }
  for (i = 0; i < DIRECT_BYPASS_ROUTES.length; i++) {
    route = DIRECT_BYPASS_ROUTES[i];
    previous = this.readIpv4Route(route.prefix);
    if (previous) directRoutes[route.prefix] = previous;
  }
  var state = {
    original: original,
    serverAddresses: serverAddresses,
    serverRoutes: serverRoutes,
    directRoutes: directRoutes,
    ipv6Routes: ipv6Routes,
    core: this.core,
    savedAt: Date.now()
  };
  atomic.writeJsonAtomic(this.stateFile, state);
  return state;
};

RouteManager.prototype.loadState = function () {
  return atomic.readJson(this.stateFile, null);
};

RouteManager.prototype.tunExists = function () {
  return this.ip(['link', 'show', TUN_NAME]).code === 0;
};

/* Keep traffic to the VPN server itself off the tunnel, or the tunnel would
   route its own transport back into itself. */
RouteManager.prototype.addServerBypass = function (address, original) {
  if (!address || !original) return;
  if (original.gateway) {
    this.ip(['route', 'replace', address, 'via', original.gateway, 'dev', original.device]);
  } else {
    this.ip(['route', 'replace', address, 'dev', original.device]);
  }
};

RouteManager.prototype.removeServerBypass = function (address, original, previousRoute) {
  if (!address) return;
  if (original && original.gateway) {
    this.ip(['route', 'del', address, 'via', original.gateway, 'dev', original.device]);
  }
  this.ip(['route', 'del', address]);
  if (previousRoute) {
    this.ip(['route', 'replace'].concat(String(previousRoute).split(/\s+/)));
  }
};

RouteManager.prototype.installDirectBypasses = function (state) {
  var original = state && state.original;
  var i, route, result, args;
  if (!original || !original.device) {
    throw err('ROUTE_FAILED', 'physical default route unavailable');
  }
  for (i = 0; i < DIRECT_BYPASS_ROUTES.length; i++) {
    route = DIRECT_BYPASS_ROUTES[i];
    args = ['route', 'replace', route.prefix];
    if (route.gateway && original.gateway) args = args.concat(['via', original.gateway]);
    args = args.concat(['dev', original.device]);
    result = this.ip(args);
    if (result.code !== 0) {
      if (this.logger) this.logger.warn('direct route install failed', {
        prefix: route.prefix,
        status: result.code
      });
      throw err('ROUTE_FAILED', 'direct route install failed');
    }
  }
};

RouteManager.prototype.directRoutesActive = function (state) {
  var original = state && state.original;
  var i, out, devMatch, route;
  if (!original || !original.device) return false;
  for (i = 0; i < DIRECT_BYPASS_ROUTES.length; i++) {
    route = DIRECT_BYPASS_ROUTES[i];
    out = route.probe
      ? this.ip(['route', 'get', route.probe])
      : this.ip(['route', 'show', 'exact', route.prefix]);
    devMatch = /\bdev\s+(\S+)/.exec(out.stdout);
    if (out.code !== 0 || !devMatch || devMatch[1] !== original.device ||
        out.stdout.indexOf(TUN_NAME) >= 0 || out.stdout.indexOf(TUN_GW) >= 0) {
      if (this.logger) this.logger.warn('direct route verification failed', {
        prefix: route.prefix,
        status: out.code
      });
      return false;
    }
  }
  return true;
};

/* Install the split-default routes that send all traffic into the tunnel. */
RouteManager.prototype.applyTunRoutes = function (state) {
  var original = state && state.original;
  var addresses = (state && state.serverAddresses) || [];
  var i;

  if (!this.available()) throw err('ROUTE_FAILED', 'ip binary unavailable');

  for (i = 0; i < SPLIT_ROUTES.length; i++) this.ip(['route', 'del', SPLIT_ROUTES[i]]);
  for (i = 0; i < IPV6_BLOCK_ROUTES.length; i++) {
    /* Neither edition configures an IPv6 TUN address. Block it while the VPN
       is active instead of silently leaking it through the physical link. */
    this.ip(['-6', 'route', 'replace', 'unreachable', IPV6_BLOCK_ROUTES[i], 'metric', '42760']);
  }

  if (this.core === 'sing-box') {
    /* sing-box creates and addresses tun0 itself; only add what is missing. */
    this.ip(['addr', 'add', TUN_IP + '/' + TUN_MASK, 'dev', TUN_NAME]);
  } else {
    this.ip(['addr', 'add', TUN_IP + '/' + TUN_MASK, 'peer', TUN_GW, 'dev', TUN_NAME]);
  }
  this.ip(['link', 'set', TUN_NAME, 'up']);

  for (i = 0; i < addresses.length; i++) this.addServerBypass(addresses[i], original);
  this.installDirectBypasses(state);

  for (i = 0; i < SPLIT_ROUTES.length; i++) {
    if (this.core === 'sing-box') {
      this.ip(['route', 'replace', SPLIT_ROUTES[i], 'dev', TUN_NAME]);
    } else {
      this.ip(['route', 'replace', SPLIT_ROUTES[i], 'via', TUN_GW, 'dev', TUN_NAME]);
    }
  }
  this.ip(['route', 'flush', 'cache']);
  if (!this.directRoutesActive(state)) {
    throw err('ROUTE_FAILED', 'direct routes captured by tunnel');
  }
  this.applied = true;
  if (this.logger) this.logger.info('tun routes applied', { core: this.core, bypass: addresses.length });
  return true;
};

/* Verify public traffic actually leaves through the tunnel. */
RouteManager.prototype.routeActive = function () {
  var probes = ['9.9.9.9', '1.0.0.1', '208.67.222.222'];
  var i, out;
  for (i = 0; i < probes.length; i++) {
    out = this.ip(['route', 'get', probes[i]]);
    if (out.code === 0 && (out.stdout.indexOf(TUN_NAME) >= 0 || out.stdout.indexOf(TUN_GW) >= 0)) return true;
  }
  return false;
};

/* Undo everything applyTunRoutes did and restore the original default route.
   Safe to call repeatedly and safe to call when nothing was applied. */
RouteManager.prototype.rollback = function (options) {
  options = options || {};
  var state = this.loadState();
  var original = state && state.original;
  var addresses = (state && state.serverAddresses) || [];
  var serverRoutes = (state && state.serverRoutes) || {};
  var directRoutes = state && state.directRoutes;
  var ipv6Routes = (state && state.ipv6Routes) || {};
  var i, route;

  if (!this.available()) return false;

  for (i = 0; i < SPLIT_ROUTES.length; i++) this.ip(['route', 'del', SPLIT_ROUTES[i]]);
  for (i = 0; i < IPV6_BLOCK_ROUTES.length; i++) {
    this.ip(['-6', 'route', 'del', 'unreachable', IPV6_BLOCK_ROUTES[i], 'metric', '42760']);
    if (!options.preserveCurrentNetwork && ipv6Routes[IPV6_BLOCK_ROUTES[i]]) {
      this.ip(['-6', 'route', 'replace'].concat(
        String(ipv6Routes[IPV6_BLOCK_ROUTES[i]]).split(/\s+/)
      ));
    }
  }
  if (!options.preserveCurrentNetwork) {
    for (i = 0; i < addresses.length; i++) {
      this.removeServerBypass(addresses[i], original, serverRoutes[addresses[i]] || '');
    }
  }
  /* Only remove this package's direct routes when the state explicitly
     contains their snapshot. Older state files must not cause unrelated
     physical routes to be deleted during upgrade recovery. */
  if (directRoutes && !options.preserveCurrentNetwork) {
    for (i = 0; i < DIRECT_BYPASS_ROUTES.length; i++) {
      route = DIRECT_BYPASS_ROUTES[i];
      this.ip(['route', 'del', route.prefix]);
      if (directRoutes[route.prefix]) {
        this.ip(['route', 'replace'].concat(
          String(directRoutes[route.prefix]).split(/\s+/)
        ));
      }
    }
  }

  this.ip(['route', 'flush', 'dev', TUN_NAME]);
  this.ip(['link', 'set', TUN_NAME, 'down']);
  this.ip(['addr', 'flush', 'dev', TUN_NAME]);
  this.ip(['link', 'delete', TUN_NAME]);

  /* On a physical network transition, the current network manager route is
     authoritative; restoring the old gateway/device could strand the TV. */
  if (!options.preserveCurrentNetwork && original && original.device) {
    if (this.readDefaultRoute() === null) {
      if (original.gateway) {
        this.ip(['route', 'replace', 'default', 'via', original.gateway, 'dev', original.device]);
      } else {
        this.ip(['route', 'replace', 'default', 'dev', original.device]);
      }
    }
  }
  this.ip(['route', 'flush', 'cache']);
  this.applied = false;
  atomic.removeQuiet(this.stateFile);
  if (this.logger) this.logger.info('routes rolled back');
  return true;
};

RouteManager.prototype.diagnostics = function () {
  var state = this.loadState();
  var publicRoute = this.ip(['route', 'get', '9.9.9.9']);
  return {
    core: this.core,
    ipAvailable: this.available(),
    tunPresent: this.tunExists(),
    routeActive: this.routeActive(),
    directBypassActive: this.directRoutesActive(state),
    originalDevice: (state && state.original && state.original.device) || '',
    bypassCount: (state && state.serverAddresses && state.serverAddresses.length) || 0,
    ipv6Blocked: this.ip(['-6', 'route', 'show', IPV6_BLOCK_ROUTES[0]]).stdout.indexOf('unreachable') >= 0,
    publicRouteUsesTun: publicRoute.stdout.indexOf(TUN_NAME) >= 0 || publicRoute.stdout.indexOf(TUN_GW) >= 0
  };
};

module.exports = {
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
  findIpBinary: findIpBinary
};
