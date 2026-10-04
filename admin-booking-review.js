import { getToken } from './forms.js';
const params = new URLSearchParams(location.search); const reference = params.get('reference');
const reviewToken = params.get('token');
const status = document.getElementById('reviewStatus'); const content = document.getElementById('reviewContent');
const money = p => `£${(Number(p || 0) / 100).toFixed(2)}`;
const esc = v => String(v ?? '—').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const row = (label, value) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
function fail(message) { status.textContent = message; status.classList.add('error'); }
async function load() {
  if (!reference) return fail('This review link is missing its booking reference.');
  const response = await fetch('/api/admin-booking-review', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({reference,reviewToken}) });
  const result = await response.json(); if (!response.ok) return fail(result.error || 'Unable to load this booking request.');
  const b=result.booking, d=result.driver; status.hidden=true; content.hidden=false;
  document.getElementById('reviewTitle').textContent = b.vehicle_name || b.van_size || 'Booking request'; document.getElementById('reviewReference').textContent=`Reference ${b.reference}`; document.getElementById('reviewState').textContent=b.approval_status || b.status || 'Pending Approval';
  document.getElementById('bookingDetails').innerHTML=[row('Customer',b.name),row('Email',b.email),row('Phone',b.phone),row('Collection',`${b.date || b.collection_at || '—'} ${b.time || ''} (owner location)`),row('Destination',b.dropoff),row('Duration',b.duration)].join('');
  document.getElementById('priceDetails').innerHTML=[row('Hire price',b.hire_price_pence ? money(b.hire_price_pence) : b.price),row('Booking deposit',money(b.booking_deposit_pence)),row('Outstanding hire',money(b.outstanding_balance_pence)),row('Insurance charge',money(b.insurance_charge_pence)),row('Refundable security deposit',money(b.security_deposit_pence)),row('Total before deposit',money(b.total_due_pence))].join('');
  document.getElementById('driverDetails').innerHTML=d?[row('Name',d.full_name),row('Date of birth',d.date_of_birth),row('Licence number',d.driving_licence_number),row('DVLA check code',d.dvla_check_code),row('Status',d.verification_status)].join(''):'<p>No driver documents found.</p>';
  document.getElementById('driverDocuments').innerHTML=d?[['licence_front_file','Licence front'],['licence_back_file','Licence back']].map(([key,label])=>result.documents?.[key]?`<a href="${esc(result.documents[key])}" target="_blank" rel="noopener">${label} ↗</a>`:'').join(''):'';
  const act = async action => { const code=prompt('Enter the administrator verification code:'); if(!code)return; if(!confirm(`${action==='approve'?'Approve':'Decline'} this booking request?`))return; const captcha=await getToken('manage'); const r=await fetch('/api/manage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bookingId:b.id,action,approvalCode:code,reviewToken,token:captcha})}); const j=await r.json(); if(!r.ok)return alert(j.error||'Unable to update booking.'); alert(j.message); location.reload(); };
  document.getElementById('approveReview').onclick=()=>act('approve'); document.getElementById('rejectReview').onclick=()=>act('reject');
}
load().catch(error=>fail(error.message || 'Unable to load this booking request.'));
