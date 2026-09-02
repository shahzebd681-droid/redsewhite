const state = { customers: [], transactions: [], txFilter: 'all' };

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function api(url, options = {}) {
  const r = await fetch(url, { credentials: 'same-origin', ...options });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

function showMessage(text, type='success') {
  const el = $('customerMessage');
  if (!el) return;
  el.textContent = text;
  el.className = `inline-message ${type}`;
  clearTimeout(showMessage.timer);
  showMessage.timer = setTimeout(() => { el.textContent=''; el.className='inline-message'; }, 5000);
}

function fmtDate(value) {
  if (!value) return '—';
  try { return new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'}).format(new Date(value)); }
  catch { return value; }
}

function customerStatus(c) {
  return String(c.status || 'active').toLowerCase() === 'active'
    ? '<span class="status-pill active">Active</span>'
    : '<span class="status-pill blocked">Blocked</span>';
}

function renderCustomers() {
  const q = ($('customerSearch')?.value || '').trim().toLowerCase();
  const list = state.customers.filter(c =>
    !q || String(c.client_name).toLowerCase().includes(q) || String(c.user_id).toLowerCase().includes(q)
  );
  const box = $('customers');
  if (!list.length) {
    box.innerHTML = `<div class="empty-state"><div class="empty-icon">♙</div><strong>No customers found</strong><p>Create your first customer account to provide dashboard access.</p></div>`;
    return;
  }
  box.innerHTML = list.map(c => `
    <article class="customer-card">
      <div class="customer-main">
        <div class="customer-avatar">${esc(String(c.client_name || '?').trim().charAt(0).toUpperCase())}</div>
        <div class="customer-identity">
          <h3>${esc(c.client_name)}</h3>
          <div class="customer-id">User ID: <b>${esc(c.user_id)}</b></div>
          <div class="customer-contact">${c.whatsapp_number ? `WhatsApp: ${esc(c.whatsapp_number)}` : ''}${c.whatsapp_number && c.telegram_id ? ' · ' : ''}${c.telegram_id ? `Telegram: ${esc(c.telegram_id)}` : ''}</div>
        </div>
      </div>
      <div class="customer-meta">
        <div>${customerStatus(c)} ${c.temporary_password ? '<span class="status-pill temporary">Password Reset Required</span>' : ''}</div>
        <small>Created ${esc(fmtDate(c.created_at))}</small>
      </div>
      <div class="customer-actions">
        <button class="ghost-btn small" data-action="view" data-id="${c.id}">View</button>
        <button class="ghost-btn small" data-action="reset" data-id="${c.id}">Reset Password</button>
        <button class="ghost-btn small" data-action="toggle" data-id="${c.id}">${String(c.status).toLowerCase()==='active'?'Block':'Activate'}</button>
        <button class="danger-btn small" data-action="delete" data-id="${c.id}">Delete</button>
      </div>
    </article>`).join('');
}

async function loadCustomers() {
  $('customers').innerHTML = '<div class="loading-state">Loading customers…</div>';
  try {
    state.customers = await api('/api/admin/customers');
    renderCustomers();
  } catch (e) {
    $('customers').innerHTML = `<div class="empty-state error"><strong>Could not load customers</strong><p>${esc(e.message)}</p></div>`;
  }
}

async function createCustomer(e) {
  e.preventDefault();
  const err = $('createCustomerError');
  err.textContent = '';
  const payload = {
    client_name: $('cClientName').value.trim(),
    user_id: $('cUserId').value.trim(),
    temporary_password: $('cPassword').value,
    whatsapp_number: $('cWhatsapp').value.trim(),
    telegram_id: $('cTelegram').value.trim()
  };
  if (!payload.whatsapp_number && !payload.telegram_id) {
    err.textContent = 'Please provide at least WhatsApp or Telegram.';
    return;
  }
  const btn = e.submitter;
  btn.disabled = true;
  try {
    const data = await api('/api/admin/customers', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
    });
    $('customerModal').hidden = true;
    state.customers.unshift(data.customer);
    renderCustomers();
    showMessage(`Customer ${data.customer.user_id} created successfully. Share the temporary password securely.`);
  } catch (e) {
    err.textContent = e.message;
  } finally { btn.disabled = false; }
}

function randomPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  for (const b of bytes) out += chars[b % chars.length];
  $('cPassword').value = out;
  $('cPassword').type = 'text';
}

async function viewCustomer(id) {
  try {
    const c = await api(`/api/admin/customers/${id}`);
    $('detailName').textContent = c.client_name;
    $('detailBody').innerHTML = `
      <div class="detail-grid">
        <div><span>Client Name</span><b>${esc(c.client_name)}</b></div>
        <div><span>User ID</span><b>${esc(c.user_id)}</b></div>
        <div><span>Status</span><b>${c.status==='active'?'Active':'Blocked'}</b></div>
        <div><span>Password</span><b>${c.temporary_password?'Temporary / Reset Required':'Permanent'}</b></div>
        <div><span>WhatsApp</span><b>${esc(c.whatsapp_number)||'—'}</b></div>
        <div><span>Telegram</span><b>${esc(c.telegram_id)||'—'}</b></div>
        <div><span>Created</span><b>${esc(fmtDate(c.created_at))}</b></div>
        <div><span>Last Login</span><b>${esc(fmtDate(c.last_login_at))}</b></div>
      </div>
      <div class="detail-warning">For security, stored passwords are never displayed. Reset the password to issue a new temporary password.</div>`;
    $('detailModal').hidden = false;
  } catch(e) { showMessage(e.message,'error'); }
}

