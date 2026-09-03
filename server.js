const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const QR_BUCKET = 'payment-qr';
const SCREENSHOT_BUCKET = 'payment-screenshots';
const AUTH_COOKIE = 'rw_admin';
const CUSTOMER_COOKIE = 'rw_customer';
const AUTH_SECRET = String(process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'));
const ADMIN_USER = String(process.env.ADMIN_USER || 'admin');
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || 'CHANGE-ME-IMMEDIATELY');

const defaults = {
  upi_id: '',
  upi_holder: '',
  upi_min: '100',
  upi_max: '100000',
  upi_message: 'Pay using the UPI details shown above.',
  qr_a: '',
  qr_a_holder: '',
  qr_a_min: '100',
  qr_a_max: '100000',
  qr_a_message: 'Scan QR A and complete your payment.',
  qr_b: '',
  qr_b_holder: '',
  qr_b_min: '100',
  qr_b_max: '100000',
  qr_b_message: 'Scan QR B and complete your payment.',
  qr_c: '',
  qr_c_holder: '',
  qr_c_min: '100',
  qr_c_max: '100000',
  qr_c_message: 'Scan QR C and complete your payment.',
  bank_holder: '',
  bank_name: '',
  bank_account: '',
  bank_ifsc: '',
  bank_min: '100',
  bank_max: '100000',
  bank_message: 'Transfer to the bank details shown above.',
  telegram: '',
  whatsapp: ''
};

app.set('trust proxy', 1);

app.use((req, res, next) => {
  const publicApi =
    req.path === '/api/public' ||
    req.path === '/api/payment' ||
    req.path.startsWith('/api/status/') ||
    req.path.startsWith('/api/customer/');
  if (publicApi) {
    const origin = req.headers.origin;
    const allowedOrigin = req.path.startsWith('/api/customer/') && origin === CUSTOMER_ORIGIN ? origin : '*';
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    if (allowedOrigin !== '*') {
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS' && publicApi) return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, /^image\/(png|jpeg|webp|gif)$/.test(file.mimetype));
  }
});

function sign(value) {
  return crypto.createHmac('sha256', AUTH_SECRET).update(value).digest('hex');
}

function makeToken(type, subject, hours) {
  const payload = Buffer.from(JSON.stringify({
    type,
    sub: String(subject),
    exp: Date.now() + hours * 60 * 60 * 1000
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token, expectedType) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(payload);
  if (signature.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.type !== expectedType || Number(data.exp) <= Date.now()) return null;
    return data;
  } catch (_) {
    return null;
  }
}

function getCookie(req, name) {
  const header = req.headers.cookie || '';
  const item = header.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`));
  return item ? item.slice(name.length + 1) : null;
}

function auth(req, res, next) {
  const token = getCookie(req, AUTH_COOKIE);
  const data = verifyToken(token, 'admin');
  if (!data || data.sub !== ADMIN_USER) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function customerAuth(req, res, next) {
  const data = verifyToken(getCookie(req, CUSTOMER_COOKIE), 'customer');
  if (!data) return res.status(401).json({ error: 'Customer authentication required.' });
  req.customerId = Number(data.sub);
  next();
}

function cookieOptions() {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function customerCookieOptions() {
  if (process.env.NODE_ENV === 'production') return 'Path=/; HttpOnly; SameSite=None; Secure';
  return 'Path=/; HttpOnly; SameSite=Lax';
}

function ist(iso) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium'
  }).format(new Date(iso));
}

function generateCode() {
  return `PAY-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function methodLimits(s, method) {
  const map = {
    upi: [s.upi_min, s.upi_max],
    qr_a: [s.qr_a_min, s.qr_a_max],
    qr_b: [s.qr_b_min, s.qr_b_max],
    qr_c: [s.qr_c_min, s.qr_c_max],
    bank: [s.bank_min, s.bank_max]
  };
  const pair = map[method];
  return pair ? { min: Number(pair[0]), max: Number(pair[1]) } : null;
}

async function getSettings() {
  const { data, error } = await supabase.from('settings').select('key,value');
  if (error) throw error;
  const result = { ...defaults };
  for (const row of data || []) result[row.key] = row.value;
  return result;
}

async function ensureDefaults() {
  const { data, error } = await supabase.from('settings').select('key');
  if (error) throw error;
  const existing = new Set((data || []).map(row => row.key));
  const missing = Object.entries(defaults)
    .filter(([key]) => !existing.has(key))
    .map(([key, value]) => ({ key, value }));
  if (missing.length) {
    const { error: insertError } = await supabase.from('settings').insert(missing);
    if (insertError) throw insertError;
  }
}

async function ensureBuckets() {
  const qr = await supabase.storage.createBucket(QR_BUCKET, { public: true });
  if (qr.error && !/already exists|duplicate/i.test(qr.error.message || '')) {
    console.warn('QR bucket:', qr.error.message);
  }
  const qrPublic = await supabase.storage.updateBucket(QR_BUCKET, { public: true });
  if (qrPublic.error) console.warn('QR bucket public setting:', qrPublic.error.message);

  const shots = await supabase.storage.createBucket(SCREENSHOT_BUCKET, { public: false });
  if (shots.error && !/already exists|duplicate/i.test(shots.error.message || '')) {
    console.warn('Screenshot bucket:', shots.error.message);
  }
}

async function uploadFile(bucket, file, filename) {
  const { error } = await supabase.storage.from(bucket).upload(filename, file.buffer, {
    contentType: file.mimetype,
    upsert: true
  });
  if (error) throw error;
  return filename;
}

function qrPublicUrl(pathname) {
  if (!pathname) return '';
  return supabase.storage.from(QR_BUCKET).getPublicUrl(pathname).data.publicUrl;
}

/* Passwords: scrypt with a per-password random salt. */
function hashCustomerPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 32 * 1024 * 1024
  });
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

function verifyCustomerPassword(password, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const salt = parts[1];
    const expected = Buffer.from(parts[2], 'hex');
    const actual = crypto.scryptSync(String(password), salt, expected.length, {
      N: 16384,
      r: 8,
      p: 1,
      maxmem: 32 * 1024 * 1024
    });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch (_) {
    return false;
  }
}

function cleanCustomer(row) {
  if (!row) return null;
  return {
    id: row.id,
    client_name: row.client_name,
    user_id: row.user_id,
    whatsapp_number: row.whatsapp_number || '',
    telegram_id: row.telegram_id || '',
    status: row.status || 'active',
    temporary_password: Boolean(row.temporary_password),
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_login_at: row.last_login_at || null
  };
}

function validateCustomerInput(body, requirePassword = true) {
  const clientName = String(body?.client_name || '').trim();
  const userId = String(body?.user_id || '').trim();
  const password = String(body?.temporary_password || '');
  const whatsapp = String(body?.whatsapp_number ?? body?.whatsapp ?? '').trim();
  const telegram = String(body?.telegram_id ?? body?.telegram ?? '').trim();

  if (!clientName) return { error: 'Client Name is required.' };
  if (!userId) return { error: 'User ID is required.' };
  if (!/^[A-Za-z0-9._-]{3,50}$/.test(userId)) {
    return { error: 'User ID must be 3–50 characters and use only letters, numbers, dot, underscore or hyphen.' };
  }
  if (requirePassword && password.length < 8) {
    return { error: 'Temporary Password must be at least 8 characters.' };
  }
  if (!whatsapp && !telegram) {
    return { error: 'At least one contact method (WhatsApp or Telegram) is required.' };
  }
  return { clientName, userId, password, whatsapp, telegram };
}

/* ---------------- Public payment settings ---------------- */

app.get('/api/public', async (req, res) => {
  try {
    const settings = await getSettings();
    for (const key of ['qr_a', 'qr_b', 'qr_c']) settings[`${key}_url`] = qrPublicUrl(settings[key]);
    res.json({ settings });
  } catch (error) {
    console.error('PUBLIC SETTINGS ERROR:', error);
    res.status(500).json({ error: 'Could not load payment settings.' });
  }
});

/* ---------------- Admin authentication ---------------- */

app.post('/api/login', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (username !== ADMIN_USER || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid login' });
  }
  const token = makeToken('admin', ADMIN_USER, 8);
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=${token}; Max-Age=${8 * 60 * 60}; ${cookieOptions()}`);
  res.json({ ok: true, username: ADMIN_USER });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=; Max-Age=0; ${cookieOptions()}`);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const data = verifyToken(getCookie(req, AUTH_COOKIE), 'admin');
  const authenticated = Boolean(data && data.sub === ADMIN_USER);
  res.json({ authenticated, username: authenticated ? ADMIN_USER : null });
});

