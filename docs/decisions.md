---
title: StoryTracker Decisions
subtitle: What's settled and what's still the owner's to choose
author: Recon Towers Dev Department
date: 2026-11-04
tags: [plan, decisions]
---

# Decisions

Each open decision gives the choices, what depends on it, and a recommendation. The recommendations are suggestions.

## Settled

1. **The main job.** ✅ Writing the book in it.
2. **Who it's for.** ✅ Any author, from day one. His own system is a template, not built in.
3. **What it takes from Notion.** ✅ Dossiers, timeline and places, lore pages and book tracking, plus story ideas,
   dictionaries and research.
4. **The file format.** ✅ App-only: files are imported, and the way out is export. Chosen for privacy. The Markdown copy
   beside it was turned down. Real `.pages` export is off the list, because the format isn't published; Word covers Macs.
5. **Importing a folder.** ✅ The app asks where the files are, reads the structure, and sorts them or asks.
6. **Password mode.** ✅ Yes, with several ways back in, 2FA among them.
   [The design](design/passwords-and-recovery.md) explains what 2FA can and can't do.
7. **Claude integration.** ✅ It has to be in, with settings up to read and write. *Cloud Integration* in his dictated
   answer was taken to mean Claude; correct this if it meant something else.
8. **Devices.** ✅ Every kind. Only the desktop app has the database, and phones and Chromebooks sync with it.
9. **RT Markdown Reader.** ✅ It goes first on App Link, and StoryTracker builds to those rules. StoryTracker is off the
   App Store page until the rebuild is done, and stays on The Bench.

## Needed before building starts

All chosen. He took the recommendations on 4 November 2026. The options stay here as the record.

### 10. Which database?

✅ **Chosen 4 November 2026: C.** SQLite now, with encryption. His own PostgreSQL stays possible later.

He asked to see both with a test. [The design](design/database.md) has the results.

| Choice | In short |
|---|---|
| **A. Built-in PostgreSQL** | What he first named. Works, but a background server, bigger install, a migration every few years, and no built-in way to make the password mode real. |
| **B. Built-in SQLite** | Nothing to run, smallest install, and a truly encrypted file. Can't serve other computers directly, which sync doesn't need. |
| **C. SQLite, with your own PostgreSQL as an extra later** | B now, and a home server stays possible. |

*Depends on it:* step zero, and the size of v3.0.
*Recommendation:* **C**, which means building B now. The password mode is what decides it. Speed doesn't: both were far
faster than needed, and both survived every crash.

### 11. What to build it with?

✅ **Chosen 4 November 2026: Electron.**

The old WPF code runs only on Windows, so it's a rewrite either way.

