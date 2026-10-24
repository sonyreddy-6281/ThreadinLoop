export type OrderStatus = 'new' | 'confirmed' | 'making' | 'shipped' | 'delivered' | 'cancelled' | 'refunded' | 'returned';
export type PaymentStatus = 'pending' | 'received';
export interface Product {
  id: string;
  name: string;
  description: string;
  category: string;
  price: number;
  discountPercent: number;
  imageUrl: string;
  available: boolean;
  stock: number;
  featured: boolean;
  createdAt: string;
}
export interface CartLine { productId: string; quantity: number; }
export interface Customer {
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  postalCode: string;
  note: string;
}
export interface OrderItem {
  productId: string;
  name: string;
  imageUrl: string;
  quantity: number;
  unitPrice: number;
}
export interface ShopOrder {
  id: string;
  orderNumber: string;
  customer: Customer;
  items: OrderItem[];
  subtotal: number;
  total: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  createdAt: string;
}
export type ProductDraft = Omit<Product, 'id' | 'createdAt'>;
export interface PublicShopConfig {
  shopName: string;
  currency: string;
  currencyLocale: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  demoMode: boolean;
}
