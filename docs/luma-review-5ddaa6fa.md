> **Historical review, not a current audit.** Two corrections to the advice below: a length check cannot guarantee credential entropy (use a CSPRNG-generated capability); and credentials already disclosed to peers should be revoked/rotated, not simply hashed in place. These are recommendations about Luma at the cited commit, not test results for Chatterbox.

Review of `5ddaa6fa` *"Improve credential storage, add partner typing indicator"* — the two highest-severity items from #8 are genuinely fixed. Four residual items below, ordered by severity.

**Method / provenance.** Static read of `5ddaa6fa` and the affected files at `main`. I did not run the app and did not test a live deployment. File:line references are to `main` at the time of writing. I'm the implementer of a comparable app (Chatterbox) and reviewed this because several of these failure modes are ones I shipped and then fixed myself, so I went looking for them specifically.

---

## Verified fixed — credit where due

**ECDH `key_ops` mismatch (#8 item 1).** `createEcdhCredentials()` now generates with `["deriveBits"]` (`src/lib/e2ee.ts:45-48`). The migration shim in `deriveRandomRoomBits()` that re-imports the stored JWK with `key_ops: ["deriveBits"]` is a nice touch — it keeps pre-existing local credentials working instead of orphaning them, and the inline comment explains why it's safe (ECDH `key_ops` is local JWK metadata, not a server-side constraint).

**Public ID / secret credential separation (#8 item 2).** This is done properly, and more thoroughly than #8 asked:

- credential moved out of the JSON body into a bearer header (`bearerCredential(request)`) on messages, events, join, keys, and typing;
- stored at rest as `hashAccessCredential()` (SHA-256) — `src/lib/server-credentials.ts`;
- new `publicId` UUID column with `uniqueIndex(chat_participants_room_public_id_idx)`;
- `senderClientId` → `senderPublicId` in the envelope, **and** carried through `additionalData()` and `envelopeSigningBytes()`, so the public identity is cryptographically bound rather than merely checked;
- explicit 403 when `permission.publicId !== payload.envelope.senderPublicId` (`messages/route.ts`), which closes the "claim someone else's public ID" hole.

I specifically checked whether the hashed credential leaks back out via `getRoomSnapshot()`. It does not — `clientId` is used only for the internal `partner.clientId !== accessHash` comparison, and the returned `RoomSnapshot` exposes just `participantPublicId` / `partnerPublicId` / keys. Clean.

**Delivery signalling (#8 item 3, partially).** `publishChatMessage()` returning `false` now yields `409 "Encrypted peer is not connected."` instead of a bare 202, so the sender learns the peer wasn't attached. That's not a signed recipient ACK, but it converts a silent loss into a visible one.

**Typing indicator (new code, unreviewed by #8).** Holds up well: the receiver rejects events whose `senderPublicId` doesn't match `roomSnapshot.partnerPublicId` (`chat-app.tsx:1104`), auto-clears after 3.5s (`:1107-1111`), and clears on `peer.connected === false` (`:1092`). No stuck-indicator path that I can find. `publishTypingState()` correctly excludes the sender and puts only `publicId` on the wire.

---

## 1. Legacy `senderClientId` may still hold a *peer's* live credential in localStorage

`LocalChatMessage.senderClientId` is retained and annotated *"Legacy local-only transcript field; never sent over the network"* (`src/lib/local-chats.ts:9-11`), and the UI still falls back to it:

```js
const mine = message.senderPublicId === room.participantPublicId ||
  (!message.senderPublicId && message.senderClientId === localConversation?.clientId);
```
— `chat-app.tsx:585` and `:612`

The annotation is accurate for *outbound* traffic, but the field's provenance is inbound. Under the pre-`5ddaa6fa` envelope format, `senderClientId` **was the sender's raw bearer credential** — that was precisely #8's finding. So any transcript persisted before this deploy can contain the *peer's* credential, in cleartext, in `localStorage` under `luma-local-chats-v1`.

Impact is bounded (the holder must also have a still-active room and an un-left participant row), and #8's separation means it's no longer re-transmitted. But it's the residual half of the fix.

Suggested remediation:
- one-time strip in `loadLocalConversations()`: drop `senderClientId` from every stored message on read, then persist;
- once transcripts are migrated, delete the `:585`/`:612` fallback so the legacy field has no reader left;
- `isMessage()` currently accepts a message with *only* `senderClientId` and no `senderPublicId` (`local-chats.ts:36-45`) — tighten that after migration so the field can't be reintroduced.

## 2. No credential migration: pre-deploy participants appear to be locked out

`chatParticipants.clientId` is now compared against `hashAccessCredential(credential)` everywhere (`chat-server.ts`, join, keys, events, messages). The tree has no migration files (only `drizzle.config.json`), and `schema.ts` in this commit adds `publicId` but does not rewrite existing `clientId` values.

If rows written before the deploy still hold the **raw** credential, then `WHERE clientId = sha256(incoming)` will never match them.

This fails *safe* — old sessions break rather than remaining exploitable, which is the right direction — but it means every room created before `5ddaa6fa` is permanently inaccessible to its original participants, silently, as a 403/404. For an ephemeral-chat product that may be entirely acceptable. Worth confirming it's intentional and, if so, documenting it in the deploy notes rather than letting it surface as a support report. If it isn't intentional, the fix is a one-off `UPDATE chat_participants SET client_id = encode(digest(client_id,'sha256'),'hex')` guarded to rows that don't already look like 64-hex.

## 3. `isValidClientId` floor is far below the generator's entropy

```js
value.length >= 8 && value.length <= 100 && /^[a-zA-Z0-9_-]+$/.test(value)
```
— `src/lib/chat.ts`

The actual generator is strong: `createParticipantId()` returns `guest_` + a dashless UUIDv4, i.e. ~122 bits (`local-chats.ts`, last line). At that entropy, unsalted SHA-256 at rest is fine and I am **not** claiming a cracking risk.

The concern is that the at-rest safety of `hashAccessCredential` depends entirely on the *client* generator staying strong, while the server's own validator would happily accept an 8-character credential (~48 bits) — a space that unsalted SHA-256 does not protect. Any future caller, test fixture, or third-party client that mints a shorter ID silently downgrades the whole scheme.

Cheap fix: raise the validator floor to something that guarantees ≥128 bits on its own (e.g. `length >= 26` over the 64-char alphabet), so the hash's strength is a server-enforced invariant rather than a client-side assumption.

## 4. Still open from #8, now also affecting the new endpoint

Verified unchanged at `main`:

- **`requestClientAddress()` / `X-Forwarded-For`** still keys every rate-limit bucket, and the new typing route inherits it: ``allowRequest(`typing:${requestClientAddress(request)}:${roomId}:${accessHash}`, 20, 10_000)``. #8's request to confirm ingress strips client-supplied XFF now covers one more surface. Note the bucket does also include `accessHash`, so spoofing XFF alone doesn't let one actor exhaust another's budget — it lets an attacker widen *their own*.
- **Process-local state.** `globalThis.__lumaChatEventRegistry` (`chat-events.ts`) plus the replay cache remain per-process, so SSE fan-out and duplicate suppression are single-node only. Fine for the MVP; #8's guidance stands.
- **No tests.** The tree contains zero test files. #8 asked for a two-client test covering safety-code agreement, bidirectional encrypt/decrypt, and rejection of tampered envelopes; that request is still outstanding and is now more valuable, because `5ddaa6fa` changed the envelope's signed fields (`senderClientId` → `senderPublicId` inside both `additionalData()` and `envelopeSigningBytes()`). A signature-layout change with no test is exactly how an interop break ships unnoticed between two independently-updating clients.

---

### Suggested order

1 → 3 are small and local. 2 is a one-line confirmation (or a guarded `UPDATE`). 4's test item is the one I'd prioritise if only one gets done, since it protects the change that just landed.

Happy to be corrected on 2 — I may have missed a migration applied outside the repo.
