import {readFile,writeFile,mkdir,copyFile,rm} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Buffer} from 'node:buffer';
import vm from 'node:vm';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function replaceOnce(source,needle,replacement){
 const i=source.indexOf(needle);
 if(i<0||source.indexOf(needle,i+needle.length)>=0)throw new Error('Le template a changé : point d’insertion absent ou ambigu.');
 return source.slice(0,i)+replacement+source.slice(i+needle.length);
}
function classicModule(source){
 const output=source.replace(/\bexport\s+(?=(?:const|function|class)\b)/g,'');
 if(/^\s*import\b/m.test(output)||/\bexport\s+/m.test(output))throw new Error('Le module STL contient une syntaxe ESM non compatible avec le mode local autonome.');
 return output;
}
function scriptSafe(source){return source.replaceAll('</script>','<\\/script>');}
function executableScript(attrs=''){
 const type=attrs.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
 return !type||type==='text/javascript'||type==='application/javascript';
}
export function compileStudio(html,studio,cloud,css,{bootstrap='<script src="./config.js"></script>'}={}){
 const embedded=/<script>window\.HURACAN_MODEL_BASE64="[A-Za-z0-9+/=]+";<\/script>/g;
 if([...html.matchAll(embedded)].length!==1)throw new Error('GLB embarqué absent ou ambigu.');
 let output=html.replace(embedded,bootstrap);
 output=replaceOnce(output,"const source=window.HURACAN_MODEL_BASE64?Uint8Array.from(atob(window.HURACAN_MODEL_BASE64),c=>c.charCodeAt(0)).buffer:'assets/spyder-study.glb';viewer.load(source).catch(viewerError);","const source='lambo%2BH.stl';viewer.load(source).catch(viewerError);");
 output=replaceOnce(output,'try{\n viewer=new CarViewer',`${studio}\n${cloud}\ntry{\n viewer=new CarViewer`);
 output=replaceOnce(output,'</head>',`<style>${css}</style></head>`);
 output=output.replace('Le modèle interactif reste une étude originale simplifiée, pas une reproduction exacte de la Huracán ni un gabarit de pose. Le modèle définitif sous licence et la calibration des surfaces restent à prévoir.','Le modèle interactif utilise lambo+H.stl fourni dans le dépôt. Le vitrage est coloré par masques géométriques calibrés ; cet aperçu ne constitue pas un gabarit de pose. Vérifiez les droits sur le modèle et les dimensions avant fabrication.');
 for(const m of output.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g))if(executableScript(m[1]||'')&&m[2].trim())new vm.Script(m[2],{filename:'compiled-studio.html'});
 if(output.includes('window.HURACAN_MODEL_BASE64'))throw new Error('Une référence au GLB subsiste.');
 return output;
}
export function compileStandaloneStudio(html,studio,cloud,css,{config={},model,profile,stlSource,workerSource}){
 const bytes=Buffer.from(model||[]);if(!bytes.length)throw new Error('STL vide.');
 const parsedProfile=JSON.parse(profile),classic=classicModule(stlSource);
 const worker=classic+'\n'+workerSource.replace(/^\s*import[^\n]*\n/,'');
 if(/^\s*import\b/m.test(worker)||/\bexport\s+/m.test(worker))throw new Error('Le worker STL local contient encore une dépendance ESM.');
 const bootstrap=`<script id="huracan-stl-data" type="application/octet-stream">${bytes.toString('base64')}</script>\n<script id="huracan-model-profile" type="application/json">${JSON.stringify(parsedProfile).replaceAll('<','\\u003c')}</script>\n<script>window.HURACAN_CONFIG=Object.freeze(${JSON.stringify(config).replaceAll('<','\\u003c')});window.HURACAN_STANDALONE=true;window.HURACAN_STL_WORKER_SOURCE=${JSON.stringify(worker).replaceAll('<','\\u003c')};\n${scriptSafe(classic)}\nwindow.HURACAN_STL_API=Object.freeze({samplePanel,fitsPanel});</script>`;
 return compileStudio(html,studio,cloud,css,{bootstrap});
}
export function publicConfig(env){
 const url=env.SUPABASE_URL?.trim()||'',key=env.SUPABASE_PUBLISHABLE_KEY?.trim()||'';
 if(!!url!==!!key)throw new Error('Renseignez ensemble l’URL Supabase et la clé publique.');
 if(url){const u=new URL(url);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))throw new Error('Supabase doit utiliser HTTPS.');}
 if(key&&!key.startsWith('sb_publishable_')){
  let role;try{role=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString()).role;}catch{}
  if(role!=='anon'||key.startsWith('sb_secret_'))throw new Error('Clé secrète interdite : utilisez une clé publishable ou anon.');
 }
 const vehicleId=env.HURACAN_VEHICLE_ID||'huracan-stl-v1';
 if(!/^[a-z0-9][a-z0-9_-]{0,99}$/.test(vehicleId))throw new Error('Identifiant de véhicule invalide.');
 return {supabaseUrl:url,supabaseKey:key,vehicleId};
}
export async function build(){
 const env={};try{for(const line of (await readFile(join(root,'.env'),'utf8')).split(/\r?\n/)){const m=line.match(/^\s*(SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY|HURACAN_VEHICLE_ID)\s*=\s*(.*?)\s*$/);if(m)env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}}catch(e){if(e.code!=='ENOENT')throw e;}
 const config=publicConfig({...env,...process.env});
 const [html,studio,cloud,css,model,profile,stlSource,workerSource]=await Promise.all([
  readFile(join(root,'HURACAN-500-v2.html'),'utf8'),readFile(join(root,'src/studio-extension.js'),'utf8'),readFile(join(root,'src/cloud-extension.js'),'utf8'),readFile(join(root,'src/extensions.css'),'utf8'),
  readFile(join(root,'lambo+H.stl')),readFile(join(root,'model-profile.json'),'utf8'),readFile(join(root,'src/stl.mjs'),'utf8'),readFile(join(root,'src/stl-worker.mjs'),'utf8')
 ]);
 const output=compileStudio(html,studio,cloud,css),localOutput=compileStandaloneStudio(html,studio,cloud,css,{config,model,profile,stlSource,workerSource});
 const dist=join(root,'dist');await rm(dist,{recursive:true,force:true});await mkdir(join(dist,'assets'),{recursive:true});
 await Promise.all([writeFile(join(dist,'index.html'),output),writeFile(join(dist,'HURACAN-500-v2.html'),output),writeFile(join(root,'HURACAN-500-v2.local.html'),localOutput),writeFile(join(dist,'config.js'),`window.HURACAN_CONFIG=Object.freeze(${JSON.stringify(config).replaceAll('<','\\u003c')});\n`),copyFile(join(root,'lambo+H.stl'),join(dist,'lambo+H.stl')),copyFile(join(root,'model-profile.json'),join(dist,'model-profile.json')),...['stl.mjs','stl-worker.mjs','placements.mjs'].map(f=>copyFile(join(root,'src',f),join(dist,'assets',f)))]);
 console.log(`Build OK : dist/ + HURACAN-500-v2.local.html ; Supabase ${config.supabaseUrl?'configuré':'non configuré (mode local)'}.`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)build().catch(e=>{console.error(e.message);process.exitCode=1;});
