import { FFmpeg } from './vendor/ffmpeg/index.js';
import { zipSync, strToU8 } from './vendor/fflate/browser.js';

const $ = (id) => document.getElementById(id);
const ui = Object.fromEntries([...document.querySelectorAll('[id]')].map((el) => [el.id, el]));
const LIMIT = 1024 * 1024 * 1024;
const MIN_CLIP = .04;
const state = {file:null, duration:0, start:0, end:0, busy:false, engine:null, job:0, fileToken:0, sourceURL:null, urls:[], previewing:false, controller:null, phaseStart:0, phaseSpan:0, logs:[]};
Object.assign(state,{native:null,nativeJob:null,capReady:false,picking:false,upload:null,started:0,timer:null,percent:0});

async function localRequest(url,body,signal) {
  const response=await fetch(url,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-ClipNest-Token':state.native?.token||''},body:body===undefined?undefined:JSON.stringify(body),signal});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||'本机处理请求失败，请刷新后重试。');
  return result;
}
async function detectLocalEngine() {
  try{
    if(!['localhost','127.0.0.1','[::1]'].includes(location.hostname))return;
    const response=await fetch('/api/capabilities',{signal:AbortSignal.timeout(2500)});
    if(!response.ok)return;
    const capabilities=await response.json();
    if(capabilities.available){state.native=capabilities;ui.engineStatus.textContent='本机引擎已就绪';ui.fileLimitNote.textContent='MP4 / MOV / WebM / MKV 等 · 本机模式最大 10 GB';}
  }catch{ /* Static hosting keeps the browser-only engine. */ }
  finally{state.capReady=true;updateControls();}
}
function setProgressValue(value) {
  const percent=value==null?null:Math.min(100,Math.max(state.percent,Math.round(value)));
  if(percent!=null)state.percent=percent;
  for(const bar of [ui.progressBar,ui.inlineProgressBar]){if(percent==null)bar.removeAttribute('value');else bar.value=percent;}
  ui.inlineProgressPercent.textContent=percent==null?'处理中…':`${percent}%`;
}
function finishProgress(title,value=state.percent) {
  clearInterval(state.timer);state.timer=null;setProgressValue(value);
  ui.inlineProgressTitle.textContent=title;ui.inlineCancel.hidden=true;
  ui.inlineElapsed.textContent=`已用时 ${Math.max(0,(performance.now()-state.started)/1000).toFixed(1)} 秒`;
}
async function chooseFile() {
  if(state.busy||state.picking)return;
  if(state.native?.nativePicker){
    state.picking=true;updateControls();ui.footerStatus.textContent='系统文件窗口已打开，请选择视频或取消';
    try{const result=await localRequest('/api/picker',{});state.picking=false;if(result.media)await loadFile(result.media);else ui.footerStatus.textContent='已取消选择，可以重新选择视频';}
    catch(error){message(`系统文件窗口未能完成选择：${error.message}。也可以把视频拖入页面。`);}
    finally{state.picking=false;updateControls();}
  }else{
    try{if(typeof ui.fileInput.showPicker==='function')ui.fileInput.showPicker();else ui.fileInput.click();}
    catch{ui.fileInput.click();}
  }
}
function importToLocal(file,token) {
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();state.upload=xhr;
    xhr.open('POST','/api/import');xhr.setRequestHeader('X-ClipNest-Token',state.native.token);xhr.setRequestHeader('X-ClipNest-Filename',encodeURIComponent(file.name));
    xhr.upload.onprogress=event=>{if(token===state.job&&event.lengthComputable)progress('正在准备本机素材…',`已传送 ${size(event.loaded)} / ${size(event.total)} 到这台电脑的处理进程，没有云端上传。`,event.loaded/event.total*4);};
    xhr.onload=()=>{state.upload=null;try{const body=JSON.parse(xhr.responseText);if(xhr.status<200||xhr.status>=300)throw new Error(body.error||'素材准备失败。');resolve(body.media);}catch(error){reject(error);}};
    xhr.onerror=()=>{state.upload=null;reject(new Error('本机连接中断，请检查本地服务是否仍在运行。'));};
    xhr.onabort=()=>{state.upload=null;reject(new DOMException('Cancelled','AbortError'));};xhr.send(file);
  });
}
async function exportOnLocal(token,base,wantVideo,wantAudio,format) {
  const source=state.file.nativeId?state.file:state.nativeSource||await importToLocal(state.file,token);checkJob(token);state.nativeSource=source;
  const response=await localRequest('/api/jobs',{mediaId:source.nativeId,start:state.start,end:state.end,video:wantVideo,audio:wantAudio,format,base});
  if(token!==state.job){await localRequest(`/api/jobs/${response.id}/cancel`,{});checkJob(token);}
  state.nativeJob=response.id;
  try{
    for(;;){
      checkJob(token);const status=await localRequest(`/api/jobs/${response.id}`);checkJob(token);
      progress(status.title,status.detail,status.progress);
      if(status.status==='failed')throw new Error(status.error||'本机处理失败。');
      if(status.status==='cancelled')throw new DOMException('Cancelled','AbortError');
      if(status.status==='succeeded'){renderResults(status.files,status.warning,status.elapsed,base,status.zip);finishProgress('分离完成，可以下载',100);ui.footerStatus.textContent='分离完成，请下载保存你的片段';return;}
      await new Promise(resolve=>setTimeout(resolve,250));
    }
  }finally{if(state.nativeJob===response.id)state.nativeJob=null;}
}

