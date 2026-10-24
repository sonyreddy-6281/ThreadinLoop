\set ON_ERROR_STOP on
set role anon;
select * from public.create_order(
  '{"name":"Race Sample","phone":"9999999999","address":"123 Example Street","city":"Hyderabad","postalCode":"500001"}',
  '[{"product_id":"00000000-0000-0000-0000-000000000003","quantity":1}]', gen_random_uuid()
);
