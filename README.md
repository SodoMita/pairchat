# Luma — anonymous text chat roulette

Luma is a calm, anonymous one-to-one text chat. Meet a random stranger in seconds or create a
private invite link for exactly one friend. No profiles, no accounts, no images or calls.

- **End-to-end encrypted** with browser-generated P-256 ECDH + AES-256-GCM and ECDSA-signed
  envelopes. The relay cannot read message plaintext (`SECURITY.md` describes the model).
- **Anonymous by default**: rooms use unguessable IDs, participant credentials stay in the browser,
  and the server stores only routing state plus a hash of each credential.
- **Local history** stays in the browser; random chats are ephemeral unless you choose to keep them.
- **20 languages**, complete UI and safety copy, RTL support for Arabic and Urdu.
- **Notification sounds** synthesised in the browser (Web Audio), with a persistent mute toggle.
- **Typing indicators, delivery receipts and reports** over the same encrypted relay.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · PostgreSQL · Drizzle ORM · lucide-react

```
src/app          pages, invite shell, API route handlers
src/components   chat-app.tsx (all screens in one client component)
src/lib          e2ee, relay events, i18n, local history, safety limits, sounds
src/db           Drizzle schema and client
SECURITY.md      threat model and relay authorization rules
```

## Running locally

```bash
npm install
cp .env.example .env            # if present; otherwise set DATABASE_URL
# DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db
npx drizzle-kit push            # create the tables
npm run dev                     # http://localhost:3000
```

Production checks:

```bash
npx next typegen
npx tsc --noEmit
npm run build
npm run start
```

The API surface is `/api/health`, `/api/match`, `/api/rooms` and
`/api/rooms/[roomId]/{join,keys,messages,events,typing,ack,report}`. Every mutation requires a
same-origin JSON request and a participant bearer credential.

## What changed in this iteration

- **Sounds work.** A small Web Audio engine (`src/lib/sound.ts`) creates notification tones for
  sent / received / matched / ended / error states. The audio context is unlocked by the first
  user gesture, resumes after tab suspension, and the mute preference is stored in
  `localStorage`. A header button toggles sound anywhere in the app, and turning it back on plays
  a confirmation tone so people can verify their device volume.
- **Everything is translated.** The original dictionaries were missing the report flow, local
  history controls and safety copy in all 19 non-English languages. The gaps are now filled for
  every locale, including the new community safety guide and sound/typing strings.
- **The wording is localized even on failure.** Server error strings no longer leak raw English
  into localized error screens or chat toasts.
- **Typing indicators.** The unused typing endpoint is now wired end-to-end; typing state is
  ephemeral, never stored, and relayed only to the peer.
- **Instant end notification.** Leaving a chat broadcasts an `ended` relay event so the partner's
  composer closes immediately instead of waiting for the 20-second status poll.
- **Broken invite route fixed.** The dynamic `/r/[roomId]` page contradicted the static invite
  shell rewrite and failed type checking; it is removed so `/r/:roomId` is served by the
  prerendered invite shell as designed.
- **In-chat errors are visible.** Failed sends and relay problems surface as a dismissible toast
  with a localized message; a failed match returns to the home screen instead of an English-only
  error page.
- **Community safety guide.** The home page now explains the real-world problems of anonymous chat
  (ghosting, scams, harassment, sexual pressure, privacy requests, bots, minors/self-harm,
  screenshots/consent) with a short reaction protocol, translated into all 20 languages.
- **Kept random chats resume locally.** Reopening a saved stranger chat reconnects from the local
  encrypted state instead of failing through the private-invite join path.

## Verification

- `npx next typegen`, `npx tsc --noEmit` and `npm run build` pass.
- A Playwright run with two isolated browser contexts verifies: matching, encrypted message
  delivery in both directions, typing indicator, sound generation on match/receive, mute
  persistence, report flow, instant peer disconnect after "End chat", localized hero/guide copy,
  RTL switching, and zero browser console errors.
- A Node integration script verifies the relay contract directly: health, stranger matching,
  SSE peer/typing/ended events, signature rejection, AES-GCM decrypt equality, signed delivery
  ACKs, content-free reports, the `/r/:roomId` invite shell, wrong-secret rejection and the private
  room join/message/leave flow.

```bash
BASE=https://your-preview-host node scripts/browser-check.mjs
```

## Common problems in random anonymous chats — and how to behave, react and resolve them

Anonymous chat is unpredictable by design: you meet a stranger with no reputation, no shared
history and no moderator reading the messages. The guide below is also shown, translated, on the
home page (`#safety-guide`) so people do not have to read a README to stay safe.

### 1. Someone disappears mid-chat (ghosting)

