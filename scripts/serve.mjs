import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalEngine, sendFile } from './local-engine.mjs';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.mp4':'video/mp4','.svg':'image/svg+xml','.bin':'application/octet-stream','.txt':'text/plain; charset=utf-8'};
export function createServer(options = {}) {
const engine = createLocalEngine({cacheRoot:fileURLToPath(new URL('../.clipnest-cache/',import.meta.url)),...options});
const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400).end(); return; }
  if (await engine.handle(req,res,url)) return;
  if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
  let target;
  try { target = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname)); } catch { res.writeHead(400).end(); return; }
  if (target !== path.resolve(root) && !target.startsWith(root)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) { res.writeHead(404).end('Not found'); return; }
  sendFile(req,res,target,{type:types[path.extname(target)]});
});
server.on('close',engine.close);
server.requestTimeout=0;
return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port=Number(process.env.CLIPNEST_PORT||4178),server=createServer();
  server.listen(port,'127.0.0.1',()=>process.stdout.write(`Local: http://127.0.0.1:${port}\n`));
}
