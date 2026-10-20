# Luma — anonymous text chat roulette

> **Live preview:** https://3000-iojhjonxxht7y15sb8hg3.e2b.app
>
> Preview URLs are temporary and change when the sandbox restarts; the default GitHub branch is `main`.

Luma is a calm, anonymous one-to-one text chat. Meet another person who is searching at the same time, or create a private invite link for exactly one friend. Waiting depends on whether someone else is online. No profiles, no accounts, no images or calls.

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

## Connection reliability and what to expect

- A stranger chat needs **two different browser sessions searching at the same time**. The
  matching screen says so and offers a private invite while the queue is empty. Two tabs in the
  same browser share one session and cannot be matched to each other.
- Closing or reloading during a search no longer silently strands the browser in a 429
  "already waiting" state. A saved waiting seat is resumed with its original encryption key;
  if that key has been lost, a fresh search replaces the *waiting* seat without claiming it.
  Only recently checked-in waiting users are offered to a partner.
- A match updates local state in both tabs. One tab can no longer mistake the other tab's
  "active" update for a lost key and DELETE the matched conversation.
- End & find next waits for the server to confirm the old room ended before requesting a new
  one. Failed cleanup does not discard the only local key for a still-open room.
- Search expiry, rate limits, an offline partner, and a blocked browser storage API now have
  visible, translated explanations. Cancelled searches cannot reopen from late responses.
- On a fresh PostgreSQL database, the first request provisions the tables with Drizzle DDL;
  `/api/health` checks real chat tables instead of merely executing `SELECT 1`. Old raw room
  credentials are hashed during this awaited setup, while legacy peer credentials are removed
  from local transcripts. For upgrades of an existing schema, run `npx drizzle-kit push`.
- Matching and private-room creation are limited per anonymous browser session, not by a small
  IP-only bucket that all visitors might share when a proxy omits the client address. The
  proof-of-work challenge and contact budget still apply to unusually rapid matching.
- Notification sounds, encrypted delivery receipts, typing signals and the translated safety
  guide remain available. All nine common problems—including swearing—show their causes,
  possible consequences and responses directly in plain HTML. The guide has no accordion,
  show-more control, or checkbox gating entry; reading it is optional.

This MVP still uses a **single in-memory relay process**. Running multiple workers requires a
shared pub/sub and room-affine routing for SSE events; see `SECURITY.md`.

## Verification

The browser regression script covers: a 31-second wait followed by a real match, bidirectional
end-to-end messages and receipts, reload and lost-key recovery, same-browser tabs, private
invites, localized rate-limit feedback, blocked storage, and an end-then-next transition. It
uses its own browser profiles; run it on a test instance, not against other people's rooms.

```bash
npm i --no-save playwright
npx playwright install --with-deps chromium
BASE=http://localhost:3000 node scripts/browser-check.mjs
npx next typegen && npx tsc --noEmit && npm run build
```

## What usually happens in random anonymous chats

This is a description of the situation, not a list of orders. People already know they can leave. What is less obvious is what follows from staying, answering, or leaving.

### The other person disappears

A lot of chats end in the middle of a sentence. Sometimes the network dropped. Sometimes they got what they wanted, or nothing they wanted, and closed the tab. The consequence of reading that as a verdict on you is that the next chat starts already defensive. The consequence of treating it as the format is smaller: that transcript is over, and the next person is not the previous one. Nothing in the product tells you which of those causes it was.

### Swearing

Swearing shows up in a few different shapes, and they do not have the same aftermath.

Some people swear the way they talk. The words are rough and the subject is ordinary. Answering in the same register often just continues the conversation. Matching their volume does not, by itself, turn the chat into a fight.

Some swearing is aimed. It is about you, your silence, your boundary, or a group you were assumed to belong to. Answering that kind often has a specific consequence: the chat becomes a contest, and the other person now has a longer sample of how you react. Leaving has a different consequence. The chat ends for both of you, they may be annoyed, and anything already on their screen can still be copied. There is no middle outcome where the words are unsent.

A safety signal does not summon someone to read the transcript. It does not delete their copy. It can make their next stranger matches slower for a while. That is the whole effect. If the swearing was casual, that friction is a cost they did not necessarily earn. If it was aimed, the friction is still only friction.

### Cruelty, sexual pressure, and demands

Some chats move quickly from hello to a demand: a photo, a sexual script, an insult if you decline, a test of whether you will stay. Replying with an explanation often becomes the next thing they argue with. The consequence is more time in the chat, not a negotiated peace. Leaving ends your side. It does not make them kinder in the next room, and it does not erase what you already typed. A safety signal adds temporary matching friction for their browser session. It is not a case file and nobody reviews the messages, because the server cannot read them.

### Spam, bots, and people fishing for a reply

Repeated lines, links, or a script that ignores what you said are usually looking for any response. A reply is evidence that a human is on the other side, which is the thing the script was measuring. Silence plus ending the chat withholds that evidence. Reporting it as spam can slow that session's later matches. It will not identify a person, because there is no account behind the session.

### Money, codes, and personal details

Encryption hides the sentence from the server. It does not hide it from the other person. A bank code, a login code, a photo of an ID, a phone number, or a city small enough to find someone are still in their browser after you send them. Ending the chat does not pull that back. Keeping the chat does not make them more trustworthy. The safety code only tells you that the keys were not swapped by the relay if you compare it somewhere else. It says nothing about whether the person will ask you for money five messages later.

Impersonation works here because there is no profile to check. Someone can claim a job, an age, a crisis, or a platform role. The consequence of believing it is that you act on a sentence from an anonymous tab. The consequence of not believing it is that a real person in trouble gets a shorter conversation. The product cannot tell those apart.

### Awkwardness and silence

A pause is often just someone typing, or deciding to leave. Filling every pause has the consequence of doing the whole conversation yourself. A short boundary ("I don't want to talk about that") sometimes redirects the chat and sometimes becomes the topic. Either result is information. You do not get a record of it on the server, and they may keep one locally if they chose to.

### Language

The language menu changes your interface, not the other person's. If you cannot read each other, the chat stalls. Translation tools outside Luma mean pasting their words into another site, which is another copy of the conversation. Staying in a chat you cannot read mostly produces more unread text.

### The search itself

A waiting search used to die after a short silence, while the screen still said it was looking. A second tab in the same browser was rejected outright, so two windows could not meet. After a few skips, a proof-of-work check was hard enough that the browser often failed it, and the next match never started. Those are fixed: a live search stays in the queue, a vanished search is started again, a second tab can join the waiting person if nobody else is there, and the admission check is small enough to finish. If the other side never opens the live connection, the chat does not sit on "Connecting" forever.

## Sounds

Message, connect, and disconnect tones are generated in the browser. Browsers block audio until a click or key press, so the tone is armed by the same gesture that starts or sends a chat. The speaker button in the chat mutes them on this device.

## License

MIT. See [LICENSE](LICENSE). Security limits are described in [SECURITY.md](SECURITY.md).
