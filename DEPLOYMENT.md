# Breezyee Vans deployment and operations

Implementation is ready for staging verification, **not yet verified in production**. Do not promote the branch until the configuration and live checks below pass. The existing production domain is not evidence that these changes have deployed.

## Local development and checks

Use Node 22.12+ (tested on Node 24.20), then `npm ci` and `npm run check`. This runs ESLint, the Vite production build and the Node test suite. `npm run dev` serves the existing multipage site and the same API handlers used by Vercel. `npm run preview` serves built static assets only; it does not serve the API.

Copy `.env.example` to `.env.local` and configure values privately. `.env.local` was previously tracked; it has been removed from Git tracking and remains on this machine. Never commit it. Only `VITE_` variables are public browser configuration.

## Environment variables

| Variable | Location and purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Public project URL, also read by the server. The currently configured hostname failed DNS resolution during verification. Restore the project or replace with the correct project URL. |
| `VITE_SUPABASE_ANON_KEY` | Public Supabase anonymous/publishable client credential. Must match the project. |
| `VITE_ADMIN_EMAIL` | Public navigation role hint. Default is `info@breezyeevans.co.uk`. It grants no database permission. |
| `VITE_RECAPTCHA_SITE_KEY` | Public v3 site key; supplied value is in `.env.example`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. Required for validated persistence, rate limits, email queue and booking management. Missing in this workspace. |
| `RECAPTCHA_SECRET_KEY` | Server only. Supplied value is held only in ignored local configuration. |
| `RECAPTCHA_HOSTNAMES` | Exact comma-separated accepted hosts. Default: `www.breezyeevans.co.uk,breezyeevans.co.uk`. Add a deliberate staging host when testing; do not use wildcards. |
| `RECAPTCHA_MIN_SCORE` | Default `0.5`; monitor legitimate rejection rates before adjusting. |
| `RESEND_API_KEY` | Server only. Supplied key is send-only; it cannot inspect domains or DNS. |
| `RATE_LIMIT_SECRET` | Server only, random 32-byte secret used to hash rate-limit identities. Generated in ignored local configuration. |
| `CRON_SECRET` | Server only, independent random secret for the email retry endpoint. Generated in ignored local configuration. |
| `ADMIN_EMAIL` | Server authorization identity. Keep aligned with the admin identity in the SQL policies and `VITE_ADMIN_EMAIL`. |
| `SITE_URL` | Exact allowed form origin and auth link destination. Production default: `https://www.breezyeevans.co.uk`. Set explicitly for an isolated preview environment. |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Public Stripe publishable key used by Stripe.js Payment Element in the browser. |
| `STRIPE_SECRET_KEY` | Server only. Creates idempotent Stripe PaymentIntents for priced booking requests. |
| `STRIPE_WEBHOOK_SECRET` | Server only. Stripe webhook signing secret for `/api/stripe-webhook`; set after creating the webhook endpoint in Stripe. |
| `GOOGLE_SITE_VERIFICATION` | Optional Search Console HTML verification value, emitted at build time. |

In Vercel, inspect existing project settings and environment variable names before adding missing values. Do not replace existing secrets blindly. Use separate staging configuration and database where practical. A local environment file is not uploaded automatically as production configuration.

## Supabase migration and storage

Confirm the live schema and take a database backup before applying migrations. The test suite executes these migrations on an isolated PostgreSQL-compatible PGlite database; this does not establish compatibility with an unseen production schema.

For an existing installation, confirm `cars`, `driver_verifications`, the private driver bucket and their prerequisites from the existing setup are present. Do not rerun old migrations blindly: the legacy driver migration includes a column deletion. For a fresh database, apply the original cars and driver migrations first, followed by:

1. `supabase_migrations/20261003_production_workflows.sql`
2. `supabase_migrations/20261003_booking_management.sql`
3. `supabase_migrations/20261003_fleet_images.sql`

