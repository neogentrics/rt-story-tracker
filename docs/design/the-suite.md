---
title: "Design: the Recon Towers apps finding each other"
subtitle: The suite half of 3.9, as planned with the owner and as built
author: Recon Towers Dev Department
date: 2026-11-18
tags: [design, app-link, suite]
---

# The apps finding each other

This is the half of release 3.9 that used to be 3.8. RT Markdown Reader, and the apps still to be built, will copy whatever
is made here. The owner agreed the plan, and all four recommendations below, on 18 November 2026, and it's built in this
app. [As built](#as-built) says what's different from the plan and what hasn't been tested.

The rules for App Link are in `docs/app-link.md` in the rt-markdown-reader repo. [The suite page](https://github.com/neogentrics/rt-markdown-reader/blob/main/docs/app-suite.md)
there says who owns what. Everything below is an addition to protocol version 1, which an app that doesn't know it ignores.

## What you'd see

- **An Apps panel** in Preferences, the same in every app. It lists each Recon Towers app on this computer, says whether it's
  installed, running and linked, and has three buttons: **Link**, **Open** and **Remove link**. An app that's installed but
  closed is shown, which isn't possible today.
- **A line about what the other app is doing**, for a linked app that's running, such as "Editing a chapter". Never any
  writing.
- **Numbers on request.** A linked app can ask this one for a book's word count or chapter count, and this one can ask
  RT Author Desk for a book's published facts once that app exists.
- **Publish from here.** A chapter goes to RT Markdown Reader to be sent to WordPress, Ghost, Discord or a wiki. This app
  builds none of that itself.

Finding an app never links it. You still approve each link once, in the app being asked, as now.

## How it works

| Part | What's added |
|---|---|
| Installed list | Each app keeps a small file `installed/<id>.json` in the App Link folder: its id, name, version, the path to start it, and the protocol. It's written on first run and after each update. The Windows installer also writes it at install, and its uninstaller removes it, so an app is found before it has ever been run. On Mac and Linux a file can be left behind, so a reader checks that the path still exists, and deletes the file if it doesn't. |
| Apps panel | Joins three lists: the installed files, the running files that already exist, and the saved links. |
| `status` | A new request, only for linked apps. The answer is `{ "state": "idle" \| "open" \| "busy", "line": "…" }`. A locked project, or none, answers `idle` with no line, so a locked project can't be told from no project. |
| `facts` and `get_fact` | `facts` lists what an app can tell. `get_fact` asks for one by name, such as `book.progress`. The names are added to `app-link.md` when the first app needs them. |
| Publish | A chapter is sent to Reader with the existing `open_document`, plus `intent: "publish"`. A Reader that doesn't know `intent` opens it as a normal document. |

## The four decisions

*All four were taken as recommended on 18 November 2026.*

**1. Which apps may be started from the Apps panel?** The start path comes from a file any program on this computer could
write. *Recommended:* only the known suite ids, only when the path exists and is the app's own program, started with no
extra arguments. A file from an unknown id is shown in the list but has no Open button.

**2. Does the status line include the project's name?** *Recommended:* yes when the project isn't locked, because "Editing
*Chapter 3* in *Salt Road*" is what a status is for. A locked project says nothing. If you'd rather it never names anything,
the line becomes "Editing a chapter".

**3. Which projects can another app ask about?** *Recommended:* only the project that's open right now, and only when
it isn't locked. Another app that wants the figures keeps its last answer. The other choice is every unlocked project in the
library, which would let a linked app read your library without the app being open.

**4. Automations (webhooks and n8n).** *Recommended:* leave them out of 3.9 and give them their own short design. They mean
a listener on this computer, and that needs a token, local-only access and a way to keep locked projects out. It's the one
part here that opens a door to the network stack, so it deserves its own review.

## What RT Markdown Reader needs (for its session)

Nothing here is changed in that repo from this one. The wire details are under [As built](#as-built).

1. Write and clean `installed/rt-markdown-reader.json`, as above, and the Windows installer entries.
2. The Apps panel, using the same layout and words, and the `status` request.
3. `get_fact` support only if Reader owns a fact. It owns none today, so it answers `facts` with an empty list.
4. Act on `intent: "publish"` in `open_document` by opening its publish step. The existing PR #33 is the place for it.
5. Keep accepting both ids, `rt-story-tracker` and the old `storytracker`.

## Safety rules for all of it

- Off until you turn App Link on, as now.
- A locked project is never described, never asked about and never sent. That includes its name.
- No answer carries chapter text, notes, record contents or file paths of your writing.
- Anything received is untrusted. A name is cleaned before it's shown, and a request without a good key is refused.
- Starting an app uses no shell, and takes no arguments from a file or a request.

## Build order and tests

1. The installed list and its removal, tested with a fake folder and by installing and removing on Windows.
2. The Apps panel, tested in the real window with two apps.
3. `status`, with a test that a locked project answers `idle` and nothing more.
4. `facts` and `get_fact` for `book.progress`: words, chapters and each chapter's draft status.
5. Publish, once Reader reads `intent`.

**Test for the whole thing:** install two apps on a clean computer, in either order, and each finds the other. Remove one
and it leaves the list. Ask for status from a locked project and get nothing.

## As built

In this app, on the branch for 3.9. The tests are `test/suite.test.cjs`, and the Apps panel, status and facts are in
`test/e2e/link.e2e.cjs` against a second App Link playing Reader.

- **Installed list.** `src/main/installed.js`. The app writes `installed/rt-story-tracker.json` each time it starts, as an
  installed copy only (not from the source), whether or not App Link is on, since it connects to nothing. A reader skips a file
  whose id doesn't match its name, whose `protocol` isn't 1, or whose `launch` isn't an absolute path, and **deletes** one whose
  path no longer exists. On a Mac `launch` is the `.app`, and for an AppImage it's the AppImage.
- **Windows installer.** `build/installer.nsh` writes the same file at install and deletes it at uninstall, with the path in
  forward slashes so it needs no escaping in JSON. *Not tested at run time:* it compiles with the real NSIS in the Windows
  build, but Wine on the VM couldn't run the installer to the end. The app rewrites the file in its own form on first run, so
  the worst case is that an app is found only after it has run once. A user name with non-English letters may be garbled in
  the installer's copy for the same reason. **Check this on a real Windows install.**
- **Apps panel.** In Preferences, under *Apps*, replacing *Linked apps*. Each row says installed, running and linked, shows the
  version and a status line for a linked app that's running, and offers **Open** for an installed app that isn't running,
  **Link** for a running one that isn't linked, and **Remove** for a linked one. This app doesn't list itself.
- **Open.** Only the suite's own ids (the five, and Recon Browser from 3.10), only a real program (a folder for a Mac `.app`, an `.exe` on Windows, an executable file
  elsewhere), started with no arguments and `shell: false`. An unknown id is listed but has no Open button, and the launcher
  refuses it as well. This can't tell an app from a different program given the same id by something running as you.
- **`status`.** A linked app only. `{ "state": "idle" | "open" | "busy", "line": "…" }`, with no `line` for `idle`. A project
  with a password, open or not, answers exactly as no project does. Lines: *Editing “Chapter” in “Project”*, *Looking at
  records in “Project”*, *Open: “Project”*, *Busy with a long job*. The window tells the app what's open so the line is right.
- **`facts` and `get_fact`.** `facts` returns `{ "facts": ["book.progress"] }`. `get_fact` with `"fact": "book.progress"`
  returns `{ "fact": "book.progress", "value": { "project": "…", "books": [{ "title", "words", "chapters" }] } }` for the open
  project, if it has no password. Otherwise `not_found`, "No project is open", whichever the reason. An unknown name is
  `not_found` too. No chapter text, notes, record contents or paths are ever in an answer. Draft status joins this when it
  exists (3.13).
- **Asking.** `AppLink.statusOf(id)` and `AppLink.askFact(id, fact, params)` are there for the Apps panel and for RT Author
  Desk once it exists. Only `statusOf` is used in the window so far.
- **Publish.** *File, Publish Chapter with RT Markdown Reader* sends the chapter with `intent: "publish"` over a link. With no
  link it opens as before, since a file has no way to carry the hint, and the message says to choose Publish there. A project
  with a password is refused, as for Open in RT Markdown Reader. **Needs Reader:** until it acts on `intent`, this is the same
  as Open in RT Markdown Reader.
- **Automations.** Not built, as decided.

### For the Reader session

1. Write and clean `installed/rt-markdown-reader.json` the same way, and add the same installer macros.
2. Add the Apps panel and `status`, `facts`, `get_fact` to its App Link. `src/main/app-link.js` here is the copy to start from,
   and `src/main/installed.js` is new. Keep Reader's own `id`.
3. Read `intent: "publish"` in `open_document`.
4. Say in `app-link.md`: `status`, `facts`, `get_fact`, the `intent` field, the installed list and the fact `book.progress`.

## Clips

Recon Browser 1.3 can send a highlighted passage, with where it came from, to this app. This is the receiving end, built in
3.10. It adds nothing to the protocol except a value for a field `open_document` already has: `kind: "research"`. The choices
are decision 29 in [decisions](decisions.md).

**How one arrives.** Recon Browser is an App Link app with the id `recon-browser`. The owner links it once, with the usual
question here. It sends `open_document` with `kind: "research"` and the Markdown as `text`. There's **no `rtstory://` link and
no inbox folder.** A web page can fire an operating system link, a command line can't carry a whole article, and a shared folder
has no key.

**What it carries.** Front matter, then the words, ending with a `Source:` line:

```
---
title: Medieval Aqueduct Architecture
source_url: https://example.com/page
source_title: The page's own title
source_author: A. Writer
source_date: 2026-04-12
accessed: 2026-11-18
category: setting
tags: [research, aqueduct]
---
The highlighted words, as Markdown.

Source: [The page's own title](https://example.com/page) by A. Writer (Accessed: 2026-11-18)
```

Every key is optional. A clip with no front matter, or front matter that never closes, is still a clip: it has no source to
show. `category` is one of lore, character, setting, historical, science or general. The optional fields are for
`docs/app-link.md` in the Reader repo, and the Reader session adds them there.

**What happens here.** It waits in the inbox, in memory, like any document. The window says *Recon Browser sent a web clip*,
shows the source on a line, and asks only *Add to*, which starts on a book called Research if there is one and otherwise offers
to make it. It goes in as **one chapter**, with the source as its first lines (`source_url: …`) and then the clip. In 3.12
the same lines are read into a Research record, with the source as its citation, so nothing needs to be typed twice.

**The rules, all tested.**

- Nothing is stored without the owner's choice. *Not now* and *Throw away* work as for any document.
- A locked project holds the clip in memory until it's unlocked. No file holds it before that, and a test searches the profile,
  the shared folder and the temp folder for it.
- The Markdown goes through the same reader as any document sent to this app, which drops scripts and raw markup.
- **A picture is never fetched,** on arrival or when the clip is added, because that would tell the site the owner read it. The
  reference is kept as words: `[Image: A weir (https://…)]`. A test runs a local server and asserts it is never asked for
  anything.
- The front matter is checked and not copied: seven known keys, a web address must be `http` or `https`, and anything else is
  dropped.
- At most 20 clips wait, each at most 8 MB.

**Recon Browser in the Apps panel.** `recon-browser` is a known suite id, so it's listed when it's installed or running, and can
be started from the installed list like the others. It writes its own `installed/recon-browser.json`; this app doesn't.

**Not built, and not tested.** Recon Browser's own sending side is in its own repo, so the tests use a small App Link playing
Recon Browser. Fetching a picture as an attachment, with the owner's yes, isn't built. A Research book isn't kept out of word
totals. A real clip from a real page hasn't been tried.

## The apps status icon

An icon at the right end of the toolbar, with a dot, that opens the Apps panel. It's built in 3.10, in the plan the owner set out
in `docs/app-suite.md` in the rt-markdown-reader repo ("Apps status in every app"), and this app is the one the others copy.

**The dot only summarises.** The panel and the icon's name carry the words, so colour is never the only signal, and the four dots
differ in shape as well as colour.

| Dot | Shape | Means | Name read out |
|---|---|---|---|
| Green | filled | At least one other app is linked | Recon Towers apps: An app is linked |
| Amber | filled with a ring | Apps are installed or running, and none is linked | Recon Towers apps: Apps found, none linked |
| Grey | a ring | No other app was found | Recon Towers apps: No other app found |
| Off | a dashed ring | App Link is off. The panel says so and has a **Turn on** button | Recon Towers apps: App Link is off |

**The panel** lists every app in the suite, not only the ones that are here, each with one state and its button. This app isn't
listed to itself.

| State | Button | When |
|---|---|---|
| Linked | Open, if it's installed and not running; and Remove | A link has been approved, open or not |
| Found, not linked | Link | It's running. Link asks for the one-time approval in the other app |
| Installed, not running | Open | Its `installed/<id>.json` is there and the `launch` path in it still exists |
| Not installed | Get it | Opens that app's page on the Recon Towers store |

Something that left an installed file but isn't one of the suite's apps is listed too, with no Open and no Get it.

**The rules.**

- Finding an app never links it.
- Nothing is checked on a timer. It looks once when the window opens, when the panel opens and when **Refresh** is pressed. (After
  Open it looks once more a few seconds later, because that is the moment the person is waiting to see the app appear.)
- An app is installed only if its file exists *and* the program it names still does. A file whose program is gone is deleted.
- Status is asked only of linked apps that are running, and a locked project says nothing about itself, not even its name.
- **Get it** takes an app's id, never an address. The page is looked up in the shared list in the main process, must be `https`,
  and is opened in the browser.
- No new protocol and no background service.

**One shared file.** `src/shared/suite-apps.js` holds the list (id, name, a short line and the store page for each app), the four
states and their wording, the four dots and their wording, and the two small functions that pick them. It has no dependencies,
so another app can copy it as it is. The launcher in `src/main/installed.js` uses the same list, so an app is added in one place.
A new app is one more line, and it appears in every app's panel by an ordinary update.

**Not known yet.** Only RT Story Tracker's own store page is a real address. The others open the store's list of projects until
each app has a page, and each address is changed in the shared file when it does. The icon is on the writing screen's toolbar; the
library screen doesn't have one yet. Recon Browser has been added to the shared list with the five apps in
`app-suite.md`, so the Reader repo's table needs the same line.

**Tested.** `test/suite.test.cjs` covers the list, the four states, the four dots, the installed check, Get it and which apps are
asked for status. `test/e2e/apps-status.e2e.cjs` drives the real window through every dot, the panel, Refresh, Link, Remove, Get it
and turning App Link on and off.

## Updates and compatibility

The Apps panel also says when an app has a newer version, and when two apps can't link. It follows the plan in `docs/app-suite.md` in
the rt-markdown-reader repo ("Updates and compatibility"), and it's built in 3.10.

**What decides whether two apps link.** Their App Link protocol, and the kinds of document each accepts, which `hello` already says.
Never the app's own version number, so two apps on different releases link fine, and an ordinary release can't break a link. Two
small additions to protocol 1 carry the rest: `hello` now also says `minProtocol`, the oldest protocol the app will link with, and an
installed file may say it too. An app that doesn't say it is taken to accept protocol 1, as before.

**The one case that blocks.** If the other app speaks a protocol older than this one's minimum, or this one is older than the other's
minimum (a security fix raised it), no link is made, and the older app shows **Needs an update to link**. That app is found and
listed, not hidden, and the panel says which of the two needs the update. Two apps with no kind of document in common also can't link,
but only when both list some, so an app that only sends, such as Recon Browser, still links. Nothing else blocks.

**The nudge.** An app with a newer release shows **Update available** with both numbers: "you have 3.7.1, the latest is 3.9.0". The
button is **Open to update** for an app that updates itself (the Windows installer, and a Linux AppImage, which is told by the start
path in the installed file) and **Download** for the rest. An app that is already open has no button, since it updates itself. It
never takes away a Link or Open button.

**Where "latest" comes from.** One small file on our own site, `https://recontowers.com/apps/versions.json`, not GitHub. The address is
in one place, `VERSIONS_URL` in `src/main/versions.js`, so it can change. The rules:

- It's read when the app starts (if App Link is on) and when the panel opens, and the answer is kept for a day, in one small file in
  the library folder that holds only what the site said. **Refresh** asks again, because that is the person asking. A failure is kept
  for an hour so a computer that's offline isn't asked at every click.
- The request is a plain GET of the address: **no query string, no ids, no list of what's installed, no cookies, no referrer and no
  headers of ours.** It's made with Node's own fetch, so it doesn't carry this app's name or version in its user agent as Chromium's
  would. A test with a fake fetch, and one against a server in the real app, check what was sent.
- If the site hasn't published the file (404) that's "not available" and nothing is said. If it can't be reached the panel says
  **Couldn't check for updates** and carries on with everything else.
- What comes back is untrusted: it's size-limited, and only a plain version number and an https page on the site are kept.

**The words,** in `src/shared/suite-apps.js` with the app list: *Update available*, *Needs an update to link*, *Couldn't check for
updates*, *Open to update* and *Download*. `isNewer`, `linkability` and `updateButton` are there too, with no dependencies, so another
app can copy them.

**Not tested.** Nothing has been tried against the real file, because the site doesn't publish it yet. A protocol other than 1 has only
been tried against a stand-in app. Whether an installed Windows app is a self-updating installer or a portable copy can't be told
from here, so on Windows every app is offered *Open to update*; a portable copy will be offered it too.

## Looking like the same family

The owner put the installed 3.7.1 next to RT Markdown Reader 3.11 and said this app didn't look like it belonged. This makes it look like
the same family without copying every feature. The structure is the Reader's (its Help menu in `src/main/main.js`, its About window in
`src/renderer/about-ui.js`), and the wording is in one small shared file, `src/shared/family.js`, that another app can copy.

**Help menu.** *Help Center* (F1), *Keyboard Shortcuts*, *Check for Updates…* and *About RT Story Tracker 3.10.0*, with the version in the
label, in that order. On a Mac, About is in the app menu, as the Reader does it. **Tutorial and Find a Command are the Reader's and aren't
here yet.** They're on the roadmap for later.

**Help Center and Keyboard Shortcuts** are two simple pages in one window. The Help Center's words are in `src/shared/help-pages.js`.
They name no keys, because keys can be changed.

**Changing shortcuts.** Every command that can have a key is listed once, in `src/shared/shortcuts.js`. The menu takes its keys from
that list and the Keyboard Shortcuts page shows it. A test builds the menu and checks that the two agree, both ways. On the page,
*Change* beside a command waits for the next key press, and *Escape* leaves the command as it was.

- **What's allowed:** Ctrl (Cmd on a Mac) with another key, or a function key. A plain letter, or Shift or Alt with one, would take over
  typing.
- **What's refused:** a key another command has (the page names it), and the keys for copying, cutting, pasting, undoing, selecting
  everything, zoom, full screen, quitting and what the writing page's editor does from the keyboard. Two starting keys, *Library*
  (Ctrl+Shift+L) and *Save a Copy* (Ctrl+Shift+S), are also the editor's keys. They were so before shortcuts could be changed, and
  each command can still go back to its own.
- **Reset:** one command, or all of them. A reset that would give one key to two commands is refused.
- **Where they're kept:** with this computer's settings, not in a project. Only the changes are saved, and what's read back is checked.
- **While it listens,** the menu has no keys, so pressing one that's taken doesn't run its command. The keys come back when the page
  stops listening, however that happens: a key, Escape, Done, the other tab, a menu item, the lock, another window on top, or leaving
  the app.

**About** is a window in the page, not the native box: the icon, the name, the version (and *portable* if it is), one line about the
app, and four links: *Website* (the Recon Towers project page), *What's new in this version* (this release on GitHub), *Report a problem or
suggest a feature* (the GitHub issues) and *Source code*. Under them an engine line (Electron, Chromium, Node and the system), then
© year Recon Towers, *License*, *Open-source notices*, **Copy Version Details** and *Done*. The window names a link and never sends an
address: the main process looks the name up in the shared file, so the window can't send anyone anywhere else. Copy Version Details
puts the version, the engine and the system on the clipboard, and a test checks that nothing about the person is in it. With no window
open (a Mac with every window closed) About is a short message box.

**A bar across the top of the library,** like the one in the writing room and the Reader's: the app's name, the apps icon, and a
**Preferences** button that opens the themes and fonts. Until now they were under File, then Preferences, or after a project opened, so
they couldn't be found. The icon is the same code as the writing room's, so the two can't differ.

**File and Edit, compared with the Reader's.** Added: *Exit* on Windows and Linux (the Reader's word for Quit), and *Find Next* (F3) and
*Find Previous* (Shift+F3), which the Find bar already did with its arrows. Not added, because they don't make sense here or aren't
built: Open Recent (the library is the list of projects), New Window (one project is open at a time), Save and Save As (everything saves
itself), Close Tab, Copy as Formatted Text, Find in Folder, and the Reader's tools for documents in folders.

