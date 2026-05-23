# 🚀 AdMaster Pro — מדריך דפלוי מלא

## סקירה — מה עושים

```
קוד מקומי  →  GitHub  →  Vercel  →  admaster-pro.co.il
     ↓                        ↓
  .env.local           env variables
                             ↓
                        Supabase DB
```

---

## שלב 1 — הכנת הפרויקט מקומית

```bash
# פתח terminal בתיקיית הפרויקט
cd admaster-pro

# התקן dependencies
npm install

# צור .env.local
cp .env.example .env.local
```

פתח `.env.local` ומלא (ראה שלב 2 + 3):

---

## שלב 2 — הגדרת Supabase

### 2.1 צור פרויקט
1. כנס ל-**[supabase.com](https://supabase.com)** → "New project"
2. שם: `admaster-pro`, בחר region: **Europe (Frankfurt)**
3. המתן ~2 דקות

### 2.2 הרץ את ה-Schema
1. בתפריט שמאל: **SQL Editor** → "New query"
2. פתח `supabase/migrations/001_schema.sql`
3. העתק הכל → הדבק ב-SQL Editor → לחץ **Run**
4. אמור לראות: ✅ Success. No rows returned

### 2.3 קבל את המפתחות
1. **Settings** → **API**
2. העתק:
   - `URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY` ⚠️ שמור בסוד!

### 2.4 הגדר Auth
1. **Authentication** → **Providers** → ודא Email מופעל
2. **Authentication** → **URL Configuration**:
   - Site URL: `https://admaster-pro.co.il`
   - Redirect URLs הוסף: `https://admaster-pro.co.il/**`
   - לפיתוח הוסף: `http://localhost:3000/**`

---

## שלב 3 — Anthropic API Key

1. כנס ל-**[console.anthropic.com](https://console.anthropic.com)**
2. **API Keys** → "Create Key"
3. העתק → `ANTHROPIC_API_KEY=sk-ant-...`

> 💰 מחיר: Claude Sonnet ~$3/1M tokens קלט, ~$15/1M פלט
> לשימוש רגיל: ~$20-50/חודש

---

## שלב 4 — GitHub

```bash
# אתחל git
git init
git add .
git commit -m "Initial commit — AdMaster Pro"

# צור repo ב-GitHub (github.com → New repository)
# שם: admaster-pro
# Private ✅

# חבר ופוש
git remote add origin https://github.com/YOUR_USERNAME/admaster-pro.git
git branch -M main
git push -u origin main
```

---

## שלב 5 — Vercel

### 5.1 צור חשבון + Import
1. כנס ל-**[vercel.com](https://vercel.com)** → Sign up עם GitHub
2. **Add New Project** → Import `admaster-pro`
3. Framework: **Next.js** (אוטומטי)
4. **לא** תלחץ Deploy עדיין

### 5.2 הגדר Environment Variables
ב-Vercel dashboard → Settings → Environment Variables → הוסף כל אחד:

| שם משתנה | ערך | Environments |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxx.supabase.co` | All |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbGc...` | All |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGc...` | **Production only** |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | All |
| `NEXT_PUBLIC_APP_URL` | `https://admaster-pro.co.il` | Production |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Development |
| `STRIPE_SECRET_KEY` | `sk_test_...` | All (אחר כך) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | Production (אחר כך) |

### 5.3 Deploy
1. חזור ל-"Deploy" → לחץ **Deploy**
2. המתן ~2-3 דקות
3. Vercel ייתן לך URL זמני: `admaster-pro-xxx.vercel.app`

✅ בדוק שהאתר עולה!

---

## שלב 6 — דומיין .co.il

### 6.1 רכישת דומיין (אם עוד אין)
אפשרויות בישראל:
- **[isoc.org.il](https://isoc.org.il)** — רשות האינטרנט הישראלית
- **[godaddy.com](https://godaddy.com)** — בינלאומי, תומך .co.il
- **[namecheap.com](https://namecheap.com)** — בינלאומי
- **[hostinger.co.il](https://hostinger.co.il)** — ישראלי

> 💰 מחיר: ~₪30-80/שנה

### 6.2 חיבור דומיין ל-Vercel

**ב-Vercel:**
1. **Settings** → **Domains** → Add Domain
2. הקלד: `admaster-pro.co.il`
3. Vercel יראה לך **2 רשומות DNS** להוסיף:

```
Type: A
Name: @
Value: 76.76.21.21

Type: CNAME
Name: www
Value: cname.vercel-dns.com
```

**אצל רשם הדומיין (DNS Management):**
1. כנס לממשק ניהול הדומיין שלך
2. מצא "DNS Records" או "Name Servers"
3. הוסף את שתי הרשומות מהשלב הקודם
4. המתן **10-30 דקות** עד לפרופגציה

> ⚠️ .co.il דורש לפעמים תהליך אימות נפרד — בדוק עם הרשם

### 6.3 HTTPS אוטומטי
Vercel מוציא SSL (Let's Encrypt) אוטומטית לאחר אימות הדומיין.
✅ תקבל https://admaster-pro.co.il

---

## שלב 7 — עדכון Supabase לדומיין החדש

**Authentication** → **URL Configuration**:
- Site URL: `https://admaster-pro.co.il`

---

## שלב 8 — Stripe (תשלומים)

### 8.1 צור חשבון Stripe
1. **[stripe.com](https://stripe.com)** → הרשמה
2. עבור למצב **Live** (לאחר בדיקות)

### 8.2 צור מוצרים
**Products** → Add product:

| שם | מחיר | Billing | Price ID |
|---|---|---|---|
| Starter | ₪79 | Monthly | `price_xxx_starter` |
| Pro | ₪199 | Monthly | `price_xxx_pro` |
| Agency | ₪499 | Monthly | `price_xxx_agency` |

העתק Price IDs → הוסף ל-Vercel env:
```
STRIPE_PRICE_STARTER=price_xxx
STRIPE_PRICE_PRO=price_xxx
STRIPE_PRICE_AGENCY=price_xxx
```

### 8.3 Webhook
1. **Developers** → **Webhooks** → Add endpoint
2. URL: `https://admaster-pro.co.il/api/credits/webhook`
3. Events לבחור:
   - `checkout.session.completed`
   - `invoice.paid`
   - `customer.subscription.deleted`
4. העתק Signing secret → `STRIPE_WEBHOOK_SECRET`

---

## שלב 9 — Meta App (לחיבור לקוחות)

### 9.1 צור Facebook App
1. **[developers.facebook.com](https://developers.facebook.com)** → My Apps → Create App
2. סוג: **Business**
3. שם: `AdMaster Pro`

### 9.2 הוסף Products
- **Facebook Login** → Settings:
  - Valid OAuth Redirect URIs: `https://admaster-pro.co.il`
- **Marketing API** → הפעל

### 9.3 App Settings
- App ID → `META_APP_ID`
- App Secret → `META_APP_SECRET`

### 9.4 לקוחות — איך מקבלים Token
לכל לקוח:
1. כנס ל-**[developers.facebook.com/tools/explorer](https://developers.facebook.com/tools/explorer)**
2. בחר את האפליקציה: `AdMaster Pro`
3. הרשאות נדרשות:
   ```
   pages_manage_posts
   pages_read_engagement
   ads_management
   ads_read
   instagram_basic
   ```
4. "Generate Access Token" → אשר
5. **Long-lived token** (מומלץ):
   ```
   GET https://graph.facebook.com/v19.0/oauth/access_token
     ?grant_type=fb_exchange_token
     &client_id={APP_ID}
     &client_secret={APP_SECRET}
     &fb_exchange_token={SHORT_TOKEN}
   ```

---

## Deploy אוטומטי (CI/CD)

כל `git push` ל-`main` יעשה deploy אוטומטי ב-Vercel.

```bash
# שינוי קוד → commit → push → deploy אוטומטי
git add .
git commit -m "feat: add new feature"
git push origin main
# Vercel יבנה ויפרסם תוך ~2 דקות
```

---

## תיקון בעיות נפוצות

### ❌ "Module not found"
```bash
npm install
```

### ❌ Supabase connection error
- בדוק ש-env vars מוגדרים נכון
- ודא שה-schema רץ בהצלחה

### ❌ 401 Unauthorized
- ודא שה-middleware עובד
- בדוק Supabase Auth settings

### ❌ Meta API error
- Token פג תוקף — חדש
- בדוק הרשאות ב-Graph API Explorer

---

## עלות חודשית בייצור

| שירות | תוכנית | עלות |
|---|---|---|
| Vercel | Pro | $20 |
| Supabase | Pro | $25 |
| Anthropic | Pay-per-use | ~$30-60 |
| Stripe | 2.9% + $0.30 | משתנה |
| דומיין | — | ₪5/חודש |
| **סה"כ** | | **~$75-110/חודש** |

> 💡 בתחילה: Vercel Free + Supabase Free = **$0** (עד לגדילה)
