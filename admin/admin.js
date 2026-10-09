// Página de administración de Garaje: clientes enviados a cada taller y la
// comisión que generan. Solo la ve quien esté en platform_admins
// (supabase/012_admin_reminders.sql); los RPC admin_* devuelven vacío a cualquier otro.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const sb = createClient('https://pzgqgligxmwnwvozfwcl.supabase.co', 'sb_publishable_zPxM3Ul4VYkudB1D_lhUZw_lUy6K52g');
const $ = (id) => document.getElementById(id);
const show = (id, on = true) => $(id).classList.toggle('hidden', !on);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const eur = (n) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(n || 0));
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
const fmtTime = (iso) => iso ? new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const STATUS = { sent: 'Enviada', quoted: 'Respondida', reschedule: 'Pide otra hora', accepted: 'Aceptada', declined: 'Rechazada', converted: 'Orden abierta', closed: 'Cerrada' };

let session = null;

$('google').onclick = async () => {
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
  if (error) $('loginErr').textContent = error.message;
};
$('logout').onclick = async (e) => { e.preventDefault(); await sb.auth.signOut(); };

sb.auth.onAuthStateChange((_e, s) => { session = s; s ? enter() : leave(); });
const { data: { session: s0 } } = await sb.auth.getSession();
session = s0;
s0 ? enter() : leave();

function leave() { show('login'); show('main', false); show('nav', false); }

async function enter() {
  show('login', false); show('main'); show('nav');
  $('who').textContent = session.user.email;
  const [fees, workshops, leads, ios, crashes] = await Promise.all([sb.rpc('admin_lead_fees'), sb.rpc('admin_workshops'), sb.rpc('admin_leads'), sb.rpc('admin_ios_waitlist'), sb.rpc('admin_crash_reports')]);
  sb.rpc('admin_usage').then(({ data, error }) => renderUsage(data, error));
  sb.rpc('admin_feedback').then(({ data, error }) => renderFeedback(data || [], error));
  const err = fees.error || workshops.error || leads.error;
  if (err) { $('kpis').innerHTML = `<div class="kpi"><b>—</b><small>${esc(err.message)}</small></div>`; return; }
  if ((fees.data || []).length === 0 && (workshops.data || []).length === 0) {
    $('kpis').innerHTML = '<div class="kpi"><b>—</b><small>Esta cuenta no es administradora de Garaje, o aún no hay talleres.</small></div>';
  }
  window.__ios = ios.data || [];
  renderKpis(fees.data || [], leads.data || []);
  renderByMonth(fees.data || []);
  renderWorkshops(workshops.data || []);
  renderLeads(leads.data || []);
  renderIos(ios.data || []);
  renderCrashes(crashes.data || [], crashes.error);
}

const FEEDBACK_KIND = { bug: 'Fallo', idea: 'Idea', otro: 'Otro' };
const FEEDBACK_STATUS = { nuevo: 'Nuevo', visto: 'Visto', resuelto: 'Resuelto' };

function renderFeedback(rows, error) {
  const tb = $('feedback').querySelector('tbody');
  if (error) { tb.innerHTML = `<tr><td colspan="5" class="muted">${esc(error.message)}</td></tr>`; return; }
  tb.innerHTML = rows.length ? '' : '<tr><td colspan="5" class="muted">Nada todavía.</td></tr>';
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    if (r.status === 'nuevo') tr.style.fontWeight = '700';
    const sel = Object.entries(FEEDBACK_STATUS).map(([k, v]) => `<option value="${k}"${k === r.status ? ' selected' : ''}>${v}</option>`).join('');
    tr.innerHTML = `<td>${fmtTime(r.created_at)}</td><td>${FEEDBACK_KIND[r.kind] || esc(r.kind)}</td>`
      + `<td>${esc(String(r.message).slice(0, 120))}</td><td class="num">${(r.images || []).length || ''}</td>`
      + `<td><select>${sel}</select></td>`;
    const select = tr.querySelector('select');
    select.onclick = (e) => e.stopPropagation();
    select.onchange = async () => {
      const { error: err } = await sb.rpc('admin_set_feedback_status', { p_id: r.id, p_status: select.value });
      if (err) { alert(err.message); return; }
      r.status = select.value;
      tr.style.fontWeight = r.status === 'nuevo' ? '700' : '';
    };
    tr.onclick = () => showFeedback(r);
    tb.appendChild(tr);
  }
}

