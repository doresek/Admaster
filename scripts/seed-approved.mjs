import { chromium } from 'playwright';
const APP='http://localhost:3007', EMAIL='elirankahalani27@gmail.com', PW='0503377';
const IMG='https://racywcnflunsdyxbmlms.supabase.co/storage/v1/object/public/generated-images/bfc4a212-6efe-4193-96fd-69055f843658/1780177281580-j4s1vv.png';
const b=await chromium.launch({headless:true});
const p=await (await b.newContext()).newPage();
try{
  async function login(){await p.goto(`${APP}/login`,{waitUntil:'networkidle'});await p.waitForTimeout(1600);
    await p.fill('input[type=email]',EMAIL);await p.fill('input[type=password]',PW);await p.waitForTimeout(300);
    await p.click('button[type=submit]');await p.waitForURL(u=>!u.toString().includes('/login'),{timeout:20000}).catch(()=>{});return !p.url().includes('/login');}
  let ok=await login(); if(!ok) ok=await login(); if(!ok) throw new Error('login failed');
  const out=await p.evaluate(async (img)=>{
    const create=await fetch('/api/approvals',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({title:'מאמן כושר — מודעת בדיקה',content:{text:'רוצה להתחיל להתאמן עם ליווי אישי? אימון ראשון חינם 💪 קבע פגישת היכרות עוד היום.',image_url:img}})}).then(r=>r.json());
    if(!create.token) return {err:'create failed',create};
    const appr=await fetch('/api/approvals/public',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({token:create.token,status:'approved'})}).then(r=>r.json());
    const list=await fetch('/api/approvals').then(r=>r.json());
    const approved=Array.isArray(list)?list.filter(a=>a.status==='approved'):[];
    return {approvalId:create.approval?.id,approveResp:appr,approvedCount:approved.length};
  },IMG);
  console.log(JSON.stringify(out,null,2));
}catch(e){console.error('FAIL',e.message);process.exitCode=1;}finally{await b.close();}
