import { response, secrets, validHmac, razorpay, markCaptured } from './_payment.mjs';
export default async (request) => {
  if (request.method !== 'POST') return response(405, { error: 'Method not allowed' });
  try {
    const payload = await request.json();
    const orderId = payload.razorpay_order_id, paymentId = payload.razorpay_payment_id, signature = payload.razorpay_signature;
    if (typeof orderId !== 'string' || typeof paymentId !== 'string' || !validHmac(orderId + '|' + paymentId, signature, secrets().secret)) return response(400, { error: 'Invalid payment signature.' });
    const { db, keyId, secret } = secrets();
    const [{ data: link }, payment] = await Promise.all([db.from('checkout_attempts').select('id,total_paise').eq('razorpay_order_id', orderId).maybeSingle(), razorpay('payments/' + encodeURIComponent(paymentId), keyId, secret)]);
    if (!link || payment.order_id !== orderId || payment.amount !== link.total_paise || payment.currency !== 'INR') return response(409, { error: 'Payment details did not match the order.' });
    if (payment.status !== 'captured') return response(202, { verified: false, message: 'Payment is awaiting capture. Check your order status with the seller.' });
    const order = await markCaptured(db, orderId, paymentId);
    return response(200, { verified: true, orderNumber: order.order_number });
  } catch { return response(500, { error: 'Unable to confirm payment now. Do not pay again; contact the shop with your payment reference.' }); }
};
