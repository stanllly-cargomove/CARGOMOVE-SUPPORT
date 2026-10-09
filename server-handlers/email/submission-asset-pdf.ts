import { readFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { interPdfFonts } from './pdf-inter-font.js';

type AssetType = 'DRIVER' | 'TRAILER' | 'VEHICLE';
type AssetRow = { item: Record<string, unknown> };
type Column = { title: string; width: number; value: (row: AssetRow) => unknown };

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const LEFT = 42;
const TABLE_WIDTH = 511;
const ROWS_PER_PAGE = 16;
const INK = '0.12 0.20 0.31';
const BLUE = '0.03 0.36 0.66';
const MUTED = '0.38 0.46 0.55';

function safeText(value: unknown) {
  return String(value ?? '').trim().replace(/[^\x20-\x7e]/g, '?').replace(/[\\()]/g, '\\$&');
}

function fitText(value: unknown, width: number, size: number, bold = false) {
  const raw = String(value ?? '').trim().replace(/[^\x20-\x7e]/g, '?');
  const metrics = bold ? interPdfFonts().bold.widths : interPdfFonts().regular.widths;
  const measure = (text: string) => [...text].reduce((total, character) => total + (metrics[character.charCodeAt(0) - 32] || metrics[31]) * size / 1000, 0);
  if (measure(raw) <= width) return raw;
  let clipped = raw;
  while (clipped && measure(`${clipped}...`) > width) clipped = clipped.slice(0, -1);
  return `${clipped}...`;
}

function line(font: 'F1' | 'F2', size: number, x: number, y: number, value: unknown, color = INK) {
  return `${color} rg BT /${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${safeText(value)}) Tj ET`;
}

function assetRows(submissions: any[]): AssetRow[] {
  return submissions.flatMap((submission) => {
    const type = submission.registration_type as AssetType;
    const data = submission.data || {};
    const plural = type === 'DRIVER' ? data.drivers : type === 'TRAILER' ? data.trailers : data.vehicles;
    const singular = type === 'DRIVER' ? data.driver : type === 'TRAILER' ? data.trailer : data.vehicle;
    const items = Array.isArray(plural) && plural.length ? plural : singular ? [singular] : [{}];
    return items.map((item: Record<string, unknown>) => ({ item }));
  });
}

function columnsFor(type: AssetType): Column[] {
  if (type === 'DRIVER') return [
    { title: 'DRIVER NAME', width: 185, value: ({ item }) => item.name || '-' },
    { title: 'LICENCE / NRIC', width: 180, value: ({ item }) => item.driving_license || '-' },
    { title: 'MOBILE NO.', width: 146, value: ({ item }) => item.mobile_no || '-' },
  ];
  if (type === 'TRAILER') return [
    { title: 'PLATE / REG NO.', width: 145, value: ({ item }) => item.registration_number || '-' },
    { title: 'TRAILER TYPE', width: 158, value: ({ item }) => item.trailer_type || '-' },
    { title: 'UNLADEN WT.', width: 104, value: ({ item }) => item.weight ? `${item.weight} KG` : '-' },
    { title: 'BDM WT.', width: 104, value: ({ item }) => item.bdm_weight ? `${item.bdm_weight} KG` : '-' },
  ];
  return [
    { title: 'PLATE / REG NO.', width: 151, value: ({ item }) => item.registration_number || '-' },
    { title: 'HEAD NO.', width: 132, value: ({ item }) => item.head || '-' },
    { title: 'UNLADEN WT.', width: 114, value: ({ item }) => item.weight ? `${item.weight} KG` : '-' },
    { title: 'BGK WT.', width: 114, value: ({ item }) => item.bgk_weight ? `${item.bgk_weight} KG` : '-' },
  ];
}

function logoPixels() {
  // Decode the same transparent PNG used by the app's Logo component. PDF
  // image XObjects need the RGB pixels and transparency as separate streams.
  const png = readFileSync(new URL('../../media/image-removebg-preview.png', import.meta.url));
  if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid CargoMove logo PNG.');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (png[24] !== 8 || png[25] !== 6 || png[28] !== 0) throw new Error('Unsupported CargoMove logo PNG format.');
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const name = png.toString('ascii', offset + 4, offset + 8);
    if (name === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
    if (name === 'IEND') break;
  }
  const decoded = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const rgb = Buffer.alloc(width * height * 3);
  const alpha = Buffer.alloc(width * height);
  let previous = Buffer.alloc(stride);
  let source = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = decoded[source++];
    const current = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const raw = decoded[source++];
      const a = x >= 4 ? current[x - 4] : 0;
      const b = previous[x];
      const c = x >= 4 ? previous[x - 4] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : filter === 4 ? pa <= pb && pa <= pc ? a : pb <= pc ? b : c : 0;
      if (filter > 4) throw new Error('Unsupported CargoMove logo PNG filter.');
      current[x] = (raw + predictor) & 255;
    }
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      current.copy(rgb, pixel * 3, x * 4, x * 4 + 3);
      alpha[pixel] = current[x * 4 + 3];
    }
    previous = current;
  }
  return { width, height, rgb: deflateSync(rgb), alpha: deflateSync(alpha) };
}

