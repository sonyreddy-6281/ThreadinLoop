import { Component, ElementRef, OnInit, OnDestroy, computed, inject, signal, viewChild } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ShopService } from '../shop.service';
import { CartService } from '../cart.service';
import { salePrice, validateCustomer } from '../shop.utils';
import type { Customer, Product } from '../models';

@Component({
  selector: 'app-storefront',
  standalone: true,
  imports: [CurrencyPipe, FormsModule, RouterLink],
  templateUrl: './storefront.component.html',
  styleUrl: './storefront.component.css'
})
export class StorefrontComponent implements OnInit, OnDestroy {
  readonly shop = inject(ShopService);
  readonly cart = inject(CartService);
  readonly query = signal('');
  readonly category = signal('All pieces');
  readonly sort = signal('featured');
  readonly panel = signal<'cart' | 'checkout' | 'success'>('cart');
  readonly submitting = signal(false);
  readonly paymentNotice = signal('');
  readonly checkoutErrors = signal<string[]>([]);
  readonly orderNumber = signal('');
  readonly toast = signal('');
  readonly selectedProduct = signal<Product | null>(null);
  readonly cartDialog = viewChild.required<ElementRef<HTMLDialogElement>>('cartDialog');
  readonly productDialog = viewChild.required<ElementRef<HTMLDialogElement>>('productDialog');
  readonly salePrice = salePrice;
  readonly categories = computed(() => ['All pieces', ...new Set(this.shop.products().filter(product => product.available).map(product => product.category))]);
  readonly visibleProducts = computed(() => {
    const query = this.query().trim().toLowerCase();
    const products = this.shop.products().filter(product => product.available && (this.category() === 'All pieces' || product.category === this.category()) && (!query || `${product.name} ${product.category} ${product.description}`.toLowerCase().includes(query)));
    return products.sort((a, b) => this.sort() === 'price-low' ? salePrice(a) - salePrice(b) : this.sort() === 'price-high' ? salePrice(b) - salePrice(a) : Number(b.featured) - Number(a.featured) || b.createdAt.localeCompare(a.createdAt));
  });
  customer: Customer = { name: '', phone: '', email: '', address: '', city: '', postalCode: '', note: '' };
  private toastTimer?: ReturnType<typeof setTimeout>;

  async ngOnInit(): Promise<void> {
    try { await this.shop.initialize(); document.title = `${this.shop.config().shopName} — Handmade with a little love`; }
    catch { /* The service exposes a recoverable error and does not simulate live data. */ }
  }

  ngOnDestroy(): void { clearTimeout(this.toastTimer); document.body.style.overflow = ''; }

