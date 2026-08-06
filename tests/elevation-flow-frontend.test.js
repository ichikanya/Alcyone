'use strict';

/* Automatic startup elevation through the production TV frontend.

   The real-hardware sequence remains fixed: Homebrew Channel checkRoot,
   elevateService for one allowlisted service id, Alcyone restartService, then
   bounded getState polling until uid 0. */

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var source = fs.readFileSync(path.join(ROOT, 'app', 'app.js'), 'utf8')
  .replace('var ELEVATION_POLL_INTERVAL_MS = 1000;', 'var ELEVATION_POLL_INTERVAL_MS = 5;')
  .replace('var ELEVATION_POLL_LIMIT = 15;', 'var ELEVATION_POLL_LIMIT = 3;');

var results = [];
function record(name, ok, detail) {
  results.push(ok);
  console.log((ok ? 'ok   - ' : 'FAIL - ') + name + (detail ? ' (' + detail + ')' : ''));
}

function makeElement(id) {
  return {
    id: id, className: '', textContent: '', innerHTML: '', value: '', disabled: false,
    style: {}, childNodes: [],
    classList: { add: function () {}, remove: function () {}, contains: function () { return false; } },
    getAttribute: function () { return null; },
    setAttribute: function () {},
    removeAttribute: function () {},
    querySelectorAll: function () { return []; },
    querySelector: function () { return null; },
    contains: function () { return false; },
    getBoundingClientRect: function () { return { width: 10, height: 10, top: 0, bottom: 10, left: 0, right: 10 }; },
    focus: function () {},
    addEventListener: function () {},
    onclick: null
  };
}

var ELEMENT_IDS = ['stateText', 'hint', 'power', 'current', 'homeStage', 'serverList', 'count',
  'search', 'pingServers', 'refresh', 'subUpdate', 'log', 'logsRefresh', 'clearLog', 'freezeLog',
  'autostartState', 'langState', 'restartSub', 'checkIpSub', 'rowRestart', 'rowCheckIp',
  'rowLang', 'rowAutostart', 'rowPair', 'pairStart', 'pairStop', 'pairState', 'pairBox',
  'rowLogs', 'rowAbout', 'rowDonate', 'rowDonate2', 'editionBrand', 'editionVersion',
  'aboutVersion', 'webUrl', 'webPairInfo', 'webCode', 'webExpiry', 'webHint',
  'elevationBanner', 'elevationTitle', 'elevationText', 'grantPermissions'];

function editionFacts(name) {
  if (name === 'sing-box') {
    return {
      appId: 'com.alcyone.vpn.singbox',
      serviceId: 'com.alcyone.vpn.singbox.service',
      core: 'sing-box',
      coreLabel: 'sing-box',
      editionName: 'sing-box Edition',
      title: 'Alcyone sing-box',
      version: '4.0.4'
    };
  }
  return {
    appId: 'com.alcyone.vpn',
    serviceId: 'com.alcyone.vpn.service',
    core: 'xray',
    coreLabel: 'XRay',
    editionName: 'XRay Edition',
    title: 'Alcyone XRay',
    version: '4.0.4'
  };
}

