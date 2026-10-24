import { Injectable, computed, inject, signal } from '@angular/core';
import { ShopService } from './shop.service';
import type { Product } from './models';
import { cartTotal, sanitizeCart } from './shop.utils';

@Injectable({ providedIn: 'root' })
export class CartService {
  private shop = inject(ShopService);
  readonly lines = signal(this.read());
  readonly warning = signal('');
  readonly count = computed(() => this.lines().reduce((sum, line) => sum + line.quantity, 0));
  readonly total = computed(() => cartTotal(this.lines(), this.shop.products()));
  readonly items = computed(() => this.lines().map(line => ({ ...line, product: this.shop.products().find(product => product.id === line.productId) })));
  readonly invalidItems = computed(() => this.items().some(item => !item.product?.available || item.quantity > (item.product?.stock ?? 0)));

  add(product: Product): boolean {
    const existing = this.lines().find(line => line.productId === product.id);
    if (!product.available || product.stock <= (existing?.quantity ?? 0) || (existing?.quantity ?? 0) >= 10) {
      this.warning.set('You’ve reached the available quantity for this piece.');
      return false;
    }
    if (!existing && this.lines().length >= 8) {
      this.warning.set('You can order up to 8 different pieces at a time.');
      return false;
    }
    this.lines.update(lines => existing ? lines.map(line => line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line) : [...lines, { productId: product.id, quantity: 1 }]);
    this.persist();
    return true;
  }

  quantity(id: string, value: number): void {
    if (!Number.isInteger(value) || value < 1) return;
    const product = this.shop.products().find(item => item.id === id);
    const quantity = Math.min(value, 10, product?.stock ?? 10);
    if (quantity <= 0) return;
    this.lines.update(lines => lines.map(line => line.productId === id ? { ...line, quantity } : line));
    this.persist();
  }

  remove(id: string): void { this.lines.update(lines => lines.filter(line => line.productId !== id)); this.persist(); }
  clear(): void { this.lines.set([]); this.persist(); }
  private read() {
    try { return sanitizeCart(JSON.parse(localStorage.getItem('crochet.cart.v1') ?? '[]')); } catch { return []; }
  }
  private persist(): void {
    try { localStorage.setItem('crochet.cart.v1', JSON.stringify(this.lines())); this.warning.set(''); }
    catch { this.warning.set('Your browser could not save the cart. Keep this tab open while placing your order.'); }
  }
}
