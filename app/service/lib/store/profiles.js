'use strict';

/* Profile and subscription store.

   This module owns the on-disk format. It is the only place that reads or
   writes profiles.json, and it is the boundary where secrets stop: callers
   that serve network clients use `sanitizedProfiles()` / `sanitizedStore()`,
   which return display metadata only.

   The full record (proxy link, UUID, password, subscription URL, full Xray
   config) never leaves this module except through `activeProfile()` and
   `profileById()`, which the VPN lifecycle uses locally to build a core config
   on disk. The LAN API and the Luna status methods never receive them. */

var atomic = require('../atomic');
var parsers = require('../proto/parsers');
var errors = require('../errors');
var err = errors.err;

var MAX_PROFILES = 4096;
var MAX_SUBSCRIPTIONS = 64;

function now() { return Date.now(); }
function isArray(value) { return Object.prototype.toString.call(value) === '[object Array]'; }

function validProfileId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 64 && /^[A-Za-z0-9_-]+$/.test(id);
}

function hasValidLink(profile) {
  if (!profile || typeof profile.link !== 'string') return false;
  try {
    parsers.validateLink(profile.link);
    return true;
  } catch (e) {
    return false;
  }
}

function hasValidFullConfig(profile) {
  var outbounds, i, protocol;
  if (!profile || !parsers.isFullXrayConfig(profile.fullConfig)) return false;
  outbounds = profile.fullConfig.outbounds;
  for (i = 0; i < outbounds.length; i++) {
    protocol = String((outbounds[i] && outbounds[i].protocol) || '').toLowerCase();
    if (/^(vless|trojan|vmess|shadowsocks|socks|hysteria)$/.test(protocol)) return true;
  }
  return false;
}

function makeId(prefix, randomBytes) {
  var rnd;
  try {
    rnd = randomBytes(4).toString('hex');
  } catch (e) {
    rnd = String(Math.floor(Math.random() * 0xffffffff).toString(16));
  }
  return (prefix || 'p') + now().toString(36) + rnd;
}

function defaultStore() {
  return { profiles: [], subscriptions: [], activeId: null, updatedAt: now() };
}

/* Accept both the legacy bare-array format and the current object format so
   existing user data keeps working after an upgrade. */
function normalize(parsed) {
  var i, found, country;
  if (isArray(parsed)) {
    parsed = { profiles: parsed, subscriptions: [], activeId: (parsed[0] && parsed[0].id) || null };
  }
  if (!parsed || typeof parsed !== 'object') parsed = defaultStore();
  if (!isArray(parsed.profiles)) parsed.profiles = [];
  if (!isArray(parsed.subscriptions)) parsed.subscriptions = [];
  if (parsed.lang !== 'ru' && parsed.lang !== 'en' && parsed.lang !== 'auto') delete parsed.lang;

  for (i = parsed.profiles.length - 1; i >= 0; i--) {
    if (!validProfileId(parsed.profiles[i] && parsed.profiles[i].id) ||
        (!hasValidLink(parsed.profiles[i]) && !hasValidFullConfig(parsed.profiles[i]))) {
      parsed.profiles.splice(i, 1);
    }
  }
  if (parsed.profiles.length > MAX_PROFILES) parsed.profiles.length = MAX_PROFILES;

  for (i = 0; i < parsed.profiles.length; i++) {
    if (!parsed.profiles[i].protocol) parsed.profiles[i].protocol = 'vless';
    if (!parsed.profiles[i].sourceType) {
      parsed.profiles[i].sourceType = parsed.profiles[i].subscriptionId ? 'subscription' : 'single';
    }
    if (parsed.profiles[i].name) parsed.profiles[i].name = parsers.cleanServerLabel(parsed.profiles[i].name);
    if (!parsed.profiles[i].country) {
      country = parsers.detectCountryForProfile(parsed.profiles[i]);
      if (country) parsed.profiles[i].country = country;
    }
  }
  for (i = parsed.subscriptions.length - 1; i >= 0; i--) {
    if (!parsed.subscriptions[i] || !parsed.subscriptions[i].id || !parsed.subscriptions[i].url) {
      parsed.subscriptions.splice(i, 1);
    } else {
      /* Preserve the legacy field for stored-data compatibility while making
         its effective value mandatory for every existing subscription. */
      parsed.subscriptions[i].compatMode = true;
    }
  }
  if (parsed.subscriptions.length > MAX_SUBSCRIPTIONS) parsed.subscriptions.length = MAX_SUBSCRIPTIONS;

  parsers.dedupeProfilesInStore(parsed);

  if (parsed.activeId) {
    found = false;
    for (i = 0; i < parsed.profiles.length; i++) if (parsed.profiles[i].id === parsed.activeId) found = true;
    if (!found) parsed.activeId = (parsed.profiles[0] && parsed.profiles[0].id) || null;
  }
  if (!parsed.activeId && parsed.profiles[0]) parsed.activeId = parsed.profiles[0].id;
  return parsed;
}

