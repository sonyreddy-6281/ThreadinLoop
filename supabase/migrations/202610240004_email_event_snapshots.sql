-- Apply after 202610240003_order_email_outbox.sql.
-- Preserve the status *at the moment of change*, not the status at delivery time.
begin;
alter table public.order_email_outbox add column status_snapshot text;
create or replace function public.queue_order_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if tg_op = 'INSERT' then
   insert into public.order_email_outbox(order_id,event_key,event_type,status_snapshot)
   values(new.id,'order:'||new.id::text,'order_placed',new.status::text)
   on conflict do nothing;
 else
   if new.payment_status='received' and old.payment_status is distinct from new.payment_status then
     insert into public.order_email_outbox(order_id,event_key,event_type,status_snapshot)
     values(new.id,'payment:'||new.id::text,'payment_received',new.status::text)
     on conflict do nothing;
   end if;
   if new.status is distinct from old.status then
     insert into public.order_email_outbox(order_id,event_key,event_type,status_snapshot)
     values(new.id,'status:'||new.id::text||':'||new.status::text||':'||new.updated_at::text,'status_changed',new.status::text)
     on conflict do nothing;
   end if;
 end if;
 return new;
end; $$;

drop function public.claim_order_email(integer);
create function public.claim_order_email(p_limit integer default 10)
returns table(id bigint, order_id uuid, event_key text, event_type text, customer_name text, customer_email text, order_number text, total_paise integer, order_status text, payment_status text)
language plpgsql security definer set search_path = '' as $$
begin
 return query
 with pending as (
   select e.id from public.order_email_outbox e
   where ((e.status in ('queued','failed') and e.available_at <= now())
      or (e.status='processing' and e.locked_at < now()-interval '10 minutes'))
      and e.attempts < 5
   order by e.id
   for update skip locked limit least(greatest(p_limit,1),20)
 ), claimed as (
   update public.order_email_outbox e set status='processing',locked_at=now(),attempts=e.attempts+1
   from pending p where e.id=p.id
   returning e.id,e.order_id,e.event_key,e.event_type,e.status_snapshot
 )
 select c.id,c.order_id,c.event_key,c.event_type,o.customer_name,o.customer_email,o.order_number,o.total_paise,
  coalesce(c.status_snapshot,o.status::text),o.payment_status::text
 from claimed c join public.orders o on o.id=c.order_id;
end; $$;
revoke all on function public.claim_order_email(integer) from public,anon,authenticated;
grant execute on function public.claim_order_email(integer) to service_role;
commit;