function boot(scenario, done) {
  var elements = {};
  var listeners = {};
  var calls = [];
  var pollCount = 0;
  var edition = editionFacts(scenario.edition);

  ELEMENT_IDS.forEach(function (id) { elements[id] = makeElement(id); });

  function respond(uri, method, params, onSuccess, onFailure) {
    calls.push({ uri: uri, method: method, parameters: params });

    if (uri === 'luna://org.webosbrew.hbchannel.service') {
      if (method === 'checkRoot') {
        if (scenario.checkRootFails) return onFailure({ errorCode: 'SERVICE_UNAVAILABLE' });
        return onSuccess({ returnValue: !!scenario.homebrewRoot });
      }
      if (method === 'elevateService') {
        if (scenario.elevateFails) return onFailure({ errorCode: 'DENIED' });
        if (scenario.elevateDelayMs) {
          return setTimeout(function () { onSuccess({ returnValue: true }); }, scenario.elevateDelayMs);
        }
        return onSuccess({ returnValue: true });
      }
      return onFailure({ errorCode: 'UNKNOWN_METHOD' });
    }

    if (method === 'getProfiles') {
      return onSuccess({ returnValue: true, ok: true, profiles: [], subscriptions: [], activeId: null, lang: 'auto', revision: 'r1' });
    }
    if (method === 'getProfilesMeta') return onSuccess({ returnValue: true, ok: true, revision: 'r1' });
    if (method === 'getState') {
      var elevated = !!scenario.initialRoot ||
        (scenario.rootAfterPolls !== undefined &&
          pollCount >= scenario.rootAfterPolls && scenario.restarted);
      if (scenario.restarted) pollCount++;
      return onSuccess({
        returnValue: true, ok: true,
        edition: {
          id: edition.core, core: edition.core, coreLabel: edition.coreLabel,
          title: edition.title, version: edition.version
        },
        vpn: { state: 'idle', connected: false, connectedAt: 0, profileId: '', lastErrorCode: '', ownsTunnel: false, tunnelOwner: '' },
        lan: { pairingActive: false, secondsRemaining: 0, sessions: 0 },
        autostart: false,
        privilege: elevated
          ? { uid: 0, root: true, pid: 5890, appPayloadReadable: true, dataDirWritable: true, tunVisible: true }
          : {
              uid: 5033, root: !!scenario.rootTrueWithoutUid, pid: 5586,
              appPayloadReadable: true, dataDirWritable: false, tunVisible: false
            },
        health: { ok: elevated, code: elevated ? 'OK' : 'ELEVATION_REQUIRED' },
        revision: 'r1'
      });
    }
    if (method === 'restartService') {
      if (scenario.restartFails) return onFailure({ errorCode: 'RESTART_FAILED' });
      scenario.restarted = true;
      return onSuccess({ returnValue: true, ok: true, restarting: true });
    }
    if (method === 'startPairing') {
      return onSuccess({
        returnValue: true, ok: true, code: 'ABCD2345',
        expiresAt: Date.now() + 300000, port: 8080, addresses: ['192.168.1.50']
      });
    }
    return onSuccess({ returnValue: true, ok: true });
  }

  var windowStub = {
    ALCYONE_EDITION: edition,
    localStorage: { getItem: function () { return null; }, setItem: function () {} },
    addEventListener: function () {},
    webOS: {
      service: {
        request: function (uri, options) {
          respond(uri, options.method, options.parameters,
            options.onSuccess || function () {},
            options.onFailure || function () {});
        }
      }
    }
  };

  var documentStub = {
    hidden: false,
    activeElement: null,
    body: { classList: { add: function () {}, remove: function () {} } },
    getElementById: function (id) { return elements[id] || null; },
    querySelectorAll: function () { return []; },
    querySelector: function () { return null; },
    addEventListener: function (name, cb) { listeners[name] = cb; },
    removeEventListener: function () {}
  };

  var context = {
    window: windowStub, webOS: windowStub.webOS, document: documentStub,
    navigator: { language: 'en-US', languages: ['en-US'] },
    localStorage: windowStub.localStorage,
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    setInterval: function () { return 0; }, clearInterval: function () {},
    Date: Date, Math: Math, console: console, JSON: JSON, String: String,
    Number: Number, Array: Array, Object: Object, isFinite: isFinite,
    parseInt: parseInt, parseFloat: parseFloat,
    encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent
  };
  context.self = context;
  context.globalThis = context;

  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'app.js' });
  listeners.DOMContentLoaded();
  setTimeout(function () {
    done({
      elements: elements,
      calls: calls,
      listeners: listeners,
      scenario: scenario,
      edition: edition
    });
  }, scenario.observeAfterMs === undefined ? 20 : scenario.observeAfterMs);
}

function methods(run) {
  return run.calls.map(function (call) { return call.method; });
}

function countMethod(run, name) {
  return methods(run).filter(function (method) { return method === name; }).length;
}

function runHealthyScenario() {
  boot({ initialRoot: true }, function (healthy) {
    record('an Alcyone service already running as uid 0 does not query Homebrew',
      countMethod(healthy, 'checkRoot') === 0);
    record('an Alcyone service already running as uid 0 is never elevated or restarted',
      countMethod(healthy, 'elevateService') === 0 && countMethod(healthy, 'restartService') === 0);
    runAutomaticEdition('xray', function () {
      runAutomaticEdition('sing-box', runUnsupportedScenario);
    });
  });
}

