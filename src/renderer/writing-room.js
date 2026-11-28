// The three columns: books, then the chapters of the chosen book, then the page.
import { canHold, findNode, holdersOf, indexTree, resolveDrop, resolveStep, visibleRows } from '../shared/outline.js';
import { el, formatCount, shortCount, words } from './dom.js';
import { openDetails } from './details-dialog.js';
import { openExport } from './export-dialog.js';
import { openHistory } from './history.js';
import { createBarFit } from './bar-fit.js';
import { openFiles } from './files-dialog.js';
import { openFolderChanges, summarise } from './folder-changes.js';
import { openFolderImport } from './folder-import.js';
import { openImport } from './import-dialog.js';
import { createListSplitters } from './list-splitters.js';
import { closeMenu, openMenu } from './popup-menu.js';
import { icon } from './icons.js';
import { createAppsButton } from './apps-panel.js';
import { openInbox } from './inbox-dialog.js';
import { LookupPanel } from './lookup-panel.js';
import { Page } from './page.js';
import { RecordsView } from './records-view.js';
import { ensurePass } from './security-dialog.js';
import { openTrash } from './trash.js';

const DRAG_TYPE = 'application/x-rtst-item';
const lastChapterKey = (projectId) => `lastChapter:${projectId}`;
const MAX_GOAL = 10000000;
const KIND_ICONS = { series: 'series', book: 'book', part: 'part', chapter: 'chapter' };

// The order the top bar's buttons move into the More menu as it narrows, the least used first. The last few stay until the word counts
// have gone.
const LEAVE_ORDER = ['goals-button', 'trash-button', 'security-button', 'focus-button', 'history-button', 'import-button', 'export-button', 'attachments-button', 'lookup-button', 'find-button', 'prefs-button', 'apps-button'];
const STAY_LONGEST = 3;

function iconButton(id, name, label, onclick) {
  return el('button', { class: `bar-button ${id}`, title: label, 'aria-label': label, onclick }, icon(name));
}

// Which kinds fold away what's inside them.
const FOLDS = new Set(['series', 'part']);

function chaptersOf(node) {
  return node.kind === 'chapter' ? [node] : node.children.flatMap(chaptersOf);
}

function booksOf(node) {
  return node.kind === 'book' ? [node] : node.children.flatMap(booksOf);
}

