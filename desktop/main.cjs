// Electron main process: windows, native file dialogs, recent-session memory, menu.
const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const recentFile = () => path.join(app.getPath('userData'), 'recent.json');
function readRecent() { try { return JSON.parse(fs.readFileSync(recentFile(), 'utf8')); } catch { return { projects: [] }; } }
function remember(projectPath) {
  const r = readRecent(); r.projects = [projectPath, ...r.projects.filter(p => p !== projectPath)].slice(0, 10); r.last = projectPath;
  fs.mkdirSync(path.dirname(recentFile()), { recursive: true }); fs.writeFileSync(recentFile(), JSON.stringify(r, null, 1));
}
const LAS_FILTERS = [{ name: 'LAS well logs', extensions: ['las', 'LAS', 'txt'] }];
const PROJ_FILTERS = [{ name: 'Weller Logs project', extensions: ['lasproj', 'json'] }];
let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 950, minWidth: 900, minHeight: 600, title: 'Weller Logs',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, '..', 'mockup', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  const shot = process.argv.find(a => a.startsWith('--screenshot='));
  if (shot) win.webContents.once('did-finish-load', () => setTimeout(async () => {
    const img = await win.webContents.capturePage(); fs.writeFileSync(shot.split('=')[1], img.toPNG()); app.quit();
  }, 2500));
}

const send = (ch, ...a) => win && win.webContents.send(ch, ...a);
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const tpl = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      { label: 'Open LAS…', accelerator: 'CmdOrCtrl+O', click: () => send('menu', 'open-las') },
      { label: 'Open Project…', accelerator: 'CmdOrCtrl+Shift+O', click: () => send('menu', 'open-project') },
      { label: 'Open Recent', submenu: readRecent().projects.map(p => ({ label: path.basename(p), click: () => send('menu', 'open-project-path', p) })) },
      { type: 'separator' },
      { label: 'Save Project', accelerator: 'CmdOrCtrl+S', click: () => send('menu', 'save-project') },
      { label: 'Save Project As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('menu', 'save-project-as') },
      { label: 'Export PNG…', accelerator: 'CmdOrCtrl+E', click: () => send('menu', 'export-png') },
      { type: 'separator' }, isMac ? { role: 'close' } : { role: 'quit' } ] },
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

const readText = p => fs.readFileSync(p, 'utf8');
ipcMain.handle('open-las', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: LAS_FILTERS });
  return r.canceled ? [] : r.filePaths.map(p => ({ name: path.basename(p), path: p, text: readText(p) }));
});
ipcMain.handle('read-files', (_e, paths, base) => paths.map(p => {
  const abs = path.isAbsolute(p) || !base ? p : path.resolve(path.dirname(base), p);
  try { return { name: path.basename(abs), path: abs, text: readText(abs) }; } catch (err) { return { name: path.basename(abs), path: abs, error: err.message }; }
}));
ipcMain.handle('open-project', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: PROJ_FILTERS });
  if (r.canceled) return null; const p = r.filePaths[0]; remember(p); buildMenu(); return { path: p, text: readText(p) };
});
ipcMain.handle('read-project', (_e, p) => { try { const t = readText(p); remember(p); buildMenu(); return { path: p, text: t }; } catch (err) { return { path: p, error: err.message }; } });
ipcMain.handle('save-project', async (_e, text, current, suggested) => {
  let p = current;
  if (!p) { const r = await dialog.showSaveDialog(win, { defaultPath: (suggested || 'project') + '.lasproj', filters: PROJ_FILTERS }); if (r.canceled) return null; p = r.filePath; }
  fs.writeFileSync(p, text); remember(p); buildMenu(); return p;
});
ipcMain.handle('save-bytes', async (_e, name, bytes) => {
  const ext = path.extname(name).slice(1);
  const r = await dialog.showSaveDialog(win, { defaultPath: name, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  if (r.canceled) return null; fs.writeFileSync(r.filePath, Buffer.from(bytes)); return r.filePath;
});
ipcMain.handle('last-session', () => { const r = readRecent(); return r.last && fs.existsSync(r.last) ? { path: r.last, name: path.basename(r.last), mtime: fs.statSync(r.last).mtime.toISOString() } : null; });
ipcMain.handle('relative-path', (_e, from, to) => path.relative(path.dirname(from), to));

app.whenReady().then(() => { buildMenu(); createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('open-file', (e, p) => { e.preventDefault(); if (win) send('menu', 'open-project-path', p); });
