'use strict';
const { BrowserWindow, dialog, ipcMain, nativeImage, session, shell } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EXPORT_FORMATS } = require('../shared/details');
const { checkExport, exportEverything, exportFile, safeName } = require('./export');
const { FolderImport } = require('./folder');
const { FolderCheck } = require('./folder/recheck');
const { IMPORT_EXTENSIONS, Importer } = require('./import');
const { RecordImporter } = require('./records-import');
const { Files } = require('./files');
const { registerReadAloud } = require('./read-aloud/ipc');

const MAX_COVER = 50 * 1024 * 1024;
const importer = new Importer();
const previews = new Set();
const folderImport = new FolderImport();
const folderCheck = new FolderCheck();
const recordImporter = new RecordImporter();
let chosenFolder = null;

// The window can only ask to scan the folder the author just picked, never a path of its own.
async function chooseFolder(window) {
  const { canceled, filePaths } = await dialog.showOpenDialog(window(), { title: 'Where are your files?', properties: ['openDirectory'] });
  if (canceled) return null;
  [chosenFolder] = filePaths;
  return { name: path.basename(chosenFolder) };
}

async function saveFolderReport(window) {
  const { canceled, filePath } = await dialog.showSaveDialog(window(), {
    title: 'Save the report',
    defaultPath: 'Find my files report.txt',
    filters: [{ name: 'Text', extensions: ['txt'] }],
  });
  return canceled ? null : filePath;
}

// Which files come in is chosen here, in the system's own dialog, and never named by the window.
async function chooseRecordFiles(window) {
  const { canceled, filePaths } = await dialog.showOpenDialog(window(), {
    title: 'Bring in records',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Spreadsheets and Markdown files', extensions: ['csv', 'tsv', 'md', 'markdown', 'txt'] }],
  });
  return canceled ? null : recordImporter.load(filePaths);
}

async function chooseRecordFolder(window) {
  const { canceled, filePaths } = await dialog.showOpenDialog(window(), { title: 'Choose a folder of records', properties: ['openDirectory'] });
  return canceled ? null : recordImporter.loadFolder(filePaths[0]);
}

async function addAttachments(workspace, window, parentId) {
  const { canceled, filePaths } = await dialog.showOpenDialog(window(), { title: 'Add attachments', properties: ['openFile', 'multiSelections'] });
  return canceled ? 0 : workspace().addAttachments({ parentId, files: filePaths });
}

async function saveAttachment(workspace, window, id) {
  const { name } = workspace().open().attachment(id);
  const { canceled, filePath } = await dialog.showSaveDialog(window(), { title: 'Save a copy', defaultPath: name });
  if (canceled || !filePath) return null;
  await workspace().saveAttachment(id, filePath);
  return filePath;
}

async function chooseImport(window) {
  const { canceled, filePaths } = await dialog.showOpenDialog(window(), {
    title: 'Import a file',
    properties: ['openFile'],
    filters: [{ name: 'Writing', extensions: IMPORT_EXTENSIONS }],
  });
  if (canceled) return null;
  return importer.inspect(filePaths[0]);
}

// While this runs the project can't be locked from under it.
function busyWhile(workspace, work) {
  return async (...args) => {
    const space = workspace();
    space.busy += 1;
    try {
      return await work(...args);
    } finally {
      space.busy -= 1;
    }
  };
}

// Errors come back as plain results, so the window can show the app's own words and not Electron's wrapper around them.
function handle(channel, work) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, value: await work(...args) };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
}

// Asking comes first and the file is only touched after that. A cancelled dialog is a plain "no", not an error.
async function exportProject(workspace, window) {
  const space = workspace();
  const { id } = space.open();
  const { canceled, filePath } = await dialog.showSaveDialog(window(), {
    title: 'Save a copy of this project',
    defaultPath: `${(space.locked ? space.library.describe(id).title : space.open().title()).replace(/[<>:"/\\|?*]/g, ' ').trim() || 'Project'}.rtstory`,
    filters: [{ name: 'RT Story Tracker project', extensions: ['rtstory'] }],
  });
  if (canceled || !filePath) return null;
  await space.packProjectLater(id, filePath);
  return filePath;
}

