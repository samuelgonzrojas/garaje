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
