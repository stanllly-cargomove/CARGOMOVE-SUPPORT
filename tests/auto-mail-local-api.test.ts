import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

test('real local Express API serves deployed email and Auto Mail routes with offline providers', async () => {
  await mkdir('test-results', { recursive: true });
  const directory = await mkdtemp(path.resolve('test-results/auto-mail-local-api-'));
  try {
    const outfile = path.join(directory, 'server.mjs');
    await build({ entryPoints: ['server.ts'], outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external',
      banner: { js: "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);" },
      plugins: [{ name: 'no-real-environment', setup(builder) {
        builder.onResolve({ filter: /^dotenv$/ }, () => ({ path: 'dotenv', namespace: 'offline-dotenv' }));
        builder.onLoad({ filter: /.*/, namespace: 'offline-dotenv' }, () => ({ contents: 'export const config=()=>({parsed:{}});export default {config};' }));
      } }],
    });
    // Derive public routes from the actual deployed registry, so future additions
    // also have to reach their authentication checks through the local API.
    const { readFile } = await import('node:fs/promises');
    const deployed = await readFile('api/mail.ts', 'utf8');
    const routes = [...deployed.matchAll(/'([A-Z]+) (auto-mail\/[^']+)':/g)].map(match => [match[1], match[2]]);
    const emailRoutes = [...deployed.matchAll(/'([A-Z]+) (email\/[^']+)':/g)].map(match => [match[1], match[2]]);
    assert.ok(routes.length > 25);
    assert.ok(emailRoutes.length > 10);
    const runner = path.join(directory, 'check.mjs');
    await writeFile(runner, `
      import assert from 'node:assert/strict';
      import crypto from 'node:crypto';
      Object.assign(process.env,{NODE_ENV:'production',SESSION_SECRET:'offline-session',SUPABASE_URL:'https://primary.invalid',SUPABASE_SERVICE_ROLE_KEY:'fake-main',SUPABASE_ANON_KEY:'fake-anon',AUTO_MAIL_ENABLED:'true',AUTO_MAIL_SUPABASE_URL:'https://auto-mail.invalid',AUTO_MAIL_SUPABASE_SERVICE_ROLE_KEY:'fake-auto',AUTO_MAIL_APP_URL:'http://localhost:3000',AUTO_MAIL_AUTO_REPLY_ENABLED:'false',AUTO_MAIL_SCHEDULER_SECRET:'x'.repeat(40)});
      const nativeFetch=globalThis.fetch;let providerCalls=0,writes=0;
      let settings={enabled:false,scope:'ALL',version:1,auto_reply_enabled:false,min_confidence:0.95,max_auto_replies_per_hour:5};
      globalThis.fetch=async(input,init={})=>{
        const url=new URL(String(input));assert.equal(url.hostname,'auto-mail.invalid','No live or main database access');providerCalls++;
        if(url.pathname.endsWith('/incoming_agent_settings'))return new Response(JSON.stringify(settings));
        if(url.pathname.endsWith('/incoming_worker_state'))return new Response(JSON.stringify({last_seen:null,lease_until:null}));
        assert.ok(url.pathname.endsWith('/save_incoming_settings'));const body=JSON.parse(init.body);writes++;assert.equal(body.p_actor,'10000000-0000-4000-8000-000000000001');assert.equal(body.p_auto_reply_enabled,false);
        settings={...settings,version:2};return new Response(JSON.stringify(settings));
      };
      const {default:app}=await import(${JSON.stringify(pathToFileURL(outfile).href)});
      const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
      try{
        const base='http://127.0.0.1:'+server.address().port;
        for(const [method,route] of ${JSON.stringify([...routes, ...emailRoutes])}){
          const response=await nativeFetch(base+'/api/'+route,{method});assert.equal(response.status,401,method+' '+route+' reaches auth, not HTML 404');await response.arrayBuffer();
        }
        assert.equal(providerCalls,0,'Authentication rejects requests before providers');
        const payload=Buffer.from(JSON.stringify({id:'10000000-0000-4000-8000-000000000001',email:'admin@example.test',type:'ADMIN',exp:Date.now()+60000})).toString('base64url');
        const cookie='cargomove_session='+payload+'.'+crypto.createHmac('sha256',process.env.SESSION_SECRET).update(payload).digest('base64url');
        const response=await nativeFetch(base+'/api/auto-mail/incoming-settings?route=auto-mail/compose',{headers:{cookie}});
        assert.equal(response.status,200);const data=await response.json();assert.equal(data.autoReplyReady,true);assert.equal(data.settings.auto_reply_enabled,false);assert.equal(data.autoReplyServerEnabled,false);
        const saved=await nativeFetch(base+'/api/auto-mail/incoming-settings',{method:'POST',headers:{cookie,origin:'http://localhost:3000','content-type':'application/json'},body:JSON.stringify(settings)});
        assert.equal(saved.status,200);assert.equal((await saved.json()).settings.version,2);assert.equal(writes,1);
        console.log('Local Auto Mail route parity and settings load/save passed');
      }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    `);
    const output = execFileSync(process.execPath, [runner], { encoding: 'utf8', timeout: 30000, env: { ...process.env, NODE_ENV: 'production' } });
    assert.match(output, /Local Auto Mail route parity and settings load\/save passed/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
