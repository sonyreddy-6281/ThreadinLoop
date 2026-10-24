-- Apply once in the Supabase SQL editor or with `supabase db push`.
-- No customer data or admin credentials are seeded.
begin;

create type public.order_status as enum ('new', 'confirmed', 'making', 'shipped', 'delivered', 'cancelled');
create type public.payment_status as enum ('pending', 'received');

create table public.admin_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admin_members enable row level security;
revoke all on public.admin_members from anon, authenticated;
grant select on public.admin_members to authenticated;
create policy "Admins can see their own membership" on public.admin_members for select to authenticated using (user_id = auth.uid());

create function public.is_shop_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.admin_members where user_id = auth.uid()); $$;
revoke all on function public.is_shop_admin() from public;
grant execute on function public.is_shop_admin() to anon, authenticated;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  category text not null check (char_length(category) between 1 and 60),
  price_paise integer not null check (price_paise between 1 and 10000000),
  discount_percent smallint not null default 0 check (discount_percent between 0 and 95),
  image_url text not null check (char_length(image_url) <= 2048 and image_url ~ '^(https://|/images/)'),
  available boolean not null default true,
  stock integer not null default 0 check (stock between 0 and 10000),
  featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((price_paise::bigint * (100 - discount_percent) + 50) / 100 >= 1)
);
create index products_catalog_idx on public.products (available, created_at desc);
alter table public.products enable row level security;
revoke all on public.products from anon, authenticated;
grant select on public.products to anon, authenticated;
grant insert, update on public.products to authenticated;
create policy "Available products are public" on public.products for select to anon, authenticated using (available or public.is_shop_admin());
create policy "Admins can create products" on public.products for insert to authenticated with check (public.is_shop_admin());
create policy "Admins can edit products" on public.products for update to authenticated using (public.is_shop_admin()) with check (public.is_shop_admin());

create sequence public.order_number_sequence;
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default ('MC-' || nextval('public.order_number_sequence')::text),
  request_id uuid not null unique,
  customer_name text not null check (char_length(customer_name) between 2 and 100),
  customer_phone text not null check (customer_phone ~ '^[6-9][0-9]{9}$'),
  customer_email text not null default '' check (char_length(customer_email) <= 254),
  customer_address text not null check (char_length(customer_address) between 10 and 400),
  customer_city text not null check (char_length(customer_city) between 2 and 100),
  customer_postal_code text not null check (customer_postal_code ~ '^[1-9][0-9]{5}$'),
  customer_note text not null default '' check (char_length(customer_note) <= 500),
  total_paise integer not null check (total_paise > 0),
  status public.order_status not null default 'new',
  payment_status public.payment_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_created_idx on public.orders (created_at desc);
create index orders_status_idx on public.orders (status, payment_status);
alter table public.orders enable row level security;
revoke all on public.orders from anon, authenticated;
grant select on public.orders to authenticated;
grant update (status, payment_status) on public.orders to authenticated;
create policy "Admins can view orders" on public.orders for select to authenticated using (public.is_shop_admin());
create policy "Admins can update order status" on public.orders for update to authenticated using (public.is_shop_admin()) with check (public.is_shop_admin());
revoke all on sequence public.order_number_sequence from public, anon, authenticated;

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name text not null,
  image_url text not null,
  quantity integer not null check (quantity between 1 and 10),
  unit_price_paise integer not null check (unit_price_paise > 0),
  unique (order_id, product_id)
);
create index order_items_order_idx on public.order_items (order_id);
alter table public.order_items enable row level security;
revoke all on public.order_items from anon, authenticated;
grant select on public.order_items to authenticated;
create policy "Admins can view order items" on public.order_items for select to authenticated using (public.is_shop_admin());

create function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end;
$$;
revoke all on function public.touch_updated_at() from public;
create trigger products_updated_at before update on public.products for each row execute function public.touch_updated_at();
create trigger orders_updated_at before update on public.orders for each row execute function public.touch_updated_at();

