# Luma

Anonymous one-to-one text chat. No account, no profile, no message stored on the server.

Live preview: https://3000-ikfnas0k27xmw7arg1f83.e2b.app

Deploy the same repo on E2B: https://e2b.dev/deploy?repo=https://github.com/SodoMita/pairchat

The preview address can change when the sandbox restarts. The repository link above stays valid.

## What this is

Two people get a text box. Stranger chat pairs whoever is waiting. A private link is a room for one other person, with the key kept in the URL fragment so the server never receives it. Messages are encrypted in the browser. The relay can see timing and ciphertext length, not the words.

History stays in the browser. Stranger chats are dropped from this device when they end, unless that chat is explicitly kept.

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

## Run locally

PostgreSQL must be reachable at `DATABASE_URL` in `.env`.

```bash
npm install
npx drizzle-kit push
npm run dev
```

The app also creates the tables on startup if they are missing. `npx drizzle-kit push` remains the explicit schema path.

## Sounds

Message, connect, and disconnect tones are generated in the browser. Browsers block audio until a click or key press, so the tone is armed by the same gesture that starts or sends a chat. The speaker button in the chat mutes them on this device.

## License

MIT. See [LICENSE](LICENSE). Security limits are described in [SECURITY.md](SECURITY.md).
