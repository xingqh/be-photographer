import { z } from 'zod';
import { parseVisionResponse, visionInstructions, visionJsonSchema } from '@/lib/vision';
import { applyExif } from '@/lib/photo';
import { providers, analysisTimeoutMs } from '@/lib/providers';
const metadataSchema=z.object({camera:z.string().max(200).optional(),lens:z.string().max(200).optional(),focalLength:z.number().positive().max(10000).optional(),focalLength35:z.number().positive().max(10000).optional(),aperture:z.number().positive().max(1000).optional(),exposure:z.number().positive().max(10000).optional(),iso:z.number().positive().max(10000000).optional()}).strict();
const requestSchema=z.object({provider:z.enum(['deepseek','openai']),image:z.string().max(4_500_000).regex(/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/),apiKey:z.string().trim().min(20).max(500).regex(/^sk-[A-Za-z0-9_-]+$/),metadata:metadataSchema}).strict();
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function POST(request:Request){
  const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return response({error:'请求来源不匹配。'},403);
  if(!request.headers.get('content-type')?.includes('application/json'))return response({error:'请使用照片分析入口提交。'},415);
  if(Number(request.headers.get('content-length'))>5_000_000)return response({error:'照片过大，请缩小后重试。'},413);
  let raw:unknown;
  try{
    const reader=request.body?.getReader();if(!reader)return response({error:'未收到照片。'},400);
    const parts:Uint8Array[]=[];let size=0;
    while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>5_000_000){await reader.cancel();return response({error:'照片过大，请缩小后重试。'},413);}parts.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.byteLength;}raw=JSON.parse(new TextDecoder().decode(bytes));
  }catch{return response({error:'请求格式不正确，请重新载入照片。'},400);}
  const parsed=requestSchema.safeParse(raw);if(!parsed.success)return response({error:'请重新选择模型服务，并检查照片格式与 API Key。'},400);
  const {image,apiKey,metadata,provider}=parsed.data;
  const service=providers[provider];
  const cancellation=new AbortController();
  const timeout=AbortSignal.timeout(analysisTimeoutMs);
  const signal=AbortSignal.any([timeout,request.signal,cancellation.signal]);
  async function run(){try{
    const upstream=await fetch(service.endpoint,{method:'POST',headers:{'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json'},signal,body:JSON.stringify({
      model:service.model,store:false,max_output_tokens:5500,instructions:visionInstructions,
      ...(provider==='deepseek'?{reasoning:{effort:'none'}}:{}),
      input:[{role:'user',content:[{type:'input_text',text:`请分析这张摄影作品。文件记录的EXIF（不是作者身份或精确地点）：${JSON.stringify(metadata)}`},{type:'input_image',image_url:image,detail:'high'}]}],
      text:{format:{type:'json_schema',name:'photography_breakdown',...(provider==='openai'?{strict:true}:{}),schema:visionJsonSchema}}
    })});
    if(!upstream.ok){const messages:Record<number,string>={401:`${service.name} API Key 无效或已失效，请确认密钥属于所选服务。`,402:`${service.name} 账户余额不足，请充值后重试。`,403:`${service.name} 账号无法访问该模型，请检查账号权限。`,429:`${service.name} 请求过多或额度不足，请稍后重试。`,400:`${service.name} 未能接收分析请求，请确认模型支持图像并重新导出 JPG。`};await upstream.body?.cancel();return {status:upstream.status>=500?502:upstream.status,body:{error:messages[upstream.status]??`${service.name} 服务暂时不可用，请稍后重试。`}};}
    const analysis=applyExif(parseVisionResponse(await upstream.json()),metadata);
    return {status:200,body:{analysis,model:service.model,provider}};
  }catch(error){const e=error as Error;if(timeout.aborted||e.name==='TimeoutError')return {status:504,body:{error:`${service.name} 分析超过两分钟，照片已保留，请稍后重试。`}};if(signal.aborted)return {status:499,body:{error:'分析已取消，照片已保留。'}};return {status:502,body:{error:e.message.startsWith('模型')?e.message:`无法连接 ${service.name} 或分析响应异常，照片已保留，请检查网络后重试。`}};}}
  if(!request.headers.get('accept')?.includes('application/x-ndjson')){const result=await run();return response(result.body,result.status);}
  // Send headers and a heartbeat immediately so a long model call stays active at the gateway.
  const encoder=new TextEncoder();let heartbeat:ReturnType<typeof setInterval>|undefined;let closed=false;
  const stream=new ReadableStream<Uint8Array>({
    start(controller){
      const send=(body:unknown)=>{if(!closed)controller.enqueue(encoder.encode(JSON.stringify(body)+'\n'));};
      send({type:'started',provider,model:service.model});
      heartbeat=setInterval(()=>send({type:'progress'}),15000);
      void run().then(result=>{if(closed)return;send({type:'result',...result.body,status:result.status});closed=true;clearInterval(heartbeat);controller.close();});
    },
    cancel(){closed=true;clearInterval(heartbeat);cancellation.abort();}
  });
  return new Response(stream,{headers:{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store, no-transform','X-Content-Type-Options':'nosniff'}});
}
