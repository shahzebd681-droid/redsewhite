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

const ADMIN_COOKIE = 'rw_admin';
const CUSTOMER_COOKIE = 'rw_customer';

const AUTH_SECRET = String(
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex')
);

const ADMIN_USER = String(process.env.ADMIN_USER || 'admin');
const ADMIN_PASSWORD = String(
  process.env.ADMIN_PASSWORD || 'CHANGE-ME-IMMEDIATELY'
);

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

/* -------------------- COMMON HELPERS -------------------- */

function sign(value) {
  return crypto.createHmac('sha256', AUTH_SECRET).update(value).digest('hex');
}

function makeToken(payloadObject) {
  const payload = Buffer.from(
    JSON.stringify(payloadObject)
  ).toString('base64url');

  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;

  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(payload);

  if (signature.length !== expected.length) return null;

  try {
    if (
      !crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected)
      )
    ) {
      return null;
    }

    const data = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8')
    );

    if (!data || Number(data.exp) <= Date.now()) return null;

    return data;
  } catch (_) {
    return null;
  }
}

function getCookie(req, name) {
  const header = req.headers.cookie || '';

  const item = header
    .split(';')
    .map(v => v.trim())
    .find(v => v.startsWith(`${name}=`));

  return item ? item.slice(name.length + 1) : null;
}

function cookieOptions() {
  const secure =
    process.env.NODE_ENV === 'production' ? '; Secure' : '';

  return `Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function setCookie(res, name, value, maxAgeSeconds) {
  res.setHeader(
    'Set-Cookie',
    `${name}=${value}; Max-Age=${maxAgeSeconds}; ${cookieOptions()}`
  );
}

function clearCookie(res, name) {
  setCookie(res, name, '', 0);
}

function ist(iso) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'medium'
  }).format(new Date(iso));
}

function generateCode() {
  return `PAY-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function generateRedwalletId(prefix) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = crypto.randomBytes(4).toString('base64url').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 6);
  return `RW-${prefix}-${date}-${random}`;
}

/* -------------------- PASSWORD HELPERS -------------------- */

function hashCustomerPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');

  const hash = crypto
    .scryptSync(password, salt, 64)
    .toString('hex');

  return `scrypt:${salt}:${hash}`;
}

function verifyCustomerPassword(password, storedHash) {
  try {
    const parts = String(storedHash || '').split(':');

    if (parts.length !== 3 || parts[0] !== 'scrypt') {
      return false;
    }

    const salt = parts[1];
    const expected = Buffer.from(parts[2], 'hex');

    const actual = crypto.scryptSync(password, salt, 64);

    return (
      expected.length === actual.length &&
      crypto.timingSafeEqual(expected, actual)
    );
  } catch (_) {
    return false;
  }
}

/* -------------------- ADMIN AUTH -------------------- */

function makeAdminToken() {
  return makeToken({
    type: 'admin',
    user: ADMIN_USER,
    exp: Date.now() + 8 * 60 * 60 * 1000
  });
}

function verifyAdminToken(token) {
  const data = verifyToken(token);

  if (!data || data.type !== 'admin') return false;

  return data.user === ADMIN_USER;
}