**What happens:** the other person closes the tab, loses interest, or finds another match.
**How to react:** being left without a goodbye is normal here. Do not chase, guilt-trip, send
repeated messages, or insult them. End the chat and start a new match.
**How to resolve it:** recognise that nobody owes you a farewell. Take a short break if it stings.

### 2. Money, crypto, investment, or gift-card requests

**What happens:** romance scams, "my uncle's trading bot", fake prizes, "verification" links,
requests for gift cards or crypto transfers.
**How to react:** never pay, invest, share card numbers, wallet seeds, one-time codes or
identity documents. Do not click shortened links.
**How to resolve it:** leave immediately, use **Report → Scam**, and warn friends who might meet
the same account. No legitimate stranger needs your money.

### 3. Harassment, hate speech, or threats

**What happens:** insults, sexual demands, slurs, doxxing threats, or intimidation.
**How to react:** do not argue and do not retaliate. You cannot win a fight with a stranger, and
engagement rewards them.
**How to resolve it:** save what you need as evidence, **Report → Harassment** or **→ Unsafe**,
then **End & find next**. Credible threats of violence belong with local police, not the chat.

### 4. Sexual pressure or explicit content

**What happens:** unsolicited sexual messages, push for photos or video calls, age questions.
**How to react:** you decide what you share. Say no once, then leave — you do not need to justify
yourself. Luma is text-only and has no image upload, so keep it that way.
**How to resolve it:** report as **Unsafe**; repeated reports add temporary matching friction for
that abuse session. Never continue a conversation that makes you uncomfortable.

### 5. Requests for personal details

**What happens:** requests for your full name, address, workplace, school, social handles,
photos, or to "continue on WhatsApp/Telegram/Snapchat".
**How to react:** keep identifying details private. Do not move to another app with a stranger;
leaving Luma removes the encryption and safety boundaries of this site.
**How to resolve it:** decline, end the chat and report if they persist. Remember that anything
already sent can be screenshotted by the other person — ending a chat cannot take it back.

### 6. Bots, spam, and suspicious links

**What happens:** instant copy-paste openers, escort/ad spam, fake moderation messages asking for
credentials, phishing links, file downloads.
**How to react:** do not open links, download files, or send codes. Attention is exactly what bots
want.
**How to resolve it:** **Report → Spam**, then start a new chat. No one from Luma will ever ask for
a password or invite you to a login page from inside a chat.

### 7. Minors, illegal content, or self-harm disclosures

**What happens:** someone claims to be a minor in a sexual context, shares illegal material, or
expresses intent to harm themselves or others.
**How to react:** do not engage with or redistribute the content. Do not ask for more details.
**How to resolve it:** leave and report immediately. For an immediate risk to life, contact local
emergency services and, where appropriate, a trusted adult or support line in your country.
Luma cannot review encrypted messages or intervene in a live conversation.

### The reaction protocol (in order)

1. **Stop replying.** No explanation, debate, or revenge is required.
2. **Preserve what you need.** If you intend to report to authorities, note the time and content
   before leaving; local history can be deleted later from the sidebar.
3. **Use Report.** It sends a content-free safety signal (reason code only) — no message text.
4. **End & find next.** This disconnects both sides immediately and erases the room key.
5. **Escalate when needed.** Threats, extortion, sexual content involving minors, or self-harm risk
   go to emergency services or specialized reporting channels in your country.
6. **Regulate yourself.** Breaks reduce doom-matching; you are allowed to stop at any time.

### Behaviour that keeps anonymous chat kind

- Open with something small and specific instead of demands.
- Accept a "no" the first time and do not ask why.
- Keep other people's secrets; don't screenshot or share transcripts.
- Assume good faith but verify safety claims; don't send money or personal data.
- Do not impersonate moderators, ask for credentials, or test the relay's limits.
- Choose the local-history option deliberately: stranger chats are ephemeral unless you keep them.

### What Luma can and cannot do

- **Cannot read your messages.** End-to-end encryption means reports are content-free and no human
  reviews a transcript.
- **Reports add friction, not justice.** They can place a temporary matching cooldown on the
  reported browser session, but determined abusers can rotate storage, browsers, or addresses.
- **Cannot erase what was already saved.** The other person may have screenshots or notes.
- **Cannot verify age or identity.** Treat everyone as an unverified stranger, including people who
  claim to be someone else.
- **Safety codes**: compare the displayed code out-of-band if you need to rule out an active
  man-in-the-middle; TLS alone does not authenticate a stranger's key.

If you see a bug or a security issue in this project, follow the testing rules in `SECURITY.md`
and use only rooms and identities you created for testing.

## Preview

E2B preview: https://3000-io40uhrizojih3yoqtvun.e2b.app
