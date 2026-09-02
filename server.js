const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use((req, res, next) => {
  const publicApi =
    req.path === '/api/public' ||
    req.path === '/api/payment' ||
    req.path.startsWith('/api/status/');

  if (publicApi) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  if (req.method === 'OPTIONS' && publicApi) {
    return res.sendStatus(204);
  }

  next();
});
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

function makeAuthToken() {
  const payload = Buffer.from(JSON.stringify({
    user: ADMIN_USER,
    exp: Date.now() + 8 * 60 * 60 * 1000
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function getCookie(req, name) {
  const header = req.headers.cookie || '';
  const item = header.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`));
  return item ? item.slice(name.length + 1) : null;
}

function verifyAuthToken(token) {
  if (!token || typeof token !== 'string') return false;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(payload);
  if (signature.length !== expected.length) return false;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.user === ADMIN_USER && Number(data.exp) > Date.now();
  } catch (_) {
    return false;
  }
}

function auth(req, res, next) {
  if (!verifyAuthToken(getCookie(req, AUTH_COOKIE))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function cookieOptions() {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Lax${secure}`;
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

  // If the QR bucket already existed as private, make it public now.
  // This is required because customer pages use the public QR image URL.
  const qrPublic = await supabase.storage.updateBucket(QR_BUCKET, { public: true });
  if (qrPublic.error) {
    console.warn('QR bucket public setting:', qrPublic.error.message);
  }

  const shots = await supabase.storage.createBucket(SCREENSHOT_BUCKET, { public: false });
  if (shots.error && !/already exists|duplicate/i.test(shots.error.message || '')) {
    console.warn('Screenshot bucket:', shots.error.message);
  }
}

function generateCode() {
  return `PAY-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function ist(iso) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium'
  }).format(new Date(iso));
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

app.get('/api/public', async (req, res) => {
  try {
    const settings = await getSettings();
    for (const key of ['qr_a', 'qr_b', 'qr_c']) {
      settings[`${key}_url`] = qrPublicUrl(settings[key]);
    }
    res.json({ settings });
  } catch (error) {
    console.error('PUBLIC SETTINGS ERROR:', error);
    res.status(500).json({ error: 'Could not load payment settings.' });
  }
});

app.post('/api/login', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (username !== ADMIN_USER || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid login' });
  }
  const token = makeAuthToken();
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=${token}; Max-Age=${8 * 60 * 60}; ${cookieOptions()}`);
  res.json({ ok: true, username: ADMIN_USER });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=; Max-Age=0; ${cookieOptions()}`);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const authenticated = verifyAuthToken(getCookie(req, AUTH_COOKIE));
  res.json({ authenticated, username: authenticated ? ADMIN_USER : null });
});

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
      code,
      amount,
      utr,
      screenshot: screenshotPath,
      payment_method: method,
      status: 'pending',
      rejection_reason: '',
      created_at: now,
      updated_at: now
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
    const { error } = await supabase.from('transactions').update({
      status,
      rejection_reason: String(req.body?.rejection_reason || ''),
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
