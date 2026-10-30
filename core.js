'use strict';
/* Zajednička poslovna logika: koristi je server (Node.js) i demo u pregledniku. */
(function (root) {
  const VRSTE = ['Redovan rad', 'Bolovanje', 'Godišnji odmor', 'Slobodan dan', 'Praznik', 'Rad na praznik', 'Praktična nastava', 'Bolest', 'Odobren izostanak'];
  const NERAD = ['Bolovanje', 'Godišnji odmor', 'Slobodan dan', 'Praznik', 'Bolest', 'Odobren izostanak'];
  /* NAUČNIK (korisnik s users[].nau): samo šihterica i ove tri vrste upisa; Praktična nastava upisuje se kao rad (gradilište, sati, topli obrok, bez terenskog dodatka) */
  const VRSTE_NAU = ['Praktična nastava', 'Bolest', 'Odobren izostanak'];
  const vrsteOf = u => u && u.nau ? VRSTE_NAU : VRSTE.filter(v => !VRSTE_NAU.includes(v));
  const PRAZNIK_VRSTE = ['Praznik', 'Rad na praznik'];
  const FIKSNI_SATI = 8; /* za NERAD vrste sati su fiksni i unosi ih aplikacija */
  const pad = n => String(n).padStart(2, '0');
  const r2 = n => Math.round(n * 100) / 100;
  const vr = e => e.vrsta || 'Redovan rad';
  /* Prekovremeni rad: po radniku i danu zbroj sati rada (bez bolovanja, godišnjeg, slobodnog dana i praznika) iznad 9 h (pon-čet), iznad 8 h (petak),
     a subotom i nedjeljom svi sati; svi sati 'Rada na praznik' uvijek su prekovremeni. Višak se raspoređuje na unose redom unosa (prvo redovni dio, ostatak na kasnije unose). */
  const otLimit = d => { const w = new Date(d + 'T00:00:00Z').getUTCDay(); return w === 0 || w === 6 ? 0 : w === 5 ? 8 : 9; };
  function otMap(entries) {
    const g = {}, out = new Map();
    entries.filter(e => !NERAD.includes(vr(e))).forEach(e => { if (vr(e) === 'Rad na praznik') { out.set(e.id, Math.round(e.hours * 100) / 100); return; } (g[e.uid + '|' + e.date] = g[e.uid + '|' + e.date] || []).push(e); });
    Object.values(g).forEach(l => { l.sort((a, b) => (a.ts || 0) - (b.ts || 0)); let cap = otLimit(l[0].date); l.forEach(e => { const reg = Math.min(e.hours, cap); cap -= reg; out.set(e.id, Math.round((e.hours - reg) * 100) / 100); }); });
    return out;
  }
  /* Sati za slobodan dan (po mjesecu, od nule svakog 1.): prijenos (unosi administrator, moze biti negativan)
     + 1 h za svaki dan s ukupnim radom >= 9 h (Praznik/Bolovanje/Godisnji/Slobodan dan se ne racunaju kao rad) - 8 h za svaki Slobodan dan u tom mjesecu */
  function bank(list, month, prijenos) {
    const byDay = {}; let used = 0;
    list.forEach(e => { if (!e.date.startsWith(month)) return; const v = vr(e); if (v === 'Slobodan dan') { used++; return; } if (NERAD.includes(v)) return; byDay[e.date] = (byDay[e.date] || 0) + (+e.hours || 0); });
    return (+prijenos || 0) + Object.values(byDay).filter(h => h >= 9).length - 8 * used;
  }
  const S = (l, f) => l.reduce((a, x) => a + f(x), 0);

  /* ---- kalendar: hrvatski blagdani i radni dani ---- */
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
      g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
    return Date.UTC(y, mo - 1, da);
  }
  const iso = ms => new Date(ms).toISOString().slice(0, 10);
  function holidays(y) {
    const s = new Set(['01-01', '01-06', '05-01', '05-30', '06-22', '08-05', '08-15', '11-01', '11-18', '12-25', '12-26'].map(x => y + '-' + x)), e = easter(y);
    [0, 1, 60].forEach(o => s.add(iso(e + o * 864e5)));
    return s;
  }
  /* Fond sati: svi dani od ponedjeljka do petka (praznici na radni dan ulaze u zbroj) x 8 h */
  const FOND_DNEVNO = 8;
  function weekdays(month) {
    const y = +month.slice(0, 4), m = +month.slice(5, 7), n = new Date(Date.UTC(y, m, 0)).getUTCDate(), out = [];
    for (let d = 1; d <= n; d++) { const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); if (w !== 0 && w !== 6) out.push(month + '-' + pad(d)); }
    return out;
  }
  function fond(month) { const dani = weekdays(month).length; return { dani, dnevno: FOND_DNEVNO, sati: dani * FOND_DNEVNO }; }
  function workdays(month) {
    const y = +month.slice(0, 4), m = +month.slice(5, 7), n = new Date(Date.UTC(y, m, 0)).getUTCDate(), h = holidays(y), out = [];
    for (let d = 1; d <= n; d++) {
      const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay(), ds = month + '-' + pad(d);
      if (w !== 0 && w !== 6 && !h.has(ds)) out.push(ds);
    }
    return out;
  }

  /* ---- zip (bez kompresije) i xlsx bez ovisnosti ---- */
  const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u) { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files) {
    const enc = new TextEncoder(), parts = [], cen = []; let off = 0;
    for (const f of files) {
      const nm = enc.encode(f.name), d = enc.encode(f.data), crc = crc32(d);
      const lh = new Uint8Array(30 + nm.length), v = new DataView(lh.buffer);
      v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(10, 0, true); v.setUint16(12, 0x5C21, true);
      v.setUint32(14, crc, true); v.setUint32(18, d.length, true); v.setUint32(22, d.length, true); v.setUint16(26, nm.length, true); lh.set(nm, 30);
      const ch = new Uint8Array(46 + nm.length), c = new DataView(ch.buffer);
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(14, 0x5C21, true);
      c.setUint32(16, crc, true); c.setUint32(20, d.length, true); c.setUint32(24, d.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true); ch.set(nm, 46);
      parts.push(lh, d); cen.push(ch); off += lh.length + d.length;
    }
    const cs = S(cen, x => x.length), end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cs, true); e.setUint32(16, off, true);
    const all = parts.concat(cen, [end]), out = new Uint8Array(S(all, x => x.length)); let p = 0;
    for (const x of all) { out.set(x, p); p += x.length; }
    return out;
  }
  const col = i => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
  const esc = s => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function sheetXml(t) {
    const rows = [t.head].concat(t.rows, t.total ? [t.total] : []), w = t.head.map((_, i) => Math.min(48, Math.max(8, ...rows.map(r => String(r[i] == null ? '' : r[i]).length)) + 2));
    const body = rows.map((r, ri) => {
      const st = ri === 0 ? ' s="1"' : (t.total && ri === rows.length - 1 ? ' s="2"' : '');
      return '<row r="' + (ri + 1) + '">' + r.map((v, ci) => {
        const ref = col(ci) + (ri + 1);
        if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '"' + st + '><v>' + v + '</v></c>';
        if (v === '' || v == null) return st ? '<c r="' + ref + '"' + st + '/>' : '';
        return '<c r="' + ref + '"' + st + ' t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
      }).join('') + '</row>';
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>' +
      w.map((x, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + x + '" customWidth="1"/>').join('') + '</cols><sheetData>' + body + '</sheetData></worksheet>';
  }
  /* ===== Jednostavan PDF (A4, Helvetica, tablice) bez vanjskih biblioteka =====
     doc = { title, info: [tekst...], blocks: [{h}|{p}|{table:[{head?,cells:[{t,right,bold}]}]}] } -> Uint8Array */
  const HW = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  const PMAP = { 'Č': 129, 'č': 141, 'Ć': 143, 'ć': 144, 'Đ': 157, 'đ': 127, 'Š': 138, 'š': 154, 'Ž': 142, 'ž': 158, '–': 150, '—': 151, '’': 146, '‘': 145, '“': 147, '”': 148, '„': 132, '•': 149, '…': 133, '€': 128, '✓': 0x2a, '−': 45, '\u00a0': 32 };
  const PBASE = { 'Č': 'C', 'č': 'c', 'Ć': 'C', 'ć': 'c', 'Đ': 'D', 'đ': 'd', 'Š': 'S', 'š': 's', 'Ž': 'Z', 'ž': 'z' };
  const pEnc = s => Array.from(String(s == null ? '' : s)).map(ch => { if (PMAP[ch] !== undefined) return String.fromCharCode(PMAP[ch]); const k = ch.charCodeAt(0); return k >= 32 && k < 127 ? ch : k >= 160 && k < 256 ? ch : '?'; }).join('');
  const pW = (s, size, bold) => Array.from(String(s == null ? '' : s)).reduce((a, ch) => { const b = PBASE[ch] || ch, k = b.charCodeAt(0); return a + (k >= 32 && k < 127 ? HW[k - 32] : 556); }, 0) * size / 1000 * (bold ? 1.06 : 1);
  const pStr = s => '(' + pEnc(s).replace(/[\\()]/g, m => '\\' + m).replace(/[\x7f-\xff]/g, m => '\\' + m.charCodeAt(0).toString(8).padStart(3, '0')) + ')';
  function pdfDoc(doc) {
    const W = 595, H = 842, M = 40, pages = []; let ops = [], y = 0;
    const newPage = () => { ops = []; pages.push(ops); y = H - M; };
    const text = (x, yy, s, size, bold, gray) => ops.push((gray ? '0.42 g ' : '0 g ') + 'BT /' + (bold ? 'F2' : 'F1') + ' ' + size + ' Tf ' + x.toFixed(1) + ' ' + yy.toFixed(1) + ' Td ' + pStr(s) + ' Tj ET');
    const line = (x1, y1, x2, y2, g) => ops.push((g || 0.8) + ' G 0.6 w ' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' m ' + x2.toFixed(1) + ' ' + y2.toFixed(1) + ' l S');
    const fit = (s, w, size, bold) => { s = String(s); if (pW(s, size, bold) <= w) return s; while (s.length > 1 && pW(s + '…', size, bold) > w) s = s.slice(0, -1); return s + '…'; };
    const wrap = (s, w, size, bold) => { const out = []; let cur = ''; String(s).split(/\s+/).forEach(word => { const t = cur ? cur + ' ' + word : word; if (pW(t, size, bold) > w && cur) { out.push(cur); cur = word; } else cur = t; }); if (cur) out.push(cur); return out; };
    const need = h => { if (y - h < M + 20) newPage(); };
    newPage();
    text(M, y - 16, doc.title || '', 16, true); y -= 26;
    (doc.info || []).forEach(s => { text(M, y - 10, s, 10, false, true); y -= 14; });
    y -= 6; line(M, y, W - M, y, 0.6); y -= 14;
    (doc.blocks || []).forEach(b => {
      if (b.h) { need(72); y -= 6; text(M, y - 12, b.h, 12.5, true); y -= 20; }
      else if (b.p) { wrap(b.p, W - 2 * M, 9.5).forEach(l => { need(14); text(M, y - 9, l, 9.5, false, true); y -= 13; }); y -= 2; }
      else if (b.table && b.table.length) {
        const rows = b.table, n = Math.max(...rows.map(r => r.cells.length)), sz = 9.5, pad = 6, avail = W - 2 * M;
        const wid = Array.from({ length: n }, (_, i) => Math.max(30, ...rows.map(r => r.cells[i] ? pW(r.cells[i].t, sz, r.head || r.cells[i].bold) + 2 * pad + 3 : 0)));
        const tot = wid.reduce((a, x) => a + x, 0); if (tot > avail) { const lastNum = wid.map((w, i) => rows.some(r => r.cells[i] && r.cells[i].right)); const fixed = wid.reduce((a, w, i) => a + (lastNum[i] ? w : 0), 0), flex = tot - fixed, k = Math.max(0.2, (avail - fixed) / flex); wid.forEach((w, i) => { if (!lastNum[i]) wid[i] = w * k; }); }
        const head = rows[0] && rows[0].head ? rows[0] : null;
        const drawRow = r => { need(r.head ? 34 : 16); let x = M; r.cells.forEach((cl, i) => { const w = wid[i] || 40, bold = r.head || cl.bold, s = fit(cl.t, w - 2 * pad, sz, bold); text(cl.right ? x + w - pad - pW(s, sz, bold) : x + pad, y - 11, s, sz, bold, r.head); x += w; }); y -= 16; line(M, y + 1, M + Math.min(avail, wid.reduce((a, x) => a + x, 0)), y + 1, r.head || r.foot ? 0.55 : 0.85); };
        rows.forEach((r, i) => { const before = pages.length; if (i > 0 && y - 16 < M + 20) { newPage(); if (head) drawRow(head); } if (pages.length === before || i === 0) drawRow(r); else drawRow(r); });
        y -= 10;
      }
    });
    const N = pages.length, objs = [], add = s => { objs.push(s); return objs.length; };
    const enc = '<< /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [127 /dcroat 129 /Ccaron 141 /ccaron 143 /Cacute 144 /cacute 157 /Dcroat] >>';
    const cat = add(''), pgs = add(''), f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding ' + enc + ' >>'), f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding ' + enc + ' >>');
    const kids = pages.map((p, i) => { const foot = '0.42 g BT /F1 8 Tf ' + M + ' 22 Td ' + pStr((doc.footer || '') + '   Stranica ' + (i + 1) + ' / ' + N) + ' Tj ET'; const body = p.concat([foot]).join('\n'); const st = add('<< /Length ' + body.length + ' >>\nstream\n' + body + '\nendstream'); return add('<< /Type /Page /Parent ' + pgs + ' 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /Font << /F1 ' + f1 + ' 0 R /F2 ' + f2 + ' 0 R >> >> /Contents ' + st + ' 0 R >>'); });
    objs[cat - 1] = '<< /Type /Catalog /Pages ' + pgs + ' 0 R >>'; objs[pgs - 1] = '<< /Type /Pages /Kids [' + kids.map(k => k + ' 0 R').join(' ') + '] /Count ' + N + ' >>';
    const info = add('<< /Title ' + pStr(doc.title || '') + ' /Producer (TiDy Connect) >>');
    let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'; const off = [];
    objs.forEach((o, i) => { off.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
    const xr = out.length; out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + off.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + cat + ' 0 R /Info ' + info + ' 0 R >>\nstartxref\n' + xr + '\n%%EOF\n';
    const u = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) u[i] = out.charCodeAt(i) & 255; return u;
  }
  function xlsxFile(sheets) {
    const H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    const used = new Set(), names = sheets.map((s, i) => { let n = s.name.replace(/[\\\/\?\*\[\]:]/g, ' ').slice(0, 31) || 'List' + (i + 1), k = 2; const b = n;
      while (used.has(n.toLowerCase())) n = b.slice(0, 31 - String(k).length - 1) + ' ' + (k++); used.add(n.toLowerCase()); return n; });
    return zip([
      { name: '[Content_Types].xml', data: H + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>' },
      { name: '_rels/.rels', data: H + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: H + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + names.map((n, i) => '<sheet name="' + esc(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: H + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', data: H + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFDE7C8"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' }
    ].concat(sheets.map((s, i) => ({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: sheetXml(s) }))));
  }

  /* ---- jezgra nad bazom ---- */
  /* ---- NARUČI MATERIJAL: jedinične mjere, PDF narudžbe i ukupna lista (dijele server, preglednik i demo) ---- */
  const NM_JM = ['kom', 'm', 'm²', 'm³', 'kg', 't', 'l', 'pak', 'vreća', 'kutija', 'rola', 'paleta', 'set', 'par'];
  const nmNum = v => String(Math.round(v * 1000) / 1000).replace('.', ',');
  const nmDt = t => { const d = new Date(t), p = n => String(n).padStart(2, '0'); return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() + '. ' + p(d.getHours()) + ':' + p(d.getMinutes()); };
  const nmDoc = o => ({ title: 'Narudžba materijala – ' + o.site, footer: 'TiDy Connect – narudžba materijala',
    info: ['Naručio: ' + (o.name || ''), 'Primatelj: ' + (o.adminName || ''), 'Gradilište: ' + o.site, (o.status === 'sent' ? 'Poslano: ' + nmDt(o.sentTs) : 'Nije poslano (spremljeno ' + nmDt(o.updated || o.ts) + ')')],
    blocks: [{ table: [{ head: true, cells: [{ t: 'R. br.', right: true }, { t: 'Materijal' }, { t: 'Količina', right: true }, { t: 'Jed. mjera' }] }].concat(o.items.map((it, i) => ({ cells: [{ t: (i + 1) + '.', right: true }, { t: it.naziv }, { t: nmNum(it.kol), right: true }, { t: it.jm }] }))) }] });
  /* zbroj istog materijala (naziv bez obzira na velika/mala slova) u istoj jediničnoj mjeri */
  const nmTotal = list => { const m = new Map(); list.forEach(o => o.items.forEach(it => { const k = it.naziv.trim().toLocaleLowerCase('hr') + '|' + it.jm; const x = m.get(k) || { naziv: it.naziv.trim(), jm: it.jm, kol: 0, n: 0 }; x.kol += it.kol; x.n++; m.set(k, x); })); return [...m.values()].sort((a, b) => a.naziv.localeCompare(b.naziv, 'hr') || a.jm.localeCompare(b.jm, 'hr')); };
  function Core(db) {
    db.requests = db.requests || [];
    db.prijenos = db.prijenos || {};
    db.slreq = db.slreq || [];
    db.godisnji = db.godisnji || {}; db.gorq = db.gorq || []; db.obav = db.obav || []; db.poruke = db.poruke || []; db.sitereq = db.sitereq || []; db.siteNews = db.siteNews || []; db.inboxDel = db.inboxDel || {}; db.otpremnice = db.otpremnice || []; db.otpSites = db.otpSites || [];
    const dfmt = d => d.slice(8, 10) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4) + '.';
    /* radni dani (pon-pet, bez praznika) od-do, najvise 92 dana; null = neispravan raspon */
    function rangeDates(from, to) {
      const ok = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
      if (!ok(from) || (to && !ok(to))) return null; to = to || from; if (to < from) return null;
      const out = [], a = Date.parse(from + 'T00:00:00Z'), b = Date.parse(to + 'T00:00:00Z'); if ((b - a) / 864e5 > 92) return null;
      for (let t = a; t <= b; t += 864e5) { const ds = iso(t), w = new Date(t).getUTCDay(); if (w !== 0 && w !== 6 && !holidays(+ds.slice(0, 4)).has(ds)) out.push(ds); }
      return out;
    }
    const goDates = uid => new Set(db.gorq.filter(q => q.uid === uid && q.status === 'approved').flatMap(q => q.dates));
    function goStats(uid, year) {
      const g = db.godisnji[uid + '|' + year] || {}, used = new Set(db.entries.filter(e => e.uid === uid && vr(e) === 'Godišnji odmor' && e.date.startsWith(String(year))).map(e => e.date)).size;
      const ukupno = +g.ukupno || 0, pocetno = +g.pocetno || 0, isk = pocetno + used;
      return { year: +year, ukupno, pocetno, iskoristeno: isk, preostalo: ukupno - isk };
    }
    const missingDays = (uid, month) => { const have = new Set(db.entries.filter(e => e.uid === uid && e.date.startsWith(month)).map(e => e.date)), u = db.users.find(x => x.id === uid), hol = u && u.nau ? holidays(+month.slice(0, 4)) : new Set(); return weekdays(month).filter(d => !have.has(d) && !hol.has(d)); }; /* naučnik ne upisuje državne praznike */
    /* until: zadnji datum na koji se obavijest odnosi; dan poslije više se ne prikazuje na početnoj stranici */
    const notify = (uid, text, until) => { db.obav.push({ id: Math.random().toString(36).slice(2) + Date.now().toString(36), uid, text, ts: Date.now(), read: false, until: until || '' }); if (Core.onNotify) Core.onNotify(uid, text); };
    const approval = (uid, date, ex) => db.slreq.find(q => q.uid === uid && q.status === 'approved' && q.date === date && (!q.entryId || q.entryId === ex));
    const pr = (uid, m) => +db.prijenos[uid + '|' + m] || 0;
    const nameOf = id => (db.users.find(u => u.id === id) || {}).name || '?';
    /* Pošta radnika: primljene poruke i obavijesti te poslani zahtjevi, najnovije prvo. Zapisi se nikad ne brišu, samo skrivaju za tog radnika
       (db.inboxDel[uid]): ručno gumbom ✕ i automatski početkom mjeseca (inboxClean) – tada ostaje samo 5 najnovijih. */
    const ymdOf = t => { const d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
    const ymOf = t => { const d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };
    function inbox(uid) {
      const del = new Set(db.inboxDel[uid] || []), L = [], st = q => ({ status: q.status, note: q.note || '', decided: q.decided || 0, changed: !!q.changed });
      db.poruke.filter(p => p.to.includes(uid)).forEach(p => L.push({ k: 'po', id: p.id, ts: p.ts, t: 'Poruka administratora', text: p.text, from: nameOf(p.from), read: p.reads[uid] || 0 }));
      db.obav.filter(o => o.uid === uid).forEach(o => L.push({ k: 'ob', id: o.id, ts: o.ts, t: 'Obavijest', text: o.text, read: o.read ? 1 : 0 }));
      db.slreq.filter(q => q.uid === uid).forEach(q => L.push({ k: 'sl', id: q.id, ts: q.ts, t: 'Zahtjev za slobodan dan', text: dfmt(q.date) + (q.reason ? ' – ' + q.reason : ''), ...st(q) }));
      db.gorq.filter(q => q.uid === uid && q.source !== 'admin').forEach(q => L.push({ k: 'go', id: q.id, ts: q.ts, t: 'Zahtjev za godišnji odmor', text: (q.dates.length === 1 ? dfmt(q.dates[0]) : dfmt(q.dates[0]) + ' – ' + dfmt(q.dates[q.dates.length - 1]) + ' (' + q.dates.length + ' dana)') + (q.reason ? ' – ' + q.reason : ''), ...st(q) }));
      db.requests.filter(q => q.uid === uid).forEach(q => L.push({ k: 'mj', id: q.id, ts: q.ts, t: 'Zahtjev za ponovno otvaranje mjeseca', text: q.month.slice(5) + '.' + q.month.slice(0, 4) + '.' + (q.reason ? ' – ' + q.reason : ''), ...st(q) }));
      db.sitereq.filter(q => q.uid === uid).forEach(q => L.push({ k: 'gr', id: q.id, ts: q.ts, t: 'Zahtjev za novo gradilište', text: q.text, ...st(q) }));
      const items = L.filter(x => !del.has(x.k + '|' + x.id)).sort((a, b) => b.ts - a.ts);
      return { items, unread: items.filter(x => (x.k === 'po' || x.k === 'ob') && !x.read).length };
    }
    /* Automatsko čišćenje pošte na kraju mjeseca: od stavki iz prijašnjih mjeseci ostaje samo 5 najnovijih (ukupno). Vraća broj skrivenih. */
    function inboxClean(uid) {
      const cur = ymOf(Date.now()), l = db.inboxDel[uid] = db.inboxDel[uid] || []; let n = 0;
      inbox(uid).items.forEach((x, i) => { if (i >= 5 && ymOf(x.ts) < cur) { l.push(x.k + '|' + x.id); n++; } });
      if (l.length > 1000) l.splice(0, l.length - 1000); return n;
    }
    /* OTPREMNICE: fotografije su zasebne datoteke (ime počinje oznakom radnika), u bazi je samo zapis */
    const otpKey = id => String(id).replace(/[^0-9a-z]/gi, '').slice(0, 8).toLowerCase();
    const otpName = f => /^u-[0-9a-z]{1,8}-[0-9a-z]{6,24}\.jpg$/.test(f);
    const otpOwn = (uid, f) => otpName(f) && f.startsWith('u-' + otpKey(uid) + '-');
    function otpCheck(u, b, exists) {
      const files = [...new Set(Array.isArray(b.files) ? b.files.map(String) : [])], site = String(b.site || '').trim(), date = String(b.date || '');
      if (!files.length) return 'Fotografirajte otpremnicu.';
      if (files.length > 10) return 'Najviše 10 fotografija po otpremnici.';
      if (files.some(f => !otpOwn(u.id, f) || !exists(f))) return 'Fotografija nije pronađena. Pošaljite ponovno.';
      if (site !== OTP_ADMIN && !(db.sites || []).includes(site)) return 'Odaberite gradilište s popisa.';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayIso()) return 'Neispravan datum (ne može biti u budućnosti).';
      return { id: Math.random().toString(36).slice(2) + Date.now().toString(36), uid: u.id, site: site === OTP_ADMIN ? '' : site, date, note: String(b.note || '').trim().slice(0, 300), files, ts: Date.now(), adminSite: {}, pitanja: [] };
    }
    /* radnik može odabrati "Odluka administratora" (site ostaje prazan); administrator gradilište mijenja po fotografiji (adminSite[f]),
       a ručno upisana gradilišta vrijede samo u Otpremnicama (db.otpSites), ne i u ostatku aplikacije */
    const OTP_ADMIN = '__admin__';
    const otpSite = (o, f) => ((o.adminSite || {})[f]) || o.site || '';
    const otpList = (u, od, dO, adm = u.role === 'admin') => db.otpremnice.filter(o => (adm ? ((!od || o.date >= od) && (!dO || o.date <= dO)) : o.uid === u.id)).sort((x, y) => y.ts - x.ts).slice(0, adm ? 5000 : 30)
      .map(o => ({ ...o, adminSite: o.adminSite || {}, pitanja: o.pitanja || [], name: nameOf(o.uid) }));
    /* otpremnice se zajedno s fotografijama brišu OTP_DANA dana nakon slanja; vraća datoteke za brisanje */
    const OTP_DANA = 60;
    function otpExpire(now) { const old = db.otpremnice.filter(o => now - o.ts > OTP_DANA * 864e5); if (!old.length) return []; db.otpremnice = db.otpremnice.filter(o => !old.includes(o)); return old.flatMap(o => o.files); }
    const otpSitesAll = () => [...new Set((db.sites || []).concat(db.otpSites))].sort((a, b) => a.localeCompare(b, 'hr'));
    /* NARUČI MATERIJAL: radnik šalje popis materijala odabranom primatelju (administrator ili radnik s pravom 'nm') */
    const canG = (u, g) => !!u && (u.role === 'admin' || ((u.role === 'user' || u.role === 'vod') && !u.disabled && !u.deleted && Array.isArray(u.prava) && u.prava.includes(g)));
    const nmPrimatelji = () => db.users.filter(u => !u.deleted && !u.disabled && !u.purged && canG(u, 'nm')).map(u => ({ id: u.id, name: u.name })).sort((a, b) => a.name.localeCompare(b.name, 'hr'));
    /* prijedlozi naziva materijala iz svih narudžbi (samo naziv i najčešća jedinična mjera, bez ostalih podataka o narudžbama);
       bez obzira na velika/mala slova, bez duplikata, prvo nazivi koji počinju upisanim tekstom, zatim ostali, svaka skupina abecedno */
    function nmNazivi(q, max = 12) {
      const t = String(q || '').trim().toLocaleLowerCase('hr'); if (t.length < 3) return [];
      const m = new Map();
      for (const o of db.narudzbe) for (const it of o.items || []) {
        const n = String(it.naziv || '').trim(), k = n.toLocaleLowerCase('hr'); if (!n || !k.includes(t)) continue;
        const r = m.get(k) || { k, n: new Map(), j: new Map() }; r.n.set(n, (r.n.get(n) || 0) + 1); if (it.jm) r.j.set(it.jm, (r.j.get(it.jm) || 0) + 1); m.set(k, r);
      }
      const top = mp => [...mp].sort((a, b) => b[1] - a[1])[0];
      return [...m.values()].map(r => ({ naziv: top(r.n)[0], jm: r.j.size ? top(r.j)[0] : '', p: r.k.startsWith(t) ? 0 : 1 }))
        .sort((a, b) => a.p - b.p || a.naziv.localeCompare(b.naziv, 'hr', { sensitivity: 'base', numeric: true })).slice(0, max).map(({ naziv, jm }) => ({ naziv, jm }));
    }
    function nmSave(u, b) {
      const adminId = String(b.adminId || ''), site = String(b.site || '').trim(), items = Array.isArray(b.items) ? b.items : [];
      if (!nmPrimatelji().some(x => x.id === adminId)) return 'Odaberite administratora kojem šaljete narudžbu.';
      if (!(db.sites || []).includes(site)) return 'Odaberite gradilište s popisa.';
      if (!items.length) return 'Dodajte barem jednu stavku materijala.';
      if (items.length > 200) return 'Najviše 200 stavki po narudžbi.';
      const it = [];
      for (const x of items) {
        const naziv = String(x && x.naziv || '').trim().slice(0, 120), jm = String(x && x.jm || ''), kol = Math.round(parseFloat(String(x && x.kol).replace(',', '.')) * 1000) / 1000;
        if (!naziv) return 'Svaka stavka mora imati naziv materijala.';
        if (!NM_JM.includes(jm)) return 'Odaberite jediničnu mjeru za „' + naziv + '”.';
        if (!isFinite(kol) || kol <= 0 || kol > 1e7) return 'Upišite ispravnu količinu za „' + naziv + '”.';
        it.push({ naziv, jm, kol });
      }
      const now = Date.now(); let o;
      if (b.id) { o = db.narudzbe.find(x => x.id === b.id && x.uid === u.id); if (!o) return 'Narudžba nije pronađena.'; if (o.status === 'sent') return 'Poslana narudžba se više ne može mijenjati.'; }
      else { o = { id: Math.random().toString(36).slice(2) + now.toString(36), uid: u.id, ts: now }; db.narudzbe.push(o); }
      Object.assign(o, { adminId, site, items: it, updated: now, status: b.send ? 'sent' : 'unsent' });
      if (b.send) o.sentTs = now; else o.cancelTs = now;
      return o;
    }
    function nmDelete(u, id) { const i = db.narudzbe.findIndex(x => x.id === id && x.uid === u.id); if (i < 0) return 'Narudžba nije pronađena.'; if (db.narudzbe[i].status === 'sent') return 'Poslana narudžba se ne može obrisati.'; return db.narudzbe.splice(i, 1)[0]; }
    /* obrada narudžbe: primatelj (ili puni administrator) označi Obrađeno / vrati u Neobrađeno, ili je proslijedi drugom primatelju (tada je opet neobrađena) */
    const nmMoze = (u, o) => o && o.status === 'sent' && (o.adminId === u.id || u.role === 'admin');
    function nmObradi(u, id, val) {
      const o = db.narudzbe.find(x => x.id === id); if (!o || o.status !== 'sent') return 'Narudžba nije pronađena.';
      if (!nmMoze(u, o)) return 'Narudžbu može obraditi samo njezin primatelj.';
      o.obr = val ? { ts: Date.now(), by: u.id } : null; return o;
    }
    function nmProslijedi(u, id, to) {
      const o = db.narudzbe.find(x => x.id === id); if (!o || o.status !== 'sent') return 'Narudžba nije pronađena.';
      if (!nmMoze(u, o)) return 'Narudžbu može proslijediti samo njezin primatelj.';
      if (!nmPrimatelji().some(x => x.id === to)) return 'Odaberite administratora kojem prosljeđujete narudžbu.';
      if (to === o.adminId) return 'Narudžba je već kod tog administratora.';
      if (!Array.isArray(o.fwd)) o.fwd = [];
      o.fwd.push({ from: o.adminId, to, by: u.id, ts: Date.now() }); o.adminId = to; o.obr = null; return o;
    }
    const nmNeobr = u => db.narudzbe.filter(o => o.status === 'sent' && o.adminId === u.id && !o.obr).length;
    const nmView = o => ({ ...o, name: nameOf(o.uid), adminName: nameOf(o.adminId), obr: o.obr ? { ...o.obr, name: nameOf(o.obr.by) } : null,
      fwd: (o.fwd || []).map(f => ({ ...f, fromName: nameOf(f.from), toName: nameOf(f.to), byName: nameOf(f.by) })) });
    /* radnik: svoje narudžbe; primatelj (adm): poslane njemu, a puni administrator uz svi=1 sve poslane */
    const nmList = (u, adm, svi) => db.narudzbe.filter(o => adm ? o.status === 'sent' && (o.adminId === u.id || (svi && u.role === 'admin')) : o.uid === u.id).sort((a, b) => (b.sentTs || b.updated) - (a.sentTs || a.updated)).slice(0, 2000).map(nmView);
    function otpSetSite(u, id, f, site) {
      const o = db.otpremnice.find(x => x.id === id); if (!o || !o.files.includes(f)) return 'Fotografija nije pronađena.';
      site = String(site || '').trim().slice(0, 100); if (!site) return 'Odaberite ili upišite gradilište.';
      if (!(db.sites || []).includes(site) && !db.otpSites.includes(site)) db.otpSites.push(site);
      o.adminSite = o.adminSite || {}; if (site === o.site) delete o.adminSite[f]; else o.adminSite[f] = site; return o;
    }
    function otpAsk(u, id, f, text) {
      const o = db.otpremnice.find(x => x.id === id); if (!o || !o.files.includes(f)) return 'Fotografija nije pronađena.';
      text = String(text || '').trim().slice(0, 500); if (!text) return 'Upišite pitanje.';
      (o.pitanja = o.pitanja || []).push({ id: Math.random().toString(36).slice(2) + Date.now().toString(36), f, ts: Date.now(), from: u.id, text, answer: '', answerTs: 0 });
      notify(o.uid, 'Administrator traži dodatno objašnjenje za otpremnicu (' + (otpSite(o, f) || 'odluka administratora') + ', ' + dfmt(o.date) + ', fotografija ' + (o.files.indexOf(f) + 1) + '): „' + text + '“. Odgovorite u dijelu OTPREMNICE.');
      return o;
    }
    function otpAnswer(u, id, pid, text) {
      const o = db.otpremnice.find(x => x.id === id && x.uid === u.id), q = o && (o.pitanja || []).find(x => x.id === pid); if (!q) return 'Pitanje nije pronađeno.';
      text = String(text || '').trim().slice(0, 1000); if (!text) return 'Upišite odgovor.';
      q.answer = text; q.answerTs = Date.now(); return o;
    }
    /* brisanje: administrator uvijek, radnik svoju otpremnicu samo na dan slanja; vraća datoteke za brisanje */
    function otpDelete(u, id, adm = u.role === 'admin') {
      const i = db.otpremnice.findIndex(o => o.id === id); if (i < 0) return 'Otpremnica nije pronađena.';
      const o = db.otpremnice[i]; if (!adm && (o.uid !== u.id || ymdOf(o.ts) !== todayIso())) return 'Otpremnicu možete obrisati samo na dan slanja. Javite se administratoru.';
      db.otpremnice.splice(i, 1); return o.files;
    }
    /* Ručno brisanje iz pošte: skriva se samo radniku; nepročitana poruka/obavijest time se smatra pročitanom */
    function inboxHide(uid, k, id) {
      const it = inbox(uid).items.find(x => x.k === k && x.id === id); if (!it) return false;
      if (k === 'po') { const p = db.poruke.find(x => x.id === id); if (p && !p.reads[uid]) p.reads[uid] = Date.now(); }
      if (k === 'ob') { const o = db.obav.find(x => x.id === id); if (o) o.read = true; }
      const l = db.inboxDel[uid] = db.inboxDel[uid] || []; l.push(k + '|' + id); if (l.length > 1000) l.splice(0, l.length - 1000);
      return true;
    }
    const fmtNum = n => String(r2(n)).replace('.', ',');
    /* Ako radnik za završen (ili prošli) mjesec nema ispunjen fond sati, manjak se prenosi iz prekovremenih sati u redovan rad.
       m.trans['uid|mjesec'] = broj prenesenih sati; prekovremeni sati unosa smanjuju se razmjerno. */
    const OT = () => {
      const m = otMap(db.entries), cur = todayIso().slice(0, 7), g = {};
      db.entries.forEach(e => { const k = e.uid + '|' + e.date.slice(0, 7), x = g[k] = g[k] || { h: 0, ot: 0, ids: [] }; x.h += e.hours; const o = m.get(e.id) || 0; x.ot += o; if (o) x.ids.push(e.id); });
      m.trans = {};
      Object.entries(g).forEach(([k, x]) => { const mo = k.split('|')[1];
        if (!x.ot || !(db.closed.includes(k) || mo < cur)) return;
        const pren = Math.min(x.ot, Math.max(0, fond(mo).sati - (x.h - x.ot)));
        if (pren <= 0) return;
        m.trans[k] = Math.round(pren * 100) / 100; const f = (x.ot - pren) / x.ot; x.ids.forEach(id => m.set(id, Math.round(m.get(id) * f * 100) / 100)); });
      return m;
    };
    const otv = (m, e) => m.get(e.id) || 0;
    const ents = (month, f) => db.entries.filter(e => e.date.startsWith(month) && (!f.uid || e.uid === f.uid) && (!f.site || e.site === f.site) && (!f.vrsta || vr(e) === f.vrsta));

    function check(u, b, exceptId) {
      const d = String(b.date || ''), h = parseFloat(b.hours), vrsta = String(b.vrsta || 'Redovan rad'), site = String(b.site || '').trim(), meal = NERAD.includes(vrsta) ? '' : String(b.meal || '');
      if (!vrsteOf(u).includes(vrsta)) return 'Odaberite vrstu upisa.';
      if (PRAZNIK_VRSTE.includes(vrsta) && !(holidays(+d.slice(0, 4)).has(d))) return 'Praznik i Rad na praznik mogu se upisati samo na dan državnog praznika u RH.';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || (!NERAD.includes(vrsta) && !(h > 0 && h <= 24))) return 'Unesite datum i sate (0,5–24).';
      if (!site && !NERAD.includes(vrsta)) return 'Odaberite gradilište.';
      /* gradilište mora biti s administratorova popisa (stari ručni unosi ostaju valjani pri izmjeni) */
      if (site && !NERAD.includes(vrsta) && !(db.sites || []).includes(site) && !(exceptId && db.entries.some(e => e.id === exceptId && e.site === site))) return 'Gradilište nije na popisu. Pošaljite administratoru zahtjev za novo gradilište.';
      if (!NERAD.includes(vrsta) && d > todayIso()) return 'Radne sate nije moguće upisati za budući datum. Zadnji otključani datum je današnji.';
      const old = exceptId && db.entries.find(e => e.id === exceptId);
      if (vrsta === 'Godišnji odmor' && !goDates(u.id).has(d) && !(old && vr(old) === 'Godišnji odmor' && old.date === d)) return 'Godišnji odmor možete odabrati samo za dane koje je administrator odobrio.';
      if (meal && !db.meals.includes(meal) && !(old && old.meal === meal)) return 'Nepoznata opcija toplog obroka.';
      if (db.closed.includes(u.id + '|' + d.slice(0, 7))) return 'Taj je mjesec završen.';
      if (!NERAD.includes(vrsta) && !meal && !db.entries.some(e => e.uid === u.id && e.date === d && e.meal && e.id !== exceptId)) return 'Odaberite topli obrok.';
      if (meal && db.entries.some(e => e.uid === u.id && e.date === d && e.meal && e.id !== exceptId)) return 'Topli obrok za taj datum već je upisan.';
      const mine = db.entries.filter(e => e.uid === u.id), others = mine.filter(e => e.id !== exceptId), nr = rec(b);
      for (const m of new Set([d.slice(0, 7)].concat(old ? [old.date.slice(0, 7)] : []))) {
        const before = bank(mine, m, pr(u.id, m)), after = bank(others.concat([nr]), m, pr(u.id, m));
        if (after < 0 && after < before) { if (vrsta === 'Slobodan dan' && approval(u.id, d, exceptId)) continue; return vrsta === 'Slobodan dan' ? 'Za Slobodan dan potrebno je barem 8 sati u polju Sati za slobodan dan (trenutno ' + Math.max(0, before) + ' h).' : 'Promjena nije moguća jer je slobodan dan već iskorišten, pa bi Sati za slobodan dan postali negativni.'; };
      }
      return null;
    }
    /* Gradilište koje radnik upiše ručno (nije s administratorova popisa) sprema se velikim slovima. */
    const upSite = s => (db.sites || []).includes(s) ? s : s.toLocaleUpperCase('hr-HR');
    const rec = b => { const v = String(b.vrsta || 'Redovan rad'), n = NERAD.includes(v); return { date: b.date, site: n ? '' : upSite(String(b.site || '').trim()), vrsta: v, hours: v === 'Slobodan dan' ? 0 : n ? FIKSNI_SATI : parseFloat(b.hours), meal: n ? '' : String(b.meal || ''), teren: n || VRSTE_NAU.includes(v) ? 0 : (b.teren ? 1 : 0) }; };

    function summary(month, f) {
      const E = ents(month, f), fd = fond(month), wd = fd.dani, dn = fd.dnevno, applies = !f.site && !f.vrsta, norma = fd.sati, rows = {};
      const om = OT(), mk = id => rows[id] = rows[id] || { uid: id, name: nameOf(id), h: 0, ot: 0, t: 0, days: new Set(), m: {}, v: {} };
      if (applies) db.users.filter(u => u.role === 'user' && !u.deleted && (!f.uid || u.id === f.uid)).forEach(u => mk(u.id));
      E.forEach(e => { const r = mk(e.uid); r.h += e.hours; r.ot += otv(om, e); r.t += e.teren; r.days.add(e.date); r.v[vr(e)] = (r.v[vr(e)] || 0) + e.hours; if (e.meal) r.m[e.meal] = (r.m[e.meal] || 0) + 1; });
      const cols = [...db.meals]; E.forEach(e => { if (e.meal && !cols.includes(e.meal)) cols.push(e.meal); });
      const list = Object.values(rows).map(r => {
        const v = Object.fromEntries(Object.entries(r.v).map(([k, x]) => [k, r2(x)]));
        return { uid: r.uid, name: r.name, h: r2(r.h), ot: r2(r.ot), pren: applies ? om.trans[r.uid + '|' + month] || 0 : 0, t: r.t, m: r.m, v, days: r.days.size, closed: db.closed.includes(r.uid + '|' + month),
          prijenos: pr(r.uid, month), bank: bank(db.entries.filter(e => e.uid === r.uid), month, pr(r.uid, month)), norma: applies ? norma : null, razlika: applies ? r2(r2(r.h) - norma) : null };
      }).sort((a, b) => a.name.localeCompare(b.name, 'hr'));
      return { cols, vrste: VRSTE, list, norma: { dani: wd, dnevna: dn, sati: norma, applies } };
    }
    function daily(month, f) {
      const m = {}, om = OT();
      ents(month, f).forEach(e => { const k = e.date + '|' + e.uid, r = m[k] = m[k] || { date: e.date, uid: e.uid, name: nameOf(e.uid), h: 0, ot: 0, sites: [], vrste: [] };
        r.h += e.hours; r.ot += otv(om, e); if (e.site && !r.sites.includes(e.site)) r.sites.push(e.site); if (!r.vrste.includes(vr(e))) r.vrste.push(vr(e)); });
      return Object.values(m).map(r => ({ ...r, h: r2(r.h), ot: r2(r.ot) })).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name, 'hr'));
    }
    function sitesRep(month, f) {
      const m = {}, om = OT();
      ents(month, f).filter(e => e.site).forEach(e => { const r = m[e.site] = m[e.site] || { site: e.site, h: 0, ot: 0, w: {}, wo: {} }; r.h += e.hours; r.ot += otv(om, e); r.w[e.uid] = (r.w[e.uid] || 0) + e.hours; r.wo[e.uid] = (r.wo[e.uid] || 0) + otv(om, e); });
      return Object.values(m).map(r => ({ site: r.site, h: r2(r.h), ot: r2(r.ot), radnika: Object.keys(r.w).length,
        radnici: Object.entries(r.w).map(([id, h]) => ({ name: nameOf(id), h: r2(h), ot: r2(r.wo[id]) })).sort((a, b) => b.h - a.h) })).sort((a, b) => b.h - a.h);
    }
    function rowsList(month, f) {
      const om = OT();
      return ents(month, f).map(e => ({ ...e, vrsta: vr(e), name: nameOf(e.uid), ot: otv(om, e) })).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name, 'hr') || a.ts - b.ts);
    }
    function slobodni(month, f) {
      return ents(month, f).filter(e => vr(e) === 'Slobodan dan').map(e => ({ id: e.id, uid: e.uid, name: nameOf(e.uid), date: e.date, odobren: db.slreq.some(q => q.entryId === e.id) }))
        .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name, 'hr'));
    }
    function missing(month, f, today) {
      if (f.site || f.vrsta) return [];
      const days = weekdays(month).filter(d => d < today), out = [];
      db.users.filter(u => u.role === 'user' && !u.deleted && !u.disabled && (!f.uid || u.id === f.uid) && !db.closed.includes(u.id + '|' + month)).forEach(u => {
        const have = new Set(db.entries.filter(e => e.uid === u.id && e.date.startsWith(month)).map(e => e.date)), miss = days.filter(d => !have.has(d));
        if (miss.length) out.push({ uid: u.id, name: u.name, dates: miss });
      });
      return out.sort((a, b) => b.dates.length - a.dates.length || a.name.localeCompare(b.name, 'hr'));
    }
    function report(month, f, today) {
      return { ...summary(month, f), daily: daily(month, f), sites: sitesRep(month, f), rows: rowsList(month, f), slobodni: slobodni(month, f), missing: missing(month, f, today) };
    }
    /* Sati po gradilištu: radnici x mjeseci (period = 'YYYY' ili 'all'), uz ukupno po radniku i po mjesecu */
    function siteHours(period, site) {
      const E = db.entries.filter(e => e.site && (period === 'all' || e.date.startsWith(period)) && (!site || e.site === site));
      const months = period === 'all' ? [...new Set(E.map(e => e.date.slice(0, 7)))].sort() : Array.from({ length: 12 }, (_, i) => period + '-' + pad(i + 1));
      const by = {}; E.forEach(e => { const s = by[e.site] = by[e.site] || {}; const w = s[e.uid] = s[e.uid] || {}; const m = e.date.slice(0, 7); w[m] = (w[m] || 0) + e.hours; });
      const sites = Object.keys(by).sort((a, b) => a.localeCompare(b, 'hr')).map(s => {
        const rows = Object.entries(by[s]).map(([uid, w]) => ({ uid, name: nameOf(uid), byMonth: Object.fromEntries(months.map(m => [m, r2(w[m] || 0)])), total: r2(months.reduce((a, m) => a + (w[m] || 0), 0)) }))
          .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'hr'));
        return { site: s, rows, totals: { byMonth: Object.fromEntries(months.map(m => [m, r2(S(rows, x => x.byMonth[m]))])), total: r2(S(rows, x => x.total)) } };
      });
      return { period, months, sites };
    }
    const mLabel = m => m.slice(5) + '.' + m.slice(0, 4) + '.';
    function siteTables(period, site) {
      const d = siteHours(period, site);
      return d.sites.map(s => ({ name: s.site, head: ['Radnik', ...d.months.map(mLabel), 'Ukupno'],
        rows: s.rows.map(x => [x.name, ...d.months.map(m => x.byMonth[m]), x.total]), total: ['Ukupno', ...d.months.map(m => s.totals.byMonth[m]), s.totals.total] }));
    }
    function siteCsv(period, site) {
      const d = siteHours(period, site), head = ['Gradilište', 'Radnik', ...d.months.map(mLabel), 'Ukupno'], rows = [head];
      d.sites.forEach(s => { s.rows.forEach(x => rows.push([s.site, x.name, ...d.months.map(m => x.byMonth[m]), x.total])); rows.push([s.site, 'Ukupno', ...d.months.map(m => s.totals.byMonth[m]), s.totals.total]); });
      return '\uFEFF' + rows.map(r => r.map(v => q(typeof v === 'number' ? String(v).replace('.', ',') : v)).join(';')).join('\r\n');
    }
    function siteXlsx(period, site) {
      const t = siteTables(period, site);
      return xlsxFile(t.length ? t : [{ name: 'Gradilišta', head: ['Nema podataka'], rows: [], total: null }]);
    }
    /* Statistika: rang liste po svim kriterijima za mjesec (YYYY-MM) ili godinu (YYYY) */
    function stats(period, today) {
      const E = db.entries.filter(e => e.date.startsWith(period)), isYear = period.length === 4, users = db.users.filter(u => u.role === 'user' && (!u.deleted || E.some(e => e.uid === u.id))), P = {};
      const om = OT(), mk = id => P[id] = P[id] || { h: 0, ot: 0, rad: 0, prazRad: 0, boln: new Set(), god: new Set(), slob: new Set(), teren: 0, obr: 0, ob: {}, dani: new Set(), dan: {}, site: {} };
      E.forEach(e => { const p = mk(e.uid), v = vr(e); p.h += e.hours; p.ot += otv(om, e); p.dani.add(e.date);
        if (v === 'Redovan rad') p.rad += e.hours; else if (v === 'Rad na praznik') p.prazRad += e.hours;
        else if (v === 'Bolovanje') p.boln.add(e.date); else if (v === 'Godišnji odmor') p.god.add(e.date); else if (v === 'Slobodan dan') p.slob.add(e.date);
        p.teren += e.teren || 0; if (e.meal) { p.obr++; p.ob[e.meal] = (p.ob[e.meal] || 0) + 1; }
        if (!NERAD.includes(v)) { p.dan[e.date] = (p.dan[e.date] || 0) + e.hours; }
        if (e.site) p.site[e.site] = (p.site[e.site] || 0) + e.hours; });
      const t = new Date(today || Date.now()), cy = String(t.getFullYear()), cm = t.getMonth() + 1;
      const months = isYear ? (period > cy ? [] : Array.from({ length: period < cy ? 12 : cm }, (_, i) => period + '-' + pad(i + 1))) : [period];
      const fondSum = months.reduce((a, m) => a + fond(m).sati, 0);
      const ms = isYear ? [] : missing(period, {}, today || todayIso());
      const lists = [], rank = (key, title, unit, items, opts) => {
        const rows = items.filter(x => (opts && opts.all) || x.v > 0).sort((a, b) => b.v - a.v || a.name.localeCompare(b.name, 'hr'));
        let pr = 0; rows.forEach((x, i) => { if (i === 0 || x.v !== rows[i - 1].v) pr = i + 1; x.rank = pr; x.v = r2(x.v); });
        lists.push({ key, title, unit, rows: rows.map(x => ({ rank: x.rank, name: x.name, value: x.v })) });
      };
      const U = (fn, all) => users.filter(u => !all || P[u.id]).map(u => ({ name: u.name, v: P[u.id] ? fn(P[u.id], u) : 0 }));
      rank('h', 'Najviše odrađenih sati (ukupno)', 'h', U(p => p.h));
      rank('ot', 'Najviše prekovremenih sati', 'h', U(p => p.ot));
      rank('rad', 'Najviše sati redovnog rada', 'h', U(p => p.rad));
      rank('razlika', 'Najveći višak sati u odnosu na fond', 'h', users.filter(u => P[u.id]).map(u => ({ name: u.name, v: P[u.id].h - fondSum })));
      rank('manjak', 'Najveći manjak sati u odnosu na fond', 'h', users.filter(u => P[u.id]).map(u => ({ name: u.name, v: fondSum - P[u.id].h })).filter(x => x.v > 0));
      rank('dani', 'Najviše dana s upisanim radom', 'dana', U(p => p.dani.size));
      rank('max', 'Najviše sati u jednom danu', 'h', U(p => Math.max(0, ...Object.values(p.dan))));
      rank('d9', 'Najviše dana s 9 i više sati rada', 'dana', U(p => Object.values(p.dan).filter(h => h >= 9).length));
      rank('boln', 'Najviše bolovanja', 'dana', U(p => p.boln.size));
      rank('god', 'Najviše godišnjeg odmora', 'dana', U(p => p.god.size));
      rank('slob', 'Najviše iskorištenih slobodnih dana', 'dana', U(p => p.slob.size));
      rank('praz', 'Najviše sati rada na praznik', 'h', U(p => p.prazRad));
      rank('teren', 'Najviše terenskih dodataka', 'dana', U(p => p.teren));
      rank('obr', 'Najviše toplih obroka (ukupno)', 'obroka', U(p => p.obr));
      const mealNames = [...new Set(db.meals.concat(E.map(e => e.meal).filter(Boolean)))];
      mealNames.forEach(mn => rank('ob:' + mn, 'Topli obrok – ' + mn, 'obroka', U(p => p.ob[mn] || 0)));
      if (!isYear) {
        rank('bank', 'Najviše sati za slobodan dan (stanje)', 'h', users.map(u => ({ name: u.name, v: bank(db.entries.filter(e => e.uid === u.id), period, pr(u.id, period)) })).filter(x => x.v !== 0), { all: true });
        rank('miss', 'Najviše radnih dana bez unosa', 'dana', ms.map(x => ({ name: x.name, v: x.dates.length })));
      }
      const pairs = []; users.forEach(u => P[u.id] && Object.entries(P[u.id].site).forEach(([s, h]) => pairs.push({ name: u.name + ' · ' + s, v: h })));
      rank('par', 'Najviše sati radnika na jednom gradilištu', 'h', pairs);
      const st = sitesRep(period, {});
      rank('gs', 'Gradilišta po ukupnim satima', 'h', st.map(s => ({ name: s.site, v: s.h })));
      rank('gso', 'Gradilišta po prekovremenim satima', 'h', st.map(s => ({ name: s.site, v: s.ot })));
      rank('gr', 'Gradilišta po broju radnika', 'radnika', st.map(s => ({ name: s.site, v: s.radnika })));
      return { period, isYear, fond: fondSum, lists };
    }
    const todayIso = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
    function tables(month, f, today) {
      const s = summary(month, f), d = daily(month, f), st = sitesRep(month, f), l = rowsList(month, f), sl = slobodni(month, f), ms = missing(month, f, today), nm = s.norma.applies;
      const sumHead = ['Radnik', 'Dani', 'Sati ukupno', 'Prekovremeni sati', 'Preneseno u redovan rad', ...VRSTE.map(v => 'Sati – ' + v), 'Fond sati', 'Razlika', 'Prijenos iz prošlog mjeseca', 'Sati za slobodan dan', 'Terenski dodatak', ...s.cols];
      return {
        sum: { name: 'Sažetak', head: sumHead,
          rows: s.list.map(r => [r.name, r.days, r.h, r.ot, r.pren, ...VRSTE.map(v => r.v[v] || 0), nm ? r.norma : '', nm ? r.razlika : '', r.prijenos, r.bank, r.t, ...s.cols.map(c => r.m[c] || 0)]),
          total: ['Ukupno u mjesecu', '', r2(S(s.list, r => r.h)), r2(S(s.list, r => r.ot)), r2(S(s.list, r => r.pren)), ...VRSTE.map(v => r2(S(s.list, r => r.v[v] || 0))), nm ? r2(S(s.list, r => r.norma)) : '', nm ? r2(S(s.list, r => r.razlika)) : '', r2(S(s.list, r => r.prijenos)), r2(S(s.list, r => r.bank)), S(s.list, r => r.t), ...s.cols.map(c => S(s.list, r => r.m[c] || 0))] },
        day: { name: 'Sati po danima', head: ['Datum', 'Radnik', 'Vrsta', 'Gradilišta', 'Ukupno sati', 'Prekovremeni sati'],
          rows: d.map(r => [r.date, r.name, r.vrste.join(', '), r.sites.join(', '), r.h, r.ot]), total: ['Ukupno u mjesecu', '', '', '', r2(S(d, r => r.h)), r2(S(d, r => r.ot))] },
        site: { name: 'Po gradilištima', head: ['Gradilište', 'Sati', 'Prekovremeni sati', 'Radnika', 'Radnici'],
          rows: st.map(r => [r.site, r.h, r.ot, r.radnika, r.radnici.map(w => w.name + ' ' + fmtNum(w.h) + ' h' + (w.ot ? ' (prekovremeno ' + fmtNum(w.ot) + ' h)' : '')).join('; ')]), total: ['Ukupno', r2(S(st, r => r.h)), r2(S(st, r => r.ot)), '', ''] },
        det: { name: 'Svi unosi', head: ['Datum', 'Radnik', 'Vrsta', 'Gradilište', 'Sati', 'Prekovremeni sati', 'Topli obrok', 'Terenski dodatak'],
          rows: l.map(e => [e.date, e.name, e.vrsta, e.site, e.hours, e.ot, e.meal, e.teren || 0]), total: ['Ukupno u mjesecu', '', '', '', r2(S(l, e => e.hours)), r2(S(l, e => e.ot)), '', S(l, e => e.teren || 0)] },
        sl: { name: 'Slobodni dani', head: ['Datum', 'Radnik', 'Uz odobren zahtjev'], rows: sl.map(e => [e.date, e.name, e.odobren ? 'Da' : 'Ne']), total: ['Ukupno u mjesecu', sl.length, ''] },
        mis: { name: 'Bez unosa', head: ['Radnik', 'Broj dana', 'Datumi'], rows: ms.map(r => [r.name, r.dates.length, r.dates.join(', ')]), total: null }
      };
    }
    const q = v => '"' + String(v).replace(/"/g, '""') + '"';
    function csv(month, kind, f, today) {
      const t = tables(month, f, today)[kind] || tables(month, f, today).sum;
      const rows = [t.head, ...t.rows].concat(t.total ? [t.total] : []);
      return '﻿' + rows.map(r => r.map(v => q(typeof v === 'number' ? String(v).replace('.', ',') : v)).join(';')).join('\r\n');
    }
    function xlsx(month, f, today) {
      const t = tables(month, f, today), list = [t.sum, t.day, t.site, t.det];
      if (t.sl.rows.length) list.push(t.sl);
      if (t.mis.rows.length) list.push(t.mis);
      return xlsxFile(list);
    }
    return { VRSTE, NERAD, VRSTE_NAU, vrsteOf, nameOf, nmNazivi, nmObradi, nmProslijedi, nmNeobr, check, rec, summary, daily, sitesRep, rowsList, slobodni, stats, missingDays, rangeDates, goDates, goStats, notify, inbox, inboxHide, inboxClean, otpKey, otpName, otpOwn, otpCheck, otpList, otpDelete, OTP_ADMIN, nmPrimatelji, nmSave, nmList, nmDelete, nmView, canG, OTP_DANA, otpExpire, otpSite, otpSitesAll, otpSetSite, otpAsk, otpAnswer, dfmt, siteHours, siteCsv, siteXlsx, missing, report, tables, csv, xlsx, workdays, holidays, fond, weekdays, bank, pr, approval };
  }
  Core.VRSTE = VRSTE; Core.NERAD = NERAD; Core.VRSTE_NAU = VRSTE_NAU; Core.PRAZNIK_VRSTE = PRAZNIK_VRSTE; Core.workdays = workdays; Core.fond = fond; Core.bank = bank; Core.weekdays = weekdays; Core.holidays = holidays; Core.pdf = pdfDoc; Core.NM_JM = NM_JM; Core.nmDoc = nmDoc; Core.nmTotal = nmTotal; Core.nmNum = nmNum;
  if (typeof module !== 'undefined' && module.exports) module.exports = Core; else root.Core = Core;
})(typeof window !== 'undefined' ? window : this);
