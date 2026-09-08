import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileStandaloneStudio} from '../scripts/build.mjs';

const source="const source=window.HURACAN_MODEL_BASE64?Uint8Array.from(atob(window.HURACAN_MODEL_BASE64),c=>c.charCodeAt(0)).buffer:'assets/spyder-study.glb';viewer.load(source).catch(viewerError);";
const html=`<head></head><body><script>window.HURACAN_MODEL_BASE64="AAAA";</script><script>(()=>{try{\n viewer=new CarViewer();${source}}catch(e){}})();</script></body>`;
const stlSource=`export function parseSTL(){}\nexport function normalizeSTL(){}\nexport function splitMaterials(){}\nexport function buildPanels(){}\nexport function samplePanel(){return null}\nexport function fitsPanel(){return true}`;
const workerSource=`import {parseSTL,normalizeSTL,splitMaterials,buildPanels} from './stl.mjs';\nself.onmessage=()=>{};`;

test('standalone HTML embeds the STL and all local processing code',()=>{
 const out=compileStandaloneStudio(html,'','','',{config:{vehicleId:'huracan-stl-v1'},model:Buffer.from('STL'),profile:'{}',stlSource,workerSource});
 assert.match(out,/id="huracan-stl-data" type="application\/octet-stream">U1RM<\/script>/);
 assert.match(out,/window\.HURACAN_STANDALONE=true/);
 assert.match(out,/window\.HURACAN_STL_WORKER_SOURCE=/);
 assert.match(out,/window\.HURACAN_STL_API=Object\.freeze\(\{samplePanel,fitsPanel\}\)/);
 assert.doesNotMatch(out,/<script src="\.\/config\.js"><\/script>/);
 assert.doesNotMatch(out,/window\.HURACAN_MODEL_BASE64/);
});

test('local STL loader uses an embedded Blob worker instead of rejecting file URLs',async()=>{
 const studio=await readFile(new URL('../src/studio-extension.js',import.meta.url),'utf8');
 assert.match(studio,/if\(window\.HURACAN_STANDALONE\)/);
 assert.match(studio,/new Blob\(\[source\],\{type:'text\/javascript'\}\)/);
 assert.doesNotMatch(studio,/Servez le studio via npm run dev/);
 assert.match(studio,/HURACAN-500-v2\.local\.html/);
});
