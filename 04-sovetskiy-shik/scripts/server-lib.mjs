import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import worker from '../dist/server/index.js';
const root=fileURLToPath(new URL('../',import.meta.url));
export function startServer(port=4173,{memory=false}={}){
  const dataDirectory=path.join(root,'.data');if(!memory)fs.mkdirSync(dataDirectory,{recursive:true});
  const sqlite=new DatabaseSync(memory?':memory:':path.join(dataDirectory,'visits.sqlite'));
  sqlite.exec('PRAGMA journal_mode=WAL');
  if(!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='qr_route_totals'").get())sqlite.exec(fs.readFileSync(path.join(root,'drizzle/0000_qr_route_totals.sql'),'utf8'));
  function prepare(sql,args=[]){return{bind:(...values)=>prepare(sql,values),first:async()=>sqlite.prepare(sql).get(...args)||null,all:async()=>({results:sqlite.prepare(sql).all(...args)})};}
  const server=http.createServer(async(req,res)=>{
    try{
      const parts=[];let size=0;for await(const part of req){size+=part.length;if(size>65536){res.writeHead(413);res.end('Request too large');return;}parts.push(part);}
      const base=process.env.PUBLIC_ORIGIN||'http://'+req.headers.host;
      const request=new Request(new URL(req.url,base),{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(parts)}:{})});
      const response=await worker.fetch(request,{DB:{prepare}});
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
    }catch{res.writeHead(500);res.end('Server unavailable');}
  });
  server.listen(port,()=>console.log('Route site: http://localhost:'+port+(memory?' (temporary test counter)':'')));
  server.on('close',()=>sqlite.close());return server;
}
