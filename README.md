# Chatterbox

The `chatterbox` branch is the alternative implementation in [SodoMita/pairchat](https://github.com/SodoMita/pairchat). The repository's `main` branch contains Luma; this branch does not replace it.

Text-only stranger matching and private invite rooms, with a responsive conversation sidebar, 20-language UI, local history, and browser-side encryption.

## Run locally

1. Install dependencies with `npm ci`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` for a local PostgreSQL database.
3. Apply the schema with `npx drizzle-kit push` (review changes before applying on an existing deployment).
4. Run `npm run dev`, or `npm run build` then `npm start`.

Production must use HTTPS. Session cookies are `Secure` in production, `HttpOnly`, and `SameSite=Lax`. Chromium and curl treat localhost as a secure testing exception; do not disable `Secure` to work around a test setup problem.

Optional deployment settings are documented in `.env.example`. In particular, set `APP_ORIGIN` to the canonical public origin. Only configure `TRUSTED_CLIENT_IP_HEADER` when the ingress strips/overwrites that header; arbitrary `X-Forwarded-For` values are not trusted.

## Chat and storage model

- **Stranger roulette:** one active match per authenticated browser identity. Queue entry is idempotent and serialized in PostgreSQL, including concurrent requests from tabs.
- **Private rooms:** up to eight open rooms per host. Creating another does not close existing conversations. Two seats per room, claimed atomically. Either participant can explicitly end the conversation.
- **Complete invite links:** `/room/<id>#<key>`. The random encryption key remains in the browser fragment and local storage. A separately derived admission capability proves possession of the invite; the server stores only its hash. A room UUID alone cannot claim a new room's guest seat.
- **Optional passphrases:** an additional entry gate, protected with salted scrypt. They are not encryption keys. Existing authenticated guests can re-enter without supplying the passphrase again.
- **History:** new network-chat transcripts are stored as ciphertext in browser IndexedDB, at most 500 messages per conversation. The sidebar's previews are local plaintext. Ended conversations open in a read-only `/history/<scope>` view without API calls. Clearing browser data loses history and keys; another device cannot fetch them from the server.
- **Local tab chat:** a separate same-browser BroadcastChannel mode. It is not an internet transport and does not provide isolation from other pages on the same origin.

The live relay does **not** read or write message history to PostgreSQL. A missing peer returns an unsent error. HTTP 202 means accepted by the live relay, **not** a verified recipient delivery receipt. A disconnect after acceptance can still lose a message; do not describe it as guaranteed delivery.

## Encryption and trust boundaries

The application uses native WebCrypto:

- X25519 + HKDF-SHA-256 for a per-stranger-conversation AES-256-GCM key;
- a random 256-bit private-room secret, domain-separated into admission and conversation keys;
- fresh random 96-bit GCM IVs per message;
- v2 authenticated data binding the version, conversation scope, sender, message UUID, and timestamp;
- non-extractable stranger private keys in IndexedDB; pinned peer public keys and a safety code for independent comparison.

This is **not Signal**, does **not provide forward secrecy**, and is **not independently audited**. Key pinning only protects after first use. A malicious relay can substitute initial stranger keys unless participants compare safety codes through another trusted channel. An operator serving modified JavaScript, a compromised browser, an extension, or an XSS can access plaintext/keys. Encryption also does not prevent the peer from saving a conversation.

The server sees routing metadata: participant IDs, room state, timing, ciphertext size, and public keys. New message bodies are transient ciphertext in the delivery path, not persistent records. Do not enable request-body logging at the reverse proxy.

## Network model

All page shells remain static/on-demand cached. All dynamic connections are same-origin; CSP includes `connect-src 'self'`. No third-party fonts, analytics, scripts, or media are loaded.

- Landing: one aggregate stats request, every 30 seconds only while visible.
- Stranger chat: queue-entry POST, a control SSE stream, one key-publication PATCH, and a message SSE stream; no matching/key polling.
- Private room: one entry request and one message stream, plus explicit send/close actions.
- Ended local history and local-tab chat: no API requests.

Streams have per-user/global caps, bounded backpressure, bounded lifetimes and abort cleanup. Rate limits and relay fanout remain **single-process**. Deploy one relay process until shared pub/sub, shared quotas and routing have been implemented. The static Next.js shell still requires inline bootstrap scripts; the present CSP is not an XSS-proof security boundary.

## Upgrade notes

This release intentionally invalidates the former UUID/PID-signed cookies. Users receive new random sessions whose token digests and expiry are stored in PostgreSQL; these survive process restarts without `SESSION_SECRET`.

New clients send only v2 envelopes. Reload both participants after deploying. Existing v1 conversations are not silently re-keyed or represented as recoverable. Start new rooms/matches.

The additive schema introduces `sessions`, expands room passphrase verifiers to text, and adds a hashed invite capability. Legacy SHA-256 passphrases are upgraded after a successful entry. Legacy rooms without a capability hash retain their older admission semantics; recreate them for the stronger invitation check.

The legacy `messages` table is retained to avoid destructive upgrades. No runtime route reads or writes it. To inspect/purge an old server archive, use `node --import tsx scripts/purge-legacy-messages.mjs` (dry-run count), then explicitly pass `--confirm-server-history-deletion` if deletion is intended. Database backups and browser backups are outside that purge.

## Validation and tests

```sh
npx next typegen
npm exec tsc -- --noEmit --pretty false
npm run build

# Install the browser once (system dependency installation may require sudo).
npx playwright install --with-deps chromium

# Run the full suite. Requires a LOCAL PostgreSQL user with CREATEDB permission.
node --import tsx tests/run-review.mjs
```

The runner provisions a uniquely named temporary database and production server, runs tests, verifies session continuity across a process restart, then cleans up its own database/process. It never truncates the application's database.

- `tests/security.test.ts`: actual application crypto, tampering, wrong context, password salts, streamed body limits, Origin checks and rate limiting.
- `tests/e2e-api.mjs`: authentication, immutable keys, concurrent pairing, private admission, stream limits/revocation, replay handling, and no new persisted message rows.
- `tests/browser.mjs`: independent Chromium contexts exercising actual UI send/receive/reload, sender echoes, confirmation cancellation, private links, passphrases, concurrent rooms, local archives, hidden-tab notices, HTML-as-text, and same-origin/no-plaintext network checks.

See [the security review](docs/security-review.md) for findings and remaining limitations.
