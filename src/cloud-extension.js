/* Shared PNGs in Storage; authoritative, revisioned grid positions in PostgreSQL. */
const cloudEnabled=!!(appConfig.supabaseUrl&&appConfig.supabaseKey),vehicleId=appConfig.vehicleId||'huracan-stl-v1';
const cloud={client:null,user:null,rows:[],own:null,editId:null,editRevision:0,fresh:false,busy:false,sequence:0,channel:null,auth:null};
let placementAPI=null,restoredPlacement=null,restoredKey=null;
const localPlacement=placement,localRefresh=refreshPartners,localRemove=removeLogo;
placement=function(){return restoredPlacement&&restoredKey===JSON.stringify(snapshot())?{...restoredPlacement}:localPlacement();};
const cloudPanel=document.createElement('section');cloudPanel.className='cloud-panel';
cloudPanel.innerHTML=`<h3>Positions des entreprises</h3><p id="cloud-status" role="status" aria-live="polite"></p>
<form id="cloud-login" hidden><label for="cloud-email">Votre email professionnel</label><input id="cloud-email" type="email" required maxlength="254" autocomplete="email" placeholder="vous@entreprise.fr"><button class="cloud-action" type="submit">Recevoir un lien de connexion</button></form>
<div id="cloud-account" hidden><p id="cloud-user"></p><div class="cloud-actions"><button id="cloud-load" type="button" class="cloud-action">Reprendre ma position</button><button id="cloud-delete" type="button" class="cloud-action">Supprimer ma position</button><button id="cloud-signout" type="button" class="quiet-button">Déconnexion</button></div></div>
<p class="cloud-note">Une position enregistrée est publique. Elle bloque techniquement les cellules, sans constituer un paiement ni un accord commercial.</p>`;
document.querySelector('.config-panel').append(cloudPanel);
function cloudStatus(text){$('cloud-status').textContent=text;}
function resetEdit(){cloud.editId=null;cloud.editRevision=0;restoredPlacement=null;restoredKey=null;lastAccepted=null;}
function accountUI(){
 $('cloud-login').hidden=!cloudEnabled||!!cloud.user;$('cloud-account').hidden=!cloud.user;
 $('cloud-user').textContent=cloud.user?`Connecté : ${cloud.user.email||'compte vérifié'}`:'';
 const locked=cloud.own&&(cloud.own.approval_status==='approved'||cloud.own.payment_status==='paid');
 $('cloud-load').disabled=!cloud.own||!!locked||cloud.busy;$('cloud-delete').disabled=!cloud.own||!!locked||cloud.busy;$('cloud-signout').disabled=cloud.busy;
 if(cloudEnabled){const email=$('proposal-form').elements.email;email.value=cloud.user?.email||'';email.readOnly=true;email.required=false;email.closest('label').hidden=true;}
}
function renderInventory(){
 cloud.own=cloud.rows.find(r=>r.owner_id===cloud.user?.id)||null;
 const shown=cloud.rows.filter(r=>r.id!==cloud.editId),confirmed=cloud.rows.filter(r=>r.approval_status==='approved'&&r.payment_status==='paid');
 inventoryUpdate(()=>{state.occupied=shown.map(r=>r.placement);state.sponsors=confirmed.map(r=>({placement:r.placement,brand:r.brand,logo:r.logo,amountCents:r.amount_cents}));viewer?.setSponsors(shown);update();});
 const total=confirmed.reduce((s,r)=>s+r.amount_cents,0);
 $('collected').textContent=euro(total/100);$('progress-fill').style.width=`${Math.min(100,total/GOAL_CENTS*100)}%`;$('funding-progress').setAttribute('aria-valuenow',String(Math.min(GOAL_CENTS,total)/100));$('nav-count').textContent=String(cloud.rows.length);
 const grid=$('partner-grid');grid.replaceChildren();grid.classList.toggle('has-partners',cloud.rows.length>0);
 if(!cloud.rows.length){const p=document.createElement('p');p.className='empty-partners';p.textContent='Aucune position partagée pour le moment.';grid.append(p);}
 for(const r of cloud.rows){const card=document.createElement('article');card.className='partner-card';const img=document.createElement('img');img.crossOrigin='anonymous';img.src=r.logo;img.alt=`Logo ${r.brand}`;img.loading='lazy';const name=document.createElement('strong');name.textContent=r.brand;const note=document.createElement('span');note.textContent=r.approval_status==='approved'&&r.payment_status==='paid'?'Confirmé & payé':'Position enregistrée · non confirmée';card.append(img,name,note);grid.append(card);}
 accountUI();
}
cloudStatus(cloudEnabled?'Chargement de l’inventaire partagé…':'Mode local : Supabase non configuré. Aucune position n’est partagée.');accountUI();
const cloudReady=(async()=>{
 if(!cloudEnabled)return;
 try{
  const [{createClient},api]=await Promise.all([import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm'),loadModule('assets/placements.mjs')]);placementAPI=api;
  cloud.client=createClient(appConfig.supabaseUrl,appConfig.supabaseKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce'}});
  const {data,error}=await cloud.client.auth.getUser();if(!error)cloud.user=data.user;
  const listener=cloud.client.auth.onAuthStateChange((_event,session)=>{const changed=cloud.user?.id!==session?.user?.id;cloud.user=session?.user||null;if(changed)resetEdit();accountUI();setTimeout(()=>refreshPartners(),0);});cloud.auth=listener.data.subscription;
  cloud.channel=cloud.client.channel(`logos:${vehicleId}`).on('postgres_changes',{event:'*',schema:'public',table:'logo_placements'},()=>refreshPartners()).subscribe();accountUI();
 }catch{cloudStatus('Connexion Supabase impossible. Prévisualisation disponible, sauvegarde partagée indisponible.');}
})();
refreshPartners=async function(){
 if(!cloudEnabled)return localRefresh();await cloudReady;if(!cloud.client||!placementAPI)return false;
 const sequence=++cloud.sequence;
 try{
  const {data,error}=await cloud.client.rpc('list_logo_placements',{p_vehicle_id:vehicleId});if(error)throw error;if(!Array.isArray(data))throw new Error('Inventaire invalide.');
  const rows=data.map(r=>placementAPI.mapPlacement(r,vehicleId)).map(r=>({...r,logo:cloud.client.storage.from('company-logos').getPublicUrl(r.logo_path).data.publicUrl}));
  if(sequence!==cloud.sequence)return false;cloud.rows=rows;cloud.fresh=true;renderInventory();cloudStatus(`${rows.length} position(s) partagée(s) · inventaire actualisé.`);return true;
 }catch{if(sequence===cloud.sequence){cloud.fresh=false;cloudStatus('Inventaire indisponible. Les dernières positions restent affichées ; sauvegarde suspendue.');}return false;}
};
$('cloud-login').addEventListener('submit',async event=>{
 event.preventDefault();if(!$('cloud-login').reportValidity())return;await cloudReady;if(!cloud.client)return;
 const button=$('cloud-login').querySelector('button');button.disabled=true;
 try{const {error}=await cloud.client.auth.signInWithOtp({email:$('cloud-email').value.trim(),options:{emailRedirectTo:new URL(location.pathname,location.origin).href}});if(error)throw error;cloudStatus('Lien envoyé. Ouvrez-le dans ce navigateur puis importez votre logo ou reprenez votre position.');}
 catch{cloudStatus('Envoi impossible. Vérifiez votre adresse, la configuration Auth et réessayez.');}finally{button.disabled=false;}
});
$('cloud-signout').addEventListener('click',async()=>{try{const {error}=await cloud.client.auth.signOut();if(error)throw error;cloud.user=null;resetEdit();renderInventory();}catch{cloudStatus('Déconnexion impossible. Réessayez.');}});
$('cloud-load').addEventListener('click',async()=>{
 const own=cloud.own;if(!own||cloud.busy)return;cloud.busy=true;accountUI();
 try{const image=await decalImage(own.logo);if(!image.width||!image.height||image.width>16000||image.height>16000)throw new Error('Dimensions du logo invalides.');
  const canvas=document.createElement('canvas'),scale=Math.min(1,1000/image.width,1000/image.height);canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
  cloud.editId=own.id;cloud.editRevision=own.revision;lastAccepted=null;
  inventoryUpdate(()=>{installLogo(canvas,own.brand);const p=own.placement;state.zoneId=p.zoneId;state.center=[(p.col+p.cols/2)/20,(p.row+p.rows/2)/10];state.cols=p.cols;state.rotation=p.rotation;restoredPlacement={...p};restoredKey=JSON.stringify(snapshot());renderInventory();});
  viewer?.setCamera(adaptCamera(zoneById(own.placement.zoneId).camera));toast('Position chargée. Enregistrez pour partager vos modifications.');
 }catch(e){cloudStatus(e.message||'Chargement du logo impossible.');}finally{cloud.busy=false;accountUI();}
});
removeLogo=function(){resetEdit();localRemove();if(cloudEnabled&&cloud.client)renderInventory();};
function formError(text){$('form-error').textContent=text;$('form-error').hidden=false;}
function asPNG(canvas){return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Préparation du PNG impossible.')),'image/png'));}
async function cleanupPNG(path){if(!path)return;try{await cloud.client.storage.from('company-logos').remove([path]);}catch{/* Best effort: referenced objects are protected by Storage policy. */}}
$('proposal-form').addEventListener('submit',async event=>{
 if(!cloudEnabled)return;event.preventDefault();event.stopImmediatePropagation();
 if(cloud.busy||!event.currentTarget.reportValidity())return;
 cloud.busy=true;accountUI();$('save-proposal').disabled=true;$('form-error').hidden=true;
 let uploaded=null,committed=false;
 try{
  await cloudReady;if(!cloud.client||!cloud.user)throw new Error('Connectez-vous par email dans le panneau « Positions des entreprises ».');
  if(!ready||!stlPanels)throw new Error('Attendez le chargement du STL. Aucune position ne peut être partagée sans validation de la surface.');
  if(!cloud.fresh){await refreshPartners();if(!cloud.fresh)throw new Error('Inventaire indisponible. Votre logo n’a pas été partagé.');}
  if(cloud.own&&cloud.editId!==cloud.own.id)throw new Error('Vous avez déjà une position. Fermez cette fenêtre et choisissez « Reprendre ma position ».');
  const form=new FormData($('proposal-form')),brand=String(form.get('brand')||'').trim();if(!brand||brand.length>60||form.get('rights')!=='on')throw new Error('Vérifiez la marque et confirmez vos droits sur le logo.');
  const p={...placement()},logo=state.logo,expected=cloud.editId?cloud.editRevision:0,oldPath=cloud.own?.logo_path,uid=cloud.user.id;
  placementAPI.validateGrid(p);if(!state.custom||isBlocked(p))throw new Error('Déplacez le logo sur une surface de carrosserie libre.');
  const {data:auth,error:authError}=await cloud.client.auth.getUser();if(authError||auth.user?.id!==uid)throw new Error('Connexion expirée. Reconnectez-vous.');
  const blob=await asPNG(logo);if(blob.size>2097152)throw new Error('Le logo PNG dépasse 2 Mo.');uploaded=`${uid}/${crypto.randomUUID()}.png`;
  const {error:uploadError}=await cloud.client.storage.from('company-logos').upload(uploaded,blob,{contentType:'image/png',cacheControl:'3600',upsert:false});if(uploadError)throw uploadError;
  const {data,error}=await cloud.client.rpc('save_logo_placement',{p_vehicle_id:vehicleId,p_brand:brand,p_logo_path:uploaded,p_zone_id:p.zoneId,p_col:p.col,p_row:p.row,p_cols:p.cols,p_rows:p.rows,p_rotation:p.rotation,p_expected_revision:expected});if(error)throw error;
  const saved=Array.isArray(data)?data[0]:data;if(!saved?.id)throw new Error('Réponse inattendue. Actualisez pour vérifier votre position.');
  committed=true;cloud.editId=saved.id;cloud.editRevision=saved.revision;
  state.proposal={id:saved.id,version:3,status:'shared_pending',createdAt:saved.created_at,vehicleId,brand,placement:p,quote:quote(p),logoPath:uploaded,rightsConfirmed:true,note:'Position partagée, non approuvée, non payée. Conditions et gabarit à valider.'};
  $('success-note').textContent='Logo et position enregistrés dans Supabase et visibles par les autres entreprises. Aucun paiement ni accord commercial n’a été déclenché.';$('proposal-form').hidden=true;$('proposal-success').hidden=false;
  await refreshPartners();if(oldPath&&oldPath!==uploaded)await cleanupPNG(oldPath);
 }catch(e){if(uploaded&&!committed)await cleanupPNG(uploaded);formError(placementAPI?placementAPI.placementError(e):e.message);if(cloud.client)await refreshPartners();}
 finally{cloud.busy=false;$('save-proposal').disabled=false;accountUI();}
},true);
$('cloud-delete').addEventListener('click',async()=>{
 const own=cloud.own;if(!own||cloud.busy||!confirm('Supprimer votre position partagée et libérer sa surface ?'))return;cloud.busy=true;accountUI();
 try{const {data:path,error}=await cloud.client.rpc('delete_logo_placement',{p_id:own.id,p_expected_revision:own.revision});if(error)throw error;resetEdit();await cleanupPNG(path);await refreshPartners();toast('Position supprimée, surface libérée.');}
 catch(e){await refreshPartners();cloudStatus(placementAPI.placementError(e));}finally{cloud.busy=false;accountUI();}
});
if(cloudEnabled){
 $('save-proposal').textContent='Enregistrer la position partagée ↗';$('proposal-form').querySelector('.local-note').textContent='Après connexion et enregistrement, votre marque, votre PNG et sa position seront publics. Votre email reste dans Supabase Auth. Aucun paiement n’est déclenché.';
 $('privacy-button').addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();information('<p class="eyebrow">INFORMATIONS & CONFIDENTIALITÉ</p><h2>Un placement partagé.</h2><p>La prévisualisation reste locale. Après connexion et enregistrement explicite, Supabase conserve votre marque, votre PNG et sa position. Ces éléments et votre identifiant technique de propriétaire sont publics pour afficher les logos des entreprises et empêcher les chevauchements.</p><p>Votre email reste dans Supabase Auth, pas dans la table publique. La session est conservée sur cet appareil : déconnectez-vous sur un appareil partagé.</p><p>Vous pouvez reprendre ou supprimer votre position non confirmée depuis le panneau. Pour une position approuvée ou payée, contactez l’opérateur. Les caches d’images peuvent subsister après suppression.</p><p>Une position bloque les cellules techniquement mais ne constitue pas un paiement ni un contrat. L’opérateur doit définir les droits sur le modèle, la conservation des données et les conditions commerciales avant lancement.</p>');},true);
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshPartners();});window.addEventListener('online',()=>refreshPartners());
window.addEventListener('pagehide',e=>{if(!e.persisted){cloud.auth?.unsubscribe();if(cloud.channel)cloud.client?.removeChannel(cloud.channel);}});
