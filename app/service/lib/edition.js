"use strict";
var fs = require("fs"),
  path = require("path"),
  DEFAULTS = {
    xray: {
      id: "xray",
      appId: "com.alcyone.vpn",
      serviceId: "com.alcyone.vpn.service",
      core: "xray",
      coreLabel: "XRay",
      editionName: "XRay Edition",
      title: "Alcyone XRay",
      dataDir: "/var/lib/alcyone",
      autostartName: "alcyone-vpn",
      webPort: 8080,
    },
    "sing-box": {
      id: "sing-box",
      appId: "com.alcyone.vpn.singbox",
      serviceId: "com.alcyone.vpn.singbox.service",
      core: "sing-box",
      coreLabel: "sing-box",
      editionName: "sing-box Edition",
      title: "Alcyone sing-box",
      dataDir: "/var/lib/alcyone-singbox",
      autostartName: "alcyone-singbox-vpn",
      webPort: 8081,
    },
  };
function load(e) {
  var o,
    a = e || path.join(__dirname, ".."),
    r = path.join(a, "edition.json"),
    n = null;
  try {
    n = JSON.parse(fs.readFileSync(r, "utf8"));
  } catch (e) {
    n = null;
  }
  return (
    (o = (n && DEFAULTS[n.id]) || DEFAULTS.xray),
    n ? merge(copy(o), n) : copy(o)
  );
}
function copy(e) {
  var o,
    a = {};
  for (o in e) Object.prototype.hasOwnProperty.call(e, o) && (a[o] = e[o]);
  return a;
}
function merge(e, o) {
  var a;
  for (a in o) Object.prototype.hasOwnProperty.call(o, a) && (e[a] = o[a]);
  return e;
}
function paths(e, o) {
  var a = e.dataDir,
    r = path.resolve(__dirname, "..", ".."),
    i = o || r;
  return {
    appDir: i,
    dataDir: a,
    storeFile: a + "/profiles.json",
    configFile: a + "/core-config.json",
    routeState: a + "/route.state",
    stateFile: a + "/service-state.json",
    serviceLog: a + "/service.log",
    tunnelLog: a + "/tunnel.log",
    launcher: i + "/bin/alcyone-exec",
  };
}
module.exports = { DEFAULTS: DEFAULTS, load: load, paths: paths };
