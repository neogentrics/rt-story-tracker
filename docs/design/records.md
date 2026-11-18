---
title: "Design: records"
subtitle: Kinds of record, records, links, @, saved views, numbering and bringing records in
author: Recon Towers Dev Department
date: 2026-11-18
tags: [design, records]
---

# Records

Where the story bible lives: characters, places, weapons, or any kind an author makes up. This page says how it's kept
and why. It's built in 3.9. Nothing about any one author's system is in the app: the owner's own setup is a
[template](#templates), and it can be changed or removed like any other.

## What's kept

A **kind of record** has a name, a list of **fields**, optional **numbering** and any number of **saved views**. A **record**
has a name, a number if the kind is numbered, a value for each field it has filled in, and **notes**.

| Field kind | Holds |
|---|---|
| Text, Long text | Words. Long text is a box that grows. |
| Number | Any number, with decimals. |
| Choice | One of a list, or several if the field allows it. |
| Date | A calendar date. A date on a made-up calendar is for the timeline, in v3.11. |
| Link to records | One or more other records, of one kind if the field says so. |
| Yes or no | A tick. |

Every field has a permanent ID, so renaming or reordering it never loses what was typed. Taking a field away hides its
values but leaves them stored, so a mistake can't destroy anything. Putting the same name back makes a new field.

## How it's stored

Both are ordinary items in the project, like chapters, under the rules in [the database design](database.md): a permanent
ID, a change log entry for every change, and a marker when something is removed for good.

- A kind is an item under the project, `recordtype`. Its `details` hold the fields, numbering and views.
- A record is an item under its kind, `record`. Its title is the name, its `body` the notes, its `details` the number and
  values.

So the Trash, Earlier versions of the project, backups, the password lock and sync cover records without any extra code.
Records stay out of the outline of books and chapters, and a kind in the Trash takes its records out of sight with it.

**Links** are kept in a table, `record_links`, of what points at what, and by which field or by an `@`. It's worked out from
the items every time one is saved, so like the word count it's never logged or synced, and it can always be rebuilt. It's
what lets a record show **everything that links to it**, including the chapters it's in.

## Numbers

A kind can number its records with a prefix and a width, such as `W-007`. A new record gets the lowest free number. A
number can't be used twice, and one that belongs to a record in the Trash stays taken, so putting that record back can't
clash. **Ranges** keep each series in its own set of numbers (100 to 199 for one, 200 to 299 for another), and the next free
number can be asked for within a range. A number outside every range is allowed: ranges guide, they don't police.

## @ in a chapter

Typing `@` and a few letters offers matching records. Choosing one writes the record's name into the text with an invisible
**mention** mark that holds its ID. The words stay in the text, so they count as words, export as words and are found by Find
like any others; the mark only says which record it is. Exports remove the mark, as they do for comments.

Clicking a mention only puts the cursor there, so a name in the middle of a sentence can still be edited. **Ctrl or Cmd and
click** looks it up beside the page. The same box looks up any record, from the View menu.

## Saved views

A view is a way of looking at one kind's records: a table or cards, filters, a sort and which columns. It's kept with the
kind, so it comes back next time and syncs with it. A view never changes a record. Filters are tests suited to the kind of
field, such as *is more than* for a number or *includes* for a link. Empty values always sort last.

## Bringing records in

From spreadsheets (CSV) or Markdown files, or a folder of them. A spreadsheet gives one record per row. A Markdown file gives
one record: its first heading is the name, and lines like `Role: Main`, `**Role:** Main`, a two-column table row or front
matter can go to the fields of the same name. A line that doesn't go to a field is left in the notes, and so is everything
else in the file. The author sees where each column or label would go before anything is written.

- New fields can be made from the files, and a kind can be made from them. The kind of a new field is guessed from what's in it.
- Words in a choice column that aren't choices yet are added as choices.
- Links are made by name once every record exists, so a link can point at a record from the same files. Notion's `Name (url)`,
  `[Name](file.md)` and `[[Name]]` forms are read as the name.
- A name that's already there is left alone, or filled in without wiping anything else.
- It lands in one step, so a failure leaves the project as it was, and a copy of the project is kept first.
- Anything it couldn't read is listed and left empty. Nothing is guessed.

## Getting it out

**Export everything** writes every record as a Markdown file, in the form it's read back in, and a spreadsheet for each
kind. A link leaves as the other record's name. Records are in the project's own file too, and in every backup.

## Templates

A template is a set of kinds, made in one go. They're ordinary kinds afterwards.

| Template | Makes |
|---|---|
| A single novel | Character and Place |
| A series | Character, Place, Object and Group, with where each first appears |
| A shared universe | Numbered Character, Weapon, Material and Place, each with a Draft or Frozen status, and room for ranges per series |

## Versions

For authors who need to say what a record said as of each book. Off by default: a kind keeps versions only when it's switched
on, and the simple templates leave it off.

- **A frozen version** is an item under its record, written once with everything in it: the values, both sets of notes, the
  fields as they were (each with who it's for), the book it covers, the date and what changed. It can't be edited, moved or
  thrown away on its own, and that rule is in `putItem`, below every screen. A record under canon lock isn't involved: freezing
  doesn't change it.
- **What's being edited is the next version.** There's no separate draft item. Freezing copies the record as it is into a new
  frozen version, and the record carries on as the next one, so “Revision 2 (draft)” is just the record.
- **Never unfrozen.** There is no way to unfreeze, and no undo window. A mistake is a *correction*: a note kept in the record,
  naming the version, which is added to the author's list of changes when the next version is frozen. Nothing in the frozen
  version moves.
- **One frozen version per book, for each record,** and a freeze needs a change since the last one.
- **Changes since** is worked out at freeze time and stored with the version, so it can't drift. There are two lists: what
  changed in print fields, which is printed, and what changed in author-only fields and notes and the corrections, which isn't.
  The first version has none.
- **A printable part and an author-only part.** In a kind that keeps versions, a field has an *audience*, print or author, and
  one with none is the author's. There are two sets of notes: *notes for print* and *author-only notes*. A kind that doesn't keep
  versions has one set of notes and prints its fields, as it always did.
- **`printable()` is the only way a record leaves as a document.** Print, Export everything and every other path call
  `src/main/export/printable.js`, so there is one place the author-only part has to stay out of. It also holds for the status
  line and facts for other apps, which never contain record contents. `test/records-versions.test.cjs` plants one marker in an
  author-only field, its name, the author's notes and a correction, and then searches every print page, every file Export
  everything writes, find, the status line, the facts and a book sent to another app. The real PDF is searched too, in
  `test/e2e/versions.e2e.cjs`.
- **The author's own full copy** is the `.rtstory` file and the backups. Export everything is a way out for the printable part.
- **Canon lock** is on a record. A locked record can be read, and a change needs the author's yes. The window asks before
  anything is typed, and the main process refuses any change that doesn't carry that yes, so nothing gets round it. Taking the
  lock off is a change too. An import that would fill in a locked record leaves it alone and says so.
- **Print records** puts each record on its own page, with a label such as `Record 0100 · Revision 2`, the name, the printable
  fields, what changed and the printable notes, as the latest frozen version of each or as a draft. A record with no frozen
  version is left out of a set and counted. The page is built from HTML in a hidden window, as the books are.
- **The label** is a word the kind chooses (“Record” by default), the record's number and the revision.

Not built: comparing two versions side by side. What changed is listed instead.

## Not here yet

A timeline and places on a made-up calendar (3.11), lore pages, ideas, research and the
dictionary (3.12), a catalog of books (3.13) and Claude working with records (3.14). Pictures on a record wait for pictures
on the page (3.18).

## Tested

`test/records.test.cjs` and `test/records-import.test.cjs` cover the rules, numbering, links, the Trash, import and the way
back out. `test/e2e/records.e2e.cjs` and `records-import.e2e.cjs` drive the real app through all of it, including a
restart. **Not yet tested:** a real folder of dossiers, which is the owner's to try on his own computer, and the Mac and
Windows builds, which CI covers.