export class WritingRoom {
  constructor(root, opened, { api, onLibrary, onPreferences, onSecurity, remember }) {
    this.api = api;
    this.onLibrary = onLibrary;
    this.remember = remember;
    this.projectId = opened.id;
    this.outline = opened.outline;
    this.folded = this.readFolded();
    this.bookId = null;
    this.chapterId = null;
    this.dragId = null;
    this.progress = opened.progress;
    this.secondPage = null;
    this.mode = 'write';
    this.records = null;

    this.message = el('div', { id: 'room-message', class: 'room-message', role: 'alert', hidden: true });
    this.subtitle = el('p', { id: 'room-subtitle', class: 'room-subtitle' });
    this.projectTitle = el('h1', { id: 'project-title', title: 'Double-click to rename' }, opened.title);
    this.projectTitle.addEventListener('dblclick', () => this.startRename(this.outline.id, this.projectTitle));
    this.projectWords = el('span', { id: 'project-words', class: 'header-words' });
    this.todayWords = el('span', { id: 'today-words', class: 'header-words' });
    this.bookList = el('ul', { id: 'book-list', class: 'rows', 'aria-label': 'Books' });
    this.chapterList = el('ul', { id: 'chapter-list', class: 'rows', 'aria-label': 'Chapters' });
    this.bookHeading = el('h2', { id: 'book-heading' }, 'Chapters');
    this.filter = el('input', {
      id: 'chapter-filter',
      class: 'list-filter',
      type: 'search',
      placeholder: 'Filter chapters…',
      'aria-label': 'Filter chapters',
      oninput: () => this.renderChapters(),
    });
    this.pageRoot = el('div', { class: 'pane' });
    this.secondRoot = el('div', { class: 'pane', hidden: true });
    this.pages = el('section', { class: 'column page-column', 'aria-label': 'Page' }, this.pageRoot, this.secondRoot);
    this.lookup = new LookupPanel(this.pages, {
      api,
      onError: (text) => this.showMessage(text),
      onOpenChapter: (id) => this.openChapterFromRecords(id),
    });
    // The apps icon: a dot that only summarises, with the same words as its name. The panel it opens carries the words.
    this.apps = createAppsButton(api);
    this.writeButton = el('button', { id: 'mode-write', class: 'mode-tab active', 'aria-pressed': 'true', onclick: () => this.showMode('write') }, 'Write');
    this.recordsButton = el('button', { id: 'mode-records', class: 'mode-tab', 'aria-pressed': 'false', onclick: () => this.showMode('records') }, 'Records');
    this.recordsRoot = el('div', { class: 'records-room', hidden: true });
    this.columns = el('div', { class: 'columns' });

    this.addDropZone(this.bookList, () => this.outline.id);
    this.addDropZone(this.chapterList, () => this.bookId);

    const tools = [
      iconButton('lookup-button write-only', 'records', 'Look up a record', () => this.toggleLookup()),
      iconButton('find-button write-only', 'search', 'Find and replace', () => this.find()),
      iconButton('import-button', 'import', 'Import', () => this.showImport()),
      iconButton('export-button', 'export', 'Export', () => this.showExport()),
      iconButton('attachments-button', 'attach', 'Files', () => this.showAttachments()),
      iconButton('history-button write-only', 'history', 'Earlier versions of this chapter', () => this.showHistory()),
      iconButton('goals-button write-only', 'goal', 'Goals', () => this.openGoals(this.activePage.chapterId)),
      iconButton('focus-button write-only', 'focus', 'Focus mode', () => this.toggleFocus()),
      iconButton('trash-button', 'trash', 'Trash', () => this.showTrash()),
      iconButton('security-button', 'lock', 'Password and lock', () => onSecurity()),
      this.apps.button,
      iconButton('prefs-button', 'settings', 'Preferences', () => onPreferences()),
    ];
    this.barWords = el('span', { class: 'bar-words' }, this.todayWords, this.projectWords);
    const barTitle = el('div', { class: 'bar-title' }, this.projectTitle, this.subtitle);
    const barRight = el('div', { class: 'bar-side bar-right' }, this.barWords, ...tools);
    let header;

    root.replaceChildren(
      el(
        'div',
        { class: 'room' },
        header = el(
          'header',
          { class: 'room-header' },
          el(
            'div',
            { class: 'bar-side' },
            iconButton('toggle-lists', 'menu', 'Show or hide the lists', () => {
              this.room.classList.toggle('lists-hidden');
              this.splitters.apply();
            }),
            el('button', { id: 'open-library', class: 'bar-primary', title: 'Library', 'aria-label': 'Library', onclick: () => onLibrary() }, icon('library'), el('span', { class: 'bar-text' }, 'Library')),
            el('div', { class: 'mode-tabs', role: 'group', 'aria-label': 'Show' }, this.writeButton, this.recordsButton),
          ),
          barTitle,
          barRight,
        ),
        this.message,
        this.columns,
        this.recordsRoot,
        el('button', { class: 'focus-exit', onclick: () => this.toggleFocus() }, icon('close'), 'Leave focus mode'),
      ),
    );

    this.bookFolds = this.foldTools('series');
    this.partFolds = this.foldTools('part');
    const booksColumn = el(
      'section',
      { class: 'column', 'aria-label': 'Books', oncontextmenu: (event) => this.listMenu(event, 'books') },
      el('div', { class: 'column-head' }, el('h2', {}, 'Books'), this.bookFolds),
      this.bookList,
      el(
        'div',
        { class: 'column-actions' },
        el('button', { id: 'add-book', onclick: () => this.addBook() }, icon('plus'), 'Book'),
        el('button', { id: 'add-series', onclick: () => this.addSeries() }, icon('plus'), 'Series'),
      ),
    );
    const chaptersColumn = el(
      'section',
      { class: 'column', 'aria-label': 'Chapters', oncontextmenu: (event) => this.listMenu(event, 'chapters') },
      el('div', { class: 'column-head' }, this.bookHeading, this.partFolds),
      this.filter,
      this.chapterList,
      el(
        'div',
        { class: 'column-actions' },
        el('button', { id: 'add-chapter', class: 'primary', onclick: () => this.addChapter() }, icon('plus'), 'Chapter'),
        el('button', { id: 'add-part', onclick: () => this.addPart() }, icon('plus'), 'Part'),
      ),
    );
    this.columns.append(booksColumn, chaptersColumn, this.pages);

    this.room = root.querySelector('.room');
    this.splitters = createListSplitters({ columns: this.columns, books: booksColumn, chapters: chaptersColumn, page: this.pages, remember });
    this.barFit = createBarFit({
      header, title: barTitle, bar: barRight, tools, leaving: LEAVE_ORDER, core: STAY_LONGEST,
      showWords: (level) => this.renderBarWords(level),
    });
    this.page = this.makePage(this.pageRoot);
    this.activePage = this.page;
    this.pageRoot.addEventListener('focusin', () => {
      this.activePage = this.page;
    });
    this.secondRoot.addEventListener('focusin', () => {
      this.activePage = this.secondPage ?? this.page;
    });
    this.keys = (event) => {
      if (event.key === 'Escape' && this.room.classList.contains('focus') && !document.querySelector('dialog[open]')) {
        this.toggleFocus();
      }
    };
    document.addEventListener('keydown', this.keys);
    this.showProgress();
  }

  makePage(root, extra = {}) {
    return new Page(root, {
      api: this.api,
      onWords: (id, count) => this.setWords(id, count),
      onTitle: (id, title) => this.setTitle(id, title),
      onError: (text) => this.showMessage(text),
      onSaved: ({ progress }) => this.setProgress(progress),
      onNewChapter: () => this.addChapter(),
      onLookUp: (id) => this.lookUp(id),
      find: {
        scopeBook: () => this.bookId,
        onFlush: () => this.flush(),
        onOpenChapter: (id) => this.openChapter(id),
        onReplaced: (outline) => this.afterReplace(outline),
      },
      ...extra,
    });
  }

  leave() {
    this.left = true;
    document.removeEventListener('keydown', this.keys);
    this.apps.destroy();
    this.barFit?.destroy();
    this.splitters?.destroy();
    closeMenu();
    this.records?.destroy();
    document.querySelectorAll('.mention-pop, .record-picker').forEach((node) => node.remove());
  }

  // Writing and Records are two ways of looking at one project. Whatever is being typed is saved before switching.
  async showMode(mode) {
    if (mode === this.mode) return;
    await this.attempt(async () => {
      await this.flush();
      this.mode = mode;
      this.room.dataset.mode = mode;
      // The other view has other buttons, so the menu doesn't stay open over it.
      this.barFit.close();
      this.barFit.fit();
      this.reportActivity();
      this.columns.hidden = mode === 'records';
      this.recordsRoot.hidden = mode !== 'records';
      for (const [button, name] of [[this.writeButton, 'write'], [this.recordsButton, 'records']]) {
        button.classList.toggle('active', mode === name);
        button.setAttribute('aria-pressed', String(mode === name));
      }
      if (mode === 'records') {
        this.records ??= new RecordsView(this.recordsRoot, {
          api: this.api,
          remember: this.remember,
          projectId: this.projectId,
          onError: (text) => this.showMessage(text),
          onInfo: (text, action) => this.showInfo(text, action),
          onOpenChapter: (id) => this.openChapterFromRecords(id),
        });
        await this.records.show();
      }
    });
  }

  // Tells the app where the author is, for the short line a linked app can ask for. A failure here is no one's business.
  reportActivity() {
    this.api.setActivity({ mode: this.mode, chapterId: this.chapterId }).catch(() => {});
  }

