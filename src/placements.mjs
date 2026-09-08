export const ZONE_IDS=['hood','door-left','door-right','rear-left','rear-right','front-left','front-right','deck','rear-bumper','front-bumper'];
export function validateGrid(p){
 if(!p||!ZONE_IDS.includes(p.zoneId))throw new Error('Zone inconnue.');
 for(const k of ['col','row','cols','rows'])if(!Number.isInteger(p[k]))throw new Error('Coordonnées invalides.');
 if(p.col<0||p.row<0||p.cols<1||p.rows<1||p.col+p.cols>20||p.row+p.rows>10||![0,90,180,270].includes(p.rotation))throw new Error('Emprise ou rotation invalide.');return p;
}
export function overlap(a,b){return a.zoneId===b.zoneId&&a.col<b.col+b.cols&&a.col+a.cols>b.col&&a.row<b.row+b.rows&&a.row+a.rows>b.row;}
export function mapPlacement(row,vehicleId){
 if(!row||row.vehicle_id!==vehicleId||typeof row.id!=='string'||typeof row.brand!=='string'||!row.brand.trim()||row.brand.length>60||!Number.isSafeInteger(row.amount_cents)||row.amount_cents<0||!Number.isInteger(row.revision)||row.revision<1||!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/.test(row.logo_path)||row.logo_path.split('/')[0]!==row.owner_id)throw new Error('Inventaire partagé invalide.');
 return {...row,placement:validateGrid({zoneId:row.zone_id,col:row.col,row:row.row,cols:row.cols,rows:row.rows,rotation:row.rotation})};
}
export function placementError(e){
 if(e?.code==='23P01')return 'Une autre entreprise occupe cette surface. Déplacez ou réduisez votre logo.';
 if(e?.code==='40001')return 'Cette position a changé dans un autre onglet. Reprenez votre position avant de sauvegarder.';
 if(e?.code==='42501')return 'Action non autorisée. Vérifiez votre connexion ; un placement confirmé ne peut plus être modifié.';
 return e?.message||'Sauvegarde non confirmée. Vérifiez votre connexion et actualisez l’inventaire.';
}
