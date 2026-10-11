// Panel web de Garaje para talleres (y familiares). Habla directamente con
// Supabase: la seguridad la ponen las políticas RLS (supabase/008_workshop.sql).
// El historial del coche es el mismo documento por vehículo que usa la app
// (unión por id de eventos y lecturas); las órdenes, piezas, proveedores y
// mensajes van en sus propias tablas.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { BRANDS, searchUrl } from './brands.js';

const SUPABASE_URL = 'https://pzgqgligxmwnwvozfwcl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_zPxM3Ul4VYkudB1D_lhUZw_lUy6K52g';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (id) => document.getElementById(id);
const show = (id, on = true) => $(id).classList.toggle('hidden', !on);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let session = null;
let profile = null;        // { display_name, is_workshop }
let workshop = null;       // fila de public.workshops (null si no es taller)
let myRole = null;         // 'owner' | 'manager' | 'mechanic' en ese taller (supabase/019_workshop_team.sql)
let team = [];             // equipo del taller (workshop_team)
const isOwner = () => myRole === 'owner';
const isManager = () => myRole === 'owner' || myRole === 'manager';
const ROLE_NAME = { owner: 'Dueño', manager: 'Encargado', mechanic: 'Mecánico' };
let roles = {};            // vehicle_id -> role
let vehicles = [];         // filas de public.vehicles
let people = {};           // vehicle_id -> personas con acceso (dueño, familia), de vehicle_people
let vstatus = {};          // vehicle_id -> semáforo que publica la app del cliente (vehicle_status)
let jobs = [];             // órdenes del taller
let leads = [];            // solicitudes de presupuesto llegadas desde la app
let agendaStart = null;    // lunes de la semana que se enseña en la agenda
let appointments = [];     // citas propias del taller (workshop_appointments)
let parts = [];            // biblioteca de piezas
let suppliers = [];        // proveedores
let catalogNames = {};     // catalog_id -> nombre
let engines = {};          // engine_id -> familia (con specs)
let current = null;        // coche abierto
let job = null;            // orden abierta
let jobVehicle = null;     // coche de la orden abierta
let messages = [];
let channel = null;
let tab = 'jobs';

// ------------------------------------------------------------------ utilidades
const fmtKm = (n) => n == null ? '—' : new Intl.NumberFormat('es-ES').format(n) + ' km';
const fmtDate = (iso) => iso ? new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
const fmtTime = (iso) => new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtEur = (n) => n == null || isNaN(n) ? '' : new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n);
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isNaN(n) ? null : n; };
const newId = () => (Date.now() * 1000).toString(36) + '-' + Math.floor(Math.random() * 2 ** 30).toString(36);
const today = () => new Date().toISOString().slice(0, 10);
const roleName = (r) => r === 'owner' ? 'propietario' : r === 'workshop' ? 'taller' : 'familiar';
// WhatsApp: número en formato internacional; los de 9 cifras se dan por españoles.
const waUrl = (phone) => 'https://wa.me/' + String(phone).replace(/\D/g, '').replace(/^00/, '').replace(/^(\d{9})$/, '34$1');
const fmtPhone = (phone) => String(phone).replace(/\s+/g, ' ').trim();
// Iconos (24×24) para los botones de contacto.
const ICON = {
  call: '<path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/>',
  whatsapp: '<path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.15l-.3-.18-3 .78.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.25-.12-1.46-.72-1.69-.8s-.39-.12-.55.12-.63.8-.78.97-.29.18-.53.06a6.7 6.7 0 0 1-3.34-2.92c-.25-.43.25-.4.72-1.34a.45.45 0 0 0-.02-.43c-.06-.12-.55-1.33-.76-1.82s-.4-.41-.55-.42h-.47a.9.9 0 0 0-.65.3 2.74 2.74 0 0 0-.86 2.04 4.76 4.76 0 0 0 1 2.53 10.9 10.9 0 0 0 4.18 3.69c1.55.67 2.16.73 2.94.61a2.5 2.5 0 0 0 1.65-1.16 2.04 2.04 0 0 0 .14-1.16c-.06-.1-.22-.16-.47-.28z"/>',
  mail: '<path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4-8 5-8-5V6l8 5 8-5z"/>',
  web: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-2.9a15.7 15.7 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8zM12 4c.8 1.2 1.5 2.5 1.9 4h-3.8c.4-1.4 1.1-2.8 1.9-4zM4.3 14a8.2 8.2 0 0 1 0-4h3.4a16.5 16.5 0 0 0 0 4zm.8 2h2.9c.3 1.3.8 2.5 1.4 3.6A8 8 0 0 1 5.1 16zM8 8H5.1a8 8 0 0 1 4.3-3.6C8.8 5.5 8.3 6.7 8 8zm4 12c-.8-1.2-1.5-2.5-1.9-4h3.8c-.4 1.4-1.1 2.8-1.9 4zm2.3-6H9.7a14.7 14.7 0 0 1 0-4h4.6a14.7 14.7 0 0 1 0 4zm.3 5.6c.6-1.1 1.1-2.3 1.4-3.6h2.9a8 8 0 0 1-4.3 3.6zm1.7-5.6a16.5 16.5 0 0 0 0-4h3.4a8.2 8.2 0 0 1 0 4z"/>',
};
// Iconos de la navegación y de las pantallas vacías (los mismos que la app).
const NAV_ICON = {
  jobs: '<path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/>',
  leads: '<path d="M19 3H4.99C3.88 3 3.01 3.89 3.01 5L3 19c0 1.1.88 2 1.99 2H19c1.1 0 2-.9 2-2V5c0-1.11-.9-2-2-2zm0 12h-4c0 1.66-1.35 3-3 3s-3-1.34-3-3H4.99V5H19v10z"/>',
  agenda: '<path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/>',
  cars: '<path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/>',
  parts: '<path d="M20 2H4c-1 0-2 .9-2 2v3.01c0 .72.43 1.34 1 1.69V20c0 1.1 1.1 2 2 2h14c.9 0 2-.9 2-2V8.7c.57-.35 1-.97 1-1.69V4c0-1.1-1-2-2-2zm-5 12H9v-2h6v2zm5-7H4V4h16v3z"/>',
  suppliers: '<path d="M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>',
  settings: '<path d="M20 4H4v2h16V4zm1 10v-2l-1-5H4l-1 5v2h1v6h10v-6h4v6h2v-6h1zm-9 4H6v-4h6v4z"/>',
  team: '<path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>',
  more: '<path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>',
  logout: '<path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>',
};
const svgIcon = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${NAV_ICON[k] || ''}</svg>`;
for (const el of document.querySelectorAll('.tabs [data-icon]')) el.insertAdjacentHTML('afterbegin', `<i class="ni">${svgIcon(el.dataset.icon)}</i>`);
for (const el of document.querySelectorAll('.empty[data-icon]')) el.insertAdjacentHTML('afterbegin', `<i class="empty-ic">${svgIcon(el.dataset.icon)}</i>`);
/** Pantalla vacía con icono, como en la app. */
const emptyState = (icon, title, text) => `<div class="empty"><i class="empty-ic">${svgIcon(icon)}</i><b>${title}</b><p>${text}</p></div>`;

const iconLink = (kind, href, label, external = false) =>
  `<a class="ic ${kind}" href="${esc(href)}" title="${esc(label)}" aria-label="${esc(label)}"${external ? ' target="_blank" rel="noopener"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[kind]}</svg></a>`;
/** Botones de contacto con icono: llamar, WhatsApp y correo (los que haya). */
function contactButtons(phone, email, waText = '', who = '') {
  const t = waText ? '?text=' + encodeURIComponent(waText) : '';
  const to = who ? ' a ' + who : '';
  return (phone ? iconLink('call', 'tel:' + String(phone).replace(/\s/g, ''), 'Llamar' + to) + iconLink('whatsapp', waUrl(phone) + t, 'WhatsApp' + to, true) : '')
    + (email ? iconLink('mail', 'mailto:' + email, 'Correo' + to) : '');
}
/** Dueño y familiares del coche (sin los talleres). */
const peopleOf = (vehicleId) => (people[vehicleId] || []).filter((p) => p.role !== 'workshop');
/** El dueño del coche (o, si no lo hay, el primer familiar). */
function ownerOf(vehicleId) {
  const list = peopleOf(vehicleId);
  return list.find((p) => p.role === 'owner') || list[0] || null;
}
const isMe = (p) => p.user_id === session?.user?.id;
const personName = (p) => esc(p.display_name) + (isMe(p) ? ' <span class="muted">(tú)</span>' : '');

const STATUS = {
  received: 'Recibido', diagnosis: 'En diagnóstico', quote_sent: 'Presupuesto enviado', approved: 'Aprobado',
  rejected: 'Presupuesto rechazado', in_progress: 'En reparación', waiting_parts: 'Esperando piezas',
  ready: 'Listo para recoger', delivered: 'Entregado', cancelled: 'Cancelado',
};
const LEAD_STATUS = { sent: 'Nueva', quoted: 'Respondida', reschedule: 'Pide otra hora', accepted: 'Aceptada', declined: 'Rechazada', converted: 'Orden abierta', closed: 'Cerrada' };
const LEAD_OPEN = ['sent', 'quoted', 'reschedule', 'accepted'];
const COLUMNS = [
  ['Entrada', ['received', 'diagnosis']],
  ['Esperando al cliente', ['quote_sent', 'rejected']],
  ['En el taller', ['approved', 'in_progress', 'waiting_parts']],
  ['Listos para recoger', ['ready']],
];
// Qué especificación del motor corresponde a cada ítem del plan.
const SPEC_ITEMS = { oil: 'oil', coolant: 'coolant', brake_fluid: 'brake_fluid', plugs: 'spark_plugs', gearbox: 'gearbox_oil_manual', diff: 'diff_oil' };
const SPEC_LABEL = { oil: 'Aceite', oil_l: 'Cantidad de aceite', coolant: 'Refrigerante', brake_fluid: 'Líquido de frenos', plugs: 'Bujías', gearbox: 'Caja de cambios', diff: 'Diferencial', battery: 'Batería', adblue: 'AdBlue', fap: 'Filtro de partículas', timing: 'Distribución', tyres: 'Neumáticos', notes: 'Ojo' };

function profileOf(row) {
  try { return JSON.parse(row.data.asset.profile_json); } catch { return {}; }
}
function itemName(catalogId, prof) {
  if (!catalogId) return 'Otros trabajos';
  if (catalogNames[catalogId]) return catalogNames[catalogId];
  const bare = catalogId.replace(/^custom:/, '');
  const c = (prof?.custom_items || []).find((x) => x.id === bare || 'custom:' + x.id === catalogId);
  return c ? c.name : catalogId;
}
function latestReading(doc) {
  const deleted = new Set(doc.deleted || []);
  let best = null;
  for (const r of doc.readings || []) {
    if (deleted.has(r.id)) continue;
    if (!best || r.at > best.at || (r.at === best.at && r.value > best.value)) best = r;
  }
  return best;
}
function liveEvents(doc) {
  const deleted = new Set(doc.deleted || []);
  return (doc.events || []).filter((e) => !deleted.has(e.id)).sort((a, b) => b.at.localeCompare(a.at));
}
// Foto del vehículo (miniatura JPEG en base64 que pone el cliente en la app).
function photoSrc(b64) {
  return typeof b64 === 'string' && b64.length < 200000 && /^[A-Za-z0-9+/=]+$/.test(b64) ? 'data:image/jpeg;base64,' + b64 : null;
}
function photoImg(b64, size) {
  const src = photoSrc(b64);
  return src ? `<img class="vphoto" src="${src}" alt="" style="width:${size}px;height:${size}px">` : '';
}
function setPhoto(id, b64) {
  const el = $(id);
  const src = photoSrc(b64);
  el.classList.toggle('hidden', !src);
  if (src) el.src = src; else el.removeAttribute('src');
}

function summary(row) {
  const doc = row.data;
  const prof = profileOf(row);
  const r = latestReading(doc);
  const events = liveEvents(doc);
  return {
    name: row.name || `${prof.make ?? ''} ${prof.model ?? ''} (${prof.year ?? ''})`.trim(),
    plate: prof.plate ? prof.plate.replace(/^(\d{4})([A-Z]{3})$/, '$1 $2') : '',
    km: r?.value ?? null,
    kmAt: r?.at ?? null,
    itv: doc.inspection?.due_date ?? null,
    last: events[0] ? `${fmtDate(events[0].at)} · ${itemName(events[0].catalog_id, prof)}` : '—',
    role: roles[row.id] || 'family',
    photo: prof.photo || null,
    prof, events,
  };
}

// ------------------------------------------------------------------ datos estáticos
async function loadStatic() {
  try {
    const c = await (await fetch('catalog.json')).json();
    for (const it of [...(c.interval_items || []), ...(c.watch_items || [])]) catalogNames[it.id] = it.name;
  } catch (e) { console.warn('catálogo', e); }
  try {
    const e = await (await fetch('engines.json')).json();
    for (const f of e.engines || []) engines[f.id] = f;
  } catch (e) { console.warn('motores', e); }
  $('brands').innerHTML = BRANDS.map((b) => `<option value="${esc(b)}">`).join('');
}

// ------------------------------------------------------------------ acceso
$('sendCode').onclick = async () => {
  const email = $('email').value.trim();
  $('loginErr').textContent = '';
  if (!email.includes('@')) { $('loginErr').textContent = 'Escribe un correo válido.'; return; }
  $('sendCode').disabled = true;
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  $('sendCode').disabled = false;
  if (error) { $('loginErr').textContent = 'No se pudo enviar el código: ' + error.message; return; }
  $('sentTo').textContent = email;
  show('stepEmail', false); show('stepCode');
  $('code').focus();
};
$('again').onclick = (e) => { e.preventDefault(); show('stepCode', false); show('stepEmail'); };
$('verify').onclick = async () => {
  const email = $('sentTo').textContent;
  const token = $('code').value.replace(/\D/g, '');
  if (token.length !== 6) { $('loginErr').textContent = 'El código tiene 6 cifras.'; return; }
  $('verify').disabled = true;
  const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
  $('verify').disabled = false;
  if (error) $('loginErr').textContent = 'Código incorrecto o caducado. Pide otro.';
};
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('verify').click(); });
$('email').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('sendCode').click(); });
$('google').onclick = async () => {
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
  if (error) $('loginErr').textContent = error.message;
};
$('logout').onclick = async (e) => { e.preventDefault(); await sb.auth.signOut(); };

sb.auth.onAuthStateChange((_event, s) => {
  const was = session?.user?.id;
  session = s;
  if (!s) leave(); else if (s.user.id !== was) enter();
});

function hideAll() {
  for (const id of ['login', 'setup', 'tabs', 'tab-jobs', 'tab-leads', 'tab-agenda', 'tab-cars', 'tab-parts', 'tab-suppliers', 'tab-team', 'tab-settings', 'job', 'vehicle']) show(id, false);
}
function leave() {
  hideAll(); show('login'); show('nav', false);
  if (channel) { sb.removeChannel(channel); channel = null; }
}

async function enter() {
  hideAll(); show('nav');
  await ensureProfile();
  await loadWorkshop();
  await loadVehicles();
  if (!workshop && localStorage.getItem('garaje.skipSetup') !== '1') {
    renderWsForm('setupForm', {}, 'Crear mi taller');
    show('setup');
  } else {
    show('tabs');
    if (workshop) await Promise.all([loadJobs(), loadLeads(), loadParts(), loadSuppliers(), loadTeam(), loadAppointments()]);
    setTab(workshop ? tab : 'cars');
  }
  subscribe();
}

function subscribe() {
  if (channel) return;
  channel = sb.channel('panel')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, () => loadVehicles())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => workshop && loadJobs())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => workshop && loadLeads())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'workshop_appointments' }, () => workshop && loadAppointments())
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'job_messages' }, (p) => {
      if (job && p.new.job_id === job.id) loadMessages();
    })
    .subscribe();
}