async function resetPassword(id) {
  const c = state.customers.find(x => Number(x.id) === Number(id));
  if (!c) return;
  const p = prompt(`Enter a new temporary password for ${c.user_id}.\nMinimum 8 characters:`);
  if (p === null) return;
  if (p.length < 8) { alert('Temporary Password must be at least 8 characters.'); return; }
  if (!confirm(`Reset password for ${c.user_id}?\nThe customer will be required to change it on next login.`)) return;
  try {
    await api(`/api/admin/customers/${id}/reset-password`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({temporary_password:p})
    });
    c.temporary_password = true;
    renderCustomers();
    showMessage(`Password reset for ${c.user_id}. Share the new temporary password securely.`);
  } catch(e) { showMessage(e.message,'error'); }
}

async function toggleCustomer(id) {
  const c = state.customers.find(x => Number(x.id) === Number(id));
  if (!c) return;
  const active = String(c.status).toLowerCase() === 'active';
  const next = active ? 'blocked' : 'active';
  if (!confirm(`${active ? 'Block' : 'Activate'} customer ${c.user_id}?`)) return;
  try {
    const data = await api(`/api/admin/customers/${id}/status`, {
      method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({status:next})
    });
    Object.assign(c, data.customer);
    renderCustomers();
    showMessage(`${c.user_id} is now ${next}.`);
  } catch(e) { showMessage(e.message,'error'); }
}

async function deleteCustomer(id) {
  const c = state.customers.find(x => Number(x.id) === Number(id));
  if (!c) return;
  if (!confirm(`Delete customer ${c.user_id} permanently?\nThis action cannot be undone.`)) return;
  if (!confirm(`Final confirmation: permanently delete ${c.client_name} (${c.user_id})?`)) return;
  try {
    await api(`/api/admin/customers/${id}`, { method:'DELETE' });
    state.customers = state.customers.filter(x => Number(x.id) !== Number(id));
    renderCustomers();
    showMessage(`${c.user_id} was deleted.`);
  } catch(e) { showMessage(e.message,'error'); }
}

function renderTransactions() {
  const list = state.transactions.filter(t => state.txFilter === 'all' || t.status === state.txFilter);
  const box = $('txs');
  $('totalStat').textContent = state.transactions.length;
  $('pendingStat').textContent = state.transactions.filter(t=>t.status==='pending').length;
  $('confirmedStat').textContent = state.transactions.filter(t=>t.status==='confirmed').length;
  $('rejectedStat').textContent = state.transactions.filter(t=>t.status==='rejected').length;

  if (!list.length) { box.innerHTML='<div class="empty-state"><strong>No transactions</strong><p>No transactions match this filter.</p></div>'; return; }
  box.innerHTML = list.map(t => `
    <article class="tx-card">
      <div><b>${esc(t.code)}</b><small>${esc(fmtDate(t.created_at))}</small></div>
      <div><strong>₹${esc(t.amount)}</strong><small>${esc(t.payment_method || '')}</small></div>
      <div><span class="status-pill ${esc(t.status)}">${esc(t.status)}</span><small>UTR: ${esc(t.utr)}</small></div>
      <div class="tx-actions">
        ${t.screenshot ? `<a class="ghost-btn small" href="/api/admin/transactions/${t.id}/screenshot" target="_blank">Screenshot</a>` : ''}
        ${t.status !== 'confirmed' ? `<button class="primary-btn small" data-tx-action="confirm" data-id="${t.id}">Confirm</button>`:''}
        ${t.status !== 'rejected' ? `<button class="danger-btn small" data-tx-action="reject" data-id="${t.id}">Reject</button>`:''}
      </div>
      ${t.rejection_reason ? `<div class="rejection-note">Reason: ${esc(t.rejection_reason)}</div>`:''}
    </article>`).join('');
}

async function loadTxs() {
  $('txs').innerHTML='Loading…';
  try { state.transactions = await api('/api/admin/transactions'); renderTransactions(); }
  catch(e) { $('txs').innerHTML=`<div class="empty-state error"><strong>Could not load transactions</strong><p>${esc(e.message)}</p></div>`; }
}

async function updateTx(id, status) {
  let reason = '';
  if (status === 'rejected') {
    reason = prompt('Enter the rejection reason (required):') || '';
    if (!reason.trim()) return;
  }
  try {
    await api(`/api/admin/transactions/${id}`, {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({status,rejection_reason:reason.trim()})
    });
    await loadTxs();
  } catch(e) { alert(e.message); }
}

