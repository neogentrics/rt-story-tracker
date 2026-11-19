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
