# Luma security model

## Message confidentiality

- Message plaintext is encrypted in the browser before any network request.
- The relay accepts and forwards only versioned AES-256-GCM envelopes.
- A fresh random 96-bit IV is generated for every message.
- Room ID, message ID, sender capability ID, timestamp, and protocol version are authenticated as AES-GCM additional data.
- Plaintext and ciphertext are never persisted in PostgreSQL. The server stores room/participant routing state, participant capability IDs, presence timestamps, public ECDH/ECDSA keys, and a one-way private-invite secret commitment only.
- Local plaintext history and active-room key material stay in the browser profile. Local encryption/signing keys are erased when a room ends.

## Sender authentication

Each participant generates a separate P-256 ECDSA signing key pair in the browser. Only the public signing key is registered with the relay. Every encrypted envelope is signed over its room, ID, sender, timestamp, IV, and ciphertext. The relay verifies the signature against the registered participant key before fan-out, and the receiving browser verifies it again before decryption. Registered signing keys and stranger-chat ECDH public keys are immutable: presenting a different key for the same participant is rejected.

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
- Envelope shape, size, sender binding, signature, and timestamp freshness are validated.
- Message UUID replay is suppressed in memory.
- Mutation endpoints require same-origin browser fetch metadata, JSON content type, and a byte-bounded request body.
- Basic per-address and per-capability rate limits protect room, match, stream, and message endpoints.
- Room IDs contain 128 bits of randomness.
- Ended room metadata is deleted after 24 hours, and inactive room metadata after 7 days, so public keys and routing records are not retained indefinitely.

## Metadata visible to the server

The server can observe room IDs and type, participant capability IDs, public ECDH/ECDSA keys, a one-way SHA-256 commitment for private invite verification, connection times, presence, message timing, sender, and ciphertext length. It cannot passively recover message plaintext or the 256-bit invite secret from these values.

## Important limitations

A web application cannot cryptographically protect users from the same server that delivers its JavaScript if that server becomes malicious and serves modified code that steals plaintext or local keys. Strong protection from the delivery server requires an independently distributed, signed/audited client or reproducible-build verification outside this web origin.

Stranger ECDH is not identity-authenticated. Without out-of-band safety-code comparison, a malicious relay can perform an active key-substitution attack. TLS, CSP, and safety codes reduce risk but do not remove this fundamental limitation.

Local history is trusted to the browser profile. Malware, malicious extensions, another local user with profile access, or an XSS vulnerability could read local history and keys.

## Reporting

Use only rooms and identities you created for security testing. Do not enumerate room IDs, intercept live traffic, or access other users' conversations.