function time(seconds) {
  const ticks = Math.max(0, Math.round((Number(seconds) || 0) * 100));
  const hours = Math.floor(ticks / 360000), mins = Math.floor(ticks / 6000) % 60;
  const secs = (ticks % 6000 / 100).toFixed(2).padStart(5, '0');
  return hours ? `${String(hours).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${secs}` : `${String(mins).padStart(2,'0')}:${secs}`;
}
function parseTime(value) {
  const parts = value.trim().split(':');
  if (!parts.length || parts.length > 3 || parts.some((p,i) => !(i === parts.length - 1 ? /^\d+(\.\d{1,3})?$/ : /^\d+$/).test(p))) return NaN;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n)) || (nums.length > 1 && nums.at(-1) >= 60) || (nums.length === 3 && nums[1] >= 60)) return NaN;
  return nums.reduce((sum,n) => sum * 60 + n, 0);
}
function size(bytes) { return bytes>=1024**3?`${(bytes/1024**3).toFixed(2)} GB`:bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function message(text) { ui.message.textContent = text; ui.message.hidden = !text; }
function objectURL(blob) { const url = URL.createObjectURL(blob); state.urls.push(url); return url; }
function clearResults() { state.urls.forEach((url) => URL.revokeObjectURL(url)); state.urls = []; ui.resultFiles.replaceChildren(); ui.results.hidden = true; }
function updateControls() {
  const ready = !!state.file && state.duration >= MIN_CLIP;
  const outputs = Number(ui.exportVideo.checked) + Number(ui.exportAudio.checked);
  ui.exportButton.disabled = state.busy || state.picking || !ready || !outputs;
  for (const el of [ui.chooseButton, ui.replaceButton, ui.demoButton, ui.fileInput]) el.disabled = state.busy || state.picking || !state.capReady;
  ui.timeFieldset.disabled = state.busy || !ready;
  ui.outputFieldset.disabled = state.busy;
  ui.startRange.disabled = ui.endRange.disabled = state.busy || !ready;
  ui.previewSelection.disabled = state.busy || !ready || ui.video.hidden;
  ui.audioFormat.disabled = state.busy || !ui.exportAudio.checked;
  ui.exportSummary.textContent = !ready ? '选好片段，剩下的交给片刻。' : !outputs ? '请至少选择一种导出内容。' : `导出 ${outputs} 个文件 · 选中 ${time(state.end - state.start)}`;
  ui.audioFormatLabel.textContent = ui.audioFormat.value.toUpperCase();
}
function updateRange({seek=false} = {}) {
  ui.startTime.value = time(state.start); ui.endTime.value = time(state.end);
  ui.startRange.max = ui.endRange.max = state.duration;
  ui.startRange.value = state.start; ui.endRange.value = state.end;
  ui.selectionOverlay.style.left = `${state.start / state.duration * 100}%`;
  ui.selectionOverlay.style.right = `${(1 - state.end / state.duration) * 100}%`;
  ui.selectionDuration.replaceChildren(document.createTextNode('选中时长 '));
  const duration = document.createElement('b'); duration.textContent = time(state.end - state.start); ui.selectionDuration.append(duration);
  updateControls();
  if (seek && !ui.video.hidden) { ui.video.pause(); state.previewing = false; ui.video.currentTime = state.start; }
}
function setBusy(busy) {
  state.busy=busy;
  if(busy){state.started=performance.now();state.percent=0;ui.inlineProcessing.hidden=false;ui.inlineCancel.hidden=false;clearInterval(state.timer);state.timer=setInterval(()=>{ui.inlineElapsed.textContent=`已用时 ${Math.floor((performance.now()-state.started)/1000)} 秒`;},500);}
  else if(state.timer)finishProgress('处理已停止');
  updateControls();
}
function progress(title, detail, value) {
  ui.processing.hidden = false; ui.progressTitle.textContent = title; ui.progressDetail.textContent = detail;
  ui.inlineProcessing.hidden=false;ui.inlineProgressTitle.textContent=title;setProgressValue(value);
  ui.footerStatus.textContent = title;
}
function checkJob(token) { if (token !== state.job) throw new DOMException('Cancelled', 'AbortError'); }

async function engine(token) {
  if (state.engine?.loaded) return state.engine;
  state.controller = new AbortController();
  const signal = state.controller.signal;
  ui.engineStatus.textContent = '引擎加载中';
  progress('正在加载本地处理引擎…', '首次使用需加载约 31 MB。只下载处理工具，你的视频不会上传。', 0);
  let wasmURL;
  const ffmpeg = new FFmpeg(); state.engine = ffmpeg;
  ffmpeg.on('log', ({message:line}) => { state.logs.push(line); if (state.logs.length > 80) state.logs.shift(); });
  ffmpeg.on('progress', ({time:encoded}) => { if (state.busy && state.phaseSpan) setProgressValue(Math.min(98,state.phaseStart+Math.min(1,Math.max(0,encoded/1e6/(state.end-state.start)))*state.phaseSpan)); });
  try {
    const manifestResponse = await fetch(new URL('./vendor/core/chunks.json', import.meta.url), {signal});
    if (!manifestResponse.ok) throw new Error('引擎文件加载失败，请检查网络后重试。');
    const manifest = await manifestResponse.json();
    let loaded = 0;
    const buffers = [];
    for (const chunk of manifest.chunks) {
      const response = await fetch(new URL(`./vendor/core/${chunk.name}`, import.meta.url), {signal});
      if (!response.ok) throw new Error('引擎文件加载失败，请检查网络后重试。');
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength !== chunk.bytes) throw new Error('引擎文件不完整，请刷新页面后重试。');
      if (crypto.subtle) {
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map((b) => b.toString(16).padStart(2,'0')).join('');
        if (hash !== chunk.sha256) throw new Error('引擎校验失败，请刷新页面后重试。');
      }
      buffers.push(buffer); loaded += buffer.byteLength;
      checkJob(token); progress('正在加载本地处理引擎…', `已加载 ${size(loaded)} / ${size(manifest.bytes)}，请稍候。`, loaded / manifest.bytes * 12);
    }
    wasmURL = URL.createObjectURL(new Blob(buffers, {type:'application/wasm'}));
    await ffmpeg.load({coreURL:new URL('./vendor/core/ffmpeg-core.js',import.meta.url).href, wasmURL});
    checkJob(token); ui.engineStatus.textContent = '本地引擎已就绪';
    return ffmpeg;
  } catch (error) {
    try { ffmpeg.terminate(); } catch {}
    if (state.engine === ffmpeg) state.engine = null;
    ui.engineStatus.textContent = '引擎待命'; throw error;
  } finally { if (wasmURL) URL.revokeObjectURL(wasmURL); }
}

