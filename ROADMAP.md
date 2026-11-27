---
title: StoryTracker Roadmap
subtitle: From a chapter editor to the place a book lives
author: Recon Towers Dev Department
date: 2026-11-04
tags: [roadmap, planning]
---

# Roadmap

Version 2.3 stored chapters on a PostgreSQL server you had to set up yourself, and it stopped there because there was no
plan. The [product plan](docs/product-plan.md) is that plan. This page lists the rebuild, in releases that can each be
tested on their own. The rebuilt app is called RT Story Tracker, and this replaces the older roadmap in the README.

> [!TIP]
> This file is written in Markdown, so it looks best opened in RT Markdown Reader.

**Legend:** 🙋 requested by the owner · 🛡️ needs a permission step · Size: **S** ≈ a day, **M** ≈ a few days, **L** ≈ a week or more

**Version numbers:** new features are 3.x releases (3.9 is followed by 3.10, 3.11…). 3.0 is a new major version because
it's a new app. The next one, 4.0, is kept for a change as big: the companion on phones and Chromebooks.

**Every release must:** install on a clean computer with nothing else set up, update from the release before it without
losing anything, and pass its automated tests on Windows, Mac and Linux.

| Release | Theme | Status |
|---|---|---|
| [v1.0–v2.3](#v10v23--the-first-app) | The first app | ✅ Released (Windows, needs a PostgreSQL server) |
| [Step zero](#step-zero--settle-the-foundations) | Settle the foundations | ✅ Done |
| [v3.0](#v30--write-a-book) | Write a book | ✅ Released ([3.0.0](https://github.com/neogentrics/rt-story-tracker/releases/tag/v3.0.0)) |
| [v3.1](#v31--comfortable-writing) | Comfortable writing | ✅ Released ([3.1.0](https://github.com/neogentrics/rt-story-tracker/releases/tag/v3.1.0)) |
| [v3.2](#v32--never-lose-a-word) | Never lose a word | ✅ Released ([3.2.0](https://github.com/neogentrics/rt-story-tracker/releases/tag/v3.2.0)) |
| [v3.3](#v33--get-it-out) | Get it out | ✅ Released ([3.3.0](https://github.com/neogentrics/rt-story-tracker/releases/tag/v3.3.0)) |
| [v3.4](#v34--bring-it-in) | Bring it in | ✅ Released ([3.4.0](https://github.com/neogentrics/rt-story-tracker/releases/tag/v3.4.0)) |
| [v3.5](#v35--find-my-files) | Find my files | ✅ Released ([3.5.0](https://github.com/neogentrics/rt-story-tracker/releases/tag/v3.5.0)) |
| [v3.6](#v36--password-lock) | Password lock | ✅ Released ([3.6.0](https://github.com/neogentrics/rt-story-tracker/releases/tag/v3.6.0)) |
| [v3.7](#v37--rt-markdown-reader-on-this-computer) | RT Markdown Reader, on this computer | ✅ Released ([3.7.0](https://github.com/neogentrics/rt-story-tracker/releases/tag/v3.7.0), [3.7.1](https://github.com/neogentrics/rt-story-tracker/releases/tag/v3.7.1), then [3.7.2](https://github.com/neogentrics/rt-story-tracker/releases/tag/v3.7.2)) |
| [v3.8](#v38--the-recon-towers-suite) | The Recon Towers suite | ✅ Released with [3.9.0](https://github.com/neogentrics/rt-story-tracker/releases/tag/v3.9.0), [built there](docs/design/the-suite.md) |
| [v3.9](#v39--records-with-the-suite) | Records, with the suite | ✅ Released ([3.9.0](https://github.com/neogentrics/rt-story-tracker/releases/tag/v3.9.0)) |
| [v3.10](#v310--versions-of-a-record) | Versions of a record | ✅ Released ([3.10.0](https://github.com/neogentrics/rt-story-tracker/releases/tag/v3.10.0)) |
| [v3.11](#v311--files-you-bring-in) | Files you bring in | Planned |
| [v3.12](#v312--read-aloud) | Read aloud | Planned |
| [v3.13](#v313--connect-claude) | Connect Claude | Planned |
| [v3.14](#v314--timeline-and-places) | Timeline and places | Planned |
| [v3.15](#v315--lore-ideas-research-dictionaries) | Lore, ideas, research, dictionaries | Planned |
| [v3.16](#v316--where-every-book-stands) | Where every book stands | Planned |
| [v3.17](#v317--claude-and-ai) | Claude and AI | Planned |
| [v3.18](#v318--leaving-notion) | Leaving Notion | Planned |
| [v3.19](#v319--two-computers) | Two computers | Planned |
| [v3.20](#v320--files-kept-in-step) | Files kept in step | Planned |
| [v3.21](#v321--pictures-and-tables-on-the-page) | Pictures and tables on the page | Planned |
| [v3.22](#v322--hear-it-and-say-it) | Hear it and say it | Planned |
| [v3.23](#v323--find-your-way-around) | Find your way around | Planned |
| [v4.0](#v40--the-companion) | The companion | Planned |
| [Later](#later--only-if-needed) | Only if needed | Ideas |
| [Ongoing](#ongoing--polish--distribution) | Polish & distribution | Ongoing |

## v1.0–v2.3 — The first app

✅ **Released, July 2025.** Windows only. Chapters in a rich text editor, themes, spell check, export to TXT, RTF, Word and
PDF, with data on a PostgreSQL server the user sets up. The [product plan](docs/product-plan.md#whats-already-built-and-whats-worth-keeping)
lists what carries over. It stays on The Bench and is off the App Store page until the rebuild is done.

## Step zero — Settle the foundations

Not a release: the choices that are expensive to change later. [Decisions](docs/decisions.md) 10 to 15 are made.

| Task | Size | Details |
|---|:-:|---|
| ✅ Finish the database test | S | [Done](docs/design/database.md#the-test-with-encryption-on) on Windows, Mac and Linux, with encryption on, from the real installers. |
| ✅ Project setup | M | The new app in this repo, with tests, CI on all three systems, a `LICENSE`, and a clean README. The old app is in `legacy-wpf`. |
| ✅ Storage rules | M | Permanent IDs, a change log and room for key slots, from the first table. [Sync](docs/design/working-with-rt-markdown-reader.md#sync-what-it-needs-from-storage) and the [lock](docs/design/passwords-and-recovery.md) can't be added later. |

**Test:** an empty app installs and opens on all three systems, and the test results are in the database design. ✅ Passed.

## v3.0 — Write a book

🙋 The main reason to open the app. No server, no login, nothing to set up.

| Feature | Size | Details |
|---|:-:|---|
| ✅ 🙋 Built-in storage | L | Everything saves by itself to the library. No database to set up, on any system. |
| ✅ Projects, books and chapters | M | A project holds series and books; a book holds parts and chapters. Drag to reorder, or use Alt and the arrow keys. Three columns, as in the old app. |
| ✅ 🙋 The editor | L | A page to write on, with bold, italic, headings, lists and alignment, plus Markdown shortcuts. |
| ✅ Word counts | S | Live, per chapter, per book and per project. |
| ✅ Saves itself | S | Two seconds after a pause, and every five during steady typing, with no Save button to forget. Closing or switching chapters saves first. |
| ✅ Installers & updates | M | Windows, Mac and Linux installers. Windows and the Linux AppImage update themselves. Mac and the `.deb` get a message with a download link, because a Mac app can't replace itself until it's signed. |
| ✅ A simple first run | S | One screen: start a project, or try a sample. |

**Test:** on a clean computer, install it, write a chapter, pull the power, restart: the chapter is there. Killing the app
outright is tested on all three systems. Pulling the power is still a hand test.

## v3.1 — Comfortable writing

Make it a place to spend a whole day.

| Feature | Size | Details |
|---|:-:|---|
| ✅ Spell check & your own words | M | With a personal dictionary, and *Add to Dictionary* from the right-click menu. Invented names stop being marked wrong. |
| ✅ Find & replace | S | In a chapter, a book, or the whole project. |
| ✅ 🙋 Themes & fonts | M | RT Markdown Reader's themes and fonts, the old app's themes, a new Slate theme, Glass with any theme, and app-wide font control. |
| ✅ Focus mode | S | Just the page. |
| ✅ Goals | S | Words per day and per chapter. |
| ✅ Comments | M | Notes on a selection that stay out of the book. |
| ✅ Split view | S | Two chapters side by side. |

**Test:** the owner writes a real chapter in it, by choice.

## v3.2 — Never lose a word

Comes before import, because the first thing people will trust it with is years of work.

| Feature | Size | Details |
|---|:-:|---|
| ✅ 🛡️ Version history | M | Every chapter keeps its earlier versions; compare any two and restore with one click. |
| ✅ 🛡️ Automatic backups | M | On a schedule, to a folder you choose. A closed backup is safe in OneDrive or Dropbox. |
| ✅ The `.rtstory` file | M | A whole project in one file, to back up or move. Double-click to open. |
| ✅ Trash | S | Deleted things wait 30 days. |
| ✅ 🙋 A friendlier look | M | Warmer, easier screens with clear buttons and icons, up to the standard of RT Markdown Reader's. |

**Test:** delete a chapter, restore it. Move a project to another computer with one file. Restore an old backup.

## v3.3 — Get it out

🙋 The app's format is private, so this is how your work leaves it. It ships before import, so nothing can ever go in
that can't come out.

| Feature | Size | Details |
|---|:-:|---|
| ✅ 🙋 Word | M | A chapter, a book, or a series as `.docx`, which also covers Pages on a Mac. |
| ✅ 🙋 PDF | M | With print preview, printing, and a contents page. |
| ✅ 🙋 Markdown, HTML, XML | M | Plus plain text and RTF. |
| ✅ 🙋 Store-ready EPUB | L | An EPUB that KDP and other stores' uploaders accept, with the cover, contents, metadata and book details they ask for, checked before it's saved. It does the job of a tool like Kindle Create in our own way, with nothing else to install. |
| ✅ OpenDocument | S | |
| ✅ Book layouts | L | Trim sizes, mirrored margins, front and back matter, for print PDFs and ebooks. To be shared with RT Markdown Reader's v4.0. |
| ✅ Export everything | S | A whole project as a folder of Markdown, pictures and CSV. |

**Test:** export a book to each format and open it in Word, Pages, Calibre and a browser. Upload the EPUB to KDP's previewer and at least one other store, and neither reports a problem.

## v3.4 — Bring it in

🙋 One file at a time, with Markdown first, because people bring in files made with AI.

| Feature | Size | Details |
|---|:-:|---|
| ✅ 🙋 Markdown | M | Front matter becomes fields; a long file can be split into chapters at its headings. |
| ✅ 🙋 AI clean-up | M | Finds chat text, stray symbols and odd headings in AI-made files, shows each, and asks. |
| ✅ 🙋 Word | M | Headings, italics and comments. Most manuscripts today. Pictures wait for attachments in v3.5, and the app says how many were left out. |
| ✅ More types | M | Plain text, RTF, HTML, EPUB, OpenDocument, and text from PDFs. |
| ✅ 🙋 Pages, best effort | M | Reads what it can; otherwise explains how to save as Word from Pages. |
| ✅ Scrivener | M | For authors moving over. |

**Test:** import a real Word manuscript and an AI-made Markdown file. Compare word counts with the originals.

## v3.5 — Find my files

🙋 Tell it where your files are, and it works out the rest or asks. [How it works](docs/design/file-types.md#importing-a-whole-folder).

| Feature | Size | Details |
|---|:-:|---|
| ✅ 🙋 Folder scan | L | Reads names and contents, and sorts them into series, books, chapters, versions and attachments. The originals are never touched. |
| ✅ 🙋 The plan & *Ask me* | M | Shows what it thinks as a tree. What it's unsure of, it asks. Drag to fix. |
| ✅ Older versions go into history | M | `v1`, `v2`, `Final`, `Copy`: the newest is the chapter, the rest are its history. |
| ✅ Pictures and other files | M | Covers, audio and PDFs become attachments, stored apart so projects stay quick. Pictures in Word, EPUB and OpenDocument imports are kept this way too. |
| ✅ The report | S | Every file accounted for. Stop and resume at any time. |

**Test:** the owner's Stories folder (6.2 GB): every file is accounted for, and the originals are unchanged. **Passed** on 2026-11-05: all 2,526 files accounted for and none changed, checked by contents and date before and after. Whether each book's chapters came out right is the owner's to judge.

## v3.6 — Password lock

🙋 Lock a project so that without getting into the app it's garbled. [The design](docs/design/passwords-and-recovery.md).

| Feature | Size | Details |
|---|:-:|---|
| ✅ 🙋🛡️ Password | L | Lock any project. Everything in it is encrypted, including search and history. Putting a lock on moves the project to a new key, so copies made earlier can't open it. |
| ✅ 🙋 Recovery key | M | Shown once, to save or print. |
| ✅ 🙋 Trusted computer | M | Optional. This computer can open the project through your login. |
| ✅ 🙋 Authenticator (2FA) | M | Works with any authenticator app. A code before opening on a trusted computer, and a way back in if you forget the password there. |
| ✅ Lock when idle | S | Or on close, or by hand, and when the computer locks or sleeps. |

**Test:** search a copied locked file for known words and find none. Recover using each way in. Get an outside review
before release. The first two pass, and are automated. An independent review by a separate AI session found eight
problems around the encryption and none in it, and all are fixed. On 2026-11-05 the owner decided that review is enough
for release.

## v3.7 — RT Markdown Reader, on this computer

🙋 Needs RT Markdown Reader 3.6. Built to [App Link](docs/design/working-with-rt-markdown-reader.md), not a second set of rules.

| Feature | Size | Details |
|---|:-:|---|
| ✅ 🙋 Send to StoryTracker | M | A document from RT Markdown Reader lands in a small window: which project, and as what. With no pairing, Open With works here; a menu item for it is on RT Markdown Reader's side. |
| ✅ 🙋 Open in RT Markdown Reader | S | A chapter or book opens there as a copy. Records join when they exist. |
| ✅ 🙋🛡️ Link once | M | The apps find each other and you approve once. Off until you turn it on. |
| ✅ Pictures come too | S | Coming in, through App Link's `attachments`. Going out waits until RT Markdown Reader reads them. |

**Test:** send a document each way, with and without a link, and with a locked project. **Passed** on 2026-11-05, in the
app's own tests and against RT Markdown Reader 3.10 from source.

## v3.8 — The Recon Towers suite

**Released with [3.9.0](https://github.com/neogentrics/rt-story-tracker/releases/tag/v3.9.0). Folded into 3.9 on 18 November 2026,** at the owner's request: the suite and Records ship as one release, 3.9, and
there is no 3.8. The plan, the owner's four decisions (all as recommended) and what was built are in
[the suite design](docs/design/the-suite.md). The table below is the original plan and says what became of each row.

🙋 The apps know each other when they're installed, not only when they're running. Built to
[the suite's rules](https://github.com/neogentrics/rt-markdown-reader/blob/main/docs/app-suite.md), not a second set.

| Feature | Size | Details |
|---|:-:|---|
| ✅ 🙋 Installed list | S | Each app leaves a small file saying it's installed and how to start it, and removes it when it's uninstalled. Replaces the guessing in Open in RT Markdown Reader. |
| ✅ 🙋 Apps panel | M | The same panel in every app: which Recon Towers apps are on this computer, which are running, and which are linked. It offers to link one or open one. Finding an app never links it. |
| ✅ 🙋 What it's doing | S | A linked app can ask for a short status, such as what's open. A locked project says nothing about itself, and no writing is ever in the answer. |
| ✅ 🙋 Asking for facts | M | A linked app can ask for what this one owns: word counts, draft status, dictionary pronunciations. This app can ask RT Author Desk for a book's published facts. |
| ✅ 🙋 Publish through RT Markdown Reader | S | Sending to WordPress, Ghost, Discord and wikis stays in RT Markdown Reader. This app hands it the chapter over App Link, and doesn't build its own. Never a locked project. |
| Automations | M | Webhooks and n8n can start an export or a backup, or add a note to a project. Off until you turn it on, and locked projects stay out. **Not in 3.9, as decided:** it opens a listener on this computer, so it gets its own design first. |

**Test:** install each app on a clean computer, in either order, and each finds the other. Uninstall one and it goes from
the list. Status from a locked project says nothing.

## v3.9 — Records, with the suite

🙋 Where the story bible begins: characters, and anything else an author wants to track. [How it's built](docs/design/records.md).

✅ **Released as [3.9.0](https://github.com/neogentrics/rt-story-tracker/releases/tag/v3.9.0).** The suite half of this release (v3.8 above) came out with it.

| Feature | Size | Details |
|---|:-:|---|
| ✅ 🙋 Record types | L | Characters, weapons, materials, or your own. Add any field: text, long text, number, choice, date, yes or no, a link to another record. |
| ✅ Templates | M | *A single novel*, *A series*, *A shared universe*. The owner's own setup is one of them. |
| ✅ 🙋 Records and links | M | Open a record, follow its links, and see everything that links back to it. |
| ✅ Saved views | M | Filter, sort and save, as tables or cards. Without this it feels worse than Notion. |
| ✅ Mentions | M | Type `@` in a chapter to link a record, and see every chapter a character is in. |
| ✅ Look up while writing | S | A side panel with the record, without leaving the page. |
| ✅ Numbering | S | Number ranges per series and prefixes like `W-001`, with the next free number offered. |
| ✅ Bring in records | M | From Markdown files, a folder of them, or CSV. The Universe Dossiers folder is the test. |
| ✅ Records on the way out | S | Export everything writes every record as Markdown and a spreadsheet for each kind, in the form it reads back in. |

**Test:** load every dossier, then find any character faster than in Notion. A new author can set up a plain novel.
*Passed so far:* the automated tests and the real app, on the VM, with made-up files. *Still the owner's:* his real dossiers
on his own computer, and finding a character faster than in Notion.

## v3.10 — Versions of a record

🙋 What a record said as of each book, for authors who need it. Off in the simple templates. [How it's built](docs/design/records.md#versions).

✅ **Released as [3.10.0](https://github.com/neogentrics/rt-story-tracker/releases/tag/v3.10.0).** The choices behind versions are decision 28 and behind
clips decision 29, in [decisions](docs/decisions.md). Clips are in this release so that Recon Browser 1.3 has somewhere to send them.

| Feature | Size | Details |
|---|:-:|---|
| 🙋 Versions per book | M | `0100 v1`, `v2`, each tied to the book it covers, with *Changes since* filled in for you. |
| 🙋 Draft and Frozen | S | A version freezes when the author freezes it for a book, naming the book. It can never be edited or unfrozen: fixes go in the next one. |
| 🙋 A printable part and an author-only part | S | Hidden lore and notes stay out of every print, export, status line and fact. |
| Print records | M | A record or a set as a PDF, with labels such as *Record 0100 · Revision 2*. Replaces the dossier scripts. Built last. |
| Canon lock | S | Locked items warn before they change, and change only if the author confirms. |
| 🙋🛡️ Clips from Recon Browser | S | Web research sent by Recon Browser over App Link, as a document of kind `research` with its source as front matter. It waits in the inbox, and nothing is filed or fetched without your choice. A locked project holds it until unlocked. No new protocol: it uses the key you approve once. |
| 🙋 Apps status icon | S | A small icon on the toolbar whose dot says at a glance whether other Recon Towers apps are linked, found or off, in words as well as colour. It opens the Apps panel, which lists every app with what you can do about it, including where to get one you don't have yet. The same in every app. |
| 🙋🛡️ Updates and compatibility in the Apps panel | S | The panel says when another app has a newer version, with both numbers and the right button, and it never stops a link. Two apps link or don't by their App Link version, never by the app's version, so an ordinary release can't break a link. Only an incompatible protocol blocks, and then the older app says *Needs an update to link*. The latest versions come from one small file on the Recon Towers site, with nothing about you in the request. |
| 🙋 Looks like the same family | S | A Help menu like the Reader's (Help Center, Keyboard Shortcuts, Check for Updates, About with the version), About as a window in the app with its links and *Copy Version Details*, a top bar on the library screen with Preferences and the apps icon, and F3 for Find Next. The Reader's **Tutorial** and **Find a Command** are left for later. |
| 🙋 Matches the suite's look and feel | S | Menus and words like RT Markdown Reader's, as set out in `docs/app-suite.md` there. File is short, with the project's own commands in a **This Project** submenu and *Export* and *Print* beside it, *Preferences* ends the Edit menu, and zoom is in a View submenu. Help is Help Center, Check for Updates and About with the version (Keyboard Shortcuts is kept, as in the Reader), and **Tutorial is left out of the menu until it exists**. Labels follow the Reader's (*Open…*, *Exit*, *Restart to Update*). One automated test opens every main screen, checks that every control has a name and that the main flows work from the keyboard. |
| 🙋 Your own shortcuts | M | Keyboard Shortcuts stays in the Help menu, and every command it lists can be given another key, or a key where it had none. A key another command has is refused and that command is named. So are keys that would get in the way of typing, and the ones for copying, pasting, undoing, bold, italic, underline, zoom and full screen. Reset puts one back, or all of them. The choice is kept on this computer, not in a project. |
| 🙋 A Preferences window | M | Preferences is a window like RT Markdown Reader's, sized to the app: its sections listed on the left (General, Appearance, Editing, Backups, Password lock, Linked Apps and Shortcuts), the settings on the right, *Help Center* bottom left and *Done* bottom right. Nothing is cut off at 1024 by 768. General adds a switch for reopening the last project. |

**Test:** freeze a version, try to edit it, and print a set without the author-only part. Send a clip from Recon Browser with
and without a link, and with a locked project. Watch the apps dot go grey, amber and green as you install, find and link
another app, and check that the panel says the same in words.

## v3.11 — Files you bring in

🙋 From the owner's own test of Find my files on a 1,952-file stories folder: nearly everything came in as one flat pile of
attachments. Issues 37 to 40, 42 to 47, and 49.

| Feature | Size | Details |
|---|:-:|---|
| 🙋 Sort by type | M | Find my files recognises what a file is and places it to match: covers, art, notes and outlines, audio, and only truly unknown files as attachments. The questions it asks default to a sensible answer, not always *Keep as attachments*. |
| 🙋 A files view | M | After a book is brought in, a list of every file in it, with a preview and a menu to change what a file is (chapter, cover, art, record, audio, attachment) or to remove it. Files that were not sorted in the preview can be sorted later. |
| 🙋 Audio, art and cover sections | M | A place for audio files, art and covers in each book, so they are sorted on the way in and browsed afterwards. |
| The number means words | S | The count beside a book, part or chapter says *words*, so it is not read as a file count. |
| 🙋🛡️ Check the folder for changes | M | A book remembers the folder Find my files read it from, because files get changed there outside the app. *Check folder for changes*, and a check when the project opens, list files that changed, are new or are gone. Nothing is applied by itself: a changed file can be taken from the folder, left as it is in the app, or kept as both, a new one is sorted into a section, and a missing one is only reported. Where a chapter changed in both places both are kept, and replaced text goes into its earlier versions. A locked project reads nothing until it's unlocked. Watching the folder and editing in both places stay in [v3.20](#v320--files-kept-in-step). |
| 🙋 Works at any window size | M | The app works in a small window and on a small screen, including Windows with the display scaled to 125 or 150 percent. In the top bar the title is shortened rather than running into the word counts, which shorten and then hide, and buttons that don't fit move into a *More* menu, the least used first, each still reachable from the keyboard and named for screen readers. Long headings wrap. The window never opens larger than the screen, and where room runs out things scroll rather than going out of reach. |
| 🙋 Lists you can arrange | M | The books list and the chapters list can each be made wider or narrower by dragging the line beside it, or from the keyboard, with a reset, and the widths are remembered on this computer. They stop before they push the page off a small window. Every series and part folds away with an arrow, and stays as you left it, with *Collapse all* and *Expand all*. A series looks clearly different from a book, with its books indented under it. |
| 🙋 Right-click menus | M | Right-clicking a series, book, part or chapter shows the app's own menu with what can be done to it, such as rename, add, move, fold, book details, export, duplicate and Trash, in place of the browser's. The Menu key or Shift+F10 opens the same menu. On the writing page the menu keeps Cut, Copy, Paste and Select All, and adds ones that fit, such as Comment. Anything destructive asks first or goes to the Trash. |
| 🙋 A readable apps window | S | The Recon Towers apps window is as wide and readable as Preferences, with larger text and buttons and every app shown, with no scrolling box inside it. |
| 🙋 A Look choice | S | *Look* takes the place of the Glass tick box: **Solid**, **Metallic** or **Glass**, in Preferences under Appearance, directly below the theme, as in RT Markdown Reader, and in the View menu. Anyone who had Glass ticked keeps Glass, everyone else keeps Solid, and Aero is always Glass. |
| 🙋 Metallic look | S | A brushed-metal finish on the app's toolbar, columns, windows and Find bar, copied from RT Markdown Reader's 3.13, on top of any theme. The page you write on stays flat, and High Contrast, forced colours, increased contrast and printing are left alone. A test measures the contrast of text in every theme. |
| 🙋🛡️ App Link: what this app does with each kind | S | An **App Link capability change**. When another Recon Towers app asks what this one is, the answer now also lists `kinds`: the kinds of document it does something special with, so a sender can offer an action for one kind only where it will mean something. Here that is `research` alone, for web clips. Any other kind still arrives as a plain document. `kinds` never decides whether two apps link: the App Link version does. |

**Test:** run Find my files on a large folder with pictures and audio. Cover art and audio land in their own sections, and a file wrongly marked as an attachment can be changed afterwards. Then change, add and remove files in the folder, edit one of the same chapters in the app, and check the folder: nothing changes without your choice, and no text is lost. At 1024 by 768 every app in the apps window can be read. Try each look in light, dark and High Contrast. Open the app at 640, 800, 1000 and 1280 wide, at 1024 by 600, and on a 1280 by 720 screen scaled to 125 and 150 percent: nothing in the top bar overlaps or is cut off, and every command can be reached. Make each list wider and narrower, fold a series and a part, restart, and find them as you left them. Do every right-click action with the mouse and again from the keyboard.

## v3.12 — Read aloud

🙋 Moved up from the Hear it and say it release, because a tester wants her chapters read to her. It matches RT Markdown Reader's read aloud, with the offline voices, so nothing leaves the computer. Issue 41.

| Feature | Size | Details |
|---|:-:|---|
| 🙋 Read aloud | M | Hear a chapter in a natural voice, with each sentence highlighted as it is read, a choice of voice and speed, and a choice of speakers or headphones. |
| 🙋 Same controls as RT Markdown Reader | S | Play, pause, skip a sentence, speed and voice, as in the Reader, so the two apps feel the same. |

**Test:** with the computer offline, read a chapter aloud, change the voice and speed, and pause and resume.

## v3.13 — Connect Claude

🙋 Connect this app to Claude Desktop, Claude Code and the Claude CLI, as RT Markdown Reader already does. A plan comes first, and it follows the Reader's way of doing it. Issue 36.

| Feature | Size | Details |
|---|:-:|---|
| 🙋🛡️ Connect Claude | L | Link Claude Desktop, Claude Code or the CLI to your stories on this computer, only with your say-so, through a connector you add in one click, with the connection shown in the Apps panel and easy to remove. Locked projects stay out. |
| 🙋🛡️ Your choice of access | M | Per project: **Off** (the default), **Read only**, **Suggest** (you accept or reject each change), or **Read and write** (Claude edits directly). |
| A record of changes | S | Every change Claude makes is in version history, labelled and undoable. |

**Test:** connect from each of the three, read a chapter, and remove the connection. A Claude session finds a dossier and suggests an edit, which appears as a change to accept. Try each of the other access levels too.

## v3.14 — Timeline and places

🙋 One timeline across every series, on your own calendar.

| Feature | Size | Details |
|---|:-:|---|
| 🙋 Your own calendar | M | Normal dates, or eras and epochs, with negative numbers. |
| 🙋 Timeline | L | Events tied to series, records and places, shown as a line and a table, and filtered by series. |
| 🙋 Places | M | A record type with kind, status and ruler. Places can sit inside places. |
| Spot clashes | M | Flags a character who's dead by an event they appear in, or events out of order. |

**Test:** load the Master Timeline and Locations, and check them against Notion.

## v3.15 — Lore, ideas, research, dictionaries

🙋 Everything else a story needs.

| Feature | Size | Details |
|---|:-:|---|
| 🙋 Lore pages | M | Free pages, with links both ways. |
| 🙋 Story ideas | S | Jot it, tag it, and turn it into a book when it's ready. |
| 🙋 Dictionaries | M | Glossary and invented words, with meanings and a pronunciation guide, including words from other languages. Feeds spell check and read aloud, and RT Markdown Reader's voices through App Link, so a name is taught once. |
| 🙋 Research | M | Sources, notes, pictures and PDFs, attached to what they're for. Clips from Recon Browser become Research records, with the source as the citation. |
| Citations | M | Bring in sources from BibTeX or Zotero, cite them, and build the list at the end. For research and non-fiction. |
| One search | M | Across chapters, records, lore and research. |
| 🙋 Smart search | M | Search by meaning as well as by word, on your own computer, beside One search. Using RT Markdown Reader's way of doing it. |
| Check links | S | Finds mentions and links that lead nowhere, across chapters, records and lore, as RT Markdown Reader's link checker does. |

**Test:** load the Universe Bible, Races and Research Library, and find a fact by search alone.

## v3.16 — Where every book stands

🙋 The Book Catalog and Works in Progress, kept current by the work itself.

| Feature | Size | Details |
|---|:-:|---|
| 🙋 Book catalog | M | Writing status and series live here. Published editions, formats, dates and store links are RT Author Desk's, shown here once it exists. Until then they're typed in here. |
| 🙋 What's left | M | One view of every book: words, chapters done, what's next. It updates itself. |
| 🙋 To-dos | S | Per book or project, and in the text. |
| Reading order | S | Publication order and timeline order, side by side. |
| Where this was sent | S | A list per book of what went where, and when. Needs App Link to say where a document landed. |

**Test:** Works in Progress can be retired, because this view says the same thing on its own.

## v3.17 — Claude and AI

🙋 Must be in the app, with settings for how far it goes. Follows RT Markdown Reader's AI services. Connecting Claude Desktop and Claude
Code to your projects came earlier, in [v3.13](#v313--connect-claude). AI is an
add-on: it's off until you turn it on, and the app is complete without it.

| Feature | Size | Details |
|---|:-:|---|
| 🙋 AI assist (optional) | M | Proofread, rewrite, shorten, translate or summarise a selection. You see the change and accept it. |
| 🙋 Your choice of AI | M | Claude, ChatGPT, Gemini, Mistral, OpenRouter, or a local model through Ollama or LM Studio, with a different model for each task if you like. Your own account and key, as in RT Markdown Reader. |
| 🙋 Claude Code | S | Use a Claude Code sign-in instead of a key, and Open in Claude Code from a project. |

**Test:** proofread a selection with a local model, with the computer offline.

## v3.18 — Leaving Notion

🙋 The goal. Everything is ready, so now it moves.

| Feature | Size | Details |
|---|:-:|---|
| 🙋 Import from Notion | L | Pages and databases, with their links, from a Notion export or a token you create. Maps to your record types. |
| Check it matches | M | A report: every page counted, and any field that didn't land. |
| 🙋 Universe Bible export | S | One file with all that's canon, for Gemini and others that read only files. |
| Keep a Notion copy (optional) | M | Only if [decision 20](docs/decisions.md) says so. |

**Test:** a month of story work with Notion closed, and nothing missing.

## v3.19 — Two computers

🙋 Same work on a desktop and a laptop, with no account.

| Feature | Size | Details |
|---|:-:|---|
| 🙋🛡️ Pairing code | M | A one-time code on one computer, typed on the other. Each saves the other's key. |
| 🙋 Sync | L | Over your home network, or through a folder you already sync, encrypted. |
| Both changed it | M | Writing is never dropped: both versions are shown side by side. |
| Paired devices | S | See them, choose what each can reach, and remove any. |

**Test:** change different things on two computers offline, reconnect, and check both. Then change the same chapter.

## v3.20 — Files kept in step

🙋 Optional sync of a file with RT Markdown Reader. Needs App Link version 2.

| Feature | Size | Details |
|---|:-:|---|
| 🙋🛡️ Linked files | M | A chapter or record tied to one Markdown file, per item. Off in locked projects. |
| 🙋 Changes to accept | M | A change in the file shows up as something to accept or reject. |
| RT Markdown Reader on another computer | M | Using the same pairing as v3.19. |

**Test:** edit in each app, then in both at once. Comments in StoryTracker survive an edit from the file.

## v3.21 — Pictures and tables on the page

🙋 What RT Markdown Reader's pages can hold. Until now, pictures sit beside the writing as attachments.

| Feature | Size | Details |
|---|:-:|---|
| 🙋 Pictures in chapters | M | Place a picture on the page, from an attachment or a file, and it goes through to Word, PDF and EPUB. Encrypted like the rest. |
| 🙋 Tables | M | A table editor for the page, with export to every format. |
| 🙋 Clean paste | S | Paste from a web page or Word as clean text, with only the formatting this app uses. |
| Bookmarks | S | Mark a place and jump back to it. Private notes are already comments, which stay out of the book. |

**Test:** a chapter with a picture and a table comes out right in Word, PDF and EPUB, and survives the KDP previewer.

## v3.22 — Hear it and say it

🙋 Read aloud itself moved up to 3.12. This release is the rest: names said right, and dictation, using RT Markdown Reader's offline voices and speech to text, with nothing to install and nothing
leaving the computer.

| Feature | Size | Details |
|---|:-:|---|
| 🙋 Names said right | S | Read aloud uses the dictionary's pronunciations, so an invented name is taught once. |
| 🙋 Dictation | M | Speak and it types, with the offline Whisper model and a choice of microphone. |

**Test:** with the computer offline, hear a chapter with an invented name said right, and dictate a page.

## v3.23 — Find your way around

🙋 What a big project needs once it has hundreds of chapters and records.

| Feature | Size | Details |
|---|:-:|---|
| 🙋 Quick Open | S | Type a few letters to jump to any chapter or record. |
| 🙋 Command palette | S | Every command, by name, from the keyboard. It opens on Ctrl+K, as in the Reader, so *Look Up a Record*, which has Ctrl+K today, becomes a command in it and takes another key, which can be changed like any other. Changing shortcuts is already in [v3.10](#v310--versions-of-a-record). |
| 🙋 Customize Theme | M | Change a theme's colours, and share them with RT Markdown Reader. |
| 🙋 Themes shared across the apps | L | **Waiting for the owner's go. Nothing here is being built.** Three parts, decided for the whole suite. **(1) One shared set:** themes, tokens, looks and the contrast tests live once, in a private repository, instead of a copy in each app. An app takes them in with a script that copies the files at a pinned version and writes a lock file. Both are kept with the app, so building it never needs that repository, and a test fails if the copy no longer matches the lock. **(2) Added themes, kept once:** a theme you make or load is stored once in the App Link folder you and the apps share, so every app offers it. It's checked, and refused if its contrast is too low. **(3) Following:** changing the theme, look or colour-safe in one app switches the linked apps on the same computer too. It needs an addition to App Link, and that protocol decision isn't made yet. This app keeps its extra themes: Slate, Blue/Orange, Plum, Evergreen and Aero. |
| 🙋 Colour-safe | S | Colours that work for colour-blind readers, in every theme. |
| 🙋 Tutorial | M | A hands-on tour with a practice chapter, offered the first time the app opens, skippable and resumable, and replayed from Help. People who update from an older version get it too. The Help menu has no Tutorial item until this exists. |
| 🙋 Help Center guides | M | Numbered, searchable guides kept as plain Markdown files in a `help` folder, like RT Markdown Reader's, each able to jump to the setting it explains. The Help Center in 3.10 is a short page of topics; these replace it. |
| Adjustable toolbar | S | Hide, reorder and shrink toolbar buttons, with names beside the icons if wanted. Copied from RT Markdown Reader's when it exists, in its v3.13. |

**Test:** run a morning's work from the keyboard alone, and pass the contrast test with a custom theme, with each of the three looks.

## v4.0 — The companion

🙋 Phones, tablets and Chromebooks. A second app, which is why it's a major version. Only the desktop has the database:
these devices sync with it.

| Feature | Size | Details |
|---|:-:|---|
| 🙋 The Android app | L | Runs on phones, tablets and most Chromebooks. Pairs by QR code. |
| 🙋 Read & look up | M | Records, timeline and chapters, offline. |
| 🙋 Notes & ideas | M | Quick notes that land in the project. |
| 🙋 Write on it | L | Chapters on the go, queued until it reaches the desktop. |
| 🙋 Approve from your phone | M | The phone as a way back into a locked project. |

**Test:** write on a phone with no connection, reach the desktop later, and nothing is lost.

## Later — only if needed

💡 Ideas kept for later, if people ask for them.

| Feature | Size | Details |
|---|:-:|---|
| 🙋 Theme and font packs | M | Download more themes and fonts as packs, and share them with RT Markdown Reader. |
| Your own PostgreSQL server | M | Connect to a server you run yourself. |
| Add-ons | L | Extra features you can add to the app, as in RT Markdown Reader. |
| Canon checking with AI | M | Read a chapter against the records and flag what doesn't match. |
| Scripts & screenplays | M | A writing mode, from the old roadmap. |
| Writing with others | L | Sharing a project with an editor or co-author. It needs a service in the middle. |
| Relationship maps | M | Family trees and who knows whom, drawn from the links. |
| iPhone and iPad | L | Depends on [decision 17](docs/decisions.md). |

## Ongoing — Polish & distribution

| Feature | Size | Details |
|---|:-:|---|
| Code signing | S | Windows and Mac, as for RT Markdown Reader. |
| Tutorial & Help Center | M | Built in [v3.23](#v323--find-your-way-around). Until then Help has a Help Center and a Keyboard Shortcuts page, and no Tutorial item. |
| Accessibility | S | Screen readers, contrast and keyboard use, checked in the tests. Started in 3.10: one test opens every main screen and checks every control has a name and the main flows work from the keyboard. |
| Languages | L | Every word of the app's own in one table per feature, with Spanish, French and German and right-to-left layouts, as in RT Markdown Reader. Product names aren't translated. |
| Recon Towers App Store | S | StoryTracker goes back on the App Store page when the rebuild is done. Until then it stays on The Bench. |

## Open decisions

The full list is in [docs/decisions.md](docs/decisions.md).
