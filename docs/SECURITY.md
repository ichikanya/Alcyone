# Security model

## Threat model

Alcyone runs as root on a rooted TV and handles proxy credentials. The
adversaries it is designed against:

1. **A malicious or compromised subscription provider.** It chooses URLs we
   fetch and content we parse, and may try to redirect us at internal services
   or feed us oversized or hostile payloads.
2. **Anyone else on the local network.** Home LANs include guest devices, IoT
   gadgets and other people's phones. Any of them can reach the TV's HTTP port.
3. **A hostile web page open in a browser on the same LAN.** It can issue
   cross-origin requests at the TV and try to drive the importer through the
   user's browser.
4. **Another application on the TV.** It may try to reach our Luna methods.

Explicitly **out of scope**: an attacker who already has root on the TV, and
passive interception of LAN traffic (see the plaintext limitation below).

## UI/service trust boundary

The TV frontend cannot perform privileged work. It builds no commands, touches
no files, and never receives secrets. Everything privileged is behind Luna
methods that validate input, reject unknown fields and return structured codes.
Every handler also checks the bus-provided `message.sender` against the exact
edition app ID. Generated LS2 roles repeat that single-app inbound allow-list;
the runtime check remains authoritative after Homebrew privilege elevation.

There is no code path from user input to a shell. Cores are launched with
absolute paths resolved from a fixed allow-list and argument *arrays*, with
`shell: false`. Profile data reaches a core only through a JSON config file
written by the service, never as a command argument.

## LAN importer

**Default state: closed.** The importer binds to `127.0.0.1` and serves nothing
until the user opens a window from the TV.

Opening a window (`startPairing`):

- mints a fresh 8-character code from a 32-symbol unambiguous alphabet
  (~40 bits) using `crypto.randomBytes` with rejection sampling;
- invalidates any previous code and all existing sessions;
- rebinds the listener to the LAN for a **5 minute** window;
- displays the code and address on the TV screen only.

Redeeming a code:

- the code is **single use** — redeeming it closes the window;
- comparison is constant time over SHA-256 digests, so neither value nor length
  leaks through timing;
- failures are rate limited per client address: 5 attempts per 5 minutes, then a
  15 minute lockout;
- success issues a session cookie that is `HttpOnly` and `SameSite=Strict`.

Sessions expire on a **10 minute idle timeout** and a **30 minute absolute
timeout**, capped at 4 concurrent sessions. Closing the window from the TV
revokes every session immediately and returns the listener to loopback.

Every state-changing request additionally requires a CSRF token bound to the
session and sent in `X-Alcyone-CSRF`.

### CORS

There is **no wildcard CORS**, and no allowed cross-origin. Cross-origin access
is simply not enabled: `OPTIONS` returns `405`, and a request carrying an
`Origin` that does not match the request `Host` is rejected with `403`.

### What the API will not return

`GET /api/profiles` returns display metadata only:

```json
{"id":"p...","name":"NL Reality","protocol":"vless","country":"nl",
 "endpoint":"a.example.com:443","transport":"ws","security":"reality",
 "sourceType":"single","subscriptionName":"","hasFullConfig":false,"selected":true}
```

It never returns raw proxy URIs, UUIDs, passwords, pre-shared or public keys,
complete Xray or sing-box configurations, subscription URLs or tokens, private
request headers, or the raw profile store. Subscriptions expose only a name, a
coarse host label and a count — the URL is a bearer credential for most
providers and is withheld.

Authenticated clients may **submit** new profiles and subscriptions. They cannot
**read back** anything already stored. This is enforced in one place
(`sanitizeProfile` / `sanitizeSubscription`) and verified by tests that fail if
a known secret appears in any response.

### Plaintext limitation (unresolved by design)

The LAN importer speaks **plain HTTP**. A TV cannot obtain a trusted certificate
for a private address, and shipping a self-signed certificate would train users
to click through warnings.

This trusted-LAN HTTP limitation remains in 4.0.3. It is not treated as secure
transport, and this release intentionally does not add a self-signed HTTPS
workaround. Pairing, sessions, CSRF and Origin checks restrict access but do not
provide confidentiality against a network observer.

Authentication does not make plaintext confidential. Concretely, on a network
where an attacker can passively observe or actively intercept traffic:

- a submitted proxy link or subscription URL is exposed in transit;
- the pairing code and session cookie are exposed in transit.

