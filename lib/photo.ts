export type PhotoMetadata = { camera?: string; lens?: string; focalLength?: number; focalLength35?: number; aperture?: number; exposure?: number; iso?: number };
export type PhotoStats = { colors: string[]; histogram: number[]; brightness: number; width: number; height: number };
// Only camera settings are read. GPS, timestamps, and serial numbers are excluded.
export function parseExif(buffer: ArrayBuffer): PhotoMetadata {
  const data=new DataView(buffer); const metadata: PhotoMetadata={};
  try {
    if(data.byteLength<4||data.getUint16(0)!==0xffd8)return metadata;
    let pos=2;
    while(pos+4<=data.byteLength){
      if(data.getUint8(pos)!==0xff)break;
      const marker=data.getUint8(pos+1); if(marker===0xda||marker===0xd9)break;
      if(marker===0x00||marker===0x01||(marker>=0xd0&&marker<=0xd7)){pos+=2;continue;}
      const size=data.getUint16(pos+2);if(size<2||pos+size+2>data.byteLength)break;
      const start=pos+4,end=pos+size+2;
      if(marker===0xe1&&size>14&&data.getUint32(start)===0x45786966&&data.getUint16(start+4)===0){
        const base=start+6;const byteOrder=data.getUint16(base);if(byteOrder!==0x4949&&byteOrder!==0x4d4d)return metadata;
        const le=byteOrder===0x4949;
        const valid=(offset:number,bytes:number)=>offset>=base&&offset+bytes<=end;
        const u16=(o:number)=>{if(!valid(o,2))throw Error('Invalid EXIF');return data.getUint16(o,le);};
        const u32=(o:number)=>{if(!valid(o,4))throw Error('Invalid EXIF');return data.getUint32(o,le);};
        if(u16(base+2)!==42)return metadata;
        const lengths:Record<number,number>={1:1,2:1,3:2,4:4,5:8};
        const readIFD=(offset:number)=>{
          const count=u16(offset);const tags=new Map<number,string|number>();
          if(count>256||!valid(offset+2,count*12+4))return tags;
          for(let i=0;i<count;i++){
            const p=offset+2+i*12,tag=u16(p),type=u16(p+2),n=u32(p+4);const len=(lengths[type]??0)*n;
            if(!len||n>1024)continue;
            const value=len<=4?p+8:base+u32(p+8);if(!valid(value,len))continue;
            if(type===2){let s='';for(let j=0;j<n&&data.getUint8(value+j)!==0;j++)s+=String.fromCharCode(data.getUint8(value+j));tags.set(tag,s.trim());}
            else if(type===3)tags.set(tag,u16(value));
            else if(type===4)tags.set(tag,u32(value));
            else if(type===5){const den=u32(value+4);if(den)tags.set(tag,u32(value)/den);}
          }
          return tags;
        };
        const root=readIFD(base+u32(base+4));
        metadata.camera=[root.get(0x010f),root.get(0x0110)].filter(Boolean).join(' ')||undefined;
        const pointer=root.get(0x8769);
        if(typeof pointer==='number'){
          const tags=readIFD(base+pointer);
          const number=(tag:number)=>{const v=tags.get(tag);return typeof v==='number'&&Number.isFinite(v)&&v>0?v:undefined;};
          metadata.focalLength=number(0x920a);metadata.focalLength35=number(0xa405);metadata.aperture=number(0x829d);metadata.exposure=number(0x829a);metadata.iso=number(0x8827);
          const lens=tags.get(0xa434);if(typeof lens==='string')metadata.lens=lens;
        }
        return metadata;
      }
      pos+=size+2;
    }
  } catch { /* Malformed metadata must not prevent a valid image from opening. */ }
  return metadata;
}
export function shutterLabel(n:number){return n>=1?`${Number(n.toFixed(1))} s`:`1/${Math.round(1/n)} s`;}
export async function preparePhoto(file:File):Promise<{url:string;metadata:PhotoMetadata;stats:PhotoStats}>{
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('请选择 JPG、PNG 或 WebP 照片；RAW 和 HEIC 暂不支持。');
  if(file.size>20*1024*1024)throw Error('照片最大支持 20 MB，请缩小后重试。');
  const metadata=parseExif(await file.arrayBuffer());
  const objectUrl=URL.createObjectURL(file);
  const image=new Image();
  try{
    await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(Error('这张照片无法解码，请检查文件是否损坏，或重新导出为 JPG。'));image.src=objectUrl;});
    const width=image.naturalWidth,height=image.naturalHeight;if(!width||!height)throw Error('无法读取照片尺寸。');
    const scale=Math.min(1,1600/Math.max(width,height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
    const context=canvas.getContext('2d');if(!context)throw Error('浏览器暂不支持照片处理。');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
    const url=canvas.toDataURL('image/jpeg',.88);
    const small=document.createElement('canvas');const sampleScale=Math.min(1,160/Math.max(width,height));small.width=Math.max(1,Math.round(width*sampleScale));small.height=Math.max(1,Math.round(height*sampleScale));const ctx=small.getContext('2d');if(!ctx)throw Error('无法读取图像信息。');ctx.drawImage(canvas,0,0,small.width,small.height);
    const pixels=ctx.getImageData(0,0,small.width,small.height).data;const histogram=Array<number>(32).fill(0);const counts=new Map<string,number>();let total=0;
    for(let i=0;i<pixels.length;i+=4){const r=pixels[i],g=pixels[i+1],b=pixels[i+2];const l=.2126*r+.7152*g+.0722*b;histogram[Math.min(31,Math.floor(l/8))]++;total+=l;const c=[r,g,b].map(v=>Math.min(255,Math.floor(v/32)*32+16).toString(16).padStart(2,'0')).join('');counts.set('#'+c,(counts.get('#'+c)??0)+1);}
    return {url,metadata,stats:{width,height,colors:[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([color])=>color),histogram,brightness:Math.round(total/(pixels.length/4)/255*100)}};
  }finally{URL.revokeObjectURL(objectUrl);}
}
export function applyExif(a:import('./analysis').Analysis,m:PhotoMetadata):import('./analysis').Analysis {
  const recorded=(value:string)=>({value,confidence:'high' as const,evidence:'来自当前文件的 EXIF 记录；元数据可被编辑，仅代表文件记录。'});
  return {...a,
    focalLength:m.focalLength35?recorded(`${m.focalLength35} mm · 35mm 等效`):m.focalLength?recorded(`${m.focalLength} mm · 实际焦距`):a.focalLength,
    aperture:m.aperture?recorded(`f/${Number(m.aperture.toFixed(1))}`):a.aperture,
    shutter:m.exposure?recorded(shutterLabel(m.exposure)):a.shutter,
    iso:m.iso?recorded(`ISO ${m.iso}`):a.iso
  };
}
