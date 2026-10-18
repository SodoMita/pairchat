# Contributing to Luma

Thank you for your interest in contributing to Luma! We welcome contributions from everyone.

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## How Can I Contribute?

### Reporting Bugs

- Check if the bug has already been reported in the [issues](https://github.com/SodoMita/pairchat/issues)
- Create a new issue with a clear title and description
- Include steps to reproduce the bug
- Add screenshots if helpful
- Specify your browser and operating system

### Suggesting Features

- Check if the feature has already been suggested
- Create a new issue describing the feature
- Explain why this feature would be useful
- Describe how you envision it working

### Submitting Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Commit your changes (`git commit -m 'Add amazing feature'`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

### Development Setup

```bash
# Clone the repository
git clone https://github.com/SodoMita/pairchat.git
cd pairchat

# Install dependencies
npm install

# Set up database
# Update DATABASE_URL in .env file

# Apply database schema
npx drizzle-kit push

# Start development server
npm run dev
```

### Testing

- Run the development server: `npm run dev`
- Test in multiple browsers
- Test on mobile devices
- Verify all features work as expected

### Code Style

- Use TypeScript
- Follow the existing code style
- Use meaningful variable and function names
- Add comments for complex logic
- Keep commits atomic and well-described

### Translations

We welcome translations to new languages! To add a translation:

1. Add the language to the `languages` array in `src/lib/i18n.ts`
2. Add a new entry to the `translations` object
3. Translate all keys from the English dictionary
4. Test the translation in the app

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
