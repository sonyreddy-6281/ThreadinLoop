# Razorpay checkout (Netlify + Angular + Supabase)

**Not live until configured and tested.** Deploy this branch from GitHub using Netlify continuous deployment (not manual drag-and-drop of just the `dist` folder; static upload will omit Netlify Functions).

## 1. Database
Apply `supabase/migrations/202610240001_razorpay_orders.sql` after the original shop migration.

## 2. Netlify environment variables (Functions scope)
- `RAZORPAY_KEY_ID` – start with Razorpay **test** key ID.
- `RAZORPAY_KEY_SECRET` – corresponding Razorpay **test** secret; NEVER public or in Git.
- `RAZORPAY_WEBHOOK_SECRET` – independently generated webhook secret (not your API secret).
- `SUPABASE_URL` – your Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY` – secret service-role credential. Never ship in browser or `shop.config.json`.

Set build command `npm run build`, publish directory `dist/madhu/browser`, and branch `feature/razorpay-checkout`; keep existing public Supabase shop settings from README. Redeploy after adding environment variables.

Webhook URL: `https://YOUR-NETLIFY-SITE.netlify.app/.netlify/functions/razorpay-webhook`.
Subscribe to `payment.captured`. Enable Razorpay auto-capture as appropriate for your account.

## 3. Test
- Confirm Supabase database setup and at least one in-stock product.
- Use Razorpay TEST cards/UPI test flows only; never test by charging an actual card.
- Successful payment => order payment_status 'received'; failed/dismissed payment => order remains 'pending'.
- Check webhook retry and a browser closed during payment. Verify admin order display and actual payment in Razorpay dashboard.
- Do not manually mark an order paid just because checkout returned a handler response.

## Limitations before production
- The existing `create_order` RPC reserves stock immediately, **before payment**. Failed/abandoned checkouts hold inventory. Implement a safe scheduled expiry and stock-release mechanism before heavy live traffic; do not blindly restock orders with a possible late payment.
- The existing admin can manually mark payment received. Restrict that operation if you require all `received` orders to be gateway-verified.
- Payment creation uses an opaque order UUID, without buyer authentication; add stronger ownership/rate limiting and bot protection before public high-volume use.
- This adds online payment, not automatic refunds, invoice creation or seller fulfillment.
