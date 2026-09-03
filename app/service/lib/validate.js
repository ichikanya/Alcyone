"use strict";
var errors = require("./errors"),
  ssrf = require("./net/ssrf"),
  err = errors.err,
  MAX_LINK = 16e3,
  MAX_URL = 2048,
  MAX_NAME = 80,
  MAX_ID = 64;
function isPlainObject(r) {
  return (
    !!r &&
    "object" == typeof r &&
    "[object Array]" !== Object.prototype.toString.call(r)
  );
}
function requireObject(r) {
  if (!isPlainObject(r))
    throw err("INVALID_PARAMS", "payload must be an object");
  return r;
}
function rejectUnknown(r, e) {
  var t,
    o,
    n = {};
  for (t = 0; t < e.length; t++) n[e[t]] = !0;
  for (o in r)
    if (
      Object.prototype.hasOwnProperty.call(r, o) &&
      "$activity" !== o &&
      "subscribe" !== o &&
      "$sender" !== o &&
      !n[o]
    )
      throw err("UNKNOWN_FIELD", o);
  return r;
}
function optionalBoolean(r, e, t) {
  var o = r[e];
  if (null == o) return !!t;
  if ("boolean" != typeof o)
    throw err("INVALID_PARAMS", e + " must be a boolean");
  return o;
}
function profileId(r, e, t) {
  var o = r[e];
  if (null == o || "" === o) {
    if (t) throw err("MISSING_FIELD", e);
    return "";
  }
  if ("string" != typeof o)
    throw err("INVALID_PROFILE_ID", e + " must be a string");
  if (o.length > MAX_ID || !/^[A-Za-z0-9_-]+$/.test(o))
    throw err("INVALID_PROFILE_ID", e);
  return o;
}
function displayName(r, e) {
  var t = r[e];
  if (null == t) return "";
  if ("string" != typeof t)
    throw err("INVALID_PARAMS", e + " must be a string");
  return t
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, MAX_NAME);
}
function proxyLink(r, e) {
  var t = r[e];
  if ("string" != typeof t || !t) throw err("MISSING_FIELD", e);
  if ((t = t.replace(/[\u0000-\u001f\u007f]/g, "").trim()).length > MAX_LINK)
    throw err("INVALID_LINK", "link too long");
  if (!/^(vless|hy2|hysteria2|hysteria|trojan|vmess|ss|socks5?):\/\//i.test(t))
    throw err("INVALID_LINK", "unsupported scheme");
  return t;
}
function subscriptionUrl(r, e) {
  var t = r[e];
  if ("string" != typeof t || !t) throw err("MISSING_FIELD", e);
  if ((t = t.replace(/[\u0000-\u001f\u007f\s]/g, "").trim()).length > MAX_URL)
    throw err("INVALID_URL", "url too long");
  if (!/^https?:\/\//i.test(t))
    throw err("INVALID_URL", "only http and https are supported");
  if (/^https?:\/\/[^/?#]*@/i.test(t))
    throw err("URL_CREDENTIALS_REJECTED", "credentials in url");
  return t;
}
function optionalProviderHwid(r, e) {
  var t;
  if (!Object.prototype.hasOwnProperty.call(r, e) || null == r[e]) return null;
  if ("string" != typeof r[e])
    throw err("INVALID_PARAMS", e + " must be a string");
  t = r[e].trim();
  if (!t) return "";
  if (!/^[\x21-\x7e]{1,128}$/.test(t))
    throw err("INVALID_PARAMS", e + " contains invalid characters");
  return t;
}
function language(r, e) {
  var t = r[e];
  if ("ru" !== t && "en" !== t && "auto" !== t) throw err("INVALID_LANG", e);
  return t;
}
function dnsServer(r, e) {
  var t, o;
  if (!Object.prototype.hasOwnProperty.call(r, e))
    throw err("MISSING_FIELD", e);
  if (null == (t = r[e]) || ("string" == typeof t && !t.trim())) return null;
  if ("string" != typeof t)
    throw err("INVALID_DNS_SERVER", e + " must be a public ipv4 address");
  if (((t = t.trim()), !(o = ssrf.parseIpv4(t)) || ssrf.blockedIpv4Reason(o)))
    throw err("INVALID_DNS_SERVER", e + " must be a public ipv4 address");
  return o.join(".");
}
function importValue(r, e) {
  var t = r[e];
  if ("string" != typeof t || !t) throw err("MISSING_FIELD", e);
  if (!(t = t.replace(/[\u0000-\u001f\u007f]/g, "").trim()))
    throw err("MISSING_FIELD", e);
  if (t.length > MAX_LINK) throw err("INVALID_LINK", "value too long");
  return t;
}
module.exports = {
  MAX_LINK: MAX_LINK,
  MAX_URL: MAX_URL,
  MAX_NAME: MAX_NAME,
  isPlainObject: isPlainObject,
  requireObject: requireObject,
  rejectUnknown: rejectUnknown,
  optionalBoolean: optionalBoolean,
  profileId: profileId,
  displayName: displayName,
  proxyLink: proxyLink,
  subscriptionUrl: subscriptionUrl,
  optionalProviderHwid: optionalProviderHwid,
  language: language,
  dnsServer: dnsServer,
  importValue: importValue,
};
