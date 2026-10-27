-- Payment-first checkout. Apply after 202610260001_paid_order_notifications.sql.
-- A checkout attempt is NOT a shop order and does not reserve stock.
begin;
create table public.checkout_attempts (
 id uuid primary key,
 customer jsonb not null,
 cart jsonb not null,
 total_paise integer not null check(total_paise > 0),
 razorpay_order_id text unique,
 razorpay_payment_id text unique,
 finalized_order_id uuid unique references public.orders(id),
 created_at timestamptz not null default now()
);
alter table public.checkout_attempts enable row level security;
revoke all on public.checkout_attempts from public,anon,authenticated;

create function public.begin_paid_checkout(p_id uuid,p_customer jsonb,p_cart jsonb)
returns table(id uuid,total_paise integer)
language plpgsql security definer set search_path='' as $$
declare
 v_total bigint:=0; v_line record; v_product public.products%rowtype;
 v_name text; v_phone text; v_email text; v_address text; v_city text; v_postal text;
begin
 if p_id is null or pg_catalog.jsonb_typeof(p_customer) <> 'object' or pg_catalog.jsonb_typeof(p_cart) <> 'array'
    or pg_catalog.octet_length(p_customer::text)>8000 or pg_catalog.octet_length(p_cart::text)>8000
 then raise exception 'Invalid checkout request'; end if;
 if pg_catalog.jsonb_array_length(p_cart) not between 1 and 8 then raise exception 'Invalid cart quantity'; end if;
 v_name:=pg_catalog.btrim(coalesce(p_customer->>'name',''));
 v_phone:=pg_catalog.regexp_replace(coalesce(p_customer->>'phone',''),'[^0-9]','','g');
 if pg_catalog.length(v_phone)=12 and pg_catalog.left(v_phone,2)='91' then v_phone:=pg_catalog.substr(v_phone,3); end if;
 v_email:=pg_catalog.lower(pg_catalog.btrim(coalesce(p_customer->>'email','')));
 v_address:=pg_catalog.btrim(coalesce(p_customer->>'address',''));
 v_city:=pg_catalog.btrim(coalesce(p_customer->>'city',''));
 v_postal:=pg_catalog.btrim(coalesce(p_customer->>'postalCode',''));
 if pg_catalog.length(v_name) not between 2 and 100
  or v_phone !~ '^[6-9][0-9]{9}$'
  or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  or pg_catalog.length(v_email)>254
  or pg_catalog.length(v_address) not between 10 and 400
  or pg_catalog.length(v_city) not between 2 and 100
  or v_postal !~ '^[1-9][0-9]{5}$'
  or pg_catalog.length(coalesce(p_customer->>'note',''))>500
 then raise exception 'Invalid customer details'; end if;
 if exists (
   select 1 from pg_catalog.jsonb_array_elements(p_cart) x
   where pg_catalog.jsonb_typeof(x) <> 'object' or
      (x->>'product_id') !~ '^[0-9a-fA-F-]{36}$' or
      (x->>'quantity') !~ '^(10|[1-9])$'
 ) or (select pg_catalog.count(distinct (x->>'product_id')) from pg_catalog.jsonb_array_elements(p_cart) x)
      <> pg_catalog.jsonb_array_length(p_cart) then raise exception 'Invalid cart items'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,0));
 if exists(select 1 from public.checkout_attempts a where a.id=p_id) then
    return query select a.id,a.total_paise from public.checkout_attempts a where a.id=p_id; return;
 end if;
 for v_line in select (x->>'product_id')::uuid pid,(x->>'quantity')::integer qty from pg_catalog.jsonb_array_elements(p_cart) x
 loop
  select * into v_product from public.products p where p.id=v_line.pid;
  if not found or not v_product.available or v_product.stock<v_line.qty then raise exception 'Item unavailable'; end if;
  v_total:=v_total + ((v_product.price_paise::bigint*(100-v_product.discount_percent)+50)/100)*v_line.qty;
 end loop;
 if v_total<1 or v_total>2147483647 then raise exception 'Invalid checkout total'; end if;
 insert into public.checkout_attempts(id,customer,cart,total_paise)
 values(p_id,p_customer,p_cart,v_total::integer);
 return query select p_id,v_total::integer;
end $$;
revoke all on function public.begin_paid_checkout(uuid,jsonb,jsonb) from public;
grant execute on function public.begin_paid_checkout(uuid,jsonb,jsonb) to anon,authenticated;

create function public.finalize_paid_checkout(p_gateway_order text,p_payment text)
returns table(order_id uuid,order_number text)
language plpgsql security definer set search_path='' as $$
declare v_attempt public.checkout_attempts%rowtype;v_result record;v_payment_order uuid;
begin
 if p_gateway_order !~ '^order_[A-Za-z0-9]+$' or p_payment !~ '^pay_[A-Za-z0-9]+$' then
   raise exception 'Invalid gateway payment reference'; end if;
 select * into v_attempt from public.checkout_attempts a
 where a.razorpay_order_id=p_gateway_order for update;
 if not found then raise exception 'Unknown gateway order'; end if;
 if v_attempt.razorpay_payment_id is not null and v_attempt.razorpay_payment_id<>p_payment then
   raise exception 'Conflicting payment reference'; end if;
 if v_attempt.finalized_order_id is not null then
   return query select o.id,o.order_number from public.orders o where o.id=v_attempt.finalized_order_id;return;
 end if;
 -- Reuse existing stock-locking order RPC atomically. It recomputes prices and deducts stock.
 select o.id,o.order_number into v_result
 from public.create_order(v_attempt.customer,v_attempt.cart,v_attempt.id) o;
 if (select o.total_paise from public.orders o where o.id=v_result.id) <> v_attempt.total_paise then
   raise exception 'Captured payment amount differs from checkout total; manual resolution required';
 end if;
 insert into public.razorpay_orders(shop_order_id,razorpay_order_id,amount_paise,razorpay_payment_id,captured_at)
 values(v_result.id,p_gateway_order,v_attempt.total_paise,p_payment,now());
 update public.orders set payment_status='received' where id=v_result.id;
 update public.checkout_attempts set finalized_order_id=v_result.id,razorpay_payment_id=p_payment where id=v_attempt.id;
 return query select v_result.id::uuid,v_result.order_number::text;
end $$;
revoke all on function public.finalize_paid_checkout(text,text) from public,anon,authenticated;
grant execute on function public.finalize_paid_checkout(text,text) to service_role;
-- Browser cannot create orders directly after rollout; only confirmed gateway payments may finalize them.
revoke execute on function public.create_order(jsonb,jsonb,uuid) from anon,authenticated;
commit;
