-- Keep unpaid attempts internal. Email order confirmation only on capture.
-- Existing pending orders remain for gateway reconciliation; do not delete before
-- stock-restoration and payment race handling is implemented.
begin;
create or replace function public.queue_order_email() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then
   if new.payment_status='received' and old.payment_status is distinct from new.payment_status then
     insert into public.order_email_outbox(order_id,event_key,event_type,status_snapshot)
     values(new.id,'order:'||new.id::text,'order_placed',new.status::text)
     on conflict do nothing;
   end if;
   if new.payment_status='received' and new.status is distinct from old.status then
     insert into public.order_email_outbox(order_id,event_key,event_type,status_snapshot)
     values(new.id,'status:'||new.id::text||':'||new.status::text||':'||new.updated_at::text,'status_changed',new.status::text)
     on conflict do nothing;
   end if;
 end if;
 return new;
end; $$;

-- Cancel unsent order-created notifications for not-yet-paid orders.
update public.order_email_outbox q set status='sent',sent_at=now(),
 last_error='Suppressed: payment not yet confirmed'
from public.orders o
where q.order_id=o.id and o.payment_status <> 'received'
  and q.event_type='order_placed' and q.status in ('queued','failed');
commit;