async function probe(ffmpeg, name, token) {
  checkJob(token);
  const code = await ffmpeg.ffprobe(['-v','error','-show_entries','format=duration:stream=codec_type,width,height,duration','-of','json','-o','probe.json',name]);
  checkJob(token);
  let raw;
  try { raw = await ffmpeg.readFile('probe.json', 'utf8'); } catch { console.error('ClipNest probe:', code, state.logs.join('\n')); throw new Error('无法读取这个视频。文件可能已损坏，或使用了当前引擎不支持的编码。'); }
  // core@0.12.10 can return -1 after a successful ffprobe (upstream #817).
  // Validate the actual JSON and streams instead of rejecting that status.
  const result = JSON.parse(raw);
  if ((code !== 0 && code !== -1) || !Array.isArray(result.streams) || !result.streams.length) throw new Error('未能读取有效的媒体轨道，请检查文件是否完整。');
  await ffmpeg.deleteFile('probe.json');
  return result;
}
function durationOf(info) {
  return Math.max(0, ...[info.format?.duration, ...(info.streams || []).map((s) => s.duration)].map(Number).filter(Number.isFinite));
}

async function metadata(video) {
  return new Promise((resolve,reject) => {
    const finish = (error) => { clearTimeout(timeout); video.removeEventListener('loadedmetadata',onload); video.removeEventListener('error',onerror); error ? reject(error) : resolve(); };
    const onload = () => finish();
    const onerror = () => finish(new Error('无法预览此视频编码'));
    const timeout = setTimeout(() => finish(new Error('视频预览读取超时')), 12000);
    video.addEventListener('loadedmetadata',onload,{once:true}); video.addEventListener('error',onerror,{once:true}); video.load();
  });
}
async function thumbnails(url, token) {
  const player = document.createElement('video'); player.muted = true; player.preload = 'auto'; player.src = url;
  const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
  const ctx = canvas.getContext('2d');
  try {
    await metadata(player);
    if (token !== state.fileToken) return;
    ui.filmstrip.replaceChildren();
    for (let i=0; i<8; i++) {
      if (token !== state.fileToken) return;
      await new Promise((resolve,reject) => {
        const timeout = setTimeout(() => { player.removeEventListener('seeked',done); reject(new Error('Thumbnail timeout')); },3000);
        const done = () => { clearTimeout(timeout); resolve(); };
        player.addEventListener('seeked',done,{once:true}); player.currentTime = Math.min(player.duration - .025, Math.max(.001, player.duration * (i + .3) / 8));
      });
      if (token !== state.fileToken) return;
      ctx.drawImage(player,0,0,160,90);
      const img = document.createElement('img'); img.alt = ''; img.src = canvas.toDataURL('image/jpeg',.55); ui.filmstrip.append(img);
    }
  } catch { /* Thumbnails are optional; native preview remains usable. */ }
  finally { player.removeAttribute('src'); player.load(); }
}

