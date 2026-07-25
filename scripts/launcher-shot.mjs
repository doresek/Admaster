import { chromium } from 'playwright';
const APP='http://localhost:3007', EMAIL='elirankahalani27@gmail.com', PW='0503377';
const b=await chromium.launch({headless:true});
const p=await (await b.newContext()).newPage();
try{
  async function login(){await p.goto(`${APP}/login`,{waitUntil:'networkidle'});await p.waitForTimeout(1800);
    await p.fill('input[type=email]',EMAIL);await p.fill('input[type=password]',PW);await p.waitForTimeout(400);
    await p.click('button[type=submit]');await p.waitForURL(u=>!u.toString().includes('/login'),{timeout:20000}).catch(()=>{});return !p.url().includes('/login');}
  let ok=await login(); if(!ok) ok=await login(); if(!ok) ok=await login(); if(!ok) throw new Error('login failed');
  await p.goto(`${APP}/ads-launcher`,{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(3000);
  await p.screenshot({path:'/tmp/ads-launcher.png',fullPage:true});
  const approvedCards=await p.locator('button:has-text("מודעה")').count();
  console.log('shot saved; url=',p.url(),'cards~',approvedCards);
}catch(e){console.error('FAIL',e.message);process.exitCode=1;}finally{await b.close();}
