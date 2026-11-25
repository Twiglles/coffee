'use strict';
(() => {
  const EXT="";
  const counter=document.getElementById('route-visits'),value=document.getElementById('route-visit-count');
  let counts={};const current=1;
  const render=()=>{const total=counts[current];value.textContent=Number.isSafeInteger(total)&&total>=0?new Intl.NumberFormat('ru-RU').format(total):'—';counter.setAttribute('aria-label',Number.isSafeInteger(total)?'Открытий этого маршрута по QR-коду: '+total:'Счётчик открытий по QR-коду недоступен');};
  const load=async()=>{try{const response=await fetch(EXT?EXT+"?t="+Date.now():'./api/route-visits',{cache:'no-store',credentials:'omit'});if(!response.ok)throw new Error('counter');const body=await response.json();for(const [key,total] of Object.entries(body.counts||{}))if(Number.isSafeInteger(total)&&total>=0)counts[key]=Math.max(counts[key]||0,total);}catch{}render();};
  const entry=new URL(window.location.href);
  const qr=entry.searchParams.get('from')==='qr';
  const hasRouteParameter=entry.searchParams.has('route');entry.searchParams.delete('route');
  // Consume the QR marker on this history entry so refresh/back do not count another scan.
  if(qr||hasRouteParameter){entry.searchParams.delete('from');history.replaceState(history.state,'',entry.pathname+entry.search+entry.hash);}
  const navigation=performance.getEntriesByType('navigation')[0];
  if(qr&&(!navigation||navigation.type==='navigate')){
    fetch(EXT||'./api/route-visits',{method:'POST',headers:{'Content-Type':EXT?'text/plain':'application/json'},credentials:'omit',cache:'no-store',body:JSON.stringify({route:current})}).then(async response=>{if(!response.ok)throw new Error('counter');const body=await response.json();if(Number.isSafeInteger(body.total))counts[body.route]=Math.max(counts[body.route]||0,body.total);render();load();}).catch(()=>load());
  }else load();
  window.addEventListener('pageshow',event=>{if(event.persisted)load();});render();
})();
