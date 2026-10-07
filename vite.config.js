import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';
import { readdirSync } from 'node:fs';
import { seoPlugin } from './server/seo.mjs';

export default defineConfig(({ mode }) => {
  for (const [key,value] of Object.entries(loadEnv(mode,process.cwd(),''))) if (process.env[key] === undefined) process.env[key] = value;
  return {
  plugins: [seoPlugin(), {
    name: 'local-api',
    configureServer(server) {
      server.middlewares.use(async (req,res,next) => {
        const path = req.url?.split('?')[0];
        if (!path?.startsWith('/api/')) return next();
        const endpoint = path.slice(5);
        if (!['submit','auth','manage','email-retry','stripe-payment-intent','stripe-webhook','payment-status','vehicles','settings','admin-booking-review','admin-users'].includes(endpoint)) { res.statusCode=404; res.end(); return; }
        let body = '';
        for await (const chunk of req) { body += chunk; if(Buffer.byteLength(body)>24000) {res.statusCode=413;res.end();return;} }
        req.body=body;
        res.status=code=>{res.statusCode=code;return res;};
        res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
        try { const {default:handler}=await import(`./api/${endpoint}.mjs`); await handler(req,res); }
        catch {res.status(503).json({error:'Service temporarily unavailable.'});}
      });
    },
  }],
  build: {
    rollupOptions: {
      input: Object.fromEntries(readdirSync('.').filter(name=>name.endsWith('.html')).map(name=>[name.replace('.html',''),resolve(name)])),
    },
  },
}; });
