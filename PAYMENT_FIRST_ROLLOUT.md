# Payment-first checkout rollout (testing only until verified)

**Database deployment is REQUIRED before redeploying frontend/functions.** The migration `supabase/migrations/202610270001_payment_first_checkout.sql` must run *after* `202610260001_paid_order_notifications.sql`. Existing orders/payments are not removed.

## Behavior
1. Browser calls Supabase `begin_paid_checkout`: validates prices, contact details and stock, stores a private `checkout_attempts` record. No public order, stock deduction, or email.
2. Netlify `razorpay-create` makes a Razorpay order using the server-validated total; only pending payment attempt is stored.
3. Razorpay success handler and signed `payment.captured` webhook both check Razorpay's authoritative captured status and amount.
4. Database `finalize_paid_checkout` runs atomically: validates attempt, calls existing stock-locking create_order function, confirms captured amount equals actual order total, writes payment mapping, sets payment received, and queues the confirmation email. Duplicate captures yield the same final order.
5. Abandoned/failed payments remain private attempts and do not deduct stock or create customer orders.

**Stock/price race:** Because stock is not reserved before capture, two buyers can pay for the last item concurrently, or prices can change while checkout is open. In that case finalization rejects and the captured payment needs manual reconciliation/refund. Implement a dedicated inventory reservation/expiry and automated refund workflow before unrestricted live traffic. This migration deliberately does not claim to guarantee fulfillment in that edge case.

## Test plan
- SQL migration succeeds; no direct public execution privileges on `create_order`.
- Failed/dismissed payment: no new rows in `orders`, no stock change and no order email.
- Captured payment: exactly one new order, stock decreases once, and order email is queued once.
- Duplicate webhook/verify calls: no double stock deduction, no extra order.
- Browser closed after capture: webhook alone finalizes order.
- Confirmed order appears in admin. Old pending test records may still exist; clean up separately.
- Temporarily use Razorpay test keys and verify the whole flow before enabling live keys.
