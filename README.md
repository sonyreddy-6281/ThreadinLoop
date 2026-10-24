# Crochet shop

A responsive Angular storefront and protected admin workspace for selling handmade crochet pieces. Prices use INR. The shop name is configurable and currently uses “Madhu’s Crochet” as a placeholder.

## View the website

Visitors need only a browser. Do not deploy or open `main.html` or `src/app/storefront/storefront.component.html`: these are Angular source templates and contain instructions such as `@if`.

To run the project locally as a developer, use Node.js 24.19.0 and run:

```bash
npm ci
npm start
```

Open the address printed by the development server. For hosting, build the application and deploy the **contents of `dist/madhu/browser`**. The compiled `index.html` must be the site entry point. Opening source templates or serving the repository root will not render the application.

This cloud onboarding interface does not provide a supported public web preview. The prepared development server is useful for internal browser validation; a static host supplies a public website address.

## Storefront

- Product photos, descriptions, categories, search, sorting, availability and INR prices with percentage discounts.
- Product detail dialogs, persistent cart, quantity controls, stock checks and checkout validation.
- Guest checkout collects full name, Indian mobile number, address, city and PIN; email and order notes are optional.
- Payments are arranged with the seller. Orders start with payment pending, and the owner records received payments manually. There is no online payment gateway or automatic payment verification.
- No delivery fee is added by the current checkout. Set the desired shipping policy before launching if you need to charge separately.

## Admin

Open the `/admin` route. In live mode it requires email/password sign-in with a Supabase account explicitly granted shop-admin membership.

The dashboard manages product images, original price, discount percentage, stock, category and storefront visibility. Orders show private customer contact/delivery details, item snapshots and totals. Statuses are New, Confirmed, Making, Shipped, Delivered and Cancelled. Payment is Pending or Received. The owner can search/filter loaded orders and load older pages of 100 orders.

Cancellation does not automatically return stock or process a refund. Adjust stock deliberately when appropriate.

## Demo and Supabase setup

The public Supabase project configuration is saved in `shop.config.json`, with demo mode disabled. `npm start` and `npm run build` now use those settings automatically. Environment variables override the saved configuration. Set `SHOP_DEMO_MODE=true` explicitly if you want a browser-only demo. Demo admin is available only in demo mode. Sample products/photos and fictional orders are for demonstration; replace them with your actual crochet products before selling. Use invented contact details when testing demo checkout. Demo orders stay in the same browser and are not real sales.

For a live shop, follow [Supabase setup](supabase/README.md): create a project, apply the supplied SQL migration, create your admin account, grant its membership, and configure:

```text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-public-publishable-key
SHOP_DEMO_MODE=false
SHOP_NAME=your-final-shop-name
```

A legacy public `SUPABASE_ANON_KEY` also works. Never include a service-role key, private secret key, admin password or database password in frontend configuration. `scripts/write-shop-config.mjs` validates and writes public runtime config before start/build. Partially configured live builds fail rather than silently using sample data. A missing or failed config request shows an error and retry.

Live customer orders are stored in Supabase PostgreSQL with row-level security. Public customers can read available products and submit validated orders, but cannot read private orders or grant themselves admin access. The checkout transaction calculates current prices on the server, snapshots product details, prevents duplicate retries, and locks stock against concurrent purchases. Product images use Supabase Storage; uploads are restricted to admins.

The supplied Supabase project URL and public publishable key are saved in `shop.config.json`. The compiled download uses live mode and requires your authorized admin login. No public hosting deployment or owner login/test order has been performed here. Local/mocked tests do not establish the outcome of a live checkout.

The latest read-only connection check reached this Supabase project, but its API reports the shop tables missing (`PGRST205`). Run the complete migration in the SQL Editor of this project and grant your admin account membership before testing orders or opening the shop to customers.

## Low-latency choices

Product photos use locally bundled, compressed WebP; live uploads resize to 1,600 pixels and at most 400 KB. Images reserve layout space and load lazily. Admin code and the Supabase SDK load separately, instead of adding their full payload to storefront startup. State uses Angular signals, order lists paginate, submissions disable duplicate clicks, and network operations time out after 15 seconds with retry handling. Actual latency depends on hosting, the Supabase region, network conditions and catalog size.

## Validation

```bash
npm run test:unit
npm run test:e2e
bash supabase/tests/run-security-tests.sh
npm run build
```

Playwright uses `/usr/bin/chromium` when present; otherwise install its browser using `npx playwright install chromium`. Browser tests start/reuse the dev server. Their API integration test mocks Supabase; they do not connect to a live project.

The backend regression script needs Docker. It runs the actual migration against an isolated PostgreSQL container with minimal Supabase auth/storage schemas, checking access policies, server pricing, stock rollback, idempotent requests and concurrent checkout. It does not contact a live database.

## Put the website on a public URL

The easiest path is Netlify Drop; you do not need Node.js or `npx` for this deployment:

1. Open `downloads/crochet-website.zip` on the GitHub `feature/crochet-shop` branch and click **Download raw file**. Download it again if you have an earlier demo ZIP.
2. Extract the archive. The extracted folder must contain `index.html`, `shop-config.json`, `_redirects`, `_headers`, JavaScript files and `images/`.
3. Sign in at https://app.netlify.com/drop and drag that extracted folder onto the upload area. Upload the compiled folder, not the repository source.
4. Netlify displays your public `https://<site-name>.netlify.app` URL. You can choose an available site name in its site settings; a custom domain is optional.
5. Open that site's `/admin` path and sign in using your Supabase admin account. Add an actual product and place one order with invented test details to confirm the database, order display, manual payment status and stock.
6. Share the shop URL after the live check succeeds. Future changes require uploading a newly built folder, or connecting the GitHub branch for automatic builds.

A Netlify deployment creates the public website URL. Publishing the Codex cloud environment is a separate action.

## Free starting hosting

Cloudflare Pages or Netlify can host the compiled application. Configure build command `npm run build`, publish directory `dist/madhu/browser`, Node.js 24.19.0 and the backend public build variables above. `_redirects` serves Angular routes such as `/admin`, and `_headers` supplies caching and browser security headers.

A compiled live-configured build is available at `downloads/crochet-website.zip` on the `feature/crochet-shop` branch. Open that file on GitHub and use **Download raw file** to download it, then extract it for local testing or static hosting. The same build is packaged outside the checkout at `/workspace/crochet-shop-website.zip`. Uploading this current build to a static host connects the frontend to the saved Supabase project; admin access requires the account and membership you configured. Supabase’s free plan is a starting option; review its current quotas/inactivity policy before launch.

Stop the development server before `npm ci`, because reinstalling replaces its dependency files. In this cloud environment use `npm ci --cache /workspace/.npm-cache`. Work in the existing checkout; tasks are already isolated and do not need another worktree.
