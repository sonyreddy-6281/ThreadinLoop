-- Apply AFTER 202610120001_crochet_shop.sql.
-- Only the Netlify Functions service-role client may access this mapping.
begin;
create table if not exists public.razorpay_orders (
  shop_order_id uuid primary key references public.orders(id) on delete restrict,
  razorpay_order_id text not null unique check (razorpay_order_id ~ '^order_[A-Za-z0-9]+$'),
  amount_paise integer not null check (amount_paise > 0),
  razorpay_payment_id text unique,
  captured_at timestamptz
);
alter table public.razorpay_orders enable row level security;
revoke all on public.razorpay_orders from public, anon, authenticated;
commit;
