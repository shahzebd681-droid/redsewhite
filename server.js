const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'redsewhite.db'));

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  amount INTEGER NOT NULL,
  utr TEXT NOT NULL,
  screenshot TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  rejection_reason TEXT DEFAULT '',
  payment_method TEXT NOT NULL DEFAULT 'upi'
);
`);

/* Old database compatibility */
try {
  db.prepare(
    "ALTER TABLE transactions ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'upi'"
  ).run();
} catch (e) {
  if (!String(e.message).toLowerCase().includes('duplicate column')) {
    throw e;
  }
}

/* Default settings */
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

for (const [key, value] of Object.entries(defaults)) {
  db.prepare(
    'INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)'
  ).run(key, value);
}

/* Admin credentials */
const adminUsername = String(
  process.env.ADMIN_USER || 'admin'
);

const adminPassword = String(
  process.env.ADMIN_PASSWORD ||
  'CHANGE-ME-IMMEDIATELY'
);

const existingAdmin = db
  .prepare('SELECT id FROM admins LIMIT 1')
  .get();

if (!existingAdmin) {

  db.prepare(
    'INSERT INTO admins(username,password_hash) VALUES(?,?)'
  ).run(
    adminUsername,
    bcrypt.hashSync(adminPassword, 12)
  );

  console.log(
    `Admin created: ${adminUsername}`
  );

} else {

  db.prepare(`
    UPDATE admins
    SET username = ?,
        password_hash = ?
    WHERE id = ?
  `).run(
    adminUsername,
    bcrypt.hashSync(adminPassword, 12),
    existingAdmin.id
  );

  console.log(
    `Admin credentials synchronized: ${adminUsername}`
  );
}

app.use(express.json());
app.use(
  express.urlencoded({
    extended: true
  })
);

/* =========================================
   ADMIN AUTH COOKIE
========================================= */

const AUTH_COOKIE = 'rw_admin';

const AUTH_SECRET = String(
  process.env.SESSION_SECRET ||
  crypto.randomBytes(32).toString('hex')
);

function sign(value) {

  return crypto
    .createHmac('sha256', AUTH_SECRET)
    .update(value)
    .digest('hex');

}

function makeAuthToken(admin) {

  const payload = Buffer
    .from(
      JSON.stringify({
        id: admin.id,
        username: admin.username,
        exp: Date.now() +
          8 * 60 * 60 * 1000
      })
    )
    .toString('base64url');

  return `${payload}.${sign(payload)}`;

}

function getCookie(req, name) {

  const cookieHeader =
    req.headers.cookie || '';

  const cookies =
    cookieHeader
      .split(';')
      .map(v => v.trim());

  const prefix = `${name}=`;

  const found =
    cookies.find(v =>
      v.startsWith(prefix)
    );

  return found
    ? found.slice(prefix.length)
    : null;

}

function verifyAuthToken(token) {

  if (
    !token ||
    typeof token !== 'string'
  ) {
    return null;
  }

  const dot =
    token.lastIndexOf('.');

  if (dot <= 0) {
    return null;
  }

  const payload =
    token.slice(0, dot);

  const signature =
    token.slice(dot + 1);

  const expected =
    sign(payload);

  if (
    signature.length !==
    expected.length
  ) {
    return null;
  }

  if (
    !crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    )
  ) {
    return null;
  }

  try {

    const data =
      JSON.parse(
        Buffer
          .from(
            payload,
            'base64url'
          )
          .toString('utf8')
      );

    if (
      !data.exp ||
      Date.now() > data.exp
    ) {
      return null;
    }

    return db
      .prepare(
        'SELECT id,username FROM admins WHERE id=?'
      )
      .get(data.id);

  } catch (e) {

    return null;

  }

}

function getAdmin(req) {

  const token =
    getCookie(
      req,
      AUTH_COOKIE
    );

  return verifyAuthToken(token);

}

function auth(req, res, next) {

  const admin =
    getAdmin(req);

  if (!admin) {

    return res
      .status(401)
      .json({
        error: 'Unauthorized'
      });

  }

  req.admin = admin;

  next();

}

/* =========================================
   STATIC FILES
========================================= */

app.use(
  express.static(PUBLIC_DIR)
);

/* =========================================
   FILE UPLOAD
========================================= */

const upload =
  multer({

    storage:
      multer.diskStorage({

        destination:
          UPLOAD_DIR,

        filename:
          (req, file, cb) => {

            cb(
              null,

              crypto
                .randomBytes(16)
                .toString('hex') +

              path
                .extname(
                  file.originalname
                )
                .toLowerCase()
            );

          }

      }),

    limits: {
      fileSize:
        5 * 1024 * 1024
    },

    fileFilter:
      (req, file, cb) => {

        cb(
          null,

          /^image\/(png|jpeg|webp|gif)$/
            .test(file.mimetype)
        );

      }

  });

/* =========================================
   SETTINGS
========================================= */

function settings() {

  return Object.fromEntries(

    db
      .prepare(
        'SELECT key,value FROM settings'
      )
      .all()
      .map(row => [
        row.key,
        row.value
      ])

  );

}

/* =========================================
   TRANSACTION CODE
========================================= */

function generateCode() {

  return (
    'PAY-' +

    crypto
      .randomBytes(4)
      .toString('hex')
      .toUpperCase()
  );

}

/* =========================================
   INDIA TIME
========================================= */

function ist(iso) {

  return new Intl.DateTimeFormat(
    'en-IN',
    {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'medium'
    }
  ).format(
    new Date(iso)
  );

}

/* =========================================
   PUBLIC SETTINGS
========================================= */

app.get(
  '/api/public',
  (req, res) => {

    res.json({
      settings:
        settings()
    });

  }
);

/* =========================================
   LOGIN
========================================= */

app.post(
  '/api/login',
  (req, res) => {

    try {

      const username =
        String(
          req.body?.username || ''
        ).trim();

      const password =
        String(
          req.body?.password || ''
        );

      console.log(
        `Login attempt: ${username}`
      );

      const admin =
        db
          .prepare(
            'SELECT * FROM admins WHERE username=?'
          )
          .get(username);

      if (
        !admin ||
        !bcrypt.compareSync(
          password,
          admin.password_hash
        )
      ) {

        console.log(
          `Invalid login: ${username}`
        );

        return res
          .status(401)
          .json({
            error:
              'Invalid login'
          });

      }

      const token =
        makeAuthToken(admin);

      const secure =
        process.env.NODE_ENV ===
        'production'
          ? '; Secure'
          : '';

      res.setHeader(
        'Set-Cookie',

        `${AUTH_COOKIE}=${token}; ` +
        `Max-Age=${8 * 60 * 60}; ` +
        `Path=/; ` +
        `HttpOnly; ` +
        `SameSite=Lax` +
        secure
      );

      console.log(
        `Admin login successful: ${admin.username}`
      );

      return res.json({
        ok: true,
        username:
          admin.username
      });

    } catch (error) {

      console.error(
        'LOGIN ERROR:',
        error
      );

      return res
        .status(500)
        .json({
          error:
            'Login failed. Please try again.'
        });

    }

  }
);

/* =========================================
   LOGOUT
========================================= */

app.post(
  '/api/logout',
  (req, res) => {

    const secure =
      process.env.NODE_ENV ===
      'production'
        ? '; Secure'
        : '';

    res.setHeader(
      'Set-Cookie',

      `${AUTH_COOKIE}=; ` +
      `Max-Age=0; ` +
      `Path=/; ` +
      `HttpOnly; ` +
      `SameSite=Lax` +
      secure
    );

    res.json({
      ok: true
    });

  }
);

/* =========================================
   CHECK LOGIN
========================================= */

app.get(
  '/api/me',
  (req, res) => {

    const admin =
      getAdmin(req);

    res.json({

      authenticated:
        !!admin,

      username:
        admin?.username || null

    });

  }
);

/* =========================================
   CUSTOMER PAYMENT SUBMISSION
========================================= */

app.post(
  '/api/payment',
  upload.single('screenshot'),

  (req, res) => {

    try {

      if (!req.file) {

        return res
          .status(400)
          .json({
            error:
              'Screenshot is required.'
          });

      }

      const s =
        settings();

      const method =
        String(
          req.body.payment_method ||
          ''
        ).toLowerCase();

      const limits = {

        upi: {
          min: s.upi_min,
          max: s.upi_max
        },

        qr_a: {
          min: s.qr_a_min,
          max: s.qr_a_max
        },

        qr_b: {
          min: s.qr_b_min,
          max: s.qr_b_max
        },

        qr_c: {
          min: s.qr_c_min,
          max: s.qr_c_max
        },

        bank: {
          min: s.bank_min,
          max: s.bank_max
        }

      };

      if (!limits[method]) {

        return res
          .status(400)
          .json({
            error:
              'Please select a payment method.'
          });

      }

      const amount =
        Number(
          req.body.amount
        );

      const utr =
        String(
          req.body.utr || ''
        ).trim();

      if (
        !Number.isInteger(amount) ||
        amount <
          Number(limits[method].min) ||
        amount >
          Number(limits[method].max)
      ) {

        return res
          .status(400)
          .json({

            error:
              `Amount must be between ₹${limits[method].min} and ₹${limits[method].max}.`

          });

      }

      if (
        !utr ||
        utr.length > 100
      ) {

        return res
          .status(400)
          .json({
            error:
              'Valid UTR/Transaction ID is required.'
          });

      }

      let ref;

      do {

        ref =
          generateCode();

      } while (

        db
          .prepare(
            'SELECT 1 FROM transactions WHERE code=?'
          )
          .get(ref)

      );

      const now =
        new Date().toISOString();

      db.prepare(`
        INSERT INTO transactions
        (
          code,
          amount,
          utr,
          screenshot,
          status,
          created_at,
          updated_at,
          rejection_reason,
          payment_method
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(

        ref,

        amount,

        utr,

        'uploads/' +
          req.file.filename,

        'pending',

        now,

        now,

        '',

        method

      );

      res.json({

        ok: true,

        code: ref,

        status:
          'pending',

        submitted_at:
          now,

        submitted_at_ist:
          ist(now),

        payment_method:
          method

      });

    } catch (error) {

      console.error(
        'PAYMENT ERROR:',
        error
      );

      res
        .status(500)
        .json({
          error:
            'Could not submit payment.'
        });

    }

  }
);

