import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { load } from 'cheerio';
import { pages } from '../server/seo.mjs';
const files=fs.readdirSync('dist').filter(f=>f.endsWith('.html'));
test('every built page has metadata, one h1, a main landmark, and no broken local links',()=>{
  const titles=new Set();
  for(const file of files) {
    const $=load(fs.readFileSync(`dist/${file}`,'utf8'));
    const title=$('title').text();assert.ok(!titles.has(title),`duplicate title ${file}`);titles.add(title);
    assert.equal($('h1').length,1,`h1 ${file}`);
    assert.equal($('main').length,1,`main ${file}`);
    assert.ok($('meta[name=description]').attr('content'),`description ${file}`);
    assert.ok($('link[rel=canonical]').attr('href').startsWith('https://www.breezyeevans.co.uk/'));
    assert.equal($('meta[name=robots]').attr('content'),pages[file.replace('.html','')]?'index,follow':'noindex,nofollow');
    $('a[href]').each((_,a)=>{
      const href=$(a).attr('href');if(/^(https?:|mailto:|tel:)/.test(href))return;
      if(href==='#' && $(a).attr('id')==='signOutLink')return;
      const url=new URL(href,`https://test/${file}`);
      const path=url.pathname==='/'?'index.html':url.pathname.slice(1).replace(/\.html$/,'')+'.html';
      assert.ok(fs.existsSync(`dist/${path}`),`broken ${file} -> ${href}`);
      if(url.hash) { const target=path===file?$:load(fs.readFileSync(`dist/${path}`,'utf8'));assert.ok(target(`[id="${url.hash.slice(1)}"]`).length,`missing anchor ${file} -> ${href}`); }
    });
    $('img').each((_,img)=>assert.ok($(img).attr('alt')!==undefined,`image alt ${file}`));
  }
});
test('sitemap excludes account pages and robots references canonical sitemap',()=>{
  const sitemap=fs.readFileSync('dist/sitemap.xml','utf8');
  assert.ok(!/dashboard|login|admin-|api\//.test(sitemap));
  assert.equal((sitemap.match(/<loc>/g)||[]).length,Object.keys(pages).length);
  assert.match(fs.readFileSync('dist/robots.txt','utf8'),/Sitemap: https:\/\/www.breezyeevans.co.uk\/sitemap.xml/);
});
test('client bundle contains no server credentials or fake payment flow',()=>{
  const bundle=fs.readdirSync('dist/assets').filter(f=>f.endsWith('.js')).map(f=>fs.readFileSync(`dist/assets/${f}`,'utf8')).join('');
  for(const secretName of ['RESEND_API_KEY','RECAPTCHA_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY','RATE_LIMIT_SECRET']) assert.ok(!bundle.includes(secretName));
  assert.ok(!bundle.includes('Mark as paid'));
});
