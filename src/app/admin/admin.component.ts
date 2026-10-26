import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, FormsModule, Validators } from '@angular/forms';
import { ShopService } from '../shop.service';
import { OrderStatus, PaymentStatus, Product, ProductDraft, ShopOrder } from '../models';
import { salePrice } from '../shop.utils';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.css',
})
export class AdminComponent {
  readonly shop = inject(ShopService);
  private readonly fb = inject(FormBuilder);
  @ViewChild('orderDialog') orderDialog?: ElementRef<HTMLDialogElement>;

  readonly tab = signal<'products' | 'orders'>('products');
  readonly loginBusy = signal(false);
  readonly loginError = signal('');
  readonly pageError = signal('');
  readonly message = signal('');
  readonly editorOpen = signal(false);
  readonly editingId = signal<string | undefined>(undefined);
  readonly saving = signal(false);
  readonly uploading = signal(false);
  readonly productError = signal('');
  readonly productSubmitted = signal(false);
  readonly productSearch = signal('');
  readonly orderSearch = signal('');
  readonly statusFilter = signal('all');
  readonly selectedOrderId = signal<string | null>(null);
  private readonly selectedOrderSnapshot = signal<ShopOrder | null>(null);
  readonly orderBusy = signal(false);
  readonly orderError = signal('');
  readonly orderMessage = signal('');
  detailStatus: OrderStatus = 'new';