// ------------------------------------------------------------------ perfil y taller
async function ensureProfile() {
  const uid = session.user.id;
  const { data } = await sb.from('profiles').select('display_name,is_workshop,phone').eq('user_id', uid).maybeSingle();
  profile = data || { display_name: session.user.email.split('@')[0], is_workshop: false };
}
async function loadWorkshop() {
  // ¿Dueño de un taller? Si no, ¿me han invitado a uno (por mi correo)?
  const { data } = await sb.from('workshops').select('*').eq('owner_id', session.user.id).maybeSingle();
  workshop = data; myRole = data ? 'owner' : null;
  if (!workshop) {
    let wid = null;
    try { ({ data: wid } = await sb.rpc('claim_workshop_invite')); } catch { /* sin equipos todavía */ }
    if (wid) {
      const [{ data: ws }, { data: me }] = await Promise.all([
        sb.from('workshops').select('*').eq('id', wid).maybeSingle(),
        sb.from('workshop_members').select('role').eq('workshop_id', wid).eq('user_id', session.user.id).maybeSingle(),
      ]);
      if (ws && me) { workshop = ws; myRole = me.role; }
    }
  }
  const name = workshop?.name || profile.display_name || '';
  $('who').textContent = name;
  $('avatar').textContent = (name.trim()[0] || '?').toUpperCase();
  $('roleChip').textContent = workshop && myRole !== 'owner' ? ROLE_NAME[myRole] : 'Taller';
  // Pestañas según el rol: el mecánico, órdenes, agenda y coches; el encargado,
  // todo menos los datos del taller; el dueño, todo.
  const allowed = !workshop ? ['cars', 'agenda']
    : myRole === 'mechanic' ? ['jobs', 'agenda', 'cars']
    : myRole === 'manager' ? ['jobs', 'leads', 'agenda', 'cars', 'parts', 'suppliers', 'team']
    : ['jobs', 'leads', 'agenda', 'cars', 'parts', 'suppliers', 'team', 'settings'];
  for (const b of document.querySelectorAll('.tabs button[data-tab]')) b.classList.toggle('hidden', !allowed.includes(b.dataset.tab));
  if (!allowed.includes(tab)) tab = allowed[0];
  document.querySelector('.tabs .more-btn').classList.toggle('no-more', !workshop);
  show('vJobActions', !!workshop);
}

const WS_FIELDS = [
  ['name', 'Nombre comercial', 'Taller Martínez', true],
  ['legal_name', 'Razón social o nombre y apellidos', 'Talleres Martínez S.L.'],
  ['tax_id', 'NIF / CIF', 'B12345678'],
  ['registry_no', 'Nº de registro industrial del taller', 'Sale en los presupuestos (obligatorio)'],
  ['address', 'Dirección', 'C/ Mayor 1, 28001 Madrid'],
  ['phone', 'Teléfono', '600 000 000'],
  ['email', 'Correo', 'taller@ejemplo.com'],
  ['labor_rate', 'Precio hora de mano de obra (€, sin IVA)', '45'],
  ['vat', 'IVA (%)', '21'],
  ['quote_validity_days', 'Validez del presupuesto (días hábiles)', '12'],
];
/** Bloque de la ficha: aparecer en la app para recibir solicitudes de presupuesto. */
function listingBlock(d) {
  const vt = d.vehicle_types || ['car'];
  const accepted = leads.filter((l) => ['accepted', 'converted'].includes(l.status)).length;
  const stats = leads.length ? ` Hasta ahora: ${leads.length} ${leads.length === 1 ? 'solicitud' : 'solicitudes'}, ${accepted} ${accepted === 1 ? 'aceptada' : 'aceptadas'}.` : '';
  const fee = num(d.lead_fee);
  return `<h3 style="margin:0 0 4px">Visible en la app Garaje</h3>
    <p class="muted" style="font-size:13px;margin:0 0 8px">Si lo activas, los usuarios de Garaje de tu zona pueden pedirte presupuesto desde la app con lo que le toca a su vehículo. Cada solicitud es un cliente que te envía Garaje${fee ? ` (tarifa acordada: ${fmtEur(fee)} por cliente enviado)` : ''}.${stats}</p>
    <label class="chk"><input type="checkbox" name="listed" ${d.listed ? 'checked' : ''}> Aparecer en la app</label>
    <div class="row3">
      <div><label>Ciudad</label><input name="city" value="${esc(d.city ?? '')}" placeholder="Madrid"></div>
      <div><label>Provincia</label><input name="province" value="${esc(d.province ?? '')}" placeholder="Madrid"></div>
      <div><label>Código postal</label><input name="postal_code" value="${esc(d.postal_code ?? '')}" inputmode="numeric" placeholder="28001"></div>
    </div>
    <div><label>Vehículos que atiendes</label>
      <label class="chk"><input type="checkbox" name="vt_car" ${vt.includes('car') ? 'checked' : ''}> Coches</label>
      <label class="chk"><input type="checkbox" name="vt_moto" ${vt.includes('moto') ? 'checked' : ''}> Motos</label>
    </div>
    <div><label>Qué haces mejor (sale en la app, opcional)</label><input name="description" value="${esc(d.description ?? '')}" placeholder="Mecánica general, diésel, neumáticos, ITV…" maxlength="140"></div>`;
}

function renderWsForm(formId, data, button) {
  const f = $(formId);
  const field = ([k, label, ph, req]) => `<div><label>${label}${req ? ' *' : ''}</label><input name="${k}" value="${esc(data[k] ?? '')}" placeholder="${esc(ph)}" ${req ? 'required' : ''} ${['labor_rate', 'vat', 'quote_validity_days'].includes(k) ? 'inputmode="decimal"' : ''}></div>`;
  f.innerHTML = `<div class="ws-cols"><div>
    <h3 style="margin:0 0 4px">Datos del taller</h3>
    ${field(WS_FIELDS[0])}
    <div class="row2">${field(WS_FIELDS[1])}${field(WS_FIELDS[2])}</div>
    ${field(WS_FIELDS[3])}${field(WS_FIELDS[4])}
    <div class="row2">${field(WS_FIELDS[5])}${field(WS_FIELDS[6])}</div>
    <div class="row3">${field(WS_FIELDS[7])}${field(WS_FIELDS[8])}${field(WS_FIELDS[9])}</div>
    </div><div>${listingBlock(data)}</div></div>
    <div class="err" id="${formId}Err"></div>
    <button class="btn">${button}</button>`;
  f.onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(f).entries());
    const row = { owner_id: session.user.id, updated_at: new Date().toISOString() };
    for (const [k] of WS_FIELDS) {
      const v = (fd[k] ?? '').trim();
      row[k] = ['labor_rate', 'vat'].includes(k) ? (num(v) ?? (k === 'vat' ? 21 : 45)) : k === 'quote_validity_days' ? (parseInt(v, 10) || 12) : (v || null);
    }
    // Visible en la app (solicitudes de presupuesto).
    row.listed = !!fd.listed;
    for (const k of ['city', 'province', 'postal_code', 'description']) row[k] = (fd[k] ?? '').trim() || null;
    row.vehicle_types = ['car', 'moto'].filter((t) => fd['vt_' + t]);
    if (row.vehicle_types.length === 0) row.vehicle_types = ['car'];
    if (row.listed && !row.city) { $(formId + 'Err').textContent = 'Para aparecer en la app hace falta la ciudad.'; return; }
    if (!row.name) { $(formId + 'Err').textContent = 'Falta el nombre del taller.'; return; }
    const q = workshop ? sb.from('workshops').update(row).eq('id', workshop.id) : sb.from('workshops').insert(row);
    const { error } = await q;
    if (error) { $(formId + 'Err').textContent = 'No se pudo guardar: ' + error.message; return; }
    // El nombre del taller firma también los trabajos que apunta.
    await sb.from('profiles').upsert({ user_id: session.user.id, display_name: row.name, is_workshop: true, phone: row.phone, updated_at: row.updated_at });
    const first = !workshop;
    await loadWorkshop();
    if (first) { localStorage.removeItem('garaje.skipSetup'); enter(); } else { show('settingsOk'); setTimeout(() => show('settingsOk', false), 2000); }
  };
}
$('skipSetup').onclick = (e) => { e.preventDefault(); localStorage.setItem('garaje.skipSetup', '1'); enter(); };

// ------------------------------------------------------------------ pestañas
for (const b of document.querySelectorAll('.tabs button[data-tab]')) b.onclick = () => setTab(b.dataset.tab);
// "Más" (móvil): Piezas, Proveedores, Mi taller y salir en una hoja desde abajo.
document.querySelector('.tabs .more-btn').onclick = () => {
  const items = [...document.querySelectorAll('.tabs button.secondary')].filter((b) => !b.classList.contains('hidden'));
  $('moreList').innerHTML = items.map((b) => `<button class="sheet-item" data-go="${b.dataset.tab}"><i class="ni">${svgIcon(b.dataset.icon)}</i>${esc(b.textContent.trim())}</button>`).join('')
    + `<button class="sheet-item" data-go="logout"><i class="ni">${svgIcon('logout')}</i>Salir</button>`;
  for (const it of $('moreList').querySelectorAll('[data-go]')) {
    it.onclick = () => { $('moreSheet').close(); if (it.dataset.go === 'logout') $('logout').click(); else setTab(it.dataset.go); };
  }
  $('moreSheet').showModal();
};
$('moreSheet').onclick = (e) => { if (e.target === $('moreSheet')) $('moreSheet').close(); };
function setTab(t) {
  tab = t;
  for (const b of document.querySelectorAll('.tabs button[data-tab]')) b.classList.toggle('on', b.dataset.tab === t);
  document.querySelector('.tabs .more-btn').classList.toggle('on', ['parts', 'suppliers', 'team', 'settings'].includes(t));
  for (const id of ['tab-jobs', 'tab-leads', 'tab-agenda', 'tab-cars', 'tab-parts', 'tab-suppliers', 'tab-team', 'tab-settings', 'job', 'vehicle']) show(id, false);
  show('tab-' + t);
  if (t === 'jobs') renderBoard();
  if (t === 'leads') renderLeads();
  if (t === 'agenda') renderAgenda();
  if (t === 'cars') renderGrid();
  if (t === 'parts') renderParts();
  if (t === 'suppliers') renderSuppliers();
  if (t === 'settings') renderWsForm('settingsForm', workshop || {}, 'Guardar');
  if (t === 'team') renderTeam();
  job = null; current = null;
  window.scrollTo(0, 0);
}

// ------------------------------------------------------------------ coches
async function loadVehicles() {
  $('listErr').textContent = '';
  const [{ data: rows, error }, { data: myRoles }] = await Promise.all([
    sb.from('vehicles').select('id,name,data,version,updated_at').order('updated_at', { ascending: false }),
    sb.rpc('my_roles'),
  ]);
  if (error) { $('listErr').textContent = 'No se pudieron cargar los coches: ' + error.message; return; }
  roles = Object.fromEntries((myRoles || []).map((r) => [r.vehicle_id, r.role]));
  vehicles = rows || [];
  // Quién es el dueño de cada coche y cómo contactarle (nombre y teléfono de su perfil en la app).
  const loaded = await Promise.all(vehicles.map((v) => people[v.id] ? null
    : sb.rpc('vehicle_people', { p_vehicle: v.id }).then(({ data }) => [v.id, data || []], () => [v.id, []])));
  for (const e of loaded) if (e) people[e[0]] = e[1];
  // Lo que le toca a cada coche, tal como lo calcula la app del cliente.
  if (vehicles.length) {
    const { data: st } = await sb.from('vehicle_status').select('*').in('vehicle_id', vehicles.map((v) => v.id));
    vstatus = Object.fromEntries((st || []).map((x) => [x.vehicle_id, x]));
  }
  if (tab === 'cars' && !current) renderGrid();
  if (current) {
    const fresh = vehicles.find((v) => v.id === current.id);
    if (fresh) { current = fresh; renderVehicle(); }
  }
  if (job) jobVehicle = vehicles.find((v) => v.id === job.vehicle_id) || jobVehicle;
}
/** ITV: "Caducada", "en N días" (si quedan menos de 45) o nada. */
function itvBadge(iso) {
  if (!iso) return '';
  const days = Math.round((new Date(iso.length === 10 ? iso + 'T12:00:00' : iso) - new Date()) / 86400000);
  if (days < 0) return '<span class="due late">ITV caducada</span>';
  if (days <= 45) return `<span class="due today">ITV en ${days} ${days === 1 ? 'día' : 'días'}</span>`;
  return '';
}
const attentionOf = (id) => (vstatus[id]?.items || []).filter((i) => i.level === 'red' || i.level === 'amber');

function renderGrid() {
  const g = $('grid');
  g.innerHTML = '';
  show('empty', vehicles.length === 0);
  const q = $('carSearch').value.trim().toLowerCase();
  const openOf = (id) => jobs.find((j) => j.vehicle_id === id && !['delivered', 'cancelled'].includes(j.status));
  const list = vehicles.filter((row) => {
    if (!q) return true;
    const s = summary(row); const o = ownerOf(row.id);
    return [s.name, s.plate, (s.plate || '').replace(/\s/g, ''), o?.display_name, o?.phone].some((x) => (x || '').toLowerCase().includes(q));
  }).sort((a, b) => (openOf(b.id) ? 1 : 0) - (openOf(a.id) ? 1 : 0) || attentionOf(b.id).length - attentionOf(a.id).length || b.updated_at.localeCompare(a.updated_at));
  if (q && !list.length) g.innerHTML = '<p class="muted">Ningún coche coincide con la búsqueda.</p>';
  for (const row of list) {
    const s = summary(row);
    const open = openOf(row.id);
    const att = attentionOf(row.id);
    const reds = att.filter((i) => i.level === 'red').length;
    const el = document.createElement('div');
    el.className = 'card vcard';
    const o = ownerOf(row.id);
    el.innerHTML = `${photoImg(s.photo, 64)}<h3>${esc(s.name)}</h3><span class="plate">${esc(s.plate)}</span>${s.role !== 'workshop' ? `<span class="badge ${s.role}">${roleName(s.role)}</span>` : ''}
      <div class="vchips">${open ? `<span class="status ${open.status}">OR ${open.number} · ${STATUS[open.status]}</span>` : ''}${itvBadge(s.itv)}
        ${att.length ? `<span class="due ${reds ? 'late' : 'today'}">${att.length === 1 ? 'Le toca 1 cosa' : `Le tocan ${att.length} cosas`}</span>` : ''}</div>
      ${o ? `<div class="owner-line"><div class="who-line"><b>${personName(o)}</b><small>${o.phone ? esc(fmtPhone(o.phone)) : 'sin teléfono'}</small></div>
        ${isMe(o) ? '' : `<div class="icons">${contactButtons(o.phone, o.phone ? null : o.email, `Hola ${o.display_name}, te escribo del taller por tu ${s.name}.`, o.display_name)}</div>`}</div>` : ''}
      <div class="kv"><div><b>${fmtKm(s.km)}</b><small>${s.kmAt ? 'el ' + fmtDate(s.kmAt) : 'sin lectura'}</small></div>
      <div><b>${fmtDate(s.itv)}</b><small>ITV</small></div></div>
      <p class="muted" style="margin:10px 0 0;font-size:14px">Último: ${esc(s.last)}</p>`;
    el.onclick = () => openVehicle(row);
    for (const a of el.querySelectorAll('.owner-line a')) a.onclick = (e) => e.stopPropagation();
    g.appendChild(el);
  }
}
$('carSearch').addEventListener('input', () => renderGrid());

