// Local PDF export: the browser renders the existing Inter font (including
// Unicode values) into print-resolution pages. No upload or extra dependency.
const PAGE_WIDTH = 595, PAGE_HEIGHT = 842, MARGIN = 36, BOTTOM = 801;
const encoder = new TextEncoder();
const ascii = (value: string) => encoder.encode(value);
const concat = (parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
};
function jpegBytes(canvas: HTMLCanvasElement) {
  const binary = atob(canvas.toDataURL('image/jpeg', .94).split(',')[1]);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
function imagePdf(images: Uint8Array[], width: number, height: number) {
  const objects: Uint8Array[] = [ascii('<< /Type /Catalog /Pages 2 0 R >>'), new Uint8Array()];
  const pages: string[] = [];
  for (const jpeg of images) {
    const page = objects.length + 1, image = page + 1, contents = page + 2;
    pages.push(`${page} 0 R`);
    objects.push(ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /XObject << /Image ${image} 0 R >> >> /Contents ${contents} 0 R >>`));
    objects.push(concat([ascii(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, ascii('\nendstream')]));
    const command = ascii(`q ${PAGE_WIDTH} 0 0 ${PAGE_HEIGHT} 0 0 cm /Image Do Q`);
    objects.push(concat([ascii(`<< /Length ${command.length} >>\nstream\n`), command, ascii('\nendstream')]));
  }
  objects[1] = ascii(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.join(' ')}] >>`);
  const chunks = [ascii('%PDF-1.4\n%CargoMove\n')], offsets = [0];
  let position = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(position);
    const chunk = concat([ascii(`${index + 1} 0 obj\n`), object, ascii('\nendobj\n')]);
    chunks.push(chunk); position += chunk.length;
  });
  chunks.push(ascii(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${position}\n%%EOF\n`));
  return concat(chunks);
}
function wrapText(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  return text.split(/\r?\n/).flatMap(paragraph => {
    const lines: string[] = []; let line = '';
    for (const word of paragraph.split(/(\s+)/)) {
      if (context.measureText(line + word).width <= width) { line += word; continue; }
      if (line.trim()) lines.push(line.trimEnd());
      line = '';
      for (const character of word.trimStart()) {
        if (context.measureText(line + character).width > width && line) { lines.push(line); line = ''; }
        line += character;
      }
    }
    if (line || !lines.length) lines.push(line);
    return lines;
  });
}

/** Each movement retains its full field set; long values continue on new pages. */
export async function createNpPdf(rows: string[][], containerNumber: string): Promise<Uint8Array> {
  if (rows.length < 2) throw new Error('No movements to export.');
  await document.fonts.ready;
  const canvas = document.createElement('canvas'); canvas.width = PAGE_WIDTH * 2; canvas.height = PAGE_HEIGHT * 2;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('PDF rendering is unavailable.');
  context.scale(2, 2);
  const images: Uint8Array[] = []; let y = 0, rowIndex = 0;
  const font = (size: number, bold = false) => { context.font = `${bold ? '600' : '400'} ${size}px Inter, Arial, sans-serif`; };
  const startPage = (movement: number, source: string, evidence: string, continued: boolean) => {
    context.fillStyle = '#fff'; context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
    context.fillStyle = '#08245b'; context.fillRect(0, 0, PAGE_WIDTH, 7);
    font(18, true); context.fillText('Northport Container Query', MARGIN, 43);
    font(10); context.fillStyle = '#475569'; context.fillText(`${containerNumber}  |  Movement ${movement} of ${rows.length - 1}  |  Source record ${source}${continued ? ' (continued)' : ''}`, MARGIN, 65);
    font(9); context.fillText(evidence, MARGIN, 82); y = 98; rowIndex = 0;
  };
  const finishPage = () => {
    font(8); context.fillStyle = '#64748b'; context.fillText('CargoMove - Northport enquiry', MARGIN, 823);
    context.textAlign = 'right'; context.fillText(`Page ${images.length + 1}`, PAGE_WIDTH - MARGIN, 823); context.textAlign = 'left';
    images.push(jpegBytes(canvas));
  };
  for (let index = 1; index < rows.length; index++) {
    const record = rows[index]; startPage(index, record[0], record[1], false);
    for (let field = 2; field < rows[0].length; field++) {
      font(10); const lines = wrapText(context, record[field] || '—', 355);
      let offset = 0;
      while (offset < lines.length) {
        if (y + 42 > BOTTOM) { finishPage(); startPage(index, record[0], record[1], true); }
        font(9, true); const labels = wrapText(context, rows[0][field] + (offset ? ' (continued)' : ''), 135);
        const count = Math.min(lines.length - offset, Math.max(1, Math.floor((BOTTOM - y - 6) / 11)));
        const height = Math.max(labels.length, count) * 11 + 6;
        context.fillStyle = rowIndex++ % 2 ? '#f1f5fb' : '#fff'; context.fillRect(MARGIN, y, PAGE_WIDTH - MARGIN * 2, height);
        context.fillStyle = '#475569'; labels.forEach((line, lineIndex) => context.fillText(line, MARGIN + 8, y + 12 + lineIndex * 11));
        font(10); context.fillStyle = '#0f172a'; lines.slice(offset, offset + count).forEach((line, lineIndex) => context.fillText(line, MARGIN + 154, y + 12 + lineIndex * 11));
        y += height; offset += count;
      }
    }
    finishPage();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
  return imagePdf(images, canvas.width, canvas.height);
}