async function loadSettings() {
  try {
    const {settings:s} = await api('/api/public');
    $('telegram').value=s.telegram||'';
    $('whatsapp').value=s.whatsapp||'';
    const methods = [
      ['upi','UPI Payment','UPI ID','upi_id','upi_holder','upi_min','upi_max','upi_message'],
      ['qr_a','QR A','QR Holder','qr_a','qr_a_holder','qr_a_min','qr_a_max','qr_a_message'],
      ['qr_b','QR B','QR Holder','qr_b','qr_b_holder','qr_b_min','qr_b_max','qr_b_message'],
      ['qr_c','QR C','QR Holder','qr_c','qr_c_holder','qr_c_min','qr_c_max','qr_c_message'],
      ['bank','Bank Transfer','Account Holder','bank_account','bank_holder','bank_min','bank_max','bank_message']
    ];
    $('settingsCards').innerHTML=methods.map(m=>`
      <div class="setting-card">
        <div class="setting-number">${m[0].toUpperCase()}</div><h3>${m[1]}</h3>
        <label>${m[2]}<input data-setting="${m[3]}" value="${esc(s[m[3]]||'')}"></label>
        <label>Holder / Name<input data-setting="${m[4]}" value="${esc(s[m[4]]||'')}"></label>
        <div class="two-input"><label>Min<input data-setting="${m[5]}" value="${esc(s[m[5]]||'100')}"></label><label>Max<input data-setting="${m[6]}" value="${esc(s[m[6]]||'100000')}"></label></div>
        <label>Instructions<textarea data-setting="${m[7]}">${esc(s[m[7]]||'')}</textarea></label>
        ${m[0].startsWith('qr_')?`<div class="qr-upload"><img src="${esc(s[m[0]+'_url']||'')}" onerror="this.style.display='none'"><input type="file" accept="image/png,image/jpeg,image/webp" data-qr="${m[0]}"><button class="ghost-btn small" data-upload-qr="${m[0]}" type="button">Upload QR</button></div>`:''}
      </div>`).join('');
    document.querySelectorAll('[data-setting]').forEach(el=>el.dataset.original=el.value);
  } catch(e) { console.error(e); }
}

async function saveSettings(payload) {
  await api('/api/admin/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
}

async function initAdmin() {
  await Promise.all([loadCustomers(),loadSettings(),loadTxs()]);
}

$('customerForm')?.addEventListener('submit', createCustomer);
$('generatePassword')?.addEventListener('click', randomPassword);
$('refreshCustomers')?.addEventListener('click', loadCustomers);
$('customerSearch')?.addEventListener('input', renderCustomers);
$('customers')?.addEventListener('click', e => {
  const b=e.target.closest('button[data-action]'); if(!b)return;
  const id=b.dataset.id;
  if(b.dataset.action==='view')viewCustomer(id);
  if(b.dataset.action==='reset')resetPassword(id);
  if(b.dataset.action==='toggle')toggleCustomer(id);
  if(b.dataset.action==='delete')deleteCustomer(id);
});
$('customers')?.addEventListener('click', e => {
  const b=e.target.closest('button[data-action]'); if(!b)return;
});
$('refreshTx')?.addEventListener('click',loadTxs);
document.querySelectorAll('.filter').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.filter').forEach(x=>x.classList.remove('active'));
  b.classList.add('active'); state.txFilter=b.dataset.filter; renderTransactions();
}));
$('txs')?.addEventListener('click',e=>{
  const b=e.target.closest('[data-tx-action]'); if(!b)return;
  updateTx(b.dataset.id,b.dataset.txAction==='confirm'?'confirmed':'rejected');
});
$('saveContacts')?.addEventListener('click',async()=>{
  try { await saveSettings({telegram:$('telegram').value.trim(),whatsapp:$('whatsapp').value.trim()}); showMessage('Contact settings saved.'); }
  catch(e){showMessage(e.message,'error');}
});
$('settingsCards')?.addEventListener('click',async e=>{
  const b=e.target.closest('[data-upload-qr]'); if(b){
    const method=b.dataset.uploadQr, file=document.querySelector(`[data-qr="${method}"]`)?.files?.[0];
    if(!file){alert('Please select a QR image first.');return;}
    const fd=new FormData();fd.append('qr',file);
    try{await api(`/api/admin/payment-settings/${method}/qr`,{method:'POST',body:fd});await loadSettings();showMessage(`${method.toUpperCase()} QR updated.`);}
    catch(err){alert(err.message);}
  }
});
$('settingsCards')?.addEventListener('change',async e=>{
  const el=e.target.closest('[data-setting]'); if(!el)return;
  const payload={}; document.querySelectorAll('[data-setting]').forEach(x=>payload[x.dataset.setting]=x.value);
  try{await saveSettings(payload);showMessage('Payment settings saved.');}
  catch(err){alert(err.message);await loadSettings();}
});
$('logout')?.addEventListener('click',async()=>{
  try{await api('/api/logout',{method:'POST'});}finally{location.href='/admin';}
});

(async()=>{
  try{
    const m=await api('/api/me');
    if(m.authenticated){$('login').hidden=true;$('panel').hidden=false;await initAdmin();}
  }catch(_){}
})();
