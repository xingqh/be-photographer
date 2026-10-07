import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExif, applyExif } from '../lib/photo';
import { sample, reportMarkdown } from '../lib/analysis';
import { parseVisionResponse } from '../lib/vision';
import { readAnalysisResponse } from '../lib/analysis-client';
import { analysisTimeoutMs } from '../lib/providers';
import { POST } from '../app/api/analyze/route';
function exifFixture(le:boolean){
  const data=new Uint8Array(100),v=new DataView(data.buffer);v.setUint16(0,0xffd8);v.setUint16(2,0xffe1);v.setUint16(4,94);
  data.set([69,120,105,102,0,0],6);const base=12;v.setUint16(base,le?0x4949:0x4d4d);v.setUint16(base+2,42,le);v.setUint32(base+4,8,le);
  v.setUint16(base+8,1,le);v.setUint16(base+10,0x8769,le);v.setUint16(base+12,4,le);v.setUint32(base+14,1,le);v.setUint32(base+18,26,le);
  const e=base+26;v.setUint16(e,3,le);
  for(const [i,tag,type,n,val] of [[0,0x8827,3,1,200],[1,0x920a,5,1,70],[2,0xa405,3,1,35]]){
    const p=e+2+i*12;v.setUint16(p,tag,le);v.setUint16(p+2,type,le);v.setUint32(p+4,n,le);if(type===3)v.setUint16(p+8,val,le);else v.setUint32(p+8,val,le);
  }
  v.setUint32(base+70,24,le);v.setUint32(base+74,1,le);return data.buffer;
}
for(const le of [true,false])test(`EXIF reads ${le?'little':'big'} endian settings without GPS`,()=>{assert.deepEqual(parseExif(exifFixture(le)),{camera:undefined,focalLength:24,focalLength35:35,aperture:undefined,exposure:undefined,iso:200});});
test('malformed EXIF and non-JPEG are safe',()=>{for(let n=0;n<100;n++)assert.doesNotThrow(()=>parseExif(exifFixture(true).slice(0,n)));assert.deepEqual(parseExif(new ArrayBuffer(2)),{});});
test('EXIF overrides guessed settings and preserves units',()=>{const result=applyExif(sample,{focalLength:24,aperture:8,exposure:1/125,iso:200});assert.equal(result.focalLength.value,'24 mm · 实际焦距');assert.equal(result.shutter.value,'1/125 s');assert.equal(result.focalLength.confidence,'high');assert.equal(sample.focalLength.confidence,'low');});
test('model response refuses incomplete or malformed outputs',()=>{assert.throws(()=>parseVisionResponse({status:'incomplete'}));assert.throws(()=>parseVisionResponse({output:[{type:'message',content:[{type:'refusal'}]}]}));assert.throws(()=>parseVisionResponse({output:[{type:'message',content:[{type:'output_text',text:'{}'}]}]}));assert.deepEqual(parseVisionResponse({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(sample)}]}]}),sample);});
test('export keeps source, uncertainty, and editing limits',()=>{const text=reportMarkdown(sample,'test.jpg',true);assert.match(text,/人工示例解读/);assert.match(text,/可信程度：较低/);assert.match(text,/无法还原真实后期步骤/);});
const image='data:image/jpeg;base64,/9j/AAAA';const apiKey='sk-test-key-for-unit-test-only';
function request(body:unknown,origin='http://localhost'){return new Request('http://localhost/api/analyze',{method:'POST',headers:{'Content-Type':'application/json','Origin':origin},body:JSON.stringify({provider:'openai',...(body as object)})});}
test('API rejects missing key, remote image URL, and cross-origin without contacting model',async()=>{let calls=0;const old=globalThis.fetch;globalThis.fetch=async()=>{calls++;throw Error('Unexpected model call');};try{assert.equal((await POST(request({image,metadata:{}}))).status,400);assert.equal((await POST(request({image:'https://example.com/private.jpg',apiKey,metadata:{}}))).status,400);assert.equal((await POST(request({image,apiKey,metadata:{}},'https://wrong.example'))).status,403);assert.equal(calls,0);}finally{globalThis.fetch=old;}});
test('API uses fixed model endpoint, disables response storage, and validates metadata',async()=>{const old=globalThis.fetch;let calls=0;globalThis.fetch=async(url,init)=>{calls++;assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(init!.body as string);assert.equal(body.store,false);assert.equal(body.text.format.strict,true);assert.equal(body.input[0].content[1].image_url,image);return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(sample)}]}]});};try{const r=await POST(request({image,apiKey,metadata:{iso:100}}));assert.equal(r.status,200);const p=await r.json() as {analysis:{iso:{value:string}}};assert.equal(p.analysis.iso.value,'ISO 100');assert.equal(r.headers.get('cache-control'),'no-store');assert.equal((await POST(request({image,apiKey,metadata:{gps:[1,2]}}))).status,400);assert.equal(calls,1);}finally{globalThis.fetch=old;}});
test('provider key failure returns actionable message without exposing upstream',async()=>{const old=globalThis.fetch;globalThis.fetch=async()=>new Response('private provider detail',{status:401});try{const r=await POST(request({image,apiKey,metadata:{}}));assert.equal(r.status,401);assert.deepEqual(await r.json(),{error:'OpenAI API Key 无效或已失效，请确认密钥属于所选服务。'});}finally{globalThis.fetch=old;}});
test('API rejects oversized request before contacting model',async()=>{const req=new Request('http://localhost/api/analyze',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':'5000001'},body:'{}'});assert.equal((await POST(req)).status,413);});

const modelResult = {status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(sample)}]}]};
test('DeepSeek uses its own image endpoint with thinking disabled and compatible schema',async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    assert.equal(url,'https://api.deepseek.com/responses');
    const body=JSON.parse(init!.body as string);
    assert.equal(body.model,'deepseek-flash');assert.deepEqual(body.reasoning,{effort:'none'});
    assert.equal(body.store,false);assert.equal(body.text.format.type,'json_schema');
    assert.equal('strict' in body.text.format,false);assert.equal(body.input[0].content[1].image_url,image);
    return Response.json(modelResult);
  };
  try{const result=await POST(request({provider:'deepseek',image,apiKey,metadata:{}}));assert.equal(result.status,200);const body=await result.json() as {model:string;provider:string};assert.equal(body.model,'deepseek-flash');assert.equal(body.provider,'deepseek');}finally{globalThis.fetch=old;}
});
test('missing or untrusted provider is rejected without forwarding a key',async()=>{
  const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('Unexpected call');};
  try{for(const provider of [undefined,'https://example.com','unknown'])assert.equal((await POST(request({provider,image,apiKey,metadata:{}}))).status,400);assert.equal(calls,0);}finally{globalThis.fetch=old;}
});
test('DeepSeek balance and authentication failures stay actionable and private',async()=>{
  const old=globalThis.fetch;
  try{for(const status of [401,402,429]){globalThis.fetch=async()=>new Response('secret upstream details',{status});const result=await POST(request({provider:'deepseek',image,apiKey,metadata:{}}));assert.equal(result.status,status);const body=await result.json() as {error:string};assert.match(body.error,/DeepSeek/);assert.doesNotMatch(body.error,/secret/);if(status===402)assert.match(body.error,/余额不足/);}}finally{globalThis.fetch=old;}
});
test('upstream timeout and user cancellation have distinct results',async()=>{
  const old=globalThis.fetch,oldTimeout=AbortSignal.timeout;
  try{
    AbortSignal.timeout=(ms)=>{assert.equal(ms,analysisTimeoutMs);return AbortSignal.abort(new DOMException('Test deadline','TimeoutError'));};
    globalThis.fetch=async(_url,init)=>{assert.equal(init!.signal!.aborted,true);throw init!.signal!.reason;};
    const timed=await POST(request({provider:'deepseek',image,apiKey,metadata:{}}));assert.equal(timed.status,504);assert.match((await timed.json() as {error:string}).error,/两分钟/);
    AbortSignal.timeout=oldTimeout;
    const controller=new AbortController();controller.abort();
    const req=new Request('http://localhost/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({provider:'deepseek',image,apiKey,metadata:{}})});
    assert.equal((await POST(req)).status,499);
  }finally{globalThis.fetch=old;AbortSignal.timeout=oldTimeout;}
});
test('stream opens before upstream finishes, returns a validated report, and cancels upstream',async()=>{
  const old=globalThis.fetch;
  let finish!:(response:Response)=>void;
  globalThis.fetch=()=>new Promise(resolve=>{finish=resolve;});
  try{
    const req=request({provider:'deepseek',image,apiKey,metadata:{}});req.headers.set('Accept','application/x-ndjson');
    const response=await POST(req);const reader=response.body!.getReader();
    const first=await reader.read();assert.match(new TextDecoder().decode(first.value),/"type":"started"/);
    finish(Response.json(modelResult));
    const last=await reader.read();const result=JSON.parse(new TextDecoder().decode(last.value));assert.equal(result.type,'result');assert.deepEqual(result.analysis,sample);assert.equal((await reader.read()).done,true);
    let modelSignal:AbortSignal|null|undefined;
    globalThis.fetch=async(_url,init)=>{modelSignal=init!.signal;return new Promise((_resolve,reject)=>{modelSignal!.addEventListener('abort',()=>reject(modelSignal!.reason),{once:true});});};
    const next=request({provider:'deepseek',image,apiKey,metadata:{}});next.headers.set('Accept','application/x-ndjson');
    const cancelled=await POST(next);await cancelled.body!.cancel();assert.equal(modelSignal!.aborted,true);
  }finally{globalThis.fetch=old;}
});
test('client reads split UTF-8 reports, progress, provider errors, and broken gateways',async()=>{
  const bytes=new TextEncoder().encode(JSON.stringify({type:'started'})+'\n'+JSON.stringify({type:'progress'})+'\n'+JSON.stringify({type:'result',analysis:sample})+'\n');
  const chunks=new ReadableStream<Uint8Array>({start(controller){for(let i=0;i<bytes.length;i+=7)controller.enqueue(bytes.slice(i,i+7));controller.close();}});
  assert.deepEqual(await readAnalysisResponse(new Response(chunks,{headers:{'Content-Type':'application/x-ndjson'}})),sample);
  await assert.rejects(()=>readAnalysisResponse(new Response('{"type":"result","error":"DeepSeek 余额不足"}\n',{headers:{'Content-Type':'application/x-ndjson'}})),/余额不足/);
  await assert.rejects(()=>readAnalysisResponse(new Response('{"type":"started"}\n',{headers:{'Content-Type':'application/x-ndjson'}})),/连接已中断/);
  await assert.rejects(()=>readAnalysisResponse(new Response('<html>gateway</html>',{status:504,headers:{'Content-Type':'text/html'}})),/分析超时/);
});
