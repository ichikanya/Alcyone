!(function (r, t) {
  "use strict";
  var e = (function () {
    var r = {
      ae: 1,
      al: 1,
      am: 1,
      ar: 1,
      at: 1,
      au: 1,
      az: 1,
      ba: 1,
      be: 1,
      bg: 1,
      br: 1,
      by: 1,
      ca: 1,
      ch: 1,
      cl: 1,
      cn: 1,
      cy: 1,
      cz: 1,
      de: 1,
      dk: 1,
      ee: 1,
      es: 1,
      fi: 1,
      fr: 1,
      gb: 1,
      ge: 1,
      gr: 1,
      hk: 1,
      hr: 1,
      hu: 1,
      id: 1,
      ie: 1,
      il: 1,
      in: 1,
      is: 1,
      it: 1,
      jp: 1,
      kg: 1,
      kr: 1,
      kz: 1,
      lt: 1,
      lu: 1,
      lv: 1,
      md: 1,
      me: 1,
      mk: 1,
      mt: 1,
      mx: 1,
      my: 1,
      nl: 1,
      no: 1,
      nz: 1,
      ph: 1,
      pl: 1,
      pt: 1,
      ro: 1,
      rs: 1,
      ru: 1,
      se: 1,
      sg: 1,
      si: 1,
      sk: 1,
      th: 1,
      tr: 1,
      tw: 1,
      ua: 1,
      us: 1,
      uz: 1,
      vn: 1,
    };
    function t(t) {
      return ((t = String(t || "").toLowerCase()), r[t] ? t : "un");
    }
    function e(r) {
      var t = 127462 + r.charCodeAt(0) - 97;
      return (
        (t -= 65536),
        String.fromCharCode(55296 + (t >> 10), 56320 + (1023 & t))
      );
    }
    return {
      normalize: t,
      isSupported: function (r) {
        return "un" !== t(r);
      },
      emoji: function (r) {
        return e((r = t(r)).charAt(0)) + e(r.charAt(1));
      },
      nativeSrc: function (r) {
        return "flags/" + t(r) + ".png";
      },
      supportedCodes: function () {
        return Object.keys(r).sort();
      },
    };
  })();
  ("undefined" != typeof module && module.exports && (module.exports = e),
    r && (r.ALCYONE_COUNTRIES = e));
})(this);
