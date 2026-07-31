'use strict';

/* Structured error codes shared by the Luna service and the LAN importer.
   Backend code never emits localized text: the frontend maps codes to
   Russian/English strings, and diagnostic logs stay concise English. */

var CODES = {
  OK: 'OK',

  /* input validation */
  INVALID_PARAMS: 'INVALID_PARAMS',
  UNKNOWN_FIELD: 'UNKNOWN_FIELD',
  MISSING_FIELD: 'MISSING_FIELD',
  INVALID_PROFILE_ID: 'INVALID_PROFILE_ID',
  INVALID_LINK: 'INVALID_LINK',
  INVALID_URL: 'INVALID_URL',
  INVALID_LANG: 'INVALID_LANG',

  /* store */
  PROFILE_NOT_FOUND: 'PROFILE_NOT_FOUND',
  SUBSCRIPTION_NOT_FOUND: 'SUBSCRIPTION_NOT_FOUND',
  STORE_WRITE_FAILED: 'STORE_WRITE_FAILED',
  STORE_READ_FAILED: 'STORE_READ_FAILED',

  /* lifecycle */
  ALREADY_RUNNING: 'ALREADY_RUNNING',
  NOT_RUNNING: 'NOT_RUNNING',
  BUSY: 'BUSY',
  CANCELLED: 'CANCELLED',
  ILLEGAL_STATE: 'ILLEGAL_STATE',
  NO_ACTIVE_PROFILE: 'NO_ACTIVE_PROFILE',
  CORE_MISSING: 'CORE_MISSING',
  ASSET_MISSING: 'ASSET_MISSING',
  /* Retained as a compatibility alias: a 4.0.x frontend that predates
     ASSET_INTEGRITY_FAILED still has localized text for this code, so the
     older name must keep resolving. New code emits ASSET_INTEGRITY_FAILED. */
  ASSET_CORRUPT: 'ASSET_CORRUPT',
  ASSET_INTEGRITY_FAILED: 'ASSET_INTEGRITY_FAILED',
  CORE_INTEGRITY_FAILED: 'CORE_INTEGRITY_FAILED',
  PACKAGE_INCOMPLETE: 'PACKAGE_INCOMPLETE',
  CORE_START_FAILED: 'CORE_START_FAILED',
  /* The proxy endpoint could not be resolved *before* the routes changed.
     Raised while the TV's networking is still untouched, so it can never leave
     the television without a default route. */
  ENDPOINT_RESOLUTION_FAILED: 'ENDPOINT_RESOLUTION_FAILED',
  /* The endpoint resolved, but no resolved candidate carried traffic once the
     tunnel was up. The routes are rolled back before this is reported. */
  ENDPOINT_UNREACHABLE: 'ENDPOINT_UNREACHABLE',
  TUN_NOT_READY: 'TUN_NOT_READY',
  ROUTE_FAILED: 'ROUTE_FAILED',
  HEALTH_CHECK_FAILED: 'HEALTH_CHECK_FAILED',
  NETWORK_CHANGED: 'NETWORK_CHANGED',
  CONFIG_BUILD_FAILED: 'CONFIG_BUILD_FAILED',
  TUNNEL_OWNED_BY_OTHER_EDITION: 'TUNNEL_OWNED_BY_OTHER_EDITION',
  NOT_ROOT: 'NOT_ROOT',

  /* Elevation.

     HOMEBREW_REQUIRED is the unmet *hard prerequisite*: no rooted TV with
     Homebrew Channel running as root. It is not a recoverable application
     state and offers no in-app remedy.

     ELEVATION_REQUIRED is the recoverable case: Homebrew Channel is root, but
     the last package install reset this service's LS2 configuration and it is
     running jailed. Only this state offers "Grant permissions". */
  HOMEBREW_REQUIRED: 'HOMEBREW_REQUIRED',
  ELEVATION_REQUIRED: 'ELEVATION_REQUIRED',
  ELEVATION_FAILED: 'ELEVATION_FAILED',

  /* transport / subscriptions */
  NETWORK_ERROR: 'NETWORK_ERROR',
  TLS_CERTIFICATE_INVALID: 'TLS_CERTIFICATE_INVALID',
  HTTP_ERROR: 'HTTP_ERROR',
  TIMEOUT: 'TIMEOUT',
  TOO_MANY_REDIRECTS: 'TOO_MANY_REDIRECTS',
  HTTPS_DOWNGRADE_REJECTED: 'HTTPS_DOWNGRADE_REJECTED',
  RESPONSE_TOO_LARGE: 'RESPONSE_TOO_LARGE',
  DECOMPRESSED_TOO_LARGE: 'DECOMPRESSED_TOO_LARGE',
  BLOCKED_ADDRESS: 'BLOCKED_ADDRESS',
  BLOCKED_SCHEME: 'BLOCKED_SCHEME',
  URL_CREDENTIALS_REJECTED: 'URL_CREDENTIALS_REJECTED',
  DNS_FAILED: 'DNS_FAILED',
  TOO_MANY_NESTED: 'TOO_MANY_NESTED',
  NO_SERVERS_FOUND: 'NO_SERVERS_FOUND',
  UNSUPPORTED_TRANSPORT: 'UNSUPPORTED_TRANSPORT',
  PROVIDER_AUTH_FAILED: 'PROVIDER_AUTH_FAILED',
  PROVIDER_REJECTED: 'PROVIDER_REJECTED',
  HWID_REQUIRED: 'HWID_REQUIRED',

  /* LAN importer / pairing */
  PAIRING_DISABLED: 'PAIRING_DISABLED',
  PAIRING_ACTIVE: 'PAIRING_ACTIVE',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  BODY_TOO_LARGE: 'BODY_TOO_LARGE',
  CSRF_FAILED: 'CSRF_FAILED',

  INTERNAL: 'INTERNAL'
};

/* An AlcyoneError carries a stable machine code plus optional neutral detail.
   `detail` must never contain secrets: it is surfaced to the UI and logs. */
function AlcyoneError(code, detail, meta) {
  Error.call(this);
  this.name = 'AlcyoneError';
  this.code = CODES[code] ? code : CODES.INTERNAL;
  this.detail = detail === undefined || detail === null ? '' : String(detail);
  this.meta = meta && typeof meta === 'object' ? meta : null;
  this.message = this.code + (this.detail ? ': ' + this.detail : '');
}
AlcyoneError.prototype = Object.create(Error.prototype);
AlcyoneError.prototype.constructor = AlcyoneError;

function err(code, detail, meta) {
  return new AlcyoneError(code, detail, meta);
}

function isAlcyoneError(value) {
  return !!value && value.name === 'AlcyoneError' && typeof value.code === 'string';
}

/* Normalize any thrown value into a structured, secret-free payload. */
function toResult(error) {
  if (isAlcyoneError(error)) {
    var out = { returnValue: false, ok: false, errorCode: error.code };
    if (error.detail) out.errorDetail = error.detail;
    if (error.meta) out.errorMeta = error.meta;
    return out;
  }
  return { returnValue: false, ok: false, errorCode: CODES.INTERNAL };
}

module.exports = {
  CODES: CODES,
  AlcyoneError: AlcyoneError,
  err: err,
  isAlcyoneError: isAlcyoneError,
  toResult: toResult
};