**Not tested.** F1 can't be pressed by the real-app test (the menu takes the key before the page does), so it's checked on the menu item
only. How the About and Help windows look on a Mac and on Windows hasn't been seen.

## Look and feel

The owner wants one look and feel across every app, and `docs/app-suite.md` in the rt-markdown-reader repo ("Look and feel in every app",
2026-11-19) says what that is, with RT Markdown Reader as the reference. This is how this app stands against it in 3.10, and what is left.

| The standard says | This app |
|---|---|
| Menus short: Reader caps File at 20 items, with the less-used ones in a submenu | **Done.** File has 9 items, laid out like the Reader's: new, open and save, then *This Project* (its *This Document*), then *Export* and *Print*, then *Library* and *Exit*. *This Project* holds Import, Find My Files, Attachments, Book Details, Earlier Versions, Trash, Documents Sent Here, the three for RT Markdown Reader, Password and Lock and Lock Project, with the same keys. *Preferences* ends the Edit menu, as the Reader's does (on a Mac it's in the app menu). View keeps zoom in a submenu, as the Reader keeps text size. A test caps every menu at 20 items, File at 14, and checks what's where. |
| Help in this order: Help Center (F1), Tutorial, Check for Updates…, About with the version | **Done, except Tutorial.** The order is kept. Keyboard Shortcuts stays as well, as it does in the Reader. **There's no Tutorial item until there is a tutorial,** so there's no dead entry. It's in v3.20 on the roadmap. Once an update is ready the item says *Restart to Update (3.11.0)*, as the Reader's does. |
| Help Center with guides as Markdown files in a `help` folder, searchable | **Later (v3.20).** Today it's a short page of topics in `src/shared/help-pages.js`. |
| A tutorial, offered the first run | **Later (v3.20).** |
| About window with four links, an engine line, copyright, license, notices and Copy details | **Done** (see *Looking like the same family* above). |
| One Preferences window on Ctrl+comma, in sections | **Done** (see *Preferences* below). The library also has a **Preferences** button. |
| Shared themes with Glass, Follow System, fonts, and a contrast test | **Already so, not touched.** |
| Colour-safe, and Customize Theme | **Later (v3.20).** |
| Toolbar: icon buttons with names; an adjustable toolbar in the Reader's v3.13 | Buttons have names, and that's now tested. **The adjustable toolbar is copied from the Reader when it exists (its v3.13).** The apps icon is at the right end. |
| Updates: *Restart to update*, or a link to the download where the system can't update itself | **Already so**, with the Reader's words (below). |
| Accessibility: every button named, keyboard use, checked automatically | **Started.** One test, `test/e2e/accessibility.e2e.cjs`, opens 20 screens and dialogs, checks 814 controls, and runs the main flows from the keyboard. See below. |
| Languages: every word in a table, Spanish, French, German, right-to-left | **Later (Ongoing).** |
| Changeable shortcuts | **Done.** In *Help, Keyboard Shortcuts* (see *Changing shortcuts* above). |
| Command palette on Ctrl+K | **Later (v3.20).** Ctrl+K is *Look Up a Record* here today. When the palette arrives it takes Ctrl+K, and *Look Up a Record* takes another key. |
| Wording: *Open*, *Save*, *Restart to update*, *Check for Updates…* | **Done where the Reader has a word.** See below. |

**Preferences.** Laid out like the Reader's (`src/renderer/prefs-ui.js` there): a window up to 900 by 640 that follows the app window,
with the sections on the left, the chosen one on the right, *Help Center* bottom left, and *Done* bottom right. Only the right side
scrolls. The sections are General, Appearance, Editing, Backups, Password lock, Linked Apps and Shortcuts. They're one list in
`src/renderer/prefs.js`, so **AI and Claude** is one more entry when it's built. Until then it isn't listed. General has the Reader's two
things: reopening what was open (a new switch here, on to begin with, which is what the app did before) and *Check for Updates…* with
*Releases Page*. As in the Reader, there's no switch to turn update checks off. Shortcuts is the same editor as *Help, Keyboard
Shortcuts*, and only one of the two windows is open at a time. A test opens every section at 1024 by 768 and at 900 by 560, the
smallest the app allows, and checks that nothing is cut off or needs sideways scrolling.

**Wording, against the Reader's labels.** *Open Project File…* is now *Open…*, and *Save a Copy of This Project…* is *Save a Copy…* (the Reader
has no Save a Copy). *Quit* is *Exit* on Windows and Linux. The update banner says *Version X is ready to install.* with *Restart to
update*, and *Version X is available.* with *Download*. Check for Updates answers *You're up to date*, *Version X is ready to install*,
*Version X is available* and *Couldn't check for updates*, in a box titled Check for Updates, with typographic apostrophes as the Reader
has. Where the Reader has no label (the records, versions and the story bible) the app's own words stay.

**The accessibility test.** It opens the library, a project being written, Records with a kind and a record, Preferences, the Apps panel,
the Trash, Export, Attachments, Book Details, Earlier Versions, Password and Lock, the Help Center, Keyboard Shortcuts, About, the look-up
panel and Find, and checks every button, link, field, select, summary and editor on each for a name: an aria-label, a label, a title or
words inside it. A placeholder isn't a name. The test first proves it catches an unnamed button, a field with only a placeholder and a
link with only a picture. From the keyboard alone it types a project's name and starts it with Enter, Tabs to Preferences and opens it,
checks focus moves into the dialog and comes back, opens the Apps panel with Space, adds a chapter and types in it, and switches to
Records. Escape closes every dialog. **Not covered:** Import and Find My Files, which begin with the system's own file chooser, the lock
screen, and screen readers themselves: a name is checked for, not how a screen reader reads it. Contrast is the existing theme test's job.

