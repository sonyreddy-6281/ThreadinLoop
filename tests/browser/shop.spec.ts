import { expect, test, type Page } from '@playwright/test';
import { DEMO_PRODUCTS } from '../../src/app/demo-data';
import { salePrice } from '../../src/app/shop.utils';

const pageErrors = new WeakMap<Page, string[]>();
const delivery = {
  name: 'Asha Test Customer', phone: '9876543210', email: 'asha.test@example.com',
  address: '12 Jasmine Street, Flat 3, Near City Library', city: 'Hyderabad',
  postal: '500001', note: 'Please call before delivery.',
};

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  // Browser tests deliberately use the labelled local demo. They do not assert live Supabase access.
  await page.route('**/shop-config.json', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ shopName: 'Crochet Studio', currency: 'INR', currencyLocale: 'en-IN',
      demoMode: true, supabaseUrl: '', supabaseAnonKey: '' }),
  }));
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
});

async function addFirstProduct(page: Page): Promise<string> {
  const first = page.getByTestId('product-card').first();
  await expect(first).toBeVisible();
  const button = first.locator('[data-testid^="add-to-cart-"]');
  const id = (await button.getAttribute('data-testid'))!.replace('add-to-cart-', '');
  await button.click();
  return id;
}

async function openCheckout(page: Page): Promise<string> {
  await page.goto('/');
  const id = await addFirstProduct(page);
  await page.getByTestId('cart-open').click();
  await page.getByTestId('cart-checkout').click();
  await expect(page.getByRole('heading', { name: 'Delivery details', exact: true })).toBeVisible();
  return id;
}

async function fillDelivery(page: Page): Promise<void> {
  for (const [field, value] of Object.entries(delivery)) {
    await page.getByTestId(`checkout-${field}`).fill(value);
  }
}

async function demoSignIn(page: Page): Promise<void> {
  const login = page.getByTestId('admin-demo-login');
  await expect(login.or(page.getByTestId('admin-product-new'))).toBeVisible();
  if (await login.isVisible()) await login.click();
  await expect(page.getByTestId('admin-product-new')).toBeVisible();
}

test('catalog supports searching, category browsing and loading real product images', async ({ page }) => {
  await page.goto('/');
  const cards = page.getByTestId('product-card');
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThanOrEqual(3);
  const firstName = (await cards.first().getByRole('heading').innerText()).trim();
  await page.getByTestId('catalog-search').fill(firstName);
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText(firstName);
  await page.getByTestId('catalog-search').fill('no-such-crochet-item-abcdefgh');
  await expect(cards).toHaveCount(0);
  await page.getByTestId('catalog-search').clear();
  await page.getByRole('button', { name: 'Bags', exact: true }).click();
  await expect(cards.first()).toBeVisible();
  for (const card of await cards.all()) await expect(card).toContainText('Bags');
  await page.getByRole('button', { name: 'All pieces', exact: true }).click();
  await expect.poll(() => cards.first().getByRole('img').evaluate((image: HTMLImageElement) =>
    image.complete && image.naturalWidth > 0)).toBe(true);
});

test('cart quantities and discounted INR total survive a reload and support removal', async ({ page }) => {
  await page.goto('/');
  const id = await addFirstProduct(page);
  await page.getByTestId('cart-open').click();
  const quantity = page.getByTestId(`cart-quantity-${id}`);
  await expect(quantity).toHaveValue('1');
  await quantity.fill('2');
  await quantity.blur();
  await expect(quantity).toHaveValue('2');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('crochet.cart.v1') || '[]')))
    .toEqual([{ productId: id, quantity: 2 }]);
  const totalBeforeReload = await page.getByTestId('cart-total').innerText();
  expect(totalBeforeReload).toContain('₹');
  const product = DEMO_PRODUCTS.find(product => product.id === id)!;
  expect(Number(totalBeforeReload.replace(/[₹,\s]/g, ''))).toBe(salePrice(product) * 2);
  await page.reload();
  await page.getByTestId('cart-open').click();
  await expect(page.getByTestId(`cart-quantity-${id}`)).toHaveValue('2');
  await expect(page.getByTestId('cart-total')).toHaveText(totalBeforeReload);
  await page.getByRole('button', { name: `Remove ${product.name} from cart`, exact: true }).click();
  await expect(page.getByTestId(`cart-quantity-${id}`)).toHaveCount(0);
  await expect(page.getByTestId('cart-checkout')).toHaveCount(0);
});