Apply each new migration once. The workflow migration creates `bookings` if absent and adds reference, vehicle and terms-acceptance columns. It adds private enquiries, submission receipts, rate limits and an email outbox. Existing booking policies are replaced with owner/admin reads; browser booking writes and driver-verification mutations are revoked. Server role functions handle those writes. **The previous browser-only booking client must not be used after these grants change.** Coordinate the migration and application release.

Driver uploads remain private, scoped to the authenticated user's folder, and limited to JPEG/PNG/WebP/PDF at 5 MB. Admins can read short-lived signed links. The new `fleet-images` bucket contains intentionally public vehicle photos; only the existing administrator can upload/delete through RLS. Never upload driver documents to it.

Configure a retention process for old bookings, enquiry messages, licence documents, abandoned uploads and sent email bodies. No arbitrary retention period or bulk deletion has been imposed. The business must confirm its actual retention requirements before publishing a final privacy notice. Email receipts and submission keys must remain long enough to prevent duplicates.

## Booking and email workflows

Booking requires a signed-in, email-verified Supabase user. The form loads active vehicles, uses configured rates for its estimate, collects driver documents, presents a review dialog and sends a fresh v3 token. The server verifies action, hostname, score and token age, verifies the user and upload paths, and recalculates the price from the selected database vehicle. Existing hourly arithmetic is preserved: daily rate / 8 for 2/4/8-hour hires; daily rate times days for 24/48/72-hour hires; custom hire requests require a quote.

One database transaction writes a `Requested` booking, pending driver verification, unique reference, submission receipt and customer/business email jobs. Retrying the same request returns the same reference. Changed payloads under an already-used request key are rejected. No reservation, payment or availability is assumed.

Enquiries validate contact details and message, verify v3, and atomically save the enquiry, reference and two email jobs. The customer receives an acknowledgement; the business copy goes to `info@breezyeevans.co.uk`.

Every transactional email has branded HTML and plain text, sender `Breezyee Vans <no-reply@breezyeevans.co.uk>` and business reply-to. Resend acceptance is recorded with its provider ID. It does not prove inbox delivery. A failed provider request leaves durable queued work; the browser reports that the request is saved rather than claiming an email was delivered.

The authenticated admin workflow supports driver approval/rejection, separate confirmation after availability has been checked, cancellation confirmation, and booking-detail/status/reminder emails. Customers can request cancellation; this does not promise a refund. Stripe Payment Element is used for calculated online booking payments after the booking request is saved. A Stripe webhook, not the browser redirect, marks a booking `Paid`; paid bookings still require driver review and separate availability confirmation.

## Stripe payment setup

Create a Stripe webhook endpoint for `https://www.breezyeevans.co.uk/api/stripe-webhook` and subscribe to `payment_intent.succeeded`. Copy the resulting `whsec_...` signing secret into `STRIPE_WEBHOOK_SECRET`. Set `VITE_STRIPE_PUBLISHABLE_KEY` and `STRIPE_SECRET_KEY` in the appropriate Vercel environments. Apply `supabase_migrations/20261003_stripe_payments.sql` so admin confirmation remains possible after a booking has been paid but before availability is confirmed. Custom quote bookings do not take payment online until a price is agreed.

## Email retries and Resend domain

Use a full-access Resend account session or a narrowly appropriate domain-management key to inspect `breezyeevans.co.uk`, obtain its exact DNS records and verify the resulting status. Do not invent SPF/DKIM values or replace unrelated DNS. The supplied send-only API key returned HTTP 401 when listing domains, explicitly stating its permission restriction. Domain verification remains unconfirmed.

Configure an authenticated scheduler to call `/api/email-retry` at least every five minutes with `Authorization: Bearer <CRON_SECRET>`. This deployment does not impose a paid Vercel Cron plan or install an unverified schedule. Select a supported scheduler after checking the existing hosting plan. A request claims up to ten jobs with a five-minute database lease. Increase capacity or frequency if observed volume requires it.

