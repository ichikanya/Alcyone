"use strict";
var crypto = require("crypto"),
  os = require("os"),
  fs = require("fs"),
  atomic = require("./atomic"),
  DEFAULT_IDENTITY_FILE =
    "linux" === process.platform
      ? "/var/lib/alcyone-shared/device-identity.json"
      : "";
function DeviceInfo(e) {
  ((e = e || {}),
    (this.service = e.service || null),
    (this.logger = e.logger || null),
    (this.identityFile = e.identityFile || DEFAULT_IDENTITY_FILE),
    (this._deviceData = null),
    (this._hwid = null));
}
function localeParts() {
  var e = String((process.env && process.env.LANG) || "en-US")
    .split(".")[0]
    .replace(/_/g, "-");
  return e || "en-US";
}
function validHwid(e) {
  return /^[a-f0-9]{32}$/i.test(String(e || ""));
}
function readPersistedHwid(e) {
  var r, t;
  if (!e) return "";
  try {
    r = atomic.readJson(e, null);
    t = r && r.hwid;
    return validHwid(t) ? String(t).toLowerCase() : "";
  } catch (e) {
    return "";
  }
}
function persistHwid(e, r, t) {
  if (!e || !validHwid(r)) return;
  try {
    atomic.writeJsonAtomic(e, { version: 1, hwid: String(r).toLowerCase() });
  } catch (e) {
    t && t.warn && t.warn("device identity persistence failed", { code: "STORE_WRITE_FAILED" });
  }
}
function deriveHwid(e) {
  return crypto
    .createHash("sha256")
    .update("alcyone:" + String(e || "alcyone-device"), "utf8")
    .digest("hex")
    .slice(0, 32);
}
((DeviceInfo.prototype._readPhysicalHardwareId = function () {
  var e,
    i,
    t = [
      "/sys/class/net/eth0/address",
      "/sys/class/net/wlan0/address",
      "/var/preferences/system",
      "/etc/hostname",
      "/sys/devices/virtual/dmi/id/product_uuid",
    ];
  for (e = 0; e < t.length; e++)
    try {
      if (
        fs.existsSync(t[e]) &&
        (i = String(fs.readFileSync(t[e], "utf8")).trim()) &&
        i.length >= 4 &&
        "127.0.0.1" !== i &&
        "localhost" !== i
      )
        return i;
    } catch (e) {}
  return "";
}),
  (DeviceInfo.prototype.getDeviceInfo = function (e) {
    if (this._deviceData && this._deviceData.ndid)
      return e(null, this._deviceData);
    var i = this;
    function t(e, t, s, r) {
      return (
        (i._deviceData = {
          modelName: t || "webOS TV",
          firmwareVersion: s || r || "unknown",
          osVersion: r || "unknown",
          sdkVersion: r || "",
          locale: localeParts(),
          ndid: e || i._readPhysicalHardwareId() || os.hostname() || "webos-tv",
        }),
        i._deviceData
      );
    }
    if (this.service && "function" == typeof this.service.call)
      try {
        return void this.service.call(
          "luna://com.webos.service.systemservice/queryDeviceInfo",
          {},
          function (s) {
            var r = (s && s.payload) || s || {};
            if (!1 !== r.returnValue && (r.ndid || r.serialNumber))
              return e(
                null,
                t(
                  r.ndid || r.serialNumber,
                  r.modelName,
                  r.firmwareVersion,
                  r.sdkVersion,
                ),
              );
            try {
              i.service.call(
                "luna://com.webos.service.tv.systemproperty/getSystemInfo",
                {
                  keys: [
                    "serialNumber",
                    "modelName",
                    "firmwareVersion",
                    "sdkVersion",
                  ],
                },
                function (s) {
                  var r = (s && s.payload) || s || {};
                  if (!1 !== r.returnValue && r.serialNumber)
                    return e(
                      null,
                      t(
                        r.serialNumber,
                        r.modelName,
                        r.firmwareVersion,
                        r.sdkVersion,
                      ),
                    );
                  i._fallbackDeviceInfo(e);
                },
              );
            } catch (t) {
              i._fallbackDeviceInfo(e);
            }
          },
        );
      } catch (e) {
        this.logger &&
          this.logger.warn("queryDeviceInfo failed", {
            detail: (e && e.message) || "error",
          });
      }
    this._fallbackDeviceInfo(e);
  }),
  (DeviceInfo.prototype._fallbackDeviceInfo = function (e) {
    var i = this._readPhysicalHardwareId() || os.hostname() || "webos-tv";
    ((this._deviceData = {
      modelName: "webOS TV",
      firmwareVersion: "unknown",
      osVersion: "unknown",
      sdkVersion: "",
      locale: localeParts(),
      ndid: i,
    }),
      e(null, this._deviceData));
  }),
  (DeviceInfo.prototype.getHwid = function (e) {
    if (this._hwid) return e(null, this._hwid);
    var persisted = readPersistedHwid(this.identityFile);
    if (persisted) return ((this._hwid = persisted), e(null, persisted));
    var i = this;
    this.getDeviceInfo(function (t, s) {
      var r =
          (s && s.ndid) ||
          i._readPhysicalHardwareId() ||
          os.hostname() ||
          "alcyone-device",
        a = deriveHwid(r);
      ((i._hwid = a), persistHwid(i.identityFile, i._hwid, i.logger), e(null, i._hwid));
    });
  }),
  (DeviceInfo.prototype.getHwidSync = function () {
    if (this._hwid) return this._hwid;
    var persisted = readPersistedHwid(this.identityFile);
    if (persisted) return ((this._hwid = persisted), persisted);
    var e =
        (this._deviceData && this._deviceData.ndid) ||
        this._readPhysicalHardwareId() ||
        os.hostname() ||
        "alcyone-device",
      i = deriveHwid(e);
    return (persistHwid(this.identityFile, i, this.logger), (this._hwid = i), this._hwid);
  }),
  (DeviceInfo.prototype.getDiagnostics = function () {
    return {
      deviceIdAvailable: !!(
        this._hwid ||
        (this._deviceData && this._deviceData.ndid)
      ),
      modelName: (this._deviceData && this._deviceData.modelName) || "webOS TV",
      osVersion: (this._deviceData && this._deviceData.osVersion) || "unknown",
      sdkVersion: (this._deviceData && this._deviceData.sdkVersion) || "",
      locale: (this._deviceData && this._deviceData.locale) || localeParts(),
      osName: "webOS",
    };
  }),
  (module.exports = DeviceInfo));