test('checkout validates delivery details and saves a complete order for manual payment', async ({ page }) => {
  await openCheckout(page);
  await fillDelivery(page);
  await page.getByTestId('checkout-phone').fill('1234');
  await page.getByTestId('checkout-postal').fill('123');
  await page.getByTestId('checkout-submit').click();
  await expect(page.getByTestId('order-success')).toHaveCount(0);
  await expect(page.getByTestId('checkout-errors')).toBeVisible();
  await page.getByTestId('checkout-phone').fill(delivery.phone);
  await page.getByTestId('checkout-postal').fill(delivery.postal);
  await page.getByTestId('checkout-submit').click();
  await expect(page.getByTestId('order-success')).toBeVisible();
  await expect(page.getByTestId('order-success')).toContainText(/payment|pay/i);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('crochet.cart.v1') || '[]'))).toEqual([]);
  await page.goto('/admin');
  await expect(page.getByText(delivery.name, { exact: true })).toHaveCount(0);
  await expect(page.getByText(delivery.phone, { exact: true })).toHaveCount(0);
  await demoSignIn(page);
  await page.getByTestId('admin-orders-tab').click();
  await expect(page.getByText(delivery.name, { exact: true })).toBeVisible();
  await page.locator('[data-testid^="order-details-"]').first().click();
  const orderDialog = page.getByTestId('order-dialog');
  await expect(orderDialog.getByText(delivery.phone, { exact: true })).toBeVisible();
  await expect(orderDialog.getByText(delivery.address, { exact: false })).toBeVisible();
  await expect(orderDialog.getByText(delivery.city, { exact: false })).toBeVisible();
  await expect(orderDialog.getByText(delivery.postal, { exact: false })).toBeVisible();
});

test('admin order and manually recorded payment statuses persist', async ({ page }) => {
  await openCheckout(page);
  await fillDelivery(page);
  await page.getByTestId('checkout-submit').click();
  await expect(page.getByTestId('order-success')).toBeVisible();
  await page.goto('/admin');
  await demoSignIn(page);
  await page.getByTestId('admin-orders-tab').click();
  const details = page.locator('[data-testid^="order-details-"]').first();
  const orderId = (await details.getAttribute('data-testid'))!.replace('order-details-', '');
  await details.click();
  await page.getByTestId(`admin-order-status-${orderId}`).selectOption('making');
  await page.getByTestId(`admin-order-payment-${orderId}`).selectOption('received');
  await page.getByTestId('admin-order-save').click();
  await expect(page.getByTestId('order-dialog').getByRole('status')).toContainText('Order and payment status saved.');
  await page.reload();
  await demoSignIn(page);
  await page.getByTestId('admin-orders-tab').click();
  await page.getByTestId(`order-details-${orderId}`).click();
  await expect(page.getByTestId(`admin-order-status-${orderId}`)).toHaveValue('making');
  await expect(page.getByTestId(`admin-order-payment-${orderId}`)).toHaveValue('received');
});

