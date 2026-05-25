# AdMaster Pro — Environment Variables Checklist

צ'קליסט להשגה והגדרה של כל המשתנים הנדרשים לפרויקט.
מסומן ✅ אחרי שהערך נמצא והוגדר גם ב-`.env.local` וגם ב-Vercel.

| # | שם משתנה | חובה/אופציונלי | מאיפה להשיג (URL מדויק) | פורמט לדוגמה |
|---|---|---|---|---|
| 1 | `NEXT_PUBLIC_SUPABASE_URL` | חובה | https://supabase.com/dashboard → בחר פרויקט → Settings → API → **Project URL** | `https://abcdefghij.supabase.co` |
| 2 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | חובה | https://supabase.com/dashboard → Settings → API → **Project API keys** → `anon` `public` | `eyJhbGciOiJIUzI1NiIs...` (JWT, ~220 תווים) |
| 3 | `SUPABASE_SERVICE_ROLE_KEY` | חובה ⚠️ סודי | https://supabase.com/dashboard → Settings → API → **Project API keys** → `service_role` `secret` (לחץ Reveal) | `eyJhbGciOiJIUzI1NiIs...` (JWT, ~220 תווים) |
| 4 | `ANTHROPIC_API_KEY` | חובה ⚠️ סודי | https://console.anthropic.com/settings/keys → **Create Key** | `sk-ant-api03-XXXX...` |
| 5 | `META_APP_ID` | חובה | https://developers.facebook.com/apps/ → בחר App → Settings → Basic → **App ID** | `1234567890123456` (15-16 ספרות) |
| 6 | `META_APP_SECRET` | חובה ⚠️ סודי | https://developers.facebook.com/apps/ → App → Settings → Basic → **App Secret** (לחץ Show) | `a1b2c3d4e5f6...` (32 תווי hex) |
| 7 | `META_WEBHOOK_VERIFY_TOKEN` | חובה | להמציא מחרוזת אקראית חזקה ולהעתיק גם ל-Meta App → Webhooks → Verify Token | `my-random-webhook-secret-2026` |
| 8 | `STRIPE_SECRET_KEY` | חובה ⚠️ סודי | https://dashboard.stripe.com/apikeys → **Secret key** (Reveal live key) | `sk_live_51XXXX...` או `sk_test_51XXXX...` |
| 9 | `STRIPE_WEBHOOK_SECRET` | חובה ⚠️ סודי | https://dashboard.stripe.com/webhooks → לחץ על ה-endpoint → **Signing secret** → Reveal | `whsec_XXXX...` |
| 10 | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | חובה | https://dashboard.stripe.com/apikeys → **Publishable key** | `pk_live_51XXXX...` או `pk_test_51XXXX...` |
| 11 | `NEXT_PUBLIC_APP_URL` | חובה | ה-URL הציבורי של ה-deployment — דומיין מותאם או Vercel URL (ללא `/` בסוף) | `https://admaster-pro.co.il` |
| 12 | `IDEOGRAM_API_KEY` | אופציונלי | https://ideogram.ai/manage-api → **Create API Key** | `ideogram-XXXX...` |

## איך להגדיר אחרי שיש לי את הערכים

1. מלא את הערכים ב-`.env.local` בשורש הפרויקט (לפיתוח מקומי).
2. הגדר את אותם ערכים ב-Vercel:
   - דרך הדאשבורד: Project Settings → Environment Variables → לכל משתנה בחר Production + Preview + Development.
   - או דרך CLI: `vercel env add <NAME>` (תתבקש להזין ערך וסביבה).
3. עשה Redeploy אחרון כדי שה-build יקח את הערכים החדשים.

⚠️ **אזהרת אבטחה**: אסור לדחוף את `.env.local` ל-git (כבר ב-`.gitignore`). אסור להדביק מפתחות עם `SERVICE_ROLE` / `SECRET` ב-chat ציבורי, ב-PR, או ב-screenshot.
