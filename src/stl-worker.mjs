import {parseSTL,normalizeSTL,splitMaterials,buildPanels} from './stl.mjs';
self.onmessage=({data})=>{
  try{
    const model=normalizeSTL(parseSTL(data.buffer),data.profile);
    const {groups,labels}=splitMaterials(model,data.profile,data.software?Math.max(1,Math.ceil(model.triangleCount/12000)):1);
    const panels=buildPanels(model,data.zones,labels);
    const transfer=groups.flatMap(g=>[g.positions.buffer,g.normals.buffer]);
    for(const p of Object.values(panels))transfer.push(p.points.buffer,p.valid.buffer);
    self.postMessage({groups,panels,metadata:{axes:model.axes,signs:model.signs,size:model.size,triangleCount:model.triangleCount}},transfer);
  }catch(error){self.postMessage({error:error.message||'Impossible de lire le STL.'});}
};
