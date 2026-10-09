// ================== Textdateien (.txt, .log, Code …) ==================
// Ein normales Textfeld mit Werkzeugleiste: Suchen & Ersetzen, Zeilenumbruch, Schrift, Schriftgröße, „Alles kopieren“
// und einer Statuszeile (Zeile, Spalte, Wörter, Zeichen). Suchtreffer werden auf einer unsichtbaren Kopie des Textes
// hinter dem Textfeld eingefärbt (CSS Custom Highlight API) – das Textfeld selbst bleibt ein ganz normales <textarea>.

const TXT_SIZES = [11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32];
// Fließtext liest sich in normaler Schrift mit Zeilenumbruch besser, Code eher in Festbreitenschrift ohne Umbruch
const TXT_PROSE = ['.txt', '.log', '.rst', '.adoc', '.tex', '.wt', ''];
const TXT_MAX_HITS = 5000;
const TXT_READ_WIDTH = 860;             // Lesebreite für Fließtext mit Zeilenumbruch (px)

class TextEditor {
  constructor(host, text, opts) {
    this.host = host; this.opts = opts;
    this.prose = TXT_PROSE.includes((opts.ext || '').toLowerCase());
    this.prefKey = 'text.' + (this.prose ? 'prose' : 'code');
    this.pref = { wrap: this.prose, mono: !this.prose, size: this.prose ? 16 : 14, ...opts.store.get(this.prefKey, {}) };
    this.hits = []; this.cur = -1; this.caseSens = false; this.anchor = 0; this.layerText = null;

    host.insertAdjacentHTML('beforeend', `<div class="doc-toolbar txt-bar">
        <button class="tool" data-a="find" title="Im Text suchen (Strg+F)">🔍 Suchen</button>
        <button class="tool" data-a="replace" title="Suchen und ersetzen (Strg+H)">⇄ Ersetzen</button>
        <span class="sep"></span>
        <button class="tool" data-a="wrap" title="Lange Zeilen am Fensterrand umbrechen">↩️ Zeilenumbruch</button>
        <button class="tool" data-a="mono" title="Zwischen normaler Schrift und Festbreitenschrift (für Code und Tabellen) wechseln"></button>
        <span class="tool-opt"><button class="tool" data-a="smaller" title="Schrift kleiner (Strg+Minus)">A−</button><span class="txt-size" data-size title="Schriftgröße (Strg+0 = Standard)"></span><button class="tool" data-a="bigger" title="Schrift größer (Strg+Plus)">A+</button></span>
        <span class="sep"></span>
        <button class="tool" data-a="copy" title="Den ganzen Text in die Zwischenablage kopieren">📋 Alles kopieren</button>
      </div>
      <div class="txt-find" hidden>
        <input data-q placeholder="Suchen …" spellcheck="false" autocomplete="off">
        <span class="txt-count" data-count></span>
        <button class="tool" data-a="prev" title="Vorheriger Treffer (Umschalt+Enter)">↑</button>
        <button class="tool" data-a="next" title="Nächster Treffer (Enter / F3)">↓</button>
        <button class="tool" data-a="case" title="Groß- und Kleinschreibung beachten">Aa</button>
        <span class="txt-rep">
          <span class="sep"></span>
          <input data-r placeholder="Ersetzen durch …" spellcheck="false" autocomplete="off">
          <button class="tool" data-a="rep1" title="Diesen Treffer ersetzen (Enter im Ersetzen-Feld)">Ersetzen</button>
          <button class="tool" data-a="repAll" title="Alle Treffer ersetzen (Strg+Z macht es rückgängig)">Alle ersetzen</button>
        </span>
        <button class="tool txt-x" data-a="close" title="Suche schließen (Esc)">✕</button>
      </div>
      <div class="text-view txt-edit"><div class="txt-mirror" aria-hidden="true"><div class="txt-layer"></div></div><textarea spellcheck="false" placeholder="Schreib hier deinen Text …"></textarea></div>
      <div class="txt-status"><span>Strg+A alles markieren · Strg+F suchen · Strg+H ersetzen · Strg+Mausrad Schriftgröße</span><span data-stats></span></div>`);
    const $ = s => host.querySelector(s);
    this.bar = $('.txt-bar'); this.findBar = $('.txt-find'); this.box = $('.txt-edit');
    this.mirror = $('.txt-mirror'); this.layer = $('.txt-layer'); this.ta = $('.txt-edit textarea');
    this.q = $('[data-q]'); this.r = $('[data-r]'); this.count = $('[data-count]'); this.stats = $('[data-stats]');
    this.ta.value = text;

    host.querySelectorAll('[data-a]').forEach(b => {
      b.addEventListener('mousedown', e => e.preventDefault());   // Fokus und Markierung bleiben, wo sie sind
      b.addEventListener('click', () => this.action(b.dataset.a));
    });
    this.bindText(); this.bindFind();
    this.onDocKey = e => this.onKey(e);
    this.onSel = () => { if (document.activeElement === this.ta) this.queueStats(); };
    document.addEventListener('keydown', this.onDocKey);
    document.addEventListener('selectionchange', this.onSel);
    this.resizeObs = new ResizeObserver(() => this.layout());
    this.resizeObs.observe(this.box);
    this.applyPref(false);
    this.updateStats(true);
  }

