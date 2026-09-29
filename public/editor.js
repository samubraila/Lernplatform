// ================== Kleine UI-Helfer (Menüs, Toast) ==================
const UI = (() => {
  let st = null; // { items, sel, onClose }
  const el = () => document.getElementById('menu');

  function place(node, pos) {
    node.hidden = false;
    node.style.left = '0px'; node.style.top = '0px';
    const r = node.getBoundingClientRect();
    let x = pos.x, y = pos.y;
    if (x + r.width > innerWidth - 8) x = Math.max(8, innerWidth - r.width - 8);
    if (y + r.height > innerHeight - 8) y = Math.max(8, (pos.top ?? pos.y) - r.height - 6);
    node.style.left = x + 'px'; node.style.top = y + 'px';
  }

  function posFrom(anchor) {
    if (!anchor) return { x: innerWidth / 2 - 110, y: 120 };
    if (anchor.x !== undefined && anchor.getBoundingClientRect === undefined) return anchor;
    const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor;
    return { x: r.left, y: r.bottom + 6, top: r.top };
  }

  function menu(items, anchor, opts = {}) {
    const m = el();
    m.className = 'menu' + (opts.compact ? ' compact' : '');
    m.innerHTML = '';
    const selectable = [];
    if (opts.title) m.insertAdjacentHTML('beforeend', `<div class="m-title">${MD.esc(opts.title)}</div>`);
    if (!items.length) m.insertAdjacentHTML('beforeend', `<div class="m-empty">Keine Treffer</div>`);
    for (const it of items) {
      if (it === 'sep') { m.insertAdjacentHTML('beforeend', '<div class="m-sep"></div>'); continue; }
      if (it.title) { m.insertAdjacentHTML('beforeend', `<div class="m-title">${MD.esc(it.title)}</div>`); continue; }
      const b = document.createElement('button');
      b.className = 'm-item' + (it.danger ? ' danger' : '');
      b.innerHTML = `<span class="m-ico">${it.icon || ''}</span><span>${MD.esc(it.label)}${it.sub ? `<small>${MD.esc(it.sub)}</small>` : ''}</span>`;
      b.addEventListener('mousedown', e => e.preventDefault());
      b.addEventListener('click', () => { close(); it.run && it.run(); });
      b.addEventListener('mousemove', () => setSel(selectable.indexOf(b)));
      selectable.push(b); m.append(b);
    }
    st = { items: items.filter(i => i !== 'sep' && !i.title), btns: selectable, sel: 0, onClose: opts.onClose };
    setSel(0);
    place(m, posFrom(anchor));
  }

  function custom(node, anchor, opts = {}) {
    const m = el();
    m.className = 'menu' + (opts.compact ? ' compact' : '');
    m.innerHTML = ''; m.append(node);
    st = { items: [], btns: [], sel: 0, onClose: opts.onClose };
    place(m, posFrom(anchor));
  }

  function setSel(i) {
    if (!st || !st.btns.length) return;
    st.sel = (i + st.btns.length) % st.btns.length;
    st.btns.forEach((b, j) => b.classList.toggle('sel', j === st.sel));
    st.btns[st.sel].scrollIntoView({ block: 'nearest' });
  }

  function close() {
    if (!st) return;
    const cb = st.onClose; st = null; el().hidden = true;
    cb && cb();
  }

  // Tastatursteuerung, solange ein Menü offen ist. Gibt true zurück, wenn die Taste verbraucht wurde.
  function key(e) {
    if (!st) return false;
    if (e.key === 'ArrowDown') { setSel(st.sel + 1); e.preventDefault(); return true; }
    if (e.key === 'ArrowUp') { setSel(st.sel - 1); e.preventDefault(); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (!st.btns.length) { close(); return false; }
      e.preventDefault(); st.btns[st.sel].click(); return true;
    }
    if (e.key === 'Escape') { e.preventDefault(); close(); return true; }
    return false;
  }

  document.addEventListener('mousedown', e => { if (st && !el().contains(e.target)) close(); }, true);
  addEventListener('resize', close);

  let toastTimer;
  function toast(msg, err = false) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), err ? 4500 : 2200);
  }

  return { menu, custom, close, key, isOpen: () => !!st, toast };
})();

// ================== Cursor-Helfer ==================
const Caret = {
  offset(el) {
    const s = getSelection(); if (!s.rangeCount || !el.contains(s.anchorNode)) return 0;
    const r = s.getRangeAt(0); const pre = document.createRange();
    pre.selectNodeContents(el); pre.setEnd(r.startContainer, r.startOffset);
    return pre.toString().length;
  },
  set(el, offset = null) {
    el.focus({ preventScroll: true });
    const s = getSelection(); const r = document.createRange();
    if (offset == null) { r.selectNodeContents(el); r.collapse(false); }
    else {
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n, left = offset, done = false;
      while ((n = w.nextNode())) { if (left <= n.length) { r.setStart(n, left); r.collapse(true); done = true; break; } left -= n.length; }
      if (!done) { r.selectNodeContents(el); r.collapse(offset === 0); }
    }
    s.removeAllRanges(); s.addRange(r);
    const rect = (r.getClientRects()[0]) || el.getBoundingClientRect();
    const view = el.closest('.view');
    if (view) { const vr = view.getBoundingClientRect(); if (rect.bottom > vr.bottom - 40 || rect.top < vr.top + 10) el.scrollIntoView({ block: 'nearest' }); }
  },
  collapsed() { const s = getSelection(); return s.rangeCount && s.isCollapsed; },
  atStart(el) { return this.collapsed() && this.offset(el) === 0; },
  atEnd(el) { return this.collapsed() && this.offset(el) >= el.textContent.length; },
  rect() {
    const s = getSelection(); if (!s.rangeCount) return null;
    const r = s.getRangeAt(0).cloneRange(); r.collapse(true);
    return r.getClientRects()[0] || null;
  },
  edgeRect(el, start) {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n, pick = null;
    while ((n = w.nextNode())) { if (n.length) { pick = n; if (start) break; } }
    if (!pick) return null;
    const r = document.createRange(); r.setStart(pick, start ? 0 : pick.length); r.collapse(true);
    return r.getClientRects()[0] || null;
  },
  onFirstLine(el) { const c = this.rect(), e = this.edgeRect(el, true); return !c || !e || Math.abs(c.top - e.top) < 6; },
  onLastLine(el) { const c = this.rect(), e = this.edgeRect(el, false); return !c || !e || Math.abs(c.top - e.top) < 6; },
  removeLeading(el, n) {
    const r = document.createRange(); const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node, left = n, first = null;
    while ((node = w.nextNode())) { if (!first) { first = node; r.setStart(node, 0); } if (left <= node.length) { r.setEnd(node, left); break; } left -= node.length; }
    if (first) r.deleteContents();
  },
};