async function loadFile(file) {
  if (!file || state.busy) return;
  const extension = file.name.split('.').at(-1).toLowerCase();
  if (!file.type.startsWith('video/') && !['mp4','mov','webm','mkv','m4v','avi','mpeg','mpg','mts'].includes(extension)) { message('请选择视频文件，例如 MP4、MOV 或 WebM。'); return; }
  const limit=state.native?.available?state.native.maxInputBytes:LIMIT;
  if (file.size > limit) { message(state.native?.available?'本机模式单文件上限为 10 GB，请先截取或缩小视频。':'浏览器模式单文件上限为 1 GB。更大的视频请在这台电脑上启动本地版，使用本机引擎（最大 10 GB）。'); return; }
  if (!file.size) { message('这个文件是空的，请重新选择视频。'); return; }
  const fileToken = ++state.fileToken;
  const loadJob = ++state.job;
  message(''); clearResults(); state.previewing = false; ui.video.pause();
  state.file = file; state.duration = 0; updateControls();
  state.nativeSource=null;
  if (state.sourceURL?.startsWith('blob:')) URL.revokeObjectURL(state.sourceURL);
  state.sourceURL = file.nativeId?file.url:URL.createObjectURL(file);
  ui.video.src = state.sourceURL; ui.video.hidden = false; ui.emptyState.hidden = true; ui.dropZone.classList.add('loaded');
  ui.projectName.textContent = file.name; ui.previewLabel.hidden = true; ui.replaceButton.hidden = false;
  ui.fileInfo.textContent = `${file.name} · ${size(file.size)}`; ui.dimensions.textContent = '读取中…';
  ui.footerStatus.textContent = '正在读取视频信息…'; ui.filmstrip.replaceChildren();
  setBusy(true);
  try {
    try {
      await metadata(ui.video);
      if (fileToken !== state.fileToken) return;
      state.duration = ui.video.duration;
      ui.dimensions.textContent = `${ui.video.videoWidth} × ${ui.video.videoHeight}`;
    } catch {
      ui.video.hidden = true;
      ui.emptyState.hidden = false;
      ui.emptyState.querySelector('h2').textContent = '该编码暂不支持预览';
      ui.emptyState.querySelector('p').textContent = '正在读取素材，仍可尝试选择时间并导出。';
      const token = state.job;
      let info=file.info;
      if(!info){
        const ffmpeg=await engine(token);
        await ffmpeg.createDir('/source').catch(()=>{});
        await ffmpeg.mount('WORKERFS',{files:[new File([file],'source')]},'/source');
        try{info=await probe(ffmpeg,'/source/source',token);}finally{await ffmpeg.unmount('/source');}
      }
      state.duration = durationOf(info);
      const stream = info.streams?.find((s) => s.codec_type === 'video');
      if (!stream) throw new Error('文件中没有视频轨道，请选择一个视频文件。');
      ui.dimensions.textContent = `${stream.width} × ${stream.height}`;
      message('浏览器无法预览这个视频编码。已读取时长，你仍可以输入起止时间尝试导出。');
    }
    if (!Number.isFinite(state.duration) || state.duration < MIN_CLIP) throw new Error('无法读取有效的视频时长，请选择一个完整的视频文件。');
    state.start = 0; state.end = state.duration;
    ui.ruler.replaceChildren(...Array.from({length:5},(_,i) => {const span=document.createElement('span');span.textContent=time(state.duration*i/4).replace(/\.\d+$/,'');return span;}));
    updateRange(); ui.playhead.style.opacity = '1';
    ui.footerStatus.textContent = '素材已就绪，选择你想留下的片段';
    if (!ui.video.hidden) { ui.emptyState.querySelector('h2').textContent = '把视频放进来'; ui.emptyState.querySelector('p').textContent = '拖拽文件到这里，或从电脑中选择'; void thumbnails(state.sourceURL,fileToken); }
  } catch (error) {
    if (fileToken !== state.fileToken || loadJob !== state.job) return;
    if (error.name !== 'AbortError') message(error.message || '视频读取失败，请更换文件后重试。');
    state.file = null; state.duration = 0; ui.video.hidden = true; ui.emptyState.hidden = false;
    ui.emptyState.querySelector('h2').textContent = '无法读取这个视频'; ui.emptyState.querySelector('p').textContent = '请检查文件是否完整，或更换为 MP4 后重试。';
    ui.footerStatus.textContent = '素材读取失败，请更换文件'; ui.dimensions.textContent = '— × —';
  } finally { if (fileToken === state.fileToken && loadJob === state.job) { ui.processing.hidden = true;setBusy(false);ui.inlineProcessing.hidden=true; ui.fileInput.value = ''; } }
}

