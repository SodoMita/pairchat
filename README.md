# Luma - Anonymous Chat Roulette

A calm, anonymous place for one-to-one text conversations with strangers or friends by private invite.

## Features

- **Anonymous by design**: No names, emails, profiles, or permanent identity
- **End-to-end encrypted**: Messages are encrypted in the browser before being sent
- **Text-only**: Simple, focused conversations
- **Leave anytime**: You can end any conversation when you choose
- **Private links**: Create a private room and invite exactly one friend

## Quick Start

### Local Development

```bash
# Clone the repository
git clone https://github.com/SodoMita/pairchat.git
cd pairchat

# Install dependencies
npm install

# Set up database
# Make sure you have PostgreSQL running
# Update DATABASE_URL in .env file

# Apply database schema
npx drizzle-kit push

# Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

### Production

```bash
npm run build
npm start
```

## Common Problems in Random Anonymous Chats

Anonymous chat platforms can be wonderful for meeting new people, but they also come with unique challenges. Here's what to expect and how to handle common situations:

### 1. **Trolls and Harassment**

**What happens**: Some users may send offensive, inappropriate, or harassing messages.

**How to react**: 
- **Don't engage**: Don't respond or argue. This often encourages them.
- **End the chat immediately**: Use the "End chat" button to disconnect.
- **Report**: Use the "Report" button to send a safety signal. This helps reduce future matches with that user.
- **Block and move on**: After ending, start a new chat with someone else.

**Prevention**: The platform has rate limits and abuse detection, but no system is perfect. Your best protection is ending unwanted conversations quickly.

### 2. **Spam and Bots**

**What happens**: Automated messages, repeated text, or nonsensical content.

**How to react**:
- **Don't respond**: Bots often look for engagement.
- **End the chat**: Use the "End & find next" button to quickly move to a new conversation.
- **Report**: Use the "Spam or automation" report option.

**Prevention**: The platform includes proof-of-work challenges to deter simple bots, but sophisticated ones may still get through.

### 3. **Scams and Phishing**

**What happens**: Users asking for personal information, money, passwords, or to click on links.

**How to react**:
- **NEVER share**: Personal information, financial details, passwords, or verification codes.
- **Don't click links**: Even if they seem harmless.
- **End immediately**: If someone asks for anything suspicious.
- **Report**: Use the "Scam or impersonation" option.

**Remember**: This is an anonymous platform. Anyone asking for identifying information is violating the spirit of the service and likely has malicious intent.

### 4. **Awkward or Uncomfortable Conversations**

**What happens**: The conversation takes an uncomfortable turn, becomes too personal, or makes you uneasy.

**How to react**:
- **Set boundaries**: Politely but firmly state what you're comfortable with.
- **Change the subject**: Redirect to a different topic.
- **End the chat**: You have the right to leave any conversation at any time, for any reason.
- **No explanation needed**: You don't owe anyone a reason for leaving.

**Prevention**: Start with light, general topics. Avoid sharing personal details early on.

### 5. **Language Barriers**

**What happens**: You're matched with someone who speaks a different language.

**How to react**:
- **Use the language selector**: Both users can select their preferred language.
- **Be patient**: Try simple phrases or use translation tools.
- **End politely**: If communication is too difficult, end the chat and try again.

**Prevention**: The platform supports multiple languages, but matches are random across all users.

### 6. **Connection Issues**

**What happens**: Messages don't send, the chat disconnects, or the other person disappears.

**How to react**:
- **Wait a moment**: Sometimes it's a brief connectivity issue.
- **Check your connection**: Make sure you're still online.
- **Refresh**: If the chat is stuck, you may need to start a new one.
- **Try again later**: If the service is unavailable, wait and try again.

**Prevention**: The platform has automatic reconnection, but network issues on your end will affect your experience.

### 7. **The Other Person Leaves Suddenly**

**What happens**: Your chat partner disconnects without warning.

**How to react**:
- **Don't take it personally**: People leave for many reasons (bad connection, got busy, changed their mind).
- **Start a new chat**: Use the "Meet someone new" button.
- **Move on**: Each conversation is independent.

**Remember**: This is the nature of anonymous, ephemeral conversations. Not every chat will last.

## Safety Guidelines

### Do:
- ✅ Keep conversations light and respectful
- ✅ End chats that make you uncomfortable
- ✅ Report abusive behavior
- ✅ Protect your privacy
- ✅ Assume good faith initially

### Don't:
- ❌ Share personal information (name, location, phone, email, etc.)
- ❌ Share financial information or passwords
- ❌ Send harassing or abusive messages
- ❌ Click on suspicious links
- ❌ Continue conversations that make you uncomfortable

## Technical Details

### Encryption

- All messages are encrypted end-to-end using AES-256-GCM
- Each conversation has unique encryption keys
- The server cannot read message content
- Keys are generated in your browser and never sent to the server

### Privacy

- No personal data is collected
- No accounts or registration required
- Conversations are not stored on the server
- Local chat history is stored only in your browser

### Rate Limiting

- Each IP address is limited to prevent abuse
- Abuse signals create temporary cooldowns for reported users
- Proof-of-work challenges prevent simple bot attacks

## Deployment

### Environment Variables

```
DATABASE_URL=postgresql://user:password@localhost:5432/dbname
```

### Docker (Recommended)

```bash
# Build and run with Docker
docker-compose up --build
```

## Contributing

Contributions are welcome! Please read our [Code of Conduct](CODE_OF_CONDUCT.md) and [Contributing Guidelines](CONTRIBUTING.md).

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

## E2B Link

Try this app on E2B (Elastic Cloud):

[![Deploy on E2B](https://img.shields.io/badge/Deploy%20on%20E2B-4a4a4a?style=flat-square&logo=e2b)](https://e2b.dev)

Or deploy with one click:
- [Deploy to E2B](https://e2b.dev/deploy?repo=https://github.com/SodoMita/pairchat)

## Support

For issues, questions, or feedback:
- Open an issue on [GitHub](https://github.com/SodoMita/pairchat/issues)
- Join our [Discord community](https://discord.gg/example)

---

**Made for small moments of genuine connection.**
