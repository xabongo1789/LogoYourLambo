/** STL geometry in a stable, vehicle-local coordinate system: +X front, +Y up.
 * No dependency on rendering, DOM, Supabase, or the indicative price dimensions.
 */
export const MAX_TRIANGLES = 1_000_000;
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const sub = (a,b) => a.map((v,i)=>v-b[i]);
const unit = v => {const n=Math.hypot(...v);return n>1e-12?v.map(x=>x/n):[0,0,0];};

export function parseSTL(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength<15) throw new Error('STL vide ou invalide.');
  const view=new DataView(buffer);
  // Binary STL headers can also begin with "solid"; the exact byte count wins.
  const count=buffer.byteLength>=84?view.getUint32(80,true):0;
  let positions;
  if(count>0 && 84+count*50===buffer.byteLength){
    if(count>MAX_TRIANGLES)throw new Error('STL trop lourd (maximum un million de triangles).');
    positions=new Float32Array(count*9);
    for(let f=0;f<count;f++)for(let j=0;j<9;j++)positions[f*9+j]=view.getFloat32(84+f*50+12+j*4,true);
  } else {
    if(buffer.byteLength>100_000_000)throw new Error('STL trop lourd.');
    const text=new TextDecoder().decode(buffer);
    if(!/^\s*solid\b/i.test(text)||! /endsolid\b/i.test(text))throw new Error('STL binaire tronqué ou STL ASCII invalide.');
    const numbers=[];
    const re=/\bvertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
    for(const m of text.matchAll(re)){
      numbers.push(Number(m[1]),Number(m[2]),Number(m[3]));
      if(numbers.length>MAX_TRIANGLES*9)throw new Error('STL trop lourd.');
    }
    if(!numbers.length||numbers.length%9)throw new Error('Triangles STL incomplets.');
    positions=new Float32Array(numbers);
  }
  if(positions.some(x=>!Number.isFinite(x)))throw new Error('Le STL contient des coordonnées non finies.');
  return positions;
}

export function normalizeSTL(input, options={}) {
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<input.length;i++) {const a=i%3;min[a]=Math.min(min[a],input[i]);max[a]=Math.max(max[a],input[i]);}
  const extent=min.map((v,i)=>max[i]-v);
  if(extent.some(v=>v<=1e-8))throw new Error('Le STL doit contenir un volume 3D non nul.');
  const sorted=[0,1,2].sort((a,b)=>extent[b]-extent[a]);
  const axes=options.axes||[sorted[0],sorted[2],sorted[1]];
  if(axes.length!==3||new Set(axes).size!==3||axes.some(x=>![0,1,2].includes(x)))throw new Error('Axes STL invalides.');
  const front=options.frontSign??1,up=options.upSign??1;
  if(![1,-1].includes(front)||![1,-1].includes(up))throw new Error('Orientation STL invalide.');
  const inversions=axes.reduce((n,a,i)=>n+axes.slice(i+1).filter(b=>a>b).length,0);
  // Preserve handedness, and therefore winding, under axis permutations.
  const signs=[front,up,(inversions%2?-1:1)*front*up];
  const length=4.42,scale=length/extent[axes[0]],size=axes.map(a=>extent[a]*scale);
  const positions=new Float32Array(input.length),normals=new Float32Array(input.length);
  for(let i=0;i<input.length;i+=3)for(let j=0;j<3;j++){
    const a=axes[j],origin=(min[a]+max[a])/2;
    positions[i+j]=(input[i+a]-origin)*signs[j]*scale+(j===1?size[1]/2:0);
  }
  for(let i=0;i<positions.length;i+=9){
    const n=unit(cross(sub(positions.slice(i+3,i+6),positions.slice(i,i+3)),sub(positions.slice(i+6,i+9),positions.slice(i,i+3))));
    normals.set(n,i);normals.set(n,i+3);normals.set(n,i+6);
  }
  return {positions,normals,size,axes,signs,scale,triangleCount:positions.length/9};
}

function inside(point, polygon) {
  let result=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])result=!result;
  }
  return result;
}

/** STL has no dependable named glass/body materials. These normalized geometric
 * masks are deliberately editable in model-profile.json; they are NOT CAD labels.
 * Roof-facing triangles outside the windscreen/rear screen remain white.
 */
export function isGlass(point, normal, size, profile={}) {
  const [x,y,z]=point.map((v,i)=>v/size[i]);
  const lateral=profile.sideWindow||[[-.21,.69],[-.12,.91],[.025,.91],[.15,.66]];
  const windshield=profile.windshield||[[.025,.90],[.15,.66],[.185,.66],[.055,.94]];
  const rear=profile.rearWindow||[[-.27,.67],[-.20,.90],[-.17,.90],[-.23,.67]];
  return (Math.abs(normal[2])>.45 && Math.abs(z)>.24 && inside([x,y],lateral)) ||
    (Math.abs(z)<.38 && Math.abs(normal[1])>.2 && (inside([x,y],windshield)||inside([x,y],rear)));
}

export function splitMaterials(model, profile={}, stride=1) {
  const labels=new Uint8Array(model.triangleCount),counts=[0,0];
  for(let f=0;f<model.triangleCount;f++){
    const i=f*9,p=[0,1,2].map(a=>(model.positions[i+a]+model.positions[i+3+a]+model.positions[i+6+a])/3);
    const label=isGlass(p,model.normals.slice(i,i+3),model.size,profile)?1:0;
    labels[f]=label;if(f%stride===0)counts[label]++;
  }
  const groups=counts.map(n=>({positions:new Float32Array(n*9),normals:new Float32Array(n*9)})),offset=[0,0];
  for(let f=0;f<model.triangleCount;f+=stride){const l=labels[f],i=f*9,o=offset[l];groups[l].positions.set(model.positions.subarray(i,i+9),o);groups[l].normals.set(model.normals.subarray(i,i+9),o);offset[l]+=9;}
  return {groups,labels};
}