  async openChapterFromRecords(id) {
    await this.showMode('write');
    await this.openChapter(id, { focus: true });
    this.reveal(id);
  }

  toggleLookup() {
    return this.attempt(async () => {
      if (this.mode !== 'write') await this.showMode('write');
      await this.lookup.toggle();
    });
  }

  // A mention was opened in the text: show that record beside the page.
  lookUp(id) {
    return this.attempt(() => this.lookup.open(id));
  }

  setProgress(progress) {
    this.progress = progress;
    this.showProgress();
  }

  showProgress() {
    const { today, dailyGoal } = this.progress;
    this.todayWords.classList.toggle('goal-met', dailyGoal > 0 && today >= dailyGoal);
    this.updateBarWords();
  }

  // The counts in the top bar, at the length there's room for. It returns them in full, for the More menu.
  renderBarWords(level = this.wordLevel ?? 'long') {
    this.wordLevel = level;
    const { today = 0, dailyGoal = 0 } = this.progress ?? {};
    const total = this.outline.words;
    const full = [dailyGoal ? `${formatCount(today)} of ${words(dailyGoal)} today` : `${words(today)} today`, words(total)];
    const brief = [dailyGoal ? `${shortCount(today)}/${shortCount(dailyGoal)} today` : `${shortCount(today)} today`, total === 1 ? '1 word' : `${shortCount(total)} words`];
    const [first, second] = level === 'short' ? brief : full;
    this.todayWords.textContent = first;
    this.projectWords.textContent = second;
    this.barWords.hidden = level === 'none';
    this.barWords.title = full.join(' · ');
    return full.join(' · ');
  }

  // A count that has grown or shrunk can change what fits.
  updateBarWords() {
    const before = this.barWords?.textContent;
    this.renderBarWords();
    if (this.barWords?.textContent !== before) this.barFit?.fit();
  }

  toggleFocus() {
    this.room.classList.toggle('focus');
    this.activePage.focus();
  }

  openGoals(chapterId) {
    document.getElementById('goals')?.remove();
    const number = (id, label, value) => {
      const input = el('input', { id, type: 'number', min: '0', max: String(MAX_GOAL), step: '50', value: String(value), 'aria-label': label });
      return { input, row: el('label', { class: 'field' }, el('span', {}, label), input) };
    };
    const daily = number('goal-daily', 'Words a day, for this project', this.progress.dailyGoal);
    const chapterPage = [this.page, this.secondPage].find((page) => page?.chapterId === chapterId);
    const chapter = number('goal-chapter', 'Words for this chapter', chapterPage?.goal ?? 0);
    const dialog = el(
      'dialog',
      { id: 'goals', class: 'dialog' },
      el('h2', {}, 'Goals'),
      el('p', { class: 'quiet-note' }, 'Leave a goal at 0 to have none.'),
      daily.row,
      chapter.row,
      el(
        'div',
        { class: 'dialog-actions' },
        el('button', { type: 'button', onclick: () => dialog.close() }, 'Cancel'),
        el('button', { id: 'goals-save', class: 'primary', onclick: () => this.saveGoals(dialog, chapterPage, daily.input, chapter.input) }, 'Save'),
      ),
    );
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
  }

  saveGoals(dialog, chapterPage, daily, chapter) {
    const whole = (input) => Math.max(0, Math.min(MAX_GOAL, Math.round(Number(input.value) || 0)));
    return this.attempt(async () => {
      this.setProgress(await this.api.setGoal({ id: this.outline.id, goal: whole(daily) }));
      if (chapterPage) {
        this.setProgress(await this.api.setGoal({ id: chapterPage.chapterId, goal: whole(chapter) }));
        chapterPage.goal = whole(chapter);
      }
      this.showCounts();
      dialog.close();
    });
  }

  find({ replacing = false } = {}) {
    if (this.activePage.chapterId) this.activePage.findBar.open({ replacing });
  }

  // F3 and Shift+F3: the next or previous match, opening Find first if it isn't open.
  findStep(direction) {
    const bar = this.activePage.chapterId ? this.activePage.findBar : null;
    if (!bar) return;
    if (bar.root.hidden) bar.open({});
    else bar.step(direction);
  }

  async afterReplace(outline) {
    this.outline = outline;
    await this.page.reload();
    await this.secondPage?.reload();
    this.renderLists();
  }

  openBeside(id) {
    if (id === this.chapterId) {
      this.showMessage('That chapter is already open.');
      return null;
    }
    return this.attempt(async () => {
      if (!this.secondPage) {
        this.secondRoot.hidden = false;
        this.secondPage = this.makePage(this.secondRoot, { onClose: () => this.closeBeside() });
      }
      await this.secondPage.open(id);
      this.showSelection();
      this.showCounts();
    });
  }

  closeBeside() {
    return this.attempt(async () => {
      await this.secondPage?.flush();
      this.secondPage?.editor?.destroy();
      this.secondPage = null;
      this.secondRoot.replaceChildren();
      this.secondRoot.hidden = true;
      this.activePage = this.page;
      this.showSelection();
    });
  }

  async start() {
    this.renderLists();
    const remembered = this.remember.get(lastChapterKey(this.projectId));
    const node = remembered && findNode(this.outline, remembered);
    const first = node ?? chaptersOf(this.outline)[0];
    if (first) await this.openChapter(first.id);
    else this.selectBook(booksOf(this.outline)[0]?.id ?? null);
    this.noticeFolderChanges();
  }

  // A look in the background as the project opens, at folders chosen on this computer only. It changes nothing, and says so quietly if
  // there's something to see. If it can't look, it says nothing: the author can still ask from the menu.
  async noticeFolderChanges() {
    try {
      if (!(await this.api.watchedFolders()).some((folder) => folder.linked)) return;
      const { entries } = await this.api.checkFolders();
      if (!this.left && entries.length) this.showInfo(`The folder has changes: ${summarise(entries)}. Nothing has been changed here.`, { label: 'See them', run: () => this.checkFolder() });
    } catch {
      // Nothing to say.
    }
  }

