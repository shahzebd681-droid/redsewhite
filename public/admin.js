const $ = (id) => document.getElementById(id);

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));

const money = (value) =>
  Number(value || 0).toLocaleString('en-IN');

let settings = {};

const methods = {
  upi: [
    'UPI Payment',
    [
      ['upi_id', 'UPI ID'],
      ['upi_holder', 'UPI Account Holder Name'],
      ['upi_min', 'Minimum Amount'],
      ['upi_max', 'Maximum Amount'],
      ['upi_message', 'Payment Instructions']
    ]
  ],

  qr_a: [
    'QR Payment A',
    [
      ['qr_a_holder', 'Account Holder Name A'],
      ['qr_a_min', 'Minimum Amount'],
      ['qr_a_max', 'Maximum Amount'],
      ['qr_a_message', 'Payment Instructions']
    ]
  ],

  qr_b: [
    'QR Payment B',
    [
      ['qr_b_holder', 'Account Holder Name B'],
      ['qr_b_min', 'Minimum Amount'],
      ['qr_b_max', 'Maximum Amount'],
      ['qr_b_message', 'Payment Instructions']
    ]
  ],

  qr_c: [
    'QR Payment C',
    [
      ['qr_c_holder', 'Account Holder Name C'],
      ['qr_c_min', 'Minimum Amount'],
      ['qr_c_max', 'Maximum Amount'],
      ['qr_c_message', 'Payment Instructions']
    ]
  ],

  bank: [
    'Bank Transfer',
    [
      ['bank_holder', 'Bank Holder Name'],
      ['bank_name', 'Bank Name'],
      ['bank_account', 'Account Number'],
      ['bank_ifsc', 'IFSC Code'],
      ['bank_min', 'Minimum Amount'],
      ['bank_max', 'Maximum Amount'],
      ['bank_message', 'Payment Instructions']
    ]
  ]
};


/* =========================
   API HELPER
========================= */

async function api(url, options = {}) {
  const config = {
    ...options,
    credentials: 'include'
  };

  if (!(options.body instanceof FormData)) {
    config.headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
  }

  const response = await fetch(url, config);

  const data = await response
    .json()
    .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error || `Request failed (${response.status})`
    );
  }

  return data;
}


/* =========================
   SHOW / HIDE LOGIN
========================= */

function showDashboard() {
  const login = $('login');
  const panel = $('panel');

  if (login) {
    login.hidden = true;
    login.style.display = 'none';
  }

  if (panel) {
    panel.hidden = false;
    panel.style.display = 'block';
  }

  loadSettings();
  loadTxs();
}


function showLogin() {
  const login = $('login');
  const panel = $('panel');

  if (login) {
    login.hidden = false;
    login.style.display = '';
  }

  if (panel) {
    panel.hidden = true;
    panel.style.display = 'none';
  }
}


/* =========================
   LOGIN
========================= */

async function login(event) {
  event.preventDefault();

  const username = $('username').value.trim();
  const password = $('password').value;

  if (!username || !password) {
    alert('Username and password required.');
    return;
  }

  const button =
    event.submitter ||
    document.querySelector('#loginForm button');

  if (button) {
    button.disabled = true;
    button.textContent = 'Logging in...';
  }

  try {
    await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        username,
        password
      })
    });

    /*
      Login successful.

      Force the browser to reload /admin.
      This makes sure the newly-created session
      is used by the dashboard.
    */

    window.location.replace('/admin');

  } catch (error) {

    alert(error.message);

    if (button) {
      button.disabled = false;
      button.textContent = 'Login';
    }
  }
}


/* =========================
   LOGOUT
========================= */

async function logout() {
  try {
    await api('/api/logout', {
      method: 'POST'
    });
  } catch (error) {
    console.log(error);
  }

  window.location.replace('/admin');
}


/* =========================
   BUILD PAYMENT CARDS
========================= */

