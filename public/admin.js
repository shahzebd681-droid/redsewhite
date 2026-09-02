const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const money = v => Number(v || 0).toLocaleString('en-IN');

let settings = {};
let allTransactions = [];
let activeFilter = 'all';

const methods = {
  upi: ['UPI Payment', [
    ['upi_id','UPI ID'],
    ['upi_holder','Account Holder Name'],
    ['upi_min','Minimum Amount'],
    ['upi_max','Maximum Amount'],
    ['upi_message','Payment Instructions']
  ]],
  qr_a: ['QR Payment A', [
    ['qr_a_holder','Account Holder Name A'],
    ['qr_a_min','Minimum Amount'],
    ['qr_a_max','Maximum Amount'],
    ['qr_a_message','Payment Instructions']
  ]],
  qr_b: ['QR Payment B', [
    ['qr_b_holder','Account Holder Name B'],
    ['qr_b_min','Minimum Amount'],
    ['qr_b_max','Maximum Amount'],
    ['qr_b_message','Payment Instructions']
  ]],
  qr_c: ['QR Payment C', [
    ['qr_c_holder','Account Holder Name C'],
    ['qr_c_min','Minimum Amount'],
    ['qr_c_max','Maximum Amount'],
    ['qr_c_message','Payment Instructions']
  ]],
  bank: ['Bank Transfer', [
    ['bank_holder','Bank Holder Name'],
    ['bank_name','Bank Name'],
    ['bank_account','Account Number'],
    ['bank_ifsc','IFSC Code'],
    ['bank_min','Minimum Amount'],
    ['bank_max','Maximum Amount'],
    ['bank_message','Payment Instructions']
  ]]
};

const labels = {
  upi:'UPI Payment', qr_a:'QR Payment A', qr_b:'QR Payment B', qr_c:'QR Payment C', bank:'Bank Transfer'
};

async function api(url, options = {}) {
  const isForm = options.body instanceof FormData;
  const headers = isForm ? (options.headers || {}) : {
    'Content-Type':'application/json',
    ...(options.headers || {})
  };
  const response = await fetch(url, { ...options, headers, credentials:'same-origin' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function showPanel() {
  $('login').hidden = true;
  $('panel').hidden = false;
  loadSettings();
  loadTxs();
}

async function loadSettings() {
  try {
    settings = (await api('/api/public')).settings || {};
    buildCards();
    $('telegram').value = settings.telegram || '';
    $('whatsapp').value = settings.whatsapp || '';
  } catch (error) {
    console.error(error);
    toast(error.message, true);
  }
}

function buildCards() {
  let html = '';
  for (const [method, config] of Object.entries(methods)) {
    const fields = config[1].map(([key, label]) => {
      const type = key.includes('_min') || key.includes('_max') ? 'number' : 'text';
      const value = esc(settings[key] || '');
      return `<label>${label}<input id="${key}" type="${type}" value="${value}" autocomplete="off"></label>`;
    }).join('');

    const upload = method.startsWith('qr_') ? `
      <label>QR Code Image
        <input id="${method}_file" type="file" accept="image/png,image/jpeg,image/webp,image/gif">
      </label>` : '';

    html += `
      <div class="admin-method" id="card_${method}">
        <div class="method-top"><div class="method-number">${method === 'upi' ? '01' : method === 'qr_a' ? '02' : method === 'qr_b' ? '03' : method === 'qr_c' ? '04' : '05'}</div><div><h3>${config[0]}</h3><p>Manage ${config[0].toLowerCase()} details</p></div></div>
        ${fields}
        ${upload}
        <div class="method-actions"><button class="primary-btn compact-btn" type="button" onclick="saveMethod('${method}')">Save ${config[0]}</button><span id="save_${method}" class="save-note"></span></div>
      </div>`;
  }
  $('settingsCards').innerHTML = html;
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
        const form = new FormData();
        form.append('qr', file);
        await api(`/api/admin/payment-settings/${method}/qr`, { method:'POST', body:form });
      }
    }
    note.textContent = 'Saved ✓';
    note.classList.add('success');
    setTimeout(() => note.textContent = '', 2500);
    await loadSettings();
  } catch (error) {
    note.textContent = error.message;
    note.classList.add('error');
    setTimeout(() => note.textContent = '', 4000);
  }
}

