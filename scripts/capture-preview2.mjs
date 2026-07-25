import { chromium } from 'playwright';
const APP='http://localhost:3007', EMAIL='elirankahalani27@gmail.com', PW='0503377';
const CLIENT='2385b553-1bce-4749-bc8c-25db26524ad7', APPROVAL='90d57f65-567f-4409-918e-059fa94093e8';
const PAGE='1156644177524326';            // אלירן שיווק לעסקים (correct)
const ADACC='act_1504943103412983';       // Eliran Kahalani
const b=await chromium.launch({headless:true}); const ctx=await b.newContext(); const p=await ctx.newPage();
try{
  async function login(){await p.goto(`${APP}/login`,{waitUntil:'networkidle'});await p.waitForTimeout(1600);
    await p.fill('input[type=email]',EMAIL);await p.fill('input[type=password]',PW);await p.waitForTimeout(300);
    await p.click('button[type=submit]');await p.waitForURL(u=>!u.toString().includes('/login'),{timeout:20000}).catch(()=>{});return !p.url().includes('/login');}
  let ok=await login(); if(!ok) ok=await login(); if(!ok) throw new Error('login failed');
  const html=await p.evaluate(async ({client,approval,page,adacc})=>{
    const r=await fetch('/api/meta/preview',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({clientId:client,approvalId:approval,headline:'אימון אישי — שיחת היכרות חינם',cta:'LEARN_MORE',
        destination:{type:'external_url',value:'https://admaster-three.vercel.app'},pageId:page,adAccountId:adacc})});
    const j=await r.json(); return j.previewHtml||JSON.stringify(j);
  },{client:CLIENT,approval:APPROVAL,page:PAGE,adacc:ADACC});
  if(!html.startsWith('<')) throw new Error('no preview: '+html.slice(0,200));
  const pv=await ctx.newPage(); await pv.setViewportSize({width:560,height:760});
  await pv.setContent(`<html><body style="margin:0;background:#f0f2f5;display:flex;justify-content:center;padding:16px;">${html}</body></html>`,{waitUntil:'networkidle'});
  await pv.waitForTimeout(5000); await pv.screenshot({path:'/tmp/ad-preview2.png'});
  console.log('saved /tmp/ad-preview2.png');
}catch(e){console.error('FAIL',e.message);process.exitCode=1;}finally{await b.close();}