/** Projected triangle bins: one index per surface-normal axis. Built in the worker.
 * Queries hit the actual outermost STL triangle, not the old GLB's flat panels.
 */
class ProjectionIndex {
  constructor(model, axis, labels, resolution=64) {
    this.model=model;this.axis=axis;this.labels=labels;this.resolution=resolution;
    this.other=[0,1,2].filter(a=>a!==axis);
    this.bins=Array.from({length:resolution*resolution},()=>[]);
    for(let f=0;f<model.triangleCount;f++){
      const i=f*9,p=model.positions;
      const ranges=this.other.map(a=>{
        const vals=[p[i+a],p[i+3+a],p[i+6+a]];
        return [this.cell(Math.min(...vals),a),this.cell(Math.max(...vals),a)];
      });
      for(let y=ranges[1][0];y<=ranges[1][1];y++)for(let x=ranges[0][0];x<=ranges[0][1];x++)this.bins[y*resolution+x].push(f);
    }
  }
  cell(v,a) {const min=a===1?0:-this.model.size[a]/2;return Math.max(0,Math.min(this.resolution-1,Math.floor((v-min)/this.model.size[a]*this.resolution)));}
  at(point, sign) {
    const [a,b]=this.other,x=point[a],y=point[b],p=this.model.positions;
    const candidates=this.bins[this.cell(y,b)*this.resolution+this.cell(x,a)];
    let best=null,distance=-Infinity;
    for(const f of candidates){
      const i=f*9,ax=p[i+a],ay=p[i+b],bx=p[i+3+a],by=p[i+3+b],cx=p[i+6+a],cy=p[i+6+b];
      const den=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);if(Math.abs(den)<1e-12)continue;
      const u=((by-cy)*(x-cx)+(cx-bx)*(y-cy))/den,v=((cy-ay)*(x-cx)+(ax-cx)*(y-cy))/den,w=1-u-v;
      if(u<-.00001||v<-.00001||w<-.00001)continue;
      const coordinate=p[i+this.axis]*u+p[i+3+this.axis]*v+p[i+6+this.axis]*w;
      if(coordinate*sign<=distance)continue;
      distance=coordinate*sign;
      const n=Array.from(this.model.normals.subarray(i,i+3));if(n[this.axis]*sign<0)for(let k=0;k<3;k++)n[k]*=-1;
      const pos=[...point];pos[this.axis]=coordinate;
      best={point:pos,normal:n,glass:!!this.labels[f]};
    }
    return best;
  }
}

export function buildPanels(model, zones, labels, {columns=40,rows=20}={}) {
  const panels={},indexes=new Map();
  const factor=[model.size[0]/4.42,model.size[1]/1.2,model.size[2]/1.96];
  for(const zone of zones){
    const outward=unit(cross(zone.right,zone.up));
    const axis=[0,1,2].sort((a,b)=>Math.abs(outward[b])-Math.abs(outward[a]))[0],sign=Math.sign(outward[axis]);
    if(!indexes.has(axis))indexes.set(axis,new ProjectionIndex(model,axis,labels));
    const index=indexes.get(axis),points=new Float32Array((columns+1)*(rows+1)*3),valid=new Uint8Array((columns+1)*(rows+1));
    for(let y=0;y<=rows;y++)for(let x=0;x<=columns;x++){
      const id=y*(columns+1)+x;
      const ref=zone.center.map((v,a)=>(v+zone.right[a]*(x/columns-.5)*zone.size[0]+zone.up[a]*(.5-y/rows)*zone.size[1])*factor[a]);
      const hit=index.at(ref,sign);
      // Do not project a decal through a hole, onto glass, or across the vehicle.
      if(!hit||hit.glass||Math.abs(hit.point[axis]-ref[axis])>model.size[axis]*.3||Math.abs(hit.normal[axis])<.15)continue;
      valid[id]=1;points.set(hit.point.map((v,a)=>v+hit.normal[a]*.004),id*3);
    }
    panels[zone.id]={columns,rows,points,valid};
  }
  return panels;
}

export function samplePanel(panel,u,v) {
  if(!panel||u<0||u>1||v<0||v>1)return null;
  const x=Math.min(panel.columns-1,Math.floor(u*panel.columns)),y=Math.min(panel.rows-1,Math.floor(v*panel.rows));
  const tx=u*panel.columns-x,ty=v*panel.rows-y;
  const ids=[y*(panel.columns+1)+x,y*(panel.columns+1)+x+1,(y+1)*(panel.columns+1)+x,(y+1)*(panel.columns+1)+x+1];
  if(ids.some(i=>!panel.valid[i]))return null;
  const weights=[(1-tx)*(1-ty),tx*(1-ty),(1-tx)*ty,tx*ty];
  return [0,1,2].map(a=>ids.reduce((s,id,i)=>s+panel.points[id*3+a]*weights[i],0));
}

/** Every grid cell is subdivided; reject any footprint that straddles a hole or glass. */
export function fitsPanel(panel,p) {
  if(!panel)return false;
  for(let y=0;y<=p.rows*2;y++)for(let x=0;x<=p.cols*2;x++)if(!samplePanel(panel,(p.col+x/2)/20,(p.row+y/2)/10))return false;
  return true;
}