function auth(req, res, next) {
  if (!verifyAdminToken(getCookie(req, ADMIN_COOKIE))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

/* -------------------- CUSTOMER AUTH -------------------- */

function makeCustomerToken(customer) {
  return makeToken({
    type: 'customer',
    customer_id: customer.id,
    user_id: customer.user_id,
    exp: Date.now() + 24 * 60 * 60 * 1000
  });
}

async function getCustomerFromToken(req) {
  const data = verifyToken(getCookie(req, CUSTOMER_COOKIE));

  if (!data || data.type !== 'customer' || !data.customer_id) {
    return null;
  }

  const { data: customer, error } = await supabase
    .from('rw_customers')
    .select('*')
    .eq('id', data.customer_id)
    .maybeSingle();

  if (error || !customer) return null;

  const status = String(customer.status || 'active').toLowerCase();

  if (status !== 'active') return null;

  return customer;
}

async function requireCustomer(req, res, next) {
  try {
    const customer = await getCustomerFromToken(req);

    if (!customer) {
      return res.status(401).json({ error: 'Customer login required.' });
    }

    req.customer = customer;

    next();
  } catch (error) {
    console.error('CUSTOMER AUTH ERROR:', error);
    return res.status(500).json({ error: 'Unable to verify customer session.' });
  }
}

async function requireCustomerReady(req, res, next) {
  const customer = req.customer;

  if (customer.temporary_password === true) {
    return res.status(403).json({
      error: 'Password reset required.',
      requires_password_reset: true
    });
  }

  next();
}

function publicCustomer(customer) {
  return {
    id: customer.id,
    client_name: customer.client_name,
    user_id: customer.user_id,
    whatsapp: customer.whatsapp || '',
    telegram: customer.telegram || '',
    status: customer.status || 'active',
    temporary_password: customer.temporary_password === true,
    created_at: customer.created_at || null,
    updated_at: customer.updated_at || null
  };
}

/* -------------------- SETTINGS / STORAGE -------------------- */

async function getSettings() {
  const { data, error } = await supabase
    .from('settings')
    .select('key,value');

  if (error) throw error;

  const result = { ...defaults };

  for (const row of data || []) {
    result[row.key] = row.value;
  }

  return result;
}

async function ensureDefaults() {
  const { data, error } = await supabase
    .from('settings')
    .select('key');

  if (error) throw error;

  const existing = new Set(
    (data || []).map(row => row.key)
  );

  const missing = Object.entries(defaults)
    .filter(([key]) => !existing.has(key))
    .map(([key, value]) => ({ key, value }));

  if (missing.length) {
    const { error: insertError } = await supabase
      .from('settings')
      .insert(missing);

    if (insertError) throw insertError;
  }
}

async function ensureBuckets() {
  const qr = await supabase.storage.createBucket(
    QR_BUCKET,
    { public: true }
  );

  if (
    qr.error &&
    !/already exists|duplicate/i.test(qr.error.message || '')
  ) {
    console.warn('QR bucket:', qr.error.message);
  }

  const shots = await supabase.storage.createBucket(
    SCREENSHOT_BUCKET,
    { public: false }
  );

  if (
    shots.error &&
    !/already exists|duplicate/i.test(shots.error.message || '')
  ) {
    console.warn(
      'Screenshot bucket:',
      shots.error.message
    );
  }

  const qrPublic = await supabase.storage.updateBucket(
    QR_BUCKET,
    { public: true }
  );

  if (qrPublic.error) {
    console.warn(
      'QR bucket public setting:',
      qrPublic.error.message
    );
  }
}

async function uploadFile(bucket, file, filename) {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(filename, file.buffer, {
      contentType: file.mimetype,
      upsert: true
    });

  if (error) throw error;

  return filename;
}

function qrPublicUrl(pathname) {
  if (!pathname) return '';

  return supabase.storage
    .from(QR_BUCKET)
    .getPublicUrl(pathname)
    .data.publicUrl;
}

function methodLimits(settings, method) {
  const map = {
    upi: [settings.upi_min, settings.upi_max],
    qr_a: [settings.qr_a_min, settings.qr_a_max],
    qr_b: [settings.qr_b_min, settings.qr_b_max],
    qr_c: [settings.qr_c_min, settings.qr_c_max],
    bank: [settings.bank_min, settings.bank_max]
  };

  const pair = map[method];

  return pair
    ? {
        min: Number(pair[0]),
        max: Number(pair[1])
      }
    : null;
}

/* -------------------- PUBLIC SETTINGS -------------------- */

app.get('/api/public', async (req, res) => {
  try {
    const settings = await getSettings();

    for (const key of ['qr_a', 'qr_b', 'qr_c']) {
      settings[`${key}_url`] = qrPublicUrl(settings[key]);
    }

    res.json({ settings });
  } catch (error) {
    console.error('PUBLIC SETTINGS ERROR:', error);

    res.status(500).json({
      error: 'Could not load payment settings.'
    });
  }
});

/* -------------------- ADMIN LOGIN -------------------- */

app.post('/api/login', (req, res) => {
  const username = String(
    req.body?.username || ''
  ).trim();

  const password = String(
    req.body?.password || ''
  );

  if (
    username !== ADMIN_USER ||
    password !== ADMIN_PASSWORD
  ) {
    return res.status(401).json({
      error: 'Invalid login'
    });
  }

  const token = makeAdminToken();

  setCookie(
    res,
    ADMIN_COOKIE,
    token,
    8 * 60 * 60
  );

  res.json({
    ok: true,
    username: ADMIN_USER
  });
});

app.post('/api/logout', (req, res) => {
  clearCookie(res, ADMIN_COOKIE);

  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const authenticated = verifyAdminToken(
    getCookie(req, ADMIN_COOKIE)
  );

  res.json({
    authenticated,
    username: authenticated
      ? ADMIN_USER
      : null
  });
});

/* -------------------- CUSTOMER LOGIN -------------------- */

app.post('/api/customer/login', async (req, res) => {
  try {
    const userId = String(
      req.body?.user_id || ''
    ).trim();

    const password = String(
      req.body?.password || ''
    );

    if (!userId || !password) {
      return res.status(400).json({
        error: 'User ID and password are required.'
      });
    }

    const { data: customer, error } = await supabase
      .from('rw_customers')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;

    if (!customer) {
      return res.status(401).json({
        error: 'Invalid User ID or password.'
      });
    }

    const status = String(
      customer.status || 'active'
    ).toLowerCase();

    if (status !== 'active') {
      return res.status(403).json({
        error: 'Your account is currently blocked or inactive.'
      });
    }

    if (
      !verifyCustomerPassword(
        password,
        customer.password_hash
      )
    ) {
      return res.status(401).json({
        error: 'Invalid User ID or password.'
      });
    }

    const token = makeCustomerToken(customer);

    setCookie(
      res,
      CUSTOMER_COOKIE,
      token,
      24 * 60 * 60
    );

    const temporary =
      customer.temporary_password === true;

    return res.json({
      ok: true,
      customer: publicCustomer(customer),
      requires_password_reset: temporary
    });
  } catch (error) {
    console.error('CUSTOMER LOGIN ERROR:', error);

    res.status(500).json({
      error: 'Unable to login. Please try again.'
    });
  }
});

app.post('/api/customer/logout', (req, res) => {
  clearCookie(res, CUSTOMER_COOKIE);

  res.json({ ok: true });
});

app.get('/api/customer/me', async (req, res) => {
  try {
    const customer = await getCustomerFromToken(req);

    if (!customer) {
      return res.json({
        authenticated: false,
        customer: null
      });
    }

    res.json({
      authenticated: true,
      customer: publicCustomer(customer),
      requires_password_reset:
        customer.temporary_password === true
    });
  } catch (error) {
    console.error('CUSTOMER ME ERROR:', error);

    res.status(500).json({
      error: 'Unable to load customer session.'
    });
  }
});

/* -------------------- FIRST LOGIN PASSWORD RESET -------------------- */

app.post(
  '/api/customer/change-password',
  requireCustomer,
  async (req, res) => {
    try {
      const oldPassword = String(
        req.body?.old_password || ''
      );

      const newPassword = String(
        req.body?.new_password || ''
      );

      const repeatPassword = String(
        req.body?.repeat_password || ''
      );

      if (
        !oldPassword ||
        !newPassword ||
        !repeatPassword
      ) {
        return res.status(400).json({
          error: 'All password fields are required.'
        });
      }

      if (newPassword !== repeatPassword) {
        return res.status(400).json({
          error: 'New passwords do not match.'
        });
      }

      if (newPassword.length < 8) {
        return res.status(400).json({
          error:
            'New password must be at least 8 characters.'
        });
      }

      const validOldPassword =
        verifyCustomerPassword(
          oldPassword,
          req.customer.password_hash
        );

      if (!validOldPassword) {
        return res.status(400).json({
          error: 'Old password is incorrect.'
        });
      }

      const passwordHash =
        hashCustomerPassword(newPassword);

      const now = new Date().toISOString();

      const { data: updatedCustomer, error } =
        await supabase
          .from('rw_customers')
          .update({
            password_hash: passwordHash,
            temporary_password: false,
            updated_at: now
          })
          .eq('id', req.customer.id)
          .select('*')
          .single();

      if (error) throw error;

      return res.json({
        ok: true,
        customer: publicCustomer(updatedCustomer),
        temporary_password: false
      });
    } catch (error) {
      console.error(
        'CUSTOMER PASSWORD CHANGE ERROR:',
        error
      );

      res.status(500).json({
        error: 'Unable to change password.'
      });
    }
  }
);

/* -------------------- CUSTOMER DASHBOARD GUARD -------------------- */

app.get(
  '/api/customer/dashboard-access',
  requireCustomer,
  requireCustomerReady,
  async (req, res) => {
    res.json({
      ok: true,
      customer: publicCustomer(req.customer)
    });
  }
);

/* -------------------- ADMIN CUSTOMER MANAGEMENT -------------------- */

app.get(
  '/api/admin/customers',
  auth,
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('rw_customers')
        .select('*')
        .order('id', { ascending: false });

      if (error) throw error;

      res.json(
        (data || []).map(publicCustomer)
      );
    } catch (error) {
      console.error(
        'ADMIN CUSTOMERS ERROR:',
        error
      );

      res.status(500).json({
        error: 'Could not load customers.'
      });
    }
  }
);

