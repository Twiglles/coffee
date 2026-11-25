const ROUTE_NUMBER=1;
const responseHeaders={
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'same-origin',
  'Permissions-Policy':'geolocation=(self)'
};
const json=(value,status=200)=>Response.json(value,{status,headers:responseHeaders});

export default {
  async fetch(request,env){
    const url=new URL(request.url),path=url.pathname;
    if(path==='/api/route-visits'){
      if(!env.DB)return json({error:'counter_unavailable'},503);
      try{
        if(request.method==='GET'){
          const result=await env.DB.prepare('SELECT route_id, total FROM qr_route_totals WHERE route_id = ?').bind(ROUTE_NUMBER).all();
          const counts={[ROUTE_NUMBER]:0};
          for(const row of result.results)counts[row.route_id]=row.total;
          return json({counts});
        }
        if(request.method!=='POST')return json({error:'method_not_allowed'},405);
        if(request.headers.get('Origin')!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return json({error:'origin_not_allowed'},403);
        if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))return json({error:'json_required'},415);
        // Only a route number reaches the database. No GPS, IP, cookies or visitor IDs.
        const reader=request.body?.getReader();if(!reader)return json({error:'route_required'},400);
        let size=0,text='';const decoder=new TextDecoder();
        for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>64){await reader.cancel();return json({error:'body_too_large'},413);}text+=decoder.decode(value,{stream:true});}
        text+=decoder.decode();let body;try{body=JSON.parse(text);}catch{return json({error:'invalid_json'},400);}
        if(!body||Object.keys(body).length!==1||!Number.isInteger(body.route)||body.route!==ROUTE_NUMBER)return json({error:'invalid_route'},400);
        const row=await env.DB.prepare('INSERT INTO qr_route_totals (route_id,total) VALUES (?,1) ON CONFLICT(route_id) DO UPDATE SET total=total+1 RETURNING total').bind(body.route).first();
        return json({route:body.route,total:row.total});
      }catch{return json({error:'counter_unavailable'},503);}
    }
    const qr=path==='/qr'||path==='/qr/'||path==='/qr/'+ROUTE_NUMBER;
    if(qr){if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:responseHeaders});return new Response(null,{status:302,headers:{...responseHeaders,Location:'/?from=qr'}});}
    if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:responseHeaders});
    const aliases={'/':'/index.html','/ryazan-walks':'/ryazan-walks.html','/privacy':'/privacy.html','/consent':'/consent.html'};
    const asset=ASSETS[aliases[path]||path];
    if(!asset)return new Response('Страница не найдена',{status:404,headers:{...responseHeaders,'Content-Type':'text/plain; charset=utf-8'}});
    const bytes=Uint8Array.from(atob(asset.body),c=>c.charCodeAt(0));
    return new Response(request.method==='HEAD'?null:bytes,{headers:{...responseHeaders,'Content-Type':asset.type,'Cache-Control':asset.type.startsWith('text/html')?'no-store':'public, max-age=3600'}});
  }
};