-- Only this transaction can create an order. Client-supplied totals and payment
-- statuses are never used. Product row locks serialize concurrent purchases.
create function public.create_order(p_customer jsonb, p_cart jsonb, p_request_id uuid)
returns table (id uuid, order_number text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text;
  v_phone text;
  v_email text;
  v_address text;
  v_city text;
  v_postal text;
  v_note text;
  v_count integer;
  v_total bigint := 0;
  v_product public.products%rowtype;
  v_line record;
  v_unit integer;
  v_order_id uuid;
  v_order_number text;
  v_items jsonb := '[]'::jsonb;
begin
  if p_request_id is null then raise exception 'A checkout request ID is required.' using errcode = '22023'; end if;
  -- Serializes a repeated request while permitting independent carts in parallel.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text, 0));
  select o.id, o.order_number into v_order_id, v_order_number from public.orders o where o.request_id = p_request_id;
  if found then return query select v_order_id, v_order_number; return; end if;

  if pg_catalog.jsonb_typeof(p_customer) is distinct from 'object' then raise exception 'Invalid customer details.' using errcode = '22023'; end if;
  if pg_catalog.jsonb_typeof(p_cart) is distinct from 'array' then raise exception 'Invalid cart.' using errcode = '22023'; end if;
  v_count := pg_catalog.jsonb_array_length(p_cart);
  if v_count < 1 or v_count > 8 then raise exception 'Choose between 1 and 8 different products.' using errcode = '22023'; end if;
  -- Bound all submitted JSON, including irrelevant attacker-supplied fields.
  if pg_catalog.octet_length(p_customer::text) > 8000 or pg_catalog.octet_length(p_cart::text) > 8000 then raise exception 'Checkout payload is too large.' using errcode = '22023'; end if;
  v_name := pg_catalog.btrim(coalesce(p_customer->>'name', ''));
  v_phone := pg_catalog.regexp_replace(coalesce(p_customer->>'phone', ''), '[^0-9]', '', 'g');
  if pg_catalog.char_length(v_phone) = 12 and pg_catalog.left(v_phone, 2) = '91' then v_phone := pg_catalog.substring(v_phone, 3); end if;
  v_email := pg_catalog.lower(pg_catalog.btrim(coalesce(p_customer->>'email', '')));
  v_address := pg_catalog.btrim(coalesce(p_customer->>'address', ''));
  v_city := pg_catalog.btrim(coalesce(p_customer->>'city', ''));
  v_postal := pg_catalog.btrim(coalesce(p_customer->>'postalCode', ''));
  v_note := pg_catalog.btrim(coalesce(p_customer->>'note', ''));
  if pg_catalog.char_length(v_name) not between 2 and 100 then raise exception 'Enter a valid customer name.' using errcode = '22023'; end if;
  if v_phone !~ '^[6-9][0-9]{9}$' then raise exception 'Enter a valid 10-digit Indian mobile number.' using errcode = '22023'; end if;
  if pg_catalog.char_length(v_address) not between 10 and 400 or pg_catalog.char_length(v_city) not between 2 and 100 then raise exception 'Enter a complete delivery address and city.' using errcode = '22023'; end if;
  if v_postal !~ '^[1-9][0-9]{5}$' then raise exception 'Enter a valid 6-digit Indian PIN code.' using errcode = '22023'; end if;
  if pg_catalog.char_length(v_email) > 254 or (v_email <> '' and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'Enter a valid email address.' using errcode = '22023'; end if;
  if pg_catalog.char_length(v_note) > 500 then raise exception 'Order notes must be under 500 characters.' using errcode = '22023'; end if;

  if exists (select 1 from pg_catalog.jsonb_array_elements(p_cart) as entry where pg_catalog.jsonb_typeof(entry) is distinct from 'object' or pg_catalog.jsonb_typeof(entry->'product_id') is distinct from 'string' or pg_catalog.jsonb_typeof(entry->'quantity') is distinct from 'number' or (entry->>'product_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' or (entry->>'quantity') !~ '^(10|[1-9])$') then
    raise exception 'Each cart item needs a valid product and a quantity from 1 to 10.' using errcode = '22023';
  end if;
  if (select count(distinct (entry->>'product_id')::uuid) from pg_catalog.jsonb_array_elements(p_cart) entry) <> v_count then raise exception 'Combine duplicate products into one cart item.' using errcode = '22023'; end if;

  -- Consistent lock order prevents deadlocks for carts containing the same items.
  for v_line in select (entry->>'product_id')::uuid as product_id, (entry->>'quantity')::integer as quantity from pg_catalog.jsonb_array_elements(p_cart) entry order by (entry->>'product_id')::uuid
  loop
    select * into v_product from public.products p where p.id = v_line.product_id for update;
    if not found or not v_product.available or v_product.stock < v_line.quantity then raise exception 'An item is unavailable in that quantity. Please review your cart.' using errcode = '22023'; end if;
    v_unit := ((v_product.price_paise::bigint * (100 - v_product.discount_percent) + 50) / 100)::integer;
    if v_unit < 1 then raise exception 'This product price needs to be corrected by the shop.' using errcode = '22023'; end if;
    v_total := v_total + v_unit::bigint * v_line.quantity;
    v_items := v_items || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('product_id', v_product.id, 'product_name', v_product.name, 'image_url', v_product.image_url, 'quantity', v_line.quantity, 'unit_price_paise', v_unit));
    update public.products set stock = stock - v_line.quantity where products.id = v_product.id;
  end loop;

  insert into public.orders (request_id, customer_name, customer_phone, customer_email, customer_address, customer_city, customer_postal_code, customer_note, total_paise)
  values (p_request_id, v_name, v_phone, v_email, v_address, v_city, v_postal, v_note, v_total::integer)
  returning orders.id, orders.order_number into v_order_id, v_order_number;
  insert into public.order_items (order_id, product_id, product_name, image_url, quantity, unit_price_paise)
  select v_order_id, (entry->>'product_id')::uuid, entry->>'product_name', entry->>'image_url', (entry->>'quantity')::integer, (entry->>'unit_price_paise')::integer from pg_catalog.jsonb_array_elements(v_items) entry;
  return query select v_order_id, v_order_number;
end;
$$;
revoke all on function public.create_order(jsonb, jsonb, uuid) from public;
grant execute on function public.create_order(jsonb, jsonb, uuid) to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy "Product images can be viewed publicly" on storage.objects for select to anon, authenticated using (bucket_id = 'product-images');
create policy "Admins can upload product images" on storage.objects for insert to authenticated with check (bucket_id = 'product-images' and public.is_shop_admin());
-- Immutable unique image names keep long cache lifetimes safe. Replacing a photo
-- uploads a new object; old images can be removed in the Supabase dashboard.

commit;
