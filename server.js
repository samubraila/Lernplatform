// Lernplattform – lokaler Server (ohne externe Pakete)
// Liest/schreibt direkt im gewählten Ordner und meldet Änderungen live an die App.
// Läuft entweder mit "node server.js" oder als Lernplattform.exe (Node Single Executable).
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn, execFile } = require('child_process');

// Als EXE: Oberfläche steckt in der EXE, Einstellungen/Sicherungen liegen in %APPDATA%\Lernplattform
let sea = null;
try { sea = require('node:sea'); if (!sea.isSea()) sea = null; } catch { sea = null; }
const APP_DIR = sea ? path.dirname(process.execPath) : __dirname;
const DATA_DIR = process.env.LERN_DATA || (sea ? path.join(process.env.APPDATA || APP_DIR, 'Lernplattform') : __dirname);
const PORT = Number(process.env.LERN_PORT || 4747);
const PUB = path.join(__dirname, 'public');
const BACKUP_DIR = process.env.LERN_BACKUP_DIR || path.join(DATA_DIR, 'Sicherungen');
const CONFIG_FILE = path.join(DATA_DIR, 'einstellungen.json');
const TEST_MODE = !!process.env.LERN_ROOT;

// Ohne Konsole (EXE) Meldungen in eine Logdatei schreiben
if (sea) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
  const logFile = path.join(DATA_DIR, 'lernplattform.log');
  const log = (...a) => { try { fs.appendFileSync(logFile, `[${new Date().toLocaleString('de-DE')}] ${a.map(String).join(' ')}\n`); } catch {} };
  console.log = log; console.error = log; console.warn = log;
}

// ---------- Ordner, mit denen die App verknüpft ist ----------
const DEFAULT_ROOT = 'C:\\Users\\samub\\OneDrive\\Documenten\\Schule';
function loadConfig() {
  let cfg = { folders: [], current: null };
  if (!TEST_MODE) { try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; } catch {} }
  const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
  if (TEST_MODE) cfg.current = path.resolve(process.env.LERN_ROOT);
  if (!cfg.current || !isDir(cfg.current)) cfg.current = cfg.folders.find(isDir) || (isDir(DEFAULT_ROOT) ? DEFAULT_ROOT : path.join(process.env.USERPROFILE || 'C:\\', 'Documents'));
  cfg.current = path.resolve(cfg.current);
  if (!cfg.folders.some(f => samePath(f, cfg.current))) cfg.folders.unshift(cfg.current);
  return cfg;
}
function samePath(a, b) { return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase(); }
function saveConfig() {
  if (TEST_MODE) return;
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2)); } catch (e) { console.error('Einstellungen nicht gespeichert:', e.message); }
}
const config = loadConfig();
let ROOT = config.current;
const URL_APP = `http://localhost:${PORT}`;
const NO_OPEN = process.argv.includes('--no-open');

const HIDDEN = /^(\.|~\$|desktop\.ini$|thumbs\.db$)/i;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.avif': 'image/avif', '.pdf': 'application/pdf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
  '.mjs': 'text/javascript; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};