function rangeInput(isStart) {
  if (!state.duration || state.busy) return;
  message('');
  if (isStart) state.start = Math.max(0,Math.min(Number(ui.startRange.value),state.end - MIN_CLIP));
  else state.end = Math.min(state.duration,Math.max(Number(ui.endRange.value),state.start + MIN_CLIP));
  updateRange({seek:isStart});
}
function changeTime(isStart) {
  const value = parseTime(isStart ? ui.startTime.value : ui.endTime.value);
  if (!Number.isFinite(value) || value < 0 || value > state.duration || (isStart ? state.end-value : value-state.start) < MIN_CLIP - .001) {
    message(`时间范围无效。请输入 0 至 ${time(state.duration)} 之间的时间，结束须晚于开始至少 0.04 秒。`); updateRange(); return;
  }
  message(''); if (isStart) state.start = value; else state.end = value;
  updateRange({seek:isStart});
}

function filenameBase(name) { return (name.replace(/\.[^.]+$/,'').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/\.+$/,'').slice(0,75) || 'clip') + `_${time(state.start).replace(/:/g,'-')}_${time(state.end).replace(/:/g,'-')}`; }
function renderResults(files, warning, elapsed, base, nativeZip) {
  const total = files.reduce((sum,item) => sum + (item.size??item.data.byteLength),0);
  ui.resultSummary.textContent = `选中 ${time(state.end-state.start)} · ${files.length} 个文件 · ${size(total)} · 处理用时 ${elapsed.toFixed(1)} 秒`;
  ui.resultWarning.textContent = warning; ui.resultWarning.hidden = !warning;
  const zipFiles = {};
  for (const item of files) {
    if(item.data)zipFiles[item.name] = item.data;
    const link = document.createElement('a'); link.href = item.url||objectURL(new Blob([item.data],{type:item.type})); link.download = item.name; link.setAttribute('aria-label',`下载${item.kind}`);
    link.innerHTML = '<svg><use href="#i-download"/></svg>';
    const card = document.createElement('div'); card.className = 'result-file';
    card.innerHTML = `<svg><use href="#${item.type.startsWith('video') ? 'i-film':'i-music'}"/></svg>`;
    const copy = document.createElement('div'), title = document.createElement('strong'), detail = document.createElement('small');
    title.textContent = item.name; title.title = item.name; detail.textContent = `${item.kind} · ${size(item.size??item.data.byteLength)}`;
    copy.append(title,detail);card.append(copy,link);ui.resultFiles.append(card);
  }
  const readme = `片刻 ClipNest\n\n原素材：${state.file.name}\n开始时间：${time(state.start)}\n结束时间：${time(state.end)}\n选中时长：${time(state.end-state.start)}\n\nMP4 为无声视频；MP3/WAV 为原视频选中范围的混合音轨。\n重新编码可能产生不到一帧/一个音频编码帧的时长差。\n${warning}\n\n文件在浏览器本地生成，未上传视频。\n`;
  zipFiles['片段说明.txt'] = strToU8(readme);
  ui.zipDownload.hidden=nativeZip===null;
  if(nativeZip){ui.zipDownload.href=nativeZip.url;ui.zipDownload.download=nativeZip.name;}
  else if(nativeZip!==null){const zip=zipSync(zipFiles,{level:0});ui.zipDownload.href=objectURL(new Blob([zip],{type:'application/zip'}));ui.zipDownload.download=`${base}_音画分离.zip`;}
  ui.results.hidden = false; ui.results.scrollIntoView({behavior:'smooth',block:'nearest'});
}