async function showFeedback(r) {
  const d = $('feedbackDetail');
  d.classList.remove('hidden');
  d.innerHTML = `<p><b>${FEEDBACK_KIND[r.kind] || esc(r.kind)}</b> · ${fmtTime(r.created_at)} · ${esc(r.app_version || '')} · ${esc(r.platform || '')}</p>`
    + `<p style="white-space:pre-wrap">${esc(r.message)}</p>`
    + (r.contact ? `<p>Contacto: <a href="mailto:${esc(r.contact)}">${esc(r.contact)}</a></p>` : '<p class="muted">Sin correo de contacto.</p>')
    + '<div id="feedbackImages" style="display:flex;gap:8px;flex-wrap:wrap"></div>'
    + (r.diagnostics ? `<details style="margin-top:8px"><summary>Datos técnicos</summary><pre style="white-space:pre-wrap;font-size:12px">${esc(r.diagnostics)}</pre></details>` : '');
  d.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const imgs = r.images || [];
  if (!imgs.length) return;
  const { data, error } = await sb.storage.from('feedback').createSignedUrls(imgs, 3600);
  const box = $('feedbackImages');
  if (error) { box.textContent = error.message; return; }
  for (const s of data || []) {
    if (!s.signedUrl) continue;
    box.innerHTML += `<a href="${s.signedUrl}" target="_blank" rel="noopener"><img src="${s.signedUrl}" style="height:220px;border-radius:10px;border:1px solid var(--line)"></a>`;
  }
}

