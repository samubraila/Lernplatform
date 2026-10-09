// ================== Fotos und Bilder bearbeiten ==================
// Das Foto liegt als Zeichenfläche („base“) vor. Drehen, Spiegeln und Zuschneiden erzeugen eine neue Fläche;
// Stift, Formen und Text bleiben bis zum Speichern eigene Objekte (verschieben, löschen, Rückgängig).
// Helligkeit, Kontrast und Farbe zeigt die Anzeige per CSS-Filter, eingerechnet wird erst beim Speichern.

const IMG_TOOLS = [
  { id: 'select', icon: '🖱️', label: 'Auswählen', hint: 'Gezeichnetes anklicken und verschieben · Entf löscht · Doppelklick auf Text zum Ändern · ← → nächstes Bild' },
  { id: 'pen', icon: '✍️', label: 'Stift', hint: 'Mit gedrückter Maustaste (oder mit Stift/Finger) zeichnen' },
  { id: 'marker', icon: '🖍️', label: 'Textmarker', hint: 'Durchscheinend über wichtige Stellen malen' },
  { id: 'arrow', icon: '➜', label: 'Pfeil', hint: 'Ziehen, um einen Pfeil zu zeichnen', short: true },
  { id: 'rect', icon: '▭', label: 'Rahmen', hint: 'Ziehen, um einen Rahmen zu zeichnen', short: true },
  { id: 'ellipse', icon: '◯', label: 'Kreis', hint: 'Ziehen, um einen Kreis einzuzeichnen', short: true },
  { id: 'text', icon: '🔤', label: 'Text', hint: 'Klicke an die Stelle, an der du schreiben möchtest (Enter = neue Zeile, Esc = fertig)' },
  { id: 'cover', icon: '⬜', label: 'Abdecken', hint: 'Rechteck über Antworten ziehen – wird in der Papierfarbe drumherum gefüllt (z. B. um ein Arbeitsblatt neu zu üben)' },
  { id: 'pixel', icon: '▦', label: 'Verpixeln', hint: 'Rechteck über Namen oder Gesichter ziehen, um sie unkenntlich zu machen' },
  { id: 'eraser', icon: '🧽', label: 'Radierer', hint: 'Über Gezeichnetes fahren, um es zu entfernen – das Foto selbst bleibt unverändert' },
  { id: 'crop', icon: '✂️', label: 'Zuschneiden', hint: 'Rahmen an Ecken und Kanten ziehen oder neu aufziehen · Enter = zuschneiden · Esc = abbrechen' },
];
const IMG_COLORS = [['#e03131', 'Rot'], ['#f08c00', 'Orange'], ['#ffd43b', 'Gelb'], ['#2f9e44', 'Grün'], ['#1971c2', 'Blau'], ['#000000', 'Schwarz'], ['#ffffff', 'Weiß']];
const IMG_SIZES = ['Dünn', 'Mittel', 'Dick', 'Sehr dick'];
const IMG_PEN = [2, 4, 8, 16];          // Strichstärke je Größe (× Bildeinheit)
const IMG_TEXT = [10, 16, 24, 36];      // Textgröße je Größe (× Bildeinheit)
const IMG_SAVE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const IMG_RATIOS = [['Frei', 0], ['1:1', 1], ['4:3', 4 / 3], ['3:4', 3 / 4], ['16:9', 16 / 9], ['A4', 1 / Math.SQRT2]];
const IMG_PRESETS = { bw: { b: 105, c: 115, s: 0 }, scan: { b: 120, c: 180, s: 0 }, vivid: { b: 104, c: 112, s: 150 }, reset: { b: 100, c: 100, s: 100 } };
const IMG_FONT = '"Segoe UI", Arial, sans-serif';

class ImageEditor {
  constructor(host, buf, opts) {
    this.host = host; this.buf = buf; this.opts = opts;
    this.ext = (opts.ext || '').toLowerCase();
    this.canOverwrite = this.ext in IMG_SAVE_TYPES;   // GIF, BMP, AVIF … lassen sich im Browser nicht schreiben → PNG-Kopie
    this.saveType = IMG_SAVE_TYPES[this.ext] || 'image/png';
    this.tool = 'select'; this.color = '#e03131'; this.markerColor = '#ffd43b'; this.size = 1;
    this.objects = []; this.adjust = { ...IMG_PRESETS.reset }; this.sel = null;
    this.history = []; this.idx = -1; this.savedIdx = 0; this.pendingSaved = null;
    this.zoom = 1; this.fit = true;
    this.onDocKey = e => this.onKey(e);
    document.addEventListener('keydown', this.onDocKey);
  }
  destroy() { document.removeEventListener('keydown', this.onDocKey); this.resizeObs?.disconnect(); cancelAnimationFrame(this.raf); }

  get W() { return this.base.width; }
  get H() { return this.base.height; }
  // Strichstärken und Textgrößen wachsen mit dem Bild, damit sie auf kleinen und großen Fotos gleich wirken
  unit() { return Math.max(0.25, Math.max(this.W, this.H) / 800); }
  static canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  static clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  async render() {
    const url = URL.createObjectURL(new Blob([this.buf]));
    try {
      const img = new Image(); img.src = url;
      try { await img.decode(); } catch { throw new Error('Bildformat nicht lesbar'); }
      if (!img.naturalWidth || !img.naturalHeight) throw new Error('Bild ist leer');
      const c = ImageEditor.canvas(img.naturalWidth, img.naturalHeight);
      c.getContext('2d').drawImage(img, 0, 0);       // Handyfotos: die Drehung aus den EXIF-Daten übernimmt der Browser
      this.base = c;
    } finally { URL.revokeObjectURL(url); }
    this.buf = null;
    this.build();
    this.commit(true); this.savedIdx = this.idx;
    this.mountBase();
    this.setTool('select');
    this.applyFilter(); this.updateUndo();
    return this;
  }

