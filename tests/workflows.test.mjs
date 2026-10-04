import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { captcha, requestBody, uuid } from '../server/core.mjs';
import { validateBooking, validateDriver, validateEnquiry } from '../server/validation.mjs';
import { template, submissionEmails, deliverEmails } from '../server/email.mjs';
import { parseMoneyToPence, verifyStripeSignature } from '../server/stripe.mjs';
import { calculateBookingCharges } from '../server/pricing.mjs';
import { createHmac } from 'node:crypto';

const user={id:'10000000-0000-4000-8000-000000000001',email:'customer@example.test'};
const requestId='20000000-0000-4000-8000-000000000001';
const car={id:'30000000-0000-4000-8000-000000000001',type:'small',model:'Citroen Berlingo',is_active:true,price_daily:100};
const body={name:'Test Customer',phone:'+44 7300 331603',pickup:'Test pickup',dropoff:'Test destination',date:'2027-01-02',time:'10:00',duration:'24',termsAccepted:true};
const driver={user_id:user.id,full_name:'Test Customer',date_of_birth:'1990-01-01',driving_licence_number:'TEST-ONLY',dvla_check_code:'TESTCODE',licence_front_file:`${user.id}/${requestId}/front.png`,licence_back_file:`${user.id}/${requestId}/back.png`,verification_status:'PENDING'};

