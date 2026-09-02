let cfg = {};

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

const methods = {
  upi: {
    title: 'UPI Payment',
    icon: '💳'
  },

  qr_a: {
    title: 'QR Payment A',
    icon: '▣'
  },

  qr_b: {
    title: 'QR Payment B',
    icon: '▣'
  },

  qr_c: {
    title: 'QR Payment C',
    icon: '▣'
  },

  bank: {
    title: 'Bank Transfer',
    icon: '🏦'
  }
};

function renderPaymentMethods() {
  const container = $('methods');

  if (!container) return;

  let html = '';

  /* =========================
     UPI
  ========================= */

  html += `
    <div class="method">
      <h3>💳 UPI Payment</h3>

      <p>
        <b>UPI ID:</b>
        ${esc(cfg.upi_id || 'Not configured')}
      </p>

      <p>
        <b>Account Holder:</b>
        ${esc(cfg.upi_holder || 'Not configured')}
      </p>

      <p class="limits">
        Minimum: ₹${money(cfg.upi_min)}
        <br>
        Maximum: ₹${money(cfg.upi_max)}
      </p>

      <p>
        ${esc(cfg.upi_message || '')}
      </p>

      <button
        type="button"
        onclick="selectMethod('upi')"
      >
        Use UPI Payment
      </button>
    </div>
  `;


  /* =========================
     QR A
  ========================= */

  html += `
    <div class="method">
      <h3>▣ QR Payment A</h3>

      ${
        cfg.qr_a
          ? `
            <img
              class="qr"
              src="${esc(cfg.qr_a)}"
              alt="QR Payment A"
            >
          `
          : `
            <p>QR Code A is not configured.</p>
          `
      }

      <p>
        <b>Account Holder:</b>
        ${esc(cfg.qr_a_holder || 'Not configured')}
      </p>

      <p class="limits">
        Minimum: ₹${money(cfg.qr_a_min)}
        <br>
        Maximum: ₹${money(cfg.qr_a_max)}
      </p>

      <p>
        ${esc(cfg.qr_a_message || '')}
      </p>

      <button
        type="button"
        onclick="selectMethod('qr_a')"
      >
        Use QR Payment A
      </button>
    </div>
  `;


  /* =========================
     QR B
  ========================= */

  html += `
    <div class="method">
      <h3>▣ QR Payment B</h3>

      ${
        cfg.qr_b
          ? `
            <img
              class="qr"
              src="${esc(cfg.qr_b)}"
              alt="QR Payment B"
            >
          `
          : `
            <p>QR Code B is not configured.</p>
          `
      }

      <p>
        <b>Account Holder:</b>
        ${esc(cfg.qr_b_holder || 'Not configured')}
      </p>

      <p class="limits">
        Minimum: ₹${money(cfg.qr_b_min)}
        <br>
        Maximum: ₹${money(cfg.qr_b_max)}
      </p>

      <p>
        ${esc(cfg.qr_b_message || '')}
      </p>

      <button
        type="button"
        onclick="selectMethod('qr_b')"
      >
        Use QR Payment B
      </button>
    </div>
  `;


  /* =========================
     QR C
  ========================= */

  html += `
    <div class="method">
      <h3>▣ QR Payment C</h3>

      ${
        cfg.qr_c
          ? `
            <img
              class="qr"
              src="${esc(cfg.qr_c)}"
              alt="QR Payment C"
            >
          `
          : `
            <p>QR Code C is not configured.</p>
          `
      }

      <p>
        <b>Account Holder:</b>
        ${esc(cfg.qr_c_holder || 'Not configured')}
      </p>

      <p class="limits">
        Minimum: ₹${money(cfg.qr_c_min)}
        <br>
        Maximum: ₹${money(cfg.qr_c_max)}
      </p>

      <p>
        ${esc(cfg.qr_c_message || '')}
      </p>

      <button
        type="button"
        onclick="selectMethod('qr_c')"
      >
        Use QR Payment C
      </button>
    </div>
  `;


  /* =========================
     BANK
  ========================= */

  html += `
    <div class="method">
      <h3>🏦 Bank Transfer</h3>

      <p>
        <b>Bank Holder:</b>
        ${esc(cfg.bank_holder || 'Not configured')}
      </p>

      <p>
        <b>Bank Name:</b>
        ${esc(cfg.bank_name || 'Not configured')}
      </p>

      <p>
        <b>Account Number:</b>
        ${esc(cfg.bank_account || 'Not configured')}
      </p>

      <p>
        <b>IFSC:</b>
        ${esc(cfg.bank_ifsc || 'Not configured')}
      </p>

      <p class="limits">
        Minimum: ₹${money(cfg.bank_min)}
        <br>
        Maximum: ₹${money(cfg.bank_max)}
      </p>

      <p>
        ${esc(cfg.bank_message || '')}
      </p>

      <button
        type="button"
        onclick="selectMethod('bank')"
      >
        Use Bank Transfer
      </button>
    </div>
  `;

  container.innerHTML = html;
}


/* =========================
   PAYMENT DROPDOWN
========================= */

function renderDropdown() {

  const select = $('payment_method');

  if (!select) return;

  select.innerHTML = `
    <option value="upi">
      UPI Payment
    </option>

    <option value="qr_a">
      QR Payment A
    </option>

    <option value="qr_b">
      QR Payment B
    </option>

    <option value="qr_c">
      QR Payment C
    </option>

    <option value="bank">
      Bank Transfer
    </option>
  `;
}


/* =========================
   SELECT METHOD
========================= */