function renderUsage(u, error) {
  const tb = $('usage').querySelector('tbody');
  if (error || !u) {
    $('usageKpis').innerHTML = '';
    tb.innerHTML = `<tr><td colspan="2" class="muted">${esc(error ? error.message : 'Sin datos todavía.')}</td></tr>`;
    return;
  }
  const kpi = (n, label) => `<div class="kpi"><b>${n}</b><small>${label}</small></div>`;
  $('usageKpis').innerHTML = kpi(u.active_1d, 'abiertas hoy') + kpi(u.active_7d, 'en 7 días') + kpi(u.active_30d, 'en 30 días')
    + kpi(u.total, 'instalaciones en total') + kpi(u.new_7d, 'nuevas en 7 días');
  const t = u.totals || {}, us = u.using || {};
  const list = (o) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)} ${v}`).join(' · ') || '—';
  const rows = [
    ['Vehículos', `${t.vehicles ?? 0} en ${us.vehicles ?? 0} instalaciones`],
    ['Tipos', list(u.types)],
    ['Marcas', list(u.makes)],
    ['Trabajos apuntados', `${t.events ?? 0} · ${us.events ?? 0} instalaciones apuntan`],
    ['Lecturas de km', `${t.readings ?? 0}`],
    ['Repostajes', `${t.refuels ?? 0} · ${us.refuels ?? 0} instalaciones`],
    ['Viajes medidos', `${t.trips ?? 0} · ${us.trips ?? 0} instalaciones`],
    ['Adjuntos', `${t.attachments ?? 0} · ${us.attachments ?? 0} instalaciones`],
    ['Con sesión iniciada', `${us.signed_in ?? 0}`],
    ['Versiones', list(u.versions)],
    ['Origen', list(u.platforms)],
    ['Activas por día', (u.daily || []).map((d) => `${d.day.slice(8, 10)}/${d.day.slice(5, 7)}: ${d.n}`).join(' · ') || '—'],
  ];
  tb.innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
}

function renderCrashes(rows, error) {
  const tb = $('crashes').querySelector('tbody');
  if (error) { tb.innerHTML = `<tr><td colspan="4" class="muted">${esc(error.message)}</td></tr>`; return; }
  tb.innerHTML = rows.length ? '' : '<tr><td colspan="4" class="muted">Ningún fallo en 90 días.</td></tr>';
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.innerHTML = `<td>${fmtTime(r.last_at)}</td><td class="num">${r.times}</td><td>${esc(r.app_versions)}</td><td>${esc(String(r.message || '').split('\n')[0].slice(0, 120))}</td>`;
    tr.onclick = () => {
      const d = $('crashDetail');
      d.textContent = `${r.kind} · ${r.os || ''}\n\n${r.message}\n\n${r.stack || ''}\n\n--- últimas acciones ---\n${r.breadcrumbs || ''}`;
      d.classList.remove('hidden');
      d.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    tb.appendChild(tr);
  }
}

function renderIos(rows) {
  const tb = $('ios').querySelector('tbody');
  tb.innerHTML = rows.length ? '' : '<tr><td colspan="2" class="muted">Nadie todavía.</td></tr>';
  for (const r of rows) tb.innerHTML += `<tr><td>${esc(r.email)}</td><td>${fmtTime(r.created_at)}</td></tr>`;
}

function renderKpis(fees, leads) {
  const now = new Date();
  const thisMonth = fees.filter((f) => { const d = new Date(f.month); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth(); });
  const sum = (arr, k) => arr.reduce((a, r) => a + Number(r[k] || 0), 0);
  $('kpis').innerHTML = [
    [sum(thisMonth, 'leads'), `clientes enviados en ${MONTHS[now.getMonth()]}`],
    [eur(sum(thisMonth, 'fees')), `comisión de ${MONTHS[now.getMonth()]}`],
    [sum(fees, 'leads'), 'clientes enviados en total'],
    [eur(sum(fees, 'fees')), 'comisión total'],
    [leads.filter((l) => ['accepted', 'converted'].includes(l.status)).length, 'presupuestos aceptados'],
    [(window.__ios || []).length, 'en lista de espera iPhone'],
  ].map(([v, t]) => `<div class="kpi"><b>${v}</b><small>${t}</small></div>`).join('');
}

function renderByMonth(fees) {
  const tb = $('byMonth').querySelector('tbody');
  tb.innerHTML = fees.length ? '' : '<tr><td colspan="5" class="muted">Todavía no hay clientes enviados.</td></tr>';
  for (const f of fees) {
    const d = new Date(f.month);
    tb.innerHTML += `<tr><td>${MONTHS[d.getMonth()]} ${d.getFullYear()}</td><td>${esc(f.workshop)}</td><td class="num">${f.leads}</td><td class="num">${f.accepted}</td><td class="num">${eur(f.fees)}</td></tr>`;
  }
}

function renderWorkshops(ws) {
  const tb = $('workshops').querySelector('tbody');
  tb.innerHTML = ws.length ? '' : '<tr><td colspan="5" class="muted">Ningún taller dado de alta.</td></tr>';
  for (const w of ws) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${esc(w.name)}</td><td>${esc(w.city || '—')}</td><td>${w.listed ? 'Sí' : 'No'}</td>
      <td class="num"><input class="fee" inputmode="decimal" value="${Number(w.lead_fee).toFixed(2)}"></td><td><button class="btn small">Guardar</button></td>`;
    tr.querySelector('button').onclick = async () => {
      const fee = parseFloat(tr.querySelector('input').value.replace(',', '.'));
      const { error } = await sb.rpc('admin_set_lead_fee', { p_workshop: w.id, p_fee: isNaN(fee) ? 0 : fee });
      tr.querySelector('button').textContent = error ? 'Error' : 'Guardado';
      setTimeout(() => { tr.querySelector('button').textContent = 'Guardar'; }, 1500);
    };
    tb.appendChild(tr);
  }
}

function renderLeads(leads) {
  const tb = $('leads').querySelector('tbody');
  tb.innerHTML = leads.length ? '' : '<tr><td colspan="6" class="muted">Ninguno todavía.</td></tr>';
  for (const l of leads) {
    tb.innerHTML += `<tr><td>${fmtTime(l.created_at)}</td><td>${esc(l.workshop)}</td><td>${esc(l.vehicle || '—')}</td><td>${STATUS[l.status] || esc(l.status)}${l.appointment_at ? `<br><small class="muted">cita ${fmtTime(l.appointment_at)}</small>` : ''}</td><td class="num">${l.quote_amount != null ? eur(l.quote_amount) : '—'}</td><td class="num">${eur(l.fee)}</td></tr>`;
  }
}
