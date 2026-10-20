# Luma — anonymous text chat roulette

> **Preview:** https://3000-itden3yk7rin9ufs1q9gg.e2b.app

The live host changes when the sandbox restarts. The repository itself stays at
https://github.com/SodoMita/pairchat

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

## What actually happens in random anonymous chats (and why)

Anonymous chat is unpredictable by design: there is no reputation, no shared history and no
moderator reading the messages. Most sessions go fine, but the situations below come up
regularly. The same explanations are also shown, translated, on the home page (`#safety-guide`)
so people do not have to read a README to understand what is happening. The goal is to explain
*why* a reaction matters, not to lecture; the response choices are still your own.

### 1. The other person disappears mid-chat ("ghosting")

**Why it happens:** the other person closed the tab, lost interest, had to go do something, or
opened a new match in another window. They may not even know you are still typing. End-to-end
chats do not have a "left" signal until one side actually disconnects.

**What it can lead to:** repeated messages that the other person never sees, frustration that
turns into insults, and a worse mood than if the chat had simply ended. Sending more messages
will not get a reply that isn't coming.

**What to know:** no one is owed a goodbye in a stranger match. The chat ends when either side
ends it. If it stings, the most useful response is to take a short break before matching again.

### 2. Money, crypto, investment, or gift-card requests

**Why it happens:** these are the highest-yield scam formats on the open internet: romance,
"investment opportunity", "verification" link, fake prize, urgent help from someone pretending
to be a friend. Anonymous chat is a place they will try because the platform can never read
what they say.

**What it can lead to:** direct financial loss, wallet or account compromise (one-time codes
are not reversible), and ongoing targeting if you give a single data point. Even a small reply
identifies the account as real and reachable.

**What to know:** a legitimate stranger never needs your money, your wallet seed, your
verification code, or your card number. The same advice that applies to email and SMS applies
here. Leaving and reporting is the only safe response; the report is content-free and reaches
the relay without you quoting the conversation.

### 3. Harassment, hate speech, or threats

**Why it happens:** anonymity lowers the cost of cruelty for people who would not behave that
way in person. Some are testing what they can get away with, others are repeating a pattern
that worked elsewhere.

**What it can lead to:** retaliation that escalates the situation, real emotional harm, and in
the case of threats (especially threats of violence or self-harm) genuine danger. A long
back-and-forth keeps both people in a harmful state longer.

**What to know:** Luma is text-only, anonymous to the other side, and ends when you end it.
Save what you need as evidence *before* leaving, send a report, then end the chat. Threats of
violence are a matter for local police; Luma cannot intervene in a live conversation and the
relay has no human review.

### 4. Sexual pressure or explicit content

**Why it happens:** some people treat text chat as a place to push sexual content, sometimes
as a test, sometimes as a habit. Luma is designed for casual text only — there is no image,
audio, or video.

**What it can lead to:** a conversation that drifts into territory the other person is
pressuring, and an experience that no longer feels safe or fun. Continuing to engage often
raises the pressure rather than lowering it.

**What to know:** what you share is your decision. A single "no" is enough, and you are not
required to explain. Leaving is the strongest signal. Reports here add temporary matching
friction to the partner's session; they do not create a case, and they do not share message
content with anyone.

### 5. Requests for personal details

**Why it happens:** people naturally want to keep talking after a good match, and a "where are
you from" question is innocent on its own. The same question, combined with asking for a
phone number or to move to a different app, is how targeting usually starts.

**What it can lead to:** being identified and contacted outside Luma, where none of the
encryption or safety boundaries of this site apply. Once a phone number, photo or social
handle is sent, the other person controls it forever.

**What to know:** keep your full name, address, workplace, school, and social handles private.
Luma will never ask you to move to a different app; the moment anyone does, that is a sign to
leave. Anything already sent may already be screenshotted — the chat cannot be un-said.

### 6. Bots, spam, and suspicious links

**Why it happens:** spammers harvest any open text surface. The opening line is often a
templated compliment, an escort or "crypto mentor" pitch, or a fake moderation message
("verify your account by clicking here").

**What it can lead to:** phishing accounts, stolen credentials, malware, and continued
spamming if you reply (a reply confirms the account is live).

**What to know:** never open links or download files from a stranger match. No one from Luma
will ever message you from inside a chat. A report-as-spam plus a new match takes a few
seconds and removes the bot's attention reward.

### 7. Swearing, insults, and crude language

**Why it happens:** anonymous text lowers the social cost of strong language. Some people
swear casually with friends, others do it deliberately to provoke. There is no automatic
filter on the relay, because Luma cannot read encrypted content.

**What it can lead to:** a conversation that feels hostile, even when no one is "threatening"
in a reportable sense. Persistent crude language shortens the chat for everyone, including the
person typing it.

**What to know:** you decide what is acceptable in your chat. Strong language aimed at *you*
on purpose (especially with slurs) crosses from "rude" into "harassment" — the report flow
exists for that case. A one-off "damn" or "hell" is not a safety issue; a stream of personal
insults is. If a chat tilts that way, leaving is faster and cheaper than trying to moderate
the other person, and it is the only response that actually changes the experience.

### 8. Minors, illegal content, or self-harm disclosures

**Why it happens:** the open internet includes people in crisis and people who should not be
on an open chat at all. Luma has no age check, no identity check, and cannot read messages.

**What it can lead to:** real-world harm, including to the stranger themselves. Continuing
the conversation, even with good intentions, usually makes the situation worse.

**What to know:** do not engage with sexual content involving minors, do not redistribute
illegal material, and do not try to counsel someone through self-harm in an anonymous text
chat. Leave, report if appropriate, and contact local emergency services or a trusted
support line in your country when there is immediate risk. Luma cannot intervene in a live
chat; the relay cannot read message content.

### The patterns that follow from the above

A few consequences show up over and over, regardless of which situation triggered them:

- **Stopping a reply is the strongest signal available.** Engaging rewards the other side
  whether they are a bot, a scammer, or a person having a bad day. A silent end is not rude.
- **Local history is local.** Whatever was screenshotted on the other side cannot be
  unscreenshotted. The "Keep this stranger chat" option controls only *your* device.
- **A report is content-free.** Luma's relay never sees the message text. The report is just
  a reason code attached to the partner's session for a few minutes. Sending one costs
  nothing and is the only moderation mechanism the platform has.
- **The system can be wrong, and so can the user.** A bored or angry match may misread
  intent. The same is true in reverse. The default in Luma is "anonymous stranger, treat
  accordingly" — and the same grace extends to your own behaviour.
- **Breaks help.** Doom-matching (rapidly starting new chats to "find someone decent") is
  exhausting. Closing the tab is allowed at any time, for any reason.

### What Luma can and cannot do

- **Cannot read your messages.** End-to-end encryption means reports are content-free and no
  human reviews a transcript.
- **Reports add friction, not justice.** They can place a temporary matching cooldown on the
  reported browser session, but determined abusers can rotate storage, browsers, or
  addresses.
- **Cannot erase what was already saved.** The other person may have screenshots or notes.
- **Cannot verify age or identity.** Treat everyone as an unverified stranger, including
  people who claim to be someone else.
- **Safety codes**: compare the displayed code out-of-band if you need to rule out an active
  man-in-the-middle; TLS alone does not authenticate a stranger's key.

If you see a bug or a security issue in this project, follow the testing rules in
`SECURITY.md` and use only rooms and identities you created for testing.
