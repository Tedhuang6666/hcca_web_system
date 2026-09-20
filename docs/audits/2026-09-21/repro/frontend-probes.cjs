const fs = require('node:fs');
const http = require('node:http');
const {createRequire} = require('node:module');
const req = createRequire(process.cwd()+'/apps/web/package.json');
const ts = req('typescript');
const {JSDOM} = req('jsdom');
function load(file, stubs={}) {
  const module={exports:{}};
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require','module','exports',code)(name=>name in stubs?stubs[name]:req(name),module,module.exports);
  return module.exports;
}
async function main(){
  const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://audit.local/'});
  global.window=dom.window;global.document=dom.window.document;
  Object.defineProperty(global,'navigator',{value:dom.window.navigator,configurable:true});
  global.Event=dom.window.Event;
  const {renderHook,act,cleanup}=req('@testing-library/react');
  const {useDraftAutosave}=load('apps/web/src/hooks/useDraftAutosave.ts');
  const {cacheCurrentUser,clearAuthCache}=load('apps/web/src/lib/auth-cache.ts',{'./api-cache':load('apps/web/src/lib/api-cache.ts')});
  cacheCurrentUser({id:'audit-user-A'});
  const a=renderHook(()=>useDraftAutosave({key:'documents:new',value:{subject:'A private synthetic draft'},onRestore(){}}));
  act(()=>a.result.current.flushDraft());a.unmount();
  clearAuthCache();cacheCurrentUser({id:'audit-user-B'});
  let restored=null;
  const b=renderHook(()=>useDraftAutosave({key:'documents:new',value:{subject:''},onRestore(v){restored=v;}}));
  console.log('EVIDENCE cross-account draft',JSON.stringify({activeUser:window.localStorage.getItem('user_id'),restored}));
  if(restored?.subject!=='A private synthetic draft')throw new Error('Not reproduced');
  b.unmount();cleanup();

  const privatePage=load('apps/web/src/app/(public)/documents/[id]/page.tsx',{
    '@/lib/branding':{BRANDING:{}}, '@/lib/content-labels':{},
    '@/lib/publicSeoFetch':{fetchPublicDocumentResult:async()=>({data:null,status:404})},
    '@/lib/social-metadata':{}, '@/lib/structured-data':{}, '@/lib/seo':{},
    './DocumentDetailEntry':()=>null,
  });
  let privatePageOutcome;
  try{await privatePage.default({params:Promise.resolve({id:'synthetic-private-id'})});privatePageOutcome='rendered';}
  catch(e){privatePageOutcome=e.digest;}
  console.log('EVIDENCE private document SSR',JSON.stringify({userCached:window.localStorage.getItem('user_id'),anonymousPrefetchStatus:404,outcome:privatePageOutcome}));
  dom.window.close();
  if(privatePageOutcome!=='NEXT_HTTP_ERROR_FALLBACK;404') throw new Error('Private SSR rejection not reproduced');
  delete global.window;delete global.document;
  const sockets=new Set();
  const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.flushHeaders();res.write('{"ok":');});
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const pub=load('apps/web/src/lib/serverFetch.ts',{'next/cache':{unstable_cache:f=>f},'./config':{serverApiUrl:p=>base+p}});
  const transport=load('apps/web/src/lib/api/transport.ts',{'../config':{API_BASE:base},'../auth-cache':{getImpersonationSession:()=>null},'../client-error-reporter':{reportClientError(){}}});
  let publicSettled=false,clientSettled=false,headersReceived=false;
  const started=performance.now();
  const p1=pub.fetchPublicJsonResult('/public').finally(()=>publicSettled=true);
  const p2=transport.fetchWithRetry('/client',{}, {},0).then(({response})=>{headersReceived=true;return response.json();}).catch(()=>{}).finally(()=>clientSettled=true);
  await new Promise(resolve=>setTimeout(resolve,16000));
  console.log('EVIDENCE body timeouts',JSON.stringify({elapsedMs:Math.round(performance.now()-started),headersReceived,publicSettled,clientSettled,configuredPublicMs:5000,configuredClientMs:15000}));
  const bodyTimeoutFailureReproduced=headersReceived&&!publicSettled&&!clientSettled;
  for(const socket of sockets)socket.destroy();
  await new Promise(resolve=>server.close(resolve));await Promise.allSettled([p1,p2]);
  if(!bodyTimeoutFailureReproduced)throw new Error('Body timeout failure not reproduced');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