// Installierte Programme finden, mit denen Dateien bearbeitet werden können
function findExe(appPathName, fallbacks) {
  for (const hive of ['HKLM', 'HKCU']) {
    try {
      const out = require('child_process').execFileSync('reg.exe', ['query', `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${appPathName}`, '/ve'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      const m = /REG_(?:EXPAND_)?SZ\s+(.+)/.exec(out);
      if (m) { const exe = m[1].trim().replace(/^"|"$/g, '').replace(/%([^%]+)%/g, (x, v) => process.env[v] || x); if (fs.existsSync(exe)) return exe; }
    } catch {}
  }
  return fallbacks.find(f => f && fs.existsSync(f)) || null;
}
const LOCAL = process.env.LOCALAPPDATA || '';
const APPS = Object.fromEntries(Object.entries({
  word: { name: 'Word', exe: findExe('WINWORD.EXE', []) },
  excel: { name: 'Excel', exe: findExe('EXCEL.EXE', []) },
  powerpoint: { name: 'PowerPoint', exe: findExe('POWERPNT.EXE', []) },
  onenote: { name: 'OneNote', exe: findExe('ONENOTE.EXE', []) },
  vscode: { name: 'VS Code', exe: findExe('Code.exe', [path.join(LOCAL, 'Programs\\Microsoft VS Code\\Code.exe'), 'C:\\Program Files\\Microsoft VS Code\\Code.exe']) },
  edge: { name: 'Edge', exe: findExe('msedge.exe', ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']) },
  packettracer: { name: 'Packet Tracer', exe: findExe('PacketTracer.exe', ['C:\\Program Files\\Cisco Packet Tracer 8.2.2\\bin\\PacketTracer.exe', 'C:\\Program Files\\Cisco Packet Tracer 8.2.1\\bin\\PacketTracer.exe', 'C:\\Program Files\\Cisco Packet Tracer 8.2.0\\bin\\PacketTracer.exe']) },
  notepad: { name: 'Editor', exe: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32\\notepad.exe') },
}).filter(([, v]) => v.exe));

// Windows-Vorlage für "Neu > Word-Dokument" usw. (leer, falls keine Vorlage registriert ist)
function regValue(key, name) {
  try {
    const out = require('child_process').execFileSync('reg.exe', ['query', key, ...(name ? ['/v', name] : ['/ve'])], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const m = /REG_(?:EXPAND_)?SZ\s+(.+)/.exec(out); return m ? m[1].trim() : null;
  } catch { return null; }
}
function shellNewTemplate(ext) {
  const prog = regValue(`HKCR\\${ext}`);
  const file = prog && regValue(`HKCR\\${ext}\\${prog}\\ShellNew`, 'FileName');
  return file && fs.existsSync(file) ? file : null;
}
const NEW_DOC_TYPES = ['.docx', '.xlsx', '.pptx'];

function httpError(code, msg) { const e = new Error(msg); e.status = code; return e; }

// Pfad aus der App → absoluter Pfad, der garantiert im ROOT liegt
function safe(rel) {
  const p = path.resolve(ROOT, String(rel || '').replace(/^[/\\]+/, ''));
  if (p !== ROOT && !p.startsWith(ROOT + path.sep)) throw httpError(400, 'Ungültiger Pfad');
  return p;
}
const toRel = abs => path.relative(ROOT, abs).split(path.sep).join('/');

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req, limit = 200 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(httpError(413, 'Datei zu groß')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function exists(p) { try { await fsp.access(p); return true; } catch { return false; } }

async function uniqueName(dir, name) {
  const ext = path.extname(name); const base = name.slice(0, name.length - ext.length);
  let candidate = name, i = 2;
  while (await exists(path.join(dir, candidate))) candidate = `${base} (${i++})${ext}`;
  return candidate;
}

function cleanName(name) {
  return String(name || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+$/g, '').replace(/^\.+/, '').trim() || 'Unbenannt';
}

// Emoji-Icon aus dem Frontmatter einer .md-Datei lesen (nur die ersten Bytes)
async function mdIcon(abs) {
  try {
    const fh = await fsp.open(abs, 'r');
    const buf = Buffer.alloc(400); const { bytesRead } = await fh.read(buf, 0, 400, 0); await fh.close();
    const head = buf.slice(0, bytesRead).toString('utf8');
    if (!head.startsWith('---')) return null;
    const m = head.match(/^icon:\s*(.+)$/m); return m ? m[1].trim() : null;
  } catch { return null; }
}

async function list(rel) {
  const dir = safe(rel);
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const out = [];
  await Promise.all(entries.filter(e => !HIDDEN.test(e.name)).map(async e => {
    const abs = path.join(dir, e.name);
    let st; try { st = await fsp.stat(abs); } catch { return; }
    const isDir = st.isDirectory();
    const ext = isDir ? '' : path.extname(e.name).toLowerCase();
    out.push({
      name: e.name, path: toRel(abs), type: isDir ? 'dir' : 'file', ext,
      size: st.size, mtime: st.mtimeMs, icon: ext === '.md' ? await mdIcon(abs) : null,
    });
  }));
  const coll = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
  out.sort((a, b) => (a.type === b.type ? coll.compare(a.name, b.name) : a.type === 'dir' ? -1 : 1));
  return out;
}

async function walk(dir, visit, depth = 0) {
  if (depth > 12) return;
  let entries; try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (HIDDEN.test(e.name)) continue;
    const abs = path.join(dir, e.name);
    if (visit(e, abs) === false) return false;
    if (e.isDirectory() && (await walk(abs, visit, depth + 1)) === false) return false;
  }
}

async function search(q) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = [];
  await walk(ROOT, (e, abs) => {
    const rel = toRel(abs); const low = rel.toLowerCase();
    if (terms.every(t => low.includes(t))) hits.push({ name: e.name, path: rel, type: e.isDirectory() ? 'dir' : 'file', ext: e.isDirectory() ? '' : path.extname(e.name).toLowerCase() });
    if (hits.length >= 150) return false;
  });
  return hits;
}

async function recent(n = 12) {
  const files = [];
  const pending = [];
  await walk(ROOT, (e, abs) => { if (e.isFile()) pending.push(abs); });
  await Promise.all(pending.map(async abs => {
    try { const st = await fsp.stat(abs); files.push({ name: path.basename(abs), path: toRel(abs), type: 'file', ext: path.extname(abs).toLowerCase(), mtime: st.mtimeMs }); } catch {}
  }));
  files.sort((a, b) => b.mtime - a.mtime);
  return files.slice(0, n);
}

// In den Windows-Papierkorb verschieben (wiederherstellbar)
function recycle(abs, isDir) {
  return new Promise((resolve, reject) => {
    const esc = abs.replace(/'/g, "''");
    const fn = isDir ? 'DeleteDirectory' : 'DeleteFile';
    const ps = `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::${fn}('${esc}','OnlyErrorDialogs','SendToRecycleBin')`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true }, err => err ? reject(err) : resolve());
  });
}

// ---------- Live-Sync: Ordner überwachen und per Server-Sent-Events melden ----------
const clients = new Set();
let lastClientSeen = Date.now();
const pendingEvents = new Map();
let flushTimer = null;

function broadcast(obj) {
  const data = `data: ${JSON.stringify(obj)}\n\n`;
  for (const res of clients) res.write(data);
}

let watcher = null;
function startWatcher() {
  try { watcher?.close(); } catch {}
  try {
    watcher = fs.watch(ROOT, { recursive: true }, (evt, filename) => {
      if (!filename) return;
      const rel = String(filename).split(path.sep).join('/');
      if (rel.split('/').some(part => HIDDEN.test(part))) return;
      pendingEvents.set(rel, evt);
      clearTimeout(flushTimer);
      flushTimer = setTimeout(() => {
        const paths = [...pendingEvents.keys()]; pendingEvents.clear();
        broadcast({ type: 'change', paths });
      }, 200);
    });
    watcher.on('error', err => console.error('Ordnerüberwachung:', err.message));
  } catch (err) {
    console.error('Ordnerüberwachung konnte nicht gestartet werden:', err.message);
  }
}

// Zu einem anderen Ordner wechseln (die App lädt sich danach neu)
function switchRoot(dir) {
  const abs = path.resolve(dir);
  if (!fs.statSync(abs).isDirectory()) throw httpError(400, 'Kein Ordner');
  ROOT = abs; config.current = abs;
  if (!config.folders.some(f => samePath(f, abs))) config.folders.push(abs);
  saveConfig();
  startWatcher();
  broadcast({ type: 'root', root: ROOT, rootName: path.basename(ROOT) || ROOT });
}

// Windows-Dialog „Ordner auswählen“ (moderner Explorer-Dialog, im Vordergrund)
function pickFolder() {
  if (process.env.LERN_PICK_RESULT !== undefined) return Promise.resolve(process.env.LERN_PICK_RESULT || null);   // für die Tests
  const ps = `[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
[ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FileOpenDialogRCW {}
[ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IShellItem { void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv); void GetParent(out IShellItem si); void GetDisplayName(uint sigdn, [MarshalAs(UnmanagedType.LPWStr)] out string name); void GetAttributes(uint mask, out uint attrs); void Compare(IShellItem si, uint hint, out int order); }
[ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IFileDialog {
  [PreserveSig] int Show(IntPtr parent);
  void SetFileTypes(uint c, IntPtr f); void SetFileTypeIndex(uint i); void GetFileTypeIndex(out uint i);
  void Advise(IntPtr p, out uint c); void Unadvise(uint c); void SetOptions(uint fos); void GetOptions(out uint fos);
  void SetDefaultFolder(IShellItem si); void SetFolder(IShellItem si); void GetFolder(out IShellItem si); void GetCurrentSelection(out IShellItem si);
  void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string n); void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string n);
  void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string t); void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string t);
  void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string l); void GetResult(out IShellItem si);
}
public static class FolderPicker {
  public static string Pick(IntPtr owner) {
    var d = (IFileDialog)new FileOpenDialogRCW();
    uint o; d.GetOptions(out o); d.SetOptions(o | 0x20 | 0x40 | 0x800);
    d.SetTitle("Ordner für die Lernplattform auswählen"); d.SetOkButtonLabel("Ordner verknüpfen");
    if (d.Show(owner) != 0) return null;
    IShellItem si; d.GetResult(out si); string p; si.GetDisplayName(0x80058000, out p); return p;
  }
}
'@
$f = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; Opacity = 0; Width = 1; Height = 1; StartPosition = 'CenterScreen' }
$f.Show(); $f.Activate()
$r = [FolderPicker]::Pick($f.Handle)
$f.Close()
if ($r) { Write-Output $r }`;
  const tmp = path.join(require('os').tmpdir(), `lernplattform-ordnerwahl-${process.pid}.ps1`);
  fs.writeFileSync(tmp, '\ufeff' + ps, 'utf8');
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', tmp], { windowsHide: true, encoding: 'utf8', timeout: 10 * 60 * 1000 }, (err, out) => {
      try { fs.unlinkSync(tmp); } catch {}
      const p = String(out || '').trim().split(/\r?\n/).pop();
      resolve(!err && p && fs.existsSync(p) ? p : null);
    });
  });
}