// ================== Block-Editor ==================
const LIST_TYPES = new Set(['ul', 'ol', 'todo']);
const TEXT_TYPES = new Set(['para', 'h1', 'h2', 'h3', 'ul', 'ol', 'todo', 'quote', 'callout']);
const PLACEHOLDER = { para: 'Tippe „/“ für Befehle …', h1: 'Überschrift 1', h2: 'Überschrift 2', h3: 'Überschrift 3', ul: 'Liste', ol: 'Liste', todo: 'To-do', quote: 'Zitat', callout: 'Notiz …' };
const BLOCK_TYPES = [
  { type: 'para', icon: 'Aa', label: 'Text', sub: 'Normaler Absatz', keys: 'text absatz paragraph' },
  { type: 'h1', icon: 'H1', label: 'Überschrift 1', sub: 'Große Überschrift', keys: 'heading h1 titel ueberschrift' },
  { type: 'h2', icon: 'H2', label: 'Überschrift 2', sub: 'Mittlere Überschrift', keys: 'heading h2 ueberschrift' },
  { type: 'h3', icon: 'H3', label: 'Überschrift 3', sub: 'Kleine Überschrift', keys: 'heading h3 ueberschrift' },
  { type: 'ul', icon: '•', label: 'Aufzählung', sub: 'Einfache Liste', keys: 'liste bullet list ul' },
  { type: 'ol', icon: '1.', label: 'Nummerierte Liste', sub: 'Liste mit Nummern', keys: 'nummer numbered ol liste' },
  { type: 'todo', icon: '☑', label: 'To-do-Liste', sub: 'Aufgaben zum Abhaken', keys: 'todo aufgabe checkbox check' },
  { type: 'quote', icon: '❝', label: 'Zitat', sub: 'Zitat hervorheben', keys: 'zitat quote' },
  { type: 'callout', icon: '💡', label: 'Hinweis-Box', sub: 'Wichtiges hervorheben', keys: 'callout hinweis box info merke' },
  { type: 'code', icon: '</>', label: 'Code', sub: 'Code-Block', keys: 'code programm snippet' },
];
const INSERT_TYPES = [
  { cmd: 'image', icon: '🖼️', label: 'Bild', sub: 'Bild hochladen', keys: 'bild image foto picture' },
  { cmd: 'file', icon: '📎', label: 'Datei', sub: 'Datei anhängen', keys: 'datei file anhang pdf' },
  { cmd: 'divider', icon: '—', label: 'Trennlinie', sub: 'Abschnitte trennen', keys: 'trenn linie divider hr' },
  { cmd: 'table', icon: '▦', label: 'Tabelle', sub: 'Tabelle mit Zeilen und Spalten', keys: 'tabelle table raster' },
];
let blockSeq = 0;

class Editor {
  constructor(host, opts) {
    this.host = host; this.opts = opts; this.blocks = [];
    host.classList.add('editor');
    this.list = document.createElement('div');
    const below = document.createElement('div');
    below.className = 'add-below';
    below.addEventListener('click', () => this.focusEndOrAppend());
    host.append(this.list, below);

    document.execCommand('styleWithCSS', false, false);

    this.list.addEventListener('input', e => this.onInput(e));
    this.list.addEventListener('keydown', e => this.onKey(e));
    this.list.addEventListener('paste', e => this.onPaste(e));
    this.list.addEventListener('click', e => this.onClick(e));
    this.list.addEventListener('focusin', e => this.blockOf(e.target)?.el.classList.add('focus'));
    this.list.addEventListener('focusout', e => { const b = this.blockOf(e.target); if (b) { b.el.classList.remove('focus'); b.el.classList.remove('selected'); } });
    this.list.addEventListener('dragstart', e => this.onDragStart(e));
    host.addEventListener('dragover', e => this.onDragOver(e));
    host.addEventListener('dragleave', e => { if (!host.contains(e.relatedTarget)) this.clearDrop(); });
    host.addEventListener('drop', e => this.onDrop(e));
    this.list.addEventListener('dragend', () => this.onDragEnd());

    this.toolbar = this.makeToolbar();
    this.onSel = () => this.updateToolbar();
    document.addEventListener('selectionchange', this.onSel);
  }

  destroy() {
    document.removeEventListener('selectionchange', this.onSel);
    this.toolbar.remove();
    UI.close();
  }

  // ---------- Laden / Speichern ----------
  load(blocks) {
    this.renderBlocks(blocks);
    this.history = [JSON.stringify(this.getData())]; this.future = [];
  }

  renderBlocks(blocks) {
    this.list.innerHTML = ''; this.blocks = [];
    for (const d of blocks) { const b = this.create(d); this.blocks.push(b); this.list.append(b.el); }
    if (!this.blocks.length) { const b = this.create({ type: 'para' }); this.blocks.push(b); this.list.append(b.el); }
    this.renumber();
  }

  getData() {
    return this.blocks.filter(b => !b.uploading).map(b => {
      const d = { type: b.type, indent: b.indent || 0 };
      if (b.type === 'todo') d.checked = !!b.checked;
      if (b.type === 'callout') d.icon = b.icon;
      if (b.type === 'code') { d.lang = b.lang || ''; d.text = b.content.textContent.replace(/\n$/, ''); }
      if (b.type === 'image') { d.src = b.src; d.alt = b.alt || ''; d.width = b.width || ''; }
      if (TEXT_TYPES.has(b.type)) d.md = MD.htmlToInline(b.content);
      if (b.type === 'table') d.rows = [...b.content.querySelectorAll('tr')].map(tr => [...tr.cells].map(td => MD.htmlToInline(td)));
      return d;
    });
  }