test('admin uploads a product photo, edits its discount and can hide it from the catalog', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByTestId('admin-product-new')).toHaveCount(0);
  await demoSignIn(page);
  await page.getByTestId('admin-product-new').click();
  await page.getByTestId('admin-product-name').fill('Test Sunflower Tote');
  await page.getByTestId('admin-product-description').fill('A soft handmade cotton tote with sunny flower details.');
  await page.getByTestId('admin-product-category').fill('Bags');
  await page.getByTestId('admin-product-price').fill('1299');
  await page.getByTestId('admin-product-discount').fill('25');
  await page.getByTestId('admin-product-stock').fill('3');
  await page.getByTestId('admin-product-available').check();
  await page.getByTestId('admin-product-image').setInputFiles('public/images/bag.webp');
  await page.getByTestId('admin-product-save').click();
  await expect(page.getByTestId('admin-product-save')).toHaveCount(0);
  await expect(page.getByText('Test Sunflower Tote', { exact: true })).toBeVisible();
  await page.goto('/');
  await page.getByTestId('catalog-search').fill('Test Sunflower Tote');
  const card = page.getByTestId('product-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('25%');
  await expect(card).toContainText('974.25');
  await expect.poll(() => card.getByRole('img').evaluate((image: HTMLImageElement) =>
    image.complete && image.naturalWidth > 0)).toBe(true);
  await page.goto('/admin');
  await demoSignIn(page);
  const row = page.locator('[data-testid^="admin-product-row-"]').filter({ hasText: 'Test Sunflower Tote' });
  await row.getByRole('button', { name: /edit/i }).click();
  await page.getByTestId('admin-product-discount').fill('10');
  await page.getByTestId('admin-product-save').click();
  await expect(page.getByTestId('admin-product-save')).toHaveCount(0);
  await page.goto('/');
  await page.getByTestId('catalog-search').fill('Test Sunflower Tote');
  await expect(page.getByTestId('product-card')).toContainText(/1,169\.1(?:0)?/);
  await page.goto('/admin');
  await demoSignIn(page);
  await page.locator('[data-testid^="admin-product-row-"]').filter({ hasText: 'Test Sunflower Tote' })
    .getByRole('button', { name: /edit/i }).click();
  await page.getByTestId('admin-product-available').uncheck();
  await page.getByTestId('admin-product-save').click();
  await expect(page.getByTestId('admin-product-save')).toHaveCount(0);
  await page.goto('/');
  await page.getByTestId('catalog-search').fill('Test Sunflower Tote');
  await expect(page.getByTestId('product-card')).toHaveCount(0);
});

test('corrupt stored cart data recovers and storefront, cart, checkout and admin fit a mobile screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('crochet.cart.v1', '{invalid JSON'));
  await page.goto('/');
  await expect(page.getByTestId('product-card').first()).toBeVisible();
  const noOverflow = async () => expect(await page.evaluate(() =>
    document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await noOverflow();
  await addFirstProduct(page);
  await page.getByTestId('cart-open').click();
  await noOverflow();
  await page.getByTestId('cart-checkout').click();
  await expect(page.getByRole('heading', { name: 'Delivery details', exact: true })).toBeVisible();
  await noOverflow();
  await page.goto('/admin');
  await demoSignIn(page);
  await noOverflow();
});

test('incomplete live configuration fails closed without serving demo products or accepting an order', async ({ page }) => {
  await page.route('**/shop-config.json', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ shopName: 'Live Crochet Shop', demoMode: false,
      currency: 'INR', currencyLocale: 'en-IN', supabaseUrl: '', supabaseAnonKey: '' }),
  }));
  await page.goto('/');
  await expect(page.getByText(/Live shop setup is incomplete/)).toBeVisible();
  await expect(page.getByTestId('product-card')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('madhu-crochet-demo-orders-v1'))).toBeNull();
});

test('a configuration fetch failure can be retried without losing the page', async ({ page }) => {
  let requests = 0;
  await page.route('**/shop-config.json', route => {
    requests += 1;
    return requests === 1 ? route.fulfill({ status: 503, body: 'Temporary test outage.' }) :
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ demoMode: true }) });
  });
  await page.goto('/');
  await expect(page.getByText('Could not load the shop configuration. Please refresh.')).toBeVisible();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByTestId('product-card')).toHaveCount(DEMO_PRODUCTS.length);
  expect(requests).toBe(2);
});

