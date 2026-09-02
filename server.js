const express = require("express");
const session = require("express-session");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOAD_DIR = path.join(PUBLIC_DIR, "uploads");
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, "redsewhite.db"));
db.pragma("journal_mode=WAL");
db.exec(
  `CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE IF NOT EXISTS admins(id INTEGER PRIMARY KEY,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL);CREATE TABLE IF NOT EXISTS transactions(id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT UNIQUE NOT NULL,amount INTEGER NOT NULL,utr TEXT NOT NULL,screenshot TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,rejection_reason TEXT DEFAULT '',payment_method TEXT NOT NULL DEFAULT 'upi');`
);
try {
  db.prepare(
    "ALTER TABLE transactions ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'upi'"
  ).run();
} catch (e) {
  if (!String(e.message).includes("duplicate column")) throw e;
}
const defaults = {
  upi_id: "",
  upi_holder: "",
  upi_min: "100",
  upi_max: "100000",
  upi_message: "Pay using the UPI details shown above.",
  qr_a: "",
  qr_a_holder: "",
  qr_a_min: "100",
  qr_a_max: "100000",
  qr_a_message: "Scan QR A and complete your payment.",
  qr_b: "",
  qr_b_holder: "",
  qr_b_min: "100",
  qr_b_max: "100000",
  qr_b_message: "Scan QR B and complete your payment.",
  qr_c: "",
  qr_c_holder: "",
  qr_c_min: "100",
  qr_c_max: "100000",
  qr_c_message: "Scan QR C and complete your payment.",
  bank_holder: "",
  bank_name: "",
  bank_account: "",
  bank_ifsc: "",
  bank_min: "100",
  bank_max: "100000",
  bank_message: "Transfer to the bank details shown above.",
  telegram: "",
  whatsapp: "",
};
for (const [k, v] of Object.entries(defaults))
  db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)").run(k, v);
const adminUsername =
  process.env.ADMIN_USER || 'admin';

const adminPassword =
  process.env.ADMIN_PASSWORD || 'CHANGE-ME-IMMEDIATELY';