  getCursor() {
    const a = document.activeElement; const b = this.blockOf(a);
    if (!b || !b.content || a !== b.content) return null;
    return { index: this.blocks.indexOf(b), offset: Caret.offset(b.content) };
  }
  setCursor(c) {
    if (!c) return;
    const b = this.blocks[Math.min(c.index, this.blocks.length - 1)];
    if (b && b.content && b.content.isContentEditable) Caret.set(b.content, Math.min(c.offset, b.content.textContent.length));
  }

  changed() {
    if (!this.restoring) { clearTimeout(this.snapTimer); this.snapTimer = setTimeout(() => this.snapshot(), 400); }
    this.opts.onChange && this.opts.onChange();
  }

  // ---------- Rückgängig / Wiederholen ----------
  snapshot() {
    clearTimeout(this.snapTimer);
    if (!this.history) return;
    const s = JSON.stringify(this.getData());
    if (s !== this.history[this.history.length - 1]) { this.history.push(s); if (this.history.length > 300) this.history.shift(); this.future = []; }
  }
  static fromData(d) {
    return { ...d, html: d.md !== undefined ? MD.inlineToHtml(d.md) : '', rows: d.rows ? d.rows.map(r => r.map(c => MD.inlineToHtml(c))) : undefined };
  }
  restore(s) {
    this.restoring = true;
    const cur = this.getCursor();
    this.renderBlocks(JSON.parse(s).map(Editor.fromData));
    this.setCursor(cur || { index: 0, offset: 0 });
    this.changed();
    this.restoring = false;
  }
  undo() {
    this.snapshot();
    if (this.history.length < 2) { UI.toast('Nichts mehr zum Rückgängigmachen'); return; }
    this.future.push(this.history.pop());
    this.restore(this.history[this.history.length - 1]);
  }
  redo() {
    if (!this.future.length) return;
    const s = this.future.pop(); this.history.push(s); this.restore(s);
  }

  // ---------- Block-DOM ----------
  blockOf(node) { const el = node && node.closest ? node.closest('.block') : node?.parentElement?.closest('.block'); return el && el.__b; }
  idx(b) { return this.blocks.indexOf(b); }

  create(d) {
    const b = { id: ++blockSeq, type: d.type || 'para', indent: d.indent || 0, checked: !!d.checked, icon: d.icon || '💡', lang: d.lang || '', src: d.src || '', alt: d.alt || '', width: d.width || '', text: d.text || '', rows: d.rows || [['', '', ''], ['', '', ''], ['', '', '']] };
    this.build(b, d.html || '');
    return b;
  }

