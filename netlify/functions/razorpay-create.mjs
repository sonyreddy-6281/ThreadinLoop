import { response, secrets, createGatewayOrder, uuid } from './_payment.mjs';
export default async (request) => {
  if (request.method !== 'POST') return response(405, { error: 'Method not allowed' });
  let stage = 'read-request';
  try {
    const { orderId } = await request.json();
    if (!uuid(orderId)) return response(400, { error: 'Invalid order reference.' });
    stage = 'load-credentials';
    const { db, keyId, secret } = secrets();
    stage = 'read-shop-order';
    const { data: order, error } = await db.from('orders').select('id,order_number,total_paise,payment_status,created_at').eq('id', orderId).maybeSingle();
    if (error || !order) return response(404, { error: 'Order not found.' });
    if (order.payment_status !== 'pending') return response(409, { error: 'This order is already paid.' });
    if (Date.now() - new Date(order.created_at).getTime() > 24 * 3600 * 1000) return response(409, { error: 'This order is too old for payment. Contact the shop.' });
    stage = 'read-payment-mapping';
    const { data: existing, error: findError } = await db.from('razorpay_orders').select('razorpay_order_id,amount_paise').eq('shop_order_id', orderId).maybeSingle();
    if (findError) throw findError;
    if (existing) return response(200, { keyId, razorpayOrderId: existing.razorpay_order_id, amount: existing.amount_paise, currency: 'INR', orderNumber: order.order_number });
    stage = 'create-razorpay-order';
    const created = await createGatewayOrder(keyId, secret, order);
    if (created.amount !== order.total_paise || created.currency !== 'INR') throw new Error('Provider amount mismatch');
    stage = 'save-payment-mapping';
    const { error: saveError } = await db.from('razorpay_orders').insert({ shop_order_id: order.id, razorpay_order_id: created.id, amount_paise: created.amount });
    if (saveError) {
      // A concurrent request may have created the link first.
      const { data: winner } = await db.from('razorpay_orders').select('razorpay_order_id,amount_paise').eq('shop_order_id', orderId).maybeSingle();
      if (!winner) throw saveError;
      return response(200, { keyId, razorpayOrderId: winner.razorpay_order_id, amount: winner.amount_paise, currency: 'INR', orderNumber: order.order_number });
    }
    return response(200, { keyId, razorpayOrderId: created.id, amount: created.amount, currency: 'INR', orderNumber: order.order_number });
  } catch (error) {
    // Log the failing operation only, never API keys, customer records or raw provider responses.
    console.error('[razorpay-create] failed at stage:', stage, 'errorType:', error instanceof Error ? error.name : 'unknown');
    return response(500, { error: 'Payment setup failed. Check Netlify Function logs for the failing stage. Your shop order is saved.' });
  }
};