async function exportClip() {
  if (state.busy || !state.file) return;
  if (ui.startTime.value !== time(state.start) || ui.endTime.value !== time(state.end)) { message('请先确认起止时间，再开始导出。'); return; }
  const wantVideo = ui.exportVideo.checked, wantAudio = ui.exportAudio.checked;
  if (!wantVideo && !wantAudio) { message('请至少选择一种导出内容。'); return; }
  if (state.end-state.start < MIN_CLIP-.001) { message('请先选择至少 0.04 秒的片段。'); return; }
  const token = ++state.job, started = performance.now(), base = filenameBase(state.file.name);
  const duration = state.end-state.start, format = ui.audioFormat.value;
  const tempFiles = ['input','clip.mp4',`clip.${format}`,'probe.json'];
  let ffmpeg,mounted=false;
  clearResults(); message(''); state.previewing = false; ui.video.pause(); setBusy(true); state.phaseSpan = 0;
  progress('正在开始导出…','正在准备选中的片段，请保持页面打开。',0);
  try {
    if(state.native?.available){await exportOnLocal(token,base,wantVideo,wantAudio,format);return;}
    ffmpeg = await engine(token); checkJob(token);
    progress('正在读取本地视频…', '只读挂载素材，避免把整个文件复制到浏览器内存。',13);
    await ffmpeg.createDir('/source').catch(()=>{});
    await ffmpeg.mount('WORKERFS',{files:[new File([state.file],'input')]},'/source');mounted=true;checkJob(token);
    const info = await probe(ffmpeg,'/source/input',token);
    if (!info.streams?.some((s) => s.codec_type === 'video')) throw new Error('文件中没有可读取的视频轨道。');
    const hasAudio = info.streams.some((s) => s.codec_type === 'audio');
    if (wantAudio && !wantVideo && !hasAudio) throw new Error('这个视频没有音轨。请勾选“无声视频”导出画面。');
    const files = [], stepCount = Number(wantVideo) + Number(wantAudio && hasAudio);
    let completed = 0, warning = wantAudio && !hasAudio ? '原视频没有音轨，已跳过音频，仅生成无声视频。' : '';
    const common = ['-ss',state.start.toFixed(3),'-i','/source/input','-t',duration.toFixed(3)];
    if (wantVideo) {
      state.phaseStart = 18; state.phaseSpan = 76 / stepCount;
      progress('正在生成无声视频…', '按选定起止时间重新编码。长片段和 4K 素材可能需要数分钟，请保持页面打开。',state.phaseStart);
      state.logs = [];
      const result = await ffmpeg.exec([...common,'-map','0:v:0','-an','-c:v','libx264','-preset','ultrafast','-crf','20','-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2','-pix_fmt','yuv420p','-movflags','+faststart','-map_metadata','-1','clip.mp4']);
      checkJob(token);
      if (result !== 0) throw new Error('视频导出失败。编码可能不受支持或可用内存不足，请尝试更短片段或更小文件。');
      const data = await ffmpeg.readFile('clip.mp4');
      if (!data.byteLength) throw new Error('视频导出为空，请选择其他时间范围。');
      files.push({name:`${base}_无声视频.mp4`,data,type:'video/mp4',kind:'无声视频'}); completed++;
      await ffmpeg.deleteFile('clip.mp4');
    }
    if (wantAudio && hasAudio) {
      state.phaseStart = 18 + completed * 76 / stepCount; state.phaseSpan = 76 / stepCount;
      progress('正在提取独立音频…', `生成 ${format.toUpperCase()} 音频，保留选中片段中的原始混合声音。`,state.phaseStart);
      state.logs = [];
      const codec = format === 'wav' ? ['-c:a','pcm_s16le'] : ['-c:a','libmp3lame','-q:a','2'];
      const result = await ffmpeg.exec([...common,'-map','0:a:0','-vn',...codec,'-map_metadata','-1',`clip.${format}`]);
      checkJob(token);
      if (result !== 0) { if (!files.length) throw new Error('音频导出失败，当前音频编码可能不受支持。'); warning = '无声视频已生成，但音频导出失败。可尝试改用另一种音频格式。'; }
      else { const data = await ffmpeg.readFile(`clip.${format}`); if (data.byteLength) files.push({name:`${base}_独立音频.${format}`,data,type:format==='wav'?'audio/wav':'audio/mpeg',kind:`${format.toUpperCase()} 音频`}); }
    }
    checkJob(token); state.phaseSpan = 0;
    if (!files.length) throw new Error('没有生成可下载文件。请检查视频内容和选定的时间范围。');
    progress('正在打包你的片段…','文件即将准备好，可以分别下载或打包下载。',97);
    renderResults(files,warning,(performance.now()-started)/1000,base);
    finishProgress('分离完成，可以下载',100);
    ui.footerStatus.textContent = '分离完成，请下载保存你的片段';
  } catch (error) {
    if (token !== state.job || error.name === 'AbortError') return;
    const text = String(error.message || error);
    message(/memory|out of bounds|aborted|allocation/i.test(text) ? '浏览器可用内存不足，处理已停止。请更换更小视频或缩短片段后重试。' : text || '处理失败，请稍后重试。');
    ui.footerStatus.textContent = '处理失败，可以调整后重试';
    finishProgress('导出失败，请调整后重试');
    if (/memory|out of bounds|aborted|allocation/i.test(text)) { try{state.engine?.terminate();}catch{} state.engine = null; ui.engineStatus.textContent = '引擎待命'; }
  } finally {
    if (token === state.job) {
      if (ffmpeg?.loaded) for (const name of tempFiles) { try { await ffmpeg.deleteFile(name); } catch {} }
      if(mounted&&ffmpeg?.loaded){try{await ffmpeg.unmount('/source');}catch{}}
      state.phaseSpan = 0; ui.processing.hidden = true; setBusy(false);
    }
  }
}