async function pickProjectFile(window) {
  const { canceled, filePaths } = await dialog.showOpenDialog(window(), {
    title: 'Open a project file',
    properties: ['openFile'],
    filters: [{ name: 'RT Story Tracker project', extensions: ['rtstory'] }],
  });
  return canceled ? null : filePaths[0];
}

// Comes back as a project's ID, or for a locked file, what the lock screen needs.
async function importProject(workspace, window, given, projectKey = null) {
  const file = given ?? (await pickProjectFile(window));
  if (!file) return null;
  try {
    return workspace().importProject(file, { projectKey });
  } catch (error) {
    if (error.code === 'LOCKED') return { locked: true, file, label: error.label };
    if (error.code !== 'EXISTS') throw error;
    const { response } = await dialog.showMessageBox(window(), {
      type: 'question',
      buttons: ['Replace it', 'Cancel'],
      cancelId: 1,
      message: `You already have “${error.title}”.`,
      detail: 'Replacing it opens this file instead. The project you have now goes to the Trash for 30 days, so you can get it back.',
    });
    return response === 0 ? workspace().importProject(file, { replace: true, projectKey }) : null;
  }
}

async function chooseCover(workspace, window, bookId) {
  const { canceled, filePaths } = await dialog.showOpenDialog(window(), {
    title: 'Choose a cover picture',
    properties: ['openFile'],
    filters: [{ name: 'Pictures', extensions: ['jpg', 'jpeg', 'png'] }],
  });
  if (canceled) return null;
  const [file] = filePaths;
  const data = fs.readFileSync(file);
  if (data.length > MAX_COVER) throw new Error('That picture is too large. Stores ask for under 50 MB.');
  const { width, height } = nativeImage.createFromBuffer(data).getSize();
  if (!width) throw new Error("That picture couldn't be read. Use a JPEG or PNG.");
  const type = path.extname(file).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
  workspace().setCover(bookId, { type, data, width, height });
  return { width, height, url: `data:${type};base64,${data.toString('base64')}` };
}

function exportName(project, input) {
  const item = input.scope === 'project' ? project.getItem(project.id) : project.getItem(input.id);
  return `${safeName(item?.title)}.${EXPORT_FORMATS[input.format].extension}`;
}

async function runExport(workspace, window, input) {
  const project = workspace().open();
  const format = EXPORT_FORMATS[input.format];
  if (!format) throw new Error("That format isn't known.");
  const { canceled, filePath } = await dialog.showSaveDialog(window(), {
    title: 'Export',
    defaultPath: exportName(project, input),
    filters: [{ name: format.label, extensions: [format.extension] }],
  });
  if (canceled || !filePath) return null;
  return exportFile(project, { ...input, file: filePath });
}

