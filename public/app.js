let cfg = {};
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const money = v => Number(v || 0).toLocaleString('en-IN');
const labels = { upi:'UPI Payment', qr_a:'QR Payment A', qr_b:'QR Payment B', qr_c:'QR Payment C', bank:'Bank Transfer' };

function render() {
  const methods = [
    ['upi','UPI ID',cfg.upi_id,'Account Holder',cfg.upi_holder],
    ['qr_a','QR Payment A','QR','Account Holder',cfg.qr_a_holder],
    ['qr_b','QR Payment B','QR','Account Holder',cfg.qr_b_holder],
    ['qr_c','QR Payment C','QR','Account Holder',cfg.qr_c_holder],
    ['bank','Bank Transfer',cfg.bank_name,'Account Holder',cfg.bank_holder]
  ];

  $('methods').innerHTML = methods.map(x => {
    const qr = x[0].startsWith('qr_') && cfg[x[0] + '_url']
      ? `<img class="qr" src="${esc(cfg[x[0] + '_url'])}" alt="${esc(x[1])}">`
      : '';
    const bank = x[0] === 'bank'
      ? `<p><b>Account:</b> ${esc(cfg.bank_account || 'Not configured')}<br><b>IFSC:</b> ${esc(cfg.bank_ifsc || 'Not configured')}</p>`
      : '';
    return `<div class="method">
      <h3>${x[0] === 'upi' ? '💳' : x[0] === 'bank' ? '🏦' : '▣'} ${x[1]}</h3>
      <p>${x[2] === 'QR' ? 'Scan the QR code below.' : esc(x[2] || 'Not configured')}</p>
      <p><b>${esc(x[3])}:</b> ${esc(x[4] || 'Not configured')}</p>
      ${bank}${qr}
      <p class="limits">₹${money(cfg[x[0] + '_min'])} — ₹${money(cfg[x[0] + '_max'])}</p>
      <p>${esc(cfg[x[0] + '_message'] || '')}</p>
      <button type="button" onclick="selectMethod('${x[0]}')">Use ${x[1]}</button>
    </div>`;
  }).join('');

  $('payment_method').innerHTML = Object.keys(labels)
    .map(k => `<option value="${k}">${labels[k]}</option>`).join('');
  selectMethod('upi');

  const contacts = `${cfg.whatsapp ? `<a class="btn" href="${esc(cfg.whatsapp)}" target="_blank">WhatsApp</a>` : ''} ${cfg.telegram ? `<a class="btn" href="${esc(cfg.telegram)}" target="_blank">Telegram</a>` : ''}`;
  $('contacts').innerHTML = contacts || 'Support contacts are not configured yet.';
}

function selectMethod(m) {
  $('payment_method').value = m;
  const min = Number(cfg[m + '_min'] || 1);
  const max = Number(cfg[m + '_max'] || 100000000);
  $('amount').min = min;
  $('amount').max = max;
  $('amount').placeholder = `₹${money(min)} - ₹${money(max)}`;
}

$('paymentForm').onsubmit = async e => {
  e.preventDefault();
  $('result').innerHTML = '';
  try {
    const r = await fetch('/api/payment', { method:'POST', body:new FormData(e.target) });
    const j = await r.json();
    if (!r.ok) throw Error(j.error);
    $('result').innerHTML = `<div class="success">Submitted successfully.<br><b>Reference Code: ${esc(j.code)}</b><br>Submitted: ${esc(j.submitted_at_ist)} IST<br>Save your reference code to check status.</div>`;
    e.target.reset();
    selectMethod('upi');
  } catch (e) {
    $('result').innerHTML = `<div class="error">${esc(e.message)}</div>`;
  }
};

async function checkStatus() {
  const c = $('codeSearch').value.trim().toUpperCase();
  if (!c) return;
  $('statusResult').innerHTML = 'Checking…';
  try {
    const r = await fetch('/api/status/' + encodeURIComponent(c));
    const j = await r.json();
    if (!r.ok) throw Error(j.error);
    $('statusResult').innerHTML = `<div class="status"><h3>${esc(j.code)}</h3><span class="pill ${esc(j.status)}">${esc(j.status)}</span><p><b>Payment Method:</b> ${esc(labels[j.payment_method] || j.payment_method)}<br><b>Amount:</b> ₹${money(j.amount)}<br><b>Submitted:</b> ${esc(j.created_at_ist)} IST<br><b>Last Updated:</b> ${esc(j.updated_at_ist)} IST</p>${j.status === 'rejected' && j.rejection_reason ? `<p><b>Reason:</b> ${esc(j.rejection_reason)}</p>` : ''}</div>`;
  } catch (e) {
    $('statusResult').innerHTML = `<div class="error">${esc(e.message)}</div>`;
  }
}

fetch('/api/public')
  .then(r => r.json())
  .then(j => { cfg = j.settings || {}; render(); })
  .catch(() => { $('methods').innerHTML = '<div class="error">Could not load payment settings.</div>'; });
