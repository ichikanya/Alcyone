"use strict";

/* Boot ordering regressions. The Homebrew init hook must survive a Luna
   service that registers late, and the service-side retry scheduler must be
   bounded, coalesced and safe to stop. */

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");

var ROOT = path.join(__dirname, "..");
var autostartLib = require(
  path.join(ROOT, "app", "service", "lib", "autostart.js"),
);
var apiLib = require(path.join(ROOT, "app", "service", "lib", "api.js"));

var results = [];
function record(name, ok, detail) {
  results.push(!!ok);
  console.log(
    (ok ? "ok   - " : "FAIL - ") + name + (detail ? " (" + detail + ")" : ""),
  );
}
function check(name, fn) {
  try {
    fn();
    record(name, true);
  } catch (error) {
    record(
      name,
      false,
      (error && (error.code || error.message)) || String(error),
    );
  }
}

var quiet = {
  info: function () {},
  warn: function () {},
  error: function () {},
};

function edition(id, appId, serviceId, autostartName) {
  return {
    id: id,
    appId: appId,
    serviceId: serviceId,
    autostartName: autostartName,
  };
}

var EDITIONS = [
  edition("xray", "com.alcyone.vpn", "com.alcyone.vpn.service", "alcyone-vpn"),
  edition(
    "sing-box",
    "com.alcyone.vpn.singbox",
    "com.alcyone.vpn.singbox.service",
    "alcyone-singbox-vpn",
  ),
];

EDITIONS.forEach(function (spec) {
  check(
    spec.id +
      " legacy one-shot hook is atomically replaced by the bounded worker",
    function () {
      var dir = fs.mkdtempSync(path.join(os.tmpdir(), "alcyone-autostart-"));
      var hook = path.join(dir, spec.autostartName);
      var autostart = new autostartLib.Autostart({
        edition: spec,
        logger: quiet,
        initDir: dir,
      });
      fs.writeFileSync(
        hook,
        "#!/bin/sh\nluna-send -a old.app -n 1 luna://old.service/autostart {}\n",
      );
      assert.strictEqual(autostart.isEnabled(), false);
      assert.strictEqual(autostart.repairLegacy(), true);
      assert.strictEqual(fs.readFileSync(hook, "utf8"), autostart.script());
      assert.strictEqual(autostart.isEnabled(), true);
    },
  );

  check(
    spec.id +
      " worker has a fixed sender, acknowledged handoff, and background output redirection",
    function () {
      var dir = fs.mkdtempSync(
        path.join(os.tmpdir(), "alcyone-autostart-script-"),
      );
      var script = new autostartLib.Autostart({
        edition: spec,
        logger: quiet,
        initDir: dir,
      }).script();
      assert.ok(
        script.indexOf(
          "luna-send -a " +
            spec.appId +
            " -n 1 -f luna://" +
            spec.serviceId +
            "/autostart '{}'",
        ) >= 0,
        script,
      );
      assert.ok(script.indexOf("while :; do") >= 0);
      assert.ok(script.indexOf("sleep 10") >= 0);
      assert.ok(script.indexOf("compact_response=") >= 0);
      assert.ok(script.indexOf("*'\"accepted\":true'*) exit 0 ;;") >= 0);
      assert.ok(script.indexOf("*'\"returnValue\":true'*) exit 0 ;;") < 0);
      assert.ok(script.indexOf(") >/dev/null 2>&1 &") >= 0);
      assert.ok(
        script.indexOf(spec.autostartName) < 0,
        "the hook script may not interpolate a hook filename or user data",
      );
    },
  );
});

function fakeTimers() {
  var pending = [];
  return {
    pending: pending,
    setTimeout: function (fn, delay) {
      var timer = { fn: fn, delay: delay, cancelled: false };
      pending.push(timer);
      return timer;
    },
    clearTimeout: function (timer) {
      if (timer) timer.cancelled = true;
    },
    runOne: function () {
      var timer;
      while (pending.length) {
        timer = pending.shift();
        if (timer.cancelled) continue;
        timer.fn();
        return timer.delay;
      }
      return null;
    },
    activeCount: function () {
      return pending.filter(function (timer) {
        return !timer.cancelled;
      }).length;
    },
  };
}

function schedulerFixture(options) {
  options = options || {};
  var timers = fakeTimers();
  var state = {
    enabled: options.enabled === undefined ? true : options.enabled,
    connected: !!options.connected,
    owner: options.owner || "",
    profile: options.profile === undefined ? {} : options.profile,
    healthCode: options.healthCode || "OK",
    busy: !!options.busy,
    errors: (options.errors || []).slice(0),
    connectCalls: 0,
    logErrors: [],
  };
  var ctx = {
    edition: { id: "xray" },
    autostart: {
      isEnabled: function () {
        return state.enabled;
      },
      set: function (enabled) {
        state.enabled = enabled;
      },
    },
    store: {
      activeProfile: function () {
        return state.profile;
      },
    },
    vpn: {
      status: function () {
        return { connected: state.connected, connectionOwner: state.owner };
      },
      isBusy: function () {
        return state.busy;
      },
      healthSummary: function () {
        return { code: state.healthCode };
      },
      connect: function (callback) {
        var error;
        state.connectCalls++;
        error = state.errors.length ? state.errors.shift() : null;
        if (!error) state.connected = true;
        callback(error);
      },
    },
    logger: {
      error: function (message, meta) {
        state.logErrors.push({ message: message, meta: meta });
      },
    },
  };
  return {
    state: state,
    timers: timers,
    api: new apiLib.Api(ctx, {
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      autostartInitialDelay: 5,
      autostartRetryDelay: 10,
      autostartMaxAttempts:
        options.maxAttempts === undefined ? 3 : options.maxAttempts,
    }),
  };
}