function selectMethod(method) {

  const select = $('payment_method');

  const amount = $('amount');

  if (!select || !amount) return;

  select.value = method;

  let min = Number(cfg[method + '_min']);

  let max = Number(cfg[method + '_max']);

  if (!Number.isFinite(min) || min <= 0) {
    min = 1;
  }

  if (!Number.isFinite(max) || max <= 0) {
    max = 100000000;
  }

  amount.min = min;

  amount.max = max;

  amount.placeholder =
    `₹${money(min)} - ₹${money(max)}`;
}


/* =========================
   CONTACT
========================= */

function renderContacts() {

  const contacts = $('contacts');

  if (!contacts) return;

  let html = '';

  if (cfg.whatsapp) {

    html += `
      <a
        class="btn"
        href="${esc(cfg.whatsapp)}"
        target="_blank"
        rel="noopener"
      >
        WhatsApp
      </a>
    `;
  }

  if (cfg.telegram) {

    html += `
      <a
        class="btn"
        href="${esc(cfg.telegram)}"
        target="_blank"
        rel="noopener"
      >
        Telegram
      </a>
    `;
  }

  if (!html) {

    html =
      '<p style="color:#777">Support contacts are not configured yet.</p>';
  }

  contacts.innerHTML = html;
}


/* =========================
   LOAD PUBLIC SETTINGS
========================= */

async function loadPublicSettings() {

  const methodsBox = $('methods');

  try {

    const response = await fetch(
      '/api/public?nocache=' + Date.now(),
      {
        method: 'GET',
        cache: 'no-store'
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || 'Unable to load payment settings.'
      );
    }

    cfg = data.settings || {};

    renderDropdown();

    renderPaymentMethods();

    renderContacts();

    selectMethod('upi');

  } catch (error) {

    console.error(
      'Payment settings error:',
      error
    );

    if (methodsBox) {

      methodsBox.innerHTML = `
        <div class="error">
          Payment methods could not be loaded.
          <br>
          Please refresh the page.
        </div>
      `;
    }

    renderDropdown();

    selectMethod('upi');
  }
}


/* =========================
   SUBMIT PAYMENT
========================= */

async function submitPayment(event) {

  event.preventDefault();

  const form = event.target;

  const result = $('result');

  const button =
    form.querySelector('button[type="submit"]');

  if (result) {
    result.innerHTML = '';
  }

  if (button) {
    button.disabled = true;
    button.textContent = 'Submitting...';
  }

  try {

    const formData = new FormData(form);

    const response = await fetch(
      '/api/payment',
      {
        method: 'POST',
        body: formData
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || 'Payment submission failed.'
      );
    }

    if (result) {

      result.innerHTML = `
        <div class="success">

          <b>Payment Submitted Successfully</b>

          <br><br>

          Reference Code:

          <strong>
            ${esc(data.code)}
          </strong>

          <br><br>

          Status:
          <strong>Pending</strong>

          <br><br>

          Please save your reference code.

        </div>
      `;
    }

    form.reset();

    selectMethod('upi');

  } catch (error) {

    if (result) {

      result.innerHTML = `
        <div class="error">
          ${esc(error.message)}
        </div>
      `;
    }

  } finally {

    if (button) {

      button.disabled = false;

      button.textContent =
        'Submit Payment →';
    }
  }
}


/* =========================
   CHECK STATUS
========================= */

async function checkStatus() {

  const input = $('codeSearch');

  const result = $('statusResult');

  if (!input || !result) return;

  const code =
    input.value.trim().toUpperCase();

  if (!code) {

    result.innerHTML = `
      <div class="error">
        Please enter your reference code.
      </div>
    `;

    return;
  }

  result.innerHTML = 'Checking...';

  try {

    const response = await fetch(
      '/api/status/' +
      encodeURIComponent(code) +
      '?nocache=' +
      Date.now(),
      {
        cache: 'no-store'
      }
    );

    const data =
      await response.json();

    if (!response.ok) {

      throw new Error(
        data.error ||
        'Transaction not found.'
      );
    }

    const methodNames = {
      upi: 'UPI Payment',
      qr_a: 'QR Payment A',
      qr_b: 'QR Payment B',
      qr_c: 'QR Payment C',
      bank: 'Bank Transfer'
    };

    result.innerHTML = `
      <div class="status">

        <h3>
          ${esc(data.code)}
        </h3>

        <span class="pill ${esc(data.status)}">
          ${esc(data.status)}
        </span>

        <p>
          <b>Payment Method:</b>
          ${esc(
            methodNames[data.payment_method]
            || data.payment_method
            || '-'
          )}
        </p>

        <p>
          <b>Amount:</b>
          ₹${money(data.amount)}
        </p>

        <p>
          <b>Submitted:</b>
          ${esc(data.created_at_ist || '')}
        </p>

        <p>
          <b>Last Updated:</b>
          ${esc(data.updated_at_ist || '')}
        </p>

        ${
          data.status === 'rejected' &&
          data.rejection_reason
            ? `
              <p>
                <b>Rejection Reason:</b>
                ${esc(data.rejection_reason)}
              </p>
            `
            : ''
        }

      </div>
    `;

  } catch (error) {

    result.innerHTML = `
      <div class="error">
        ${esc(error.message)}
      </div>
    `;
  }
}


/* =========================
   INITIALIZE
========================= */

document.addEventListener(
  'DOMContentLoaded',
  () => {

    const form =
      $('paymentForm');

    if (form) {

      form.addEventListener(
        'submit',
        submitPayment
      );
    }

    const select =
      $('payment_method');

    if (select) {

      select.addEventListener(
        'change',
        () => {
          selectMethod(select.value);
        }
      );
    }

    loadPublicSettings();

  }
);
