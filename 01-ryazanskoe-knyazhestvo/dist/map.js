'use strict';
(() => {
  const el=document.getElementById('map'),canvas=document.getElementById('city-canvas'),ctx=canvas.getContext('2d',{alpha:false});
  const tooltip=document.getElementById('place-tooltip'),markerLayer=document.getElementById('markers'),status=document.getElementById('map-status');
  const locationButton=document.getElementById('locate-me'),locationMarker=document.getElementById('user-location'),notice=document.getElementById('location-notice'),themeButton=document.getElementById('theme-toggle');
  const geoIntro=document.getElementById('geo-intro');
  const clamp=(v,a,b)=>Math.max(a,Math.min(v,b));
  let data,width=1,height=1,dpr=1,scale=1,zoom=1,pan=[0,0],selected=0,scheduled=false,colours;
  let watchId=null,locationWanted=false,location=null,locationNeedsCenter=false,pendingLocation=null,noticeTimer=null,savedSelection=0;
  let viewCenter=[40,-5],viewSize=[1100,820];
  let markerPositions=[],markerAnchors=[],hasSize=false;
  let descriptionOpen=false,geoConsent=false;
  const pins=[],pointers=new Map();
  const streetLabels=[],labelSources=new Set();
  try{const n=Number(sessionStorage.getItem('route-1-point'));if(Number.isInteger(n)&&n>=0&&n<5)savedSelection=n;}catch{}
  function theme(light){
    document.documentElement.dataset.theme=light?'light':'dark';
    themeButton.setAttribute('aria-label',light?'Включить тёмную тему':'Включить светлую тему');themeButton.setAttribute('aria-pressed',String(light));
    document.querySelector('meta[name="theme-color"]').setAttribute('content',light?'#f5f4f2':'#2c2929');
    try{localStorage.setItem('route-theme',light?'light':'dark');}catch{}
    const fallback=light?{map:'#edece8',road:'#fcfbf8',building:'#e0ddd7',park:'#dce2d8','map-text':'#8b8380'}:{map:'#f5f4f2',road:'#ffffff',building:'#e7e4df',park:'#e2e6df','map-text':'#9b9491'};
    let style;try{style=getComputedStyle(document.documentElement);}catch{}
    colours=Object.fromEntries(Object.keys(fallback).map(k=>{const value=style?.getPropertyValue('--'+k)?.trim()||'';const valid=value&&!/^(transparent|currentcolor)$/i.test(value)&&!/(var|env|color-mix)\s*\(/i.test(value)&&(typeof CSS!=='undefined'?CSS.supports('color',value):/^#(?:[a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})$/i.test(value));return[k,valid?value:fallback[k]];}));schedule();
  }
  themeButton.addEventListener('click',()=>theme(document.documentElement.dataset.theme!=='light'));
  let initialLight=false;try{initialLight=localStorage.getItem('route-theme')==='light';}catch{}theme(initialLight);
  // One north-up 2D projection for map, route, stops and live position.
  // Leave room below the route for a full description without shifting its pin.
  function routeHeight(){return Math.max(140,height-90);}
  function fitScale(){return Math.max(.001,Math.min((width-78)/viewSize[0],(routeHeight()-125)/viewSize[1]));}
  function project(x,y){return [width*.47+(x-viewCenter[0])*scale+pan[0],routeHeight()*.52+(y-viewCenter[1])*scale+pan[1]];}
  function layoutMarkers(){
    if(!hasSize)return;
    const base=fitScale(),positions=data.points.map(p=>[(p.routeXY[0]-viewCenter[0])*base,(p.routeXY[1]-viewCenter[1])*base]);
    for(let pass=0;pass<12;pass++)for(let i=0;i<positions.length;i++)for(let j=i+1;j<positions.length;j++){
      const a=positions[i],b=positions[j];let dx=b[0]-a[0],dy=b[1]-a[1],distance=Math.hypot(dx,dy);
      if(distance>=38)continue;if(distance<.1){dx=1;dy=0;distance=1;}
      const shift=(38-distance)/2+.2;a[0]-=dx/distance*shift;a[1]-=dy/distance*shift;b[0]+=dx/distance*shift;b[1]+=dy/distance*shift;
    }
    // Store label offsets in map coordinates once, rather than moving pins on every gesture.
    markerAnchors=positions.map(p=>[viewCenter[0]+(clamp(width*.47+p[0],24,width-24)-width*.47)/base,viewCenter[1]+(clamp(routeHeight()*.52+p[1],57,height-41)-routeHeight()*.52)/base]);
  }
  function indexGeometry(){
    const box=g=>{let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const p of g){minX=Math.min(minX,p[0]);minY=Math.min(minY,p[1]);maxX=Math.max(maxX,p[0]);maxY=Math.max(maxY,p[1]);}return[minX,minY,maxX,maxY];};
    data.roads=data.roads.filter(r=>validLine(r?.g));data.buildings=data.buildings.filter(b=>validRing(b?.g));
    data.roads.forEach(r=>r.box=box(r.g));data.buildings.forEach(b=>b.box=box(b.g));
    for(const key of ['parks','water','rivers']){data[key]=(data[key]||[]).filter(key==='rivers'?validLine:validRing);for(const g of data[key])g.box=box(g);}
    anchorStreetLabels();
  }
  function validLine(g){return Array.isArray(g)&&g.length>=2&&g.every(p=>Array.isArray(p)&&p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1]));}
  function validRing(g){return validLine(g)&&g.length>=4&&g[0][0]===g[g.length-1][0]&&g[0][1]===g[g.length-1][1];}
  function inView(box){const a=project(box[0],box[1]),b=project(box[2],box[3]);return b[0]>=-25&&a[0]<=width+25&&b[1]>=-25&&a[1]<=height+25;}
  function clipSegment(a,b){
    const dx=b[0]-a[0],dy=b[1]-a[1];let from=0,to=1;
    for(const[p,q]of[[-dx,a[0]+32],[dx,width+32-a[0]],[-dy,a[1]+32],[dy,height+32-a[1]]]){
      if(p===0){if(q<0)return null;continue;}const t=q/p;
      if(p<0){if(t>to)return null;from=Math.max(from,t);}else{if(t<from)return null;to=Math.min(to,t);}
    }
    return[[a[0]+from*dx,a[1]+from*dy],[a[0]+to*dx,a[1]+to*dy]];
  }
  function clipPolygon(points){
    for(const[axis,bound,direction]of[[0,-32,1],[0,width+32,-1],[1,-32,1],[1,height+32,-1]]){
      const input=points;points=[];if(!input.length)break;let previous=input[input.length-1],previousInside=(previous[axis]-bound)*direction>=0;
      for(const p of input){const inside=(p[axis]-bound)*direction>=0;if(inside!==previousInside){const t=(bound-previous[axis])/(p[axis]-previous[axis]);points.push([previous[0]+t*(p[0]-previous[0]),previous[1]+t*(p[1]-previous[1])]);}if(inside)points.push(p);previous=p;previousInside=inside;}
    }return points;
  }
  function line(points,close=false){
    ctx.beginPath();const projected=points.map(p=>project(...p));
    if(close){const polygon=clipPolygon(projected);polygon.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));if(polygon.length)ctx.closePath();}
    else for(let i=1;i<projected.length;i++){const segment=clipSegment(projected[i-1],projected[i]);if(segment){ctx.moveTo(...segment[0]);ctx.lineTo(...segment[1]);}}
  }
  function routePath(){
    // Keep every bend on its source street, sidewalk or pedestrian path.
    line(data.path);
  }
  function anchorStreetLabels(){
    // Lay out names once in geographic space. Camera gestures only project these anchors.
    const candidates=[];
    for(const road of data.roads){
      const key=road.type+'|'+JSON.stringify(road.g);if(labelSources.has(key))continue;labelSources.add(key);
      if(!road.name||['service','path','footway','steps','cycleway','construction'].includes(road.type))continue;
      let length=0;for(let i=1;i<road.g.length;i++)length+=Math.hypot(road.g[i][0]-road.g[i-1][0],road.g[i][1]-road.g[i-1][1]);
      if(length<45)continue;
      let remaining=length/2,position,angle=0;
      for(let i=1;i<road.g.length;i++){const a=road.g[i-1],b=road.g[i],segment=Math.hypot(b[0]-a[0],b[1]-a[1]);if(segment>=remaining&&segment>0){position=[a[0]+(b[0]-a[0])*remaining/segment,a[1]+(b[1]-a[1])*remaining/segment];angle=Math.atan2(b[1]-a[1],b[0]-a[0]);break;}remaining-=segment;}
      if(!position)continue;
      position=[position[0]-Math.sin(angle)*24,position[1]+Math.cos(angle)*24];
      if(angle>Math.PI/2)angle-=Math.PI;if(angle<-Math.PI/2)angle+=Math.PI;
      const text=road.name.replace(/^улица /,'ул. ').replace(/^(.+) улица$/,'ул. $1').replace(/ площадь$/,' пл.').replace(/ бульвар$/,' б-р');
      const priority=['motorway','trunk','primary','secondary','tertiary'].includes(road.type)?10000:0;
      const tw=text.length*7,bw=Math.abs(Math.cos(angle))*tw+Math.abs(Math.sin(angle))*14+16,bh=Math.abs(Math.sin(angle))*tw+Math.abs(Math.cos(angle))*14+12;
      candidates.push({name:road.name,text,position,angle,bw,bh,score:priority+length});
    }
    candidates.sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name));
    for(const candidate of candidates){
      if(streetLabels.some(l=>l.name===candidate.name&&Math.hypot(l.position[0]-candidate.position[0],l.position[1]-candidate.position[1])<700))continue;
      for(const tier of [.04,.08,.16,.32,.64,1.28,2.56]){
        const collision=streetLabels.some(l=>l.minScale<=tier&&Math.abs(l.position[0]-candidate.position[0])<(l.bw+candidate.bw)/(2*tier)&&Math.abs(l.position[1]-candidate.position[1])<(l.bh+candidate.bh)/(2*tier));
        if(!collision){streetLabels.push({...candidate,minScale:tier});break;}
      }
    }
  }
  function drawStreetLabels(){
    ctx.font='500 12px Montserrat, sans-serif';const rendered=new Set();
    for(const label of streetLabels){
      if(scale<label.minScale)continue;
      const [x,y]=project(...label.position);
      if(x+label.bw/2<0||x-label.bw/2>width||y+label.bh/2<0||y-label.bh/2>height)continue;
      ctx.save();ctx.translate(x,y);ctx.rotate(label.angle);ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineWidth=4;ctx.strokeStyle=colours.map;ctx.strokeText(label.text,0,0);ctx.fillStyle='#706966';ctx.fillText(label.text,0,0);ctx.restore();rendered.add(label.text);
    }
    document.getElementById('street-names').textContent='Улицы на карте: '+[...rendered].join(', ');el.dataset.streetLabels=[...rendered].join('|');
  }
  function draw(){
    scheduled=false;if(!data||!colours||!hasSize||markerAnchors.length!==data.points.length)return;
    scale=fitScale()*zoom;
    markerPositions=markerAnchors.map(p=>project(...p));
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.lineCap='round';ctx.lineJoin='round';ctx.clearRect(0,0,width,height);ctx.fillStyle=colours.map;ctx.fillRect(0,0,width,height);
    data.parks.forEach(p=>{if(!inView(p.box))return;line(p,true);ctx.fillStyle=colours.park;ctx.fill();});
    for(const water of data.water||[]){if(inView(water.box)){line(water,true);ctx.fillStyle='#d3e2e7';ctx.fill();}}
    for(const river of data.rivers||[]){if(inView(river.box)){line(river);ctx.strokeStyle='#d3e2e7';ctx.lineWidth=Math.max(2,30*scale);ctx.stroke();}}
    if(scale>.025)data.buildings.forEach(b=>{if(!inView(b.box))return;line(b.g,true);ctx.fillStyle=colours.building;ctx.fill();});
    ctx.lineCap='round';ctx.lineJoin='round';const major=['primary','secondary','tertiary','residential','unclassified','pedestrian'];
    for(const road of data.roads){if(!inView(road.box)||scale<.025&&!major.includes(road.type)&&!['motorway','trunk','primary_link','secondary_link','tertiary_link'].includes(road.type))continue;line(road.g);ctx.strokeStyle=colours.road;ctx.lineWidth=Math.max(major.includes(road.type)?1:.5,(major.includes(road.type)?18:4)*scale);ctx.stroke();}
    drawStreetLabels();
    routePath();ctx.strokeStyle=colours.map;ctx.lineWidth=8;ctx.stroke();routePath();ctx.strokeStyle='#70000e';ctx.lineWidth=3;ctx.stroke();
    pins.forEach((pin,i)=>{const p=markerPositions[i];pin.style.left=p[0]+'px';pin.style.top=p[1]+'px';pin.hidden=p[0]<15||p[0]>width-15||p[1]<50||p[1]>height-35;});
    if(descriptionOpen){
      const p=markerPositions[selected],cardWidth=Math.min(260,width-16),left=clamp(p[0]-cardWidth/2,8,width-cardWidth-8);
      tooltip.style.width=cardWidth+'px';
      const cardHeight=tooltip.offsetHeight,screen=document.querySelector('.experience').getBoundingClientRect(),map=el.getBoundingClientRect(),bottom=screen.bottom-map.top-8;
      let top=p[1]+18,side='below';if(top+cardHeight>bottom){if(p[1]-cardHeight-18>=8){top=p[1]-cardHeight-18;side='above';}else{top=clamp(top,8,Math.max(8,bottom-cardHeight));side='overlap';}}
      tooltip.dataset.side=side;tooltip.style.left=left+'px';tooltip.style.top=top+'px';
      tooltip.style.setProperty('--anchor-left',(p[0]-left)+'px');
    }
    if(location){const p=project(...location.xy);locationMarker.hidden=!(p[0]>=12&&p[0]<=width-12&&p[1]>=45&&p[1]<=height-28);locationMarker.style.left=p[0]+'px';locationMarker.style.top=p[1]+'px';locationMarker.style.setProperty('--heading',location.heading+'deg');}else locationMarker.hidden=true;
    const metres=Math.round(35/scale/10)*10;document.getElementById('map-scale').textContent=metres>=1000?(metres/1000).toFixed(1)+' км':metres+' м';
    el.dataset.zoom=zoom.toFixed(2);el.dataset.selected=String(selected+1);el.dataset.pan=pan.map(n=>Math.round(n)).join(',');el.dataset.descriptionOpen=String(descriptionOpen);
  }
  function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(draw);}}
  function resize(preserveView=true){
    const r=el.getBoundingClientRect();if(r.width<=48||r.height<=100)return;
    const nextDpr=Math.min(window.devicePixelRatio||1,2.5),changed=r.width!==width||r.height!==height,previousScale=fitScale()*zoom;
    const center=preserveView&&changed&&data&&markerAnchors.length?[viewCenter[0]+(width*.03-pan[0])/previousScale,viewCenter[1]+(height*.5-routeHeight()*.52-pan[1])/previousScale]:null;
    width=r.width;height=r.height;dpr=nextDpr;hasSize=true;
    if(center){scale=fitScale()*zoom;pan=[width*.03-(center[0]-viewCenter[0])*scale,height*.5-routeHeight()*.52-(center[1]-viewCenter[1])*scale];}
    if(data&&markerAnchors.length!==data.points.length)layoutMarkers();
    if(pendingLocation&&data){const position=pendingLocation;pendingLocation=null;locationSuccess(position);}
    const pixelWidth=Math.round(width*dpr),pixelHeight=Math.round(height*dpr);if(canvas.width!==pixelWidth||canvas.height!==pixelHeight){canvas.width=pixelWidth;canvas.height=pixelHeight;if(data&&markerAnchors.length&&colours)draw();else schedule();}else schedule();
  }
  function select(i,announce=true){
    selected=i;const p=data.points[i];
    pins.forEach((pin,j)=>{const open=descriptionOpen&&i===j;pin.classList.toggle('selected',i===j);pin.classList.toggle('is-open',open);pin.setAttribute('aria-pressed',String(open));pin.setAttribute('aria-expanded',String(open));pin.setAttribute('aria-label',`${j+1}. ${data.points[j].name}, ${data.points[j].address}`);pin.querySelector('.pin-head').textContent=String(j+1);});
    document.getElementById('place-name').textContent=p.name;document.getElementById('place-address').textContent=p.address;
    document.getElementById('footer-place').textContent=p.name;document.getElementById('footer-address').textContent=p.address;
    document.querySelectorAll('.route-progress span').forEach((s,j)=>{s.className=j===i?'current':j<i?'visited':'';});
    if(announce)document.getElementById('selection-announcement').textContent=`Остановка ${i+1} из 5: ${p.name}. ${p.address}.`;
    document.getElementById('place-description').textContent=p.description;
    try{sessionStorage.setItem('route-1-point',String(i));}catch{}schedule();
  }
  function closeDescription(){
    if(!descriptionOpen)return;descriptionOpen=false;tooltip.hidden=true;el.classList.remove('has-description');
    select(selected,false);
  }
  function showDescription(i){
    if(descriptionOpen&&selected===i){closeDescription();return;}
    descriptionOpen=true;tooltip.hidden=false;el.classList.add('has-description');select(i);
    schedule();
  }
  document.getElementById('close-place').addEventListener('click',()=>{closeDescription();pins[selected].focus({preventScroll:true});});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&descriptionOpen){e.preventDefault();closeDescription();}});
  function initializeRoute(initialPoint=0){
    closeDescription();
    const route=data.walk;data.points=route.points;data.path=route.path;
    const xs=data.path.map(p=>p[0]),ys=data.path.map(p=>p[1]);
    viewCenter=[(Math.min(...xs)+Math.max(...xs))/2,(Math.min(...ys)+Math.max(...ys))/2];
    viewSize=[Math.max(220,Math.max(...xs)-Math.min(...xs)),Math.max(220,Math.max(...ys)-Math.min(...ys))];zoom=1;pan=[0,0];
    const heading=document.querySelector('h1');heading.replaceChildren();
    route.titleLines.forEach(text=>{const s=document.createElement('span');s.textContent=text;heading.appendChild(s);});
    document.querySelector('.route-description').textContent=route.summary;
    markerLayer.replaceChildren();pins.length=0;
    data.points.forEach((p,i)=>{const pin=document.createElement('button');pin.className='map-pin';pin.innerHTML=`<span class="pin-head">${i+1}</span>`;pin.setAttribute('aria-label',`${i+1}. ${p.name}, ${p.address}`);pin.setAttribute('aria-pressed','false');pin.setAttribute('aria-expanded','false');pin.setAttribute('aria-controls','place-tooltip');pin.addEventListener('click',()=>showDescription(i));markerLayer.appendChild(pin);pins.push(pin);});
    markerAnchors=[];select(initialPoint,false);resize(false);layoutMarkers();schedule();
  }
  function setZoom(value,anchor=[width*.5,height*.5]){
    const next=clamp(value,.025,16),ratio=next/zoom,offset=[anchor[0]-width*.47,anchor[1]-routeHeight()*.52];
    pan=[offset[0]-(offset[0]-pan[0])*ratio,offset[1]-(offset[1]-pan[1])*ratio];zoom=next;schedule();
  }
  function fitRoute(){
    if(!data)return;closeDescription();pointers.clear();gestureStart=null;locationNeedsCenter=false;zoom=1;pan=[0,0];schedule();
  }
  document.getElementById('route-center').addEventListener('click',fitRoute);
  document.getElementById('zoom-in').addEventListener('click',()=>{closeDescription();setZoom(zoom*1.2);});document.getElementById('zoom-out').addEventListener('click',()=>{closeDescription();setZoom(zoom/1.2);});
  el.addEventListener('wheel',e=>{if(e.target.closest('.map-place-card'))return;e.preventDefault();if(!descriptionOpen){const r=el.getBoundingClientRect();setZoom(zoom*Math.exp(-e.deltaY*.0015),[e.clientX-r.left,e.clientY-r.top]);}},{passive:false});
  let gestureStart;
  function pairDistance(){const[a,b]=[...pointers.values()];return a&&b?Math.hypot(a.x-b.x,a.y-b.y):0;}
  function pairCenter(){const[a,b]=[...pointers.values()],r=el.getBoundingClientRect();return[(a.x+b.x)*.5-r.left,(a.y+b.y)*.5-r.top];}
  el.addEventListener('pointerdown',e=>{if(!data||descriptionOpen||e.target.closest('button')||pointers.size>=2)return;el.focus({preventScroll:true});el.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});gestureStart={x:e.clientX,y:e.clientY,pan:[...pan],zoom,distance:pairDistance(),center:pointers.size===2?pairCenter():null};});
  el.addEventListener('pointermove',e=>{if(!pointers.has(e.pointerId))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===2){const distance=pairDistance(),center=pairCenter();if(gestureStart.distance){const next=clamp(gestureStart.zoom*distance/gestureStart.distance,.025,16),ratio=next/gestureStart.zoom,origin=[width*.47,routeHeight()*.52];pan=[center[0]-origin[0]-(gestureStart.center[0]-origin[0]-gestureStart.pan[0])*ratio,center[1]-origin[1]-(gestureStart.center[1]-origin[1]-gestureStart.pan[1])*ratio];zoom=next;schedule();}else gestureStart={...gestureStart,distance,zoom,pan:[...pan],center};}else if(gestureStart){pan=[gestureStart.pan[0]+e.clientX-gestureStart.x,gestureStart.pan[1]+e.clientY-gestureStart.y];schedule();}});
  function endGesture(e){pointers.delete(e.pointerId);if(pointers.size===1){const p=[...pointers.values()][0];gestureStart={...p,pan:[...pan],zoom,distance:0};}else gestureStart=null;}
  el.addEventListener('pointerup',endGesture);el.addEventListener('pointercancel',endGesture);el.addEventListener('lostpointercapture',endGesture);
  el.addEventListener('keydown',e=>{if(e.target!==el||descriptionOpen)return;let handled=true;switch(e.key){case'ArrowLeft':pan[0]+=25;break;case'ArrowRight':pan[0]-=25;break;case'ArrowUp':pan[1]+=25;break;case'ArrowDown':pan[1]-=25;break;case'+':case'=':setZoom(zoom*1.2);break;case'-':setZoom(zoom/1.2);break;case'Home':fitRoute();break;case'1':case'2':case'3':case'4':case'5':if(data)select(Number(e.key)-1);break;default:handled=false;}if(handled){e.preventDefault();schedule();}});
  function showNotice(message,persistent=false){clearTimeout(noticeTimer);notice.textContent=message;notice.hidden=false;if(!persistent)noticeTimer=setTimeout(()=>{notice.hidden=true;},5500);}
  function clearLocationWatch(){if(watchId!==null){navigator.geolocation.clearWatch(watchId);watchId=null;}}
  function stopLocation(){geoConsent=false;locationWanted=false;locationNeedsCenter=false;pendingLocation=null;clearLocationWatch();location=null;locationMarker.hidden=true;locationButton.classList.remove('busy');locationButton.setAttribute('aria-pressed','false');locationButton.setAttribute('aria-label','Показать моё местоположение');schedule();}
  function locationError(error){stopLocation();const messages={1:'Геопозиция недоступна. Разрешите доступ в настройках браузера и нажмите ещё раз.',2:'Не удалось определить местоположение. Попробуйте ещё раз на открытом месте.',3:'Поиск занял слишком много времени. Нажмите кнопку ещё раз.'};showNotice(messages[error.code]||'Не удалось определить местоположение. Попробуйте ещё раз.',true);}
  function locationSuccess(position){
    if(!locationWanted)return;
    if(!data||!hasSize||!markerAnchors.length){pendingLocation=position;return;}
    const{latitude,longitude,accuracy,heading}=position.coords;
    if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180){locationError({code:2});return;}
    // Precise coordinates stay in this closure: no network, storage or logs.
    const xy=[(longitude-data.center[0])*64350,-(latitude-data.center[1])*111200];location={xy,accuracy,heading:Number.isFinite(heading)?heading:0};locationButton.classList.remove('busy');
    if(locationNeedsCenter&&!descriptionOpen){const currentScale=fitScale()*zoom;pan=[width*.03-(xy[0]-viewCenter[0])*currentScale,height*.5-routeHeight()*.52-(xy[1]-viewCenter[1])*currentScale];locationNeedsCenter=false;}
    showNotice(accuracy>150?'Положение приблизительное: точность около '+Math.round(accuracy)+' м.':'Вы здесь. Синяя стрелка — ваше местоположение.');schedule();
  }
  function startLocationWatch(){
    if(!navigator.geolocation){showNotice('Этот браузер не поддерживает геопозицию.',true);return;}
    if(!window.isSecureContext){showNotice('Для геопозиции откройте опубликованный сайт по HTTPS.',true);return;}
    locationWanted=true;locationButton.classList.add('busy');locationButton.setAttribute('aria-pressed','true');locationButton.setAttribute('aria-label','Отключить моё местоположение');showNotice('Определяем ваше местоположение…',true);
    watchId=navigator.geolocation.watchPosition(locationSuccess,locationError,{enableHighAccuracy:true,timeout:15000,maximumAge:10000});
  }
  function enableLocation(){closeDescription();locationNeedsCenter=true;startLocationWatch();}
  locationButton.addEventListener('click',()=>{if(locationWanted){stopLocation();showNotice('Показ местоположения выключен.');}else if(!data)showNotice('Дождитесь загрузки карты.');else if(!geoConsent){positionGeoIntro();let geoChoice=null;try{geoChoice=localStorage.getItem('geo-choice')}catch{}if(geoChoice=='allow')geoConsent=true;if(!geoChoice)geoIntro.showModal();}else enableLocation();});
  function positionGeoIntro(){const r=document.querySelector('.experience').getBoundingClientRect();geoIntro.style.left=r.left+'px';geoIntro.style.width=r.width+'px';geoIntro.style.bottom=Math.max(0,window.innerHeight-r.bottom)+'px';}
  document.getElementById('geo-intro-allow').addEventListener('click',()=>{try{localStorage.setItem('geo-choice','allow')}catch{}geoConsent=true;geoIntro.close();enableLocation();});
  document.getElementById('geo-intro-later').addEventListener('click',()=>{try{localStorage.setItem('geo-choice','later')}catch{}geoIntro.close();});
  geoIntro.addEventListener('close',()=>locationButton.focus({preventScroll:true}));
  geoIntro.addEventListener('click',e=>{const r=geoIntro.getBoundingClientRect();if(e.target===geoIntro&&(e.clientY<r.top||e.clientY>r.bottom||e.clientX<r.left||e.clientX>r.right))geoIntro.close();});
  window.addEventListener('resize',()=>{if(geoIntro.open)positionGeoIntro();});
  positionGeoIntro();geoIntro.showModal();
  document.addEventListener('visibilitychange',()=>{if(document.hidden){clearLocationWatch();pointers.clear();gestureStart=null;}else{resize();if(locationWanted&&watchId===null)startLocationWatch();}});window.addEventListener('pagehide',clearLocationWatch);
  window.addEventListener('pageshow',()=>{if(data)resize();});
  canvas.addEventListener('contextlost',e=>e.preventDefault());canvas.addEventListener('contextrestored',()=>{if(data){resize();schedule();}});
  fetch('./assets/scene.json?v=single-route-1').then(r=>{if(!r.ok)throw new Error('map');return r.json();}).then(scene=>{
    data=scene;indexGeometry();
    initializeRoute(savedSelection);status.classList.add('hidden');new ResizeObserver(resize).observe(el);resize();document.fonts.ready.then(schedule);
    requestAnimationFrame(()=>{if(pendingLocation){const position=pendingLocation;pendingLocation=null;locationSuccess(position);}});
    fetch('./assets/citywide.json?v=gps-12').then(r=>{if(!r.ok)throw new Error('city');return r.json();}).then(city=>{
      if(!Array.isArray(city.roads)||!city.roads.some(r=>validLine(r?.g)))throw new Error('Invalid city map');
      const roadKey=r=>r.type+'|'+JSON.stringify(r.g),seen=new Set(data.roads.map(roadKey)),extra=city.roads.filter(r=>{if(!validLine(r?.g))return false;const key=roadKey(r);if(seen.has(key))return false;seen.add(key);return true;});
      data.roads=data.roads.concat(extra);data.parks=Array.isArray(city.parks)?city.parks:data.parks;data.water=Array.isArray(city.water)?city.water:[];data.rivers=Array.isArray(city.rivers)?city.rivers:[];indexGeometry();el.dataset.coverage='ryazan';el.dataset.cityRoads=String(city.roads.length);schedule();
    }).catch(()=>showNotice('Карта района загружена. Для карты всей Рязани проверьте интернет и обновите страницу.',true));
  }).catch(()=>{status.textContent='Не удалось загрузить карту. Обновите страницу.';});
})();