function buildCards() {

  const container = $('settingsCards');

  if (!container) return;

  let html = '';

  for (const [method, data] of Object.entries(methods)) {

    html += `
      <div class="admin-method">

        <h3>${esc(data[0])}</h3>
    `;

    for (const field of data[1]) {

      const key = field[0];
      const label = field[1];

      const isNumber =
        key.includes('_min') ||
        key.includes('_max');

      html += `
        <label>
          ${esc(label)}

          <input
            id="${esc(key)}"
            type="${isNumber ? 'number' : 'text'}"
            value="${esc(settings[key] || '')}"
          >
        </label>
      `;
    }


    /* QR upload */

    if (
      method === 'qr_a' ||
      method === 'qr_b' ||
      method === 'qr_c'
    ) {

      html += `
        <label>
          Upload ${esc(data[0])} QR

          <input
            id="${method}_file"
            type="file"
            accept="image/png,image/jpeg,image/webp"
          >
        </label>
      `;
    }


    /* Current QR preview */

    if (
      method === 'qr_a' ||
      method === 'qr_b' ||
      method === 'qr_c'
    ) {

      const qrValue = settings[method] || '';

      if (qrValue) {

        html += `
          <div style="margin-top:12px">
            <img
              src="${esc(qrValue)}"
              alt="${esc(data[0])}"
              style="
                width:160px;
                height:160px;
                object-fit:contain;
                background:#fff;
                padding:8px;
                border-radius:10px;
              "
            >
          </div>
        `;
      }
    }


    html += `
      </div>
    `;
  }

  container.innerHTML = html;
}


/* =========================
   LOAD SETTINGS
========================= */

async function loadSettings() {

  try {

    const data = await api('/api/public');

    settings = data.settings || {};

    buildCards();

    if ($('telegram')) {
      $('telegram').value =
        settings.telegram || '';
    }

    if ($('whatsapp')) {
      $('whatsapp').value =
        settings.whatsapp || '';
    }

  } catch (error) {

    console.error(
      'Settings error:',
      error
    );
  }
}


/* =========================
   SAVE PAYMENT SETTINGS
========================= */

async function saveSettings(event) {

  event.preventDefault();

  try {

    const body = {};

    for (const data of Object.values(methods)) {

      for (const field of data[1]) {

        const input = $(field[0]);

        if (input) {
          body[field[0]] = input.value;
        }
      }
    }


    await api('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(body)
    });


    /* Upload QR A/B/C */

    for (
      const method of [
        'qr_a',
        'qr_b',
        'qr_c'
      ]
    ) {

      const fileInput =
        $(`${method}_file`);

      if (
        fileInput &&
        fileInput.files &&
        fileInput.files[0]
      ) {

        const formData =
          new FormData();

        formData.append(
          'qr',
          fileInput.files[0]
        );

        await api(
          `/api/admin/payment-settings/${method}/qr`,
          {
            method: 'POST',
            body: formData
          }
        );
      }
    }


    alert(
      'Payment settings saved successfully.'
    );

    await loadSettings();

  } catch (error) {

    alert(error.message);
  }
}


/* =========================
   SAVE CONTACT
========================= */

async function saveContacts(event) {

  if (event) {
    event.preventDefault();
  }

  try {

    await api('/api/admin/settings', {
      method: 'PUT',

      body: JSON.stringify({
        telegram:
          $('telegram')?.value || '',

        whatsapp:
          $('whatsapp')?.value || ''
      })
    });

    alert(
      'Contact settings saved successfully.'
    );

  } catch (error) {

    alert(error.message);
  }
}


/* =========================
   TRANSACTIONS
========================= */

