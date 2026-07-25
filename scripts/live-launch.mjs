import { chromium } from 'playwright';
const APP='http://localhost:3007', EMAIL='elirankahalani27@gmail.com', PW='0503377';
const CLIENT='2385b553-1bce-4749-bc8c-25db26524ad7', APPROVAL='90d57f65-567f-4409-918e-059fa94093e8';
const PAGE='1156644177524326';           // אלירן שיווק לעסקים (correct page)
const ADACC='act_1504943103412983';      // Eliran Kahalani
const b=await chromium.launch({headless:true}); const p=await (await b.newContext()).newPage();
try{
  async function login(){await p.goto(`${APP}/login`,{waitUntil:'networkidle'});await p.waitForTimeout(1600);
    await p.fill('input[type=email]',EMAIL);await p.fill('input[type=password]',PW);await p.waitForTimeout(300);
    await p.click('button[type=submit]');await p.waitForURL(u=>!u.toString().includes('/login'),{timeout:20000}).catch(()=>{});return !p.url().includes('/login');}
  let ok=await login(); if(!ok) ok=await login(); if(!ok) throw new Error('login failed');
  const out=await p.evaluate(async ({client,approval,page,adacc})=>{
    const body={
      clientId:client, approvalId:approval,
      headline:'אימון אישי — שיחת היכרות חינם',
      cta:'LEARN_MORE',
      destination:{type:'external_url',value:'https://admaster-three.vercel.app'},
      targeting:{ageMin:25,ageMax:55,genders:'all',geo:{countries:['IL']},interests:[],dailyBudget:7000,rationale:''},
      budget:7000,
      pageId:page, adAccountId:adacc,
    };
    const r=await fetch('/api/meta/launch',{method:'POST',
      headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},
      body:JSON.stringify(body)});
    return {status:r.status, data:await r.json().catch(()=>({}))};
  },{client:CLIENT,approval:APPROVAL,page:PAGE,adacc:ADACC});
  console.log(JSON.stringify(out,null,2));
}catch(e){console.error('FAIL',e.message);process.exitCode=1;}finally{await b.close();}
