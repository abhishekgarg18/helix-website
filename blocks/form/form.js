import { addInViewAnimationToSingleElement } from '../../utils/helpers.js';

function createSelect(fd) {
  const select = document.createElement('select');
  select.id = fd.Field;
  if (fd.Placeholder) {
    const ph = document.createElement('option');
    ph.textContent = fd.Placeholder;
    ph.setAttribute('selected', '');
    ph.setAttribute('disabled', '');
    select.append(ph);
  }
  fd.Options.split(',').forEach((o) => {
    const option = document.createElement('option');
    option.textContent = o.trim();
    option.value = o.trim();
    select.append(option);
  });
  if (fd.Mandatory === 'x') {
    select.setAttribute('required', 'required');
  }
  return select;
}

// derive branch, repo, and owner from the current hostname, e.g.
// main--helix-website--owner.aem.page
function getHelixLocationParts() {
  try {
    const { hostname } = window.location;
    const parts = hostname.split('--');
    const branch = parts[0] || 'main';
    const repo = parts[1] || 'helix-website';
    const ownerWithDomain = parts[2] || '';
    const owner = ownerWithDomain.split('.')[0] || 'adobe';
    return { branch, repo, owner };
  } catch (e) {
    return { branch: 'main', repo: 'helix-website', owner: 'adobe' };
  }
}

function constructPayload(form) {
  const payload = {};
  [...form.elements].forEach((fe) => {
    if (fe.type === 'checkbox') {
      if (fe.checked) payload[fe.id] = fe.value;
    } else if (fe.id) {
      payload[fe.id] = fe.value;
    }
  });
  return payload;
}

function renderStatus(form, { ok, heading, details }) {
  let status = form.querySelector('.form-status');
  if (!status) {
    status = document.createElement('div');
    status.className = 'form-status';
    form.append(status);
  }
  status.classList.toggle('success', !!ok);
  status.classList.toggle('error', !ok);

  const safeHeading = heading || (ok ? 'Success' : 'Failed');
  let safeDetails = '';
  if (details) {
    if (typeof details === 'string') safeDetails = details;
    else safeDetails = JSON.stringify(details, null, 2);
  }
  status.innerHTML = `
    <strong>${safeHeading}</strong>
    ${safeDetails ? `<pre>${safeDetails}</pre>` : ''}
  `;
}

// Inline progress rendering (progress element + text)
function renderProgress(form, { percent = 0, finished = false, processId = null }) {
  let wrap = form.querySelector('.form-progress');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'form-progress';
    const bar = document.createElement('progress');
    bar.max = 100;
    bar.value = 0;
    bar.className = 'form-progress-bar';
    const text = document.createElement('span');
    text.className = 'form-progress-text';
    wrap.append(bar, text);
    form.append(wrap);
  }
  const bar = wrap.querySelector('progress');
  const text = wrap.querySelector('.form-progress-text');
  const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  bar.value = clamped;
  const pidSuffix = processId ? ` | Process ID: ${processId}` : '';
  text.textContent = finished ? `Completed${pidSuffix}` : `${clamped}%${pidSuffix}`;
  wrap.style.display = finished ? 'none' : '';
}

// Show current status/state (currentStep, completionStatus, stepLog)
function renderStateDetails(form, state = {}) {
  let panel = form.querySelector('.form-progress-details');
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'form-progress-details';
    panel.innerHTML = `
      <div class="form-progress-meta">
        <span class="label">Status:</span>
        <span class="val" data-field="completionStatus">-</span>
        <span class="label" style="margin-left:12px;">Current step:</span>
        <span class="val" data-field="currentStep">-</span>
      </div>
      <ul class="form-step-log"></ul>
    `;
    form.append(panel);
  }
  const statusEl = panel.querySelector('[data-field="completionStatus"]');
  const stepEl = panel.querySelector('[data-field="currentStep"]');
  const logEl = panel.querySelector('.form-step-log');
  if (statusEl && 'completionStatus' in state) statusEl.textContent = state.completionStatus || '';
  if (stepEl && 'currentStep' in state) stepEl.textContent = state.currentStep || '';
  if (logEl && Array.isArray(state.stepLog)) {
    // show last 10 entries
    const last = state.stepLog.slice(-10);
    logEl.innerHTML = last.map((l) => `<li>${String(l)}</li>`).join('');
  }
}

// Extract site path and asoSiteId from status JSON
function getSiteInfoFromStatus(json) {
  let sitePath = '';
  try {
    if (json && json.siteUrl) {
      sitePath = new URL(json.siteUrl).pathname || '';
    } else if (json && json.contentRoot && json.parentSuffix && json.siteName) {
      const root = String(json.contentRoot).replace(/\/$/, '');
      sitePath = `${root}/${json.parentSuffix}/${json.siteName}`;
    }
  } catch (e) {
    sitePath = '';
  }
  const asoSiteId = json && (json.asoSiteId || json.asositeid || json.ASOSiteId);
  return { sitePath, asoSiteId };
}

