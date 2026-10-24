\set ON_ERROR_STOP on
begin;
insert into auth.users values ('11111111-1111-1111-1111-111111111111', 'admin@example.com'), ('22222222-2222-2222-2222-222222222222', 'visitor@example.com');
insert into public.admin_members (user_id) values ('11111111-1111-1111-1111-111111111111');
insert into public.products (id, name, category, price_paise, discount_percent, image_url, stock, available) values
  ('00000000-0000-0000-0000-000000000001', 'Rounding test tote', 'Bags', 10005, 10, '/images/bag.webp', 3, true),
  ('00000000-0000-0000-0000-000000000002', 'Unavailable bunny', 'Plushies', 89900, 0, '/images/bunny.webp', 1, false),
  ('00000000-0000-0000-0000-000000000003', 'Race test charm', 'Accessories', 24900, 0, '/images/keychain.webp', 1, true);

set role anon;
select public.test_assert((select count(*) from public.products) = 2, 'anonymous catalog hides unavailable products');
select public.test_assert(not public.is_shop_admin(), 'anonymous visitor is not an admin');
select public.test_reject('select * from public.admin_members', 'anonymous visitor cannot read admin memberships');
select public.test_reject('select * from public.orders', 'anonymous visitor cannot read customer details');
select public.test_reject('select * from public.order_items', 'anonymous visitor cannot read order snapshots');
select public.test_reject($q$insert into public.orders (request_id, customer_name, customer_phone, customer_address, customer_city, customer_postal_code, total_paise) values (gen_random_uuid(), 'Attacker', '9999999999', '123 Example Street', 'Hyderabad', '500001', 1)$q$, 'anonymous direct order insert denied');
select public.test_reject($q$update public.products set price_paise = 1$q$, 'anonymous product edit denied');
select public.test_reject($q$insert into storage.objects (bucket_id, name) values ('product-images', 'anonymous.webp')$q$, 'anonymous photo upload denied');

select public.test_reject($q$select * from public.create_order('{"name":"Sample Customer","phone":"123","address":"123 Example Street","city":"Hyderabad","postalCode":"500001"}', '[{"product_id":"00000000-0000-0000-0000-000000000001","quantity":1}]', gen_random_uuid())$q$, 'invalid customer phone rejected');
select public.test_reject($q$select * from public.create_order('{"name":"Sample Customer","phone":"9999999999","address":"123 Example Street","city":"Hyderabad","postalCode":"000001"}', '[{"product_id":"00000000-0000-0000-0000-000000000001","quantity":1}]', gen_random_uuid())$q$, 'invalid delivery PIN rejected');
select public.test_reject($q$select * from public.create_order('{"name":"Sample Customer","phone":"9999999999","address":"123 Example Street","city":"Hyderabad","postalCode":"500001"}', '[]', gen_random_uuid())$q$, 'empty cart rejected');
select public.test_reject($q$select * from public.create_order('{"name":"Sample Customer","phone":"9999999999","address":"123 Example Street","city":"Hyderabad","postalCode":"500001"}', '[{"product_id":"00000000-0000-0000-0000-000000000001","quantity":1},{"product_id":"00000000-0000-0000-0000-000000000001","quantity":1}]', gen_random_uuid())$q$, 'duplicate product lines rejected');
select public.test_reject($q$select * from public.create_order('{"name":"Sample Customer","phone":"9999999999","address":"123 Example Street","city":"Hyderabad","postalCode":"500001"}', '[{"product_id":"00000000-0000-0000-0000-000000000001","quantity":1.5}]', gen_random_uuid())$q$, 'fractional quantity rejected');
select public.test_reject($q$select * from public.create_order('{"name":"Sample Customer","phone":"9999999999","address":"123 Example Street","city":"Hyderabad","postalCode":"500001"}', '[{"product_id":"invalid","quantity":1}]', gen_random_uuid())$q$, 'invalid product ID rejected');
select public.test_reject($q$select * from public.create_order('{"name":"Sample Customer","phone":"9999999999","address":"123 Example Street","city":"Hyderabad","postalCode":"500001"}', '[{"product_id":"00000000-0000-0000-0000-000000000001","quantity":11}]', gen_random_uuid())$q$, 'quantity above maximum rejected');
select * from public.create_order('{"name":"Sample Customer","phone":"+91 99999 99999","email":"sample@example.com","address":"123 Example Street","city":"Hyderabad","postalCode":"500001","note":"Test only","total_paise":1,"status":"delivered","payment_status":"received"}', '[{"product_id":"00000000-0000-0000-0000-000000000001","quantity":1,"unit_price_paise":1}]', '33333333-3333-3333-3333-333333333333');
select * from public.create_order('{"name":"Ignored retry payload"}', '[]', '33333333-3333-3333-3333-333333333333');
select public.test_assert((select stock from public.products where id = '00000000-0000-0000-0000-000000000001') = 2, 'duplicate request decrements stock only once');
select public.test_reject($q$select * from public.create_order('{"name":"Sample Customer","phone":"9999999999","address":"123 Example Street","city":"Hyderabad","postalCode":"500001"}', '[{"product_id":"00000000-0000-0000-0000-000000000001","quantity":1},{"product_id":"00000000-0000-0000-0000-000000000002","quantity":1}]', gen_random_uuid())$q$, 'unavailable item rejects complete cart');
select public.test_assert((select stock from public.products where id = '00000000-0000-0000-0000-000000000001') = 2, 'rejected cart rolls back earlier stock updates');
select public.test_reject($q$select * from public.create_order('{"name":"Sample Customer","phone":"9999999999","address":"123 Example Street","city":"Hyderabad","postalCode":"500001"}', '[{"product_id":"00000000-0000-0000-0000-000000000001","quantity":3}]', gen_random_uuid())$q$, 'insufficient stock rejected');

