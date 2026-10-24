import { createHmac, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export function response(status, data) { return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }); }
export function secrets() {
  const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (![RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY].every(Boolean)) throw new Error('Payment integration is not configured.');
  return { keyId: RAZORPAY_KEY_ID, secret: RAZORPAY_KEY_SECRET, db: createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } }) };
}
export async function razorpay(path, keyId, secret) {
  const res = await fetch('https://api.razorpay.com/v1/' + path, { headers: { Authorization: 'Basic ' + Buffer.from(keyId + ':' + secret).toString('base64') } });
  if (!res.ok) throw new Error('Payment provider request failed.');
  return await res.json();
}
export async function createGatewayOrder(keyId, secret, order) {
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(keyId + ':' + secret).toString('base64'), 'content-type': 'application/json' },
    body: JSON.stringify({ amount: order.total_paise, currency: 'INR', receipt: order.order_number.slice(0, 40), notes: { shop_order_id: order.id } })
  });
  if (!res.ok) throw new Error('Could not initialize payment.');
  return res.json();
}
export function validHmac(message, signature, secret) {
  if (!/^[a-f0-9]{64}$/i.test(signature || '')) return false;
  const actual = Buffer.from(signature, 'hex');
  const expected = createHmac('sha256', secret).update(message).digest();
  return timingSafeEqual(actual, expected);
}
export async function markCaptured(db, gatewayOrderId, paymentId) {
  const { data: attempt, error } = await db.from('razorpay_orders').select('shop_order_id,amount_paise,razorpay_payment_id').eq('razorpay_order_id', gatewayOrderId).maybeSingle();
  if (error || !attempt) throw new Error('Payment attempt was not found.');
  if (attempt.razorpay_payment_id && attempt.razorpay_payment_id !== paymentId) throw new Error('Payment reference conflicts with an existing payment.');
  // Conditional update keeps retries idempotent and rejects remapping a gateway order to another payment.
  const { error: linkError } = await db.from('razorpay_orders').update({ razorpay_payment_id: paymentId, captured_at: new Date().toISOString() }).eq('razorpay_order_id', gatewayOrderId).or('razorpay_payment_id.is.null,razorpay_payment_id.eq.' + paymentId);
  if (linkError) throw linkError;
  const { error: paidError } = await db.from('orders').update({ payment_status: 'received' }).eq('id', attempt.shop_order_id).eq('total_paise', attempt.amount_paise);
  if (paidError) throw paidError;
  return attempt.shop_order_id;
}
export function uuid(value) { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value); }