$('joinForm').onsubmit = async (e) => {
  e.preventDefault();
  // Vale el código o el enlace que manda la app (…?c=ABC123).
  const raw = $('joinCode').value.trim();
  const code = ((raw.match(/[?&]c=([A-Za-z0-9]{6})/) || [])[1] || raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 6) { $('listErr').textContent = 'El código tiene 6 letras o números. También puedes pegar el enlace que te ha mandado el cliente.'; return; }
  $('listErr').textContent = '';
  const { error } = await sb.rpc('accept_invite', { p_code: code });
  if (error) { $('listErr').textContent = error.message; return; }
  $('joinCode').value = '';
  await loadVehicles();
  renderGrid();
};

function openVehicle(row) {
  current = row;
  show('tab-cars', false); show('vehicle');
  $('fDate').value = today();
  $('fKm').value = summary(row).km ?? '';
  $('lines').innerHTML = '';
  addLine();
  show('saveOk', false); $('saveErr').textContent = '';
  renderVehicle();
  window.scrollTo(0, 0);
}
$('back').onclick = (e) => { e.preventDefault(); current = null; setTab('cars'); };
$('vNewJob').onclick = () => newJobFor(current);

function renderVehicle() {
  const s = summary(current);
  $('vName').textContent = s.name;
  setPhoto('vPhoto', s.photo);
  $('vPlate').textContent = s.plate;
  $('vRole').textContent = roleName(s.role); $('vRole').className = 'badge ' + s.role;
  $('vKm').textContent = fmtKm(s.km);
  $('vKmSub').textContent = s.kmAt ? 'el ' + fmtDate(s.kmAt) : 'sin lectura';
  $('vItv').textContent = fmtDate(s.itv);
  $('vLast').textContent = s.last;
  renderPeople(current, s);
  renderSpecs(s.prof);
  renderDue(current);
  renderVehicleJobs(current);
  show('vLeaveWrap', isOwner() && s.role === 'workshop');
  const tb = $('history');
  tb.innerHTML = '';
  show('noHistory', s.events.length === 0);
  for (const e of s.events) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td data-label="Fecha">${fmtDate(e.at)}</td><td class="h-what"><b>${esc(itemName(e.catalog_id, s.prof))}</b>${e.note ? `<small>${esc(e.note)}</small>` : ''}</td>
      <td data-label="Km">${e.reading_value != null ? fmtKm(e.reading_value) : '—'}</td><td data-label="Coste">${fmtEur(e.cost) || '—'}</td><td data-label="Quién">${esc(e.author || '—')}</td>`;
    tb.appendChild(tr);
  }
}

const FUEL = { diesel: 'Diésel', gasoline: 'Gasolina', petrol: 'Gasolina', hybrid: 'Híbrido', phev: 'Híbrido enchufable', electric: 'Eléctrico', lpg: 'GLP', cng: 'GNC' };
/** Motor, combustible, año, matriculación y bastidor. */
function renderSpecs(prof) {
  const eng = engines[prof.engine_id];
  const bits = [eng?.engine || '', FUEL[prof.fuel] || prof.fuel || '', prof.year ? String(prof.year) : '',
    prof.first_registration ? 'matriculado el ' + fmtDate(prof.first_registration) : '', prof.vin ? 'bastidor ' + prof.vin : ''].filter(Boolean);
  $('vSpecs').textContent = bits.join(' · ');
}
/** "Lo que le toca", con el semáforo que publica la app del cliente. */
function renderDue(row) {
  const st = vstatus[row.id];
  const box = $('vDue');
  if (!st) {
    $('vDueSub').textContent = '';
    box.innerHTML = '<p class="muted">Cuando el dueño tenga la última versión de Garaje, aquí verás lo que le toca a su vehículo, con los mismos colores que ve él en su móvil.</p>';
    show('vDueJob', false);
    return;
  }
  $('vDueSub').textContent = `Según la app del dueño · actualizado ${ago(st.updated_at)}${st.km ? ' · ' + fmtKm(st.km) : ''}`;
  const order = { red: 0, amber: 1, unknown: 2, green: 3 };
  const items = [...(st.items || [])].sort((a, b) => order[a.level] - order[b.level] || (a.km_left ?? 1e9) - (b.km_left ?? 1e9));
  const att = items.filter((i) => i.level === 'red' || i.level === 'amber');
  const rest = items.filter((i) => i.level === 'unknown');
  const ok = items.filter((i) => i.level === 'green');
  const row1 = (i) => `<div class="due-item ${i.level}"><i></i><div><b>${esc(i.name)}</b><small>${esc(i.reason || '')}</small></div></div>`;
  box.innerHTML = (att.length ? att.map(row1).join('') : '<p class="muted">Nada urgente ahora mismo.</p>')
    + (rest.length ? `<details class="due-more"><summary>${rest.length} sin datos (no se sabe cuándo se hizo)</summary>${rest.map(row1).join('')}</details>` : '')
    + (ok.length ? `<details class="due-more"><summary>${ok.length} al día</summary>${ok.map(row1).join('')}</details>` : '');
  show('vDueJob', att.length > 0 && !!workshop);
  $('vDueJob').onclick = () => newJobFor(row, {
    customer_request: 'Lo que le toca según Garaje: ' + att.map((i) => i.name).join(', '),
    lines: att.map((i) => ({ kind: 'labor', description: i.name, catalog_id: i.id.startsWith('custom:') ? '' : i.id, qty: 1, unit_price: workshop.labor_rate, discount: '' })),
  });
}
/** Órdenes y citas de este coche. */
function renderVehicleJobs(row) {
  const js = jobs.filter((j) => j.vehicle_id === row.id).sort((a, b) => b.number - a.number);
  const ap = appointments.filter((a) => a.vehicle_id === row.id && new Date(a.starts_at) >= new Date(Date.now() - 86400000)).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const box = $('vJobs');
  box.innerHTML = '';
  if (!js.length && !ap.length) { box.innerHTML = '<p class="muted">Ninguna todavía. Ábrele una orden o dale cita desde la Agenda.</p>'; return; }
  for (const a of ap) {
    const b = document.createElement('button');
    b.className = 'vj-row';
    b.innerHTML = `<span class="ag-kind cita">Cita</span><b>${esc(a.title)}</b><small>${fmtTime(a.starts_at)}</small>`;
    b.onclick = () => { setTab('agenda'); agendaStart = monday(new Date(a.starts_at)); renderAgenda(); };
    box.appendChild(b);
  }
  for (const j of js) {
    const b = document.createElement('button');
    b.className = 'vj-row';
    b.innerHTML = `<span class="num-tag">OR ${j.number}</span><b>${esc(j.customer_request ? j.customer_request.slice(0, 70) : 'Orden de trabajo')}</b><span class="status ${j.status}">${STATUS[j.status]}</span>${isManager() && (j.lines || []).length ? `<small>${fmtEur(totals(j).total)}</small>` : ''}`;
    b.onclick = () => openJob(j);
    box.appendChild(b);
  }
}
$('vLeave').onclick = async (e) => {
  e.preventDefault();
  const s = summary(current);
  if (!(await dialog(`<h3>¿Dejar de ver ${esc(s.name)}?</h3><p class="muted">Tu taller ya no verá este vehículo ni su historial. Lo que ya apuntasteis sigue en el móvil del cliente. Para volver a verlo, el cliente tendría que darte otro código.</p>`, 'Dejar de verlo', () => true))) return;
  const { error } = await sb.from('vehicle_members').delete().eq('vehicle_id', current.id).eq('user_id', session.user.id);
  if (error) { alert('No se pudo: ' + error.message); return; }
  current = null;
  await loadVehicles();
  setTab('cars');
};

/** Dueño y familiares del coche con sus datos de contacto. */
function renderPeople(row, s) {
  const list = peopleOf(row.id);
  const box = $('vPeople');
  if (list.length === 0) { box.innerHTML = ''; return; }
  box.innerHTML = list.map((p) => `<div class="person">
      <div><b>${personName(p)}</b> <span class="badge ${p.role}">${roleName(p.role)}</span>
        <small>${[p.phone ? esc(fmtPhone(p.phone)) : '', p.email ? esc(p.email) : ''].filter(Boolean).join(' · ')}</small></div>
      <div class="icons">${isMe(p) ? '' : contactButtons(p.phone, p.email, `Hola ${p.display_name}, te escribo del taller por tu ${s.name}.`, p.display_name)}</div>
    </div>`).join('')
    + (list.some((p) => p.role === 'owner' && !p.phone && !isMe(p)) ? '<p class="muted" style="font-size:13px;margin:6px 0 0">El dueño no ha puesto su teléfono en Garaje. Puede añadirlo en la app: Ajustes → Tu nombre en Garaje.</p>' : '');
}

function itemOptions(prof, selected) {
  const opts = Object.entries(catalogNames).sort((a, b) => a[1].localeCompare(b[1], 'es'));
  for (const c of prof?.custom_items || []) opts.push(['custom:' + c.id, c.name + ' (propio)']);
  return opts.map(([id, name]) => `<option value="${esc(id)}" ${id === selected ? 'selected' : ''}>${esc(name)}</option>`).join('');
}
function addLine() {
  const div = document.createElement('div');
  div.className = 'line';
  div.innerHTML = `<div><select class="item"><option value="">— Trabajo —</option>${itemOptions(profileOf(current))}</select></div>
    <div><input class="cost" type="number" step="0.01" min="0" placeholder="€"></div>
    <div><input class="note" placeholder="Nota (marca del aceite, referencia…)"></div>
    <button class="x" title="Quitar">×</button>`;
  div.querySelector('.x').onclick = (e) => { e.preventDefault(); if ($('lines').children.length > 1) div.remove(); };
  $('lines').appendChild(div);
}
$('addLine').onclick = (e) => { e.preventDefault(); addLine(); };

$('save').onclick = async () => {
  $('saveErr').textContent = ''; show('saveOk', false);
  const date = $('fDate').value;
  const km = $('fKm').value === '' ? null : parseInt($('fKm').value, 10);
  const lines = [...$('lines').querySelectorAll('.line')].map((l) => ({
    catalogId: l.querySelector('.item').value,
    cost: num(l.querySelector('.cost').value),
    note: l.querySelector('.note').value.trim() || null,
  })).filter((l) => l.catalogId);
  if (!date) { $('saveErr').textContent = 'Falta la fecha.'; return; }
  if (lines.length === 0) { $('saveErr').textContent = 'Elige al menos un trabajo.'; return; }
  const s = summary(current);
  if (km != null && s.km != null && km < s.km - 1000) {
    if (!confirm(`Los km (${fmtKm(km)}) son menores que la última lectura (${fmtKm(s.km)}). ¿Seguro?`)) return;
  }
  const at = date === today() ? new Date() : new Date(date + 'T12:00:00');
  $('save').disabled = true;
  try {
    await writeHistory(current.id, at.toISOString(), km, lines);
    show('saveOk'); $('saveOk').textContent = `Guardado. ${lines.length === 1 ? 'El trabajo ya está' : 'Los ' + lines.length + ' trabajos ya están'} en el móvil del dueño.`;
    $('lines').innerHTML = ''; addLine();
    await loadVehicles();
  } catch (e) {
    $('saveErr').textContent = 'No se pudo guardar: ' + (e.message || e);
  } finally {
    $('save').disabled = false;
  }
};

// Añade trabajos al historial del coche (mismo formato que la app).
async function writeHistory(vehicleId, atIso, km, lines) {
  const author = workshop?.name || profile.display_name;
  await withRetry(vehicleId, async (row) => {
    const doc = structuredClone(row.data);
    doc.events ||= []; doc.readings ||= [];
    let first = true;
    for (const l of lines) {
      const id = newId();
      doc.events.push({ id, catalog_id: l.catalogId || null, at: atIso, reading_value: km, person_id: null, cost: l.cost, note: l.note, author });
      // Igual que la app: la lectura de km va ligada al primer evento (id-km).
      if (km != null && first) doc.readings.push({ id: id + '-km', value: km, at: atIso, source: 'event' });
      first = false;
    }
    return doc;
  });
}

// Lee la fila fresca, aplica el cambio y escribe solo si nadie la tocó entre
// medias (version). Si otro móvil subió algo, vuelve a intentarlo sobre lo nuevo.
async function withRetry(vehicleId, mutate) {
  for (let i = 0; i < 4; i++) {
    const { data: row, error } = await sb.from('vehicles').select('id,name,data,version').eq('id', vehicleId).single();
    if (error) throw error;
    const doc = await mutate(row);
    const { data: updated, error: e2 } = await sb.from('vehicles')
      .update({ data: doc, version: row.version + 1, updated_at: new Date().toISOString(), updated_by: 'web:' + session.user.id })
      .eq('id', row.id).eq('version', row.version).select('id');
    if (e2) throw e2;
    if (updated && updated.length > 0) return;
  }
  throw new Error('el coche cambió mientras guardabas; vuelve a intentarlo');
}

// ------------------------------------------------------------------ órdenes
async function loadJobs() {
  const { data, error } = await sb.from('jobs').select('*').eq('workshop_id', workshop.id).order('updated_at', { ascending: false }).limit(300);
  if (error) { console.warn(error); return; }
  jobs = data || [];
  if (tab === 'jobs' && !job) renderBoard();
  if (tab === 'agenda') renderAgenda();
  if (job) {
    const fresh = jobs.find((j) => j.id === job.id);
    // Si el cliente decidió mientras estaba abierta, refresca estado y botones.
    if (fresh && (fresh.status !== job.status || fresh.updated_at !== job.updated_at)) {
      job = { ...fresh, lines: dirty ? job.lines : fresh.lines };
      renderJobHead();
    }
  }
}
function vehicleOf(j) { return vehicles.find((v) => v.id === j.vehicle_id); }
/** Entrega prevista: "hoy", "atrasada" o la fecha. */
function dueBadge(j) {
  if (!j.promised_at || ['delivered', 'cancelled'].includes(j.status)) return '';
  const t = today();
  if (j.status !== 'ready' && j.promised_at < t) return `<span class="due late">Atrasada · ${fmtDate(j.promised_at).slice(0, 5)}</span>`;
  if (j.promised_at === t) return '<span class="due today">Entrega hoy</span>';
  return `<span class="due">Entrega ${fmtDate(j.promised_at).slice(0, 5)}</span>`;
}
function jobCard(j) {
  const v = vehicleOf(j);
  const s = v ? summary(v) : { name: 'Coche sin acceso', plate: '' };
  const el = document.createElement('div');
  el.className = 'jcard';
  const who = j.assigned_to ? nameOf(j.assigned_to) : '';
  const total = isManager() && (j.lines || []).length ? fmtEur(totals(j).total) : '';
  el.innerHTML = `${photoImg(s.photo, 44)}<span class="num-tag">OR ${j.number}</span>${j.lead_id ? '<span class="badge workshop">Garaje</span>' : ''}<b>${esc(s.name)}</b>
    <small>${esc(s.plate)}${j.customer_name ? ' · ' + esc(j.customer_name) : ''}</small>
    ${j.customer_request ? `<small class="req">${esc(j.customer_request.slice(0, 80))}</small>` : ''}
    <div class="jfoot"><span class="status ${j.status}">${STATUS[j.status]}</span>${dueBadge(j)}${total ? `<span class="jtotal">${total}</span>` : ''}
      ${who ? `<span class="avatar mini" title="Responsable: ${esc(who)}">${esc(who.trim()[0].toUpperCase())}</span>` : ''}</div>`;
  el.onclick = () => openJob(j);
  return el;
}
/** Órdenes que pasan el buscador y "Solo las mías". */
function visibleJobs() {
  const q = $('jobSearch').value.trim().toLowerCase();
  const mine = $('onlyMine').checked;
  return jobs.filter((j) => {
    if (mine && j.assigned_to !== session.user.id) return false;
    if (!q) return true;
    const v = vehicleOf(j); const s = v ? summary(v) : {};
    return [`or ${j.number}`, String(j.number), s.name, s.plate, (s.plate || '').replace(/\s/g, ''), j.customer_name, j.customer_request]
      .some((x) => (x || '').toLowerCase().includes(q));
  });
}
$('jobSearch').addEventListener('input', () => renderBoard());
$('onlyMine').addEventListener('change', () => renderBoard());

// Primeros pasos del taller: una lista que se va marcando sola y desaparece
// cuando está todo hecho (o si el taller la cierra).
const onboardKey = () => 'garaje.onboard.' + workshop.id;
function onboardSteps() {
  const w = workshop;
  return [
    { done: !!(w.tax_id && w.registry_no && w.address && w.phone), title: 'Completa los datos del taller',
      text: 'NIF, nº de registro industrial, dirección y teléfono. Salen en los presupuestos y en la orden de reparación.', label: 'Ir a Mi taller', go: () => setTab('settings') },
    { done: !!(w.listed && w.city), title: 'Aparece en la app Garaje',
      text: 'Marca "Aparecer en la app" y pon tu ciudad: los conductores de tu zona te pedirán presupuesto desde el móvil.', label: 'Activarlo', go: () => setTab('settings') },
    { done: jobs.length > 0 || vehicles.some((v) => roles[v.id] === 'workshop'), title: 'Recibe el primer coche',
      text: 'El cliente abre Garaje → Mi coche → Compartir → Taller y te enseña un código. Lo escribes en Coches y ves su historial.', label: 'Tengo un código', go: () => { setTab('cars'); $('joinCode').focus(); } },
    { done: jobs.length > 0, title: 'Abre tu primera orden de trabajo',
      text: 'Recepción, presupuesto con mano de obra y piezas, y el cliente lo aprueba en su móvil. Al entregar, queda en el historial del coche.', label: '+ Nueva orden', go: () => $('newJobBtn').click() },
    { done: suppliers.length > 0, title: 'Añade tus proveedores',
      text: 'Tus distribuidores de recambios, para elegirlos en cada pieza y llamarlos o escribirles por WhatsApp con un toque.', label: 'Añadir proveedor', go: () => { setTab('suppliers'); editSupplier({}); } },
  ];
}
function renderOnboard() {
  const box = $('onboard');
  const steps = workshop ? onboardSteps() : [];
  const left = steps.filter((s) => !s.done).length;
  let hidden = false;
  try { hidden = localStorage.getItem(onboardKey()) === '1'; } catch { /* sin almacenamiento */ }
  if (!workshop || !isOwner() || left === 0 || hidden) { show('onboard', false); return; }
  const done = steps.length - left;
  box.innerHTML = `<div class="top"><div><h3 style="margin:0">Primeros pasos con Garaje</h3>
      <p class="muted" style="margin:2px 0 0;font-size:14px">${done} de ${steps.length} hechos. Se marcan solos.</p></div>
      <a href="#" class="muted" id="onboardHide" style="font-size:14px">Ocultar</a></div>
    <div class="bar"><span style="width:${Math.round(done / steps.length * 100)}%"></span></div>
    <ol class="ob-steps"></ol>`;
  const ol = box.querySelector('.ob-steps');
  for (const s of steps) {
    const li = document.createElement('li');
    li.className = s.done ? 'done' : '';
    li.innerHTML = `<span class="tick">${s.done ? '✓' : ''}</span><div><b>${esc(s.title)}</b>${s.done ? '' : `<p class="muted">${esc(s.text)}</p>`}</div>`;
    if (!s.done) {
      const b = document.createElement('button');
      b.className = 'btn ghost small';
      b.textContent = s.label;
      b.onclick = s.go;
      li.appendChild(b);
    }
    ol.appendChild(li);
  }
  $('onboardHide').onclick = (e) => {
    e.preventDefault();
    try { localStorage.setItem(onboardKey(), '1'); } catch { /* sin almacenamiento */ }
    show('onboard', false);
  };
  show('onboard');
}

/** Tarjeta de arriba de Órdenes, como la de kilómetros de la app: saludo y lo que hay hoy. */
function renderHero() {
  const h = $('ws-hero');
  if (!workshop) { h.innerHTML = ''; return; }
  const hour = new Date().getHours();
  const hello = hour < 14 ? 'Buenos días' : hour < 21 ? 'Buenas tardes' : 'Buenas noches';
  const open = jobs.filter((j) => !['delivered', 'cancelled'].includes(j.status));
  const tiles = [
    ['En el taller', open.filter((j) => ['received', 'diagnosis', 'approved', 'in_progress', 'waiting_parts'].includes(j.status)).length, 'jobs'],
    ['Esperando al cliente', open.filter((j) => ['quote_sent', 'rejected'].includes(j.status)).length, 'jobs'],
    ['Listos para recoger', open.filter((j) => j.status === 'ready').length, 'jobs'],
    ...(isManager() ? [['Solicitudes por atender', leads.filter((l) => NEEDS_ACTION.includes(l.status)).length, 'leads']] : [['Entregas previstas hoy', open.filter((j) => j.promised_at === today()).length, 'jobs']]),
  ];
  const dateStr = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  h.innerHTML = `<div class="ws-hero-top"><div><small>${esc(dateStr)}</small><h2>${hello}, ${esc(workshop.name)}</h2></div></div>
    <div class="ws-hero-tiles">${tiles.map(([label, n, go]) => `<button class="htile${n ? '' : ' zero'}" data-go="${go}"><b>${n}</b><span>${label}</span></button>`).join('')}</div>`;
  for (const t of h.querySelectorAll('[data-go="leads"]')) t.onclick = () => setTab('leads');
  for (const t of h.querySelectorAll('[data-go="jobs"]')) t.onclick = () => $('board').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderBoard() {
  renderOnboard();
  renderHero();
  // "Solo las mías" cuando hay equipo.
  show('mineWrap', team.filter((m) => m.joined).length > 1 || myRole === 'mechanic');
  const shown = visibleJobs();
  const b = $('board');
  b.innerHTML = '';
  for (const [title, states] of COLUMNS) {
    const list = shown.filter((j) => states.includes(j.status))
      .sort((x, y) => (x.promised_at || '9999').localeCompare(y.promised_at || '9999') || x.number - y.number);
    const col = document.createElement('div');
    col.className = 'col';
    col.innerHTML = `<h4>${title}<span>${list.length}</span></h4>`;
    for (const j of list) col.appendChild(jobCard(j));
    if (jobs.length === 0) {
      const hint = { Entrada: 'Aquí entra cada coche que recibes, con "+ Nueva orden".', 'Esperando al cliente': 'Cuando envías el presupuesto, espera aquí a que el cliente lo apruebe desde su móvil.', 'En el taller': 'Lo aprobado y lo que estás reparando.', 'Listos para recoger': 'Al marcarlo listo, el cliente recibe un aviso para venir a por él.' }[title];
      if (hint) col.insertAdjacentHTML('beforeend', `<p class="muted empty-col">${hint}</p>`);
    }
    b.appendChild(col);
  }
  const done = $('doneJobs');
  done.innerHTML = '';
  const closed = shown.filter((j) => ['delivered', 'cancelled'].includes(j.status)).slice(0, 30);
  if (closed.length === 0) done.innerHTML = `<p class="muted">${$('jobSearch').value.trim() ? 'Ninguna coincide con la búsqueda.' : 'Ninguna todavía.'}</p>`;
  for (const j of closed) done.appendChild(jobCard(j));
}

$('newJobBtn').onclick = async () => {
  if (vehicles.length === 0) {
    await dialog('<h3>Primero, un coche</h3><p class="muted">Para abrir una orden necesitas acceso al coche: el cliente abre Garaje → Mi coche → Compartir → Taller y te da un código. Escríbelo en la pestaña Coches.</p>', 'Ir a Coches', () => true) && setTab('cars');
    return;
  }
  const opts = vehicles.map((v) => { const s = summary(v); const o = ownerOf(v.id); return `<option value="${v.id}">${esc(s.name)}${s.plate ? ' · ' + esc(s.plate) : ''}${o ? ' · ' + esc(o.display_name) : ''}</option>`; }).join('');
  const r = await dialog(`<h3>Nueva orden de trabajo</h3>
    <label>Coche</label><select name="v">${opts}</select>
    <p class="muted" style="font-size:13px;margin:4px 0 0">¿No está? Pide al cliente el código de taller y escríbelo en la pestaña Coches.</p>
    <label>Lo que pide el cliente</label><textarea name="req" rows="2" placeholder="Cambio de aceite, ruido al frenar…"></textarea>
    <div class="row2"><div><label>Km al recibirlo</label><input name="km" inputmode="numeric" placeholder="Opcional"></div>
      <div><label>Entrega prevista</label><input name="promised" type="date" min="${today()}"></div></div>
    ${isManager() && team.filter((m) => m.joined).length > 1 ? `<label>Responsable</label><select name="who">${assigneeOptions(null)}</select>` : ''}`,
    'Abrir orden', (fd) => fd);
  if (!r) return;
  const row = vehicles.find((v) => v.id === r.v);
  const km = parseInt(String(r.km || '').replace(/\D/g, ''), 10);
  newJobFor(row, {
    customer_request: (r.req || '').trim() || null,
    km: Number.isFinite(km) ? km : null,
    promised_at: r.promised || null,
    assigned_to: r.who || (myRole === 'mechanic' ? session.user.id : null),
  });
};

async function newJobFor(row, extra = {}) {
  const s = summary(row);
  // Cliente: el propietario del coche (nombre y teléfono de su perfil).
  let name = null, phone = null;
  try {
    const { data } = await sb.rpc('vehicle_people', { p_vehicle: row.id });
    const owner = (data || []).find((p) => p.role === 'owner');
    if (owner) { name = owner.display_name; phone = owner.phone; }
  } catch { /* sin datos */ }
  const base = {
    workshop_id: workshop.id, vehicle_id: row.id, km: s.km, vat: workshop.vat,
    customer_name: name, customer_phone: phone,
  };
  // Desde una solicitud: lo que pidió el cliente, su teléfono, la cita.
  for (const [k, v] of Object.entries(extra)) if (v != null && v !== '') base[k] = v;
  const { data, error } = await sb.from('jobs').insert(base).select('*').single();
  if (error) { alert('No se pudo abrir la orden: ' + error.message); return null; }
  jobs.unshift(data);
  openJob(data);
  return data;
}

// ------------------------------------------------------------------ solicitudes (clientes enviados por Garaje)
async function loadLeads() {
  if (!workshop || !isManager()) return;
  const { data, error } = await sb.from('leads').select('*').eq('workshop_id', workshop.id).order('created_at', { ascending: false }).limit(200);
  if (error) { console.warn(error); return; }
  leads = data || [];
  const n = leads.filter((l) => NEEDS_ACTION.includes(l.status)).length;
  const b = $('leadsBadge');
  b.textContent = n;
  b.classList.toggle('hidden', n === 0);
  if (tab === 'leads') renderLeads();
  if (tab === 'agenda') renderAgenda();
  if (tab === 'jobs' && !job) renderHero();
}

/** "hace 5 min", "hace 3 h", "ayer a las 19:43", "el 7/10". */
function ago(iso) {
  const d = new Date(iso), mins = Math.round((Date.now() - d) / 60000);
  if (mins < 1) return 'ahora mismo';
  if (mins < 60) return `hace ${mins} min`;
  if (mins < 24 * 60) return `hace ${Math.round(mins / 60)} h`;
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (sameDay(d, y)) return 'ayer a las ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  return 'el ' + d.toLocaleDateString('es-ES', { day: 'numeric', month: 'numeric' });
}
const NEEDS_ACTION = ['sent', 'reschedule', 'accepted'];
// Grupos de la pestaña, en el orden en que conviene atenderlos.
const LEAD_GROUPS = [
  ['sent', 'Por responder', 'El cliente suele quedarse con el primer taller que contesta.'],
  ['reschedule', 'Piden otra hora', 'Proponles una cita nueva.'],
  ['accepted', 'Aceptadas · abre la orden', 'Ya tienes acceso al vehículo.'],
  ['quoted', 'Esperando al cliente', 'Les ha llegado tu presupuesto al móvil.'],
];

function leadCard(l, compact = false) {
  const v = l.vehicle || {};
  const el = document.createElement('div');
  el.className = 'card lead' + (compact ? ' compact' : '') + ' st-' + l.status;
  el.dataset.id = l.id;
  const meta = [ago(l.created_at), v.km ? fmtKm(v.km) : '', v.year ? esc(v.year) : '', v.fuel ? esc(v.fuel) : ''].filter(Boolean).join(' · ');
  const past = l.appointment_at && new Date(l.appointment_at) < new Date() && ['quoted', 'accepted'].includes(l.status);
  const who = l.customer_name || 'Cliente de Garaje';
  const wa = `Hola ${who}, te escribo de ${workshop?.name || 'el taller'} por tu solicitud de presupuesto${v.name ? ' para el ' + v.name : ''}.`;
  const answer = l.quote_amount != null ? `<div class="lead-box answer"><small>Tu respuesta</small>
      <div><b class="amount">${fmtEur(num(l.quote_amount))}</b>${l.appointment_at ? `<span class="when">${svgIcon('agenda')} ${fmtTime(l.appointment_at)}</span>` : ''}</div>
      ${l.quote_text && !compact ? `<p>${esc(l.quote_text)}</p>` : ''}</div>` : '';
  el.innerHTML = `<div class="top">${photoImg(v.photo, 64)}<div class="lead-head"><b>${esc(v.name || 'Vehículo')}</b> <span class="plate">${esc(v.plate || '')}</span> <span class="status ${l.status}">${LEAD_STATUS[l.status] || l.status}</span>
      <small>${meta}</small></div>
      <div class="actions"></div></div>
    ${compact ? answer : `
    ${(l.items || []).length ? `<div class="lead-items">${l.items.map((i) => `<span class="pill">${esc(i.name)}</span>`).join('')}</div>` : ''}
    ${l.message ? `<p class="lead-msg">${esc(l.message)}</p>` : ''}
    ${l.preferred ? `<p class="lead-pref">${svgIcon('agenda')} Le viene bien: <b>${esc(l.preferred)}</b></p>` : ''}
    <div class="lead-who"><div><b>${esc(who)}</b>${l.customer_phone ? `<small>${esc(fmtPhone(l.customer_phone))}</small>` : '<small>Sin teléfono: responde desde aquí y le llega al móvil.</small>'}</div>
      ${l.customer_phone ? `<div class="icons">${contactButtons(l.customer_phone, null, wa, who)}</div>` : ''}</div>
    ${l.status === 'reschedule' ? `<div class="lead-box warn"><b>Pide otra hora${l.client_preferred_at ? ': propone ' + fmtTime(l.client_preferred_at) : ''}</b>${l.decision_note ? `<p>“${esc(l.decision_note)}”</p>` : ''}</div>` : ''}
    ${l.status === 'accepted' ? `<div class="lead-box ok"><b>Ha aceptado tu presupuesto${l.quote_amount != null ? ' de ' + fmtEur(num(l.quote_amount)) : ''}${l.appointment_at ? ' · cita ' + fmtTime(l.appointment_at) : ''}</b><p>Abre la orden para recibir el vehículo: el cliente verá el estado en su móvil.</p></div>` : ''}
    ${l.status === 'declined' ? `<div class="lead-box"><b>Ha rechazado el presupuesto</b>${l.decision_note ? `<p>“${esc(l.decision_note)}”</p>` : ''}</div>` : ''}
    ${l.status === 'accepted' ? '' : answer}
    ${past ? `<p class="lead-past">La cita que propusiste ya ha pasado. ${l.status === 'quoted' ? 'Cambia la respuesta con una fecha nueva.' : 'Llama al cliente para quedar otro día.'}</p>` : ''}`}`;
  const acts = el.querySelector('.actions');
  const btn = (label, fn, cls = 'btn small') => { const b = document.createElement('button'); b.className = cls; b.textContent = label; b.onclick = fn; acts.appendChild(b); };
  if (l.status === 'sent' || l.status === 'quoted' || l.status === 'reschedule') btn(l.status === 'sent' ? 'Responder' : l.status === 'reschedule' ? 'Proponer otra hora' : 'Cambiar respuesta', () => respondLead(l), l.status === 'quoted' ? 'btn ghost small' : 'btn small');
  if (l.status === 'accepted') btn('Abrir orden', () => convertLead(l));
  if (l.status === 'converted' && l.job_id) btn('Ver orden', () => { const j = jobs.find((x) => x.id === l.job_id); if (j) openJob(j); }, 'btn ghost small');
  if (['sent', 'quoted', 'reschedule', 'accepted', 'declined'].includes(l.status)) btn(l.status === 'declined' ? 'Archivar' : 'Cerrar', () => closeLead(l), 'btn ghost small');
  return el;
}

function renderLeads() {
  const list = $('leadsList');
  list.innerHTML = '';
  const open = leads.filter((l) => LEAD_OPEN.includes(l.status) || l.status === 'declined');
  if (open.length === 0) {
    list.innerHTML = emptyState('leads', 'Ninguna solicitud pendiente', workshop?.listed
      ? 'Los conductores de tu zona pueden pedirte presupuesto desde la app. Cuando llegue una, la verás aquí y te avisaremos.'
      : 'Activa "Aparecer en la app" en Mi taller y los conductores de tu zona podrán pedirte presupuesto.');
  }
  for (const [status, title, hint] of [...LEAD_GROUPS, ['declined', 'Rechazadas', 'Archívalas cuando las hayas visto.']]) {
    // Las que esperan respuesta, la más antigua primero; el resto, la más reciente primero.
    const group = open.filter((l) => l.status === status)
      .sort((a, b) => status === 'sent' ? a.created_at.localeCompare(b.created_at) : b.updated_at.localeCompare(a.updated_at));
    if (!group.length) continue;
    list.insertAdjacentHTML('beforeend', `<div class="group-label">${title}<span>${group.length}</span><small>${hint}</small></div>`);
    for (const l of group) list.appendChild(leadCard(l));
  }
  const done = $('leadsDone');
  done.innerHTML = '';
  const closed = leads.filter((l) => !LEAD_OPEN.includes(l.status) && l.status !== 'declined').slice(0, 30);
  if (closed.length === 0) done.innerHTML = '<p class="muted">Ninguna todavía.</p>';
  for (const l of closed) done.appendChild(leadCard(l, true));
  $('leadsDoneCount').textContent = closed.length ? `(${closed.length})` : '';
}

async function respondLead(l) {
  const def = l.status === 'reschedule' && l.client_preferred_at ? new Date(l.client_preferred_at) : l.appointment_at ? new Date(l.appointment_at) : null;
  const toLocal = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const local = def && def > new Date() ? toLocal(def) : '';
  const items = (l.items || []).map((i) => `<span class="pill">${esc(i.name)}</span>`).join('');
  const r = await dialog(`<h3>${l.status === 'sent' ? 'Responder a' : 'Nueva respuesta para'} ${esc(l.customer_name || 'el cliente')}</h3>
    <div class="dlg-ctx"><b>${esc(l.vehicle?.name || 'Vehículo')}</b>${items ? `<div class="lead-items">${items}</div>` : ''}
      ${l.message ? `<p class="lead-msg">${esc(l.message)}</p>` : ''}
      ${l.preferred ? `<p class="lead-pref">${svgIcon('agenda')} Le viene bien: <b>${esc(l.preferred)}</b></p>` : ''}
      ${l.status === 'reschedule' && l.client_preferred_at ? `<p class="lead-pref">${svgIcon('agenda')} Propone: <b>${fmtTime(l.client_preferred_at)}</b></p>` : ''}</div>
    <label>Precio orientativo, IVA incluido</label><div class="euro"><input name="amount" inputmode="decimal" value="${l.quote_amount ?? ''}" placeholder="0" required><span>€</span></div>
    <label>Qué incluye y comentarios</label><textarea name="text" rows="3" placeholder="Mano de obra y piezas incluidas. Te confirmamos el precio final al ver el vehículo.">${esc(l.quote_text ?? '')}</textarea>
    <label>${l.status === 'reschedule' ? 'Cita nueva (ya está puesta la hora que propone; cámbiala si no te cuadra)' : 'Propón una cita'}</label><input type="datetime-local" name="when" value="${local}" min="${toLocal(new Date())}">
    <p class="muted" style="font-size:13px">Le llega al móvil al momento y puede aceptarlo con un toque. Al aceptar tendrás acceso a su vehículo para abrir la orden.</p>`,
    'Enviar respuesta', (fd) => fd);
  if (!r) return;
  const amount = num(r.amount);
  if (amount == null || amount <= 0) { alert('Pon un precio orientativo.'); return respondLead(l); }
  if (r.when && new Date(r.when) < new Date()) { alert('Esa hora ya ha pasado. Elige una cita futura.'); return respondLead(l); }
  const { error } = await sb.rpc('quote_lead', { p_lead: l.id, p_amount: amount, p_text: (r.text || '').trim() || null, p_appointment: r.when ? new Date(r.when).toISOString() : null });
  if (error) { alert('No se pudo responder: ' + error.message); return; }
  await loadLeads();
}

async function convertLead(l) {
  let row = vehicles.find((v) => v.id === l.vehicle_id);
  if (!row) { await loadVehicles(); row = vehicles.find((v) => v.id === l.vehicle_id); }
  if (!row) { alert('Todavía no tienes acceso a este vehículo: el cliente tiene que aceptar desde la app (o darte el código de taller en la pestaña Coches).'); return; }
  const request = [(l.items || []).map((i) => i.name).join(', '), l.message].filter(Boolean).join('. ');
  const created = await newJobFor(row, {
    customer_request: request || null, lead_id: l.id,
    customer_name: l.customer_name, customer_phone: l.customer_phone,
    promised_at: l.appointment_at ? l.appointment_at.slice(0, 10) : null,
  });
  if (!created) return;
  const { error } = await sb.from('leads').update({ status: 'converted', job_id: created.id, updated_at: new Date().toISOString() }).eq('id', l.id);
  if (error) console.warn(error);
  await loadLeads();
}

// ------------------------------------------------------------------ agenda
const monday = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

async function loadAppointments() {
  if (!workshop) return;
  const since = new Date(); since.setDate(since.getDate() - 60);
  const { data, error } = await sb.from('workshop_appointments').select('*').eq('workshop_id', workshop.id)
    .gte('starts_at', since.toISOString()).order('starts_at').limit(800);
  appointments = error ? [] : (data || []);
  if (tab === 'agenda') renderAgenda();
}
const hhmm = (d) => d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

/** Todo lo que va en la agenda: citas del taller, de la app, propuestas y entregas. */
function agendaItems() {
  const items = [];
  for (const a of appointments) {
    const v = a.vehicle_id ? vehicles.find((x) => x.id === a.vehicle_id) : null;
    items.push({ kind: 'cita', at: new Date(a.starts_at), minutes: a.minutes, title: a.title,
      sub: [v ? summary(v).name : '', a.customer_name, a.assigned_to ? '→ ' + nameOf(a.assigned_to) : ''].filter(Boolean).join(' · '), appt: a });
  }
  for (const l of leads) {
    const j = l.job_id ? jobs.find((x) => x.id === l.job_id) : null;
    if (j && ['delivered', 'cancelled'].includes(j.status)) continue;
    const v = l.vehicle || {};
    const who = l.customer_name || 'Cliente de Garaje';
    if (l.appointment_at && ['accepted', 'converted'].includes(l.status)) {
      items.push({ kind: 'app', at: new Date(l.appointment_at), minutes: 60, title: v.name || 'Vehículo', sub: `${esc(who)}${j ? ' · OR ' + j.number : ' · abre la orden'}`, lead: l, job: j });
    } else if (l.status === 'quoted' && l.appointment_at) {
      items.push({ kind: 'propuesta', at: new Date(l.appointment_at), minutes: 60, title: v.name || 'Vehículo', sub: `${esc(who)} · esperando que acepte`, lead: l });
    } else if (l.status === 'reschedule' && l.client_preferred_at) {
      items.push({ kind: 'propuesta', at: new Date(l.client_preferred_at), minutes: 60, title: v.name || 'Vehículo', sub: `${esc(who)} · propone esta hora`, lead: l });
    }
  }
  for (const j of jobs) {
    if (!j.promised_at || ['delivered', 'cancelled'].includes(j.status)) continue;
    const v = vehicleOf(j); const s = v ? summary(v) : { name: 'Coche' };
    items.push({ kind: 'entrega', at: new Date(j.promised_at + 'T23:59:00'), allDay: true, title: s.name, sub: `OR ${j.number} · ${STATUS[j.status]}`, job: j });
  }
  return items;
}

function renderAgenda() {
  agendaStart ||= monday(new Date());
  const end = new Date(agendaStart); end.setDate(end.getDate() + 6);
  $('agTitle').textContent = `Semana del ${fmtDate(agendaStart.toISOString())} al ${fmtDate(end.toISOString())}`;
  const now = new Date();
  const items = agendaItems();
  // Resumen de hoy y entregas atrasadas (se ven aunque cambies de semana).
  const todays = items.filter((it) => sameDay(it.at, now));
  const nCitas = todays.filter((it) => it.kind === 'cita' || it.kind === 'app').length;
  const nEnt = todays.filter((it) => it.kind === 'entrega').length;
  const late = jobs.filter((j) => j.promised_at && j.promised_at < today() && !['ready', 'delivered', 'cancelled'].includes(j.status));
  const nextUp = items.filter((it) => (it.kind === 'cita' || it.kind === 'app') && it.at > now).sort((a, b) => a.at - b.at)[0];
  $('agSummary').innerHTML = `<div class="ag-today"><small>Hoy</small><b>${nCitas ? `${nCitas} ${nCitas === 1 ? 'cita' : 'citas'}` : 'Sin citas'}${nEnt ? ` · ${nEnt} ${nEnt === 1 ? 'entrega' : 'entregas'}` : ''}</b>
      ${nextUp ? `<span>Siguiente: ${sameDay(nextUp.at, now) ? 'hoy' : DAYS[(nextUp.at.getDay() + 6) % 7].toLowerCase() + ' ' + nextUp.at.getDate()} a las ${hhmm(nextUp.at)} · ${esc(nextUp.title)}</span>` : ''}</div>
    ${late.length ? `<div class="ag-late"><small>Entregas atrasadas</small>${late.map((j) => { const v = vehicleOf(j); return `<button class="late-chip" data-job="${j.id}">OR ${j.number} · ${esc(v ? summary(v).name : 'Coche')} · ${fmtDate(j.promised_at).slice(0, 5)}</button>`; }).join('')}</div>` : ''}`;
  for (const b of $('agSummary').querySelectorAll('[data-job]')) b.onclick = () => openJob(jobs.find((j) => j.id === b.dataset.job));
  const w = $('agWeek');
  w.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(agendaStart); d.setDate(d.getDate() + i);
    const col = document.createElement('div');
    const list = items.filter((it) => sameDay(it.at, d)).sort((a, b) => (a.allDay ? 1 : 0) - (b.allDay ? 1 : 0) || a.at - b.at);
    col.className = 'day' + (sameDay(d, now) ? ' today' : d < now && !sameDay(d, now) ? ' past' : '') + (list.length ? '' : ' empty-day');
    col.innerHTML = `<h4>${DAYS[i]}<b>${d.getDate()}</b></h4>`;
    if (list.length === 0) col.innerHTML += '<p class="muted" style="font-size:12px;margin:0 4px">—</p>';
    for (const it of list) {
      const el = document.createElement('button');
      el.className = 'appt ' + it.kind;
      const endAt = new Date(it.at.getTime() + (it.minutes || 60) * 60000);
      const when = it.allDay ? 'Entrega' : `${hhmm(it.at)}–${hhmm(endAt)}`;
      el.innerHTML = `<small>${when}${it.kind === 'propuesta' ? ' · propuesta' : it.kind === 'app' ? ' · app' : ''}</small><b>${esc(it.title)}</b>${it.sub ? `<small>${it.sub}</small>` : ''}`;
      el.onclick = () => openAgendaItem(it);
      col.appendChild(el);
    }
    // Añadir una cita ese día (no en días pasados).
    if (!(d < now && !sameDay(d, now))) {
      const add = document.createElement('button');
      add.className = 'day-add'; add.textContent = '+ Cita';
      add.onclick = () => editAppointment({ starts_at: new Date(d.getFullYear(), d.getMonth(), d.getDate(), sameDay(d, now) ? Math.min(now.getHours() + 1, 19) : 9).toISOString() });
      col.appendChild(add);
    }
    w.appendChild(col);
  }
}

/** Ficha de algo de la agenda, con lo que se puede hacer. */
async function openAgendaItem(it) {
  const a = it.appt, l = it.lead, j = it.job || (a?.job_id ? jobs.find((x) => x.id === a.job_id) : null);
  const phone = a?.customer_phone || l?.customer_phone || j?.customer_phone;
  const who = a?.customer_name || l?.customer_name || j?.customer_name || '';
  const endAt = new Date(it.at.getTime() + (it.minutes || 60) * 60000);
  const label = { cita: 'Cita del taller', app: 'Cita desde la app', propuesta: 'Propuesta, sin aceptar', entrega: 'Entrega prevista' }[it.kind];
  const buttons = [];
  if (j) buttons.push(['job', 'Ver orden', 'btn small']);
  if (a && !j && a.vehicle_id && vehicles.some((v) => v.id === a.vehicle_id)) buttons.push(['open', 'Abrir orden', 'btn small']);
  if (l && isManager()) buttons.push(['lead', 'Ver solicitud', j ? 'btn ghost small' : 'btn small']);
  if (!it.allDay) buttons.push(['ics', 'Añadir a mi calendario', 'btn ghost small']);
  if (a) buttons.push(['edit', 'Editar', 'btn ghost small'], ['del', 'Borrar', 'btn ghost small']);
  const choice = await choose(`<small class="ag-kind ${it.kind}">${label}</small><h3>${esc(it.title)}</h3>
    <p class="ag-when">${svgIcon('agenda')} ${it.allDay ? fmtDate(j.promised_at) : `${DAYS[(it.at.getDay() + 6) % 7]} ${it.at.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}, ${hhmm(it.at)}–${hhmm(endAt)}`}</p>
    ${it.sub ? `<p class="muted">${it.sub}</p>` : ''}
    ${a?.notes ? `<p class="lead-msg">${esc(a.notes)}</p>` : ''}
    ${phone ? `<div class="lead-who"><div><b>${esc(who || 'Cliente')}</b><small>${esc(fmtPhone(phone))}</small></div><div class="icons">${contactButtons(phone, null, `Hola${who ? ' ' + who : ''}, te escribo de ${workshop?.name || 'el taller'} por tu cita del ${it.at.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}.`, who || 'el cliente')}</div></div>` : ''}`,
    buttons);
  if (choice === 'job') openJob(j);
  if (choice === 'lead') {
    setTab('leads');
    const card = document.querySelector(`.lead[data-id="${l.id}"]`);
    if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.classList.add('flash'); setTimeout(() => card.classList.remove('flash'), 1800); }
  }
  if (choice === 'ics') downloadIcs(it, endAt, who, phone);
  if (choice === 'edit') editAppointment(a);
  if (choice === 'del' && await dialog('<h3>¿Borrar esta cita?</h3>', 'Borrar', () => true)) {
    const { error } = await sb.from('workshop_appointments').delete().eq('id', a.id);
    if (error) alert('No se pudo borrar: ' + error.message);
    await loadAppointments();
  }
  if (choice === 'open') {
    const row = vehicles.find((v) => v.id === a.vehicle_id);
    const created = await newJobFor(row, { customer_request: [a.title, a.notes].filter(Boolean).join('. '), customer_name: a.customer_name, customer_phone: a.customer_phone, assigned_to: a.assigned_to });
    if (created) { await sb.from('workshop_appointments').update({ job_id: created.id, updated_at: new Date().toISOString() }).eq('id', a.id); loadAppointments(); }
  }
}

/** Nueva cita o editar una. */
async function editAppointment(a = {}) {
  // Por defecto, la siguiente hora en punto (o mañana a las 9 si ya es tarde).
  const start = a.starts_at ? new Date(a.starts_at) : (() => {
    const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1);
    if (d.getHours() >= 20 || d.getHours() < 8) { if (d.getHours() >= 20) d.setDate(d.getDate() + 1); d.setHours(9); }
    return d;
  })();
  const local = new Date(start.getTime() - start.getTimezoneOffset() * 60000).toISOString();
  const durs = [[15, '15 min'], [30, '30 min'], [45, '45 min'], [60, '1 hora'], [90, '1 h 30 min'], [120, '2 horas'], [180, '3 horas'], [240, '4 horas'], [480, 'Todo el día']];
  const carOpts = '<option value="">Sin coche en Garaje</option>' + vehicles.map((v) => { const s = summary(v); const o = ownerOf(v.id); return `<option value="${v.id}" ${v.id === a.vehicle_id ? 'selected' : ''}>${esc(s.name)}${s.plate ? ' · ' + esc(s.plate) : ''}${o ? ' · ' + esc(o.display_name) : ''}</option>`; }).join('');
  const r = await dialog(`<h3>${a.id ? 'Editar cita' : 'Nueva cita'}</h3>
    <label>Qué</label><input name="title" required maxlength="200" value="${esc(a.title || '')}" placeholder="Revisión, ITV, cambio de ruedas…">
    <div class="row3"><div><label>Día</label><input name="day" type="date" required value="${local.slice(0, 10)}"></div>
      <div><label>Hora</label><input name="time" type="time" required step="900" value="${local.slice(11, 16)}"></div>
      <div><label>Duración</label><select name="minutes">${durs.map(([m, t]) => `<option value="${m}" ${m === (a.minutes || 60) ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
    <label>Coche</label><select name="vehicle">${carOpts}</select>
    <div class="row2"><div><label>Cliente</label><input name="name" value="${esc(a.customer_name || '')}"></div>
      <div><label>Teléfono</label><input name="phone" type="tel" value="${esc(a.customer_phone || '')}"></div></div>
    ${team.filter((m) => m.joined).length > 1 ? `<label>Responsable</label><select name="who">${assigneeOptions(a.assigned_to)}</select>` : ''}
    <label>Notas</label><textarea name="notes" rows="2">${esc(a.notes || '')}</textarea>`,
    a.id ? 'Guardar' : 'Crear cita', (fd) => fd, (form) => {
      // Al elegir un coche, se rellenan el cliente y el teléfono de su dueño.
      form.vehicle.onchange = () => {
        const o = ownerOf(form.vehicle.value);
        if (o && !form.name.value) form.name.value = o.display_name || '';
        if (o?.phone && !form.phone.value) form.phone.value = o.phone;
      };
    });
  if (!r) return;
  const startsAt = new Date(`${r.day}T${r.time}`);
  if (isNaN(startsAt)) { alert('Revisa el día y la hora.'); return; }
  const row = {
    workshop_id: workshop.id, title: r.title.trim(), starts_at: startsAt.toISOString(), minutes: parseInt(r.minutes, 10) || 60,
    vehicle_id: r.vehicle || null, customer_name: (r.name || '').trim() || null, customer_phone: (r.phone || '').trim() || null,
    assigned_to: r.who || a.assigned_to || null, notes: (r.notes || '').trim() || null, updated_at: new Date().toISOString(),
  };
  const q = a.id ? sb.from('workshop_appointments').update(row).eq('id', a.id) : sb.from('workshop_appointments').insert(row);
  const { error } = await q;
  if (error) { alert('No se pudo guardar la cita: ' + error.message); return; }
  agendaStart = monday(startsAt);
  await loadAppointments();
}
$('newApptBtn').onclick = () => editAppointment({});

/** Archivo .ics para añadir la cita al calendario del móvil o del ordenador. */
function downloadIcs(it, endAt, who, phone) {
  const f = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const txt = (x) => String(x || '').replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Garaje//Panel de taller//ES', 'BEGIN:VEVENT',
    `UID:${(it.appt?.id || it.lead?.id || Date.now())}@garaje`, `DTSTAMP:${f(new Date())}`, `DTSTART:${f(it.at)}`, `DTEND:${f(endAt)}`,
    `SUMMARY:${txt(it.title + (who ? ' · ' + who : ''))}`, `DESCRIPTION:${txt([it.appt?.notes, phone ? 'Tel. ' + phone : ''].filter(Boolean).join('\n'))}`,
    workshop?.address ? `LOCATION:${txt(workshop.address)}` : '', 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = 'cita-garaje.ics';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

$('agPrev').onclick = () => { agendaStart = monday(agendaStart || new Date()); agendaStart.setDate(agendaStart.getDate() - 7); renderAgenda(); };
$('agNext').onclick = () => { agendaStart = monday(agendaStart || new Date()); agendaStart.setDate(agendaStart.getDate() + 7); renderAgenda(); };
$('agToday').onclick = () => { agendaStart = monday(new Date()); renderAgenda(); };

async function closeLead(l) {
  const archive = l.status === 'declined';
  const ok = await dialog(archive
    ? `<h3>Archivar la solicitud</h3><p class="muted">Pasa a "Cerradas". El cliente ya la rechazó, así que no le llega nada.</p>`
    : `<h3>¿Cerrar esta solicitud?</h3><p class="muted">Pasa a "Cerradas" y el cliente deja de verla como pendiente en su app. Si no puedes atenderle, mejor llámale o respóndele con otra fecha: es un cliente que te ha elegido.</p>`,
    archive ? 'Archivar' : 'Cerrar solicitud', () => true);
  if (!ok) return;
  const { error } = await sb.from('leads').update({ status: 'closed', updated_at: new Date().toISOString() }).eq('id', l.id);
  if (error) { alert('No se pudo cerrar: ' + error.message); return; }
  await loadLeads();
}

let dirty = false;
function openJob(j) {
  job = structuredClone(j);
  jobVehicle = vehicleOf(j);
  dirty = false;
  for (const id of ['tab-jobs', 'tab-cars', 'vehicle']) show(id, false);
  show('job');
  $('jKm').value = job.km ?? '';
  $('jFuel').value = job.fuel_level ?? '';
  $('jPromised').value = job.promised_at ?? '';
  $('jCustomer').value = job.customer_name ?? '';
  $('jPhone').value = job.customer_phone ?? '';
  $('jRequest').value = job.customer_request ?? '';
  $('jIntake').value = job.intake_notes ?? '';
  $('jAssigned').innerHTML = assigneeOptions(job.assigned_to);
  $('jAssigned').disabled = !isManager();
  $('jErr').textContent = ''; setSaveState('');
  renderPhoneIcons();
  renderJobHead();
  renderLines();
  renderRecs();
  loadMessages();
  window.scrollTo(0, 0);
}
/** Opciones de "Responsable": el equipo que ya ha entrado en el panel. */
function assigneeOptions(selected) {
  const people = team.filter((m) => m.joined && m.user_id);
  return `<option value="">Sin asignar</option>` + people.map((m) => `<option value="${m.user_id}" ${m.user_id === selected ? 'selected' : ''}>${esc(m.display_name)} · ${ROLE_NAME[m.role]}</option>`).join('')
    + (selected && !people.some((m) => m.user_id === selected) ? `<option value="${selected}" selected>Otra persona</option>` : '');
}
const nameOf = (uid) => team.find((m) => m.user_id === uid)?.display_name || '';
function renderPhoneIcons() {
  const phone = $('jPhone').value.trim();
  const v = jobVehicle ? summary(jobVehicle).name : 'tu vehículo';
  const name = $('jCustomer').value.trim();
  $('jPhoneIcons').innerHTML = phone ? contactButtons(phone, null, `Hola${name ? ' ' + name : ''}, te escribo de ${workshop?.name || 'el taller'} por tu ${v} (OR ${job?.number ?? ''}).`, name || 'el cliente') : '';
}
$('jobBack').onclick = async (e) => {
  e.preventDefault();
  clearTimeout(autoSaveTimer);
  if (dirty) await saveJob({}, { quiet: true });
  job = null; setTab('jobs');
};
// Guardado automático: al dejar de escribir un momento, se guarda solo.
let autoSaveTimer = null;
function setSaveState(text, cls = '') { const el = $('jSaved'); el.textContent = text; el.className = 'save-state ' + cls; }
function markDirty() {
  dirty = true;
  setSaveState('Sin guardar…', 'pending');
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => { if (job && dirty && !isLocked()) saveJob({}, { quiet: true }); }, 1500);
}
window.addEventListener('beforeunload', (e) => { if (job && dirty) { e.preventDefault(); e.returnValue = ''; } });
const isLocked = () => ['delivered', 'cancelled'].includes(job?.status);
for (const id of ['jKm', 'jFuel', 'jPromised', 'jCustomer', 'jPhone', 'jRequest', 'jIntake', 'jAssigned']) $(id).addEventListener('input', markDirty);
$('jAssigned').addEventListener('change', markDirty);
$('jPhone').addEventListener('input', renderPhoneIcons);
$('jCustomer').addEventListener('input', renderPhoneIcons);

// Pasos de una orden, como los ve el cliente en su móvil.
const STEPS = [['Recibido', ['received', 'diagnosis']], ['Presupuesto', ['quote_sent', 'rejected']], ['Aprobado', ['approved']],
  ['En reparación', ['in_progress', 'waiting_parts']], ['Listo', ['ready']], ['Entregado', ['delivered']]];
function renderProgress() {
  const st = job.status;
  const at = STEPS.findIndex(([, sts]) => sts.includes(st));
  $('jProgress').className = 'progress' + (st === 'cancelled' ? ' cancelled' : '');
  $('jProgress').innerHTML = STEPS.map(([label], i) => {
    const cls = st === 'cancelled' ? '' : i < at ? 'done' : i === at ? 'now' + (st === 'rejected' || st === 'waiting_parts' ? ' warn' : '') : '';
    const sub = i === at && st === 'rejected' ? 'Rechazado' : i === at && st === 'waiting_parts' ? 'Esperando piezas' : i === at && st === 'diagnosis' ? 'En diagnóstico' : '';
    return `<li class="${cls}"><i>${i < at && st !== 'cancelled' ? '✓' : i + 1}</i><span>${label}${sub ? `<small>${sub}</small>` : ''}</span></li>`;
  }).join('');
  // Avisos: retraso, rechazo, entregada o cancelada.
  const late = job.promised_at && job.promised_at < today() && !['ready', 'delivered', 'cancelled'].includes(st);
  const alert = st === 'delivered' ? `<b>Entregada${job.delivered_at ? ' el ' + fmtDate(job.delivered_at) : ''}.</b> Los trabajos ya están en el historial del coche; la orden queda de solo lectura.`
    : st === 'cancelled' ? '<b>Orden cancelada.</b> Queda de solo lectura.'
    : st === 'rejected' ? `<b>El cliente ha rechazado el presupuesto</b>${job.decision_note ? ': «' + esc(job.decision_note) + '»' : '.'} Cámbialo y vuelve a enviarlo, o llámale.`
    : late ? `<b>Va con retraso:</b> la entrega estaba prevista el ${fmtDate(job.promised_at)}. Avisa al cliente o cambia la fecha.` : '';
  $('jAlert').innerHTML = alert;
  $('jAlert').className = 'job-alert' + (alert ? '' : ' hidden') + (late || st === 'rejected' ? ' warn' : '');
  // Solo lectura cuando ya está entregada o cancelada.
  const locked = isLocked();
  for (const el of document.querySelectorAll('#job input:not(#jMsg), #job select, #job textarea')) el.disabled = locked || (el.id === 'jAssigned' && !isManager());
  for (const id of ['addLabor', 'addPart', 'jSave']) show(id, !locked);
}

function renderJobHead() {
  const s = jobVehicle ? summary(jobVehicle) : { name: 'Coche', plate: '' };
  $('jTitle').textContent = `OR ${job.number} · ${s.name}`;
  setPhoto('jPhoto', s.photo);
  $('jPlate').textContent = s.plate;
  $('jStatus').textContent = STATUS[job.status];
  $('jStatus').className = 'status ' + job.status;
  const bits = [`Abierta el ${fmtDate(job.created_at)}`];
  if (job.quote_sent_at) bits.push(`presupuesto enviado el ${fmtDate(job.quote_sent_at)}`);
  if (job.decided_at) bits.push(`${job.decision === 'approved' ? 'aprobado' : 'rechazado'} el ${fmtDate(job.decided_at)}${job.decision_note ? ': «' + job.decision_note + '»' : ''}`);
  if (job.delivered_at) bits.push(`entregado el ${fmtDate(job.delivered_at)}`);
  if (job.assigned_to) bits.push(`responsable: ${nameOf(job.assigned_to) || 'otra persona'}`);
  $('jSub').textContent = bits.join(' · ');
  renderProgress();
  const a = $('jActions');
  a.innerHTML = '';
  const btn = (label, fn, cls = 'btn small') => { const b = document.createElement('button'); b.className = cls; b.textContent = label; b.onclick = fn; a.appendChild(b); };
  const st = job.status;
  if (['received', 'diagnosis', 'rejected'].includes(st)) {
    if (isManager()) btn('Enviar presupuesto al cliente', sendQuote);
    if (st === 'received') btn('En diagnóstico', () => setStatus('diagnosis'), 'btn ghost small');
    if (isManager()) btn('Aprobado en persona', () => setStatus('approved', { decision: 'approved', decided_at: new Date().toISOString(), decision_note: 'Aprobado en el taller' }), 'btn ghost small');
  }
  if (st === 'quote_sent' && isManager()) btn('Aprobado por teléfono', () => setStatus('approved', { decision: 'approved', decided_at: new Date().toISOString(), decision_note: 'Aprobado por teléfono' }), 'btn ghost small');
  if (st === 'approved') btn('Empezar la reparación', () => setStatus('in_progress'));
  if (st === 'in_progress') { btn('Listo para recoger', () => setStatus('ready')); btn('Esperando piezas', () => setStatus('waiting_parts'), 'btn ghost small'); }
  if (st === 'waiting_parts') { btn('Han llegado: seguir', () => setStatus('in_progress')); btn('Listo para recoger', () => setStatus('ready'), 'btn ghost small'); }
  if (st === 'ready') btn('Entregar y pasar al historial', deliver);
  if (!['delivered', 'cancelled'].includes(st) && isManager()) btn('Cancelar', async () => {
    if (await dialog('<h3>¿Cancelar esta orden?</h3><p class="muted">El cliente verá en su móvil que se ha cancelado. No se puede deshacer.</p>', 'Cancelar orden', () => true)) setStatus('cancelled');
  }, 'btn ghost small');
}

// --- líneas del presupuesto
const lineTotal = (l) => (num(l.qty) ?? 0) * (num(l.unit_price) ?? 0) * (1 - (num(l.discount) ?? 0) / 100);
function totals(j) {
  const base = (j.lines || []).reduce((a, l) => a + lineTotal(l), 0);
  const vat = base * (num(j.vat) ?? 21) / 100;
  return { base, vat, total: base + vat };
}
function renderLines() {
  const box = $('jLines');
  box.innerHTML = (job.lines || []).length
    ? '<div class="qhead"><span>Tipo</span><span>Descripción</span><span>Cant. / horas</span><span>€/u sin IVA</span><span>Dto %</span><span>Total</span><span></span></div>'
    : '<p class="muted">Añade mano de obra y piezas. Las piezas de tu biblioteca se autocompletan al escribir.</p>';
  const prof = jobVehicle ? profileOf(jobVehicle) : {};
  const supOpts = (sel) => `<option value="">Proveedor</option>` + suppliers.map((s) => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  (job.lines || []).forEach((l, i) => {
    const row = document.createElement('div');
    row.className = 'qline ' + l.kind;
    const part = l.kind === 'part';
    row.innerHTML = `<div class="r1">
        <select data-k="kind" title="Tipo"><option value="labor" ${!part ? 'selected' : ''}>Mano de obra</option><option value="part" ${part ? 'selected' : ''}>Pieza</option></select>
        <input data-k="description" value="${esc(l.description)}" placeholder="${part ? 'Filtro de aceite' : 'Cambio de aceite y filtro'}" ${part ? 'list="partNames"' : ''} title="Descripción">
        <input data-k="qty" value="${esc(l.qty)}" inputmode="decimal" title="${part ? 'Cantidad' : 'Horas'}" placeholder="${part ? 'Cant.' : 'Horas'}">
        <input data-k="unit_price" value="${esc(l.unit_price)}" inputmode="decimal" placeholder="€/u" title="Precio unitario sin IVA">
        <input data-k="discount" value="${esc(l.discount ?? '')}" inputmode="decimal" placeholder="Dto %" title="Descuento %">
        <span class="tot">${fmtEur(lineTotal(l))}</span>
        <button class="x" title="Quitar">×</button>
      </div>
      <div class="r2">
        <select data-k="catalog_id" title="Trabajo del plan de mantenimiento (para el historial)"><option value="">Trabajo del plan…</option>${itemOptions(prof, l.catalog_id)}</select>
        ${part ? `<input data-k="brand" value="${esc(l.brand)}" list="brands" placeholder="Marca">
        <input data-k="reference" value="${esc(l.reference)}" placeholder="Referencia">
        ${isManager() ? `<select data-k="supplier_id">${supOpts(l.supplier_id)}</select>` : ''}` : ''}
        ${part && l.reference ? `<a class="search" href="${searchUrl(l.brand, l.reference)}" target="_blank" rel="noopener">Buscar ${esc(l.reference)} ↗</a>` : ''}
      </div>`;
    for (const inp of row.querySelectorAll('[data-k]')) {
      inp.addEventListener('change', () => { l[inp.dataset.k] = inp.value; afterLineEdit(inp.dataset.k === 'kind' || inp.dataset.k === 'reference', l, inp.dataset.k); });
      inp.addEventListener('input', () => { l[inp.dataset.k] = inp.value; markDirty(); row.querySelector('.tot').textContent = fmtEur(lineTotal(l)); renderTotals(); });
    }
    row.querySelector('.x').onclick = () => { job.lines.splice(i, 1); markDirty(); renderLines(); };
    if (isLocked()) row.querySelector('.x').remove();
    box.appendChild(row);
  });
  // Autocompletar descripciones con la biblioteca de piezas.
  $('partNames').innerHTML = parts.map((p) => `<option value="${esc(p.description)}">${esc([p.brand, p.reference].filter(Boolean).join(' '))}</option>`).join('');
  renderTotals();
}
function afterLineEdit(rerender, l, key) {
  markDirty();
  // Al elegir una descripción de la biblioteca, se rellenan marca, ref. y precio.
  if (key === 'description' && l.kind === 'part') {
    const p = parts.find((x) => x.description === l.description);
    if (p) { Object.assign(l, partToLine(p)); rerender = true; }
  }
  if (rerender) renderLines(); else renderTotals();
}
function renderTotals() {
  const t = totals(job);
  $('jTotals').innerHTML = `<span>Base imponible</span><span>${fmtEur(t.base)}</span>
    <span>IVA ${num(job.vat) ?? 21} %</span><span>${fmtEur(t.vat)}</span>
    <span><b>Total</b></span><span><b>${fmtEur(t.total)}</b></span>`;
}
const partToLine = (p) => ({ kind: 'part', description: p.description, catalog_id: p.catalog_id || '', brand: p.brand || '', reference: p.reference || '', supplier_id: p.supplier_id || '', qty: 1, unit_price: p.price ?? '', discount: '', part_id: p.id });
function addJobLine(l) { job.lines ||= []; job.lines.push(l); markDirty(); renderLines(); }
$('addLabor').onclick = () => addJobLine({ kind: 'labor', description: '', catalog_id: '', qty: 1, unit_price: workshop.labor_rate, discount: '' });
$('addPart').onclick = () => addJobLine({ kind: 'part', description: '', catalog_id: '', brand: '', reference: '', supplier_id: '', qty: 1, unit_price: '', discount: '' });

// --- recomendaciones para este coche
function renderRecs() {
  const box = $('jRecs');
  box.innerHTML = '';
  const prof = jobVehicle ? profileOf(jobVehicle) : {};
  const eng = engines[prof.engine_id];
  const add = (title, sub, fn) => { const b = document.createElement('button'); b.className = 'rec'; b.innerHTML = `${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}`; b.onclick = fn; box.appendChild(b); };
  const head = (t) => { const h = document.createElement('div'); h.className = 'rec-h'; h.textContent = t; box.appendChild(h); };
  if (eng) {
    head(`Lo que lleva: ${eng.engine}`);
    const sp = eng.specs || {};
    for (const [k, v] of Object.entries(sp)) {
      if (!v || k === 'oil_l') continue;
      const qty = k === 'oil' ? num((sp.oil_l || '').match(/[\d,.]+/)?.[0]) : 1;
      add(`${SPEC_LABEL[k] || k}: ${v}`, k === 'oil' && sp.oil_l ? sp.oil_l : null, () => addJobLine({
        kind: 'part', description: `${SPEC_LABEL[k] || k} ${v}`.slice(0, 120), catalog_id: SPEC_ITEMS[k] || '', brand: '', reference: '', supplier_id: '', qty: qty || 1, unit_price: '', discount: '',
      }));
    }
    if ((eng.known_issues || []).length) {
      head('Puntos débiles a revisar');
      for (const issue of eng.known_issues.slice(0, 4)) add(typeof issue === 'string' ? issue : (issue.title || issue.name || ''), null, () => addJobLine({ kind: 'labor', description: 'Revisión: ' + (typeof issue === 'string' ? issue : (issue.title || issue.name || '')).slice(0, 100), catalog_id: '', qty: 0.5, unit_price: workshop.labor_rate, discount: '' }));
    }
  }
  const used = eng ? parts.filter((p) => (p.engine_ids || []).includes(eng.id)).sort((a, b) => b.uses - a.uses).slice(0, 8) : [];
  if (used.length) {
    head('Lo que has montado en este motor');
    for (const p of used) add(p.description, [p.brand, p.reference, p.price != null ? fmtEur(p.price) : null].filter(Boolean).join(' · '), () => addJobLine(partToLine(p)));
  }
  const notes = Object.entries(prof.part_notes || {});
  if (notes.length) {
    head('Referencias que apuntó el dueño');
    for (const [cid, text] of notes) add(`${itemName(cid, prof)}: ${text}`, null, () => addJobLine({ kind: 'part', description: itemName(cid, prof), catalog_id: cid, brand: '', reference: text.slice(0, 60), supplier_id: '', qty: 1, unit_price: '', discount: '' }));
  }
  if (!box.children.length) box.innerHTML = '<p class="muted" style="font-size:14px">Cuando el dueño tenga el motor elegido en la app, aquí verás qué aceite y líquidos lleva, sus puntos débiles y las piezas que ya le has montado a ese motor.</p>';
}

// --- guardar y cambiar de estado
function collectJob() {
  return {
    km: $('jKm').value === '' ? null : parseInt($('jKm').value, 10),
    fuel_level: $('jFuel').value || null,
    promised_at: $('jPromised').value || null,
    customer_name: $('jCustomer').value.trim() || null,
    customer_phone: $('jPhone').value.trim() || null,
    customer_request: $('jRequest').value.trim() || null,
    intake_notes: $('jIntake').value.trim() || null,
    assigned_to: $('jAssigned').value || null,
    lines: (job.lines || []).filter((l) => (l.description || '').trim() || num(l.unit_price)).map((l) => ({
      ...l, qty: num(l.qty) ?? 1, unit_price: num(l.unit_price), discount: num(l.discount),
      supplier: suppliers.find((s) => s.id === l.supplier_id)?.name || l.supplier || null,
    })),
  };
}
async function saveJob(extra = {}, { quiet = false } = {}) {
  clearTimeout(autoSaveTimer);
  $('jErr').textContent = '';
  setSaveState('Guardando…', 'pending');
  const patch = { ...collectJob(), ...extra, updated_at: new Date().toISOString() };
  const { data, error } = await sb.from('jobs').update(patch).eq('id', job.id).select('*').single();
  if (error) { $('jErr').textContent = 'No se pudo guardar: ' + error.message; setSaveState('Sin guardar', 'bad'); return false; }
  const i = jobs.findIndex((j) => j.id === data.id); if (i >= 0) jobs[i] = data;
  if (!job || job.id !== data.id) return true; // ya se ha salido de la orden
  // Guardado automático mientras se escribe: no se repinta (se perdería el foco).
  job = quiet ? { ...data, lines: job.lines } : data;
  dirty = false;
  setSaveState('Guardado ✓', 'ok');
  if (!quiet) { renderJobHead(); renderLines(); }
  return true;
}
$('jSave').onclick = () => saveJob();

async function setStatus(status, extra = {}) {
  if (!(await saveJob({ status, ...extra }))) return;
  await postMessage(`Estado: ${STATUS[status]}.${status === 'ready' ? ' Ya puedes pasar a recogerlo.' : ''}`, true);
}
async function sendQuote() {
  const c = collectJob();
  if (c.lines.length === 0) { $('jErr').textContent = 'Añade al menos una línea al presupuesto.'; return; }
  const t = totals({ ...job, lines: c.lines });
  if (!(await dialog(`<h3>Enviar el presupuesto</h3><p class="muted">Le llega al móvil del cliente para que lo apruebe o lo rechace.</p><p class="big-total">${fmtEur(t.total)} <small>con IVA</small></p>`, 'Enviar al cliente', () => true))) return;
  if (!(await saveJob({ status: 'quote_sent', quote_sent_at: new Date().toISOString(), decision: null, decided_at: null, decision_note: null }))) return;
  await postMessage(`Te hemos enviado el presupuesto: ${fmtEur(t.total)} con IVA. Puedes aprobarlo o rechazarlo desde la app.`, true);
}

// Entregar: pasa los trabajos al historial del coche y enseña a la biblioteca.
async function deliver() {
  if (!(await dialog('<h3>Entregar el vehículo</h3><p class="muted">Se marca como entregado y los trabajos pasan al historial del coche en el móvil del cliente, con la firma del taller. Después la orden queda de solo lectura.</p>', 'Entregar', () => true))) return;
  if (!(await saveJob())) return;
  try {
    if (!job.history_written) {
      const eng = jobVehicle ? profileOf(jobVehicle).engine_id : null;
      const byItem = new Map();
      for (const l of job.lines || []) {
        const key = l.catalog_id || '';
        const g = byItem.get(key) || { catalogId: key || null, cost: 0, notes: [] };
        g.cost += lineTotal(l) * (1 + (num(job.vat) ?? 21) / 100);
        g.notes.push([l.description, l.brand, l.reference].filter(Boolean).join(' '));
        byItem.set(key, g);
      }
      const lines = [...byItem.values()].map((g) => ({ catalogId: g.catalogId, cost: Math.round(g.cost * 100) / 100, note: `OR ${job.number}: ${g.notes.join('; ')}`.slice(0, 500) }));
      if (lines.length === 0) lines.push({ catalogId: null, cost: null, note: `OR ${job.number}` });
      await writeHistory(job.vehicle_id, new Date().toISOString(), job.km, lines);
      if (isManager()) await learnParts(eng);
    }
    await setStatus('delivered', { delivered_at: new Date().toISOString(), history_written: true });
    await loadVehicles();
  } catch (e) {
    $('jErr').textContent = 'No se pudo pasar al historial: ' + (e.message || e);
  }
}
async function learnParts(engineId) {
  for (const l of job.lines || []) {
    if (l.kind !== 'part' || !(l.description || '').trim()) continue;
    // La misma pieza: por id de la biblioteca, por marca + referencia (aunque
    // la descripción cambie) o, sin referencia, por la descripción exacta.
    const norm = (x) => (x || '').toLowerCase().replace(/[\s.\-]/g, '');
    const existing = parts.find((p) => p.id === l.part_id) ||
      (l.reference ? parts.find((p) => norm(p.reference) === norm(l.reference) && norm(p.brand) === norm(l.brand)) : null) ||
      parts.find((p) => !p.reference && !l.reference && p.description === l.description && norm(p.brand) === norm(l.brand));
    const engineIds = existing ? [...new Set([...(existing.engine_ids || []), ...(engineId ? [engineId] : [])])] : (engineId ? [engineId] : []);
    const row = {
      workshop_id: workshop.id, description: existing?.description || l.description.trim(), brand: l.brand || null, reference: l.reference || null,
      catalog_id: l.catalog_id || null, supplier_id: l.supplier_id || null, price: num(l.unit_price), engine_ids: engineIds,
      uses: (existing?.uses || 0) + 1, last_used_at: new Date().toISOString(),
    };
    if (existing) await sb.from('workshop_parts').update(row).eq('id', existing.id);
    else await sb.from('workshop_parts').insert(row);
  }
  await loadParts();
}

// --- mensajes
async function loadMessages() {
  if (!job) return;
  const { data } = await sb.from('job_messages').select('*').eq('job_id', job.id).order('created_at');
  messages = data || [];
  const box = $('jChat');
  box.innerHTML = messages.length ? '' : '<p class="muted" style="font-size:14px">Los cambios de estado y lo que os escribáis aparecen aquí y en el móvil del cliente.</p>';
  for (const m of messages) {
    const d = document.createElement('div');
    d.className = 'msg' + (m.from_workshop ? ' mine' : '');
    d.innerHTML = `${esc(m.body)}<small>${m.from_workshop ? esc(m.author_name || 'Taller') : 'Cliente'} · ${fmtTime(m.created_at)}</small>`;
    box.appendChild(d);
  }
  box.scrollTop = box.scrollHeight;
}
async function postMessage(body, silent = false) {
  const { error } = await sb.from('job_messages').insert({ job_id: job.id, author_id: session.user.id, author_name: workshop.name, from_workshop: true, body });
  if (error && !silent) alert('No se pudo enviar: ' + error.message);
  await loadMessages();
}
$('jMsgForm').onsubmit = async (e) => {
  e.preventDefault();
  const body = $('jMsg').value.trim();
  if (!body) return;
  $('jMsg').value = '';
  await postMessage(body);
};

// --- documentos
$('printQuote').onclick = () => printDoc('quote');
$('printOrder').onclick = () => printDoc('order');
async function printDoc(kind) {
  if (dirty) await saveJob();
  const s = jobVehicle ? summary(jobVehicle) : { name: '', plate: '', prof: {} };
  const t = totals(job);
  const w = workshop;
  const title = kind === 'quote' ? 'Presupuesto' : 'Orden de reparación y resguardo de depósito';
  const rows = (job.lines || []).map((l) => `<tr><td>${l.kind === 'labor' ? 'Mano de obra' : 'Pieza'}</td><td>${esc(l.description)}${l.brand || l.reference ? `<br><small>${esc([l.brand, l.reference].filter(Boolean).join(' · '))}</small>` : ''}</td>
    <td class="num">${esc(l.qty)}</td><td class="num">${fmtEur(num(l.unit_price))}</td><td class="num">${l.discount ? esc(l.discount) + ' %' : ''}</td><td class="num">${fmtEur(lineTotal(l))}</td></tr>`).join('');
  $('print').innerHTML = `<div class="doc">
    <div class="head"><div><h1>${esc(w.name)}</h1>${w.legal_name ? esc(w.legal_name) + '<br>' : ''}${w.tax_id ? 'NIF ' + esc(w.tax_id) + '<br>' : ''}${esc(w.address || '')}<br>${esc([w.phone, w.email].filter(Boolean).join(' · '))}${w.registry_no ? '<br>Nº registro industrial: ' + esc(w.registry_no) : ''}</div>
      <div style="text-align:right"><h1>${title}</h1>Nº ${job.number}<br>Fecha: ${fmtDate(new Date().toISOString())}${kind === 'quote' ? `<br>Válido ${w.quote_validity_days} días hábiles` : ''}${job.promised_at ? '<br>Entrega prevista: ' + fmtDate(job.promised_at) : ''}</div></div>
    <div class="boxes">
      <div class="box"><b>Cliente</b>${esc(job.customer_name || '')}<br>${esc(job.customer_phone || '')}</div>
      <div class="box"><b>Vehículo</b>${esc(s.name)}<br>Matrícula: ${esc(s.plate)}${s.prof?.vin ? '<br>Bastidor: ' + esc(s.prof.vin) : ''}<br>Km: ${fmtKm(job.km)}${job.fuel_level ? ' · Combustible: ' + esc(job.fuel_level) : ''}</div>
    </div>
    ${job.customer_request ? `<div class="box" style="margin-bottom:10px"><b>Trabajos solicitados</b>${esc(job.customer_request)}</div>` : ''}
    ${kind === 'order' && job.intake_notes ? `<div class="box" style="margin-bottom:10px"><b>Estado del vehículo a la recepción</b>${esc(job.intake_notes)}</div>` : ''}
    ${rows ? `<table><thead><tr><th>Tipo</th><th>Concepto</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Dto.</th><th class="num">Importe</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="tot"><div><span>Base imponible</span><span>${fmtEur(t.base)}</span></div><div><span>IVA ${num(job.vat)} %</span><span>${fmtEur(t.vat)}</span></div><div class="big"><span>Total</span><span>${fmtEur(t.total)}</span></div></div>` : ''}
    <div class="legal">${kind === 'quote'
      ? 'Presupuesto conforme al Real Decreto 1457/1986. El usuario puede aceptarlo firmando este documento o desde la app Garaje. Las piezas sustituidas se entregarán al cliente si así lo solicita. Este presupuesto no es una factura.'
      : 'El usuario autoriza la reparación descrita y deposita el vehículo en el taller. Este documento sirve como resguardo de depósito (Real Decreto 1457/1986): preséntelo para retirar el vehículo. No es una factura.'}</div>
    <div class="sign"><div>Firma del taller</div><div>Conforme, firma del cliente</div></div>
  </div>`;
  const old = document.title;
  document.title = `${title} ${job.number} · ${s.plate || s.name}`;
  window.print();
  document.title = old;
}

// ------------------------------------------------------------------ piezas
async function loadParts() {
  if (!isManager()) { parts = []; return; }
  const { data } = await sb.from('workshop_parts').select('*').eq('workshop_id', workshop.id).order('uses', { ascending: false }).limit(2000);
  parts = data || [];
  if (tab === 'parts') renderParts();
}
$('partSearch').addEventListener('input', () => renderParts());
function renderParts() {
  const q = $('partSearch').value.trim().toLowerCase();
  const list = parts.filter((p) => !q || [p.description, p.brand, p.reference].some((x) => (x || '').toLowerCase().includes(q)));
  const tb = $('partsBody');
  tb.innerHTML = '';
  show('noParts', parts.length === 0);
  for (const p of list) {
    const sup = suppliers.find((s) => s.id === p.supplier_id);
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><b>${esc(p.description)}</b>${p.catalog_id ? `<small>${esc(itemName(p.catalog_id))}</small>` : ''}${(p.engine_ids || []).length ? `<small>Motores: ${esc(p.engine_ids.map((id) => engines[id]?.engine || id).join(', '))}</small>` : ''}</td>
      <td data-label="Marca"><span>${esc(p.brand || '')}${p.reference ? `<small><a href="${searchUrl(p.brand, p.reference)}" target="_blank" rel="noopener">${esc(p.reference)} ↗</a></small>` : ''}</span></td>
      <td data-label="Proveedor">${esc(sup?.name || '')}</td><td class="num" data-label="Coste">${fmtEur(p.cost)}</td><td class="num" data-label="PVP">${fmtEur(p.price)}</td><td class="num" data-label="Usos">${p.uses}</td>
      <td class="edit"><a href="#" data-edit>Editar</a></td>`;
    tr.querySelector('[data-edit]').onclick = (e) => { e.preventDefault(); editPart(p); };
    tb.appendChild(tr);
  }
}
$('newPartBtn').onclick = () => editPart({});
async function editPart(p) {
  const supOpts = `<option value="">—</option>` + suppliers.map((s) => `<option value="${s.id}" ${s.id === p.supplier_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  const res = await dialog(`<h3>${p.id ? 'Editar pieza' : 'Nueva pieza'}</h3>
    <label>Descripción *</label><input name="description" value="${esc(p.description || '')}" required placeholder="Filtro de aceite">
    <div class="row2"><div><label>Marca</label><input name="brand" list="brands" value="${esc(p.brand || '')}"></div><div><label>Referencia</label><input name="reference" value="${esc(p.reference || '')}"></div></div>
    <label>Trabajo del plan</label><select name="catalog_id"><option value="">—</option>${itemOptions({}, p.catalog_id)}</select>
    <label>Proveedor</label><select name="supplier_id">${supOpts}</select>
    <div class="row2"><div><label>Coste (sin IVA)</label><input name="cost" inputmode="decimal" value="${esc(p.cost ?? '')}"></div><div><label>PVP (sin IVA)</label><input name="price" inputmode="decimal" value="${esc(p.price ?? '')}"></div></div>
    ${p.id ? '<p style="margin-top:14px"><a href="#" id="delPart" style="color:#E5484D">Borrar esta pieza</a></p>' : ''}`, 'Guardar', (fd) => fd, (form) => {
    const d = form.querySelector('#delPart');
    if (d) d.onclick = async (e) => { e.preventDefault(); if (!confirm('¿Borrar la pieza?')) return; await sb.from('workshop_parts').delete().eq('id', p.id); $('dlg').close(); await loadParts(); };
  });
  if (!res) return;
  const row = { workshop_id: workshop.id, description: res.description.trim(), brand: res.brand.trim() || null, reference: res.reference.trim() || null, catalog_id: res.catalog_id || null, supplier_id: res.supplier_id || null, cost: num(res.cost), price: num(res.price) };
  const { error } = p.id ? await sb.from('workshop_parts').update(row).eq('id', p.id) : await sb.from('workshop_parts').insert(row);
  if (error) alert('No se pudo guardar: ' + error.message);
  await loadParts();
}

// ------------------------------------------------------------------ proveedores
async function loadSuppliers() {
  if (!isManager()) { suppliers = []; return; }
  const { data } = await sb.from('workshop_suppliers').select('*').eq('workshop_id', workshop.id).order('name');
  suppliers = data || [];
  if (tab === 'suppliers') renderSuppliers();
  if (tab === 'jobs' && !job && workshop) renderOnboard();
}
function renderSuppliers() {
  const g = $('suppliersGrid');
  g.innerHTML = '';
  show('noSuppliers', suppliers.length === 0);
  for (const s of suppliers) {
    const n = parts.filter((p) => p.supplier_id === s.id).length;
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `<h3 style="margin:0 0 4px">${esc(s.name)}</h3>
      <p class="muted" style="margin:0 0 10px;font-size:14px">${n} ${n === 1 ? 'pieza' : 'piezas'} en tu biblioteca${s.notes ? ' · ' + esc(s.notes) : ''}</p>
      <div class="supplier-actions"><div class="icons">${contactButtons(s.phone, s.email, '', s.name)}${s.web ? iconLink('web', /^https?:/.test(s.web) ? s.web : 'https://' + s.web, 'Web de ' + s.name, true) : ''}</div><a class="btn ghost small" href="#" data-edit>Editar</a></div>`;
    el.querySelector('[data-edit]').onclick = (e) => { e.preventDefault(); editSupplier(s); };
    g.appendChild(el);
  }
}
$('newSupplierBtn').onclick = () => editSupplier({});
async function editSupplier(s) {
  const res = await dialog(`<h3>${s.id ? 'Editar proveedor' : 'Nuevo proveedor'}</h3>
    <label>Nombre *</label><input name="name" value="${esc(s.name || '')}" required placeholder="Recambios del Sur">
    <div class="row2"><div><label>Teléfono</label><input name="phone" type="tel" value="${esc(s.phone || '')}"></div><div><label>Correo</label><input name="email" type="email" value="${esc(s.email || '')}"></div></div>
    <label>Web o tienda online</label><input name="web" value="${esc(s.web || '')}">
    <label>Notas (horario de reparto, comercial…)</label><input name="notes" value="${esc(s.notes || '')}">
    ${s.id ? '<p style="margin-top:14px"><a href="#" id="delSup" style="color:#E5484D">Borrar este proveedor</a></p>' : ''}`, 'Guardar', (fd) => fd, (form) => {
    const d = form.querySelector('#delSup');
    if (d) d.onclick = async (e) => { e.preventDefault(); if (!confirm('¿Borrar el proveedor? Sus piezas se quedan sin proveedor.')) return; await sb.from('workshop_suppliers').delete().eq('id', s.id); $('dlg').close(); await loadSuppliers(); };
  });
  if (!res) return;
  const row = { workshop_id: workshop.id, name: res.name.trim(), phone: res.phone.trim() || null, email: res.email.trim() || null, web: res.web.trim() || null, notes: res.notes.trim() || null };
  const { error } = s.id ? await sb.from('workshop_suppliers').update(row).eq('id', s.id) : await sb.from('workshop_suppliers').insert(row);
  if (error) alert('No se pudo guardar: ' + error.message);
  await loadSuppliers();
}

// ------------------------------------------------------------------ diálogo
// ------------------------------------------------------------------ equipo
async function loadTeam() {
  if (!workshop) return;
  const { data, error } = await sb.rpc('workshop_team', { w: workshop.id });
  team = error ? [] : (data || []);
  if (tab === 'team') renderTeam();
  if (tab === 'jobs' && !job) renderBoard();
}
function renderTeam() {
  const box = $('teamList');
  const canInvite = isManager();
  show('inviteBtn', canInvite);
  const order = { owner: 0, manager: 1, mechanic: 2 };
  const rows = [...team].sort((a, b) => order[a.role] - order[b.role] || (a.display_name || '').localeCompare(b.display_name || ''));
  box.innerHTML = rows.map((m) => {
    const me = m.user_id === session.user.id;
    const canChange = isOwner() && m.role !== 'owner';
    const canRemove = m.role !== 'owner' && (isOwner() || (myRole === 'manager' && m.role === 'mechanic') || me);
    return `<div class="member">
      <span class="avatar">${esc((m.display_name || m.email || '?').trim()[0].toUpperCase())}</span>
      <div class="m-info"><b>${esc(m.joined ? m.display_name : m.email)}${me ? ' <span class="muted">(tú)</span>' : ''}</b>
        <small>${m.joined ? esc(m.email) : 'Invitación pendiente: entrará cuando abra el panel con este correo'}${m.phone ? ' · ' + esc(fmtPhone(m.phone)) : ''}</small></div>
      ${canChange ? `<select class="m-role" data-id="${m.id}"><option value="manager" ${m.role === 'manager' ? 'selected' : ''}>Encargado</option><option value="mechanic" ${m.role === 'mechanic' ? 'selected' : ''}>Mecánico</option></select>`
        : `<span class="role-chip ${m.role}">${ROLE_NAME[m.role]}</span>`}
      ${canRemove ? `<button class="icon-btn m-remove" data-id="${m.id}" title="${me ? 'Salir del equipo' : 'Quitar del equipo'}" aria-label="Quitar">×</button>` : '<span class="m-gap"></span>'}
    </div>`;
  }).join('') + (rows.length <= 1 ? emptyState('team', 'Solo estás tú', 'Invita a tu encargado y a tus mecánicos con su correo. Cuando entren en el panel con ese correo, verán las órdenes y los coches del taller.') : '');
  for (const sel of box.querySelectorAll('.m-role')) sel.onchange = async () => {
    const { error } = await sb.rpc('set_member_role', { p_member: sel.dataset.id, p_role: sel.value });
    if (error) alert('No se pudo cambiar: ' + error.message);
    await loadTeam();
  };
  for (const b of box.querySelectorAll('.m-remove')) b.onclick = async () => {
    const m = team.find((x) => x.id === b.dataset.id);
    const me = m.user_id === session.user.id;
    const ok = await dialog(me ? '<h3>¿Salir del equipo?</h3><p class="muted">Dejarás de ver las órdenes y los coches del taller.</p>'
      : `<h3>¿Quitar a ${esc(m.joined ? m.display_name : m.email)}?</h3><p class="muted">Dejará de ver las órdenes, los coches y los clientes del taller.</p>`, me ? 'Salir' : 'Quitar', () => true);
    if (!ok) return;
    const { error } = await sb.rpc('remove_member', { p_member: m.id });
    if (error) { alert('No se pudo: ' + error.message); return; }
    if (me) location.reload(); else await loadTeam();
  };
}
$('inviteBtn').onclick = async () => {
  const roleOpts = isOwner()
    ? '<option value="mechanic">Mecánico: órdenes y coches; ve el presupuesto, no los costes</option><option value="manager">Encargado: el día a día, solicitudes, piezas e invita mecánicos</option>'
    : '<option value="mechanic">Mecánico: órdenes y coches; ve el presupuesto, no los costes</option>';
  const r = await dialog(`<h3>Invitar al equipo</h3>
    <label>Su correo (el de Google o el que use para entrar)</label><input name="email" type="email" required placeholder="nombre@ejemplo.com">
    <label>Rol</label><select name="role">${roleOpts}</select>
    <p class="muted" style="font-size:13px">Cuando entre en este panel con ese correo (samuelgonzrojas.github.io/garaje/taller), pasará a ser del equipo. Mándale el enlace por WhatsApp.</p>`,
    'Invitar', (fd) => fd);
  if (!r) return;
  const { error } = await sb.rpc('invite_member', { w: workshop.id, p_email: r.email, p_role: r.role });
  if (error) { alert('No se pudo invitar: ' + error.message); return; }
  await loadTeam();
};

/** Diálogo con varios botones; devuelve el que se pulse (o null). */
function choose(html, buttons) {
  return new Promise((resolve) => {
    const dlg = $('dlg'), form = $('dlgForm');
    form.innerHTML = html + `<div class="dlg-actions wrap">${buttons.map(([v, label, cls]) => `<button class="${cls}" value="${v}">${label}</button>`).join('')}<button class="btn ghost small" value="cancel" formnovalidate>Cerrar</button></div>`;
    dlg.onclose = () => resolve(dlg.returnValue && dlg.returnValue !== 'cancel' ? dlg.returnValue : null);
    dlg.returnValue = '';
    dlg.showModal();
  });
}

function dialog(html, okLabel, pick, after) {
  return new Promise((resolve) => {
    const dlg = $('dlg'), form = $('dlgForm');
    form.innerHTML = html + `<div class="dlg-actions"><button class="btn ghost small" value="cancel" formnovalidate>Cancelar</button><button class="btn small" value="ok">${okLabel}</button></div>`;
    after?.(form);
    dlg.onclose = () => {
      if (dlg.returnValue !== 'ok') return resolve(null);
      resolve(pick(Object.fromEntries(new FormData(form).entries())));
    };
    dlg.returnValue = '';
    dlg.showModal();
  });
}

// ------------------------------------------------------------------ arranque
await loadStatic();
const { data: { session: s0 } } = await sb.auth.getSession();
session = s0;
if (s0) enter(); else leave();
