import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=new URL('./',import.meta.url),projects=JSON.parse(fs.readFileSync(new URL('projects.json',root),'utf8'));

async function mountMap(project,scene,city){
  const elements=new Map(),raf=[],saved=new Map([['route-v3-route',String(project.number%5)]]);let watch,requests=0;
  const ctx=new Proxy({measureText:text=>({width:text.length*7})},{get:(obj,key)=>obj[key]??(()=>{}),set:(obj,key,value)=>{obj[key]=value;return true;}});
  function element(){const e={style:{setProperty(k,v){this[k]=v;}},attrs:{},dataset:{},events:{},children:[],hidden:true,open:false,offsetHeight:100,textContent:'',className:'',getContext:()=>ctx,getBoundingClientRect:()=>({left:0,top:0,right:340,bottom:340,width:340,height:340}),setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,f){this.events[k]=f;},querySelector:get,appendChild(v){this.children.push(v);},append(...v){this.children.push(...v);},replaceChildren(...v){this.children=[...v];},focus(){},setPointerCapture(){},showModal(){this.open=true;},close(){this.open=false;this.events.close?.();}};e.classList={add(){},remove(){},toggle(){}};return e;}
  function get(key){if(!elements.has(key))elements.set(key,element());return elements.get(key);}
  const progress=Array.from({length:5},element),document={documentElement:{dataset:{}},hidden:false,fonts:{ready:Promise.resolve()},getElementById:get,querySelector:get,querySelectorAll:()=>progress,createElement:element,addEventListener(){}};
  const source=fs.readFileSync(new URL(project.folder+'/dist/map.js',root),'utf8');
  vm.runInNewContext(source,{document,window:{location:{search:'?route='+(project.number%5+1)},innerHeight:693,devicePixelRatio:1,isSecureContext:true,addEventListener(){}},navigator:{geolocation:{watchPosition(success){requests++;watch=success;return 1;},clearWatch(){}}},getComputedStyle:()=>({getPropertyValue:()=>''}),sessionStorage:{getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v)},localStorage:{getItem:()=>null,setItem(){}},requestAnimationFrame:f=>raf.push(f),setTimeout:()=>1,clearTimeout(){},ResizeObserver:class{constructor(f){this.f=f;}observe(){this.f();}},fetch:async url=>({ok:true,json:async()=>structuredClone(url.includes('citywide')?city:scene)})});
  await new Promise(setImmediate);const flush=()=>{let n=0;while(raf.length){assert.ok(++n<100);raf.shift()();}};flush();
  assert.deepEqual(get('h1').children.map(s=>s.textContent),scene.walk.titleLines,'A foreign route query and old selection cannot change the fixed route');
  assert.equal(requests,0,'Entry does not request GPS');get('geo-intro-later').events.click();get('locate-me').events.click();assert.equal(requests,0,'The GPS button first requests consent');get('geo-intro-allow').events.click();assert.equal(requests,1);
  watch({coords:{latitude:scene.center[1],longitude:scene.center[0],accuracy:20}});flush();
  assert.equal(get('user-location').hidden,false);get('route-center').events.click();flush();
  const map=get('map'),pins=get('markers').children;assert.equal(pins.length,5);assert.ok(pins.every(p=>!p.hidden),'All five points fit');
  const before=pins.map(p=>[Number.parseFloat(p.style.left),Number.parseFloat(p.style.top)]);
  pins[2].events.click();flush();assert.equal(get('place-name').textContent,scene.walk.points[2].name);assert.equal(get('place-tooltip').hidden,false);
  assert.deepEqual(pins.map(p=>[Number.parseFloat(p.style.left),Number.parseFloat(p.style.top)]),before,'Place cards do not move points');get('close-place').events.click();flush();
  map.events.pointerdown({pointerId:1,clientX:100,clientY:100,target:{closest:()=>null}});map.events.pointermove({pointerId:1,clientX:120,clientY:113});flush();map.events.pointerup({pointerId:1});
  for(let i=0;i<5;i++){assert.ok(Math.abs(Number.parseFloat(pins[i].style.left)-before[i][0]-20)<1e-6);assert.ok(Math.abs(Number.parseFloat(pins[i].style.top)-before[i][1]-13)<1e-6);}
  get('zoom-in').events.click();flush();get('route-center').events.click();flush();assert.equal(map.dataset.pan,'0,0');assert.equal(map.dataset.zoom,'1.00');assert.ok(pins.every(p=>!p.hidden));
  assert.ok(!elements.has('choose-route')&&!elements.has('routes-dialog'),'No route picker is even referenced');
}