/* ---------------- Customer authentication ---------------- */

app.post('/api/customer/login', async (req, res) => {
  try {
    const userId = String(req.body?.user_id || '').trim();
    const password = String(req.body?.password || '');
    if (!userId || !password) return res.status(400).json({ error: 'User ID and password are required.' });

    const { data, error } = await supabase.from('rw_customers')
      .select('id,client_name,user_id,password_hash,temporary_password,status,whatsapp_number,telegram_id,created_at,updated_at,last_login_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(401).json({ error: 'Invalid User ID or password.' });
    if (String(data.status).toLowerCase() !== 'active') {
      return res.status(403).json({ error: 'Your account is currently blocked. Please contact support.' });
    }
    if (!verifyCustomerPassword(password, data.password_hash)) {
      return res.status(401).json({ error: 'Invalid User ID or password.' });
    }

    const now = new Date().toISOString();
    await supabase.from('rw_customers').update({ last_login_at: now, updated_at: now }).eq('id', data.id);

    const token = makeToken('customer', data.id, 24);
    res.setHeader('Set-Cookie', `${CUSTOMER_COOKIE}=${token}; Max-Age=${24 * 60 * 60}; ${customerCookieOptions()}`);
    res.json({
      ok: true,
      customer: cleanCustomer({ ...data, last_login_at: now })
    });
  } catch (error) {
    console.error('CUSTOMER LOGIN ERROR:', error);
    res.status(500).json({ error: 'Could not complete customer login.' });
  }
});

app.post('/api/customer/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${CUSTOMER_COOKIE}=; Max-Age=0; ${customerCookieOptions()}`);
  res.json({ ok: true });
});

app.get('/api/customer/me', customerAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('rw_customers')
      .select('id,client_name,user_id,password_hash,temporary_password,status,whatsapp_number,telegram_id,created_at,updated_at,last_login_at')
      .eq('id', req.customerId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Customer account not found.' });
    if (String(data.status).toLowerCase() !== 'active') return res.status(403).json({ error: 'Your account is blocked.' });
    res.json({ authenticated: true, customer: cleanCustomer(data) });
  } catch (error) {
    console.error('CUSTOMER ME ERROR:', error);
    res.status(500).json({ error: 'Could not load customer account.' });
  }
});

app.post('/api/customer/change-password', customerAuth, async (req, res) => {
  try {
    const oldPassword = String(req.body?.old_password || '');
    const newPassword = String(req.body?.new_password || '');
    const repeatPassword = String(req.body?.repeat_password || '');

    if (newPassword.length < 8) return res.status(400).json({ error: 'New Password must be at least 8 characters.' });
    if (newPassword !== repeatPassword) return res.status(400).json({ error: 'New Password and Repeat New Password do not match.' });

    const { data, error } = await supabase.from('rw_customers')
      .select('id,password_hash,temporary_password,status')
      .eq('id', req.customerId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Customer account not found.' });
    if (String(data.status).toLowerCase() !== 'active') return res.status(403).json({ error: 'Your account is blocked.' });
    if (!verifyCustomerPassword(oldPassword, data.password_hash)) {
      return res.status(401).json({ error: 'Old Password is incorrect.' });
    }

    const now = new Date().toISOString();
    const { error: updateError } = await supabase.from('rw_customers').update({
      password_hash: hashCustomerPassword(newPassword),
      temporary_password: false,
      updated_at: now
    }).eq('id', req.customerId);
    if (updateError) throw updateError;

    res.json({ ok: true, force_reset_complete: true });
  } catch (error) {
    console.error('CUSTOMER PASSWORD ERROR:', error);
    res.status(500).json({ error: 'Could not change password.' });
  }
});

/* ---------------- Existing payment submission/status ---------------- */

app.post('/api/payment', upload.single('screenshot'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Screenshot is required.' });
    const settings = await getSettings();
    const method = String(req.body.payment_method || '').toLowerCase();
    const limits = methodLimits(settings, method);
    if (!limits) return res.status(400).json({ error: 'Please select a payment method.' });
    const amount = Number(req.body.amount);
    const utr = String(req.body.utr || '').trim();
    if (!Number.isInteger(amount) || amount < limits.min || amount > limits.max) {
      return res.status(400).json({ error: `Amount must be between ₹${limits.min} and ₹${limits.max}.` });
    }
    if (!utr || utr.length > 100) return res.status(400).json({ error: 'Valid UTR/Transaction ID is required.' });

    const duplicate = await supabase.from('transactions').select('id').eq('utr', utr).limit(1);
    if (duplicate.error) throw duplicate.error;
    if (duplicate.data?.length) {
      return res.status(409).json({ error: 'This UTR has already been used. Please enter a valid and unused UTR.' });
    }

    let code = generateCode();
    for (let i = 0; i < 5; i++) {
      const { data } = await supabase.from('transactions').select('id').eq('code', code).maybeSingle();
      if (!data) break;
      code = generateCode();
    }

    const screenshotPath = `${code}/${crypto.randomBytes(8).toString('hex')}${path.extname(req.file.originalname).toLowerCase() || '.jpg'}`;
    await uploadFile(SCREENSHOT_BUCKET, req.file, screenshotPath);
    const now = new Date().toISOString();
    const { error } = await supabase.from('transactions').insert({
      code, amount, utr, screenshot: screenshotPath, payment_method: method,
      status: 'pending', rejection_reason: '', created_at: now, updated_at: now
    });
    if (error) throw error;
    res.json({ ok: true, code, status: 'pending', payment_method: method, submitted_at: now, submitted_at_ist: ist(now) });
  } catch (error) {
    console.error('PAYMENT ERROR:', error);
    res.status(500).json({ error: 'Could not submit payment.' });
  }
});

app.get('/api/status/:code', async (req, res) => {
  try {
    const code = String(req.params.code || '').trim().toUpperCase();
    const { data, error } = await supabase.from('transactions')
      .select('code,amount,utr,payment_method,status,created_at,updated_at,rejection_reason')
      .eq('code', code).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Transaction not found.' });
    res.json({ ...data, created_at_ist: ist(data.created_at), updated_at_ist: ist(data.updated_at) });
  } catch (error) {
    console.error('STATUS ERROR:', error);
    res.status(500).json({ error: 'Could not check transaction status.' });
  }
});

/* ---------------- Admin: customer management ---------------- */