  checkFolder() {
    return this.attempt(async () => {
      await this.flush();
      this.clearMessage();
      await openFolderChanges({
        api: this.api,
        onError: (text) => this.showMessage(text),
        onBefore: () => this.flush(),
        onApplied: (outline) => this.afterReplace(outline),
      });
    });
  }

  showMessage(text) {
    this.message.className = 'room-message';
    this.message.textContent = text;
    this.message.hidden = false;
  }

  showInfo(text, action) {
    this.message.className = 'room-message info';
    this.message.replaceChildren(
      el('span', {}, text),
      ...(action ? [el('button', { id: 'message-action', onclick: action.run }, action.label)] : []),
      el('button', { class: 'message-close', 'aria-label': 'Dismiss', onclick: () => this.clearMessage() }, icon('close')),
    );
    this.message.hidden = false;
  }

  applyFilter() {
    const wanted = this.filter.value.trim().toLowerCase();
    for (const row of this.chapterList.children) {
      const title = row.querySelector('.row-title')?.textContent.toLowerCase() ?? '';
      row.hidden = Boolean(wanted) && !title.includes(wanted);
    }
  }

  async showHistory() {
    const page = this.activePage;
    if (!page.chapterId) return;
    await this.attempt(() =>
      openHistory({
        api: this.api,
        page,
        onRestored: (outline) => this.afterReplace(outline),
        onError: (text) => this.showMessage(text),
      }));
  }

  exportScopes(chapterId = this.activePage.chapterId, bookId = this.bookId) {
    const scopes = [];
    const chapter = chapterId && findNode(this.outline, chapterId);
    if (chapter) scopes.push({ scope: 'chapter', id: chapter.id, label: `This chapter: ${chapter.title}` });
    const book = bookId && findNode(this.outline, bookId);
    if (book) scopes.push({ scope: 'book', id: book.id, label: `This book: ${book.title}` });
    const holder = book && indexTree(this.outline).get(book.id)?.parent;
    if (holder?.kind === 'series') scopes.push({ scope: 'series', id: holder.id, label: `This series: ${holder.title}` });
    scopes.push({ scope: 'project', id: this.outline.id, label: `The whole project: ${this.outline.title}` });
    return scopes;
  }

  async showExport(options = {}) {
    await this.attempt(async () => {
      await this.flush();
      if (!(await ensurePass(this.api, 'Exported files aren’t protected: anyone can read them.'))) return;
      // From a row's menu, what's offered is that book or chapter, whatever is open.
      const { target, ...rest } = options;
      const node = target && findNode(this.outline, target);
      const scopes = node ? this.exportScopes(node.kind === 'chapter' ? node.id : null, node.kind === 'book' ? node.id : this.bookOf(node.id)?.id) : this.exportScopes();
      openExport({ api: this.api, scopes, scope: node?.kind ?? 'book', onError: (text) => this.showMessage(text), ...rest });
    });
  }

  async showImport() {
    await this.attempt(async () => {
      await this.flush();
      const holder = this.bookId && indexTree(this.outline).get(this.bookId)?.parent;
      await openImport({
        api: this.api,
        books: booksOf(this.outline),
        parentId: holder?.id ?? this.outline.id,
        emptyBookId: this.bookId && findNode(this.outline, this.bookId)?.words === 0 ? this.bookId : null,
        onError: (text) => this.showMessage(text),
        onDone: (result) => this.afterImport(result),
      });
    });
  }

  async findFiles(options) {
    await this.attempt(async () => {
      await this.flush();
      await openFolderImport({
        api: this.api,
        ...options,
        onError: (text) => this.showMessage(text),
        onDone: (outline) => this.afterFolderImport(outline),
      });
    });
  }

  async afterFolderImport(outline) {
    this.outline = outline;
    this.chapterId = null;
    this.bookId = null;
    await this.page.clear();
    this.renderLists();
    const first = booksOf(outline).find((book) => book.children.length);
    if (first) this.selectBook(first.id);
  }

  showAttachments() {
    return this.attempt(() =>
      openFiles({
        api: this.api,
        id: this.bookId ?? this.outline.id,
        projectId: this.outline.id,
        title: this.bookId ? findNode(this.outline, this.bookId)?.title : this.outline.title,
        onError: (text) => this.showMessage(text),
        onBefore: () => this.flush(),
        onCheckFolder: () => this.checkFolder(),
        onOutline: (outline) => {
          this.outline = outline;
          this.renderLists();
        },
      }));
  }

  // Another app sent something. A book chosen here is only a suggestion, which the author can change.
  showInbox() {
    return this.attempt(async () => {
      if (document.querySelector('#inbox[open]')) return;
      if (document.querySelector('dialog[open]')) {
        if ((await this.api.inboxList()).length) this.showInfo('A document was sent here. It’s waiting under File, This Project, Documents Sent Here.');
        return;
      }
      await this.flush();
      await openInbox({
        api: this.api,
        books: booksOf(this.outline),
        bookId: this.bookId,
        onError: (text) => this.showMessage(text),
        onDifferentProject: () => this.onLibrary(),
        onNext: () => this.showInbox(),
        onAdded: async (result) => {
          await this.afterImport(result, 'Added');
          await this.showInbox();
        },
      });
    });
  }

  // A copy goes over, so nothing there comes back. A password-locked project refuses, and says why.
  openInReader(scope, { publish = false } = {}) {
    return this.attempt(async () => {
      await this.flush();
      const id = scope === 'book' ? this.bookId : this.activePage.chapterId;
      if (!id) {
        this.showMessage(`Open a ${scope} first.`);
        return;
      }
      const { without } = await this.api.openInReader({ scope, id, publish });
      const colours = without
        ? ` Markdown can’t keep colours, so ${publish ? 'what you publish' : 'the copy'} won’t show them: ${without}. They’re still here.`
        : '';
      this.showInfo(publish
        ? `Sent a copy to RT Markdown Reader. Choose Publish there to put it on your site or wiki. Changes there don’t come back here.${colours}`
        : `Opened a copy in RT Markdown Reader. Changes there don’t come back here.${colours}`);
    });
  }

