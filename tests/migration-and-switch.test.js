'use strict';

/* Migration safety and server-switch behaviour.

   Covers the two things an upgrade must never get wrong: existing user
   profiles must survive migration untouched, and switching servers while
   connected must tear the old tunnel down before bringing a new one up. */

var os = require('os');
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var storeLib = require(path.join(ROOT, 'app', 'service', 'lib', 'store', 'profiles.js'));
var migrateLib = require(path.join(ROOT, 'app', 'service', 'lib', 'migrate.js'));
var apiLib = require(path.join(ROOT, 'app', 'service', 'lib', 'api.js'));
var loggerLib = require(path.join(ROOT, 'app', 'service', 'lib', 'logger.js'));
var pairingLib = require(path.join(ROOT, 'app', 'service', 'lib', 'pairing.js'));

var results = [];
function record(name, ok, detail) {
  results.push(ok);
  console.log((ok ? 'ok   - ' : 'FAIL - ') + name + (detail ? ' (' + detail + ')' : ''));
}

var quiet = { info: function () {}, warn: function () {}, error: function () {} };

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'alcyone-mig-')); }

function makePaths(dir) {
  return {
    appDir: path.join(dir, 'app'),
    dataDir: dir,
    storeFile: path.join(dir, 'profiles.json'),
    configFile: path.join(dir, 'core-config.json'),
    routeState: path.join(dir, 'route.state'),
    stateFile: path.join(dir, 'service-state.json'),
    serviceLog: path.join(dir, 'service.log'),
    tunnelLog: path.join(dir, 'tunnel.log')
  };
}

/* --- an existing 3.2.1-era store must survive migration --- */
var dir = tempDir();
var paths = makePaths(dir);
fs.mkdirSync(paths.appDir, { recursive: true });

var LEGACY = {
  profiles: [
    {
      id: 'pold1', protocol: 'vless', name: 'NL Reality', country: 'nl',
      link: 'vless://11111111-2222-3333-4444-555555555555@a.example.com:443?security=reality&pbk=K#NL',
      sourceType: 'single', addedAt: 1700000000000, updatedAt: 1700000000000
    },
    {
      id: 'pold2', protocol: 'trojan', name: 'DE Node',
      link: 'trojan://pw@b.example.com:443#DE',
      sourceType: 'subscription', subscriptionId: 'sold1', subscriptionName: 'My Sub',
      addedAt: 1700000000000, updatedAt: 1700000000000
    },
    {
      id: 'pold3', protocol: 'vless', name: 'Full XHTTP',
      link: 'vless://11111111-2222-3333-4444-555555555555@c.example.com:443?type=xhttp#Full',
      sourceType: 'single',
      fullConfig: { inbounds: [{ port: 1, protocol: 'socks' }], outbounds: [{ protocol: 'vless', tag: 'proxy', settings: { vnext: [{ address: 'c.example.com', port: 443, users: [{ id: 'u' }] }] }, streamSettings: { network: 'xhttp' } }] }
    }
  ],
  subscriptions: [
    { id: 'sold1', url: 'https://panel.example.com/sub/TOKEN', name: 'My Sub', count: 1, lastUpdate: 1700000000000 }
  ],
  activeId: 'pold2',
  lang: 'ru',
  updatedAt: 1700000000000
};
fs.writeFileSync(paths.storeFile, JSON.stringify(LEGACY, null, 2));

var migrator = new migrateLib.Migrator({
  paths: paths,
  edition: { id: 'xray', core: 'xray' },
  logger: quiet
});
migrator.run();

var store = new storeLib.ProfileStore({ file: paths.storeFile });
var after = store.read();

record('migration preserves every profile', after.profiles.length === 3, String(after.profiles.length));
record('migration preserves profile ids',
  ['pold1', 'pold2', 'pold3'].every(function (id) {
    return after.profiles.some(function (p) { return p.id === id; });
  }));
record('migration preserves the active selection', after.activeId === 'pold2');
record('migration preserves proxy links verbatim',
  after.profiles[0].link === LEGACY.profiles[0].link);
record('migration preserves the full Xray config',
  !!after.profiles[2].fullConfig &&
  after.profiles[2].fullConfig.outbounds[0].streamSettings.network === 'xhttp');
record('migration preserves subscriptions',
  after.subscriptions.length === 1 && after.subscriptions[0].url === LEGACY.subscriptions[0].url);
record('migration preserves the language setting', after.lang === 'ru');

/* Running it again must change nothing. */
var revisionBefore = JSON.stringify(store.read());
migrator.run();
migrator.run();
record('migration is idempotent across repeated runs', JSON.stringify(store.read()) === revisionBefore);
record('migration records its version',
  JSON.parse(fs.readFileSync(paths.stateFile, 'utf8')).migrationVersion === migrateLib.MIGRATION_VERSION);

/* A restart has no Supervisor child table. Recovery must find a current core
   by its kernel executable identity, never merely by a PID file or name. */
