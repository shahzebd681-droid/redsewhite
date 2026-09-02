const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'redsewhite.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS transactions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 code TEXT UNIQUE NOT NULL,
 amount INTEGER NOT NULL,
 utr TEXT NOT NULL,
 screenshot TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 rejection_reason TEXT DEFAULT ''
);
`);

const defaults = {
  upi:'', bank:'', account:'', ifsc:'', min:'100', max:'100000', message:'Please pay only within the minimum and maximum limits.',
  telegram:'', whatsapp:'', qr:''
};
for (const [key,value] of Object.entries(defaults)) db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').run(key,value);
if (!db.prepare('SELECT id FROM admins LIMIT 1').get()) {
  const username = process.env.ADMIN_USER || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'CHANGE-ME-IMMEDIATELY';
  db.prepare('INSERT INTO admins(username,password_hash) VALUES(?,?)').run(username, bcrypt.hashSync(password, 12));
  console.log(`Admin created: ${username}. Set ADMIN_USER and ADMIN_PASSWORD before production.`);
}

app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(session({secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'), resave:false, saveUninitialized:false, cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:8*60*60*1000}}));
app.use(express.static(path.join(__dirname,'public')));

const upload = multer({
  storage: multer.diskStorage({destination:UPLOAD_DIR, filename:(req,file,cb)=>cb(null, crypto.randomBytes(16).toString('hex') + path.extname(file.originalname).toLowerCase())}),
  limits:{fileSize:5*1024*1024},
  fileFilter:(req,file,cb)=>cb(null,/^image\/(png|jpeg|webp|gif)$/.test(file.mimetype))
});

function settings(){ return Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(r=>[r.key,r.value])); }
function auth(req,res,next){ if(req.session.admin) return next(); return res.status(401).json({error:'Unauthorized'}); }
function code(){ return 'PAY-' + crypto.randomBytes(4).toString('hex').toUpperCase(); }

app.get('/api/public', (req,res)=>res.json({settings:settings()}));
app.post('/api/login',(req,res)=>{
  const {username,password}=req.body||{}; const a=db.prepare('SELECT * FROM admins WHERE username=?').get(username||'');
  if(!a || !bcrypt.compareSync(password||'',a.password_hash)) return res.status(401).json({error:'Invalid login'});
  req.session.admin={id:a.id,username:a.username}; res.json({ok:true});
});
app.post('/api/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/me',(req,res)=>res.json({authenticated:!!req.session.admin,username:req.session.admin?.username||null}));

app.post('/api/payment', upload.single('screenshot'), (req,res)=>{
  try {
    if(!req.file) return res.status(400).json({error:'Screenshot is required.'});
    const s=settings(), amount=Number(req.body.amount), utr=String(req.body.utr||'').trim();
    if(!Number.isInteger(amount) || amount<Number(s.min) || amount>Number(s.max)) return res.status(400).json({error:`Amount must be between ₹${s.min} and ₹${s.max}.`});
    if(!utr || utr.length>100) return res.status(400).json({error:'Valid UTR/Transaction ID is required.'});
    let ref; do { ref=code(); } while(db.prepare('SELECT 1 FROM transactions WHERE code=?').get(ref));
    const now=new Date().toISOString();
    db.prepare('INSERT INTO transactions(code,amount,utr,screenshot,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(ref,amount,utr,'/uploads/'+req.file.filename,'pending',now,now);
    res.json({ok:true,code:ref,status:'pending'});
  } catch(e){ console.error(e); res.status(500).json({error:'Could not submit payment.'}); }
});

app.get('/api/status/:code',(req,res)=>{
  const t=db.prepare('SELECT code,amount,status,created_at,updated_at,rejection_reason FROM transactions WHERE code=?').get(String(req.params.code).trim().toUpperCase());
  if(!t) return res.status(404).json({error:'Transaction not found.'});
  res.json(t);
});

app.get('/api/admin/transactions',auth,(req,res)=>res.json(db.prepare('SELECT * FROM transactions ORDER BY id DESC').all()));
app.get('/api/admin/transactions/:id/screenshot',auth,(req,res)=>{const t=db.prepare('SELECT screenshot FROM transactions WHERE id=?').get(req.params.id); if(!t)return res.sendStatus(404); res.sendFile(path.join(__dirname,'public',t.screenshot));});
app.put('/api/admin/settings',auth,(req,res)=>{for(const k of Object.keys(defaults)){if(req.body[k]!==undefined) db.prepare('UPDATE settings SET value=? WHERE key=?').run(String(req.body[k]),k)} res.json({ok:true,settings:settings()});});
app.post('/api/admin/qr', auth, upload.single('qr'), (req,res)=>{ if(!req.file)return res.status(400).json({error:'QR image is required.'}); db.prepare('UPDATE settings SET value=? WHERE key=?').run('/uploads/'+req.file.filename,'qr'); res.json({ok:true,qr:'/uploads/'+req.file.filename}); });
app.put('/api/admin/transactions/:id',auth,(req,res)=>{const status=req.body.status; if(!['pending','confirmed','rejected'].includes(status))return res.status(400).json({error:'Invalid status'}); db.prepare('UPDATE transactions SET status=?, rejection_reason=?, updated_at=? WHERE id=?').run(status,String(req.body.rejection_reason||''),new Date().toISOString(),req.params.id); res.json({ok:true});});

app.get('/admin', (req,res)=>res.sendFile(path.join(__dirname,'public','admin.html')));
app.listen(PORT,()=>console.log(`RedseWhite running on http://localhost:${PORT}`));
