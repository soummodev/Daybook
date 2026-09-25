# Deploy Daybook to Vercel

The `404 NOT_FOUND` page happens when Vercel cannot find a deployable app entry point or the wrong folder was uploaded. This project now includes `api/index.py` and `vercel.json`, which route `/` and every API path to FastAPI.

## Deploy the correct folder

1. Extract `daybook.zip`.
2. Upload/import the **`daybook` folder itself** — the folder that directly contains `main.py`, `api/`, `requirements.txt`, and `vercel.json`.
3. Do not upload the ZIP file as-is or a parent folder that merely contains the `daybook` folder.
4. In Vercel Project Settings → Environment Variables, add `DATABASE_URL` for every required environment (Production and Preview).
5. Redeploy after adding the environment variable.

## PostgreSQL for Vercel

Your local database at `127.0.0.1:5433` cannot be reached from Vercel. Create a hosted PostgreSQL database, for example from Vercel Marketplace (Neon), then set its connection string as `DATABASE_URL`.

Use this SQLAlchemy format:

```text
postgresql+psycopg://USERNAME:PASSWORD@HOST:5432/DATABASE?sslmode=require
```

If a Vercel Marketplace integration creates `POSTGRES_URL`, the app can use that automatically; `DATABASE_URL` is still the recommended explicit setting.

## After deployment

Open the Vercel deployment URL, create a new account, and log in. Set `COOKIE_SECURE=true` in Vercel Environment Variables because Vercel deploys over HTTPS.
