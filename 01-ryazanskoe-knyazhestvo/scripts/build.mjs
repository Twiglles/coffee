import {readFileSync,writeFileSync,readdirSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dist=path.join(root,'dist');
const legal=spawnSync(process.execPath,[path.join(root,'scripts/legal.mjs'),...(process.argv.includes('--preview')?['--preview']:process.argv.includes('--allow-draft-legal')?['--allow-draft-legal']:[])],{stdio:'inherit',windowsHide:true});
if(legal.status!==0)throw new Error('Legal pages are incomplete; production build stopped.');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp','.otf':'font/otf','.ttf':'font/ttf'};
const assets={};
function collect(directory,prefix=''){
  for(const entry of readdirSync(directory,{withFileTypes:true})){
    if(entry.name==='server'||entry.name==='.openai')continue;
    const name=prefix+'/'+entry.name,filename=path.join(directory,entry.name);
    if(entry.isDirectory())collect(filename,name);
    else assets[name]={type:types[path.extname(entry.name)]||'application/octet-stream',body:readFileSync(filename).toString('base64')};
  }
}
collect(dist);
mkdirSync(path.join(dist,'server'),{recursive:true});mkdirSync(path.join(dist,'.openai'),{recursive:true});
writeFileSync(path.join(dist,'server/index.js'),'const ASSETS='+JSON.stringify(assets)+';\n'+readFileSync(path.join(root,'worker/index.mjs'),'utf8'));
writeFileSync(path.join(dist,'.openai/hosting.json'),readFileSync(path.join(root,'.openai/hosting.json')));
console.log('Built Worker with '+Object.keys(assets).length+' local assets');
