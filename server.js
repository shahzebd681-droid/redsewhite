a.username };
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
    const s = settings(),
      amount = Number(req.body.amount),
      utr = String(req.body.utr || "").trim();
    if (
      !Number.isInteger(amount) ||
      amount < Number(s.min) ||
      amount > Number(s.max)
    )
      return res
        .status(400)
        .json({ error: `Amount must be between ₹${s.min} and ₹${s.max}.` });
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
      "INSERT INTO transactions(code,amount,utr,screenshot,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)"
    ).run(
      ref,
      amount,
      utr,
      "/uploads/" + req.file.filename,
      "pending",
      now,
      now
    );
    res.json({ ok: true, code: ref, status: "pending" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not submit payment." });
  }
});

app.get("/api/status/:code", (req, res) => {
  const t = db
    .prepare(
      "SELECT code,amount,status,created_at,updated_at,rejection_reason FROM transactions WHERE code=?"
    )
    .get(String(req.params.code).trim().toUpperCase());
  if (!t) return res.status(404).json({ error: "Transaction not found." });
  res.json(t);
});

app.get("/api/admin/transactions", auth, (req, res) =>
  res.json(db.prepare("SELECT * FROM transactions ORDER BY id DESC").all())
);
app.get("/api/admin/transactions/:id/screenshot", auth, (req, res) => {
  const t = db
    .prepare("SELECT screenshot FROM transactions WHERE id=?")
    .get(req.params.id);
  if (!t) return res.sendStatus(404);
  res.sendFile(path.join(__dirname, t.screenshot));
});
app.put("/api/admin/settings", auth, (req, res) => {
  for (const k of Object.keys(defaults)) {
    if (req.body[k] !== undefined)
      db.prepare("UPDATE settings SET value=? WHERE key=?").run(
        String(req.body[k]),
        k
      );
  }
  res.json({ ok: true, settings: settings() });
});
app.post("/api/admin/qr", auth, upload.single("qr"), (req, res) => {
  if (!req.file)
    return res.status(400).json({ error: "QR image is required." });
  db.prepare("UPDATE settings SET value=? WHERE key=?").run(
    "/uploads/" + req.file.filename,
    "qr"
  );
  res.json({ ok: true, qr: "/uploads/" + req.file.filename });
});
app.put("/api/admin/transactions/:id", auth, (req, res) => {
  const status = req.body.status;
  if (!["pending", "confirmed", "rejected"].includes(status))
    return res.status(400).json({ error: "Invalid status" });
  db.prepare(
    "UPDATE transactions SET status=?, rejection_reason=?, updated_at=? WHERE id=?"
  ).run(
    status,
    String(req.body.rejection_reason || ""),
    new Date().toISOString(),
    req.params.id
  );
  res.json({ ok: true });
});

app.listen(PORT, () =>
  console.log(`RedseWhite running on http://localhost:${PORT}`)
);
