const API_BASE='https://redsewhite.onrender.com';
let settings={};
const $=id=>document.getElementById(id);
const api=(path,options={})=>fetch(API_BASE+path,{...options,credentials:'include'});
function show(id){$(id).classList.remove('hidden');$(id).setAttribute('aria-hidden','false')}
function hide(id){$(id).classList.add('hidden');$(id).setAttribute('aria-hidden','true')}
function resultBox(id,type,msg){$(id).innerHTML=`<div class="${type}">${msg}</div>`}
async function loadSettings(){
  try{
    const r=await fetch(API_BASE+'/api/public?nocache='+Date.now(),{cache:'no-store'});
    const d=await r.json(); settings=d.settings||{};
    const c=$('contacts'); let h='';
    if(settings.whatsapp) h+=`<a class="primary-btn" href="${settings.whatsapp}" target="_blank" rel="noopener">WhatsApp</a>`;
    if(settings.telegram) h+=`<a class="primary-btn" href="${settings.telegram}" target="_blank" rel="noopener">Telegram</a>`;
    c.innerHTML=h||'<p class="muted">Support contacts are not configured yet.</p>';
  }catch(e){$('contacts').innerHTML='<p class="muted">Support contacts are temporarily unavailable.</p>'}
}
async function checkSession(){
  try{
    const r=await api('/api/customer/me');
    if(!r.ok)return;
    const d=await r.json();
    if(d.customer?.temporary_password){openReset(d.customer)}
    else openDashboard(d.customer);
  }catch(e){}
}
function openLogin(){show('loginModal');setTimeout(()=>$('userId').focus(),50)}
function openReset(customer){
  hide('loginModal'); show('resetModal'); $('oldPassword').value=$('password').value||''; $('newPassword').value=''; $('repeatPassword').value='';
}
function openDashboard(customer){hide('loginModal');hide('resetModal');$('welcomeName').textContent=`Welcome, ${customer?.client_name||'Customer'}`;show('dashboardModal')}
$('openLogin').addEventListener('click',openLogin);
$('closeLogin').addEventListener('click',()=>hide('loginModal'));
$('closeDashboard').addEventListener('click',()=>hide('dashboardModal'));
$('loginForm').addEventListener('submit',async e=>{
  e.preventDefault(); resultBox('loginResult','muted','Signing in...');
  try{
    const r=await api('/api/customer/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_id:$('userId').value.trim(),password:$('password').value})});
    const d=await r.json(); if(!r.ok)throw new Error(d.error||'Login failed.');
    if(d.customer?.temporary_password){openReset(d.customer);return}
    openDashboard(d.customer);
  }catch(err){resultBox('loginResult','error',err.message)}
});
$('resetForm').addEventListener('submit',async e=>{
  e.preventDefault(); resultBox('resetResult','muted','Updating password...');
  try{
    const r=await api('/api/customer/change-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      old_password:$('oldPassword').value,new_password:$('newPassword').value,repeat_password:$('repeatPassword').value
    })});
    const d=await r.json(); if(!r.ok)throw new Error(d.error||'Password change failed.');
    resultBox('resetResult','success','Password updated successfully. Your dashboard is now accessible.');
    setTimeout(async()=>{const r2=await api('/api/customer/me');const d2=await r2.json();openDashboard(d2.customer)},500);
  }catch(err){resultBox('resetResult','error',err.message)}
});
$('logoutBtn').addEventListener('click',async()=>{
  try{await api('/api/customer/logout',{method:'POST'})}catch(e){}
  hide('dashboardModal');$('loginForm').reset();$('loginResult').innerHTML='';
});
$('adminLink').href=API_BASE+'/admin';
document.addEventListener('DOMContentLoaded',()=>{loadSettings();checkSession()});
