import { test } from 'node:test';
import assert from 'node:assert/strict';
import submit from '../api/submit.mjs';
import auth from '../api/auth.mjs';
import manage from '../api/manage.mjs';
import createPaymentIntent from '../api/stripe-payment-intent.mjs';

const user={id:'10000000-0000-4000-8000-000000000001',email:'customer@example.test',email_confirmed_at:'2026-01-01T00:00:00Z'};
const requestId='20000000-0000-4000-8000-000000000001';
const vehicleId='30000000-0000-4000-8000-000000000001';
function response() {return {code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(value){this.body=value;}};}
function request(body) {return {method:'POST',headers:{origin:'https://www.breezyeevans.co.uk','content-type':'application/json',authorization:'Bearer test-session'},socket:{remoteAddress:'127.0.0.1'},body};}
test('API submission ordering, persistence failure, CAPTCHA rejection and authorization',async()=>{
  Object.assign(process.env,{VITE_SUPABASE_URL:'https://test.supabase.co',VITE_SUPABASE_ANON_KEY:'anon-test',SUPABASE_SERVICE_ROLE_KEY:'service-test',RATE_LIMIT_SECRET:'rate-test',RECAPTCHA_SECRET_KEY:'captcha-test',RESEND_API_KEY:'email-test',STRIPE_SECRET_KEY:'sk_test'});
  const original=globalThis.fetch;
  let mode='ok',action='enquiry',calls=[];
  const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
  globalThis.fetch=async(input,options={})=>{
    const url=String(input);calls.push(url);
    if(url.includes('siteverify')) return json({success:mode!=='captcha-fail',action,hostname:'www.breezyeevans.co.uk',score:0.9,challenge_ts:new Date().toISOString()});
    if(url.includes('bv_rate_limit')) return json(mode!=='limited');
    if(url.includes('/auth/v1/admin/generate_link')) {
      const payload=JSON.parse(options.body);
      assert.equal(payload.type,'magiclink');
      assert.equal(payload.email,user.email);
      return json({...user,user_metadata:{password_set:false},email_otp:'123456',action_link:'https://www.breezyeevans.co.uk/login',hashed_token:'hash',redirect_to:'https://www.breezyeevans.co.uk/login',verification_type:'magiclink'});
    }
    if(url.includes('/auth/v1/admin/users')) {
      assert.equal(options.method,'GET');
      return json({users:[]});
    }
    if(url.includes('api.resend.com/emails')) {
      const payload=JSON.parse(options.body);
      assert.equal(payload.from,'Breezyee Vans <no-reply@breezyeevans.co.uk>');
      assert.deepEqual(payload.to,[user.email]);
      assert.match(payload.text,/123456/);
      assert.equal(options.headers['Idempotency-Key'].length,64);
      return json({id:'resend-auth-test'});
    }
    if(url.includes('/auth/v1/otp')) throw new Error('Supabase OTP email endpoint must not be used');
    if(url.includes('/auth/v1/user')) return json(user);
    if(url.includes('/auth/v1/token')) {
      assert.equal(JSON.parse(options.body).password,' password with spaces ');
      return json({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600,token_type:'bearer',user});
    }
    if(url.includes('/auth/v1/verify')) {
      const payload=JSON.parse(options.body);
      assert.equal(payload.type,'email');assert.equal(payload.token,'123456');
      return json({access_token:'otp-access',refresh_token:'otp-refresh',expires_in:3600,token_type:'bearer',user});
    }
    if(url.includes('api.stripe.com/v1/payment_intents')) {
      const payload=new URLSearchParams(options.body);
      assert.equal(payload.get('amount'),'5000');assert.equal(payload.get('currency'),'gbp');
      assert.equal(options.headers['Idempotency-Key'],'booking-payment:BV-TEST123:booking_deposit');
      return json({id:'pi_test',client_secret:'pi_test_secret',amount:5000,currency:'gbp',status:'requires_payment'});
    }
    if(url.includes('/rest/v1/business_settings')) return json({id:true,booking_deposit_pence:5000,security_deposit_pence:25000,insurance_percent_bps:2000,insurance_enabled:false,hold_minutes:15,payment_deadline_hours:24});
    if(url.includes('bv_vehicle_available')) return json(true);
    if(url.includes('/rest/v1/cars')) return json({id:vehicleId,model:'Test van',type:'small',price_daily:100,is_active:true});
    if(url.includes('/storage/v1/object/list')) return json([{name:'front.png',metadata:{size:100}},{name:'back.png',metadata:{size:100}}]);
    if(url.includes('bv_submit')) {
      const payload=JSON.parse(options.body);
      assert.equal(payload.p_emails.length,2);
      if(action==='booking') assert.equal(payload.p_data.price,'£100.00');
      if(mode==='db-fail') return json({message:'database unavailable',code:'P0001'},400);
      return json({reference:payload.p_reference});
    }
    if(url.includes('bv_claim_emails'))return json([]);
    if(url.includes('/rest/v1/booking_payments')) return json({id:'payment',booking_id:'booking',category:'booking_deposit',expected_amount_pence:5000,received_amount_pence:0,currency:'gbp',status:'requires_payment'});
    if(url.includes('/rest/v1/bookings'))return json({id:'booking',reference:'BV-TEST123',...user,user_id:user.id,name:'Test Customer',vehicle_name:'Test van',price:'£100',status:'Awaiting booking deposit',booking_status:'Awaiting booking deposit',payment_status:'unpaid',booking_deposit_pence:5000,outstanding_balance_pence:5000,insurance_charge_pence:0,security_deposit_pence:25000});
    throw new Error('Unexpected test endpoint');
  };
  try {
    const enquiry={kind:'enquiry',requestId,token:'mock',name:'Test Customer',email:user.email,phone:'+44 7300 331603',message:'A test enquiry message.'};
    let res=response();await submit(request(enquiry),res);
    assert.equal(res.code,200);assert.match(res.body.reference,/^BV-[A-F0-9]{16}$/);
    assert.ok(calls.findIndex(x=>x.includes('bv_submit'))<calls.findIndex(x=>x.includes('bv_claim_emails')));
    assert.ok(!JSON.stringify(res.body).includes(user.email));
    calls=[];mode='db-fail';res=response();await submit(request(enquiry),res);
    assert.equal(res.code,503);assert.ok(!calls.some(x=>x.includes('bv_claim_emails')));
    calls=[];mode='captcha-fail';res=response();await submit(request(enquiry),res);
    assert.equal(res.code,403);assert.ok(!calls.some(x=>x.includes('bv_submit')));
    calls=[];mode='limited';res=response();await submit(request(enquiry),res);
    assert.equal(res.code,429);assert.ok(!calls.some(x=>x.includes('siteverify')));
    mode='ok';action='booking';res=response();
    const booking={kind:'booking',requestId,token:'mock',vehicleId,name:'Test Customer',phone:'+44 7300 331603',pickup:'Test pickup',dropoff:'Test destination',date:'2099-01-02',time:'10:00',duration:'24',termsAccepted:true,price:'£0',driver:{full_name:'Test Customer',date_of_birth:'1990-01-01',driving_licence_number:'TEST-ONLY',dvla_check_code:'TESTCODE',licence_front_file:`${user.id}/${requestId}/front.png`,licence_back_file:`${user.id}/${requestId}/back.png`}};
    await submit(request(booking),res);assert.equal(res.code,200);
    assert.equal(res.body.payment.paymentPage,`/payment?reference=${encodeURIComponent(res.body.reference)}&category=booking_deposit`);
    assert.equal(res.body.payment.amountTotal,5000);
    assert.equal(res.body.payment.currency,'gbp');
    const unsigned=request(booking);delete unsigned.headers.authorization;res=response();await submit(unsigned,res);assert.equal(res.code,401);
    action='manage';res=response();await manage(request({action:'confirm',token:'mock',requestId,bookingId:'booking'}),res);assert.equal(res.code,403);
    action='register';mode='captcha-fail';res=response();await auth(request({action:'register',email:user.email,token:'mock'}),res);assert.equal(res.code,403);
    action='start_otp';mode='ok';calls=[];res=response();await auth(request({action:'start_otp',email:user.email,token:'mock',signup:true,fullName:'Test Customer',phone:'+44 7300 331603',postcode:'SW1A 1AA'}),res);assert.equal(res.code,200);assert.match(res.body.message,/one-time code/);assert.ok(calls.some(x=>x.includes('/auth/v1/admin/generate_link')));assert.ok(calls.some(x=>x.includes('api.resend.com/emails')));assert.ok(!calls.some(x=>x.includes('/auth/v1/otp')));
    action='login';mode='ok';res=response();await auth(request({action:'login',email:user.email,token:'mock',password:' password with spaces '}),res);assert.equal(res.code,200);assert.equal(res.body.session.access_token,'test-access');
    action='verify_otp';res=response();await auth(request({action:'verify_otp',email:user.email,token:'mock',otp:'123456'}),res);assert.equal(res.code,200);assert.equal(res.body.session.access_token,'otp-access');
    action='payment';res=response();await createPaymentIntent(request({reference:'BV-TEST123',token:'mock'}),res);assert.equal(res.code,200);assert.equal(res.body.clientSecret,'pi_test_secret');assert.equal(res.body.amountTotal,5000);
  } finally {globalThis.fetch=original;}
});


