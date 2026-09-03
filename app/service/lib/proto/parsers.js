"use strict";
var errors = require("../errors"),
  err = errors.err;
function locErr(e, r) {
  return err(e, r || "");
}
function safeText(e, r) {
  return String(null == e ? "" : e)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, r || 4096);
}
function decodeUrlPart(e) {
  try {
    return decodeURIComponent(String(e || "").replace(/\+/g, "%20"));
  } catch (r) {
    return String(e || "");
  }
}
function bufferFrom(e, r) {
  return Buffer.from ? Buffer.from(e, r) : new Buffer(e, r);
}
function truthy(e) {
  return (
    "true" === (e = String(null == e ? "" : e).toLowerCase()) ||
    "1" === e ||
    "yes" === e ||
    "on" === e
  );
}
function looksLikeUnsupportedSubscriptionPage(e) {
  var r = htmlEntityDecode(String(e || "")).toLowerCase();
  return (
    (r.indexOf("<html") >= 0 ||
      r.indexOf("raytune") >= 0 ||
      r.indexOf("app") >= 0) &&
    (r.indexOf("не поддерж") >= 0 ||
      r.indexOf("приложен") >= 0 ||
      r.indexOf("unsupported") >= 0 ||
      r.indexOf("not supported") >= 0 ||
      r.indexOf("not support") >= 0)
  );
}
function findUnsupportedSubscriptionProtocols(e) {
  var r,
    t,
    s,
    a,
    o = {},
    n = [String(e || "")],
    i = safeBase64Decode(htmlEntityDecode(String(e || "")));
  i && i !== n[0] && n.push(i);
  for (r = 0; r < n.length; r++)
    for (
      t = [
        {
          name: "wireguard",
          re: /(?:wireguard|wireguard-go|wg):\/\//gi,
          field: /["']?(?:type|protocol|network|kind)["']?\s*[:=]\s*["']?wireguard\b/gi,
        },
        {
          name: "tuic",
          re: /tuic:\/\//gi,
          field: /["']?(?:type|protocol|network|kind)["']?\s*[:=]\s*["']?tuic\b/gi,
        },
        {
          name: "hysteria1",
          re: /hysteria:\/\/[^\s\r\n]*(?:[?&](?:upmbps|downmbps|protocol|auth|fast-open)=)/gi,
          field: /(?:["']?(?:type|protocol|network|kind)["']?\s*[:=]\s*["']?hysteria1?\b|\bhysteria\s+v?1\b)/gi,
        },
      ],
      s = 0;
      s < t.length;
      s++
    )
      for (; (a = t[s].re.exec(n[r])); ) o[t[s].name] = (o[t[s].name] || 0) + 1;
  for (r = 0; r < n.length; r++)
    for (s = 0; s < t.length; s++)
      for (; (a = t[s].field && t[s].field.exec(n[r])); )
        o[t[s].name] = (o[t[s].name] || 0) + 1;
  return o;
}
function htmlEntityDecode(e) {
  return String(e || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
function percentDecodeLoose(e) {
  var r,
    t,
    s = String(e || "");
  for (r = 0; r < 3; r++) {
    try {
      t = decodeURIComponent(s);
    } catch (e) {
      break;
    }
    if (t === s) break;
    s = t;
  }
  return s;
}
function stripYamlQuote(e) {
  return (
    (('"' === (e = String(null == e ? "" : e).trim()).charAt(0) &&
      '"' === e.charAt(e.length - 1)) ||
      ("'" === e.charAt(0) && "'" === e.charAt(e.length - 1))) &&
      (e = e.slice(1, -1)),
    e
  );
}
function normalizeYamlList(e) {
  var r,
    t,
    s = [];
  for (
    "[" === (e = String(null == e ? "" : e).trim()).charAt(0) &&
      "]" === e.charAt(e.length - 1) &&
      (e = e.slice(1, -1)),
      r = e.split(","),
      t = 0;
    t < r.length;
    t++
  ) {
    var a = stripYamlQuote(r[t]);
    a && s.push(a);
  }
  return s.join(",");
}
function cleanServerName(e) {
  return safeText(
    (e = (e = htmlEntityDecode(
      percentDecodeLoose(decodeUrlPart(String(null == e ? "" : e)))
    ))
      .replace(/[\r\n\t]+/g, " ")
      .replace(/^['"`]+|['"`]+$/g, "")
      .replace(/\s+/g, " ")
      .trim()),
    120
  );
}
function isGenericName(e) {
  var r = cleanServerName(e).toLowerCase();
  return (
    !r ||
    "proxy" === r ||
    "vless" === r ||
    "server" === r ||
    "default" === r ||
    "outbound" === r ||
    "direct" === r ||
    "block" === r ||
    "dns" === r ||
    "undefined" === r ||
    "null" === r ||
    /^(proxy|outbound|server|node|vless|vmess|trojan|ss|socks|hysteria2?)[\s._-]*\d+$/i.test(
      r
    )
  );
}
function descriptiveName() {
  var e, r;
  for (e = 0; e < arguments.length; e++)
    if ((r = cleanServerName(arguments[e])) && !isGenericName(r)) return r;
  return "";
}
function hostDisplayName(e) {
  var r = cleanServerName(String(e || "").split(".")[0])
    .replace(/[_-]+/g, " ")
    .trim();
  return r
    ? r.length <= 3
      ? r.toUpperCase()
      : r.replace(/(^|\s)([a-zа-яё])/gi, function (e, r, t) {
          return r + t.toUpperCase();
        })
    : "";
}
function jsonProfileName(e, r, t) {
  return descriptiveName(e, r) || hostDisplayName(t) || cleanServerName(t);
}
function importedProfileName(e, r, t, s) {
  r = r || null;
  var a = descriptiveName((e = e || {}).name),
    o = hostDisplayName(e.host),
    n = r && descriptiveName(r.name);
  return !n || (a && a.toLowerCase() !== o.toLowerCase())
    ? a || n || o || cleanServerName(e.host) || (t || "VPN") + " #" + s
    : n;
}
function bestName() {
  var e, r;
  for (e = 0; e < arguments.length; e++)
    if ((r = cleanServerName(arguments[e])) && !isGenericName(r)) return r;
  for (e = 0; e < arguments.length; e++)
    if ((r = cleanServerName(arguments[e]))) return r;
  return "";
}
function splitInlineMap(e) {
  var r,
    t,
    s = [],
    a = "",
    o = "",
    n = 0;
  for (
    "{" === (e = String(e || "").trim()).charAt(0) &&
      "}" === e.charAt(e.length - 1) &&
      (e = e.slice(1, -1)),
      r = 0;
    r < e.length;
    r++
  )
    ((t = e.charAt(r)),
      o
        ? ((a += t), t === o && "\\" !== e.charAt(r - 1) && (o = ""))
        : '"' !== t && "'" !== t
          ? (("{" !== t && "[" !== t) || n++,
            ("}" !== t && "]" !== t) || n--,
            "," === t && n <= 0 ? (s.push(a.trim()), (a = "")) : (a += t))
          : ((o = t), (a += t)));
  return (a.trim() && s.push(a.trim()), s);
}
function parseInlineMap(e) {
  var r,
    t,
    s,
    a,
    o,
    n = {},
    i = splitInlineMap(e);
  for (r = 0; r < i.length; r++)
    (s = (t = i[r]).indexOf(":")) < 0 ||
      ((a = t.slice(0, s).trim().toLowerCase()),
      (o = stripYamlQuote(t.slice(s + 1).trim())),
      a && (n[a] = o));
  return n;
}
function applyYamlKey(e, r, t, s) {
  if (
    ((t = String(t || "").toLowerCase()),
    (s = stripYamlQuote(String(null == s ? "" : s).replace(/\s+#.*$/, ""))),
    !e)
  )
    return r || "";
  if (!s)
    return ("ws-opts" !== r && "ws_opts" !== r) || "headers" !== t
      ? t
      : "ws-headers";
  if ("{" === s.charAt(0) && "}" === s.charAt(s.length - 1)) {
    var a = parseInlineMap(s);
    if ("reality-opts" === t || "reality_opts" === t)
      return (
        (e.publicKey = a["public-key"] || a.publickey || e.publicKey),
        (e.shortId = a["short-id"] || a.shortid || e.shortId),
        r || ""
      );
    if ("ws-opts" === t || "ws_opts" === t) {
      var o = parseInlineMap(a.headers || "");
      return (
        (e.path = a.path || e.path),
        (e.hostHeader = a.host || o.host || e.hostHeader),
        r || ""
      );
    }
    if ("grpc-opts" === t || "grpc_opts" === t)
      return (
        (e.serviceName =
          a["grpc-service-name"] ||
          a["service-name"] ||
          a.path ||
          e.serviceName),
        r || ""
      );
    if (
      "http-opts" === t ||
      "http_opts" === t ||
      "xhttp-opts" === t ||
      "xhttp_opts" === t
    )
      return (
        (e.path = a.path || e.path),
        (e.mode = a.mode || e.mode),
        (e.hostHeader = a.host || e.hostHeader),
        r || ""
      );
  }
  return "reality-opts" === r || "reality_opts" === r
    ? ("public-key" === t
        ? (e.publicKey = s)
        : "short-id" === t
          ? (e.shortId = s)
          : (e[t] = s),
      r)
    : "ws-opts" === r || "ws_opts" === r
      ? ("path" === t && (e.path = s), "headers" === t ? "ws-headers" : r)
      : "grpc-opts" === r || "grpc_opts" === r
        ? (("grpc-service-name" !== t && "service-name" !== t) ||
            (e.serviceName = s),
          r)
        : "http-opts" === r ||
            "http_opts" === r ||
            "xhttp-opts" === r ||
            "xhttp_opts" === r
          ? ("path" === t && (e.path = s),
            "mode" === t && (e.mode = s),
            "host" === t && (e.hostHeader = s),
            r)
          : "ws-headers" === r
            ? ("host" === t && (e.hostHeader = s), r)
            : ("name" === t || "remark" === t || "remarks" === t || "ps" === t
                ? (e.name = s)
                : "type" === t
                  ? (e.proto = s)
                  : "server" === t || "address" === t
                    ? (e.host = s)
                    : "port" === t || "server-port" === t || "server_port" === t
                      ? (e.port = s)
                      : "uuid" === t || "id" === t
                        ? (e.uuid = s)
                        : "password" === t || "auth" === t || "auth-str" === t
                          ? (e.password = s)
                          : "network" === t
                            ? (e.network = s)
                            : "tls" === t
                              ? (e.tls = s)
                              : "servername" === t ||
                                  "sni" === t ||
                                  "peer" === t
                                ? (e.sni = s)
                                : "client-fingerprint" === t ||
                                    "fingerprint" === t ||
                                    "fp" === t
                                  ? (e.fp = s)
                                  : "flow" === t
                                    ? (e.flow = s)
                                    : "skip-cert-verify" === t ||
                                        "skip_cert_verify" === t ||
                                        "insecure" === t
                                      ? (e.insecure = s)
                                      : "obfs" === t
                                        ? (e.obfs = s)
                                        : "obfs-password" === t ||
                                            "obfs_password" === t
                                          ? (e.obfsPassword = s)
                                          : "up" === t ||
                                              "upmbps" === t ||
                                              "up-mbps" === t
                                            ? (e.up = s)
                                            : "down" === t ||
                                                "downmbps" === t ||
                                                "down-mbps" === t
                                              ? (e.down = s)
                                              : "alpn" === t
                                                ? (e.alpn =
                                                    normalizeYamlList(s))
                                                : "cipher" === t
                                                  ? (e.cipher = s)
                                                  : "alterid" === t
                                                    ? (e.alterId = s)
                                                    : ("username" !== t &&
                                                        "user" !== t) ||
                                                      (e.username = s),
              r || "");
}
function pushParam(e, r, t) {
  null != t &&
    "" !== String(t) &&
    e.push(encodeURIComponent(r) + "=" + encodeURIComponent(String(t)));
}
function buildVlessLink(e) {
  var r = e.host || e.server || e.address,
    t = parseInt(e.port || e.server_port || 443, 10) || 443,
    s = e.uuid || e.id;
  if (!r || !s) return "";
  var a = [],
    o = e.security || "none",
    n = e.type || e.network || "tcp";
  return (
    pushParam(a, "encryption", e.encryption || "none"),
    o && "none" !== o && pushParam(a, "security", o),
    n && pushParam(a, "type", n),
    pushParam(a, "sni", e.sni || e.servername || e.serverName),
    pushParam(
      a,
      "fp",
      e.fp || e.fingerprint || e.clientFingerprint || e.client_fingerprint
    ),
    pushParam(a, "pbk", e.pbk || e.publicKey || e.public_key),
    pushParam(a, "sid", e.sid || e.shortId || e.short_id),
    pushParam(a, "spx", e.spx || e.spiderX || e.spider_x),
    pushParam(a, "flow", e.flow),
    pushParam(a, "path", e.path),
    pushParam(a, "host", e.hostHeader || e.host_header || e.headersHost),
    pushParam(
      a,
      "serviceName",
      e.serviceName || e.grpcServiceName || e.grpc_service_name
    ),
    pushParam(a, "mode", e.mode),
    pushParam(a, "alpn", e.alpn),
    "vless://" +
      encodeURIComponent(s) +
      "@" +
      r +
      ":" +
      t +
      (a.length ? "?" + a.join("&") : "") +
      "#" +
      encodeURIComponent(bestName(e.name, e.remarks, e.remark, e.ps, e.tag, r))
  );
}
function buildHysteria2Link(e) {
  var r = e.host || e.server || e.address,
    t = parseInt(e.port || e.server_port || 443, 10) || 443,
    s = e.password || e.auth || e["auth-str"];
  if (!r || !s) return "";
  var a = [];
  return (
    pushParam(a, "sni", e.sni || e.servername || e.serverName || e.peer),
    pushParam(
      a,
      "insecure",
      truthy(e.insecure || e["skip-cert-verify"] || e.skipCertVerify)
        ? "1"
        : ""
    ),
    pushParam(a, "obfs", e.obfs),
    pushParam(
      a,
      "obfs-password",
      e.obfsPassword || e["obfs-password"] || e.obfs_password
    ),
    pushParam(a, "alpn", e.alpn),
    pushParam(a, "upmbps", e.up || e.upmbps || e["up-mbps"]),
    pushParam(a, "downmbps", e.down || e.downmbps || e["down-mbps"]),
    "hy2://" +
      encodeURIComponent(s) +
      "@" +
      r +
      ":" +
      t +
      (a.length ? "?" + a.join("&") : "") +
      "#" +
      encodeURIComponent(bestName(e.name, e.remarks, e.remark, e.ps, e.tag, r))
  );
}
function buildTrojanLink(e) {
  var r = e.host || e.server || e.address,
    t = parseInt(e.port || e.server_port || 443, 10) || 443,
    s = e.password;
  if (!r || !s) return "";
  var a = [],
    o = e.type || e.network || "tcp";
  return (
    e.security && "tls" !== e.security && pushParam(a, "security", e.security),
    o && "tcp" !== o && pushParam(a, "type", o),
    pushParam(a, "sni", e.sni || e.servername || e.serverName),
    pushParam(a, "fp", e.fp || e.fingerprint || e.clientFingerprint),
    pushParam(a, "path", e.path),
    pushParam(a, "host", e.hostHeader || e.host_header),
    pushParam(a, "serviceName", e.serviceName),
    pushParam(a, "alpn", e.alpn),
    pushParam(
      a,
      "allowInsecure",
      truthy(e.insecure || e["skip-cert-verify"] || e.skipCertVerify)
        ? "1"
        : ""
    ),
    "trojan://" +
      encodeURIComponent(s) +
      "@" +
      r +
      ":" +
      t +
      (a.length ? "?" + a.join("&") : "") +
      "#" +
      encodeURIComponent(bestName(e.name, e.remarks, e.remark, e.ps, e.tag, r))
  );
}
function buildVmessLink(e) {
  var r = e.host || e.server || e.address,
    t = parseInt(e.port || e.server_port || 443, 10) || 443,
    s = e.uuid || e.id;
  if (!r || !s) return "";
  var a = {
    v: "2",
    ps: bestName(e.name, e.remarks, e.remark, e.ps, e.tag, r),
    add: String(r),
    port: String(t),
    id: String(s),
    aid: String(parseInt(e.aid || e.alterId || e.alter_id || 0, 10) || 0),
    scy: String(e.scy || e.cipher || e.security || "auto"),
    net: String(e.net || e.network || "tcp"),
    type: "none",
    host: String(e.hostHeader || e.host_header || ""),
    path: String(e.path || ""),
    tls: truthy(e.tls) || "tls" === e.tls ? "tls" : "",
    sni: String(e.sni || e.servername || ""),
    alpn: String(e.alpn || ""),
    fp: String(e.fp || ""),
  };
  try {
    return (
      "vmess://" + bufferFrom(JSON.stringify(a), "utf8").toString("base64")
    );
  } catch (e) {
    return "";
  }
}
function buildSsLink(e) {
  var r,
    t = e.host || e.server || e.address,
    s = parseInt(e.port || e.server_port || 8388, 10) || 8388,
    a = e.method || e.cipher,
    o = e.password;
  if (!t || !a || !o) return "";
  try {
    r = bufferFrom(a + ":" + o, "utf8")
      .toString("base64")
      .replace(/[+]/g, "-")
      .replace(/[/]/g, "_")
      .replace(/=+$/, "");
  } catch (e) {
    return "";
  }
  return (
    "ss://" +
    r +
    "@" +
    t +
    ":" +
    s +
    "#" +
    encodeURIComponent(bestName(e.name, e.remarks, e.remark, e.ps, e.tag, t))
  );
}
function buildSocksLink(e) {
  var r = e.host || e.server || e.address,
    t = parseInt(e.port || e.server_port || 1080, 10) || 1080;
  if (!r) return "";
  var s = "",
    a = e.user || e.username,
    o = e.pass || e.password;
  return (
    a &&
      (s =
        encodeURIComponent(a) + (o ? ":" + encodeURIComponent(o) : "") + "@"),
    "socks5://" +
      s +
      r +
      ":" +
      t +
      "#" +
      encodeURIComponent(bestName(e.name, e.remarks, e.remark, e.ps, e.tag, r))
  );
}
function addUniqueLink(e, r, t) {
  if (
    ((t = htmlEntityDecode(
      (t = safeText(t, 16e3).replace(/^["'`]+|["'`,;\]\)]+$/g, ""))
    )),
    /^(vless|hy2|hysteria2|hysteria|trojan|vmess|ss|socks5?):\/\//i.test(t))
  ) {
    try {
      parseProxyLink(t);
    } catch (e) {
      return;
    }
    var s = profileKeyFromLink(t);
    r[s] || ((r[s] = !0), e.push(t));
  }
}
function parseClashVless(e, r, t) {
  var s,
    a,
    o,
    n,
    i,
    p,
    l,
    c,
    u = String(e || "").split(/\r?\n/),
    d = [],
    m = null,
    h = "",
    f = /^\s*proxies\s*:\s*(?:#.*)?$/im.test(String(e || "")),
    g = !f,
    y = -1,
    v = -1,
    k = -1;
  function b() {
    (m && (d.push(m), (m = null)), (h = ""), (k = -1));
  }
  for (s = 0; s < u.length; s++)
    if (
      ((c = (a = u[s].replace(/\t/g, "  ")).trim()),
      (l = a.length - a.replace(/^\s+/, "").length),
      f && /^\s*proxies\s*:\s*(?:#.*)?$/i.test(a))
    )
      (b(), (g = !0), (y = l), (v = -1));
    else if (
      (f &&
        g &&
        c &&
        "#" !== c.charAt(0) &&
        l <= y &&
        /^[A-Za-z0-9_.-]+\s*:/.test(c) &&
        (b(), (g = !1)),
      g && c && "#" !== c.charAt(0))
    ) {
      if (/^\s*-\s+/.test(a)) {
        if ((v < 0 && (v = l), l !== v)) {
          if (m && "alpn" === h && l > k) {
            var S = normalizeYamlList(a.replace(/^\s*-\s+/, ""));
            S && (m.alpn = m.alpn ? m.alpn + "," + S : S);
          }
          continue;
        }
        if (
          (b(),
          (m = {}),
          "{" === (a = a.replace(/^\s*-\s+/, "").trim()).charAt(0) &&
            "}" === a.charAt(a.length - 1))
        ) {
          ((p = parseInlineMap(a)),
            Object.keys(p).forEach(function (e) {
              h = applyYamlKey(m, h, e, p[e]);
            }));
          continue;
        }
      }
      if (m && (o = a.match(/^\s*([A-Za-z0-9_.-]+)\s*:\s*(.*)$/))) {
        ((n = o[1].toLowerCase()),
          (i = o[2]),
          h && k >= 0 && l <= k && ((h = ""), (k = -1)));
        var w = h;
        ((h = applyYamlKey(m, h, n, i)) && h !== w && (k = l), h || (k = -1));
      }
    }
  for (b(), s = 0; s < d.length; s++) {
    var L = d[s],
      N = String(L.proto || "").toLowerCase();
    "vless" === N
      ? addUniqueLink(
          r,
          t,
          buildVlessLink({
            name: L.name,
            uuid: L.uuid,
            host: L.host,
            port: L.port,
            network: L.network || "tcp",
            security: L.publicKey ? "reality" : truthy(L.tls) ? "tls" : "none",
            sni: L.sni,
            fp: L.fp,
            pbk: L.publicKey,
            sid: L.shortId,
            flow: L.flow,
            path: L.path,
            hostHeader: L.hostHeader,
            serviceName: L.serviceName,
            mode: L.mode,
            alpn: L.alpn,
          })
        )
      : "hysteria2" === N || "hy2" === N || "hysteria" === N
        ? addUniqueLink(
            r,
            t,
            buildHysteria2Link({
              name: L.name,
              password: L.password,
              host: L.host,
              port: L.port,
              sni: L.sni,
              insecure: L.insecure,
              obfs: L.obfs,
              obfsPassword: L.obfsPassword,
              alpn: L.alpn,
              up: L.up,
              down: L.down,
            })
          )
        : "trojan" === N
          ? addUniqueLink(
              r,
              t,
              buildTrojanLink({
                name: L.name,
                password: L.password,
                host: L.host,
                port: L.port,
                sni: L.sni,
                network: L.network || "tcp",
                path: L.path,
                hostHeader: L.hostHeader,
                serviceName: L.serviceName,
                insecure: L.insecure,
                alpn: L.alpn,
                fp: L.fp,
              })
            )
          : "ss" === N
            ? addUniqueLink(
                r,
                t,
                buildSsLink({
                  name: L.name,
                  method: L.cipher,
                  password: L.password,
                  host: L.host,
                  port: L.port,
                })
              )
            : "vmess" === N
              ? addUniqueLink(
                  r,
                  t,
                  buildVmessLink({
                    name: L.name,
                    uuid: L.uuid,
                    host: L.host,
                    port: L.port,
                    aid: L.alterId || 0,
                    scy: L.cipher || "auto",
                    network: L.network || "tcp",
                    tls: L.tls,
                    sni: L.sni,
                    path: L.serviceName || L.path,
                    hostHeader: L.hostHeader,
                    alpn: L.alpn,
                    fp: L.fp,
                  })
                )
              : ("socks5" !== N && "socks" !== N) ||
                addUniqueLink(
                  r,
                  t,
                  buildSocksLink({
                    name: L.name,
                    user: L.username,
                    pass: L.password,
                    host: L.host,
                    port: L.port,
                  })
                );
  }
}
function parseJsonVless(e, r, t) {
  var s;
  try {
    s = JSON.parse(String(e || "").trim());
  } catch (e) {
    return;
  }
  function a(e, r) {
    var t;
    if ("[object Array]" === Object.prototype.toString.call(e))
      for (t = 0; t < e.length; t++) r(e[t]);
  }
  function o(e) {
    return e && "object" == typeof e
      ? descriptiveName(
          e.name,
          e.remarks,
          e.remark,
          e.ps,
          e.title,
          e.label,
          e.displayName,
          e.display_name,
          e.tag
        )
      : "";
  }
  !(function e(s, n) {
    var i, p, l;
    if (s && "object" == typeof s) {
      ((p = (function (e) {
        return e && "object" == typeof e
          ? bestName(
              e.name,
              e.remarks,
              e.remark,
              e.ps,
              e.title,
              e.label,
              e.displayName,
              e.display_name,
              e.profileName,
              e.profile_name,
              e.serverName,
              e.server_name,
              e.meta && e.meta.name,
              e.meta && e.meta.remarks,
              e.metadata && e.metadata.name,
              e.metadata && e.metadata.remarks
            )
          : "";
      })(s)),
        (l = bestName(p, n)));
      var c = String(s.type || s.protocol || "").toLowerCase();
      if ("vless" === c) {
        var u = s.tls || {},
          d = u.reality || {},
          m = s.transport || {};
        addUniqueLink(
          r,
          t,
          buildVlessLink({
            name: jsonProfileName(o(s), n, s.server || s.address),
            uuid: s.uuid,
            host: s.server || s.address,
            port: s.server_port || s.port,
            network: m.type || s.network || "tcp",
            security: d.enabled ? "reality" : u.enabled ? "tls" : "none",
            sni: u.server_name || s.server_name,
            fp: u.utls && u.utls.fingerprint,
            pbk: d.public_key,
            sid: d.short_id,
            flow: s.flow,
            path: m.path,
            hostHeader: m.headers && (m.headers.Host || m.headers.host),
            serviceName: m.service_name || m.serviceName,
            mode: m.mode,
          })
        );
      } else if ("hysteria2" === c || "hy2" === c || "hysteria" === c) {
        var h = s.tls || {},
          f = s.obfs || {};
        addUniqueLink(
          r,
          t,
          buildHysteria2Link({
            name: jsonProfileName(o(s), n, s.server || s.address),
            password: s.password || s.auth || s.auth_str,
            host: s.server || s.address,
            port: s.server_port || s.port,
            sni: h.server_name || s.server_name || s.sni,
            insecure: h.insecure || s.insecure,
            obfs: f.type || s.obfs_type || s.obfs,
            obfsPassword: f.password || s.obfs_password,
            alpn: h.alpn,
            up: s.up_mbps || s.upmbps,
            down: s.down_mbps || s.downmbps,
          })
        );
      } else if ("trojan" === c) {
        var g = s.tls || {},
          y = s.transport || {};
        addUniqueLink(
          r,
          t,
          buildTrojanLink({
            name: jsonProfileName(o(s), n, s.server || s.address),
            password: s.password,
            host: s.server || s.address,
            port: s.server_port || s.port,
            sni: g.server_name || s.sni,
            insecure: g.insecure || s.insecure,
            network: y.type || s.network || "tcp",
            path: y.path,
            hostHeader: y.headers && (y.headers.Host || y.headers.host),
            serviceName: y.service_name || y.serviceName,
            alpn: g.alpn,
            fp: g.utls && g.utls.fingerprint,
          })
        );
      } else if ("vmess" === c) {
        var v = s.tls || {},
          k = s.transport || {};
        addUniqueLink(
          r,
          t,
          buildVmessLink({
            name: jsonProfileName(o(s), n, s.server || s.address),
            uuid: s.uuid,
            host: s.server || s.address,
            port: s.server_port || s.port,
            aid: s.alter_id || s.alterId || 0,
            scy: s.security || "auto",
            network: k.type || s.network || "tcp",
            tls: v.enabled,
            sni: v.server_name,
            path: k.service_name || k.serviceName || k.path,
            hostHeader: k.headers && (k.headers.Host || k.headers.host),
            alpn: v.alpn,
            fp: v.utls && v.utls.fingerprint,
          })
        );
      } else
        "shadowsocks" === c ||
        "ss" === c ||
        (!c && s.server && (s.server_port || s.port) && s.method && s.password)
          ? addUniqueLink(
              r,
              t,
              buildSsLink({
                name: jsonProfileName(o(s), n, s.server || s.address),
                method: s.method,
                password: s.password,
                host: s.server || s.address,
                port: s.server_port || s.port,
              })
            )
          : ("socks" !== c && "socks5" !== c) ||
            addUniqueLink(
              r,
              t,
              buildSocksLink({
                name: jsonProfileName(o(s), n, s.server || s.address),
                user: s.username,
                pass: s.password,
                host: s.server || s.address,
                port: s.server_port || s.port,
              })
            );
      if (
        "vless" === String(s.protocol || "").toLowerCase() &&
        s.settings &&
        s.settings.vnext
      )
        a(s.settings.vnext, function (e) {
          a(e.users, function (a) {
            var i = s.streamSettings || {},
              p = i.realitySettings || {},
              l = i.tlsSettings || {},
              c = i.grpcSettings || {},
              u = i.wsSettings || {},
              d = i.httpSettings || {},
              m = i.xhttpSettings || i.splithttpSettings || {},
              h = m.path || u.path || d.path || "",
              f =
                m.host ||
                (u.headers && (u.headers.Host || u.headers.host)) ||
                (d.host && d.host[0]) ||
                "";
            addUniqueLink(
              r,
              t,
              buildVlessLink({
                name: jsonProfileName(
                  descriptiveName(o(s), a.email),
                  n,
                  e.address
                ),
                uuid: a.id,
                host: e.address,
                port: e.port,
                network: i.network || "tcp",
                security: i.security || "none",
                sni: p.serverName || l.serverName,
                fp: p.fingerprint,
                pbk: p.publicKey,
                sid: p.shortId,
                spx: p.spiderX,
                flow: a.flow,
                path: h,
                hostHeader: f,
                serviceName: c.serviceName || c.service_name,
                mode: m.mode,
              })
            );
          });
        });
      else if (
        "vmess" === String(s.protocol || "").toLowerCase() &&
        s.settings &&
        s.settings.vnext
      )
        a(s.settings.vnext, function (e) {
          a(e.users, function (a) {
            var i = s.streamSettings || {},
              p = i.tlsSettings || {},
              l = i.grpcSettings || {},
              c = i.wsSettings || {};
            addUniqueLink(
              r,
              t,
              buildVmessLink({
                name: jsonProfileName(
                  descriptiveName(o(s), a.email),
                  n,
                  e.address
                ),
                uuid: a.id,
                host: e.address,
                port: e.port,
                aid: a.alterId || 0,
                scy: a.security || "auto",
                network: i.network || "tcp",
                tls: "tls" === i.security,
                sni: p.serverName,
                path: "grpc" === i.network ? l.serviceName || "" : c.path || "",
                hostHeader: c.headers && (c.headers.Host || c.headers.host),
                alpn: p.alpn,
                fp: p.fingerprint,
              })
            );
          });
        });
      else if (
        "trojan" === String(s.protocol || "").toLowerCase() &&
        s.settings &&
        s.settings.servers
      )
        a(s.settings.servers, function (e) {
          var a = s.streamSettings || {},
            i = a.tlsSettings || {},
            p = a.grpcSettings || {},
            l = a.wsSettings || {};
          addUniqueLink(
            r,
            t,
            buildTrojanLink({
              name: jsonProfileName(
                descriptiveName(o(s), e.email),
                n,
                e.address
              ),
              password: e.password,
              host: e.address,
              port: e.port,
              security: a.security || "tls",
              network: a.network || "tcp",
              sni: i.serverName,
              fp: i.fingerprint,
              path: l.path,
              hostHeader: l.headers && (l.headers.Host || l.headers.host),
              serviceName: p.serviceName,
            })
          );
        });
      else if (
        "shadowsocks" === String(s.protocol || "").toLowerCase() &&
        s.settings &&
        s.settings.servers
      )
        a(s.settings.servers, function (e) {
          addUniqueLink(
            r,
            t,
            buildSsLink({
              name: jsonProfileName(o(s), n, e.address),
              method: e.method,
              password: e.password,
              host: e.address,
              port: e.port,
            })
          );
        });
      else if (
        "socks" === String(s.protocol || "").toLowerCase() &&
        s.settings &&
        s.settings.servers
      )
        a(s.settings.servers, function (e) {
          var a = (e.users && e.users[0]) || {};
          addUniqueLink(
            r,
            t,
            buildSocksLink({
              name: jsonProfileName(o(s), n, e.address),
              user: a.user,
              pass: a.pass,
              host: e.address,
              port: e.port,
            })
          );
        });
      else if (
        "hysteria" === String(s.protocol || "").toLowerCase() &&
        s.settings
      ) {
        var b = (s.streamSettings && s.streamSettings.hysteriaSettings) || {},
          S = (s.streamSettings && s.streamSettings.tlsSettings) || {};
        addUniqueLink(
          r,
          t,
          buildHysteria2Link({
            name: jsonProfileName(o(s), n, s.settings.address),
            password: b.auth,
            host: s.settings.address,
            port: s.settings.port,
            sni: S.serverName,
            insecure: S.allowInsecure,
            obfs: b.obfs && b.obfs.type,
            obfsPassword: b.obfs && b.obfs.password,
            alpn: S.alpn,
          })
        );
      }
      for (i in s) Object.prototype.hasOwnProperty.call(s, i) && e(s[i], l);
    }
  })(s, "");
}
function looksLikeProxyContent(e, r) {
  return (
    (e = String(e || "")),
    (r = String(r || "")),
    /vless:\/\//i.test(e) ||
      /vmess:\/\//i.test(e) ||
      /trojan:\/\//i.test(e) ||
      /ss:\/\//i.test(e) ||
      /socks5?:\/\//i.test(e) ||
      /hysteria2?:\/\//i.test(e) ||
      /hy2:\/\//i.test(e) ||
      /tuic:\/\//i.test(e) ||
      /(?:wireguard|wg):\/\//i.test(e) ||
      /^\s*https?:\/\/[^\s]+\s*$/i.test(e) ||
      e.split("\n").length > r.split("\n").length ||
      /^\s*[\[{]/.test(e)
  );
}
function decodeBase64Candidate(e, r) {
  for (
    var t = String(e || "")
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    t.length % 4;
  )
    t += "=";
  try {
    var s = bufferFrom(t, "base64").toString("utf8");
    if (looksLikeProxyContent(s, r)) return s;
  } catch (e) {}
  return "";
}
function safeBase64Decode(e) {
  var r,
    t,
    s = String(e || "").trim(),
    a = s.replace(/\s+/g, "");
  return !a ||
    a.length < 8 ||
    /^\s*[\[{]/.test(s) ||
    /(?:vless|hy2|hysteria2|hysteria|trojan|vmess|ss|socks5?):\/\//i.test(s) ||
    /^\s*(proxies|proxy-providers|outbounds)\s*:/im.test(s) ||
    /^\s*-\s+/.test(s)
    ? s
    : (/^[A-Za-z0-9+/_=-]+$/.test(a) && (t = decodeBase64Candidate(a, s))) ||
        ((r = s.replace(/[^A-Za-z0-9+/_=-]/g, "")).length >= 16 &&
          r.length > 0.55 * a.length &&
          (t = decodeBase64Candidate(r, s)))
      ? t
      : s;
}
function parseContentHeaders(e) {
  var r,
    t,
    s,
    a,
    o,
    n = {},
    i = safeBase64Decode(e).split(/\r?\n/),
    p = i.length < 10 ? i.length : 10;
  for (r = 0; r < p; r++)
    (0 !== (t = i[r] || "").indexOf("#") && 0 !== t.indexOf("//")) ||
      (s = t.indexOf(":")) < 0 ||
      ((a = t
        .slice(0, s)
        .replace(/^#|^\/\//, "")
        .trim()
        .toLowerCase()),
      (o = t.slice(s + 1).trim()),
      a && (n[a] = o));
  return n;
}
function profileTitleFromHeaders(e, r) {
  var t,
    s = e["profile-title"] || e["content-disposition"] || "";
  if (0 === s.indexOf("base64:"))
    try {
      s = bufferFrom(s.replace(/^base64:/, ""), "base64").toString("utf8");
    } catch (e) {}
  return (
    (t = String(s).match(/filename="([^"]+)"/)) && (s = t[1]),
    (s = safeText(s, 80)) || r || ""
  );
}
function parseQuery(e) {
  var r,
    t,
    s,
    a,
    o,
    n = {},
    i = String(e || "").split("&");
  for (r = 0; r < i.length; r++)
    if ((t = i[r])) {
      ((a = (s = t.indexOf("=")) >= 0 ? t.slice(0, s) : t),
        (o = s >= 0 ? t.slice(s + 1) : ""));
      try {
        n[decodeURIComponent(a)] = decodeURIComponent(o.replace(/\+/g, "%20"));
      } catch (e) {
        n[a] = o;
      }
    }
  return n;
}
function parseHostPort(e, r) {
  var t,
    s,
    a = e,
    o = r || 443;
  return (
    "[" === e.charAt(0)
      ? ((t = e.indexOf("]")),
        (a = e.slice(1, t)),
        ":" === e.slice(t + 1, t + 2) && (o = parseInt(e.slice(t + 2), 10)))
      : (s = e.lastIndexOf(":")) > -1 &&
        ((a = e.slice(0, s)), (o = parseInt(e.slice(s + 1), 10))),
    { host: a, port: o }
  );
}
function parseVless(e) {
  if (((e = safeText(e, 16e3)), !/^vless:\/\//i.test(e)))
    throw locErr("INVALID_LINK", "vless expected");
  var r,
    t,
    s = e.replace(/^vless:\/\//i, "").split("#"),
    a = s[1] ? cleanServerName(s.slice(1).join("#")) : "",
    o = s[0],
    n = o.indexOf("?"),
    i = n >= 0 ? o.slice(0, n) : o,
    p = n >= 0 ? o.slice(n + 1) : "",
    l = i.lastIndexOf("@");
  if (l < 0) throw locErr("INVALID_LINK", "missing user@host:port");
  if (
    ((r = i.slice(0, l)),
    (t = parseHostPort(i.slice(l + 1), 443)),
    !r || !t.host || !t.port)
  )
    throw locErr("INVALID_LINK", "malformed link");
  var c = parseQuery(p);
  return (
    (a = bestName(a, c.name, c.remarks, c.remark, c.ps, c.title)),
    {
      protocol: "vless",
      uuid: r,
      host: t.host,
      port: t.port,
      params: c,
      name: a,
    }
  );
}
function parseHysteria2(e) {
  if (((e = safeText(e, 16e3)), !/^(hy2|hysteria2|hysteria):\/\//i.test(e)))
    throw locErr("INVALID_LINK", "hysteria2 expected");
  var r,
    t,
    s = e.replace(/^(hy2|hysteria2|hysteria):\/\//i, "").split("#"),
    a = s[1] ? cleanServerName(s.slice(1).join("#")) : "",
    o = s[0],
    n = o.indexOf("?"),
    i = n >= 0 ? o.slice(0, n) : o,
    p = n >= 0 ? o.slice(n + 1) : "",
    l = i.lastIndexOf("@"),
    c = "",
    u = i;
  if (
    (l >= 0 && ((c = decodeUrlPart(i.slice(0, l))), (u = i.slice(l + 1))),
    (r = parseHostPort(u, 443)),
    (t = parseQuery(p)),
    (c = c || t.auth || t.password || t["auth-str"] || ""),
    !r.host || !r.port || !c)
  )
    throw locErr("INVALID_LINK", "malformed hysteria2 link");
  return (
    (a = bestName(a, t.name, t.remarks, t.remark, t.ps, t.title, r.host)),
    {
      protocol: "hysteria2",
      password: c,
      host: r.host,
      port: r.port,
      params: t,
      name: a,
    }
  );
}
function b64DecodeLoose(e) {
  for (
    e = String(e || "")
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .replace(/\s+/g, "");
    e.length % 4;
  )
    e += "=";
  try {
    return bufferFrom(e, "base64").toString("utf8");
  } catch (e) {
    return "";
  }
}
function splitLinkParts(e, r) {
  var t = safeText(e, 16e3).replace(r, "").split("#"),
    s = t[1] ? cleanServerName(t.slice(1).join("#")) : "",
    a = t[0],
    o = a.indexOf("?");
  return {
    name: s,
    authority: o >= 0 ? a.slice(0, o) : a,
    query: o >= 0 ? a.slice(o + 1) : "",
  };
}
function parseTrojan(e) {
  if (!/^trojan:\/\//i.test(String(e || "")))
    throw locErr("INVALID_LINK", "unsupported protocol");
  var r = splitLinkParts(e, /^trojan:\/\//i),
    t = r.authority.lastIndexOf("@");
  if (t < 0) throw locErr("INVALID_LINK", "missing user@host:port");
  var s = decodeUrlPart(r.authority.slice(0, t)),
    a = parseHostPort(r.authority.slice(t + 1), 443),
    o = parseQuery(r.query);
  if (!s || !a.host || !a.port) throw locErr("INVALID_LINK", "malformed link");
  var n = bestName(r.name, o.name, o.remarks, o.remark, o.ps, a.host);
  return {
    protocol: "trojan",
    password: s,
    host: a.host,
    port: a.port,
    params: o,
    name: n,
  };
}
function parseVmess(e) {
  if (!/^vmess:\/\//i.test(String(e || "")))
    throw locErr("INVALID_LINK", "unsupported protocol");
  var r = splitLinkParts(e, /^vmess:\/\//i),
    t = null;
  try {
    t = JSON.parse(b64DecodeLoose(r.authority));
  } catch (e) {
    t = null;
  }
  if (t && (t.add || t.host) && t.id) {
    var s = String(t.net || "tcp").toLowerCase(),
      a = "tls" === String(t.tls || "").toLowerCase() || !0 === t.tls,
      o = {
        security: a ? "tls" : "none",
        type: s,
        sni: String(t.sni || (a && t.host) || ""),
        path: String(t.path || ""),
        host: String(t.host || ""),
        alpn: String(t.alpn || ""),
        fp: String(t.fp || ""),
      };
    "grpc" === s && (o.serviceName = String(t.path || ""));
    var n = parseInt(t.port, 10);
    if (!n || (!t.add && !t.host))
      throw locErr("INVALID_LINK", "malformed link");
    return {
      protocol: "vmess",
      uuid: String(t.id),
      host: String(t.add || t.host),
      port: n,
      aid: parseInt(t.aid, 10) || 0,
      scy: String(t.scy || t.security || "auto"),
      params: o,
      name: bestName(String(t.ps || ""), r.name, String(t.add || t.host)),
    };
  }
  var i = r.authority.lastIndexOf("@");
  if (i < 0) throw locErr("INVALID_LINK", "missing user@host:port");
  var p = decodeUrlPart(r.authority.slice(0, i)),
    l = parseHostPort(r.authority.slice(i + 1), 443),
    c = parseQuery(r.query);
  if (!p || !l.host || !l.port) throw locErr("INVALID_LINK", "malformed link");
  return {
    protocol: "vmess",
    uuid: p,
    host: l.host,
    port: l.port,
    aid: parseInt(c.aid, 10) || 0,
    scy: String(c.scy || c.encryption || "auto"),
    params: c,
    name: bestName(r.name, c.name, c.remarks, l.host),
  };
}
function parseSs(e) {
  if (!/^ss:\/\//i.test(String(e || "")))
    throw locErr("INVALID_LINK", "unsupported protocol");
  var r = splitLinkParts(e, /^ss:\/\//i),
    t = r.authority.replace(/\/$/, ""),
    s = "",
    a = "",
    o = null,
    n = t.lastIndexOf("@");
  if (n >= 0) {
    var i = b64DecodeLoose(t.slice(0, n));
    (!i || i.indexOf(":") < 0) && (i = decodeUrlPart(t.slice(0, n)));
    var p = i.indexOf(":");
    if (p < 0) throw locErr("INVALID_LINK", "malformed link");
    ((s = i.slice(0, p)),
      (a = i.slice(p + 1)),
      (o = parseHostPort(t.slice(n + 1), 8388)));
  } else {
    var l = b64DecodeLoose(t),
      c = l.lastIndexOf("@");
    if (c < 0) throw locErr("INVALID_LINK", "malformed link");
    var u = l.slice(0, c),
      d = u.indexOf(":");
    if (d < 0) throw locErr("INVALID_LINK", "malformed link");
    ((s = u.slice(0, d)),
      (a = u.slice(d + 1)),
      (o = parseHostPort(l.slice(c + 1), 8388)));
  }
  var m = parseQuery(r.query);
  if (!(s && a && o.host && o.port))
    throw locErr("INVALID_LINK", "malformed link");
  var h = bestName(r.name, m.name, m.remarks, o.host);
  return {
    protocol: "ss",
    method: s.toLowerCase(),
    password: a,
    host: o.host,
    port: o.port,
    params: m,
    name: h,
  };
}
function parseSocks(e) {
  if (!/^socks5?:\/\//i.test(String(e || "")))
    throw locErr("INVALID_LINK", "unsupported protocol");
  var r = splitLinkParts(e, /^socks5?:\/\//i),
    t = "",
    s = "",
    a = r.authority,
    o = a.lastIndexOf("@");
  if (o >= 0) {
    var n = a.slice(0, o);
    if (n.indexOf(":") < 0) {
      var i = b64DecodeLoose(n);
      i && i.indexOf(":") >= 0 && (n = i);
    }
    var p = n.indexOf(":");
    ((t = decodeUrlPart(p >= 0 ? n.slice(0, p) : n)),
      (s = p >= 0 ? decodeUrlPart(n.slice(p + 1)) : ""),
      (a = a.slice(o + 1)));
  }
  var l = parseHostPort(a, 1080);
  if (!l.host || !l.port) throw locErr("INVALID_LINK", "malformed link");
  var c = bestName(r.name, l.host);
  return {
    protocol: "socks",
    user: t,
    pass: s,
    host: l.host,
    port: l.port,
    params: parseQuery(r.query),
    name: c,
  };
}
function parseProxyLink(e) {
  var r = String(e || "");
  if (/^vless:\/\//i.test(r)) return parseVless(e);
  if (/^(hy2|hysteria2|hysteria):\/\//i.test(r)) return parseHysteria2(e);
  if (/^trojan:\/\//i.test(r)) return parseTrojan(e);
  if (/^vmess:\/\//i.test(r)) return parseVmess(e);
  if (/^ss:\/\//i.test(r)) return parseSs(e);
  if (/^socks5?:\/\//i.test(r)) return parseSocks(e);
  throw locErr("INVALID_LINK", "unsupported protocol");
}
var PROTO_RE = /^(vless|hy2|hysteria2|hysteria|trojan|vmess|ss|socks5?):\/\//i,
  PROTO_BADGE = {
    vless: "VLESS",
    hysteria2: "HYSTERIA2",
    trojan: "TROJAN",
    vmess: "VMESS",
    ss: "SS",
    socks: "SOCKS5",
  };
function inferName(e) {
  try {
    var r = parseProxyLink(e);
    return bestName(r.name, r.host) || r.host;
  } catch (e) {
    return "VPN profile";
  }
}
function summary(e) {
  try {
    var r = parseProxyLink(e),
      t = r.host + ":" + r.port;
    return "hysteria2" === r.protocol
      ? t + " · hysteria2"
      : "trojan" === r.protocol
        ? t + " · trojan · " + (r.params.type || r.params.network || "tcp")
        : "vmess" === r.protocol
          ? t +
            " · vmess · " +
            (r.params.security || "none") +
            " · " +
            (r.params.type || "tcp")
          : "ss" === r.protocol
            ? t + " · shadowsocks · " + r.method
            : "socks" === r.protocol
              ? t + " · socks5" + (r.user ? " · auth" : "")
              : t +
                " · " +
                (r.params.security || "none") +
                " · " +
                (r.params.type || r.params.network || "tcp");
  } catch (r) {
    return e;
  }
}
function validateLink(e) {
  if (!e) throw locErr("INVALID_LINK", "empty link");
  if (!PROTO_RE.test(e)) throw locErr("INVALID_LINK", "unsupported protocol");
  if (e.length > 16e3) throw locErr("INVALID_LINK", "link too long");
  parseProxyLink(e);
}
function paramsIdentity(e) {
  var r,
    t,
    s = { name: 1, remarks: 1, remark: 1, ps: 1, title: 1 },
    a = [],
    o = [];
  for (r in (e = e || {}))
    Object.prototype.hasOwnProperty.call(e, r) &&
      !s[String(r).toLowerCase()] &&
      a.push(r);
  for (
    a.sort(function (e, r) {
      return (e = String(e).toLowerCase()) < (r = String(r).toLowerCase())
        ? -1
        : e > r
          ? 1
          : 0;
    }),
      t = 0;
    t < a.length;
    t++
  )
    o.push([String(a[t]).toLowerCase(), String(e[a[t]])]);
  return JSON.stringify(o);
}
function profileKeyFromLink(e) {
  try {
    var r = parseProxyLink(e),
      t = r.params || {};
    return "hysteria2" === r.protocol
      ? [
          "hysteria2",
          String(r.password || ""),
          String(r.host || "").toLowerCase(),
          String(r.port || ""),
          paramsIdentity(t),
        ].join("|")
      : "trojan" === r.protocol
        ? [
            "trojan",
            String(r.password || ""),
            String(r.host || "").toLowerCase(),
            String(r.port || ""),
            paramsIdentity(t),
          ].join("|")
        : "vmess" === r.protocol
          ? [
              "vmess",
              String(r.uuid || "").toLowerCase(),
              String(r.host || "").toLowerCase(),
              String(r.port || ""),
              String(r.aid || 0),
              String(r.scy || "auto").toLowerCase(),
              paramsIdentity(t),
            ].join("|")
          : "ss" === r.protocol
            ? [
                "ss",
                String(r.method || ""),
                String(r.password || ""),
                String(r.host || "").toLowerCase(),
                String(r.port || ""),
                paramsIdentity(t),
              ].join("|")
            : "socks" === r.protocol
              ? [
                  "socks",
                  String(r.user || ""),
                  String(r.pass || ""),
                  String(r.host || "").toLowerCase(),
                  String(r.port || ""),
                  paramsIdentity(t),
                ].join("|")
              : [
                  "vless",
                  String(r.uuid || "").toLowerCase(),
                  String(r.host || "").toLowerCase(),
                  String(r.port || ""),
                  paramsIdentity(t),
                ].join("|");
  } catch (r) {
    return "raw|" + String(e || "").split("#")[0];
  }
}
function profileKey(e) {
  return e && e.sourceKey
    ? String(e.sourceKey)
    : e && e.fullConfig && e.id
      ? "fullConfig|" + String(e.id)
      : profileKeyFromLink((e && e.link) || e || "");
}
function profileStoreKey(e) {
  return e && e.subscriptionId
    ? "subscription|" + String(e.subscriptionId) + "|" + profileKey(e)
    : "single|" + profileKey(e);
}
function dedupeProfilesInStore(e) {
  var r,
    t,
    s,
    a,
    o = e.activeId,
    n = "",
    i = {},
    p = [];
  if (!e || "[object Array]" !== Object.prototype.toString.call(e.profiles))
    return e;
  for (r = 0; r < e.profiles.length; r++)
    e.profiles[r] &&
      e.profiles[r].id === o &&
      (n = profileStoreKey(e.profiles[r]));
  for (r = 0; r < e.profiles.length; r++)
    (t = e.profiles[r]) &&
      (t.link || t.fullConfig) &&
      (void 0 === i[(s = profileStoreKey(t))]
        ? ((i[s] = p.length), p.push(t))
        : ((a = i[s]),
          (t.id === o || (!p[a].name && t.name)) && ((p[a] = t), (i[s] = a))));
  if (((e.profiles = p), o)) {
    for (r = 0; r < p.length; r++) if (p[r].id === o) return e;
    if (n)
      for (r = 0; r < p.length; r++)
        if (profileStoreKey(p[r]) === n) return ((e.activeId = p[r].id), e);
  }
  return (
    (e.activeId &&
      p.some(function (r) {
        return r.id === e.activeId;
      })) ||
      (e.activeId = (p[0] && p[0].id) || null),
    e
  );
}
function cleanServerLabel(e) {
  return String(e || "")
    .replace(/[\uD83C][\uDDE6-\uDDFF][\uD83C][\uDDE6-\uDDFF]/g, "")
    .replace(/^[\s·|:-]+|[\s·|:-]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
function profileDisplayName(e) {
  return cleanServerLabel((e && (e.name || inferName(e.link))) || "");
}
var countries = require("../../countries"),
  COUNTRY_WORDS = [
    ["россия", "ru"],
    ["russia", "ru"],
    ["москва", "ru"],
    ["moscow", "ru"],
    ["петербург", "ru"],
    ["petersburg", "ru"],
    ["украина", "ua"],
    ["ukraine", "ua"],
    ["киев", "ua"],
    ["kyiv", "ua"],
    ["kiev", "ua"],
    ["беларусь", "by"],
    ["белоруссия", "by"],
    ["belarus", "by"],
    ["минск", "by"],
    ["minsk", "by"],
    ["казахстан", "kz"],
    ["kazakhstan", "kz"],
    ["алматы", "kz"],
    ["almaty", "kz"],
    ["астана", "kz"],
    ["astana", "kz"],
    ["германия", "de"],
    ["germany", "de"],
    ["deutschland", "de"],
    ["франкфурт", "de"],
    ["frankfurt", "de"],
    ["falkenstein", "de"],
    ["берлин", "de"],
    ["berlin", "de"],
    ["мюнхен", "de"],
    ["munich", "de"],
    ["нюрнберг", "de"],
    ["nuremberg", "de"],
    ["нидерланды", "nl"],
    ["голландия", "nl"],
    ["netherlands", "nl"],
    ["holland", "nl"],
    ["амстердам", "nl"],
    ["amsterdam", "nl"],
    ["франция", "fr"],
    ["france", "fr"],
    ["париж", "fr"],
    ["paris", "fr"],
    ["страсбург", "fr"],
    ["strasbourg", "fr"],
    ["финляндия", "fi"],
    ["finland", "fi"],
    ["хельсинки", "fi"],
    ["helsinki", "fi"],
    ["швеция", "se"],
    ["sweden", "se"],
    ["стокгольм", "se"],
    ["stockholm", "se"],
    ["швейцария", "ch"],
    ["switzerland", "ch"],
    ["цюрих", "ch"],
    ["zurich", "ch"],
    ["женева", "ch"],
    ["geneva", "ch"],
    ["польша", "pl"],
    ["poland", "pl"],
    ["варшава", "pl"],
    ["warsaw", "pl"],
    ["литва", "lt"],
    ["lithuania", "lt"],
    ["вильнюс", "lt"],
    ["vilnius", "lt"],
    ["латвия", "lv"],
    ["latvia", "lv"],
    ["рига", "lv"],
    ["riga", "lv"],
    ["эстония", "ee"],
    ["estonia", "ee"],
    ["таллин", "ee"],
    ["tallinn", "ee"],
    ["чехия", "cz"],
    ["czech", "cz"],
    ["прага", "cz"],
    ["prague", "cz"],
    ["австрия", "at"],
    ["austria", "at"],
    ["вена", "at"],
    ["vienna", "at"],
    ["австралия", "au"],
    ["australia", "au"],
    ["сидней", "au"],
    ["sydney", "au"],
    ["великобритания", "gb"],
    ["британия", "gb"],
    ["англия", "gb"],
    ["united kingdom", "gb"],
    ["britain", "gb"],
    ["england", "gb"],
    ["лондон", "gb"],
    ["london", "gb"],
    ["сша", "us"],
    ["америка", "us"],
    ["united states", "us"],
    ["usa", "us"],
    ["america", "us"],
    ["нью-йорк", "us"],
    ["new york", "us"],
    ["даллас", "us"],
    ["dallas", "us"],
    ["майами", "us"],
    ["miami", "us"],
    ["чикаго", "us"],
    ["chicago", "us"],
    ["сиэтл", "us"],
    ["seattle", "us"],
    ["ashburn", "us"],
    ["канада", "ca"],
    ["canada", "ca"],
    ["торонто", "ca"],
    ["toronto", "ca"],
    ["ванкувер", "ca"],
    ["vancouver", "ca"],
    ["япония", "jp"],
    ["japan", "jp"],
    ["токио", "jp"],
    ["tokyo", "jp"],
    ["осака", "jp"],
    ["osaka", "jp"],
    ["корея", "kr"],
    ["korea", "kr"],
    ["сеул", "kr"],
    ["seoul", "kr"],
    ["сингапур", "sg"],
    ["singapore", "sg"],
    ["гонконг", "hk"],
    ["hong kong", "hk"],
    ["hongkong", "hk"],
    ["тайвань", "tw"],
    ["taiwan", "tw"],
    ["тайбэй", "tw"],
    ["taipei", "tw"],
    ["турция", "tr"],
    ["turkey", "tr"],
    ["turkiye", "tr"],
    ["стамбул", "tr"],
    ["istanbul", "tr"],
    ["израиль", "il"],
    ["israel", "il"],
    ["эмираты", "ae"],
    ["оаэ", "ae"],
    ["emirates", "ae"],
    ["дубай", "ae"],
    ["dubai", "ae"],
    ["испания", "es"],
    ["spain", "es"],
    ["мадрид", "es"],
    ["madrid", "es"],
    ["барселона", "es"],
    ["barcelona", "es"],
    ["италия", "it"],
    ["italy", "it"],
    ["милан", "it"],
    ["milan", "it"],
    ["португалия", "pt"],
    ["portugal", "pt"],
    ["лиссабон", "pt"],
    ["lisbon", "pt"],
    ["ирландия", "ie"],
    ["ireland", "ie"],
    ["дублин", "ie"],
    ["dublin", "ie"],
    ["норвегия", "no"],
    ["norway", "no"],
    ["осло", "no"],
    ["oslo", "no"],
    ["дания", "dk"],
    ["denmark", "dk"],
    ["копенгаген", "dk"],
    ["copenhagen", "dk"],
    ["бельгия", "be"],
    ["belgium", "be"],
    ["брюссель", "be"],
    ["brussels", "be"],
    ["люксембург", "lu"],
    ["luxembourg", "lu"],
    ["венгрия", "hu"],
    ["hungary", "hu"],
    ["будапешт", "hu"],
    ["budapest", "hu"],
    ["румыния", "ro"],
    ["romania", "ro"],
    ["бухарест", "ro"],
    ["bucharest", "ro"],
    ["болгария", "bg"],
    ["bulgaria", "bg"],
    ["софия", "bg"],
    ["греция", "gr"],
    ["greece", "gr"],
    ["афины", "gr"],
    ["athens", "gr"],
    ["сербия", "rs"],
    ["serbia", "rs"],
    ["белград", "rs"],
    ["belgrade", "rs"],
    ["хорватия", "hr"],
    ["croatia", "hr"],
    ["словакия", "sk"],
    ["slovakia", "sk"],
    ["словения", "si"],
    ["slovenia", "si"],
    ["молдова", "md"],
    ["молдавия", "md"],
    ["moldova", "md"],
    ["грузия", "ge"],
    ["тбилиси", "ge"],
    ["tbilisi", "ge"],
    ["georgia", "ge"],
    ["армения", "am"],
    ["armenia", "am"],
    ["ереван", "am"],
    ["yerevan", "am"],
    ["азербайджан", "az"],
    ["azerbaijan", "az"],
    ["баку", "az"],
    ["baku", "az"],
    ["узбекистан", "uz"],
    ["uzbekistan", "uz"],
    ["ташкент", "uz"],
    ["tashkent", "uz"],
    ["киргизия", "kg"],
    ["кыргызстан", "kg"],
    ["kyrgyzstan", "kg"],
    ["бишкек", "kg"],
    ["bishkek", "kg"],
    ["индонезия", "id"],
    ["indonesia", "id"],
    ["индия", "in"],
    ["india", "in"],
    ["бразилия", "br"],
    ["brazil", "br"],
    ["аргентина", "ar"],
    ["argentina", "ar"],
    ["мексика", "mx"],
    ["mexico", "mx"],
    ["таиланд", "th"],
    ["thailand", "th"],
    ["вьетнам", "vn"],
    ["vietnam", "vn"],
    ["малайзия", "my"],
    ["malaysia", "my"],
    ["филиппины", "ph"],
    ["philippines", "ph"],
    ["исландия", "is"],
    ["iceland", "is"],
    ["кипр", "cy"],
    ["cyprus", "cy"],
    ["мальта", "mt"],
    ["malta", "mt"],
    ["албания", "al"],
    ["albania", "al"],
    ["босния", "ba"],
    ["bosnia", "ba"],
    ["македония", "mk"],
    ["macedonia", "mk"],
    ["черногория", "me"],
    ["montenegro", "me"],
    ["новая зеландия", "nz"],
    ["new zealand", "nz"],
    ["чили", "cl"],
    ["chile", "cl"],
    ["китай", "cn"],
    ["china", "cn"],
  ];
function detectCountry(e) {
  var r = String(e || "");
  if (!r) return "";
  var t = r.match(/[\uD83C][\uDDE6-\uDDFF][\uD83C][\uDDE6-\uDDFF]/);
  if (t) {
    var s = String.fromCharCode(
      97 + t[0].charCodeAt(1) - 56806,
      97 + t[0].charCodeAt(3) - 56806
    );
    if (countries.isSupported(s)) return s;
  }
  var a,
    o = r.toLowerCase();
  for (a = 0; a < COUNTRY_WORDS.length; a++)
    if (o.indexOf(COUNTRY_WORDS[a][0]) >= 0) return COUNTRY_WORDS[a][1];
  for (
    var n, i, p = /(^|[^A-Za-z0-9])([A-Z]{2})(?![A-Za-z])/g;
    (n = p.exec(r));
  )
    if ("gb" !== (i = n[2].toLowerCase()) && countries.isSupported(i)) return i;
  return "";
}
function detectCountryForProfile(e) {
  var r = "";
  try {
    r = parseProxyLink(e.link).name || "";
  } catch (e) {}
  return detectCountry(String((e && e.name) || "") + " " + r);
}
function flagEmoji(e) {
  return countries.emoji(e);
}
function extractProxyLinks(e) {
  var r,
    t,
    s,
    a = htmlEntityDecode(e),
    o = safeBase64Decode(a) || a,
    n = o.split(/\r?\n/),
    i = [],
    p = {};
  for (r = 0; r < n.length; r++) addUniqueLink(i, p, n[r]);
  for (
    t =
      o.match(
        /(?:vless|hy2|hysteria2|hysteria|trojan|vmess|ss|socks5?):\/\/[^\s<>'"`]+/gi
      ) || [],
      s = 0;
    s < t.length;
    s++
  )
    addUniqueLink(i, p, t[s]);
  for (
    t =
      htmlEntityDecode(o)
        .replace(/\\u0026/g, "&")
        .replace(/\\\//g, "/")
        .match(
          /(?:vless|hy2|hysteria2|hysteria|trojan|vmess|ss|socks5?):\/\/[^\s<>'"`]+/gi
        ) || [],
      s = 0;
    s < t.length;
    s++
  )
    addUniqueLink(i, p, t[s]);
  return (parseClashVless(o, i, p), parseJsonVless(o, i, p), i);
}
function isFullXrayConfig(e) {
  return (
    !!e &&
    "object" == typeof e &&
    "[object Array]" === Object.prototype.toString.call(e.inbounds) &&
    "[object Array]" === Object.prototype.toString.call(e.outbounds)
  );
}
function fullXrayProfile(e, r) {
  var t,
    s,
    a,
    o = [];
  return (
    parseJsonVless(JSON.stringify(e), o, {}),
    o.length
      ? ((t = parseProxyLink(o[0])),
        (s = cleanServerName(
          e.remarks || e.remark || e.name || e.ps || t.name
        )) || (s = t.host || "VPN #" + (r + 1)),
        (a = cleanServerName(
          e.id || e.profileId || e.profile_id || e.uuid || ""
        )),
        {
          link: o[0],
          protocol: t.protocol || "vless",
          name: s,
          sourceKey: a
            ? "xray|id|" + a
            : "xray|name|" + s + "|" + profileKeyFromLink(o[0]),
          fullConfig: e,
        })
      : null
  );
}
function extractSubscriptionProfiles(e) {
  var r,
    t,
    s,
    a,
    o = safeBase64Decode(htmlEntityDecode(e)),
    n = safeBase64Decode(percentDecodeLoose(o)),
    i = null,
    p = [],
    l = 0;
  try {
    i = JSON.parse(String(o || "").trim());
  } catch (e) {
    if (n && n !== o)
      try {
        ((i = JSON.parse(String(n || "").trim())), (o = n));
      } catch (e) {}
  }
  if (isFullXrayConfig(i)) return (a = fullXrayProfile(i, 0)) ? [a] : [];
  if ("[object Array]" === Object.prototype.toString.call(i)) {
    for (t = 0; t < i.length; t++) isFullXrayConfig(i[t]) && l++;
    if (l) {
      for (t = 0; t < i.length; t++)
        isFullXrayConfig((s = i[t]))
          ? (a = fullXrayProfile(s, t)) && p.push(a)
          : (r = extractProxyLinks(JSON.stringify(s))).forEach(function (e) {
              var r = parseProxyLink(e);
              p.push({ link: e, protocol: r.protocol, name: r.name });
            });
      return p;
    }
  }
  for (r = extractProxyLinks(e), t = 0; t < r.length; t++) {
    var c = parseProxyLink(r[t]);
    p.push({ link: r[t], protocol: c.protocol, name: c.name });
  }
  return p;
}
module.exports = {
  PROTO_RE: PROTO_RE,
  PROTO_BADGE: PROTO_BADGE,
  safeText: safeText,
  cleanServerName: cleanServerName,
  cleanServerLabel: cleanServerLabel,
  htmlEntityDecode: htmlEntityDecode,
  percentDecodeLoose: percentDecodeLoose,
  safeBase64Decode: safeBase64Decode,
  parseProxyLink: parseProxyLink,
  parseVless: parseVless,
  parseVmess: parseVmess,
  parseTrojan: parseTrojan,
  parseSs: parseSs,
  parseSocks: parseSocks,
  parseHysteria2: parseHysteria2,
  validateLink: validateLink,
  inferName: inferName,
  summary: summary,
  profileKey: profileKey,
  profileKeyFromLink: profileKeyFromLink,
  profileStoreKey: profileStoreKey,
  profileDisplayName: profileDisplayName,
  dedupeProfilesInStore: dedupeProfilesInStore,
  detectCountry: detectCountry,
  detectCountryForProfile: detectCountryForProfile,
  flagEmoji: flagEmoji,
  extractProxyLinks: extractProxyLinks,
  extractSubscriptionProfiles: extractSubscriptionProfiles,
  isFullXrayConfig: isFullXrayConfig,
  fullXrayProfile: fullXrayProfile,
  parseContentHeaders: parseContentHeaders,
  profileTitleFromHeaders: profileTitleFromHeaders,
  looksLikeUnsupportedSubscriptionPage: looksLikeUnsupportedSubscriptionPage,
  findUnsupportedSubscriptionProtocols: findUnsupportedSubscriptionProtocols,
  isGenericName: isGenericName,
  descriptiveName: descriptiveName,
  bestName: bestName,
  hostDisplayName: hostDisplayName,
  importedProfileName: importedProfileName,
  jsonProfileName: jsonProfileName,
  parseQuery: parseQuery,
  parseHostPort: parseHostPort,
  truthy: truthy,
};
