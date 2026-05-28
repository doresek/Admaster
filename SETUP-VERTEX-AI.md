# Vertex AI Setup — Gemini Nano Banana

Google's image-gen Gemini models (`gemini-2.5-flash-image`, `gemini-3-pro-image-preview`) are
**not available** through the regular AI Studio API key path — they're locked behind a
"free tier, limit: 0" gate on most accounts. The official way to get billed access is
through **Vertex AI** with a **Service Account**.

## One-time setup (~10 minutes)

### 1. Enable billing on your Google Cloud project

```
https://console.cloud.google.com/billing
```

Make sure your project has a billing account linked. (You already did this.)

### 2. Enable the Vertex AI API

```
https://console.cloud.google.com/apis/library/aiplatform.googleapis.com
```

Click **ENABLE**.

### 3. Create a Service Account

```
https://console.cloud.google.com/iam-admin/serviceaccounts
```

- Click **CREATE SERVICE ACCOUNT**
- Name: `admaster-vertex-image-gen`
- Click **CREATE AND CONTINUE**
- Grant role: **Vertex AI User** (`roles/aiplatform.user`)
- Click **DONE**

### 4. Create a JSON key

- Click on the service account you just created
- Tab: **KEYS** → **ADD KEY** → **Create new key**
- Key type: **JSON**
- Click **CREATE** — a `.json` file downloads automatically

### 5. Add the JSON to `.env.local`

The JSON must be on a single line. Run:

```sh
jq -c . /path/to/admaster-vertex-image-gen-XXXXX.json
```

Copy the output and paste it as the value of `GOOGLE_SERVICE_ACCOUNT_JSON` in `.env.local`:

```env
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"admaster-vertex-image-gen@PROJECT.iam.gserviceaccount.com",...}
```

> ⚠️ The single-line JSON has escaped `\n` inside `private_key` — that's correct, leave them as-is.

### 6. Restart the dev server

```sh
npm run dev:webpack
```

### 7. Test

```sh
node scripts/test-image-flow.js
```

Or in the browser: `http://localhost:3000/images` → select "🍌 Gemini Nano Banana" → generate.

## Pricing

- `gemini-2.5-flash-image` (default): ~$0.039 / image
- `gemini-3-pro-image-preview` (set `GEMINI_IMAGE_MODEL=gemini-3-pro-image-preview`): ~$0.06 / image

Set a budget alert at https://console.cloud.google.com/billing/budgets to avoid surprises.

## Troubleshooting

| Error | Fix |
|---|---|
| `Missing GOOGLE_SERVICE_ACCOUNT_JSON` | Add the env var and restart |
| `Invalid GOOGLE_SERVICE_ACCOUNT_JSON: Unexpected token` | The JSON isn't single-line. Use `jq -c .` |
| `403 Permission denied` on Vertex | Service account missing `roles/aiplatform.user` |
| `404 Model not found` | Wrong location. Try `us-central1`. Or model not available in your region. |
| `429 Quota exceeded` | Billing not linked to this project. See step 1. |

## Security

- The service account JSON has **full Vertex AI access**. Treat it like a password.
- `.env.local` is in `.gitignore` — never commit it.
- In production (Vercel), paste the JSON into the env-var UI (not as a file).
- Rotate the key periodically: Service Accounts → Keys → delete old, create new.
