-- Existing orders may have empty emails; leave historical rows intact.
-- Require valid email for all newly created orders, including direct RPC callers.
begin;
alter table public.orders add constraint orders_customer_email_required
check (customer_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') not valid;
create or replace function public.require_new_order_email()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.customer_email is null or new.customer_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then raise exception 'Enter a valid email address for order updates.' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.require_new_order_email() from public;
create trigger orders_require_email before insert on public.orders
for each row execute function public.require_new_order_email();
commit;
