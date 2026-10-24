import type { Product, CartLine, Customer } from './models';

export function salePrice(product: Pick<Product, 'price' | 'discountPercent'>): number {
  const paise = Math.max(0, Math.round(product.price * 100));
  const discount = Math.min(95, Math.max(0, product.discountPercent || 0));
  return Math.round(paise * (100 - discount) / 100) / 100;
}

export function sanitizeCart(value: unknown): CartLine[] {
  if (!Array.isArray(value)) return [];
  const cart = new Map<string, number>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const { productId, quantity } = item as Partial<CartLine>;
    if (typeof productId !== 'string' || !/^[\w-]{1,100}$/.test(productId)) continue;
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) continue;
    if (!cart.has(productId) && cart.size >= 8) continue;
    cart.set(productId, Math.min(10, (cart.get(productId) ?? 0) + quantity));
  }
  return [...cart].map(([productId, quantity]) => ({ productId, quantity }));
}

export function cartTotal(lines: CartLine[], products: Product[]): number {
  const lookup = new Map(products.map(product => [product.id, product]));
  return lines.reduce((paise, line) => {
    const product = lookup.get(line.productId);
    return paise + (product?.available ? Math.round(salePrice(product) * 100) * line.quantity : 0);
  }, 0) / 100;
}

export function normalizePhone(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  return digits;
}

export function validateCustomer(customer: Customer): string[] {
  const errors: string[] = [];
  if (customer.name.trim().length < 2 || customer.name.trim().length > 100) errors.push('Enter your full name (2–100 characters).');
  if (!/^[6-9]\d{9}$/.test(normalizePhone(customer.phone))) errors.push('Enter a valid 10-digit Indian mobile number.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email.trim()) || customer.email.length > 254) errors.push('Enter a valid email address for order and delivery updates.');
  if (customer.address.trim().length < 10 || customer.address.trim().length > 400) errors.push('Enter your full delivery address (10–400 characters).');
  if (customer.city.trim().length < 2 || customer.city.trim().length > 100) errors.push('Enter your city (2–100 characters).');
  if (!/^[1-9]\d{5}$/.test(customer.postalCode.trim())) errors.push('Enter a valid 6-digit Indian PIN code.');
  if (customer.note.length > 500) errors.push('Keep your order note under 500 characters.');
  return errors;
}
