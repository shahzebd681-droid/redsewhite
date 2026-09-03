const express=require('express');
const path=require('path');
const crypto=require('crypto');
const multer=require('multer');
const {createClient}=require('@supabase/supabase-js');

const app=express();
const PORT=process.env.PORT||3000;

const SUPABASE_URL=process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;

if(!SUPABASE_URL||!SUPABASE_SERVICE_ROLE_KEY){
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase=createClient(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,{
  auth:{persistSession:false}
});

const AUTH_COOKIE='rw_admin';
const CUSTOMER_COOKIE='rw_customer';
const AUTH_SECRET=process.env.SESSION_SECRET||'change-this-secret';
const ADMIN_USER=process.env.ADMIN_USER||'admin';
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||'admin';

const CUSTOMER_ORIGIN=process.env.CUSTOMER_ORIGIN||'https://redsewhite-customer.onrender.com';

app.use(express.json({limit:'2mb'}));
app.use(express.urlencoded({extended:true,limit:'2mb'}));

app.use((req,res,next)=>{
  const origin=req.headers.origin;
  const allowed=[
    CUSTOMER_ORIGIN,
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173'
  ];

  if(origin&&allowed.includes(origin)){
    res.setHeader('Access-Control-Allow-Origin',origin);
    res.setHeader('Access-Control-Allow-Credentials','true');
  }

  res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');

  if(req.method==='OPTIONS')return res.sendStatus(204);
  next();
});

app.use(express.static(path.join(__dirname,'public')));

function parseCookies(req){
  const out={};
  const raw=req.headers.cookie||'';

  for(const part of raw.split(';')){
    const i=part.indexOf('=');
    if(i<0)continue;
    const k=part.slice(0,i).trim();
    const v=part.slice(i+1).trim();
    out[k]=decodeURIComponent(v);
  }

  return out;
}

function signToken(payload){
  const body=Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig=crypto
    .createHmac('sha256',AUTH_SECRET)
    .update(body)
    .digest('base64url');

  return `${body}.${sig}`;
}

function verifyToken(token){
  try{
    if(!token)return null;

    const [body,sig]=String(token).split('.');
    if(!body||!sig)return null;

    const expected=crypto
      .createHmac('sha256',AUTH_SECRET)
      .update(body)
      .digest('base64url');

    if(!crypto.timingSafeEqual(
      Buffer.from(sig),
      Buffer.from(expected)
    ))return null;

    const payload=JSON.parse(
      Buffer.from(body,'base64url').toString('utf8')
    );

    if(payload.exp&&Date.now()>payload.exp)return null;

    return payload;
  }catch(e){
    return null;
  }
}

function adminCookieOptions(){
  if(process.env.NODE_ENV==='production'){
    return 'Path=/; HttpOnly; SameSite=Lax; Secure';
  }

  return 'Path=/; HttpOnly; SameSite=Lax';
}

function customerCookieOptions(){
  if(process.env.NODE_ENV==='production'){
    return 'Path=/; HttpOnly; SameSite=None; Secure';
  }

  return 'Path=/; HttpOnly; SameSite=Lax';
}

function customerCookieOptionsCrossSite(){
  return customerCookieOptions();
}

function hashPassword(password){
  const salt=crypto.randomBytes(16).toString('hex');

  const hash=crypto.scryptSync(
    String(password),
    salt,
    64
  ).toString('hex');

  return `${salt}:${hash}`;
}

function verifyPassword(password,stored){
  try{
    const [salt,key]=String(stored||'').split(':');

    if(!salt||!key)return false;

    const derived=crypto.scryptSync(
      String(password),
      salt,
      64
    ).toString('hex');

    return crypto.timingSafeEqual(
      Buffer.from(key,'hex'),
      Buffer.from(derived,'hex')
    );
  }catch(e){
    return false;
  }
}

function rwDate(){
  return new Date().toISOString();
}

function istDateString(){
  const now=new Date();

  return new Intl.DateTimeFormat('en-CA',{
    timeZone:'Asia/Kolkata',
    year:'numeric',
    month:'2-digit',
    day:'2-digit'
  }).format(now).replace(/-/g,'');
}

function rwTransactionId(prefix){
  return `RW-${prefix}-${istDateString()}-${crypto
    .randomBytes(3)
    .toString('hex')
    .toUpperCase()}`;
}

function roundMoney(value){
  return Math.round((Number(value)+Number.EPSILON)*100)/100;
}

function cleanCustomer(row){
  if(!row)return null;

  return {
    id:row.id,
    client_name:row.client_name,
    user_id:row.user_id,
    temporary_password:Boolean(row.temporary_password),
    whatsapp_number:row.whatsapp_number||'',
    telegram_id:row.telegram_id||'',
    status:row.status,
    created_at:row.created_at,
    updated_at:row.updated_at,
    last_login_at:row.last_login_at
  };
}

function validateCustomerInput(body){
  const clientName=String(body?.client_name||'').trim();
  const userId=String(body?.user_id||'').trim();
  const temporaryPassword=String(body?.temporary_password||'');
  const whatsapp=String(body?.whatsapp_number||'').trim();
  const telegram=String(body?.telegram_id||'').trim();

  if(!clientName){
    return {error:'Client Name is required.'};
  }

  if(!userId){
    return {error:'User ID is required.'};
  }

  if(!/^[A-Za-z0-9._-]{3,50}$/.test(userId)){
    return {error:'User ID must be 3–50 characters and contain only letters, numbers, dot, underscore or hyphen.'};
  }

  if(temporaryPassword.length<8){
    return {error:'Temporary Password must be at least 8 characters.'};
  }

  if(!whatsapp&&!telegram){
    return {error:'At least one contact method is required.'};
  }

  return {
    clientName,
    userId,
    temporaryPassword,
    whatsapp,
    telegram
  };
}

function requireAdmin(req,res){
  const cookies=parseCookies(req);
  const payload=verifyToken(cookies[AUTH_COOKIE]);

  if(!payload||payload.type!=='admin'){
    res.status(401).json({error:'Admin authentication required.'});
    return null;
  }

  return payload;
}

function auth(req,res,next){
  const admin=requireAdmin(req,res);

  if(!admin)return;

  req.admin=admin;
  next();
}

function requireCustomerAuth(req,res){
  const cookies=parseCookies(req);
  const payload=verifyToken(cookies[CUSTOMER_COOKIE]);

  if(!payload||payload.type!=='customer'){
    res.status(401).json({error:'Customer authentication required.'});
    return null;
  }

  req.customerId=Number(payload.customerId);

  if(!Number.isInteger(req.customerId)){
    res.status(401).json({error:'Invalid customer session.'});
    return null;
  }

  return payload;
}

function customerAuth(req,res,next){
  const customer=requireCustomerAuth(req,res);

  if(!customer)return;

  req.customer=customer;
  next();
}

async function getCustomerById(id){
  const {data,error}=await supabase
    .from('rw_customers')
    .select(`
      id,
      client_name,
      user_id,
      password_hash,
      temporary_password,
      whatsapp_number,
      telegram_id,
      status,
      created_at,
      updated_at,
      last_login_at
    `)
    .eq('id',id)
    .maybeSingle();

  if(error)throw error;

  return data;
}

async function requireCustomerActive(req,res){
  const customer=await getCustomerById(req.customerId);

  if(!customer){
    res.status(401).json({error:'Customer account not found.'});
    return null;
  }

  if(customer.status!=='active'){
    res.status(403).json({error:'Your customer account is currently blocked.'});
    return null;
  }

  return customer;
}

async function audit(
  action,
  actorType,
  actorId,
  customerId,
  transactionId,
  details={}
){
  try{
    await supabase
      .from('rw_audit_logs')
      .insert({
        actor_id:actorId||null,
        actor_type:actorType,
        customer_id:customerId||null,
        transaction_id:transactionId||null,
        action,
        details,
        created_at:rwDate()
      });
  }catch(e){
    console.error('AUDIT ERROR:',e);
  }
}

app.get('/api/health',(req,res)=>{
  res.json({
    ok:true,
    service:'redwallet',
    time:rwDate()
  });
});

/* ---------------- Admin authentication ---------------- */

app.post('/api/admin/login',(req,res)=>{
  try{
    const username=String(req.body?.username||'');
    const password=String(req.body?.password||'');

    if(
      username!==ADMIN_USER||
      password!==ADMIN_PASSWORD
    ){
      return res.status(401).json({
        error:'Invalid admin credentials.'
      });
    }

    const token=signToken({
      type:'admin',
      username,
      iat:Date.now(),
      exp:Date.now()+24*60*60*1000
    });

    res.setHeader(
      'Set-Cookie',
      `${AUTH_COOKIE}=${encodeURIComponent(token)}; ${adminCookieOptions()}`
    );

    res.json({
      ok:true,
      user:{username}
    });
  }catch(e){
    console.error('ADMIN LOGIN ERROR:',e);
    res.status(500).json({
      error:'Could not login.'
    });
  }
});

app.post('/api/admin/logout',(req,res)=>{
  res.setHeader(
    'Set-Cookie',
    `${AUTH_COOKIE}=; Path=/; HttpOnly; Max-Age=0`
  );

  res.json({ok:true});
});

app.get('/api/admin/me',auth,(req,res)=>{
  res.json({
    ok:true,
    user:{
      username:req.admin.username
    }
  });
});

/* ---------------- Customer authentication ---------------- */

app.post('/api/customer/login',async(req,res)=>{
  try{
    const userId=String(req.body?.user_id||'').trim();
    const password=String(req.body?.password||'');

    if(!userId||!password){
      return res.status(400).json({
        error:'User ID and password are required.'
      });
    }

    const {data:customer,error}=await supabase
      .from('rw_customers')
      .select(`
        id,
        client_name,
        user_id,
        password_hash,
        temporary_password,
        whatsapp_number,
        telegram_id,
        status,
        created_at,
        updated_at,
        last_login_at
      `)
      .eq('user_id',userId)
      .maybeSingle();

    if(error)throw error;

    if(!customer){
      return res.status(401).json({
        error:'Invalid User ID or password.'
      });
    }

    if(customer.status!=='active'){
      return res.status(403).json({
        error:'Your customer account is currently blocked.'
      });
    }

    if(!verifyPassword(password,customer.password_hash)){
      return res.status(401).json({
        error:'Invalid User ID or password.'
      });
    }

    const now=rwDate();

    await supabase
      .from('rw_customers')
      .update({
        last_login_at:now,
        updated_at:now
      })
      .eq('id',customer.id);

    /*
      IMPORTANT:
      A temporary-password customer receives a session that is
      marked as first_login_only. The frontend can only use this
      session for password reset. Customer APIs also enforce the
      temporary_password flag server-side.
    */

    const token=signToken({
      type:'customer',
      customerId:customer.id,
      firstLogin:Boolean(customer.temporary_password),
      iat:Date.now(),
      exp:Date.now()+24*60*60*1000
    });

    res.setHeader(
      'Set-Cookie',
      `${CUSTOMER_COOKIE}=${encodeURIComponent(token)}; ${customerCookieOptions()}`
    );

    res.json({
      ok:true,
      first_login:Boolean(customer.temporary_password),
      customer:cleanCustomer(customer)
    });
  }catch(e){
    console.error('CUSTOMER LOGIN ERROR:',e);
    res.status(500).json({
      error:'Could not login.'
    });
  }
});

app.post('/api/customer/login-v2',async(req,res)=>{
  return res.status(410).json({
    error:'This login endpoint is no longer supported. Please use the standard customer login.'
  });
});

app.post('/api/customer/logout',(req,res)=>{
  res.setHeader(
    'Set-Cookie',
    `${CUSTOMER_COOKIE}=; Path=/; HttpOnly; Max-Age=0`
  );

  res.json({ok:true});
});

app.get('/api/customer/me',customerAuth,async(req,res)=>{
  try{
    const customer=await getCustomerById(req.customerId);

    if(!customer){
      return res.status(401).json({
        error:'Customer account not found.'
      });
    }

    if(customer.status!=='active'){
      return res.status(403).json({
        error:'Your customer account is currently blocked.'
      });
    }

    /*
      Never expose dashboard data to a customer whose temporary
      password has not yet been replaced.
    */
    if(customer.temporary_password){
      return res.status(403).json({
        error:'Password reset is required before dashboard access.',
        first_login:true
      });
    }

    res.json({
      ok:true,
      customer:cleanCustomer(customer)
    });
  }catch(e){
    console.error('CUSTOMER ME ERROR:',e);
    res.status(500).json({
      error:'Could not load customer profile.'
    });
  }
});

/* ---------------- First-login password reset ---------------- */

app.post('/api/customer/reset-password',customerAuth,async(req,res)=>{
  try{
    const customer=await getCustomerById(req.customerId);

    if(!customer){
      return res.status(401).json({
        error:'Customer account not found.'
      });
    }

    if(customer.status!=='active'){
      return res.status(403).json({
        error:'Your customer account is currently blocked.'
      });
    }

    if(!customer.temporary_password){
      return res.status(400).json({
        error:'First-login password reset is no longer required.'
      });
    }

    const oldPassword=String(req.body?.old_password||'');
    const newPassword=String(req.body?.new_password||'');
    const repeatPassword=String(req.body?.repeat_password||'');

    if(!oldPassword||!newPassword||!repeatPassword){
      return res.status(400).json({
        error:'Old Password, New Password and Repeat New Password are required.'
      });
    }

    if(!verifyPassword(oldPassword,customer.password_hash)){
      return res.status(400).json({
        error:'Old Password is incorrect.'
      });
    }

    if(newPassword.length<8){
      return res.status(400).json({
        error:'New Password must be at least 8 characters.'
      });
    }

    if(newPassword!==repeatPassword){
      return res.status(400).json({
        error:'New Password and Repeat New Password must match.'
      });
    }

    if(newPassword===oldPassword){
      return res.status(400).json({
        error:'New Password must be different from the old password.'
      });
    }

    const now=rwDate();

    const {error}=await supabase
      .from('rw_customers')
      .update({
        password_hash:hashPassword(newPassword),
        temporary_password:false,
        updated_at:now
      })
      .eq('id',customer.id)
      .eq('temporary_password',true);

    if(error)throw error;

    await audit(
      'password_reset',
      'customer',
      customer.id,
      customer.id,
      null,
      {first_login:true}
    );

    /*
      Issue a fresh normal customer session after successful reset.
    */
    const token=signToken({
      type:'customer',
      customerId:customer.id,
      firstLogin:false,
      iat:Date.now(),
      exp:Date.now()+24*60*60*1000
    });

    res.setHeader(
      'Set-Cookie',
      `${CUSTOMER_COOKIE}=${encodeURIComponent(token)}; ${customerCookieOptions()}`
    );

    res.json({
      ok:true,
      message:'Password changed successfully. Your dashboard is now available.'
    });
  }catch(e){
    console.error('FIRST RESET ERROR:',e);
    res.status(500).json({
      error:'Could not reset password.'
    });
  }
});

/* ---------------- Normal customer password change ---------------- */

app.post('/api/customer/change-password',customerAuth,async(req,res)=>{
  try{
    const customer=await requireCustomerActive(req,res);

    if(!customer)return;

    if(customer.temporary_password){
      return res.status(403).json({
        error:'Please complete the first-login password reset before changing your password.'
      });
    }

    const oldPassword=String(req.body?.old_password||'');
    const newPassword=String(req.body?.new_password||'');
    const repeatPassword=String(req.body?.repeat_password||'');

    if(!oldPassword||!newPassword||!repeatPassword){
      return res.status(400).json({
        error:'Old Password, New Password and Repeat New Password are required.'
      });
    }

    if(!verifyPassword(oldPassword,customer.password_hash)){
      return res.status(400).json({
        error:'Old Password is incorrect.'
      });
    }

    if(newPassword.length<8){
      return res.status(400).json({
        error:'New Password must be at least 8 characters.'
      });
    }

    if(newPassword!==repeatPassword){
      return res.status(400).json({
        error:'New Password and Repeat New Password must match.'
      });
    }

    if(newPassword===oldPassword){
      return res.status(400).json({
        error:'New Password must be different from the old password.'
      });
    }

    const now=rwDate();

    const {error}=await supabase
      .from('rw_customers')
      .update({
        password_hash:hashPassword(newPassword),
        temporary_password:false,
        updated_at:now
      })
      .eq('id',customer.id);

    if(error)throw error;

    await audit(
      'password_change',
      'customer',
      customer.id,
      customer.id,
      null,
      {}
    );

    res.json({
      ok:true,
      message:'Password changed successfully.'
    });
  }catch(e){
    console.error('CHANGE PASSWORD ERROR:',e);
    res.status(500).json({
      error:'Could not change password.'
    });
  }
});

/* ---------------- Admin customer management ---------------- */

app.get('/api/admin/customers',auth,async(req,res)=>{
  try{
    const {data,error}=await supabase
      .from('rw_customers')
      .select(`
        id,
        client_name,
        user_id,
        temporary_password,
        whatsapp_number,
        telegram_id,
        status,
        created_at,
        updated_at,
        last_login_at
      `)
      .order('created_at',{ascending:false});

    if(error)throw error;

    res.json({
      ok:true,
      customers:(data||[]).map(cleanCustomer)
    });
  }catch(e){
    console.error('ADMIN CUSTOMERS ERROR:',e);
    res.status(500).json({
      error:'Could not load customers.'
    });
  }
});

app.get('/api/admin/customers/:id',auth,async(req,res)=>{
  try{
    const id=Number(req.params.id);

    if(!Number.isInteger(id)){
      return res.status(400).json({
        error:'Invalid customer ID.'
      });
    }

    const customer=await getCustomerById(id);

    if(!customer){
      return res.status(404).json({
        error:'Customer not found.'
      });
    }

    res.json({
      ok:true,
      customer:cleanCustomer(customer)
    });
  }catch(e){
    console.error('ADMIN CUSTOMER DETAIL ERROR:',e);
    res.status(500).json({
      error:'Could not load customer.'
    });
  }
});

app.post('/api/admin/customers',auth,async(req,res)=>{
  try{
    const input=validateCustomerInput(req.body);

    if(input.error){
      return res.status(400).json({
        error:input.error
      });
    }

    const {
      clientName,
      userId,
      temporaryPassword,
      whatsapp,
      telegram
    }=input;

    const {data:existing,error:existingError}=await supabase
      .from('rw_customers')
      .select('id')
      .eq('user_id',userId)
      .maybeSingle();

    if(existingError)throw existingError;

    if(existing){
      return res.status(409).json({
        error:'This User ID is already in use.'
      });
    }

    const now=rwDate();

    const {data:customer,error}=await supabase
      .from('rw_customers')
      .insert({
        client_name:clientName,
        user_id:userId,
        password_hash:hashPassword(temporaryPassword),
        temporary_password:true,
        whatsapp_number:whatsapp||null,
        telegram_id:telegram||null,
        status:'active',
        created_at:now,
        updated_at:now
      })
      .select(`
        id,
        client_name,
        user_id,
        temporary_password,
        whatsapp_number,
        telegram_id,
        status,
        created_at,
        updated_at,
        last_login_at
      `)
      .single();

    if(error)throw error;

    await audit(
      'customer_create',
      'admin',
      null,
      customer.id,
      null,
      {
        user_id:userId,
        client_name:clientName
      }
    );

    res.status(201).json({
      ok:true,
      customer:cleanCustomer(customer)
    });
  }catch(e){
    console.error('ADMIN CREATE CUSTOMER ERROR:',e);
    res.status(500).json({
      error:'Could not create customer.'
    });
  }
});

app.post('/api/admin/customers/:id/reset-password',auth,async(req,res)=>{
  try{
    const id=Number(req.params.id);

    if(!Number.isInteger(id)){
      return res.status(400).json({
        error:'Invalid customer ID.'
      });
    }

    const newPassword=String(req.body?.temporary_password||'');

    if(newPassword.length<8){
      return res.status(400).json({
        error:'Temporary Password must be at least 8 characters.'
      });
    }

    const customer=await getCustomerById(id);

    if(!customer){
      return res.status(404).json({
        error:'Customer not found.'
      });
    }

    const now=rwDate();

    const {error}=await supabase
      .from('rw_customers')
      .update({
        password_hash:hashPassword(newPassword),
        temporary_password:true,
        updated_at:now
      })
      .eq('id',id);

    if(error)throw error;

    await audit(
      'password_reset',
      'admin',
      null,
      id,
      null,
      {temporary_password:true}
    );

    res.json({
      ok:true,
      message:'Temporary password reset successfully.'
    });
  }catch(e){
    console.error('ADMIN RESET PASSWORD ERROR:',e);
    res.status(500).json({
      error:'Could not reset password.'
    });
  }
});

app.put('/api/admin/customers/:id/status',auth,async(req,res)=>{
  try{
    const id=Number(req.params.id);
    const status=String(req.body?.status||'').toLowerCase();

    if(!Number.isInteger(id)){
      return res.status(400).json({
        error:'Invalid customer ID.'
      });
    }

    if(!['active','blocked'].includes(status)){
      return res.status(400).json({
        error:'Status must be active or blocked.'
      });
    }

    const customer=await getCustomerById(id);

    if(!customer){
      return res.status(404).json({
        error:'Customer not found.'
      });
    }

    const now=rwDate();

    const {error}=await supabase
      .from('rw_customers')
      .update({
        status,
        updated_at:now
      })
      .eq('id',id);

    if(error)throw error;

    await audit(
      status==='active'?'customer_activate':'customer_block',
      'admin',
      null,
      id,
      null,
      {status}
    );

    res.json({
      ok:true,
      status
    });
  }catch(e){
    console.error('ADMIN STATUS ERROR:',e);
    res.status(500).json({
      error:'Could not update customer status.'
    });
  }
});

app.delete('/api/admin/customers/:id',auth,async(req,res)=>{
  try{
    const id=Number(req.params.id);

    if(!Number.isInteger(id)){
      return res.status(400).json({
        error:'Invalid customer ID.'
      });
    }

    const customer=await getCustomerById(id);

    if(!customer){
      return res.status(404).json({
        error:'Customer not found.'
      });
    }

    const {error}=await supabase
      .from('rw_customers')
      .delete()
      .eq('id',id);

    if(error)throw error;

    await audit(
      'customer_delete',
      'admin',
      null,
      id,
      null,
      {
        user_id:customer.user_id,
        client_name:customer.client_name
      }
    );

    res.json({
      ok:true
    });
  }catch(e){
    console.error('ADMIN DELETE CUSTOMER ERROR:',e);
    res.status(500).json({
      error:'Could not delete customer.'
    });
  }
});

/* ---------------- Wallet helpers ---------------- */

const FUN_COIN_DB={
  inr:'white_inr',
  usdt_trc20:'white_usdt'
};

function funCoinDbType(coin){
  return FUN_COIN_DB[String(coin||'').toLowerCase()]||null;
}

function funCoinApiType(coin){
  const value=String(coin||'').toLowerCase();

  if(value==='white_inr')return 'inr';
  if(value==='white_usdt')return 'usdt_trc20';

  return value;
}

async function ensureWalletSeeds(){
  const seeds=[
    {
      coin_type:'white_inr',
      rate:1.20
    },
    {
      coin_type:'white_usdt',
      rate:120.00
    }
  ];

  for(const seed of seeds){
    const {data:existing,error}=await supabase
      .from('rw_fun_coin_settings')
      .select('id,coin_type,rate')
      .eq('coin_type',seed.coin_type)
      .maybeSingle();

    if(error)throw error;

    if(!existing){
      const {error:insertError}=await supabase
        .from('rw_fun_coin_settings')
        .insert(seed);

      if(insertError)throw insertError;
    }
  }
}

async function walletBalance(customerId){
  const {data:ledger,error}=await supabase
    .from('rw_wallet_ledger')
    .select('entry_type,amount')
    .eq('customer_id',customerId);

  if(error)throw error;

  let balance=0;

  for(const row of ledger||[]){
    const amount=Number(row.amount)||0;

    if(row.entry_type==='credit'){
      balance+=amount;
    }else if(row.entry_type==='debit'){
      balance-=amount;
    }
  }

  return roundMoney(balance);
}

async function walletSummary(customerId){
  const balance=await walletBalance(customerId);

  const {data:transactions,error}=await supabase
    .from('rw_transactions')
    .select('*')
    .eq('customer_id',customerId)
    .order('created_at',{ascending:false});

  if(error)throw error;

  const txs=transactions||[];

  const totalDeposited=txs
    .filter(t=>
      t.transaction_type==='deposit'&&
      t.status==='confirmed'
    )
    .reduce((sum,t)=>sum+Number(t.amount||0),0);

  const totalUsed=txs
    .filter(t=>
      t.transaction_type==='conversion'&&
      ['pending','processing','confirmed'].includes(t.status)
    )
    .reduce((sum,t)=>sum+Number(t.amount||0),0);

  const pendingAmount=txs
    .filter(t=>
      t.status==='pending'||
      t.status==='processing'
    )
    .reduce((sum,t)=>sum+Number(t.amount||0),0);

  return {
    balance:roundMoney(balance),
    total_deposited:roundMoney(totalDeposited),
    total_used:roundMoney(totalUsed),
    pending_amount:roundMoney(pendingAmount)
  };
}

async function conversionDebit(customerId,tx){
  const amount=roundMoney(Number(tx.amount));

  const balance=await walletBalance(customerId);

  if(balance<amount){
    return {
      ok:false,
      balance
    };
  }

  const reference=`${tx.transaction_id}-DEBIT`;

  const {data:existing,error:ee}=await supabase
    .from('rw_wallet_ledger')
    .select('id')
    .eq('transaction_id',tx.id)
    .eq('entry_type','debit')
    .eq('reference',reference)
    .maybeSingle();

  if(ee)throw ee;

  if(existing){
    return {
      ok:true,
      balance:roundMoney(balance)
    };
  }

  const {error}=await supabase
    .from('rw_wallet_ledger')
    .insert({
      customer_id:customerId,
      transaction_id:tx.id,
      entry_type:'debit',
      amount,
      description:`Fun Coin conversion: ${tx.coin_quantity} coins`,
      reference,
      created_at:rwDate()
    });

  if(error)throw error;

  return {
    ok:true,
    balance:roundMoney(balance-amount)
  };
}

async function conversionCredit(customerId,tx){
  const reference=`${tx.transaction_id}-REV`;

  const {data:existing,error:ee}=await supabase
    .from('rw_wallet_ledger')
    .select('id')
    .eq('transaction_id',tx.id)
    .eq('entry_type','credit')
    .eq('reference',reference)
    .maybeSingle();

  if(ee)throw ee;

  if(existing)return;

  const {error}=await supabase
    .from('rw_wallet_ledger')
    .insert({
      customer_id:customerId,
      transaction_id:tx.id,
      entry_type:'credit',
      amount:Number(tx.amount),
      description:'Conversion reversal',
      reference,
      created_at:rwDate()
    });

  if(error)throw error;
}

async function reverseConversion(customerId,tx,reason){
  const reference=`${tx.transaction_id}-REV`;

  const {data:existing,error:ee}=await supabase
    .from('rw_wallet_ledger')
    .select('id')
    .eq('transaction_id',tx.id)
    .eq('entry_type','credit')
    .eq('reference',reference)
    .maybeSingle();

  if(ee)throw ee;

  if(existing)return;

  const {error}=await supabase
    .from('rw_wallet_ledger')
    .insert({
      customer_id:customerId,
      transaction_id:tx.id,
      entry_type:'credit',
      amount:Number(tx.amount),
      description:`Conversion reversal: ${reason}`,
      reference,
      created_at:rwDate()
    });

  if(error)throw error;
}
