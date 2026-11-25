import {startServer} from './server-lib.mjs';
const port=Number(process.argv.find(a=>a.startsWith('--port='))?.split('=')[1]||process.env.PORT||4173);
const server=startServer(port,{memory:process.argv.includes('--memory')});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit()));
