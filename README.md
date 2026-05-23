# AdMaster Pro 🚀

AI Social Media Platform — Next.js + Supabase + Vercel

---

## Stack

| Layer     | Technology          |
|-----------|---------------------|
| Frontend  | Next.js 14 (App Router) |
| Hosting   | Vercel              |
| Database  | Supabase (PostgreSQL) |
| Auth      | Supabase Auth       |
| AI        | Anthropic Claude    |
| Payments  | Stripe              |
| Ads API   | Meta Graph API v19  |

---

## Setup — Step by Step

### 1. Clone & install
```bash
git clone https://github.com/you/admaster-pro
cd admaster-pro
npm install
```

### 2. Create Supabase project
1. Go to [supabase.com](https://supabase.com) → New project
2. Copy your project URL and anon key
3. Go to **SQL Editor** → paste contents of `supabase/migrations/001_schema.sql` → Run

### 3. Configure environment
```bash
cp .env.example .env.local
# Fill in all values
```

Required:
- `NEXT_PUBLIC_SUPABASE_URL` — from Supabase dashboard
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from Supabase dashboard
- `SUPABASE_SERVICE_ROLE_KEY` — from Supabase dashboard (keep secret!)
- `ANTHROPIC_API_KEY` — from [console.anthropic.com](https://console.anthropic.com)

### 4. Run locally
```bash
npm run dev
# → http://localhost:3000
```

### 5. Meta API setup
1. Go to [developers.facebook.com](https://developers.facebook.com) → Create App → Business type
2. Add products: **Facebook Login**, **Marketing API**
3. Copy App ID and App Secret → add to `.env.local`
4. For each client: use Graph API Explorer to get their User Access Token
   - Permissions needed: `pages_manage_posts`, `ads_management`, `ads_read`, `pages_read_engagement`

### 6. Stripe setup (payments)
1. Create account at [stripe.com](https://stripe.com)
2. Create 3 products in Stripe dashboard:
   - Starter — ₪79/month
   - Pro — ₪199/month  
   - Agency — ₪499/month
3. Copy price IDs → add to `.env.local` as `STRIPE_PRICE_STARTER`, etc.
4. Set up webhook: `https://yourdomain.co.il/api/credits/webhook`
   - Events: `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`

### 7. Deploy to Vercel
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Add environment variables in Vercel dashboard
# → Settings → Environment Variables
```

Or connect GitHub repo to Vercel for automatic deploys.

---

## Project Structure

```
admaster-pro/
├── app/
│   ├── (auth)/          # Login, Register pages
│   ├── (dashboard)/     # All protected pages
│   │   ├── layout.tsx   # Sidebar layout
│   │   ├── page.tsx     # Dashboard
│   │   ├── brand/       # Brand DNA
│   │   ├── briefs/      # Client briefs list
│   │   ├── create/      # Create post
│   │   ├── analyze/     # Analyze ad
│   │   ├── variations/  # A/B variations
│   │   ├── calendar/    # Jewish holidays
│   │   ├── clients/     # Meta clients
│   │   ├── publish/     # Publish to Meta
│   │   ├── campaign/    # Campaign builder
│   │   └── credits/     # Credits & plans
│   ├── brief/           # Client brief form (no auth)
│   └── api/
│       ├── ai/          # Claude AI calls
│       ├── meta/        # Meta Graph API proxy
│       ├── briefs/      # Brief management
│       └── credits/     # Stripe payments
├── components/          # Reusable UI components
├── lib/
│   ├── supabase/        # DB clients
│   └── hooks/           # useAI, useMeta
├── types/               # TypeScript types
├── middleware.ts         # Auth protection
└── supabase/
    └── migrations/      # SQL schema
```

---

## Credit System

| Action              | Cost |
|---------------------|------|
| יצירת פוסט          | 3    |
| ניתוח מודעה         | 5    |
| וריאציות            | 8    |
| פוסט לחג            | 3    |
| פרסום פוסט          | 2    |
| בניית קמפיין        | 15   |
| בניית אווטאר        | 10   |
| מודעות מאווטאר      | 8    |
| משפך שיווקי         | 12   |

---

## Security Notes

- **Never expose `SUPABASE_SERVICE_ROLE_KEY` to client** — server-side only
- **Meta tokens** are stored in DB and only accessed server-side via `/api/meta`
- **RLS** is enabled on all tables — users can only see their own data
- **Credit deduction** is atomic via DB function — no double-spending possible
- In production, consider **Supabase Vault** for encrypting Meta tokens

---

## License
Private — All rights reserved
