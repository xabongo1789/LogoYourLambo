import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {resolve,relative,extname} from 'node:path';
const root=resolve('dist'),port=Number(process.env.PORT||8000),types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json','.stl':'model/stl'};
createServer(async(req,res)=>{try{
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
 const p=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=resolve(root,'.'+(p.endsWith('/')?p+'index.html':p));
 if(relative(root,file).startsWith('..')){res.writeHead(403);res.end();return;}
 const info=await stat(file);if(!info.isFile())throw new Error('Not a file');
 res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Content-Length':info.size,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});if(req.method==='HEAD')res.end();else createReadStream(file).pipe(res);
 }catch{res.writeHead(404);res.end('Fichier introuvable.');}}).listen(port,'127.0.0.1',()=>console.log(`Studio : http://127.0.0.1:${port}`));
