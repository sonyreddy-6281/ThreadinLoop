# Customer order email notifications

The website domain can remain on Netlify. The **sender** domain `threadinloop.com` must be configured for outbound mail by its DNS administrator.

1. In Resend, sign up and add `threadinloop.com` under Domains. Add its required SPF/DKIM DNS records with the current DNS provider. Keep Google Workspace MX records unchanged. Wait until Resend says Verified.
2. Create a Resend API key with sending permission. Add Netlify environment variables (Functions scope): `RESEND_API_KEY`, `EMAIL_FROM` (set its value privately in Netlify to your verified sender display name and email address). Also retain `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Include production context when you promote to production.
3. Run Supabase migrations in order: `202610240002_required_customer_email.sql`, `202610240003_order_email_outbox.sql`, and `202610240004_email_event_snapshots.sql`. The final migration prevents a delayed email from describing a later order status instead of the status that triggered it.
4. Deploy from GitHub with Netlify Functions enabled. Netlify scheduled function `send-order-emails` runs every five minutes on **published production deployments**; Netlify previews do not execute the schedule automatically. Do NOT invoke this function via arbitrary anonymous HTTP calls.
5. Test on production only after you have verified the store, payments, DNS, and email configuration. Add an order with your own email, check `order_email_outbox` rows and Netlify Functions logs, and check inbox/spam. Order-created and status-changed rows enqueue automatically; separate payment receipt emails are disabled.
6. Delivery is asynchronous and may be delayed by several minutes. A 'sent' status means provider accepted it, not proof of inbox delivery. For stronger observability add Resend delivery/bounce webhook handling.

Note: Pending messages can be left queued until the provider is configured. This is transactional email only, not marketing. Email addresses must be collected for order communications; avoid unsolicited promotional messages.

Caution: Existing admin code can manually mark a payment received; ensure gateway-confirmed and manually confirmed payments are distinguished for financial reconciliation.

## What is committed
- Required email field and validation in checkout, server-side RPC insert enforcement.
- Order, captured-payment, and admin status-change triggers queue unique email events.
- Responsive larger shopping bag panel.
- A Netlify scheduled function sends branded order summaries via Resend every five minutes on production.
- Retries are bounded; provider idempotency key reduces double sends and send results are logged.

**Deployment caveat:** A functioning PR preview does not activate Netlify scheduled functions. Trigger a controlled production release after validating the latest SQL migrations and sender DNS records. A send accepted by Resend is not proof of inbox delivery.
