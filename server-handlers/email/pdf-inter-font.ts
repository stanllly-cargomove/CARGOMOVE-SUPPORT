import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

type InterPdfFont = {
  data: Buffer;
  widths: number[];
  bbox: number[];
  ascent: number;
  descent: number;
  capHeight: number;
};

function fontTable(data: Buffer, records: Map<string, { offset: number; length: number }>, tag: string) {
  const record = records.get(tag);
  if (!record) throw new Error(`Inter font is missing its ${tag} table.`);
  return data.subarray(record.offset, record.offset + record.length);
}

function glyphFor(cmap: Buffer, code: number) {
  const count = cmap.readUInt16BE(2);
  let selected = 0;
  for (let index = 0; index < count; index += 1) {
    const offset = 4 + index * 8;
    const platform = cmap.readUInt16BE(offset);
    const encoding = cmap.readUInt16BE(offset + 2);
    const tableOffset = cmap.readUInt32BE(offset + 4);
    if ((platform === 3 && encoding === 1) || (platform === 0 && !selected)) selected = tableOffset;
  }
  if (!selected || cmap.readUInt16BE(selected) !== 4) throw new Error('Unsupported Inter font character map.');
  const segments = cmap.readUInt16BE(selected + 6) / 2;
  const endStart = selected + 14;
  const startStart = endStart + segments * 2 + 2;
  const deltaStart = startStart + segments * 2;
  const rangeStart = deltaStart + segments * 2;
  for (let index = 0; index < segments; index += 1) {
    if (code > cmap.readUInt16BE(endStart + index * 2)) continue;
    if (code < cmap.readUInt16BE(startStart + index * 2)) return 0;
    const delta = cmap.readInt16BE(deltaStart + index * 2);
    const range = cmap.readUInt16BE(rangeStart + index * 2);
    if (!range) return (code + delta) & 0xffff;
    const glyph = cmap.readUInt16BE(rangeStart + index * 2 + range + (code - cmap.readUInt16BE(startStart + index * 2)) * 2);
    return glyph ? (glyph + delta) & 0xffff : 0;
  }
  return 0;
}

function loadInterFont(woff: Buffer): InterPdfFont {
  if (woff.toString('ascii', 0, 4) !== 'wOFF') throw new Error('Invalid Inter font file.');
  const count = woff.readUInt16BE(12);
  const totalSize = woff.readUInt32BE(16);
  const sfnt = Buffer.alloc(totalSize);
  sfnt.writeUInt32BE(woff.readUInt32BE(4), 0);
  sfnt.writeUInt16BE(count, 4);
  const largestPower = 2 ** Math.floor(Math.log2(count));
  sfnt.writeUInt16BE(largestPower * 16, 6);
  sfnt.writeUInt16BE(Math.log2(largestPower), 8);
  sfnt.writeUInt16BE(count * 16 - largestPower * 16, 10);
  const records = new Map<string, { offset: number; length: number }>();
  let target = 12 + count * 16;
  for (let index = 0; index < count; index += 1) {
    const source = 44 + index * 20;
    const tag = woff.toString('ascii', source, source + 4);
    const offset = woff.readUInt32BE(source + 4);
    const compressedLength = woff.readUInt32BE(source + 8);
    const length = woff.readUInt32BE(source + 12);
    const contents = woff.subarray(offset, offset + compressedLength);
    const table = compressedLength < length ? inflateSync(contents) : contents;
    if (table.length !== length) throw new Error(`Invalid Inter font ${tag} table.`);
    const directory = 12 + index * 16;
    sfnt.write(tag, directory, 4, 'ascii');
    sfnt.writeUInt32BE(woff.readUInt32BE(source + 16), directory + 4);
    sfnt.writeUInt32BE(target, directory + 8);
    sfnt.writeUInt32BE(length, directory + 12);
    table.copy(sfnt, target);
    records.set(tag, { offset: target, length });
    target += (length + 3) & ~3;
  }
  const head = fontTable(sfnt, records, 'head');
  const hhea = fontTable(sfnt, records, 'hhea');
  const hmtx = fontTable(sfnt, records, 'hmtx');
  const cmap = fontTable(sfnt, records, 'cmap');
  const units = head.readUInt16BE(18);
  const metrics = hhea.readUInt16BE(34);
  const scale = (value: number) => Math.round(value * 1000 / units);
  const widths = Array.from({ length: 95 }, (_, index) => {
    const glyph = glyphFor(cmap, index + 32);
    return scale(hmtx.readUInt16BE(Math.min(glyph, metrics - 1) * 4));
  });
  return {
    data: sfnt,
    widths,
    bbox: [scale(head.readInt16BE(36)), scale(head.readInt16BE(38)), scale(head.readInt16BE(40)), scale(head.readInt16BE(42))],
    ascent: scale(hhea.readInt16BE(4)),
    descent: scale(hhea.readInt16BE(6)),
    capHeight: scale(hhea.readInt16BE(4)),
  };
}

let cachedFonts: { regular: InterPdfFont; bold: InterPdfFont } | undefined;

export function interPdfFonts() {
  if (!cachedFonts) cachedFonts = {
    regular: loadInterFont(readFileSync(new URL('../../node_modules/@fontsource/inter/files/inter-latin-400-normal.woff', import.meta.url))),
    bold: loadInterFont(readFileSync(new URL('../../node_modules/@fontsource/inter/files/inter-latin-700-normal.woff', import.meta.url))),
  };
  return cachedFonts;
}
