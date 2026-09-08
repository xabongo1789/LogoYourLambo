/* Injected before CarViewer is constructed. Keep the existing editor and pricing. */
const appConfig=window.HURACAN_CONFIG||{};
let stlAPI=null,stlPanels=null,lastAccepted=null,applyingInventory=false;
const baseUpdate=update,baseBlocked=isBlocked,basePanelPoint=panelPoint;
function inventoryUpdate(fn){const before=applyingInventory;applyingInventory=true;try{return fn();}finally{applyingInventory=before;}}
function surfaceUnavailable(p){return !!stlPanels&&!stlAPI.fitsPanel(stlPanels[p.zoneId],p);}
function loadModule(path){return import(new URL(path,document.baseURI).href);}
function decodeStandaloneSTL(){
 const data=document.getElementById('huracan-stl-data'),profile=document.getElementById('huracan-model-profile');
 if(!data||!profile||!window.HURACAN_STL_API||!window.HURACAN_STL_WORKER_SOURCE)throw new Error('Le HTML local ne contient pas le STL autonome. Relancez npm run build.');
 const encoded=data.textContent.trim();if(!encoded)throw new Error('Le STL embarqué est vide.');
 const binary=atob(encoded),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
 return {buffer:bytes.buffer,profile:JSON.parse(profile.textContent),api:window.HURACAN_STL_API,workerSource:window.HURACAN_STL_WORKER_SOURCE};
}
function createSTLWorker(source){
 if(!source)return new Worker(new URL('assets/stl-worker.mjs',document.baseURI),{type:'module'});
 const objectURL=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
 try{const worker=new Worker(objectURL);worker.huracanObjectURL=objectURL;return worker;}catch(error){URL.revokeObjectURL(objectURL);throw error;}
}
function disposeSTLWorker(worker){if(!worker)return;worker.terminate();if(worker.huracanObjectURL)URL.revokeObjectURL(worker.huracanObjectURL);}
panelPoint=function(z,u,v,offset=.009){const p=stlAPI?.samplePanel(stlPanels?.[z.id],u,v);return p?V.add(p,V.mul(V.norm(V.cross(z.right,z.up)),Math.max(0,offset-.009))):basePanelPoint(z,u,v,offset);};
isBlocked=function(p){return baseBlocked(p)||surfaceUnavailable(p);};
update=function(){
 const key=JSON.stringify(snapshot());
 if(!applyingInventory&&!dragContext&&state.custom&&lastAccepted?.logo===state.logo&&lastAccepted.key!==key&&isBlocked(placement())){
  Object.assign(state,lastAccepted.snapshot);toast('Modification refusée : chevauchement ou sortie de la carrosserie.');
 }
 baseUpdate();
 if(surfaceUnavailable(placement())){$('availability').textContent='Hors carrosserie';$('placement-warning').textContent='Déplacez ou réduisez le logo : il doit rester sur la carrosserie, hors vitres et ouvertures.';}
 if(!isBlocked(placement())&&!dragContext)lastAccepted={key:JSON.stringify(snapshot()),snapshot:snapshot(),logo:state.logo};
 else if(applyingInventory&&isBlocked(placement()))lastAccepted=null;
};
const baseLoad=CarViewer.prototype.load;
CarViewer.prototype.load=async function(url){
 if(typeof url!=='string'||!url.toLowerCase().endsWith('.stl'))return baseLoad.call(this,url);
 let buffer,api,profile,workerSource=null;
 if(window.HURACAN_STANDALONE){({buffer,api,profile,workerSource}=decodeStandaloneSTL());}
 else{
  if(location.protocol==='file:')throw new Error('Ce fichier est le template source. Exécutez npm run build puis ouvrez HURACAN-500-v2.local.html.');
  const [response,module,profileResponse]=await Promise.all([fetch(new URL(url,document.baseURI)),loadModule('assets/stl.mjs'),fetch(new URL('model-profile.json',document.baseURI))]);
  if(!response.ok||!profileResponse.ok)throw new Error('Fichier STL ou profil de calibration indisponible.');
  buffer=await response.arrayBuffer();profile=await profileResponse.json();api=module;
 }
 stlAPI=api;$('loading').lastElementChild.textContent='Préparation du STL et des surfaces…';
 for(const z of ZONES)if(profile.zones?.[z.id])Object.assign(z,profile.zones[z.id]);
 const zones=ZONES.map(z=>({id:z.id,center:[...z.center],right:[...z.right],up:[...z.up],size:[...z.size]}));
 const result=await new Promise((resolve,reject)=>{
  const worker=createSTLWorker(workerSource);this.stlWorker=worker;
  const timer=setTimeout(()=>{disposeSTLWorker(worker);this.stlWorker=null;reject(new Error('Le traitement du STL a expiré.'));},120000);
  const done=()=>{clearTimeout(timer);disposeSTLWorker(worker);this.stlWorker=null;};
  worker.onmessage=({data})=>{done();data.error?reject(new Error(data.error)):resolve(data);};
  worker.onerror=()=>{done();reject(new Error('Impossible de démarrer le worker STL.'));};
  worker.postMessage({buffer,profile,zones,software:this.software},[buffer]);
 });
 if(!this.alive)return;
 stlPanels=result.panels;this.stlMetadata=result.metadata;
 const materials=[{name:'Carrosserie blanche',color:[1,1,1,1],metallic:.12,roughness:.28},{name:'Vitres grises',color:[.27,.29,.32,1],metallic:.35,roughness:.16}];
 const meshes=[];
 try{result.groups.forEach((g,i)=>{if(!g.positions.length)return;const ids=Uint32Array.from({length:g.positions.length/3},(_,j)=>j);meshes.push(this.makeMesh(g.positions,ids,materials[i],g.normals));});}
 catch(e){meshes.forEach(m=>this.disposeMesh(m));throw e;}
 this.meshes.forEach(m=>this.disposeMesh(m));this.meshes=meshes;
 this.panelTriangles=Object.entries(stlPanels).flatMap(([zoneId,panel])=>{
  const triangles=[];
  for(let y=0;y<panel.rows;y++)for(let x=0;x<panel.columns;x++){
   const ids=[y*(panel.columns+1)+x,y*(panel.columns+1)+x+1,(y+1)*(panel.columns+1)+x+1,(y+1)*(panel.columns+1)+x];
   if(ids.some(i=>!panel.valid[i]))continue;
   const uv=[[x/panel.columns,y/panel.rows],[(x+1)/panel.columns,y/panel.rows],[(x+1)/panel.columns,(y+1)/panel.rows],[x/panel.columns,(y+1)/panel.rows]];
   for(const order of [[0,1,2],[0,2,3]])triangles.push({zoneId,points:order.map(i=>Array.from(panel.points.subarray(ids[i]*3,ids[i]*3+3))),uv:order.map(i=>uv[i])});
  }return triangles;
 });
 for(const z of ZONES){const center=api.samplePanel(stlPanels[z.id],.5,.5);if(center)z.center=center;}
 this.draftKey=null;this.dirty=true;
 document.querySelector('.model-note').textContent=window.HURACAN_STANDALONE?'STL du dépôt · mode local autonome':'STL du dépôt · carrosserie blanche · vitres grises';
 if(this.software)toast('Aperçu logiciel allégé. Les positions utilisent le maillage STL complet.');
 this.callbacks.onReady?.();this.rebuildDecals();
};
const basePick=CarViewer.prototype.pick;
CarViewer.prototype.pick=function(x,y){
 if(!stlPanels)return basePick.call(this,x,y);if(!this.vp)return null;
 const ray=this.ray(x,y);let best=null;
 const visible=new Set(ZONES.filter(z=>V.dot(ray.direction,V.norm(V.cross(z.right,z.up)))<-.03).map(z=>z.id));
 for(const tri of this.panelTriangles||[]){
  if(!visible.has(tri.zoneId))continue;
  const [a,b,c]=tri.points,d=ray.direction,o=ray.origin;
  const ex=b[0]-a[0],ey=b[1]-a[1],ez=b[2]-a[2],fx=c[0]-a[0],fy=c[1]-a[1],fz=c[2]-a[2];
  const hx=d[1]*fz-d[2]*fy,hy=d[2]*fx-d[0]*fz,hz=d[0]*fy-d[1]*fx,det=ex*hx+ey*hy+ez*hz;
  if(Math.abs(det)<1e-9)continue;
  const sx=o[0]-a[0],sy=o[1]-a[1],sz=o[2]-a[2],u=(sx*hx+sy*hy+sz*hz)/det;if(u<0||u>1)continue;
  const qx=sy*ez-sz*ey,qy=sz*ex-sx*ez,qz=sx*ey-sy*ex,v=(d[0]*qx+d[1]*qy+d[2]*qz)/det;if(v<0||u+v>1)continue;
  const t=(fx*qx+fy*qy+fz*qz)/det;if(t<=0||(best&&t>=best.t))continue;
  best={zoneId:tri.zoneId,t,point:V.add(o,V.mul(d,t)),uv:[0,1].map(i=>tri.uv[0][i]*(1-u-v)+tri.uv[1][i]*u+tri.uv[2][i]*v)};
 }return best;
};
const logoCache=new Map();
function decalImage(source){
 if(typeof source!=='string')return Promise.resolve(source);
 if(logoCache.has(source))return logoCache.get(source);
 const promise=new Promise((resolve,reject)=>{const image=new Image();image.crossOrigin='anonymous';const timer=setTimeout(()=>reject(new Error('Logo indisponible.')),15000);image.onload=()=>{clearTimeout(timer);resolve(image);};image.onerror=()=>{clearTimeout(timer);reject(new Error('Logo indisponible.'));};image.src=source;});
 logoCache.set(source,promise);promise.catch(()=>logoCache.delete(source));if(logoCache.size>64)logoCache.delete(logoCache.keys().next().value);return promise;
}
CarViewer.prototype.rebuildDecals=async function(){
 if(!stlPanels)return;
 const version=this.decalVersion=(this.decalVersion||0)+1,items=[...(this.sponsors||[])];
 if(this.currentPlacement&&this.logoImage)items.push({placement:this.currentPlacement,logo:this.logoImage,draft:true});
 const images=await Promise.all(items.map(i=>decalImage(i.logo).catch(()=>null)));if(version!==this.decalVersion||!this.alive)return;
 const built=[];
 try{items.forEach((item,i)=>{
  const image=images[i],p=item.placement,z=zoneById(p.zoneId),panel=stlPanels[p.zoneId];if(!image||!z||!panel)return;
  const canvas=document.createElement('canvas'),ratio=(p.cols/20*z.size[0])/(p.rows/10*z.size[1]);
  canvas.width=Math.max(1,Math.round(512*Math.min(1,ratio)));canvas.height=Math.max(1,Math.round(512/Math.max(1,ratio)));
  const ctx=canvas.getContext('2d'),rot=p.rotation%180!==0,scale=Math.min(canvas.width/(rot?image.height:image.width),canvas.height/(rot?image.width:image.height))*.93;
  ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate((p.rotation||0)*Math.PI/180);ctx.drawImage(image,-image.width*scale/2,-image.height*scale/2,image.width*scale,image.height*scale);
  const nx=p.cols*2,ny=p.rows*2,positions=[],uv=[],normals=[],ids=[],valid=[];
  for(let y=0;y<=ny;y++)for(let x=0;x<=nx;x++){const point=stlAPI.samplePanel(panel,(p.col+x/2)/20,(p.row+y/2)/10);valid.push(!!point);positions.push(...(point||[0,0,0]));uv.push(x/nx,y/ny);normals.push(0,1,0);}
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){const a=y*(nx+1)+x,b=a+1,c=a+nx+2,d=a+nx+1;if([a,b,c,d].every(i=>valid[i]))ids.push(a,b,c,a,c,d);}
  if(!ids.length)return;
  const mesh=this.makeMesh(positions,ids,{texture:this.texture(canvas),color:[1,1,1,1],kind:1},normals,uv);mesh.ownTexture=true;mesh.zoneId=p.zoneId;built.push(mesh);
 });}catch(e){built.forEach(m=>this.disposeMesh(m));console.warn('Rendu du logo indisponible.',e);return;}
 if(version!==this.decalVersion||!this.alive){built.forEach(m=>this.disposeMesh(m));return;}
 this.decals.forEach(m=>this.disposeMesh(m));this.decals=built;this.dirty=true;
};
const baseDestroy=CarViewer.prototype.destroy;
CarViewer.prototype.destroy=function(){disposeSTLWorker(this.stlWorker);this.stlWorker=null;this.decalVersion=(this.decalVersion||0)+1;return baseDestroy.call(this);};