test('a stalled connection times out and recovers through retry instead of leaving a loading screen', async ({ page }) => {
  test.setTimeout(45_000);
  let recover = false;
  await page.route('**/shop-config.json', route => {
    if (recover) return route.fulfill({ contentType: 'application/json',
      body: JSON.stringify({ demoMode: true }) });
    // Deliberately leave the first request pending. The application must abort it itself.
    return undefined;
  });
  await page.goto('/');
  const retry = page.getByRole('button', { name: 'Try again', exact: true });
  await expect(retry).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('alert')).toContainText(/connection|timed out|try again/i);
  recover = true;
  await retry.click();
  await expect(page.getByTestId('product-card')).toHaveCount(DEMO_PRODUCTS.length);
});

test('live client retries the same checkout safely and keeps customer details off local storage (mocked API)', async ({ page }) => {
  const productId = '00000000-0000-4000-8000-000000000123';
  let submitted: Record<string, unknown> | undefined;
  const requestIds: unknown[] = [];
  const product = { id: productId, name: 'Live Test Cotton Tote', description: 'A handmade cotton bag.',
    category: 'Bags', price_paise: 10005, discount_percent: 10, image_url: '/images/bag.webp',
    available: true, stock: 4, featured: true, created_at: '2026-10-12T09:00:00Z' };
  await page.route('**/shop-config.json', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ shopName: 'Live Test Crochet', demoMode: false,
      currency: 'INR', currencyLocale: 'en-IN', supabaseUrl: 'https://browser-test.supabase.co',
      supabaseAnonKey: 'sb_publishable_browser_test' }),
  }));
  await page.route('https://browser-test.supabase.co/**', async route => {
    const request = route.request();
    const headers = { 'access-control-allow-origin': '*',
      'access-control-allow-headers': 'apikey,authorization,content-type,x-client-info',
      'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
    } else if (request.url().includes('/rest/v1/products')) {
      await route.fulfill({ headers, contentType: 'application/json', body: JSON.stringify([product]) });
    } else if (request.url().endsWith('/rest/v1/rpc/create_order')) {
      submitted = request.postDataJSON();
      requestIds.push(submitted?.['p_request_id']);
      if (requestIds.length === 1) {
        await route.fulfill({ status: 503, headers, contentType: 'application/json',
          body: JSON.stringify({ code: 'TEST_OUTAGE', message: 'Temporary test outage.' }) });
      } else {
        await route.fulfill({ headers, contentType: 'application/json',
          body: JSON.stringify({ id: '00000000-0000-4000-8000-000000000456', order_number: 'CRO-TEST-1' }) });
      }
    } else {
      await route.fulfill({ status: 404, headers, contentType: 'application/json', body: '{}' });
    }
  });
  await openCheckout(page);
  await fillDelivery(page);
  await page.getByTestId('checkout-submit').click();
  await expect(page.getByTestId('checkout-errors')).toBeVisible();
  await expect(page.getByTestId('checkout-submit')).toBeEnabled();
  await page.getByTestId('checkout-submit').click();
  await expect(page.getByTestId('order-success')).toContainText('CRO-TEST-1');
  expect(submitted?.['p_cart']).toEqual([{ product_id: productId, quantity: 1 }]);
  expect(submitted?.['p_customer']).toEqual({
    name: delivery.name, phone: delivery.phone, email: delivery.email, address: delivery.address,
    city: delivery.city, postalCode: delivery.postal, note: delivery.note,
  });
  expect(submitted?.['p_request_id']).toMatch(/^[0-9a-f-]{36}$/);
  expect(requestIds).toHaveLength(2);
  expect(requestIds[0]).toBe(requestIds[1]);
  const localValues = await page.evaluate(() => Object.values(localStorage).join('\n'));
  expect(localValues).not.toContain(delivery.phone);
  expect(localValues).not.toContain(delivery.address);
  expect(await page.evaluate(() => localStorage.getItem('madhu-crochet-demo-orders-v1'))).toBeNull();
  await page.goto('/admin');
  await expect(page.getByLabel('Email address', { exact: true })).toBeVisible();
  await expect(page.getByTestId('admin-demo-login')).toHaveCount(0);
  await expect(page.getByTestId('admin-product-new')).toHaveCount(0);
  await expect(page.getByText(delivery.name, { exact: true })).toHaveCount(0);
});
