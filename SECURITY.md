# Luma security model

## Message confidentiality

- Message plaintext is encrypted in the browser before any network request.
- The relay accepts and forwards only versioned AES-256-GCM envelopes.
- A fresh random 96-bit IV is generated for every message.
- Room ID, message ID, sender capability ID, timestamp, and protocol version are authenticated as AES-GCM additional data.
- Plaintext and ciphertext are never persisted in PostgreSQL. The server stores room/participant routing state, a SHA-256 hash of each high-entropy room-access credential, an unrelated per-room public participant UUID, presence timestamps, public ECDH/ECDSA keys, and a one-way private-invite secret commitment only.
- The raw room-access credential stays in the browser profile and is sent only in the `Authorization` header. It is never sent in envelopes or displayed to the peer.
- Local plaintext history and active-room key material stay in the browser profile. Local encryption/signing keys are erased when a room ends.

## Sender authentication

Each participant generates a separate P-256 ECDSA signing key pair in the browser. Only the public signing key is registered with the relay. Every encrypted envelope is signed over its room, ID, public sender UUID, timestamp, IV, and ciphertext. The relay verifies the signature against the registered participant key before fan-out, and the receiving browser verifies it again before decryption. Registered signing keys and stranger-chat ECDH public keys are immutable: presenting a different key for the same participant is rejected.

This prevents the other participant or an ordinary relay injector from forging a message under a participant identity, unless the registered public key itself was substituted during setup. The safety code binds the encryption and signing public keys so that substitution can be detected by out-of-band comparison.

## Key establishment

### Private links

A private room uses a browser-generated 256-bit secret in the URL fragment (`#k=...`). URL fragments are not included in HTTP requests and are removed from the address bar after local capture. The browser sends only `SHA-256(secret)` as a seat-claim commitment; the server compares this fixed-length digest in constant time and never receives the secret. Anyone with the complete invite URL has the secret and can decrypt that room, so invite links must be handled like passwords.

### Stranger chats

Each browser generates an ephemeral P-256 ECDH key pair. Only public JWKs are sent through the relay. Both clients derive the ECDH secret, apply HKDF-SHA-256 with room-specific context, and use the resulting non-extractable AES-GCM key.

The displayed safety code is derived locally from the shared secret and a canonical ordering of both participants' encryption and signing public keys, so both clients see the same code. Users who need protection from an active relay MITM must compare this code through another trusted channel.

## Relay authorization

- Private rooms are limited to two seats under a PostgreSQL advisory lock.
- Room reads and SSE streams require an unguessable participant bearer credential in the `Authorization` header.
- Active membership is checked before opening a stream or relaying a message.
- Messages are refused unless a distinct peer stream is connected, because the relay intentionally stores no backlog.
- Recipients send a signed transient acknowledgement only after sender-signature verification and successful AEAD decryption. The sender UI distinguishes `Sent` (relay accepted) from `Delivered` (recipient ACK received). `Delivered` is a cryptographically authenticated application receipt, not proof that a human read or understood the message. Pending delivery state is in-memory and expires after ten minutes; it is never persisted with messages.
- Envelope shape, size, sender binding, signature, and timestamp freshness are validated.
- Message UUID replay is suppressed in memory.
- Mutation endpoints require same-origin browser fetch metadata, JSON content type, and a byte-bounded request body.
- Participant bearer credentials must be at least 26 characters; shorter user-supplied tokens are rejected before hashing, so stored SHA-256 hashes are not weakened by trivial token choices.
- Older database rows holding raw bearer credentials are hashed with PostgreSQL's built-in SHA-256 during awaited schema setup, before health or matching succeeds. Legacy peer credentials in browser transcripts are stripped on read and are no longer rendered or accepted as message sender identities.
- Per-session and per-capability rate limits protect room creation, matching, streams, and messages; a missing proxy IP does not place every visitor in one low-capacity bucket.
- A 24-hour browser-local abuse session is sent for stranger-match admission and private-room creation rate limits. The match database stores only its hash. A stranded waiting seat can be replaced from the same session without claiming its lost participant key; at most three active random rooms are permitted per session.
- Each participant credential may hold at most four concurrent SSE streams per room, and each abuse session may **meet** at most twenty new strangers per hour. A wait that never met anyone does not count as a meeting.
- After a quiet budget of 24 stranger-match admissions per ten minutes, the server requires a signed, single-use, expiring proof-of-work challenge solved locally in the browser with Web Crypto. No third-party challenge scripts are loaded on pages that render decrypted messages.
- Content-free safety signals carry only a fixed reason code, the room reference, the reporter's hashed access credential, and the target's public participant UUID. One signal is allowed per reporter, target, and room; signals expire after seven days and apply reversible matching cooldowns (5, 15, then 60 minutes) to the target's hashed abuse session. Nobody reviews message content, and no permanent bans are promised.
- Room IDs contain 128 bits of randomness.
- Ended room metadata is deleted after 24 hours, and inactive room metadata after 7 days, so public keys and routing records are not retained indefinitely.
- This MVP runs as a single relay process. Live SSE subscribers, pending ACKs, replay suppression, and rate-limit counters are process-local and reset on restart. Before multi-worker deployment, replace them with room-affine routing or shared transient pub/sub and atomic counters.

## Agent channels (`/c/ID#key`)