  readonly loginForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  readonly productForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(120)]],
    description: ['', [Validators.required, Validators.maxLength(2000)]],
    category: ['', [Validators.required, Validators.maxLength(60)]],
    price: [0, [Validators.required, Validators.min(0.01), Validators.max(100000), Validators.pattern(/^\d+(\.\d{1,2})?$/)]],
    discountPercent: [0, [Validators.required, Validators.min(0), Validators.max(95), Validators.pattern(/^\d+$/)]],
    imageUrl: ['', Validators.required],
    stock: [1, [Validators.required, Validators.min(0), Validators.max(10000), Validators.pattern(/^\d+$/)]],
    available: [true],
    featured: [false],
  });

  readonly statuses: OrderStatus[] = ['new', 'confirmed', 'shipped', 'refunded', 'returned'];
  readonly visibleProducts = computed(() => {
    const query = this.productSearch().trim().toLowerCase();
    return this.shop.products().filter(product => !query || `${product.name} ${product.category}`.toLowerCase().includes(query));
  });
  readonly visibleOrders = computed(() => {
    const query = this.orderSearch().trim().toLowerCase();
    return this.shop.orders().filter(order =>
      (this.statusFilter() === 'all' || order.status === this.statusFilter()) &&
      (!query || `${order.orderNumber} ${order.customer.name} ${order.customer.phone}`.toLowerCase().includes(query))
    );
  });
  readonly selectedOrder = computed(() => this.selectedOrderId() ? this.shop.orders().find(order => order.id === this.selectedOrderId()) ?? this.selectedOrderSnapshot() : null);
  readonly activeProducts = computed(() => this.shop.products().filter(product => product.available && product.stock > 0).length);
  readonly openOrders = computed(() => this.shop.orders().filter(order => !['delivered', 'cancelled', 'refunded', 'returned'].includes(order.status)).length);
  readonly receivedTotal = computed(() => this.shop.orders().filter(order => order.paymentStatus === 'received').reduce((sum, order) => sum + order.total, 0));

  async ngOnInit(): Promise<void> {
    try {
      await this.shop.initialize();
      if (this.shop.isAdmin()) await this.shop.loadOrders();
    } catch (error) {
      this.pageError.set(this.errorText(error, 'The workspace could not load. Please try again.'));
    }
  }

  async login(): Promise<void> {
    this.loginForm.markAllAsTouched();
    if (this.loginForm.invalid || this.loginBusy()) return;
    this.loginBusy.set(true);
    this.loginError.set('');
    try {
      const { email, password } = this.loginForm.getRawValue();
      await this.shop.signIn(email.trim(), password);
      if (!this.shop.isAdmin()) throw new Error('This account does not have shop admin access.');
      this.loginForm.controls.password.reset();
      await this.shop.loadOrders();
    } catch (error) {
      this.loginError.set(this.errorText(error, 'Sign-in failed. Please check your details and try again.'));
    } finally {
      this.loginBusy.set(false);
    }
  }

  async demoLogin(): Promise<void> {
    if (!this.shop.demoMode() || this.loginBusy()) return;
    this.loginBusy.set(true);
    this.loginError.set('');
    try {
      await this.shop.enterDemoAdmin();
      await this.shop.loadOrders();
    } catch (error) {
      this.loginError.set(this.errorText(error, 'The demo could not open. Please try again.'));
    } finally {
      this.loginBusy.set(false);
    }
  }

  async logout(): Promise<void> {
    this.closeOrder();
    this.pageError.set('');
    try {
      await this.shop.signOut();
      this.editorOpen.set(false);
      this.selectedOrderId.set(null);
      this.selectedOrderSnapshot.set(null);
      this.message.set('');
    } catch (error) {
      this.pageError.set(this.errorText(error, 'Sign-out failed. Please try again.'));
    }
  }

  async refreshOrders(): Promise<void> {
    if (this.shop.loading()) return;
    this.pageError.set('');
    try {
      await this.shop.loadOrders();
    } catch (error) {
      this.pageError.set(this.errorText(error, 'Orders could not refresh. Please try again.'));
    }
  }

  async loadOlderOrders(): Promise<void> {
    if (this.shop.loading()) return;
    this.pageError.set('');
    try {
      await this.shop.loadMoreOrders();
    } catch (error) {
      this.pageError.set(this.errorText(error, 'Older orders could not load. Please try again.'));
    }
  }

  newProduct(): void {
    this.editingId.set(undefined);
    this.productForm.reset({ name: '', description: '', category: '', price: 0, discountPercent: 0, imageUrl: '', stock: 1, available: true, featured: false });
    this.productError.set('');
    this.productSubmitted.set(false);
    this.editorOpen.set(true);
    this.message.set('');
  }

  editProduct(product: Product): void {
    if (this.saving() || this.uploading()) return;
    this.editingId.set(product.id);
    this.productForm.reset({ name: product.name, description: product.description, category: product.category, price: product.price, discountPercent: product.discountPercent, imageUrl: product.imageUrl, stock: product.stock, available: product.available, featured: product.featured });
    this.productError.set('');
    this.productSubmitted.set(false);
    this.editorOpen.set(true);
    this.message.set('');
  }

  closeEditor(): void {
    if (this.saving() || this.uploading()) return;
    this.editorOpen.set(false);
    this.productError.set('');
  }

  invalid(field: keyof ProductDraft): boolean {
    const control = this.productForm.controls[field];
    return control.invalid && (control.touched || this.productSubmitted());
  }

  async uploadImage(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || this.uploading() || this.saving()) return;
    this.productError.set('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      this.productError.set('Choose a JPG, PNG, or WebP image.');
      input.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.productError.set('This image is too large. Choose a file smaller than 5 MB.');
      input.value = '';
      return;
    }
    this.uploading.set(true);
    try {
      const imageUrl = await this.shop.uploadImage(file);
      this.productForm.controls.imageUrl.setValue(imageUrl);
      this.productForm.controls.imageUrl.markAsDirty();
    } catch (error) {
      this.productError.set(this.errorText(error, 'The image could not upload. Your other changes have been kept.'));
    } finally {
      this.uploading.set(false);
      input.value = '';
    }
  }

  async saveProduct(): Promise<void> {
    this.productSubmitted.set(true);
    this.productForm.markAllAsTouched();
    if (this.productForm.invalid || this.saving() || this.uploading()) return;
    const value = this.productForm.getRawValue();
    const draft: ProductDraft = { ...value, name: value.name.trim(), description: value.description.trim(), category: value.category.trim(), imageUrl: value.imageUrl.trim(), price: Number(value.price), discountPercent: Number(value.discountPercent), stock: Number(value.stock) };
    if (!draft.name || !draft.description || !draft.category || !draft.imageUrl) {
      this.productError.set('Please complete the product name, description, category, and photo.');
      return;
    }
    this.saving.set(true);
    this.productError.set('');
    this.productForm.disable({ emitEvent: false });
    try {
      await this.shop.saveProduct(draft, this.editingId());
      this.message.set(this.editingId() ? 'Product updated. Your storefront has the latest details.' : 'Product added. It is ready for your storefront.');
      this.editorOpen.set(false);
    } catch (error) {
      this.productError.set(this.errorText(error, 'This product could not save. Your changes have been kept; please try again.'));
    } finally {
      this.productForm.enable({ emitEvent: false });
      this.saving.set(false);
    }
  }

  openOrder(order: ShopOrder): void {
    this.selectedOrderId.set(order.id);
    this.selectedOrderSnapshot.set(order);
    this.detailStatus = order.status;
    this.orderError.set('');
    this.orderMessage.set('');
    setTimeout(() => {
      const dialog = this.orderDialog?.nativeElement;
      if (dialog && !dialog.open && this.selectedOrderId()) dialog.showModal();
    });
  }

  closeOrder(): void {
    if (this.orderBusy()) return;
    this.orderDialog?.nativeElement.close();
    this.selectedOrderId.set(null);
    this.selectedOrderSnapshot.set(null);
  }

  onDialogCancel(event: Event): void {
    if (this.orderBusy()) event.preventDefault();
    else {
      this.selectedOrderId.set(null);
      this.selectedOrderSnapshot.set(null);
    }
  }

  async saveOrder(): Promise<void> {
    const order = this.selectedOrder();
    if (!order || this.orderBusy()) return;
    this.orderBusy.set(true);
    this.orderError.set('');
    this.orderMessage.set('');
    try {
      await this.shop.updateOrder(order.id, this.detailStatus);
      this.selectedOrderSnapshot.set({ ...order, status: this.detailStatus });
      this.message.set(`${order.orderNumber} updated.`);
      this.orderMessage.set('Order status saved.');
    } catch (error) {
      this.orderError.set(this.errorText(error, 'This order could not update. Please try again.'));
    } finally {
      this.orderBusy.set(false);
    }
  }

  price(product: Pick<Product, 'price' | 'discountPercent'>): number {
    return salePrice(product);
  }

  imageFallback(event: Event): void {
    const image = event.target as HTMLImageElement;
    if (!image.src.endsWith('/images/fallback.svg')) image.src = '/images/fallback.svg';
  }

  money(value: number): string {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value);
  }

  statusLabel(value: string): string {
    return value === 'returned' ? 'Item received back (undelivered)' : value === 'refunded' ? 'Refunded' : value === 'new' ? 'New order' : value === 'confirmed' ? 'Confirmed / Being made' : value === 'making' ? 'Confirmed / Being made' : value === 'received' ? 'Received' : value.charAt(0).toUpperCase() + value.slice(1);
  }

  private errorText(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
  }
}
