import { response, secrets, uuid } from './_payment.mjs';
export default async (request) => {
 if(request.method!=='POST')return response(405,{error:'Method not allowed'});
 try {
  const {attemptId}=await request.json();
  if(!uuid(attemptId))return response(400,{error:'Invalid checkout reference'});
  const {db,keyId,secret}=secrets();
  const {data:attempt,error}=await db.from('checkout_attempts').select('id,total_paise,razorpay_order_id,created_at').eq('id',attemptId).maybeSingle();
  if(error||!attempt)return response(404,{error:'Checkout attempt not found'});
  if(Date.now()-Date.parse(attempt.created_at)>30*60_000)return response(409,{error:'Checkout expired; please start again'});
  if(attempt.razorpay_order_id)return response(200,{keyId,razorpayOrderId:attempt.razorpay_order_id,amount:attempt.total_paise,currency:'INR'});
  const res=await fetch('https://api.razorpay.com/v1/orders',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(keyId+':'+secret).toString('base64'),'Content-Type':'application/json'},body:JSON.stringify({amount:attempt.total_paise,currency:'INR',receipt:attempt.id.slice(0,40),notes:{checkout_attempt:attempt.id}})});
  if(!res.ok)throw Error('Gateway order failed');
  const gw=await res.json();
  if(gw.amount!==attempt.total_paise||gw.currency!=='INR')throw Error('Gateway amount mismatch');
  const {data:stored,error:saveError}=await db.from('checkout_attempts').update({razorpay_order_id:gw.id}).eq('id',attempt.id).is('razorpay_order_id',null).select('razorpay_order_id').maybeSingle();
  if(saveError)throw saveError;
  if(!stored)return response(409,{error:'Concurrent checkout started; please retry'});
  return response(200,{keyId,razorpayOrderId:gw.id,amount:gw.amount,currency:'INR'});
 }catch(e){console.error('[razorpay-create] failed:',e instanceof Error?e.message:'unknown');return response(500,{error:'Unable to start payment. Please try again.'})}
};