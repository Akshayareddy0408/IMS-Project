# Safe email setup (Supabase Auth)

Auth email verification and password recovery are handled by Supabase Auth. Do not put mailbox credentials in the frontend.

## Supabase dashboard
1. Authentication → URL Configuration: set Site URL to your app origin and add exact local/deployed callback origins under Redirect URLs (for local Vite, `http://localhost:5173/**`).
2. Authentication → Providers → Email: enable Email and email confirmation.
3. Configure custom SMTP under the Auth SMTP settings. The built-in mailer has testing restrictions; custom SMTP is recommended for actual users.
4. Use SMTP host, port, username, app password, and verified sender address from your provider. Customize Auth → Email Templates and test verification/reset messages.

## Gmail example
- Enable Google 2-Step Verification and generate an App Password. Use this password, not your regular Gmail password.
- Host `smtp.gmail.com`, port `587` (STARTTLS), username your full Gmail address.
- Keep `.env` out of Git. Never share credentials in chat.

## Local environment
- Copy `frontend/.env.example` to `frontend/.env` and fill Supabase URL + publishable/anon key.
- Copy `backend/.env.example` to `backend/.env` and fill Supabase URL + secret/service-role key. The server key bypasses RLS and must remain server-only.
- Public signup cannot create an Administrator. Student registration is provisioned through the authenticated API; Warden and Maintenance Staff access remains pending until an Administrator approves the request.
- Create or invite the initial Administrator using `npm run provision:admin --prefix backend`. Follow its interactive confirmation prompts. Do not edit roles directly in SQL or put the server key in frontend configuration.

## Security scope
Supabase Auth performs email confirmation and password reset. The Express API validates every bearer token and bases authorization on trusted `app_metadata`; the browser uses only the publishable/anon key. Keep server credentials in the backend environment only. Password reset mail is subject to Supabase/provider rate limits; wait for the cooldown rather than repeatedly requesting messages.

## Database migration order
For an existing schema, apply the workflow migration, then the auth/role safety migration, then `database/migrations/20261108_01_room_management_safety.sql`. This room migration adds the room availability flag and database-enforced student occupancy updates. It stops before making changes if it finds normalized duplicate room identifiers or student links exceeding a room's capacity. Review those records before retrying. Do not apply it to the live project until you have reviewed that preflight condition and approved the change.
