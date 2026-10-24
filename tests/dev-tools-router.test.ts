import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createDevToolsRouter} from '../api/dev-tools.js';
function response(){return {code:200,body:null as any,setHeader(){},status(code:number){this.code=code;return this;},json(body:any){this.body=body;return this;}};}
test('consolidated Dev Tools function forwards requests intact to existing handlers and rejects unknown routes',async()=>{
  const seen:string[]=[];
  const routes=['schedulers','run-scheduler','northport-recovery','system-versions','profile','registration-uploads'];
  const handler=createDevToolsRouter(Object.fromEntries(routes.map(route=>[route,(req:any,res:any)=>{assert.equal(req.method,'POST');assert.deepEqual(req.body,{id:'test'});assert.equal(req.headers['x-cargomove-confirm'],'test-confirm');seen.push(route);return res.json({route});}])));
  for(const route of routes){const res=response();await handler({method:'POST',query:{route},body:{id:'test'},headers:{'x-cargomove-confirm':'test-confirm'}},res);assert.equal(res.body.route,route);}
  assert.deepEqual(seen,routes);
  for(const route of [undefined,'__proto__','constructor','unknown',['schedulers','run-scheduler']]){const res=response();await handler({query:{route}},res);assert.equal(res.code,404);}
});
test('production rewrites preserve all existing public Dev Tools URLs with one configured function',()=>{
  const config=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
  for(const route of ['schedulers','run-scheduler','northport-recovery','system-versions','registration-uploads'])assert.ok(config.rewrites.some((r:any)=>r.source===`/api/dev-tools/${route}`&&r.destination===`/api/dev-tools?route=${route}`));
  assert.ok(config.rewrites.some((r:any)=>r.source==='/api/auth/profile'&&r.destination==='/api/dev-tools?route=profile'));
  assert.equal(config.functions['api/dev-tools.ts'].maxDuration,120);
  assert.match(config.functions['api/dev-tools.ts'].includeFiles,/chromium/);
});

test('API entry points stay within the Hobby deployment limit',()=>{
  function entryPoints(directory:URL):string[] {
    return readdirSync(directory,{withFileTypes:true}).flatMap(item=>{
      const path=new URL(item.name+(item.isDirectory()?'/':''),directory);
      if(item.isDirectory())return entryPoints(path);
      if(!/\.[cm]?[jt]sx?$/.test(item.name))return [];
      const source=readFileSync(path,'utf8');
      return /export\s+default\b|export\s*\{\s*default\s*\}/.test(source)?[path.pathname]:[];
    });
  }
  const entries=entryPoints(new URL('../api/',import.meta.url));
  assert.ok(entries.length<=12,`${entries.length} API functions exceed the Hobby limit:\n${entries.join('\n')}`);
  assert.ok(!entries.some(path=>path.endsWith('/auth/profile.ts')),'Profile uses the existing dispatcher instead of a separate function');
});
