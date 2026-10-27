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
export async function markCaptured(db,gatewayOrderId,paymentId) {
 const {data,error}=await db.rpc('finalize_paid_checkout',{p_gateway_order:gatewayOrderId,p_payment:paymentId});
 if(error)throw error;
 const row=Array.isArray(data)?data[0]:data;
 if(!row?.order_id)throw Error('Payment captured but shop order finalization failed');
 return row;
}
export function uuid(value) { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value); }