app.get(
  '/api/admin/customers/:id',
  auth,
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('rw_customers')
        .select('*')
        .eq('id', req.params.id)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        return res.status(404).json({
          error: 'Customer not found.'
        });
      }

      res.json({
        customer: publicCustomer(data)
      });
    } catch (error) {
      console.error(
        'ADMIN CUSTOMER ERROR:',
        error
      );

      res.status(500).json({
        error: 'Could not load customer.'
      });
    }
  }
);

app.post(
  '/api/admin/customers',
  auth,
  async (req, res) => {
    try {
      const clientName = String(
        req.body?.client_name || ''
      ).trim();

      const userId = String(
        req.body?.user_id || ''
      ).trim();

      const temporaryPassword = String(
        req.body?.temporary_password || ''
      );

      const whatsapp = String(
        req.body?.whatsapp || ''
      ).trim();

      const telegram = String(
        req.body?.telegram || ''
      ).trim();

      if (!clientName || !userId || !temporaryPassword) {
        return res.status(400).json({
          error:
            'Client Name, User ID and Temporary Password are required.'
        });
      }

      if (!whatsapp && !telegram) {
        return res.status(400).json({
          error:
            'At least one contact method (WhatsApp or Telegram) is required.'
        });
      }

      if (temporaryPassword.length < 8) {
        return res.status(400).json({
          error:
            'Temporary password must be at least 8 characters.'
        });
      }

      const { data: existing, error: existingError } =
        await supabase
          .from('rw_customers')
          .select('id')
          .eq('user_id', userId)
          .maybeSingle();

      if (existingError) throw existingError;

      if (existing) {
        return res.status(409).json({
          error: 'User ID already exists.'
        });
      }

      const now = new Date().toISOString();

      const customerId =
        generateRedwalletId('CUS');

      const passwordHash =
        hashCustomerPassword(
          temporaryPassword
        );

      const { data: customer, error } =
        await supabase
          .from('rw_customers')
          .insert({
            customer_ref: customerId,
            client_name: clientName,
            user_id: userId,
            password_hash: passwordHash,
            temporary_password: true,
            whatsapp,
            telegram,
            status: 'active',
            created_at: now,
            updated_at: now
          })
          .select('*')
          .single();

      if (error) throw error;

      res.status(201).json({
        ok: true,
        customer: publicCustomer(customer),
        customer_ref: customerId,
        user_id: userId,
        temporary_password: temporaryPassword
      });
    } catch (error) {
      console.error(
        'CREATE CUSTOMER ERROR:',
        error
      );

      res.status(500).json({
        error:
          error.message ||
          'Could not create customer.'
      });
    }
  }
);

