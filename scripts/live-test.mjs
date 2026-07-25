import { chromium } from 'playwright';
const APP='http://localhost:3007', EMAIL='elirankahalani27@gmail.com', PW='0503377';
const CLIENT='2385b553-1bce-4749-bc8c-25db26524ad7';
const APPROVAL='90d57f65-567f-4409-918e-059fa94093e8';
const b=await chromium.launch({headless:true});
const p=await (await b.newContext()).newPage();
try{
  async function login(){await p.goto(`${APP}/login`,{waitUntil:'networkidle'});await p.waitForTimeout(1600);
    await p.fill('input[type=email]',EMAIL);await p.fill('input[type=password]',PW);await p.waitForTimeout(300);
    await p.click('button[type=submit]');await p.waitForURL(u=>!u.toString().includes('/login'),{timeout:20000}).catch(()=>{});return !p.url().includes('/login');}
  let ok=await login(); if(!ok) ok=await login(); if(!ok) throw new Error('login failed');
  const r=await p.evaluate(async ({client,approval})=>{
    const out={};
    // set active client
    await fetch('/api/active-client',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:client})});
    // targeting
    const tRes=await fetch('/api/meta/targeting',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId:client,approvalId:approval})});
    out.targetingStatus=tRes.status; out.targeting=await tRes.json().catch(()=>({}));
    // preview (external_url destination)
    const pvRes=await fetch('/api/meta/preview',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({clientId:client,approvalId:approval,headline:'אימון אישי — שיחת היכרות חינם',cta:'LEARN_MORE',destination:{type:'external_url',value:'https://admaster-three.vercel.app'}})});
    out.previewStatus=pvRes.status; const pv=await pvRes.json().catch(()=>({}));
    out.preview = pv.previewHtml ? {ok:true, htmlLen:pv.previewHtml.length, link:pv.link} : pv;
    return out;
  },{client:CLIENT,approval:APPROVAL});
  console.log(JSON.stringify(r,null,2));
}catch(e){console.error('FAIL',e.message);process.exitCode=1;}finally{await b.close();}
