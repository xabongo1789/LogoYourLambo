import {readFile,writeFile,mkdir,copyFile,rm,stat} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import vm from 'node:vm';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function replaceOnce(source,needle,replacement){
 const i=source.indexOf(needle);
 if(i<0||source.indexOf(needle,i+needle.length)>=0)throw new Error('Le template a changé : point d’insertion absent ou ambigu.');
 return source.slice(0,i)+replacement+source.slice(i+needle.length);
}
export function compileStudio(html,studio,cloud,css){
 const embedded=/<script>window\.HURACAN_MODEL_BASE64="[A-Za-z0-9+/=]+";<\/script>/g;
 if([...html.matchAll(embedded)].length!==1)throw new Error('GLB embarqué absent ou ambigu.');
 let output=html.replace(embedded,'<script src="./config.js"></script>');
 output=replaceOnce(output,"const source=window.HURACAN_MODEL_BASE64?Uint8Array.from(atob(window.HURACAN_MODEL_BASE64),c=>c.charCodeAt(0)).buffer:'assets/spyder-study.glb';viewer.load(source).catch(viewerError);","const source='lambo%2BH.stl';viewer.load(source).catch(viewerError);");
 output=replaceOnce(output,'try{\n viewer=new CarViewer',`${studio}\n${cloud}\ntry{\n viewer=new CarViewer`);
 output=replaceOnce(output,'</head>',`<style>${css}</style></head>`);
 output=output.replace('Le modèle interactif reste une étude originale simplifiée, pas une reproduction exacte de la Huracán ni un gabarit de pose. Le modèle définitif sous licence et la calibration des surfaces restent à prévoir.','Le modèle interactif utilise lambo+H.stl fourni dans le dépôt. Le vitrage est coloré par masques géométriques calibrés ; cet aperçu ne constitue pas un gabarit de pose. Vérifiez les droits sur le modèle et les dimensions avant fabrication.');
 for(const m of output.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(m[1].trim())new vm.Script(m[1],{filename:'dist/index.html'});
 if(output.includes('window.HURACAN_MODEL_BASE64'))throw new Error('Une référence au GLB subsiste.');
 return output;
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
 const [html,studio,cloud,css]=await Promise.all(['HURACAN-500-v2.html','src/studio-extension.js','src/cloud-extension.js','src/extensions.css'].map(f=>readFile(join(root,f),'utf8')));
 const output=compileStudio(html,studio,cloud,css),model=await stat(join(root,'lambo+H.stl'));if(!model.size)throw new Error('STL vide.');
 const dist=join(root,'dist');await rm(dist,{recursive:true,force:true});await mkdir(join(dist,'assets'),{recursive:true});
 await Promise.all([writeFile(join(dist,'index.html'),output),writeFile(join(dist,'HURACAN-500-v2.html'),output),writeFile(join(dist,'config.js'),`window.HURACAN_CONFIG=Object.freeze(${JSON.stringify(config).replaceAll('<','\\u003c')});\n`),copyFile(join(root,'lambo+H.stl'),join(dist,'lambo+H.stl')),copyFile(join(root,'model-profile.json'),join(dist,'model-profile.json')),...['stl.mjs','stl-worker.mjs','placements.mjs'].map(f=>copyFile(join(root,'src',f),join(dist,'assets',f)))]);
 console.log(`Build OK : dist/ ; Supabase ${config.supabaseUrl?'configuré':'non configuré (mode local)'}.`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)build().catch(e=>{console.error(e.message);process.exitCode=1;});
