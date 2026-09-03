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
    req.path.startsWith('/api/status/');

  const customerApi =
    req.path.startsWith('/api/customer/');

  const customerOrigin = 'https://redsewhite-customer.onrender.com';

  if (publicApi) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  if (customerApi) {
    const origin = req.headers.origin;

    if (origin === customerOrigin) {
      res.setHeader('Access-Control-Allow-Origin', customerOrigin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Vary', 'Origin');
    }
  }

  if (req.method === 'OPTIONS' && (publicApi || customerApi)) {
    return res.sendStatus(204);
  }

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
  return 'Path=/; HttpOnly; SameSite=None; Secure';
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
    app.listen(PORT, () => console.log(`RedseWhite Supabase server running on port ${PORT}`));
  } catch (error) {
    console.error('STARTUP ERROR:', error);
    process.exit(1);
  }
}

start();
