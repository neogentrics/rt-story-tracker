# Contributing

Thanks for your interest in RT Story Tracker!

This is **proprietary software** (see [LICENSE](LICENSE)). The source is public for transparency, but **code contributions are
by invitation only**. Please don't open pull requests unless you've been asked to.

You are very welcome to:

- **Report bugs.** Open an issue with the *Bug report* template. Say what happened, how to make it happen again, and your
  version from *Help → About*.
- **Suggest features.** Use the *Feature or idea* template, after a look at the [roadmap](ROADMAP.md).
- **Ask questions or share how it felt.** Use the *Question or feedback* template.
- **Report security issues** privately, as described in [SECURITY.md](SECURITY.md).

Issues are public, so please keep your own writing, story names and private details out of them.

By submitting an issue, suggestion or other feedback you agree to the terms of the [LICENSE](LICENSE).

## For invited collaborators

```bash
npm ci
npm start          # build the window and launch the app
npm test           # unit tests
npm run test:e2e   # every end-to-end suite, in the real app
```

- Everything the window asks for is checked in the main process. The window is never trusted with a path, a key or a decision.
- Keep story content out of the repository: no real names, writing or private details in code, tests, screenshots or notes.
- A change to storage, export or another app needs a test for a locked project.
- Say what you couldn't check in the pull request, such as Windows or Mac behaviour.
