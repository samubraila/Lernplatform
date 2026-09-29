// ================== Lernplattform – automatische Tests ==================
// Startet einen eigenen Server mit einem Test-Ordner (NICHT dein Schule-Ordner), bedient die App
// in einem unsichtbaren Edge-Fenster wie ein Mensch und schreibt einen Bericht nach Testbericht\index.html.
//   Start:  node tests\run-tests.js      (oder Tests-ausfuehren.bat)
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const PORT = 4799;
const BASE = `http://localhost:${PORT}`;
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const ROOT = path.join(os.tmpdir(), 'lernplattform-test-' + STAMP);
const ROOT2 = path.join(os.tmpdir(), 'lernplattform-test-zweiter-ordner-' + STAMP);
const EXE = (process.argv.find(a => a.startsWith('--exe=')) || '').slice(6);
const BACKUPS = path.join(ROOT, '..', 'lernplattform-test-sicherungen-' + STAMP);
const REPORT = path.join(APP, 'Testbericht');
const IMG = path.join(REPORT, 'img');
const SCHULE = 'C:\\Users\\samub\\OneDrive\\Documenten\\Schule';
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(f => fs.existsSync(f));
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7).toLowerCase();

const JSZip = require(path.join(APP, 'public/vendor/jszip.min.js'));
const PDFLib = require(path.join(APP, 'public/vendor/pdf-lib.min.js'));
const XLSX = require(path.join(APP, 'public/vendor/xlsx.full.min.js'));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const P = (...p) => path.join(ROOT, ...p);
const read = f => fs.readFileSync(P(f), 'utf8');
const exists = f => fs.existsSync(P(f));
function expect(cond, msg) { if (!cond) throw new Error(msg); }
async function until(fn, ms = 5000, msg = 'Zeitüberschreitung') {
  const t0 = Date.now(); let last;
  while (Date.now() - t0 < ms) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await sleep(120); }
  throw new Error(msg + (last instanceof Error ? ' (' + last.message + ')' : ''));
}

// ================== Testdateien erzeugen ==================
async function makeDocx(file) {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const p = (text, bold) => `<w:p><w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const cell = t => `<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>${t ? p(t) : '<w:p/>'}</w:tc>`;
  const row = (a, b) => `<w:tr>${cell(a)}${cell(b)}</w:tr>`;
  const border = s => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`;
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>
${p('Arbeitsblatt Netzwerke', true)}
<w:p><w:r><w:t xml:space="preserve">Name: </w:t></w:r><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>Max</w:t></w:r></w:p>
${p('Beantworte die Fragen in der Tabelle.')}
<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders></w:tblPr>
<w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid>
${row('Frage', 'Antwort')}${row('Was ist ein Switch?', '')}${row('Was ist ein Router?', '')}${row('Was ist eine IP?', 'Adresse')}
</w:tbl>
${p('Ende des Arbeitsblatts.')}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1134" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/document.xml', doc);
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));
}

async function makePdf(file) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const form = doc.getForm();
  const p1 = doc.addPage([595, 842]);
  p1.drawText('Arbeitsblatt Topologien', { x: 50, y: 780, size: 18, font: bold });
  p1.drawText('Name:', { x: 50, y: 720, size: 12, font });
  const name = form.createTextField('name'); name.addToPage(p1, { x: 110, y: 712, width: 220, height: 22 });
  p1.drawText('Fertig bearbeitet:', { x: 50, y: 680, size: 12, font });
  const cb = form.createCheckBox('fertig'); cb.addToPage(p1, { x: 160, y: 676, width: 16, height: 16 });
  p1.drawText('Klasse:', { x: 50, y: 640, size: 12, font });
  const dd = form.createDropdown('klasse'); dd.addOptions(['FI11', 'FI12', 'FI13']); dd.select('FI11'); dd.addToPage(p1, { x: 110, y: 632, width: 100, height: 22 });
  p1.drawText('Note:', { x: 50, y: 600, size: 12, font });
  const rg = form.createRadioGroup('note');
  rg.addOptionToPage('gut', p1, { x: 110, y: 596, width: 14, height: 14 }); p1.drawText('gut', { x: 130, y: 598, size: 11, font });
  rg.addOptionToPage('mittel', p1, { x: 170, y: 596, width: 14, height: 14 }); p1.drawText('mittel', { x: 190, y: 598, size: 11, font });
  const p2 = doc.addPage([595, 842]);
  p2.drawText('Seite zwei Text zum Abdecken', { x: 72, y: 700, size: 14, font });
  p2.drawText('Markier mich bitte', { x: 72, y: 650, size: 14, font });
  const p3 = doc.addPage([595, 842]);
  p3.drawText('Seite drei', { x: 72, y: 760, size: 14, font, color: rgb(0.2, 0.2, 0.2) });
  fs.writeFileSync(file, await doc.save());
}

async function makeLinkPdf(file) {
  const { PDFDocument, StandardFonts, PDFName, PDFString, rgb } = PDFLib;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([595, 842]); const p2 = doc.addPage([595, 842]);
  const blue = rgb(0.1, 0.3, 0.8);
  p1.drawText('Webseite zur Aufgabe', { x: 50, y: 760, size: 14, font, color: blue });
  p1.drawText('Weiter zu Seite 2', { x: 50, y: 720, size: 14, font, color: blue });
  p1.drawText('Formular oeffnen', { x: 50, y: 680, size: 14, font, color: blue });
  p1.drawText('Mehr Infos: www.beispiel.de/info oder lehrer@schule.de', { x: 50, y: 640, size: 12, font });
  p2.drawText('Ziel auf Seite zwei', { x: 50, y: 500, size: 14, font });
  const ctx = doc.context;
  const link = (y, A) => ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [48, y - 4, 220, y + 14], Border: [0, 0, 0], A }));
  p1.node.set(PDFName.of('Annots'), ctx.obj([
    link(760, ctx.obj({ S: 'URI', URI: PDFString.of('https://schule.example.org/aufgabe') })),
    link(720, ctx.obj({ S: 'GoTo', D: [p2.ref, 'XYZ', null, 520, null] })),
    link(680, ctx.obj({ S: 'GoToR', F: PDFString.of('Formular.pdf'), D: [0, 'Fit'] })),
  ]));
  fs.writeFileSync(file, await doc.save());
}

async function setupFixtures() {
  fs.mkdirSync(P('Notizen'), { recursive: true });
  fs.mkdirSync(P('Dateien'), { recursive: true });
  fs.mkdirSync(P('Word'), { recursive: true });
  fs.mkdirSync(P('PDF'), { recursive: true });
  fs.mkdirSync(BACKUPS, { recursive: true });
  fs.mkdirSync(path.join(ROOT2, 'Privat'), { recursive: true });
  fs.writeFileSync(path.join(ROOT2, 'Zweiter Ordner.md'), '# Hallo aus dem zweiten Ordner\n');
  fs.writeFileSync(path.join(ROOT2, 'Privat', 'Einkauf.txt'), 'Milch');
  await makeDocx(P('Word', 'Arbeitsblatt.docx'));
  await makePdf(P('PDF', 'Formular.pdf'));
  await makeLinkPdf(P('PDF', 'Links.pdf'));
  const quiz = path.join(SCHULE, 'Jahr3', 'FU-IT', 'Netzwerktechnik_Quiz_Erklaerungen.docx');
  if (fs.existsSync(quiz)) fs.copyFileSync(quiz, P('Word', 'Quiz (echte Datei).docx'));
  const topo = path.join(SCHULE, 'IT-Tec', 'IT-Tec', 'Jahr 1', '01_Topologien_AB.pdf');
  if (fs.existsSync(topo)) fs.copyFileSync(topo, P('PDF', 'Topologien (echte Datei).pdf'));
  const pptx = path.join(SCHULE, 'IT-Tec', '050_Vorlagen_fuer_Modellierungen.pptx');
  if (fs.existsSync(pptx)) fs.copyFileSync(pptx, P('Dateien', 'Praesentation.pptx'));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Fach', 'Note'], ['Mathe', 1], ['Englisch', 2]]), 'Noten');
  fs.writeFileSync(P('Dateien', 'Noten.xlsx'), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  fs.mkdirSync(P('Web'), { recursive: true });
  fs.writeFileSync(P('Web', 'index.html'), '<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<link rel="stylesheet" href="style.css">\n<title>Testseite</title>\n</head>\n<body>\n<h1 id="t">Hallo HTML</h1>\n<img id="i" src="bild.png" width="120">\n<p>Umlaute: äöü ß</p>\n<script src="script.js"></script>\n</body>\n</html>\n');
  fs.writeFileSync(P('Web', 'style.css'), 'body { font-family: sans-serif; background: #fff8e1; } h1 { color: rgb(200, 0, 0); }');
  fs.writeFileSync(P('Web', 'bild.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64'));
  fs.writeFileSync(P('Web', 'script.js'), `window.addEventListener('load', async () => {
  let api = 'offen';
  try { await fetch('/api/list?path='); api = 'erreichbar'; } catch { api = 'blockiert'; }
  const h = document.getElementById('t');
  parent.postMessage({ lern: true, h1: h.textContent, color: getComputedStyle(h).color, img: document.getElementById('i').naturalWidth, api }, '*');
});`);
  fs.writeFileSync(P('Dateien', 'Programm.cs'), 'class Programm {\n    static void Main() { }\n}\n');
  fs.writeFileSync(P('Dateien', 'notizen.wt'), 'Das ist Text mit unbekannter Endung.\n');
  fs.writeFileSync(P('Dateien', 'daten.bin'), Buffer.from([0, 1, 2, 3, 0, 255, 0, 17, 0, 0, 42]));
  fs.writeFileSync(P('Notizen', 'Fremd.md'), 'Titel\n=====\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<div align="center">HTML bleibt</div>\n\nText mit Fußnote[^1]\n\n[^1]: Die Fußnote\n');
}

// ================== Browser (Edge über DevTools-Protokoll) ==================
let ws, msgId = 0; const pending = new Map(); const jsErrors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
async function js(expr) {
  // in einen Block packen, damit sich Variablen verschiedener Tests nicht in die Quere kommen
  const r = await send('Runtime.evaluate', { expression: '{\n' + expr + '\n}', awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error('JS: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).split('\n')[0]);
  return r.result?.result?.value;
}
const KEYS = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, Delete: 46, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, z: 90, y: 89, b: 66, c: 67 };
async function key(k, mods = 0) {
  const code = k.length === 1 ? 'Key' + k.toUpperCase() : k;
  // Strg+C: dem Browser ausdrücklich den Kopier-Befehl mitgeben (wie bei einem echten Tastendruck)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: KEYS[k], modifiers: mods, commands: k === 'c' && mods === 2 ? ['copy'] : [] });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: KEYS[k], modifiers: mods });
}
async function type(text) { for (const ch of text) { if (ch === '\n') await key('Enter'); else await send('Input.insertText', { text: ch }); } }
async function mouse(type, x, y) { await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, buttons: type === 'mouseReleased' ? 0 : 1 }); }
async function click(x, y) { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); }
async function drag(x1, y1, x2, y2) { await mouse('mousePressed', x1, y1); for (let i = 1; i <= 6; i++) await mouse('mouseMoved', x1 + (x2 - x1) * i / 6, y1 + (y2 - y1) * i / 6); await mouse('mouseReleased', x2, y2); }
async function nav(p) { await js(`location.hash = ${JSON.stringify(p ? '#/' + p.split('/').map(encodeURIComponent).join('/') : '#/')}`); await sleep(250); }
async function waitJs(expr, ms = 6000, msg) { return until(() => js(expr), ms, msg || 'Wartet auf: ' + expr.slice(0, 80)); }