reset role;
select public.test_assert((select count(*) from public.orders) = 1, 'only valid checkout inserts an order');
select public.test_assert((select total_paise from public.orders) = 9005, 'server ignores forged prices and rounds discounted paise');
select public.test_assert((select unit_price_paise from public.order_items) = 9005, 'immutable item snapshot records server price');
select public.test_assert((select customer_phone from public.orders) = '9999999999', 'phone country code and spaces normalize');
select public.test_assert((select payment_status from public.orders) = 'pending' and (select status from public.orders) = 'new', 'forged payment and order statuses are ignored');

set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select public.test_assert(not public.is_shop_admin(), 'authenticated ordinary account is not admin');
select public.test_assert((select count(*) from public.orders) = 0, 'ordinary account cannot read customer orders');
select public.test_assert((select count(*) from public.order_items) = 0, 'ordinary account cannot read order items');
select public.test_assert((select count(*) from public.admin_members) = 0, 'ordinary account cannot see admin membership');
select public.test_reject($q$insert into public.admin_members (user_id) values ('22222222-2222-2222-2222-222222222222')$q$, 'ordinary account cannot make itself admin');
select public.test_reject($q$insert into public.products (name, category, price_paise, image_url, stock) values ('Injected Product', 'Bags', 1, '/images/bag.webp', 10)$q$, 'ordinary account cannot create products');
select public.test_reject($q$insert into storage.objects (bucket_id, name) values ('product-images', 'unauthorized.webp')$q$, 'ordinary account cannot upload product photos');
update public.orders set status = 'shipped', payment_status = 'received';
reset role;
select public.test_assert((select status from public.orders) = 'new' and (select payment_status from public.orders) = 'pending', 'ordinary account cannot change fulfillment or payment');

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.test_assert(public.is_shop_admin(), 'granted owner is admin');
select public.test_assert((select count(*) from public.products) = 3, 'admin sees unavailable products');
select public.test_assert((select customer_address from public.orders) = '123 Example Street', 'admin can view delivery details');
select public.test_assert((select count(*) from public.order_items) = 1, 'admin can view order item snapshot');
update public.orders set status = 'confirmed', payment_status = 'received';
select public.test_assert((select status from public.orders) = 'confirmed' and (select payment_status from public.orders) = 'received', 'admin can manually update fulfillment and payment');
select public.test_reject($q$update public.orders set total_paise = 1$q$, 'admin browser cannot rewrite recorded total');
select public.test_reject($q$update public.orders set customer_address = 'Forged Address'$q$, 'admin browser cannot rewrite customer identity');
select public.test_reject($q$update public.order_items set unit_price_paise = 1$q$, 'admin browser cannot rewrite item snapshots');
select public.test_reject($q$delete from public.orders$q$, 'admin browser cannot delete order history');
insert into storage.objects (bucket_id, name) values ('product-images', 'authorized.webp');
select public.test_assert((select count(*) from storage.objects) = 1, 'admin can upload product photo metadata');
select public.test_reject($q$insert into public.products (name, category, price_paise, discount_percent, image_url, stock) values ('Invalid Discount', 'Bags', 10000, 96, '/images/bag.webp', 1)$q$, 'database rejects invalid discount');
select public.test_reject($q$insert into public.products (name, category, price_paise, image_url, stock) values ('Unsafe Image', 'Bags', 10000, 'javascript:alert(1)', 1)$q$, 'database rejects unsafe product image URL');
reset role;
commit;

select 'Security regression checks completed.' as result;