async function loadTxs() {

  try {

    const txs =
      await api(
        '/api/admin/transactions'
      );


    const counts = {
      pending: 0,
      confirmed: 0,
      rejected: 0
    };


    txs.forEach((transaction) => {

      if (
        counts[
          transaction.status
        ] !== undefined
      ) {
        counts[
          transaction.status
        ]++;
      }
    });


    if ($('totalStat')) {
      $('totalStat').textContent =
        txs.length;
    }

    if ($('pendingStat')) {
      $('pendingStat').textContent =
        counts.pending;
    }

    if ($('confirmedStat')) {
      $('confirmedStat').textContent =
        counts.confirmed;
    }

    if ($('rejectedStat')) {
      $('rejectedStat').textContent =
        counts.rejected;
    }


    const container = $('txs');

    if (!container) return;


    if (!txs.length) {

      container.innerHTML =
        '<p>No transactions yet.</p>';

      return;
    }


    container.innerHTML = `
      <div class="tablewrap">

        <table>

          <tr>
            <th>Reference</th>
            <th>Method</th>
            <th>Amount</th>
            <th>UTR</th>
            <th>Status</th>
            <th>Submitted</th>
            <th>Updated</th>
            <th>Action</th>
          </tr>

          ${txs.map((transaction) => `

            <tr>

              <td>
                <b>
                  ${esc(transaction.code)}
                </b>
              </td>

              <td>
                ${esc(
                  transaction.payment_method ||
                  '-'
                )}
              </td>

              <td>
                ₹${money(transaction.amount)}
              </td>

              <td>
                ${esc(transaction.utr)}
              </td>

              <td>
                <span
                  class="pill ${esc(
                    transaction.status
                  )}"
                >
                  ${esc(
                    transaction.status
                  )}
                </span>
              </td>

              <td>
                ${formatDateTime(
                  transaction.created_at_ist ||
                  transaction.created_at
                )}
              </td>

              <td>
                ${formatDateTime(
                  transaction.updated_at_ist ||
                  transaction.updated_at
                )}
              </td>

              <td>

                <a
                  href="/api/admin/transactions/${transaction.id}/screenshot"
                  target="_blank"
                >
                  Screenshot
                </a>

                <br><br>

                <button
                  class="mini-btn"
                  onclick="setStatus(${transaction.id}, 'pending')"
                >
                  Pending
                </button>

                <button
                  class="mini-btn confirm"
                  onclick="setStatus(${transaction.id}, 'confirmed')"
                >
                  Confirm
                </button>

                <button
                  class="mini-btn reject"
                  onclick="setStatus(${transaction.id}, 'rejected')"
                >
                  Reject
                </button>

              </td>

            </tr>

          `).join('')}

        </table>

      </div>
    `;

  } catch (error) {

    const container = $('txs');

    if (container) {
      container.textContent =
        error.message;
    }
  }
}


/* =========================
   DATE / TIME
========================= */

function formatDateTime(value) {

  if (!value) {
    return '-';
  }

  /*
    If server already sends IST text,
    don't convert it again.
  */

  if (
    typeof value === 'string' &&
    value.includes('IST')
  ) {
    return value;
  }


  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return String(value);
  }


  return new Intl.DateTimeFormat(
    'en-IN',
    {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'medium'
    }
  ).format(date) + ' IST';
}


/* =========================
   CHANGE TRANSACTION STATUS
========================= */

async function setStatus(
  id,
  status
) {

  let reason = '';

  if (status === 'rejected') {

    reason =
      prompt(
        'Rejection reason:'
      ) || '';
  }


  try {

    await api(
      `/api/admin/transactions/${id}`,
      {
        method: 'PUT',

        body: JSON.stringify({
          status,
          rejection_reason:
            reason
        })
      }
    );


    await loadTxs();

  } catch (error) {

    alert(error.message);
  }
}


/* =========================
   INITIALIZE
========================= */

async function boot() {

  try {

    const me =
      await api('/api/me');

    if (me.authenticated) {

      showDashboard();

    } else {

      showLogin();
    }

  } catch (error) {

    console.log(
      'Not authenticated'
    );

    showLogin();
  }
}


/* =========================
   EVENT LISTENERS
========================= */

document.addEventListener(
  'DOMContentLoaded',
  () => {

    const loginForm =
      $('loginForm');

    if (loginForm) {

      loginForm.addEventListener(
        'submit',
        login
      );
    }


    const logoutButton =
      $('logout');

    if (logoutButton) {

      logoutButton.addEventListener(
        'click',
        logout
      );
    }


    const settingsForm =
      $('settingsForm');

    if (settingsForm) {

      settingsForm.addEventListener(
        'submit',
        saveSettings
      );
    }


    const contactButton =
      document.querySelector(
        '#contactSave'
      );

    if (contactButton) {

      contactButton.addEventListener(
        'click',
        saveContacts
      );
    }


    boot();
  }
);
