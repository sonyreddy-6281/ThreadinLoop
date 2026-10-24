import assert from 'node:assert/strict';
import test from 'node:test';
import type { Customer, Product } from '../src/app/models.ts';
import { cartTotal, salePrice, sanitizeCart, validateCustomer } from '../src/app/shop.utils.ts';

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'bag', name: 'Everyday crochet bag', description: 'Handmade with cotton yarn.',
    category: 'Bags', price: 999, discountPercent: 15, imageUrl: '/products/bag.webp',
    available: true, stock: 10, featured: false, createdAt: '2026-10-12T09:00:00Z',
    ...overrides,
  };
}

const customer: Customer = {
  name: 'Asha Reddy', phone: '9876543210', email: 'asha@example.com',
  address: '12 Jasmine Street, Flat 3', city: 'Hyderabad', postalCode: '500001', note: '',
};

test('discounts INR prices and rounds the payable amount to paise', () => {
  assert.equal(salePrice(product()), 849.15);
  assert.equal(salePrice(product({ price: 100.05, discountPercent: 10 })), 90.05);
  assert.equal(salePrice(product({ price: 499, discountPercent: 0 })), 499);
  assert.equal(salePrice(product({ price: 499, discountPercent: 100 })), 24.95);
});

test('calculates cart totals from the current product prices with integer paise', () => {
  const products = [product(), product({ id: 'flower', price: 100.05, discountPercent: 10 })];
  const lines = [{ productId: 'bag', quantity: 2 }, { productId: 'flower', quantity: 3 }];
  assert.equal(cartTotal(lines, products), 1968.45);
  assert.equal(cartTotal([], products), 0);
  assert.equal(cartTotal([{ productId: 'deleted', quantity: 5 }], products), 0);
  assert.equal(cartTotal([{ productId: 'bag', quantity: 1 }], [product({ available: false })]), 0);
});

test('ignores malformed saved carts instead of letting browser storage break checkout', () => {
  for (const value of [null, undefined, false, 3, 'text', {}, { productId: 'bag', quantity: 1 }]) {
    assert.deepEqual(sanitizeCart(value), []);
  }
  assert.deepEqual(sanitizeCart([
    { productId: 'bag', quantity: 2 }, null, {},
    { productId: '', quantity: 1 }, { productId: 'flower', quantity: 0 },
    { productId: 'other', quantity: -1 }, { productId: 'bad', quantity: '2' },
    { productId: 'fraction', quantity: 1.5 },
  ]), [{ productId: 'bag', quantity: 2 }]);
});

test('combines duplicate saved cart lines and caps unreasonable quantities', () => {
  assert.deepEqual(sanitizeCart([
    { productId: 'bag', quantity: 2 }, { productId: 'bag', quantity: 3 },
    { productId: 'flower', quantity: 9999 },
  ]), [{ productId: 'bag', quantity: 5 }, { productId: 'flower', quantity: 10 }]);
  assert.equal(sanitizeCart(Array.from({ length: 20 }, (_, index) => ({
    productId: `product-${index}`, quantity: 1,
  }))).length, 8, 'checkout accepts a bounded number of distinct products');
});

test('accepts complete Indian delivery details with optional email and notes', () => {
  assert.deepEqual(validateCustomer(customer), []);
  assert.deepEqual(validateCustomer({ ...customer, email: '', note: 'Call when outside.' }), []);
  assert.deepEqual(validateCustomer({ ...customer, phone: '+91 98765 43210' }), []);
});

test('rejects missing delivery details and malformed mobile numbers and PIN codes', () => {
  const empty = { name: '', phone: '', email: '', address: '', city: '', postalCode: '', note: '' };
  assert.ok(validateCustomer(empty).length >= 5);
  for (const field of ['name', 'address', 'city'] as const) {
    assert.ok(validateCustomer({ ...customer, [field]: '   ' }).length > 0, `${field} is required`);
  }
  for (const phone of ['1234', 'abcdefghij', '1234567890']) {
    assert.ok(validateCustomer({ ...customer, phone }).length > 0, `${phone} is not an Indian mobile number`);
  }
  for (const postalCode of ['50001', '5000011', 'ABCDEF']) {
    assert.ok(validateCustomer({ ...customer, postalCode }).length > 0, `${postalCode} is not a six-digit PIN code`);
  }
  assert.ok(validateCustomer({ ...customer, email: 'missing-at-sign' }).length > 0);
  assert.ok(validateCustomer({ ...customer, note: 'x'.repeat(501) }).length > 0);
});