  destroy() {
    document.removeEventListener('keydown', this.onDocKey);
    document.removeEventListener('selectionchange', this.onSel);
    this.resizeObs.disconnect(); clearTimeout(this.searchTimer); clearTimeout(this.statsTimer);
    this.clearMarks();
  }

  get value() { return this.ta.value; }

  // Text von außen ersetzen (Datei wurde im Ordner geändert) – Cursor möglichst behalten
  setText(t) {
    const s = this.ta.selectionStart, top = this.ta.scrollTop;
    this.ta.value = t;
    this.ta.selectionStart = this.ta.selectionEnd = Math.min(s, t.length);
    this.ta.scrollTop = top;
    this.updateStats(true);
    if (!this.findBar.hidden) this.search(false);
  }

  focus() {
    this.ta.focus({ preventScroll: true });
    this.ta.setSelectionRange(0, 0); this.ta.scrollTop = 0;
  }

  action(a) {
    if (a === 'find' || a === 'replace') {
      // nochmal klicken schließt die Leiste wieder
      if (!this.findBar.hidden && this.findBar.classList.contains('with-rep') === (a === 'replace')) return this.closeFind();
      return this.openFind(a);
    }
    if (a === 'wrap') { this.pref.wrap = !this.pref.wrap; return this.applyPref(); }
    if (a === 'mono') { this.pref.mono = !this.pref.mono; return this.applyPref(); }
    if (a === 'smaller' || a === 'bigger') return this.zoom(a === 'bigger' ? 1 : -1);
    if (a === 'copy') return this.copyAll();
    if (a === 'prev' || a === 'next') return this.step(a === 'next' ? 1 : -1);
    if (a === 'case') { this.caseSens = !this.caseSens; this.findBar.querySelector('[data-a=case]').classList.toggle('on', this.caseSens); return this.search(true); }
    if (a === 'rep1') return this.replaceOne();
    if (a === 'repAll') return this.replaceAll();
    if (a === 'close') return this.closeFind();
  }

  // ---------- Darstellung ----------
  applyPref(save = true) {
    const p = this.pref;
    this.box.classList.toggle('nowrap', !p.wrap);
    this.box.classList.toggle('mono', p.mono);
    this.box.style.setProperty('--txt-size', p.size + 'px');
    this.bar.querySelector('[data-a=wrap]').classList.toggle('on', p.wrap);
    this.bar.querySelector('[data-a=mono]').textContent = p.mono ? '⌨️ Schrift: Code' : '🔤 Schrift: Normal';
    this.bar.querySelector('[data-size]').textContent = p.size;
    if (save) this.opts.store.set(this.prefKey, p);
    this.layout();
    if (this.hits.length && this.cur >= 0) this.reveal();
  }

  zoom(dir) {
    const i = TXT_SIZES.indexOf(this.pref.size);
    const next = dir === 0 ? (this.prose ? 16 : 14) : TXT_SIZES[Math.max(0, Math.min(TXT_SIZES.length - 1, (i < 0 ? 4 : i) + dir))];
    if (next === this.pref.size) return;
    this.pref.size = next; this.applyPref();
  }