app.get('/api/admin/customers', auth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('rw_customers')
      .select('id,client_name,user_id,whatsapp_number,telegram_id,status,temporary_password,created_at,updated_at,last_login_at')
      .order('id', { ascending: false });
    if (error) throw error;
    res.json((data || []).map(cleanCustomer));
  } catch (error) {
    console.error('CUSTOMERS LIST ERROR:', error);
    res.status(500).json({ error: 'Could not load customers.' });
  }
});

app.get('/api/admin/customers/:id', auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid customer ID.' });
    const { data, error } = await supabase.from('rw_customers')
      .select('id,client_name,user_id,whatsapp_number,telegram_id,status,temporary_password,created_at,updated_at,last_login_at')
      .eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Customer not found.' });
    res.json(cleanCustomer(data));
  } catch (error) {
    console.error('CUSTOMER DETAIL ERROR:', error);
    res.status(500).json({ error: 'Could not load customer.' });
  }
});

app.post('/api/admin/customers', auth, async (req, res) => {
  try {
    const input = validateCustomerInput(req.body, true);
    if (input.error) return res.status(400).json({ error: input.error });

    const existing = await supabase.from('rw_customers').select('id').eq('user_id', input.userId).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return res.status(409).json({ error: 'This User ID is already in use. Please choose another User ID.' });

    const now = new Date().toISOString();
    const { data, error } = await supabase.from('rw_customers').insert({
      client_name: input.clientName,
      user_id: input.userId,
      password_hash: hashCustomerPassword(input.password),
      temporary_password: true,
      whatsapp_number: input.whatsapp,
      telegram_id: input.telegram,
      status: 'active',
      created_at: now,
      updated_at: now
    }).select('id,client_name,user_id,whatsapp_number,telegram_id,status,temporary_password,created_at,updated_at,last_login_at').single();

    if (error) {
      if (/duplicate|unique/i.test(error.message || '')) {
        return res.status(409).json({ error: 'This User ID is already in use. Please choose another User ID.' });
      }
      throw error;
    }
    res.status(201).json({ ok: true, customer: cleanCustomer(data) });
  } catch (error) {
    console.error('CUSTOMER CREATE ERROR:', error);
    res.status(500).json({ error: 'Could not create customer.' });
  }
});

app.post('/api/admin/customers/:id/reset-password', auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const password = String(req.body?.temporary_password || '');
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid customer ID.' });
    if (password.length < 8) return res.status(400).json({ error: 'Temporary Password must be at least 8 characters.' });

    const { data: existing, error: findError } = await supabase.from('rw_customers')
      .select('id').eq('id', id).maybeSingle();
    if (findError) throw findError;
    if (!existing) return res.status(404).json({ error: 'Customer not found.' });

    const now = new Date().toISOString();
    const { error } = await supabase.from('rw_customers').update({
      password_hash: hashCustomerPassword(password),
      temporary_password: true,
      updated_at: now
    }).eq('id', id);
    if (error) throw error;

    res.json({ ok: true, message: 'Password reset successfully. Customer must change it on next login.' });
  } catch (error) {
    console.error('CUSTOMER RESET ERROR:', error);
    res.status(500).json({ error: 'Could not reset customer password.' });
  }
});

app.put('/api/admin/customers/:id/status', auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const status = String(req.body?.status || '').toLowerCase();
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid customer ID.' });
    if (!['active', 'blocked'].includes(status)) return res.status(400).json({ error: 'Status must be active or blocked.' });

    const now = new Date().toISOString();
    const { data, error } = await supabase.from('rw_customers').update({
      status, updated_at: now
    }).eq('id', id).select('id,client_name,user_id,whatsapp_number,telegram_id,status,temporary_password,created_at,updated_at,last_login_at').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Customer not found.' });
    res.json({ ok: true, customer: cleanCustomer(data) });
  } catch (error) {
    console.error('CUSTOMER STATUS ERROR:', error);
    res.status(500).json({ error: 'Could not update customer status.' });
  }
});

app.delete('/api/admin/customers/:id', auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid customer ID.' });
    const { data: existing, error: findError } = await supabase.from('rw_customers')
      .select('id,user_id').eq('id', id).maybeSingle();
    if (findError) throw findError;
    if (!existing) return res.status(404).json({ error: 'Customer not found.' });

    const { error } = await supabase.from('rw_customers').delete().eq('id', id);
    if (error) throw error;
    res.json({ ok: true, deleted_id: id });
  } catch (error) {
    console.error('CUSTOMER DELETE ERROR:', error);
    res.status(500).json({ error: 'Could not delete customer.' });
  }
});


/* ---------------- Redwallet wallet / customer portal ---------------- */
const CUSTOMER_ORIGIN = String(process.env.CUSTOMER_ORIGIN || 'https://redsewhite-customer.onrender.com').trim();