/* =========================================
   CUSTOMER STATUS
========================================= */

app.get(
  '/api/status/:code',
  (req, res) => {

    const transaction =
      db
        .prepare(`
          SELECT
            code,
            amount,
            utr,
            payment_method,
            status,
            created_at,
            updated_at,
            rejection_reason
          FROM transactions
          WHERE code=?
        `)
        .get(
          String(
            req.params.code
          )
            .trim()
            .toUpperCase()
        );

    if (!transaction) {

      return res
        .status(404)
        .json({
          error:
            'Transaction not found.'
        });

    }

    res.json({

      ...transaction,

      created_at_ist:
        ist(
          transaction.created_at
        ),

      updated_at_ist:
        ist(
          transaction.updated_at
        )

    });

  }
);

/* =========================================
   ADMIN TRANSACTIONS
========================================= */

app.get(
  '/api/admin/transactions',
  auth,

  (req, res) => {

    const transactions =
      db
        .prepare(
          'SELECT * FROM transactions ORDER BY id DESC'
        )
        .all();

    res.json(

      transactions.map(
        transaction => ({

          ...transaction,

          created_at_ist:
            ist(
              transaction.created_at
            ),

          updated_at_ist:
            ist(
              transaction.updated_at
            )

        })
      )

    );

  }
);

