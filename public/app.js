let cfg = {};
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const money = value => Number(value || 0).toLocaleString('en-IN');
const methodNames = {upi:'UPI Payment',qr_a:'QR Payment A',qr_b:'QR Payment B',qr_c:'QR Payment C',bank:'Bank Transfer'};
const methodIcons = {upi:'₹',qr_a:'▣',qr_b:'▣',qr_c:'▣',bank:'⌂'};

function methodCard(key, title, body, tag='Payment Option'){
  return `<article class="method" id="method-${key}">
    <div class="method-top"><div class="method-title"><span class="method-icon">${methodIcons[key]}</span><h3>${title}</h3></div><span class="method-tag">${tag}</span></div>
    <div class="method-body"><div class="method-details">${body}</div><div class="method-action"><button type="button" onclick="selectMethod('${key}')">Use ${title}</button></div></div>
  </article>`;
}
function renderPaymentMethods(){
  const box=$('methods'); if(!box)return;
  const upi=methodCard('upi','UPI Payment',`
    <p><b>UPI ID:</b> ${esc(cfg.upi_id || 'Not configured')}</p>
    <p><b>Account Holder:</b> ${esc(cfg.upi_holder || 'Not configured')}</p>
    <p class="limits">₹${money(cfg.upi_min)} – ₹${money(cfg.upi_max)}</p>
    ${cfg.upi_message?`<p class="instructions">${esc(cfg.upi_message)}</p>`:''}`,'UPI');
  const qr=(key,title)=>methodCard(key,title,`${cfg[key]?`<img class="qr" src="${esc(cfg[key])}" alt="${title} QR code">`:'<p>QR code is not configured yet.</p>'}<p><b>Account Holder:</b> ${esc(cfg[key+'_holder'] || 'Not configured')}</p><p class="limits">₹${money(cfg[key+'_min'])} – ₹${money(cfg[key+'_max'])}</p>${cfg[key+'_message']?`<p class="instructions">${esc(cfg[key+'_message'])}</p>`:''}`,'QR CODE');
  const bank=methodCard('bank','Bank Transfer',`
    <p><b>Bank Holder:</b> ${esc(cfg.bank_holder || 'Not configured')}</p>
    <p><b>Bank Name:</b> ${esc(cfg.bank_name || 'Not configured')}</p>
    <p><b>Account Number:</b> ${esc(cfg.bank_account || 'Not configured')}</p>
    <p><b>IFSC:</b> ${esc(cfg.bank_ifsc || 'Not configured')}</p>
    <p class="limits">₹${money(cfg.bank_min)} – ₹${money(cfg.bank_max)}</p>
    ${cfg.bank_message?`<p class="instructions">${esc(cfg.bank_message)}</p>`:''}`,'BANK');
  box.innerHTML=upi+qr('qr_a','QR Payment A')+qr('qr_b','QR Payment B')+qr('qr_c','QR Payment C')+bank;
}
function renderDropdown(){const s=$('payment_method');if(!s)return;s.innerHTML=Object.entries(methodNames).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');}
function selectMethod(method){
  const s=$('payment_method'),a=$('amount');if(!s||!a)return;
  s.value=method;
  let min=Number(cfg[method+'_min']);let max=Number(cfg[method+'_max']);
  if(!Number.isFinite(min)||min<=0)min=1;if(!Number.isFinite(max)||max<=0)max=100000000;
  a.min=min;a.max=max;a.placeholder=`₹${money(min)} - ₹${money(max)}`;
  document.querySelectorAll('.method').forEach(x=>x.classList.remove('selected'));
  const active=$('method-'+method);if(active)active.classList.add('selected');
}
function renderContacts(){const c=$('contacts');if(!c)return;let html='';if(cfg.whatsapp)html+=`<a class="primary-btn" href="${esc(cfg.whatsapp)}" target="_blank" rel="noopener">WhatsApp</a>`;if(cfg.telegram)html+=`<a class="primary-btn" href="${esc(cfg.telegram)}" target="_blank" rel="noopener">Telegram</a>`;c.innerHTML=html||'<p class="muted">Support contacts are not configured yet.</p>';}
async function loadPublicSettings(){
  try{const r=await fetch('/api/public?nocache='+Date.now(),{cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Unable to load payment settings.');cfg=d.settings||{};renderDropdown();renderPaymentMethods();renderContacts();selectMethod('upi');}
  catch(e){console.error(e);if($('methods'))$('methods').innerHTML='<div class="error">Payment methods could not be loaded. Please refresh the page.</div>';renderDropdown();selectMethod('upi');}
}
async function submitPayment(event){
 event.preventDefault();const form=event.target,result=$('result'),button=form.querySelector('button[type="submit"]');if(result)result.innerHTML='';if(button){button.disabled=true;button.textContent='Submitting...';}
 try{const r=await fetch('/api/payment',{method:'POST',body:new FormData(form)});const d=await r.json();if(!r.ok)throw new Error(d.error||'Payment submission failed.');result.innerHTML=`<div class="success"><b>Payment Submitted Successfully</b><br><br>Reference Code: <strong>${esc(d.code)}</strong><br><br>Status: <strong>Pending</strong><br><br>Please save your reference code.</div>`;form.reset();selectMethod('upi');}
 catch(e){result.innerHTML=`<div class="error">${esc(e.message)}</div>`;}
 finally{if(button){button.disabled=false;button.textContent='Submit Payment →';}}
}
async function checkStatus(){
 const input=$('codeSearch'),result=$('statusResult');if(!input||!result)return;const code=input.value.trim().toUpperCase();if(!code){result.innerHTML='<div class="error">Please enter your reference code.</div>';return;}result.innerHTML='<p class="muted">Checking...</p>';
 try{const r=await fetch('/api/status/'+encodeURIComponent(code)+'?nocache='+Date.now(),{cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Transaction not found.');result.innerHTML=`<div class="status"><h3>${esc(d.code)}</h3><span class="pill ${esc(d.status)}">${esc(d.status)}</span><p><b>Payment Method:</b> ${esc(methodNames[d.payment_method]||d.payment_method||'-')}</p><p><b>Amount:</b> ₹${money(d.amount)}</p>${d.created_at_ist?`<p><b>Submitted:</b> ${esc(d.created_at_ist)}</p>`:''}${d.updated_at_ist?`<p><b>Last Updated:</b> ${esc(d.updated_at_ist)}</p>`:''}${d.status==='rejected'&&d.rejection_reason?`<p><b>Rejection Reason:</b> ${esc(d.rejection_reason)}</p>`:''}</div>`;}
 catch(e){result.innerHTML=`<div class="error">${esc(e.message)}</div>`;}
}
document.addEventListener('DOMContentLoaded',()=>{const f=$('paymentForm');if(f)f.addEventListener('submit',submitPayment);const s=$('payment_method');if(s)s.addEventListener('change',()=>selectMethod(s.value));loadPublicSettings();});