app.post(
  '/api/admin/customers/:id/reset-password',
  auth,
  async (req, res) => {
    try {
      const temporaryPassword = String(
        req.body?.temporary_password || ''
      );

      if (temporaryPassword.length < 8) {
        return res.status(400).json({
          error:
            'Temporary password must be at least 8 characters.'
        });
      }

      const passwordHash =
        hashCustomerPassword(
          temporaryPassword
        );

      const now = new Date().toISOString();

      const { data: customer, error } =
        await supabase
          .from('rw_customers')
          .update({
            password_hash: passwordHash,
            temporary_password: true,
            updated_at: now
          })
          .eq('id', req.params.id)
          .select('*')
          .single();

      if (error) throw error;

      res.json({
        ok: true,
        customer: publicCustomer(customer),
        temporary_password: temporaryPassword
      });
    } catch (error) {
      console.error(
        'RESET CUSTOMER PASSWORD ERROR:',
        error
      );

      res.status(500).json({
        error:
          error.message ||
          'Could not reset customer password.'
      });
    }
  }
);

app.put(
  '/api/admin/customers/:id/status',
  auth,
  async (req, res) => {
    try {
      const status = String(
        req.body?.status || ''
      ).toLowerCase();

      if (!['active', 'blocked'].includes(status)) {
        return res.status(400).json({
          error:
            'Status must be active or blocked.'
        });
      }

      const now = new Date().toISOString();

      const { data: customer, error } =
        await supabase
          .from('rw_customers')
          .update({
            status,
            updated_at: now
          })
          .eq('id', req.params.id)
          .select('*')
          .single();

      if (error) throw error;

      res.json({
        ok: true,
        customer: publicCustomer(customer)
      });
    } catch (error) {
      console.error(
        'CUSTOMER STATUS ERROR:',
        error
      );

      res.status(500).json({
        error:
          error.message ||
          'Could not update customer status.'
      });
    }
  }
);

