# Supabase backend

The app currently saves your public Supabase project settings in `shop.config.json` and uses live mode. An explicit `SHOP_DEMO_MODE=true` override enables a browser-only demo for trying the shopping/admin flow. Demo orders are explicitly labelled, stay on the same browser, and are not sales. Use invented contact details when testing.

Read-only checks against the saved project reached Supabase Authentication successfully, but its REST API returned `PGRST205` for `products`, `orders`, `order_items`, and `admin_members`: these tables were not present in the exposed schema cache. Apply the complete migration in this same project's SQL Editor, then grant your existing admin account membership using the SQL below. A live checkout has not yet been verified.

## Connect a live shop

1. Create a Supabase project. The free plan is suitable for an initial small shop; check current quotas and inactivity policies before launch. Choose a region close to your customers (for India, a nearby available region such as Mumbai or Singapore).
2. Open the SQL editor and run `migrations/202610120001_crochet_shop.sql` once. It creates the product catalog, private orders, checkout transaction, authorization policies, and `product-images` storage bucket. With the Supabase CLI you can instead link the project and run `supabase db push`.
3. In **Authentication → Users**, create your admin account with a strong password. Registration is not part of this storefront. For an admin-only site, disable public new-user signups in the authentication settings.
4. Grant only your account admin membership in the SQL editor, replacing the example email:

   ```sql
   insert into public.admin_members (user_id)
   select id from auth.users where email = 'your-admin-email@example.com'
   on conflict (user_id) do nothing;
   ```

   Check that exactly your intended account is listed. A logged-in account without this membership cannot read orders or manage products. No browser can grant itself membership.
5. Copy the **Project URL** and **publishable key** from Supabase project settings. A legacy `anon` key also works. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (or `SUPABASE_ANON_KEY`) in the hosting build environment, and `SHOP_DEMO_MODE=false`. Set `SHOP_NAME` when you choose the business name. Run `npm run build`. The prebuild script generates `public/shop-config.json`; these values are intentionally public. Never use a service-role JWT, `sb_secret_` key, database password, or admin password in the frontend.
6. Deploy `dist/madhu/browser` to a static host. Open the admin page, sign in, upload actual product photos, set prices/stock, and add products. Live mode starts with an empty catalog, with no demo products or orders copied to Supabase.
7. Before taking customer orders, confirm one test checkout appears in admin, mark its payment manually, change its status, and confirm an anonymous browser cannot open the admin dashboard.

`node scripts/write-shop-config.mjs` regenerates the public config. It reads saved public settings from `shop.config.json`, unless backend environment variables override them. Without a saved file or environment settings it defaults to demo mode. A partial live configuration fails the build rather than silently becoming a demo. `SHOP_DEMO_MODE=true` explicitly builds a demo with no backend keys included.

## Data and access

- Amounts are integer paise in PostgreSQL and displayed in INR in the app. Checkout calculates discounts on the server and snapshots item names/images/prices. Client-supplied amounts, order status, or payment flags are ignored.
- Public visitors can read available products and submit a cart through `create_order`. They cannot directly insert, read, update, or delete orders or customer data. The RPC returns only an opaque ID and order number.
- Every order starts `new` with payment `pending`. An administrator can manually mark payment `received` and update fulfillment status. This does not charge a card, verify a bank transfer, issue a refund, or send notifications.
- Checkout validates contact details and 1–8 distinct products, with 1–10 units each. Product rows lock in a consistent order, so concurrent checkouts cannot oversell. Duplicate retries with the same random request ID create one order. Any rejected checkout rolls back all stock changes.
- Admin updates are restricted to order status and payment status. They cannot edit recorded totals, customer fields, or order-item snapshots from this browser. The dashboard loads 100 orders at a time and can load older orders in additional pages.
- Hiding a product (`available=false`) removes it from the public catalog without deleting old order references. Cancelling an order does not automatically restock or refund it; adjust product stock deliberately if the goods can be sold again.
- Photos accept JPG/PNG/WebP only, up to 5 MB before upload. The browser resizes them to at most 1,600 pixels and compresses them to at most 400 KB. Public immutable photo URLs are cached for a year. Only admins may upload. Old objects can be cleaned up in Supabase Storage after ensuring no product or order snapshot uses them.
- Order contact details are private under row-level security. Establish retention and deletion practices for your real business, and restrict Supabase dashboard access to the owner. Database backups and custom SMTP are separate Supabase configuration decisions.

Anonymous checkout is intentionally available for guest customers. Before a public promotion with significant traffic, add server-side request limiting or CAPTCHA verification using a Supabase Edge Function if abuse becomes a concern; a static frontend cannot keep a privileged anti-abuse secret.

## Backend regression check

`bash supabase/tests/run-security-tests.sh` starts an isolated PostgreSQL container and validates the actual migration and checkout/RLS rules. Its minimal auth/storage schemas substitute for Supabase-managed schemas; it does not contact or modify a live project. Requires Docker and access to the official `postgres:17-alpine` image. Browser/end-to-end tests separately exercise the demo application flow.