var procDir = path.join(dir, 'proc');
fs.mkdirSync(path.join(procDir, '700'), { recursive: true });
fs.mkdirSync(path.join(procDir, '701'), { recursive: true });
var killed = [];
var orphanMigrator = new migrateLib.Migrator({
  paths: paths,
  edition: { id: 'xray', core: 'xray' },
  logger: quiet,
  procRoot: procDir,
  procReadlink: function (target) {
    return /[\\/]700[\\/]exe$/.test(target)
      ? path.join(paths.dataDir, 'bin', 'xray')
      : '/usr/bin/unrelated-process';
  },
  kill: function (pid, signal) { killed.push(String(pid) + ':' + signal); }
});
record('restart recovery terminates only an orphaned core owned by this edition',
  orphanMigrator.stopOwnedCoreOrphans().join(',') === '700' && killed.join(',') === '700:SIGTERM');

/* A legacy bare-array store must be upgraded without loss. */
var dir2 = tempDir();
var paths2 = makePaths(dir2);
fs.mkdirSync(paths2.appDir, { recursive: true });
fs.writeFileSync(paths2.storeFile, JSON.stringify([
  { id: 'a1', link: 'vless://11111111-2222-3333-4444-555555555555@d.example.com:443#One', name: 'One' }
]));
new migrateLib.Migrator({ paths: paths2, edition: { id: 'xray', core: 'xray' }, logger: quiet }).run();
var upgraded = new storeLib.ProfileStore({ file: paths2.storeFile }).read();
record('a legacy array-format store is upgraded', upgraded.profiles.length === 1 && !!upgraded.activeId);

/* A corrupt store must not crash startup or lose the recoverable temp file. */
var dir3 = tempDir();
var paths3 = makePaths(dir3);
fs.mkdirSync(paths3.appDir, { recursive: true });
fs.writeFileSync(paths3.storeFile, '{ this is not json');
fs.writeFileSync(paths3.storeFile + '.tmp', JSON.stringify(LEGACY));
new migrateLib.Migrator({ paths: paths3, edition: { id: 'xray', core: 'xray' }, logger: quiet }).run();
var recovered = new storeLib.ProfileStore({ file: paths3.storeFile }).read();
record('an interrupted write is recovered from the temp file', recovered.profiles.length === 3);

/* --- server switch ordering --- */
var switchDir = tempDir();
var switchStore = new storeLib.ProfileStore({ file: path.join(switchDir, 'profiles.json') });
var first = switchStore.upsertManualProfile('vless://11111111-2222-3333-4444-555555555555@e.example.com:443#E', 'E');
var second = switchStore.upsertManualProfile('vless://11111111-2222-3333-4444-555555555555@f.example.com:443#F', 'F');

var sequence = [];
var vpnStub = {
  connected: true,
  status: function () {
    return { state: this.connected ? 'connected' : 'idle', connected: this.connected, connectedAt: 0,
      profileId: '', lastErrorCode: '', ownsTunnel: true, tunnelOwner: 'xray', routes: {} };
  },
  connect: function (cb) { sequence.push('connect'); this.connected = true; cb(null, { state: 'connected' }); },
  disconnect: function (cb) { sequence.push('disconnect'); this.connected = false; cb(null, { state: 'idle' }); }
};

var api = new apiLib.Api({
  edition: { id: 'xray', core: 'xray', coreLabel: 'XRay', title: 'T', version: '1', webPort: 8080 },
  logger: new loggerLib.Logger({ file: path.join(switchDir, 'log') }),
  store: switchStore,
  pairing: new pairingLib.PairingManager({ logger: quiet }),
  vpn: vpnStub,
  autostart: { isEnabled: function () { return false; }, set: function () { return true; } },
  diagnostics: { probeProfiles: function (cb) { cb(null, []); }, externalIp: function (cb) { cb(null, ''); } },
  importer: { listen: function (lan, cb) { cb(null, {}); } },
  localAddresses: function () { return []; }
});

api.selectProfile({ profileId: first.profile.id, reconnect: true }, function (error) {
  record('a connected server switch persists the selection first',
    !error && switchStore.read().activeId === first.profile.id, error ? error.code : '');
  record('a connected server switch issues exactly disconnect then connect',
    sequence.join(',') === 'disconnect,connect', sequence.join(','));

  sequence.length = 0;
  vpnStub.connected = false;
  api.selectProfile({ profileId: second.profile.id, reconnect: true }, function (error2) {
    record('selecting a server while disconnected does not start the VPN',
      !error2 && sequence.length === 0, sequence.join(','));

    sequence.length = 0;
    vpnStub.connected = true;
    api.selectProfile({ profileId: second.profile.id, reconnect: false }, function (error3) {
      record('selecting without reconnect leaves the tunnel untouched',
        !error3 && sequence.length === 0, sequence.join(','));

      var passed = results.filter(Boolean).length;
      console.log('\n' + passed + '/' + results.length + ' checks passed');
      if (passed !== results.length) process.exit(1);
    });
  });
});
