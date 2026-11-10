// Vorschau einer PDF-Rechnung: die ersten Seiten untereinander als Bild (für Anzeige und Zoom)
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import worker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = worker;

async function render(data: Uint8Array, maxPages: number, width: number): Promise<HTMLCanvasElement[]> {
  // pdf.js darf die Daten nicht übernehmen, sonst ist das Original danach leer
  const doc = await getDocument({ data: data.slice(), isEvalSupported: false }).promise;
  try {
    const pages: HTMLCanvasElement[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
      const pg = await doc.getPage(i);
      const v0 = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: width / v0.width });
      const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      await pg.render({ canvasContext: g, viewport: vp }).promise;
      pages.push(c);
    }
    if (!pages.length) throw new Error('Leere PDF');
    return pages;
  } finally { void doc.destroy(); }
}

export async function pdfPreview(data: Uint8Array, maxPages = 4, width = 1400): Promise<string> {
  const pages = await render(data, maxPages, width);
  {
    const gap = 16, H = pages.reduce((s, c) => s + c.height, 0) + gap * (pages.length - 1);
    const out = document.createElement('canvas'); out.width = width; out.height = H;
    const g = out.getContext('2d')!; g.fillStyle = '#9aa3a0'; g.fillRect(0, 0, width, H);
    let y = 0; for (const c of pages) { g.drawImage(c, 0, y); y += c.height + gap; }
    return out.toDataURL('image/jpeg', 0.85);
  }
}

// Seiten einer PDF einzeln als JPEG (Base64 ohne Vorspann), falls die KI die PDF selbst nicht annimmt
export async function pdfPages(data: Uint8Array, maxPages = 4, width = 1600): Promise<string[]> {
  return (await render(data, maxPages, width)).map(c => c.toDataURL('image/jpeg', 0.85).split(',')[1]);
}
