---
title: "Design: the Recon Towers apps finding each other"
subtitle: The suite half of 3.9, written for the owner to decide on before anything is built
author: Recon Towers Dev Department
date: 2026-11-18
tags: [design, app-link, suite]
---

# The apps finding each other

This is the half of release 3.9 that used to be 3.8. RT Markdown Reader, and the apps still to be built, will copy whatever
is made here, so it's planned and agreed first. **Nothing on this page is built yet.** The records half of 3.9 is.

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

## What I need you to decide

**1. Which apps may be started from the Apps panel?** The start path comes from a file any program on this computer could
write. *Recommended:* only the five known suite ids, only when the path exists and is the app's own program, started with no
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

Nothing here is changed in that repo from this one.

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
