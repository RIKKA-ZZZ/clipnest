import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Zip, ZipPassThrough, strToU8 } from '../dist/vendor/fflate/browser.js';

export const LOCAL_LIMIT=10*1024**3;
const EXTENSIONS=new Set(['.mp4','.mov','.webm','.mkv','.m4v','.avi','.mpg','.mpeg','.mts']);
const MIME={'.mp4':'video/mp4','.m4v':'video/mp4','.mov':'video/quicktime','.webm':'video/webm','.mkv':'video/x-matroska','.mp3':'audio/mpeg','.wav':'audio/wav','.zip':'application/zip'};
function capture(command,args,timeout=15000){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
    const timer=timeout?setTimeout(()=>{child.kill();reject(new Error('读取媒体信息超时。'));},timeout):null;
    child.stdout.on('data',c=>{stdout+=c.toString('utf8');if(stdout.length>2*1024*1024)child.kill();});
    child.stderr.on('data',c=>{stderr=(stderr+c.toString('utf8')).slice(-12000);});
    child.once('error',e=>{clearTimeout(timer);reject(e);});
    child.once('close',code=>{clearTimeout(timer);code===0?resolve(stdout):reject(new Error(stderr||'本机处理程序未能完成操作。'));});
  });
}
export async function pickWindowsVideo(){
  const script=fileURLToPath(new URL('./select-video.ps1',import.meta.url));
  const result=await capture('powershell.exe',['-NoLogo','-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',script],0);
  const value=JSON.parse(result.replace(/^\uFEFF/,'').trim());return value.cancelled?null:value.path;
}
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
async function readJSON(req){let body='';for await(const c of req){body+=c.toString('utf8');if(body.length>16384)throw new Error('请求内容过大。');}try{return JSON.parse(body);}catch{throw new Error('请求内容无效。');}}
function safeName(value){return String(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/\.+$/,'').slice(0,160)||'clip';}
export function sendFile(req,res,filename,{name,type}={}){
  const stat=fs.statSync(filename),headers={'Content-Type':type||MIME[path.extname(filename).toLowerCase()]||'application/octet-stream','Content-Length':stat.size,'Accept-Ranges':'bytes','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  if(name)headers['Content-Disposition']=`attachment; filename="clip${path.extname(name)}"; filename*=UTF-8''${encodeURIComponent(name).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16))}`;
  let start=0,end=stat.size-1;
  if(req.headers.range){
    const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if(!m||(!m[1]&&!m[2])){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`}).end();return;}
    if(!m[1])start=Math.max(0,stat.size-Number(m[2]));else{start=Number(m[1]);if(m[2])end=Math.min(end,Number(m[2]));}
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=stat.size){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`}).end();return;}
    headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;headers['Content-Length']=end-start+1;
  }
  res.writeHead(req.headers.range?206:200,headers);
  if(req.method==='HEAD'||!stat.size){res.end();return;}
  const stream=fs.createReadStream(filename,{start,end});stream.once('error',()=>res.destroy());res.once('close',()=>stream.destroy());stream.pipe(res);
}
export function createLocalEngine({cacheRoot,ffmpegCommand='ffmpeg',ffprobeCommand='ffprobe',pickFile=pickWindowsVideo,maxInputBytes=LOCAL_LIMIT}={}){
  const token=randomBytes(32).toString('hex'),media=new Map(),jobs=new Map(),root=path.resolve(cacheRoot);
  const executable=c=>spawnSync(c,['-version'],{windowsHide:true,stdio:'ignore',timeout:5000}).status===0;
  const available=executable(ffmpegCommand)&&executable(ffprobeCommand);let pickerPending=false;
  async function register(filename,displayName){
    const stat=await fsp.stat(filename);if(!stat.isFile()||!stat.size)throw new Error('请选择一个非空的视频文件。');
    if(stat.size>maxInputBytes)throw new Error('本机模式单个视频上限为 10 GB。');
    if(!EXTENSIONS.has(path.extname(displayName||filename).toLowerCase()))throw new Error('请选择 MP4、MOV、WebM、MKV 等视频文件。');
    const info=JSON.parse(await capture(ffprobeCommand,['-v','error','-show_entries','format=duration:stream=codec_type,width,height,duration','-of','json',filename]));
    if(!info.streams?.some(s=>s.codec_type==='video'))throw new Error('文件中没有可读取的视频轨道。');
    info.duration=Math.max(0,...[info.format?.duration,...info.streams.map(s=>s.duration)].map(Number).filter(Number.isFinite));
    if(!info.duration)throw new Error('无法读取有效的视频时长。');
    const id=randomUUID(),name=displayName||path.basename(filename);media.set(id,{id,path:filename,name,size:stat.size,info});
    return {nativeId:id,name,size:stat.size,type:MIME[path.extname(name).toLowerCase()]||'video/mp4',url:`/api/media/${id}`,info};
  }
  function check(job){if(job.status==='cancelled')throw new Error('cancelled');}
  function encode(job,args,{start,span,duration}){
    check(job);return new Promise((resolve,reject)=>{
      const child=spawn(ffmpegCommand,['-hide_banner','-loglevel','error','-nostdin','-y','-stats_period','0.25','-progress','pipe:1','-nostats',...args],{windowsHide:true,stdio:['ignore','pipe','pipe']});
      job.child=child;let buffered='',stderr='';
      child.stdout.on('data',c=>{buffered+=c.toString();const lines=buffered.split(/\r?\n/);buffered=lines.pop();for(const line of lines){const m=/^out_time_us=(\d+)$/.exec(line);if(m&&job.status==='running')job.progress=Math.max(job.progress,Math.min(start+span,start+Number(m[1])/1e6/duration*span));}});
      child.stderr.on('data',c=>{stderr=(stderr+c.toString('utf8')).slice(-12000);});child.once('error',reject);
      child.once('close',code=>{job.child=null;if(job.status==='cancelled')reject(new Error('cancelled'));else if(code===0){job.progress=start+span;resolve();}else reject(new Error(stderr||'媒体处理失败，请检查编码和磁盘空间。'));});
    });
  }
  async function bundle(job,readme){
    const filename=path.join(job.directory,'bundle.zip'),out=fs.createWriteStream(filename);let drain=false,failure;
    out.on('error',e=>{failure=e;});const done=once(out,'finish');done.catch(()=>{});
    const zip=new Zip((e,data,final)=>{if(e){failure=e;out.destroy(e);return;}if(data.length&&!out.write(data))drain=true;if(final)out.end();});
    try{
      for(const file of job.files){const entry=new ZipPassThrough(file.name);zip.add(entry);for await(const c of fs.createReadStream(file.path)){check(job);if(failure)throw failure;entry.push(new Uint8Array(c.buffer,c.byteOffset,c.byteLength),false);if(drain){drain=false;await once(out,'drain');}}entry.push(new Uint8Array(),true);}
      check(job);const note=new ZipPassThrough('片段说明.txt');zip.add(note);note.push(strToU8(readme),true);zip.end();await done;if(failure)throw failure;
      job.zip={path:filename,name:`${job.base}_音画分离.zip`};
    }catch(e){zip.terminate();out.destroy();throw e;}
  }
  async function run(job,source,o){
    try{
      await fsp.mkdir(job.directory,{recursive:true});check(job);const hasAudio=source.info.streams.some(s=>s.codec_type==='audio');
      if(o.audio&&!o.video&&!hasAudio)throw new Error('这个视频没有音轨。请勾选“无声视频”导出画面。');
      if(o.audio&&!hasAudio)job.warning='原视频没有音轨，已跳过音频，仅生成无声视频。';
      const span=90/(Number(o.video)+Number(o.audio&&hasAudio)),duration=o.end-o.start,common=['-ss',o.start.toFixed(3),'-i',source.path,'-t',duration.toFixed(3)];let completed=0;
      const add=async(key,name,type,kind)=>{const filename=path.join(job.directory,key);job.files.push({key,path:filename,name,type,kind,size:(await fsp.stat(filename)).size});};
      if(o.video){job.title='正在生成无声视频…';job.detail='从本机磁盘读取素材，进度来自实际已编码时长。';await encode(job,[...common,'-map','0:v:0','-an','-c:v','libx264','-preset','veryfast','-crf','20','-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2','-pix_fmt','yuv420p','-movflags','+faststart','-map_metadata','-1',path.join(job.directory,'clip.mp4')],{start:5,span,duration});check(job);await add('clip.mp4',`${job.base}_无声视频.mp4`,'video/mp4','无声视频');completed++;}
      if(o.audio&&hasAudio){
        job.title='正在提取独立音频…';job.detail=`正在生成 ${o.format.toUpperCase()}，保留选中范围内的混合声音。`;const codec=o.format==='wav'?['-c:a','pcm_s16le']:['-c:a','libmp3lame','-q:a','2'];
        try{await encode(job,[...common,'-map','0:a:0','-vn',...codec,'-map_metadata','-1',path.join(job.directory,`clip.${o.format}`)],{start:5+completed*span,span,duration});check(job);await add(`clip.${o.format}`,`${job.base}_独立音频.${o.format}`,o.format==='wav'?'audio/wav':'audio/mpeg',`${o.format.toUpperCase()} 音频`);}
        catch(e){check(job);if(!job.files.length)throw e;job.warning='无声视频已生成，但音频导出失败，可尝试另一种格式。';}
      }
      check(job);job.title='正在打包你的片段…';job.detail='输出已在本机磁盘生成，打包后可直接下载。';job.progress=95;
      if(job.files.reduce((sum,f)=>sum+f.size,0)<=2*1024**3){try{await bundle(job,`片刻 ClipNest\n原素材：${source.name}\n开始：${o.start} 秒\n结束：${o.end} 秒\n时长：${duration} 秒\n${job.warning||''}\n仅在本机处理，没有云端上传。\n`);}catch(e){check(job);job.warning=(job.warning||'')+' ZIP 打包失败，请分别下载已生成的文件。';}}
      else job.warning=(job.warning||'')+' 输出超过 2 GB，为避免 ZIP 格式大小限制，请分别下载。';
      check(job);job.status='succeeded';job.progress=100;job.title='分离完成';job.detail='可以下载保存你的片段。';job.elapsed=(Date.now()-job.started)/1000;
    }catch(e){if(job.status!=='cancelled'){job.status='failed';job.error=String(e.message||e).replaceAll(source.path,'[本地视频]').replaceAll(job.directory,'[本地输出]');job.title='处理失败';}}
  }
  function status(job){return {id:job.id,status:job.status,progress:job.progress,title:job.title,detail:job.detail,elapsed:job.elapsed??(Date.now()-job.started)/1000,error:job.error||null,warning:job.warning||'',files:job.status==='succeeded'?job.files.map(f=>({name:f.name,type:f.type,kind:f.kind,size:f.size,url:`/api/jobs/${job.id}/files/${f.key}`})):[],zip:job.zip?{name:job.zip.name,url:`/api/jobs/${job.id}/files/bundle.zip`}:null};}
  async function handle(req,res,url){
    if(!url.pathname.startsWith('/api/'))return false;
    const port=req.socket.localPort,allowed=new Set([`http://127.0.0.1:${port}`,`http://localhost:${port}`]);
    if(!allowed.has(`http://${req.headers.host}`)||req.headers['sec-fetch-site']==='cross-site'||(req.headers.origin&&!allowed.has(req.headers.origin))){json(res,403,{error:'只允许本机页面访问。'});return true;}
    if(!['GET','HEAD'].includes(req.method)&&req.headers['x-clipnest-token']!==token){json(res,403,{error:'会话已更新，请刷新页面后重试。'});return true;}
    try{
      if(url.pathname==='/api/capabilities'&&req.method==='GET'){json(res,200,{available,nativePicker:available&&process.platform==='win32',maxInputBytes,token:available?token:null});return true;}
      if(!available){json(res,503,{error:'未检测到本机 FFmpeg，请使用浏览器模式。'});return true;}
      if(url.pathname==='/api/picker'&&req.method==='POST'){
        if(pickerPending){json(res,409,{error:'系统文件窗口已经打开，请先完成选择或取消。'});return true;}
        pickerPending=true;try{const selected=await pickFile();json(res,200,selected?{media:await register(selected)}:{cancelled:true});}finally{pickerPending=false;}return true;
      }
      if(url.pathname==='/api/import'&&req.method==='POST'){
        const length=Number(req.headers['content-length']);if(!Number.isSafeInteger(length)||length<=0||length>maxInputBytes){json(res,413,{error:'请选择不超过 10 GB 的视频文件。'});return true;}
        let name;try{name=decodeURIComponent(req.headers['x-clipnest-filename']||'video.mp4');}catch{throw new Error('文件名无效。');}
        if(!EXTENSIONS.has(path.extname(name).toLowerCase()))throw new Error('请选择视频文件。');
        const uploads=path.join(root,'imports');await fsp.mkdir(uploads,{recursive:true});const filename=path.join(uploads,randomUUID()+path.extname(name).toLowerCase());let received=0;
        try{const counter=new Transform({transform(c,encoding,cb){received+=c.length;if(received>maxInputBytes)cb(new Error('视频超过 10 GB。'));else cb(null,c);}});await pipeline(req,counter,fs.createWriteStream(filename));json(res,201,{media:await register(filename,path.basename(name))});}
        catch(e){await fsp.unlink(filename).catch(()=>{});throw e;}return true;
      }
      const m=/^\/api\/media\/([a-f0-9-]+)$/.exec(url.pathname);
      if(m&&['GET','HEAD'].includes(req.method)){const s=media.get(m[1]);if(!s)json(res,404,{error:'素材已失效，请重新选择。'});else sendFile(req,res,s.path,{type:MIME[path.extname(s.name).toLowerCase()]});return true;}
      if(url.pathname==='/api/jobs'&&req.method==='POST'){
        if([...jobs.values()].some(j=>j.status==='running')){json(res,409,{error:'已有片段正在处理，请完成或取消后重试。'});return true;}
        const o=await readJSON(req),s=media.get(o.mediaId);if(!s)throw new Error('素材已失效，请重新选择。');
        if(typeof o.start!=='number'||typeof o.end!=='number'||!Number.isFinite(o.start)||!Number.isFinite(o.end)||o.start<0||o.end>s.info.duration+.02||o.end-o.start<.039)throw new Error('片段时间范围无效。');
        if(typeof o.video!=='boolean'||typeof o.audio!=='boolean'||(!o.video&&!o.audio)||!['mp3','wav'].includes(o.format))throw new Error('导出设置无效。');
        const id=randomUUID(),job={id,directory:path.join(root,'jobs',id),base:safeName(o.base||'clip'),status:'running',started:Date.now(),progress:3,title:'正在准备本机处理…',detail:'从磁盘读取，不把整个视频塞进浏览器内存。',files:[]};jobs.set(id,job);json(res,202,{id});void run(job,s,o);return true;
      }
      const j=/^\/api\/jobs\/([a-f0-9-]+)(?:\/(cancel|files)(?:\/([^/]+))?)?$/.exec(url.pathname);
      if(j){
        const job=jobs.get(j[1]);if(!job){json(res,404,{error:'处理记录已失效，请重新导出。'});return true;}
        if(!j[2]&&req.method==='GET'){json(res,200,status(job));return true;}
        if(j[2]==='cancel'&&req.method==='POST'){if(job.status==='running'){job.status='cancelled';job.child?.kill();}json(res,200,{cancelled:job.status==='cancelled'});return true;}
        if(j[2]==='files'&&['GET','HEAD'].includes(req.method)&&job.status==='succeeded'){const f=j[3]==='bundle.zip'?job.zip:job.files.find(f=>f.key===j[3]);if(!f)json(res,404,{error:'文件不存在。'});else sendFile(req,res,f.path,{name:f.name,type:f.type});return true;}
      }
      json(res,404,{error:'接口不存在。'});return true;
    }catch(e){if(!res.destroyed&&!res.headersSent)json(res,400,{error:String(e.message||e).slice(0,500)});return true;}
  }
  return {handle,close(){for(const j of jobs.values())if(j.status==='running'){j.status='cancelled';j.child?.kill();}}};
}