Retries reuse a stable Resend idempotency key. Automatic retry stops 23 hours after the first attempt to avoid sending again after Resend's 24-hour deduplication period. Alert on any unsent job older than ten minutes. Older ambiguous jobs require an operator to check provider receipts before clearing the attempt/lease timestamps. Do not blindly reset them. See [Resend idempotency guidance](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Authentication email setup and protection boundary

Keep the existing Supabase authentication provider. The site uses email+password sign-in only (`/api/auth` actions `login`/`register`/`reset`) — there is no OTP/magic-link flow, and the app deliberately never calls Supabase's own `/auth/v1/otp` endpoint. Enable email confirmation, configure the production site URL and allow `/login` and `/reset-password` redirects. Use Resend custom SMTP with sender `no-reply@breezyeevans.co.uk`, sender name `Breezyee Vans`, host `smtp.resend.com`, port `465`, username `resend`, and the API key as the password. Check the current [Resend Supabase SMTP setup](https://resend.com/docs/send-with-supabase-smtp) before applying account settings. Password reset uses the trusted `{{ .ConfirmationURL }}` recovery template; the server generates and emails that link itself via the admin API + Resend (`api/auth.mjs`), so the account-level template only needs to render correctly if Supabase ever sends recovery email directly. Provider SMTP MIME/plain-text output must be checked with a controlled verification email; it has not been tested live.

The website login, registration and reset-request routes are protected by server-verified reCAPTCHA v3 and persistent rate limits. **Supabase's directly accessible Auth API is a separate protection boundary.** Its documented native CAPTCHA providers are hCaptcha and Turnstile, not this Google v3 key. The proxy alone does not prevent a bot from calling public Supabase Auth endpoints directly. Before launch, review Supabase provider rate limits and configure compatible provider-level protection or a suitable supported Auth gateway/hook. Do not claim direct-provider bot protection is solved, and do not silently substitute another CAPTCHA on the website. See [Supabase CAPTCHA support](https://supabase.com/docs/guides/auth/auth-captcha).

The Google integration uses standard v3 `api.js` and SiteVerify with the supplied site/secret pair. Confirm the key is score-based v3 and registered for the deployed hostname. No Enterprise assessment is sent without a Cloud project/key configuration. See [Google v3 validation](https://developers.google.com/recaptcha/docs/v3). No live token has been verified in this run.

## Vercel release and Google

The repository remains a Vite multipage application with Vercel Node API functions. Static HTML contains crawlable page content; metadata is emitted during build. The catch-all rewrite has been removed so unknown paths can return the real `404.html`. Source assets are no longer marked immutable; Vite's hashed assets are. The canonical host is www. The existing public domain returned HTTPS 200 and its apex returned 308 to www during this run, before these changes were deployed.

Vercel CLI is currently logged out and no linked `.vercel` project was found. Sign in, link **the existing** project, inspect its environment variables and production branch, then deploy an isolated preview. Configure its origin/reCAPTCHA hosts deliberately; do not point a public test at the production customer database. Confirm `/api/submit`, `/api/auth`, `/api/manage`, `/robots.txt`, `/sitemap.xml`, missing-page HTTP status, both domain variants and TLS before promoting. Follow the project's existing Git-to-Vercel release process once confirmed. Do not create a replacement project or claim a production release on the basis of a Git push.

Set the Search Console verification value or use a DNS verification record supplied by Google. Submit `https://www.breezyeevans.co.uk/sitemap.xml` after production deployment. The sitemap excludes APIs and account/admin pages; those HTML pages carry `noindex`. No Google indexing or Search Console verification has been confirmed.

## Live acceptance checks still required

Use owned test accounts and approved test recipients. Verify signup and email confirmation, sign-in, reset and resend, one booking request with private test documents, persistence and matching reference, one enquiry, both customer/business deliveries, a retry without duplication, owner-only reads, denied anonymous writes, admin driver review, cancellation request and separate availability confirmation. Remove test data using the project's agreed process. No real customer email or payment was sent during development.
