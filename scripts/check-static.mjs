import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../dist/',import.meta.url));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'vendor/core/chunks.json'),'utf8'));
let bytes=0;
for(const chunk of manifest.chunks){
  const data=fs.readFileSync(path.join(root,'vendor/core',chunk.name));
  assert.equal(data.length,chunk.bytes,`${chunk.name}: byte count`);
  assert.equal(createHash('sha256').update(data).digest('hex'),chunk.sha256,`${chunk.name}: SHA-256`);
  bytes+=data.length;
}
assert.equal(bytes,manifest.bytes);
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const [,relative] of html.matchAll(/(?:href|src)="(\.\/[^"?#]+)"/g)){
  assert.ok(fs.existsSync(path.resolve(root,relative)),`Missing asset: ${relative}`);
}
assert.ok(fs.existsSync(path.join(root,'vendor/ffmpeg/worker.js')));
assert.ok(fs.existsSync(path.join(root,'vendor/ffmpeg/LICENSE')));
assert.ok(fs.existsSync(path.join(root,'vendor/core/LICENSE')));
assert.ok(fs.existsSync(path.join(root,'vendor/fflate/LICENSE')));
function walk(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
  assert.ok(!['.git','.openai','.clipnest-cache'].includes(entry.name),`Private directory in static output: ${entry.name}`);
  const target=path.join(directory,entry.name);
  if(entry.isDirectory())walk(target);else assert.ok(fs.statSync(target).size<100*1024*1024,`Oversized static asset: ${target}`);
}}
walk(root);
console.log(`Static assets verified; ${manifest.chunks.length} engine chunks, ${bytes} bytes; ready for project-path hosting.`);
