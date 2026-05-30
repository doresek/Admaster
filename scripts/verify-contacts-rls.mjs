#!/usr/bin/env node
// READ-ONLY verification of public.contacts RLS state on PROD.
// No writes. No PII pulled — only exact row COUNTS via HEAD requests.
//
// Logic:
//   N = count visible to service_role (bypasses RLS) = true total
//   M = count visible to an ordinary authenticated user (QA login)
//     M > 0            -> authenticated can read -> broad policy STILL present -> VULNERABLE
//     M == 0 && N > 0  -> RLS denies authenticated reads -> FIXED
//     N == 0           -> table empty -> inconclusive (can't distinguish)

import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter(l => l && !l.trimStart().startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const QA_EMAIL = process.env.QA_EMAIL || 'qa-ms-26052026@gmail.com';
const QA_PASS = process.env.QA_PASS || 'QaTest123!';

// HEAD count=exact -> Content-Range: "*/N". Returns null if not permitted.
// apikey must match the bearer token's key (anon-key for user JWTs,
// service key for the service_role bearer).
async function count(token, apikey) {
  const r = await fetch(`${URL_}/rest/v1/contacts?select=id`, {
    method: 'HEAD',
    headers: { apikey, Authorization: `Bearer ${token}`, Prefer: 'count=exact', Range: '0-0' },
  });
  const cr = r.headers.get('content-range'); // e.g. "0-0/12" or "*/0"
  const total = cr ? Number(cr.split('/')[1]) : null;
  return { status: r.status, total };
}

async function main() {
  console.log(`\n=== contacts RLS verification (READ-ONLY) against ${URL_} ===\n`);

  const svc = await count(SERVICE, SERVICE);
  console.log(`service_role count: HTTP ${svc.status}, total=${svc.total}`);

  const auth = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: QA_EMAIL, password: QA_PASS }),
  });
  if (auth.status !== 200) { console.error('❌ QA login failed:', auth.status, (await auth.text()).slice(0, 200)); process.exit(2); }
  const userToken = (await auth.json()).access_token;
  console.log(`logged in as ${QA_EMAIL} (authenticated role)`);

  const usr = await count(userToken, ANON);
  console.log(`authenticated count: HTTP ${usr.status}, total=${usr.total}`);

  console.log('\n=== RESULT ===');
  if (usr.total != null && usr.total > 0) {
    console.log(`❌ VULNERABLE — authenticated user can read ${usr.total} contact row(s). Broad SELECT policy STILL present in prod.`);
    console.log(`   FIX: drop policy if exists "contacts_authenticated_select" on public.contacts;`);
    process.exit(1);
  } else if (svc.total != null && svc.total > 0 && (usr.total === 0 || usr.total == null)) {
    console.log(`✅ FIXED — service_role sees ${svc.total} row(s) but authenticated user sees ${usr.total ?? 'none'}. RLS denies SELECT to ordinary users; only service_role reads contacts.`);
    process.exit(0);
  } else if (svc.total === 0) {
    console.log(`⚠️ INCONCLUSIVE — contacts table is empty (service_role total=0), so an authenticated 0-count can't distinguish "fixed" from "no data". Verify via SQL Editor: select polname from pg_policies where tablename='contacts';`);
    process.exit(0);
  } else {
    console.log(`⚠️ INCONCLUSIVE — svc.total=${svc.total}, usr.total=${usr.total}. Verify manually.`);
    process.exit(0);
  }
}

main().catch(e => { console.error('Unhandled:', e); process.exit(3); });