  async afterImport({ outline, first, chapters }, verb = 'Imported') {
    this.outline = outline;
    this.chapterId = null;
    this.bookId = null;
    await this.page.clear();
    this.renderLists();
    if (first) await this.openChapter(first);
    this.showInfo(`${verb} ${chapters === 1 ? '1 chapter' : `${chapters} chapters`}.`);
  }

  showDetails(id = this.bookId) {
    if (!id) {
      this.showMessage('Choose a book first.');
      return null;
    }
    return this.attempt(() => openDetails({ api: this.api, bookId: id, onError: (text) => this.showMessage(text) }));
  }

  showTrash() {
    return this.attempt(() =>
      openTrash({
        title: 'Trash',
        load: () => this.api.listTrash(),
        restore: (id) => this.restoreRow(id),
        onError: (text) => this.showMessage(text),
      }));
  }

  async restoreRow(id) {
    this.outline = await this.api.restoreItem(id);
    this.reveal(id);
    this.clearMessage();
    await this.records?.refresh();
  }

  clearMessage() {
    this.message.hidden = true;
  }

  // Everything that changes the outline goes through here, so a failure is shown and not lost.
  async attempt(work) {
    try {
      this.clearMessage();
      return await work();
    } catch (error) {
      this.showMessage(error.message);
      return null;
    }
  }

  async flush() {
    await this.page.flush();
    await this.secondPage?.flush();
    await this.lookup.flush();
    await this.records?.flush();
  }

  bookOf(id) {
    const index = indexTree(this.outline);
    for (let entry = index.get(id); entry; entry = entry.parent && index.get(entry.parent.id)) {
      if (entry.node.kind === 'book') return entry.node;
    }
    return null;
  }

  // Lists

  renderLists() {
    // The list of books never shows what's inside a book.
    const shelves = visibleRows(this.outline.children, { folded: this.folded, closed: (node) => node.kind === 'book' });
    this.bookList.replaceChildren(...shelves.map(({ node, depth }) => this.row(node, depth)));
    this.updateBarWords();
    this.renderChapters();
  }

  renderChapters() {
    const book = this.bookId && findNode(this.outline, this.bookId);
    this.bookHeading.textContent = book ? book.title : 'Chapters';
    // A search looks everywhere, so nothing stays folded while there are words in the filter.
    const chapters = book ? visibleRows(book.children, { folded: this.filter.value.trim() ? new Set() : this.folded }) : [];
    this.chapterList.replaceChildren(...chapters.map(({ node, depth }) => this.row(node, depth)));
    this.applyFilter();
    this.showSelection();
    this.showCounts();
    this.bookFolds.hidden = this.idsOf('series').length === 0;
    this.partFolds.hidden = this.idsOf('part').length === 0;
  }

  row(node, depth) {
    const title = el('span', { class: 'row-title' }, node.title);
    const folds = FOLDS.has(node.kind);
    // While there are words in the chapter filter, parts show what's in them.
    const folded = folds && this.folded.has(node.id) && !(node.kind === 'part' && this.filter.value.trim());
    const arrow = folds
      ? el('button', {
        class: 'row-fold',
        type: 'button',
        'aria-expanded': String(!folded),
        'aria-label': `${folded ? 'Expand' : 'Collapse'} ${node.title}`,
        title: folded ? 'Expand' : 'Collapse',
        onclick: () => this.setFolded(node.id, !folded),
      }, icon('chevron'))
      : null;
    const main = el(
      'button',
      {
        class: 'row-main',
        onclick: (event) => this.chooseRow(node, event),
        ondblclick: () => this.startRename(node.id, title),
      },
      icon(KIND_ICONS[node.kind]),
      title,
      el('span', { class: 'row-words', dataset: { wordsFor: node.id } }, words(node.words)),
    );
    const item = el(
      'li',
      {
        class: `row kind-${node.kind} depth-${Math.min(depth, 2)}`,
        draggable: 'true',
        dataset: { id: node.id },
        onkeydown: (event) => this.onRowKey(event, node, title),
        oncontextmenu: (event) => this.rowMenu(event, node),
        ondragstart: (event) => this.onDragStart(event, node),
        ondragend: () => this.onDragEnd(),
        ondragover: (event) => this.onDragOver(event, node, item),
        ondragleave: () => this.clearDropMarks(item),
        ondrop: (event) => this.onDrop(event, node, item),
      },
      arrow,
      main,
      el(
        'span',
        { class: 'row-actions' },
        el(
          'button',
          { class: 'row-action', title: 'Rename', 'aria-label': `Rename ${node.title}`, onclick: () => this.startRename(node.id, title) },
          icon('pencil'),
        ),
        node.kind === 'book'
          ? el(
              'button',
              { class: 'row-action', title: 'Book details', 'aria-label': `Details of ${node.title}`, onclick: () => this.showDetails(node.id) },
              icon('info'),
            )
          : null,
        node.kind === 'chapter'
          ? el(
              'button',
              { class: 'row-action', title: 'Open beside', 'aria-label': `Open ${node.title} beside`, onclick: () => this.openBeside(node.id) },
              icon('beside'),
            )
          : null,
        el(
          'button',
          { class: 'row-action', title: 'Move to Trash', 'aria-label': `Move ${node.title} to Trash`, onclick: () => this.removeRow(node) },
          icon('trash'),
        ),
      ),
    );
    return item;
  }

