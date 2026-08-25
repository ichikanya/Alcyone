"use strict";
var dns = require("dns"),
  DNS_FALLBACK_GRACE_MS = 1e3;
function timeoutError() {
  var n = new Error("DNS lookup deadline exceeded");
  return ((n.code = "TIMEOUT"), n);
}
function orderedUnique(n, r) {
  var e,
    o,
    l,
    t = [],
    u = {};
  for (e = 0; e < (n || []).length; e++)
    (o = String(n[e] || "")) &&
      (u[(l = r + ":" + o)] ||
        ((u[l] = !0), t.push({ address: o, family: r })));
  return (
    t.sort(function (n, r) {
      return n.family - r.family;
    }),
    t
  );
}
function resolveForConnection(n, r, e) {
  var o = !1,
    l = !1,
    t = null,
    u = !1,
    i = 0,
    f = [],
    s = null,
    a = null;
  function c(n, r) {
    o ||
      ((o = !0),
      s && (clearTimeout(s), (s = null)),
      a && (clearTimeout(a), (a = null)),
      e(n || null, r || null));
  }
  function d() {
    o || !u || i > 0 || !l || c(t || f[0] || new Error("DNS lookup failed"));
  }
  function m(n, r, e) {
    var l;
    if (!o) {
      if ((i--, !n)) {
        if ((l = orderedUnique(r, e)).length) return c(null, l);
        n = new Error("empty DNS response");
      }
      (f.push(n), d());
    }
  }
  function h() {
    if (!o && !u) {
      ((u = !0), (i = 2));
      try {
        dns.resolve4(n, function (n, r) {
          m(n, r, 4);
        });
      } catch (n) {
        m(n, null, 4);
      }
      try {
        dns.resolve6(n, function (n, r) {
          m(n, r, 6);
        });
      } catch (n) {
        m(n, null, 6);
      }
    }
  }
  if (Date.now() >= r) return c(timeoutError());
  ((a = setTimeout(
    function () {
      c(timeoutError());
    },
    Math.max(1, r - Date.now()),
  )),
    (s = setTimeout(
      h,
      Math.min(DNS_FALLBACK_GRACE_MS, Math.max(1, r - Date.now())),
    )));
  try {
    dns.lookup(n, 4, function (n, r, e) {
      var u;
      if (!o) {
        if (((l = !0), !n && r)) {
          if ((u = orderedUnique([r], e || 4)).length) return c(null, u);
          n = new Error("empty DNS lookup response");
        }
        ((t = n || new Error("DNS lookup failed")), h(), d());
      }
    });
  } catch (n) {
    ((l = !0), (t = n), h(), d());
  }
}
function resolveAll(n, r) {
  var e = 2,
    o = [],
    l = [],
    t = !1;
  function u(u, i, f) {
    var s;
    if (!t) {
      if (u) l.push(u);
      else
        for (s = 0; s < (i || []).length; s++)
          o.push({ address: String(i[s]), family: f });
      if (!(--e > 0))
        if (((t = !0), o.length))
          (o.sort(function (n, r) {
            return n.family - r.family;
          }),
            r(null, o));
        else
          try {
            dns.lookup(n, function (n, e, o) {
              if (n || !e)
                return r(l[0] || n || new Error("DNS lookup failed"));
              r(null, [{ address: String(e), family: o || 4 }]);
            });
          } catch (n) {
            r(l[0] || n || new Error("DNS lookup failed"));
          }
    }
  }
  try {
    dns.resolve4(n, function (n, r) {
      u(n, r, 4);
    });
  } catch (n) {
    u(n, null, 4);
  }
  try {
    dns.resolve6(n, function (n, r) {
      u(n, r, 6);
    });
  } catch (n) {
    u(n, null, 6);
  }
}
module.exports = {
  DNS_FALLBACK_GRACE_MS: DNS_FALLBACK_GRACE_MS,
  resolveAll: resolveAll,
  resolveForConnection: resolveForConnection,
};