  add(product: Product): void {
    if (this.cart.add(product)) {
      this.toast.set(`${product.name} added to your bag`);
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => this.toast.set(''), 3000);
    }
  }

  openCart(): void {
    this.panel.set('cart');
    this.checkoutErrors.set([]);
    this.open(this.cartDialog().nativeElement);
  }

  openProduct(product: Product): void { this.selectedProduct.set(product); this.open(this.productDialog().nativeElement); }
  close(dialog: HTMLDialogElement): void { if (!this.submitting()) { dialog.close(); this.unlockScroll(); } }
  unlockScroll(): void { if (!this.cartDialog().nativeElement.open && !this.productDialog().nativeElement.open) document.body.style.overflow = ''; }
  private open(dialog: HTMLDialogElement): void { dialog.showModal(); document.body.style.overflow = 'hidden'; }

  checkout(): void {
    if (!this.cart.lines().length || this.cart.invalidItems()) return;
    this.panel.set('checkout');
    setTimeout(() => this.cartDialog().nativeElement.querySelector<HTMLInputElement>('[data-testid="checkout-name"]')?.focus());
  }

  private async paymentApi(endpoint: string, payload: object): Promise<any> {
    const response = await fetch('/.netlify/functions/' + endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Payment service is temporarily unavailable.');
    return data;
  }

  private async launchRazorpay(orderId: string): Promise<boolean> {
    const config = await this.paymentApi('razorpay-create', { orderId });
    if (!window.document.getElementById('razorpay-checkout-script')) {
      const script = document.createElement('script');
      script.id = 'razorpay-checkout-script';
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      const loaded = new Promise<void>((resolve, reject) => {
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Unable to load secure payment checkout.'));
      });
      document.head.appendChild(script);
      await loaded;
    }
    const Razorpay = (window as any).Razorpay;
    if (typeof Razorpay !== 'function') throw new Error('Secure payment checkout is unavailable.');
    // Native <dialog>.showModal() lives in the browser top layer and covers
    // Razorpay's iframe regardless of CSS z-index. Close it before opening checkout.
    const deliveryDialog = this.cartDialog().nativeElement;
    if (deliveryDialog.open) {
      deliveryDialog.close();
      this.unlockScroll();
    }
    return new Promise<boolean>((resolve, reject) => {
      let complete = false;
      const checkout = new Razorpay({
        key: config.keyId, amount: config.amount, currency: 'INR', order_id: config.razorpayOrderId,
        name: this.shop.config().shopName, description: 'Crochet order ' + config.orderNumber,
        prefill: { name: this.customer.name, email: this.customer.email, contact: this.customer.phone },
        theme: { color: '#986b77' },
        handler: async (payment: any) => {
          if (complete) return;
          complete = true;
          try {
            const verified = await this.paymentApi('razorpay-verify', payment);
            resolve(verified.verified === true);
          } catch (error) { reject(error); }
        },
        modal: { ondismiss: () => { if (!complete) { complete = true; resolve(false); } } }
      });
      checkout.on('payment.failed', () => { if (!complete) { complete = true; resolve(false); } });
      checkout.open();
    });
  }

  async placeOrder(): Promise<void> {
    if (this.submitting()) return;
    const errors = validateCustomer(this.customer);
    if (!this.cart.lines().length) errors.push('Your bag is empty. Add a piece before placing your order.');
    if (this.cart.invalidItems()) errors.push('Some pieces are no longer available in this quantity. Please review your bag.');
    this.checkoutErrors.set(errors);
    if (errors.length) return;
    this.submitting.set(true);
    let savedOrder: { id: string; orderNumber: string } | undefined;
    try {
      savedOrder = await this.shop.placeOrder({ ...this.customer }, this.cart.lines().map(line => ({ ...line })));
      this.orderNumber.set(savedOrder.orderNumber);
      let paid = false;
      if (!this.shop.demoMode()) paid = await this.launchRazorpay(savedOrder.id);
      this.paymentNotice.set(this.shop.demoMode() ? 'Preview only. No real payment was collected.' : paid
        ? 'Your payment has been verified. Thank you!'
        : 'Payment was not completed. Your order is saved with payment pending. Contact the seller with your order reference before attempting another payment.');
      this.cart.clear();
      this.customer = { name: '', phone: '', email: '', address: '', city: '', postalCode: '', note: '' };
      this.panel.set('success');
      if (!this.cartDialog().nativeElement.open) this.open(this.cartDialog().nativeElement);
    } catch (error) {
      if (savedOrder) {
        this.paymentNotice.set('Your order was saved, but payment could not be confirmed. Do not place another order. Contact the seller with your reference and payment details.');
        this.cart.clear();
        this.panel.set('success');
        if (!this.cartDialog().nativeElement.open) this.open(this.cartDialog().nativeElement);
      } else this.checkoutErrors.set([error instanceof Error ? error.message : 'We couldn’t place your order. Please try again.']);
    } finally { this.submitting.set(false); }
  }

  async retry(): Promise<void> { try { await this.shop.initialize(); } catch {} }
  imageFallback(event: Event): void { const image = event.target as HTMLImageElement; if (!image.src.endsWith('/images/fallback.svg')) image.src = '/images/fallback.svg'; }
}
