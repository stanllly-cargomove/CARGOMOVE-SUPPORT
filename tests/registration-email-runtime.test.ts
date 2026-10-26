import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

test('bundled mail and scheduler functions render acceptance PDFs using only their packaged runtime assets', async () => {
  const base = path.resolve('test-results');
  mkdirSync(base, { recursive: true });
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
  const resources = ['media/image-removebg-preview.png',
    'node_modules/@fontsource/inter/files/inter-latin-400-normal.woff',
    'node_modules/@fontsource/inter/files/inter-latin-700-normal.woff'];
  for (const entry of ['api/mail.ts', 'api/scheduler/auto-register-cm.ts']) {
    const root = mkdtempSync(path.join(base, 'registration-email-runtime-'));
    try {
      for (const resource of resources) {
        assert.equal(path.matchesGlob(resource, config.functions[entry].includeFiles), true, `${entry} must package ${resource}`);
        const target = path.join(root, resource);
        mkdirSync(path.dirname(target), { recursive: true });
        copyFileSync(resource, target);
      }
      // Exercise import.meta relocation in a bundled function, rather than tsx
      // reading assets beside the original TypeScript modules in the checkout.
      const output = path.join(root, entry.replace(/\.ts$/, '.mjs'));
      await build({ entryPoints: ['server-handlers/email/submission-asset-pdf.ts'], outfile: output,
        bundle: true, platform: 'node', format: 'esm', target: 'node24' });
      execFileSync(process.execPath, ['--input-type=module', '-e', `
        import assert from 'node:assert/strict';
        const {buildAssetRegistrationPdf} = await import(${JSON.stringify(pathToFileURL(output).href)});
        const pdf = buildAssetRegistrationPdf('Offline Carrier', [{registration_type:'TRAILER',reference_no:'CMREG-TEST',data:{trailer:{registration_number:'T/123',weight:'1000'}}}]);
        assert.equal(pdf.subarray(0,5).toString(), '%PDF-');
        assert.ok(pdf.includes(Buffer.from('/FontFile2')));
        assert.ok(pdf.includes(Buffer.from('/Subtype /Image')));
      `], { cwd: root, env: { ...process.env, VERCEL: '1' }, timeout: 15000, stdio: 'pipe' });
    } finally {
      assert.equal(path.dirname(root), base);
      rmSync(root, { recursive: true, force: true });
    }
  }
});