function ProfileStore(options) {
  options = options || {};
  this.file = options.file;
  this.logger = options.logger || null;
  this.randomBytes = options.randomBytes || require('crypto').randomBytes;
}

ProfileStore.prototype.read = function () {
  return normalize(atomic.readJson(this.file, null));
};

ProfileStore.prototype.write = function (store) {
  store.updatedAt = now();
  try {
    atomic.writeJsonAtomic(this.file, store, atomic.FILE_MODE);
  } catch (e) {
    throw err('STORE_WRITE_FAILED', 'cannot persist store');
  }
  return store;
};

ProfileStore.prototype.revision = function () {
  return atomic.fileRevision(this.file);
};

ProfileStore.prototype.newId = function (prefix) {
  return makeId(prefix, this.randomBytes);
};

/* --- reads that intentionally expose secrets, for local use only --- */

ProfileStore.prototype.profileById = function (id) {
  var store = this.read(), i;
  for (i = 0; i < store.profiles.length; i++) if (store.profiles[i].id === id) return store.profiles[i];
  return null;
};

ProfileStore.prototype.activeProfile = function () {
  var store = this.read(), i;
  if (!store.activeId) return null;
  for (i = 0; i < store.profiles.length; i++) if (store.profiles[i].id === store.activeId) return store.profiles[i];
  return null;
};

/* --- sanitized reads, safe for any network or UI consumer --- */

/* Display metadata only: opaque id, name, protocol, country, selection state.
   No link, uuid, password, subscription url, token or full config. */
function sanitizeProfile(profile, activeId) {
  var summaryText = '';
  try {
    var parsed = parsers.parseProxyLink(profile.link);
    /* Host and port are shown in the existing UI rows; they are not secrets,
       but credentials in the same URI are, so we rebuild the label instead of
       forwarding any part of the raw link. */
    summaryText = parsed.host + ':' + parsed.port;
  } catch (e) {
    summaryText = '';
  }
  return {
    id: String(profile.id),
    name: parsers.cleanServerLabel(profile.name || parsers.inferName(profile.link)),
    protocol: String(profile.protocol || 'vless').toLowerCase(),
    country: profile.country ? String(profile.country).toLowerCase() : '',
    endpoint: summaryText,
    transport: (function () {
      try {
        var p = parsers.parseProxyLink(profile.link).params || {};
        return String(p.type || p.network || 'tcp').toLowerCase();
      } catch (e2) { return ''; }
    })(),
    security: (function () {
      try {
        var p = parsers.parseProxyLink(profile.link).params || {};
        return String(p.security || 'none').toLowerCase();
      } catch (e3) { return ''; }
    })(),
    sourceType: profile.sourceType === 'subscription' ? 'subscription' : 'single',
    subscriptionId: profile.subscriptionId ? String(profile.subscriptionId) : '',
    subscriptionName: profile.subscriptionName ? parsers.cleanServerLabel(profile.subscriptionName) : '',
    hasFullConfig: !!profile.fullConfig,
    selected: profile.id === activeId
  };
}

/* Subscription display metadata. The URL itself is a bearer credential for
   most providers, so only a coarse host label is exposed. */