  showSelection() {
    for (const row of [...this.bookList.children, ...this.chapterList.children]) {
      const selected = row.dataset.id === this.bookId || row.dataset.id === this.chapterId;
      row.classList.toggle('selected', selected);
      row.classList.toggle('beside', row.dataset.id === this.secondPage?.chapterId);
      row.querySelector('.row-main').setAttribute('aria-current', String(selected));
      // A folded series or part says when the book or chapter that's open is inside it.
      const holds = row.querySelector('.row-fold[aria-expanded="false"]') && [this.bookId, this.chapterId].some((id) => id && holdersOf(this.outline, id).includes(row.dataset.id));
      row.classList.toggle('holds-selected', Boolean(holds));
    }
    this.showSubtitle();
  }

  showSubtitle() {
    const book = this.bookId && findNode(this.outline, this.bookId);
    const chapter = this.chapterId && findNode(this.outline, this.chapterId);
    this.subtitle.textContent = [book?.title, chapter?.title].filter(Boolean).join(' · ');
  }

  showCounts() {
    const chapter = this.chapterId && findNode(this.outline, this.chapterId);
    const book = this.bookId && findNode(this.outline, this.bookId);
    if (chapter && book) this.page.showCounts(chapter.words, book.words);
    const second = this.secondPage?.chapterId && findNode(this.outline, this.secondPage.chapterId);
    if (second) this.secondPage.showCounts(second.words, this.bookOf(second.id)?.words ?? second.words);
  }

  chooseRow(node, event) {
    if (node.kind === 'chapter' && (event.ctrlKey || event.metaKey)) return this.openBeside(node.id);
    if (node.kind === 'chapter') return this.openChapter(node.id);
    if (node.kind === 'book') return this.openBook(node.id);
    return null;
  }

  selectBook(id) {
    this.bookId = id;
    this.renderChapters();
  }

  async openBook(id) {
    const first = chaptersOf(findNode(this.outline, id))[0];
    if (first) return this.openChapter(first.id);
    return this.attempt(async () => {
      await this.page.clear();
      this.chapterId = null;
      this.selectBook(id);
    });
  }

  openChapter(id, { focus = false } = {}) {
    return this.attempt(async () => {
      if (id === this.secondPage?.chapterId) await this.closeBeside();
      await this.page.open(id);
      const bookId = this.bookOf(id)?.id ?? null;
      const sameBook = bookId === this.bookId;
      this.chapterId = id;
      this.bookId = bookId;
      this.reportActivity();
      this.remember.set(lastChapterKey(this.projectId), id);
      // A row that was just clicked has to stay put, or the second click of a double-click lands on nothing.
      if (sameBook && this.chapterList.querySelector(`[data-id="${id}"]`)) {
        this.showSelection();
        this.showCounts();
      } else {
        this.renderChapters();
      }
      if (focus) this.page.focus();
    });
  }

  // Folding. What's folded is remembered for each project, on this computer.

  readFolded() {
    try {
      return new Set(JSON.parse(this.remember.get(`folded:${this.projectId}`) || '[]'));
    } catch {
      return new Set();
    }
  }

  saveFolded() {
    this.remember.set(`folded:${this.projectId}`, JSON.stringify([...this.folded]));
  }

  // Every series in the project, or every part in the book that's showing.
  idsOf(kind) {
    const top = kind === 'part' ? this.bookId && findNode(this.outline, this.bookId) : this.outline;
    return top ? [...indexTree(top).values()].filter(({ node }) => node.kind === kind).map(({ node }) => node.id) : [];
  }

  setFolded(id, folded) {
    const had = document.activeElement?.closest('.row')?.dataset.id === id ? document.activeElement.className.split(' ')[0] : null;
    if (folded) this.folded.add(id);
    else this.folded.delete(id);
    this.saveFolded();
    this.renderLists();
    if (had) document.querySelector(`.row[data-id="${id}"] .${had}`)?.focus();
  }

  foldAll(kind, folded) {
    for (const id of this.idsOf(kind)) {
      if (folded) this.folded.add(id);
      else this.folded.delete(id);
    }
    this.saveFolded();
    this.renderLists();
  }

  // Opens whatever is folded around something, so it can be seen, and draws the lists.
  reveal(id) {
    let changed = false;
    for (const holder of holdersOf(this.outline, id)) changed = this.folded.delete(holder) || changed;
    if (changed) this.saveFolded();
    this.renderLists();
  }

  foldTools(kind) {
    const what = kind === 'series' ? 'series' : 'parts';
    const button = (folded, name, label) => el('button', { type: 'button', class: 'fold-tool', title: label, 'aria-label': label, onclick: () => this.foldAll(kind, folded), dataset: { fold: `${kind}-${folded ? 'all' : 'none'}` } }, icon(name));
    return el('span', { class: 'fold-all', hidden: true }, button(true, 'foldall', `Collapse all ${what}`), button(false, 'unfoldall', `Expand all ${what}`));
  }

  // The menu for a row: from a right-click, the Menu key or Shift+F10. A field being typed in keeps the usual menu.
  rowMenu(event, node) {
    if (event?.target.closest('input')) return;
    event?.preventDefault();
    event?.stopPropagation();
    const row = document.querySelector(`.row[data-id="${node.id}"]`);
    const main = row?.querySelector('.row-main');
    if (!main) return;
    const box = main.getBoundingClientRect();
    const pointed = event && (event.clientX || event.clientY);
    openMenu({ items: this.menuFor(node), at: pointed ? { x: event.clientX, y: event.clientY } : { x: box.left + 24, y: box.bottom }, label: `Actions for ${node.title}`, returnTo: main });
  }

  // The menu for the empty part of a list.
  listMenu(event, list) {
    if (event.target.closest('input, .row, .splitter')) return;
    event.preventDefault();
    const kind = list === 'books' ? 'series' : 'part';
    const none = this.idsOf(kind).length === 0;
    const what = list === 'books' ? 'series' : 'parts';
    openMenu({
      at: { x: event.clientX, y: event.clientY },
      label: list === 'books' ? 'Actions for the list of books' : 'Actions for the list of chapters',
      items: [
        ...(list === 'books'
          ? [{ label: 'Add a book', run: () => this.addBook(this.outline.id) }, { label: 'Add a series', run: () => this.addSeries() }]
          : [{ label: 'Add a chapter', run: () => this.addChapter(), disabled: !this.bookId }, { label: 'Add a part', run: () => this.addPart(), disabled: !this.bookId }]),
        'separator',
        { label: `Collapse all ${what}`, run: () => this.foldAll(kind, true), disabled: none },
        { label: `Expand all ${what}`, run: () => this.foldAll(kind, false), disabled: none },
      ],
    });
  }