/* =========================================
   ADMIN SCREENSHOT
========================================= */

app.get(
  '/api/admin/transactions/:id/screenshot',
  auth,

  (req, res) => {

    const transaction =
      db
        .prepare(
          'SELECT screenshot FROM transactions WHERE id=?'
        )
        .get(
          req.params.id
        );

    if (!transaction) {

      return res.sendStatus(
        404
      );

    }

    res.sendFile(
      path.join(
        PUBLIC_DIR,
        transaction.screenshot
      )
    );

  }
);

/* =========================================
   ADMIN PAYMENT SETTINGS
========================================= */

app.put(
  '/api/admin/settings',
  auth,

  (req, res) => {

    for (
      const key of
      Object.keys(defaults)
    ) {

      if (
        req.body[key] !==
        undefined
      ) {

        db.prepare(
          'UPDATE settings SET value=? WHERE key=?'
        ).run(

          String(
            req.body[key]
          ),

          key

        );

      }

    }

    res.json({

      ok: true,

      settings:
        settings()

    });

  }
);

/* =========================================
   QR UPLOAD
========================================= */

app.post(
  '/api/admin/payment-settings/:method/qr',
  auth,

  upload.single('qr'),

  (req, res) => {

    const method =
      String(
        req.params.method
      ).toLowerCase();

    if (
      ![
        'qr_a',
        'qr_b',
        'qr_c'
      ].includes(method)
    ) {

      return res
        .status(400)
        .json({
          error:
            'Invalid QR method.'
        });

    }

    if (!req.file) {

      return res
        .status(400)
        .json({
          error:
            'QR image is required.'
        });

    }

    const qrPath =
      'uploads/' +
      req.file.filename;

    db.prepare(
      'UPDATE settings SET value=? WHERE key=?'
    ).run(
      qrPath,
      method
    );

    res.json({

      ok: true,

      qr:
        qrPath

    });

  }
);

/* =========================================
   UPDATE TRANSACTION STATUS
========================================= */

app.put(
  '/api/admin/transactions/:id',
  auth,

  (req, res) => {

    const status =
      req.body.status;

    if (
      ![
        'pending',
        'confirmed',
        'rejected'
      ].includes(status)
    ) {

      return res
        .status(400)
        .json({
          error:
            'Invalid status'
        });

    }

    const now =
      new Date().toISOString();

    db.prepare(`
      UPDATE transactions
      SET
        status=?,
        rejection_reason=?,
        updated_at=?
      WHERE id=?
    `).run(

      status,

      String(
        req.body.rejection_reason ||
        ''
      ),

      now,

      req.params.id

    );

    res.json({

      ok: true,

      updated_at:
        now,

      updated_at_ist:
        ist(now)

    });

  }
);

/* =========================================
   ADMIN PAGE
========================================= */

app.get(
  '/admin',
  (req, res) => {

    res.sendFile(
      path.join(
        PUBLIC_DIR,
        'admin.html'
      )
    );

  }
);

/* =========================================
   START SERVER
========================================= */

app.listen(
  PORT,
  () => {

    console.log(
      `RedseWhite running on port ${PORT}`
    );

  }
);
