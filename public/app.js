// ================== Lernplattform – App ==================
(() => {
  const $ = s => document.querySelector(s);
  const enc = encodeURIComponent;
  const view = $('#view');

  const store = {
    get(k, d) { try { const v = localStorage.getItem('lern.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('lern.' + k, JSON.stringify(v)); } catch {} },
  };

  const S = {
    rootName: 'Schule',
    cache: new Map(),                        // Ordner -> Einträge
    expanded: new Set(),
    root: '',
    kind: null, path: null,                  // aktuelle Ansicht
    doc: null,                               // geöffnete bearbeitbare Datei (Seite oder Textdatei)
    editor: null,
    routeToken: 0,
    focusTitle: false,
    bin: null,                               // geöffnetes Word-/PDF-Dokument zum Bearbeiten
    backedUp: new Set(),
    ownWrites: new Map(),                    // Pfad -> { size, mtime, at } der eigenen letzten Speicherung                     // Dateien, von denen es schon eine Sicherung gibt
    docxEditing: false,
    apps: {},                                // installierte Programme (vom Server)
  };

  // ---------- Pfade ----------
  const P = {
    dir: p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''),
    base: p => p.slice(p.lastIndexOf('/') + 1),
    join: (a, b) => (a ? a + '/' + b : b),
    ext: p => { const b = P.base(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i).toLowerCase() : ''; },
    stem: p => { const b = P.base(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(0, i) : b; },
    resolve(dir, rel) {
      const parts = dir ? dir.split('/') : [];
      for (const seg of rel.replace(/\\/g, '/').split('/')) { if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg); }
      return parts.join('/');
    },
    inside: (p, dir) => p === dir || p.startsWith(dir + '/'),
  };
  const decode = u => { try { return decodeURIComponent(u); } catch { return u; } };
  const raw = p => `/raw?path=${enc(p)}`;
  const expKey = () => 'expanded:' + S.root.toLowerCase();
  const hashFor = p => '#/' + p.split('/').map(enc).join('/');
  const go = p => { location.hash = p ? hashFor(p) : '#/'; };
  // Link aus einer Notiz oder einem PDF öffnen: Webseiten im Browser, Dateien im Ordner direkt in der App
  const openHref = (href, from) => {
    href = String(href || '').trim(); if (!href) return;
    let file = null;
    if (/^file:/i.test(href)) file = decode(href.replace(/^file:\/*/i, '').split(/[?#]/)[0]);
    else if (/^[a-z]:[\\/]/i.test(href) || href.startsWith('\\\\')) file = href;
    if (file != null) {
      const abs = file.replace(/\\/g, '/'); const root = S.root.replace(/\\/g, '/').replace(/\/$/, '');
      if (abs.toLowerCase() === root.toLowerCase()) return go('');
      if (abs.toLowerCase().startsWith(root.toLowerCase() + '/')) return go(abs.slice(root.length + 1));
      UI.toast('Diese Datei liegt außerhalb deines Lernordners: ' + file);
      return;
    }
    if (/^[a-z][\w+.-]*:/i.test(href) || /^www\./i.test(href)) { window.open(/^www\./i.test(href) ? 'https://' + href : href, '_blank'); return; }
    const rel = decode(href.split('#')[0]);
    if (rel) go(P.resolve(P.dir(from), rel));
  };
  const cleanName = n => String(n || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();

  // ---------- Server-API ----------
  async function req(url, opts) {
    const r = await fetch(url, opts);
    if (!r.ok) { let m = r.statusText; try { m = (await r.json()).error || m; } catch {} throw new Error(m); }
    return r;
  }
  const post = (url, body) => req(url, { method: 'POST', body }).then(r => r.json());
  const api = {
    info: () => req('/api/info').then(r => r.json()),
    list: p => req(`/api/list?path=${enc(p)}`).then(r => r.json()),
    stat: p => req(`/api/stat?path=${enc(p)}`).then(r => r.json()),
    read: p => req(`/api/read?path=${enc(p)}`).then(r => r.text()),
    search: q => req(`/api/search?q=${enc(q)}`).then(r => r.json()),
    recent: () => req('/api/recent?n=10').then(r => r.json()),
    write: (p, body) => post(`/api/write?path=${enc(p)}`, body),
    create: (dir, name, body = '') => post(`/api/create?dir=${enc(dir)}&name=${enc(name)}`, body),
    mkdir: (dir, name) => post(`/api/mkdir?dir=${enc(dir)}&name=${enc(name)}`),
    rename: (from, to) => post(`/api/rename?from=${enc(from)}&to=${enc(to)}`),
    del: p => post(`/api/delete?path=${enc(p)}`),
    open: (p, reveal) => post(`/api/open?path=${enc(p)}&reveal=${reveal ? 1 : 0}`),
    openIn: (p, app) => post(`/api/open?path=${enc(p)}&app=${enc(app)}`),
    newDoc: (dir, name, ext) => post(`/api/newdoc?dir=${enc(dir)}&name=${enc(name)}&ext=${enc(ext)}`),
  };

  // ---------- Dateitypen & Symbole ----------
  const EXT = {
    image: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif', '.ico'],
    video: ['.mp4', '.webm', '.mov'],
    audio: ['.mp3', '.wav', '.ogg', '.m4a'],
    text: ['.txt', '.csv', '.tsv', '.json', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.java', '.c', '.h', '.cpp', '.hpp', '.cc', '.cs', '.cshtml', '.razor', '.csproj', '.sln', '.config', '.xaml', '.resx', '.html', '.htm', '.css', '.scss', '.less', '.vue', '.svelte', '.xml', '.yml', '.yaml', '.toml', '.env', '.sql', '.ps1', '.psm1', '.bat', '.cmd', '.sh', '.php', '.rb', '.pl', '.lua', '.r', '.swift', '.dart', '.ini', '.log', '.cfg', '.conf', '.properties', '.gradle', '.kt', '.go', '.rs', '.vb', '.asm', '.ino', '.tex', '.rst', '.adoc', '.gitignore', '.editorconfig', '.dockerfile', '.map', '.lock'],
    docx: ['.docx', '.docm', '.dotx'],
    sheet: ['.xlsx', '.xlsm', '.xls', '.ods'],
    slides: ['.pptx', '.pptm', '.ppsx'],
  };
  function kindOf(ext) {
    if (ext === '.md') return 'note';
    if (ext === '.pdf') return 'pdf';
    for (const k of ['image', 'video', 'audio', 'text', 'docx', 'sheet', 'slides']) if (EXT[k].includes(ext)) return k;
    return 'other';
  }
  const ICONS = { '.html': '🌐', '.htm': '🌐', '.pdf': '📕', '.doc': '📘', '.docx': '📘', '.odt': '📘', '.rtf': '📘', '.ppt': '📙', '.pptx': '📙', '.odp': '📙', '.xls': '📗', '.xlsx': '📗', '.ods': '📗', '.csv': '📗', '.zip': '🗜️', '.rar': '🗜️', '.7z': '🗜️', '.pkt': '🌐', '.pka': '🌐', '.exe': '⚙️', '.msi': '⚙️', '.one': '📓', '.txt': '📄', '.url': '🔗', '.lnk': '🔗' };
  function iconFor(it) {
    if (it.type === 'dir') return S.expanded.has(it.path) ? '📂' : '📁';
    if (it.ext === '.md') return it.icon || '📝';
    const k = kindOf(it.ext);
    if (k === 'image') return '🖼️';
    if (k === 'video') return '🎬';
    if (k === 'audio') return '🎵';
    if (k === 'text' && !ICONS[it.ext]) return '💻';
    return ICONS[it.ext] || '📄';
  }
  const displayName = it => (it.type === 'file' && it.ext === '.md' ? P.stem(it.path) : it.name);

  const SUBJECTS = [[/engl/i, '🗣️'], [/deutsch/i, '📖'], [/ethi/i, '🤔'], [/mathe/i, '📐'], [/labor/i, '🧪'], [/fu-?it|it-?tec|ittk|it-p\b|informatik|it$/i, '💻'], [/iphon|phys/i, '⚡'], [/pug|politik|gesch/i, '🏛️'], [/bgwp|wirtschaft/i, '📊'], [/aeup/i, '🧩'], [/foi/i, '🌐'], [/klassen/i, '👥'], [/jahr/i, '🎓'], [/vorlage/i, '📋'], [/bild|foto/i, '🖼️'], [/datei/i, '📎']];
  const subjectIcon = name => (SUBJECTS.find(([re]) => re.test(name)) || [0, '📁'])[1];
  const PALETTE = [['#e3ecfd', '#f3e6fa'], ['#fdeee0', '#fbe3ea'], ['#e1f5ec', '#e6f0fd'], ['#fff4d6', '#fde6d6'], ['#ece6fd', '#dff3fb'], ['#fde2e2', '#fff0d9'], ['#dcf3f0', '#eef7dc'], ['#e8e8f8', '#fbe8f3']];
  const hash = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

  const COVERS = [
    'linear-gradient(135deg,#667eea,#764ba2)', 'linear-gradient(135deg,#f6d365,#fda085)', 'linear-gradient(135deg,#84fab0,#8fd3f4)',
    'linear-gradient(135deg,#a1c4fd,#c2e9fb)', 'linear-gradient(135deg,#fbc2eb,#a6c1ee)', 'linear-gradient(135deg,#ff9a9e,#fecfef)',
    'linear-gradient(135deg,#43e97b,#38f9d7)', 'linear-gradient(135deg,#30cfd0,#330867)', 'linear-gradient(120deg,#e0c3fc,#8ec5fc)',
    'linear-gradient(135deg,#fa709a,#fee140)', 'linear-gradient(135deg,#0f2027,#2c5364)', 'linear-gradient(135deg,#d4fc79,#96e6a1)',
  ];
  const EMOJIS = '📝 📚 📖 📘 📕 📗 📙 📓 🗒️ 📋 📌 📎 ✏️ 🖊️ 🧠 💡 🎓 🏫 🧪 🔬 🧮 📐 📏 💻 🖥️ ⌨️ 🌐 🛜 🔌 🔧 ⚙️ 🧩 📊 📈 🗂️ 📁 🗃️ ⭐ 🔥 ✅ ❗ ❓ ⚠️ 🎯 🚀 🏆 🎨 🎵 🌍 🗣️ 🤔 👥 🏛️ ⚡ 🔋 🔒 🔑 🕒 📅 ☕ 🍀 ❤️'.split(' ');

  // ---------- Formatierung ----------
  const fmtSize = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  function relTime(ms) {
    const d = (Date.now() - ms) / 1000;
    if (d < 60) return 'gerade eben';
    if (d < 3600) return `vor ${Math.floor(d / 60)} Min.`;
    if (d < 86400) return `vor ${Math.floor(d / 3600)} Std.`;
    if (d < 86400 * 7) return `vor ${Math.floor(d / 86400)} Tag${d >= 172800 ? 'en' : ''}`;
    return new Date(ms).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  const esc = MD.esc;

  // ---------- Kleine Dialoge ----------
  function askText(title, value, anchor, okLabel = 'OK') {
    return new Promise(resolve => {
      const box = document.createElement('div');
      box.style.cssText = 'padding:8px;width:280px';
      box.innerHTML = `<div class="m-title" style="padding:0 0 6px">${esc(title)}</div>
        <input style="width:100%;padding:6px 9px;border-radius:6px;border:1px solid var(--line);background:var(--bg);outline-color:var(--accent)">
        <div style="display:flex;justify-content:flex-end;gap:6px;margin-top:8px"><button class="btn" data-x>Abbrechen</button><button class="btn primary" data-ok>${esc(okLabel)}</button></div>`;
      const input = box.querySelector('input'); input.value = value || '';
      let done = false;
      const finish = v => { if (done) return; done = true; UI.close(); resolve(v); };
      box.querySelector('[data-ok]').onclick = () => finish(input.value.trim() || null);
      box.querySelector('[data-x]').onclick = () => finish(null);
      input.onkeydown = e => { if (e.key === 'Enter') finish(input.value.trim() || null); if (e.key === 'Escape') finish(null); };
      UI.custom(box, anchor, { onClose: () => { if (!done) { done = true; resolve(null); } } });
      setTimeout(() => { input.focus(); const dot = input.value.lastIndexOf('.'); input.setSelectionRange(0, dot > 0 ? dot : input.value.length); }, 0);
    });
  }

  function pickEmoji(anchor, cb, removable = true) {
    const wrap = document.createElement('div');
    const grid = document.createElement('div'); grid.className = 'emoji-grid';
    for (const e of EMOJIS) {
      const b = document.createElement('button'); b.textContent = e;
      b.onmousedown = ev => ev.preventDefault();
      b.onclick = () => { UI.close(); cb(e); };
      grid.append(b);
    }
    wrap.append(grid);
    if (removable) {
      const r = document.createElement('button'); r.className = 'm-item'; r.innerHTML = '<span class="m-ico">✕</span><span>Symbol entfernen</span>';
      r.onclick = () => { UI.close(); cb(null); };
      wrap.append(r);
    }
    UI.custom(wrap, anchor, { compact: true });
  }

  function pickFiles(accept, cb) {
    const fp = $('#filePicker');
    fp.accept = accept || ''; fp.value = '';
    fp.onchange = () => { if (fp.files.length) cb([...fp.files]); };
    fp.click();
  }

  function showBanner(text, actions) {
    const b = $('#banner'); b.innerHTML = `<span style="flex:1">${esc(text)}</span>`;
    for (const [label, fn] of actions) { const x = document.createElement('button'); x.className = 'btn'; x.textContent = label; x.onclick = () => { b.hidden = true; fn(); }; b.append(x); }
    b.hidden = false;
  }
  const hideBanner = () => ($('#banner').hidden = true);
  const setSave = t => ($('#saveState').textContent = t);

  // ================== Seitenleiste / Ordnerbaum ==================
  async function listing(dir, fresh = false) {
    if (fresh || !S.cache.has(dir)) S.cache.set(dir, await api.list(dir));
    return S.cache.get(dir);
  }

  let treeBusy = null, treeAgain = false;
  async function renderTree() {
    if (treeBusy) { treeAgain = true; return treeBusy; }
    treeBusy = (async () => {
      await Promise.all([...S.expanded].map(d => listing(d).catch(() => { S.expanded.delete(d); S.cache.delete(d); })));
      const frag = document.createDocumentFragment();
      await buildLevel(frag, '', 0);
      $('#tree').replaceChildren(frag);
      markActive();
    })();
    try { await treeBusy; } finally { treeBusy = null; if (treeAgain) { treeAgain = false; renderTree(); } }
  }

  async function buildLevel(parent, dir, depth) {
    let items; try { items = await listing(dir); } catch { return; }
    if (!items.length && depth) { const e = document.createElement('div'); e.className = 'empty'; e.style.paddingLeft = (26 + depth * 14) + 'px'; e.textContent = 'Leer'; parent.append(e); }
    for (const it of items) {
      const node = document.createElement('div'); node.className = 'node';
      node.append(makeRow(it, depth));
      if (it.type === 'dir' && S.expanded.has(it.path)) {
        const kids = document.createElement('div'); node.append(kids);
        await buildLevel(kids, it.path, depth + 1);
      }
      parent.append(node);
    }
  }

  function makeRow(it, depth, sub) {
    const row = document.createElement('div');
    row.className = 'row' + (sub ? ' search-hit' : '');
    row.dataset.path = it.path;
    row.style.paddingLeft = (4 + depth * 14) + 'px';
    row.draggable = true;
    const isDir = it.type === 'dir';
    row.innerHTML = `<span class="twisty ${isDir ? (S.expanded.has(it.path) ? 'open' : '') : 'none'}">▶</span>
      <span class="ico">${iconFor(it)}</span><span class="label">${esc(displayName(it))}${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</span>
      <span class="row-actions">${isDir ? '<button data-a="new" title="Neue Seite hier">+</button>' : ''}<button data-a="more" title="Mehr">⋯</button></span>`;
    row.title = it.path;
    row.addEventListener('click', e => {
      const a = e.target.closest('[data-a]');
      if (a) { e.stopPropagation(); if (a.dataset.a === 'new') newPage(it.path); else itemMenu(it, a); return; }
      if (e.target.closest('.twisty') && isDir) { toggle(it.path); return; }
      if (isDir && !S.expanded.has(it.path)) toggle(it.path, true);
      go(it.path);
    });
    row.addEventListener('contextmenu', e => { e.preventDefault(); itemMenu(it, { x: e.clientX, y: e.clientY }); });
    row.addEventListener('dragstart', e => { e.dataTransfer.setData('text/x-lern-path', it.path); e.dataTransfer.effectAllowed = 'move'; });
    if (isDir) makeDropTarget(row, it.path);
    return row;
  }

  // Ordner als Ziel: Einträge verschieben oder Dateien vom PC hochladen
  function makeDropTarget(el, dir) {
    el.addEventListener('dragover', e => {
      const t = e.dataTransfer.types;
      if (!t.includes('text/x-lern-path') && !t.includes('Files')) return;
      e.preventDefault(); e.stopPropagation(); el.classList.add('drop');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop'));
    el.addEventListener('drop', async e => {
      el.classList.remove('drop');
      const from = e.dataTransfer.getData('text/x-lern-path');
      if (!from && !e.dataTransfer.files.length) return;
      e.preventDefault(); e.stopPropagation();
      if (from) return moveItem(from, dir);
      uploadTo(dir, [...e.dataTransfer.files]);
    });
  }

  async function toggle(dir, forceOpen) {
    if (S.expanded.has(dir) && !forceOpen) S.expanded.delete(dir); else S.expanded.add(dir);
    store.set(expKey(), [...S.expanded]);
    await renderTree();
  }

  function markActive() {
    document.querySelectorAll('.row.active').forEach(r => r.classList.remove('active'));
    if (S.path) document.querySelectorAll(`.row[data-path="${CSS.escape(S.path)}"]`).forEach(r => r.classList.add('active'));
    document.querySelector('[data-go="home"]').classList.toggle('active', S.kind === 'home');
  }

  async function expandTo(p) {
    const parts = p.split('/'); let changed = false;
    for (let i = 1; i < parts.length; i++) { const d = parts.slice(0, i).join('/'); if (!S.expanded.has(d)) { S.expanded.add(d); changed = true; } }
    if (changed) { store.set(expKey(), [...S.expanded]); await renderTree(); }
    else markActive();
    document.querySelector(`#tree .row[data-path="${CSS.escape(p)}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  // ---------- Suche ----------
  let searchTimer;
  $('#searchInput').addEventListener('input', e => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    if (!q) { $('#searchResults').hidden = true; $('#tree').hidden = false; return; }
    searchTimer = setTimeout(async () => {
      const hits = await api.search(q).catch(() => []);
      const box = $('#searchResults'); box.innerHTML = '';
      if (!hits.length) box.innerHTML = '<div class="empty">Nichts gefunden</div>';
      for (const h of hits) box.append(makeRow(h, 0, P.dir(h.path) || S.rootName));
      box.hidden = false; $('#tree').hidden = true;
    }, 180);
  });
  $('#searchInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('#searchResults .row')?.click();
    if (e.key === 'Escape') { e.target.value = ''; e.target.dispatchEvent(new Event('input')); e.target.blur(); }
  });

  // ================== Aktionen ==================
  async function newPage(dir) {
    try {
      const r = await api.create(dir, 'Unbenannt.md', '');
      if (dir && !S.expanded.has(dir)) { S.expanded.add(dir); store.set(expKey(), [...S.expanded]); }
      await listing(dir, true); renderTree();
      S.focusTitle = true; go(r.path);
    } catch (e) { UI.toast(e.message, true); }
  }

  async function newFolder(dir, anchor) {
    const name = await askText('Name des neuen Ordners', 'Neuer Ordner', anchor, 'Erstellen');
    if (!name) return;
    try {
      const r = await api.mkdir(dir, cleanName(name));
      if (dir) S.expanded.add(dir);
      await listing(dir, true); renderTree(); go(r.path);
    } catch (e) { UI.toast(e.message, true); }
  }

  async function uploadTo(dir, files) {
    let ok = 0;
    for (const f of files) {
      UI.toast(`Lade hoch: ${f.name} (${ok + 1}/${files.length}) …`);
      try { await api.create(dir, f.name, f); ok++; } catch (e) { UI.toast(`${f.name}: ${e.message}`, true); }
    }
    await listing(dir, true).catch(() => {}); renderTree();
    if (S.kind === 'folder' && S.path === dir || S.kind === 'home' && !dir) refreshView();
    if (ok) UI.toast(`${ok} Datei${ok > 1 ? 'en' : ''} hinzugefügt ✓`);
  }

  async function renameItem(it, anchor) {
    const isMd = it.type === 'file' && it.ext === '.md';
    const cur = isMd ? P.stem(it.path) : P.base(it.path);
    let name = await askText('Umbenennen', cur, anchor, 'Speichern');
    if (!name) return;
    name = cleanName(name); if (!name || name === cur) return;
    const to = P.join(P.dir(it.path), isMd ? name + '.md' : name);
    await doMove(it.path, to);
  }

  async function moveItem(from, toDir) {
    if (P.dir(from) === toDir || P.inside(toDir, from)) return;
    await doMove(from, P.join(toDir, P.base(from)));
  }

  async function doMove(from, to) {
    if (S.doc && P.inside(S.doc.path, from)) await flushSave();
    try { await api.rename(from, to); }
    catch (e) { UI.toast(e.message, true); return; }
    // Offene Ansicht auf den neuen Pfad umstellen
    if (S.path && P.inside(S.path, from)) {
      const np = to + S.path.slice(from.length);
      if (S.doc && P.inside(S.doc.path, from)) S.doc.path = to + S.doc.path.slice(from.length);
      S.path = np; history.replaceState(null, '', hashFor(np)); renderCrumbs();
      if (S.kind === 'note') $('.page-title').textContent = P.stem(np);
    }
    if (S.expanded.has(from)) { S.expanded.delete(from); S.expanded.add(to); store.set(expKey(), [...S.expanded]); }
    S.cache.delete(from);
    await Promise.all([listing(P.dir(from), true), listing(P.dir(to), true)].map(p => p.catch(() => {})));
    renderTree();
  }

  async function deleteItem(it) {
    if (!confirm(`„${displayName(it)}“ in den Papierkorb verschieben?\n\n(Du kannst es im Windows-Papierkorb wiederherstellen.)`)) return;
    if (S.doc && P.inside(S.doc.path, it.path)) { clearTimeout(S.doc.timer); S.doc = null; }
    try { await api.del(it.path); } catch (e) { UI.toast(e.message, true); return; }
    UI.toast('In den Papierkorb verschoben');
    S.cache.delete(it.path); S.expanded.delete(it.path);
    await listing(P.dir(it.path), true).catch(() => {});
    renderTree();
    if (S.path && P.inside(S.path, it.path)) go(P.dir(it.path));
  }

  function itemMenu(it, anchor) {
    const isDir = it.type === 'dir';
    const items = [{ icon: '↗', label: 'Öffnen', run: () => go(it.path) }];
    if (isDir) items.push(
      { icon: '📝', label: 'Neue Seite hier', run: () => newPage(it.path) },
      { icon: '📁', label: 'Neuer Ordner hier', run: () => newFolder(it.path, anchor) },
      { icon: '📄', label: 'Neues Dokument …', run: () => newDocMenu(it.path, anchor) },
      { icon: '⬆️', label: 'Dateien hochladen …', run: () => pickFiles('', f => uploadTo(it.path, f)) },
    );
    else items.push(
      { icon: '🪟', label: 'Mit Standard-App öffnen', run: () => api.open(it.path) },
      { icon: '🧰', label: 'Öffnen mit …', run: () => openWithMenu(it.path, anchor) },
    );
    items.push('sep',
      { icon: '✏️', label: 'Umbenennen', run: () => renameItem(it, anchor) },
      { icon: '📂', label: 'Im Explorer zeigen', run: () => api.open(it.path, true) },
      'sep',
      { icon: '🗑', label: 'In den Papierkorb', danger: true, run: () => deleteItem(it) });
    UI.menu(items, anchor, { compact: true });
  }

  // ================== Verknüpfte Ordner (aus dem Explorer wählen) ==================
  function setRoot(root, name) {
    S.root = root; S.rootName = name;
    S.expanded = new Set(store.get(expKey(), []));
    $('#rootName').textContent = root;
    $('#homeBtn').title = 'Ordner wechseln – verknüpft: ' + root;
    document.title = name + ' – Lernplattform';
  }

  async function applyRoot(root, name) {
    await leaveCurrent();
    setRoot(root, name);
    S.cache.clear(); S.path = ''; S.kind = null;
    await renderTree();
    if (location.hash === '#/' || !location.hash) route(); else go('');
    UI.toast('📂 Verknüpft: ' + root);
  }

  async function switchFolder(dir) {
    try { await leaveCurrent(); await post(`/api/folders/switch?path=${enc(dir)}`); }
    catch (e) { UI.toast(e.message, true); }
  }

  async function addFolder() {
    UI.toast('Windows-Dialog „Ordner auswählen“ ist geöffnet …');
    try {
      await leaveCurrent();
      const r = await post('/api/folders/pick');
      if (r.cancelled) UI.toast('Kein Ordner ausgewählt');
    } catch (e) { UI.toast(e.message, true); }
  }

  async function folderMenu(anchor) {
    let data; try { data = await req('/api/folders').then(r => r.json()); } catch (e) { UI.toast(e.message, true); return; }
    const items = [{ title: 'Verknüpfte Ordner' }];
    for (const f of data.folders) items.push({
      icon: f.current ? '✅' : f.exists ? '📁' : '⚠️', label: f.name, sub: f.exists ? f.path : f.path + ' (nicht gefunden)',
      run: () => { if (!f.current && f.exists) switchFolder(f.path); else if (f.current) go(''); },
    });
    items.push('sep',
      { icon: '➕', label: 'Ordner hinzufügen …', sub: 'Beliebigen Ordner im Explorer auswählen', run: addFolder },
      { icon: '🏠', label: 'Startseite', run: () => go('') },
      { icon: '📂', label: 'Im Explorer öffnen', run: () => api.open('', false) });
    const others = data.folders.filter(f => !f.current);
    if (others.length) items.push({ icon: '✕', label: 'Ordner aus der Liste entfernen …', sub: 'Die Dateien bleiben erhalten', run: () => {
      UI.menu([{ title: 'Aus der Liste entfernen' }, ...others.map(f => ({ icon: '✕', label: f.name, sub: f.path, danger: true,
        run: async () => { await post(`/api/folders/remove?path=${enc(f.path)}`); UI.toast('„' + f.name + '“ aus der Liste entfernt (Dateien bleiben erhalten)'); } }))], anchor, { compact: true });
    } });
    UI.menu(items, anchor, { compact: true });
  }

  // ================== Navigation ==================
  function currentHashPath() {
    const h = location.hash.replace(/^#\/?/, '');
    return h ? h.split('/').map(decode).join('/') : '';
  }

  async function leaveCurrent() {
    clearTimeout(fileRefreshTimer); clearTimeout(viewRefreshTimer);
    if (S.doc) await flushSave();
    S.doc = null;
    if (S.bin && S.bin.dirty) { try { await saveBin(true); } catch {} }
    S.bin?.ed.destroy?.();
    S.bin = null;
    if (S.editor) { S.editor.destroy(); S.editor = null; }
    hideBanner(); setSave('');
    $('#topButtons').innerHTML = '';
  }

  async function route() {
    const token = ++S.routeToken;
    const p = currentHashPath();
    await leaveCurrent();
    if (token !== S.routeToken) return;
    view.scrollTop = 0;
    if (!p) { S.kind = 'home'; S.path = ''; renderCrumbs(); markActive(); return showHome(token); }
    let st; try { st = await api.stat(p); } catch { st = { exists: false }; }
    if (token !== S.routeToken) return;
    S.path = p;
    if (!st.exists) { S.kind = 'missing'; renderCrumbs(); view.innerHTML = `<div class="other-view"><div class="big">🔍</div><h2>Nicht gefunden</h2><p>„${esc(p)}“ gibt es nicht (mehr) im Ordner.</p><div class="btns"><button class="btn primary" onclick="location.hash='#/'">Zur Startseite</button></div></div>`; markActive(); return; }
    S.kind = st.type === 'dir' ? 'folder' : kindOf(P.ext(p));
    renderCrumbs();
    expandTo(p);
    if (st.type === 'dir') return showFolder(p, token);
    return showFile(p, st, token);
  }

  function renderCrumbs() {
    const c = $('#crumbs'); c.innerHTML = '';
    const add = (label, p) => { const b = document.createElement('button'); b.textContent = label; b.onclick = () => go(p); c.append(b); };
    add('🏠 ' + S.rootName, '');
    if (!S.path) return;
    const parts = S.path.split('/');
    parts.forEach((seg, i) => {
      c.insertAdjacentHTML('beforeend', '<span class="sep">/</span>');
      const p = parts.slice(0, i + 1).join('/');
      add(i === parts.length - 1 && P.ext(seg) === '.md' ? P.stem(seg) : seg, p);
    });
  }

  function topButton(label, title, fn) {
    const b = document.createElement('button'); b.className = 'btn'; b.innerHTML = label; b.title = title; b.onclick = e => fn(e.currentTarget);
    $('#topButtons').append(b); return b;
  }

  // ---------- Karten ----------
  function card(it) {
    const c = document.createElement('button'); c.className = 'card';
    const k = it.type === 'dir' ? 'dir' : kindOf(it.ext);
    let thumb;
    if (k === 'dir') {
      const [c1, c2] = PALETTE[hash(it.name) % PALETTE.length];
      thumb = `<div class="thumb folder" style="--c1:${c1};--c2:${c2}">${subjectIcon(it.name)}</div>`;
    } else if (k === 'image') thumb = `<div class="thumb" style="background-image:url('${raw(it.path)}')"></div>`;
    else thumb = `<div class="thumb">${iconFor(it)}</div>`;
    const sub = it.type === 'dir' ? 'Ordner' : `${it.ext === '.md' ? 'Seite' : (it.ext.slice(1).toUpperCase() || 'Datei')} · ${it.mtime ? relTime(it.mtime) : ''}`;
    c.innerHTML = `${thumb}<div class="meta"><div class="name">${esc(displayName(it))}</div><div class="sub">${esc(sub)}</div></div>`;
    c.title = it.name;
    c.onclick = () => { if (it.type === 'dir' && !S.expanded.has(it.path)) toggle(it.path, true); go(it.path); };
    c.oncontextmenu = e => { e.preventDefault(); itemMenu(it, { x: e.clientX, y: e.clientY }); };
    c.draggable = true;
    c.addEventListener('dragstart', e => { e.dataTransfer.setData('text/x-lern-path', it.path); });
    if (it.type === 'dir') makeDropTarget(c, it.path);
    return c;
  }

  function listRow(it) {
    const r = document.createElement('button'); r.className = 'list-row';
    r.innerHTML = `<span class="ico">${iconFor(it)}</span><span class="name">${esc(displayName(it))}</span><span class="sub">${esc(P.dir(it.path) || S.rootName)}</span><span class="sub">${relTime(it.mtime)}</span>`;
    r.onclick = () => go(it.path);
    return r;
  }

  function sectionGrid(host, title, items) {
    if (!items.length) return;
    host.insertAdjacentHTML('beforeend', `<div class="section-title">${title}<span style="font-weight:400;color:var(--text-3)">${items.length}</span></div>`);
    const g = document.createElement('div'); g.className = 'grid';
    items.forEach(it => g.append(card(it)));
    host.append(g);
  }

  // ---------- Startseite ----------
  async function showHome(token) {
    $('#topButtons').innerHTML = '';
    topButton('📂 Im Explorer', 'Hauptordner im Explorer öffnen', () => api.open('', false));
    const h = new Date().getHours();
    const greet = h < 11 ? 'Guten Morgen' : h < 18 ? 'Hallo' : 'Guten Abend';
    const [items, recent] = await Promise.all([listing('', true).catch(() => []), api.recent().catch(() => [])]);
    if (token !== S.routeToken) return;
    const page = document.createElement('div'); page.className = 'page wide';
    page.innerHTML = `<div class="hero"><h1>${greet} 👋</h1><p>Alle deine Schulunterlagen aus <b>${esc(S.rootName)}</b> – live mit dem Ordner synchronisiert.</p></div>
      <div class="folder-actions" style="margin-top:18px"><button class="btn" data-a="page">📝 Neue Seite</button><button class="btn" data-a="newdoc">📄 Neues Dokument</button><button class="btn" data-a="folder">📁 Neuer Ordner</button><button class="btn" data-a="upload">⬆️ Dateien hochladen</button></div>`;
    page.querySelector('[data-a=page]').onclick = () => newPage('');
    page.querySelector('[data-a=newdoc]').onclick = e => newDocMenu('', e.currentTarget);
    page.querySelector('[data-a=folder]').onclick = e => newFolder('', e.currentTarget);
    page.querySelector('[data-a=upload]').onclick = () => pickFiles('', f => uploadTo('', f));
    const other = document.createElement('button'); other.className = 'btn'; other.dataset.a = 'otherfolder'; other.textContent = '🗂️ Anderen Ordner öffnen';
    other.onclick = e => folderMenu(e.currentTarget); page.querySelector('.folder-actions').append(other);
    sectionGrid(page, '📂 Ordner', items.filter(i => i.type === 'dir'));
    if (recent.length) {
      page.insertAdjacentHTML('beforeend', '<div class="section-title">🕒 Zuletzt bearbeitet</div>');
      const l = document.createElement('div'); l.className = 'list';
      recent.forEach(r => l.append(listRow(r)));
      page.append(l);
    }
    sectionGrid(page, '📄 Dateien', items.filter(i => i.type === 'file'));
    view.replaceChildren(page);
  }

  // ---------- Ordneransicht ----------
  async function showFolder(p, token) {
    let items; try { items = await listing(p, true); } catch (e) { view.innerHTML = `<div class="other-view"><p>${esc(e.message)}</p></div>`; return; }
    if (token !== S.routeToken) return;
    $('#topButtons').innerHTML = '';
    topButton('📂 Im Explorer', 'Ordner im Windows-Explorer öffnen', () => api.open(p, false));
    topButton('⋯', 'Mehr', a => itemMenu({ type: 'dir', path: p, name: P.base(p) }, a));

    const page = document.createElement('div'); page.className = 'page wide';
    page.innerHTML = `<div style="font-size:56px;line-height:1;margin:48px 0 12px">${subjectIcon(P.base(p))}</div>
      <div class="folder-head"><h1 class="page-title" contenteditable="plaintext-only" spellcheck="false" title="Klicken zum Umbenennen"></h1>
      <div class="folder-actions"><button class="btn" data-a="page">📝 Neue Seite</button><button class="btn" data-a="newdoc">📄 Neues Dokument</button><button class="btn" data-a="folder">📁 Neuer Ordner</button><button class="btn" data-a="upload">⬆️ Hochladen</button></div></div>`;
    const title = page.querySelector('.page-title'); title.textContent = P.base(p);
    title.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } if (e.key === 'Escape') { title.textContent = P.base(S.path); title.blur(); } };
    title.onblur = () => {
      const n = cleanName(title.textContent);
      if (!n || n === P.base(S.path)) { title.textContent = P.base(S.path); return; }
      doMove(S.path, P.join(P.dir(S.path), n));
    };
    page.querySelector('[data-a=page]').onclick = () => newPage(p);
    page.querySelector('[data-a=newdoc]').onclick = e => newDocMenu(p, e.currentTarget);
    page.querySelector('[data-a=folder]').onclick = e => newFolder(p, e.currentTarget);
    page.querySelector('[data-a=upload]').onclick = () => pickFiles('', f => uploadTo(p, f));

    sectionGrid(page, '📂 Ordner', items.filter(i => i.type === 'dir'));
    sectionGrid(page, '📝 Seiten', items.filter(i => i.ext === '.md'));
    sectionGrid(page, '📄 Dateien', items.filter(i => i.type === 'file' && i.ext !== '.md'));
    if (!items.length) page.insertAdjacentHTML('beforeend', `<div class="empty-state" style="margin-top:24px"><div style="font-size:40px">🗂️</div>Dieser Ordner ist leer.<br>Erstelle eine Seite oder zieh Dateien hierher.</div>`);
    view.replaceChildren(page);
  }

  // Dateien auf Startseite/Ordneransicht ziehen = hochladen
  view.addEventListener('dragover', e => {
    if (!(S.kind === 'folder' || S.kind === 'home') || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault(); view.classList.add('dragover');
  });
  view.addEventListener('dragleave', e => { if (!view.contains(e.relatedTarget)) view.classList.remove('dragover'); });
  view.addEventListener('drop', e => {
    view.classList.remove('dragover');
    if (!(S.kind === 'folder' || S.kind === 'home') || !e.dataTransfer.files.length) return;
    e.preventDefault(); uploadTo(S.path || '', [...e.dataTransfer.files]);
  });

  // ---------- Dateiansichten ----------
  // ---------- Externe Programme ----------
  const APP_ICONS = { word: '📘', excel: '📗', powerpoint: '📙', onenote: '📓', vscode: '💻', edge: '🌐', packettracer: '🛜', notepad: '📄' };
  const APP_FOR_EXT = {
    word: ['.doc', '.docx', '.docm', '.dot', '.dotx', '.odt', '.rtf'],
    excel: ['.xls', '.xlsx', '.xlsm', '.ods', '.csv', '.tsv'],
    powerpoint: ['.ppt', '.pptx', '.pptm', '.pps', '.ppsx', '.odp'],
    onenote: ['.one'],
    packettracer: ['.pkt', '.pka'],
    edge: ['.pdf', '.html', '.htm', '.svg'],
  };
  // Dateien, die sicher keine Textdateien sind (werden nicht als Text geprüft)
  const BINARY = new Set(['.doc', '.dot', '.ppt', '.pps', '.odt', '.odp', '.rtf', '.one', '.pkt', '.pka', '.pub', '.zip', '.rar', '.7z', '.gz', '.tar', '.exe', '.msi', '.dll', '.iso', '.jar', '.class', '.db', '.sqlite', '.psd', '.ai', '.ttf', '.otf', '.woff', '.woff2', '.vsdx', '.accdb']);

  function appsFor(ext, kind) {
    const list = Object.keys(APP_FOR_EXT).filter(a => APP_FOR_EXT[a].includes(ext));
    if (kind === 'text' || EXT.text.includes(ext) || ext === '.md') list.push('vscode', 'notepad');
    return list.filter(a => S.apps[a]);
  }

  function openIn(p, app) {
    const name = app === 'default' ? 'der Standard-App' : S.apps[app];
    (app === 'default' ? api.open(p) : api.openIn(p, app))
      .then(() => { if (app !== 'openwith') UI.toast(`Wird in ${name} geöffnet – gespeicherte Änderungen erscheinen hier automatisch`); })
      .catch(e => UI.toast(e.message, true));
  }

  function openWithMenu(p, anchor) {
    const ext = P.ext(p); const best = appsFor(ext, kindOf(ext));
    const rest = Object.keys(S.apps).filter(a => !best.includes(a));
    const item = a => ({ icon: APP_ICONS[a] || '🧰', label: S.apps[a], run: () => openIn(p, a) });
    UI.menu([
      ...(best.length ? [{ title: 'Empfohlen' }, ...best.map(item)] : []),
      { title: 'Alle Programme' }, ...rest.map(item),
      'sep',
      { icon: '🪟', label: 'Standard-App', run: () => openIn(p, 'default') },
      { icon: '🔎', label: 'Andere App wählen …', sub: 'Windows-Auswahl „Öffnen mit“', run: () => openIn(p, 'openwith') },
    ], anchor, { compact: true });
  }

  function newDocMenu(dir, anchor) {
    const make = (label, ext, app) => ({
      icon: APP_ICONS[app] || '📄', label,
      run: async () => {
        const name = await askText(`Name für ${label}`, 'Neues Dokument', anchor, 'Erstellen');
        if (!name) return;
        try {
          const r = ext === '.txt' ? await api.create(dir, cleanName(name) + '.txt', '') : await api.newDoc(dir, cleanName(name), ext);
          await listing(dir, true).catch(() => {}); renderTree();
          go(r.path);
          if (app && S.apps[app]) openIn(r.path, app);
        } catch (e) { UI.toast(e.message, true); }
      },
    });
    const items = [];
    if (S.apps.word) items.push(make('Word-Dokument', '.docx', 'word'));
    if (S.apps.excel) items.push(make('Excel-Tabelle', '.xlsx', 'excel'));
    if (S.apps.powerpoint) items.push(make('PowerPoint-Präsentation', '.pptx', 'powerpoint'));
    items.push(make('Textdatei', '.txt', null));
    UI.menu(items, anchor, { compact: true });
  }

  // ---------- Hilfsfunktionen für Vorschauen ----------
  const scriptCache = new Map();
  function loadScript(src) {
    if (!scriptCache.has(src)) scriptCache.set(src, new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Konnte ' + src + ' nicht laden'));
      document.head.append(s);
    }));
    return scriptCache.get(src);
  }
  const fetchBuf = async p => (await req(raw(p) + '&v=' + Date.now())).arrayBuffer();

  async function looksLikeText(p) {
    try {
      const r = await fetch(raw(p), { headers: { Range: 'bytes=0-8191' } });
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (!bytes.length) return true;
      if (bytes.includes(0)) return false;
      let ctrl = 0; for (const b of bytes) if (b < 9 || (b > 13 && b < 32)) ctrl++;
      return ctrl / bytes.length < 0.02;
    } catch { return false; }
  }

  function fileButtons(p, k) {
    const apps = appsFor(P.ext(p), k);
    if (apps[0]) topButton(`${APP_ICONS[apps[0]] || '✏️'} In ${esc(S.apps[apps[0]])} bearbeiten`, `Mit ${S.apps[apps[0]]} öffnen – Änderungen werden im Ordner gespeichert`, () => openIn(p, apps[0])).classList.add('primary');
    else topButton('🪟 Mit App öffnen', 'Mit dem Standardprogramm öffnen', () => openIn(p, 'default')).classList.add('primary');
    topButton('🧰 Öffnen mit ▾', 'Anderes Programm wählen', a => openWithMenu(p, a));
    topButton('📂', 'Im Explorer zeigen', () => api.open(p, true));
    topButton('⋯', 'Mehr', a => itemMenu({ type: 'file', path: p, name: P.base(p), ext: P.ext(p) }, a));
  }

  function fallbackCard(wrap, p, st, note) {
    const it = { type: 'file', path: p, ext: P.ext(p) };
    const apps = appsFor(it.ext, kindOf(it.ext));
    wrap.innerHTML = `<div class="other-view"><div class="big">${iconFor(it)}</div><h2>${esc(P.base(p))}</h2>
      <p>${st ? `${fmtSize(st.size)} · geändert ${relTime(st.mtime)}<br>` : ''}${esc(note || 'Für diese Datei gibt es keine Vorschau – öffne sie mit einem Programm.')}</p>
      <div class="btns"></div></div>`;
    const btns = wrap.querySelector('.btns');
    const add = (html, fn, primary) => { const b = document.createElement('button'); b.className = 'btn' + (primary ? ' primary' : ''); b.innerHTML = html; b.onclick = e => fn(e.currentTarget); btns.append(b); };
    apps.forEach((a, i) => add(`${APP_ICONS[a] || '✏️'} In ${esc(S.apps[a])} bearbeiten`, () => openIn(p, a), i === 0));
    if (!apps.length) add('🪟 Mit Standard-App öffnen', () => openIn(p, 'default'), true);
    add('🧰 Öffnen mit …', b => openWithMenu(p, b));
    add('📂 Im Explorer zeigen', () => api.open(p, true));
  }

  // ---------- Dateiansichten ----------
  async function showFile(p, st, token) {
    let k = S.kind;
    $('#topButtons').innerHTML = '';
    if (k === 'note') return showNote(p, token);
    if (k === 'other' && st.size < 3 * 1024 * 1024 && !BINARY.has(P.ext(p)) && await looksLikeText(p)) k = S.kind = 'text';
    if (token !== S.routeToken) return;
    fileButtons(p, k);
    const wrap = document.createElement('div'); wrap.className = 'file-view';
    view.replaceChildren(wrap);
    if (k === 'image') wrap.innerHTML = `<div class="image-view"><img src="${raw(p)}" alt=""></div>`;
    else if (k === 'video') wrap.innerHTML = `<div class="media-view"><video src="${raw(p)}" controls></video></div>`;
    else if (k === 'audio') wrap.innerHTML = `<div class="media-view"><audio src="${raw(p)}" controls></audio></div>`;
    else if (k === 'text' && ['.html', '.htm'].includes(P.ext(p)) && st.size < 3 * 1024 * 1024) return showHtml(p, token, wrap);
    else if (k === 'text' && st.size < 3 * 1024 * 1024) return showText(p, token, wrap);
    else if (['docx', 'sheet', 'slides', 'pdf'].includes(k)) {
      if (!st.size) return fallbackCard(wrap, p, st, 'Das Dokument ist noch leer. Öffne es zum Bearbeiten – danach erscheint hier die Vorschau.');
      wrap.innerHTML = '<div class="preview-loading">⏳ Vorschau wird geladen …</div>';
      try {
        const buf = await fetchBuf(p);
        if (token !== S.routeToken) return;
        if (k === 'docx') await renderDocx(wrap, buf, p);
        if (k === 'pdf') await renderPdf(wrap, buf, p);
        if (k === 'sheet') await renderSheet(wrap, buf);
        if (k === 'slides') await renderSlides(wrap, buf);
      } catch (e) {
        if (token === S.routeToken) fallbackCard(wrap, p, st, 'Die Vorschau konnte nicht erstellt werden (' + e.message + ').');
      }
    }
    else fallbackCard(wrap, p, st);
  }

  // Vorschau neu laden, wenn die Datei z. B. in Word gespeichert wurde
  let fileRefreshTimer;
  function refreshFile() {
    // Pfad und Ansicht jetzt merken – wurde inzwischen eine andere Datei geöffnet, nichts tun
    const token = S.routeToken; const p = S.path;
    clearTimeout(fileRefreshTimer);
    fileRefreshTimer = setTimeout(async () => {
      if (token !== S.routeToken || p !== S.path) return;
      const sc = view.scrollTop;
      const st = await api.stat(p).catch(() => null);
      if (!st || !st.exists || token !== S.routeToken) return;
      const b = S.bin;
      if (b && b.path === p) {
        if (b.saving) await b.saving.catch(() => {});
        // Eigene Speicherung? (gleiche Größe, Zeitstempel fast gleich – Windows rundet manchmal nach)
        const own = S.ownWrites.get(p);
        if (own && st.size === own.size && Math.abs(st.mtime - own.mtime) < 2000) return;
        if (b.dirty) {
          showBanner('Diese Datei wurde außerhalb der App geändert (z. B. in Word).', [
            ['Neu laden (meine Änderungen verwerfen)', () => { b.dirty = false; b.lastMtime = null; refreshFile(); }],
            ['Meine Änderungen speichern', () => saveBin().catch(() => {})],
          ]);
          return;
        }
      }
      S.kind = kindOf(P.ext(p));
      await showFile(p, st, token);
      view.scrollTop = sc;
      setSave('↻ Vorschau aktualisiert');
    }, 900);
  }

  // ---------- Word & PDF direkt bearbeiten ----------
  function makeBin(p, ed, bar) { return { path: p, ed, bar, dirty: false, lastMtime: null, saving: null }; }

  function updateBinUi() {
    const b = S.bin; if (!b) return;
    const btn = b.bar.querySelector('[data-save]'); if (btn) btn.disabled = !b.dirty;
    if (b.dirty) setSave('● Ungespeicherte Änderungen');
  }

  function markBinDirty() {
    const b = S.bin; if (!b) return;
    b.dirty = b.ed.isDirty();
    updateBinUi();
  }

  async function saveBin(leaving = false) {
    const b = S.bin; if (!b) return;
    if (b.saving) return b.saving;
    b.saving = (async () => {
      setSave('Speichert …');
      try {
        const bytes = await b.ed.getBytes();
        const r = await req(`/api/write?path=${enc(b.path)}&backup=${S.backedUp.has(b.path) ? 0 : 1}`, { method: 'POST', body: bytes }).then(x => x.json());
        S.backedUp.add(b.path);
        b.lastMtime = r.mtime; b.lastSize = bytes.length; b.savedAt = Date.now(); b.dirty = false;
        S.ownWrites.set(b.path, { size: bytes.length, mtime: r.mtime, at: Date.now() });
        if (r.backup) UI.toast('✓ Gespeichert – das Original liegt als Sicherung in LernPlattform\\Sicherungen');
        if (!leaving) {
          setSave('✓ Gespeichert');
          if (b.ed instanceof PdfEditor) await b.ed.reload(bytes);
          updateBinUi();
        }
      } catch (e) {
        setSave('⚠ Nicht gespeichert'); UI.toast(e.message, true); throw e;
      } finally { b.saving = null; }
    })();
    return b.saving;
  }

  async function renderDocx(wrap, buf, p) {
    await loadScript('/vendor/jszip.min.js');
    await loadScript('/vendor/docx-preview.min.js');
    const bar = document.createElement('div'); bar.className = 'doc-toolbar';
    bar.innerHTML = `<button class="tool" data-edit>✏️ Bearbeiten</button>
      <span class="fmt"><span class="sep"></span>
        <button class="tool" data-f="b" title="Fett (Strg+B)"><b>F</b></button><button class="tool" data-f="i" title="Kursiv (Strg+I)"><i>K</i></button>
        <button class="tool" data-f="u" title="Unterstrichen (Strg+U)"><u>U</u></button><button class="tool" data-f="s" title="Durchgestrichen"><s>S</s></button>
        <button class="tool" data-menu="color" title="Textfarbe">🎨 Farbe ▾</button><button class="tool" data-menu="hl" title="Text markieren">🖍️ Markieren ▾</button>
        <span class="sep"></span><button class="tool" data-row="add" title="Neue Tabellenzeile unter der aktuellen Zelle">＋ Zeile</button><button class="tool" data-row="del" title="Aktuelle Tabellenzeile löschen">− Zeile</button>
      </span><span class="doc-hint"></span><button class="btn primary" data-save disabled>💾 Speichern</button>`;
    const body = document.createElement('div');
    const ed = await new DocxEditor(body, buf, { onDirty: markBinDirty }).render();
    wrap.classList.add('doc-mode');
    wrap.replaceChildren(bar, body);
    S.bin = makeBin(p, ed, bar);
    const editBtn = bar.querySelector('[data-edit]'); const hint = bar.querySelector('.doc-hint');
    const apply = () => {
      ed.setEditing(S.docxEditing);
      editBtn.classList.toggle('on', S.docxEditing);
      editBtn.textContent = S.docxEditing ? '✏️ Bearbeiten: an' : '✏️ Bearbeiten';
      bar.querySelector('.fmt').hidden = !S.docxEditing;
      hint.textContent = S.docxEditing
        ? `Text anklicken und schreiben · Enter = neuer Absatz · Tab = nächste Zelle${ed.total - ed.pairs.length ? ` · ${ed.total - ed.pairs.length} schraffierte Stellen nur in Word` : ''}`
        : 'Vorschau – klicke „Bearbeiten“, um Text direkt zu ändern.';
    };
    editBtn.onclick = () => { S.docxEditing = !S.docxEditing; apply(); };
    // Formatieren: mousedown verhindern, damit die Markierung im Dokument erhalten bleibt
    bar.querySelectorAll('[data-f],[data-row],[data-menu]').forEach(b => b.addEventListener('mousedown', e => e.preventDefault()));
    bar.querySelectorAll('[data-f]').forEach(b => b.onclick = () => ed.format(b.dataset.f));
    bar.querySelectorAll('[data-row]').forEach(b => b.onclick = () => ed.rowOp(b.dataset.row));
    const COLORS = [['Schwarz', '000000'], ['Rot', 'C00000'], ['Blau', '0070C0'], ['Grün', '00B050'], ['Lila', '7030A0'], ['Orange', 'ED7D31']];
    const HLS = [['Gelb', 'yellow', '#ffff00'], ['Grün', 'green', '#00ff00'], ['Türkis', 'cyan', '#00ffff'], ['Pink', 'magenta', '#ff00ff'], ['Grau', 'lightGray', '#d3d3d3']];
    bar.querySelector('[data-menu=color]').onclick = e => UI.menu(COLORS.map(([n, c]) => ({ icon: `<span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:#${c}"></span>`, label: n, run: () => ed.format('color', c) })), e.currentTarget, { compact: true });
    bar.querySelector('[data-menu=hl]').onclick = e => UI.menu([...HLS.map(([n, v, c]) => ({ icon: `<span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${c}"></span>`, label: n, run: () => ed.format('highlight', v) })), 'sep', { icon: '✕', label: 'Markierung entfernen', run: () => ed.format('highlight', 'none') }], e.currentTarget, { compact: true });
    bar.querySelector('[data-save]').onclick = () => saveBin().catch(() => {});
    apply();
  }

  async function renderPdf(wrap, buf, p) {
    await loadScript('/vendor/pdf.min.js');
    await loadScript('/vendor/pdf-lib.min.js');
    await loadScript('/vendor/fontkit.umd.min.js');
    const host = document.createElement('div'); host.className = 'pdf-editor';
    wrap.classList.add('doc-mode');
    wrap.replaceChildren(host);
    const ed = new PdfEditor(host, buf, { onDirty: () => { markBinDirty(); }, onSave: () => saveBin().catch(() => {}), pickFiles, openLink: href => openHref(href, p) });
    await ed.render();
    S.bin = makeBin(p, ed, ed.bar);
  }

  async function renderSheet(wrap, buf) {
    await loadScript('/vendor/xlsx.full.min.js');
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    wrap.innerHTML = '<div class="sheet-tabs"></div><div class="sheet-view"></div>';
    const tabs = wrap.querySelector('.sheet-tabs'); const box = wrap.querySelector('.sheet-view');
    const show = i => {
      tabs.querySelectorAll('button').forEach((b, j) => b.classList.toggle('on', i === j));
      const ws = wb.Sheets[wb.SheetNames[i]];
      if (!ws || !ws['!ref']) { box.innerHTML = '<div class="empty-state" style="margin:24px">Dieses Blatt ist leer.</div>'; return; }
      const html = XLSX.utils.sheet_to_html(ws, { header: '', footer: '' });
      const table = new DOMParser().parseFromString(html, 'text/html').querySelector('table');
      const range = XLSX.utils.decode_range(ws['!ref']);
      // Spalten- (A, B, C …) und Zeilenköpfe wie in Excel
      const head = document.createElement('tr'); head.className = 'hdr';
      head.innerHTML = '<th></th>' + Array.from({ length: range.e.c - range.s.c + 1 }, (_, c) => `<th>${XLSX.utils.encode_col(range.s.c + c)}</th>`).join('');
      [...table.rows].forEach((tr, r) => tr.insertAdjacentHTML('afterbegin', `<th>${range.s.r + r + 1}</th>`));
      table.prepend(head);
      box.replaceChildren(table);
    };
    wb.SheetNames.forEach((n, i) => { const b = document.createElement('button'); b.textContent = n; b.onclick = () => show(i); tabs.append(b); });
    show(0);
  }

  async function renderSlides(wrap, buf) {
    await loadScript('/vendor/jszip.min.js');
    const zip = await JSZip.loadAsync(buf);
    const num = n => Number(/(\d+)\.xml$/.exec(n)[1]);
    const names = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
    const decodeXml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' };
    const blobUrl = async (file) => { const ext = file.split('.').pop().toLowerCase(); if (!mime[ext] || !zip.file(file)) return null; return URL.createObjectURL(new Blob([await zip.file(file).async('arraybuffer')], { type: mime[ext] })); };

    const page = document.createElement('div'); page.className = 'page wide slides-view';
    const thumb = zip.file('docProps/thumbnail.jpeg') ? URL.createObjectURL(new Blob([await zip.file('docProps/thumbnail.jpeg').async('arraybuffer')], { type: 'image/jpeg' })) : null;
    page.innerHTML = `<div class="slides-head">${thumb ? `<img src="${thumb}" alt="Erste Folie">` : ''}<div><h1>${esc(P.stem(S.path))}</h1><p>${names.length} Folie${names.length === 1 ? '' : 'n'} · Textvorschau. Zum Bearbeiten und für die volle Ansicht in PowerPoint öffnen.</p></div></div>`;
    const grid = document.createElement('div'); grid.className = 'slide-list';
    for (const [i, n] of names.entries()) {
      const xml = await zip.file(n).async('string');
      const paras = xml.split('</a:p>').map(seg => [...seg.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => decodeXml(m[1])).join('')).filter(t => t.trim());
      const relFile = n.replace('slides/', 'slides/_rels/') + '.rels';
      const imgs = [];
      if (zip.file(relFile)) {
        const rels = await zip.file(relFile).async('string');
        for (const m of rels.matchAll(/Target="\.\.\/media\/([^"]+)"/g)) { const u = await blobUrl('ppt/media/' + m[1]); if (u) imgs.push(u); if (imgs.length >= 3) break; }
      }
      const card = document.createElement('div'); card.className = 'slide-card';
      card.innerHTML = `<div class="slide-no">${i + 1}</div><div class="slide-body">${paras.length ? `<h3>${esc(paras[0])}</h3>${paras.slice(1).map(t => `<p>${esc(t)}</p>`).join('')}` : '<p class="muted">(kein Text)</p>'}
        ${imgs.length ? `<div class="slide-imgs">${imgs.map(u => `<img src="${u}" alt="">`).join('')}</div>` : ''}</div>`;
      grid.append(card);
    }
    page.append(grid);
    wrap.replaceChildren(page);
  }

  // ---------- Gemeinsames Speichern (Seiten & Textdateien) ----------
  function markDirty() {
    const d = S.doc; if (!d) return;
    d.seq++; setSave('Bearbeitet …');
    clearTimeout(d.timer); d.timer = setTimeout(saveDoc, 600);
  }

  async function saveDoc() {
    const d = S.doc; if (!d) return;
    clearTimeout(d.timer);
    if (d.saving) { d.again = true; return d.saving; }
    const content = d.getContent();
    const seq = d.seq;
    if (content === d.lastSaved) { d.savedSeq = seq; setSave('✓ Gespeichert'); return; }
    setSave('Speichert …');
    d.saving = (async () => {
      try {
        await api.write(d.path, content);
        d.lastSaved = content; d.savedSeq = seq;
        if (S.doc === d) setSave(d.seq === seq ? '✓ Gespeichert' : 'Bearbeitet …');
      } catch (e) {
        setSave('⚠ Nicht gespeichert'); UI.toast('Speichern fehlgeschlagen: ' + e.message, true);
      } finally {
        d.saving = null;
        if (d.again) { d.again = false; saveDoc(); }
      }
    })();
    return d.saving;
  }

  async function flushSave() {
    const d = S.doc; if (!d) return;
    if (d.saving) await d.saving;
    if (d.seq !== d.savedSeq) await saveDoc();
    if (d.saving) await d.saving;
  }

  const isDirty = d => d.seq !== d.savedSeq || !!d.saving;

  function makeDoc(path, text, getContent, apply) {
    return { path, lastSaved: text, seq: 0, savedSeq: 0, saving: null, timer: null, getContent, apply };
  }

  // Datei wurde im Ordner (außerhalb der App) verändert
  async function onDocChangedOnDisk() {
    const d = S.doc; if (!d) return;
    if (d.saving) await d.saving;
    let text;
    try { text = await api.read(d.path); }
    catch {
      showBanner('Diese Datei wurde im Ordner gelöscht oder verschoben.', [['Zur Startseite', () => go('')], ['Trotzdem speichern', () => { d.lastSaved = null; saveDoc(); }]]);
      return;
    }
    if (S.doc !== d || text === d.lastSaved) return;
    if (isDirty(d)) {
      showBanner('Diese Datei wurde außerhalb der App geändert.', [
        ['Neu laden', () => { d.seq = d.savedSeq; d.apply(text); }],
        ['Meine Version behalten', () => { d.lastSaved = null; d.seq++; saveDoc(); }],
      ]);
      return;
    }
    d.apply(text);
    setSave('↻ Vom Ordner aktualisiert');
  }

  // ---------- Textdateien ----------
  async function showText(p, token, wrap) {
    const text = await api.read(p);
    if (token !== S.routeToken) return;
    wrap.innerHTML = '<div class="text-view"><textarea spellcheck="false"></textarea></div>';
    const ta = wrap.querySelector('textarea'); ta.value = text;
    ta.addEventListener('input', markDirty);
    ta.addEventListener('keydown', e => { if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '    '); } });
    S.doc = makeDoc(p, text, () => ta.value, t => { const s = ta.selectionStart; ta.value = t; ta.lastSaved = t; S.doc.lastSaved = t; ta.selectionStart = ta.selectionEnd = Math.min(s, t.length); });
    view.replaceChildren(wrap);
  }

  // ---------- HTML-Dateien: Vorschau / Code / geteilt ----------
  const filesUrl = p => '/files/' + p.split('/').map(enc).join('/');
  async function showHtml(p, token, wrap) {
    const text = await api.read(p);
    if (token !== S.routeToken) return;
    wrap.classList.add('html-mode');
    wrap.innerHTML = `<div class="doc-toolbar"><button class="tool" data-m="preview" title="Nur die Webseite">👁️ Vorschau</button><button class="tool" data-m="split" title="Code und Vorschau nebeneinander – die Vorschau folgt beim Tippen">⬌ Geteilt</button><button class="tool" data-m="code" title="Nur den HTML-Code">&lt;/&gt; Code</button>
      <span class="sep"></span><button class="tool" data-reload title="Vorschau neu laden">↻ Neu laden</button><span class="doc-hint">Skripte laufen abgeschottet – sie können deine Dateien nicht verändern.</span><button class="btn" data-browser title="In einem eigenen Browserfenster öffnen">🌐 Im Browser öffnen</button></div>
      <div class="html-panes"><div class="text-view"><textarea spellcheck="false"></textarea></div><iframe class="html-frame" sandbox="allow-scripts allow-forms allow-popups allow-modals" title="HTML-Vorschau"></iframe></div>`;
    const ta = wrap.querySelector('textarea'); const frame = wrap.querySelector('iframe'); const panes = wrap.querySelector('.html-panes');
    ta.value = text;
    const base = `<base href="${location.origin}${filesUrl(P.dir(p) ? P.dir(p) + '/x' : 'x').replace(/x$/, '')}">`;
    const render = () => {
      const src = ta.value;
      frame.srcdoc = /<head[^>]*>/i.test(src) ? src.replace(/<head[^>]*>/i, m => m + base) : base + src;
    };
    let timer;
    ta.addEventListener('input', () => { markDirty(); clearTimeout(timer); timer = setTimeout(render, 350); });
    ta.addEventListener('keydown', e => { if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  '); } });
    const setMode = m => {
      panes.className = 'html-panes mode-' + m;
      wrap.querySelectorAll('[data-m]').forEach(b => b.classList.toggle('on', b.dataset.m === m));
      store.set('htmlMode', m);
    };
    wrap.querySelectorAll('[data-m]').forEach(b => b.onclick = () => setMode(b.dataset.m));
    wrap.querySelector('[data-reload]').onclick = render;
    wrap.querySelector('[data-browser]').onclick = () => window.open(filesUrl(S.doc ? S.doc.path : p), '_blank');
    setMode(store.get('htmlMode', 'preview'));
    const doc = makeDoc(p, text, () => ta.value, t => { const s = ta.selectionStart; ta.value = t; doc.lastSaved = t; ta.selectionStart = ta.selectionEnd = Math.min(s, t.length); render(); });
    S.doc = doc;
    render();
    view.replaceChildren(wrap);
  }

  // ---------- Seiten (Notion-artig) ----------
  async function showNote(p, token) {
    let text; try { text = await api.read(p); } catch (e) { UI.toast(e.message, true); return; }
    if (token !== S.routeToken) return;
    const parsed = MD.parse(text);
    const note = { meta: parsed.meta, extra: parsed.extra };

    topButton('⋯', 'Mehr', a => UI.menu([
      { icon: '😀', label: note.meta.icon ? 'Symbol ändern' : 'Symbol hinzufügen', run: () => pickEmoji(a, e => setMeta('icon', e)) },
      { icon: '🖼', label: note.meta.cover ? 'Cover ändern' : 'Cover hinzufügen', run: () => coverMenu(a) },
      'sep',
      { icon: '🧰', label: 'Öffnen mit …', run: () => openWithMenu(S.doc.path, a) },
      { icon: '📂', label: 'Im Explorer zeigen', run: () => api.open(S.doc.path, true) },
      'sep',
      { icon: '🗑', label: 'Seite in den Papierkorb', danger: true, run: () => deleteItem({ type: 'file', path: S.doc.path, ext: '.md', name: P.base(S.doc.path) }) },
    ], a, { compact: true }));

    const wrap = document.createElement('div'); wrap.className = 'note';
    wrap.innerHTML = `<div class="cover" hidden><div class="cover-actions"><button data-a="cover">Cover ändern</button><button data-a="nocover">Entfernen</button></div></div>
      <div class="page"><div class="page-head"><button class="page-icon" hidden title="Symbol ändern"></button>
      <div class="head-actions"><button class="btn" data-a="icon">😀 Symbol hinzufügen</button><button class="btn" data-a="addcover">🖼 Cover hinzufügen</button></div>
      <h1 class="page-title" contenteditable="plaintext-only" spellcheck="false" data-placeholder="Unbenannt"></h1></div>
      <div class="editor-host"></div></div>`;
    const title = wrap.querySelector('.page-title');
    title.textContent = P.stem(p) === 'Unbenannt' && S.focusTitle ? '' : P.stem(p);

    const editor = new Editor(wrap.querySelector('.editor-host'), {
      onChange: markDirty,
      resolveSrc: src => (/^(https?:|data:|blob:)/i.test(src) ? src : raw(P.resolve(P.dir(S.doc.path), decode(src)))),
      upload: async (file, isImg) => {
        const sub = isImg ? 'Bilder' : 'Dateien';
        let name = file.name && !/^image\.\w+$/i.test(file.name) ? file.name : `Bild-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}.${(file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg')}`;
        name = name.replace(/\s+/g, '-');
        const r = await api.create(P.join(P.dir(S.doc.path), sub), name, file);
        return `${sub}/${r.name}`;
      },
      openLink: href => openHref(href, S.doc.path),
      pickFiles, pickEmoji,
    });
    const doc = makeDoc(p, text,
      () => MD.serialize(note.meta, note.extra, editor.getData()),
      t => {
        const np = MD.parse(t);
        note.meta = np.meta; note.extra = np.extra;
        const cur = editor.getCursor(); const sc = view.scrollTop;
        editor.load(np.blocks); renderHead();
        doc.lastSaved = t;
        editor.setCursor(cur); view.scrollTop = sc;
      });
    S.doc = doc;
    S.editor = editor;
    editor.load(parsed.blocks);

    function setMeta(key, val) {
      if (val) note.meta[key] = val; else delete note.meta[key];
      renderHead(); markDirty();
    }

    function coverMenu(anchor) {
      const box = document.createElement('div');
      box.innerHTML = '<div class="m-title">Farbverlauf</div><div class="cover-grid"></div><div class="m-sep"></div>';
      COVERS.forEach((g, i) => {
        const b = document.createElement('button'); b.style.background = g;
        b.onclick = () => { UI.close(); setMeta('cover', 'gradient:' + i); };
        box.querySelector('.cover-grid').append(b);
      });
      const up = document.createElement('button'); up.className = 'm-item'; up.innerHTML = '<span class="m-ico">⬆️</span><span>Eigenes Bild hochladen</span>';
      up.onclick = () => { UI.close(); pickFiles('image/*', async ([f]) => { try { setMeta('cover', await editor.opts.upload(f, true)); } catch (e) { UI.toast(e.message, true); } }); };
      box.append(up);
      if (note.meta.cover) {
        const rm = document.createElement('button'); rm.className = 'm-item danger'; rm.innerHTML = '<span class="m-ico">✕</span><span>Cover entfernen</span>';
        rm.onclick = () => { UI.close(); setMeta('cover', null); };
        box.append(rm);
      }
      UI.custom(box, anchor, { compact: true });
    }

    function renderHead() {
      const cover = wrap.querySelector('.cover'); const icon = wrap.querySelector('.page-icon');
      const cv = note.meta.cover;
      if (cv) {
        const g = /^gradient:(\d+)$/.exec(cv);
        cover.style.backgroundImage = g ? COVERS[Number(g[1]) % COVERS.length] : `url("${raw(P.resolve(P.dir(S.doc ? S.doc.path : p), decode(cv)))}")`;
      }
      cover.hidden = !cv; wrap.classList.toggle('has-cover', !!cv);
      icon.hidden = !note.meta.icon; icon.textContent = note.meta.icon || '';
      wrap.querySelector('[data-a=icon]').hidden = !!note.meta.icon;
      wrap.querySelector('[data-a=addcover]').hidden = !!cv;
    }
    renderHead();

    wrap.querySelector('[data-a=icon]').onclick = e => pickEmoji(e.currentTarget, x => setMeta('icon', x));
    wrap.querySelector('.page-icon').onclick = e => pickEmoji(e.currentTarget, x => setMeta('icon', x));
    wrap.querySelector('[data-a=addcover]').onclick = () => setMeta('cover', 'gradient:' + Math.floor(Math.random() * COVERS.length));
    wrap.querySelector('[data-a=cover]').onclick = e => coverMenu(e.currentTarget);
    wrap.querySelector('[data-a=nocover]').onclick = () => setMeta('cover', null);

    // Titel = Dateiname
    title.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); editor.focusFirst(); }
      if (e.key === 'Escape') { title.textContent = P.stem(S.doc.path); title.blur(); }
    });
    const noteDoc = S.doc;
    title.addEventListener('blur', async () => {
      const d = S.doc; if (!d || d !== noteDoc) return;
      const n = cleanName(title.textContent) || 'Unbenannt';
      if (n === P.stem(d.path)) { title.textContent = n; return; }
      await doMove(d.path, P.join(P.dir(d.path), n + '.md'));
      title.textContent = P.stem(S.doc ? S.doc.path : d.path);
    });

    view.replaceChildren(wrap);
    if (S.focusTitle) { S.focusTitle = false; title.focus(); }
  }

  // ================== Live-Sync ==================
  let viewRefreshTimer;
  function refreshView() {
    const token = S.routeToken;
    clearTimeout(viewRefreshTimer);
    viewRefreshTimer = setTimeout(async () => {
      if (token !== S.routeToken) return;
      const sc = view.scrollTop;
      if (S.kind === 'folder') await showFolder(S.path, token);
      else if (S.kind === 'home') await showHome(token);
      view.scrollTop = sc;
    }, 250);
  }

  async function onChanges(paths) {
    const dirs = new Set();
    for (const p of paths) { dirs.add(P.dir(p)); if (S.cache.has(p)) dirs.add(p); }
    await Promise.all([...dirs].filter(d => S.cache.has(d)).map(async d => {
      try { S.cache.set(d, await api.list(d)); } catch { S.cache.delete(d); if (S.expanded.delete(d)) store.set(expKey(), [...S.expanded]); }
    }));
    renderTree();
    if (S.doc && paths.includes(S.doc.path)) onDocChangedOnDisk();
    if (S.kind === 'folder' && (dirs.has(S.path) || paths.some(p => P.dir(p) === S.path))) refreshView();
    if (S.kind === 'home' && paths.some(p => !p.includes('/'))) refreshView();
    if (['docx', 'sheet', 'slides', 'pdf', 'other'].includes(S.kind) && paths.includes(S.path)) refreshFile();
    if (['image'].includes(S.kind) && paths.includes(S.path)) {
      const el = view.querySelector('img, iframe'); if (el) el.src = raw(S.path) + '&v=' + Date.now();
    }
  }

  function connect() {
    const sync = $('#syncState');
    const es = new EventSource('/api/events');
    es.onopen = () => { sync.className = 'sync on'; sync.querySelector('em').textContent = 'Live synchronisiert'; };
    es.onerror = () => { sync.className = 'sync off'; sync.querySelector('em').textContent = 'Getrennt – starte die App neu'; };
    es.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.type === 'change') onChanges(m.paths);
      if (m.type === 'root' && m.root !== S.root) applyRoot(m.root, m.rootName);
    };
  }

  // ================== Allgemein ==================
  $('#homeBtn').onclick = e => folderMenu(e.currentTarget);
  document.querySelector('[data-go="home"]').onclick = () => go('');
  $('#newRootPage').onclick = () => newPage('');
  $('#themeBtn').onclick = () => {
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('theme', t); } catch {}
  };
  const setSide = hidden => { document.body.classList.toggle('side-hidden', hidden); $('#expandBtn').hidden = !hidden; store.set('sideHidden', hidden); };
  $('#collapseBtn').onclick = () => setSide(true);
  $('#expandBtn').onclick = () => setSide(false);
  setSide(store.get('sideHidden', false));
  makeDropTarget($('#tree'), '');

  document.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'k' && !e.target.closest('.editor')) { e.preventDefault(); $('#searchInput').focus(); $('#searchInput').select(); }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (S.bin) saveBin().catch(() => {}); else if (S.doc) saveDoc(); }
    if (mod && e.key === '\\') { e.preventDefault(); setSide(!document.body.classList.contains('side-hidden')); }
  });

  // Beim Schließen noch schnell speichern
  addEventListener('beforeunload', e => {
    if (S.bin && S.bin.dirty) { e.preventDefault(); e.returnValue = ''; }
    const d = S.doc;
    if (d && d.seq !== d.savedSeq) navigator.sendBeacon(`/api/write?path=${enc(d.path)}`, new Blob([d.getContent()], { type: 'text/plain' }));
  });

  addEventListener('hashchange', route);

  (async () => {
    window.__lern = { S };   // für die automatischen Tests
    try { const i = await api.info(); S.apps = i.apps || {}; S.exe = i.exe; setRoot(i.root, i.rootName); } catch {}
    await renderTree();
    connect();
    route();
  })();
})();
