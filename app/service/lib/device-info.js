'use strict';

/* Device information and Hardware Identifier (HWID) derivation.

   Obtains TV properties via webOS Luna APIs and physical hardware inspection
   when available, deriving a deterministic hardware identifier for provider
   compatibility mode.

   Written to ES5 for Node.js 0.12 on webOS 4+. */

var crypto = require('crypto');
var os = require('os');
var fs = require('fs');

function DeviceInfo(options) {
  options = options || {};
  this.service = options.service || null;
  this.logger = options.logger || null;
  this._deviceData = null;
  this._hwid = null;
}

DeviceInfo.prototype._readPhysicalHardwareId = function () {
  var sysPaths = [
    '/sys/class/net/eth0/address',
    '/sys/class/net/wlan0/address',
    '/var/preferences/system',
    '/etc/hostname',
    '/sys/devices/virtual/dmi/id/product_uuid'
  ], i, content;

  for (i = 0; i < sysPaths.length; i++) {
    try {
      if (fs.existsSync(sysPaths[i])) {
        content = String(fs.readFileSync(sysPaths[i], 'utf8')).trim();
        if (content && content.length >= 4 && content !== '127.0.0.1' && content !== 'localhost') {
          return content;
        }
      }
    } catch (e) {}
  }
  return '';
};

DeviceInfo.prototype.getDeviceInfo = function (callback) {
  if (this._deviceData && this._deviceData.ndid) {
    return callback(null, this._deviceData);
  }
  var self = this;

  function setDeviceData(rawId, model, fw, sdk) {
    self._deviceData = {
      modelName: model || 'webOS TV',
      firmwareVersion: fw || sdk || '4.0.0',
      osVersion: sdk || '4.0.0',
      ndid: rawId || self._readPhysicalHardwareId() || os.hostname() || 'webos-tv'
    };
    return self._deviceData;
  }

  if (this.service && typeof this.service.call === 'function') {
    try {
      this.service.call('luna://com.webos.service.systemservice/queryDeviceInfo', {}, function (response) {
        var payload = (response && response.payload) || response || {};
        if (payload.returnValue !== false && (payload.ndid || payload.serialNumber)) {
          return callback(null, setDeviceData(payload.ndid || payload.serialNumber, payload.modelName, payload.firmwareVersion, payload.sdkVersion));
        }
        /* Fallback Luna method 2: systemproperty */
        try {
          self.service.call('luna://com.webos.service.tv.systemproperty/getSystemInfo', { keys: ['serialNumber', 'modelName', 'firmwareVersion', 'sdkVersion'] }, function (res2) {
            var p2 = (res2 && res2.payload) || res2 || {};
            if (p2.returnValue !== false && p2.serialNumber) {
              return callback(null, setDeviceData(p2.serialNumber, p2.modelName, p2.firmwareVersion, p2.sdkVersion));
            }
            self._fallbackDeviceInfo(callback);
          });
        } catch (e2) {
          self._fallbackDeviceInfo(callback);
        }
      });
      return;
    } catch (e) {
      if (this.logger) this.logger.warn('queryDeviceInfo failed', { detail: (e && e.message) || 'error' });
    }
  }
  this._fallbackDeviceInfo(callback);
};

DeviceInfo.prototype._fallbackDeviceInfo = function (callback) {
  var rawId = this._readPhysicalHardwareId() || os.hostname() || 'webos-tv';
  this._deviceData = {
    modelName: 'webOS TV',
    firmwareVersion: '4.0.0',
    osVersion: '4.0.0',
    ndid: rawId
  };
  callback(null, this._deviceData);
};

DeviceInfo.prototype.getHwid = function (callback) {
  if (this._hwid) {
    return callback(null, this._hwid);
  }
  var self = this;
  this.getDeviceInfo(function (err, info) {
    var rawId = (info && info.ndid) || self._readPhysicalHardwareId() || os.hostname() || 'alcyone-device';
    var hash = crypto.createHash('sha256').update('alcyone:' + rawId, 'utf8').digest('hex');
    self._hwid = hash.slice(0, 32);
    callback(null, self._hwid);
  });
};

DeviceInfo.prototype.getHwidSync = function () {
  if (this._hwid) return this._hwid;
  var rawId = (this._deviceData && this._deviceData.ndid) || this._readPhysicalHardwareId() || os.hostname() || 'alcyone-device';
  var hash = crypto.createHash('sha256').update('alcyone:' + rawId, 'utf8').digest('hex');
  this._hwid = hash.slice(0, 32);
  return this._hwid;
};

DeviceInfo.prototype.getDiagnostics = function () {
  return {
    deviceIdAvailable: !!(this._hwid || (this._deviceData && this._deviceData.ndid)),
    modelName: (this._deviceData && this._deviceData.modelName) || 'webOS TV',
    osVersion: (this._deviceData && this._deviceData.osVersion) || '4.0.0'
  };
};

module.exports = DeviceInfo;