test('server pricing ignores submitted price and validates dates, terms and active fleet',()=>{
  const now=new Date('2026-10-03T10:00:00Z');
  assert.equal(validateBooking({...body,price:'£0'},user,car,now).price,'£100.00');
  assert.equal(validateBooking({...body,duration:'4'},user,car,now).price,'£50.00');
  assert.equal(validateBooking({...body,duration:'48'},user,car,now).price,'£200.00');
  assert.equal(validateBooking({...body,duration:'custom'},user,car,now).price,'Quote required');
  for(const change of [{date:'2026-01-01'},{date:'2027-02-30'},{time:'99:99'},{termsAccepted:false},{duration:'0'},{phone:'<script>'}]) assert.throws(()=>validateBooking({...body,...change},user,car,now));
  assert.throws(()=>validateBooking(body,user,{...car,is_active:false},now));
});
test('driver document paths cannot cross accounts and enquiry input is bounded',()=>{
  assert.equal(validateDriver({driver},user,requestId).full_name,'Test Customer');
  assert.throws(()=>validateDriver({driver:{...driver,licence_front_file:'another-user/private.pdf'}},user,requestId));
  assert.throws(()=>validateEnquiry({name:'T',email:'bad',phone:'123',message:'short'}));
  assert.throws(()=>uuid('not-a-uuid'));
});
test('reCAPTCHA checks score, action, hostname, expiry, and upstream failures',async()=>{
  process.env.RECAPTCHA_SECRET_KEY='test-secret';
  const valid={success:true,score:0.9,action:'booking',hostname:'www.breezyeevans.co.uk',challenge_ts:new Date().toISOString()};
  await captcha('test-token','booking',async(url,options)=>{
    assert.equal(url,'https://www.google.com/recaptcha/api/siteverify');
    assert.equal(options.body.get('secret'),'test-secret');
    return {ok:true,json:async()=>valid};
  });
  for(const change of [{success:false},{score:0.1},{score:undefined},{action:'login'},{hostname:'evil.example'},{challenge_ts:'invalid'},{challenge_ts:new Date(Date.now()-180000).toISOString()}]) await assert.rejects(()=>captcha('test-token','booking',async()=>({ok:true,json:async()=>({...valid,...change})})),{status:403});
  await assert.rejects(()=>captcha('test-token','booking',async()=>({ok:false})),{status:503});
});
test('request handling rejects cross-origin and oversized requests',()=>{
  const req={method:'POST',headers:{origin:'https://www.breezyeevans.co.uk','content-type':'application/json'},body:{name:'test'}};
  assert.equal(requestBody(req).name,'test');
  assert.throws(()=>requestBody({...req,headers:{...req.headers,origin:'https://evil.example'}}));
  assert.throws(()=>requestBody({...req,body:'x'.repeat(25000)}));
  assert.throws(()=>requestBody({...req,method:'GET'}));
});
test('email templates escape customer content and distinguish requests from reservations',()=>{
  const message=template('Test',['<img src=x onerror=alert(1)>']);
  assert.ok(!message.html.includes('<img src=x'));
  assert.ok(message.text.includes('<img src=x'));
  const jobs=submissionEmails('booking',{...body,...user,name:'Test',vehicle_name:car.model,price:'£100'},'BV-TEST');
  assert.equal(jobs.length,2);
  assert.match(jobs[0].text,/No payment has been taken|not a confirmed reservation/);
  assert.equal(jobs[1].recipient,'info@breezyeemoves.co.uk');
});
test('Stripe helpers parse GBP amounts and verify webhook signatures',()=>{
  assert.equal(parseMoneyToPence('£100'),10000);
  assert.equal(parseMoneyToPence('£50.25'),5025);
  assert.equal(parseMoneyToPence('Quote required'),null);
  const body=JSON.stringify({id:'evt_test'});
  const secret='whsec_test';
  const timestamp=Math.floor(Date.now()/1000);
  const signature=createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex');
  assert.doesNotThrow(()=>verifyStripeSignature(body,`t=${timestamp},v1=${signature}`,secret));
  assert.throws(()=>verifyStripeSignature(body,`t=${timestamp},v1=bad`,secret));
});
test('two-stage payment allocation matches the £200 rental example',()=>{
  const charges=calculateBookingCharges(20000,{booking_deposit_percent_bps:2500,security_deposit_pence:25000,insurance_percent_bps:2000,insurance_enabled:true});
  assert.equal(charges.booking_deposit_pence,5000);
  assert.equal(charges.outstanding_hire_balance_pence,15000);
  assert.equal(charges.insurance_charge_pence,4000);
  assert.equal(charges.security_deposit_pence,25000);
  assert.equal(charges.initial_payment_pence,5000);
  assert.equal(charges.final_payment_pence,44000);
  assert.equal(charges.hire_price_pence + charges.insurance_charge_pence + charges.security_deposit_pence,49000);
  const lowValue=calculateBookingCharges(3000,{booking_deposit_percent_bps:2500,security_deposit_pence:25000,insurance_percent_bps:0,insurance_enabled:false});
  assert.equal(lowValue.booking_deposit_pence,750);
  assert.equal(lowValue.outstanding_hire_balance_pence,2250);
  const capped=calculateBookingCharges(3000,{booking_deposit_percent_bps:10000,booking_deposit_cap_pence:0,security_deposit_pence:25000,insurance_percent_bps:0,insurance_enabled:false});
  assert.equal(capped.booking_deposit_pence,3000);
  assert.equal(capped.outstanding_hire_balance_pence,0);
  assert.throws(()=>calculateBookingCharges(20000,{booking_deposit_percent_bps:2500,security_deposit_pence:25000,insurance_percent_bps:2000,insurance_enabled:false},{requireInsurance:true}),{status:409});
});
test('dynamic booking deposit examples and actual fleet duration prices are calculated in pence',()=>{
  for(const [hire,deposit] of [[2000,500],[4000,1000],[8000,2000],[12000,3000],[20000,5000],[40000,10000]]) {
    const charges=calculateBookingCharges(hire,{booking_deposit_percent_bps:2500,security_deposit_pence:25000,insurance_percent_bps:2000,insurance_enabled:true});
    assert.equal(charges.booking_deposit_pence,deposit);
    assert.equal(charges.outstanding_hire_balance_pence,hire-deposit);
    assert.equal(charges.insurance_charge_pence,Math.round(hire*0.2));
    assert.equal(charges.final_payment_pence,hire-deposit+Math.round(hire*0.2)+25000);
  }
  const fleet=[
    {daily:10000, prices:{2:2500,4:5000,8:10000,24:10000,48:20000,72:30000}},
    {daily:20000, prices:{2:5000,4:10000,8:20000,24:20000,48:40000,72:60000}},
    {daily:35000, prices:{2:8750,4:17500,8:35000,24:35000,48:70000,72:105000}},
  ];
  for(const vehicle of fleet) {
    for(const [duration,hire] of Object.entries(vehicle.prices)) {
      const booking=calculateBookingCharges(hire,{booking_deposit_percent_bps:2500,security_deposit_pence:25000,insurance_percent_bps:2000,insurance_enabled:false});
      assert.equal(booking.booking_deposit_pence,Math.round(hire*0.25), `${vehicle.daily}/${duration}`);
      assert.equal(booking.security_deposit_pence,25000);
      assert.equal(booking.insurance_charge_pence,0);
    }
  }
});
test('SQL migrations preserve atomic bookings, enforce RLS, deduplicate and lease email work',async()=>{
  const pg=new PGlite();
  try {
    await pg.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;
      create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
      create function auth.jwt() returns jsonb language sql as $$ select '{}'::jsonb $$;
      alter table auth.users add column email text;
      alter table auth.users add column email_confirmed_at timestamptz;
      alter table auth.users add column raw_user_meta_data jsonb default '{}'::jsonb;
      alter table auth.users add column updated_at timestamptz;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid,bucket_id text,name text);
      create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
      insert into auth.users(id,email,raw_user_meta_data) values ('${user.id}','info@breezyeevans.co.uk','{}');`);
    for(const file of ['create_cars_table.sql','create_driver_verifications.sql','20261003_production_workflows.sql','20261003_booking_management.sql','20261003_fleet_images.sql','20261003_stripe_payments.sql','20261003_booking_payment_system.sql','20261003_dynamic_deposits_admin_auth.sql']) await pg.exec(readFileSync(new URL(`../supabase_migrations/${file}`,import.meta.url),'utf8'));
    await pg.exec(`insert into cars(id,model,type,price_daily,capacity,payload,is_active,daily_rate_pence,published)
      values('${car.id}','${car.model}','${car.type}',100,'2-3 m3',750,true,10000,true) on conflict (id) do nothing`);
    const data=validateBooking(body,user,car,new Date('2026-10-03'));
    const jobs=submissionEmails('booking',data,'BV-TEST');
    const submit=(key,hash='hash',d=driver)=>pg.query('select bv_submit($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) result',[key,hash,'booking','BV-'+key,JSON.stringify(data),JSON.stringify(d),JSON.stringify(jobs)]);
    await submit('first');await submit('first');
    assert.equal((await pg.query('select count(*)::int n from bookings')).rows[0].n,1);
    assert.equal((await pg.query('select count(*)::int n from email_outbox')).rows[0].n,2);
    assert.equal((await pg.query('select count(*)::int n from driver_verifications')).rows[0].n,1);
    await assert.rejects(()=>submit('first','different'),/idempotency_conflict/);
    await assert.rejects(()=>submit('bad','hash',{...driver,date_of_birth:'bad'}));
    assert.equal((await pg.query('select count(*)::int n from bookings')).rows[0].n,1,'failed driver insert rolls back booking');
    assert.equal((await pg.query("select has_table_privilege('authenticated','bookings','INSERT') p")).rows[0].p,false);
    assert.equal((await pg.query("select has_function_privilege('anon','bv_submit(text,text,text,text,jsonb,jsonb,jsonb)','EXECUTE') p")).rows[0].p,false);
    assert.equal((await pg.query('select * from bv_claim_emails(null)')).rows.length,2);
    assert.equal((await pg.query('select * from bv_claim_emails(null)')).rows.length,0,'leased jobs are not delivered concurrently');
    await pg.exec("update email_outbox set locked_until=now()-interval '1 minute', first_attempt_at=now()-interval '25 hours'");
    assert.equal((await pg.query('select * from bv_claim_emails(null)')).rows.length,0,'do not resend beyond provider deduplication window');
    for(let i=0;i<6;i++) assert.equal((await pg.query("select bv_rate_limit('key',6) ok")).rows[0].ok,true);
    assert.equal((await pg.query("select bv_rate_limit('key',6) ok")).rows[0].ok,false);
    const booking=(await pg.query('select * from bookings')).rows[0];
    const manage=(action,key,admin=true)=>pg.query('select bv_manage($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',[booking.id,action,'Requested',user.id,admin,key,action,JSON.stringify(jobs)]);
    await assert.rejects(()=>manage('confirm','confirm-before-driver'),/driver_not_approved/);
    await manage('approve','approve');
    assert.equal((await pg.query('select status from bookings')).rows[0].status,'Awaiting booking deposit');
    await pg.exec("update bookings set status='Paid'");
    await manage('confirm','confirm');await manage('confirm','confirm');
    assert.equal((await pg.query('select status from bookings')).rows[0].status,'Confirmed');
    await assert.rejects(()=>manage('cancel_confirm','forbidden',false),/forbidden/);
    await manage('cancel','cancel-request',false);
    assert.equal((await pg.query('select status from bookings')).rows[0].status,'Cancellation requested');
  } finally { await pg.close(); }
});
test('Resend failures leave queued work retryable and successes record provider receipt',async()=>{
  process.env.RESEND_API_KEY='test-key';
  const updates=[];
  const client={rpc:async()=>({data:[{id:'mail-id',recipient:'test@example.test',subject:'Test',html:'<p>Test</p>',text:'Test'}]}),from:()=>({update:value=>({eq:async()=>{updates.push(value);return {};}})})};
  assert.equal(await deliverEmails(client,null,async()=>({ok:false})),0);
  assert.equal(updates.length,0);
  assert.equal(await deliverEmails(client,null,async(_url,options)=>{
    assert.equal(options.headers['Idempotency-Key'],'mail-id');
    assert.equal(JSON.parse(options.body).from,'Breezyee Vans <no-reply@breezyeevans.co.uk>');
    return {ok:true,json:async()=>({id:'resend-receipt'})};
  }),1);
  assert.equal(updates[0].provider_id,'resend-receipt');
});


