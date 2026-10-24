import { Injectable, signal } from '@angular/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEMO_ORDERS, DEMO_PRODUCTS } from './demo-data';
import { normalizePhone } from './shop.utils';
import type { CartLine, Customer, OrderStatus, PaymentStatus, Product, ProductDraft, PublicShopConfig, ShopOrder } from './models';

const DEFAULT_CONFIG: PublicShopConfig = { shopName: 'Thread in Loops', currency: 'INR', currencyLocale: 'en-IN', supabaseUrl: '', supabaseAnonKey: '', demoMode: true };
const PRODUCTS_KEY = 'madhu-crochet-demo-products-v1';
const ORDERS_KEY = 'madhu-crochet-demo-orders-v1';
const ORDER_STATUSES: OrderStatus[] = ['new', 'confirmed', 'making', 'shipped', 'delivered', 'cancelled', 'refunded', 'returned'];
const PAYMENT_STATUSES: PaymentStatus[] = ['pending', 'received'];
const ORDER_PAGE_SIZE = 100;

async function timedFetch(input: RequestInfo | URL, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const source = options.signal;
  const abort = () => controller.abort(source?.reason);
  if (source?.aborted) abort(); else source?.addEventListener('abort', abort, { once: true });
  let expired = false;
  const timer = setTimeout(() => { expired = true; controller.abort(); }, 15000);
  try { return await fetch(input, { ...options, signal: controller.signal }); }
  catch (error) { if (expired) throw new Error('The shop took too long to respond. Please try again.'); throw error; }
  finally { clearTimeout(timer); source?.removeEventListener('abort', abort); }
}

/** Prices shown in INR; rounding matches the database's integer-paise arithmetic. */
export function discountedPrice(price: number, discountPercent: number): number {
  return Math.round(Math.round(price * 100) * (100 - discountPercent) / 100) / 100;
}

export function normalizeCustomer(customer: Customer): Customer {
  const phone = normalizePhone(customer.phone);
  const cleaned = {
    name: customer.name.trim(), phone, email: customer.email.trim().toLowerCase(),
    address: customer.address.trim(), city: customer.city.trim(), postalCode: customer.postalCode.trim(), note: customer.note.trim(),
  };
  if (cleaned.name.length < 2 || cleaned.name.length > 100) throw new Error('Enter a name between 2 and 100 characters.');
  if (!/^[6-9]\d{9}$/.test(phone)) throw new Error('Enter a valid 10-digit Indian mobile number.');
  if (cleaned.address.length < 10 || cleaned.address.length > 400) throw new Error('Enter a complete delivery address (10–400 characters).');
  if (cleaned.city.length < 2 || cleaned.city.length > 100) throw new Error('Enter your town or city.');
  if (!/^[1-9]\d{5}$/.test(cleaned.postalCode)) throw new Error('Enter a valid 6-digit Indian PIN code.');
  if (cleaned.email && (cleaned.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned.email))) throw new Error('Enter a valid email address, or leave it empty.');
  if (cleaned.note.length > 500) throw new Error('Keep your order note under 500 characters.');
  return cleaned;
}

