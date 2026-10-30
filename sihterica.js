'use strict';
/* ŠIHTERICA: mjesečni izvještaj po radniku u obliku tvrtkinog Excel predloška (predlosci/sihterica/).
   Svaki radnik dobiva svoj list s logom, istim stilovima, spojenim ćelijama i formulama kao u predlošku.
   Koriste ga server (Node.js) i demo u pregledniku; tpl = {ime datoteke: tekst ili Uint8Array}, zip = Core.zip. */
(function (root) {
  const COL = n => { let r = ''; n++; while (n) { const m = (n - 1) % 26; r = String.fromCharCode(65 + m) + r; n = (n - 1 - m) / 26; } return r; };
  const DAN = d => COL(2 + d); /* dan 1 = stupac D */
  const X = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  /* upiši vrijednost u postojeću ćeliju predloška (stil ćelije ostaje) */
  function cell(xml, ref, val) {
    const re = new RegExp('<c r="' + ref + '"( [^>]*?)?(?:/>|>[\\s\\S]*?</c>)');
    const m = re.exec(xml); if (!m) return xml;
    const at = (m[1] || '').replace(/ t="[^"]*"/, '');
    let body;
    if (val === null || val === undefined || val === '') body = '<c r="' + ref + '"' + at + '/>';
    else if (typeof val === 'number') body = '<c r="' + ref + '"' + at + '><v>' + val + '</v></c>';
    else if (typeof val === 'object' && val.f) body = '<c r="' + ref + '"' + at + '><f>' + X(val.f) + '</f><v>' + (val.v || 0) + '</v></c>';
    else body = '<c r="' + ref + '"' + at + ' t="inlineStr"><is><t xml:space="preserve">' + X(val) + '</t></is></c>';
    return xml.slice(0, m.index) + body + xml.slice(m.index + m[0].length);
  }
  const r2 = n => Math.round(n * 100) / 100, sum = o => r2(Object.values(o).reduce((a, x) => a + (typeof x === 'number' ? x : 0), 0));
  /* s = {name, mjesec, dana, sites:[{name, d:{dan:sati}}], sd, pr, go, bo:{dan:sati}, prijenos, fond, obrok:{dan:1}, obrokTxt, teren:{dan:1}} */
  function sheet(tpl, s) {
    let x = tpl;
    x = cell(x, 'J6', s.name); x = cell(x, 'AB6', s.mjesec);
    for (let d = 29; d <= 31; d++) if (d > s.dana) x = cell(x, DAN(d) + '10', '');
    let tot = 0;
    const row = (r, o) => { for (const [d, v] of Object.entries(o || {})) x = cell(x, DAN(+d) + r, v); const t = sum(o || {}); tot += t; return t; };
    s.sites.slice(0, 10).forEach((st, i) => { const r = 13 + i; x = cell(x, 'B' + r, st.name); const t = row(r, st.d); x = cell(x, 'AI' + r, { f: 'SUM(D' + r + ':AH' + r + ')', v: t }); });
    [['23', s.sd], ['24', s.pr], ['25', s.go], ['26', s.bo]].forEach(([r, o]) => { const t = row(r, o); if (t || Object.keys(o || {}).length) x = cell(x, 'AI' + r, { f: 'SUM(D' + r + ':AH' + r + ')', v: t }); });
    if (s.prijenos) { x = cell(x, 'AI27', s.prijenos); tot += s.prijenos; }
    tot = r2(tot);
    x = cell(x, 'AI29', { f: 'SUM(AI12:AI28)', v: tot });
    if (s.fond !== null && s.fond !== undefined) x = cell(x, 'D30', s.fond);
    const ot = tot - (s.fond || 0) < 1 ? 0 : r2(tot - (s.fond || 0));
    x = cell(x, 'AI30', { f: 'IF((AI29-D30)<1, 0, AI29-D30)', v: ot });
    if (s.obrokTxt) x = cell(x, 'C31', s.obrokTxt);
    for (const d of Object.keys(s.obrok || {})) x = cell(x, DAN(+d) + '31', s.obrok[d]);
    for (const d of Object.keys(s.teren || {})) x = cell(x, DAN(+d) + '32', s.teren[d]);
    x = x.replace(/(<c r="AI31"[^>]*><f [^>]*>[^<]*<\/f><v>)0(<\/v>)/, '$1' + sum(s.obrok || {}) + '$2').replace(/(<c r="AI32"[^>]*><f [^>]*\/><v>)0(<\/v>)/, '$1' + sum(s.teren || {}) + '$2');
    return x;
  }
  function build(tpl, list, zip) {
    const used = new Set(), names = list.map((s, i) => { let n = String(s.name).replace(/[\\\/\?\*\[\]:']/g, ' ').trim().slice(0, 31) || 'Radnik ' + (i + 1), k = 2; const b = n;
      while (used.has(n.toLowerCase())) n = b.slice(0, 31 - String(k).length - 1) + ' ' + (k++); used.add(n.toLowerCase()); return n; });
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', P = 'http://schemas.openxmlformats.org/package/2006/relationships';
    const files = [
      { name: '[Content_Types].xml', data: H + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + list.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/drawings/drawing' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>').join('')
        + '<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>' },
      { name: '_rels/.rels', data: H + '<Relationships xmlns="' + P + '"><Relationship Id="rId1" Type="' + R + '/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: H + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="' + R + '"><bookViews><workbookView/></bookViews><sheets>' + names.map((n, i) => '<sheet name="' + X(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets><definedNames>'
        + names.map((n, i) => '<definedName name="_xlnm.Print_Area" localSheetId="' + i + '">\'' + X(n.replace(/'/g, "''")) + '\'!$A$1:$AK$35</definedName>').join('') + '</definedNames><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: H + '<Relationships xmlns="' + P + '">' + list.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="' + R + '/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('')
        + '<Relationship Id="rId' + (list.length + 1) + '" Type="' + R + '/styles" Target="styles.xml"/><Relationship Id="rId' + (list.length + 2) + '" Type="' + R + '/theme" Target="theme/theme1.xml"/><Relationship Id="rId' + (list.length + 3) + '" Type="' + R + '/sharedStrings" Target="sharedStrings.xml"/></Relationships>' },
      { name: 'xl/styles.xml', data: tpl['styles.xml'] }, { name: 'xl/theme/theme1.xml', data: tpl['theme1.xml'] }, { name: 'xl/sharedStrings.xml', data: tpl['sharedStrings.xml'] }, { name: 'xl/media/image1.png', data: tpl['image1.png'] }
    ];
    list.forEach((s, i) => {
      let sx = sheet(tpl['sheet1.xml'], s).replace(/ xr:uid="\{[^}]*\}"/, '').replace('<drawing r:id="rId2"/>', '<drawing r:id="rId1"/>');
      if (i === 0) sx = sx.replace('<sheetView ', '<sheetView tabSelected="1" ');
      files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: sx },
        { name: 'xl/worksheets/_rels/sheet' + (i + 1) + '.xml.rels', data: H + '<Relationships xmlns="' + P + '"><Relationship Id="rId1" Type="' + R + '/drawing" Target="../drawings/drawing' + (i + 1) + '.xml"/></Relationships>' },
        { name: 'xl/drawings/drawing' + (i + 1) + '.xml', data: tpl['drawing1.xml'] },
        { name: 'xl/drawings/_rels/drawing' + (i + 1) + '.xml.rels', data: H + '<Relationships xmlns="' + P + '"><Relationship Id="rId1" Type="' + R + '/image" Target="../media/image1.png"/></Relationships>' });
    });
    return zip(files);
  }
  const Sihterica = { build, sheet, cell };
  if (typeof module !== 'undefined' && module.exports) module.exports = Sihterica; else root.Sihterica = Sihterica;
})(typeof window !== 'undefined' ? window : this);
