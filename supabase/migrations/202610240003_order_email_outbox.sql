-- Transactional email outbox; keeps customer communication separate from payment success.
begin;
create table public.order_email_outbox (
 id bigint generated always as identity primary key,
 order_id uuid not null references public.orders(id),
 event_key text not null unique,
 event_type text not null,
 status text not null default 'queued' check (status in ('queued','processing','sent','failed')),
 attempts int not null default 0,
 available_at timestamptz not null default now(),
 locked_at timestamptz,
 sent_at timestamptz,
 provider_id text,
 last_error text,
 created_at timestamptz not null default now()
);
create index on public.order_email_outbox(status,available_at);
alter table public.order_email_outbox enable row level security;
revoke all on public.order_email_outbox from public,anon,authenticated;

create function public.queue_order_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if tg_op = 'INSERT' then
   insert into public.order_email_outbox(order_id,event_key,event_type)
   values(new.id, 'order:'||new.id::text, 'order_placed') on conflict do nothing;
 elsif new.payment_status = 'received' and old.payment_status <> 'received' then
   insert into public.order_email_outbox(order_id,event_key,event_type)
   values(new.id,'payment:'||new.id::text,'payment_received') on conflict do nothing;
 end if;
 if tg_op = 'UPDATE' and new.status is distinct from old.status then
   insert into public.order_email_outbox(order_id,event_key,event_type)
   values(new.id,'status:'||new.id::text||':'||new.status::text||':'||new.updated_at::text,'status_changed') on conflict do nothing;
 end if;
 return new;
end; $$;
revoke all on function public.queue_order_email() from public;
create trigger orders_queue_notification after insert or update of status,payment_status on public.orders
for each row execute function public.queue_order_email();

create function public.claim_order_email(p_limit integer default 10)
returns table(id bigint, order_id uuid, event_key text, event_type text, customer_name text, customer_email text, order_number text, total_paise integer, order_status text)
language plpgsql security definer set search_path = '' as $$
begin
 return query
 with pending as (
   select e.id from public.order_email_outbox e
   where (e.status in ('queued','failed') and e.available_at <= now() and e.attempts < 5)
      or (e.status='processing' and e.locked_at < now()-interval '10 minutes' and e.attempts<5)
   order by e.id
   for update skip locked limit least(greatest(p_limit,1),20)
 ), claimed as (
   update public.order_email_outbox e set status='processing',locked_at=now(),attempts=e.attempts+1
   from pending p where e.id=p.id
   returning e.id,e.order_id,e.event_key,e.event_type
 )
 select c.id,c.order_id,c.event_key,c.event_type,o.customer_name,o.customer_email,o.order_number,o.total_paise,o.status::text
 from claimed c join public.orders o on o.id=c.order_id;
end; $$;
revoke all on function public.claim_order_email(integer) from public,anon,authenticated;
grant execute on function public.claim_order_email(integer) to service_role;
commit;
