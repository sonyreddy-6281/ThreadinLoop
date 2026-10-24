-- Run after migration 202610240004_email_event_snapshots.sql
-- These are fulfilment labels. 'refunded' does not call Razorpay's refund API.
begin;
alter type public.order_status add value if not exists 'refunded';
alter type public.order_status add value if not exists 'returned';
commit;

begin;
create or replace function public.queue_order_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if tg_op = 'INSERT' then
   insert into public.order_email_outbox(order_id,event_key,event_type,status_snapshot)
   values(new.id,'order:'||new.id::text,'order_placed',new.status::text)
   on conflict do nothing;
 elsif new.status is distinct from old.status then
   insert into public.order_email_outbox(order_id,event_key,event_type,status_snapshot)
   values(new.id,'status:'||new.id::text||':'||new.status::text||':'||new.updated_at::text,'status_changed',new.status::text)
   on conflict do nothing;
 end if;
 return new;
end; $$;
-- Suppress legacy payment receipt email jobs, including those queued by an earlier migration.
update public.order_email_outbox
set status='sent',sent_at=now(),last_error='Suppressed: payment receipt email disabled'
where event_type='payment_received' and status in ('queued','failed');
commit;