export function validateProduct(draft: ProductDraft): ProductDraft {
  const clean = { ...draft, name: draft.name.trim(), description: draft.description.trim(), category: draft.category.trim(), imageUrl: draft.imageUrl.trim() };
  if (clean.name.length < 2 || clean.name.length > 120) throw new Error('Product name must have 2–120 characters.');
  if (clean.description.length > 2000) throw new Error('Product description must be under 2,000 characters.');
  if (!clean.category || clean.category.length > 60) throw new Error('Choose a product category under 60 characters.');
  if (!Number.isFinite(clean.price) || clean.price <= 0 || clean.price > 100000 || Math.abs(clean.price * 100 - Math.round(clean.price * 100)) > 0.000001) throw new Error('Price must be between ₹0.01 and ₹1,00,000, with at most two decimal places.');
  if (!Number.isInteger(clean.discountPercent) || clean.discountPercent < 0 || clean.discountPercent > 95) throw new Error('Discount must be a whole percent between 0 and 95.');
  if (!Number.isInteger(clean.stock) || clean.stock < 0 || clean.stock > 10000) throw new Error('Stock must be a whole number between 0 and 10,000.');
  const demoImage = /^data:image\/(webp|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(clean.imageUrl);
  if (!clean.imageUrl || clean.imageUrl.length > (demoImage ? 550000 : 2048) || !(demoImage || /^(https:\/\/|\/images\/)/.test(clean.imageUrl))) throw new Error('Upload a JPG, PNG, or WebP product image.');
  if (discountedPrice(clean.price, clean.discountPercent) < 0.01) throw new Error('The discounted price must be at least ₹0.01.');
  return clean;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Shop configuration is not a JSON object.');
  return value as Record<string, unknown>;
}

function configFromJson(value: unknown): PublicShopConfig {
  const source = object(value);
  if ('demoMode' in source && typeof source['demoMode'] !== 'boolean') throw new Error('Shop configuration demoMode must be true or false.');
  const config: PublicShopConfig = {
    shopName: 'Thread in Loops',
    currency: 'INR', currencyLocale: 'en-IN',
    supabaseUrl: typeof source['supabaseUrl'] === 'string' ? source['supabaseUrl'].trim() : '',
    supabaseAnonKey: typeof source['supabaseAnonKey'] === 'string' ? source['supabaseAnonKey'].trim() : '',
    demoMode: typeof source['demoMode'] === 'boolean' ? source['demoMode'] : !(source['supabaseUrl'] || source['supabaseAnonKey']),
  };
  if (!config.demoMode) {
    if (!/^https:\/\/[^/]+\.supabase\.co\/?$/.test(config.supabaseUrl) || !config.supabaseAnonKey) throw new Error('Live shop setup is incomplete. Add the Supabase project URL and public key.');
    if (config.supabaseAnonKey.startsWith('sb_secret_')) throw new Error('A private Supabase key cannot be used in this website. Use the public publishable key.');
    // Legacy anon JWTs are public; service-role JWTs must never reach a browser.
    if (!config.supabaseAnonKey.startsWith('sb_publishable_')) {
      try {
        const payload = object(JSON.parse(atob(config.supabaseAnonKey.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))));
        if (payload['role'] !== 'anon') throw new Error('wrong-role');
      } catch { throw new Error('Use a Supabase public publishable key or legacy anon key, never a service-role key.'); }
    }
  }
  return config;
}

@Injectable({ providedIn: 'root' })
export class ShopService {
  readonly products = signal<Product[]>([]);
  readonly orders = signal<ShopOrder[]>([]);
  readonly hasMoreOrders = signal(false);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly config = signal<PublicShopConfig>({ ...DEFAULT_CONFIG });
  readonly isAdmin = signal(false);
  readonly demoMode = signal(true);
  private client?: SupabaseClient;
  private initialization?: Promise<void>;
  private pendingCheckout?: { fingerprint: string; requestId: string };
  private activeOperations = 0;

