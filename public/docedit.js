// ================== Word- und PDF-Bearbeitung direkt in der App ==================

// ---------- Word (.docx) ----------
// Die Seite wird mit docx-preview dargestellt. Jeder dargestellte Absatz wird seinem <w:p> im
// document.xml zugeordnet. Beim Speichern wird nur das Geänderte in die vorhandenen Textläufe
// geschrieben – Schrift, Farben, Tabellen und Bilder bleiben unverändert.
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
// Reihenfolge der Elemente in <w:rPr> laut Word-Schema (falsche Reihenfolge = "Datei beschädigt")
const RPR_ORDER = ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'outline', 'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath', 'rPrChange'];
const HIGHLIGHT_CSS = { yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', red: '#ff0000', lightGray: '#d3d3d3' };

class DocxEditor {
  constructor(host, buf, opts) { this.host = host; this.buf = buf; this.opts = opts; this.editing = false; this.pairs = []; this.structChanged = false; }

  async render() {
    this.zip = await JSZip.loadAsync(this.buf);
    const xmlText = await this.zip.file('word/document.xml').async('string');
    this.decl = (/^<\?xml[^>]*\?>/.exec(xmlText) || ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'])[0];
    this.xml = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (this.xml.getElementsByTagName('parsererror').length) throw new Error('document.xml konnte nicht gelesen werden');
    const view = document.createElement('div'); view.className = 'doc-view';
    await docx.renderAsync(this.buf, view, null, { className: 'docx', inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: true, experimental: true });
    this.view = view;
    this.host.replaceChildren(view);
    this.mapParagraphs();
    view.addEventListener('keydown', e => this.onKey(e));
    view.addEventListener('paste', e => this.onPaste(e));
    view.addEventListener('input', () => this.opts.onDirty());
    view.addEventListener('focusin', e => { const el = e.target.closest?.('.docx-editable'); if (el) this.opts.onFocus?.(el); });
    return this;
  }

  // ---- Zuordnung Ansicht <-> XML ----
  static textNodes(p) {
    const out = [];
    const walk = node => {
      for (const c of node.children) {
        if (c.namespaceURI === W_NS && c.localName === 'p') continue;       // Absätze in Textfeldern
        if (c.localName === 'Fallback') continue;                            // doppelte VML-Inhalte
        if (c.namespaceURI === W_NS && (c.localName === 'del' || c.localName === 'moveFrom')) continue;
        if (c.namespaceURI === W_NS && c.localName === 't') out.push(c);
        else walk(c);
      }
    };
    walk(p);
    return out;
  }
  static xmlText(p) { return DocxEditor.textNodes(p).map(t => t.textContent).join(''); }
  static domText(el) { return el.textContent.replace(/ /g, ' ').replace(/​/g, ''); }
  static ancestor(node, name) { while (node && !(node.namespaceURI === W_NS && node.localName === name)) node = node.parentNode; return node; }

  mapParagraphs() {
    const xps = [...this.xml.getElementsByTagNameNS(W_NS, 'p')];
    const texts = xps.map(p => DocxEditor.xmlText(p));
    const els = [...this.view.querySelectorAll('article p')].filter(el => !el.parentElement.closest('article p'));
    let j = 0;
    this.pairs = [];
    for (const el of els) {
      const t = DocxEditor.domText(el);
      let found = -1;
      for (let k = j; k < xps.length && k < j + 60; k++) if (texts[k] === t) { found = k; break; }
      if (found < 0) { el.classList.add('docx-locked'); continue; }
      this.addPair(el, xps[found]);
      j = found + 1;
    }
    this.total = els.length;
  }

  addPair(el, xp, at) {
    const pair = { el, xp, base: DocxEditor.domText(el) };
    el.__pair = pair; el.classList.add('docx-editable'); el.classList.remove('docx-locked');
    if (this.editing) el.contentEditable = 'true';
    if (at === undefined) this.pairs.push(pair); else this.pairs.splice(at, 0, pair);
    return pair;
  }

  setEditing(on) {
    this.editing = on;
    this.view.classList.toggle('editing', on);
    for (const p of this.pairs) p.el.contentEditable = on ? 'true' : 'false';
    for (const el of this.view.querySelectorAll('.docx-locked')) el.title = on ? 'Dieser Absatz enthält Sonderelemente und kann nur in Word geändert werden' : '';
  }

  isDirty() { return this.structChanged || this.pairs.some(p => DocxEditor.domText(p.el) !== p.base); }
  activePair() { const s = getSelection(); const n = s.anchorNode; const el = n && (n.nodeType === 1 ? n : n.parentElement)?.closest('.docx-editable'); return el ? el.__pair : null; }

  onKey(e) {
    const el = e.target.closest && e.target.closest('.docx-editable');
    if (!el || !this.editing) return;
    const pair = el.__pair;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && ['b', 'i', 'u'].includes(e.key.toLowerCase())) { e.preventDefault(); this.format(e.key.toLowerCase()); return; }
    if (e.key === 'Enter') { e.preventDefault(); this.split(pair); this.opts.onDirty(); return; }
    if (e.key === 'Tab') { e.preventDefault(); this.moveCell(el, e.shiftKey ? -1 : 1); return; }
    if (e.key === 'Backspace' && Caret.atStart(el)) {
      e.preventDefault();
      const prev = el.previousElementSibling?.__pair;
      if (prev && prev.el.classList.contains('docx-editable')) { this.merge(prev, pair); this.opts.onDirty(); }
      return;
    }
    if (e.key === 'Delete' && Caret.atEnd(el)) {
      e.preventDefault();
      const next = el.nextElementSibling?.__pair;
      if (next && next.el.classList.contains('docx-editable')) { const len = pair.base.length; this.merge(pair, next); Caret.set(pair.el, len); this.opts.onDirty(); }
    }
  }

  // Tab springt in der Tabelle zur nächsten Zelle
  moveCell(el, dir) {
    const td = el.closest('td'); if (!td) return;
    const cells = [...td.closest('table').querySelectorAll('td')];
    const next = cells[cells.indexOf(td) + dir];
    const target = next && next.querySelector('.docx-editable');
    if (target) Caret.set(target, null);
  }

  onPaste(e) {
    if (!this.editing || !e.target.closest('.docx-editable')) return;
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain').replace(/\s*\r?\n\s*/g, ' '));
  }

  // ---- Text ----
  commit(pair) {
    const now = DocxEditor.domText(pair.el);
    const old = pair.base;
    if (now === old) return;
    let a = 0; while (a < old.length && a < now.length && old[a] === now[a]) a++;
    let b = 0; while (b < old.length - a && b < now.length - a && old[old.length - 1 - b] === now[now.length - 1 - b]) b++;
    DocxEditor.replaceRange(pair.xp, a, old.length - b, now.slice(a, now.length - b));
    pair.base = now;
  }
  commitAll() { for (const p of this.pairs) this.commit(p); }

  static replaceRange(p, a, b, ins) {
    const nodes = DocxEditor.textNodes(p);
    if (!nodes.length) {
      if (!ins) return;
      const doc = p.ownerDocument;
      const r = doc.createElementNS(W_NS, 'w:r');
      const markRpr = [...p.children].find(c => c.localName === 'pPr')?.getElementsByTagNameNS(W_NS, 'rPr')[0];
      if (markRpr) { const rp = doc.createElementNS(W_NS, 'w:rPr'); for (const c of markRpr.children) if (RPR_ORDER.includes(c.localName) && c.localName !== 'rPrChange') rp.append(c.cloneNode(true)); if (rp.children.length) r.append(rp); }
      const t = doc.createElementNS(W_NS, 'w:t'); t.setAttributeNS(XML_NS, 'xml:space', 'preserve'); t.textContent = ins;
      r.append(t); p.append(r);
      return;
    }
    let pos = 0;
    const segs = nodes.map(n => { const s = pos; pos += n.textContent.length; return { n, s, e: pos }; });
    const tgt = (a > 0 && segs.find(g => g.s < a && a <= g.e)) || segs[0];
    for (const g of segs) {
      const from = Math.max(a, g.s), to = Math.min(b, g.e);
      if (from < to) { const t = g.n.textContent; g.n.textContent = t.slice(0, from - g.s) + t.slice(to - g.s); }
    }
    const t = tgt.n.textContent; const off = Math.max(0, a - tgt.s);
    tgt.n.textContent = t.slice(0, off) + ins + t.slice(off);
    for (const g of segs) g.n.setAttributeNS(XML_NS, 'xml:space', 'preserve');
  }

  // Enter: Absatz an der Cursor-Position teilen
  split(pair) {
    const el = pair.el;
    this.commit(pair);
    this.structChanged = true;
    const c = Caret.offset(el);
    const len = pair.base.length;
    const xp2 = pair.xp.cloneNode(true);
    for (const tag of ['drawing', 'pict', 'object', 'bookmarkStart', 'bookmarkEnd']) [...xp2.getElementsByTagNameNS(W_NS, tag)].forEach(x => x.remove());
    pair.xp.after(xp2);
    DocxEditor.replaceRange(pair.xp, c, len, '');
    const rest = DocxEditor.xmlText(xp2);
    DocxEditor.replaceRange(xp2, 0, rest.length - (len - c), '');

    const sel = getSelection(); const r = document.createRange();
    r.setStart(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset); r.setEnd(el, el.childNodes.length);
    const frag = r.extractContents();
    const el2 = el.cloneNode(false); el2.append(frag); el.after(el2);
    pair.base = DocxEditor.domText(el);
    this.addPair(el2, xp2, this.pairs.indexOf(pair) + 1);
    Caret.set(el2, 0);
  }

  // Rücktaste am Absatzanfang: mit dem vorherigen Absatz zusammenführen
  merge(p1, p2) {
    this.commit(p1); this.commit(p2);
    const len = p1.base.length;
    for (const c of [...p2.xp.children]) if (c.localName !== 'pPr') p1.xp.append(c);
    p2.xp.remove();
    while (p2.el.firstChild) p1.el.append(p2.el.firstChild);
    p2.el.remove();
    this.pairs.splice(this.pairs.indexOf(p2), 1);
    p1.base = DocxEditor.domText(p1.el);
    this.structChanged = true;
    Caret.set(p1.el, len);
  }

  // ---- Formatierung ----
  static splitAt(p, pos) {
    let s = 0;
    for (const t of DocxEditor.textNodes(p)) {
      const len = t.textContent.length;
      if (pos > s && pos < s + len) {
        const r = t.parentElement; if (!r || r.localName !== 'r') return;
        const off = pos - s;
        const r2 = r.cloneNode(true);
        const kids = [...r.children], kids2 = [...r2.children]; const idx = kids.indexOf(t);
        const full = t.textContent;
        kids.slice(idx + 1).forEach(k => k.remove());
        kids2.slice(0, idx).forEach(k => { if (k.localName !== 'rPr') k.remove(); });
        t.textContent = full.slice(0, off); kids2[idx].textContent = full.slice(off);
        t.setAttributeNS(XML_NS, 'xml:space', 'preserve'); kids2[idx].setAttributeNS(XML_NS, 'xml:space', 'preserve');
        r.after(r2);
        return;
      }
      s += len;
    }
  }

  static setRunProp(r, name, val) {
    const doc = r.ownerDocument;
    let rPr = [...r.children].find(c => c.localName === 'rPr');
    if (!rPr) { rPr = doc.createElementNS(W_NS, 'w:rPr'); r.insertBefore(rPr, r.firstChild); }
    [...rPr.children].filter(c => c.localName === name).forEach(c => c.remove());
    if (val === null) return;
    const el = doc.createElementNS(W_NS, 'w:' + name);
    if (val !== '') el.setAttributeNS(W_NS, 'w:val', val);
    const idx = RPR_ORDER.indexOf(name);
    const after = [...rPr.children].find(c => RPR_ORDER.indexOf(c.localName) > idx);
    rPr.insertBefore(el, after || null);
  }

  static formatRange(p, a, b, name, val) {
    if (a >= b) return;
    DocxEditor.splitAt(p, b); DocxEditor.splitAt(p, a);
    let s = 0; const runs = new Set();
    for (const t of DocxEditor.textNodes(p)) {
      const len = t.textContent.length;
      if (len && s >= a && s + len <= b && t.parentElement?.localName === 'r') runs.add(t.parentElement);
      s += len;
    }
    for (const r of runs) DocxEditor.setRunProp(r, name, val);
  }

  selectionTargets() {
    const sel = getSelection(); if (!sel.rangeCount || sel.isCollapsed) return [];
    const r = sel.getRangeAt(0);
    return this.pairs.filter(pr => r.intersectsNode(pr.el)).map(pr => {
      let a = 0, b = DocxEditor.domText(pr.el).length;
      if (pr.el.contains(r.startContainer)) { const x = document.createRange(); x.selectNodeContents(pr.el); x.setEnd(r.startContainer, r.startOffset); a = x.toString().length; }
      if (pr.el.contains(r.endContainer)) { const x = document.createRange(); x.selectNodeContents(pr.el); x.setEnd(r.endContainer, r.endOffset); b = x.toString().length; }
      return { pr, a, b };
    }).filter(t => t.b > t.a);
  }

  // kind: b | i | u | s | color | highlight
  format(kind, value) {
    const targets = this.selectionTargets();
    if (!targets.length) { UI.toast('Markiere zuerst den Text, den du formatieren möchtest'); return false; }
    this.commitAll();
    document.execCommand('styleWithCSS', false, true);
    let name, val;
    const cmd = { b: 'bold', i: 'italic', u: 'underline', s: 'strikeThrough' }[kind];
    if (cmd) {
      const on = !document.queryCommandState(cmd);
      document.execCommand(cmd);
      name = { b: 'b', i: 'i', u: 'u', s: 'strike' }[kind];
      val = kind === 'u' ? (on ? 'single' : 'none') : (on ? '' : '0');
    } else if (kind === 'color') {
      document.execCommand('foreColor', false, '#' + value); name = 'color'; val = value;
    } else if (kind === 'highlight') {
      document.execCommand('hiliteColor', false, value === 'none' ? 'transparent' : HIGHLIGHT_CSS[value]); name = 'highlight'; val = value === 'none' ? null : value;
    }
    document.execCommand('styleWithCSS', false, false);
    for (const t of targets) DocxEditor.formatRange(t.pr.xp, t.a, t.b, name, val);
    for (const t of targets) t.pr.base = DocxEditor.domText(t.pr.el);
    this.structChanged = true;
    this.opts.onDirty();
    return true;
  }

  // ---- Tabellenzeilen ----
  rowOp(kind) {
    const pair = this.activePair();
    const tr = pair && pair.el.closest('tr');
    if (!tr) { UI.toast('Klicke zuerst in eine Tabellenzelle'); return false; }
    const xtr = DocxEditor.ancestor(pair.xp, 'tr'); if (!xtr) return false;
    this.commitAll();
    if (kind === 'add') {
      const xtr2 = xtr.cloneNode(true);
      for (const t of xtr2.getElementsByTagNameNS(W_NS, 't')) t.textContent = '';
      for (const tag of ['drawing', 'pict', 'object', 'bookmarkStart', 'bookmarkEnd']) [...xtr2.getElementsByTagNameNS(W_NS, tag)].forEach(x => x.remove());
      xtr.after(xtr2);
      const tr2 = tr.cloneNode(true);
      tr2.querySelectorAll('p').forEach(p => { p.textContent = ''; p.removeAttribute('contenteditable'); });
      tr.after(tr2);
      const xps = [...xtr2.getElementsByTagNameNS(W_NS, 'p')]; const ps = [...tr2.querySelectorAll('p')];
      if (xps.length === ps.length) ps.forEach((p, i) => this.addPair(p, xps[i]));
      else ps.forEach(p => p.classList.add('docx-locked'));
      const first = tr2.querySelector('.docx-editable'); if (first) Caret.set(first, 0);
    } else {
      const xtbl = DocxEditor.ancestor(xtr, 'tbl');
      if ([...xtbl.children].filter(c => c.localName === 'tr').length <= 1) { UI.toast('Die letzte Zeile einer Tabelle kann nicht gelöscht werden'); return false; }
      const inside = new Set(tr.querySelectorAll('.docx-editable'));
      this.pairs = this.pairs.filter(p => !inside.has(p.el));
      xtr.remove(); tr.remove();
    }
    this.structChanged = true;
    this.opts.onDirty();
    return true;
  }

  async getBytes() {
    this.commitAll();
    let s = new XMLSerializer().serializeToString(this.xml);
    if (!s.startsWith('<?xml')) s = this.decl + s;
    this.zip.file('word/document.xml', s);
    const out = await this.zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    this.structChanged = false;
    return out;
  }
}

// ---------- PDF ----------
// Darstellung mit pdf.js, Änderungen werden mit pdf-lib in die PDF-Datei geschrieben.
// Formularfelder mit „automatischer“ Schriftgröße (0 Tf) bekommen überall dieselbe Größe, statt mit dem Kästchen
// zu wachsen; nur sehr flache einzeilige Felder etwas kleiner, damit nichts abgeschnitten wird
const FIELD_PT = 10;
const autoFieldPt = (h, multiline) => multiline ? FIELD_PT : Math.min(FIELD_PT, Math.max(6, (h - 2) * 0.8));

const PDF_TOOLS = [
  { id: 'select', icon: '🖱️', label: 'Auswählen', hint: 'Text markieren und mit Strg+C kopieren · Eingefügtes anklicken zum Verschieben, Entf löscht' },
  { id: 'edit', icon: '✏️', label: 'Text ändern', hint: 'Klicke auf einen Text im PDF, um ihn zu ändern oder zu löschen.' },
  { id: 'text', icon: '🔤', label: 'Text', hint: 'Klicke an die Stelle, an der du schreiben möchtest (Enter = neue Zeile).' },
  { id: 'erase', icon: '⬜', label: 'Abdecken', hint: 'Ziehe ein Rechteck über den Bereich, der verschwinden soll.' },
  { id: 'highlight', icon: '🖍️', label: 'Markieren', hint: 'Ziehe ein Rechteck zum Markieren.' },
  { id: 'draw', icon: '✍️', label: 'Zeichnen', hint: 'Mit gedrückter Maustaste zeichnen.' },
  { id: 'image', icon: '🖼️', label: 'Bild', hint: 'Bild auswählen – es wird auf der aktuellen Seite eingefügt.' },
];

class PdfEditor {
  constructor(host, buf, opts) {
    this.host = host; this.bytes = new Uint8Array(buf); this.opts = opts;
    this.ops = []; this.form = {}; this.pageOps = []; this.sel = null;
    this.tool = 'select'; this.textSize = 12; this.color = '#d0021b'; this.zoom = 1;
    this.onDocKey = e => this.onKey(e);
    document.addEventListener('keydown', this.onDocKey);
  }
  destroy() { document.removeEventListener('keydown', this.onDocKey); this.observer?.disconnect(); if (this.onTipScroll) this.host.closest('.view')?.removeEventListener('scroll', this.onTipScroll); }

  async render() { if (!this.bar) this.buildBar(); await this.load(this.bytes); return this; }
  async reload(bytes) { await this.load(bytes, true); }

  async load(bytes, keepScroll) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.js';
    this.bytes = new Uint8Array(bytes);
    this.ops = []; this.form = {}; this.pageOps = []; this.sel = null;
    this.pdf = await pdfjsLib.getDocument({ data: this.bytes.slice(), cMapUrl: '/vendor/cmaps/', cMapPacked: true, standardFontDataUrl: '/vendor/standard_fonts/', isEvalSupported: false }).promise;
    await this.layout(keepScroll);
  }

  async layout(keepScroll) {
    this.hideTip();
    const scroller = this.host.closest('.view');
    const sc = keepScroll && scroller ? scroller.scrollTop / Math.max(1, scroller.scrollHeight) : 0;
    const pagesBox = document.createElement('div'); pagesBox.className = 'pdf-pages';
    this.pages = [];
    const avail = Math.min(1100, (this.host.clientWidth || 900) - 48);
    for (let i = 1; i <= this.pdf.numPages; i++) {
      const page = await this.pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.max(0.3, Math.min(4, avail / base.width * this.zoom)) });
      const box = document.createElement('div'); box.className = 'pdf-page'; box.style.width = vp.width + 'px'; box.style.height = vp.height + 'px';
      box.innerHTML = `<canvas></canvas><svg class="pdf-ink" width="${vp.width}" height="${vp.height}"></svg><div class="pdf-layer"></div>
        <div class="pdf-page-tools"><span>Seite ${i} / ${this.pdf.numPages}</span><button data-rot title="Seite drehen">⟳</button><button data-delpage title="Seite löschen">🗑</button></div>`;
      const pg = { i, page, vp, box, canvas: box.querySelector('canvas'), layer: box.querySelector('.pdf-layer'), svg: box.querySelector('svg'), rendered: false, items: null };
      box.__pg = pg;
      box.querySelector('[data-rot]').onclick = () => this.pageOp('rotate', i);
      box.querySelector('[data-delpage]').onclick = () => this.pageOp('delete', i);
      this.pages.push(pg);
      pagesBox.append(box);
      this.bindPage(pg);
    }
    if (this.pagesBox) this.pagesBox.replaceWith(pagesBox); else this.host.append(pagesBox);
    this.pagesBox = pagesBox;
    for (const op of this.ops) this.mountOp(op);
    this.observer?.disconnect();
    this.observer = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) this.renderPage(e.target.__pg); }), { root: scroller, rootMargin: '600px' });
    this.pages.forEach(pg => this.observer.observe(pg.box));
    if (scroller) scroller.scrollTop = sc * scroller.scrollHeight;
    this.bar.querySelector('[data-zoomval]').textContent = Math.round(this.zoom * 100) + '%';
    this.setTool(this.tool);
  }

  async renderPage(pg) {
    if (pg.rendered) return; pg.rendered = true;
    const ratio = window.devicePixelRatio || 1;
    pg.canvas.width = pg.vp.width * ratio; pg.canvas.height = pg.vp.height * ratio;
    pg.canvas.style.width = pg.vp.width + 'px'; pg.canvas.style.height = pg.vp.height + 'px';
    await pg.page.render({ canvasContext: pg.canvas.getContext('2d'), viewport: pg.vp, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null }).promise;
    const tc = await pg.page.getTextContent();
    // Unsichtbare Textebene, damit man Text markieren und kopieren kann
    try {
      const tl = document.createElement('div'); tl.className = 'textLayer';
      pg.box.style.setProperty('--scale-factor', pg.vp.scale);
      pg.box.insertBefore(tl, pg.layer);
      await pdfjsLib.renderTextLayer({ textContentSource: tc, container: tl, viewport: pg.vp, textDivs: [] }).promise;
      tl.addEventListener('mousedown', e => this.startTextSelect(e));
    } catch (err) { console.warn('Textebene', err); }
    pg.items = tc.items.filter(it => it.str && it.str.trim()).map(it => {
      const size = Math.hypot(it.transform[2], it.transform[3]) || 10;
      let bold = false;
      try { const f = pg.page.commonObjs.get(it.fontName); bold = /bold|black|heavy|semibold/i.test(f?.name || ''); } catch {}
      const item = { str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, size, bold };
      item.op = this.ops.find(o => o.type === 'replace' && o.page === pg.i && Math.abs(o.x - item.x) < 0.01 && Math.abs(o.y - item.y) < 0.01) || null;
      return item;
    });
    const annots = await pg.page.getAnnotations({ intent: 'display' });
    this.renderFields(pg, annots);
    this.renderTips(pg, annots);
    this.renderLinks(pg, annots, tc);
    if (this.tool === 'edit') this.showItems(pg);
    pg.box.classList.add('ready');
  }

  // ---- Links anklickbar machen (Webseiten, Sprünge im PDF, andere Dateien) ----
  renderLinks(pg, annots, tc) {
    const rects = [];
    const add = (x1, y1, x2, y2, target, title) => {
      const r = this.rectToView(pg, Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      if (r.width < 2 || r.height < 2) return;
      const el = document.createElement('div'); el.className = 'pdf-link'; el.title = title;
      el.onclick = e => { e.preventDefault(); e.stopPropagation(); this.followLink(target); };
      this.place(el, r);
      pg.layer.append(el);
      rects.push([Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)]);
    };
    for (const a of annots) {
      if (a.subtype !== 'Link' || !a.rect) continue;
      const url = a.url || a.unsafeUrl;
      let target = null, title = '';
      if (url) { target = { url }; title = 'Link öffnen: ' + url; }
      else if (a.dest) { target = { dest: a.dest }; title = 'Zur Stelle im Dokument springen'; }
      else if (a.action) { target = { action: a.action }; title = { NextPage: 'Nächste Seite', PrevPage: 'Vorherige Seite', FirstPage: 'Erste Seite', LastPage: 'Letzte Seite' }[a.action] || a.action; }
      if (target) add(a.rect[0], a.rect[1], a.rect[2], a.rect[3], target, title);
    }
    // Adressen, die nur als Text im PDF stehen (ohne echten Link), trotzdem anklickbar machen
    const re = /\b(?:https?:\/\/|www\.)[^\s<>"'()[\]{}]+|\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/gi;
    for (const it of tc.items) {
      const t = it.transform; const s = it.str;
      if (!s || !it.width || Math.abs(t[1]) > 0.01 || Math.abs(t[2]) > 0.01) continue;
      const size = Math.abs(t[3]) || 10;
      for (const m of s.matchAll(re)) {
        const text = m[0].replace(/[.,;:!?]+$/, ''); if (text.length < 5) continue;
        const x1 = t[4] + it.width * m.index / s.length, x2 = t[4] + it.width * (m.index + text.length) / s.length;
        const y1 = t[5] - size * 0.2, y2 = t[5] + size * 0.9;
        if (rects.some(r => x1 < r[2] && x2 > r[0] && y1 < r[3] && y2 > r[1])) continue;
        const url = /^https?:/i.test(text) ? text : /^www\./i.test(text) ? 'https://' + text : 'mailto:' + text;
        add(x1, y1, x2, y2, { url }, 'Link öffnen: ' + url);
      }
    }
  }

  async followLink(t) {
    if (t.dest) return this.goToDest(t.dest);
    if (t.action) {
      const cur = this.currentPage().i;
      const n = { NextPage: cur + 1, PrevPage: cur - 1, FirstPage: 1, LastPage: this.pages.length }[t.action];
      if (n) this.scrollToPage(n);
      return;
    }
    const url = t.url;
    // Sprungmarke im selben PDF (z. B. "#page=3" oder "#Kapitel2")
    if (url.startsWith('#')) {
      const frag = decodeURIComponent(url.slice(1));
      const page = /(?:^|&)page=(\d+)/.exec(frag);
      return page ? this.scrollToPage(Number(page[1])) : this.goToDest(frag);
    }
    if (this.opts.openLink) this.opts.openLink(url); else window.open(url, '_blank');
  }

  async goToDest(dest) {
    try {
      const d = typeof dest === 'string' ? await this.pdf.getDestination(dest) : dest;
      if (!Array.isArray(d)) { UI.toast('Sprungziel nicht gefunden'); return; }
      const idx = d[0] && typeof d[0] === 'object' ? await this.pdf.getPageIndex(d[0]) : Number(d[0]);
      const kind = d[1]?.name;
      const y = kind === 'XYZ' ? d[3] : kind === 'FitH' || kind === 'FitBH' ? d[2] : kind === 'FitR' ? d[5] : null;
      this.scrollToPage(idx + 1, typeof y === 'number' ? y : null);
    } catch (err) { console.warn('Sprungziel', err); UI.toast('Sprungziel nicht gefunden'); }
  }

  scrollToPage(n, y = null) {
    const pg = this.pages[n - 1]; const sc = this.host.closest('.view');
    if (!pg || !sc) return;
    this.backTo = sc.scrollTop;
    this.bar.querySelector('[data-back]').hidden = false;
    const off = y != null ? this.toView(pg, pg.vp.viewBox[0], y)[1] : 0;
    const top = sc.scrollTop + pg.box.getBoundingClientRect().top - sc.getBoundingClientRect().top + off - this.bar.offsetHeight - 16;
    sc.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    pg.box.classList.remove('flash'); void pg.box.offsetWidth; pg.box.classList.add('flash');
  }

  goBack() {
    const sc = this.host.closest('.view');
    if (sc && this.backTo != null) sc.scrollTo({ top: this.backTo, behavior: 'smooth' });
    this.backTo = null; this.bar.querySelector('[data-back]').hidden = true;
  }

  // ---- Formularfelder ausfüllen ----
  renderFields(pg, annots) {
    for (const a of annots) {
      if (a.subtype !== 'Widget' || !a.fieldName || a.hidden) continue;
      const r = this.rectToView(pg, a.rect[0], a.rect[1], a.rect[2] - a.rect[0], a.rect[3] - a.rect[1]);
      const name = a.fieldName; let el;
      if (a.fieldType === 'Tx') {
        el = document.createElement(a.multiLine ? 'textarea' : 'input');
        el.value = name in this.form ? this.form[name] : (a.fieldValue || '');
        const da = a.defaultAppearanceData?.fontSize;   // Größe aus dem PDF, 0 = automatisch
        el.style.fontSize = (da > 0 ? da : autoFieldPt(a.rect[3] - a.rect[1], a.multiLine)) * pg.vp.scale + 'px';
        el.oninput = () => { this.form[name] = el.value; this.opts.onDirty(); };
      } else if (a.fieldType === 'Btn' && a.checkBox) {
        el = Object.assign(document.createElement('input'), { type: 'checkbox' });
        el.checked = name in this.form ? !!this.form[name] : !!(a.fieldValue && a.fieldValue !== 'Off');
        el.onchange = () => { this.form[name] = el.checked; this.opts.onDirty(); };
      } else if (a.fieldType === 'Btn' && a.radioButton) {
        el = Object.assign(document.createElement('input'), { type: 'radio', name: 'pdfradio-' + name });
        el.checked = (name in this.form ? this.form[name] : a.fieldValue) === a.buttonValue;
        el.onchange = () => { if (el.checked) { this.form[name] = a.buttonValue; this.opts.onDirty(); } };
      } else if (a.fieldType === 'Ch') {
        el = document.createElement('select');
        for (const o of a.options || []) el.add(new Option(o.displayValue, o.exportValue));
        const v = name in this.form ? this.form[name] : (Array.isArray(a.fieldValue) ? a.fieldValue[0] : a.fieldValue);
        if (v) el.value = v;
        el.onchange = () => { this.form[name] = el.value; this.opts.onDirty(); };
      } else continue;
      if (el.tagName === 'SELECT') el.style.fontSize = Math.max(9, Math.min(r.height * 0.6, 16 * pg.vp.scale)) + 'px';
      if (a.readOnly) el.disabled = true;
      el.className = 'pdf-field'; el.dataset.field = name; el.title = name;
      this.place(el, r);
      pg.layer.append(el);
    }
  }

  // ---- Übersetzungen beim Drüberfahren: unsichtbare Schaltflächen mit Tooltip (/TU), z. B. über jedem Wort ----
  // Keine eigenen Elemente pro Wort, damit Markieren und Links darunter weiter funktionieren
  renderTips(pg, annots) {
    pg.tips = annots.filter(a => a.subtype === 'Widget' && a.fieldType === 'Btn' && a.pushButton && !a.hidden && a.alternativeText?.trim() && a.rect)
      .map(a => ({ r: this.rectToView(pg, a.rect[0], a.rect[1], a.rect[2] - a.rect[0], a.rect[3] - a.rect[1]), text: a.alternativeText }));
    if (!pg.tips.length) return;
    pg.box.addEventListener('mousemove', e => this.hoverTip(pg, e));
    pg.box.addEventListener('mouseleave', () => this.hideTip());
    if (!this.onTipScroll) this.host.closest('.view')?.addEventListener('scroll', this.onTipScroll = () => this.hideTip(), { passive: true });
  }

  hoverTip(pg, e) {
    if (this.tool !== 'select' || e.buttons) return this.hideTip();
    const b = pg.box.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
    const t = pg.tips.find(t => x >= t.r.left && x <= t.r.left + t.r.width && y >= t.r.top && y <= t.r.top + t.r.height);
    if (!t) return this.hideTip();
    if (this.tipFor === t) return;
    this.tipFor = t;
    if (!this.tipEl) { this.tipEl = document.createElement('div'); this.tipEl.className = 'pdf-tip'; this.host.append(this.tipEl); }
    if (!this.tipMark) { this.tipMark = document.createElement('div'); this.tipMark.className = 'pdf-tip-mark'; }
    pg.layer.append(this.tipMark); this.place(this.tipMark, t.r);
    // Zeilen "Begriff → Deutsch" beginnen einen Abschnitt, "EN: …" ist die englische Erklärung dazu
    const secs = [];
    for (const line of t.text.split(/\r\n|\r|\n/).filter(l => l.trim())) {
      const m = /^(.+?)\s+→\s+(.+)$/.exec(line), en = /^EN:\s*(.*)$/.exec(line);
      if (m) secs.push({ term: m[1], de: m[2], en: '' });
      else if (en && secs.length) secs[secs.length - 1].en = en[1];
      else secs.push({ term: '', de: line, en: '' });
    }
    this.tipEl.innerHTML = secs.map((s, i) => `<div class="tip-sec${i ? ' combo' : ''}">${s.term ? `<div class="tip-term">${MD.esc(s.term)}</div>` : ''}` +
      `<div class="tip-row"><b>DE</b><span>${MD.esc(s.de)}</span></div>${s.en ? `<div class="tip-row en"><b>EN</b><span>${MD.esc(s.en)}</span></div>` : ''}</div>`).join('');
    this.tipEl.hidden = false;
    // unter das Wort, bei Platzmangel darüber, nie aus dem Fenster heraus
    const w = this.tipEl.offsetWidth, h = this.tipEl.offsetHeight;
    const top = b.top + t.r.top + t.r.height + 6, left = Math.max(8, Math.min(b.left + t.r.left, innerWidth - w - 8));
    Object.assign(this.tipEl.style, { left: left + 'px', top: (top + h > innerHeight - 8 ? b.top + t.r.top - h - 6 : top) + 'px' });
  }

  hideTip() {
    if (!this.tipFor) return;
    this.tipFor = null; this.tipEl.hidden = true; this.tipMark.remove();
  }

  // ---- Text markieren: rastet immer am nächsten Buchstaben ein (auch wenn man neben dem Text startet) ----
  caretAt(x, y) {
    const hit = document.caretRangeFromPoint?.(x, y);
    if (hit && hit.startContainer.nodeType === 3 && hit.startContainer.parentElement?.closest('.textLayer')) return [hit.startContainer, hit.startOffset];
    // Seite unter dem Zeiger (oder die nächstgelegene) und dort das nächste Textstück suchen
    let best = null, bestD = Infinity;
    const boxes = this.pages.map(pg => pg.box).filter(b => { const r = b.getBoundingClientRect(); return r.bottom > y - 2000 && r.top < y + 2000; });
    for (const box of boxes) {
      for (const sp of box.querySelectorAll('.textLayer span')) {
        const t = sp.firstChild; if (!t || t.nodeType !== 3 || !t.length) continue;
        const r = sp.getBoundingClientRect(); if (!r.width) continue;
        const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
        const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
        const d = dy * 10 + dx;                      // gleiche Zeile ist wichtiger als der Abstand zur Seite
        if (d < bestD) { bestD = d; best = { t, r }; }
      }
    }
    if (!best) return null;
    if (x <= best.r.left) return [best.t, 0];
    if (x >= best.r.right) return [best.t, best.t.length];
    const inside = document.caretRangeFromPoint?.(x, Math.min(Math.max(y, best.r.top + 1), best.r.bottom - 1));
    if (inside && inside.startContainer === best.t) return [best.t, inside.startOffset];
    return [best.t, Math.round((x - best.r.left) / best.r.width * best.t.length)];
  }

  startTextSelect(e) {
    if (e.button !== 0 || this.tool !== 'select' || e.detail > 1 || e.shiftKey) return;   // Doppel-/Dreifachklick: Browser markiert Wort/Zeile
    const start = this.caretAt(e.clientX, e.clientY); if (!start) return;
    e.preventDefault();
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    const sel = getSelection(); sel.collapse(start[0], start[1]);
    const move = ev => { const p = this.caretAt(ev.clientX, ev.clientY); if (p) sel.setBaseAndExtent(start[0], start[1], p[0], p[1]); };
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  }

  buildBar() {
    const bar = document.createElement('div'); bar.className = 'doc-toolbar';
    bar.innerHTML = PDF_TOOLS.map(t => `<button class="tool" data-t="${t.id}" title="${t.hint}">${t.icon} ${t.label}</button>`).join('') +
      `<span class="sep"></span><label class="tool-opt" title="Schriftgröße für neuen Text">Aa <select data-size>${[8, 9, 10, 11, 12, 14, 16, 18, 24, 32].map(s => `<option ${s === 12 ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
       <label class="tool-opt" title="Farbe für Text und Zeichnungen"><input type="color" data-color value="${this.color}"></label>
       <button class="tool" data-undo title="Rückgängig (Strg+Z)">↶</button>
       <button class="tool" data-back hidden title="Zurück zur Stelle vor dem Link-Sprung">↩ Zurück</button>
       <span class="sep"></span><button class="tool" data-copyall title="Gesamten Text des PDFs in die Zwischenablage kopieren">📋 Kopieren</button>
       <span class="sep"></span><button class="tool" data-zoom="-1" title="Verkleinern">−</button><span class="tool-opt" data-zoomval>100%</span><button class="tool" data-zoom="1" title="Vergrößern">+</button>
       <span class="doc-hint"></span><button class="btn primary" data-save disabled>💾 Speichern</button>`;
    bar.querySelectorAll('[data-t]').forEach(b => b.onclick = () => (b.dataset.t === 'image' ? this.pickImage() : this.setTool(b.dataset.t)));
    bar.querySelector('[data-size]').onchange = e => (this.textSize = Number(e.target.value));
    bar.querySelector('[data-color]').oninput = e => (this.color = e.target.value);
    bar.querySelector('[data-undo]').onclick = () => this.undo();
    bar.querySelector('[data-back]').onclick = () => this.goBack();
    bar.querySelectorAll('[data-zoom]').forEach(b => b.onclick = () => { this.zoom = Math.max(0.4, Math.min(3, this.zoom * (b.dataset.zoom === '1' ? 1.2 : 1 / 1.2))); this.layout(true); });
    bar.querySelector('[data-save]').onclick = () => this.opts.onSave();
    bar.querySelector('[data-copyall]').onclick = () => this.copyAll();
    this.bar = bar; this.host.prepend(bar);
  }

  setTool(t) {
    this.tool = t;
    if (this.host.contains(document.activeElement) && document.activeElement.closest('.pdf-layer')) document.activeElement.blur();
    this.bar.querySelectorAll('[data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === t));
    this.bar.querySelector('.doc-hint').textContent = PDF_TOOLS.find(x => x.id === t).hint || '';
    this.host.dataset.tool = t;
    this.select(null);
    for (const op of this.ops) if (op.type === 'text' && op.el && document.activeElement !== op.el) op.el.contentEditable = t === 'select' ? 'false' : 'plaintext-only';
    for (const pg of this.pages || []) { pg.layer.querySelectorAll('.pdf-item').forEach(x => x.remove()); if (t === 'edit' && pg.items) this.showItems(pg); }
  }

  // ---- Koordinaten ----
  toView(pg, x, y) { return pg.vp.convertToViewportPoint(x, y); }
  toPdf(pg, e) { const r = pg.box.getBoundingClientRect(); return pg.vp.convertToPdfPoint(e.clientX - r.left, e.clientY - r.top); }
  rectToView(pg, x, y, w, h) {
    const [x1, y1] = this.toView(pg, x, y); const [x2, y2] = this.toView(pg, x + w, y + h);
    return { left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
  }
  place(el, r) { Object.assign(el.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' }); }
  currentPage() {
    const sc = this.host.closest('.view'); const mid = sc ? sc.getBoundingClientRect().top + sc.clientHeight / 2 : innerHeight / 2;
    return this.pages.find(pg => { const r = pg.box.getBoundingClientRect(); return r.top <= mid && r.bottom >= mid; }) || this.pages[0];
  }

  // ---- Vorhandenen Text ändern ----
  showItems(pg) {
    for (const it of pg.items) {
      if (it.op) continue;
      const d = document.createElement('div'); d.className = 'pdf-item';
      this.place(d, this.rectToView(pg, it.x, it.y - it.size * 0.25, it.w, it.size * 1.2));
      d.title = 'Klicken zum Ändern: ' + it.str;
      d.onclick = e => { e.stopPropagation(); d.remove(); this.editItem(pg, it); };
      pg.layer.append(d);
    }
  }

  editItem(pg, it) {
    const op = { type: 'replace', page: pg.i, x: it.x, y: it.y, w: it.w, size: it.size, bold: it.bold, text: it.str, orig: it.str,
      box: { x: it.x - 1, y: it.y - it.size * 0.28, w: it.w + 2, h: it.size * 1.3 } };
    it.op = op;
    this.ops.push(op); this.mountOp(op);
    Caret.set(op.el, null);
    this.opts.onDirty();
    return op;
  }

  // ---- Objekte (Text, Rechtecke, Zeichnungen, Bilder) anzeigen ----
  mountOp(op) {
    const pg = this.pages?.[op.page - 1]; if (!pg) return;
    op.el?.remove();
    const scale = pg.vp.scale;
    let el;
    if (op.type === 'replace') {
      el = document.createElement('div'); el.className = 'pdf-edit'; el.contentEditable = 'plaintext-only'; el.textContent = op.text;
      el.style.fontWeight = op.bold ? '700' : '400';
      el.oninput = () => { op.text = el.textContent.replace(/\n/g, ' '); this.opts.onDirty(); };
      el.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } };
    } else if (op.type === 'text') {
      el = document.createElement('div'); el.className = 'pdf-newtext pdf-obj';
      el.contentEditable = this.tool === 'select' ? 'false' : 'plaintext-only';
      el.textContent = op.text; el.style.color = op.color;
      el.oninput = () => { op.text = el.innerText.replace(/\n$/, ''); this.opts.onDirty(); };
      el.onblur = () => { if (!op.text.trim()) this.removeOp(op); else if (this.tool === 'select') el.contentEditable = 'false'; };
      el.ondblclick = () => { el.contentEditable = 'plaintext-only'; Caret.set(el, null); };
    } else if (op.type === 'rect') {
      el = document.createElement('div'); el.className = (op.kind === 'erase' ? 'pdf-erase' : 'pdf-mark') + ' pdf-obj';
    } else if (op.type === 'image') {
      el = document.createElement('div'); el.className = 'pdf-img pdf-obj';
      el.innerHTML = `<img src="${op.url}" alt="" draggable="false"><span class="pdf-resize" title="Größe ändern"></span>`;
      el.querySelector('.pdf-resize').addEventListener('pointerdown', e => this.startResize(e, op));
    } else if (op.type === 'ink') {
      el = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      el.setAttribute('fill', 'none'); el.setAttribute('stroke', op.color); el.setAttribute('stroke-width', op.width * scale);
      el.setAttribute('stroke-linecap', 'round'); el.setAttribute('stroke-linejoin', 'round'); el.classList.add('pdf-obj');
      pg.svg.append(el);
    }
    el.__op = op; op.el = el;
    if (op.type !== 'ink') pg.layer.append(el);
    this.positionOp(op);
  }

  positionOp(op) {
    const pg = this.pages[op.page - 1]; const el = op.el; if (!pg || !el) return;
    const scale = pg.vp.scale;
    if (op.type === 'replace') {
      const r = this.rectToView(pg, op.box.x, op.box.y, op.box.w, op.box.h);
      Object.assign(el.style, { left: r.left + 'px', top: r.top + 'px', minWidth: r.width + 'px', height: r.height + 'px', fontSize: op.size * scale + 'px', lineHeight: r.height + 'px' });
    } else if (op.type === 'text') {
      const [vx, vy] = this.toView(pg, op.x, op.y + op.size);
      Object.assign(el.style, { left: vx + 'px', top: vy + 'px', fontSize: op.size * scale + 'px' });
    } else if (op.type === 'rect' || op.type === 'image') {
      this.place(el, this.rectToView(pg, op.x, op.y, op.w, op.h));
    } else if (op.type === 'ink') {
      el.setAttribute('points', op.points.map(p => this.toView(pg, p[0], p[1]).join(',')).join(' '));
    }
  }

  removeOp(op) {
    op.el?.remove();
    this.ops = this.ops.filter(o => o !== op);
    if (op.type === 'replace') {
      const pg = this.pages[op.page - 1]; const it = pg?.items?.find(i => i.op === op);
      if (it) it.op = null;
      if (this.tool === 'edit' && pg) { pg.layer.querySelectorAll('.pdf-item').forEach(x => x.remove()); this.showItems(pg); }
    }
    if (this.sel === op) this.sel = null;
    this.opts.onDirty();
  }

  select(op) {
    this.sel?.el?.classList.remove('selected');
    this.sel = op;
    op?.el?.classList.add('selected');
  }

  onKey(e) {
    if (!this.host.isConnected) return;
    const mod = e.ctrlKey || e.metaKey;
    const typing = e.target.closest && e.target.closest('[contenteditable="true"],[contenteditable="plaintext-only"],input,textarea,select');
    if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); this.undo(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel && !typing) { e.preventDefault(); this.removeOp(this.sel); }
    if (e.key === 'Escape') this.select(null);
  }

  // ---- Maus: neue Objekte erstellen / verschieben ----
  bindPage(pg) {
    pg.box.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const obj = e.target.closest('.pdf-obj');
      if (obj && this.tool === 'select') { e.preventDefault(); this.startMove(e, pg, obj.__op); return; }
      if (e.target.closest('.pdf-edit,.pdf-newtext,.pdf-item,.pdf-field,.pdf-link,.pdf-page-tools,.pdf-resize')) return;
      const t = this.tool;
      if (t === 'select') { this.select(null); return; }
      if (t === 'text') {
        e.preventDefault();
        const [x, y] = this.toPdf(pg, e);
        const op = { type: 'text', page: pg.i, x, y: y - this.textSize, size: this.textSize, color: this.color, text: '' };
        this.ops.push(op); this.mountOp(op);
        setTimeout(() => op.el.focus(), 0);
        return;
      }
      if (t === 'erase' || t === 'highlight') {
        e.preventDefault();
        const start = this.toPdf(pg, e);
        const op = { type: 'rect', page: pg.i, kind: t, x: start[0], y: start[1], w: 0, h: 0 };
        this.mountOp(op);
        this.track(ev => {
          const p = this.toPdf(pg, ev);
          op.x = Math.min(start[0], p[0]); op.y = Math.min(start[1], p[1]); op.w = Math.abs(p[0] - start[0]); op.h = Math.abs(p[1] - start[1]);
          this.positionOp(op);
        }, () => { if (op.w < 2 || op.h < 2) op.el.remove(); else { this.ops.push(op); this.opts.onDirty(); } });
        return;
      }
      if (t === 'draw') {
        e.preventDefault();
        const op = { type: 'ink', page: pg.i, color: this.color, width: 2, points: [this.toPdf(pg, e)] };
        this.mountOp(op);
        this.track(ev => { op.points.push(this.toPdf(pg, ev)); this.positionOp(op); },
          () => { if (op.points.length > 1) { this.ops.push(op); this.opts.onDirty(); } else op.el.remove(); });
      }
    });
  }

  track(move, up) {
    const mv = ev => move(ev);
    const u = ev => { removeEventListener('pointermove', mv); removeEventListener('pointerup', u); up(ev); };
    addEventListener('pointermove', mv); addEventListener('pointerup', u);
  }

  startMove(e, pg, op) {
    if (document.activeElement && document.activeElement.closest?.('.pdf-layer')) document.activeElement.blur();
    this.select(op);
    if (op.type === 'replace') return;
    let last = this.toPdf(pg, e); let moved = false;
    this.track(ev => {
      const p = this.toPdf(pg, ev); const dx = p[0] - last[0], dy = p[1] - last[1]; last = p;
      if (op.type === 'ink') op.points = op.points.map(q => [q[0] + dx, q[1] + dy]);
      else { op.x += dx; op.y += dy; }
      moved = true; this.positionOp(op);
    }, () => { if (moved) this.opts.onDirty(); });
  }

  startResize(e, op) {
    e.preventDefault(); e.stopPropagation();
    const pg = this.pages[op.page - 1]; const ratio = op.h / op.w; const top = op.y + op.h;
    this.select(op);
    this.track(ev => {
      const p = this.toPdf(pg, ev);
      op.w = Math.max(10, p[0] - op.x); op.h = op.w * ratio; op.y = top - op.h;
      this.positionOp(op);
    }, () => this.opts.onDirty());
  }

  // ---- Bild einfügen ----
  pickImage() {
    this.opts.pickFiles('image/*', async ([file]) => {
      if (!file) return;
      try { await this.addImage(file); } catch (err) { UI.toast('Bild konnte nicht eingefügt werden: ' + err.message, true); }
    });
  }

  async addImage(file, pageNo) {
    const url = URL.createObjectURL(file);
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Bildformat nicht lesbar')); i.src = url; });
    let bytes, kind;
    if (file.type === 'image/png' || file.type === 'image/jpeg') { bytes = new Uint8Array(await file.arrayBuffer()); kind = file.type === 'image/png' ? 'png' : 'jpg'; }
    else {
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0);
      bytes = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/png'))).arrayBuffer()); kind = 'png';
    }
    const pg = pageNo ? this.pages[pageNo - 1] : this.currentPage();
    const [pw, ph] = [pg.vp.viewBox[2] - pg.vp.viewBox[0], pg.vp.viewBox[3] - pg.vp.viewBox[1]];
    const w = Math.min(200, pw * 0.4); const h = w * img.naturalHeight / img.naturalWidth;
    const op = { type: 'image', page: pg.i, x: pg.vp.viewBox[0] + (pw - w) / 2, y: pg.vp.viewBox[1] + (ph - h) / 2, w, h, bytes, kind, url };
    this.ops.push(op); this.mountOp(op);
    this.setTool('select'); this.select(op);
    this.opts.onDirty();
    return op;
  }

  // ---- Seiten drehen / löschen (wird sofort gespeichert) ----
  pageOp(type, i) {
    if (type === 'delete') {
      if (this.pdf.numPages - this.pageOps.filter(p => p.type === 'delete').length <= 1) { UI.toast('Die letzte Seite kann nicht gelöscht werden'); return; }
      if (!confirm(`Seite ${i} aus dem PDF löschen?`)) return;
    }
    this.pageOps.push({ type, page: i });
    this.opts.onSave();
  }

  // Kompletten Text aller Seiten (Zeilenumbrüche wie im PDF)
  async allText() {
    const pages = [];
    for (let i = 1; i <= this.pdf.numPages; i++) {
      const tc = await (await this.pdf.getPage(i)).getTextContent();
      pages.push(tc.items.map(it => (it.str || '') + (it.hasEOL ? '\n' : '')).join('').replace(/[ \t]+\n/g, '\n').trim());
    }
    return pages.join('\n\n');
  }

  async copyAll() {
    const text = await this.allText();
    if (!text.trim()) { UI.toast('Dieses PDF enthält keinen Text (vermutlich eingescannt) – nichts zum Kopieren', true); return ''; }
    try { await navigator.clipboard.writeText(text); }
    catch { const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); }
    UI.toast(`✓ Text kopiert (${text.length.toLocaleString('de-DE')} Zeichen, ${this.pdf.numPages} Seite${this.pdf.numPages > 1 ? 'n' : ''})`);
    return text;
  }

  undo() {
    const op = this.ops[this.ops.length - 1];
    if (!op) { UI.toast('Nichts zum Rückgängigmachen'); return; }
    this.removeOp(op);
  }

  isDirty() { return this.pageOps.length > 0 || Object.keys(this.form).length > 0 || this.ops.some(o => o.type !== 'replace' || o.text !== o.orig); }

  async getBytes() {
    const { PDFDocument, StandardFonts, rgb, degrees } = PDFLib;
    const doc = await PDFDocument.load(this.bytes, { ignoreEncryption: true, updateMetadata: false });
    let reg, bold, unicode = false;
    try {
      if (typeof fontkit === 'undefined') throw new Error('kein fontkit');
      doc.registerFontkit(fontkit);
      const [a, b] = await Promise.all(['/fonts/arial.ttf', '/fonts/arialbd.ttf'].map(async u => { const r = await fetch(u); if (!r.ok) throw new Error(u); return r.arrayBuffer(); }));
      reg = await doc.embedFont(a, { subset: true }); bold = await doc.embedFont(b, { subset: true }); unicode = true;
    } catch {
      reg = await doc.embedFont(StandardFonts.Helvetica); bold = await doc.embedFont(StandardFonts.HelveticaBold);
    }
    const safe = (s, font) => [...s].map(ch => {
      if (ch === '\t') return ' ';
      if (ch === '\n' || ch === '\r') return ch;     // Zeilenumbrüche behalten (mehrzeilige Felder, Text)
      if (unicode) return font.getCharacterSet().includes(ch.codePointAt(0)) ? ch : '?';
      try { font.encodeText(ch); return ch; } catch { return '?'; }
    }).join('');
    const hex = h => { const n = parseInt(h.slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };

    // „automatische“ Schriftgröße wie in der Anzeige fest eintragen – sonst rechnet pdf-lib sie passend zum Kästchen aus
    const fixAutoSize = f => {
      for (const w of f.acroField.getWidgets()) {
        const da = w.getDefaultAppearance() ?? f.acroField.getDefaultAppearance();
        if (da && /(^|\s)0(\.0+)?\s+Tf/.test(da))
          w.setDefaultAppearance(da.replace(/(^|\s)0(\.0+)?(\s+Tf)/, `$1${autoFieldPt(w.getRectangle().height, f.isMultiline())}$3`));
      }
    };

    // Formularfelder
    if (Object.keys(this.form).length) {
      const form = doc.getForm();
      for (const [name, val] of Object.entries(this.form)) {
        try {
          const f = form.getField(name);
          if (f instanceof PDFLib.PDFTextField) { f.setText(safe(String(val), reg)); fixAutoSize(f); }
          else if (f instanceof PDFLib.PDFCheckBox) val ? f.check() : f.uncheck();
          else if (f instanceof PDFLib.PDFRadioGroup) { const o = f.getOptions(); f.select(o.includes(val) ? val : (/^\d+$/.test(val) && o[+val]) || val); }
          else if (f instanceof PDFLib.PDFDropdown || f instanceof PDFLib.PDFOptionList) f.select(val);
        } catch (err) { console.warn('Feld', name, err); }
      }
      try { form.updateFieldAppearances(reg); } catch {}
    }

    const images = new Map();
    for (const op of this.ops) {
      const page = doc.getPage(op.page - 1);
      if (op.type === 'replace') {
        if (op.text === op.orig) continue;
        const font = op.bold ? bold : reg;
        const text = safe(op.text, font);
        const w = Math.max(op.box.w, font.widthOfTextAtSize(text, op.size) + 3);
        page.drawRectangle({ x: op.box.x, y: op.box.y, width: w, height: op.box.h, color: rgb(1, 1, 1) });
        if (text.trim()) page.drawText(text, { x: op.x, y: op.y, size: op.size, font, color: rgb(0, 0, 0) });
      } else if (op.type === 'text') {
        safe(op.text, reg).split('\n').forEach((l, i) => page.drawText(l, { x: op.x, y: op.y - i * op.size * 1.2, size: op.size, font: reg, color: hex(op.color) }));
      } else if (op.type === 'rect') {
        page.drawRectangle({ x: op.x, y: op.y, width: op.w, height: op.h, color: op.kind === 'erase' ? rgb(1, 1, 1) : rgb(1, 0.92, 0.23), opacity: op.kind === 'erase' ? 1 : 0.4 });
      } else if (op.type === 'ink') {
        for (let i = 1; i < op.points.length; i++) {
          const [x1, y1] = op.points[i - 1], [x2, y2] = op.points[i];
          page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: op.width, color: hex(op.color), lineCap: 1 });
        }
      } else if (op.type === 'image') {
        if (!images.has(op)) images.set(op, op.kind === 'png' ? await doc.embedPng(op.bytes) : await doc.embedJpg(op.bytes));
        page.drawImage(images.get(op), { x: op.x, y: op.y, width: op.w, height: op.h });
      }
    }

    for (const p of this.pageOps.filter(p => p.type === 'rotate')) {
      const page = doc.getPage(p.page - 1); page.setRotation(degrees((page.getRotation().angle + 90) % 360));
    }
    for (const n of [...new Set(this.pageOps.filter(p => p.type === 'delete').map(p => p.page))].sort((a, b) => b - a)) doc.removePage(n - 1);
    return doc.save();
  }
}