async function saveContacts() {
  try {
    await api('/api/admin/settings', {
      method:'PUT',
      body:JSON.stringify({ telegram:$('telegram').value.trim(), whatsapp:$('whatsapp').value.trim() })
    });
    toast('Contact settings saved.');
  } catch (error) {
    toast(error.message, true);
  }
}

function updateStats() {
  const counts = { pending:0, confirmed:0, rejected:0 };
  allTransactions.forEach(t => { if (counts[t.status] !== undefined) counts[t.status]++; });
  $('totalStat').textContent = allTransactions.length;
  $('pendingStat').textContent = counts.pending;
  $('confirmedStat').textContent = counts.confirmed;
  $('rejectedStat').textContent = counts.rejected;
}

function renderTransactions() {
  const transactions = activeFilter === 'all' ? allTransactions : allTransactions.filter(t => t.status === activeFilter);
  if (!transactions.length) {
    $('txs').innerHTML = `<div class="empty-state"><strong>No transactions found</strong><span>There are no ${activeFilter === 'all' ? '' : activeFilter + ' '}transactions yet.</span></div>`;
    return;
  }

  $('txs').innerHTML = transactions.map(t => `
    <article class="transaction-card">
      <div class="tx-head"><div><span class="tx-ref">${esc(t.code)}</span><span class="pill ${esc(t.status)}">${esc(t.status)}</span></div><strong>₹${money(t.amount)}</strong></div>
      <div class="tx-grid">
        <div><small>Payment Method</small><b>${esc(labels[t.payment_method] || t.payment_method || 'UPI Payment')}</b></div>
        <div><small>UTR / Transaction ID</small><b>${esc(t.utr)}</b></div>
        <div><small>Submitted</small><b>${esc(t.created_at_ist || t.created_at || '')}</b></div>
        <div><small>Updated</small><b>${esc(t.updated_at_ist || t.updated_at || '')}</b></div>
      </div>
      ${t.rejection_reason ? `<div class="rejection-note">Rejection reason: ${esc(t.rejection_reason)}</div>` : ''}
      <div class="tx-actions"><a class="ghost-btn" href="/api/admin/transactions/${t.id}/screenshot" target="_blank" rel="noopener">View Screenshot</a><button class="ghost-btn" onclick="setStatus(${t.id},'pending')">Pending</button><button class="primary-btn small-btn" onclick="setStatus(${t.id},'confirmed')">Confirm</button><button class="danger-btn" onclick="setStatus(${t.id},'rejected')">Reject</button></div>
    </article>`).join('');
}

async function loadTxs() {
  try {
    allTransactions = await api('/api/admin/transactions');
    updateStats();
    renderTransactions();
  } catch (error) {
    $('txs').innerHTML = `<div class="empty-state error-state">${esc(error.message)}</div>`;
  }
}

async function setStatus(id, status) {
  let reason = '';
  if (status === 'rejected') {
    reason = prompt('Rejection reason:') || '';
  }
  try {
    await api('/api/admin/transactions/' + id, {
      method:'PUT',
      body:JSON.stringify({ status, rejection_reason:reason })
    });
    await loadTxs();
    toast('Transaction updated.');
  } catch (error) {
    toast(error.message, true);
  }
}

function toast(message, error = false) {
  let box = $('adminToast');
  if (!box) {
    box = document.createElement('div');
    box.id = 'adminToast';
    box.className = 'admin-toast';
    document.body.appendChild(box);
  }
  box.textContent = message;
  box.classList.toggle('error', error);
  box.classList.add('show');
  clearTimeout(box._timer);
  box._timer = setTimeout(() => box.classList.remove('show'), 2800);
}

async function checkSession() {
  try {
    const me = await api('/api/me');
    if (me.authenticated) showPanel();
  } catch (_) {}
}

// Login is handled inline in admin.html so an admin.js caching/loading issue
// can never cause the form to silently reload.

$('logout')?.addEventListener('click', async () => {
  try { await api('/api/logout', { method:'POST' }); } finally { location.reload(); }
});
$('saveContacts')?.addEventListener('click', saveContacts);
$('refreshTx')?.addEventListener('click', loadTxs);

document.querySelectorAll('.filter').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.filter').forEach(b => b.classList.remove('active'));
    button.classList.add('active');
    activeFilter = button.dataset.filter || 'all';
    renderTransactions();
  });
});

checkSession();