  build(b, html) {
    const el = document.createElement('div');
    el.className = `block b-${b.type}` + (b.type === 'todo' && b.checked ? ' done' : '');
    el.dataset.indent = b.indent;
    el.style.marginLeft = (b.indent * 26) + 'px';
    el.__b = b; b.el = el;
    el.innerHTML = `<div class="gutter" contenteditable="false"><button class="plus" title="Block hinzufügen">+</button><button class="drag" draggable="true" title="Ziehen zum Verschieben · Klicken für Menü">⋮⋮</button></div>`;

    if (b.type === 'divider') {
      el.tabIndex = -1;
      b.content = Object.assign(document.createElement('div'), { className: 'content', innerHTML: '<hr>' });
      el.append(b.content); return el;
    }
    if (b.type === 'image') { this.buildImage(b); return el; }
    if (b.type === 'table') { this.buildTable(b); return el; }
    if (b.type === 'code') {
      const lang = Object.assign(document.createElement('input'), { className: 'lang', value: b.lang, placeholder: 'Sprache', spellcheck: false });
      lang.addEventListener('input', () => { b.lang = lang.value.trim(); this.changed(); });
      const c = document.createElement('div');
      c.className = 'content'; c.spellcheck = false;
      c.setAttribute('contenteditable', 'plaintext-only');
      c.textContent = b.text;
      b.content = c; el.append(lang, c); return el;
    }
    if (LIST_TYPES.has(b.type) || b.type === 'callout') {
      const m = document.createElement('div'); m.className = 'marker'; m.contentEditable = 'false';
      if (b.type === 'todo') {
        const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: b.checked });
        cb.addEventListener('change', () => { b.checked = cb.checked; el.classList.toggle('done', cb.checked); this.changed(); });
        m.append(cb);
      } else if (b.type === 'callout') {
        m.textContent = b.icon; m.title = 'Symbol ändern';
        m.addEventListener('click', () => this.opts.pickEmoji(m, e => { b.icon = e || '💡'; m.textContent = b.icon; this.changed(); }));
      }
      el.append(m);
    }
    const c = document.createElement('div');
    c.className = 'content' + (b.type === 'para' ? ' para' : '');
    c.contentEditable = 'true';
    c.dataset.ph = PLACEHOLDER[b.type] || '';
    c.innerHTML = html;
    b.content = c; el.append(c);
    return el;
  }

  buildImage(b) {
    const el = b.el; el.tabIndex = -1;
    const c = document.createElement('div'); c.className = 'content'; c.contentEditable = 'false';
    c.innerHTML = `<figure><div class="img-wrap"><img alt=""><div class="img-tools">
      <button data-w="25%">S</button><button data-w="50%">M</button><button data-w="75%">L</button><button data-w="">Voll</button>
      <button data-act="open" title="Bild groß öffnen">↗</button><button data-act="del" title="Bild entfernen">🗑</button></div><div class="resize" title="Größe ziehen"></div></div>
      <figcaption contenteditable="true"></figcaption></figure>`;
    const img = c.querySelector('img'); const wrap = c.querySelector('.img-wrap'); const cap = c.querySelector('figcaption');
    img.src = this.opts.resolveSrc(b.src);
    img.alt = b.alt;
    img.addEventListener('error', () => { wrap.innerHTML = `<div class="broken">🖼️ Bild nicht gefunden<br><small>${MD.esc(b.src)}</small></div>`; });
    img.addEventListener('mousedown', e => { e.preventDefault(); this.select(b); });
    cap.textContent = b.alt;
    cap.addEventListener('input', () => { b.alt = cap.textContent; this.changed(); });
    const applyWidth = () => {
      wrap.style.width = b.width || '';
      img.style.width = b.width ? '100%' : '';
      c.querySelectorAll('[data-w]').forEach(x => x.classList.toggle('on', x.dataset.w === b.width));
    };
    applyWidth();
    c.querySelector('.img-tools').addEventListener('mousedown', e => {
      const t = e.target.closest('button'); if (!t) return; e.preventDefault(); e.stopPropagation();
      if (t.dataset.w !== undefined) { b.width = t.dataset.w; applyWidth(); this.changed(); }
      else if (t.dataset.act === 'open') this.opts.openLink(b.src);
      else if (t.dataset.act === 'del') this.remove(b, true);
    });
    c.querySelector('.resize').addEventListener('pointerdown', e => {
      e.preventDefault();
      const handle = e.target; handle.setPointerCapture(e.pointerId);
      const startX = e.clientX; const startW = wrap.getBoundingClientRect().width; const full = c.clientWidth;
      const move = ev => {
        const pct = Math.max(10, Math.min(100, Math.round((startW + (ev.clientX - startX) * 2) / full * 100)));
        b.width = pct >= 100 ? '' : pct + '%'; applyWidth();
      };
      const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); this.changed(); };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
    });
    b.content = c; el.append(c);
  }

  buildTable(b) {
    const c = document.createElement('div'); c.className = 'content table-wrap'; c.contentEditable = 'false';
    const table = document.createElement('table');
    for (const row of b.rows) {
      const tr = table.insertRow();
      for (const html of row) { const td = tr.insertCell(); td.contentEditable = 'true'; td.innerHTML = html; }
    }
    const tools = document.createElement('div'); tools.className = 'table-tools';
    tools.innerHTML = '<button data-x="row">+ Zeile</button><button data-x="col">+ Spalte</button><button data-x="delrow">− Zeile</button><button data-x="delcol">− Spalte</button>';
    tools.addEventListener('mousedown', e => { const x = e.target.closest('button'); if (!x) return; e.preventDefault(); this.tableOp(b, x.dataset.x); });
    c.append(table, tools);
    c.addEventListener('focusin', e => { if (e.target.tagName === 'TD') b.lastCell = e.target; });
    b.content = c; b.el.append(c);
  }

  // Zeilen/Spalten einfügen oder löschen (bezogen auf die zuletzt benutzte Zelle)
  tableOp(b, op, cell) {
    this.snapshot();
    const table = b.content.querySelector('table');
    const td = cell || (b.lastCell && table.contains(b.lastCell) ? b.lastCell : table.rows[table.rows.length - 1].cells[0]);
    const ri = td.parentElement.rowIndex, ci = td.cellIndex;
    const cols = table.rows[0].cells.length;
    let focus = null;
    if (op === 'row') { const tr = table.insertRow(ri + 1); for (let i = 0; i < cols; i++) tr.insertCell().contentEditable = 'true'; focus = tr.cells[ci]; }
    if (op === 'col') { for (const tr of table.rows) tr.insertCell(ci + 1).contentEditable = 'true'; focus = table.rows[ri].cells[ci + 1]; }
    if (op === 'delrow') { if (table.rows.length <= 1) return this.remove(b, true); table.deleteRow(ri); const r = table.rows[Math.min(ri, table.rows.length - 1)]; focus = r.cells[Math.min(ci, r.cells.length - 1)]; }
    if (op === 'delcol') { if (cols <= 1) return this.remove(b, true); for (const tr of table.rows) tr.deleteCell(ci); focus = table.rows[ri].cells[Math.min(ci, cols - 2)]; }
    b.lastCell = focus;
    if (focus) Caret.set(focus, null);
    this.changed();
  }

  insertAt(index, d, focus = true) {
    const b = this.create(d);
    const ref = this.blocks[index];
    this.blocks.splice(index, 0, b);
    ref ? this.list.insertBefore(b.el, ref.el) : this.list.append(b.el);
    this.renumber();
    if (focus && b.content && b.content.isContentEditable) Caret.set(b.content, 0);
    return b;
  }
  insertAfter(b, d, focus = true) { return this.insertAt(this.idx(b) + 1, d, focus); }

  remove(b, focusNeighbour = false) {
    this.snapshot();
    const i = this.idx(b); if (i < 0) return;
    this.blocks.splice(i, 1); b.el.remove();
    if (!this.blocks.length) this.insertAt(0, { type: 'para' }, true);
    else if (focusNeighbour) this.focusBlock(this.blocks[Math.max(0, i - 1)], false);
    this.renumber(); this.changed();
  }

  setType(b, type) {
    if (b.type === type) return;
    this.snapshot();
    const wasCode = b.type === 'code';
    const hadFocus = b.content && document.activeElement === b.content;
    const off = hadFocus ? Caret.offset(b.content) : null;
    let html = '';
    if (wasCode) html = MD.esc(b.content.textContent).replace(/\n/g, '<br>');
    else if (b.content && TEXT_TYPES.has(b.type)) html = b.content.innerHTML;
    if (type === 'code') b.text = b.content ? b.content.innerText.replace(/\n$/, '') : '';
    if (!LIST_TYPES.has(type)) b.indent = 0;
    b.type = type;
    const old = b.el; this.build(b, html); old.replaceWith(b.el);
    this.renumber(); this.changed();
    if (b.content && b.content.isContentEditable) Caret.set(b.content, off);
  }

  renumber() {
    const counters = [];
    for (const b of this.blocks) {
      if (b.type === 'ol') {
        counters.length = b.indent + 1;
        counters[b.indent] = (counters[b.indent] || 0) + 1;
        const n = counters[b.indent]; const lvl = b.indent % 3;
        b.el.querySelector('.marker').textContent = (lvl === 0 ? n : lvl === 1 ? String.fromCharCode(96 + ((n - 1) % 26) + 1) : toRoman(n)) + '.';
      } else counters.length = LIST_TYPES.has(b.type) ? b.indent : 0;
    }
  }

  focusBlock(b, atStart = true) {
    if (!b) return;
    if (b.type === 'image' || b.type === 'divider') return this.select(b);
    if (b.type === 'table') { const cells = b.content.querySelectorAll('td'); return Caret.set(atStart ? cells[0] : cells[cells.length - 1], atStart ? 0 : null); }
    Caret.set(b.content, atStart ? 0 : null);
  }

  focusEndOrAppend() {
    const last = this.blocks[this.blocks.length - 1];
    if (last && last.type === 'para' && !last.content.textContent) return Caret.set(last.content, 0);
    this.insertAt(this.blocks.length, { type: 'para' }, true);
  }

  focusFirst() { this.focusBlock(this.blocks[0], true); }

  select(b) {
    this.blocks.forEach(x => x.el.classList.remove('selected'));
    b.el.classList.add('selected'); b.el.focus({ preventScroll: false });
  }

  // ---------- Eingabe ----------
  onInput(e) {
    const b = this.blockOf(e.target); if (!b) return;
    if (e.target === b.content && TEXT_TYPES.has(b.type)) {
      if (b.content.innerHTML === '<br>') b.content.innerHTML = '';
      if (b.type === 'para' || b.type === 'ul') this.shortcuts(b);
      this.checkSlash(b);
    }
    this.changed();
  }

  shortcuts(b) {
    const off = Caret.offset(b.content);
    const before = b.content.textContent.slice(0, off).replace(/ /g, ' ');
    const map = b.type === 'ul'
      ? { '[] ': 'todo', '[ ] ': 'todo', '[x] ': 'todo' }
      : { '# ': 'h1', '## ': 'h2', '### ': 'h3', '- ': 'ul', '* ': 'ul', '+ ': 'ul', '1. ': 'ol', '1) ': 'ol', '[] ': 'todo', '[ ] ': 'todo', '> ': 'quote', '```': 'code', '---': 'divider', '!! ': 'callout' };
    const type = map[before]; if (!type) return;
    Caret.removeLeading(b.content, before.length);
    if (type === 'divider') { this.makeDivider(b); return; }
    if (type === 'todo' && before === '[x] ') b.checked = true;
    this.setType(b, type);
    Caret.set(b.content, 0);
  }

  makeDivider(b) {
    const empty = !b.content.textContent.trim();
    if (empty) { this.setType(b, 'divider'); this.insertAfter(b, { type: 'para' }); }
    else { const d = this.insertAfter(b, { type: 'divider' }, false); this.insertAfter(d, { type: 'para' }); }
    this.changed();
  }

  // ---------- Slash-Menü ----------
  checkSlash(b) {
    const off = Caret.offset(b.content);
    const before = b.content.textContent.slice(0, off).replace(/ /g, ' ');
    const m = /(?:^|\s)\/([^\s/]{0,24})$/.exec(before);
    if (!m) { if (this.slashOpen) UI.close(); return; }
    const q = m[1].toLowerCase();
    const match = x => !q || x.label.toLowerCase().includes(q) || x.keys.includes(q);
    const items = [];
    const types = BLOCK_TYPES.filter(match), inserts = INSERT_TYPES.filter(match);
    if (types.length) items.push({ title: 'Blöcke' }, ...types.map(t => ({ icon: t.icon, label: t.label, sub: t.sub, run: () => this.runSlash(b, q.length + 1, t) })));
    if (inserts.length) items.push({ title: 'Einfügen' }, ...inserts.map(t => ({ icon: t.icon, label: t.label, sub: t.sub, run: () => this.runSlash(b, q.length + 1, t) })));
    if (!types.length && !inserts.length) { if (this.slashOpen) UI.close(); return; }
    const r = Caret.rect() || b.content.getBoundingClientRect();
    this.slashOpen = true;
    UI.menu(items, { x: r.left, y: r.bottom + 6, top: r.top }, { onClose: () => (this.slashOpen = false) });
  }

  runSlash(b, len, t) {
    // "/befehl" wieder entfernen
    const s = getSelection();
    if (s.rangeCount && b.content.contains(s.anchorNode)) {
      const r = s.getRangeAt(0); const off = Caret.offset(b.content);
      Caret.set(b.content, off - len);
      const start = getSelection().getRangeAt(0);
      const del = document.createRange(); del.setStart(start.startContainer, start.startOffset); del.setEnd(r.endContainer, r.endOffset);
      del.deleteContents();
    }
    if (t.type) { this.setType(b, t.type); return; }
    if (t.cmd === 'divider') return this.makeDivider(b);
    if (t.cmd === 'table') {
      this.snapshot();
      const empty = b.type === 'para' && !b.content.textContent.trim();
      const tb = this.insertAfter(b, { type: 'table' }, false);
      if (empty) this.remove(b);
      if (!this.blocks[this.idx(tb) + 1]) this.insertAfter(tb, { type: 'para' }, false);
      Caret.set(tb.content.querySelector('td'), 0); this.changed(); return;
    }
    if (t.cmd === 'image') return this.opts.pickFiles('image/*', files => this.insertFiles(files, b));
    if (t.cmd === 'file') return this.opts.pickFiles('', files => this.insertFiles(files, b));
  }

  // ---------- Tastatur ----------
  onKey(e) {
    if (UI.isOpen() && this.slashOpen && UI.key(e)) return;
    const modKey = e.ctrlKey || e.metaKey;
    if (modKey && !e.altKey && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
      e.preventDefault();
      if (e.key.toLowerCase() === 'y' || e.shiftKey) this.redo(); else this.undo();
      return;
    }
    const b = this.blockOf(e.target); if (!b) return;
    const t = e.target;
    if (b.type === 'table' && t.tagName === 'TD') { this.tableKey(e, b, t); return; }

    // Ausgewähltes Bild / Trennlinie
    if (t === b.el) {
      if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); return this.remove(b, true); }
      if (e.key === 'Enter') { e.preventDefault(); return this.insertAfter(b, { type: 'para' }); }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); return this.focusBlock(this.blocks[this.idx(b) - 1], false); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); const n = this.blocks[this.idx(b) + 1]; return n ? this.focusBlock(n, true) : this.insertAfter(b, { type: 'para' }); }
      return;
    }
    if (t.tagName === 'FIGCAPTION' || t.classList.contains('lang')) {
      if (e.key === 'Enter') { e.preventDefault(); this.insertAfter(b, { type: 'para' }); }
      return;
    }
    if (t !== b.content) return;
    const c = b.content;
    const mod = e.ctrlKey || e.metaKey;

    if (b.type === 'code') {
      if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, e.shiftKey ? '' : '  '); return; }
      if (e.key === 'Escape' || (e.key === 'Enter' && (mod || e.shiftKey))) { e.preventDefault(); this.insertAfter(b, { type: 'para' }); return; }
      if (e.key === 'Enter') { e.preventDefault(); document.execCommand('insertText', false, '\n'); return; }
      if (e.key === 'Backspace' && !c.textContent && Caret.collapsed()) { e.preventDefault(); this.setType(b, 'para'); return; }
      if (e.key === 'ArrowUp' && Caret.onFirstLine(c) && this.idx(b) > 0) { e.preventDefault(); this.focusBlock(this.blocks[this.idx(b) - 1], false); }
      if (e.key === 'ArrowDown' && Caret.onLastLine(c)) { e.preventDefault(); const n = this.blocks[this.idx(b) + 1]; n ? this.focusBlock(n) : this.insertAfter(b, { type: 'para' }); }
      return;
    }

    if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); this.toggleInline('code'); return; }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'h') { e.preventDefault(); this.toggleInline('mark'); return; }
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); this.makeLink(); return; }

    switch (e.key) {
      case 'Enter':
        if (e.shiftKey) return;
        e.preventDefault(); this.split(b); return;
      case 'Backspace':
        if (!Caret.atStart(c)) return;
        e.preventDefault();
        if (b.type !== 'para') { if (LIST_TYPES.has(b.type) && b.indent > 0) return this.indent(b, -1); return this.setType(b, 'para'); }
        if (b.indent > 0) return this.indent(b, -1);
        return this.mergeUp(b);
      case 'Delete':
        if (!Caret.atEnd(c)) return;
        { const n = this.blocks[this.idx(b) + 1]; if (n) { e.preventDefault(); this.mergeUp(n); } }
        return;
      case 'Tab':
        e.preventDefault(); this.indent(b, e.shiftKey ? -1 : 1); return;
      case 'ArrowUp':
        if (Caret.onFirstLine(c) && this.idx(b) > 0) { e.preventDefault(); this.focusBlock(this.blocks[this.idx(b) - 1], false); }
        return;
      case 'ArrowDown':
        if (Caret.onLastLine(c) && this.idx(b) < this.blocks.length - 1) { e.preventDefault(); this.focusBlock(this.blocks[this.idx(b) + 1], true); }
        return;
      case 'ArrowLeft':
        if (Caret.atStart(c) && this.idx(b) > 0) { e.preventDefault(); this.focusBlock(this.blocks[this.idx(b) - 1], false); }
        return;
      case 'ArrowRight':
        if (Caret.atEnd(c) && this.idx(b) < this.blocks.length - 1) { e.preventDefault(); this.focusBlock(this.blocks[this.idx(b) + 1], true); }
        return;
    }
  }

  tableKey(e, b, td) {
    const table = td.closest('table'); const cells = [...table.querySelectorAll('td')];
    const i = cells.indexOf(td);
    if (e.key === 'Tab') {
      e.preventDefault();
      if (!e.shiftKey && i === cells.length - 1) { this.tableOp(b, 'row', td); return; }
      const n = cells[i + (e.shiftKey ? -1 : 1)]; if (n) Caret.set(n, null);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const below = table.rows[td.parentElement.rowIndex + 1];
      if (below) Caret.set(below.cells[td.cellIndex], null); else this.tableOp(b, 'row', td);
      return;
    }
    if (e.key === 'ArrowUp' && Caret.onFirstLine(td)) {
      const r = table.rows[td.parentElement.rowIndex - 1];
      e.preventDefault(); if (r) Caret.set(r.cells[td.cellIndex], null); else this.focusBlock(this.blocks[this.idx(b) - 1], false);
    }
    if (e.key === 'ArrowDown' && Caret.onLastLine(td)) {
      const r = table.rows[td.parentElement.rowIndex + 1];
      e.preventDefault(); if (r) Caret.set(r.cells[td.cellIndex], null); else { const n = this.blocks[this.idx(b) + 1]; n ? this.focusBlock(n) : this.insertAfter(b, { type: 'para' }); }
    }
  }

  indent(b, delta) {
    this.snapshot();
    const prev = this.blocks[this.idx(b) - 1];
    const max = prev ? Math.min(6, (prev.indent || 0) + 1) : 0;
    const n = Math.max(0, Math.min(max, b.indent + delta));
    if (n === b.indent) return;
    const off = Caret.offset(b.content);
    b.indent = n; b.el.dataset.indent = n; b.el.style.marginLeft = n * 26 + 'px';
    this.renumber(); this.changed(); Caret.set(b.content, off);
  }

  split(b) {
    this.snapshot();
    const c = b.content;
    const s = getSelection(); const r = s.getRangeAt(0); r.deleteContents();
    const emptyNow = !c.textContent && !c.querySelector('img');
    if (emptyNow && (LIST_TYPES.has(b.type) || b.type === 'quote' || b.type === 'callout')) {
      if (b.indent > 0) return this.indent(b, -1);
      return this.setType(b, 'para');
    }
    // Cursor ganz am Anfang eines nicht-leeren Blocks: leeren Block darüber einfügen
    if (Caret.offset(c) === 0 && c.textContent) {
      this.insertAt(this.idx(b), { type: LIST_TYPES.has(b.type) ? b.type : 'para', indent: LIST_TYPES.has(b.type) ? b.indent : 0 }, false);
      Caret.set(c, 0); this.changed(); return;
    }
    const tail = document.createRange();
    tail.setStart(r.endContainer, r.endOffset);
    tail.setEnd(c, c.childNodes.length);
    const frag = tail.extractContents();
    if (c.innerHTML === '<br>') c.innerHTML = '';
    const type = LIST_TYPES.has(b.type) ? b.type : 'para';
    const nb = this.insertAfter(b, { type, indent: LIST_TYPES.has(type) ? b.indent : 0 }, false);
    nb.content.append(frag);
    nb.content.querySelectorAll('b,i,s,u,code,mark,a,span').forEach(x => { if (!x.textContent) x.remove(); });
    if (nb.content.innerHTML === '<br>') nb.content.innerHTML = '';
    Caret.set(nb.content, 0);
    this.changed();
  }

  mergeUp(b) {
    this.snapshot();
    const i = this.idx(b); const prev = this.blocks[i - 1];
    if (!prev) return;
    if (prev.type === 'divider') { this.remove(prev); Caret.set(b.content, 0); return; }
    if (prev.type === 'table') { if (!b.content.textContent) this.remove(b); this.focusBlock(prev, false); return; }
    if (prev.type === 'image') { if (!b.content.textContent) this.remove(b); this.select(prev); return; }
    if (prev.type === 'code') {
      const len = prev.content.textContent.length;
      prev.content.textContent += b.content.textContent;
      this.remove(b); Caret.set(prev.content, len); return;
    }
    const len = prev.content.textContent.length;
    if (b.content && TEXT_TYPES.has(b.type)) while (b.content.firstChild) prev.content.append(b.content.firstChild);
    prev.content.normalize();
    this.remove(b);
    Caret.set(prev.content, len);
    this.changed();
  }

  // ---------- Klicks ----------
  onClick(e) {
    const a = e.target.closest('.content a');
    if (a && !e.target.closest('.b-code')) { e.preventDefault(); this.opts.openLink(a.getAttribute('href')); return; }
    const b = this.blockOf(e.target); if (!b) return;
    if (e.target.closest('.plus')) {
      const empty = b.type === 'para' && !b.content.textContent;
      const target = empty ? b : this.insertAfter(b, { type: 'para' });
      Caret.set(target.content, 0); document.execCommand('insertText', false, '/');
      return;
    }
    if (e.target.closest('.drag')) return this.blockMenu(b, e.target.closest('.drag'));
    if (b.type === 'divider') this.select(b);
  }

  blockMenu(b, anchor) {
    const i = this.idx(b);
    const items = [];
    if (TEXT_TYPES.has(b.type) || b.type === 'code') {
      items.push({ title: 'Umwandeln in' }, ...BLOCK_TYPES.filter(t => t.type !== b.type).map(t => ({ icon: t.icon, label: t.label, run: () => this.setType(b, t.type) })), 'sep');
    }
    items.push(
      { icon: '⧉', label: 'Duplizieren', run: () => { this.snapshot(); this.insertAfter(b, Editor.fromData(this.getData()[i]), false); this.changed(); } },
      { icon: '↑', label: 'Nach oben', run: () => this.move(b, i - 1) },
      { icon: '↓', label: 'Nach unten', run: () => this.move(b, i + 2) },
      'sep',
      { icon: '🗑', label: 'Löschen', danger: true, run: () => this.remove(b, true) },
    );
    UI.menu(items, anchor, { compact: true });
  }

  move(b, toIndex) {
    this.snapshot();
    const from = this.idx(b);
    if (toIndex < 0 || toIndex > this.blocks.length || toIndex === from || toIndex === from + 1) return;
    this.blocks.splice(from, 1);
    const at = toIndex > from ? toIndex - 1 : toIndex;
    const ref = this.blocks[at];
    this.blocks.splice(at, 0, b);
    ref ? this.list.insertBefore(b.el, ref.el) : this.list.append(b.el);
    this.renumber(); this.changed();
  }

  // ---------- Drag & Drop ----------
  onDragStart(e) {
    const handle = e.target.closest && e.target.closest('.drag');
    if (!handle) { if (e.target.tagName === 'IMG') e.preventDefault(); return; }
    const b = this.blockOf(handle);
    this.dragB = b;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/x-lern-block', String(b.id));
    e.dataTransfer.setDragImage(b.el, 20, 14);
    requestAnimationFrame(() => b.el.classList.add('dragging'));
  }
  dropTarget(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.block');
    let b = el && this.list.contains(el) ? el.__b : null;
    if (!b) { b = this.blocks[this.blocks.length - 1]; return b ? { b, after: true } : null; }
    const r = b.el.getBoundingClientRect();
    return { b, after: e.clientY > r.top + r.height / 2 };
  }
  clearDrop() { this.list.querySelectorAll('.drop-before,.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after')); }
  onDragOver(e) {
    const files = e.dataTransfer.types.includes('Files');
    if (!this.dragB && !files) return;
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = this.dragB ? 'move' : 'copy';
    const t = this.dropTarget(e); this.clearDrop();
    if (t) t.b.el.classList.add(t.after ? 'drop-after' : 'drop-before');
  }
  onDrop(e) {
    const t = this.dropTarget(e); this.clearDrop();
    if (this.dragB) {
      e.preventDefault(); e.stopPropagation();
      if (t && t.b !== this.dragB) this.move(this.dragB, this.idx(t.b) + (t.after ? 1 : 0));
      this.onDragEnd(); return;
    }
    if (e.dataTransfer.files.length) {
      e.preventDefault(); e.stopPropagation();
      const files = [...e.dataTransfer.files];
      if (!t) return this.insertFiles(files, null);
      const anchor = t.after ? t.b : this.blocks[this.idx(t.b) - 1] || null;
      this.insertFiles(files, anchor, !anchor ? 0 : undefined);
    }
  }
  onDragEnd() { if (this.dragB) this.dragB.el.classList.remove('dragging'); this.dragB = null; this.clearDrop(); }

  // ---------- Einfügen / Dateien ----------
  onPaste(e) {
    const b = this.blockOf(e.target); if (!b) return;
    const cd = e.clipboardData;
    const files = [...cd.files];
    if (files.length && e.target === b.content) { e.preventDefault(); this.insertFiles(files, b); return; }
    const text = cd.getData('text/plain');
    e.preventDefault();
    if (!text) return;
    if (b.type === 'code' || e.target !== b.content) { document.execCommand('insertText', false, text); return; }
    const parsed = text.includes('\n') ? MD.parse(text).blocks : null;
    if (parsed && parsed.length > 1) this.snapshot();
    if (!parsed || parsed.length < 2) { document.execCommand('insertText', false, text.replace(/\r?\n/g, ' ')); return; }
    let anchor = b; const replace = b.type === 'para' && !b.content.textContent;
    let last = null;
    for (const d of parsed) { last = this.insertAfter(anchor, d, false); anchor = last; }
    if (replace) this.remove(b);
    this.focusBlock(last, false); this.changed();
  }

  // Dateien hochladen und als Bild- bzw. Datei-Block einfügen
  async insertFiles(files, afterBlock, atIndex) {
    this.snapshot();
    const replace = afterBlock && afterBlock.type === 'para' && !afterBlock.content.textContent;
    let anchorIdx = atIndex !== undefined ? atIndex - 1 : afterBlock ? this.idx(afterBlock) : this.blocks.length - 1;
    for (const file of files) {
      const isImg = file.type.startsWith('image/');
      const ph = this.insertAt(anchorIdx + 1, { type: 'para' }, false);
      ph.uploading = true;
      ph.content.contentEditable = 'false';
      ph.content.innerHTML = `<div class="uploading">⏳ ${MD.esc(file.name || 'Bild')} wird hochgeladen …</div>`;
      anchorIdx = this.idx(ph);
      try {
        const src = await this.opts.upload(file, isImg);
        const i = this.idx(ph);
        this.blocks.splice(i, 1); ph.el.remove();
        if (isImg) this.insertAt(i, { type: 'image', src, alt: '' }, false);
        else this.insertAt(i, { type: 'para', html: `<a class="file-link" href="${MD.escAttr(src)}">${MD.esc(file.name)}</a>` }, false);
        anchorIdx = i;
      } catch (err) {
        this.remove(ph); UI.toast('Hochladen fehlgeschlagen: ' + err.message, true);
      }
    }
    if (replace && this.idx(afterBlock) >= 0) this.remove(afterBlock);
    const next = this.blocks[anchorIdx + 1];
    if (!next || next.type !== 'para') this.insertAt(anchorIdx + 1, { type: 'para' }, true);
    else Caret.set(next.content, 0);
    this.changed();
  }

  // ---------- Formatierungs-Leiste ----------
  makeToolbar() {
    const tb = document.createElement('div');
    tb.className = 'toolbar'; tb.hidden = true;
    const btns = [
      ['<b>B</b>', 'Fett (Strg+B)', () => document.execCommand('bold')],
      ['<i>I</i>', 'Kursiv (Strg+I)', () => document.execCommand('italic')],
      ['<u>U</u>', 'Unterstrichen (Strg+U)', () => document.execCommand('underline')],
      ['<s>S</s>', 'Durchgestrichen', () => document.execCommand('strikeThrough')],
      null,
      ['<code style="font-size:12px">&lt;/&gt;</code>', 'Code (Strg+E)', () => this.toggleInline('code')],
      ['🖍️', 'Markieren (Strg+Umschalt+H)', () => this.toggleInline('mark')],
      ['🔗', 'Link (Strg+K)', () => this.makeLink()],
    ];
    for (const x of btns) {
      if (!x) { tb.insertAdjacentHTML('beforeend', '<span class="sep"></span>'); continue; }
      const b = document.createElement('button'); b.innerHTML = x[0]; b.title = x[1];
      b.addEventListener('mousedown', e => { e.preventDefault(); x[2](); this.changed(); });
      tb.append(b);
    }
    document.body.append(tb);
    return tb;
  }

  updateToolbar() {
    const s = getSelection();
    const tb = this.toolbar;
    if (!s.rangeCount || s.isCollapsed) { tb.hidden = true; return; }
    const r = s.getRangeAt(0);
    const node = r.commonAncestorContainer;
    const b = this.blockOf(node.nodeType === 1 ? node : node.parentElement);
    if (!b || !(TEXT_TYPES.has(b.type) || b.type === 'table') || !b.content.contains(node)) { tb.hidden = true; return; }
    const rect = r.getBoundingClientRect();
    tb.hidden = false;
    const w = tb.offsetWidth;
    tb.style.left = Math.max(8, Math.min(innerWidth - w - 8, rect.left + rect.width / 2 - w / 2)) + 'px';
    tb.style.top = Math.max(8, rect.top - 44) + 'px';
  }

  toggleInline(tag) {
    const s = getSelection(); if (!s.rangeCount) return;
    const r = s.getRangeAt(0);
    const anc = (r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement).closest(tag);
    const b = this.blockOf(r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement);
    if (!b || !b.content) return;
    if (anc && b.content.contains(anc)) {
      const parent = anc.parentNode; while (anc.firstChild) parent.insertBefore(anc.firstChild, anc); anc.remove(); parent.normalize();
    } else {
      if (r.collapsed) return;
      const frag = r.extractContents();
      frag.querySelectorAll(tag).forEach(x => x.replaceWith(...x.childNodes));
      const w = document.createElement(tag);
      if (tag === 'code') w.textContent = frag.textContent; else w.append(frag);
      r.insertNode(w);
      const sel = document.createRange(); sel.selectNodeContents(w); s.removeAllRanges(); s.addRange(sel);
    }
    this.changed();
  }

  makeLink() {
    const s = getSelection(); if (!s.rangeCount || s.isCollapsed) { UI.toast('Markiere zuerst den Text für den Link'); return; }
    const range = s.getRangeAt(0).cloneRange();
    const url = prompt('Link-Adresse (URL oder Pfad zu einer Seite):', 'https://');
    if (!url || url === 'https://') return;
    s.removeAllRanges(); s.addRange(range);
    document.execCommand('createLink', false, url.trim());
    this.changed();
  }
}

function toRoman(n) {
  const map = [[10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = ''; for (const [v, s] of map) while (n >= v) { out += s; n -= v; } return out;
}
