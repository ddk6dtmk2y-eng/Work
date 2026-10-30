# HostFlow CRM

A mobile-first CRM for Airbnb property management, built with Node.js 24, browser JavaScript and SQLite. No external packages or build step are required. Currency is GBP; monthly management fees are estimated monthly property revenue multiplied by the fee percentage. Potential revenue includes open opportunities; won revenue is reported separately.

## Run locally

1. Install Node.js 24 or newer.
2. In this repository, run `npm start`.
3. Open `http://127.0.0.1:3000` in your browser. Choose **Create an account**, enter your email and a password of at least 12 characters. Leave sample data selected to create five fictional owners and four follow-ups. There are no shared default credentials.

Use `npm run dev` for automatic server restarts. SQLite data is stored in `data/hostflow.sqlite`, which is ignored by Git and survives restarts. `DATA_DIR`, `PORT` (default 3000) and `HOST` (default 127.0.0.1) can be set as environment variables. No `.env` loader is included; set variables in your shell or hosting environment. Use the existing checkout for cloud tasks; no additional worktree is needed.

## Use and test

Run `npm test`. The integration suite starts a real server with an isolated temporary database and exercises registration, login, rejected credentials, origin checks, validation, lead creation/editing/deletion, tasks, per-account isolation, CSV escaping, logout and persistence across a server restart.

Manual browser checks before deployment:

- Create an account with samples. Check dashboard totals against property revenue × fee. Open the lead list, search by owner/address/notes, filter by stage and sort by fee.
- Add a lead, edit its notes and property, and move it between stages using the pipeline dropdown. Confirm dashboard totals update. Export CSV and open it in a spreadsheet.
- Add a follow-up from a lead or Tasks, set a past date and confirm the overdue reminder. Complete it, refresh and confirm its saved state. Deleting a lead also deletes its tasks.
- Sign out and back in; restart the server and verify records remain. Create another account and confirm it has separate records.
- Check widths of 375px, 390px, 768px and desktop in browser device emulation; also test Safari on an iPhone and Chrome on Android. Forms stack on narrow screens; the pipeline scrolls horizontally and uses touch-friendly stage selectors. Check keyboard navigation, dialog focus and readable form labels.

To test on a phone on your trusted local network: `HOST=0.0.0.0 npm start`, then open `http://YOUR_COMPUTER_LAN_IP:3000`. Use fictional data over local HTTP. Allow the port through your local firewall if necessary.

## Security and deployment preparation

Passwords use scrypt with random salts. Sessions use random tokens, hashed in the database, with HttpOnly, SameSite=Strict cookies and seven-day expiry. Mutations validate the request Origin; user data queries enforce account ownership. Login/registration are limited to 25 attempts per network address per 15 minutes. CSV fields are quoted and spreadsheet formula prefixes neutralized. Assets are served with a restrictive content security policy.

Before deployment, use HTTPS and set `NODE_ENV=production` to require Secure cookies. Bind to the host required by your platform (commonly `HOST=0.0.0.0`), keep the backend private behind the HTTPS proxy, preserve the public Host and Origin, and attach a persistent disk for `DATA_DIR`. Production-mode cookies will not work over plain HTTP. Use a single instance with local SQLite; use a managed database and shared rate limits before scaling to multiple instances. The current rate limit uses socket addresses, so a reverse proxy shares one limit across users.

Back up SQLite with its online backup tooling or stop the app before copying the complete data directory. Test restoration before storing real owner details. Protect backups and the database disk. Hosted production access is restricted to OWNER_EMAIL. Production startup requires that email and a REGISTRATION_KEY of at least 32 characters. The private setup code is required when creating the owner account; ordinary sign-in uses the account password. Sample data is disabled in production. Account recovery, email verification, invitations, MFA, audit logging and automated email/push notifications are not implemented. Follow-up reminders are shown inside the app on sign-in; the app does not send notifications while closed. Review access controls and your data retention/privacy requirements before adding real customer data.

No deployment has been performed. Automated tests do not replace real iPhone/Android browser validation.

## Render deployment

The included `render.yaml` creates one paid Starter Node.js 24 service in Frankfurt with a 1 GB persistent disk. Database files live at `/var/data/hostflow`. Automatic deployments are off. Review Render’s displayed price before creating resources.

Create a Blueprint from this repository and enter your account email for `OWNER_EMAIL`. Render generates `REGISTRATION_KEY`: retrieve it privately from the service’s Environment settings, then use it once in the **Private workspace setup code** field when creating your account. Choose your own unique password. Keep the setup key out of GitHub and chat. The local preview database and preview credentials are not deployed.

The build runs `npm test`, the start command is `npm start`, and `/healthz` checks SQLite availability. Production cookies require HTTPS; use the assigned HTTPS Render address. After launch, create the owner account, add a fictional lead and task, redeploy, and verify both survive before adding business records.

Production creates a verified SQLite backup on startup and every 24 hours while running, retaining the latest seven copies in `DATA_DIR/backups`. `npm run backup` also creates a verified online backup without stopping the server. These copies share the database disk: download backups periodically to a separate private location to protect against disk/account loss. Render disk snapshots are not a replacement for a SQLite-consistent backup.

To restore: stop the service first; retain a copy of its current database and any WAL/SHM files; put the selected verified backup at `DATA_DIR/hostflow.sqlite` with no stale WAL/SHM files alongside it; restart and verify records. Never replace a running SQLite database. No cloud deployment has been completed by preparing these files.
