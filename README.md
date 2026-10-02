## Shiftline

Shiftline is a multi-outlet staff timekeeping app built with Next.js, Better Auth, Drizzle, and Neon Postgres. Staff can sign in, clock in or out against an assigned outlet's geofence, review recent shifts, and submit time-correction requests. Clock events and correction submissions are written with audit records.

## Local setup

1. Install Node.js and dependencies:

   ```bash
   npm install
   ```

2. Create a Neon Postgres database and copy `.env.example` to `.env.local`. Set `DATABASE_URL` to the database connection string and set `BETTER_AUTH_SECRET` to a random value of at least 32 characters. For example:

   ```bash
   openssl rand -base64 32
   ```

3. Set the bootstrap admin and initial outlet values in `.env.local`. Use the outlet's real address, coordinates, and IANA timezone. Invitations and password-reset links are copied and shared from the Team screen; no email service is required.

4. Apply the database migrations and create the initial administrator and outlet:

   ```bash
   npm run db:migrate
   npm run bootstrap-admin
   ```

   Bootstrap is a one-time local command. Public account registration remains disabled. Admins invite managers; managers invite staff or supervisors assigned to outlets they manage.

5. Start the app:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Environment variables

| Variable             | Purpose                                                        |
| -------------------- | -------------------------------------------------------------- |
| `DATABASE_URL`       | Neon/Postgres connection string                                |
| `BETTER_AUTH_SECRET` | Session and auth signing secret, minimum 32 characters         |
| `BETTER_AUTH_URL`    | Canonical application URL; use `http://localhost:3000` locally |
| `BOOTSTRAP_ADMIN_*`  | One-time administrator and first-outlet setup values           |

Keep `.env.local` private and never commit live credentials.

## Validation

```bash
npm run lint
npm test
npm run build
```

Generate a new Drizzle migration after schema changes with `npm run db:generate`, then apply it with `npm run db:migrate`.

## Current scope

Authentication, outlet assignments, geofenced clock-in/out, recent shift history, staff correction-request submission, role-scoped invitations, pending-link revocation, and manager/admin-issued password-reset links are connected to Postgres. Invite links are single-use, expire after seven days, and store only a token hash. Password-reset links are shared manually, single-use, and expire after 30 minutes. Correction approvals, manager timesheets and edits, outlet/team administration beyond invitations, and CSV export are not implemented yet. Browser GPS is evidence for location checks, not tamper-proof proof of physical presence.
# ydm-clockin
