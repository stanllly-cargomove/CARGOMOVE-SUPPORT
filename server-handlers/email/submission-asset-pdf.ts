function pdfText(value: unknown) {
  return String(value || '').replace(/[^\x20-\x7E]/g, '?').replace(/[\\()]/g, '\\$&');
}

function assetLines(submission: any) {
  const data = submission.data || {};
  const items = submission.registration_type === 'DRIVER'
    ? data.drivers || (data.driver ? [data.driver] : [])
    : submission.registration_type === 'TRAILER'
      ? data.trailers || (data.trailer ? [data.trailer] : [])
      : data.vehicles || (data.vehicle ? [data.vehicle] : []);
  const type = String(submission.registration_type || '').toLowerCase();
  return (items.length ? items : [{}]).map((item: any, index: number) => {
    const identifier = item.name || item.registration_number || item.driving_license || 'Registration item';
    return `${type.charAt(0).toUpperCase() + type.slice(1)} ${index + 1}: ${identifier} (Ref: ${submission.reference_no})`;
  });
}

/** A dependency-free PDF summary attached to each company-specific outcome email. */
export function buildAssetRegistrationPdf(companyName: string, submissions: any[]) {
  const lines = [`CargoMove Registration Asset List`, `Company: ${companyName}`, `Generated: ${new Date().toISOString().slice(0, 10)}`, '', ...submissions.flatMap(assetLines)];
  const pages = Array.from({ length: Math.max(1, Math.ceil(lines.length / 42)) }, (_, index) => lines.slice(index * 42, (index + 1) * 42));
  const objects: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`];
  pages.forEach((page, index) => {
    const pageId = 3 + index * 2; const contentId = pageId + 1;
    const content = `BT /F1 11 Tf 50 760 Td 15 TL ${page.map((line, lineIndex) => `${lineIndex ? 'T* ' : ''}(${pdfText(line)}) Tj`).join('\n')} ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${3 + pages.length * 2} 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  });
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf); pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}