function customerCors(req, res, next) {
  const isCustomerRoute = req.path.startsWith('/api/customer') || req.path.startsWith('/api/public-wallet');
  if (isCustomerRoute) {
    const origin = req.headers.origin;
    if (origin === CUSTOMER_ORIGIN || origin === 'http://localhost:3000' || origin === 'http://localhost:5500') {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  }
  next();
}
app.use(customerCors);

// Cross-site customer login is used by the separate static Render service.
function customerCookieOptionsCrossSite() {
  return 'Path=/; HttpOnly; SameSite=None; Secure';
}

function rwDate() { return new Date().toISOString(); }
function rwTransactionId(prefix) {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date()).replaceAll('-','');
  return `RW-${prefix}-${d}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}
function roundMoney(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

async function ensureWalletSeeds() {
  const now = rwDate();
  const coinSeeds = [
    { coin_type: 'inr', rate: 1.20 },
    { coin_type: 'usdt_trc20', rate: 120.00 }
  ];
  for (const seed of coinSeeds) {
    const { data, error } = await supabase.from('rw_fun_coin_settings').select('id,coin_type,rate').eq('coin_type', seed.coin_type).maybeSingle();
    if (error) throw error;
    if (!data) {
      const { error: ie } = await supabase.from('rw_fun_coin_settings').insert(seed);
      if (ie) throw ie;
    }
  }

  const settings = await getSettings();
  const methods = [
    ['upi','UPI Payment'],['qr_a','QR Payment A'],['qr_b','QR Payment B'],['qr_c','QR Payment C'],['bank','Bank Transfer']
  ];
  for (const [code, name] of methods) {
    const { data: existing, error } = await supabase.from('rw_payment_methods').select('*').eq('method_code', code).maybeSingle();
    if (error) throw error;
    if (!existing) {
      const row = {
        method_code: code, method_name: name, is_active: true,
        holder_name: settings[code === 'bank' ? 'bank_holder' : `${code}_holder`] || '',
        upi_id: code === 'upi' ? (settings.upi_id || '') : null,
        bank_name: code === 'bank' ? (settings.bank_name || '') : null,
        bank_account: code === 'bank' ? (settings.bank_account || '') : null,
        bank_ifsc: code === 'bank' ? (settings.bank_ifsc || '') : null,
        qr_image_url: code.startsWith('qr_') ? (settings[code] ? qrPublicUrl(settings[code]) : '') : null,
        minimum_amount: Number(settings[`${code}_min`] || 100),
        maximum_amount: Number(settings[`${code}_max`] || 100000),
        payment_instructions: settings[`${code}_message`] || '',
        created_at: now, updated_at: now
      };
      const { data: inserted, error: ie } = await supabase.from('rw_payment_methods').insert(row).select('*').single();
      if (ie) throw ie;
      const version = await createPaymentVersion(inserted, now, null);
      await supabase.from('rw_payment_methods').update({ current_version_id: version.id }).eq('id', inserted.id);
    } else if (!existing.current_version_id) {
      const version = await createPaymentVersion(existing, now, null);
      await supabase.from('rw_payment_methods').update({ current_version_id: version.id }).eq('id', existing.id);
    }
  }
}

async function createPaymentVersion(method, validFrom, validUntil) {
  const row = {
    payment_method_id: method.id,
    method_code: method.method_code,
    holder_name: method.holder_name || '',
    upi_id: method.upi_id || null,
    bank_name: method.bank_name || null,
    bank_account: method.bank_account || null,
    bank_ifsc: method.bank_ifsc || null,
    qr_image_url: method.qr_image_url || null,
    minimum_amount: method.minimum_amount == null ? null : Number(method.minimum_amount),
    maximum_amount: method.maximum_amount == null ? null : Number(method.maximum_amount),
    payment_instructions: method.payment_instructions || '',
    valid_from: validFrom || rwDate(),
    valid_until: validUntil || null
  };
  const { data, error } = await supabase.from('rw_payment_method_versions').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

async function getWalletPaymentMethods() {
  await ensureWalletSeeds();
  const { data, error } = await supabase.from('rw_payment_methods').select('*').eq('is_active', true).order('id');
  if (error) throw error;
  const out = [];
  for (const m of data || []) {
    let version = null;
    if (m.current_version_id) {
      const r = await supabase.from('rw_payment_method_versions').select('*').eq('id', m.current_version_id).maybeSingle();
      if (r.error) throw r.error;
      version = r.data;
    }
    out.push({
      id: m.id, method_code: m.method_code, method_name: m.method_name,
      is_active: m.is_active, current_version_id: m.current_version_id, version,
      minimum_amount: version?.minimum_amount ?? m.minimum_amount,
      maximum_amount: version?.maximum_amount ?? m.maximum_amount
    });
  }
  return out;
}

async function getRates() {
  await ensureWalletSeeds();
  const { data, error } = await supabase.from('rw_fun_coin_settings').select('coin_type,rate').order('id');
  if (error) throw error;
  return (data || []).reduce((a, r) => { a[r.coin_type] = Number(r.rate); return a; }, {});
}

async function getLedger(customerId) {
  const { data, error } = await supabase.from('rw_wallet_ledger').select('*').eq('customer_id', customerId).order('id', { ascending: true });
  if (error) throw error;
  return data || [];
}
function ledgerBalance(rows) {
  return roundMoney((rows || []).reduce((sum, r) => {
    const amount = Number(r.amount || 0);
    const type = String(r.entry_type || '').toLowerCase();
    return sum + (type === 'credit' ? amount : type === 'debit' ? -amount : 0);
  }, 0));
}
async function walletSummary(customerId) {
  const ledger = await getLedger(customerId);
  const balance = ledgerBalance(ledger);
  const { data: txs, error } = await supabase.from('rw_transactions').select('*').eq('customer_id', customerId).order('id', { ascending: false });
  if (error) throw error;
  const deposits = (txs || []).filter(t => t.transaction_type === 'deposit');
  const conversions = (txs || []).filter(t => t.transaction_type === 'conversion');
  const totalDeposited = roundMoney(deposits.filter(t => t.status === 'confirmed').reduce((s,t)=>s+Number(t.amount||0),0));
  const totalUsed = roundMoney(conversions.filter(t => t.status === 'confirmed').reduce((s,t)=>s+Number(t.amount||0),0));
  const pending = roundMoney(deposits.filter(t => ['pending','processing'].includes(t.status)).reduce((s,t)=>s+Number(t.amount||0),0));
  return { balance, total_deposited: totalDeposited, total_used: totalUsed, pending_amount: pending, transactions: txs || [], ledger };
}

async function audit(action, actorType, actorId, customerId, transactionId, details={}) {
  const row = { action, actor_type: actorType, actor_id: actorId || null, customer_id: customerId || null, transaction_id: transactionId || null, details, created_at: rwDate() };
  const { error } = await supabase.from('rw_audit_logs').insert(row);
  if (error) console.warn('AUDIT LOG ERROR:', error.message);
}

async function findCustomer(id) {
  const { data, error } = await supabase.from('rw_customers').select('id,client_name,user_id,status,temporary_password,whatsapp_number,telegram_id,created_at,updated_at,last_login_at').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function requireCustomerActive(req, res) {
  const c = await findCustomer(req.customerId);
  if (!c) { res.status(404).json({ error: 'Customer account not found.' }); return null; }
  if (String(c.status).toLowerCase() !== 'active') { res.status(403).json({ error: 'Your account is blocked. Please contact support.' }); return null; }
  return c;
}


// Remove the placeholder route above by routing the real login on a dedicated path alias.
app.post('/api/customer/login-v2', async (req, res) => {
  try {
    const userId = String(req.body?.user_id || '').trim();
    const password = String(req.body?.password || '');
    if (!userId || !password) return res.status(400).json({ error: 'User ID and password are required.' });
    const { data, error } = await supabase.from('rw_customers').select('*').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    if (!data || !verifyCustomerPassword(password, data.password_hash)) return res.status(401).json({ error: 'Invalid User ID or password.' });
    if (String(data.status).toLowerCase() !== 'active') return res.status(403).json({ error: 'Your account is currently blocked. Please contact support.' });
    const now = rwDate();
    await supabase.from('rw_customers').update({ last_login_at: now, updated_at: now }).eq('id', data.id);
    const token = makeToken('customer', data.id, 24);
    res.setHeader('Set-Cookie', `${CUSTOMER_COOKIE}=${token}; Max-Age=86400; ${customerCookieOptionsCrossSite()}`);
    res.json({ ok: true, customer: cleanCustomer({ ...data, last_login_at: now }) });
  } catch (e) { console.error('CUSTOMER LOGIN V2 ERROR:', e); res.status(500).json({ error: 'Could not complete customer login.' }); }
});

// Dashboard data.
app.get('/api/customer/dashboard', customerAuth, async (req, res) => {
  try {
    const customer = await requireCustomerActive(req, res); if (!customer) return;
    const summary = await walletSummary(req.customerId);
    const { data: destinations, error: de } = await supabase.from('rw_customer_destinations').select('*').eq('customer_id', req.customerId).order('id', { ascending: false });
    if (de) throw de;
    const [rates, paymentMethods] = await Promise.all([getRates(), getWalletPaymentMethods()]);
    res.json({ customer: cleanCustomer(customer), balance: summary.balance, total_deposited: summary.total_deposited, total_used: summary.total_used, pending_amount: summary.pending_amount, rates, destinations: destinations || [], payment_methods: paymentMethods, transactions: (summary.transactions || []).slice(0, 100) });
  } catch (e) { console.error('CUSTOMER DASHBOARD ERROR:', e); res.status(500).json({ error: 'Could not load customer dashboard.' }); }
});

app.get('/api/customer/transactions', customerAuth, async (req,res)=>{
  try { const c=await requireCustomerActive(req,res); if(!c)return; const {data,error}=await supabase.from('rw_transactions').select('*').eq('customer_id',req.customerId).order('id',{ascending:false}); if(error)throw error; res.json(data||[]); }
  catch(e){ console.error('CUSTOMER TX ERROR:',e); res.status(500).json({error:'Could not load transaction history.'}); }
});

app.get('/api/customer/destinations', customerAuth, async (req,res)=>{
  try { const c=await requireCustomerActive(req,res); if(!c)return; const {data,error}=await supabase.from('rw_customer_destinations').select('*').eq('customer_id',req.customerId).order('id',{ascending:false}); if(error)throw error; res.json(data||[]); }
  catch(e){res.status(500).json({error:'Could not load saved destinations.'});}
});
app.post('/api/customer/destinations', customerAuth, async (req,res)=>{
  try {
    const c=await requireCustomerActive(req,res); if(!c)return;
    const type=String(req.body?.destination_type||'').toLowerCase();
    if(!['inr','usdt_trc20'].includes(type)) return res.status(400).json({error:'Invalid destination type.'});
    const label=String(req.body?.label||'').trim().slice(0,80);
    const holder=String(req.body?.account_holder_name||'').trim();
    const account=String(req.body?.account_number||'').trim();
    const ifsc=String(req.body?.ifsc||'').trim();
    const wallet=String(req.body?.wallet_address||'').trim();
    if(type==='inr' && (!holder || !account || !ifsc)) return res.status(400).json({error:'Account holder, account number and IFSC are required.'});
    if(type==='usdt_trc20' && !wallet) return res.status(400).json({error:'USDT TRC20 wallet address is required.'});
    const row={customer_id:req.customerId,destination_type:type,label:label||null,account_holder_name:type==='inr'?holder:null,account_number:type==='inr'?account:null,ifsc:type==='inr'?ifsc:null,wallet_address:type==='usdt_trc20'?wallet:null,created_at:rwDate(),updated_at:rwDate()};
    const {data,error}=await supabase.from('rw_customer_destinations').insert(row).select('*').single(); if(error)throw error;
    await audit('destination_create','customer',req.customerId,req.customerId,null,{destination_type:type,label});
    res.status(201).json(data);
  } catch(e){console.error('DEST CREATE ERROR:',e);res.status(500).json({error:'Could not save destination.'});}
});
app.put('/api/customer/destinations/:id', customerAuth, async (req,res)=>{
  try {
    const c=await requireCustomerActive(req,res); if(!c)return;
    const id=Number(req.params.id); if(!Number.isInteger(id))return res.status(400).json({error:'Invalid destination.'});
    const {data:old,error:oe}=await supabase.from('rw_customer_destinations').select('*').eq('id',id).eq('customer_id',req.customerId).maybeSingle(); if(oe)throw oe; if(!old)return res.status(404).json({error:'Destination not found.'});
    const type=String(req.body?.destination_type||old.destination_type).toLowerCase();
    const row={label:String(req.body?.label ?? old.label ?? '').trim().slice(0,80)||null,updated_at:rwDate()};
    if(type==='inr'){row.account_holder_name=String((req.body?.account_holder_name ?? old.account_holder_name ?? '')).trim();row.account_number=String((req.body?.account_number ?? old.account_number ?? '')).trim();row.ifsc=String((req.body?.ifsc ?? old.ifsc ?? '')).trim();row.wallet_address=null;row.destination_type='inr';if(!row.account_holder_name||!row.account_number||!row.ifsc)return res.status(400).json({error:'Account holder, account number and IFSC are required.'});}
    else if(type==='usdt_trc20'){row.wallet_address=String((req.body?.wallet_address ?? old.wallet_address ?? '')).trim();row.account_holder_name=null;row.account_number=null;row.ifsc=null;row.destination_type='usdt_trc20';if(!row.wallet_address)return res.status(400).json({error:'USDT TRC20 wallet address is required.'});}
    else return res.status(400).json({error:'Invalid destination type.'});
    const {data,error}=await supabase.from('rw_customer_destinations').update(row).eq('id',id).eq('customer_id',req.customerId).select('*').single(); if(error)throw error;
    await audit('destination_update','customer',req.customerId,req.customerId,null,{destination_id:id});res.json(data);
  } catch(e){console.error('DEST UPDATE ERROR:',e);res.status(500).json({error:'Could not update destination.'});}
});
app.delete('/api/customer/destinations/:id', customerAuth, async(req,res)=>{
  try{const c=await requireCustomerActive(req,res);if(!c)return;const id=Number(req.params.id);const {data,error}=await supabase.from('rw_customer_destinations').delete().eq('id',id).eq('customer_id',req.customerId).select('id').maybeSingle();if(error)throw error;if(!data)return res.status(404).json({error:'Destination not found.'});await audit('destination_delete','customer',req.customerId,req.customerId,null,{destination_id:id});res.json({ok:true});}
  catch(e){res.status(500).json({error:'Could not delete destination.'});}
});

async function getCurrentPaymentVersion(methodCode, versionId) {
  if (versionId) {
    const {data,error}=await supabase.from('rw_payment_method_versions').select('*').eq('id',Number(versionId)).eq('method_code',methodCode).maybeSingle(); if(error)throw error;if(data)return data;
  }
  const {data:m,error}=await supabase.from('rw_payment_methods').select('*').eq('method_code',methodCode).eq('is_active',true).maybeSingle();if(error)throw error;if(!m)return null;
  if(m.current_version_id){const r=await supabase.from('rw_payment_method_versions').select('*').eq('id',m.current_version_id).maybeSingle();if(r.error)throw r.error;return r.data;}
  return null;
}

app.post('/api/customer/deposits', customerAuth, upload.single('screenshot'), async(req,res)=>{
  try{
    const c=await requireCustomerActive(req,res);if(!c)return;
    if(!req.file)return res.status(400).json({error:'Payment screenshot is required.'});
    const method=String(req.body?.payment_method||'').toLowerCase();const amount=Number(req.body?.amount);const utr=String(req.body?.utr||'').trim();const versionId=Number(req.body?.payment_method_version_id||0)||null;
    if(!Number.isInteger(amount)||amount<=0)return res.status(400).json({error:'Enter a valid payment amount.'});
    if(!utr||utr.length>100)return res.status(400).json({error:'Valid UTR/Transaction ID is required.'});
    const version=await getCurrentPaymentVersion(method,versionId);if(!version)return res.status(400).json({error:'This payment method is not active.'});
    const min=Number(version.minimum_amount||0),max=Number(version.maximum_amount||0);if(min&&amount<min||max&&amount>max)return res.status(400).json({error:`Amount must be between ₹${min} and ₹${max}.`});
    const {data:dup,error:dupe}=await supabase.from('rw_transactions').select('id').eq('utr',utr).maybeSingle();if(dupe)throw dupe;if(dup)return res.status(409).json({error:'This UTR has already been used. Please enter a valid and unused UTR.'});
    const txId=rwTransactionId('DEP');const ext=`${txId}/${crypto.randomBytes(8).toString('hex')}${path.extname(req.file.originalname).toLowerCase()||'.jpg'}`;await uploadFile(SCREENSHOT_BUCKET,req.file,ext);
    const now=rwDate();
    const {data,error}=await supabase.from('rw_transactions').insert({transaction_id:txId,customer_id:req.customerId,transaction_type:'deposit',amount,status:'pending',payment_method:method,payment_method_version_id:version.id,utr,screenshot_path:ext,created_at:now,updated_at:now,rejection_reason:null}).select('*').single();if(error)throw error;
    await audit('deposit_submit','customer',req.customerId,req.customerId,data.id,{transaction_id:txId,amount,method,utr});res.status(201).json({ok:true,transaction:data,message:'Payment will normally be verified within 2–3 minutes, subject to successful verification.'});
  }catch(e){console.error('DEPOSIT ERROR:',e);res.status(500).json({error:'Could not submit payment.'});}
});

async function conversionDebit(customerId, tx) {
  const ledger=await getLedger(customerId);const bal=ledgerBalance(ledger);if(bal < Number(tx.amount))return {ok:false,balance:bal};
  const {data:existing,error:ee}=await supabase.from('rw_wallet_ledger').select('id').eq('transaction_id',tx.id).eq('entry_type','debit').maybeSingle();if(ee)throw ee;if(existing)return {ok:true,balance:bal};
  const {error}=await supabase.from('rw_wallet_ledger').insert({customer_id:customerId,transaction_id:tx.id,entry_type:'debit',amount:Number(tx.amount),description:`Conversion debit ${tx.transaction_id}`,reference:tx.transaction_id,created_at:rwDate()});if(error)throw error;return {ok:true,balance:roundMoney(bal-Number(tx.amount))};
}
async function reverseConversion(customerId, tx, reason) {
  const {data:existing,error:ee}=await supabase.from('rw_wallet_ledger').select('id').eq('transaction_id',tx.id).eq('entry_type','credit').eq('reference',`${tx.transaction_id}-REV`).maybeSingle();if(ee)throw ee;if(existing)return;
  const {error}=await supabase.from('rw_wallet_ledger').insert({customer_id:customerId,transaction_id:tx.id,entry_type:'credit',amount:Number(tx.amount),description:`Conversion reversal: ${reason}`,reference:`${tx.transaction_id}-REV`,created_at:rwDate()});if(error)throw error;
}

app.post('/api/customer/conversions', customerAuth, async(req,res)=>{
  try{
    const c=await requireCustomerActive(req,res);if(!c)return;
    const coin=String(req.body?.coin_type||'').toLowerCase();const quantity=Number(req.body?.coin_quantity);const destinationId=Number(req.body?.destination_id);if(!['inr','usdt_trc20'].includes(coin))return res.status(400).json({error:'Invalid Fun Coin type.'});if(!Number.isFinite(quantity)||quantity<=0)return res.status(400).json({error:'Enter a valid coin amount.'});
    const {data:rateRow,error:re}=await supabase.from('rw_fun_coin_settings').select('rate').eq('coin_type',coin).maybeSingle();if(re)throw re;if(!rateRow)return res.status(400).json({error:'Conversion rate is not configured.'});const rate=Number(rateRow.rate);const amount=roundMoney(quantity*rate);
    const {data:dest,error:de}=await supabase.from('rw_customer_destinations').select('*').eq('id',destinationId).eq('customer_id',req.customerId).maybeSingle();if(de)throw de;if(!dest)return res.status(400).json({error:'Please select a saved destination.'});if(dest.destination_type!==coin)return res.status(400).json({error:'Selected destination does not match the selected Fun Coin.'});
    const txId=rwTransactionId('CON');const now=rwDate();const snapshot={id:dest.id,destination_type:dest.destination_type,label:dest.label,account_holder_name:dest.account_holder_name,account_number:dest.account_number,ifsc:dest.ifsc,wallet_address:dest.wallet_address};
    const {data:tx,error}=await supabase.from('rw_transactions').insert({transaction_id:txId,customer_id:req.customerId,transaction_type:'conversion',amount,coin_type:coin,applied_rate:rate,coin_quantity:quantity,destination_type:coin,destination_snapshot:snapshot,status:'pending',created_at:now,updated_at:now,rejection_reason:null}).select('*').single();if(error)throw error;
    const debit=await conversionDebit(req.customerId,tx);if(!debit.ok){await supabase.from('rw_transactions').delete().eq('id',tx.id);return res.status(400).json({error:'Insufficient available balance for this conversion.'});}
    await audit('conversion_request','customer',req.customerId,req.customerId,tx.id,{transaction_id:txId,coin_type:coin,coin_quantity:quantity,rate,amount,destination_id:dest.id});res.status(201).json({ok:true,transaction:tx,balance:debit.balance,message:'Your Fun Coin conversion will normally be processed and sent to your selected destination within 1 hour.'});
  }catch(e){console.error('CONVERSION ERROR:',e);res.status(500).json({error:'Could not submit conversion.'});}
});

app.post('/api/customer/transactions/:id/cancel', customerAuth, async(req,res)=>{
  try{
    const c=await requireCustomerActive(req,res);if(!c)return;const id=Number(req.params.id);const {data:tx,error}=await supabase.from('rw_transactions').select('*').eq('id',id).eq('customer_id',req.customerId).maybeSingle();if(error)throw error;if(!tx)return res.status(404).json({error:'Transaction not found.'});if(tx.status!=='pending')return res.status(400).json({error:'Only Pending transactions can be cancelled.'});
    const now=rwDate();if(tx.transaction_type==='conversion')await reverseConversion(req.customerId,tx,'Customer cancellation');
    const {data:updated,error:ue}=await supabase.from('rw_transactions').update({status:'cancelled',updated_at:now,processed_at:now}).eq('id',id).eq('status','pending').select('*').maybeSingle();if(ue)throw ue;if(!updated)return res.status(409).json({error:'Transaction status changed. Please refresh.'});await audit('transaction_cancel','customer',req.customerId,req.customerId,id,{transaction_id:tx.transaction_id});res.json({ok:true,transaction:updated});
  }catch(e){console.error('CANCEL ERROR:',e);res.status(500).json({error:'Could not cancel transaction.'});}
});


/* ---------------- Admin wallet APIs ---------------- */
app.get('/api/admin/wallet/stats', auth, async(req,res)=>{
  try{
    const {data:customers,error:ce}=await supabase.from('rw_customers').select('id,status');if(ce)throw ce;const {data:txs,error:te}=await supabase.from('rw_transactions').select('*');if(te)throw te;const {data:ledger,error:le}=await supabase.from('rw_wallet_ledger').select('*');if(le)throw le;
    const balanceByCustomer={};for(const r of ledger||[]){balanceByCustomer[r.customer_id]=(balanceByCustomer[r.customer_id]||0)+(r.entry_type==='credit'?Number(r.amount):r.entry_type==='debit'?-Number(r.amount):0);}
    res.json({total_customers:(customers||[]).length,active_customers:(customers||[]).filter(c=>c.status==='active').length,blocked_customers:(customers||[]).filter(c=>c.status!=='active').length,total_deposits:(txs||[]).filter(t=>t.transaction_type==='deposit'&&t.status==='confirmed').reduce((s,t)=>s+Number(t.amount),0),pending_deposits:(txs||[]).filter(t=>t.transaction_type==='deposit'&&['pending','processing'].includes(t.status)).reduce((s,t)=>s+Number(t.amount),0),pending_conversions:(txs||[]).filter(t=>t.transaction_type==='conversion'&&['pending','processing'].includes(t.status)).length,completed_conversions:(txs||[]).filter(t=>t.transaction_type==='conversion'&&t.status==='confirmed').reduce((s,t)=>s+Number(t.amount),0),total_balance:Object.values(balanceByCustomer).reduce((s,n)=>s+n,0)});
  }catch(e){console.error('WALLET STATS ERROR:',e);res.status(500).json({error:'Could not load wallet statistics.'});}
});
app.get('/api/admin/wallet/transactions', auth, async(req,res)=>{
  try{
    let q=supabase.from('rw_transactions').select('*').order('id',{ascending:false});
    const status=String(req.query.status||'').toLowerCase();const type=String(req.query.type||'').toLowerCase();const customerId=Number(req.query.customer_id||0);const search=String(req.query.search||'').trim();if(status&&status!=='all')q=q.eq('status',status);if(type&&type!=='all')q=q.eq('transaction_type',type);if(customerId)q=q.eq('customer_id',customerId);const {data,error}=await q;if(error)throw error;
    let rows=data||[];if(search){const s=search.toLowerCase();rows=rows.filter(t=>String(t.transaction_id).toLowerCase().includes(s)||String(t.utr||'').toLowerCase().includes(s));}
    const ids=[...new Set(rows.map(t=>t.customer_id))];let customers=[];if(ids.length){const r=await supabase.from('rw_customers').select('id,client_name,user_id').in('id',ids);if(r.error)throw r.error;customers=r.data||[];}const map=new Map(customers.map(c=>[c.id,c]));res.json(rows.map(t=>({...t,customer:map.get(t.customer_id)||null,created_at_ist:ist(t.created_at),updated_at_ist:ist(t.updated_at)})));
  }catch(e){console.error('WALLET TX LIST ERROR:',e);res.status(500).json({error:'Could not load wallet transactions.'});}
});

async function confirmDeposit(tx, actorType='admin', actorId=null) {
  if(tx.status==='confirmed') return;
  const {data:existing,error:ee}=await supabase.from('rw_wallet_ledger').select('id').eq('transaction_id',tx.id).eq('entry_type','credit').maybeSingle();if(ee)throw ee;
  if(!existing){const {error}=await supabase.from('rw_wallet_ledger').insert({customer_id:tx.customer_id,transaction_id:tx.id,entry_type:'credit',amount:Number(tx.amount),description:`Deposit confirmed ${tx.transaction_id}`,reference:tx.transaction_id,created_at:rwDate()});if(error)throw error;}
  const now=rwDate();const {data:updated,error:ue}=await supabase.from('rw_transactions').update({status:'confirmed',updated_at:now,processed_at:now,rejection_reason:null}).eq('id',tx.id).neq('status','confirmed').select('*').maybeSingle();if(ue)throw ue;await audit('deposit_confirm','admin',actorId,tx.customer_id,tx.id,{transaction_id:tx.transaction_id,amount:tx.amount});return updated||tx;
}
async function rejectTransaction(tx, reason, actorId) {
  if(!reason.trim()) throw new Error('Rejection reason is required.');
  if(['confirmed','cancelled'].includes(tx.status)) throw new Error('This transaction is locked and cannot be rejected.');
  if(tx.transaction_type==='conversion') await reverseConversion(tx.customer_id,tx,reason);
  const now=rwDate();const {data:updated,error}=await supabase.from('rw_transactions').update({status:'rejected',rejection_reason:reason.trim(),updated_at:now,processed_at:now}).eq('id',tx.id).in('status',['pending','processing']).select('*').maybeSingle();if(error)throw error;if(!updated)throw new Error('Transaction status changed. Refresh and try again.');await audit('transaction_reject','admin',actorId,tx.customer_id,tx.id,{reason:reason.trim(),transaction_id:tx.transaction_id});return updated;
}
app.put('/api/admin/wallet/transactions/:id', auth, async(req,res)=>{
  try{
    const id=Number(req.params.id);const status=String(req.body?.status||'').toLowerCase();const reason=String(req.body?.rejection_reason||'').trim();const {data:tx,error}=await supabase.from('rw_transactions').select('*').eq('id',id).maybeSingle();if(error)throw error;if(!tx)return res.status(404).json({error:'Transaction not found.'});
    let updated=tx;
    if(status==='processing'){if(!['pending'].includes(tx.status))return res.status(400).json({error:'Only Pending transactions can move to Processing.'});const now=rwDate();const r=await supabase.from('rw_transactions').update({status:'processing',updated_at:now}).eq('id',id).eq('status','pending').select('*').single();if(r.error)throw r.error;updated=r.data;await audit('transaction_processing','admin',null,tx.customer_id,id,{transaction_id:tx.transaction_id});}
    else if(status==='confirmed'){if(tx.transaction_type==='deposit')updated=await confirmDeposit(tx,'admin',null);else{if(!['pending','processing'].includes(tx.status))return res.status(400).json({error:'Transaction is already locked.'});const now=rwDate();const r=await supabase.from('rw_transactions').update({status:'confirmed',updated_at:now,processed_at:now,rejection_reason:null}).eq('id',id).in('status',['pending','processing']).select('*').maybeSingle();if(r.error)throw r.error;if(!r.data)return res.status(409).json({error:'Transaction status changed. Refresh and try again.'});updated=r.data;await audit('conversion_complete','admin',null,tx.customer_id,id,{transaction_id:tx.transaction_id});}}
    else if(status==='rejected')updated=await rejectTransaction(tx,reason,null);
    else return res.status(400).json({error:'Status must be Processing, Confirmed or Rejected.'});
    res.json({ok:true,transaction:updated});
  }catch(e){console.error('WALLET TX UPDATE ERROR:',e);res.status(400).json({error:e.message||'Could not update transaction.'});}
});

app.get('/api/admin/wallet/transactions/:id/screenshot', auth, async(req,res)=>{try{const id=Number(req.params.id);const {data,error}=await supabase.from('rw_transactions').select('screenshot_path').eq('id',id).maybeSingle();if(error)throw error;if(!data?.screenshot_path)return res.sendStatus(404);const signed=await supabase.storage.from(SCREENSHOT_BUCKET).createSignedUrl(data.screenshot_path,10*60);if(signed.error)throw signed.error;res.redirect(signed.data.signedUrl);}catch(e){console.error('WALLET SCREENSHOT ERROR:',e);res.sendStatus(404);}});
app.get('/api/admin/wallet/customer/:id', auth, async(req,res)=>{try{const id=Number(req.params.id);const c=await findCustomer(id);if(!c)return res.status(404).json({error:'Customer not found.'});const s=await walletSummary(id);res.json({customer:cleanCustomer(c),balance:s.balance,total_deposited:s.total_deposited,total_used:s.total_used,pending_amount:s.pending_amount,transactions:s.transactions});}catch(e){res.status(500).json({error:'Could not load customer wallet.'});}});

app.get('/api/admin/wallet/rates', auth, async(req,res)=>{try{res.json({rates:await getRates()});}catch(e){res.status(500).json({error:'Could not load Fun Coin rates.'});}});
app.put('/api/admin/wallet/rates', auth, async(req,res)=>{try{for(const coin of ['inr','usdt_trc20']){if(req.body?.[coin]!==undefined){const rate=Number(req.body[coin]);if(!Number.isFinite(rate)||rate<=0)return res.status(400).json({error:`Invalid rate for ${coin}.`});const {error}=await supabase.from('rw_fun_coin_settings').upsert({coin_type:coin,rate,updated_at:rwDate()},{onConflict:'coin_type'});if(error)throw error;await audit('rate_update','admin',null,null,null,{coin_type:coin,rate});}}res.json({ok:true,rates:await getRates()});}catch(e){res.status(500).json({error:'Could not save Fun Coin rates.'});}});

app.get('/api/admin/wallet/payment-methods', auth, async(req,res)=>{try{res.json(await getWalletPaymentMethods());}catch(e){res.status(500).json({error:'Could not load wallet payment methods.'});}});

app.post('/api/admin/wallet/payment-methods/:code/qr', auth, upload.single('qr'), async(req,res)=>{try{const code=String(req.params.code||'').toLowerCase();if(!['qr_a','qr_b','qr_c'].includes(code))return res.status(400).json({error:'Invalid QR method.'});if(!req.file)return res.status(400).json({error:'QR image is required.'});await ensureWalletSeeds();const {data:m,error:me}=await supabase.from('rw_payment_methods').select('*').eq('method_code',code).maybeSingle();if(me)throw me;if(!m)return res.status(404).json({error:'Payment method not found.'});const now=rwDate();const grace=new Date(Date.now()+30*60*1000).toISOString();if(m.current_version_id)await supabase.from('rw_payment_method_versions').update({valid_until:grace}).eq('id',m.current_version_id).is('valid_until',null);const filePath=`${code}/${crypto.randomBytes(12).toString('hex')}${path.extname(req.file.originalname).toLowerCase()||'.png'}`;await uploadFile(QR_BUCKET,req.file,filePath);const url=qrPublicUrl(filePath);const {data:updated,error:ue}=await supabase.from('rw_payment_methods').update({qr_image_url:url,updated_at:now}).eq('id',m.id).select('*').single();if(ue)throw ue;const version=await createPaymentVersion(updated,now,null);await supabase.from('rw_payment_methods').update({current_version_id:version.id}).eq('id',m.id);await audit('payment_qr_update','admin',null,null,null,{method_code:code,grace_until:grace});res.json({ok:true,qr_url:url,version});}catch(e){console.error('WALLET QR ERROR:',e);res.status(500).json({error:'Could not upload QR code.'});}});
app.put('/api/admin/wallet/payment-methods/:code', auth, async(req,res)=>{
  try{
    const code=String(req.params.code||'').toLowerCase();if(!['upi','qr_a','qr_b','qr_c','bank'].includes(code))return res.status(400).json({error:'Invalid payment method.'});await ensureWalletSeeds();const {data:m,error:me}=await supabase.from('rw_payment_methods').select('*').eq('method_code',code).maybeSingle();if(me)throw me;if(!m)return res.status(404).json({error:'Payment method not found.'});
    const now=rwDate();const grace=new Date(Date.now()+30*60*1000).toISOString();if(m.current_version_id){await supabase.from('rw_payment_method_versions').update({valid_until:grace}).eq('id',m.current_version_id).is('valid_until',null);}
    const body=req.body||{};const row={holder_name:String(body.holder_name??m.holder_name??''),upi_id:code==='upi'?String(body.upi_id??m.upi_id??''):null,bank_name:code==='bank'?String(body.bank_name??m.bank_name??''):null,bank_account:code==='bank'?String(body.bank_account??m.bank_account??''):null,bank_ifsc:code==='bank'?String(body.bank_ifsc??m.bank_ifsc??''):null,qr_image_url:String(body.qr_image_url??m.qr_image_url??''),minimum_amount:body.minimum_amount===undefined?m.minimum_amount:Number(body.minimum_amount),maximum_amount:body.maximum_amount===undefined?m.maximum_amount:Number(body.maximum_amount),payment_instructions:String(body.payment_instructions??m.payment_instructions??''),updated_at:now};
    const {data:updated,error:ue}=await supabase.from('rw_payment_methods').update(row).eq('id',m.id).select('*').single();if(ue)throw ue;const version=await createPaymentVersion(updated,now,null);const {error:ve}=await supabase.from('rw_payment_methods').update({current_version_id:version.id}).eq('id',m.id);if(ve)throw ve;await audit('payment_method_update','admin',null,null,null,{method_code:code,grace_until:grace});res.json({ok:true,method:{...updated,current_version_id:version.id,version}});
  }catch(e){console.error('PAYMENT METHOD UPDATE ERROR:',e);res.status(500).json({error:'Could not update payment method.'});}
});

// The existing admin settings endpoint remains available for backward compatibility.

/* ---------------- Admin: existing transactions/settings ---------------- */

app.get('/api/admin/transactions', auth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('transactions').select('*').order('id', { ascending: false });
    if (error) throw error;
    res.json((data || []).map(row => ({ ...row, created_at_ist: ist(row.created_at), updated_at_ist: ist(row.updated_at) })));
  } catch (error) {
    console.error('TRANSACTIONS ERROR:', error);
    res.status(500).json({ error: 'Could not load transactions.' });
  }
});

app.get('/api/admin/transactions/:id/screenshot', auth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('transactions').select('screenshot').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!data?.screenshot) return res.sendStatus(404);
    const signed = await supabase.storage.from(SCREENSHOT_BUCKET).createSignedUrl(data.screenshot, 10 * 60);
    if (signed.error) throw signed.error;
    res.redirect(signed.data.signedUrl);
  } catch (error) {
    console.error('SCREENSHOT ERROR:', error);
    res.sendStatus(404);
  }
});

app.put('/api/admin/settings', auth, async (req, res) => {
  try {
    const allowed = new Set(Object.keys(defaults));
    const rows = Object.entries(req.body || {})
      .filter(([key]) => allowed.has(key))
      .map(([key, value]) => ({ key, value: String(value ?? '') }));
    if (rows.length) {
      const { error } = await supabase.from('settings').upsert(rows, { onConflict: 'key' });
      if (error) throw error;
    }
    res.json({ ok: true, settings: await getSettings() });
  } catch (error) {
    console.error('SETTINGS ERROR:', error);
    res.status(500).json({ error: 'Could not save settings.' });
  }
});

app.post('/api/admin/payment-settings/:method/qr', auth, upload.single('qr'), async (req, res) => {
  try {
    const method = String(req.params.method || '').toLowerCase();
    if (!['qr_a', 'qr_b', 'qr_c'].includes(method)) return res.status(400).json({ error: 'Invalid QR method.' });
    if (!req.file) return res.status(400).json({ error: 'QR image is required.' });
    const filePath = `${method}/${crypto.randomBytes(12).toString('hex')}${path.extname(req.file.originalname).toLowerCase() || '.png'}`;
    await uploadFile(QR_BUCKET, req.file, filePath);
    const { error } = await supabase.from('settings').upsert({ key: method, value: filePath }, { onConflict: 'key' });
    if (error) throw error;
    res.json({ ok: true, qr: filePath, qr_url: qrPublicUrl(filePath) });
  } catch (error) {
    console.error('QR ERROR:', error);
    res.status(500).json({ error: 'Could not upload QR code.' });
  }
});

app.put('/api/admin/transactions/:id', auth, async (req, res) => {
  try {
    const status = String(req.body?.status || '').toLowerCase();
    if (!['pending', 'confirmed', 'rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const now = new Date().toISOString();
    const rejectionReason = String(req.body?.rejection_reason || '').trim();
    if (status === 'rejected' && !rejectionReason) {
      return res.status(400).json({ error: 'Rejection reason is required.' });
    }
    const { error } = await supabase.from('transactions').update({
      status,
      rejection_reason: rejectionReason,
      updated_at: now
    }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true, updated_at: now, updated_at_ist: ist(now) });
  } catch (error) {
    console.error('UPDATE TRANSACTION ERROR:', error);
    res.status(500).json({ error: 'Could not update transaction.' });
  }
});

app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));

async function start() {
  try {
    await ensureDefaults();
    await ensureBuckets();
    await ensureWalletSeeds();
    app.listen(PORT, () => console.log(`RedseWhite Supabase server running on port ${PORT}`));
  } catch (error) {
    console.error('STARTUP ERROR:', error);
    process.exit(1);
  }
}

start();
