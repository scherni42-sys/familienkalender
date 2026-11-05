// Belegfoto als PDF/A-3b (Archivformat): JPEG ohne Neukomprimierung, sRGB-Ausgabeprofil, XMP-Metadaten,
// optional die XRechnung-XML als eingebettete Datei (AFRelationship Alternative). Keine Schriften nötig, nur das Bild.

// sRGB-Profil (ICC 4.2, 588 Bytes, mit Little CMS erzeugt)
const SRGB = 'AAACTGxjbXMEIAAAbW50clJHQiBYWVogB+oACwAFABMAHgAHYWNzcEFQUEwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1sY21zAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALZGVzYwAAAQgAAAA2Y3BydAAAAUAAAABMd3RwdAAAAYwAAAAUY2hhZAAAAaAAAAAsclhZWgAAAcwAAAAUYlhZWgAAAeAAAAAUZ1hZWgAAAfQAAAAUclRSQwAAAggAAAAgZ1RSQwAAAggAAAAgYlRSQwAAAggAAAAgY2hybQAAAigAAAAkbWx1YwAAAAAAAAABAAAADGVuVVMAAAAaAAAAHABzAFIARwBCACAAYgB1AGkAbAB0AC0AaQBuAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAADAAAAAcAE4AbwAgAGMAbwBwAHkAcgBpAGcAaAB0ACwAIAB1AHMAZQAgAGYAcgBlAGUAbAB5WFlaIAAAAAAAAPbWAAEAAAAA0y1zZjMyAAAAAAABDEIAAAXe///zJQAAB5MAAP2Q///7of///aIAAAPcAADAblhZWiAAAAAAAABvoAAAOPUAAAOQWFlaIAAAAAAAACSfAAAPhAAAtsNYWVogAAAAAAAAYpcAALeHAAAY2XBhcmEAAAAAAAMAAAACZmYAAPKnAAANWQAAE9AAAApbY2hybQAAAAAAAwAAAACj1wAAVHsAAEzNAACZmgAAJmYAAA9c';

const enc = new TextEncoder();
const b64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const pad = (n: number | string, l = 2) => String(n).padStart(l, "0");
const pdfDate = (d: Date) => `D:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const isoDate = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const xe = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
// PDF-Textstring als UTF-16BE in Hex (sicher für Umlaute)
const ps = (s: string) => '<FEFF' + [...s].map(ch => { const c = ch.codePointAt(0)!; if (c < 0x10000) return pad(c.toString(16), 4); const h = 0xd800 + ((c - 0x10000) >> 10), l = 0xdc00 + ((c - 0x10000) & 0x3ff); return pad(h.toString(16), 4) + pad(l.toString(16), 4); }).join('').toUpperCase() + '>';

// Breite und Höhe aus dem JPEG-Kopf (SOF-Marker)
function jpegSize(j: Uint8Array): { w: number; h: number; comps: number } {
  let i = 2;
  while (i + 9 < j.length) {
    if (j[i] !== 0xff) { i++; continue; }
    const m = j[i + 1], len = (j[i + 2] << 8) | j[i + 3];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (j[i + 5] << 8) | j[i + 6], w: (j[i + 7] << 8) | j[i + 8], comps: j[i + 9] };
    i += 2 + len;
  }
  throw new Error('Das Foto ist kein gültiges JPEG.');
}

export interface PdfaOpts { title: string; author?: string; subject?: string; attach?: { name: string; data: Uint8Array; desc: string } }

export function pdfa(jpeg: Uint8Array, o: PdfaOpts): Uint8Array {
  const { w, h, comps } = jpegSize(jpeg);
  if (comps !== 3 && comps !== 1) throw new Error('Farbformat des Fotos wird nicht unterstützt.');
  const now = new Date();
  // Seite: A4-Breite, Höhe nach Seitenverhältnis (höchstens 14 400 pt)
  let W = 595.28, H = W * h / w;
  if (H > 14400) { H = 14400; W = H * w / h; }
  const f = (n: number) => n.toFixed(2);

  const parts: Uint8Array[] = []; let pos = 0;
  const offs: number[] = [];
  const put = (x: string | Uint8Array) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); pos += b.length; };
  const obj = (n: number, head: string, stream?: Uint8Array) => {
    offs[n] = pos;
    if (stream) { put(`${n} 0 obj\n${head}\nstream\n`); put(stream); put('\nendstream\nendobj\n'); }
    else put(`${n} 0 obj\n${head}\nendobj\n`);
  };

  const xmp = enc.encode(`<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
   <pdfaid:part>3</pdfaid:part>
   <pdfaid:conformance>B</pdfaid:conformance>
   <dc:format>application/pdf</dc:format>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xe(o.title)}</rdf:li></rdf:Alt></dc:title>