function streamObject(dictionary: string, contents: Buffer) {
  return Buffer.concat([Buffer.from(`<< ${dictionary} /Length ${contents.length} >>\nstream\n`), contents, Buffer.from('\nendstream')]);
}

/** Fixed A4 registration summary shared by attachment preview and Gmail send. */
export function buildAssetRegistrationPdf(companyName: string, submissions: any[]) {
  const type = submissions[0]?.registration_type as AssetType;
  if (!['DRIVER', 'TRAILER', 'VEHICLE'].includes(type) || submissions.some((submission) => submission.registration_type !== type)) {
    throw new Error('A PDF can contain only one asset registration type.');
  }
  const rows = assetRows(submissions);
  const columns = columnsFor(type);
  const pageCount = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
  const title = `${type.charAt(0)}${type.slice(1).toLowerCase()} Registration`;
  const references = [...new Set(submissions.map((submission) => String(submission.reference_no || '')).filter(Boolean))];
  const stamp = `${new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())} MYT`;
  const logo = logoPixels();
  const fonts = interPdfFonts();
  const regularId = 3 + pageCount * 2;
  const boldId = regularId + 1;
  const logoId = regularId + 2;
  const maskId = regularId + 3;
  const regularDescriptorId = regularId + 4;
  const boldDescriptorId = regularId + 5;
  const regularFileId = regularId + 6;
  const boldFileId = regularId + 7;
  const objects: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from(`<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, index) => `${3 + index * 2} 0 R`).join(' ')}] /Count ${pageCount} >>`),
  ];

  for (let page = 0; page < pageCount; page += 1) {
    const pageRows = rows.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE);
    const commands = [
      '1 1 1 rg 0 0 595 842 re f',
      // Real CargoMove artwork; its transparent background remains transparent.
      'q 175 0 0 30 42 779 cm /Logo Do Q',
      line('F1', 7.3, 42, 766, 'REGISTRATION OPERATIONS', MUTED),
      `${BLUE} rg 42 750 511 2 re f`,
      line('F2', 17, 42, 718, title),
      line('F1', 8.2, 42, 699, 'Approved registration details for your records', MUTED),
      '0.90 0.96 1 rg 457 706 96 24 re f',
      line('F2', 7.4, 474, 715, 'APPROVED', BLUE),
      '0.96 0.98 1 rg 42 622 511 62 re f',
      line('F2', 7.2, 55, 663, 'COMPANY', MUTED),
      line('F1', 8.8, 55, 646, fitText(companyName, 222, 8.8)),
      line('F2', 7.2, 286, 663, 'QUEUE NUMBER', MUTED),
      line('F1', 7.8, 286, 646, fitText(references.join(', '), 136, 7.8)),
      line('F2', 7.2, 432, 663, 'GENERATED', MUTED),
      line('F1', 7.1, 432, 646, fitText(stamp, 110, 7.1)),
      line('F2', 9.2, 42, 601, `Registered ${type.toLowerCase()}${rows.length === 1 ? '' : 's'}`),
      line('F1', 7.4, 486, 601, `${rows.length} ${rows.length === 1 ? 'item' : 'items'}`, MUTED),
      `${BLUE} rg 42 563 ${TABLE_WIDTH} 25 re f`,
    ];
    let x = LEFT;
    for (const column of columns) {
      commands.push(line('F2', 7, x + 9, 572, column.title, '1 1 1'));
      x += column.width;
    }
    pageRows.forEach((row, index) => {
      const bottom = 563 - (index + 1) * 25;
      if (index % 2 === 0) commands.push(`0.97 0.98 0.99 rg 42 ${bottom} ${TABLE_WIDTH} 25 re f`);
      commands.push(`0.86 0.90 0.94 RG 0.35 w 42 ${bottom} m 553 ${bottom} l S`);
      let cellX = LEFT;
      for (const column of columns) {
        const font = cellX === LEFT ? 'F2' : 'F1';
        commands.push(line(font, 7.9, cellX + 9, bottom + 9, fitText(column.value(row), column.width - 18, 7.9, font === 'F2')));
        cellX += column.width;
      }
    });
    if (pageRows.length === 0) commands.push(line('F1', 9, 52, 538, 'No asset details were recorded for this registration.', MUTED));
    commands.push(
      '0.84 0.89 0.94 RG 0.6 w 42 77 m 553 77 l S',
      line('F1', 7.4, 42, 57, `CargoMove - ${title}`, MUTED),
      line('F1', 7.4, 496, 57, `Page ${page + 1} of ${pageCount}`, MUTED),
    );
    const contents = Buffer.from(commands.join('\n'), 'ascii');
    const contentId = 4 + page * 2;
    objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${regularId} 0 R /F2 ${boldId} 0 R >> /XObject << /Logo ${logoId} 0 R >> >> /Contents ${contentId} 0 R >>`));
    objects.push(streamObject('', contents));
  }
  objects.push(Buffer.from(`<< /Type /Font /Subtype /TrueType /BaseFont /Inter-Regular /FirstChar 32 /LastChar 126 /Widths [${fonts.regular.widths.join(' ')}] /Encoding /WinAnsiEncoding /FontDescriptor ${regularDescriptorId} 0 R >>`));
  objects.push(Buffer.from(`<< /Type /Font /Subtype /TrueType /BaseFont /Inter-Bold /FirstChar 32 /LastChar 126 /Widths [${fonts.bold.widths.join(' ')}] /Encoding /WinAnsiEncoding /FontDescriptor ${boldDescriptorId} 0 R >>`));
  objects.push(streamObject(`/Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /SMask ${maskId} 0 R`, logo.rgb));
  objects.push(streamObject(`/Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, logo.alpha));
  objects.push(Buffer.from(`<< /Type /FontDescriptor /FontName /Inter-Regular /Flags 32 /FontBBox [${fonts.regular.bbox.join(' ')}] /ItalicAngle 0 /Ascent ${fonts.regular.ascent} /Descent ${fonts.regular.descent} /CapHeight ${fonts.regular.capHeight} /StemV 80 /FontFile2 ${regularFileId} 0 R >>`));
  objects.push(Buffer.from(`<< /Type /FontDescriptor /FontName /Inter-Bold /Flags 32 /FontBBox [${fonts.bold.bbox.join(' ')}] /ItalicAngle 0 /Ascent ${fonts.bold.ascent} /Descent ${fonts.bold.descent} /CapHeight ${fonts.bold.capHeight} /StemV 120 /FontFile2 ${boldFileId} 0 R >>`));
  objects.push(streamObject(`/Length1 ${fonts.regular.data.length}`, fonts.regular.data));
  objects.push(streamObject(`/Length1 ${fonts.bold.data.length}`, fonts.bold.data));

  const output: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets = [0];
  let length = output[0].length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const part = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]);
    output.push(part);
    length += part.length;
  });
  const xref = length;
  const xrefLines = offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  output.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${xrefLines}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`));
  return Buffer.concat(output);
}

export function assetRegistrationPdfName(submissions: any[]) {
  const references = submissions.map((submission) => String(submission.reference_no || '').trim()).filter(Boolean);
  return `${references.slice(0, 3).join('_') || 'REGISTRATION'}${references.length > 3 ? '_MORE' : ''}.pdf`;
}
