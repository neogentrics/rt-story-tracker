# Changelog

All notable changes to RT Story Tracker (StoryTracker until 3.0) are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- **Picking up an unfinished *Find my files* run only reads a folder chosen on this computer** ([issue 50](https://github.com/neogentrics/rt-story-tracker/issues/50)).
  The folder's path is saved in the project, and a project can come from someone else, so the path isn't trusted by itself. Where the
  folder wasn't chosen here, or has moved, the app doesn't look at it. It asks you to choose the folder, and takes it if at least half of
  the files it was reading are there. An import also opens only files it finds by looking through that folder, so a file name saved in a
  project can't lead anywhere outside it.

## [3.11.0] - 2026-11-27

Files you bring in.

### Added
- **Find my files sorts what it keeps.** Every file it keeps now goes in a section: *Covers*, *Art*, *Audio*, *Video*, *Notes*,
  *Finished copies* (PDFs, e-books and what's in Print or E-book folders) or *Other files*, which is only for a type it doesn't know.
  The preview groups each book's files that way with a count, and any file can be moved to another section before you bring it in.
  Files brought in by an earlier version are sorted the same way, and nothing stored changes.
- **A Files view**, in place of Attachments (*File, This Project, Files*). It shows a book's files, or the whole project's, by section
  with a count for each, and has a search. A picture can be looked at, a sound played and a document read. Any file can be moved to
  another section or book, one at a time or many at once. A picture can become the book's cover, and the cover it replaces is kept.
  Writing can become a chapter or a record, and the file then waits in the Trash for 30 days. None of this writes an unencrypted copy of
  a file anywhere. Only *Save a copy* writes one out, where you choose.
- **The two lists can be resized.** Drag the line beside a list, or move to it with Tab and use the arrow keys. Enter or a double click
  goes back to the usual width. The widths are remembered on this computer, and in a smaller window the lists give way so the page keeps
  its room.
- **Series and parts fold away.** Each has an arrow, the left and right arrow keys do the same, and each list has *Collapse all* and
  *Expand all*. What's folded is remembered, and opening a project doesn't unfold it. A folded series or part shows when what's open is
  inside it, and a search in the chapter filter looks inside folded parts. A series now looks like a heading, with its books indented.
- **A right-click menu on every series, book, part and chapter,** which the Menu key and Shift+F10 open too. It offers what fits the
  row: open, rename, add, collapse, move up or down, move to another series or book, duplicate, export and *Move to Trash*, which has an
  Undo. The empty part of each list has a short menu for adding.
- **Duplicate** a chapter or a whole book. The copy comes straight after, with its writing, comments, goals, book details and cover.
  Files kept with a book and earlier versions aren't copied, and the app says when files were left.
- **On the writing page,** a right-click still offers cut, copy, paste, select all and spelling fixes, and now *Comment on the Selected
  Words* and *Find and Replace*. A right-click where there’s nothing to type in and nothing selected no longer shows a menu of
  greyed-out commands.
- **A Look choice, Solid, Metallic or Glass,** in place of the Glass tick box. It's in *Preferences*, under *Appearance*, directly
  below the theme, and under *View*, *Look*, as in RT Markdown Reader. If Glass was ticked you keep Glass, and otherwise you have Solid.
  Aero is always Glass and High Contrast always Solid, and your choice comes back with another theme.
- **Metallic,** a brushed-metal finish from RT Markdown Reader on the top bar, the lists, the formatting bar, the find bar, windows and
  menus, with any theme. The page you write on stays flat.
- **Check the folder for changes.** A project remembers the folder Find my files read. *File, This Project, Check Folder for Changes*,
  a button in *Files*, and a quiet check as the project opens list what has changed there, what's new and what's gone. Nothing changes
  until you choose it and press *Apply*, nothing is chosen for you to begin with, and the folder is only ever read.
  - A chapter changed only in the folder can be updated, kept as it is in the app, or kept as both. Where it changed in both places you
    can compare the two side by side, and whichever you choose, both sets of words are kept. Replaced and unused text goes into the
    chapter's earlier versions, which are never thinned out. Comments and record links stay with the earlier version, and restoring it
    brings them back.
  - An updated file's old copy goes to the Trash. New files are sorted into sections, and become chapters only if you say so. A missing
    file is only reported, and a moved one is recognised. Chapters in the Trash aren't brought back by themselves.
  - Only a folder chosen on this computer is read, because a project can come from someone else. On another computer, choose the
    folder once. A locked project reads nothing until it's unlocked.
  - For folders brought in before 3.11, a chapter saved at all since then counts as changed in the app, so you may be asked more
    often than you need to be, and a file that made several chapters can only be added beside yours.

### Fixed
- **Text that was hard to read now meets the contrast standard in every theme:** the hint text in empty boxes, the word count beside
  the chosen row, and, in Mist, Blue and Aero, the words on the tinted buttons in the top bar. The chosen button there, such as
  *Write*, is now shaded away from its text instead of toward it.
- **The app works in a small window and on a small screen.** In a narrow window the title in the top bar ran into the word counts and the
  buttons squeezed together. Now the title is shortened, then the counts, and the buttons used least move into a *More* menu that works
  from the keyboard. The lists narrow, and in a very small window books and chapters share one column. Long chapter and record titles
  wrap instead of being cut off, even in a full window. Preferences, Files and Records fit narrow windows. The window can now be made as
  small as 640 by 400, and never opens larger than the screen, including a small laptop with Windows scaled to 150 percent.
- **The word “null” no longer shows on screen.** It appeared on the forgot-password screen, on the screen for changing a password, and
  on a record's page, where a part of the screen that wasn't needed was written out as that word.
- **Find my files no longer drops a manuscript that has an exact copy in an old-versions folder.** Of identical files it kept whichever
  came first by name, so a copy in *Old Versions* could win for a book whose title sorts after it, and an older draft then became the
  book. Now it keeps the one most likely to be the writing: one that isn't old, then one that isn't in a notes or print folder, then one
  not named as a copy, then the one nearest the top. The others are listed as its copies. This applies to imports from now on, and a
  book already brought in the wrong way isn't changed.
- **Bringing records in fits a narrow window,** with each column of the file on its own lines, so nothing scrolls sideways.
- **Bringing records in is laid out in one column** at every size. It was spread over two by mistake, which in some windows left the
  box for a new kind's name too narrow to type in.
- **The Recon Towers apps window is easy to read.** It's as wide as Preferences, with larger text and buttons, and every app shows at
  once instead of in a small box that scrolled. On a small screen the whole window scrolls. The list in *Preferences*, under *Linked
  Apps*, has no scrolling box of its own either.

### Changed
- **App Link capability change:** when another Recon Towers app asks what this one is, the answer now also lists `kinds`, the kinds of
  document it does something special with. Here that's `research`, for web clips, and nothing else. Any other kind still arrives as a
  plain document. It never decides whether two apps link, and apps that don't know it carry on as before.
- **A project opened in 3.11 can't be opened in 3.10 or earlier,** which will say it was saved by a newer version. The app keeps a copy
  of the project from before the change, with its other backups of it.
- **The Light and Dark themes are now called Paper and Night,** as in the other Recon Towers apps. Nothing else about them changes.
- **Glass is left off** when your computer uses its own colours or asks for more contrast, and in printing, as Metallic is. It was
  already left off when your computer asks for less transparency.
- **Questions start on a likely answer.** Find my files no longer starts on *attachments*. Writing it can't place starts on *Notes*,
  and loose files named as chapters start on one book. A cover whose name uses underscores is now found.
- **Word counts say so.** The number beside a book, part or chapter now reads *226 words*, so it isn't taken for a number of files.

## [3.10.0] - 2026-11-27

Versions of a record, for authors who need to say what a record said as of each book. Web clips from Recon Browser. And an app that
looks and works like the rest of the Recon Towers family, with shortcuts you can change.

### Added
- **Keep versions**, a switch on a kind of record, off by default. A record can be **frozen for a book**: a copy of it as it is,
  tied to the book you choose, numbered Revision 1, 2 and so on, with what changed since the last one filled in for you.
- **A frozen version can never be changed or unfrozen.** Freezing asks once and names the book. A mistake in a frozen version is
  written down as a correction, and the fix goes in the next revision, which is the record as you're editing it.
- **A printable part and an author-only part.** In a kind that keeps versions each field is for print or for the author alone,
  and starts as author only. There are two sets of notes, one for print and one that never leaves.
- **Print records**: one record or a set as a PDF, each starting a page, headed like “Record 0100 · Revision 2”, as the latest
  frozen version or as a draft. Only the printable part is printed.
- **Canon lock** on a record: it can be read, and changes only after you've said yes.
- Export everything writes the printable part of each record, and each frozen version as its own file. The author-only part is
  never in it. It stays in your project and its backups.
- **Web clips from Recon Browser.** Recon Browser can send a highlighted passage, with its source, over App Link as a document of
  kind research. It waits in the inbox, and nothing is filed by itself. You choose where it goes, and it starts on a book called
  Research, made if it isn't there. It goes in as one chapter with its source at the top. A locked project holds it in memory
  until you unlock it. A picture in a clip is never fetched, and shows as a reference in words. Recon Browser now shows in the
  Apps panel when it's installed or running.
- **An apps icon on the toolbar,** with a dot: green when an app is linked, amber when apps are found and none is, grey when none is
  found, and a dashed ring when App Link is off. It opens the Apps panel, which now lists every Recon Towers app with one state in
  words (Linked, Found not linked, Installed not running, Not installed) and one button (Open, Link or Get it). Finding an app
  never links it, and nothing is checked on a timer: it looks when the window opens, when the panel opens and on Refresh.
- **The Apps panel says when an app has an update, and when two apps can't link.** *Update available* shows both numbers, with *Open to
  update* for an app that updates itself and *Download* for the rest, and it never stops a link. Whether two apps link depends on
  their App Link version and the kinds of document they accept, never on the app's version, so a normal release never breaks a link.
  If a security fix ever raises the minimum, the older app shows *Needs an update to link*. The latest versions come from one small
  file on the Recon Towers site, read when the panel opens or the app starts and kept for a day. The request carries nothing about
  you. If the file can't be reached it says *Couldn't check for updates* and carries on.
- **Your own keyboard shortcuts.** In *Help, Keyboard Shortcuts*, choose *Change* beside a command and press the keys you want. Commands
  that had no key, such as Trash or Attachments, can be given one. A key another command has is refused, and so is one that would get in
  the way of typing or that copying, pasting, undoing, bold, italic, underline, zoom or full screen use. Escape leaves a command as it
  was, *Reset* puts one back and *Reset all to the standard keys* puts back every one. Your keys are kept on this computer.

### Changed
- **Looks like the rest of the family.** A Help menu like RT Markdown Reader's: Help Center (F1), Keyboard Shortcuts, Check for Updates
  and About with the version in its name. About is now a window in the app with links to the website, this release's notes, where to
  report a problem and the source code, an engine line, the license and the open-source notices, and *Copy Version Details* for a bug
  report. The library has a bar across the top with an apps icon and a **Preferences** button, so the themes and fonts can be found
  before a project is open. That button takes the place of the one 3.7.2 added at the foot of the library. Find Next (F3) and Find
  Previous (Shift+F3) are in the Edit menu, and File ends with Exit on Windows and Linux. The Reader's Tutorial and Find a Command
  aren't here yet.
- **Matches the suite's look and feel.** The menus are laid out like RT Markdown Reader's. File is shorter: the commands for the project
  are in *File, This Project*, with *Export* and *Print* beside it. *Preferences* is at the end of the Edit menu (on a Mac, in the app
  menu), and the zoom commands are in *View, Zoom*. Every command keeps its key. About has a close button at the top right.
  Words follow RT Markdown Reader's: *Open…*, *Exit*, and an update that is *ready to install* with
  *Restart to update*; once one is ready, Help says *Restart to Update*. A new test opens the main screens and dialogs and checks that
  every control has a name and that the main flows work from the keyboard. There's no Tutorial item in Help yet.
- **A new Preferences window.** 3.7.2 set Preferences out in two columns. It's now a window sized to the app, like RT Markdown Reader's,
  with General, Appearance, Editing, Backups, Password lock, Linked Apps and Shortcuts listed on the left, *Help Center* bottom left and
  *Done* bottom right. The arrow keys move through the list. Shortcuts can be changed there as well as from Help. General is new: you can
  turn off reopening your last project, which was always on, and it has *Check for Updates…* and a link to the releases page.

## [3.9.0] - 2026-11-27

Records, where the story bible lives, and the apps finding each other. It includes the suite half that used to be 3.8,
described in [docs/design/the-suite.md](docs/design/the-suite.md).

### Added
- **Records.** A new **Records** side beside **Write**, at the top of every project. Make your own kinds of record, such as
  Character, Place or Weapon, with any fields you like: text, long text, number, choice, date, yes or no, or a link to other
  records. Or start from a template: a single novel, a series, or a shared universe.
- **Links both ways.** Link one record to another, follow a link, and see everything that links back to a record.
- **@ in a chapter.** Type `@` and a name to link a record. The name stays in the text as ordinary words. A record shows
  every chapter it's mentioned in, and a click goes to the chapter.
- **Look up while writing.** Ctrl or Cmd and click a linked name, or choose Look Up a Record from the View menu, to see a
  record beside the page without leaving it.
- **Tables, cards and saved views.** Filter by any field, sort, choose columns, and save the way you've set it up as a
  named view.
- **Numbering.** Number a kind of record with a prefix like `W-001`, with the next free number offered. Ranges keep each
  series in its own set of numbers. A number can't be used twice.
- **Bring in records** from spreadsheets (CSV) or Markdown files, or a folder of them. You see where each column or
  `Label: value` line would go before anything is written, new fields and kinds can be made from the files, and a failure
  leaves the project as it was.
- **Export everything** now includes every record, as a Markdown file each and a spreadsheet for each kind, in a form that
  reads back in.
- The sample project has two characters, linked from its first chapters.
- **Apps**, in Preferences, replaces Linked apps. It lists the other Recon Towers apps on this computer, whether each is
  installed, running or linked, and offers Open, Link and Remove. Finding an app never links it. An installed app can be
  started from here, but only the Recon Towers apps, and only the program itself.
- **Installed list.** The app now says it's installed, so others can find it while it's closed. The Windows installer does
  the same and removes it when you uninstall. The file holds no secrets.
- **What it's doing.** A linked app can ask for a short line, such as *Editing “Chapter 3” in “Salt Road”*, and for a book's
  word and chapter counts. Never any writing. A project with a password says nothing at all, the same as no project.
- **Publish Chapter with RT Markdown Reader**, in the File menu. It sends the chapter with a note that it's for publishing.
  Until RT Markdown Reader reads that note, it opens as usual and you choose Publish there.

### Changed
- Exports remove the link behind an `@` name, as they do comments, so a name is just words in the file.
- Every project gets a table for links the first time it's opened. Nothing is lost or changed, and a project from an
  earlier version opens as it did.

## [3.7.2] - 2026-11-27

### Changed
- **Preferences is wide enough to read.** On a normal window the sections sit in two columns instead of one narrow strip you scroll.
- **A Preferences button on the library screen**, so themes and fonts are easy to find without opening a project.

### Fixed
- **Find my files skipped every OneDrive file on Windows.** OneDrive files are Windows reparse points even when they are
  downloaded and kept on the device, and Windows reports every reparse point as a link. Find my files skips links, so it found
  almost nothing in a OneDrive folder. It now asks the file itself, and still skips real links. Reported by Tavie, who tested it
  on Windows 11.
- **A full copy in a Print folder is no longer a second manuscript.** A file like *Book FULL.docx* in a book's `Print` folder
  made Find my files ask how the book is organized. It is now treated as a finished copy and kept as an attachment, and it is
  only the manuscript if nothing else is.

## [3.7.1] - 2026-11-06

### Changed
- The project on GitHub is now `neogentrics/rt-story-tracker`, and the app's id for linking with other Recon Towers apps
  is `rt-story-tracker`, to match the app's name. If you linked the app with RT Markdown Reader in 3.7.0, link them again
  in Preferences. Nothing else changes, and your projects and settings stay as they are.

## [3.7.0] - 2026-11-05

RT Story Tracker and RT Markdown Reader work together on this computer.

### Added
- **Linked apps**, in Preferences. The apps find each other and you approve once. It's off until you turn it on, and a
  linked app can send you documents, not read anything here.
- **Documents sent here.** A document from RT Markdown Reader lands in a small window: which book, and as what. Nothing is
  filed by itself, and until you add it the document is only in memory. If no project is open it waits, and a locked
  project offers it after its password.
- **Open in RT Markdown Reader**, in the File menu, for a chapter or a book. It opens there as a copy. With a link it goes
  straight across. With no link it starts RT Markdown Reader, the same way as Open With.
- **Pictures come too.** Pictures sent with a document stay with the book as attachments.
- **Open With.** A Markdown or text file opened with RT Story Tracker waits to be added, the same as one that was sent.

### Security
- A password-locked project is never sent to another app, by either road. A plain copy made for RT Markdown Reader is
  removed as soon as a project is locked.

## [3.6.0] - 2026-11-05

Lock a project, so that without getting into the app it's a garbled mess.

### Added
- **A password** on any project, from Password and Lock in the File menu or the lock button. Everything is encrypted under
  it: the writing, the history, the search, the attachments and the title.
- **A recovery key**, shown once, to copy, save or print. It works on any computer. You can make a new one at any time.
- **Trust this computer**, optional. If you forget your password you can get back in through your login here. It never
  travels with the project.
- **An authenticator**, on a trusted computer: any authenticator app, a code before this computer's way in opens, and a
  wait after too many wrong codes.
- **Locking** by hand (Ctrl+L), on closing, after a set time away, and when the computer locks or sleeps. The time away is
  in Preferences.
- **A lock screen** with *Forgot your password?*, which lists the ways this project has, and leads to setting a new password.
- **Locked project files.** A `.rtstory` file of a locked project opens with its password or recovery key, on any computer.
- **A name for a locked project**, of your choosing, so the library can tell them apart without showing the title.

### Changed
- Exporting from a locked project, and saving a copy of an attachment, asks for the password first, because what comes out
  isn't protected.
- A locked project backs up while it's open and as it closes, to a folder that doesn't carry its title. After locking, the
  app makes a new backup and offers to delete older ones, which it can't protect.

### Security
- Putting a lock on, or taking it off, moves the whole project to a new key, so a copy made earlier can't open it. A big
  project takes a minute or two, and needs room for a second copy while it works.

## [3.5.0] - 2026-11-05

Tell it where your files are, and it works out the rest or asks.

### Added
- **Find my files**, on the library screen and in the File menu. Point it at a folder and it sorts everything into series,
  books, parts, chapters, earlier versions and attachments, using folder names, file names, version marks and exact copies.
  Your originals are only ever read.
- **The plan**: a tree of what it found, before anything comes in. Rename anything, drag chapters and books, or leave
  out a file or a whole book.
- **Ask me**: anything it can't tell becomes a question, such as how a folder with no pattern is organized, or which of
  two files is newer. Anything you leave uses the choice shown.
- **Earlier versions go into history**: `v1`, `v2`, `Final`, `Copy`, `(before 2026-11-02)` and old folders. The newest
  file is the chapter and the rest are in its history, with their real dates. An older whole manuscript joins chapter by
  chapter, and if part of it matches nothing, the file itself is kept too.
- **Attachments**: pictures, audio, PDFs and anything else, kept with a book or the project, encrypted, and stored apart
  from the writing so a big file never slows it down. The same contents are only stored once.
- **Pictures in imported files**: pictures in Word, EPUB and OpenDocument files now stay with the book as attachments.
- **Covers** are found in a folder and set on the book, and books in a series get their series name and number.
- **The report** accounts for every file: what it became, what was left out and why. You can save it as a text file.
- **Stop and resume**: a folder import can stop at any point, by choice or by a power cut, and pick up where it was
  without repeating anything.

### Changed
- A `.rtstory` file now carries attachments. A project with none is written as before, so older versions can still open it.
- Automatic backups keep attachments in a folder beside the backups, copied once, so big files aren't written again every
  time. Restoring a backup finds them there.
- Export everything now includes attachments.

### Known limits
- Pictures sit beside the writing as attachments. They don't appear on the page yet.
- Zip files stay as attachments and aren't unpacked.
- Two exact copies are treated as one file wherever they are, even in different books, and the report lists each copy.

## [3.4.0] - 2026-11-04

Your work can come in now, from wherever it's been living.

### Added
- **Import** (Ctrl+Shift+I) brings in Word, Markdown, plain text, RTF, HTML, EPUB, OpenDocument, text from PDFs, Scrivener
  projects and, as best it can, Pages files. Your original file is never changed.
- **See it first**: the Import window lists the chapters a file will become, with their word counts, before anything is
  saved. Split at chapter titles, at headings, or keep it as one chapter. It can go into a new book or an existing one.
- **Word counts compared**: for Word files the app counts the words in the file and in the chapters, and tells you if they
  don't match.
- **AI clean-up** finds chat text at the top and bottom of a file, text wrapped in a code block, bold used as a heading,
  headings that start too deep, leftover symbol lines, straight quotes and doubled spaces. Each one is shown, and you can
  untick anything you want kept.
- **Word files** bring their headings, bold, italics, underlining, centring and comments, and templates with their own
  chapter styles are understood. A title styled as one names the book.
- **E-books** bring their chapters, cover and details. Markdown front matter fills in a book's details. A file only fills
  gaps in an existing book's details and never replaces them.

### Changed
- EPUB exports hide the landmarks list, so tools that convert an e-book to text no longer show it as a stray contents list.

### Known limits
- Pictures don't come in yet. The app tells you how many were left out, and they arrive with attachments in 3.5.
- A PDF doesn't record headings or paragraphs, so that text is an estimate. Check it against the original.
- Apple doesn't publish the Pages format. If a Pages file can't be read, the app explains how to export it to Word.
- A comment from Word lands on the words before its marker, which may be more or less than the words it first covered.

## [3.3.0] - 2026-11-04

Your work can leave the app now, in any format you need.

### Added
- **Export** (Ctrl+E) a chapter, a book, a series or the whole project as Word, PDF, EPUB, Markdown, HTML, OpenDocument,
  RTF, plain text or XML. Comments and anything in the Trash never go with it.
- **Store-ready EPUB**: a cover, contents, metadata, series details and accessibility notes, passing the official EPUB
  validator. The app tells you what a store is likely to ask for before you export.
- **Book details**: author, publisher, ISBNs, description, keywords, series, copyright page, dedication, acknowledgements,
  about the author and more, plus a cover picture.
- **Book layouts** for print PDFs and Word: six trim sizes, mirrored margins with the binding margin set from the page
  count, a contents page with real page numbers, running headers, page numbers and drop caps. Chapters can start on a
  right-hand page.
- **For print**: the last page is blank and the page count is even, unless you turn that off. For a re-upload, you can
  keep a fixed page count so the cover's spine still fits. Print files have no links, because KDP's previewer warns
  about them.
- **Preview and print** (Ctrl+P).
- **Export everything**: a whole project as a folder of Markdown, covers and CSV.

## [3.2.0] - 2026-11-04

Never lose a word, and a friendlier look.

### Added
- **Trash**: anything can be deleted now, even a chapter full of writing. It waits 30 days, and an Undo appears straight
  away. Whole projects can go to the Trash from the library too.
- **Earlier versions**: every chapter keeps copies as you write, at most every ten minutes. Compare any two, word by word,
  and restore one with a click. What was on the page is kept first, so a restore can be undone.
- **The `.rtstory` file**: a whole project in one encrypted file, to move or back up. Double-click one to open it. If you
  already have that project, the one it replaces goes to the Trash.
- **Automatic backups**: every hour, day or week, to a folder you choose, keeping the newest ones. Safe in OneDrive or
  Dropbox, because a backup is a closed file. Nothing runs until you pick a folder.
- **Filter** the chapter list by name, and show or hide the lists with one click.

### Changed
- **A friendlier look**: line icons, a clear main button, the book and chapter in the title bar, softer rounded lists and
  cards, and the Inter font for the app. Goals, Focus and Find moved to the top of the window, with Undo and Redo above
  the page.

### Fixed
- In split view, the left page lost its alignment buttons.

## [3.1.0] - 2026-11-04

Make it a place to spend a whole day.

### Added
- **Spell check with your own words**: right-click a word for suggestions or *Add to Dictionary*, so invented names stop
  being marked wrong. *Preferences* lists your words and turns checking off.
- **Find and replace** (Ctrl+F, Ctrl+H) in a chapter, a book or the whole project, with match case and whole words. A
  replace across chapters keeps a copy of the project first and has an Undo.
- **Fifteen themes**: RT Markdown Reader's, the old app's and a new one, Slate. High Contrast stays flat, and the rest
  have panels that run from one colour to another.
- **Glass**: frosted panels over colour, with any theme but High Contrast.
- **Seventeen fonts for the page**, with text size and page width, and a choice of font for the app itself. Five of the fonts
  come with the app, so a book looks the same on every computer.
- **Focus mode** (Ctrl+Shift+F): just the page. Esc brings everything back.
- **Goals**: words a day for a project and words for a chapter, with the day's count at the top of the window.
- **Comments**: notes on a selection, kept out of the book and its word count.
- **Split view**: two chapters side by side, each saving its own text.
- **Preferences** (Ctrl+,).

## [3.0.0] - 2026-11-04

A new app, built from scratch for Windows, Mac and Linux. Nothing to set up and no server to run.

### Added
- **Write a book**: a page to write on, with bold, italic, headings, lists and alignment. Markdown shortcuts work too.
- **Projects, series, books, parts and chapters** in three columns. Drag to reorder, or use Alt and the arrow keys.
- **Live word counts** for each chapter, book and project.
- **Saves itself** a couple of seconds after you pause, and every five seconds while you type. Closing the app or switching
  chapters saves first.
- **Encrypted storage** on your own computer, with no database to install. A project with no password is private from a
  casual look. The password lock comes in 3.6.
- **A simple first run**: start a project, or try a sample.
- **Installers** for Windows, Mac and Linux. Windows and the Linux AppImage update themselves. Mac and the `.deb` tell you
  when a new version is out.

### Changed
- **Rebuilt in Electron**, replacing the Windows-only C# and WPF app. The old code is kept in `legacy-wpf`.
- **Renamed** from StoryTracker to RT Story Tracker.

### Removed
- **The PostgreSQL server**: the app no longer needs one.
- **For now:** themes, spell check settings, import and export from the old app. They come back in 3.1 to 3.4. See the
  [roadmap](ROADMAP.md).

## [2.3.0] - 2025-07-23

The last version of the old Windows app. Chapters in a rich text editor, on a PostgreSQL server you set up yourself. The
notes for it and older versions are on the [releases page](https://github.com/neogentrics/rt-story-tracker/releases).