function runAutomaticEdition(edition, next) {
  boot({
    edition: edition,
    homebrewRoot: true,
    rootAfterPolls: 1,
    rootTrueWithoutUid: true,
    elevateDelayMs: 30,
    observeAfterMs: 10
  }, function (automatic) {
    record(edition + ' checks Homebrew root exactly once before elevation',
      countMethod(automatic, 'checkRoot') === 1);
    record(edition + ' begins elevation without a button press',
      countMethod(automatic, 'elevateService') === 1);
    record(edition + ' shows a neutral temporary status',
      automatic.elements.elevationTitle.textContent === 'Preparing permissions' &&
      automatic.elements.elevationText.textContent.indexOf('Preparing permissions') >= 0,
      automatic.elements.elevationTitle.textContent);
    record(edition + ' hides the manual fallback during the automatic attempt',
      automatic.elements.grantPermissions.style.display === 'none');
    record(edition + ' disables VPN activation during the automatic attempt',
      automatic.elements.power.disabled === true);

    setTimeout(function () {
      var sequence = methods(automatic);
      var elevateIndex = sequence.indexOf('elevateService');
      var elevationSequence = sequence.slice(elevateIndex).filter(function (method) {
        return method === 'elevateService' || method === 'restartService' || method === 'getState';
      });
      var targetCall = automatic.calls.filter(function (call) {
        return call.method === 'elevateService';
      })[0];
      record(edition + ' runs elevateService before restartService',
        elevateIndex >= 0 &&
        elevationSequence[0] === 'elevateService' &&
        elevationSequence[1] === 'restartService' &&
        elevationSequence[2] === 'getState',
        elevationSequence.join(','));
      record(edition + ' elevates only its fixed edition service id',
        targetCall && targetCall.parameters.id === automatic.edition.serviceId &&
        Object.keys(targetCall.parameters).length === 1,
        targetCall && JSON.stringify(targetCall.parameters));
      record(edition + ' polls getState and finishes only after uid 0',
        countMethod(automatic, 'getState') >= 3 &&
        automatic.elements.elevationBanner.style.display === 'none');
      next();
    }, 80);
  });
}

function runUnsupportedScenario() {
  boot({ homebrewRoot: false }, function (unsupported) {
    record('Homebrew without root keeps the unsupported-environment message',
      unsupported.elements.elevationTitle.textContent === 'A rooted TV is required',
      unsupported.elements.elevationTitle.textContent);
    record('Homebrew without root never attempts elevation',
      countMethod(unsupported, 'elevateService') === 0 &&
      countMethod(unsupported, 'restartService') === 0);
    record('Homebrew without root offers no manual elevation fallback',
      unsupported.elements.grantPermissions.style.display === 'none');
    runUnknownScenario();
  });
}

function runUnknownScenario() {
  boot({ checkRootFails: true }, function (unknown) {
    record('an unavailable Homebrew root verdict remains neutral and does not elevate',
      unknown.elements.elevationTitle.textContent === 'Checking requirements' &&
      countMethod(unknown, 'elevateService') === 0,
      unknown.elements.elevationTitle.textContent);
    record('an unavailable Homebrew root verdict offers no fallback action',
      unknown.elements.grantPermissions.style.display === 'none');
    runFailureAndRetryScenario();
  });
}

function runFailureAndRetryScenario() {
  boot({ homebrewRoot: true, elevateFails: true }, function (failed) {
    record('a failed automatic attempt exposes the manual fallback',
      failed.elements.grantPermissions.style.display === '' &&
      failed.elements.grantPermissions.disabled === false &&
      failed.elements.grantPermissions.textContent === 'Grant permissions');
    record('a failed automatic attempt shows a concise fallback message',
      failed.elements.elevationText.textContent.indexOf('Could not grant permissions') >= 0 &&
      failed.elements.elevationText.textContent.indexOf('DENIED') < 0,
      failed.elements.elevationText.textContent);
    record('a failed elevateService never restarts Alcyone',
      countMethod(failed, 'restartService') === 0);

    failed.listeners.webOSRelaunch();
    setTimeout(function () {
      record('runtime refresh cannot loop the automatic attempt',
        countMethod(failed, 'elevateService') === 1,
        methods(failed).join(','));

      failed.scenario.elevateFails = false;
      failed.scenario.rootAfterPolls = 0;
      failed.elements.grantPermissions.onclick();
      setTimeout(function () {
        record('the manual fallback can retry after automatic failure',
          countMethod(failed, 'elevateService') === 2 &&
          countMethod(failed, 'restartService') === 1 &&
          failed.elements.elevationBanner.style.display === 'none');
        runBoundedTimeoutScenario();
      }, 50);
    }, 30);
  });
}

function runBoundedTimeoutScenario() {
  boot({ homebrewRoot: true, observeAfterMs: 60 }, function (timedOut) {
    record('automatic polling stops at the configured attempt bound',
      countMethod(timedOut, 'getState') === 4,
      String(countMethod(timedOut, 'getState')));
    record('a bounded polling timeout exposes the manual fallback',
      timedOut.elements.elevationText.textContent.indexOf('did not come back as root in time') >= 0 &&
      timedOut.elements.grantPermissions.style.display === '' &&
      timedOut.elements.grantPermissions.disabled === false,
      timedOut.elements.elevationText.textContent);
    finish();
  });
}

function finish() {
  var passed = results.filter(Boolean).length;
  console.log('\n' + passed + '/' + results.length + ' checks passed');
  if (passed !== results.length) process.exit(1);
}

runHealthyScenario();