let shotNo = 0; let current = null;
async function shot(label) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const name = `${String(++shotNo).padStart(3, '0')}.png`;
  fs.writeFileSync(path.join(IMG, name), Buffer.from(r.result.data, 'base64'));
  if (current) current.shots.push({ name, label });
}

// Hilfsfunktionen, die in der Seite laufen
const PAGE_HELPERS = `
window.T = {
  ed: () => __lern.S.editor,
  bin: () => __lern.S.bin,
  blockWith: t => [...document.querySelectorAll('.editor .block')].find(b => b.textContent.includes(t)),
  selectText(el, word) {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) { const i = n.nodeValue.indexOf(word); if (i >= 0) { el.focus(); const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + word.length); getSelection().removeAllRanges(); getSelection().addRange(r); return true; } }
    return false;
  },
  press(sel) { const b = typeof sel === 'string' ? document.querySelector(sel) : sel; b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); b.click(); return true; },
  menuClick(label) { const b = [...document.querySelectorAll('#menu .m-item')].find(x => x.textContent.includes(label)); if (!b) return false; b.click(); return true; },
  docxEl: (t, exact) => [...document.querySelectorAll('.docx-editable')].find(e => exact ? e.textContent.trim() === t : e.textContent.includes(t)),
  pdfPoint(page, x, y) { const pg = __lern.S.bin.ed.pages[page - 1]; const [vx, vy] = pg.vp.convertToViewportPoint(x, y); const r = pg.box.getBoundingClientRect(); return [r.left + vx, r.top + vy]; },
  scrollToPdf(page, y) {
    const pg = __lern.S.bin.ed.pages[page - 1]; const v = document.getElementById('view');
    const [, vy] = pg.vp.convertToViewportPoint(0, y); const b = pg.box.getBoundingClientRect(); const vr = v.getBoundingClientRect();
    v.scrollTop += (b.top + vy) - (vr.top + vr.height / 2); return true;
  },
  pixels(page, x1, y1, x2, y2) {
    const pg = __lern.S.bin.ed.pages[page - 1]; const ratio = devicePixelRatio || 1;
    const [ax, ay] = pg.vp.convertToViewportPoint(x1, y1); const [bx, by] = pg.vp.convertToViewportPoint(x2, y2);
    const X = Math.round(Math.min(ax, bx) * ratio), Y = Math.round(Math.min(ay, by) * ratio), W = Math.max(1, Math.round(Math.abs(bx - ax) * ratio)), H = Math.max(1, Math.round(Math.abs(by - ay) * ratio));
    const d = pg.canvas.getContext('2d').getImageData(X, Y, W, H).data;
    let dark = 0, yellow = 0, red = 0, white = 0;
    for (let i = 0; i < d.length; i += 4) { const [r, g, b] = [d[i], d[i + 1], d[i + 2]]; if (r + g + b < 300) dark++; if (r > 235 && g > 220 && b < 200) yellow++; if (r > 150 && g < 90 && b < 90) red++; if (r > 245 && g > 245 && b > 245) white++; }
    return { dark, yellow, red, white, total: d.length / 4 };
  },
};
true;`;

// ================== Testablauf ==================
const results = [];
async function scenario(group, name, fn) {
  if (ONLY && !ONLY.split(',').some(o => (group + ' ' + name).toLowerCase().includes(o.trim()))) return;
  current = { group, name, ok: false, detail: '', ms: 0, shots: [] };
  const t0 = Date.now();
  try {
    const d = await fn();
    current.ok = true; current.detail = d || '';
  } catch (e) {
    current.detail = e.message;
    try { await shot('Zustand beim Fehler'); } catch {}
  }
  current.ms = Date.now() - t0;
  results.push(current);
  console.log(`${current.ok ? '✓' : '✗'} [${group}] ${name}${current.ok ? '' : '  →  ' + current.detail}`);
  current = null;
}

async function openFolderMenu(minItems = 3) {
  await js(`const m = document.getElementById('menu'); m.innerHTML = ''; m.hidden = true; document.getElementById('homeBtn').click(); true`);
  await waitJs(`!document.getElementById('menu').hidden && document.querySelectorAll('#menu .m-item').length >= ${minItems}`, 5000, 'Ordner-Menü öffnet nicht');
}

async function openNote(file, content) {
  if (content !== undefined) fs.writeFileSync(P(file), content);
  await nav(file);
  await waitJs(`!!(__lern.S.doc && __lern.S.doc.path === ${JSON.stringify(file.replace(/\\/g, '/'))} && document.querySelector('.editor .block'))`);
  await js(`document.querySelector('.add-below').click(); true`);
}
const fileHas = (file, ...parts) => until(() => { const t = read(file); return parts.every(p => t.includes(p)) && t; }, 5000, `Datei ${file} enthält nicht: ${parts.join(' | ')}`);

async function docxXml(file) { const zip = await JSZip.loadAsync(fs.readFileSync(P(file))); return zip.file('word/document.xml').async('string'); }
async function openDocx(file) {
  await nav(file);
  await waitJs(`!!(__lern.S.bin && __lern.S.bin.path === ${JSON.stringify(file)} && document.querySelector('.docx-editable'))`, 12000);
  await js(`if (!__lern.S.docxEditing) document.querySelector('[data-edit]').click(); true`);
}
async function saveBin() {
  await js(`document.querySelector('[data-save]').click(); true`);
  await waitJs(`!__lern.S.bin.saving && !__lern.S.bin.dirty`, 10000, 'Speichern wurde nicht fertig');
  await sleep(300);
}
async function openPdf(file) {
  await nav(file);
  await waitJs(`!!(__lern.S.bin && __lern.S.bin.path === ${JSON.stringify(file)} && __lern.S.bin.ed.pages && __lern.S.bin.ed.pages[0].box.classList.contains('ready'))`, 12000);
}
async function pdfReady(page, y) {
  await js(`__lern.S.bin.ed.pages[${page - 1}].box.scrollIntoView({ block: 'center' }); true`);
  await waitJs(`__lern.S.bin.ed.pages[${page - 1}].box.classList.contains('ready')`, 8000);
  if (y !== undefined) await js(`T.scrollToPdf(${page}, ${y})`);
  await sleep(250);
}
async function pdfText(file, pageNo) {
  return js(`(async () => { const d = await pdfjsLib.getDocument({ data: new Uint8Array(await (await fetch('/raw?path=' + encodeURIComponent(${JSON.stringify(file)}) + '&t=' + Date.now())).arrayBuffer()) }).promise;
    const out = []; for (let i = 1; i <= d.numPages; i++) { if (${pageNo || 0} && i !== ${pageNo || 0}) continue; const p = await d.getPage(i); out.push((await p.getTextContent()).items.map(x => x.str).join(' ')); } return out.join(' \\n '); })()`);
}

function wordValidate(files) {
  const ps = `[Console]::OutputEncoding = [Text.Encoding]::UTF8; $ErrorActionPreference='Stop'; $out=@(); $w=$null
$files = '${JSON.stringify(files).replace(/'/g, "''")}' | ConvertFrom-Json
try { $w = New-Object -ComObject Word.Application } catch { '[]'; exit }
$w.Visible=$false; $w.DisplayAlerts=0
foreach ($f in $files) {
  try { $d=$w.Documents.Open($f, $false, $true, $false); $out += @{ file=$f; ok=$true; text=$d.Content.Text; tables=$d.Tables.Count; paragraphs=$d.Paragraphs.Count }; $d.Close(0) }
  catch { $out += @{ file=$f; ok=$false; error=$_.Exception.Message } }
}
$w.Quit(); ConvertTo-Json -InputObject $out -Depth 3 -Compress`;
  const tmp = path.join(ROOT, '..', `word-check-${STAMP}.ps1`);
  fs.writeFileSync(tmp, '\ufeff' + ps, 'utf8');
  try { const r = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmp], { encoding: 'utf8', timeout: 180000 }); const j = JSON.parse(r.trim() || '[]'); return Array.isArray(j) ? j : [j]; }
  finally { fs.rmSync(tmp, { force: true }); }
}

