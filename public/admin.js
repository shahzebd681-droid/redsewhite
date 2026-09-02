const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const money = value => Number(value || 0).toLocaleString('en-IN');

let settings = {};
const methods = {
  upi: ['UPI Payment', [
    ['upi_id','UPI ID'], ['upi_holder','UPI Account Holder Name'],
    ['upi_min','Minimum Amount'], ['upi_max','Maximum Amount'], ['upi_message','Payment Instructions']
  ]],
  qr_a: ['QR Payment A', [
    ['qr_a_holder','Account Holder Name A'], ['qr_a_min','Minimum Amount'],
    ['qr_a_max','Maximum Amount'], ['qr_a_message','Payment Instructions']
  ]],
  qr_b: ['QR Payment B', [
    ['qr_b_holder','Account Holder Name B'], ['qr_b_min','Minimum Amount'],
    ['qr_b_max','Maximum Amount'], ['qr_b_message','Payment Instructions']
  ]],
  qr_c: ['QR Payment C', [
    ['qr_c_holder','Account Holder Name C'], ['qr_c_min','Minimum Amount'],
    ['qr_c_max','Maximum Amount'], ['qr_c_message','Payment Instructions']
  ]],
  bank: ['Bank Transfer', [
    ['bank_holder','Bank Holder Name'], ['bank_name','Bank Name'], ['bank_account','Account Number'],
    ['bank_ifsc','IFSC Code'], ['bank_min','Minimum Amount'], ['bank_max','Maximum Amount'], ['bank_message','Payment Instructions']
  ]]
};
const labels = { upi:'UPI Payment', qr_a:'QR Payment A', qr_b:'QR Payment B', qr_c:'QR Payment C', bank:'Bank Transfer' };

async function api(url, options = {}) {
  const config = { ...options, credentials: 'include' };
  if (!(options.body instanceof FormData)) {
    config.headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  }
  const response = await fetch(url, config);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function showDashboard() {
  const login = $('login');
  const panel = $('panel');
  if (login) {
    login.hidden = true;
    login.style.display = 'none';
    login.removeAttribute('aria-hidden');
  }
  if (panel) {
    panel.hidden = false;
    panel.style.display = 'block';
  }
  loadSettings();
  loadTxs();
}

function showLogin() {
  const login = $('login');
  const panel = $('panel');
  if (login) { login.hidden = false; login.style.display = ''; }
  if (panel) { panel.hidden = true; panel.style.display = 'none'; }
}

async function boot() {
  try {
    const me = await api('/api/me');
    if (me.authenticated) showDashboard();
    else showLogin();
  } catch (e) {
    showLogin();
  }
}

$('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter || document.querySelector('#loginForm button');
  if (button) { button.disabled = true; button.textContent = 'Logging in...'; }
  try {
    await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: $('username').value.trim(), password: $('password').value })
    });
    showDashboard();
    window.scrollTo({ top: 0, behavior: 'instant' });
  } catch (e) {
    alert(e.message);
    if (button) { button.disabled = false; button.textContent = 'Login'; }
  }
});

$('logout').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch (e) {}
  showLogin();
  window.scrollTo({ top: 0, behavior: 'instant' });
});

function buildCards() {
  const container = $('settingsCards');
  let html = '';
  for (const [method, data] of Object.entries(methods)) {
    html += `<div class="admin-method" id="card_${method}"><div class="method-head"><h3>${esc(data[0])}</h3><span class="method-tag">${method.toUpperCase()}</span></div>`;
    for (const [key, label] of data[1]) {
      const type = key.includes('_min') || key.includes('_max') ? 'number' : 'text';
      const isMessage = key.includes('_message');
      html += `<label>${esc(label)}${isMessage ? `<textarea id="${esc(key)}" rows="3" placeholder="Payment instructions">${esc(settings[key] || '')}</textarea>` : `<input id="${esc(key)}" type="${type}" value="${esc(settings[key] || '')}">`}</label>`;
    }
    if (method.startsWith('qr_')) {
      html += `<label>Upload ${esc(data[0])} QR<input id="${method}_file" type="file" accept="image/png,image/jpeg,image/webp"></label>`;
      if (settings[method]) html += `<div class="qr-preview"><img src="${esc(settings[method])}" alt="${esc(data[0])} QR"></div>`;
    }
    html += `<div class="save-row"><button class="btn" type="button" onclick="saveMethod('${method}')">Save ${esc(data[0])}</button><span id="save_${method}" class="save-note"></span></div></div>`;
  }
  container.innerHTML = html;
}