  build() {
    const bar = document.createElement('div'); bar.className = 'doc-toolbar img-toolbar';
    bar.innerHTML = IMG_TOOLS.map(t => `<button class="tool" data-t="${t.id}" title="${t.label}: ${t.hint}">${t.icon}${t.short ? '' : ' ' + t.label}</button>`).join('') +
      `<span class="sep"></span>
       <button class="tool" data-act="rotl" title="Nach links drehen">⟲</button><button class="tool" data-act="rotr" title="Nach rechts drehen">⟳</button>
       <button class="tool" data-act="fliph" title="Spiegeln: links ↔ rechts">⇆</button><button class="tool" data-act="flipv" title="Spiegeln: oben ↕ unten">⇅</button>
       <button class="tool" data-act="adjust" title="Helligkeit, Kontrast und Farbe – z. B. Foto vom Arbeitsblatt wie gescannt">☀️ Anpassen</button>
       <span class="sep"></span><span class="img-swatches">${IMG_COLORS.map(([c, n]) => `<button class="swatch" data-color="${c}" style="--c:${c}" title="${n}"></button>`).join('')}</span>
       <label class="tool-opt" title="Eigene Farbe"><input type="color" data-color-input></label>
       <label class="tool-opt" title="Strichstärke und Textgröße"><select data-size>${IMG_SIZES.map((s, i) => `<option value="${i}" ${i === this.size ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
       <span class="sep"></span><button class="tool" data-undo title="Rückgängig (Strg+Z)">↶</button><button class="tool" data-redo title="Wiederholen (Strg+Y)">↷</button>
       <span class="sep"></span><button class="tool" data-zoom="-1" title="Verkleinern (Strg+Mausrad)">−</button><span class="tool-opt" data-zoomval>100%</span><button class="tool" data-zoom="1" title="Vergrößern (Strg+Mausrad)">+</button><button class="tool" data-fit title="Ganzes Bild zeigen">⤢</button>
       <button class="btn" data-copy title="Bearbeitetes Bild als neue Datei speichern – das Original bleibt unverändert">📄 Als Kopie</button>
       <button class="btn primary" data-save disabled title="${this.canOverwrite ? 'Speichern (Strg+S) – beim ersten Mal wird das Original gesichert' : 'Dieses Format kann nicht direkt gespeichert werden – es entsteht eine PNG-Kopie'}">💾 ${this.canOverwrite ? 'Speichern' : 'Als PNG speichern'}</button>`;

    const cropBar = document.createElement('div'); cropBar.className = 'doc-toolbar img-subbar'; cropBar.hidden = true;
    cropBar.innerHTML = `<span class="lbl">Seitenverhältnis:</span>${IMG_RATIOS.map(([n, r]) => `<button class="tool" data-ratio="${r}">${n}</button>`).join('')}
      <span class="tool-opt" data-cropsize></span><span class="grow"></span><button class="btn" data-crop="cancel">Abbrechen</button><button class="btn primary" data-crop="ok">✓ Zuschneiden</button>`;

    const adjBar = document.createElement('div'); adjBar.className = 'doc-toolbar img-subbar'; adjBar.hidden = true;
    adjBar.innerHTML = [['b', '☀️ Helligkeit', 40, 180], ['c', '◐ Kontrast', 40, 220], ['s', '🎨 Farbe', 0, 200]].map(([k, l, a, b]) =>
      `<label class="img-slider">${l}<input type="range" min="${a}" max="${b}" data-adj="${k}"><span data-adjval="${k}"></span></label>`).join('') +
      `<span class="sep"></span><button class="tool" data-preset="scan" title="Hell und kontrastreich wie gescannt – ideal für Fotos von Arbeitsblättern und der Tafel">📄 Dokument-Scan</button>
       <button class="tool" data-preset="bw">⚫ Schwarz-Weiß</button><button class="tool" data-preset="vivid">🌈 Kräftig</button><button class="tool" data-preset="reset">↺ Original</button>`;

    const wrap = document.createElement('div'); wrap.className = 'img-stage-wrap';
    wrap.innerHTML = `<div class="img-stage"><div class="img-stack"><div class="img-photo"></div><canvas class="img-ink"></canvas>
      <div class="img-crop" hidden>${['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(h => `<i data-h="${h}"></i>`).join('')}</div></div></div>
      <button class="img-nav" data-nav="prev" title="Vorheriges Bild (←)" hidden>‹</button><button class="img-nav" data-nav="next" title="Nächstes Bild (→)" hidden>›</button>`;
    const status = document.createElement('div'); status.className = 'img-status';
    status.innerHTML = '<span data-hint></span><span data-info></span>';
    this.host.replaceChildren(bar, cropBar, adjBar, wrap, status);
    Object.assign(this, { bar, cropBar, adjBar, status, stage: wrap.querySelector('.img-stage'), stack: wrap.querySelector('.img-stack'),
      photo: wrap.querySelector('.img-photo'), ink: wrap.querySelector('.img-ink'), cropEl: wrap.querySelector('.img-crop') });
    this.g = this.ink.getContext('2d');

    bar.querySelectorAll('[data-t]').forEach(b => b.onclick = () => this.setTool(b.dataset.t));
    bar.querySelector('[data-act=rotl]').onclick = () => this.rotate(-1);
    bar.querySelector('[data-act=rotr]').onclick = () => this.rotate(1);
    bar.querySelector('[data-act=fliph]').onclick = () => this.flip(true);
    bar.querySelector('[data-act=flipv]').onclick = () => this.flip(false);
    bar.querySelector('[data-act=adjust]').onclick = () => this.toggleAdjust();
    // Farbknöpfe nehmen dem Textfeld nicht den Fokus – die Farbe gilt dann für den Text, der gerade geschrieben wird
    bar.querySelectorAll('[data-color]').forEach(b => { b.onmousedown = e => e.preventDefault(); b.onclick = () => this.setColor(b.dataset.color); });
    bar.querySelector('[data-color-input]').oninput = e => this.setColor(e.target.value);
    bar.querySelector('[data-size]').onchange = e => this.setSize(Number(e.target.value));
    bar.querySelector('[data-undo]').onclick = () => this.undo();
    bar.querySelector('[data-redo]').onclick = () => this.redo();
    bar.querySelectorAll('[data-zoom]').forEach(b => b.onclick = () => this.setZoom(this.zoom * (b.dataset.zoom === '1' ? 1.25 : 0.8)));
    bar.querySelector('[data-fit]').onclick = () => { this.fit = true; this.applyZoom(); };
    bar.querySelector('[data-copy]').onclick = () => this.opts.onSaveCopy();
    bar.querySelector('[data-save]').onclick = () => this.opts.onSave();
    cropBar.querySelectorAll('[data-ratio]').forEach(b => b.onclick = () => this.setRatio(Number(b.dataset.ratio)));
    cropBar.querySelector('[data-crop=ok]').onclick = () => this.applyCrop();
    cropBar.querySelector('[data-crop=cancel]').onclick = () => this.setTool('select');
    adjBar.querySelectorAll('[data-adj]').forEach(inp => {
      inp.oninput = () => { this.adjust[inp.dataset.adj] = Number(inp.value); this.applyFilter(); };
      inp.onchange = () => this.commitAdjust();
    });
    adjBar.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => { Object.assign(this.adjust, IMG_PRESETS[b.dataset.preset]); this.applyFilter(); this.commitAdjust(); });
    const sib = this.opts.siblings;
    wrap.querySelectorAll('[data-nav]').forEach(b => { const to = sib?.[b.dataset.nav]; b.hidden = !to; b.onclick = () => this.opts.go(to); });

    this.stack.addEventListener('pointerdown', e => this.onDown(e));
    this.stack.addEventListener('pointermove', e => this.onHover(e));
    this.cropEl.addEventListener('pointerdown', e => this.onCropDown(e));
    this.stage.addEventListener('pointerdown', e => { if (e.target === this.stage) { this.finishText(); this.select(null); } });
    this.stage.addEventListener('wheel', e => { if (!e.ctrlKey) return; e.preventDefault(); this.setZoom(this.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e); }, { passive: false });
    this.resizeObs = new ResizeObserver(() => { if (this.fit) this.applyZoom(); });
    this.resizeObs.observe(this.stage);
  }

  // ---- Anzeige ----
  mountBase() {
    this.photo.replaceChildren(this.base);
    if (this.ink.width !== this.W || this.ink.height !== this.H) { this.ink.width = this.W; this.ink.height = this.H; }
    this.applyZoom();
    this.renderInk();
    const s = this.opts.siblings;
    this.status.querySelector('[data-info]').textContent = `${this.W} × ${this.H} px${s && s.total > 1 ? ` · Bild ${s.pos} von ${s.total}` : ''}`;
  }

  applyZoom(anchor) {
    const st = this.stage;
    if (this.fit) this.zoom = Math.min(1, Math.max(40, st.clientWidth - 48) / this.W, Math.max(40, st.clientHeight - 48) / this.H);
    this.stack.style.width = this.W * this.zoom + 'px'; this.stack.style.height = this.H * this.zoom + 'px';
    // Punkt unter dem Mauszeiger (bzw. Bildmitte) bleibt beim Zoomen an seiner Stelle
    if (anchor) { const r = this.stack.getBoundingClientRect(); st.scrollLeft += r.left + anchor.ix * this.zoom - anchor.cx; st.scrollTop += r.top + anchor.iy * this.zoom - anchor.cy; }
    this.bar.querySelector('[data-zoomval]').textContent = Math.round(this.zoom * 100) + '%';
    this.bar.querySelector('[data-fit]').classList.toggle('on', this.fit);
    this.positionText();
    this.scheduleRender();
  }

  setZoom(z, ev) {
    const sr = this.stage.getBoundingClientRect(), r = this.stack.getBoundingClientRect();
    const cx = ev ? ev.clientX : sr.left + sr.width / 2, cy = ev ? ev.clientY : sr.top + sr.height / 2;
    const anchor = { cx, cy, ix: (cx - r.left) / this.zoom, iy: (cy - r.top) / this.zoom };
    this.fit = false; this.zoom = ImageEditor.clamp(z, 0.02, 8);
    this.applyZoom(anchor);
  }

  filterCss() { const a = this.adjust; return a.b === 100 && a.c === 100 && a.s === 100 ? 'none' : `brightness(${a.b}%) contrast(${a.c}%) saturate(${a.s}%)`; }
  applyFilter() {
    const f = this.filterCss(); this.photo.style.filter = f === 'none' ? '' : f;
    this.adjBar.querySelectorAll('[data-adj]').forEach(i => { const k = i.dataset.adj; i.value = this.adjust[k]; this.adjBar.querySelector(`[data-adjval="${k}"]`).textContent = this.adjust[k] + ' %'; });
    this.scheduleRender();   // Abdecken und Verpixeln gehören zum Foto und bekommen denselben Filter
  }
  commitAdjust() { const last = this.history[this.idx].adjust; if (['b', 'c', 's'].some(k => last[k] !== this.adjust[k])) this.commit(); }
  toggleAdjust(on = this.adjBar.hidden) { this.adjBar.hidden = !on; this.bar.querySelector('[data-act=adjust]').classList.toggle('on', on); }

  scheduleRender() { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.renderInk(); }); }
  renderInk() {
    const g = this.g; g.clearRect(0, 0, this.W, this.H);
    for (const o of this.objects) if (o !== this.editingText) this.drawObj(g, o);
    if (this.sel && this.objects.includes(this.sel)) {
      const b = this.bbox(this.sel), z = this.zoom, p = 4 / z;
      g.save();
      g.lineWidth = 3 / z; g.strokeStyle = 'rgba(255,255,255,.9)'; g.strokeRect(b.x - p, b.y - p, b.w + 2 * p, b.h + 2 * p);
      g.lineWidth = 1.5 / z; g.setLineDash([6 / z, 4 / z]); g.strokeStyle = '#2383e2'; g.strokeRect(b.x - p, b.y - p, b.w + 2 * p, b.h + 2 * p);
      g.restore();
    }
  }

  // ---- Objekte zeichnen (Anzeige und Speichern nutzen denselben Code) ----
  font(size) { return `600 ${size}px ${IMG_FONT}`; }
  headSize(o) { return Math.max(o.width * 4.5, 6); }
  textMetrics(o) {
    const g = this.g; g.save(); g.font = this.font(o.size);
    const m = g.measureText('Hg'), lines = o.text.split('\n');
    const a = m.fontBoundingBoxAscent ?? o.size * 0.93, d = m.fontBoundingBoxDescent ?? o.size * 0.24;
    const w = Math.max(o.size * 0.5, ...lines.map(l => g.measureText(l).width));
    g.restore();
    const lh = o.size * 1.25;
    return { lines, a, d, lh, w, h: lines.length * lh };
  }

  drawObj(g, o) {
    g.save();
    g.strokeStyle = g.fillStyle = o.color || '#000'; g.lineWidth = o.width || 1; g.lineCap = g.lineJoin = 'round';
    if (o.type === 'stroke') {
      const p = o.points;
      if (o.marker) g.globalAlpha = 0.4;
      g.beginPath();
      if (p.length === 1) { g.arc(p[0][0], p[0][1], o.width / 2, 0, Math.PI * 2); g.fill(); }
      else {
        // weich: Kurven durch die Mittelpunkte der Abschnitte
        g.moveTo(p[0][0], p[0][1]);
        for (let i = 1; i < p.length - 1; i++) g.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
        g.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
        g.stroke();
      }
    } else if (o.type === 'arrow') {
      const h = this.headSize(o), a = Math.atan2(o.y2 - o.y1, o.x2 - o.x1);
      if (Math.hypot(o.x2 - o.x1, o.y2 - o.y1) > h * 0.7) { g.beginPath(); g.moveTo(o.x1, o.y1); g.lineTo(o.x2 - Math.cos(a) * h * 0.7, o.y2 - Math.sin(a) * h * 0.7); g.stroke(); }
      g.beginPath(); g.moveTo(o.x2, o.y2);
      g.lineTo(o.x2 - h * Math.cos(a - 0.45), o.y2 - h * Math.sin(a - 0.45));
      g.lineTo(o.x2 - h * Math.cos(a + 0.45), o.y2 - h * Math.sin(a + 0.45));
      g.closePath(); g.fill();
    } else if (o.type === 'rect') g.strokeRect(o.x, o.y, o.w, o.h);
    else if (o.type === 'ellipse') { g.beginPath(); g.ellipse(o.x + o.w / 2, o.y + o.h / 2, o.w / 2, o.h / 2, 0, 0, Math.PI * 2); g.stroke(); }
    else if (o.type === 'text') {
      const m = this.textMetrics(o);
      g.font = this.font(o.size); g.textBaseline = 'alphabetic';
      // Grundlinie wie im Textfeld beim Schreiben (gleiche Zeilenhöhe), damit nichts springt
      m.lines.forEach((l, i) => g.fillText(l, o.x, o.y + i * m.lh + (m.lh - m.a - m.d) / 2 + m.a));
    } else if (o.type === 'cover') {
      if (o.fill) { g.filter = this.filterCss(); g.fillStyle = o.fill; }
      else g.fillStyle = 'rgba(255, 255, 255, .75)';     // Vorschau beim Aufziehen
      g.fillRect(o.x, o.y, o.w, o.h);
    } else if (o.type === 'pixel') this.drawPixel(g, o);
    g.restore();
  }

  drawPixel(g, o) {
    const c = ImageEditor.clamp;
    const x = c(o.x, 0, this.W), y = c(o.y, 0, this.H), w = c(o.x + o.w, 0, this.W) - x, h = c(o.y + o.h, 0, this.H) - y;
    if (w < 1 || h < 1) return;
    const bs = Math.max(4, Math.max(this.W, this.H) / 60);
    const t = ImageEditor.canvas(Math.max(1, Math.round(w / bs)), Math.max(1, Math.round(h / bs)));
    t.getContext('2d').drawImage(this.base, x, y, w, h, 0, 0, t.width, t.height);
    g.imageSmoothingEnabled = false; g.filter = this.filterCss();
    g.drawImage(t, x, y, w, h);
  }

  bbox(o) {
    if (o.type === 'stroke' || o.type === 'arrow') {
      const pts = o.type === 'stroke' ? o.points : [[o.x1, o.y1], [o.x2, o.y2]];
      const r = o.type === 'stroke' ? o.width / 2 : this.headSize(o) / 2;
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const [x, y] of pts) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); }
      return { x: x1 - r, y: y1 - r, w: x2 - x1 + 2 * r, h: y2 - y1 + 2 * r };
    }
    if (o.type === 'text') { const m = this.textMetrics(o); return { x: o.x, y: o.y, w: m.w, h: m.h }; }
    const p = o.type === 'rect' || o.type === 'ellipse' ? o.width / 2 : 0;
    return { x: o.x - p, y: o.y - p, w: o.w + 2 * p, h: o.h + 2 * p };
  }

  static segDist(px, py, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
    const t = l ? ImageEditor.clamp(((px - a[0]) * dx + (py - a[1]) * dy) / l, 0, 1) : 0;
    return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy);
  }

  hits(o, x, y, tol) {
    if (o.type === 'stroke') {
      const p = o.points, r = o.width / 2 + tol;
      if (p.length === 1) return Math.hypot(x - p[0][0], y - p[0][1]) <= r;
      for (let i = 1; i < p.length; i++) if (ImageEditor.segDist(x, y, p[i - 1], p[i]) <= r) return true;
      return false;
    }
    if (o.type === 'arrow') return ImageEditor.segDist(x, y, [o.x1, o.y1], [o.x2, o.y2]) <= Math.max(o.width, this.headSize(o) / 2) + tol;
    const b = this.bbox(o);
    return x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol;
  }

  hitTest(x, y) {
    const tol = 6 / this.zoom;
    for (let i = this.objects.length - 1; i >= 0; i--) if (this.hits(this.objects[i], x, y, tol)) return this.objects[i];
    return null;
  }

  translate(o, dx, dy) {
    if (o.type === 'stroke') for (const p of o.points) { p[0] += dx; p[1] += dy; }
    else if (o.type === 'arrow') { o.x1 += dx; o.y1 += dy; o.x2 += dx; o.y2 += dy; }
    else { o.x += dx; o.y += dy; }
  }

  // Drehen, Spiegeln, Zuschneiden: Objekte wandern mit; Text bleibt dabei lesbar (nur seine Position ändert sich)
  transformObjects(fn) {
    for (const o of this.objects) {
      if (o.type === 'stroke') o.points = o.points.map(([x, y]) => fn(x, y));
      else if (o.type === 'arrow') { [o.x1, o.y1] = fn(o.x1, o.y1); [o.x2, o.y2] = fn(o.x2, o.y2); }
      else if (o.type === 'text') { const m = this.textMetrics(o); const [cx, cy] = fn(o.x + m.w / 2, o.y + m.h / 2); o.x = cx - m.w / 2; o.y = cy - m.h / 2; }
      else { const [x1, y1] = fn(o.x, o.y), [x2, y2] = fn(o.x + o.w, o.y + o.h); o.x = Math.min(x1, x2); o.y = Math.min(y1, y2); o.w = Math.abs(x2 - x1); o.h = Math.abs(y2 - y1); }
    }
  }

  // Papierfarbe rund um ein Rechteck: helle Randpixel mitteln (Schrift in der Nähe zählt nicht mit)
  paperColor(o) {
    const c = ImageEditor.clamp, pad = Math.max(3, Math.round(Math.max(this.W, this.H) / 200));
    const x0 = c(Math.floor(o.x) - pad, 0, this.W), y0 = c(Math.floor(o.y) - pad, 0, this.H);
    const x1 = c(Math.ceil(o.x + o.w) + pad, 0, this.W), y1 = c(Math.ceil(o.y + o.h) + pad, 0, this.H);
    const ix0 = c(Math.floor(o.x), x0, x1), iy0 = c(Math.floor(o.y), y0, y1), ix1 = c(Math.ceil(o.x + o.w), x0, x1), iy1 = c(Math.ceil(o.y + o.h), y0, y1);
    const g = this.base.getContext('2d'), px = [];
    const strip = (x, y, w, h) => {
      if (w < 1 || h < 1) return;
      const d = g.getImageData(x, y, w, h).data, step = Math.max(1, Math.round(Math.sqrt(w * h / 20000)));
      for (let j = 0; j < h; j += step) for (let i = 0; i < w; i += step) { const k = (j * w + i) * 4; if (d[k + 3] > 127) px.push([d[k], d[k + 1], d[k + 2]]); }
    };
    strip(x0, y0, x1 - x0, iy0 - y0); strip(x0, iy1, x1 - x0, y1 - iy1);
    strip(x0, iy0, ix0 - x0, iy1 - iy0); strip(ix1, iy0, x1 - ix1, iy1 - iy0);
    if (!px.length) return '#ffffff';
    px.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
    const part = px.slice(Math.floor(px.length * 0.5), Math.max(Math.floor(px.length * 0.5) + 1, Math.floor(px.length * 0.9)));
    const avg = k => Math.round(part.reduce((s, p) => s + p[k], 0) / part.length);
    return `rgb(${avg(0)}, ${avg(1)}, ${avg(2)})`;
  }

  // ---- Werkzeuge ----
  setTool(t) {
    this.finishText();
    this.tool = t;
    this.bar.querySelectorAll('[data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === t));
    this.host.dataset.tool = t;
    this.stack.style.cursor = '';
    this.status.querySelector('[data-hint]').textContent = IMG_TOOLS.find(x => x.id === t).hint;
    this.select(null);
    this.cropBar.hidden = this.cropEl.hidden = t !== 'crop';
    if (t === 'crop') { this.crop = { x: 0, y: 0, w: this.W, h: this.H }; this.ratio = 0; this.syncCrop(); }
  }

  select(o) { this.sel = o; this.syncColorUi(); this.scheduleRender(); }

  syncColorUi() {
    const o = this.editingText || this.sel;
    const c = o?.color || (o?.type === 'cover' && /^#/.test(o.fill) && o.fill) || (this.tool === 'marker' ? this.markerColor : this.color);
    this.bar.querySelectorAll('[data-color]').forEach(b => b.classList.toggle('on', b.dataset.color === c));
    this.bar.querySelector('[data-color-input]').value = /^#[0-9a-f]{6}$/i.test(c) ? c : '#000000';
  }

  // Farbe gilt für neue Striche – und für das ausgewählte bzw. gerade geschriebene Objekt
  setColor(c) {
    const o = this.editingText || this.sel;
    if (this.tool === 'marker' || o?.marker) this.markerColor = c; else this.color = c;
    if (o?.type === 'cover') { o.fill = c; this.commit(); }
    else if (o && 'color' in o && o.color !== c) {
      o.color = c;
      if (o === this.editingText) this.positionText(); else this.commit();
    }
    this.syncColorUi();
  }

  setSize(i) {
    this.size = i;
    const o = this.editingText || this.sel; if (!o) return;
    if (o.type === 'text') o.size = IMG_TEXT[i] * this.unit();
    else if ('width' in o) o.width = IMG_PEN[i] * this.unit() * (o.marker ? 3.5 : 1);
    else return;
    if (o === this.editingText) this.positionText(); else this.commit();
  }

  toImg(e) { const r = this.stack.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * this.W, (e.clientY - r.top) / r.height * this.H]; }

  // Ziehen mit Maus, Stift oder Finger – der Zeiger bleibt dabei an der Zeichenfläche „hängen“
  track(e, move, up) {
    const el = this.stack; try { el.setPointerCapture(e.pointerId); } catch {}
    this.dragging = true;
    const mv = ev => { if (ev.pointerId === e.pointerId) move(ev); };
    const end = ev => {
      if (ev.pointerId !== e.pointerId) return;
      el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', end); el.removeEventListener('pointercancel', end);
      this.dragging = false; up(ev);
    };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }

  onHover(e) {
    if (this.tool !== 'select' || this.dragging || e.target.closest('.img-textedit')) return;
    const [x, y] = this.toImg(e); this.stack.style.cursor = this.hitTest(x, y) ? 'move' : '';
  }

  onDown(e) {
    if (e.button !== 0 || e.target.closest('.img-textedit, .img-crop')) return;
    e.preventDefault();
    this.finishText();                  // Klick daneben beendet das Schreiben
    const t = this.tool, [x, y] = this.toImg(e);
    if (t === 'crop') return this.startNewCrop(e, x, y);
    if (t === 'select') {
      const o = this.hitTest(x, y);
      if (o && o.type === 'text' && o === this.sel && Date.now() - this.lastDown < 450) return this.editText(o);   // Doppelklick
      this.lastDown = Date.now();
      this.select(o);
      if (o) this.startMove(e, o, x, y);
      return;
    }
    if (t === 'text') {
      const hit = this.hitTest(x, y);
      if (hit && hit.type === 'text') return this.editText(hit);
      const size = IMG_TEXT[this.size] * this.unit();
      return this.editText({ type: 'text', x, y: y - size * 0.6, text: '', size, color: this.color }, true);
    }
    if (t === 'eraser') return this.startErase(e, x, y);
    if (t === 'pen' || t === 'marker') return this.startStroke(e, x, y);
    this.startShape(e, x, y);
  }

  startStroke(e, x, y) {
    const marker = this.tool === 'marker';
    const o = { type: 'stroke', marker, color: marker ? this.markerColor : this.color, width: IMG_PEN[this.size] * this.unit() * (marker ? 3.5 : 1), points: [[x, y]] };
    this.objects.push(o); this.select(null);
    const minD = 1 / this.zoom;
    this.track(e, ev => {
      const evs = ev.getCoalescedEvents?.(); // bei schnellen Bewegungen alle Zwischenpunkte, damit Linien rund werden
      for (const p of evs && evs.length ? evs : [ev]) {
        const q = this.toImg(p), l = o.points[o.points.length - 1];
        if (Math.hypot(q[0] - l[0], q[1] - l[1]) >= minD) o.points.push(q);
      }
      this.scheduleRender();
    }, () => this.commit());
  }

  startShape(e, x, y) {
    const t = this.tool, width = IMG_PEN[this.size] * this.unit();
    const o = t === 'arrow' ? { type: 'arrow', x1: x, y1: y, x2: x, y2: y, color: this.color, width }
      : t === 'rect' || t === 'ellipse' ? { type: t, x, y, w: 0, h: 0, color: this.color, width }
      : { type: t, x, y, w: 0, h: 0 };
    this.objects.push(o); this.select(null);
    this.track(e, ev => {
      const [px, py] = this.toImg(ev);
      if (o.type === 'arrow') { o.x2 = px; o.y2 = py; }
      else { o.x = Math.min(x, px); o.y = Math.min(y, py); o.w = Math.abs(px - x); o.h = Math.abs(py - y); }
      this.scheduleRender();
    }, () => {
      const z = this.zoom;
      const big = o.type === 'arrow' ? Math.hypot(o.x2 - o.x1, o.y2 - o.y1) * z > 6 : o.w * z > 3 && o.h * z > 3;
      if (!big) { this.objects = this.objects.filter(q => q !== o); this.scheduleRender(); return; }
      if (o.type === 'cover') o.fill = this.paperColor(o);
      this.commit();
    });
  }

  startMove(e, o, x, y) {
    let last = [x, y], moved = false;
    this.track(e, ev => {
      const p = this.toImg(ev); if (p[0] === last[0] && p[1] === last[1]) return;
      this.translate(o, p[0] - last[0], p[1] - last[1]); last = p; moved = true;
      this.scheduleRender();
    }, () => { if (moved) this.commit(); });
  }

  startErase(e, x, y) {
    let removed = false;
    const at = (px, py) => { const o = this.hitTest(px, py); if (o) { this.objects = this.objects.filter(q => q !== o); removed = true; this.scheduleRender(); } };
    at(x, y);
    this.track(e, ev => at(...this.toImg(ev)), () => { if (removed) { this.sel = null; this.commit(); } });
  }

  removeObj(o) { this.objects = this.objects.filter(q => q !== o); if (this.sel === o) this.sel = null; this.commit(); }

  // ---- Text schreiben ----
  editText(o, isNew = false) {
    this.finishText();
    this.select(null);
    const el = document.createElement('div'); el.className = 'img-textedit'; el.contentEditable = 'plaintext-only'; el.spellcheck = false;
    el.textContent = o.text;
    el.addEventListener('blur', () => this.finishText());
    el.addEventListener('input', () => this.opts.onDirty?.());     // schon beim Tippen „ungespeichert“ (falls die App geschlossen wird)
    el.addEventListener('pointerdown', e => e.stopPropagation());
    this.stack.append(el);
    Object.assign(this, { textEl: el, editingText: o, textIsNew: isNew });
    this.positionText(); this.syncColorUi(); this.scheduleRender();
    Caret.set(el, null);
  }

  positionText() {
    const el = this.textEl, o = this.editingText; if (!el) return;
    const z = this.zoom;
    Object.assign(el.style, { left: o.x * z + 'px', top: o.y * z + 'px', fontSize: o.size * z + 'px', lineHeight: o.size * 1.25 * z + 'px', color: o.color });
  }

  finishText() {
    const el = this.textEl; if (!el) return;
    const o = this.editingText, isNew = this.textIsNew;
    this.textEl = this.editingText = null;
    const text = el.innerText.replace(/\n$/, '');
    el.remove();
    if (!text.trim()) {
      if (!isNew) { this.objects = this.objects.filter(q => q !== o); this.commit(); } else this.scheduleRender();
      return;
    }
    const changed = isNew || text !== o.text;
    o.text = text;
    if (isNew) this.objects.push(o);
    this.select(o);                     // danach wirken Farbe und Größe weiter auf diesen Text
    if (changed) this.commit();
  }

  // ---- Zuschneiden ----
  syncCrop() {
    const c = this.crop, s = this.cropEl.style;
    Object.assign(s, { left: c.x / this.W * 100 + '%', top: c.y / this.H * 100 + '%', width: c.w / this.W * 100 + '%', height: c.h / this.H * 100 + '%' });
    this.cropBar.querySelector('[data-cropsize]').textContent = `${Math.round(c.w)} × ${Math.round(c.h)} px`;
    this.cropBar.querySelectorAll('[data-ratio]').forEach(b => b.classList.toggle('on', Number(b.dataset.ratio) === this.ratio));
  }

  onCropDown(e) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const mode = e.target.dataset.h || 'move', o = { ...this.crop }, [sx, sy] = this.toImg(e);
    this.track(e, ev => { const [px, py] = this.toImg(ev); this.crop = this.cropDrag(mode, o, px - sx, py - sy); this.syncCrop(); }, () => {});
  }

  cropDrag(mode, o, dx, dy) {
    const W = this.W, H = this.H, r = this.ratio, min = Math.min(W, H, 16 / this.zoom), c = ImageEditor.clamp;
    if (mode === 'move') return { ...o, x: c(o.x + dx, 0, W - o.w), y: c(o.y + dy, 0, H - o.h) };
    let l = o.x, t = o.y, R = o.x + o.w, B = o.y + o.h;
    if (mode.includes('w')) l = c(l + dx, 0, R - min);
    if (mode.includes('e')) R = c(R + dx, l + min, W);
    if (mode.includes('n')) t = c(t + dy, 0, B - min);
    if (mode.includes('s')) B = c(B + dy, t + min, H);
    if (r) {
      // festes Seitenverhältnis: die gegenüberliegende Kante bzw. Ecke bleibt stehen
      const horiz = /[ew]/.test(mode), vert = /[ns]/.test(mode), cx = o.x + o.w / 2, cy = o.y + o.h / 2;
      let w = R - l, h = B - t;
      if (vert && !horiz) w = h * r; else h = w / r;
      const maxW = mode.includes('w') ? R : mode.includes('e') ? W - l : Math.min(cx, W - cx) * 2;
      const maxH = mode.includes('n') ? B : mode.includes('s') ? H - t : Math.min(cy, H - cy) * 2;
      const k = Math.min(1, maxW / w, maxH / h); w *= k; h *= k;
      if (mode.includes('w')) l = R - w; else if (mode.includes('e')) R = l + w; else { l = cx - w / 2; R = l + w; }
      if (mode.includes('n')) t = B - h; else if (mode.includes('s')) B = t + h; else { t = cy - h / 2; B = t + h; }
    }
    return { x: l, y: t, w: R - l, h: B - t };
  }

  // Neuen Rahmen aufziehen (Klick neben den bisherigen Rahmen)
  startNewCrop(e, x, y) {
    const c = ImageEditor.clamp, sx = c(x, 0, this.W), sy = c(y, 0, this.H), before = { ...this.crop };
    this.track(e, ev => {
      let [px, py] = this.toImg(ev); px = c(px, 0, this.W); py = c(py, 0, this.H);
      let w = Math.abs(px - sx), h = Math.abs(py - sy);
      if (this.ratio && w) {
        h = w / this.ratio;
        const k = Math.min(1, (px >= sx ? this.W - sx : sx) / w, (py >= sy ? this.H - sy : sy) / h); w *= k; h *= k;
      }
      this.crop = { x: px >= sx ? sx : sx - w, y: py >= sy ? sy : sy - h, w, h };
      this.syncCrop();
    }, () => { if (this.crop.w * this.zoom < 8 || this.crop.h * this.zoom < 8) { this.crop = before; this.syncCrop(); } });
  }

  setRatio(r) {
    this.ratio = r;
    if (r) { const c = this.crop; let w = c.w, h = w / r; if (h > c.h) { h = c.h; w = h * r; } this.crop = { x: c.x + (c.w - w) / 2, y: c.y + (c.h - h) / 2, w, h }; }
    this.syncCrop();
  }

  applyCrop() {
    const c = this.crop, x = Math.round(c.x), y = Math.round(c.y);
    const w = Math.min(Math.round(c.w), this.W - x), h = Math.min(Math.round(c.h), this.H - y);
    if (w < 1 || h < 1) return;
    if (x === 0 && y === 0 && w === this.W && h === this.H) { this.setTool('select'); return; }
    const n = ImageEditor.canvas(w, h); n.getContext('2d').drawImage(this.base, x, y, w, h, 0, 0, w, h);
    this.transformObjects((px, py) => [px - x, py - y]);
    this.base = n;
    this.setTool('select'); this.mountBase(); this.commit();
  }

  // ---- Drehen und Spiegeln ----
  rotate(dir) {
    this.finishText(); if (this.tool === 'crop') this.setTool('select');
    const W = this.W, H = this.H, n = ImageEditor.canvas(H, W), g = n.getContext('2d');
    if (dir > 0) { g.translate(H, 0); g.rotate(Math.PI / 2); } else { g.translate(0, W); g.rotate(-Math.PI / 2); }
    g.drawImage(this.base, 0, 0);
    this.transformObjects(dir > 0 ? (x, y) => [H - y, x] : (x, y) => [y, W - x]);
    this.base = n; this.mountBase(); this.commit();
  }

  flip(horizontal) {
    this.finishText(); if (this.tool === 'crop') this.setTool('select');
    const W = this.W, H = this.H, n = ImageEditor.canvas(W, H), g = n.getContext('2d');
    if (horizontal) { g.translate(W, 0); g.scale(-1, 1); } else { g.translate(0, H); g.scale(1, -1); }
    g.drawImage(this.base, 0, 0);
    this.transformObjects(horizontal ? (x, y) => [W - x, y] : (x, y) => [x, H - y]);
    this.base = n; this.mountBase(); this.commit();
  }

  // ---- Verlauf (Rückgängig / Wiederholen) ----
  commit(initial, mergeKey) {
    // gleiche Aktion direkt hintereinander (z. B. Pfeiltasten) = ein Schritt
    if (mergeKey && mergeKey === this.lastMerge && this.idx === this.history.length - 1 && this.idx > this.savedIdx) {
      this.history[this.idx] = this.snapshot(); this.changed(); return;
    }
    this.lastMerge = mergeKey;
    this.history.length = this.idx + 1;
    this.history.push(this.snapshot()); this.idx++;
    // Verlauf begrenzen – Fotos sind groß, deshalb höchstens 6 verschiedene Zeichenflächen im Speicher
    while (this.history.length > 60 || (this.history.length > 1 && new Set(this.history.map(h => h.base)).size > 6)) {
      this.history.shift(); this.idx--; this.savedIdx--; if (this.pendingSaved != null) this.pendingSaved--;
    }
    if (!initial) this.changed();
  }
  snapshot() { return { base: this.base, objects: JSON.stringify(this.objects), adjust: { ...this.adjust } }; }
  changed() { this.opts.onDirty?.(); this.updateUndo(); this.scheduleRender(); }
  updateUndo() {
    this.bar.querySelector('[data-undo]').disabled = this.idx <= 0;
    this.bar.querySelector('[data-redo]').disabled = this.idx >= this.history.length - 1;
  }

  undo() {
    this.finishText();
    if (this.idx <= 0) { UI.toast('Nichts zum Rückgängigmachen'); return; }
    this.restore(this.history[--this.idx]);
  }
  redo() {
    this.finishText();
    if (this.idx >= this.history.length - 1) { UI.toast('Nichts zum Wiederholen'); return; }
    this.restore(this.history[++this.idx]);
  }
  restore(h) {
    const baseChanged = h.base !== this.base;
    this.base = h.base; this.objects = JSON.parse(h.objects); this.adjust = { ...h.adjust }; this.sel = null; this.lastMerge = null;
    if (this.tool === 'crop') this.setTool('select');
    if (baseChanged) this.mountBase();
    this.applyFilter(); this.syncColorUi(); this.changed();
  }

  // ---- Tastatur ----
  onKey(e) {
    if (!this.host.isConnected) return;
    if (e.target.closest?.('input,textarea,select,[contenteditable="true"],[contenteditable="plaintext-only"]')) {
      if (e.target === this.textEl && e.key === 'Escape') { e.preventDefault(); this.finishText(); }
      return;
    }
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); this.redo(); return; }
    if (mod) return;
    if (this.tool === 'crop') {
      if (e.key === 'Enter') { e.preventDefault(); this.applyCrop(); }
      if (e.key === 'Escape') { e.preventDefault(); this.setTool('select'); }
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel) { e.preventDefault(); this.removeObj(this.sel); return; }
    if (e.key === 'Escape') { this.select(null); return; }
    if (this.sel && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const d = (e.shiftKey ? 10 : 1) / this.zoom;
      this.translate(this.sel, e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0);
      this.commit(false, 'nudge');
      return;
    }
    if (this.tool === 'select' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const to = this.opts.siblings?.[e.key === 'ArrowLeft' ? 'prev' : 'next'];
      if (to) { e.preventDefault(); this.opts.go(to); }
    }
  }

  // ---- Speichern ----
  isDirty() { return this.idx !== this.savedIdx || !!this.textEl?.innerText.trim(); }
  markSaved() { this.savedIdx = this.pendingSaved ?? this.idx; this.pendingSaved = null; this.lastMerge = null; }

  async getBytes(type = this.saveType) {
    this.finishText();
    this.pendingSaved = this.idx;
    const c = ImageEditor.canvas(this.W, this.H), g = c.getContext('2d');
    if (type === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, this.W, this.H); }   // JPEG kennt keine Transparenz
    g.filter = this.filterCss(); g.drawImage(this.base, 0, 0); g.filter = 'none';
    for (const o of this.objects) this.drawObj(g, o);
    const blob = await new Promise(res => c.toBlob(res, type, 0.92));
    if (!blob) throw new Error('Das Bild konnte nicht gespeichert werden (zu groß?)');
    return new Uint8Array(await blob.arrayBuffer());
  }

  // Für „Als Kopie“: gleiches Format, wenn der Browser es schreiben kann, sonst PNG
  async getCopy() {
    const ext = this.canOverwrite ? this.ext : '.png';
    return { bytes: await this.getBytes(IMG_SAVE_TYPES[ext]), ext };
  }
}