  menuFor(node) {
    const parent = indexTree(this.outline).get(node.id)?.parent;
    const step = (by, label) => {
      const to = resolveStep(this.outline, node.id, by);
      return { label, disabled: !to, run: () => this.applyMove(node.id, to) };
    };
    // A list of places to move to. One with nowhere to go says so by being off.
    const moveTo = (label, places) => (places.length
      ? { label, items: places.map((place) => ({ label: place.title, run: () => this.moveInto(node.id, place.id) })) }
      : { label, disabled: true });
    const rename = { label: 'Rename', run: () => this.startRenameOf(node.id) };
    const trash = { label: 'Move to Trash', run: () => this.removeRow(node) };
    const folded = this.folded.has(node.id);
    const fold = { label: folded ? 'Expand' : 'Collapse', run: () => this.setFolded(node.id, !folded) };
    const moving = [step(-1, 'Move up'), step(1, 'Move down')];
    const duplicate = { label: 'Duplicate', run: () => this.duplicate(node) };
    const exportIt = { label: 'Export…', run: () => this.showExport({ target: node.id }) };

    if (node.kind === 'series') {
      return [rename, { label: 'Add a book', run: () => this.addBook(node.id) }, fold, 'separator', ...moving, 'separator', trash];
    }
    if (node.kind === 'part') {
      return [{ label: 'Add a chapter', run: () => this.addChapter(node.id) }, rename, fold, 'separator', ...moving, 'separator', trash];
    }
    if (node.kind === 'book') {
      const series = [...indexTree(this.outline).values()].map((entry) => entry.node).filter((one) => one.kind === 'series' && one.id !== parent?.id);
      const places = parent?.kind === 'series' ? [...series, { id: this.outline.id, title: 'Not in a series' }] : series;
      return [
        { label: 'Open', run: () => this.openBook(node.id) }, rename, { label: 'Book details…', run: () => this.showDetails(node.id) }, 'separator',
        moveTo('Move to a series…', places), ...moving, 'separator', duplicate, exportIt, 'separator', trash,
      ];
    }
    const own = this.bookOf(node.id)?.id;
    return [
      { label: 'Open', run: () => this.openChapter(node.id, { focus: true }) }, { label: 'Open beside', run: () => this.openBeside(node.id) }, rename, duplicate, 'separator',
      ...moving, moveTo('Move to another book…', booksOf(this.outline).filter((book) => book.id !== own)), exportIt, 'separator', trash,
    ];
  }

  async moveInto(id, parentId) {
    await this.applyMove(id, { parentId, beforeId: null });
    this.reveal(id);
    document.querySelector(`.row[data-id="${id}"] .row-main`)?.focus();
  }

  duplicate(node) {
    return this.attempt(async () => {
      await this.flush();
      const made = await this.api.duplicateItem(node.id);
      this.outline = made.outline;
      this.reveal(made.id);
      document.querySelector(`.row[data-id="${made.id}"] .row-main`)?.focus();
      const left = made.filesLeft ? ` The ${made.filesLeft === 1 ? 'file kept with it wasn’t' : `${made.filesLeft} files kept with it weren’t`} copied.` : '';
      this.showInfo(`Made “${findNode(this.outline, made.id)?.title}”.${left}`);
    });
  }

  commentOnSelection() {
    if (this.mode === 'write') this.activePage.comments.start();
  }

  // Live updates from the page, without rebuilding the lists under the author's hands.

  setWords(id, count) {
    const index = indexTree(this.outline);
    const entry = index.get(id);
    if (!entry) return;
    const change = count - entry.node.words;
    if (change === 0) return;
    for (let at = entry; at; at = at.parent && index.get(at.parent.id)) {
      at.node.words += change;
      const label = document.querySelector(`[data-words-for="${at.node.id}"]`);
      if (label) label.textContent = words(at.node.words);
    }
    this.updateBarWords();
    this.showCounts();
  }

  setTitle(id, title) {
    const node = findNode(this.outline, id);
    if (!node) return;
    node.title = title;
    const label = this.chapterList.querySelector(`[data-id="${id}"] .row-title`);
    if (label) label.textContent = title;
    this.showSubtitle();
  }

  // Adding

  async add(kind, parentId, title) {
    return this.attempt(async () => {
      await this.flush();
      const { item, outline } = await this.api.addItem({ kind, parentId, title });
      this.outline = outline;
      return item;
    });
  }

  async addBook(into = null) {
    const current = this.bookId && indexTree(this.outline).get(this.bookId);
    const parentId = into ?? current?.parent?.id ?? this.outline.id;
    const book = await this.add('book', parentId, 'New book');
    if (!book) return;
    const chapter = await this.add('chapter', book.id, 'Chapter 1');
    this.reveal(book.id);
    if (chapter) await this.openChapter(chapter.id);
    this.startRenameOf(book.id);
  }

  async addSeries() {
    const series = await this.add('series', this.outline.id, 'New series');
    if (!series) return;
    this.renderLists();
    this.startRenameOf(series.id);
  }

  async addChapter(into = null) {
    if (!this.bookId) {
      this.showMessage('Add a book first.');
      return;
    }
    const book = findNode(this.outline, this.bookId);
    const open = this.chapterId && indexTree(this.outline).get(this.chapterId);
    const parentId = into ?? (open?.parent?.kind === 'part' ? open.parent.id : this.bookId);
    const chapter = await this.add('chapter', parentId, `Chapter ${chaptersOf(book).length + 1}`);
    if (!chapter) return;
    this.reveal(chapter.id);
    await this.openChapter(chapter.id, { focus: true });
  }

