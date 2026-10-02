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

Global admins manage outlets and manager assignments but do not receive outlet roles or clock shifts. Managers can be assigned to multiple outlets; they invite staff and supervisors only within their assigned outlets. Outlet edits and soft deactivation are audited, and deactivation is blocked while a shift is open.

Staff and supervisors can clock against their outlet geofence, review their own history by outlet-local date range, and submit corrections. Managers and admins can review correction requests and manage filtered timesheets. Direct time edits and approved corrections require a reason and are audited. Approved missed clock-ins are stored as manual punches with no fabricated GPS data. The timesheet export follows the active outlet, employee, and date filters, uses outlet-local timestamps, and escapes spreadsheet formula prefixes. Timesheet results are limited to 500 rows per query.

Run `npm run db:migrate` after updating to apply the punch-provenance migration. Existing clock-in and completed clock-out records are retained as GPS-verified; manually adjusted punches are labeled separately. Invite links are single-use and expire after seven days. Password-reset links are shared manually, single-use, and expire after 30 minutes. Browser GPS is operational evidence, not tamper-proof proof of physical presence.

# ydm-clockin
