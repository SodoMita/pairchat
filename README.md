# Chatterbox

A text-only chat roulette and private room application built with Next.js, PostgreSQL, and end-to-end encryption.

**Preview:** [https://3000-i7jbo8i4dbnx8fhkcjnjc.e2b.app](https://3000-i7jbo8i4dbnx8fhkcjnjc.e2b.app)

## Features

### Chat modes
- **Stranger roulette** — anonymous 1:1 matching with X25519 + AES-256-GCM E2EE per message
- **Private rooms** — host creates a room, shares an invite link; AES-256-GCM key lives in the URL fragment only (server never sees it)
- **Local tab chat** — multi-tab same-browser chat via `BroadcastChannel` + `localStorage`; zero server involvement

### Security
- Signed session cookies (HMAC-SHA256 with `timingSafeEqual`)
- Rate limiting (token-bucket, per-user, per-route, with stale sweep)
- Envelope-only message storage (AES-GCM ciphertext; plaintext rejected by the server)
- Per-message ephemeral X25519 keys (forward secrecy for stranger chats)
- 1:1 seat enforcement on private rooms (advisory lock, atomic claim)
- Participant-authorized SSE streams and metadata endpoints

### UX
- 20-language localization (SSR + client hydration, RTL support for Arabic/Urdu)
- Chat history sidebar with search, grouped time buckets, live/active badges
- Rejoin pill for ongoing conversations
- Confirm-before-end modal (Leave / Next / Close room) with i18n
- Language picker in every page header and in the chat window header
- Service health indicator on the landing page
- Auto-focus composer, capture printable keys, rename self

## Stack
- **Framework:** Next.js 16 (App Router, Turbopack)
- **DB:** PostgreSQL via Drizzle ORM
- **Crypto:** WebCrypto (X25519 ECDH, HKDF-SHA256, AES-256-GCM)
- **Real-time:** Server-Sent Events (SSE) with in-process pub/sub
- **Styling:** Tailwind CSS 4
- **Language:** TypeScript (strict)

## Getting started

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env  # or set DATABASE_URL manually

# Push schema
npx drizzle-kit push

# Dev
npm run dev

# Build & start
npm run build
npm start
```

## Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@127.0.0.1:5432/app_db` |
| `SESSION_SECRET` | HMAC key for signing session cookies (≥32 chars). Falls back to per-process random key if unset. | (auto-generated) |

## Architecture notes

- **E2EE flow (stranger):** Each client generates a non-extractable X25519 identity keypair on mount, publishes the public key via `PATCH /api/stranger/start`. The partner fetches it via `/api/stranger/partner-key`. Each message uses a fresh ephemeral keypair; the receiver recomputes the shared secret via ECDH symmetry. The key derivation is `HKDF-SHA256(ECDH(static, partnerStatic) ‖ ECDH(ephemeral, partnerStatic), salt=ephPub, info="chatterbox/v1/stranger")`.
- **E2EE flow (private room):** Host generates a random 256-bit AES key, stores it in `localStorage` and in the URL fragment (`#<base64url>`). Guest reads the key from the fragment. No key exchange needed.
- **Local-only chat:** Uses `BroadcastChannel` for cross-tab messaging and `localStorage` for persistence. No server contact whatsoever.
- **Rate limiting:** In-process token-bucket with per-route/per-user keys. Stale entries swept every 5 minutes.
- **Session security:** `roulette_uid` cookie stores `<uuid>.<HMAC-SHA256>`. The HMAC is verified with `timingSafeEqual` before trusting the UUID. The cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in production.

## Testing

```bash
# TypeScript strict check
npm run typecheck

# Production build
npm run build

# E2E crypto test (requires running server + database)
node /tmp/e2e-crypto.mjs
```

## License

MIT