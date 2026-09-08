import {readFile,writeFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseSTL,normalizeSTL,splitMaterials,buildPanels,fitsPanel} from '../src/stl.mjs';
const b=await readFile(new URL('../lambo+H.stl',import.meta.url));
const profile=JSON.parse(await readFile(new URL('../model-profile.json',import.meta.url),'utf8'));
const html=await readFile(new URL('../HURACAN-500-v2.html',import.meta.url),'utf8');
const zones=vm.runInNewContext(html.match(/const ZONES = Object.freeze\(\[[\s\S]*?\]\);/)[0]+';ZONES');
for(const z of zones)if(profile.zones?.[z.id])Object.assign(z,profile.zones[z.id]);
const model=normalizeSTL(parseSTL(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)),profile);
const {groups,labels}=splitMaterials(model,profile),panels=buildPanels(model,zones,labels);
const report={triangles:model.triangleCount,axes:model.axes,signs:model.signs,size:model.size,whiteTriangles:groups[0].positions.length/9,greyTriangles:groups[1].positions.length/9,panels:Object.fromEntries(Object.entries(panels).map(([id,p])=>[id,{samples:p.valid.reduce((a,b)=>a+b,0),defaultFits:fitsPanel(p,{col:6,row:3,cols:8,rows:4})}]))};
console.log(JSON.stringify(report,null,2));
if(process.argv.includes('--dump')){await writeFile('/mnt/data/model-positions.bin',new Uint8Array(model.positions.buffer));await writeFile('/mnt/data/model-labels.bin',labels);await writeFile('/mnt/data/model-report.json',JSON.stringify(report));}
if(!report.greyTriangles||!report.whiteTriangles)throw new Error('Les deux matériaux doivent être présents.');
if(Object.values(report.panels).some(p=>!p.defaultFits))throw new Error('Une zone ne peut plus recevoir le placement de référence. Recalibrez le profil.');
