# Create login accounts and an administrator

The Data Governance Analyzer uses **an email address and password from our Supabase project**.
Your GitHub password does not sign you into the application. There is no shared or built-in
admin password. Follow these steps once for the team project, then create a separate account
for each person.

## What the admin can do

An admin can use all current assessment features, import descriptions, view their results,
and download reports. At `/admin`, they can list all accounts, create users or other admins,
change roles, set new passwords, and disable or enable accounts. Regular users can use the
assessment but cannot manage accounts, even if they call the admin URLs directly.

Assessments are not saved to a shared database. An admin therefore cannot retrieve another
person's past assessment or browser draft. Existing passwords cannot be read; they can be
replaced. This role does not grant access to the Supabase dashboard, GitHub, hosting accounts,
or the ability to edit scoring rules. Those remain separate team permissions.

## 1. Create the team Supabase project

1. Sign into [Supabase](https://supabase.com/dashboard) and create a project in the team's organization.
2. Save the project's database password privately. **It is not an application login password.**
3. In **Authentication**, enable the **Email** provider with password sign-in. Dashboard labels
   can vary; look under the sign-in/provider settings.
4. Use an asymmetric JWT signing key, **ES256 or RS256**. Our backend rejects legacy HS256
   access tokens. See [signing keys](https://supabase.com/docs/guides/auth/signing-keys).
5. From the project's connection/API settings, get its project URL and publishable key.
   In the API keys settings, create or copy a **secret key** for server-side account management.
   The project URL looks like `https://your-project.supabase.co`.
6. If accounts should be created only by the team, turn off public sign-ups in Supabase.
   The application's admin account creation still works. This app does not provide a sign-up page.

Use a separate test project for development if the team also has production users.

## 2. Connect the application

Install the dependencies using the main [README](README.md). Create private environment files
from the examples if they do not already exist. Edit existing files without replacing their settings.

In `frontend/.env.local`, configure:

```dotenv
API_BASE_URL=http://127.0.0.1:8000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-publishable-key
SUPABASE_SECRET_KEY=your-server-only-secret-key
```

In `backend/.env`, configure the **same project**:

```dotenv
SUPABASE_URL=https://your-project.supabase.co
```

Replace the example values privately. `API_BASE_URL` must use the backend port you actually
run. If your team uses other local ports, change that URL and open the matching frontend URL.
The normal team defaults are frontend 3000 and backend 8000. `APP_ORIGIN` is optional for
ordinary same-origin localhost requests; if you set it, it must match your actual frontend URL.

`SUPABASE_SECRET_KEY` is used **only by the Next.js server for account management**.
Do not give it a `NEXT_PUBLIC_` prefix, put it in browser code, or commit its value.
The regular login client still uses the publishable key. The backend does not need the secret key.
The files above are ignored by Git; `.env.example` files contain names and placeholders only.

Restart both services after changing environment variables. For hosted environments, set the
frontend values in Vercel and the backend project URL in Render, then redeploy. Keep preview
and production settings separate. See [deployment instructions](docs/deployment.md).

## 3. Create the first email and password

1. Open **Authentication → Users** in the correct Supabase project.
2. Choose **Add user → Create new user** (or the equivalent create-user action).
3. Enter the person's email address and a unique password of at least 12 characters that also
   meets the project's password policy. Verify the person's identity and email ownership.
4. For a team account whose email you have verified, select **Auto Confirm User** when available.
   The app requires a confirmed account. Do not treat an unverified address as confirmed.
5. Copy that account's **User UID**. It is an identifier, not the password.

The email and password entered here are the credentials for `/login`. Never put a real
password in a README, commit, issue, pull request, screenshot, or shared chat.

## 4. Make that account the first admin

From the `frontend` directory, after installing dependencies and configuring `.env.local`, run:

```bash
node --env-file=.env.local scripts/bootstrap-admin.mjs YOUR_USER_UID
```

Replace `YOUR_USER_UID` with the exact UID copied in the previous step. The same command works
in PowerShell and macOS/Linux terminals with the project's supported Node version. It does
not create or print a password. It sets `app_metadata.app_role` to `admin` for that confirmed
account, using the private server key. It preserves other account metadata.

Sign in at `http://localhost:3000/login` using that person's email and password. If already
signed in, sign out and back in to refresh the role shown in navigation. Open **Admin**, or
visit `http://localhost:3000/admin` directly. Use your own frontend port if different.

Do not set the Supabase database role to `service_role`. Leave the normal Auth role as
`authenticated`. The application role belongs in **app_metadata**, which regular users cannot
edit. A value in **user_metadata** does not grant admin rights.

## 5. Create the team's other accounts

In the application's **Admin → Create an account** form, enter the verified email, initial
password, and role. Choose **User** for ordinary assessment access. Choose **Admin** only for
someone who should manage everyone else's accounts as well. Created accounts are confirmed
and can sign in immediately; this form does not send an invitation email.

Share credentials privately using the team's approved channel. The form clears submitted
passwords, and responses never return passwords or server keys. For an existing account,
use **Set new password** to replace a forgotten password. This app does not yet offer an
email recovery or forced first-login password-change flow.

Admins can change another person's role or disable their account. They cannot change their
own role or disable themselves from this screen. Another admin or the project owner can do
that if needed. Keep at least one trusted project owner able to recover access through Supabase.

## 6. Verify access before sharing the app

- Sign in as a regular user. Assessments should work; `/admin` should deny access, and direct
  `/api/admin/users` requests should return 403.
- Sign out and sign in as the admin. Open `/admin`, create a test user, and confirm that the
  new account can sign in and complete an assessment.
- As admin, change another test admin to User. Their next admin request should be denied,
  even with their older login token. Sign out/in updates the navigation label.
- Disable the test account and check that future sign-in/refresh is blocked. Enable it and
  check again. Existing access tokens can still be valid until expiry for ordinary assessment
  requests; disabling an account does not instantly erase issued tokens or downloaded files.
- Sign out. Confirm the private draft clears and protected navigation returns to login.
- Repeat on the hosted HTTPS site. Automated tests use controlled Auth responses; they do
  not prove that your actual Supabase configuration is correct.

Admin routes check the current user with Supabase on every privileged request. A revoked admin
role is not accepted just because it remains in an old token. An Auth outage blocks admin
operations with a retry message. Role/status changes already in flight may finish before a
later revocation. Normal assessment token validation is unchanged.

## Troubleshooting

| What you see | What to check |
| --- | --- |
| Email or password is incorrect | Use the app account, not GitHub or the database password. Confirm the email, password, project, and account status. |
| Sign-in unavailable | Check the project URL and publishable key, restart/redeploy, and check Supabase availability. |
| Admin access required | Run the bootstrap for the correct confirmed UID, or ask another admin to change the role. Do not use user_metadata. |
| Admin page opens but account management fails | Check the server-only secret key belongs to the same project, and restart/redeploy. |
| Password/account change rejected | Check the project's password policy, account details, and whether the email already exists. Provider details are intentionally not exposed. |
| Assessment fails after login | Check API_BASE_URL, backend availability, the backend's matching Supabase URL, and asymmetric signing-key configuration. |

Official references: [User accounts](https://supabase.com/docs/guides/auth/users),
[createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser),
[updateUserById](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid),
[getUser](https://supabase.com/docs/reference/javascript/auth-getuser).