async function loadSettings() {
  try {
    settings = (await api('/api/public')).settings || {};
    buildCards();
    $('telegram').value = settings.telegram || '';
    $('whatsapp').value = settings.whatsapp || '';
  } catch (e) { console.error(e); }
}

async function saveMethod(method) {
  const body = {};
  for (const [key] of methods[method][1]) body[key] = $(key).value;
  const note = $('save_' + method);
  try {
    await api('/api/admin/settings', { method:'PUT', body:JSON.stringify(body) });
    if (method.startsWith('qr_')) {
      const file = $(`${method}_file`).files[0];
      if (file) {
        const fd = new FormData(); fd.append('qr', file);
        await api(`/api/admin/payment-settings/${method}/qr`, { method:'POST', body:fd });
      }
    }
    note.textContent = 'Saved ✓';
    await loadSettings();
    setTimeout(() => { note.textContent = ''; }, 2500);
  } catch (e) { alert(e.message); }
}
window.saveMethod = saveMethod;

$('saveContacts').addEventListener('click', async () => {
  try {
    await api('/api/admin/settings', { method:'PUT', body:JSON.stringify({ telegram:$('telegram').value, whatsapp:$('whatsapp').value }) });
    alert('Contacts saved.');
  } catch (e) { alert(e.message); }
});

async function loadTxs() {
  try {
    const txs = await api('/api/admin/transactions');
    const count = {pending:0, confirmed:0, rejected:0};
    txs.forEach(t => count[t.status] = (count[t.status] || 0) + 1);
    $('totalStat').textContent = txs.length;
    $('pendingStat').textContent = count.pending;
    $('confirmedStat').textContent = count.confirmed;
    $('rejectedStat').textContent = count.rejected;
    if (!txs.length) { $('txs').innerHTML = '<div class="empty">No transactions yet.</div>'; return; }
    $('txs').innerHTML = `<div class="tablewrap"><table><thead><tr><th>Reference</th><th>Method</th><th>Amount</th><th>UTR</th><th>Status</th><th>Submitted</th><th>Action</th></tr></thead><tbody>${txs.map(t => `<tr><td><b>${esc(t.code)}</b></td><td>${esc(labels[t.payment_method] || t.payment_method || 'UPI Payment')}</td><td>₹${money(t.amount)}</td><td>${esc(t.utr)}</td><td><span class="pill ${esc(t.status)}">${esc(t.status)}</span>${t.rejection_reason ? `<div class="reason">${esc(t.rejection_reason)}</div>` : ''}</td><td>${esc(t.created_at_ist || t.created_at || '')}</td><td><a class="action-link" href="/api/admin/transactions/${t.id}/screenshot" target="_blank">Screenshot</a><div class="action-buttons"><button onclick="setStatus(${t.id},'pending')">Pending</button><button onclick="setStatus(${t.id},'confirmed')">Confirm</button><button onclick="setStatus(${t.id},'rejected')">Reject</button></div></td></tr>`).join('')}</tbody></table></div>`;
  } catch (e) { $('txs').textContent = e.message; }
}
window.loadTxs = loadTxs;

async function setStatus(id, status) {
  let reason = '';
  if (status === 'rejected') reason = prompt('Rejection reason:') || '';
  try {
    await api('/api/admin/transactions/' + id, { method:'PUT', body:JSON.stringify({status, rejection_reason:reason}) });
    await loadTxs();
  } catch (e) { alert(e.message); }
}
window.setStatus = setStatus;
$('refreshTx').addEventListener('click', loadTxs);

boot();