${o.author ? `   <dc:creator><rdf:Seq><rdf:li>${xe(o.author)}</rdf:li></rdf:Seq></dc:creator>\n` : ''}${o.subject ? `   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xe(o.subject)}</rdf:li></rdf:Alt></dc:description>\n` : ''}   <xmp:CreateDate>${isoDate(now)}</xmp:CreateDate>
   <xmp:ModifyDate>${isoDate(now)}</xmp:ModifyDate>
   <xmp:MetadataDate>${isoDate(now)}</xmp:MetadataDate>
   <xmp:CreatorTool>FamTO Kassenbuch</xmp:CreatorTool>
   <pdf:Producer>FamTO Kassenbuch</pdf:Producer>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`);
  const icc = b64(SRGB);
  const content = enc.encode(`q ${f(W)} 0 0 ${f(H)} 0 0 cm /Im1 Do Q`);

  put(new Uint8Array([...enc.encode('%PDF-1.7\n%'), 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const att = o.attach;
  obj(1, `<< /Type /Catalog /Pages 2 0 R /Metadata 3 0 R /OutputIntents [4 0 R] /Lang (de-DE)${att ? ' /Names << /EmbeddedFiles << /Names [' + ps(att.name) + ' 10 0 R] >> >> /AF [10 0 R]' : ''} >>`);
  obj(2, '<< /Type /Pages /Kids [6 0 R] /Count 1 >>');
  obj(3, `<< /Type /Metadata /Subtype /XML /Length ${xmp.length} >>`, xmp);
  obj(4, '<< /Type /OutputIntent /S /GTS_PDFA1 /OutputConditionIdentifier (sRGB IEC61966-2.1) /Info (sRGB IEC61966-2.1) /DestOutputProfile 5 0 R >>');
  obj(5, `<< /N 3 /Length ${icc.length} >>`, icc);
  obj(6, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(W)} ${f(H)}] /Resources << /XObject << /Im1 8 0 R >> >> /Contents 7 0 R >>`);
  obj(7, `<< /Length ${content.length} >>`, content);
  obj(8, `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /${comps === 1 ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
  let n = 9;
  if (att) {
    obj(9, `<< /Type /EmbeddedFile /Subtype /text#2Fxml /Params << /Size ${att.data.length} /ModDate (${pdfDate(now)}) >> /Length ${att.data.length} >>`, att.data);
    obj(10, `<< /Type /Filespec /F ${ps(att.name)} /UF ${ps(att.name)} /Desc ${ps(att.desc)} /AFRelationship /Alternative /EF << /F 9 0 R /UF 9 0 R >> >>`);
    n = 11;
  }
  const xref = pos;
  const id = [...crypto.getRandomValues(new Uint8Array(16))].map(b => pad(b.toString(16))).join('');
  put(`xref\n0 ${n}\n0000000000 65535 f \n` + offs.slice(1, n).map(x => `${String(x).padStart(10, '0')} 00000 n \n`).join(''));
  put(`trailer\n<< /Size ${n} /Root 1 0 R /ID [<${id}> <${id}>] >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(pos); let k = 0; for (const p of parts) { out.set(p, k); k += p.length; }
  return out;
}