for (const button of [ui.chooseButton,ui.replaceButton]) button.addEventListener('click',() => void chooseFile());
ui.fileInput.addEventListener('change',() => void loadFile(ui.fileInput.files[0]));
ui.demoButton.addEventListener('click',async() => {
  if (state.busy) return;
  ui.demoButton.disabled = true; message('');
  try { const response = await fetch(new URL('./demo.mp4',import.meta.url)); if (!response.ok) throw new Error(); const blob = await response.blob(); await loadFile(new File([blob],'落日航行_演示.mp4',{type:'video/mp4'})); }
  catch { message('演示素材加载失败，请直接选择你的视频。'); }
  finally { updateControls(); }
});
let dragDepth = 0;
document.addEventListener('dragover',(event) => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
ui.dropZone.addEventListener('dragenter',(event) => { event.preventDefault(); if (!state.busy && event.dataTransfer?.types.includes('Files')) { dragDepth++;ui.dropOverlay.hidden=false; } });
ui.dropZone.addEventListener('dragleave',() => { dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)ui.dropOverlay.hidden=true; });
ui.dropZone.addEventListener('drop',(event) => { event.preventDefault();dragDepth=0;ui.dropOverlay.hidden=true;if(!state.busy)void loadFile(event.dataTransfer.files[0]); });
ui.startRange.addEventListener('input',() => rangeInput(true)); ui.endRange.addEventListener('input',() => rangeInput(false));
ui.startTime.addEventListener('change',() => changeTime(true)); ui.endTime.addEventListener('change',() => changeTime(false));
for (const input of [ui.startTime,ui.endTime]) input.addEventListener('keydown',(event) => { if (event.key==='Enter') input.blur(); });
ui.markStart.addEventListener('click',() => { if (ui.video.hidden) { message('当前视频无法预览，请手动输入开始时间。'); return; } state.start=Math.min(Math.max(0,ui.video.currentTime),state.end-MIN_CLIP);message('');updateRange(); });
ui.markEnd.addEventListener('click',() => { if (ui.video.hidden) { message('当前视频无法预览，请手动输入结束时间。'); return; } state.end=Math.max(state.start+MIN_CLIP,Math.min(state.duration,ui.video.currentTime));message('');updateRange(); });
ui.previewSelection.addEventListener('click',async() => { ui.video.currentTime=state.start;state.previewing=true;try{await ui.video.play();}catch{state.previewing=false;message('自动播放未开始，请点击视频中的播放按钮。');} });
ui.video.addEventListener('timeupdate',() => { if(state.duration)ui.playhead.style.left=`${Math.min(100,ui.video.currentTime/state.duration*100)}%`;if(state.previewing&&ui.video.currentTime>=state.end-.02){ui.video.pause();state.previewing=false;ui.video.currentTime=state.end;} });
for (const input of [ui.exportVideo,ui.exportAudio,ui.audioFormat]) input.addEventListener('change',updateControls);
ui.exportButton.addEventListener('click',() => void exportClip());
function cancelProcessing(){
  ++state.job;state.controller?.abort();state.upload?.abort();
  if(state.nativeJob){void localRequest(`/api/jobs/${state.nativeJob}/cancel`,{}).catch(error=>message(error.message));state.nativeJob=null;}
  try{state.engine?.terminate();}catch{}state.engine=null;state.phaseSpan=0;
  ui.engineStatus.textContent=state.native?.available?'本机引擎已就绪':'引擎待命';ui.processing.hidden=true;ui.footerStatus.textContent='处理已取消，可以重新选择片段';finishProgress('已取消，可重新导出');setBusy(false);
}
ui.cancelButton.addEventListener('click',cancelProcessing);ui.inlineCancel.addEventListener('click',cancelProcessing);
ui.helpButton.addEventListener('click',() => ui.helpDialog.showModal());
ui.closeHelp.addEventListener('click',() => ui.helpDialog.close());
ui.helpDialog.addEventListener('click',(event) => { if(event.target===ui.helpDialog){const r=ui.helpDialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)ui.helpDialog.close();} });
window.addEventListener('beforeunload',(event) => { if(state.busy){event.preventDefault();event.returnValue='';} });
updateControls();
void detectLocalEngine();
