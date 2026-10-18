# Chatterbox security/correctness review

Baseline: `4a38943` on `chatterbox`. Luma's separate `main` branch was inspected for context but is not modified by this release. Tests are controlled fixtures, never attempts to access other people's conversations.

## Confirmed findings and changes

| Finding | Change | Evidence |
|---|---|---|
| Critical: session HMAC fallback was deterministically derived from a public constant and PID | Retired that cookie format; use random 256-bit tokens, database digests, and server-enforced expiry | Forged legacy cookie fails; opaque cookie is Secure/HttpOnly; session survives process restart |
| Current Next.js version had critical/high dependency advisories | Update to Next.js 16.4.2 and compatible tooling; update PostCSS | Production `npm audit --omit=dev` reports zero vulnerabilities at review time |
| Queue read/update/insert was not atomic; repeated calls could create duplicate seats | One transaction/advisory lock for start, key publication, and leave | Six clients making concurrent repeated starts have six rows in three pairs |
| Public keys could be overwritten, and PATCH could silently create a waiting participant | Require membership in an explicit session; validate usable X25519 keys; bind once; pin peers locally | Unseated publication rejected; changed published key returns 409; low-order key unit check |
| Sender's own ephemeral ciphertext could not decrypt through the receiver algorithm after reload | Versioned per-conversation X25519/HKDF key derivation, used for both directions | Real Chromium sender/receiver histories survive reload and self echoes deduplicate |
| Room/sender/message identity was not authenticated with the ciphertext | AES-GCM authenticated data covers scope, sender, UUID, version and timestamp | Context, sender, UUID, timestamp and ciphertext modifications fail decryption |
| APIs accepted loosely shaped, unbounded message bodies before validation | Stream byte limits, strict canonical v2 envelopes, maximum text/envelope sizes, no plaintext fallback | Chunked oversize cancelled; null/array/malformed JSON rejected |
| Browser CSRF protections relied only on SameSite cookies | Origin/Fetch Metadata validation and JSON-only non-empty mutation bodies | Cross-origin attempts rejected before mutations |
| New rooms used fast unsalted SHA-256 passphrases | Versioned scrypt N=32768/r=8/p=3, independent salt, constant-time verification, bounded concurrency | Same passphrase hashes differ; wrong passphrase rejected; legacy verifier migration supported |
| A known room UUID could occupy an empty guest seat without the encryption key | Random-key-derived, domain-separated invite capability; only its hash is stored | UUID-only admission rejected; capability + passphrase required; hash isn't the capability |
| Creating a room closed the host's other open chats | Remove implicit closure, enforce an explicit open-room quota | Two live private conversations tested in separate host tabs |
| New transcripts were stored server-side despite the requested local-history model | Live-only ciphertext relay; browser-only ciphertext transcript storage | No message-table inserts in API tests; browser reload and offline archive work |
| Existing streams outlived room/session termination and queues were unbounded | Terminal events close streams; abort/lifetime/backpressure cleanup and connection caps | Ending rooms/chats closes pre-existing streams; excess streams return 429 |
| Send errors disappeared in the parent-owned encrypted UI; Enter on the Cancel button could also confirm | One encrypted UI path, explicit errors, preserve failed drafts; native dialog, default Cancel focus | Browser cancel/confirm regression |
| Encrypted message notifications were wired only into the unused plaintext path | Observe decrypted messages once, keep title count, generic metadata-only notification event | Hidden-tab count increments once, clears on visibility, notification contains no text/name/key |
| API tests deleted all users/rooms/messages in the configured application database | Isolated test DB/server, fixture-only cleanup, unrelated-data canary | Runner guards, canary assertion and test-resource cleanup |

## Intentionally retained limits

- This is a prototype using standard primitives, **not an audited messaging protocol**, Signal, MLS, or a Double Ratchet. It does **not** provide forward secrecy. Earlier claims that a sender-only ephemeral key conferred forward secrecy were incorrect.
- Initial stranger keys are delivered by the relay. TOFU pinning does not authenticate first contact. Compare safety codes out of band. A compromised server that changes browser JavaScript can bypass client-side safeguards.
- An authorized peer can save or disclose messages. Private-room keys and sidebar plaintext previews live locally and can be read by same-origin scripts/extensions or another user of the same browser profile.
- HTTP 202 is relay acceptance, not a signed recipient ACK. There is no offline delivery queue. An absent peer is reported, but a disconnect after acceptance can lose a message.
- Replay IDs (not content), rate buckets, stream counts and fanout are bounded process-local state. They reset on restart; use one relay process. Timestamp limits and browser transcript dedup provide additional but not permanent replay protection.
- The legacy server `messages` table is left intact by the additive migration. Runtime routes cannot retrieve it. Purging old rows/backups is an explicit administrator action, not something a test silently does.
- Old private rooms without a capability hash have the old UUID-as-invite behavior. Recreate them to obtain capability-gated admission. Legacy passphrase hashes are upgraded on successful entry; inactive old verifiers need administrative retirement if relevant.
- Static shells and `connect-src 'self'` are preserved, but Next's inline bootstrap still requires `'unsafe-inline'`. No third-party resources are used. A dedicated immutable/audited client distribution would be needed for a stronger untrusted-web-server claim.
- Production dependencies were audited separately from development tools. Development-only dependency advisories may remain; the full audit is not claimed clean.

## Evidence scope

The suite imports the actual client crypto module, runs real HTTP/SSE calls against an isolated production build, and drives independent Chromium contexts. It is not a formal cryptographic audit, a complete penetration test, or proof that no undiscovered bugs exist. Firefox, Safari, real mobile devices, multiple relay workers, crash recovery during in-flight delivery and hostile-JavaScript hosting are not covered.
