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
    const details = submission.registration_type === 'DRIVER'
      ? `Licence: ${item.driving_license || '-'} | Mobile: ${item.mobile_no || '-'}`
      : submission.registration_type === 'TRAILER'
        ? `Type: ${item.trailer_type || '-'} | BDM: ${item.bdm_weight || '-'} KG`
        : `Head: ${item.head || '-'} | BGK: ${item.bgk_weight || '-'} KG`;
    return `${type.charAt(0).toUpperCase() + type.slice(1)} | ${identifier} | ${details} | ${submission.reference_no}`;
  });
}

/** A dependency-free PDF summary attached to each company-specific outcome email. */
export function buildAssetRegistrationPdf(companyName: string, submissions: any[]) {
  const queueNumbers = submissions.map((submission) => submission.reference_no).filter(Boolean).join(', ');
  const timestamp = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
  const lines = submissions.flatMap(assetLines);
  const pages = Array.from({ length: Math.max(1, Math.ceil(lines.length / 28)) }, (_, index) => lines.slice(index * 28, (index + 1) * 28));
  const objects: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`];
  pages.forEach((page, index) => {
    const pageId = 3 + index * 2; const contentId = pageId + 1;
    const rows = page.map((line, lineIndex) => {
      const y = 570 - lineIndex * 18;
      const [type, asset, details, queue] = line.split(' | ');
      const fill = lineIndex % 2 === 0 ? `q 0.97 0.98 0.99 rg 40 ${y - 5} 515 17 re f Q\n` : '';
      return `${fill}BT /F1 8 Tf 50 ${y} Td (${pdfText(type)}) Tj ET\nBT /F1 8 Tf 125 ${y} Td (${pdfText(asset)}) Tj ET\nBT /F1 7 Tf 265 ${y} Td (${pdfText(details)}) Tj ET\nBT /F1 8 Tf 455 ${y} Td (${pdfText(queue)}) Tj ET`;
    }).join('\n');
    const content = `q 0.02 0.35 0.65 rg 0 792 595 50 re f Q\nq 0.98 0.55 0.12 rg 42 806 18 18 re f Q\nBT /F1 20 Tf 70 814 Td (CargoMove) Tj ET\nBT /F1 8 Tf 71 801 Td (REGISTRATION OPERATIONS) Tj ET\nBT /F1 16 Tf 42 760 Td (Registration Asset List) Tj ET\nq 0.95 0.97 0.99 rg 40 675 515 55 re f Q\nBT /F1 8 Tf 52 712 Td (COMPANY) Tj ET\nBT /F1 11 Tf 52 696 Td (${pdfText(companyName)}) Tj ET\nBT /F1 8 Tf 300 712 Td (QUEUE NUMBER) Tj ET\nBT /F1 9 Tf 300 696 Td (${pdfText(queueNumbers)}) Tj ET\nBT /F1 8 Tf 445 712 Td (GENERATED) Tj ET\nBT /F1 8 Tf 445 696 Td (${pdfText(timestamp)}) Tj ET\nq 0.02 0.35 0.65 rg 40 625 515 21 re f Q\nBT /F1 8 Tf 50 632 Td (TYPE) Tj ET\nBT /F1 8 Tf 125 632 Td (ASSET / DRIVER) Tj ET\nBT /F1 8 Tf 265 632 Td (REGISTRATION DETAILS) Tj ET\nBT /F1 8 Tf 455 632 Td (QUEUE NO.) Tj ET\n${rows}\nq 0.78 0.84 0.92 RG 40 95 m 555 95 l S Q\nBT /F1 8 Tf 42 76 Td (CargoMove - Registration Operations) Tj ET\nBT /F1 8 Tf 470 76 Td (Page ${index + 1} of ${pages.length}) Tj ET`;
    // Fixed A4 portrait layout keeps attachment sizing consistent in previews,
    // downloads, and recipient mail clients.
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${3 + pages.length * 2} 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  });
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf); pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

export function assetRegistrationPdfName(submissions: any[]) {
  const references = submissions.map((submission) => String(submission.reference_no || '').trim()).filter(Boolean);
  return `${references.slice(0, 3).join('_') || 'REGISTRATION'}${references.length > 3 ? '_MORE' : ''}.pdf`;
}