// Statische App-Dateien: aus der EXE oder aus dem public-Ordner
async function readPublic(rel) {
  if (sea) return Buffer.from(sea.getAsset('public/' + rel));
  return fsp.readFile(path.join(PUB, rel));
}

// ---------- HTTP-Routen ----------
async function handle(req, res) {
  const url = new URL(req.url, URL_APP);
  const q = url.searchParams;
  const p = url.pathname;

  if (p === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ type: 'hello', root: ROOT })}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); lastClientSeen = Date.now(); });
    return;
  }

  if (p === '/api/info') return send(res, 200, { root: ROOT, rootName: path.basename(ROOT) || ROOT, apps: Object.fromEntries(Object.entries(APPS).map(([k, v]) => [k, v.name])), exe: !!sea });
  if (p === '/api/folders') return send(res, 200, { current: ROOT, folders: config.folders.map(f => ({ path: f, name: path.basename(f) || f, exists: fs.existsSync(f), current: samePath(f, ROOT) })) });
  if (p === '/api/list') return send(res, 200, await list(q.get('path')));
  if (p === '/api/search') return send(res, 200, await search(q.get('q') || ''));
  if (p === '/api/recent') return send(res, 200, await recent(Number(q.get('n') || 12)));

  if (p === '/api/stat') {
    const abs = safe(q.get('path'));
    try { const st = await fsp.stat(abs); return send(res, 200, { exists: true, type: st.isDirectory() ? 'dir' : 'file', size: st.size, mtime: st.mtimeMs }); }
    catch { return send(res, 200, { exists: false }); }
  }

  if (p === '/api/read') {
    const abs = safe(q.get('path'));
    try { return send(res, 200, await fsp.readFile(abs, 'utf8'), 'text/plain; charset=utf-8'); }
    catch { throw httpError(404, 'Datei nicht gefunden'); }
  }

  // Windows-Schriften für PDF-Text mit Umlauten und Sonderzeichen
  if (p.startsWith('/fonts/')) {
    const name = path.basename(p).toLowerCase();
    if (!['arial.ttf', 'arialbd.ttf'].includes(name)) throw httpError(404, 'Nicht gefunden');
    try { return send(res, 200, await fsp.readFile(path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', name)), 'font/ttf'); }
    catch { throw httpError(404, 'Schrift nicht gefunden'); }
  }

  // Dateien über ihren Pfad ausliefern, damit relative Links in HTML-Seiten (style.css, bild.png …) funktionieren.
  // Die Sandbox-Regel sorgt dafür, dass Skripte darin keinen Zugriff auf die App (und damit deine Dateien) haben.
  if (p.startsWith('/files/')) {
    const abs = safe(decodeURIComponent(p.slice('/files/'.length)));
    let st; try { st = await fsp.stat(abs); } catch { throw httpError(404, 'Nicht gefunden'); }
    if (st.isDirectory()) throw httpError(404, 'Ordner');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache',
      'Content-Security-Policy': 'sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads',
    });
    return fs.createReadStream(abs).pipe(res);
  }

  if (p === '/raw') {
    const abs = safe(q.get('path'));
    let st; try { st = await fsp.stat(abs); } catch { throw httpError(404, 'Nicht gefunden'); }
    const type = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Cache-Control': 'no-cache' });
      return fs.createReadStream(abs, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
    return fs.createReadStream(abs).pipe(res);
  }

  if (req.method !== 'POST') {
    // statische App-Dateien
    const rel = path.posix.normalize(p === '/' ? 'index.html' : decodeURIComponent(p).replace(/^\/+/, ''));
    if (rel.startsWith('..')) throw httpError(400, 'Ungültig');
    try { return send(res, 200, await readPublic(rel), MIME[path.extname(rel)] || 'application/octet-stream'); }
    catch { throw httpError(404, 'Nicht gefunden'); }
  }

  // ---- ab hier schreibende Aktionen ----
  if (p === '/api/folders/pick') {
    const dir = await pickFolder();
    if (!dir) return send(res, 200, { ok: false, cancelled: true });
    switchRoot(dir);
    return send(res, 200, { ok: true, current: ROOT });
  }
  if (p === '/api/folders/switch') {
    const dir = q.get('path');
    if (!dir || !fs.existsSync(dir)) throw httpError(404, 'Den Ordner gibt es nicht (mehr)');
    switchRoot(dir);
    return send(res, 200, { ok: true, current: ROOT });
  }
  if (p === '/api/folders/remove') {
    const dir = q.get('path');
    if (samePath(dir, ROOT)) throw httpError(400, 'Der geöffnete Ordner kann nicht entfernt werden – wechsle zuerst zu einem anderen');
    config.folders = config.folders.filter(f => !samePath(f, dir));
    saveConfig();
    return send(res, 200, { ok: true });
  }

  if (p === '/api/write') {
    const abs = safe(q.get('path'));
    const body = await readBody(req);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    let backup = null;
    if (q.get('backup') === '1' && await exists(abs)) {
      // Sicherungskopie außerhalb von OneDrive, bevor ein Dokument zum ersten Mal geändert wird
      await fsp.mkdir(BACKUP_DIR, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      backup = path.join(BACKUP_DIR, `${stamp}_${path.basename(abs)}`);
      await fsp.copyFile(abs, backup);
    }
    try { await fsp.writeFile(abs, body); }
    catch (err) {
      if (err.code === 'EBUSY' || err.code === 'EPERM') throw httpError(423, 'Die Datei ist gerade in einem anderen Programm geöffnet (z. B. Word). Schließe sie dort und speichere erneut.');
      throw err;
    }
    const st = await fsp.stat(abs);
    return send(res, 200, { ok: true, mtime: st.mtimeMs, backup });
  }

  if (p === '/api/create') {
    // neue Datei (ohne Überschreiben), Name wird bei Bedarf eindeutig gemacht
    const dir = safe(q.get('dir'));
    await fsp.mkdir(dir, { recursive: true });
    const name = await uniqueName(dir, cleanName(q.get('name')));
    const body = await readBody(req);
    await fsp.writeFile(path.join(dir, name), body);
    return send(res, 200, { ok: true, name, path: toRel(path.join(dir, name)) });
  }

  if (p === '/api/newdoc') {
    const dir = safe(q.get('dir'));
    const ext = String(q.get('ext') || '').toLowerCase();
    if (!NEW_DOC_TYPES.includes(ext)) throw httpError(400, 'Unbekannter Dokumenttyp');
    const tpl = shellNewTemplate(ext);
    const name = await uniqueName(dir, cleanName(q.get('name')) + ext);
    await fsp.writeFile(path.join(dir, name), tpl ? await fsp.readFile(tpl) : Buffer.alloc(0));
    return send(res, 200, { ok: true, name, path: toRel(path.join(dir, name)) });
  }

  if (p === '/api/mkdir') {
    const parent = safe(q.get('dir'));
    const name = await uniqueName(parent, cleanName(q.get('name')));
    await fsp.mkdir(path.join(parent, name), { recursive: true });
    return send(res, 200, { ok: true, name, path: toRel(path.join(parent, name)) });
  }

  if (p === '/api/rename') {
    const from = safe(q.get('from'));
    if (from === ROOT) throw httpError(400, 'Der Hauptordner kann nicht umbenannt werden');
    const to = safe(q.get('to'));
    if (from.toLowerCase() !== to.toLowerCase() && await exists(to)) throw httpError(409, 'Es gibt schon eine Datei mit diesem Namen');
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.rename(from, to);
    return send(res, 200, { ok: true, path: toRel(to) });
  }

  if (p === '/api/delete') {
    const abs = safe(q.get('path'));
    if (abs === ROOT) throw httpError(400, 'Der Hauptordner kann nicht gelöscht werden');
    const st = await fsp.stat(abs);
    await recycle(abs, st.isDirectory());
    return send(res, 200, { ok: true });
  }

  if (p === '/api/open') {
    const abs = safe(q.get('path'));
    const app = q.get('app') || (q.get('reveal') === '1' ? 'reveal' : 'default');
    let cmd, args;
    if (app === 'reveal') { cmd = 'explorer.exe'; args = [`/select,${abs}`]; }
    else if (app === 'openwith') { cmd = 'rundll32.exe'; args = ['shell32.dll,OpenAs_RunDLL', abs]; }
    else if (APPS[app]) { cmd = APPS[app].exe; args = [abs]; }
    else { cmd = 'explorer.exe'; args = [abs]; }
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
    return send(res, 200, { ok: true });
  }

  throw httpError(404, 'Unbekannte Aktion');
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(err => {
    if (res.headersSent) return res.end();
    send(res, err.status || 500, { error: err.status ? err.message : 'Serverfehler: ' + err.message });
  });
});

function openWindow() {
  if (NO_OPEN) return;
  // Als eigenes App-Fenster (Edge) öffnen, sonst im Standardbrowser
  const child = spawn('cmd.exe', ['/c', 'start', '""', 'msedge', `--app=${URL_APP}`], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => spawn('cmd.exe', ['/c', 'start', '""', URL_APP], { detached: true, stdio: 'ignore' }));
  child.unref();
}

server.on('error', err => {
  if (err.code === 'EADDRINUSE') { console.log('Lernplattform läuft bereits – öffne Fenster.'); openWindow(); setTimeout(() => process.exit(0), 500); }
  else { console.error(err); process.exit(1); }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Lernplattform läuft auf ${URL_APP}`);
  console.log(`Verknüpfter Ordner: ${ROOT}`);
  startWatcher();
  openWindow();
});

// Beendet sich selbst, wenn 15 Minuten lang kein App-Fenster offen war
setInterval(() => {
  if (!NO_OPEN && clients.size === 0 && Date.now() - lastClientSeen > 15 * 60 * 1000) process.exit(0);
}, 60 * 1000);