app.delete(
  '/api/admin/customers/:id',
  auth,
  async (req, res) => {
    try {
      const { error } = await supabase
        .from('rw_customers')
        .delete()
        .eq('id', req.params.id);

      if (error) throw error;

      res.json({ ok: true });
    } catch (error) {
      console.error(
        'DELETE CUSTOMER ERROR:',
        error
      );

      res.status(500).json({
        error:
          error.message ||
          'Could not delete customer.'
      });
    }
  }
);

/* -------------------- OLD PAYMENT ROUTES - PRESERVED -------------------- */

app.post(
  '/api/payment',
  upload.single('screenshot'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: 'Screenshot is required.'
        });
      }

      const settings = await getSettings();

      const method = String(
        req.body.payment_method || ''
      ).toLowerCase();

      const limits = methodLimits(
        settings,
        method
      );

      if (!limits) {
        return res.status(400).json({
          error:
            'Please select a payment method.'
        });
      }

      const amount = Number(
        req.body.amount
      );

      const utr = String(
        req.body.utr || ''
      ).trim();

      if (
        !Number.isInteger(amount) ||
        amount < limits.min ||
        amount > limits.max
      ) {
        return res.status(400).json({
          error:
            `Amount must be between ₹${limits.min} and ₹${limits.max}.`
        });
      }

      if (!utr || utr.length > 100) {
        return res.status(400).json({
          error:
            'Valid UTR/Transaction ID is required.'
        });
      }

      /* Global UTR duplicate protection for the existing
         transactions table. */
      const { data: duplicateUtr, error: utrError } =
        await supabase
          .from('transactions')
          .select('id')
          .eq('utr', utr)
          .maybeSingle();

      if (utrError) throw utrError;

      if (duplicateUtr) {
        return res.status(409).json({
          error:
            'This UTR has already been used. Please enter a valid and unused UTR.'
        });
      }

      let code = generateCode();

      for (let i = 0; i < 5; i++) {
        const { data } = await supabase
          .from('transactions')
          .select('id')
          .eq('code', code)
          .maybeSingle();

        if (!data) break;

        code = generateCode();
      }

      const screenshotPath =
        `${code}/${crypto.randomBytes(8).toString('hex')}` +
        `${path.extname(req.file.originalname).toLowerCase() || '.jpg'}`;

      await uploadFile(
        SCREENSHOT_BUCKET,
        req.file,
        screenshotPath
      );

      const now =
        new Date().toISOString();

      const { error } =
        await supabase
          .from('transactions')
          .insert({
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

      res.json({
        ok: true,
        code,
        status: 'pending',
        payment_method: method,
        submitted_at: now,
        submitted_at_ist: ist(now)
      });
    } catch (error) {
      console.error(
        'PAYMENT ERROR:',
        error
      );

      res.status(500).json({
        error:
          'Could not submit payment.'
      });
    }
  }
);