async function everything(workspace, window) {
  const { canceled, filePaths } = await dialog.showOpenDialog(window(), {
    title: 'Choose a folder for the whole project',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled) return null;
  return exportEverything(workspace().open(), filePaths[0]);
}

// Chromium's own PDF viewer, which also has the print button. The file goes when the window does.
async function preview(workspace, input) {
  const file = path.join(os.tmpdir(), `rtst-preview-${process.pid}-${Date.now()}.pdf`);
  await exportFile(workspace().open(), { ...input, format: 'pdf', file });
  await showPdf(file);
}

// A set of records. Only the printable part of each is ever in the pages, and a record that has none to print is counted, not
// guessed at. It goes to a file the author picks, or to the viewer.
async function printRecords(workspace, window, input) {
  const { pages, skipped, title } = workspace().records.printPages(input);
  if (!pages.length) throw new Error(skipped ? `None of these have a frozen version yet, so there is nothing to print. ${skipped} skipped.` : 'There is nothing to print.');
  const { recordsPdf } = require('./export/records-pdf');
  const bytes = await recordsPdf(pages, title);
  if (input.save === true) {
    const { canceled, filePath } = await dialog.showSaveDialog(window(), { title: 'Save as PDF', defaultPath: `${safeName(title)}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (canceled || !filePath) return null;
    fs.writeFileSync(filePath, bytes);
    return { file: filePath, pages: pages.length, skipped };
  }
  const file = path.join(os.tmpdir(), `rtst-preview-${process.pid}-${Date.now()}.pdf`);
  fs.writeFileSync(file, bytes);
  await showPdf(file);
  return { pages: pages.length, skipped };
}

async function showPdf(file) {
  const viewer = new BrowserWindow({
    width: 900,
    height: 900,
    title: 'Print preview',
    webPreferences: { plugins: true, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  viewer.setMenuBarVisibility(false);
  previews.add(viewer);
  viewer.on('closed', () => {
    previews.delete(viewer);
    fs.rmSync(file, { force: true });
  });
  await viewer.loadFile(file);
}

// A preview is a readable copy of the writing, so it goes when the project does.
function closePreviews() {
  for (const viewer of previews) viewer.close();
}

// Left behind if the app stopped while printing or previewing. Only this app's own names, and only plain copies.
function sweepTemporaryFiles() {
  for (const name of fs.readdirSync(os.tmpdir())) {
    if (/^rtst-(preview|print)-\d+-\d+\.(pdf|html)$/.test(name)) fs.rmSync(path.join(os.tmpdir(), name), { force: true });
  }
}

async function saveRecovery(window, text, label) {
  const { canceled, filePath } = await dialog.showSaveDialog(window(), {
    title: 'Save your recovery key',
    defaultPath: 'RT Story Tracker recovery key.txt',
    filters: [{ name: 'Text', extensions: ['txt'] }],
  });
  if (canceled || !filePath) return null;
  const lines = ['RT Story Tracker recovery key', ...(label ? [`Project: ${label}`] : []), '', text, '', 'Keep this somewhere safe. It opens the project without the password.', ''];
  fs.writeFileSync(filePath, lines.join('\n'));
  return filePath;
}

// Its own small window, so the system's print dialog shows only the key.
async function printRecovery(text) {
  const page = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const html = `<!doctype html><meta charset="utf-8"><title>Recovery key</title><body style="font-family:sans-serif"><h2>RT Story Tracker recovery key</h2><p style="font:20px monospace">${text}</p><p>Keep this somewhere safe. It opens the project without the password.</p>`;
  await page.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((resolve) => { page.webContents.print({}, () => resolve()); });
  page.close();
}

function registerSecurity({ security, workspace, window }) {
  handle('security:status', () => security().status());
  handle('security:lockInfo', (id) => security().lockInfo(String(id)));
  handle('security:unlock', (input) => security().unlock(input));
  handle('security:confirm', (secret) => security().confirm(secret));
  handle('security:makeRecovery', () => security().makeRecovery());
  handle('security:saveRecovery', ({ text, label }) => saveRecovery(window, String(text), String(label ?? '')));
  handle('security:printRecovery', (text) => printRecovery(String(text).replace(/[^0-9A-Z-]/g, '')));
  handle('security:setPassword', busyWhile(workspace, (input) => security().setPassword(input)));
  handle('security:dropEarlier', () => security().dropEarlier());
  handle('security:removeLock', busyWhile(workspace, () => security().removeLock()));
  handle('security:changePassword', busyWhile(workspace, (password) => security().changePassword(password)));
  handle('security:replaceRecovery', () => security().replaceRecovery());
  handle('security:rename', (label) => security().rename(label));
  handle('security:trust', () => security().trust());
  handle('security:untrust', () => security().untrust());
  handle('security:setQuick', (quick) => security().setQuick(quick));
  handle('security:beginAuthenticator', () => security().beginAuthenticator());
  handle('security:confirmAuthenticator', (code) => security().confirmAuthenticator(code));
  handle('security:removeAuthenticator', () => security().removeAuthenticator());
  handle('security:lockNow', () => {
    const locked = security().lockNow();
    if (locked) closePreviews();
    return locked;
  });
}

function registerLinking({ linking, inbox, workspace }) {
  handle('link:status', (options) => linking().status(options));
  handle('link:set', (on) => linking().setOn(on));
  handle('link:pair', (id) => linking().pair(id));
  handle('link:open', (id) => linking().openApp(id));
  handle('link:get', (id) => linking().getApp(id));
  handle('activity:set', (input) => workspace().setActivity(input ?? {}));
  handle('link:unlink', (id) => linking().unlink(id));
  handle('link:openInReader', busyWhile(workspace, (input) => linking().openInReader(input)));
  handle('inbox:list', () => inbox().list());
  handle('inbox:add', busyWhile(workspace, (input) => inbox().add(workspace(), input)));
  handle('inbox:drop', (id) => inbox().drop(id));
}

function registerIpc({ status, checkForUpdates, aboutApp, menuKeys, folderLinks, readAloud, audioFiles, workspace, updater, settings, backups, security, linking, inbox, window, takeFile }) {
  const busy = (work) => busyWhile(workspace, work);
  const unlocked = (work) => (...args) => {
    security().needExportPass();
    return work(...args);
  };
  registerSecurity({ security, workspace, window });
  registerLinking({ linking, inbox, workspace });
  sweepTemporaryFiles();
  handle('app:status', status);
  handle('update:ask', () => checkForUpdates());
  handle('shortcuts:pause', (paused) => menuKeys.pause(paused === true));
  handle('app:about', () => aboutApp.info());
  handle('app:openLink', (id) => aboutApp.open(id));
  handle('app:copyDetails', () => aboutApp.copy());
  handle('library:list', () => workspace().listProjects());
  handle('library:removeSample', (id) => workspace().removeSample(id));
  handle('project:create', (title) => workspace().createProject(title));
  handle('project:createSample', () => workspace().createSample());
  handle('project:open', (id) => workspace().openProject(id));
  handle('project:close', () => {
    closePreviews();
    security().close();
  });
  handle('item:add', (input) => workspace().addItem(input));
  handle('item:rename', (input) => workspace().rename(input));
  handle('item:move', (input) => workspace().move(input));
  handle('item:trash', (id) => workspace().trashItem(id));
  handle('item:duplicate', (id) => workspace().duplicate(id));
  handle('item:restore', (id) => workspace().restoreItem(id));
  handle('trash:list', () => workspace().listTrash());
  handle('library:trashProject', (id) => workspace().trashProject(id));
  handle('library:restoreProject', (id) => workspace().restoreProject(id));
  handle('library:trashList', () => workspace().listProjectTrash());
  handle('version:list', (id) => workspace().listVersions(id));
  handle('version:get', (input) => workspace().getVersion(input));
  handle('version:restore', (input) => workspace().restoreVersion(input));
  handle('project:export', busy(() => exportProject(workspace, window)));
  handle('project:import', (file) => importProject(workspace, window, file));
  handle('project:importLocked', async (input) => {
    const key = await security().keyFromFile(input);
    const id = await importProject(workspace, window, input.file, key);
    return id ? workspace().openProject(id, key) : null;
  });
  handle('app:takeFile', () => takeFile());
  handle('backup:chooseFolder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(window(), {
      title: 'Choose a folder for backups',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled) return settings().values;
    return settings().save({ backupFolder: filePaths[0] });
  });
  handle('backup:now', () => backups().runNow());
  handle('backup:status', () => backups().status());
  handle('chapter:load', (id) => workspace().loadChapter(id));
  handle('chapter:save', (input) => workspace().saveChapter(input));
  handle('item:setGoal', (input) => workspace().setGoal(input));
  handle('comment:list', (id) => workspace().listComments(id));
  handle('comment:add', (input) => workspace().addComment(input));
  handle('comment:edit', (input) => workspace().editComment(input));
  handle('comment:remove', (id) => workspace().removeComment(id));
  handle('find:search', (input) => workspace().search(input));
  handle('find:replaceAll', (input) => workspace().replaceAll(input));
  handle('find:undo', () => workspace().undoReplace());
  handle('settings:get', () => settings().values);
  handle('settings:save', (changes) => {
    const menuShows = ({ shortcuts, theme, surface }) => JSON.stringify([shortcuts, theme, surface]);
    const before = menuShows(settings().values);
    const saved = settings().save(changes);
    // The menu shows the shortcuts and which look is ticked, so it's built again when either changes.
    if (menuShows(saved) !== before) menuKeys.changed();
    session.defaultSession.setSpellCheckerEnabled(saved.spellcheck);
    return saved;
  });
  handle('dictionary:list', async () => {
    const words = await session.defaultSession.listWordsInSpellCheckerDictionary();
    return words.sort((a, b) => a.localeCompare(b));
  });
  handle('dictionary:add', (word) => session.defaultSession.addWordToSpellCheckerDictionary(String(word)));
  handle('dictionary:remove', (word) => session.defaultSession.removeWordFromSpellCheckerDictionary(String(word)));
  handle('details:get', (id) => workspace().getDetails(id));
  handle('details:save', (input) => workspace().saveDetails(input));
  handle('cover:choose', (id) => chooseCover(workspace, window, id));
  handle('cover:remove', (id) => workspace().removeCover(id));
  handle('export:check', (input) => checkExport(workspace().open(), input));
  handle('export:run', busy(unlocked((input) => runExport(workspace, window, input))));
  handle('export:everything', busy(unlocked(() => everything(workspace, window))));
  handle('export:preview', busy(unlocked((input) => preview(workspace, input))));
  handle('export:reveal', (file) => shell.showItemInFolder(String(file)));
  registerReadAloud({ handle, unlocked, readAloud, audioFiles, workspace, dialog, shell, window, safeName });
  const folderProgress = (data) => window()?.webContents.send('folder:progress', data);
  handle('folder:choose', () => chooseFolder(window));
  handle('folder:scan', () => {
    if (!chosenFolder) throw new Error('Choose a folder first.');
    return folderImport.scan(workspace(), chosenFolder, folderProgress);
  });
  handle('folder:edit', (change) => folderImport.edit(workspace(), change));
  // A folder chosen on this computer is remembered as chosen here, so it can be checked for changes. One that a project only names,
  // as when an import is picked up again on another computer, isn't.
  handle('folder:run', busy(() => {
    const { state } = folderImport;
    if (state && state.root === chosenFolder) folderLinks().add(workspace().open().id, state.id, state.root);
    return folderImport.run(workspace(), folderProgress);
  }));
  // Checking those folders again. Whatever was read from one is forgotten when the project closes or locks.
  const checking = () => {
    workspace().onClose = () => folderCheck.forget();
    return workspace();
  };
  handle('folderCheck:folders', () => folderCheck.folders(checking(), folderLinks()));
  handle('folderCheck:run', () => folderCheck.check(checking(), folderLinks()));
  handle('folderCheck:compare', (key) => folderCheck.compare(checking(), String(key)));
  handle('folderCheck:apply', busy((choices) => folderCheck.apply(checking(), Array.isArray(choices) ? choices : [])));
  handle('folderCheck:locate', async (importId) => {
    // The window opens where the system chooses, never at the path the project names.
    const { canceled, filePaths } = await dialog.showOpenDialog(window(), { title: 'Where is the folder now?', properties: ['openDirectory'] });
    if (canceled) return false;
    await folderCheck.locate(checking(), folderLinks(), String(importId), filePaths[0]);
    return true;
  });
  handle('folder:stop', () => folderImport.stop());
  handle('folder:pending', () => folderImport.pending(workspace(), folderLinks()));
  handle('folder:locatePending', async () => {
    // As above: the window never opens at the path the project names.
    const { canceled, filePaths } = await dialog.showOpenDialog(window(), { title: 'Choose the folder it was reading', properties: ['openDirectory'] });
    if (canceled) return false;
    await folderImport.locate(workspace(), folderLinks(), filePaths[0]);
    return true;
  });
  handle('folder:resume', busy(() => folderImport.resume(workspace(), folderLinks(), folderProgress)));
  handle('folder:discard', () => folderImport.discard(workspace()));
  handle('folder:saveReport', async (report) => {
    const file = await saveFolderReport(window);
    if (file) fs.writeFileSync(file, folderImport.reportText(report));
    return file;
  });
  handle('records:overview', () => workspace().records.overview());
  handle('records:list', (typeId) => workspace().records.list(typeId));
  handle('records:get', (id) => workspace().records.get(id));
  handle('records:create', (input) => workspace().records.create(input));
  handle('records:save', (input) => workspace().records.save(input));
  handle('records:nextNumber', (input) => workspace().records.nextNumber(input));
  handle('records:find', (input) => workspace().records.find(input));
  handle('records:backlinks', (id) => workspace().records.backlinks(id));
  handle('records:createType', (input) => workspace().records.createType(input));
  handle('records:saveType', (input) => workspace().records.saveType(input));
  handle('records:templates', () => workspace().records.templates());
  handle('records:applyTemplate', (id) => workspace().records.applyTemplate(id));
  handle('records:books', () => workspace().records.books());
  handle('records:freeze', (input) => workspace().records.freeze(input));
  handle('records:getVersion', (id) => workspace().records.getVersion(id));
  handle('records:correct', (input) => workspace().records.correct(input));
  handle('records:print', busy(unlocked((input) => printRecords(workspace, window, input))));
  handle('records:importFiles', () => chooseRecordFiles(window));
  handle('records:importFolder', () => chooseRecordFolder(window));
  handle('records:importPreview', (typeId) => recordImporter.preview(typeId ? workspace().records.typeItem(typeId) : null));
  handle('records:importRun', busy((input) => recordImporter.run(workspace().records, input)));
  handle('attachments:list', (id) => workspace().listAttachments(id));
  // The Files view. Ids arrive as a list, so many can be changed in one go.
  const idsOf = (ids) => {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100000) throw new Error('Choose some files first.');
    return ids.map(String);
  };
  const files = () => new Files(workspace());
  handle('files:list', (id) => files().list(id));
  handle('files:preview', (id) => files().preview(id));
  handle('files:section', busy(({ ids, section }) => files().setSection(idsOf(ids), section)));
  handle('files:move', busy(({ ids, parentId }) => files().move(idsOf(ids), parentId)));
  handle('files:trash', busy((ids) => files().trash(idsOf(ids))));
  handle('files:cover', busy((id) => files().useAsCover(id)));
  handle('files:chapter', busy(({ id, bookId }) => files().makeChapter(id, bookId)));
  handle('files:record', busy(({ id, typeId }) => files().makeRecord(id, typeId)));
  handle('attachments:add', busy((parentId) => addAttachments(workspace, window, parentId)));
  handle('attachments:preview', (id) => workspace().previewAttachment(id));
  handle('attachments:save', busy(unlocked((id) => saveAttachment(workspace, window, id))));
  handle('import:choose', () => chooseImport(window));
  handle('import:preview', (input) => importer.preview(input));
  handle('import:commit', busy((input) => importer.commit(workspace(), input)));
  handle('update:install', () => updater.installNow());
}

module.exports = { registerIpc };
