import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { transform } from 'esbuild';

test('deployed Dev Tools module loads in native Node with an external JSON manifest', async () => {
  // tsx and the frontend build accept JSON imports without the attributes that
  // native Node requires. Keep JSON external to exercise the production loader.
  mkdirSync('test-results', { recursive: true });
  const root = mkdtempSync(path.resolve('test-results/dev-tools-runtime-'));
  try {
    const entry = path.join(root, 'api/dev-tools.js');
    const compile = async (directory: string) => {
      for (const item of readdirSync(directory, { withFileTypes: true })) {
        const source = path.join(directory, item.name);
        if (item.isDirectory()) { await compile(source); continue; }
        if (!source.endsWith('.ts')) continue;
        const target = path.join(root, source.replace(/\.ts$/, '.js'));
        const compiled = await transform(readFileSync(source, 'utf8'), { loader: 'ts', format: 'esm', target: 'node24' });
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, compiled.code);
      }
    };
    for (const directory of ['api', 'server-handlers', 'src/types']) await compile(directory);
    mkdirSync(path.join(root, 'src/generated'), { recursive: true });
    copyFileSync('src/generated/system-versions.json', path.join(root, 'src/generated/system-versions.json'));
    const runner = path.join(root, 'check.mjs');
    writeFileSync(runner, `
      import assert from 'node:assert/strict';
      const { default: handler } = await import(${JSON.stringify(pathToFileURL(entry).href)});
      for (const route of ['northport-recovery', 'schedulers', 'run-scheduler', 'system-versions', 'profile']) {
        const response = { code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
        await handler({ method: route === 'system-versions' || route === 'run-scheduler' ? 'POST' : 'GET', query: { route }, headers: {} }, response);
        assert.equal(response.code, 401, route + ' should reach its authentication check');
      }
      console.log('Native Node Dev Tools startup passed');
    `);
    const output = execFileSync(process.execPath, [runner], { encoding: 'utf8', env: { ...process.env, VERCEL: '1' }, timeout: 30000 });
    assert.match(output, /Native Node Dev Tools startup passed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