app.get(
  '/api/status/:code',
  async (req, res) => {
    try {
      const code = String(
        req.params.code || ''
      )
        .trim()
        .toUpperCase();

      const { data, error } =
        await supabase
          .from('transactions')
          .select(
            'code,amount,utr,payment_method,status,created_at,updated_at,rejection_reason'
          )
          .eq('code', code)
          .maybeSingle();

      if (error) throw error;

      if (!data) {
        return res.status(404).json({
          error:
            'Transaction not found.'
        });
      }

      res.json({
        ...data,
        created_at_ist:
          ist(data.created_at),
        updated_at_ist:
          ist(data.updated_at)
      });
    } catch (error) {
      console.error(
        'STATUS ERROR:',
        error
      );

      res.status(500).json({
        error:
          'Could not check transaction status.'
      });
    }
  }
);

/* -------------------- ADMIN TRANSACTIONS -------------------- */

app.get(
  '/api/admin/transactions',
  auth,
  async (req, res) => {
    try {
      const { data, error } =
        await supabase
          .from('transactions')
          .select('*')
          .order('id', {
            ascending: false
          });

      if (error) throw error;

      res.json(
        (data || []).map(row => ({
          ...row,
          created_at_ist:
            ist(row.created_at),
          updated_at_ist:
            ist(row.updated_at)
        }))
      );
    } catch (error) {
      console.error(
        'TRANSACTIONS ERROR:',
        error
      );

      res.status(500).json({
        error:
          'Could not load transactions.'
      });
    }
  }
);

app.get(
  '/api/admin/transactions/:id/screenshot',
  auth,
  async (req, res) => {
    try {
      const { data, error } =
        await supabase
          .from('transactions')
          .select('screenshot')
          .eq('id', req.params.id)
          .maybeSingle();

      if (error) throw error;

      if (!data?.screenshot) {
        return res.sendStatus(404);
      }

      const signed =
        await supabase.storage
          .from(SCREENSHOT_BUCKET)
          .createSignedUrl(
            data.screenshot,
            10 * 60
          );

      if (signed.error) {
        throw signed.error;
      }

      res.redirect(
        signed.data.signedUrl
      );
    } catch (error) {
      console.error(
        'SCREENSHOT ERROR:',
        error
      );

      res.sendStatus(404);
    }
  }
);