for(const p of projects){
  const base=new URL(p.folder+'/',root),read=name=>fs.readFileSync(new URL(name,base),'utf8');
  const scene=JSON.parse(read('dist/assets/scene.json')),city=JSON.parse(read('dist/assets/citywide.json'));
  assert.equal(scene.walk.title,p.title);assert.equal(scene.walk.points.length,5);assert.ok(!('walks' in scene)&&!('points' in scene),'Only the single route is present');
  const page=read('dist/index.html');assert.ok(!/choose-route|routes-dialog|route-list|route-index/.test(page));assert.ok(page.includes('route-center')&&page.includes('geo-intro')&&page.includes('route-visits'));
  for(const file of ['map.js','visits.js']){const check=spawnSync(process.execPath,['--check',fileURLToPath(new URL('dist/'+file,base))],{encoding:'utf8',windowsHide:true});assert.equal(check.status,0,check.stderr);}
  await mountMap(p,scene,city);
  const worker=(await import(new URL('dist/server/index.js',base))).default,db=new DatabaseSync(':memory:');db.exec(read('drizzle/0000_qr_route_totals.sql'));
  const prepare=(sql,args=[])=>({bind:(...values)=>prepare(sql,values),first:async()=>db.prepare(sql).get(...args)||null,all:async()=>({results:db.prepare(sql).all(...args)})});
  const env={DB:{prepare}},origin='https://route.example',get=path=>worker.fetch(new Request(origin+path),env),post=route=>worker.fetch(new Request(origin+'/api/route-visits',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({route})}),env);
  assert.deepEqual((await (await get('/api/route-visits')).json()).counts,{[p.number]:0});
  assert.equal((await post(p.number%5+1)).status,400,'API cannot count a different route');
  await Promise.all(Array.from({length:15},()=>post(p.number)));
  assert.deepEqual((await (await get('/api/route-visits')).json()).counts,{[p.number]:15});
  assert.equal((await get('/qr')).headers.get('Location'),'/?from=qr');assert.equal((await get('/qr/'+(p.number%5+1))).status,404);
  assert.ok((await (await get('/?route='+(p.number%5+1))).text()).includes(p.title.replaceAll('&','&amp;')),'URL parameters do not switch the served page');
  assert.ok(!(await (await get('/assets/scene.json')).json()).walks);assert.equal((await get('/privacy')).status,200);assert.equal((await get('/consent')).status,200);
  assert.deepEqual(db.prepare('PRAGMA table_info(qr_route_totals)').all().map(c=>c.name),['route_id','total']);
  const client=read('dist/visits.js'),requests=[],history=[],elements={};const el=id=>elements[id]??=(id==='route-visits'?{setAttribute(){}}:{textContent:''});
  vm.runInNewContext(client,{document:{getElementById:el},window:{location:{href:origin+'/?from=qr&route='+(p.number%5+1)},addEventListener(){}},URL,Intl,history:{state:null,replaceState:(...args)=>history.push(args[2])},performance:{getEntriesByType:()=>[{type:'navigate'}]},fetch:async(url,options)=>{requests.push(options);return{ok:true,json:async()=>options.method==='POST'?{route:p.number,total:1}:{counts:{[p.number]:1}}};}});
  await new Promise(setImmediate);assert.equal(requests.find(r=>r.method==='POST').body,JSON.stringify({route:p.number}));assert.equal(history[0],'/');
  assert.ok(!read('.openai/hosting.json').includes('project_id'),'A copy cannot update the shared live site');
  db.close();console.log('PASS '+p.folder);
}
console.log('All five independent projects passed fixed-route, GPS consent, map, popup, isolated counter and URL checks.');
