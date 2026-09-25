# Daybook — FastAPI + PostgreSQL

This version stores user accounts and tracker data in PostgreSQL, so the same email/password works on every device after deployment.

## Run locally

1. Install PostgreSQL and create a database named `daybook`.
2. Create and activate a Python virtual environment.
3. Install dependencies: `pip install -r requirements.txt`
4. Copy `.env.example` to `.env`, then set `DATABASE_URL` for your PostgreSQL user.
5. Start the server: `uvicorn main:app --reload`
6. Open `http://127.0.0.1:8000` (do not open `index.html` directly).

The app creates its own tables on first start. For deployment, use an HTTPS host and set `COOKIE_SECURE=true`.

For Vercel deployment instructions, see `VERCEL-DEPLOY.md`.

## Security

- Passwords are bcrypt-hashed on the server.
- Login session tokens are HTTP-only cookies.
- Each account has its own PostgreSQL data record.