async function run() {
  console.log('Testordner:', ROOT);
  fs.rmSync(REPORT, { recursive: true, force: true }); fs.mkdirSync(IMG, { recursive: true });
  await setupFixtures();
  const env = { ...process.env, LERN_ROOT: ROOT, LERN_PORT: String(PORT), LERN_BACKUP_DIR: BACKUPS, LERN_PICK_RESULT: ROOT2, LERN_DATA: path.join(ROOT, '..', 'lernplattform-test-daten-' + STAMP) };
  if (EXE) console.log('Teste die EXE:', EXE);
  const server = EXE ? spawn(EXE, ['--no-open'], { env, stdio: 'ignore' }) : spawn(process.execPath, [path.join(APP, 'server.js'), '--no-open'], { env, stdio: 'ignore' });
  await until(() => fetch(BASE + '/api/info').then(r => r.ok).catch(() => false), 8000, 'Server startet nicht');
  const profile = path.join(os.tmpdir(), 'lernplattform-test-edge-' + STAMP);
  const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9399', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  const targets = await until(() => fetch('http://127.0.0.1:9399/json/list').then(r => r.json()).then(t => t.find(x => x.type === 'page')).catch(() => null), 15000, 'Edge startet nicht');
  ws = new WebSocket(targets.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id).res(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') jsErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true });
  });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Browser.grantPermissions', { origin: BASE, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 920, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await send('Page.navigate', { url: BASE + '/#/' });
  await until(() => js('!!(window.__lern && document.querySelector(".hero"))'), 10000, 'App lädt nicht');
  await js(PAGE_HELPERS);
  const t0 = Date.now();

  // ------------------------------------------------ Allgemein / Sync
  await scenario('Allgemein', 'App startet, Live-Verbindung zum Ordner steht', async () => {
    await waitJs(`document.getElementById('syncState').classList.contains('on')`);
    await shot('Startseite');
    return 'Status: ' + await js(`document.getElementById('syncState').textContent`);
  });

  // ------------------------------------------------ Seiten (Notizen)
  await scenario('Seiten', 'Neue Seite über „Neue Seite“ anlegen und Titel = Dateiname', async () => {
    await nav('');
    await waitJs(`!!document.querySelector('[data-a=page]')`);
    await js(`document.querySelector('[data-a=page]').click(); true`);
    await waitJs(`document.activeElement && document.activeElement.classList.contains('page-title')`);
    await type('Testseite Notizen'); await key('Enter');
    await until(() => exists('Testseite Notizen.md'), 5000, 'Datei wurde nicht umbenannt');
    expect(!exists('Unbenannt.md'), 'Unbenannt.md blieb zurück');
    return 'Datei „Testseite Notizen.md“ angelegt';
  });

  await scenario('Seiten', 'Alle Blocktypen per Markdown-Kürzel', async () => {
    await openNote('Notizen/Blocktypen.md', '');
    await type('# Überschrift eins\nText darunter\n## Unterüberschrift\n- Punkt A\nPunkt B\n\n1. Eins\nZwei\n\n[] Aufgabe offen\n\n> Ein Zitat\n!! Wichtiger Hinweis\n---');
    await type('```'); await type('let x = 1;'); await key('Escape'); await type('Ende');
    const t = await fileHas('Notizen/Blocktypen.md', '# Überschrift eins', '## Unterüberschrift', '- Punkt A\n- Punkt B', '1. Eins\n2. Zwei', '- [ ] Aufgabe offen', '> Ein Zitat', '> [!NOTE] 💡 Wichtiger Hinweis', '\n---\n', '```\nlet x = 1;\n```', 'Ende');
    await js(`window.scrollTo(0,0); document.querySelector('.view').scrollTop = 0; true`);
    await shot('Seite mit allen Blocktypen');
    return t.split('\n').length + ' Zeilen Markdown erzeugt';
  });

  await scenario('Seiten', 'Slash-Menü: filtern und Block einfügen', async () => {
    await openNote('Notizen/Slash.md', '');
    await type('/num');
    await waitJs(`!document.getElementById('menu').hidden`);
    const first = await js(`document.querySelector('#menu .m-item.sel').textContent`);
    expect(first.includes('Nummerierte Liste'), 'Erster Treffer war: ' + first);
    await shot('Slash-Menü mit Filter „num“');
    await key('Enter'); await type('Erster Punkt');
    await fileHas('Notizen/Slash.md', '1. Erster Punkt');
    return 'Filter „num“ → ' + first.trim();
  });

  await scenario('Seiten', 'Fett, kursiv, Code, Markierung und Link über die Formatierungsleiste', async () => {
    await openNote('Notizen/Format.md', '');
    await type('fett kursiv code mark link');
    const el = `T.blockWith('fett kursiv').querySelector('.content')`;
    for (const [word, title] of [['fett', 'Fett'], ['kursiv', 'Kursiv'], ['code', 'Code'], ['mark', 'Markieren']]) {
      await js(`T.selectText(${el}, '${word}'); true`); await sleep(80);
      await js(`T.press([...document.querySelectorAll('.toolbar button')].find(b => b.title.startsWith('${title}'))); true`);
    }
    await js(`T.selectText(${el}, 'link'); document.execCommand('createLink', false, 'https://example.org'); __lern.S.editor.changed(); true`);
    await js(`T.selectText(${el}, 'fett'); true`); await sleep(200);
    await shot('Formatierungsleiste über markiertem Text');
    const t = await fileHas('Notizen/Format.md', '**fett**', '*kursiv*', '`code`', '==mark==', '[link](https://example.org)');
    return t.trim();
  });

  await scenario('Seiten', 'Tabelle: anlegen, mit Tab ausfüllen, Zeile und Spalte hinzufügen', async () => {
    await openNote('Notizen/Tabelle.md', '');
    await type('/tabelle'); await waitJs(`!document.getElementById('menu').hidden`); await key('Enter');
    await waitJs(`!!document.querySelector('.b-table td')`);
    for (const [i, v] of ['Fach', 'Note', 'Lehrer', 'Mathe', '1', 'Herr Meier', 'Englisch', '2', 'Frau Kurz'].entries()) { if (i) await key('Tab'); await type(v); }
    await key('Tab'); await type('Ethik');
    await js(`const td = document.querySelectorAll('.b-table td')[1]; td.focus(); Caret.set(td, null); T.press(document.querySelector('.table-tools [data-x=col]')); true`); await type('Raum');
    await fileHas('Notizen/Tabelle.md', '| Fach | Note | Raum | Lehrer |', '| --- | --- | --- | --- |', '| Mathe | 1 |  | Herr Meier |', '| Ethik |');
    await nav(''); await openNote('Notizen/Tabelle.md');
    const cells = await js(`document.querySelectorAll('.b-table td').length`);
    expect(cells === 16, 'Nach dem Neuladen ' + cells + ' Zellen statt 16');
    await js(`document.querySelector('.b-table td').focus(); true`);
    await shot('Tabelle in einer Seite');
    return '4 Zeilen × 4 Spalten gespeichert und wieder geladen';
  });

  await scenario('Seiten', 'Rückgängig (Strg+Z) und Wiederholen (Strg+Y) – auch für Blöcke', async () => {
    await openNote('Notizen/Undo.md', 'Erster Absatz\n');
    await type('Zweiter Absatz'); await sleep(600);
    await key('Enter'); await type('Dritter'); await sleep(600);
    await key('z', 2); await sleep(200);
    const afterUndo = await js(`__lern.S.editor.getData().map(b => b.md).join('|')`);
    expect(!afterUndo.includes('Dritter'), 'Nach Strg+Z noch da: ' + afterUndo);
    await key('z', 2); await sleep(200);
    const afterUndo2 = await js(`__lern.S.editor.getData().map(b => b.md).join('|')`);
    await key('y', 2); await key('y', 2); await sleep(200);
    const afterRedo = await js(`__lern.S.editor.getData().map(b => b.md).join('|')`);
    expect(afterRedo.includes('Dritter'), 'Nach Strg+Y fehlt „Dritter“: ' + afterRedo);
    await fileHas('Notizen/Undo.md', 'Dritter');
    return `Rückgängig: „${afterUndo}“ → „${afterUndo2}“ · Wiederholen: „${afterRedo}“`;
  });

  await scenario('Seiten', 'Enter teilt, Rücktaste verbindet, Tab rückt Listen ein', async () => {
    await openNote('Notizen/Struktur.md', '');
    await type('AnfangEnde');
    for (let i = 0; i < 4; i++) await key('ArrowLeft');
    await key('Enter');
    await fileHas('Notizen/Struktur.md', 'Anfang\n\nEnde');
    await key('Backspace');
    await fileHas('Notizen/Struktur.md', 'AnfangEnde');
    await js(`document.querySelector('.add-below').click(); true`);
    await type('- Oben\nUnten'); await key('Tab');
    await fileHas('Notizen/Struktur.md', '- Oben\n  - Unten');
    return 'Teilen, Verbinden und Einrücken gespeichert';
  });

  await scenario('Seiten', 'Bild per Strg+V einfügen und Größe ändern', async () => {
    await openNote('Notizen/Bild.md', 'Bild folgt:\n');
    await js(`(async () => { const c = document.createElement('canvas'); c.width = 400; c.height = 200; const g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 400, 200); gr.addColorStop(0, '#667eea'); gr.addColorStop(1, '#f6d365'); g.fillStyle = gr; g.fillRect(0, 0, 400, 200);
      g.fillStyle = '#fff'; g.font = 'bold 32px Segoe UI'; g.fillText('Testbild', 130, 110);
      const blob = await new Promise(r => c.toBlob(r, 'image/png')); const dt = new DataTransfer(); dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
      document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return true; })()`);
    await waitJs(`!!document.querySelector('.b-image img')`, 6000);
    await js(`T.press(document.querySelector('.b-image [data-w="50%"]')); true`);
    const t = await fileHas('Notizen/Bild.md', '![](Bilder/Bild-', '"width=50%"');
    const imgs = fs.readdirSync(P('Notizen', 'Bilder'));
    expect(imgs.length === 1, 'Bilder-Ordner: ' + imgs.join(', '));
    await shot('Eingefügtes Bild (50 % Breite)');
    return t.split('\n').find(l => l.startsWith('![')) + ' · Datei: Notizen/Bilder/' + imgs[0];
  });

  await scenario('Seiten', 'Block über das ⋮⋮-Menü nach unten verschieben', async () => {
    await openNote('Notizen/Verschieben.md', 'Block A\n\nBlock B\n\nBlock C\n');
    await js(`T.blockWith('Block A').querySelector('.drag').click(); true`);
    await waitJs(`!document.getElementById('menu').hidden`);
    await js(`T.menuClick('Nach unten')`);
    await fileHas('Notizen/Verschieben.md', 'Block B\n\nBlock A\n\nBlock C');
    return 'Neue Reihenfolge: B, A, C';
  });

  await scenario('Seiten', 'Symbol (Emoji) und Titelbild setzen', async () => {
    await openNote('Notizen/Deko.md', 'Inhalt\n');
    await js(`document.querySelector('[data-a=icon]').click(); true`);
    await waitJs(`!!document.querySelector('.emoji-grid button')`);
    await js(`document.querySelectorAll('.emoji-grid button')[2].click(); document.querySelector('[data-a=addcover]').click(); true`);
    const t = await fileHas('Notizen/Deko.md', 'icon: ', 'cover: gradient:');
    await js(`document.querySelector('.view').scrollTop = 0; true`);
    await shot('Seite mit Symbol und Titelbild');
    return t.split('\n').slice(0, 4).join(' ');
  });

  await scenario('Seiten', 'Änderung im Ordner (außerhalb der App) erscheint sofort', async () => {
    await openNote('Notizen/Extern.md', 'Original\n');
    fs.appendFileSync(P('Notizen', 'Extern.md'), '\nVon außen hinzugefügt\n');
    await waitJs(`[...document.querySelectorAll('.editor .content')].some(e => e.textContent.includes('Von außen hinzugefügt'))`, 5000);
    return 'Editor hat sich automatisch aktualisiert';
  });

  await scenario('Seiten', 'Konflikt: außen geändert während ungespeicherter Eingabe → Nachfrage', async () => {
    await openNote('Notizen/Konflikt.md', 'Start\n');
    await type('Meine Eingabe');
    fs.writeFileSync(P('Notizen', 'Konflikt.md'), 'Start\n\nFremde Änderung\n');
    await waitJs(`!document.getElementById('banner').hidden`, 5000, 'Keine Nachfrage angezeigt');
    await shot('Nachfrage bei Konflikt');
    await js(`[...document.querySelectorAll('#banner button')].find(b => b.textContent.includes('Meine Version')).click(); true`);
    await fileHas('Notizen/Konflikt.md', 'Meine Eingabe');
    return 'Banner erschienen, „Meine Version behalten“ gespeichert';
  });

  await scenario('Seiten', 'Fremde Markdown-Datei wird beim bloßen Öffnen nicht verändert', async () => {
    const before = read('Notizen/Fremd.md');
    await openNote('Notizen/Fremd.md');
    await sleep(2000);
    expect(read('Notizen/Fremd.md') === before, 'Datei wurde verändert');
    return 'Tabellen, HTML und Fußnoten bleiben Byte für Byte erhalten';
  });

  await scenario('Seiten', 'Markdown hin und zurück (15 Muster)', async () => {
    const samples = ['# Titel', '## Zwei\n\n### Drei', 'Text **fett** *kursiv* `code` ~~weg~~ ==mark== [Link](https://x.de)', '- a\n- b\n  - c\n    - d', '1. eins\n2. zwei\n   1. innen', '- [ ] offen\n- [x] erledigt',
      '> Zitat\n> zweite Zeile', '> [!NOTE] ⚠️ Achtung', '```js\nconst a = 1;\n\nlet b;\n```', '---', '![Bild](Bilder/a.png "width=50%")', '| A | B |\n| --- | --- |\n| 1 | 2 \\| 3 |', 'Absatz eins\n\nAbsatz zwei', 'Umlaute äöü ß € → 😀', '---\nicon: 📘\ncover: gradient:3\n---\n\nMit Kopf'];
    const bad = await js(`(() => { const bad = []; for (const s of ${JSON.stringify(samples)}) {
      const p = MD.parse(s); const tmp = document.createElement('div');
      const blocks = p.blocks.map(b => { const d = { ...b }; if (b.html !== undefined) { tmp.innerHTML = b.html; d.md = MD.htmlToInline(tmp); }
        if (b.rows) d.rows = b.rows.map(r => r.map(c => { tmp.innerHTML = c; return MD.htmlToInline(tmp); })); return d; });
      const out = MD.serialize(p.meta, p.extra, blocks).trim(); if (out !== s.trim()) bad.push(s + '  ⇒  ' + out); } return bad; })()`);
    expect(!bad.length, bad.join(' ‖ '));
    return samples.length + ' Muster identisch';
  });

  // ------------------------------------------------ Dateien & Ordner
  await scenario('Dateien', 'Neuen Ordner anlegen (Dialog)', async () => {
    await nav(''); await waitJs(`!!document.querySelector('[data-a=folder]')`);
    await js(`document.querySelector('[data-a=folder]').click(); true`);
    await waitJs(`!!document.querySelector('#menu input')`);
    await shot('Dialog „Neuer Ordner“');
    await js(`const i = document.querySelector('#menu input'); i.value = 'Testordner'; document.querySelector('#menu [data-ok]').click(); true`);
    await until(() => exists('Testordner'), 4000, 'Ordner fehlt');
    return 'Ordner „Testordner“ angelegt';
  });

  await scenario('Dateien', 'Ordner per Rechtsklick umbenennen', async () => {
    await waitJs(`!!document.querySelector('#tree .row[data-path="Testordner"]')`);
    await js(`const r = document.querySelector('#tree .row[data-path="Testordner"]').getBoundingClientRect(); document.querySelector('#tree .row[data-path="Testordner"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 40, clientY: r.top + 10 })); true`);
    await shot('Kontextmenü im Ordnerbaum');
    await js(`T.menuClick('Umbenennen')`);
    await waitJs(`!!document.querySelector('#menu input')`);
    await js(`document.querySelector('#menu input').value = 'Testordner neu'; document.querySelector('#menu [data-ok]').click(); true`);
    await until(() => exists('Testordner neu') && !exists('Testordner'), 4000, 'nicht umbenannt');
    return '„Testordner“ → „Testordner neu“';
  });

  await scenario('Dateien', 'Datei per Drag & Drop in einen Ordner verschieben', async () => {
    fs.writeFileSync(P('Verschieb mich.txt'), 'Hallo');
    await waitJs(`!!document.querySelector('#tree .row[data-path="Verschieb mich.txt"]')`, 5000);
    await js(`const dt = new DataTransfer(); dt.setData('text/x-lern-path', 'Verschieb mich.txt'); const row = document.querySelector('#tree .row[data-path="Testordner neu"]');
      row.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); row.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); true`);
    await until(() => exists('Testordner neu/Verschieb mich.txt'), 4000, 'nicht verschoben');
    return 'Verschoben nach „Testordner neu“';
  });

  await scenario('Dateien', 'Dateien vom PC in die Ordneransicht ziehen (Hochladen)', async () => {
    await nav('Testordner neu'); await waitJs(`!!document.querySelector('.folder-head')`);
    await js(`const dt = new DataTransfer(); dt.items.add(new File(['Inhalt A'], 'Hochgeladen A.txt', { type: 'text/plain' })); dt.items.add(new File(['Inhalt B'], 'Hochgeladen B.txt', { type: 'text/plain' }));
      const v = document.getElementById('view'); v.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); v.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); true`);
    await until(() => exists('Testordner neu/Hochgeladen A.txt') && exists('Testordner neu/Hochgeladen B.txt'), 5000, 'nicht hochgeladen');
    await waitJs(`document.querySelectorAll('.card').length >= 3`, 5000);
    await shot('Ordneransicht nach dem Hochladen');
    return '2 Dateien hochgeladen und angezeigt';
  });

  await scenario('Dateien', 'Suche findet Dateien in Unterordnern', async () => {
    await js(`const s = document.getElementById('searchInput'); s.value = 'hochgeladen'; s.dispatchEvent(new Event('input')); true`);
    await waitJs(`document.querySelectorAll('#searchResults .row').length >= 2`, 4000);
    const n = await js(`document.querySelectorAll('#searchResults .row').length`);
    await shot('Suchergebnisse');
    await js(`const s = document.getElementById('searchInput'); s.value = ''; s.dispatchEvent(new Event('input')); true`);
    return n + ' Treffer für „hochgeladen“';
  });

  await scenario('Dateien', 'Außen angelegte und gelöschte Dateien erscheinen/verschwinden im Baum', async () => {
    fs.writeFileSync(P('Extern neu.md'), '# extern');
    await waitJs(`!!document.querySelector('#tree .row[data-path="Extern neu.md"]')`, 5000, 'erscheint nicht');
    fs.rmSync(P('Extern neu.md'));
    await waitJs(`!document.querySelector('#tree .row[data-path="Extern neu.md"]')`, 5000, 'verschwindet nicht');
    return 'Baum folgt dem Ordner live';
  });

  await scenario('Dateien', 'Code-Datei (.cs) bearbeiten und automatisch speichern', async () => {
    await nav('Dateien/Programm.cs'); await waitJs(`!!document.querySelector('.text-view textarea')`);
    await js(`const t = document.querySelector('.text-view textarea'); t.focus(); t.setSelectionRange(t.value.length, t.value.length); true`);
    await type('// geändert in der App');
    await fileHas('Dateien/Programm.cs', '// geändert in der App');
    fs.appendFileSync(P('Dateien', 'Programm.cs'), '\n// von außen');
    await waitJs(`document.querySelector('.text-view textarea').value.includes('// von außen')`, 5000, 'Textfeld nicht aktualisiert');
    await shot('Code-Datei im Editor');
    return 'Speichern und Aktualisieren in beide Richtungen';
  });

  await scenario('Dateien', 'HTML-Datei als Vorschau: CSS, Bild und Skript werden geladen', async () => {
    await js(`if (!window.__msgsInit) { window.__msgsInit = true; window.__msgs = []; addEventListener('message', e => { if (e.data && e.data.lern) __msgs.push(e.data); }); } __msgs.length = 0; localStorage.setItem('lern.htmlMode', '"preview"'); true`);
    await nav('Web/index.html');
    await waitJs(`!!document.querySelector('.html-frame')`, 6000, 'keine Vorschau');
    const m = await waitJs(`__msgs.length ? __msgs[__msgs.length - 1] : null`, 8000, 'Skript in der Vorschau lief nicht');
    expect(m.h1 === 'Hallo HTML', 'Überschrift: ' + m.h1);
    expect(m.color === 'rgb(200, 0, 0)', 'CSS nicht geladen, Farbe: ' + m.color);
    expect(m.img > 0, 'Bild nicht geladen');
    await sleep(300);
    await shot('HTML-Vorschau');
    return `Skript lief · CSS aktiv (${m.color}) · Bild geladen (${m.img} px)`;
  });

  await scenario('Dateien', 'HTML-Skripte sind abgeschottet (kein Zugriff auf deine Dateien)', async () => {
    const m = await js(`__msgs[__msgs.length - 1]`);
    expect(m.api === 'blockiert', 'Zugriff auf die App war möglich: ' + m.api);
    const csp = await js(`fetch('/files/Web/index.html').then(r => r.headers.get('content-security-policy'))`);
    expect(/sandbox/.test(csp || ''), 'Direktaufruf ohne Sandbox: ' + csp);
    return 'Zugriff auf /api blockiert · auch „Im Browser öffnen“ läuft in der Sandbox';
  });

  await scenario('Dateien', 'HTML geteilt: Code ändern → Vorschau folgt live, Datei wird gespeichert', async () => {
    await js(`document.querySelector('[data-m=split]').click(); true`);
    await js(`const t = document.querySelector('.html-panes textarea'); t.focus(); t.value = t.value.replace('Hallo HTML', 'Live geändert'); t.dispatchEvent(new Event('input', { bubbles: true })); true`);
    await waitJs(`__msgs.some(m => m.h1 === 'Live geändert')`, 6000, 'Vorschau nicht aktualisiert');
    await fileHas('Web/index.html', 'Live geändert');
    await sleep(300);
    await shot('HTML: Code und Vorschau nebeneinander');
    await js(`document.querySelector('[data-m=preview]').click(); true`);
    return 'Vorschau aktualisiert und Datei gespeichert';
  });

  await scenario('Dateien', 'Unbekannte Endung mit Text → Editor, Binärdatei → Infokarte', async () => {
    await nav('Dateien/notizen.wt'); await waitJs(`!!document.querySelector('.text-view textarea')`, 5000, '.wt nicht als Text erkannt');
    await nav('Dateien/daten.bin'); await waitJs(`!!document.querySelector('.other-view')`, 5000, '.bin nicht als Binärdatei erkannt');
    await shot('Binärdatei: Infokarte mit „Öffnen mit …“');
    return '.wt → Texteditor · .bin → Infokarte';
  });

  await scenario('Dateien', 'Vorschau: Excel, PowerPoint', async () => {
    await nav('Dateien/Noten.xlsx'); await waitJs(`!!document.querySelector('.sheet-view table')`, 8000);
    const cells = await js(`document.querySelector('.sheet-view').textContent.includes('Mathe')`);
    expect(cells, 'Excel-Inhalt fehlt');
    await shot('Excel-Vorschau');
    let ppt = 'keine PowerPoint-Datei vorhanden';
    if (exists('Dateien/Praesentation.pptx')) {
      await nav('Dateien/Praesentation.pptx'); await waitJs(`!!document.querySelector('.slide-card')`, 8000);
      ppt = (await js(`document.querySelectorAll('.slide-card').length`)) + ' Folien';
    }
    return 'Excel ok · PowerPoint: ' + ppt;
  });

  await scenario('Dateien', 'Neue Word-, Excel- und PowerPoint-Dokumente aus Vorlagen', async () => {
    const r = await js(`Promise.all(['.docx', '.xlsx', '.pptx'].map(e => fetch('/api/newdoc?dir=Dateien&name=Neu&ext=' + e, { method: 'POST' }).then(r => r.json())))`);
    expect(r.every(x => x.ok), JSON.stringify(r));
    expect(exists('Dateien/Neu.docx') && exists('Dateien/Neu.xlsx') && exists('Dateien/Neu.pptx'), 'Dateien fehlen');
    return r.map(x => x.name + ' (' + fs.statSync(P(x.path)).size + ' B)').join(', ');
  });

  await scenario('Dateien', 'Löschen verschiebt in den Papierkorb', async () => {
    fs.writeFileSync(P('Loesch mich.txt'), 'weg');
    await waitJs(`!!document.querySelector('#tree .row[data-path="Loesch mich.txt"]')`, 5000);
    await js(`const row = document.querySelector('#tree .row[data-path="Loesch mich.txt"]'); row.querySelector('[data-a=more]').click(); true`);
    await js(`T.menuClick('Papierkorb')`);
    await until(() => !exists('Loesch mich.txt'), 8000, 'nicht gelöscht');
    return 'Datei im Windows-Papierkorb';
  });

  // ------------------------------------------------ Word
  const AB = 'Word/Arbeitsblatt.docx';
  await scenario('Word', 'Alle Absätze und Tabellenzellen sind bearbeitbar', async () => {
    await openDocx(AB);
    const [ok, locked] = await js(`[document.querySelectorAll('.docx-editable').length, document.querySelectorAll('.docx-locked').length]`);
    expect(ok >= 11 && locked === 0, `${ok} bearbeitbar, ${locked} gesperrt`);
    await shot('Word-Dokument im Bearbeiten-Modus');
    return `${ok} bearbeitbar, ${locked} gesperrt`;
  });

  await scenario('Word', 'In leere Tabellenzelle schreiben und Zelle leeren', async () => {
    await js(`const cells = [...document.querySelectorAll('td .docx-editable')]; Caret.set(cells[3], 0); true`);
    await type('Verbindet Geräte im LAN');
    await js(`const el = T.docxEl('Adresse', true); el.focus(); const r = document.createRange(); r.selectNodeContents(el); getSelection().removeAllRanges(); getSelection().addRange(r); true`);
    await key('Backspace');
    await saveBin();
    const x = await docxXml(AB);
    expect(x.includes('Verbindet Geräte im LAN'), 'Text fehlt im XML');
    expect(!x.includes('>Adresse<'), '„Adresse“ noch vorhanden');
    return 'Zelle beschrieben, andere Zelle geleert';
  });

  await scenario('Word', 'Enter teilt einen Absatz, Rücktaste verbindet ihn wieder', async () => {
    await js(`Caret.set(T.docxEl('Beantworte die Fragen'), 'Beantworte '.length); true`);
    await key('Enter');
    await saveBin();
    let x = await docxXml(AB);
    expect(/>Beantworte <\/w:t>/.test(x) && x.includes('>die Fragen in der Tabelle.<'), 'Absatz nicht geteilt');
    await js(`Caret.set(T.docxEl('die Fragen in der Tabelle.'), 0); true`);
    await key('Backspace');
    await saveBin();
    x = await docxXml(AB);
    const joined = x.replace(/<[^>]+>/g, '');
    expect(joined.includes('Beantworte die Fragen in der Tabelle.'), 'nicht wieder verbunden');
    return 'geteilt → gespeichert → verbunden → gespeichert';
  });

  await scenario('Word', 'Fett, kursiv, unterstrichen, Farbe, Markieren', async () => {
    await js(`T.selectText(T.docxEl('Ende des Arbeitsblatts'), 'Ende'); true`);
    for (const f of ['b', 'i', 'u']) await js(`T.press('[data-f=${f}]')`);
    await js(`T.press('[data-menu=color]')`); await js(`T.menuClick('Rot')`);
    await js(`T.selectText(T.docxEl('Ende des Arbeitsblatts'), 'Ende'); T.press('[data-menu=hl]')`); await js(`T.menuClick('Gelb')`);
    await js(`T.selectText(T.docxEl('Ende des Arbeitsblatts'), 'Ende'); true`); await sleep(100);
    await shot('Formatierung in Word');
    await saveBin();
    const x = await docxXml(AB);
    const run = /<w:r><w:rPr>((?:(?!<\/w:rPr>).)*)<\/w:rPr><w:t[^>]*>Ende<\/w:t><\/w:r>/.exec(x);
    expect(run, 'Lauf „Ende“ nicht gefunden');
    const tags = [...run[1].matchAll(/<w:(\w+)/g)].map(m => m[1]);
    for (const t of ['b', 'i', 'color', 'highlight', 'u']) expect(tags.includes(t), 'fehlt: w:' + t);
    const ORDER = ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'outline', 'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u'];
    const idx = tags.map(t => ORDER.indexOf(t));
    expect(idx.every((v, i) => !i || v > idx[i - 1]), 'falsche Reihenfolge: ' + tags.join(','));
    expect(/> des Arbeitsblatts\.</.test(x), 'Resttext falsch getrennt');
    return 'w:rPr = ' + tags.join(' → ') + ' (Schema-Reihenfolge korrekt)';
  });

  await scenario('Word', 'Tabellenzeile einfügen, ausfüllen und wieder löschen', async () => {
    await js(`Caret.set(T.docxEl('Was ist ein Router?'), 0); T.press('[data-row=add]')`);
    await type('Was ist DNS?'); await key('Tab'); await type('Namensauflösung');
    await saveBin();
    let x = await docxXml(AB);
    expect((x.match(/<w:tr>/g) || []).length === 5 && x.includes('Namensauflösung'), 'Zeile fehlt');
    await shot('Neue Tabellenzeile');
    await js(`Caret.set(T.docxEl('Was ist DNS?'), 0); T.press('[data-row=del]')`);
    await saveBin();
    x = await docxXml(AB);
    expect((x.match(/<w:tr>/g) || []).length === 4 && !x.includes('Namensauflösung'), 'Zeile nicht gelöscht');
    return '4 → 5 → 4 Zeilen';
  });

  await scenario('Word', 'Umlaute, Sonderzeichen und Emoji', async () => {
    await js(`Caret.set(T.docxEl('Name:'), null); true`);
    await type(' äöüß € → 😀');
    await saveBin();
    expect((await docxXml(AB)).includes('äöüß € → 😀'), 'Zeichen fehlen');
    return 'äöüß € → 😀 gespeichert';
  });

  await scenario('Word', 'Datei in einem anderen Programm gesperrt → verständliche Meldung, danach klappt es', async () => {
    const lock = spawn('powershell.exe', ['-NoProfile', '-Command', `$f=[IO.File]::Open('${P(AB).replace(/'/g, "''")}','Open','ReadWrite','None'); Start-Sleep -Seconds 6; $f.Close()`], { stdio: 'ignore' });
    await sleep(1800);
    await js(`Caret.set(T.docxEl('Ende des Arbeitsblatts'), null); true`); await type('!');
    await js(`document.querySelector('[data-save]').click(); true`);
    await waitJs(`document.getElementById('saveState').textContent.includes('Nicht gespeichert')`, 6000, 'keine Fehlermeldung');
    const toast = await js(`document.getElementById('toast').textContent`);
    await shot('Meldung: Datei gesperrt');
    await new Promise(r => lock.on('exit', r));
    await saveBin();
    expect((await docxXml(AB)).includes('Arbeitsblatts.!'), 'nach Entsperren nicht gespeichert');
    return 'Meldung: „' + toast + '“';
  });

  await scenario('Word', 'Außen geändert bei ungespeicherten Änderungen → Nachfrage', async () => {
    await js(`Caret.set(T.docxEl('Ende des Arbeitsblatts'), null); true`); await type('?');
    const buf = fs.readFileSync(P(AB)); fs.writeFileSync(P(AB), Buffer.concat([buf, Buffer.from([0])]));   // wie eine Speicherung in Word: andere Datei
    await waitJs(`!document.getElementById('banner').hidden`, 6000, 'keine Nachfrage');
    await js(`[...document.querySelectorAll('#banner button')].find(b => b.textContent.includes('speichern')).click(); true`);
    await waitJs(`!__lern.S.bin.dirty && !__lern.S.bin.saving`, 8000);
    expect((await docxXml(AB)).includes('Arbeitsblatts.!?'), 'eigene Änderung verloren');
    return 'Nachfrage erschienen, eigene Änderung gespeichert';
  });

  await scenario('Word', 'Werkzeugleiste bleibt beim Scrollen sichtbar', async () => {
    const Q = exists('Word/Quiz (echte Datei).docx') ? 'Word/Quiz (echte Datei).docx' : AB;
    await openDocx(Q);
    await js(`const v = document.getElementById('view'); v.scrollTop = v.scrollHeight; true`); await sleep(300);
    const r = await js(`(() => { const b = document.querySelector('.doc-toolbar').getBoundingClientRect(), v = document.getElementById('view').getBoundingClientRect(); return [Math.round(b.top - v.top), Math.round(b.height), document.getElementById('view').scrollTop]; })()`);
    expect(r[2] > 500 && Math.abs(r[0]) <= 1 && r[1] >= 30, `Leiste: Abstand ${r[0]} px, Höhe ${r[1]} px, gescrollt ${r[2]} px`);
    await shot('Word: ganz nach unten gescrollt, Leiste bleibt oben');
    await openDocx(AB);
    return `nach ${r[2]} px Scrollen noch oben, ${r[1]} px hoch`;
  });

  await scenario('Word', 'Sicherungskopie des Originals beim ersten Speichern', async () => {
    const files = fs.readdirSync(BACKUPS).filter(f => f.endsWith('Arbeitsblatt.docx'));
    expect(files.length === 1, files.length + ' Sicherungen statt 1');
    return 'Genau eine Sicherung: ' + files[0];
  });

  if (exists('Word/Quiz (echte Datei).docx')) {
    await scenario('Word', 'Echte Schuldatei (Quiz): Zuordnung, Tabelle ändern, speichern', async () => {
      const Q = 'Word/Quiz (echte Datei).docx';
      await openDocx(Q);
      const [ok, locked] = await js(`[document.querySelectorAll('.docx-editable').length, document.querySelectorAll('.docx-locked').length]`);
      await js(`const el = T.docxEl('Ziel-MAC', true); el.scrollIntoView({ block: 'center' }); Caret.set(el, null); true`);
      await type(' (geprüft)');
      await js(`T.selectText(T.docxEl('Ziel-MAC (geprüft)', true), 'geprüft'); T.press('[data-f=b]')`);
      await sleep(150); await shot('Echte Quiz-Datei: Tabelle bearbeitet');
      await saveBin();
      expect((await docxXml(Q)).includes('geprüft'), 'Änderung fehlt');
      return `${ok} von ${ok + locked} Absätzen bearbeitbar`;
    });
  }

  await scenario('Word', 'Prüfung durch Microsoft Word: Dateien öffnen ohne Reparatur', async () => {
    const files = [P(AB)]; if (exists('Word/Quiz (echte Datei).docx')) files.push(P('Word/Quiz (echte Datei).docx'));
    const res = wordValidate(files);
    if (!res.length) return 'Word nicht installiert – übersprungen';
    for (const r of res) expect(r.ok, path.basename(r.file) + ': ' + r.error);
    const a = res[0].text;
    for (const s of ['Verbindet Geräte im LAN', 'äöüß € → 😀', 'Beantworte die Fragen in der Tabelle.']) expect(a.includes(s), 'Word sieht nicht: ' + s);
    return res.map(r => `${path.basename(r.file)}: ${r.paragraphs} Absätze, ${r.tables} Tabellen`).join(' · ');
  });

  // ------------------------------------------------ PDF
  const FP = 'PDF/Formular.pdf';
  await scenario('PDF', 'PDF anzeigen: Seiten, Text und Formularfelder', async () => {
    await openPdf(FP);
    const n = await js(`__lern.S.bin.ed.pages.length`);
    const fields = await js(`document.querySelectorAll('.pdf-field').length`);
    expect(n === 3, n + ' Seiten'); expect(fields >= 5, fields + ' Felder');
    return `${n} Seiten, ${fields} Formularfelder erkannt`;
  });

  await scenario('PDF', 'Text mit der Maus markieren und kopieren (Strg+C)', async () => {
    await js(`document.querySelector('[data-t=select]').click(); true`);
    await pdfReady(1, 760);
    const [a, b] = [await js(`T.pdfPoint(1, 46, 786)`), await js(`T.pdfPoint(1, 290, 786)`)];
    await drag(a[0], a[1], b[0], b[1]);
    const sel = await js(`getSelection().toString()`);
    expect(sel.trim() === 'Arbeitsblatt Topologien', 'Markiert: „' + sel + '“ (erwartet genau die Überschrift)');
    await key('c', 2);
    const clip = await js(`navigator.clipboard.readText()`);
    expect(clip.includes('Arbeitsblatt Topologien'), 'Zwischenablage: „' + clip + '“');
    await shot('Text im PDF markiert');
    await js(`getSelection().removeAllRanges(); true`);
    return 'Markiert und kopiert: „' + clip.trim() + '“';
  });

  await scenario('PDF', '„Text kopieren“ kopiert den ganzen Text aller Seiten', async () => {
    await js(`document.querySelector('[data-copyall]').click(); true`);
    await waitJs(`document.getElementById('toast').textContent.includes('Text kopiert')`, 5000);
    const clip = await js(`navigator.clipboard.readText()`);
    for (const s of ['Arbeitsblatt Topologien', 'Seite zwei Text zum Abdecken', 'Markier mich bitte', 'Seite drei']) expect(clip.includes(s), 'fehlt: ' + s);
    return clip.length + ' Zeichen aus 3 Seiten · Meldung: ' + await js(`document.getElementById('toast').textContent`);
  });

  if (exists('PDF/Topologien (echte Datei).pdf')) {
    await scenario('PDF', 'Echte Schuldatei: Absatz mit der Maus markieren und kopieren', async () => {
      const F = 'PDF/Topologien (echte Datei).pdf';
      await openPdf(F);
      await js(`document.querySelector('[data-t=select]').click(); true`);
      const n = await js(`document.querySelectorAll('.pdf-page .textLayer span').length`);
      // Mit der Maus von links neben „Wenn ein Netzwerk …“ bis rechts neben das Absatzende ziehen
      const pts = await js(`(() => { const sp = [...document.querySelectorAll('.pdf-page .textLayer span')];
        const a = sp.find(s => s.textContent.startsWith('Wenn ein Netzwerk')); const b = sp.find(s => s.textContent.includes('rekt angeschlossen'));
        if (!a || !b) return null; a.scrollIntoView({ block: 'center' }); const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        return [ra.left - 25, ra.top + ra.height / 2, rb.right + 40, rb.top + rb.height / 2]; })()`);
      expect(pts, 'Absatz nicht gefunden');
      await sleep(200);
      await drag(pts[0], pts[1], pts[2], pts[3]);
      await key('c', 2);
      const clip = await js(`navigator.clipboard.readText()`);
      expect(clip.trim().startsWith('Wenn ein Netzwerk') && clip.includes('Hauptleitung') && clip.includes('rekt angeschlossen') && !clip.includes('In einem Bus-Netz'), 'Zwischenablage: „' + clip + '“');
      await shot('Echte PDF-Datei: Absatz markiert');
      await js(`getSelection().removeAllRanges(); true`);
      await openPdf(FP);
      return `${n} Textstücke auf Seite 1 · kopiert: „${clip.trim().slice(0, 90).replace(/\s+/g, ' ')} …“`;
    });
  }

  await scenario('PDF', 'Formular ausfüllen: Textfeld, Kästchen, Liste, Optionsfeld', async () => {
    await openPdf(FP);
    await js(`const f = n => document.querySelector('.pdf-field[data-field="' + n + '"]');
      const t = f('name'); t.focus(); t.value = 'Max Müller'; t.dispatchEvent(new Event('input', { bubbles: true }));
      f('fertig').click(); const s = f('klasse'); s.value = 'FI12'; s.dispatchEvent(new Event('change'));
      const radios = [...document.querySelectorAll('.pdf-field[data-field="note"]')]; radios[1].click(); true`);
    await shot('PDF-Formular ausgefüllt');
    await saveBin();
    const doc = await PDFLib.PDFDocument.load(fs.readFileSync(P(FP)));
    const form = doc.getForm();
    const v = { name: form.getTextField('name').getText(), fertig: form.getCheckBox('fertig').isChecked(), klasse: form.getDropdown('klasse').getSelected()[0], note: form.getRadioGroup('note').getSelected() };
    expect(v.name === 'Max Müller' && v.fertig && v.klasse === 'FI12' && v.note === 'mittel', JSON.stringify(v));
    return JSON.stringify(v);
  });

  await scenario('PDF', 'Vorhandenen Text ändern', async () => {
    await openPdf(FP);
    await js(`document.querySelector('[data-t=edit]').click(); true`);
    await waitJs(`!!document.querySelector('.pdf-item')`);
    await js(`const it = [...document.querySelectorAll('.pdf-item')].find(d => d.title.includes('Arbeitsblatt Topologien')); it.click(); true`);
    await js(`Caret.set(document.querySelector('.pdf-edit'), null); true`);
    await type(' (bearbeitet)');
    await shot('PDF-Text wird geändert');
    await saveBin();
    const t = await pdfText(FP, 1);
    expect(t.includes('Arbeitsblatt Topologien (bearbeitet)'), 'Text: ' + t.slice(0, 120));
    return 'Neuer Text im PDF gefunden';
  });

  await scenario('PDF', 'Neuen Text mehrzeilig mit Umlauten schreiben', async () => {
    await js(`document.querySelector('[data-t=text]').click(); true`);
    await pdfReady(1, 560);
    const [x, y] = await js(`T.pdfPoint(1, 300, 560)`);
    await click(x, y); await sleep(150);
    await type('Zeile eins\nZeile zwei äöüß ✓');
    await js(`document.activeElement.blur(); true`);
    await saveBin();
    const t = await pdfText(FP, 1);
    expect(t.includes('Zeile eins') && t.includes('Zeile zwei äöüß'), 'Text: ' + t);
    return 'Beide Zeilen im PDF · Zeichen ohne Arial-Glyphe (✓) → „?“';
  });

  await scenario('PDF', 'Abdecken, Markieren und Zeichnen (Pixelprüfung)', async () => {
    await pdfReady(2, 610);
    const before = await js(`T.pixels(2, 72, 698, 260, 712)`);
    await js(`document.querySelector('[data-t=erase]').click(); true`);
    let [a, b] = [await js(`T.pdfPoint(2, 68, 694)`), await js(`T.pdfPoint(2, 290, 718)`)];
    await drag(a[0], a[1], b[0], b[1]);
    await js(`document.querySelector('[data-t=highlight]').click(); true`);
    [a, b] = [await js(`T.pdfPoint(2, 68, 645)`), await js(`T.pdfPoint(2, 260, 667)`)];
    await drag(a[0], a[1], b[0], b[1]);
    await js(`document.querySelector('[data-t=draw]').click(); true`);
    [a, b] = [await js(`T.pdfPoint(2, 100, 500)`), await js(`T.pdfPoint(2, 400, 520)`)];
    await drag(a[0], a[1], b[0], b[1]);
    await shot('Abdecken, Markieren, Zeichnen');
    await saveBin();
    await pdfReady(2, 610);
    const erased = await js(`T.pixels(2, 72, 698, 260, 712)`);
    const marked = await js(`T.pixels(2, 200, 648, 255, 664)`);
    const ink = await js(`T.pixels(2, 100, 495, 400, 525)`);
    expect(before.dark > 20 && erased.dark === 0, `Abdecken: vorher ${before.dark} dunkle Pixel, nachher ${erased.dark}`);
    expect(marked.yellow > marked.total * 0.5, `Markierung: ${marked.yellow}/${marked.total} gelb`);
    expect(ink.red > 20, `Zeichnung: ${ink.red} rote Pixel`);
    return `Abdecken: ${before.dark}→${erased.dark} dunkle Pixel · Markierung: ${Math.round(marked.yellow / marked.total * 100)} % gelb · Zeichnung: ${ink.red} rote Pixel`;
  });

  await scenario('PDF', 'Bild einfügen (z. B. Unterschrift), vergrößern und speichern', async () => {
    await pdfReady(3, 421);
    const op = await js(`(async () => { const c = document.createElement('canvas'); c.width = 300; c.height = 100; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 300, 100);
      g.strokeStyle = '#1a3fa0'; g.lineWidth = 4; g.beginPath(); g.moveTo(10, 70); g.bezierCurveTo(60, 0, 90, 110, 140, 40); g.bezierCurveTo(170, 10, 220, 90, 290, 30); g.stroke();
      const blob = await new Promise(r => c.toBlob(r, 'image/png')); const op = await T.bin().ed.addImage(new File([blob], 'unterschrift.png', { type: 'image/png' }), 3); return [op.w, op.h]; })()`);
    await js(`T.scrollToPdf(3, 421)`); await sleep(200);
    const h = await js(`(() => { const el = document.querySelector('.pdf-img .pdf-resize'); const r = el.getBoundingClientRect(); return [r.left + 5, r.top + 5]; })()`);
    await drag(h[0], h[1], h[0] + 60, h[1] + 20);
    const w2 = await js(`T.bin().ed.ops.find(o => o.type === 'image').w`);
    expect(w2 > op[0] + 20, `Breite ${op[0]} → ${w2}`);
    await shot('Eingefügtes Bild (Unterschrift)');
    await saveBin();
    const has = await js(`(async () => { const d = await pdfjsLib.getDocument({ data: new Uint8Array(await (await fetch('/raw?path=' + encodeURIComponent('${FP}') + '&t=' + Date.now())).arrayBuffer()) }).promise;
      const ol = await (await d.getPage(3)).getOperatorList(); return ol.fnArray.includes(pdfjsLib.OPS.paintImageXObject); })()`);
    expect(has, 'kein Bild auf Seite 3');
    return `Bild eingefügt, Breite ${Math.round(op[0])} → ${Math.round(w2)} pt, im PDF vorhanden`;
  });

  await scenario('PDF', 'Eingefügten Text verschieben und mit Entf löschen', async () => {
    await pdfReady(3, 380);
    await js(`document.querySelector('[data-t=text]').click(); true`);
    const [x, y] = await js(`T.pdfPoint(3, 100, 400)`);
    await click(x, y); await sleep(150); await type('Verschieb mich');
    await js(`document.querySelector('[data-t=select]').click(); true`);
    const x0 = await js(`T.bin().ed.ops.find(o => o.text === 'Verschieb mich').x`);
    const r = await js(`(() => { const e = T.bin().ed.ops.find(o => o.text === 'Verschieb mich').el.getBoundingClientRect(); return [e.left + 10, e.top + 5]; })()`);
    await drag(r[0], r[1], r[0] + 120, r[1] + 40);
    const x1 = await js(`T.bin().ed.ops.find(o => o.text === 'Verschieb mich').x`);
    expect(x1 > x0 + 50, `x ${x0} → ${x1}`);
    await key('Delete');
    const still = await js(`T.bin().ed.ops.some(o => o.text === 'Verschieb mich')`);
    expect(!still, 'nicht gelöscht');
    return `verschoben um ${Math.round(x1 - x0)} pt, danach gelöscht`;
  });

  await scenario('PDF', 'Werkzeugleiste bleibt beim Scrollen sichtbar', async () => {
    await js(`const v = document.getElementById('view'); v.scrollTop = v.scrollHeight; true`); await sleep(300);
    const r = await js(`(() => { const b = document.querySelector('.doc-toolbar').getBoundingClientRect(), v = document.getElementById('view').getBoundingClientRect(); return [Math.round(b.top - v.top), Math.round(b.height), document.getElementById('view').scrollTop]; })()`);
    expect(r[2] > 500 && Math.abs(r[0]) <= 1 && r[1] >= 30, `Leiste: Abstand ${r[0]} px, Höhe ${r[1]} px, gescrollt ${r[2]} px`);
    return `nach ${r[2]} px Scrollen noch oben`;
  });

  await scenario('PDF', 'Rückgängig und Zoom', async () => {
    await js(`document.querySelector('[data-t=draw]').click(); true`);
    await js(`T.scrollToPdf(3, 310)`); await sleep(200);
    const [a, b] = [await js(`T.pdfPoint(3, 100, 300)`), await js(`T.pdfPoint(3, 300, 320)`)];
    await drag(a[0], a[1], b[0], b[1]);
    const n1 = await js(`T.bin().ed.ops.length`);
    await js(`document.querySelector('[data-undo]').click(); true`);
    const n2 = await js(`T.bin().ed.ops.length`);
    expect(n2 === n1 - 1, `${n1} → ${n2}`);
    const w1 = await js(`T.bin().ed.pages[0].vp.width`);
    await js(`document.querySelector('[data-zoom="1"]').click(); true`); await sleep(600);
    const w2 = await js(`T.bin().ed.pages[0].vp.width`);
    expect(w2 > w1 * 1.1, `Breite ${w1} → ${w2}`);
    await js(`document.querySelector('[data-zoom="-1"]').click(); true`); await sleep(400);
    return `Rückgängig ok · Zoom ${Math.round(w1)} → ${Math.round(w2)} px`;
  });

  await scenario('PDF', 'Seite drehen und Seite löschen', async () => {
    await js(`T.bin().ed.pageOp('rotate', 3); true`);
    await waitJs(`!__lern.S.bin.saving && !__lern.S.bin.dirty`, 8000); await sleep(600);
    let doc = await PDFLib.PDFDocument.load(fs.readFileSync(P(FP)));
    expect(doc.getPage(2).getRotation().angle === 90, 'nicht gedreht');
    await js(`T.bin().ed.pageOp('delete', 3); true`);
    await waitJs(`!__lern.S.bin.saving && !__lern.S.bin.dirty`, 8000); await sleep(600);
    doc = await PDFLib.PDFDocument.load(fs.readFileSync(P(FP)));
    expect(doc.getPageCount() === 2, doc.getPageCount() + ' Seiten');
    return 'Seite 3 gedreht (90°), dann gelöscht → 2 Seiten';
  });

  if (exists('PDF/Topologien (echte Datei).pdf')) {
    await scenario('PDF', 'Echte Schuldatei (Topologien): Text ändern und markieren', async () => {
      const F = 'PDF/Topologien (echte Datei).pdf';
      await openPdf(F);
      await js(`document.querySelector('[data-t=edit]').click(); true`);
      await waitJs(`!!document.querySelector('.pdf-item')`);
      await js(`[...document.querySelectorAll('.pdf-item')].find(d => /Topologie/.test(d.title)).click(); Caret.set(document.querySelector('.pdf-edit'), null); true`);
      await type(' – geprüft');
      await saveBin();
      const t = await pdfText(F, 1);
      expect(t.includes('geprüft'), 'Text fehlt');
      await js(`document.querySelector('.view').scrollTop = 0; true`); await sleep(300);
      await shot('Echte PDF-Datei bearbeitet');
      return 'Überschrift geändert, im PDF-Text gefunden';
    });
  }

  await scenario('PDF', 'Links im PDF: Webseite, Sprung im Dokument, andere Datei, Adresse im Text', async () => {
    const F = 'PDF/Links.pdf';
    await openPdf(F);
    await waitJs(`document.querySelectorAll('.pdf-link').length >= 5`, 5000, 'Links nicht erkannt');
    const n = await js(`document.querySelectorAll('.pdf-link').length`);
    await js(`window.__opened = []; window.open = u => { __opened.push(String(u)); return null; }; true`);
    const at = title => js(`(() => { const l = [...document.querySelectorAll('.pdf-link')].find(e => e.title.includes(${JSON.stringify(title)})); l.scrollIntoView({ block: 'center' }); const r = l.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    let p = await at('schule.example.org'); await click(p[0], p[1]); await sleep(150);
    p = await at('www.beispiel.de'); await click(p[0], p[1]); await sleep(150);
    p = await at('lehrer@schule.de'); await click(p[0], p[1]); await sleep(150);
    const opened = await js(`__opened`);
    expect(opened[0] === 'https://schule.example.org/aufgabe', 'Web-Link: ' + opened[0]);
    expect(opened[1] === 'https://www.beispiel.de/info', 'Text-Adresse: ' + opened[1]);
    expect(opened[2] === 'mailto:lehrer@schule.de', 'E-Mail: ' + opened[2]);
    p = await at('Zur Stelle'); await click(p[0], p[1]); await sleep(900);
    const pos = await js(`(() => { const b = T.bin().ed.pages[1].box.getBoundingClientRect(), v = document.getElementById('view').getBoundingClientRect(); return [Math.round(b.top - v.top), !document.querySelector('[data-back]').hidden]; })()`);
    expect(pos[0] < 0 && pos[1], 'Sprung zu Seite 2 fehlgeschlagen: ' + JSON.stringify(pos));
    await shot('PDF-Link: zu Seite 2 gesprungen');
    await js(`document.querySelector('[data-back]').click(); true`); await sleep(700);
    p = await at('Formular.pdf'); await click(p[0], p[1]);
    await waitJs(`__lern.S.bin && __lern.S.bin.path === 'PDF/Formular.pdf'`, 8000, 'Datei-Link öffnet Formular.pdf nicht');
    return `${n} Links erkannt · Web, Text-Adresse und E-Mail geöffnet · Sprung zu Seite 2 · Datei-Link öffnet Formular.pdf in der App`;
  });

  // ------------------------------------------------ Abschluss
  await scenario('Allgemein', 'Schneller Wechsel direkt nach dem Speichern verliert nichts', async () => {
    await openDocx(AB);
    await js(`Caret.set(T.docxEl('Arbeitsblatt Netzwerke'), null); true`); await type(' 2');
    await saveBin();
    await openNote('Notizen/Wechsel.md', '');   // sofort weiter, bevor die Vorschau-Aktualisierung fällig ist
    await type('Nach dem Wechsel getippt');
    await sleep(1500);
    await fileHas('Notizen/Wechsel.md', 'Nach dem Wechsel getippt');
    expect((await docxXml(AB)).includes('Arbeitsblatt Netzwerke 2'), 'Word-Änderung fehlt');
    return 'Beide Änderungen gespeichert';
  });

  await scenario('Allgemein', 'Speicherzeit: Änderung liegt in unter 2 s im Ordner', async () => {
    await openNote('Notizen/Tempo.md', '');
    const t0 = Date.now(); await type('x');
    const dbg = await js(`[document.activeElement.tagName, document.activeElement.className, document.hasFocus(), __lern.S.editor && __lern.S.editor.getData().map(b=>b.type+':'+b.md).join('|'), document.querySelectorAll('.editor .block').length].join(' / ')`);
    await until(() => read('Notizen/Tempo.md').includes('x'), 4000, 'Zeitüberschreitung [' + dbg + ']');
    const ms = Date.now() - t0; expect(ms < 2000, ms + ' ms');
    return ms + ' ms vom Tastendruck bis zur Datei';
  });

  await scenario('Allgemein', 'Dunkles Design', async () => {
    await nav('Word/Arbeitsblatt.docx'); await sleep(2500);
    await js(`document.getElementById('themeBtn').click(); true`); await sleep(300);
    await shot('Dunkles Design');
    await js(`document.getElementById('themeBtn').click(); true`);
    return 'umgeschaltet';
  });

  // ------------------------------------------------ Ordner
  await scenario('Ordner', 'Anderen Ordner über den Windows-Dialog hinzufügen', async () => {
    await nav('');
    await openFolderMenu(3);
    await shot('Ordner-Umschalter');
    await js(`T.menuClick('Ordner hinzufügen')`);
    await waitJs(`__lern.S.root.toLowerCase() === ${JSON.stringify(ROOT2.toLowerCase())}`, 8000, 'nicht umgeschaltet');
    await waitJs(`!!document.querySelector('#tree .row[data-path="Zweiter Ordner.md"]') && !!document.querySelector('#tree .row[data-path="Privat"]')`, 6000, 'Baum zeigt den neuen Ordner nicht');
    await waitJs(`!!document.querySelector('.hero')`);
    await shot('Zweiter Ordner verknüpft');
    return 'Verknüpft: ' + await js(`document.getElementById('rootName').textContent`);
  });

  await scenario('Ordner', 'Im neuen Ordner arbeiten: Seite ändern wird dort gespeichert', async () => {
    await nav('Zweiter Ordner.md');
    await waitJs(`!!(__lern.S.doc && __lern.S.doc.path === 'Zweiter Ordner.md')`);
    await js(`document.querySelector('.add-below').click(); true`);
    await type('Geschrieben im zweiten Ordner');
    await until(() => fs.readFileSync(path.join(ROOT2, 'Zweiter Ordner.md'), 'utf8').includes('Geschrieben im zweiten Ordner'), 5000, 'nicht gespeichert');
    fs.writeFileSync(path.join(ROOT2, 'Extern im zweiten.txt'), 'x');
    await waitJs(`!!document.querySelector('#tree .row[data-path="Extern im zweiten.txt"]')`, 5000, 'Live-Sync im neuen Ordner fehlt');
    expect(!exists('Zweiter Ordner.md'), 'Datei im falschen Ordner gelandet');
    return 'Speichern und Live-Sync im zweiten Ordner funktionieren';
  });

  await scenario('Ordner', 'Zurück zum ersten Ordner wechseln', async () => {
    await openFolderMenu(4);
    const names = await js(`[...document.querySelectorAll('#menu .m-item')].map(b => b.textContent).join(' | ')`);
    expect(await js(`T.menuClick(${JSON.stringify(path.basename(ROOT))})`), 'Eintrag nicht gefunden');
    await waitJs(`__lern.S.root.toLowerCase() === ${JSON.stringify(ROOT.toLowerCase())}`, 8000, 'nicht zurückgewechselt');
    await waitJs(`!!document.querySelector('#tree .row[data-path="Notizen"]')`, 6000);
    return 'Menü: ' + names.slice(0, 160);
  });

  await scenario('Ordner', 'Ordner aus der Liste entfernen (Dateien bleiben)', async () => {
    await openFolderMenu(4);
    expect(await js(`T.menuClick('aus der Liste entfernen')`), 'Eintrag fehlt');
    await waitJs(`!document.getElementById('menu').hidden && document.querySelector('#menu').textContent.includes('Aus der Liste entfernen')`);
    await js(`T.menuClick(${JSON.stringify(path.basename(ROOT2))})`);
    await until(async () => { const f = await js(`fetch('/api/folders').then(r => r.json())`); return f.folders.length === 1; }, 4000, 'noch in der Liste');
    expect(fs.existsSync(path.join(ROOT2, 'Zweiter Ordner.md')), 'Dateien wurden gelöscht!');
    return 'Aus der Liste entfernt, Dateien unverändert';
  });

  await scenario('Allgemein', 'Keine JavaScript-Fehler während aller Tests', async () => {
    expect(!jsErrors.length, jsErrors.slice(0, 5).join(' ‖ '));
    return 'keine';
  });

  const total = Date.now() - t0;
  ws.close(); edge.kill(); server.kill();
  writeReport(total);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  // Test-Ordner wieder entfernen (Screenshots liegen im Bericht)
  if (!process.argv.includes('--keep')) for (const d of [ROOT, BACKUPS, ROOT2, env.LERN_DATA]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} bestanden · Bericht: ${path.join(REPORT, 'index.html')}`);
  return failed;
}

// ================== Bericht ==================
function writeReport(ms) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const passed = results.filter(r => r.ok).length;
  const groups = [...new Set(results.map(r => r.group))];
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Testbericht Lernplattform</title>
<style>
:root{--bg:#fff;--card:#f7f7f5;--text:#37352f;--muted:#787774;--line:#e9e9e7;--ok:#2f8a4f;--okbg:#e4f3e9;--bad:#c4413b;--badbg:#fbe4e2;--accent:#2383e2}
@media (prefers-color-scheme:dark){:root{--bg:#191919;--card:#232323;--text:#e6e6e4;--muted:#9b9a97;--line:#2f2f2f;--okbg:#1d3325;--badbg:#3d1f1d}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 "Segoe UI",system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:36px 20px 80px}h1{font-size:34px;margin:0 0 4px}.sub{color:var(--muted)}
.sum{display:flex;gap:12px;margin:22px 0 30px;flex-wrap:wrap}.tile{background:var(--card);border-radius:12px;padding:14px 20px;min-width:150px}
.tile b{display:block;font-size:30px;line-height:1.2}.tile.ok b{color:var(--ok)}.tile.bad b{color:var(--bad)}
.bar{height:10px;border-radius:6px;background:var(--badbg);overflow:hidden;margin:-14px 0 30px}.bar i{display:block;height:100%;background:var(--ok)}
h2{font-size:20px;margin:34px 0 10px;display:flex;gap:10px;align-items:baseline}h2 small{color:var(--muted);font-weight:400;font-size:14px}
.t{border:1px solid var(--line);border-radius:10px;margin:8px 0;overflow:hidden}.t summary{display:flex;gap:12px;align-items:center;padding:10px 14px;cursor:pointer;list-style:none}
.t summary::-webkit-details-marker{display:none}.st{font-weight:700;border-radius:6px;padding:1px 8px;font-size:13px;flex-shrink:0}
.ok .st{background:var(--okbg);color:var(--ok)}.bad .st{background:var(--badbg);color:var(--bad)}.bad{border-color:var(--bad)}
.name{flex:1}.ms{color:var(--muted);font-size:13px;white-space:nowrap}.cam{color:var(--muted);font-size:13px}
.det{padding:0 14px 14px 14px}.det p{margin:0 0 10px;color:var(--muted);word-break:break-word}.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px}
.shots figure{margin:0}.shots img{width:100%;border-radius:8px;border:1px solid var(--line);cursor:zoom-in}.shots figcaption{font-size:12.5px;color:var(--muted);margin-top:3px}
#big{position:fixed;inset:0;background:rgba(0,0,0,.85);display:none;align-items:center;justify-content:center;padding:20px;cursor:zoom-out}#big img{max-width:100%;max-height:100%;border-radius:8px}
</style></head><body><main>
<h1>Testbericht Lernplattform</h1>
<div class="sub">${new Date().toLocaleString('de-DE')} · ${EXE ? 'getestet: Lernplattform.exe' : 'getestet: server.js'} · Dauer ${(ms / 1000).toFixed(0)} s · eigener Test-Ordner (deine Schuldaten wurden nicht verändert)</div>
<div class="sum"><div class="tile ok"><b>${passed}</b>bestanden</div><div class="tile ${results.length - passed ? 'bad' : ''}"><b>${results.length - passed}</b>fehlgeschlagen</div><div class="tile"><b>${results.length}</b>Szenarien</div><div class="tile"><b>${shotNo}</b>Screenshots</div></div>
<div class="bar"><i style="width:${(passed / results.length * 100).toFixed(1)}%"></i></div>
${groups.map(g => { const rs = results.filter(r => r.group === g); return `<h2>${esc(g)} <small>${rs.filter(r => r.ok).length}/${rs.length} bestanden</small></h2>` +
    rs.map(r => `<details class="t ${r.ok ? 'ok' : 'bad'}" ${!r.ok || r.shots.length ? 'open' : ''}><summary><span class="st">${r.ok ? '✓ OK' : '✗ Fehler'}</span><span class="name">${esc(r.name)}</span>${r.shots.length ? `<span class="cam">📷 ${r.shots.length}</span>` : ''}<span class="ms">${(r.ms / 1000).toFixed(1)} s</span></summary>
    <div class="det"><p>${esc(r.detail)}</p>${r.shots.length ? `<div class="shots">${r.shots.map(s => `<figure><img src="img/${s.name}" loading="lazy" alt="${esc(s.label)}"><figcaption>${esc(s.label)}</figcaption></figure>`).join('')}</div>` : ''}</div></details>`).join(''); }).join('')}
</main><div id="big"><img alt=""></div>
<script>const big=document.getElementById('big');document.querySelectorAll('.shots img').forEach(i=>i.onclick=()=>{big.firstChild.src=i.src;big.style.display='flex'});big.onclick=()=>big.style.display='none';</script>
</body></html>`;
  fs.writeFileSync(path.join(REPORT, 'index.html'), html);
  fs.writeFileSync(path.join(REPORT, 'ergebnisse.json'), JSON.stringify({ date: new Date().toISOString(), ms, results }, null, 2));
}

run().then(failed => {
  if (!process.argv.includes('--no-open')) spawn('cmd.exe', ['/c', 'start', '""', path.join(REPORT, 'index.html')], { detached: true, stdio: 'ignore' }).unref();
  process.exit(failed ? 1 : 0);
}).catch(e => { console.error('Testlauf abgebrochen:', e); try { writeReport(0); } catch {} process.exit(2); });
