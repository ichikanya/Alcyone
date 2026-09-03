!(function (t) {
  "use strict";
  function e(t, e, n) {
    for (var a = t; a && a !== n;) {
      if (a.matches ? a.matches(e) : r(a, e)) return a;
      a = a.parentNode;
    }
    return null;
  }
  function r(t, e) {
    return (
      !(!t || 1 !== t.nodeType) &&
      (".card" === e
        ? !(!t.classList || !t.classList.contains("card"))
        : "[data-act]" === e &&
          !(!t.getAttribute || !t.getAttribute("data-act")))
    );
  }
  t.AlcyoneServerList = {
    create: function (r) {
      var n = (r = r || {}).list,
        a = [],
        o = [],
        i = [],
        l = [],
        c = !1,
        u = !1,
        d = null,
        s = r.cardHeight || 132,
        f = r.groupHeight || 44,
        p = null,
        g = !0,
        h = null;
      function m(t) {
        return !!t && "card" === t.kind;
      }
      function v(t) {
        return t
          ? "card" === t.kind
            ? "profile:" + String((t.profile && t.profile.id) || "")
            : "group" === t.kind
              ? "group:" + String(t.name || "")
              : "empty:" +
                String(t.titleKey || "") +
                ":" +
                String(t.hintKey || "")
          : "empty:";
      }
      function y(t, e) {
        return i[e] || (m(t) ? s : t && "empty" === t.kind ? 120 : f);
      }
      function b() {
        var t,
          e = 0;
        for (l = [], t = 0; t < a.length; t++) ((l[t] = e), (e += y(a[t], t)));
        l.total = e;
      }
      function S(t) {
        var e,
          r = 0,
          n = a.length - 1;
        if (!a.length || t <= 0) return 0;
        for (; r < n;)
          ((e = Math.floor((r + n) / 2)),
            l[e] + y(a[e], e) <= t ? (r = e + 1) : (n = e));
        return r;
      }
      function A() {
        var t,
          e = p ? Math.max(0, p.scrollTop - (n.offsetTop || 0)) : 0,
          r = (p && p.clientHeight) || 720,
          o = S(e),
          i = S(e + r) + 1,
          l = o,
          c = i,
          u = 0,
          d = 0,
          s = 0;
        for (t = o - 1; t >= 0 && u < 6; t--) ((l = t), m(a[t]) && u++);
        for (t = i; t < a.length && d < 6; t++) ((c = t + 1), m(a[t]) && d++);
        for (c > a.length && (c = a.length), t = l; t < c; t++) m(a[t]) && s++;
        for (; s > 24 && c > l;) (m(a[c - 1]) && s--, c--);
        return { start: l, end: c };
      }
      function x() {
        var r = t.document && t.document.activeElement,
          a = r && n && e(r, ".card", n),
          o = (r && r.getAttribute && r.getAttribute("data-act")) || "";
        return {
          id:
            (r && r.getAttribute && r.getAttribute("data-id")) ||
            (a && a.getAttribute("data-id")) ||
            "",
          action: o,
          index: a && parseInt(a.getAttribute("data-list-index"), 10),
          scrollTop: p ? p.scrollTop : 0,
        };
      }
      function q(t, e) {
        var r,
          a = e
            ? 'button[data-act="' + String(e).replace(/"/g, "") + '"]'
            : ".card",
          o = n.querySelectorAll(a);
        for (r = 0; r < o.length; r++)
          if (o[r].getAttribute("data-id") === t) return o[r];
        return null;
      }
      function L(e, o) {
        var s,
          f,
          g,
          h,
          v = o || (e ? null : x()),
          y = "";
        if (((c = !1), n)) {
          for (
            b(),
              s = A(),
              d = s,
              y +=
                '<div class="listSpacer" data-spacer="top" style="height:' +
                Math.max(0, l[s.start] || 0) +
                'px"></div>',
              a.length || (y += r.emptyHtml ? r.emptyHtml() : ""),
              f = s.start;
            f < s.end;
            f++
          )
            ((g = a[f]), (y += r.renderItem ? r.renderItem(g, f) : ""));
          var S, L;
          ((y +=
            '<div class="listSpacer" data-spacer="bottom" style="height:' +
            Math.max(0, l.total - (l[s.end] || l.total)) +
            'px"></div>'),
            (n.innerHTML = y),
            r.onRendered && r.onRendered(n),
            u ||
              ((u = !0),
              (h = (function () {
                var e,
                  r,
                  a,
                  o,
                  l,
                  c = n.querySelectorAll("[data-list-index]"),
                  u = !1;
                for (e = 0; e < c.length; e++)
                  (r = parseInt(c[e].getAttribute("data-list-index"), 10)) >=
                    0 &&
                    ((a = c[e].offsetHeight),
                    (l = 0),
                    t.getComputedStyle &&
                      ((o = t.getComputedStyle(c[e])),
                      (l = parseFloat(o && o.marginBottom) || 0)),
                    (a += l) > 0 &&
                      (!i[r] || Math.abs(i[r] - a) > 1) &&
                      ((i[r] = a), (u = !0)));
                return u;
              })()),
              (u = !1),
              h &&
                (b(),
                (S = n.querySelector('[data-spacer="top"]')),
                (L = n.querySelector('[data-spacer="bottom"]')),
                S && (S.style.height = Math.max(0, l[d.start] || 0) + "px"),
                L &&
                  (L.style.height =
                    Math.max(0, l.total - (l[d.end] || l.total)) + "px"))),
            (e && !o) ||
              (function (t, e) {
                var o,
                  i,
                  l = -1;
                if (t && n) {
                  if (
                    (!e &&
                      p &&
                      void 0 !== t.scrollTop &&
                      (p.scrollTop = t.scrollTop),
                    !(o = t.id ? q(t.id, t.action) : null) && t.id)
                  ) {
                    for (i = 0; i < a.length; i++)
                      if (
                        m(a[i]) &&
                        a[i].profile &&
                        String(a[i].profile.id) === String(t.id)
                      ) {
                        l = i;
                        break;
                      }
                    (l >= 0 && !e && (k(l), (o = q(t.id, t.action))),
                      !o &&
                        l >= 0 &&
                        e &&
                        (o = n.querySelector(".card")) &&
                        t.action &&
                        (o =
                          o.querySelector(
                            'button[data-act="' + t.action + '"]',
                          ) || o));
                  }
                  if (
                    (!o && t.id && (o = q(t.id, "")),
                    o || e || (o = n.querySelector(".card")),
                    o && r.focusElement)
                  ) {
                    if (e && r.focusElement(o, !0)) return;
                    if (!e && r.focusElement(o));
                  }
                }
              })(v, !!o));
        }
      }
      function T(e) {
        var r, a;
        (!0 === e ? h || (h = x()) : ((g = !1), (h = null)), c) ||
          ((c = !0),
          (r = function () {
            var e = d,
              r = g,
              a = h,
              o = t.document && t.document.activeElement;
            ((g = !0),
              (h = null),
              a && o && n && n.contains && n.contains(o) && o.blur && o.blur(),
              L(r, a),
              !e || !d || e.start !== d.start || (e.end, d.end));
          }),
          (a = t.requestAnimationFrame || t.webkitRequestAnimationFrame)
            ? a.call(t, r)
            : t.setTimeout(r, 16));
      }
      function M(t) {
        var e, r, n;
        p &&
          (e = (function (t) {
            var e = 0;
            return t
              ? ("number" == typeof t.deltaY && t.deltaY
                  ? (e = t.deltaY)
                  : "number" == typeof t.wheelDeltaY && t.wheelDeltaY
                    ? (e = -t.wheelDeltaY)
                    : "number" == typeof t.wheelDelta && t.wheelDelta
                      ? (e = -t.wheelDelta)
                      : "number" == typeof t.detail &&
                        t.detail &&
                        (e = 16 * t.detail),
                e && Math.abs(e) < 8 && (e *= 16),
                e > 192 && (e = 192),
                e < -192 && (e = -192),
                e)
              : 0;
          })(t)) &&
          ((r = Math.max(0, p.scrollHeight - p.clientHeight)),
          (n = Math.max(0, Math.min(r, p.scrollTop + e))) !== p.scrollTop &&
            ((p.scrollTop = n), t.preventDefault && t.preventDefault()));
      }
      function E(t, e) {
        var a,
          o,
          i,
          l,
          c,
          u,
          d = (function (t) {
            return n && n.querySelector
              ? n.querySelector('[data-list-index="' + t + '"]')
              : null;
          })(e);
        d &&
          (r.updateItem
            ? r.updateItem(d, t, e)
            : m(t)
              ? (d.setAttribute(
                  "data-id",
                  String((t.profile && t.profile.id) || ""),
                ),
                (a = d.querySelector(".serverTitle")),
                (o = d.querySelector(".meta")),
                (i = d.querySelector(".badge")),
                (l = (t.profile && t.profile.name) || ""),
                a && (a.textContent = l),
                o && (o.textContent = (t.profile && t.profile.endpoint) || ""),
                i &&
                  (i.textContent = String(
                    (t.profile && t.profile.protocol) || "",
                  ).toUpperCase()),
                (u = d.querySelector(".flag")) &&
                  t.profile &&
                  t.profile.country &&
                  u.setAttribute("alt", String(t.profile.country)))
              : "group" === t.kind &&
                ((l = d.querySelector(".gname")),
                (c = d.querySelector(".gcount")),
                l && (l.textContent = t.name || ""),
                c && (c.textContent = String(t.count || 0))));
      }
      function k(t) {
        var e, r;
        t >= 0 &&
          (b(),
          (e = l[t] || 0),
          (r = !d || t < d.start || t >= d.end),
          p &&
            (e < p.scrollTop
              ? (p.scrollTop = e)
              : e + y(a[t], t) > p.scrollTop + p.clientHeight &&
                (p.scrollTop = Math.max(
                  0,
                  e - Math.max(0, p.clientHeight - y(a[t], t)),
                ))),
          r && L(!0));
      }
      function C(t, a) {
        var o = t && t.getAttribute && t.getAttribute("data-act"),
          i = t && e(t, ".card", n);
        i &&
          r.onAction &&
          r.onAction(
            o || "select",
            i.getAttribute("data-id"),
            t,
            a || { input: "pointer" },
          );
      }
      return (
        (p = (function () {
          for (
            var e = n && n.parentNode;
            e && e !== t.document && e !== t.document.body;
          ) {
            if (e.classList && e.classList.contains("page")) return e;
            e = e.parentNode;
          }
          return null;
        })()) &&
          p.addEventListener &&
          (p.addEventListener(
            "scroll",
            function () {
              var t;
              n &&
                p &&
                (b(),
                (t = A()),
                (d && t.start === d.start && t.end === d.end) || T(!0));
            },
            !1,
          ),
          p.addEventListener("wheel", M, !1),
          p.addEventListener("mousewheel", M, !1),
          p.addEventListener("DOMMouseScroll", M, !1)),
        n &&
          n.addEventListener &&
          (n.addEventListener(
            "click",
            function (t) {
              var a = t.target || t.srcElement,
                o = e(a, "[data-act]", n),
                i = e(a, ".card", n);
              o
                ? (t.stopPropagation && t.stopPropagation(),
                  C(o, { input: "pointer" }))
                : i &&
                  r.onAction &&
                  r.onAction("select", i.getAttribute("data-id"), i, {
                    input: "pointer",
                  });
            },
            !1,
          ),
          n.addEventListener(
            "keydown",
            function (t) {
              var e = t.target || t.srcElement;
              (((13 === t.keyCode || 32 === t.keyCode) &&
                e &&
                e.getAttribute &&
                e.getAttribute("data-act")) ||
                ((13 === t.keyCode || 32 === t.keyCode) &&
                  e &&
                  e.classList &&
                  e.classList.contains("card"))) &&
                (t.preventDefault && t.preventDefault(),
                C(e, { input: "dpad" }));
            },
            !1,
          )),
        {
          setModel: function (t) {
            var e,
              r,
              n,
              l =
                "[object Array]" === Object.prototype.toString.call(t) ? t : [],
              c = (function (t) {
                var e,
                  r = [];
                for (e = 0; e < t.length; e++) r.push(v(t[e]));
                return r;
              })(l),
              u = {};
            for (e = 0; e < a.length; e++)
              ((r = o[e] || v(a[e])), i[e] && (u[r] = i[e]));
            if (
              ((n = (function (t, e) {
                var r;
                if (t.length !== e.length) return !1;
                for (r = 0; r < t.length; r++) if (t[r] !== e[r]) return !1;
                return !0;
              })(o, c)),
              (a = l),
              (o = c),
              n)
            )
              for (e = 0; e < a.length; e++) E(a[e], e);
            else {
              for (i.length = a.length, e = 0; e < a.length; e++)
                i[e] = u[o[e]] || void 0;
              T();
            }
          },
          setSelectedProfile: function (t, e) {
            var a,
              o,
              i,
              l = n && n.querySelectorAll ? n.querySelectorAll(".card") : [];
            for (a = 0; a < l.length; a++)
              ((o = l[a].getAttribute("data-id")),
                (i = String(o) === String(e || "")),
                l[a].classList &&
                  (i
                    ? l[a].classList.add("active")
                    : l[a].classList.remove("active")),
                r.updateSelection && r.updateSelection(l[a], i, t, e));
            return !0;
          },
          refresh: function () {
            T();
          },
          patchProfile: function (t, e) {
            var r,
              n = q(t, "");
            return (
              !(!n || !e) &&
              !!(r = n.querySelector(".pingCell")) &&
              ((r.outerHTML = e), !0)
            );
          },
          visibleProfileIds: function () {
            var t,
              e = n.querySelectorAll(".card"),
              r = [];
            for (t = 0; t < e.length; t++)
              e[t].getAttribute("data-id") &&
                r.push(e[t].getAttribute("data-id"));
            return r;
          },
          moveFocus: function (t, o) {
            var i,
              l,
              c = t && e(t, ".card", n);
            return (
              !!c &&
              (i = parseInt(c.getAttribute("data-list-index"), 10)) >= 0 &&
              (38 === o || 40 === o) &&
              !(
                (l = (function (t, e) {
                  for (var r = t + e; r >= 0 && r < a.length;) {
                    if (m(a[r])) return r;
                    r += e;
                  }
                  return -1;
                })(i, 38 === o ? -1 : 1)) < 0
              ) &&
              (function (t, e) {
                var a;
                return (
                  k(t),
                  (a = n.querySelector('.card[data-list-index="' + t + '"]')) &&
                    e &&
                    (a = a.querySelector('button[data-act="' + e + '"]') || a),
                  !!(a && r.focusElement && r.focusElement(a))
                );
              })(l, (t.getAttribute && t.getAttribute("data-act")) || "")
            );
          },
          render: L,
          capture: x,
        }
      );
    },
  };
})(window);
