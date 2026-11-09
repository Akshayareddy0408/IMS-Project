# Deploying HostelCare IMS (Render API + Vercel frontend)

## Before deployment
1. Push the project folder to a GitHub repository. Do not commit `.env` files or secrets.
2. Create/configure your Supabase project. For a new project, run `database/supabase_schema.sql`; for an existing project, inspect and apply the required migrations in the documented order. Do not rerun the base schema over an existing production database.
3. In Supabase Auth URL Configuration, add your Vercel URL as Site URL and Redirect URL (including `https://your-project.vercel.app/**`). Configure SMTP in Supabase for verification and reset emails.

## Render (backend API)
1. Sign in to Render and choose **New → Blueprint**; connect the repository containing `render.yaml`.
2. Render reads `render.yaml` and creates `hostelcare-ims-api`. If using a manual Web Service, set Root Directory `backend`, Build `npm ci && npm run build`, Start `npm start`, and health check `/api/health`. The backend requires Node.js 20 through 22.
3. Set environment variables in Render: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server-only secret), and `FRONTEND_URL` (the exact Vercel origin, e.g. `https://your-project.vercel.app`; comma-separate origins only if you intentionally support more than one). `NODE_ENV=production` is configured by the Blueprint. Render supplies `PORT`.
4. Deploy and test `https://YOUR-RENDER-SERVICE.onrender.com/api/health`.

## Vercel (frontend)
1. Sign in to Vercel → **Add New → Project** → import the same GitHub repository.
2. Set Root Directory to `frontend`; framework Vite; Build Command `npm run build`; Output Directory `dist`. `frontend/vercel.json` configures SPA fallback.
3. Add Vercel environment variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (public anon/publishable key), plus `VITE_API_URL=https://YOUR-RENDER-SERVICE.onrender.com/api` (no trailing slash required). Never put the service-role key in Vercel.
4. Deploy. Copy the resulting Vercel origin into Render's `FRONTEND_URL`, then redeploy Render.
5. In Supabase Auth URL Configuration, set Site URL to the Vercel origin and add redirect URLs for it.

The current project is a Vite static frontend plus a separate Express API. Render's existing Blueprint deploys the API only; deploy the frontend to Vercel (or another static host) and point it at the Render API using `VITE_API_URL`.

## Verify
- Render health endpoint returns JSON `{ "status": "ok" }`.
- Frontend opens and reaches backend.
- Email sign-up/confirmation and password reset are tested after SMTP configuration.

Note: Render free services may sleep when idle; first request may be slow. Deployment doesn't substitute for backend authorization/security review.
