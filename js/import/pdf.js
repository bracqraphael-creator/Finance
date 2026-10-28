// Extraction du texte d'un PDF, sur le téléphone, avec pdf.js (chargé seulement quand un PDF est importé).
// Les éléments de texte sont regroupés en lignes selon leur position, colonnes séparées par des espaces.

let pdfjsPromise = null;
function loadPdfjs() {
  pdfjsPromise ||= import('../../vendor/pdfjs/pdf.min.js').then(m => {
    m.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.min.js', import.meta.url).href;
    return m;
  });
  return pdfjsPromise;
}

/** Regroupe des éléments { x, y, w, s } d'une page en lignes de texte (haut de page en premier). */
export function itemsToLines(items) {
  const rows = [];
  for (const it of items.filter(i => i.s && i.s.trim())) {
    let row = rows.find(r => Math.abs(r.y - it.y) <= 2.5);
    if (!row) rows.push((row = { y: it.y, items: [] }));
    row.items.push(it);
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map(r => {
    const its = r.items.sort((a, b) => a.x - b.x);
    let out = '', end = null;
    for (const it of its) {
      if (end != null) {
        const gap = it.x - end;
        out += gap > 12 ? '  ' : gap > 1.2 ? ' ' : '';
      }
      out += it.s;
      end = it.x + (it.w || it.s.length * 4.5);
    }
    return out;
  });
}

/** Pages du PDF : liste d'éléments de texte { x, y, w, s } par page. */
export async function pdfToPages(buffer) {
  const pdfjs = await loadPdfjs();
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  const pages = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      pages.push(tc.items.map(i => ({ x: i.transform[4], y: i.transform[5], w: i.width, s: i.str })));
      page.cleanup();
    }
  } finally {
    doc.destroy();
  }
  return pages;
}

export async function pdfToLines(buffer) {
  return (await pdfToPages(buffer)).flatMap(itemsToLines);
}