function sanitizeSubscription(subscription) {
  var host = '';
  try {
    var m = /^https?:\/\/([^/:?#]+)/i.exec(String(subscription.url || ''));
    host = m ? m[1] : '';
  } catch (e) {}
  return {
    id: String(subscription.id),
    name: parsers.cleanServerLabel(subscription.name || ''),
    host: host,
    count: parseInt(subscription.count, 10) || 0,
    lastUpdate: parseInt(subscription.lastUpdate, 10) || 0,
    hasError: !!subscription.error,
    compatMode: !!subscription.compatMode
  };
}

ProfileStore.prototype.sanitizedProfiles = function (store) {
  var source = store || this.read();
  var out = [], i;
  for (i = 0; i < source.profiles.length; i++) out.push(sanitizeProfile(source.profiles[i], source.activeId));
  return out;
};

ProfileStore.prototype.sanitizedSubscriptions = function (store) {
  var source = store || this.read();
  var out = [], i;
  for (i = 0; i < source.subscriptions.length; i++) out.push(sanitizeSubscription(source.subscriptions[i]));
  return out;
};

ProfileStore.prototype.sanitizedStore = function (store) {
  var source = store || this.read();
  return {
    profiles: this.sanitizedProfiles(source),
    subscriptions: this.sanitizedSubscriptions(source),
    activeId: source.activeId ? String(source.activeId) : null,
    lang: source.lang === 'ru' || source.lang === 'en' || source.lang === 'auto' ? source.lang : 'auto',
    revision: this.revision(),
    updatedAt: parseInt(source.updatedAt, 10) || 0
  };
};

/* --- mutations --- */

ProfileStore.prototype.setActive = function (id) {
  var store = this.read(), exists = false, i;
  for (i = 0; i < store.profiles.length; i++) if (store.profiles[i].id === id) exists = true;
  if (!exists) throw err('PROFILE_NOT_FOUND', 'unknown profile');
  store.activeId = id;
  return this.write(store);
};

ProfileStore.prototype.deleteProfile = function (id) {
  var store = this.read(), keep = [], found = false, i;
  for (i = 0; i < store.profiles.length; i++) {
    if (store.profiles[i].id === id) { found = true; continue; }
    keep.push(store.profiles[i]);
  }
  if (!found) throw err('PROFILE_NOT_FOUND', 'unknown profile');
  store.profiles = keep;
  if (store.activeId === id) store.activeId = (store.profiles[0] && store.profiles[0].id) || null;
  return this.write(store);
};

ProfileStore.prototype.deleteSubscription = function (id) {
  var store = this.read(), subs = [], profiles = [], found = false, i;
  for (i = 0; i < store.subscriptions.length; i++) {
    if (store.subscriptions[i].id === id) { found = true; continue; }
    subs.push(store.subscriptions[i]);
  }
  if (!found) throw err('SUBSCRIPTION_NOT_FOUND', 'unknown subscription');
  for (i = 0; i < store.profiles.length; i++) {
    if (store.profiles[i].subscriptionId !== id) profiles.push(store.profiles[i]);
  }
  store.subscriptions = subs;
  store.profiles = profiles;
  if (!store.profiles.length) store.activeId = null;
  else if (!this.hasProfile(store, store.activeId)) store.activeId = store.profiles[0].id;
  return this.write(store);
};

ProfileStore.prototype.hasProfile = function (store, id) {
  var i;
  if (!id) return false;
  for (i = 0; i < store.profiles.length; i++) if (store.profiles[i].id === id) return true;
  return false;
};

ProfileStore.prototype.setLanguage = function (lang) {
  var store = this.read();
  store.lang = lang;
  return this.write(store);
};

/* Add or update a manually entered profile. Returns the stored record. */
ProfileStore.prototype.upsertManualProfile = function (link, displayName) {
  var store = this.read();
  var key = parsers.profileKeyFromLink(link);
  var parsed = parsers.parseProxyLink(link);
  var profile = null, i, country;

  for (i = 0; i < store.profiles.length; i++) {
    if (!store.profiles[i].subscriptionId && parsers.profileKeyFromLink(store.profiles[i].link) === key) {
      profile = store.profiles[i];
      break;
    }
  }
  if (profile) {
    profile.name = parsers.cleanServerLabel(displayName || profile.name || parsers.inferName(link));
    profile.link = link;
    profile.protocol = parsed.protocol || profile.protocol || 'vless';
    profile.updatedAt = now();
  } else {
    if (store.profiles.length >= MAX_PROFILES) throw err('STORE_WRITE_FAILED', 'profile limit reached');
    profile = {
      id: this.newId('p'),
      protocol: parsed.protocol || 'vless',
      name: parsers.cleanServerLabel(displayName || parsers.inferName(link)),
      link: link,
      sourceType: 'single',
      addedAt: now(),
      updatedAt: now()
    };
    store.profiles.push(profile);
  }
  country = parsers.detectCountry((displayName || '') + ' ' + (parsed.name || ''));
  if (country) profile.country = country;
  store.activeId = profile.id;
  parsers.dedupeProfilesInStore(store);
  this.write(store);
  return { profile: profile, store: store };
};

/* Replace a subscription's profiles with a freshly imported set, preserving
   existing profile ids so the active selection survives an update. */
ProfileStore.prototype.applySubscription = function (subUrl, displayName, imported, headers, options) {
  var store = this.read();
  var subscription = null, keep = [], previousByKey = {}, importedKeys = {}, count = 0;
  var i, descriptor, parsed, key, previous, rawName, stored;

  headers = headers || {};
  options = options || {};
  for (i = 0; i < store.subscriptions.length; i++) {
    if (store.subscriptions[i].url === subUrl) subscription = store.subscriptions[i];
  }
  if (!subscription) {
    if (store.subscriptions.length >= MAX_SUBSCRIPTIONS) throw err('STORE_WRITE_FAILED', 'subscription limit reached');
    subscription = { id: this.newId('s'), url: subUrl, name: '', createdAt: now() };
    store.subscriptions.push(subscription);
  }
  subscription.name = displayName || parsers.profileTitleFromHeaders(headers, subscription.name || '');
  subscription.compatMode = true;
  subscription.lastUpdate = now();
  subscription.error = '';
  subscription.subscriptionUserinfo = headers['subscription-userinfo'] || '';

  for (i = 0; i < store.profiles.length; i++) {
    if (store.profiles[i].subscriptionId === subscription.id) {
      previousByKey[parsers.profileKey(store.profiles[i])] = store.profiles[i];
    } else {
      keep.push(store.profiles[i]);
    }
  }
  store.profiles = keep;

  for (i = 0; i < imported.length; i++) {
    descriptor = imported[i];
    parsed = parsers.parseProxyLink(descriptor.link);
    key = parsers.profileKey(descriptor);
    if (importedKeys[key]) continue;
    importedKeys[key] = true;
    count++;
    if (store.profiles.length >= MAX_PROFILES) break;
    previous = previousByKey[key] || null;
    rawName = parsers.cleanServerName(descriptor.name) ||
      parsers.importedProfileName(parsed, previous, subscription.name, count);
    stored = {
      id: (previous && previous.id) || this.newId('p'),
      protocol: descriptor.protocol || parsed.protocol || 'vless',
      name: parsers.cleanServerLabel(rawName),
      link: descriptor.link,
      sourceType: 'subscription',
      subscriptionId: subscription.id,
      subscriptionName: subscription.name,
      addedAt: (previous && previous.addedAt) || now(),
      updatedAt: now()
    };
    stored.country = parsers.detectCountry(rawName + ' ' + (parsed.name || '')) ||
      (previous && previous.country) || undefined;
    if (descriptor.sourceKey) stored.sourceKey = descriptor.sourceKey;
    if (descriptor.fullConfig) stored.fullConfig = descriptor.fullConfig;
    store.profiles.push(stored);
  }
  subscription.count = count;
  parsers.dedupeProfilesInStore(store);
  if (!this.hasProfile(store, store.activeId)) {
    store.activeId = (store.profiles[0] && store.profiles[0].id) || null;
  }
  this.write(store);
  return { subscription: subscription, count: count, store: store };
};

module.exports = {
  MAX_PROFILES: MAX_PROFILES,
  MAX_SUBSCRIPTIONS: MAX_SUBSCRIPTIONS,
  ProfileStore: ProfileStore,
  normalize: normalize,
  defaultStore: defaultStore,
  sanitizeProfile: sanitizeProfile,
  sanitizeSubscription: sanitizeSubscription
};
