'use strict';

/* Edition configuration.

   The two editions differ only in identity, data location and core. Everything
   else in the service is shared, so edition-specific behaviour stays confined
   to this table and to the two config builders.

   The concrete values are written by the packager into edition.json next to
   the service; the defaults below keep the module usable in tests. */

var fs = require('fs');
var path = require('path');

var DEFAULTS = {
  xray: {
    id: 'xray',
    appId: 'com.alcyone.vpn',
    /* Luna forbids '-' in service names and requires the app id prefix. */
    serviceId: 'com.alcyone.vpn.service',
    core: 'xray',
    coreLabel: 'XRay',
    editionName: 'XRay Edition',
    title: 'Alcyone XRay',
    dataDir: '/var/lib/alcyone',
    autostartName: 'alcyone-vpn',
    webPort: 8080
  },
  'sing-box': {
    id: 'sing-box',
    appId: 'com.alcyone.vpn.singbox',
    serviceId: 'com.alcyone.vpn.singbox.service',
    core: 'sing-box',
    coreLabel: 'sing-box',
    editionName: 'sing-box Edition',
    title: 'Alcyone sing-box',
    dataDir: '/var/lib/alcyone-singbox',
    autostartName: 'alcyone-singbox-vpn',
    webPort: 8081
  }
};

function load(serviceDir) {
  /* edition.json is generated beside service.js.  When no directory is
     supplied, move one level up from this lib/ module to the service root. */
  var root = serviceDir || path.join(__dirname, '..');
  var configFile = path.join(root, 'edition.json');
  var raw = null, base;
  try {
    raw = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch (e) {
    raw = null;
  }
  base = (raw && DEFAULTS[raw.id]) || DEFAULTS.xray;
  if (!raw) return copy(base);
  return merge(copy(base), raw);
}

function copy(source) {
  var out = {}, key;
  for (key in source) if (Object.prototype.hasOwnProperty.call(source, key)) out[key] = source[key];
  return out;
}

function merge(target, extra) {
  var key;
  for (key in extra) if (Object.prototype.hasOwnProperty.call(extra, key)) target[key] = extra[key];
  return target;
}

/* All paths the service uses, derived from the edition's data directory. */
function paths(edition, appDir) {
  var dataDir = edition.dataDir;
  var defaultAppDir = path.resolve(__dirname, '..', '..');
  return {
    appDir: appDir || defaultAppDir,
    dataDir: dataDir,
    storeFile: dataDir + '/profiles.json',
    configFile: dataDir + '/core-config.json',
    routeState: dataDir + '/route.state',
    stateFile: dataDir + '/service-state.json',
    serviceLog: dataDir + '/service.log',
    tunnelLog: dataDir + '/tunnel.log'
  };
}

module.exports = {
  DEFAULTS: DEFAULTS,
  load: load,
  paths: paths
};
