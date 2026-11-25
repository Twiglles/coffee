import {readFileSync,mkdirSync,cpSync,writeFileSync,rmSync} from 'node:fs';
const ps=JSON.parse(readFileSync('projects.json','utf8'));
rmSync('_site',{recursive:true,force:true});mkdirSync('_site');
for(const p of ps){
  cpSync(p.folder+'/dist','_site/'+p.slug,{recursive:true,filter:s=>!/dist\/(server|\.openai)/.test(s)});
  mkdirSync('_site/'+p.slug+'/qr');
  writeFileSync('_site/'+p.slug+'/qr/index.html','<!doctype html><meta charset="utf-8"><script>location.replace("../?from=qr")</script><meta http-equiv="refresh" content="0;url=../?from=qr">');
}
const li=ps.map(p=>`<li><a href="./${p.slug}/">${p.number}. ${p.title}</a></li>`).join('');
writeFileSync('_site/index.html',`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Пять маршрутов Рязани</title><style>body{font:18px/1.6 system-ui;background:#2c2929;color:#fff;max-width:560px;margin:40px auto;padding:0 20px}a{color:#fff}</style></head><body><h1>Пять маршрутов Рязани</h1><ol style="list-style:none;padding:0">${li}</ol></body></html>`);
writeFileSync('_site/.nojekyll','');