  async addPart() {
    if (!this.bookId) {
      this.showMessage('Add a book first.');
      return;
    }
    const part = await this.add('part', this.bookId, 'New part');
    if (!part) return;
    this.reveal(part.id);
    this.startRenameOf(part.id);
  }

  // Renaming

  startRenameOf(id) {
    const label = document.querySelector(`.row[data-id="${id}"] .row-title`);
    if (label) this.startRename(id, label);
  }

  startRename(id, label) {
    const node = findNode(this.outline, id);
    if (!node || label.parentNode?.querySelector('.rename')) return;
    const input = el('input', { class: 'rename', type: 'text', value: node.title, 'aria-label': 'New name', maxlength: '500' });
    let finished = false;
    const finish = (save) => {
      if (finished) return;
      finished = true;
      input.replaceWith(label);
      if (save && input.value.trim() && input.value !== node.title) this.rename(id, input.value);
    };
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') finish(true);
      if (event.key === 'Escape') finish(false);
    });
    input.addEventListener('click', (event) => event.stopPropagation());
    input.addEventListener('blur', () => finish(true));
    label.replaceWith(input);
    input.focus();
    input.select();
  }

  rename(id, title) {
    return this.attempt(async () => {
      await this.flush();
      this.outline = await this.api.rename({ id, title });
      if (id === this.chapterId) this.page.setTitle(findNode(this.outline, id).title);
      if (id === this.secondPage?.chapterId) this.secondPage.setTitle(findNode(this.outline, id).title);
      if (id === this.outline.id) this.projectTitle.textContent = this.outline.title;
      this.renderLists();
    });
  }

  removeRow(node) {
    return this.attempt(async () => {
      await this.flush();
      const inside = [...indexTree(node).keys()];
      const openGoes = inside.includes(this.chapterId);
      const bookGoes = inside.includes(this.bookId);
      if (inside.includes(this.secondPage?.chapterId)) await this.closeBeside();
      this.outline = await this.api.trashItem(node.id);
      if (openGoes) {
        await this.page.clear();
        this.chapterId = null;
      }
      if (bookGoes) this.bookId = booksOf(this.outline)[0]?.id ?? null;
      this.renderLists();
      const next = !this.chapterId && this.bookId && chaptersOf(findNode(this.outline, this.bookId))[0];
      if (next) await this.openChapter(next.id);
      this.showInfo(`“${node.title}” is in the Trash.`, {
        label: 'Undo',
        run: () => this.attempt(async () => {
          await this.restoreRow(node.id);
          if (node.kind === 'chapter') await this.openChapter(node.id);
        }),
      });
    });
  }

  // Moving

  async applyMove(id, target) {
    if (!target) return;
    await this.attempt(async () => {
      await this.flush();
      this.outline = await this.api.move({ id, ...target });
      if (this.chapterId) this.bookId = this.bookOf(this.chapterId)?.id ?? this.bookId;
      this.renderLists();
      document.querySelector(`.row[data-id="${id}"] .row-main`)?.focus();
    });
  }

  onRowKey(event, node, title) {
    if (event.target.classList.contains('rename')) return;
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      this.rowMenu(null, node);
      return;
    }
    // Left folds a series or part away and right opens it, as in a tree.
    if (FOLDS.has(node.kind) && !event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      this.setFolded(node.id, event.key === 'ArrowLeft');
      return;
    }
    if (event.key === 'F2') {
      event.preventDefault();
      this.startRename(node.id, title);
    }
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      this.applyMove(node.id, resolveStep(this.outline, node.id, event.key === 'ArrowUp' ? -1 : 1));
    }
  }

  onDragStart(event, node) {
    this.dragId = node.id;
    event.dataTransfer.setData(DRAG_TYPE, node.id);
    event.dataTransfer.effectAllowed = 'move';
  }

  onDragEnd() {
    this.dragId = null;
    document.querySelectorAll('.drop-before, .drop-after, .drop-into').forEach((row) => this.clearDropMarks(row));
  }

  clearDropMarks(row) {
    row.classList.remove('drop-before', 'drop-after', 'drop-into');
  }

  dropPlace(event, node, row) {
    const box = row.getBoundingClientRect();
    const at = (event.clientY - box.top) / box.height;
    const draggedKind = findNode(this.outline, this.dragId)?.kind;
    if (canHold(node.kind, draggedKind) && at > 0.25 && at < 0.75) return 'into';
    return at < 0.5 ? 'before' : 'after';
  }

  onDragOver(event, node, row) {
    if (!this.dragId) return;
    event.stopPropagation();
    this.clearDropMarks(row);
    const place = this.dropPlace(event, node, row);
    if (!resolveDrop(this.outline, this.dragId, node.id, place)) return;
    event.preventDefault();
    row.classList.add(`drop-${place}`);
  }

  onDrop(event, node, row) {
    if (!this.dragId) return;
    event.preventDefault();
    event.stopPropagation();
    const id = this.dragId;
    const target = resolveDrop(this.outline, id, node.id, this.dropPlace(event, node, row));
    this.clearDropMarks(row);
    this.applyMove(id, target);
  }

  // Dropping on the empty part of a list puts it at the end.
  addDropZone(list, parentId) {
    const target = () => {
      const parent = parentId() && findNode(this.outline, parentId());
      const dragged = this.dragId && findNode(this.outline, this.dragId);
      return parent && dragged && canHold(parent.kind, dragged.kind) ? { parentId: parent.id, beforeId: null } : null;
    };
    list.addEventListener('dragover', (event) => {
      if (target()) event.preventDefault();
    });
    list.addEventListener('drop', (event) => {
      const place = target();
      if (!place) return;
      event.preventDefault();
      this.applyMove(this.dragId, place);
    });
  }

  newChapterFromMenu() {
    return this.addChapter();
  }

  newBookFromMenu() {
    return this.addBook();
  }
}
