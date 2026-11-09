# HostelCare IMS — Supabase-enabled starter

A student project starter for hostel complaint and inventory management. Includes React/Vite frontend, Express API, Supabase PostgreSQL schema, Supabase Auth email signup/signin/verification/password reset UI, role-aware dashboard, complaint workflow, inventory, and setup documentation.

## What is included
- Auth screen for signup, email/password sign-in, sign-out, and password reset. Supabase confirmation emails are controlled by your Supabase Auth settings.
- Public signups can register as Students or request Maintenance Staff/Warden access; elevated access stays Pending until approved by an Administrator.
- Complaint submit/list/detail, status workflow, assignment, owner-scoped activity history, resolution notes, and complaint notifications wired to Express/Supabase routes.
- Administrator resource create/edit and quantity adjustment, plus Warden/Administrator stock transaction history.
- Administrator room creation/edit/deletion, availability controls, and occupancy overview; student assignments are capacity guarded.
- Administrator activity history and recipient-scoped notification inbox with unread count/read state.
- Notification inbox with per-recipient read state for Student, Warden, and Maintenance Staff profiles.
- Dashboard overview, search, role-based UI, database schema and sample inventory seed.
- `.env.example` files and `EMAIL_SETUP.md` for SMTP sender setup.

## Run locally
Prerequisite: Node.js 20+ and a Supabase project.

1. In Supabase SQL Editor, apply `database/supabase_schema.sql` if setting up a new project. For an existing project, apply migrations in order: `20261107_hostelcare_security_and_workflows.sql`, `20261107_02_auth_role_safety.sql`, then `20261108_01_room_management_safety.sql`. The room migration checks for duplicate room numbers and linked occupancy above capacity before it changes anything; resolve those data conditions deliberately if it stops. The targeted-cleanup preview migration is only needed for the guarded cleanup utility.
2. Copy `frontend/.env.example` → `frontend/.env`; fill `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (publishable/anon key).
3. Copy `backend/.env.example` → `backend/.env`; fill `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Never expose this secret in frontend or commit `.env`.
4. Configure Auth email confirmation and custom SMTP using `EMAIL_SETUP.md`.
5. From project root: `npm install`, then `npm run dev`.
6. Open the Vite URL shown (typically `http://localhost:5173`).

Environment variable names (use your own Supabase project values locally; never paste the server-only value into the frontend or chat):

```text
frontend/.env: VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
frontend/.env: VITE_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
frontend/.env: VITE_API_URL=             # blank for local Vite proxy; set to deployed API /api URL in production
backend/.env:  SUPABASE_URL=https://YOUR_PROJECT.supabase.co
backend/.env:  SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_KEY
backend/.env:  PORT=4000
backend/.env:  FRONTEND_URL=http://localhost:5173
```

## Roles and approval
Public sign-up creates a Student identity or submits a Maintenance Staff/Warden request. Only an Administrator can approve elevated requests in the Account approvals view. To provision the first Administrator, create the account through Supabase Auth, then use a trusted server-side Supabase Admin API call to set `app_metadata.role` to `Administrator`; never put the service-role key in the browser or SQL snippets shared with users. A user must sign out and back in after a role change so the session claims refresh.

### Provision the first Administrator
1. Apply `database/migrations/20261107_02_auth_role_safety.sql` after the earlier HostelCare migration. It adds foreign-key checks for future rows, tightens browser table grants, and installs the atomic inventory audit RPC.
2. Ensure `backend/.env` has `SUPABASE_URL` and the server-only `SUPABASE_SERVICE_ROLE_KEY`. Do not copy that key into any `VITE_` variable.
3. In a terminal at the project root, run `npm run provision:admin --prefix backend`. Enter the intended email. If it has no Auth account, type `INVITE` to send a Supabase invitation. If it already has an account, type `PROMOTE <email>` to confirm the role change. The command refuses to create a second Administrator and preserves other app metadata.
4. Complete the Supabase email invitation or sign in with that account. Sign out and back in to refresh claims. The signed-in role should show Administrator and the Account approvals section should appear.

Run focused authorization tests with `npm run test --prefix backend`.

The backend test command runs role/authorization unit tests and Express room-route handler tests using an in-memory service. It does not connect to Supabase. Complaint, account-approval, inventory RPC, notification persistence, and browser workflows still need manual verification after configuration.

### Targeted test-account cleanup
The cleanup command is dry-run by default. Apply `database/migrations/20261108_targeted_cleanup_preview.sql` first so it can inspect every foreign-key dependency. Then run `npm run cleanup:test-accounts --prefix backend -- --emails first@example.com,second@example.com`. It prints the exact proposed rows, blockers, plan hash, and required confirmation phrase without deleting anything. Only after reviewing that report, execute the same command with `--execute --plan-hash <printed-hash> --confirm "<printed-phrase>"`. The command stops for Administrator accounts, cross-user complaint ownership/assignment, audit dependencies, unknown populated foreign keys, changed plan data, or missing confirmation. It preserves rooms/resources and unrelated records.

## Notes / scope
The Express API verifies Supabase access tokens and checks roles before using its server-only service client. Keep that service-role key private. The workflow migration adds RLS with no browser table policies because data access is routed through the authenticated API. Email delivery depends on Supabase Auth and SMTP configuration. Room availability depends on applying the new room-management migration; until then do not rely on live capacity enforcement. Complaint photo uploads are not implemented. Live Admin sign-in, email delivery, and all role workflows require manual Supabase/browser verification.

## Deploy
See `DEPLOY_RENDER_VERCEL.md` for deploying the API on Render and frontend on Vercel. The project includes `render.yaml` and `frontend/vercel.json`.