check(
  "duplicate autostart triggers coalesce into one active scheduler",
  function () {
    var fixture = schedulerFixture();
    var first, second;
    fixture.api.autostartTrigger({}, function (error, result) {
      first = { error: error, result: result };
    });
    fixture.api.autostartTrigger({}, function (error, result) {
      second = { error: error, result: result };
    });
    assert.strictEqual(first.error, null);
    assert.strictEqual(first.result.queued, true);
    assert.strictEqual(second.error, null);
    assert.strictEqual(second.result.queued, false);
    assert.strictEqual(fixture.timers.activeCount(), 1);
    assert.strictEqual(fixture.timers.runOne(), 5);
    assert.strictEqual(fixture.state.connectCalls, 1);
  },
);

check(
  "queued autostart acknowledgement is not reported as started",
  function () {
    var fixture = schedulerFixture();
    var queued;
    fixture.api.autostartTrigger({}, function (error, result) {
      queued = { error: error, result: result };
    });
    assert.strictEqual(queued.error, null);
    assert.strictEqual(queued.result.started, false);
    assert.strictEqual(queued.result.queued, true);
    fixture.state.connected = true;
    fixture.api.autostartTrigger({}, function (error, result) {
      assert.strictEqual(error, null);
      assert.strictEqual(result.started, true);
      assert.strictEqual(result.queued, false);
    });
  },
);

check(
  "delayed service availability retries after 10 seconds and then stops on success",
  function () {
    var fixture = schedulerFixture({
      errors: [{ code: "SERVICE_UNAVAILABLE" }, null],
    });
    assert.strictEqual(fixture.api.scheduleAutostart(), true);
    assert.strictEqual(fixture.timers.runOne(), 5);
    assert.strictEqual(fixture.state.connectCalls, 1);
    assert.strictEqual(fixture.timers.runOne(), 10);
    assert.strictEqual(fixture.state.connectCalls, 2);
    assert.strictEqual(fixture.api.autostartActive, false);
    assert.strictEqual(fixture.timers.activeCount(), 0);
  },
);

check(
  "disabled autostart stops before the first connection attempt",
  function () {
    var fixture = schedulerFixture();
    assert.strictEqual(fixture.api.scheduleAutostart(), true);
    fixture.state.enabled = false;
    assert.strictEqual(fixture.timers.runOne(), 5);
    assert.strictEqual(fixture.state.connectCalls, 0);
    assert.strictEqual(fixture.api.autostartActive, false);
  },
);

check("turning autostart off cancels a queued retry immediately", function () {
  var fixture = schedulerFixture();
  var result;
  assert.strictEqual(fixture.api.scheduleAutostart(), true);
  fixture.api.setAutostart({ enabled: false }, function (error, value) {
    result = { error: error, value: value };
  });
  assert.strictEqual(result.error, null);
  assert.strictEqual(result.value.enabled, false);
  assert.strictEqual(fixture.timers.activeCount(), 0);
  assert.strictEqual(fixture.api.autostartActive, false);
  assert.strictEqual(fixture.state.connectCalls, 0);
});

check(
  "no profile, another edition, and shared-permission repair failure stop immediately",
  function () {
    [
      schedulerFixture({ profile: null }),
      schedulerFixture({ owner: "sing-box" }),
      schedulerFixture({ healthCode: "SHARED_DIRECTORY_REPAIR_FAILED" }),
    ].forEach(function (fixture) {
      assert.strictEqual(fixture.api.scheduleAutostart(), false);
      assert.strictEqual(fixture.state.connectCalls, 0);
      assert.strictEqual(fixture.timers.activeCount(), 0);
      assert.strictEqual(fixture.api.autostartActive, false);
    });
  },
);

check(
  "terminal connection errors do not schedule another attempt",
  function () {
    [
      "NO_ACTIVE_PROFILE",
      "TUNNEL_OWNED_BY_OTHER_EDITION",
      "CONNECTION_OWNED_BY_OTHER_EDITION",
      "SHARED_DIRECTORY_REPAIR_FAILED",
    ].forEach(function (code) {
      var fixture = schedulerFixture({ errors: [{ code: code }] });
      fixture.api.scheduleAutostart();
      fixture.timers.runOne();
      assert.strictEqual(fixture.state.connectCalls, 1, code);
      assert.strictEqual(fixture.timers.activeCount(), 0, code);
      assert.strictEqual(fixture.api.autostartActive, false, code);
    });
  },
);

check(
  "retry exhaustion makes exactly the configured maximum connection attempts",
  function () {
    var fixture = schedulerFixture({
      maxAttempts: 3,
      errors: [
        { code: "NETWORK_ERROR" },
        { code: "NETWORK_ERROR" },
        { code: "NETWORK_ERROR" },
      ],
    });
    fixture.api.scheduleAutostart();
    assert.strictEqual(fixture.timers.runOne(), 5);
    assert.strictEqual(fixture.timers.runOne(), 10);
    assert.strictEqual(fixture.timers.runOne(), 10);
    assert.strictEqual(fixture.state.connectCalls, 3);
    assert.strictEqual(fixture.timers.activeCount(), 0);
    assert.strictEqual(fixture.state.logErrors.length, 1);
    assert.strictEqual(fixture.api.autostartActive, false);
  },
);

var passed = results.filter(Boolean).length;
console.log("\n" + passed + "/" + results.length + " checks passed");
if (passed !== results.length) process.exit(1);
