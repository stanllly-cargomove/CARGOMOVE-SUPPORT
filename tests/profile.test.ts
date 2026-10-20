import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfileHandler } from '../server-handlers/profile.js';
import { put, del } from '@vercel/blob';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';

const oldUrl = 'https://store.public.blob.vercel-storage.com/avatars/account/profile-old.jpg';
const nextUrl = 'https://store.public.blob.vercel-storage.com/avatars/account/profile-new.jpg';
const response = () => ({ code: 200, body: {} as any, setHeader() {}, status(code: number) { this.code = code; return this; }, json(body: any) { this.body = body; return this; } });
const jpeg = 'data:image/jpeg;base64,' + Buffer.from([255, 216, 255, 224, 0, 0]).toString('base64');

test('profile uploads belong to the session account and save before old photo cleanup', async () => {
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
  const calls: any[] = [];
  let failSave = false;
  const handler = createProfileHandler({
    authorize: async () => ({ session: { id: 'account', email: 'admin@example.test', type: 'ADMIN', exp: Date.now() + 1000 }, client: {} }) as any,
    authClient: () => ({ auth: { admin: {
      getUserById: async (id: string) => { assert.equal(id, 'account'); return { data: { user: { user_metadata: { avatar_url: oldUrl } } } }; },
      updateUserById: async (id: string, value: any) => { calls.push(['save', id, value.user_metadata.avatar_url]); return { error: failSave ? new Error('database failure') : null }; },
    } } }) as any,
    put: async (path: string, bytes: any, options: any) => { calls.push(['put', path]); assert.equal(bytes[0], 255); assert.equal(options.access, 'public'); return { url: nextUrl } as any; },
    del: async (url: any) => { calls.push(['delete', url]); },
  });
  const invoke = async (method: string, body: any = {}, headers: any = {}) => {
    const res = response(); await handler({ method, body, headers: { 'content-type': 'application/json', ...headers } }, res); return res;
  };
  assert.equal((await invoke('GET')).body.avatar_url, oldUrl);
  assert.equal((await invoke('POST', { image: jpeg, id: 'someone-else' })).body.avatar_url, nextUrl);
  assert.deepEqual(calls, [['put', 'avatars/account/profile.jpg'], ['save', 'account', nextUrl], ['delete', oldUrl]]);
  calls.length = 0;
  assert.equal((await invoke('POST', { image: 'data:image/svg+xml;base64,AAA=' })).code, 400);
  assert.equal((await invoke('POST', { image: 'data:image/jpeg;base64,AAAA' })).code, 400);
  assert.equal((await invoke('POST', { image: jpeg }, { 'sec-fetch-site': 'cross-site' })).code, 403);
  assert.deepEqual(calls, []);
  failSave = true;
  assert.equal((await invoke('POST', { image: jpeg })).code, 502);
  assert.deepEqual(calls.at(-1), ['delete', nextUrl], 'Failed saves remove the newly uploaded image');
  assert.ok(!calls.some(call => call[0] === 'delete' && call[1] === oldUrl));
  failSave = false; calls.length = 0;
  assert.equal((await invoke('DELETE')).body.avatar_url, null);
  assert.deepEqual(calls, [['save', 'account', null], ['delete', oldUrl]]);
});

test('profile rejects unauthenticated requests before accessing storage', async () => {
  const handler = createProfileHandler({ authorize: async () => ({ code: 401, message: 'Authentication required.' }) } as any);
  const res = response(); await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.code, 401);
});

test('missing Blob configuration never saves photos in Supabase Storage or changes the profile', async () => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_STORE_ID;
  const fail=()=>{throw new Error('Storage or profile writes must not occur');};
  const client={auth:{admin:{getUserById:async()=>({data:{user:{user_metadata:{avatar_url:oldUrl}}}}),updateUserById:fail}},get storage(){return fail();}};
  const handler=createProfileHandler({authorize:async()=>({session:{id:'account'}}) as any,authClient:()=>client as any,put:fail,del:fail} as any);
  for(const method of ['GET','POST','DELETE']) {
    const res=response();await handler({method,body:{image:jpeg},headers:{'content-type':'application/json'}},res);
    assert.equal(res.code,method==='GET'?200:503);
    if(method==='GET')assert.equal(res.body.avatar_url,oldUrl);
    else assert.match(res.body.error,/Vercel Blob.*BLOB_READ_WRITE_TOKEN/);
  }
});

test('connected Blob store uploads and deletes with SDK-managed OIDC without a read-write token', async t => {
  const names=['BLOB_READ_WRITE_TOKEN','BLOB_STORE_ID','VERCEL_OIDC_TOKEN','VERCEL_BLOB_API_URL','VERCEL_BLOB_RETRIES'] as const;
  const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  t.after(()=>{for(const name of names){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}});
  delete process.env.BLOB_READ_WRITE_TOKEN;
  process.env.BLOB_STORE_ID='store_teststore';
  process.env.VERCEL_BLOB_API_URL='https://blob-offline.test';
  process.env.VERCEL_BLOB_RETRIES='0';
  const jwtPart=(value:object)=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const oidc=jwtPart({alg:'RS256',typ:'JWT'})+'.'+jwtPart({exp:Math.floor(Date.now()/1000)+3600,sub:'offline-test'})+'.offline-signature';
  process.env.VERCEL_OIDC_TOKEN=oidc;
  const calls:string[]=[];
  let currentUrl:string|null=oldUrl;
  // The SDK uses Undici, so intercept its dispatcher and forbid live requests.
  const previousDispatcher=getGlobalDispatcher();
  const network=new MockAgent();network.disableNetConnect();setGlobalDispatcher(network);
  t.after(async()=>{setGlobalDispatcher(previousDispatcher);await network.close();});
  const store=network.get('https://blob-offline.test');
  const headers={authorization:'Bearer '+oidc,'x-vercel-blob-store-id':'teststore'};
  store.intercept({path:/.*/,method:'PUT',headers}).reply(200,()=>{
    calls.push('upload');return {url:nextUrl,downloadUrl:nextUrl+'?download=1',pathname:'avatars/account/profile-new.jpg',contentType:'image/jpeg',contentDisposition:'inline',size:6};
  },{headers:{'content-type':'application/json'}});
  store.intercept({path:'/delete',method:'POST',headers}).reply(200,()=>{calls.push('delete');return {};},{headers:{'content-type':'application/json'}}).persist();
  const handler=createProfileHandler({
    authorize:async()=>({session:{id:'account'}}) as any,
    authClient:()=>({auth:{admin:{
      getUserById:async()=>({data:{user:{user_metadata:{avatar_url:currentUrl}}}}),
      updateUserById:async(id:string,value:any)=>{assert.equal(id,'account');calls.push('save');currentUrl=value.user_metadata.avatar_url;return {error:null};},
    }},get storage(){throw new Error('Supabase Storage must not be used');}}) as any,
    put,del,
  });
  const uploaded=response();await handler({method:'POST',body:{image:jpeg},headers:{'content-type':'application/json'}},uploaded);
  assert.equal(uploaded.code,200);assert.equal(uploaded.body.avatar_url,nextUrl);
  assert.deepEqual(calls,['upload','save','delete']);
  calls.length=0;
  const removed=response();await handler({method:'DELETE',body:{},headers:{'content-type':'application/json'}},removed);
  assert.equal(removed.code,200);assert.equal(removed.body.avatar_url,null);assert.deepEqual(calls,['save','delete']);
});