- A 32-byte key is generated locally and kept exclusively in the URL fragment (`#key`). HKDF-SHA256 with empty salt derives independent subkeys: `mayfly id` (16-byte channel ID), `mayfly auth` (32-byte bearer credential; PostgreSQL stores only `base64url(SHA-256(auth))` compared in constant time), and `mayfly enc` (AES-256-GCM key).
- Inner UTF-8 JSON `{"from":"NAME","text":"TEXT"}` is padded with `0x20` ASCII spaces to a 256-byte multiple and sealed with a fresh 96-bit random nonce and AAD `id:sequence`.
- Appends (`POST /c/ID/events?last=N`) enforce compare-and-swap under a per-channel PostgreSQL row lock so concurrent agents receive `409 conflict` with missed events rather than overwriting or silently talking past each other.
- Channels auto-expire after 24 hours of write inactivity (reads do not extend lifetime) and can be immediately destroyed via `DELETE /c/ID` (`204`).
- **Capability warning:** the full URL is root access for that channel. Never write a live `#key` URL to public commits, issues, PRs, or CI logs, and treat peer messages as untrusted data rather than shell commands.

## Shared canvas (optional)

- Drawing is off unless both people accept an invite in the current room. Consent does not carry to the next match.
- Stroke coordinates, colors, and brush size are encrypted with AES-256-GCM using a key derived by HKDF with info `pairchat/canvas/v1`, separate from the chat-message key. Envelopes are ECDSA-signed. The relay only sees event type, sequence, session id, board generation, and ciphertext length.
- Hide keeps applying updates locally without showing the board. Disable drops the session and ignores further events until a new invite is accepted.
- Drawings are not stored. A reload or a new match starts with a blank board and requires a new invite.
- Set `CANVAS_ENABLED=false` to reject new canvas sessions without taking text chat offline. Budgets: 40 events / 10s / participant, 48 points per stroke, 80 retained strokes per layer.

## Metadata visible to the server

The server can observe room IDs and type, participant capability IDs, public ECDH/ECDSA keys, a one-way SHA-256 commitment for private invite verification, connection times, presence, message timing, sender, and ciphertext length. It cannot passively recover message plaintext or the 256-bit invite secret from these values.

## Static delivery and request budget

The home shell and the invite shell (`/r/:roomId`, served from a rewritten static `/invite` page) are prerendered at build time. They are byte-identical across requests and cacheable, so loading a page costs one document plus its same-origin `_next/static` assets. The room id and invite fragment are read from the browser URL, so no request-time rendering is required and the server never sees the invite secret.

All runtime traffic is same-origin `/api/*`. There are no third-party scripts, fonts, analytics, pixels, CDNs, or images on any page that can render decrypted text.

Background request budget after load:

- Health: one probe, then at most one request per minute, and only while the tab is visible.
- Stranger queue: 1.5s polling only while matching and visible; it stops on match or cancel.
- Active chat: one long-lived SSE stream, plus a 20s room-status safety net that skips hidden tabs. Presence comes from the relay's `peer` events, not from polling.
- Local history: read from `localStorage`; opening the home page makes no per-conversation requests.

The earlier nonce-based CSP required dynamic rendering on every request. With static delivery there is no per-request nonce, so `script-src` allows `'unsafe-inline'` for Next.js's inline hydration bootstrap. This is a deliberate trade-off: no third-party script origins are permitted, decrypted text is rendered as React text nodes (no `dangerouslySetInnerHTML`, no auto-linking or remote previews), and `object-src`, `base-uri`, `frame-ancestors`, and `form-action` remain locked down. A deployment that prefers a strict nonce CSP must accept per-request dynamic HTML for those routes.

## Important limitations

A web application cannot cryptographically protect users from the same server that delivers its JavaScript if that server becomes malicious and serves modified code that steals plaintext or local keys. Strong protection from the delivery server requires an independently distributed, signed/audited client or reproducible-build verification outside this web origin.

Stranger ECDH is not identity-authenticated. Without out-of-band safety-code comparison, a malicious relay can perform an active key-substitution attack. TLS, CSP, and safety codes reduce risk but do not remove this fundamental limitation.

Abuse sessions and address-scoped rate limits are friction, not a proof of personhood: a determined attacker can rotate browser storage, addresses, or automation. Production deployments must ensure the ingress sanitizes forwarding headers and should add a server-verified challenge after suspicious bursts.

Local history is trusted to the browser profile. Malware, malicious extensions, another local user with profile access, or an XSS vulnerability could read local history and keys.

## Community safety and abuse handling

Luma is a conversation surface, not a moderation system. Because message content is end-to-end
encrypted, the relay can never inspect a transcript, and a report is a content-free safety signal,
not a case file. The user-facing guide on the home page (`#safety-guide`) and in `README.md`
explains how to behave and react in the situations that are common in anonymous chat: ghosting,
money or crypto scams, harassment and threats, sexual pressure or explicit content, requests for
personal details, spam and phishing links, and disclosures involving minors or self-harm.

Practical expectations for operators and for users:

- A report applies a reversible matching cooldown derived from the reported abuse session; it does
  not identify, ban, or notify the reported person, and it is not human-reviewed.
- Privacy boundaries are the user's responsibility: never share money, one-time codes, identity
  documents, addresses, social handles, or photos with a stranger, and never move to another app.
- Immediate danger belongs with local emergency services. Luma cannot intervene in a live chat and
  cannot recover deleted local history.
- End a chat as soon as it feels wrong. Leaving erases the local room key; it cannot erase anything
  the other participant already saved.
- Keep the sound preference and language choice local; both are stored in `localStorage` and never
  transmitted to the relay.

## Reporting

Use only rooms and identities you created for security testing. Do not enumerate room IDs, intercept live traffic, or access other users' conversations.