| Choice | Good | Not so good |
|---|---|---|
| **Electron**, as RT Markdown Reader | Reuses export, themes, AI services, the connector, sync, tutorial, updates and the release process. App Link fits directly. The same screens can become the Android companion. | Bigger install, uses more memory. |
| **Avalonia** (C# on all three desktops) | Stays in C#, smaller and lighter. | Almost nothing from RT Markdown Reader can be reused. |
| **Tauri** (web screens, smaller core) | Much smaller install. | Rust instead of Node, so RT Markdown Reader's main-process code doesn't carry over. |

*Recommendation:* **Electron.** The owner sees this app as doing much of what RT Markdown Reader does, and that's where
most of the saved work is.

### 12. A library, or one file per project?

✅ **Chosen 4 November 2026: Library.**

| Choice | In short |
|---|---|
| **Library** | All projects live inside the app, as he described. `.rtstory` files are for backup and moving. Safe from OneDrive damage. Works with any database. |
| **One file per project** | Like a Word document: you pick where it lives. Familiar, but a live file in OneDrive risks damage, and PostgreSQL can't do it. |

*Recommendation:* **Library.**

### 13. The kind of editor

✅ **Chosen 4 November 2026: Rich text, with Markdown shortcuts.**

| Choice | In short |
|---|---|
| **Rich text, with Markdown shortcuts** | You see a page, as in Word and the old app. |
| **Markdown with a preview** | As in RT Markdown Reader. Reuses its editor, but you see symbols while you write. |
| **Both, with a switch** | Most work, and every feature is built twice. |

*Recommendation:* **Rich text with Markdown shortcuts.** Writing is the app's main job and most of his work is in Word.

### 14. Sharing code with RT Markdown Reader

✅ **Chosen 4 November 2026: Copy to begin with,** and share a piece once both apps use it and it has settled.
For features more than one app needs, [decision 31](#31-apps-stand-alone-and-shared-features-are-one-module) replaced this on
27 November 2026.

| Choice | In short |
|---|---|
| **A shared package** | Export, themes, AI, connector and sync live in one place for both, and the suite's later apps. More setup now, and changes need care in both apps. |
| **Copy what's needed** | Fastest start. Fixes must be made twice, and the copies drift apart. |

*Recommendation:* **Copy to begin with, and pull into a shared package once a piece is used by both and settled.**
App Link should be the first.

### 15. The name

✅ **Chosen 4 November 2026: RT Story Tracker.** On 6 November he asked for the repo and the App Link id to follow, so both are `rt-story-tracker`. The file extension stays `.rtstory`, and the system's app id stays `com.recontowers.storytracker`, so updates keep working.

The suite's pattern is *RT something*.

| Choice | Note |
|---|---|
| **RT Story Tracker** | Follows the pattern. |
| **StoryTracker** | Keeps the name as it is. |
| **Something else** | The app is now more than a tracker: it's where books get written. |

Renaming the repo later is possible, but RT Markdown Reader's rename showed the care it takes, so it's cheapest now.
This also sets the `.rtstory` extension.

*Recommendation:* none. It's a taste call. **RT Story Tracker** fits his own rule, if nothing better comes to mind.

## Needed before a later version

### 16. Phones away from home (before v4.0)

The desktop has to be reachable, and from outside the house a phone can't get through a home router by itself.

| Choice | In short |
|---|---|
| **Home network only** | Simple and private. Away from home it works from its offline copy and catches up later. |
| **The author's own VPN** | WireGuard or similar. Fine for anyone who already runs one; too much to ask of most authors. |
| **A small Recon Towers relay** | Passes along encrypted data it can't read. Works anywhere, no accounts, but it's a service to pay for and keep running. |
| **Cloud folder from the phone** | Phones read OneDrive or Google Drive through their own sign-ins, which needs registered apps with each company. |

*Recommendation:* **Home network first, with VPN for those who have one.** Decide on a relay if people ask.

### 17. iPhone and iPad (before v4.0)

The App Store plan covers Windows, Linux, Mac and Android, with no iOS, but he picked every device here. An iPhone app
needs an Apple Developer membership and has to go through Apple's store.

*Recommendation:* **Leave it for later.** Android and Chromebooks first.

### 18. Marketing and royalties

✅ **Chosen 6 November 2026: They move to RT Author Desk.**

[The suite's plan](https://github.com/neogentrics/rt-markdown-reader/blob/main/docs/app-suite.md) gives these to a new app, RT Author Desk, along with published editions, ISBNs, prices and store links.

His answer on book tracking takes in the Book Catalog and Works in Progress. Notion also holds Marketing & Launches and
Sales & Royalties under Business Ops, which he's kept apart from the stories.

| Thing | Home | What this app does |
|---|---|---|
| Marketing, launches, royalties, accounts | RT Author Desk | Nothing. It's off this roadmap's Later list. |
| Published editions, formats, dates, store links | RT Author Desk | v3.16's catalog shows them, read over App Link |
| Writing status, word counts, what's left | This app | Keeps them, and Author Desk shows them |

It's what he already set up: stories and business apart. Until Author Desk exists, v3.16's catalog lets him type the
published facts in, and they move across when it arrives.

### 19. Recovery defaults (before v3.6)

| Question | Recommendation |
|---|---|
| Must an author save a recovery key to set a password? | **Yes.** It's the one way that works on any computer. |
| Is *trusted computer* on or off by default? | **Off,** offered on the same screen. It's easier, but weaker. |
| Should the app warn if there's only one way in? | **Yes,** once. |

✅ **Built in 3.6 as recommended.** The warning turned out not to be needed: the password and the recovery key can only be
replaced, never removed, so a locked project always has at least two.

### 20. How Notion ends (before v3.18)

| Choice | In short |
|---|---|
| **Move and stop** | Import, check, then Notion's story side becomes read-only and stays as an archive. |
| **Move one area at a time** | Dossiers first, then the timeline, and so on, with Notion leading until each is proven. |
| **Keep a copy going** | StoryTracker leads and Notion stays updated. Most work, and it can go wrong quietly. |

Claude sessions today read and update Notion constantly, and other work depends on that, so the change has to be planned.
Those habits are written in his Claude memory, and need changing at the switch.

*Recommendation:* **One area at a time,** starting when v3.17 is out.

### 21. Licence (before v3.0)

✅ **Chosen 4 November 2026: the same as RT Markdown Reader.**

The repo has no licence. RT Markdown Reader is proprietary, with public source.

*Recommendation:* **The same as RT Markdown Reader.** It's the suite's pattern.

### 24. Where the new releases go

✅ **Chosen 6 November 2026: The suite first.**

Comparing this roadmap with RT Markdown Reader added four releases. The suite became v3.8, because Author Desk, RT Press and
RT Audio Studio are being planned to it. Records and what follows moved up by one, to v3.9 to v3.20. Pictures and tables,
read aloud and dictation, and finding your way around are v3.21 to v3.23.

### 25. Which app keeps which export

✅ **Chosen 6 November 2026: This app keeps its exports.**

RT Press starts from this app's book layouts and EPUB work and goes further, for designed print interiors and cover wraps.
This app keeps its print PDF and EPUB, and Press shares the layout code rather than copying it.

| Choice | In short |
|---|---|
| **This app keeps its exports** | Anyone can still get a print PDF and an EPUB with no second app. Press adds design on top. Two places to maintain. |
| **Press takes print, this app keeps the rest** | Word, Markdown and EPUB stay here. Print PDFs move to Press. One home for print, but print then needs a second app. |
| **Press takes all of it** | The cleanest split, but this app stops being complete by itself, which goes against the suite's promises. |

Every app in the suite is meant to stand alone, and nobody should need a second app to get a book out.

### 26. 3.8 and 3.9 ship as one release

✅ **Chosen 18 November 2026: One release, 3.9.**

The owner asked for the suite (3.8) and Records (3.9) together, so there is no 3.8. Both halves are built and tested and not
yet released. The suite half is described in [the suite design](design/the-suite.md), and Reader and the apps still to be
built will copy it.

### 27. The suite's details

✅ **Chosen 18 November 2026: all four as recommended.** Built in 3.9.

Four choices, each with a recommendation, in [the suite design](design/the-suite.md#what-i-need-you-to-decide):

| Question | Recommended |
|---|---|
| Which apps may be started from the Apps panel? | Only the five known suite apps, from their own program, with no arguments |
| Does the status line include a project's name? | Yes when it isn't locked, and nothing when it is |
| Which projects can another app ask about? | Only the one that's open now, and only when it isn't locked |
| Automations (webhooks, n8n) | Leave out of 3.9 and give them their own design |

### 28. Versions of a record (3.10)

✅ **Chosen 18 November 2026,** the four answers below, from the owner through the orchestrating session.

| Question | Chosen |
|---|---|
| How are versions kept? | As items under the record, so the Trash, change log and sync cover them, like records themselves. |
| What does canon lock do? | It warns, and lets the author confirm. It doesn't forbid. |
| Can a frozen version be unfrozen? | **Never.** His rule is that fixes go in the next version. No Unfreeze button and no undo window: only a confirmation that names the book. A mistake is written down as a *correction* against the version, which is logged and goes with the next one. |
| Which book does a freeze belong to? | The one picked when it's frozen. |

Calls made while building it, which are the owner's to overrule:

- **The author-only part never leaves, in any export.** That includes Export everything, so the way out for a kind that keeps
  versions carries the printable part only. The author's own copy of everything is the project's `.rtstory` file and its
  backups. This follows his rule that it stays out of every print, export, status and fact path.
- **A field is for the author alone unless it says it's for print,** in a kind that keeps versions, so a new field can't reach
  paper by accident. A kind that doesn't keep versions prints what it always did.
- **One frozen version per book, for each record,** and a freeze needs something to have changed since the last one.
- **Canon lock is on a record,** not on a kind.
- **The first version has no "changes since".** Later ones list what changed, in print fields for print and in author-only
  fields for the author only.

### 29. Web clips from Recon Browser (3.10)

✅ **Chosen 18 November 2026,** from the owner through the orchestrating session. Recon Browser 1.3 sends research here, and
this is the receiving end.

| Question | Chosen |
|---|---|
| How does a clip get here? | Over App Link, the way every other document does, as `open_document` with `kind: "research"`, on a key the owner approves once. **No `rtstory://` protocol and no second inbox folder:** any web page can fire an operating system link, a command line can't carry a whole article, and a shared folder has no key. |
| How does the source travel? | As front matter in the Markdown: `source_url`, `source_title`, `source_author`, `source_date`, `accessed`, `category`, `tags`, and a `Source:` line at the end, so any app can read a clip. |
| Does Recon Browser show in the Apps panel? | Yes. `recon-browser` is a known suite id, so it's listed when installed or running and can be started from the installed list. |
| Where does a clip land, until Research records exist (3.12)? | **One chapter in a book called Research,** made if it's missing, with the front matter kept as the first lines of the chapter. The owner can pick another book. In 3.12 a clip becomes a Research record, with the source as its citation. |

The rules that came with it, which are built and tested: nothing is stored without the owner's choice in the inbox window; a
locked project holds the clip in memory, never in a file; the Markdown goes through the same reader as any sent document; **a
picture is never fetched on arrival or when the clip is added,** because that would tell the site it was read; at most 20 wait
and each is at most 8 MB.

Calls made while building it, which are the owner's to overrule:

- **A picture stays as words.** `![A weir](https://…)` goes into the chapter as `[Image: A weir (https://…)]`, so the
  reference survives and nothing is requested. Fetching a picture, as an attachment and only with the owner's yes, isn't built.
- **The front matter is checked, not copied.** Only the seven known keys are kept, controlled characters are removed, a
  web address must be `http` or `https` with no password in it, dates must be real-looking, and a category must be one of
  Recon Browser's six. Anything else is dropped. Front matter that never closes is ignored and its lines stay in the text.
- **The source lines are words in the chapter, so they count toward the book's word total.** A Research book with many clips
  will show more words than the owner wrote. A way to keep a book out of the totals is a later job.
- **A clip with no source still works.** The window shows no source line, and the chapter has none at the top.

### 30. Connect Claude gets its own release

✅ **Chosen by the owner, November 2026.** Connecting Claude Desktop and Claude Code to your projects no longer waits for the Claude and
AI release. It's **v3.13**, after *Files you bring in* (3.11) and *Read aloud* (3.12), and ahead of *Timeline and places* (3.14).

- **With the connection:** your choice of access (Off to begin with, Read only, Suggest, or Read and write), and the record of every
  change Claude makes, which can be undone. A locked project is never reachable. It follows RT Markdown Reader's connector.
- **Still later, together, in Claude and AI (3.17):** AI assist, your choice of AI, and signing in with Claude Code instead of a key.
- It was first planned as 3.11. It moved to 3.13 when the owner's own test of *Find my files* put sorting brought-in files first, and a
  tester's wish moved *Read aloud* up.

### 31. Apps stand alone, and shared features are one module

✅ **Chosen by the owner, 27 November 2026,** for the whole suite. Recorded in the
[feature map](https://github.com/neogentrics/rt-markdown-reader/blob/main/docs/app-features.md#decisions-the-owner-2026-11-27).

1. **Every app works on its own.** Nobody has to install RT Markdown Reader. An app never needs another app to do a job it advertises.
   When apps are linked, hand-offs over App Link are a bonus, never a requirement.
2. **A shared feature is one code module** that each app that needs it takes in, the way the themes are to be shared. It isn't got by
   asking the Reader. This covers read aloud, dictation, your own AI service, citations, document formats and the map's other overlaps.
   The module will live in a private repository like the one for themes. **It isn't created yet, and nothing moves into it until the
   owner says go.**
3. **Exports are built into every app that uses them,** so with only RT Story Tracker installed, it exports.

What it means here:

- **Decision 14** (copy to begin with, and share a piece later) no longer applies to these features.
- **Decision 25** stands: this app keeps its exports.
- On the roadmap, read aloud (v3.12), citations (v3.15), your choice of AI (v3.17), names said right and dictation (v3.22), and the
  Word, PDF and EPUB exports are to come from the module. The exports are this app's own code today.
- **Not settled by this:** which print PDF engine the shared package uses, and who owns book layouts.

### 32. Publishing is built into this app too

✅ **Chosen by the owner, 27 November 2026.** Asked whether publishing to WordPress, Ghost and Discord should be built into RT Story
Tracker too, instead of only into RT Markdown Reader, the owner said yes. It's planned for v3.25, and nothing is being built yet.

- **From inside this app:** publish a chapter or post to WordPress, Ghost and Discord, with no other app needed.
- **The sign-ins stay inside the Lock.**
- **RT Markdown Reader can still do it** over App Link.

How it fits [decision 31](#31-apps-stand-alone-and-shared-features-are-one-module):

- **Apps stand alone,** so publishing to these three can't depend on the Reader being installed.
- **It's now a feature two apps have,** so by decision 31 it's to come from the shared code module, not a second copy. That module
  isn't created yet, and nothing moves into it until the owner says go.
- **The App Link hand-off is a bonus,** as decision 31 says of all of them.

What it changes: from 3.9, publishing here has meant handing the chapter to the Reader, and this app built none of it. That stays the
only way until v3.25. The decision names WordPress, Ghost and Discord. Wikis, and anywhere else the Reader sends, aren't part of it.

**To settle before it's built:** the Lock is a password a project may or may not have. What keeps a sign-in safe where there's no
password, whether sign-ins belong to a project or to the app, and whether a project with a password may publish at all, are still open.

## The order, and where to start

### 22. Build order

✅ **Chosen 4 November 2026: Writing first, as written.**

The roadmap puts writing first, because that's his main reason for the app.

| Choice | In short |
|---|---|
| **Writing first, as written** | v3.0 to v3.7 make it a real writing app; records and Notion come after. |
| **Records sooner** | Move v3.9 to v3.16 ahead of v3.4 to v3.7. Reaches Notion's replacement sooner, while importing and the lock wait. |
| **RT Markdown Reader link sooner** | Move v3.7 up to right after v3.3. It's small, and RT Markdown Reader is ready for it first. |

*Recommendation:* **Writing first, as written.** Moving the link up is also fine, as it doesn't disturb anything else.

### 23. What to build first

✅ **Chosen 4 November 2026: Step zero, then v3.0.**

**Step zero, then v3.0.** Step zero can't start until 10 to 15 are settled, and 21 is needed for v3.0.
