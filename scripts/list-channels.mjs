import { chromium } from 'playwright';
const APP='http://localhost:3007', EMAIL='elirankahalani27@gmail.com', PW='0503377';
const CLIENT='2385b553-1bce-4749-bc8c-25db26524ad7';
const b=await chromium.launch({headless:true}); const p=await (await b.newContext()).newPage();
try{
  async function login(){await p.goto(`${APP}/login`,{waitUntil:'networkidle'});await p.waitForTimeout(1600);
    await p.fill('input[type=email]',EMAIL);await p.fill('input[type=password]',PW);await p.waitForTimeout(300);
    await p.click('button[type=submit]');await p.waitForURL(u=>!u.toString().includes('/login'),{timeout:20000}).catch(()=>{});return !p.url().includes('/login');}
  let ok=await login(); if(!ok) ok=await login(); if(!ok) throw new Error('login failed');
  const d=await p.evaluate(async (c)=> fetch(`/api/meta/channels?clientId=${c}`).then(r=>r.json()), CLIENT);
  console.log('PAGES:'); (d.pages||[]).forEach(x=>console.log(`  - ${x.name}  [${x.id}]`));
  console.log('AD ACCOUNTS:'); (d.adAccounts||[]).forEach(x=>console.log(`  - ${x.name}  [${x.id}]`));
  console.log('current selectedPageId:', d.selectedPageId, '| selectedAdAccountId:', d.selectedAdAccountId);
}catch(e){console.error('FAIL',e.message);process.exitCode=1;}finally{await b.close();}
