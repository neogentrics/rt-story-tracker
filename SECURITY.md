# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for a security problem. Use GitHub's private report instead:
[report a vulnerability](https://github.com/neogentrics/rt-story-tracker/security/advisories/new). Include:

- what the problem is and what it could let someone do,
- the steps that show it, using made-up text and never your real writing,
- your app version (*Help → About*) and your operating system.

You should get a reply within 5 business days. Please give us reasonable time to release a fix before you tell anyone else.

## Supported versions

Only the latest release gets security fixes.

## What counts

A weakness in the password lock, the encryption, how keys are kept, or anything that lets one program or another person read
a locked project, a backup or a `.rtstory` file without a way in, is a security problem. So is anything that lets another
program push content into the app or read from it without the person approving it.

Losing the password and every other way in is not a vulnerability. By design nobody can open that project, and the app says so
when a password is set.

## How it's built

[Passwords and recovery](docs/design/passwords-and-recovery.md) explains the lock, why setting a password moves the project to
a new key, and what a lock can't do. In short:

- Every project is an encrypted database with its own random key, and attachments are encrypted under a key made from it.
- A project with a password is unlocked only by its password, its recovery key, or a trusted computer through the system's own
  encrypted storage. Nothing about a locked project is shown beside it except a name the author chose.
- A locked project is never sent to another app.
- Other Recon Towers apps reach this one over a local pipe or socket only, never over the network, and only after the person
  approves a link once. The keys for that are kept in the system's encrypted storage.
- The window runs sandboxed, with context isolation and no direct access to Node.
