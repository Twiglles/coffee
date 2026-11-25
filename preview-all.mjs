import {readFileSync} from 'node:fs';
const root=new URL('./',import.meta.url),servers=[];
for(const p of JSON.parse(readFileSync(new URL('projects.json',root),'utf8'))){const {startServer}=await import(new URL(p.folder+'/scripts/server-lib.mjs',root));servers.push(startServer(4170+p.number,{memory:process.argv.includes('--memory')}));}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{let remaining=servers.length;for(const server of servers)server.close(()=>{if(!--remaining)process.exit();});});
