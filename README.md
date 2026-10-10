# OnSITE

OnSITE is a multi-outlet workforce app built with Next.js, Drizzle, and Postgres. The Clock workspace handles shifts, history, and correction requests. The Backoffice workspace handles team access, outlet operations, device approvals, timesheets, and correction reviews. Users can sign in with a username or email address.

## Local setup

1. Install Node.js and dependencies:

   ```bash
   npm install
   ```

2. Create a Postgres database and copy `.env.example` to `.env.local`. Set `DATABASE_URL` to the database connection string. Authentication uses random opaque session tokens stored as hashes in the database; no auth signing secret is required.

3. Set the bootstrap admin and optional initial outlet values in `.env.local`. Use a real outlet address, coordinates, and IANA timezone. Invitations and password-reset links are copied and shared from the Team screen; no email service is required.

4. Apply the database migrations and create the initial super admin:

   ```bash
   npm run db:migrate
   npm run bootstrap-admin
   ```

   Bootstrap is a one-time command for the first super admin. It can also create an initial outlet. Public account registration remains disabled; invitations are one-use and expire after seven days.

5. Start the app:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Environment variables

- `DATABASE_URL`: Postgres connection string.
- `PIN_PEPPER`: Optional server-only secret of at least 32 bytes for staff PIN sign-in. Generate one with `openssl rand -base64 32`, keep it stable, and do not commit it. Changing it disables existing PINs until staff set them again; password sign-in continues to work.
- `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`: Required to deliver browser push alerts. Generate the key pair once with `npx web-push generate-vapid-keys`, set the subject to a `mailto:` contact or HTTPS URL, and keep the private key secret and stable.
- `BOOTSTRAP_ADMIN_*`: Name, username, email, and password for the initial super admin.
- `BOOTSTRAP_OUTLET_*`: Optional name, address, coordinates, and timezone for one outlet.
- `STOREHUB_STORE_NAME`: StoreHub account subdomain/name for API authentication.
- `STOREHUB_API_TOKEN`: Server-only token issued for StoreHub API access.
- `STOREHUB_OUTLET_ID`: OnSITE outlet UUID to receive the StoreHub attendance feed.
- `STOREHUB_POS_STORE_ID`: Matching StoreHub POS store ID.

Keep `.env.local` private and never commit live credentials.

Outlet managers can opt in to browser notifications for each assigned outlet. Push sends are triggered by local clock, break, correction, and timesheet writes; StoreHub attendance remains read-only and does not trigger notifications or additional StoreHub requests.

## StoreHub attendance

The management dashboard and timesheets can display StoreHub attendance for the outlet mapped by `STOREHUB_OUTLET_ID`. Configure the StoreHub account name and API token supplied by StoreHub, then map the OnSITE outlet UUID to its StoreHub POS store ID. The OnSITE UUID is the `id` on the matching `outlets` database row. The integration is read-only, fetches when these management views load or refresh, and does not create OnSITE staff accounts or clock events.

The integration uses [`@pyyupsk/storehub`](https://github.com/pyyupsk/storehub), an unofficial community client whose API details are reverse-engineered. Confirm API access and verify the response fields with StoreHub before relying on the feed. Its documented timesheet data has employee/store IDs and clock-in/out times, but no break events. Consecutive sessions for the same employee in the same outlet-local workday are grouped into one shift; each gap between a clock-out and the next clock-in is counted as a break. A break in progress cannot be confirmed until the next clock-in arrives. When the StoreHub API is unreachable, OnSITE attendance remains available.

## Validation

```bash
npm run lint
npm test
npm run build
```

Generate a new Drizzle migration after schema changes with `npm run db:generate`, then inspect it before applying it with `npm run db:migrate`.

## Current scope

There are three account types: super admin, admin, and staff. Clock and Backoffice access are granted independently. Super admins invite admins and staff and may assign admins to outlets. Admins invite staff and operate only in assigned outlets. Backoffice-enabled staff can handle outlet operations for their assigned outlets, but cannot create outlets or assign admins. Outlet edits and soft deactivation are audited, and deactivation is blocked while a shift is open.

Staff can clock against their outlet geofence, review their own history by outlet-local date range, and submit corrections. Staff must use one manager- or admin-approved browser profile for clock-in and clock-out; approving a replacement revokes the previous profile. This browser binding is not physical-device attestation and does not prevent sharing an approved browser profile. Admins and authorized staff can review correction requests and manage filtered timesheets. Direct time edits and approved corrections require a reason and are audited. Approved missed clock-ins are stored as manual punches with no fabricated GPS data. Timesheet exports follow the active outlet, employee, and date filters, use outlet-local timestamps, escape spreadsheet formula prefixes, and are limited to 500 rows per query.

The live location indicator is advisory: a failed background GPS reading does not prevent requesting a fresh location with the Clock button. Each action requests an uncached, high-accuracy fix and still requires server-side geofence and approved-browser validation. Location requests and clock service requests have 15-second timeouts with visible feedback. If a clock service response cannot be confirmed, reload the page to check the shift before retrying.

Generate a forward migration after schema changes, then inspect it before applying it to the intended database. The auth replacement migration removes obsolete auth tables and columns; it has not been applied automatically. Password-reset links are shared manually, single-use, and expire after 30 minutes. Browser GPS is operational evidence, not tamper-proof proof of physical presence.
