import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=new URL('./',import.meta.url);
for(const p of JSON.parse(readFileSync(new URL('projects.json',root),'utf8'))){const r=spawnSync(process.execPath,[fileURLToPath(new URL(p.folder+'/scripts/build.mjs',root))],{stdio:'inherit',windowsHide:true});if(r.status!==0)process.exit(r.status||1);}
