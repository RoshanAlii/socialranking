(() => {
  'use strict';

  const EXPECTED_HASH = '1d8e04f4091afdc613f852472e8a10d69f8f7829e6456111ef45c2b785aa80e2';
  const SESSION_KEY = 'kirpa-social-auth-v2';
  const EMPLOYEE_EMBED_KEY = 'kirpa-employee-embed-v1';

  const style = document.createElement('style');
  style.id = 'kirpa-auth-style';
  style.textContent = `
    html.kirpa-auth-pending body > *:not(#kirpa-auth-gate) {
      visibility: hidden !important;
    }
    html.kirpa-auth-pending,
    html.kirpa-auth-pending body {
      margin: 0 !important;
      min-height: 100% !important;
      background: #f6f3ee !important;
    }
    #kirpa-auth-gate {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: grid;
      place-items: center;
      padding: 24px;
      background:
        radial-gradient(circle at 85% 8%, rgba(241, 90, 41, .13), transparent 27rem),
        #f6f3ee;
      color: #171717;
      font-family: Manrope, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    #kirpa-auth-gate * { box-sizing: border-box; }
    .kirpa-auth-card {
      width: min(430px, 100%);
      padding: 34px;
      border: 1px solid #e8ddd2;
      border-radius: 22px;
      background: #fff;
      box-shadow: 0 24px 70px rgba(52, 35, 25, .12);
    }
    .kirpa-auth-mark {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      margin-bottom: 24px;
      color: #f15a29;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    .kirpa-auth-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: #f15a29;
      box-shadow: 0 0 0 5px rgba(241, 90, 41, .13);
    }
    .kirpa-auth-card h1 {
      margin: 0 0 10px;
      font: 700 28px/1.15 Manrope, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: -.035em;
    }
    .kirpa-auth-card p {
      margin: 0 0 24px;
      color: #796f68;
      font-size: 14px;
      line-height: 1.55;
    }
    .kirpa-auth-label {
      display: block;
      margin-bottom: 8px;
      font-size: 12px;
      font-weight: 800;
    }
    .kirpa-auth-field {
      display: flex;
      gap: 10px;
    }
    .kirpa-auth-field input {
      min-width: 0;
      flex: 1;
      height: 46px;
      padding: 0 14px;
      border: 1px solid #d9cec4;
      border-radius: 12px;
      background: #fff;
      color: #171717;
      font: inherit;
      outline: none;
    }
    .kirpa-auth-field input:focus {
      border-color: #f15a29;
      box-shadow: 0 0 0 3px rgba(241, 90, 41, .13);
    }
    .kirpa-auth-field button {
      height: 46px;
      padding: 0 18px;
      border: 0;
      border-radius: 12px;
      background: #171717;
      color: #fff;
      font: 800 13px/1 Manrope, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      cursor: pointer;
    }
    .kirpa-auth-field button:hover { background: #f15a29; }
    .kirpa-auth-error {
      min-height: 20px;
      margin: 10px 0 0 !important;
      color: #a94545 !important;
      font-size: 12px !important;
      font-weight: 700;
    }
    @media (max-width: 520px) {
      .kirpa-auth-card { padding: 26px 22px; }
      .kirpa-auth-field { flex-direction: column; }
      .kirpa-auth-field button { width: 100%; }
    }
  `;
  document.head.appendChild(style);

  const employeeHandle = new URLSearchParams(location.search).get('employeePortal');
  const isAuthorisedEmployeeEmbed = window.self !== window.top && employeeHandle &&
    sessionStorage.getItem(EMPLOYEE_EMBED_KEY)?.toLowerCase() === employeeHandle.trim().toLowerCase();

  if (sessionStorage.getItem(SESSION_KEY) === EXPECTED_HASH || isAuthorisedEmployeeEmbed) {
    document.documentElement.classList.remove('kirpa-auth-pending');
    return;
  }

  document.documentElement.classList.add('kirpa-auth-pending');

  async function sha256(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  function unlock() {
    sessionStorage.setItem(SESSION_KEY, EXPECTED_HASH);
    document.documentElement.classList.remove('kirpa-auth-pending');
    document.getElementById('kirpa-auth-gate')?.remove();
    document.getElementById('kirpa-auth-style')?.remove();
  }

  function mount() {
    if (document.getElementById('kirpa-auth-gate')) return;

    const gate = document.createElement('div');
    gate.id = 'kirpa-auth-gate';
    gate.setAttribute('role', 'dialog');
    gate.setAttribute('aria-modal', 'true');
    gate.setAttribute('aria-labelledby', 'kirpa-auth-title');
    gate.innerHTML = `
      <form class="kirpa-auth-card" autocomplete="off">
        <div class="kirpa-auth-mark"><span class="kirpa-auth-dot"></span>Kirpa Properties</div>
        <h1 id="kirpa-auth-title">Social Ranking</h1>
        <p>This dashboard is restricted to authorised viewers. Enter the access password to continue.</p>
        <label class="kirpa-auth-label" for="kirpa-auth-password">Password</label>
        <div class="kirpa-auth-field">
          <input id="kirpa-auth-password" name="password" type="password" required autofocus autocomplete="current-password" aria-describedby="kirpa-auth-error">
          <button type="submit">Access</button>
        </div>
        <p class="kirpa-auth-error" id="kirpa-auth-error" aria-live="polite"></p>
      </form>
    `;
    document.body.appendChild(gate);

    const form = gate.querySelector('form');
    const input = gate.querySelector('input');
    const error = gate.querySelector('.kirpa-auth-error');
    const button = gate.querySelector('button');

    form.addEventListener('submit', async event => {
      event.preventDefault();
      error.textContent = '';
      button.disabled = true;
      button.textContent = 'Checking…';
      try {
        const candidate = await sha256(input.value);
        if (candidate === EXPECTED_HASH) {
          unlock();
          return;
        }
        input.value = '';
        error.textContent = 'Incorrect password. Please try again.';
        input.focus();
      } catch (_) {
        error.textContent = 'Unable to verify the password in this browser.';
      } finally {
        button.disabled = false;
        button.textContent = 'Access';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