app.put(
  '/api/admin/settings',
  auth,
  async (req, res) => {
    try {
      const allowed = new Set(
        Object.keys(defaults)
      );

      const rows = Object.entries(
        req.body || {}
      )
        .filter(([key]) =>
          allowed.has(key)
        )
        .map(([key, value]) => ({
          key,
          value: String(
            value ?? ''
          )
        }));

      if (rows.length) {
        const { error } =
          await supabase
            .from('settings')
            .upsert(rows, {
              onConflict: 'key'
            });

        if (error) throw error;
      }

      res.json({
        ok: true,
        settings:
          await getSettings()
      });
    } catch (error) {
      console.error(
        'SETTINGS ERROR:',
        error
      );

      res.status(500).json({
        error:
          'Could not save settings.'
      });
    }
  }
);

app.post(
  '/api/admin/payment-settings/:method/qr',
  auth,
  upload.single('qr'),
  async (req, res) => {
    try {
      const method = String(
        req.params.method || ''
      ).toLowerCase();

      if (
        ![
          'qr_a',
          'qr_b',
          'qr_c'
        ].includes(method)
      ) {
        return res.status(400).json({
          error:
            'Invalid QR method.'
        });
      }

      if (!req.file) {
        return res.status(400).json({
          error:
            'QR image is required.'
        });
      }

      const filePath =
        `${method}/${crypto.randomBytes(12).toString('hex')}` +
        `${path.extname(req.file.originalname).toLowerCase() || '.png'}`;

      await uploadFile(
        QR_BUCKET,
        req.file,
        filePath
      );

      const { error } =
        await supabase
          .from('settings')
          .upsert(
            {
              key: method,
              value: filePath
            },
            {
              onConflict: 'key'
            }
          );

      if (error) throw error;

      res.json({
        ok: true,
        qr: filePath,
        qr_url:
          qrPublicUrl(filePath)
      });
    } catch (error) {
      console.error(
        'QR ERROR:',
        error
      );

      res.status(500).json({
        error:
          'Could not upload QR code.'
      });
    }
  }
);

app.put(
  '/api/admin/transactions/:id',
  auth,
  async (req, res) => {
    try {
      const status = String(
        req.body?.status || ''
      ).toLowerCase();

      if (
        ![
          'pending',
          'processing',
          'confirmed',
          'rejected'
        ].includes(status)
      ) {
        return res.status(400).json({
          error: 'Invalid status.'
        });
      }

      if (
        status === 'rejected' &&
        !String(
          req.body?.rejection_reason || ''
        ).trim()
      ) {
        return res.status(400).json({
          error:
            'Rejection reason is required.'
        });
      }

      const now =
        new Date().toISOString();

      const { error } =
        await supabase
          .from('transactions')
          .update({
            status,
            rejection_reason:
              String(
                req.body?.rejection_reason || ''
              ).trim(),
            updated_at: now
          })
          .eq('id', req.params.id);

      if (error) throw error;

      res.json({
        ok: true,
        updated_at: now,
        updated_at_ist:
          ist(now)
      });
    } catch (error) {
      console.error(
        'UPDATE TRANSACTION ERROR:',
        error
      );

      res.status(500).json({
        error:
          'Could not update transaction.'
      });
    }
  }
);

/* -------------------- ADMIN PAGE -------------------- */

app.get('/admin', (req, res) => {
  res.sendFile(
    path.join(
      PUBLIC_DIR,
      'admin.html'
    )
  );
});

/* -------------------- START -------------------- */

async function start() {
  try {
    await ensureDefaults();
    await ensureBuckets();

    app.listen(PORT, () => {
      console.log(
        `RedseWhite/Redwallet server running on port ${PORT}`
      );
    });
  } catch (error) {
    console.error(
      'STARTUP ERROR:',
      error
    );

    process.exit(1);
  }
}

start();