  // Unsichtbare Kopie genau so groß wie die Textfläche des Textfelds (ohne Scrollbalken) halten
  layout() {
    const box = this.box, ta = this.ta;
    const pad = this.prose && this.pref.wrap ? Math.max(32, Math.round((box.clientWidth - TXT_READ_WIDTH) / 2)) : 32;
    box.style.setProperty('--txt-pad', pad + 'px');
    this.mirror.style.width = ta.clientWidth + 'px';
    this.mirror.style.height = ta.clientHeight + 'px';
    this.syncScroll();
  }

  syncScroll() { this.layer.style.transform = `translate(${-this.ta.scrollLeft}px, ${-this.ta.scrollTop}px)`; }

  // ---------- Textfeld ----------
  bindText() {
    const ta = this.ta;
    ta.addEventListener('input', () => {
      this.opts.onInput?.();
      this.queueStats(true);
      if (!this.findBar.hidden) { clearTimeout(this.searchTimer); this.searchTimer = setTimeout(() => this.search(false), 150); }
    });
    ta.addEventListener('scroll', () => { if (this.layerText !== null) this.syncScroll(); });
    for (const ev of ['select', 'keyup', 'mouseup']) ta.addEventListener(ev, () => this.queueStats());
    ta.addEventListener('keydown', e => {
      if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); this.indent(e.shiftKey); }
    });
    // Strg+Mausrad = Schriftgröße
    ta.addEventListener('wheel', e => { if (!e.ctrlKey) return; e.preventDefault(); this.zoom(e.deltaY < 0 ? 1 : -1); }, { passive: false });
  }

  // Einfügen/Ersetzen über den Browser, damit Strg+Z weiter funktioniert
  insert(text) {
    if (text === '' && this.ta.selectionStart !== this.ta.selectionEnd) document.execCommand('delete');
    else if (text !== '') document.execCommand('insertText', false, text);
  }

  // Tab: einrücken · mit markierten Zeilen alle einrücken · Umschalt+Tab: ausrücken
  indent(out) {
    const ta = this.ta, v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    if (s === e && !out) return this.insert('    ');
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    let le = v.indexOf('\n', e > s && v[e - 1] === '\n' ? e - 1 : e); if (le < 0) le = v.length;
    const block = v.slice(ls, le);
    const res = out ? block.replace(/^(\t| {1,4})/gm, '') : block.replace(/^(?=.)/gm, '    ');
    if (res === block) return;
    ta.setSelectionRange(ls, le); this.insert(res);
    if (s === e) { const p = Math.max(ls, s - (block.length - res.length)); ta.setSelectionRange(p, p); }
    else ta.setSelectionRange(ls, ls + res.length);
  }

  async copyAll() {
    const v = this.ta.value;
    if (!v) { UI.toast('Die Datei ist noch leer'); return; }
    try { await navigator.clipboard.writeText(v); }
    catch { const { selectionStart: s, selectionEnd: e } = this.ta; this.ta.focus(); this.ta.select(); document.execCommand('copy'); this.ta.setSelectionRange(s, e); }
    const n = TextEditor.lineCount(v);
    UI.toast(`📋 Ganzer Text kopiert (${n.toLocaleString('de-DE')} ${n === 1 ? 'Zeile' : 'Zeilen'})`);
  }

  // ---------- Statuszeile ----------
  static lineCount(v) { let n = 1, i = -1; while ((i = v.indexOf('\n', i + 1)) >= 0) n++; return n; }
  static wordCount(v) { return (v.match(/[\p{L}\p{N}]+(?:['’\-.][\p{L}\p{N}]+)*/gu) || []).length; }

  queueStats(full) {
    if (full) this.statsDirty = true;
    clearTimeout(this.statsTimer);
    this.statsTimer = setTimeout(() => this.updateStats(this.statsDirty), full ? 200 : 30);
  }

  updateStats(full) {
    const v = this.ta.value, s = this.ta.selectionStart, e = this.ta.selectionEnd;
    if (full || this.words == null) { this.words = TextEditor.wordCount(v); this.lines = TextEditor.lineCount(v); this.statsDirty = false; }
    const de = n => n.toLocaleString('de-DE');
    const line = TextEditor.lineCount(v.slice(0, s)), col = s - v.lastIndexOf('\n', s - 1);
    let t = `Zeile ${de(line)} von ${de(this.lines)} · Spalte ${de(col)} · ${de(this.words)} ${this.words === 1 ? 'Wort' : 'Wörter'} · ${de(v.length)} Zeichen`;
    if (e > s) { const w = TextEditor.wordCount(v.slice(s, e)); t = `Markiert: ${de(w)} ${w === 1 ? 'Wort' : 'Wörter'}, ${de(e - s)} Zeichen · ` + t; }
    this.stats.textContent = t;
  }

  // ---------- Suchen & Ersetzen ----------
  bindFind() {
    this.q.addEventListener('input', () => this.search(true));
    this.q.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); this.step(e.shiftKey ? -1 : 1); }
    });
    this.r.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); if (e.ctrlKey) this.replaceAll(); else this.replaceOne(); }
    });
  }

  // mode: 'find' = nur suchen · 'replace' = mit Ersetzen · 'keep' = wie gerade offen (Strg+F)
  openFind(mode) {
    const ta = this.ta, sel = ta.value.slice(ta.selectionStart, ta.selectionEnd), wasOpen = !this.findBar.hidden;
    const rep = mode === 'replace' || mode === 'keep' && wasOpen && this.findBar.classList.contains('with-rep');
    this.findBar.hidden = false;
    this.findBar.classList.toggle('with-rep', rep);
    this.bar.querySelector('[data-a=find]').classList.toggle('on', !rep);
    this.bar.querySelector('[data-a=replace]').classList.toggle('on', rep);
    if (sel && !sel.includes('\n') && sel.length <= 200) this.q.value = sel;
    this.anchor = ta.selectionStart;
    const field = rep && this.q.value ? this.r : this.q;
    field.focus(); field.select();
    this.layout();
    this.search(true);
  }

  closeFind() {
    this.findBar.hidden = true;
    this.bar.querySelector('[data-a=find]').classList.remove('on');
    this.bar.querySelector('[data-a=replace]').classList.remove('on');
    this.hits = []; this.cur = -1; this.clearMarks();
    this.ta.focus({ preventScroll: true });
  }

  clearMarks() {
    if (window.CSS?.highlights) { CSS.highlights.delete('txt-hit'); CSS.highlights.delete('txt-cur'); }
    this.layer.textContent = ''; this.layerText = null;
  }

  // Treffer suchen · fromAnchor: beim Tippen den ersten Treffer ab der Stelle, an der die Suche begann
  search(fromAnchor) {
    const v = this.ta.value, q = this.q.value;
    const prev = this.hits[this.cur];
    this.hits = [];
    if (q) {
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), this.caseSens ? 'g' : 'gi');
      let m; while ((m = re.exec(v)) && this.hits.length < TXT_MAX_HITS) this.hits.push([m.index, m.index + m[0].length]);
    }
    const from = fromAnchor || !prev ? this.anchor : prev[0];
    this.cur = this.hits.length ? Math.max(0, this.hits.findIndex(h => h[0] >= from)) : -1;   // keiner mehr danach → von vorne
    this.q.classList.toggle('none', !!q && !this.hits.length);
    this.paint();
    if (this.cur >= 0 && fromAnchor) this.reveal();
    this.showCount();
  }

  showCount() {
    const n = this.hits.length;
    this.count.textContent = !this.q.value ? '' : !n ? 'Keine Treffer' : `${(this.cur + 1).toLocaleString('de-DE')} von ${n.toLocaleString('de-DE')}${n >= TXT_MAX_HITS ? '+' : ''}`;
  }

  step(dir) {
    if (this.findBar.hidden) return this.openFind('find');
    if (!this.hits.length) { if (this.q.value) UI.toast('Keine Treffer für „' + this.q.value + '“'); return; }
    this.cur = (this.cur + dir + this.hits.length) % this.hits.length;
    this.paint(); this.reveal(); this.showCount();
  }

  // Kopie des Textes hinter dem Textfeld aktuell halten (nur solange gesucht wird)
  syncLayer() {
    const v = this.ta.value;
    if (this.layerText !== v) { this.layer.textContent = v + '\n'; this.layerText = v; }
    this.layout();
    return this.layer.firstChild;
  }

  paint() {
    if (!window.CSS?.highlights || !window.Highlight) return;   // ohne Highlight-API: Treffer werden trotzdem angesprungen
    if (!this.hits.length) { CSS.highlights.delete('txt-hit'); CSS.highlights.delete('txt-cur'); return; }
    const node = this.syncLayer();
    const all = new Highlight(), cur = new Highlight();
    this.hits.forEach(([s, e], i) => { const r = new Range(); r.setStart(node, s); r.setEnd(node, e); (i === this.cur ? cur : all).add(r); });
    cur.priority = 1;
    CSS.highlights.set('txt-hit', all); CSS.highlights.set('txt-cur', cur);
  }

  // Aktuellen Treffer markieren und ins Bild rollen (Position aus der unsichtbaren Kopie)
  reveal() {
    const hit = this.hits[this.cur]; if (!hit) return;
    const ta = this.ta;
    ta.setSelectionRange(hit[0], hit[1]);
    const node = this.syncLayer();
    const r = new Range(); r.setStart(node, hit[0]); r.setEnd(node, hit[1]);
    const rr = r.getBoundingClientRect(), lr = this.layer.getBoundingClientRect();
    const top = rr.top - lr.top, left = rr.left - lr.left;
    if (top < ta.scrollTop + 8 || top + rr.height > ta.scrollTop + ta.clientHeight - 8) ta.scrollTop = Math.max(0, top - ta.clientHeight / 3);
    if (left < ta.scrollLeft || left + rr.width > ta.scrollLeft + ta.clientWidth - 16) ta.scrollLeft = Math.max(0, left - ta.clientWidth / 3);
    this.syncScroll();
    this.queueStats();
  }

  replaceOne() {
    const hit = this.hits[this.cur];
    if (!hit) { if (this.q.value) UI.toast('Keine Treffer zum Ersetzen'); return; }
    const back = document.activeElement, rep = this.r.value;
    this.ta.focus({ preventScroll: true });
    this.ta.setSelectionRange(hit[0], hit[1]);
    this.insert(rep);
    this.anchor = hit[0] + rep.length;
    this.search(true);
    if (back && back !== this.ta) back.focus();
  }

  replaceAll() {
    const n = this.hits.length;
    if (!n) { if (this.q.value) UI.toast('Keine Treffer zum Ersetzen'); return; }
    const v = this.ta.value, rep = this.r.value, back = document.activeElement, top = this.ta.scrollTop;
    let out = '', last = 0;
    for (const [s, e] of this.hits) { out += v.slice(last, s) + rep; last = e; }
    out += v.slice(last);
    // in einem Schritt einsetzen → ein einziges Strg+Z holt alles zurück
    this.ta.focus({ preventScroll: true });
    this.ta.select(); this.insert(out);
    this.ta.setSelectionRange(0, 0); this.ta.scrollTop = top;
    this.anchor = 0;
    this.search(false);
    if (back && back !== this.ta) back.focus();
    UI.toast(`${n.toLocaleString('de-DE')} Treffer ersetzt · Strg+Z macht es rückgängig`);
  }

  // ---------- Tastatur ----------
  onKey(e) {
    if (!this.host.isConnected) return;
    const mod = (e.ctrlKey || e.metaKey) && !e.altKey, k = e.key.toLowerCase();
    const field = e.target.closest?.('input,textarea,select,[contenteditable="true"],[contenteditable="plaintext-only"]');
    const mine = e.target === this.ta || this.findBar.contains(e.target);
    if (field && !mine) return;                       // z. B. die Suche oben links
    const menu = document.getElementById('menu');
    if (menu && !menu.hidden) return;                 // ein Menü ist offen
    if (mod && !e.shiftKey && k === 'f') { e.preventDefault(); this.openFind('keep'); return; }
    if (mod && !e.shiftKey && k === 'h') { e.preventDefault(); this.openFind('replace'); return; }
    if (e.key === 'F3') { e.preventDefault(); this.step(e.shiftKey ? -1 : 1); return; }
    if (mod && (e.key === '+' || e.key === '=')) { e.preventDefault(); this.zoom(1); return; }
    if (mod && e.key === '-') { e.preventDefault(); this.zoom(-1); return; }
    if (mod && e.key === '0') { e.preventDefault(); this.zoom(0); return; }
    // Strg+A markiert immer den ganzen Text – auch wenn vorher woanders hingeklickt wurde
    if (mod && !e.shiftKey && k === 'a' && !field) { e.preventDefault(); this.ta.focus({ preventScroll: true }); this.ta.select(); this.queueStats(); return; }
    if (e.key === 'Escape' && !this.findBar.hidden) { e.preventDefault(); this.closeFind(); }
  }
}