async function checkProcessStatus(processId) {
  try {
    const resp = await fetch('https://3531103-832brownpony-dev.adobeioruntime.net/api/v1/web/web-api/check-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ processId }),
    });
    const text = await resp.text().catch(() => '');
    let json;
    try { json = JSON.parse(text); } catch (e) { json = null; }

    const statusValue = json && (json.status || json.result || json.state || json.completionStatus || '');
    const finished = !!(json && json.finished === true);
    const completionPercent = Number.isFinite(json && json.completionPercent) ? json.completionPercent : null;

    const success = finished
      ? ['success', 'ok', 'completed', 'done'].includes(String(statusValue).toLowerCase()) || resp.ok
      : resp.ok;

    return { ok: success, raw: text, json, finished, completionPercent };
  } catch (e) {
    return { ok: false };
  }
}

async function registerSite(payload) {
  const email = payload.customerEmail || payload.customerEmailID || payload.email || '';
  const siteName = payload.customerName || payload.siteName || '';
  if (!email || !siteName) return { ok: false, status: 400, text: 'Missing email or siteName' };

  const body = {
    email,
    recaptchaToken: 'RECAPTCHA_CLIENT_TOKEN',
    recaptchaVersion: 'v2',
    template: 'boilerplate-wknd',
    siteName,
  };

  const resp = await fetch('https://3531103-832brownpony-dev.adobeioruntime.net/api/v1/web/web-api/registration', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await resp.text().catch(() => '');
  let json;
  try { json = JSON.parse(text); } catch (e) { json = null; }
  const processId = json && json.processId;

  return { ok: resp.ok, status: resp.status, text, json, processId };
}

// Poll until finished, updating progress UI
async function pollProcessStatus(form, processId, { intervalMs = 2000, timeoutMs = 600000 } = {}) {
  const start = Date.now();
  renderProgress(form, { percent: 0, finished: false, processId });
  renderStatus(form, { ok: true, heading: 'Provisioning in progress…' });

  while (Date.now() - start < timeoutMs) {
    const status = await checkProcessStatus(processId);
    if (status && status.json) {
      const { completionPercent = 0, finished = false } = status;
      renderProgress(form, { percent: completionPercent || 0, finished, processId });
      // Update state details (current step, status and recent logs)
      try { renderStateDetails(form, status.json); } catch (e) { /* no-op */ }
      if (finished) {
        const { sitePath, asoSiteId } = getSiteInfoFromStatus(status.json);
        const lines = [];
        if (sitePath) lines.push(`Site Path: ${sitePath}`);
        if (asoSiteId) lines.push(`ASO Site ID: ${asoSiteId}`);
        if (processId) lines.push(`Process ID: ${processId}`);
        const details = lines.join('\n');
        renderStatus(form, {
          ok: status.ok,
          heading: status.ok ? 'Provisioning complete' : 'Provisioning failed',
          details,
        });
        return status;
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  renderStatus(form, {
    ok: false,
    heading: 'Provisioning timed out',
  });
  return { ok: false };
}

async function submitForm(form) {
  const payload = constructPayload(form);
  payload.timestamp = new Date().toJSON();

  // Special action: create site on submit for UT/onboard form
  if (form.dataset.action === '/forms/ut') {
    try {
      const reg = await registerSite(payload);
      if (reg && reg.ok) {
        renderStatus(form, {
          ok: true,
          heading: 'Registration submitted',
          details: reg.json || reg.text,
        });
        if (reg && reg.processId) {
          await pollProcessStatus(form, reg.processId);
        }
      } else {
        renderStatus(form, {
          ok: false,
          heading: 'Registration failed',
          details: reg && (reg.json || reg.text || `HTTP ${reg.status}`),
        });
      }
    } catch (e) {
      renderStatus(form, {
        ok: false,
        heading: 'Registration error',
      });
    }
  }

  const { branch, repo, owner } = getHelixLocationParts();
  const resp = await fetch(`https://form.aem.page/${branch}--${repo}--${owner}${form.dataset.action}`, {
    method: 'POST',
    cache: 'no-cache',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ data: payload }),
  });
  await resp.text();
  return payload;
}

function createButton(fd) {
  const button = document.createElement('button');
  button.textContent = fd.Label;
  button.classList.add('button');
  if (fd.Type === 'submit') {
    button.addEventListener('click', async (event) => {
      const form = button.closest('form');
      if (fd.Placeholder) form.dataset.action = fd.Placeholder;
      if (form.checkValidity()) {
        event.preventDefault();
        button.disabled = true;
        button.setAttribute('disabled', '');
        button.setAttribute('aria-disabled', 'true');
        await submitForm(form);
        // For UT/onboard form, stay on page to show inline status; otherwise redirect
        const shouldStay = form.dataset.action === '/forms/ut';
        if (!shouldStay) {
          const redirectTo = fd.Extra;
          window.location.href = redirectTo;
        }
        // Do not re-enable button to avoid duplicate submissions
      }
    });
  }
  return button;
}

function createHeading(fd, el) {
  const heading = document.createElement(el);
  heading.textContent = fd.Label;
  return heading;
}

function createInput(fd) {
  const input = document.createElement('input');
  input.type = fd.Type;
  input.id = fd.Field;
  input.setAttribute('placeholder', fd.Placeholder);
  if (fd.Mandatory === 'x') {
    input.setAttribute('required', 'required');
  }
  return input;
}

function createTextArea(fd) {
  const input = document.createElement('textarea');
  input.id = fd.Field;
  input.setAttribute('placeholder', fd.Placeholder);
  if (fd.Mandatory === 'x') {
    input.setAttribute('required', 'required');
  }
  return input;
}

function createLabel(fd) {
  const label = document.createElement('label');
  label.setAttribute('for', fd.Field);
  label.textContent = fd.Label;
  if (fd.Mandatory === 'x') {
    label.classList.add('required');
  }
  return label;
}

function applyRules(form, rules) {
  const payload = constructPayload(form);
  rules.forEach((field) => {
    const { type, condition: { key, operator, value } } = field.rule;
    if (type === 'visible') {
      if (operator === 'eq') {
        if (payload[key] === value) {
          form.querySelector(`.${field.fieldId}`).classList.remove('hidden');
        } else {
          form.querySelector(`.${field.fieldId}`).classList.add('hidden');
        }
      }
    }
  });
}

function fill(form) {
  const { action } = form.dataset;
  if (action === '/tools/bot/register-form') {
    const loc = new URL(window.location.href);
    form.querySelector('#owner').value = loc.searchParams.get('owner') || '';
    form.querySelector('#installationId').value = loc.searchParams.get('id') || '';
  }
}

function buildFormFromJson(json, actionPath) {
  const form = document.createElement('form');
  const rules = [];
  form.dataset.action = actionPath || json.action || '/forms/inline';
  json.data.forEach((fd) => {
    fd.Type = fd.Type || 'text';
    const fieldWrapper = document.createElement('div');
    const style = fd.Style ? ` form-${fd.Style}` : '';
    const fieldId = `form-${fd.Type}-wrapper${style}`;
    fieldWrapper.className = fieldId;
    fieldWrapper.classList.add('field-wrapper');
    switch (fd.Type) {
      case 'select':
        fieldWrapper.append(createLabel(fd));
        fieldWrapper.append(createSelect(fd));
        break;
      case 'heading':
        fieldWrapper.append(createHeading(fd, 'h3'));
        break;
      case 'legal':
        fieldWrapper.append(createHeading(fd, 'p'));
        break;
      case 'checkbox':
        fieldWrapper.append(createInput(fd));
        fieldWrapper.append(createLabel(fd));
        break;
      case 'text-area':
        fieldWrapper.append(createLabel(fd));
        fieldWrapper.append(createTextArea(fd));
        break;
      case 'submit':
        fieldWrapper.append(createButton(fd));
        break;
      default:
        fieldWrapper.append(createLabel(fd));
        fieldWrapper.append(createInput(fd));
    }

    if (fd.Rules) {
      try {
        rules.push({ fieldId, rule: JSON.parse(fd.Rules) });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`Invalid Rule ${fd.Rules}: ${e}`);
      }
    }
    form.append(fieldWrapper);
  });

  form.addEventListener('change', () => applyRules(form, rules));
  applyRules(form, rules);
  fill(form);
  return form;
}

export async function createForm(formURLOrJson) {
  if (typeof formURLOrJson === 'string') {
    const { pathname } = new URL(formURLOrJson);
    const resp = await fetch(pathname);
    const json = await resp.json();
    const actionPath = pathname.split('.json')[0];
    return buildFormFromJson(json, actionPath);
  }
  if (typeof formURLOrJson === 'object' && formURLOrJson) {
    return buildFormFromJson(formURLOrJson, formURLOrJson.action);
  }
  return document.createElement('div');
}

export default async function decorate(block) {
  const jsonLink = block.querySelector('a[href$=".json"]');
  addInViewAnimationToSingleElement(block, 'fade-up');
  if (jsonLink) {
    jsonLink.replaceWith(await createForm(jsonLink.href));
    return;
  }
  const inlineScript = block.querySelector('script[type="application/json"]');
  if (inlineScript) {
    try {
      const parsed = JSON.parse(inlineScript.textContent);
      inlineScript.replaceWith(await createForm(parsed));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`Invalid inline form JSON: ${e.message}`);
    }
  }
}