  initialize(): Promise<void> {
    this.initialization ??= this.run(async () => {
      const response = await timedFetch('/shop-config.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error(response.status === 404 ? 'Shop configuration is missing. Rebuild and redeploy the website.' : 'Could not load the shop configuration. Please refresh.');
      const config = configFromJson(await response.json());
      this.config.set(config);
      this.demoMode.set(config.demoMode);
      if (config.demoMode) {
        this.products.set(this.readDemo<Product[]>(PRODUCTS_KEY, DEMO_PRODUCTS));
        return;
      }
      const { createClient } = await import('@supabase/supabase-js');
      this.client = createClient(config.supabaseUrl, config.supabaseAnonKey, { global: { fetch: timedFetch }, auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
      this.client.auth.onAuthStateChange((_event, session) => {
        if (!session) { this.isAdmin.set(false); this.orders.set([]); this.hasMoreOrders.set(false); }
        // Avoid awaited Supabase calls within auth callbacks (SDK auth-lock deadlock).
        else setTimeout(() => { void this.refreshAdmin().catch(() => { this.isAdmin.set(false); this.orders.set([]); this.hasMoreOrders.set(false); }); }, 0);
      });
      await this.refreshAdmin();
      await this.refreshProducts();
    }).catch(error => { this.initialization = undefined; throw error; });
    return this.initialization;
  }

  async signIn(email: string, password: string): Promise<void> {
    await this.initialize();
    await this.run(async () => {
      if (this.demoMode()) throw new Error('This is a demo. Use “Open demo admin” to try the dashboard.');
      const client = this.requireClient();
      const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw new Error('Sign-in failed. Check your email and password.');
      await this.refreshAdmin();
      if (!this.isAdmin()) { await client.auth.signOut(); throw new Error('This account does not have shop admin access.'); }
      await this.refreshProducts();
      await this.fetchOrders();
    });
  }

  async signOut(): Promise<void> {
    await this.run(async () => {
      if (this.client) { const { error } = await this.client.auth.signOut({ scope: 'local' }); if (error) throw error; }
      this.isAdmin.set(false);
      this.orders.set([]);
      this.hasMoreOrders.set(false);
      if (!this.demoMode()) await this.refreshProducts();
    });
  }

  async enterDemoAdmin(): Promise<void> {
    await this.initialize();
    await this.run(async () => {
      if (!this.config().demoMode || !this.demoMode()) throw new Error('Demo admin is disabled for the live shop.');
      this.isAdmin.set(true);
      this.orders.set(this.readDemo<ShopOrder[]>(ORDERS_KEY, DEMO_ORDERS));
      this.hasMoreOrders.set(false);
    });
  }

  async loadOrders(): Promise<void> {
    await this.initialize();
    await this.run(async () => { this.requireAdmin(); await this.fetchOrders(); });
  }

  async loadMoreOrders(): Promise<void> {
    await this.initialize();
    await this.run(async () => { this.requireAdmin(); if (this.hasMoreOrders()) await this.fetchOrders(false); });
  }

  async saveProduct(draft: ProductDraft, id?: string): Promise<void> {
    await this.initialize();
    await this.run(async () => {
      this.requireAdmin();
      const clean = validateProduct(draft);
      if (this.demoMode()) {
        const products = [...this.products()];
        const index = products.findIndex(product => product.id === id);
        if (id && index < 0) throw new Error('That product no longer exists. Refresh and try again.');
        const product: Product = { ...clean, id: id ?? `demo-${crypto.randomUUID()}`, createdAt: index >= 0 ? products[index]!.createdAt : new Date().toISOString() };
        if (index >= 0) products[index] = product; else products.unshift(product);
        this.writeDemo(PRODUCTS_KEY, products);
        this.products.set(products);
        return;
      }
      if (clean.imageUrl.startsWith('data:')) throw new Error('Upload this image to the live shop before saving.');
      const row = { name: clean.name, description: clean.description, category: clean.category, price_paise: Math.round(clean.price * 100), discount_percent: clean.discountPercent, image_url: clean.imageUrl, available: clean.available, stock: clean.stock, featured: clean.featured };
      const query = id ? this.requireClient().from('products').update(row).eq('id', id) : this.requireClient().from('products').insert(row);
      const { data, error } = await query.select('id').single();
      if (error || !data) throw error ?? new Error('Could not save the product.');
      await this.refreshProducts();
    });
  }

  async uploadImage(file: File): Promise<string> {
    await this.initialize();
    return this.run(async () => {
      this.requireAdmin();
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size < 1 || file.size > 5 * 1024 * 1024) throw new Error('Choose a JPG, PNG, or WebP image under 5 MB.');
      const blob = await this.resizeImage(file);
      if (this.demoMode()) return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Could not read this image.'));
        reader.readAsDataURL(blob);
      });
      const path = `${crypto.randomUUID()}.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`;
      const client = this.requireClient();
      const { error } = await client.storage.from('product-images').upload(path, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false });
      if (error) throw error;
      return client.storage.from('product-images').getPublicUrl(path).data.publicUrl;
    });
  }

  async updateOrder(id: string, status: OrderStatus): Promise<void> {
    await this.initialize();
    await this.run(async () => {
      this.requireAdmin();
      if (!ORDER_STATUSES.includes(status)) throw new Error('Choose a valid order status.');
      if (this.demoMode()) {
        const orders = this.readDemo<ShopOrder[]>(ORDERS_KEY, DEMO_ORDERS);
        if (!orders.some(order => order.id === id)) throw new Error('Order not found.');
        const next = orders.map(order => order.id === id ? { ...order, status } : order);
        this.writeDemo(ORDERS_KEY, next);
        this.orders.set(next);
        return;
      }
      const { data, error } = await this.requireClient().from('orders').update({ status }).eq('id', id).select('id,status,payment_status').single();
      if (error || !data) throw error ?? new Error('Could not update the order.');
      this.orders.update(orders => orders.map(order => order.id === id ? { ...order, status: data.status as OrderStatus, paymentStatus: data.payment_status as PaymentStatus } : order));
    });
  }

  async placeOrder(customer: Customer, cart: CartLine[]): Promise<{ id: string; orderNumber: string }> {
    await this.initialize();
    return this.run(async () => {
      const clean = normalizeCustomer(customer);
      if (!cart.length || cart.length > 8 || new Set(cart.map(line => line.productId)).size !== cart.length || cart.some(line => !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 10)) throw new Error('Choose 1–8 different products, with 1–10 of each.');
      if (this.demoMode()) {
        const products = this.products().map(product => ({ ...product }));
        const items = cart.map(line => {
          const product = products.find(product => product.id === line.productId);
          if (!product || !product.available || product.stock < line.quantity) throw new Error('An item is no longer available in that quantity. Please review your cart.');
          product.stock -= line.quantity;
          return { productId: product.id, name: product.name, imageUrl: product.imageUrl, quantity: line.quantity, unitPrice: discountedPrice(product.price, product.discountPercent) };
        });
        const total = items.reduce((sum, item) => sum + Math.round(item.unitPrice * 100) * item.quantity, 0) / 100;
        const id = `demo-${crypto.randomUUID()}`;
        const order: ShopOrder = { id, orderNumber: `DEMO-${Date.now().toString(36).toUpperCase()}-${id.slice(-4).toUpperCase()}`, customer: clean, items, subtotal: total, total, status: 'new', paymentStatus: 'pending', createdAt: new Date().toISOString() };
        const orders = [order, ...this.readDemo<ShopOrder[]>(ORDERS_KEY, DEMO_ORDERS)];
        this.writeDemoCheckout(orders, products);
        this.products.set(products);
        if (this.isAdmin()) this.orders.set(orders);
        return { id, orderNumber: order.orderNumber };
      }
      const fingerprint = JSON.stringify([clean, cart]);
      if (this.pendingCheckout?.fingerprint !== fingerprint) this.pendingCheckout = { fingerprint, requestId: crypto.randomUUID() };
      const { data, error } = await this.requireClient().rpc('create_order', { p_customer: clean, p_cart: cart.map(line => ({ product_id: line.productId, quantity: line.quantity })), p_request_id: this.pendingCheckout.requestId });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.id || !result?.order_number) throw new Error('Could not confirm your order. Please retry without changing your cart.');
      this.pendingCheckout = undefined;
      // A confirmed order must stay successful if refreshing the catalog fails.
      await this.refreshProducts().catch(() => undefined);
      return { id: result.id, orderNumber: result.order_number };
    });
  }

  private async refreshAdmin(): Promise<void> {
    const client = this.requireClient();
    const { data: { session }, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (!session) { this.isAdmin.set(false); this.orders.set([]); this.hasMoreOrders.set(false); return; }
    const { data, error } = await client.from('admin_members').select('user_id').eq('user_id', session.user.id).maybeSingle();
    if (error) throw error;
    const { data: latest } = await client.auth.getSession();
    const authorized = Boolean(data) && latest.session?.user.id === session.user.id;
    this.isAdmin.set(authorized);
    if (!authorized) { this.orders.set([]); this.hasMoreOrders.set(false); }
  }

  private async refreshProducts(): Promise<void> {
    let query = this.requireClient().from('products').select('*').order('created_at', { ascending: false });
    if (!this.isAdmin()) query = query.eq('available', true);
    const { data, error } = await query;
    if (error) throw error;
    this.products.set((data ?? []).map(row => ({ id: row.id, name: row.name, description: row.description, category: row.category, price: row.price_paise / 100, discountPercent: row.discount_percent, imageUrl: row.image_url, available: row.available, stock: row.stock, featured: row.featured, createdAt: row.created_at })));
  }

  private async fetchOrders(reset = true): Promise<void> {
    if (this.demoMode()) { this.orders.set(this.readDemo<ShopOrder[]>(ORDERS_KEY, DEMO_ORDERS)); this.hasMoreOrders.set(false); return; }
    const offset = reset ? 0 : this.orders().length;
    const { data, error } = await this.requireClient().from('orders').select('*, order_items(*)').order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + ORDER_PAGE_SIZE);
    if (error) throw error;
    this.requireAdmin();
    const page: ShopOrder[] = (data ?? []).slice(0, ORDER_PAGE_SIZE).map(row => ({ id: row.id, orderNumber: row.order_number, customer: { name: row.customer_name, phone: row.customer_phone, email: row.customer_email, address: row.customer_address, city: row.customer_city, postalCode: row.customer_postal_code, note: row.customer_note }, items: (row.order_items ?? []).map((item: Record<string, unknown>) => ({ productId: item['product_id'] as string, name: item['product_name'] as string, imageUrl: item['image_url'] as string, quantity: item['quantity'] as number, unitPrice: (item['unit_price_paise'] as number) / 100 })), subtotal: row.total_paise / 100, total: row.total_paise / 100, status: row.status, paymentStatus: row.payment_status, createdAt: row.created_at }));
    this.orders.set(reset ? page : [...this.orders(), ...page]);
    this.hasMoreOrders.set((data ?? []).length > ORDER_PAGE_SIZE);
  }

  private requireAdmin(): void { if (!this.isAdmin()) throw new Error('Sign in as a shop admin to make this change.'); }
  private requireClient(): SupabaseClient { if (!this.client) throw new Error('The live shop backend has not been configured.'); return this.client; }

  private readDemo<T>(key: string, fallback: T): T {
    try {
      const value = localStorage.getItem(key);
      if (!value) return structuredClone(fallback);
      const parsed: unknown = JSON.parse(value);
      if (!Array.isArray(parsed) || parsed.length > 5000) throw new Error('Invalid demo data.');
      for (const entry of parsed) {
        const row = object(entry);
        if (typeof row['id'] !== 'string' || !row['id'] || row['id'].length > 100 || typeof row['createdAt'] !== 'string' || !Number.isFinite(Date.parse(row['createdAt']))) throw new Error('Invalid demo record.');
        if (key === PRODUCTS_KEY) {
          for (const field of ['name', 'description', 'category', 'imageUrl']) if (typeof row[field] !== 'string') throw new Error('Invalid demo product.');
          for (const field of ['available', 'featured']) if (typeof row[field] !== 'boolean') throw new Error('Invalid demo product.');
          validateProduct(entry as Product);
        } else if (key === ORDERS_KEY) {
          const customer = object(row['customer']);
          for (const field of ['name', 'phone', 'email', 'address', 'city', 'postalCode', 'note']) if (typeof customer[field] !== 'string') throw new Error('Invalid demo customer.');
          normalizeCustomer(customer as unknown as Customer);
          if (typeof row['orderNumber'] !== 'string' || !row['orderNumber'] || !ORDER_STATUSES.includes(row['status'] as OrderStatus) || !PAYMENT_STATUSES.includes(row['paymentStatus'] as PaymentStatus) || typeof row['total'] !== 'number' || !Number.isFinite(row['total']) || row['total'] <= 0 || typeof row['subtotal'] !== 'number' || !Number.isFinite(row['subtotal']) || !Array.isArray(row['items']) || row['items'].length < 1 || row['items'].length > 8) throw new Error('Invalid demo order.');
          for (const itemValue of row['items']) {
            const item = object(itemValue);
            if (typeof item['productId'] !== 'string' || typeof item['name'] !== 'string' || typeof item['imageUrl'] !== 'string' || !/^(https:\/\/|\/images\/|data:image\/(webp|jpeg);base64,)/.test(item['imageUrl']) || !Number.isInteger(item['quantity']) || (item['quantity'] as number) < 1 || (item['quantity'] as number) > 10 || typeof item['unitPrice'] !== 'number' || !Number.isFinite(item['unitPrice']) || item['unitPrice'] <= 0) throw new Error('Invalid demo order item.');
          }
        }
      }
      return parsed as T;
    }
    catch { return structuredClone(fallback); }
  }

  private writeDemo(key: string, value: unknown): void {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch { throw new Error('Your browser storage is full or unavailable. Clear old demo data or try another browser.'); }
  }

  private writeDemoCheckout(orders: ShopOrder[], products: Product[]): void {
    const previousOrders = localStorage.getItem(ORDERS_KEY);
    const previousProducts = localStorage.getItem(PRODUCTS_KEY);
    try { this.writeDemo(ORDERS_KEY, orders); this.writeDemo(PRODUCTS_KEY, products); }
    catch (error) {
      // Keep a browser quota failure from creating an order without decrementing stock.
      if (previousOrders === null) localStorage.removeItem(ORDERS_KEY); else localStorage.setItem(ORDERS_KEY, previousOrders);
      if (previousProducts === null) localStorage.removeItem(PRODUCTS_KEY); else localStorage.setItem(PRODUCTS_KEY, previousProducts);
      throw error;
    }
  }

  private async run<T>(action: () => Promise<T>): Promise<T> {
    this.activeOperations++;
    this.loading.set(true);
    this.error.set('');
    try { return await action(); }
    catch (error) {
      const message = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String(error.message) : 'Something went wrong. Please try again.';
      this.error.set(message);
      throw new Error(message);
    } finally { this.activeOperations--; this.loading.set(this.activeOperations > 0); }
  }

  private async resizeImage(file: File): Promise<Blob> {
    let bitmap: ImageBitmap;
    try { bitmap = await createImageBitmap(file); }
    catch { throw new Error('This file is not a readable image. Try a JPG, PNG, or WebP photo.'); }
    try {
      if (bitmap.width * bitmap.height > 40000000) throw new Error('This photo is too large. Resize it to under 40 megapixels first.');
      const ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Your browser could not prepare the image.');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const encodeType = (type: string, quality: number) => new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality));
      const encode = async (quality: number): Promise<Blob> => {
        const webp = await encodeType('image/webp', quality);
        if (webp?.type === 'image/webp') return webp;
        const jpeg = await encodeType('image/jpeg', quality);
        if (jpeg?.type === 'image/jpeg') return jpeg;
        throw new Error('Your browser does not support photo compression.');
      };
      for (const quality of [0.82, 0.68, 0.5, 0.35]) {
        const blob = await encode(quality);
        if (blob.size <= 400 * 1024) return blob;
      }
      throw new Error('This photo is too detailed to compress. Choose a smaller image.');
    } finally { bitmap.close(); }
  }
}
