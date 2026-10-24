import { response, secrets, validHmac, markCaptured, razorpay } from './_payment.mjs';
export default async (request) => {
  if (request.method !== 'POST') return response(405, { error: 'Method not allowed' });
  try {
    const raw = await request.text();
    if (raw.length > 100000) return response(413, { error: 'Too large' });
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret || !validHmac(raw, request.headers.get('x-razorpay-signature'), webhookSecret)) return response(401, { error: 'Invalid webhook signature' });
    const event = JSON.parse(raw);
    if (event.event !== 'payment.captured') return response(200, { ok: true });
    const payment = event.payload?.payment?.entity;
    if (!payment?.id || !payment?.order_id) return response(400, { error: 'Invalid event' });
    const { db, keyId, secret } = secrets();
    // Recheck authoritative payment data, not just an event body.
    const authoritative = await razorpay('payments/' + encodeURIComponent(payment.id), keyId, secret);
    const { data: link } = await db.from('razorpay_orders').select('amount_paise').eq('razorpay_order_id', payment.order_id).maybeSingle();
    if (!link || authoritative.status !== 'captured' || authoritative.order_id !== payment.order_id || authoritative.amount !== link.amount_paise || authoritative.currency !== 'INR') return response(409, { error: 'Payment mismatch' });
    await markCaptured(db, payment.order_id, payment.id);
    return response(200, { ok: true });
  } catch { return response(500, { error: 'Webhook processing failed' }); }
};
