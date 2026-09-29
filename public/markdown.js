// Umwandlung Markdown-Datei  <->  Editor-Blöcke
// Seiten werden als ganz normale .md-Dateien gespeichert, damit sie auch außerhalb der App lesbar bleiben.
const MD = (() => {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escAttr = s => esc(s).replace(/"/g, '&quot;');
  const LIST_TYPES = new Set(['ul', 'ol', 'todo']);
  const CALLOUT_ICONS = { note: '💡', tip: '💡', info: 'ℹ️', important: '❗', warning: '⚠️', caution: '🔥', success: '✅', question: '❓' };
  const EMOJI_START = /^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*)\s*/u;

  // ---------- Inline: Markdown -> HTML ----------
  function inlineToHtml(md) {
    const codes = [];
    let s = String(md || '').replace(/`([^`\n]+)`/g, (m, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
    s = esc(s)
      .replace(/&lt;br\s*\/?&gt;/gi, '<br>')
      .replace(/&lt;(\/?)u&gt;/gi, '<$1u>');
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (m, t, u) => {
      const isFile = !/^[a-z]+:|^#/i.test(u) && !/\.md$/i.test(decodeSafe(u));
      return `<a href="${u.replace(/"/g, '&quot;')}"${isFile ? ' class="file-link"' : ''}>${t}</a>`;
    });
    s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<b>$1</b>')
      .replace(/__(?=\S)([\s\S]*?\S)__/g, '<b>$1</b>')
      .replace(/(^|[^*\w])\*(?=\S)([^*]*?\S)\*(?!\*)/g, '$1<i>$2</i>')
      .replace(/(^|[^_\w])_(?=\S)([^_]*?\S)_(?![_\w])/g, '$1<i>$2</i>')
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<s>$1</s>')
      .replace(/==(?=\S)([\s\S]*?\S)==/g, '<mark>$1</mark>');
    return s.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code>${esc(codes[i])}</code>`);
  }

  function decodeSafe(u) { try { return decodeURI(u); } catch { return u; } }

  // ---------- Inline: HTML (contenteditable) -> Markdown ----------
  function wrap(inner, mark, close = mark) {
    const m = inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
    return m[2] ? `${m[1]}${mark}${m[2]}${close}${m[3]}` : inner;
  }
  function nodeToMd(node) {
    if (node.nodeType === 3) return node.nodeValue.replace(/ /g, ' ').replace(/​/g, '');
    if (node.nodeType !== 1) return '';
    const tag = node.tagName;
    const inner = () => Array.from(node.childNodes).map(nodeToMd).join('');
    switch (tag) {
      case 'BR': return '<br>';
      case 'B': case 'STRONG': return wrap(inner(), '**');
      case 'I': case 'EM': return wrap(inner(), '*');
      case 'S': case 'STRIKE': case 'DEL': return wrap(inner(), '~~');
      case 'MARK': return wrap(inner(), '==');
      case 'U': return wrap(inner(), '<u>', '</u>');
      case 'CODE': { const t = node.textContent.replace(/`/g, '´'); return t ? '`' + t + '`' : ''; }
      case 'A': {
        const t = inner(); const h = node.getAttribute('href') || '';
        return t ? `[${t}](${h.replace(/ /g, '%20')})` : '';
      }
      case 'DIV': case 'P': {
        const t = inner();
        return (node.previousSibling ? '<br>' : '') + t;
      }
      case 'SPAN': {
        let t = inner(); const st = node.style || {};
        if (st.fontWeight === 'bold' || Number(st.fontWeight) >= 600) t = wrap(t, '**');
        if (st.fontStyle === 'italic') t = wrap(t, '*');
        return t;
      }
      default: return inner();
    }
  }
  function htmlToInline(el) {
    let s = Array.from(el.childNodes).map(nodeToMd).join('');
    s = s.replace(/(<br>)+$/, '');
    return s;
  }

  // ---------- Frontmatter ----------
  function splitFrontmatter(text) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(text);
    if (!m) return { meta: {}, extra: [], body: text };
    const meta = {}; const extra = [];
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^(icon|cover):\s*(.*)$/.exec(line);
      if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
      else extra.push(line);
    }
    return { meta, extra, body: text.slice(m[0].length) };
  }

  // ---------- Datei -> Blöcke ----------
  function parse(text) {
    const { meta, extra, body } = splitFrontmatter(String(text || '').replace(/\r\n?/g, '\n'));
    const lines = body.split('\n');
    const blocks = [];
    // Einrückungsebene von Listen über die Spalten der übergeordneten Punkte bestimmen (2, 3 oder 4 Leerzeichen)
    let listStack = [];
    const indentOf = sp => { const n = sp.replace(/\t/g, '    ').length; while (listStack.length && listStack[listStack.length - 1] >= n) listStack.pop(); const lvl = Math.min(6, listStack.length); listStack.push(n); return lvl; };
    const isSpecial = l => /^(#{1,6}\s|```|>|\s*\||\s*[-*+]\s|\s*\d+[.)]\s|(-{3,}|\*{3,}|_{3,})\s*$|!\[[^\]]*\]\([^)]*\)\s*$)/.test(l);
    const splitRow = l => { let s = l.trim(); if (s.startsWith('|')) s = s.slice(1); if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1); return s.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|')); };
    const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      if (!/^\s*([-*+]|\d+[.)])\s/.test(line)) listStack = [];
      let m;
      if ((m = /^(\s*)```\s*([\w+#.-]*)\s*$/.exec(line))) {
        const buf = []; i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) buf.push(lines[i++]);
        i++;
        blocks.push({ type: 'code', lang: m[2] || '', text: buf.join('\n') });
        continue;
      }
      if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
        blocks.push({ type: 'h' + Math.min(3, m[1].length), html: inlineToHtml(m[2].replace(/\s+#+\s*$/, '')) }); i++; continue;
      }
      if ((m = /^(\s*)[-*+]\s+\[( |x|X)\]\s?(.*)$/.exec(line))) {
        blocks.push({ type: 'todo', indent: indentOf(m[1]), checked: m[2] !== ' ', html: inlineToHtml(m[3]) }); i++; continue;
      }
      if ((m = /^(\s*)[-*+]\s+(.*)$/.exec(line))) {
        blocks.push({ type: 'ul', indent: indentOf(m[1]), html: inlineToHtml(m[2]) }); i++; continue;
      }
      if ((m = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line))) {
        blocks.push({ type: 'ol', indent: indentOf(m[1]), html: inlineToHtml(m[3]) }); i++; continue;
      }
      if ((m = /^(-{3,}|\*{3,}|_{3,})\s*$/.exec(line))) { blocks.push({ type: 'divider' }); i++; continue; }
      if ((m = /^!\[([^\]]*)\]\((<[^>]+>|[^)\s]+)(?:\s+"([^"]*)")?\)\s*$/.exec(line))) {
        const src = m[2].replace(/^<|>$/g, '');
        const w = /width=(\d+%?)/.exec(m[3] || '');
        blocks.push({ type: 'image', src, alt: m[1], width: w ? w[1] : '' }); i++; continue;
      }
      if (/^>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^>/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
        const c = /^\[!(\w+)\]\s*(.*)$/.exec(buf[0]);
        if (c) {
          let first = c[2]; let icon = CALLOUT_ICONS[c[1].toLowerCase()] || '💡';
          const e = EMOJI_START.exec(first); if (e) { icon = e[1]; first = first.slice(e[0].length); }
          const rest = [first, ...buf.slice(1)].filter((l, idx) => idx > 0 || l !== '' || buf.length === 1);
          blocks.push({ type: 'callout', icon, html: inlineToHtml(rest.join('<br>')) });
        } else {
          blocks.push({ type: 'quote', html: inlineToHtml(buf.join('<br>')) });
        }
        continue;
      }
      if (/^\s*\|/.test(line) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
        const rows = [splitRow(line)]; i += 2;
        while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(splitRow(lines[i++]));
        const cols = Math.max(...rows.map(r => r.length));
        rows.forEach(r => { while (r.length < cols) r.push(''); });
        blocks.push({ type: 'table', rows: rows.map(r => r.map(c => inlineToHtml(c))) });
        continue;
      }
      // Absatz: aufeinanderfolgende Zeilen (Tabellen, HTML usw. bleiben so erhalten)
      const buf = [line]; i++;
      while (i < lines.length && lines[i].trim() && !isSpecial(lines[i])) buf.push(lines[i++]);
      blocks.push({ type: 'para', html: inlineToHtml(buf.join('\n')) });
    }
    return { meta, extra, blocks };
  }

  // ---------- Blöcke -> Datei ----------
  function serialize(meta, extra, blocks) {
    let out = '';
    const fm = [];
    if (meta.icon) fm.push(`icon: ${meta.icon}`);
    if (meta.cover) fm.push(`cover: ${meta.cover}`);
    fm.push(...(extra || []).filter(l => l.trim()));
    if (fm.length) out += `---\n${fm.join('\n')}\n---\n\n`;

    const olCount = [];
    const widths = [];   // Breite der Listenmarker je Ebene ("- " = 2, "1. " = 3) für korrekte Einrückung
    const parts = [];
    let prev = null;
    for (const b of blocks) {
      const lvlNow = b.indent || 0;
      if (LIST_TYPES.has(b.type)) widths.length = lvlNow; else widths.length = 0;
      let ind = ''; for (let k = 0; k < lvlNow; k++) ind += ' '.repeat(widths[k] || 2);
      const md = b.type === 'para' ? (b.md ?? '') : (b.md ?? '').replace(/\n/g, '<br>');
      let s;
      if (b.type !== 'ol') olCount.length = LIST_TYPES.has(b.type) ? (b.indent || 0) : 0;
      switch (b.type) {
        case 'h1': s = '# ' + md; break;
        case 'h2': s = '## ' + md; break;
        case 'h3': s = '### ' + md; break;
        case 'ul': s = ind + '- ' + md; widths[lvlNow] = 2; break;
        case 'todo': s = ind + (b.checked ? '- [x] ' : '- [ ] ') + md; widths[lvlNow] = 2; break;
        case 'ol': {
          const lvl = b.indent || 0; olCount.length = lvl + 1;
          olCount[lvl] = (olCount[lvl] || 0) + 1;
          s = ind + olCount[lvl] + '. ' + md; widths[lvl] = String(olCount[lvl]).length + 2; break;
        }
        case 'quote': s = md.split('<br>').map(l => '> ' + l).join('\n'); break;
        case 'callout': {
          const ls = md.split('<br>');
          s = `> [!NOTE] ${b.icon || '💡'} ${ls[0]}` + ls.slice(1).map(l => '\n> ' + l).join('');
          break;
        }
        case 'divider': s = '---'; break;
        case 'table': {
          const cell = c => (c || '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
          const rows = b.rows && b.rows.length ? b.rows : [['']];
          const line = r => '| ' + r.map(cell).join(' | ') + ' |';
          s = [line(rows[0]), '| ' + rows[0].map(() => '---').join(' | ') + ' |', ...rows.slice(1).map(line)].join('\n');
          break;
        }
        case 'code': s = '```' + (b.lang || '') + '\n' + (b.text || '') + '\n```'; break;
        case 'image': {
          const src = /[\s()]/.test(b.src) ? `<${b.src}>` : b.src;
          s = `![${(b.alt || '').replace(/[\[\]\n]/g, '')}](${src}${b.width ? ` "width=${b.width}"` : ''})`;
          break;
        }
        default: s = md; if (!s.trim()) { prev = b; continue; }
      }
      const tight = prev && LIST_TYPES.has(prev.type) && LIST_TYPES.has(b.type);
      parts.push((parts.length ? (tight ? '\n' : '\n\n') : '') + s);
      prev = b;
    }
    return out + parts.join('') + '\n';
  }

  return { parse, serialize, inlineToHtml, htmlToInline, esc, escAttr, splitFrontmatter };
})();