const existingAdmin =
  db.prepare('SELECT id FROM admins LIMIT 1').get();

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
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret:
      process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 8 * 60 * 60 * 1000,
    },
  })
);
app.use(express.static(PUBLIC_DIR));
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) =>
      cb(
        null,
        crypto.randomBytes(16).toString("hex") +
          path.extname(file.originalname).toLowerCase()
      ),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    cb(null, /^image\/(png|jpeg|webp|gif)$/.test(file.mimetype)),
});
function settings() {
  return Object.fromEntries(
    db
      .prepare("SELECT key,value FROM settings")
      .all()
      .map((r) => [r.key, r.value])
  );
}
function auth(req, res, next) {
  if (req.session.admin) return next();
  res.status(401).json({ error: "Unauthorized" });
}
function code() {
  return "PAY-" + crypto.randomBytes(4).toString("hex").toUpperCase();
}
function ist(iso) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(iso));
}
app.get("/api/public", (req, res) => res.json({ settings: settings() }));
app.post("/api/login", (req, res) => {
  const a = db
    .prepare("SELECT * FROM admins WHERE username=?")
    .get(String(req.body.username || ""));
  if (
    !a ||
    !bcrypt.compareSync(String(req.body.password || ""), a.password_hash)
  )
    return res.status(401).json({ error: "Invalid login" });
  req.session.admin = { id: a.id, username: a.username };
  res.json({ ok: true });
});
app.post("/api/logout", (req, res) =>
  req.session.destroy(() => res.json({ ok: true }))
);
app.get("/api/me", (req, res) =>
  res.json({
    authenticated: !!req.session.admin,
    username: req.session.admin?.username || null,
  })
);
app.post("/api/payment", upload.single("screenshot"), (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ error: "Screenshot is required." });
    const s = settings();
    const method = String(req.body.payment_method || "").toLowerCase();
    const map = {
      upi: { min: s.upi_min, max: s.upi_max },
      qr_a: { min: s.qr_a_min, max: s.qr_a_max },
      qr_b: { min: s.qr_b_min, max: s.qr_b_max },
      qr_c: { min: s.qr_c_min, max: s.qr_c_max },
      bank: { min: s.bank_min, max: s.bank_max },
    };
    if (!map[method])
      return res.status(400).json({ error: "Please select a payment method." });
    const amount = Number(req.body.amount),
      utr = String(req.body.utr || "").trim();
    if (
      !Number.isInteger(amount) ||
      amount < Number(map[method].min) ||
      amount > Number(map[method].max)
    )
      return res
        .status(400)
        .json({
          error: `Amount must be between ₹${map[method].min} and ₹${map[method].max}.`,
        });
    if (!utr || utr.length > 100)
      return res
        .status(400)
        .json({ error: "Valid UTR/Transaction ID is required." });
    let ref;
    do {
      ref = code();
    } while (db.prepare("SELECT 1 FROM transactions WHERE code=?").get(ref));
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO transactions(code,amount,utr,screenshot,status,created_at,updated_at,rejection_reason,payment_method) VALUES(?,?,?,?,?,?,?,?,?)"
    ).run(
      ref,
      amount,
      utr,
      "uploads/" + req.file.filename,
      "pending",
      now,
      now,
      "",
      method
    );
    res.json({
      ok: true,
      code: ref,
      status: "pending",
      submitted_at: now,
      submitted_at_ist: ist(now),
      payment_method: method,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not submit payment." });
  }
});
app.get("/api/status/:code", (req, res) => {
  const t = db
    .prepare(
      "SELECT code,amount,utr,payment_method,status,created_at,updated_at,rejection_reason FROM transactions WHERE code=?"
    )
    .get(String(req.params.code).trim().toUpperCase());
  if (!t) return res.status(404).json({ error: "Transaction not found." });
  res.json({
    ...t,
    created_at_ist: ist(t.created_at),
    updated_at_ist: ist(t.updated_at),
  });
});
app.get("/api/admin/transactions", auth, (req, res) =>
  res.json(
    db
      .prepare("SELECT * FROM transactions ORDER BY id DESC")
      .all()
      .map((t) => ({
        ...t,
        created_at_ist: ist(t.created_at),
        updated_at_ist: ist(t.updated_at),
      }))
  )
);
app.get("/api/admin/transactions/:id/screenshot", auth, (req, res) => {
  const t = db
    .prepare("SELECT screenshot FROM transactions WHERE id=?")
    .get(req.params.id);
  if (!t) return res.sendStatus(404);
  res.sendFile(path.join(PUBLIC_DIR, t.screenshot));
});
app.put("/api/admin/settings", auth, (req, res) => {
  for (const k of Object.keys(defaults))
    if (req.body[k] !== undefined)
      db.prepare("UPDATE settings SET value=? WHERE key=?").run(
        String(req.body[k]),
        k
      );
  res.json({ ok: true, settings: settings() });
});
app.post(
  "/api/admin/payment-settings/:method/qr",
  auth,
  upload.single("qr"),
  (req, res) => {
    const m = String(req.params.method).toLowerCase();
    if (!["qr_a", "qr_b", "qr_c"].includes(m))
      return res.status(400).json({ error: "Invalid QR method." });
    if (!req.file)
      return res.status(400).json({ error: "QR image is required." });
    const p = "uploads/" + req.file.filename;
    db.prepare("UPDATE settings SET value=? WHERE key=?").run(p, m);
    res.json({ ok: true, qr: p });
  }
);
app.put("/api/admin/transactions/:id", auth, (req, res) => {
  const status = req.body.status;
  if (!["pending", "confirmed", "rejected"].includes(status))
    return res.status(400).json({ error: "Invalid status" });
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE transactions SET status=?,rejection_reason=?,updated_at=? WHERE id=?"
  ).run(status, String(req.body.rejection_reason || ""), now, req.params.id);
  res.json({ ok: true, updated_at: now, updated_at_ist: ist(now) });
});
app.get("/admin", (req, res) =>
  res.sendFile(path.join(PUBLIC_DIR, "admin.html"))
);
app.listen(PORT, () => console.log(`RedseWhite running on port ${PORT}`));