Mitigations: the window is short and user-initiated, the code is single use,
sessions are bounded, and — most importantly — **stored secrets are never sent
back over the network**, so an observer sees only what the user types during
that window, not the existing profile store.

The unsafe part of the old design (a permanently open `0.0.0.0` listener that
served the entire profile store, including every link and key, to anyone on the
LAN with no authentication at all) has been removed rather than papered over.

Users are told, on the TV screen and on the importer page, that the LAN
connection is unencrypted and should be used only on a trusted network.

## SSRF policy

The importer fetches user-supplied URLs, so `lib/net/ssrf.js` is deny-by-default.

Accepted: `http:` and `https:` only. Rejected: every other scheme (including
`file:`), embedded credentials, malformed or ambiguous URLs, ambiguous
zero-padded IPv4 octets, and control characters or whitespace in the URL.

All DNS answers (A and AAAA) are resolved and **every** result must pass. A name
that resolves to a mix of public and private addresses is rejected as a whole.

Blocked address classes, IPv4: unspecified `0.0.0.0/8`, private `10/8`,
`172.16/12`, `192.168/16`, CGNAT `100.64/10`, loopback `127/8`, link-local
`169.254/16` (including the `169.254.169.254` metadata address), reserved
`192.0.0/24`, `192.88.99/24`, `240/4`, documentation `192.0.2/24`,
`198.51.100/24`, `203.0.113/24`, benchmarking `198.18/15`, multicast `224/4`.

IPv6: unspecified `::`, loopback `::1`, unique-local `fc00::/7`, link-local
`fe80::/10`, multicast `ff00::/8`, documentation `2001:db8::/32`, Teredo
`2001::/32`, discard `100::/64`, and any scoped (`%zone`) address. IPv4-mapped
`::ffff:0:0/96`, IPv4-compatible, NAT64 `64:ff9b::/96` and 6to4 `2002::/16`
addresses are unwrapped and the embedded IPv4 address is judged by the rules
above.

Hostnames: `localhost` and friends, cloud metadata names, single-label names
(which resolve through local search domains), and `.local`, `.internal`,
`.intranet`, `.lan`, `.home`, `.home.arpa`, `.corp`, `.private`, `.localdomain`
suffixes are refused before any lookup.

**DNS rebinding** is closed by pinning: the socket connects to an address that
already passed validation, while TLS still verifies the original hostname
against the certificate.

**Redirects** are re-validated with the identical rules at every hop, limited to
5, and credential-bearing headers (`Authorization`, `Cookie`,
`Proxy-Authorization`, and our device headers) are dropped when the origin
changes.

Not supported at all: Unix sockets, local files, internal webOS services, and
arbitrary proxying.

## TLS policy

Certificate validation is **always on**. The production tree contains no
functional use of `rejectUnauthorized: false`, `wget --no-check-certificate`,
`curl -k`, `curl --insecure`, or a retry after a validation failure — a
repository guard fails the build if any reappears.

A certificate problem returns `TLS_CERTIFICATE_INVALID` to the UI, which asks
the user to fix the server or the provider. There is deliberately **no
"ignore certificate errors" setting**. The system trust store is used.

The previous implementation retried insecurely after any certificate error,
silently downgrading every subscription fetch. That is removed.

## Resource bounds

| Limit | Value |
| --- | --- |
| Supervised child processes | 4 |
| Connect / read / total request timeout | 10 s / 15 s / 45 s |
| Response headers | 32 KiB |
| Response body | 2 MiB |
| Decompressed body | 8 MiB |
| Concurrent subscription fetches | 4 |
| Nested subscription URLs | 32, 4 MiB total |
| Redirects | 5 |
| LAN request body | 64 KiB |
| LAN connections | 16 |
| Diagnostic log | 256 KiB, trimmed in place |
| Stored profiles / subscriptions | 4096 / 64 |

## Secret handling

Secrets live only in `<dataDir>/profiles.json`, mode `0600` in a `0700`
directory, written atomically.

Logs are scrubbed: values under keys matching `pass|password|token|secret|uuid|
key|auth|cred|link|url|cookie|session|pairing` are replaced with `[redacted]`,
anything URI-shaped becomes `[uri]`, and UUID-shaped strings become `[uuid]`.
Complete profiles and subscription URLs are never logged.

Unexpected exceptions are reported as the opaque code `INTERNAL`, so an error
message cannot become an exfiltration channel.

## Reporting

Security issues: [@AlcyoneVPN](https://t.me/AlcyoneVPN).
