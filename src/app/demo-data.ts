import type { Product, ShopOrder } from './models';

export const DEMO_PRODUCTS: Product[] = [
  { id: 'demo-bag', name: 'Everyday Bloom Tote', description: 'An easygoing cotton tote with a hand-crocheted daisy detail. Room for your everyday little essentials.', category: 'Bags', price: 1299, discountPercent: 10, imageUrl: '/images/bag.webp', available: true, stock: 8, featured: true, createdAt: '2026-10-01T09:00:00Z' },
  { id: 'demo-bunny', name: 'Little Cloud Bunny', description: 'A soft, cuddly handmade bunny with long ears and plenty of personality. A lovely keepsake gift.', category: 'Plushies', price: 899, discountPercent: 0, imageUrl: '/images/bunny.webp', available: true, stock: 6, featured: true, createdAt: '2026-10-02T09:00:00Z' },
  { id: 'demo-flowers', name: 'Forever Flower Bouquet', description: 'A cheerful bunch of crochet flowers that never needs watering. Handmade petals, wrapped ready to gift.', category: 'Flowers', price: 1499, discountPercent: 15, imageUrl: '/images/flowers.webp', available: true, stock: 5, featured: true, createdAt: '2026-10-03T09:00:00Z' },
  { id: 'demo-coaster', name: 'Sunny Daisy Coasters', description: 'A set of four cotton flower coasters to bring a little sunshine to your tea break.', category: 'Home', price: 499, discountPercent: 0, imageUrl: '/images/coaster.webp', available: true, stock: 12, featured: false, createdAt: '2026-10-04T09:00:00Z' },
  { id: 'demo-bucket', name: 'Weekend Bucket Hat', description: 'A lightweight cotton bucket hat with a relaxed fit. Made slowly, for sunny days and little adventures.', category: 'Accessories', price: 799, discountPercent: 10, imageUrl: '/images/bucket.webp', available: true, stock: 7, featured: false, createdAt: '2026-10-05T09:00:00Z' },
  { id: 'demo-keychain', name: 'Pocket Strawberry Charm', description: 'A sweet crochet strawberry to brighten your keys or bag. A small handmade gift with a big smile.', category: 'Accessories', price: 249, discountPercent: 0, imageUrl: '/images/keychain.webp', available: true, stock: 20, featured: false, createdAt: '2026-10-06T09:00:00Z' },
];

// Fictitious data only. Real customer orders live exclusively in Supabase.
export const DEMO_ORDERS: ShopOrder[] = [{
  id: 'demo-order-example', orderNumber: 'DEMO-1001',
  customer: { name: 'Sample Customer', phone: '9999999999', email: 'sample@example.com', address: '12 Sample Street, Example Colony', city: 'Hyderabad', postalCode: '500001', note: 'This is a sample order. Please do not dispatch.' },
  items: [{ productId: 'demo-bag', name: 'Everyday Bloom Tote', imageUrl: '/images/bag.webp', quantity: 1, unitPrice: 1169.10 }],
  subtotal: 1169.10, total: 1169.10, status: 'new', paymentStatus: 'pending', createdAt: '2026-10-12T09:00:00Z',
}];
