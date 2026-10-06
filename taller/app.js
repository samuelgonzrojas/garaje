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
let roles = {};            // vehicle_id -> role
let vehicles = [];         // filas de public.vehicles
let jobs = [];             // órdenes del taller
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

const STATUS = {
  received: 'Recibido', diagnosis: 'En diagnóstico', quote_sent: 'Presupuesto enviado', approved: 'Aprobado',
  rejected: 'Presupuesto rechazado', in_progress: 'En reparación', waiting_parts: 'Esperando piezas',
  ready: 'Listo para recoger', delivered: 'Entregado', cancelled: 'Cancelado',
};
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
  for (const id of ['login', 'setup', 'tabs', 'tab-jobs', 'tab-cars', 'tab-parts', 'tab-suppliers', 'tab-settings', 'job', 'vehicle']) show(id, false);
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
    if (workshop) await Promise.all([loadJobs(), loadParts(), loadSuppliers()]);
    setTab(workshop ? tab : 'cars');
  }
  subscribe();
}

function subscribe() {
  if (channel) return;
  channel = sb.channel('panel')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, () => loadVehicles())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => workshop && loadJobs())
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
  const { data } = await sb.from('workshops').select('*').eq('owner_id', session.user.id).maybeSingle();
  workshop = data;
  $('who').textContent = workshop?.name || profile.display_name;
  // Solo el taller ve las pestañas de órdenes, piezas, proveedores y taller.
  for (const t of ['jobs', 'parts', 'suppliers', 'settings']) {
    document.querySelector(`.tabs [data-tab="${t}"]`).classList.toggle('hidden', !workshop);
  }
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
function renderWsForm(formId, data, button) {
  const f = $(formId);
  const field = ([k, label, ph, req]) => `<div><label>${label}${req ? ' *' : ''}</label><input name="${k}" value="${esc(data[k] ?? '')}" placeholder="${esc(ph)}" ${req ? 'required' : ''} ${['labor_rate', 'vat', 'quote_validity_days'].includes(k) ? 'inputmode="decimal"' : ''}></div>`;
  f.innerHTML = `${field(WS_FIELDS[0])}
    <div class="row2">${field(WS_FIELDS[1])}${field(WS_FIELDS[2])}</div>
    ${field(WS_FIELDS[3])}${field(WS_FIELDS[4])}
    <div class="row2">${field(WS_FIELDS[5])}${field(WS_FIELDS[6])}</div>
    <div class="row3">${field(WS_FIELDS[7])}${field(WS_FIELDS[8])}${field(WS_FIELDS[9])}</div>
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
for (const b of document.querySelectorAll('.tabs button')) b.onclick = () => setTab(b.dataset.tab);
function setTab(t) {
  tab = t;
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('on', b.dataset.tab === t);
  for (const id of ['tab-jobs', 'tab-cars', 'tab-parts', 'tab-suppliers', 'tab-settings', 'job', 'vehicle']) show(id, false);
  show('tab-' + t);
  if (t === 'jobs') renderBoard();
  if (t === 'cars') renderGrid();
  if (t === 'parts') renderParts();
  if (t === 'suppliers') renderSuppliers();
  if (t === 'settings') renderWsForm('settingsForm', workshop || {}, 'Guardar');
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
  if (tab === 'cars' && !current) renderGrid();
  if (current) {
    const fresh = vehicles.find((v) => v.id === current.id);
    if (fresh) { current = fresh; renderVehicle(); }
  }
  if (job) jobVehicle = vehicles.find((v) => v.id === job.vehicle_id) || jobVehicle;
}
function renderGrid() {
  const g = $('grid');
  g.innerHTML = '';
  show('empty', vehicles.length === 0);
  for (const row of vehicles) {
    const s = summary(row);
    const open = jobs.find((j) => j.vehicle_id === row.id && !['delivered', 'cancelled'].includes(j.status));
    const el = document.createElement('div');
    el.className = 'card vcard';
    el.innerHTML = `<h3>${esc(s.name)}</h3><span class="plate">${esc(s.plate)}</span><span class="badge ${s.role}">${roleName(s.role)}</span>
      ${open ? `<span class="status ${open.status}">${STATUS[open.status]}</span>` : ''}
      <div class="kv"><div><b>${fmtKm(s.km)}</b><small>${s.kmAt ? 'el ' + fmtDate(s.kmAt) : 'sin lectura'}</small></div>
      <div><b>${fmtDate(s.itv)}</b><small>ITV</small></div></div>
      <p class="muted" style="margin:10px 0 0;font-size:14px">Último: ${esc(s.last)}</p>`;
    el.onclick = () => openVehicle(row);
    g.appendChild(el);
  }
}

$('joinForm').onsubmit = async (e) => {
  e.preventDefault();
  const code = $('joinCode').value.trim().toUpperCase();
  if (code.length < 6) return;
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
  $('vPlate').textContent = s.plate;
  $('vRole').textContent = roleName(s.role); $('vRole').className = 'badge ' + s.role;
  $('vKm').textContent = fmtKm(s.km);
  $('vKmSub').textContent = s.kmAt ? 'el ' + fmtDate(s.kmAt) : 'sin lectura';
  $('vItv').textContent = fmtDate(s.itv);
  $('vLast').textContent = s.last;
  const tb = $('history');
  tb.innerHTML = '';
  show('noHistory', s.events.length === 0);
  for (const e of s.events) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${fmtDate(e.at)}</td><td>${esc(itemName(e.catalog_id, s.prof))}${e.note ? `<small>${esc(e.note)}</small>` : ''}</td>
      <td>${e.reading_value != null ? fmtKm(e.reading_value) : ''}</td><td>${fmtEur(e.cost)}</td><td>${esc(e.author || '')}</td>`;
    tb.appendChild(tr);
  }
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
function jobCard(j) {
  const v = vehicleOf(j);
  const s = v ? summary(v) : { name: 'Coche sin acceso', plate: '' };
  const el = document.createElement('div');
  el.className = 'jcard';
  el.innerHTML = `<span class="num-tag">OR ${j.number}</span><b>${esc(s.name)}</b>
    <small>${esc(s.plate)}${j.customer_name ? ' · ' + esc(j.customer_name) : ''}</small>
    ${j.customer_request ? `<small>${esc(j.customer_request.slice(0, 80))}</small>` : ''}
    <span class="status ${j.status}">${STATUS[j.status]}</span>
    ${j.promised_at ? `<small>Entrega: ${fmtDate(j.promised_at)}</small>` : ''}`;
  el.onclick = () => openJob(j);
  return el;
}
function renderBoard() {
  const b = $('board');
  b.innerHTML = '';
  for (const [title, states] of COLUMNS) {
    const list = jobs.filter((j) => states.includes(j.status));
    const col = document.createElement('div');
    col.className = 'col';
    col.innerHTML = `<h4>${title}<span>${list.length}</span></h4>`;
    for (const j of list) col.appendChild(jobCard(j));
    b.appendChild(col);
  }
  const done = $('doneJobs');
  done.innerHTML = '';
  const closed = jobs.filter((j) => ['delivered', 'cancelled'].includes(j.status)).slice(0, 30);
  if (closed.length === 0) done.innerHTML = '<p class="muted">Ninguna todavía.</p>';
  for (const j of closed) done.appendChild(jobCard(j));
}

$('newJobBtn').onclick = async () => {
  if (vehicles.length === 0) { alert('Primero necesitas acceso a algún coche: pide al cliente el código de taller (pestaña Coches).'); return; }
  const opts = vehicles.map((v) => { const s = summary(v); return `<option value="${v.id}">${esc(s.name)}${s.plate ? ' · ' + esc(s.plate) : ''}</option>`; }).join('');
  const id = await dialog(`<h3>Nueva orden de trabajo</h3><label>Coche</label><select name="v">${opts}</select>
    <p class="muted" style="font-size:13px">¿No está? Pide al cliente el código de taller y escríbelo en la pestaña Coches.</p>`, 'Abrir orden', (fd) => fd.v);
  if (id) newJobFor(vehicles.find((v) => v.id === id));
};

async function newJobFor(row) {
  const s = summary(row);
  // Cliente: el propietario del coche (nombre y teléfono de su perfil).
  let name = null, phone = null;
  try {
    const { data } = await sb.rpc('vehicle_people', { p_vehicle: row.id });
    const owner = (data || []).find((p) => p.role === 'owner');
    if (owner) { name = owner.display_name; phone = owner.phone; }
  } catch { /* sin datos */ }
  const { data, error } = await sb.from('jobs').insert({
    workshop_id: workshop.id, vehicle_id: row.id, km: s.km, vat: workshop.vat,
    customer_name: name, customer_phone: phone,
  }).select('*').single();
  if (error) { alert('No se pudo abrir la orden: ' + error.message); return; }
  jobs.unshift(data);
  openJob(data);
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
  $('jErr').textContent = ''; show('jSaved', false);
  renderJobHead();
  renderLines();
  renderRecs();
  loadMessages();
  window.scrollTo(0, 0);
}
$('jobBack').onclick = async (e) => {
  e.preventDefault();
  if (dirty && confirm('¿Guardar los cambios de la orden antes de salir?')) await saveJob();
  job = null; setTab('jobs');
};
for (const id of ['jKm', 'jFuel', 'jPromised', 'jCustomer', 'jPhone', 'jRequest', 'jIntake']) $(id).addEventListener('input', () => { dirty = true; show('jSaved', false); });

function renderJobHead() {
  const s = jobVehicle ? summary(jobVehicle) : { name: 'Coche', plate: '' };
  $('jTitle').textContent = `OR ${job.number} · ${s.name}`;
  $('jPlate').textContent = s.plate;
  $('jStatus').textContent = STATUS[job.status];
  $('jStatus').className = 'status ' + job.status;
  const bits = [`Abierta el ${fmtDate(job.created_at)}`];
  if (job.quote_sent_at) bits.push(`presupuesto enviado el ${fmtDate(job.quote_sent_at)}`);
  if (job.decided_at) bits.push(`${job.decision === 'approved' ? 'aprobado' : 'rechazado'} el ${fmtDate(job.decided_at)}${job.decision_note ? ': «' + job.decision_note + '»' : ''}`);
  if (job.delivered_at) bits.push(`entregado el ${fmtDate(job.delivered_at)}`);
  $('jSub').textContent = bits.join(' · ');
  const a = $('jActions');
  a.innerHTML = '';
  const btn = (label, fn, cls = 'btn small') => { const b = document.createElement('button'); b.className = cls; b.textContent = label; b.onclick = fn; a.appendChild(b); };
  const st = job.status;
  if (['received', 'diagnosis', 'rejected'].includes(st)) {
    btn('Enviar presupuesto al cliente', sendQuote);
    if (st === 'received') btn('En diagnóstico', () => setStatus('diagnosis'), 'btn ghost small');
    btn('Aprobado en persona', () => setStatus('approved', { decision: 'approved', decided_at: new Date().toISOString(), decision_note: 'Aprobado en el taller' }), 'btn ghost small');
  }
  if (st === 'quote_sent') btn('Aprobado por teléfono', () => setStatus('approved', { decision: 'approved', decided_at: new Date().toISOString(), decision_note: 'Aprobado por teléfono' }), 'btn ghost small');
  if (st === 'approved') btn('Empezar la reparación', () => setStatus('in_progress'));
  if (st === 'in_progress') { btn('Listo para recoger', () => setStatus('ready')); btn('Esperando piezas', () => setStatus('waiting_parts'), 'btn ghost small'); }
  if (st === 'waiting_parts') { btn('Han llegado: seguir', () => setStatus('in_progress')); btn('Listo para recoger', () => setStatus('ready'), 'btn ghost small'); }
  if (st === 'ready') btn('Entregar y pasar al historial', deliver);
  if (!['delivered', 'cancelled'].includes(st)) btn('Cancelar', () => { if (confirm('¿Cancelar esta orden?')) setStatus('cancelled'); }, 'btn ghost small');
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
  box.innerHTML = (job.lines || []).length ? '' : '<p class="muted">Añade mano de obra y piezas. Las piezas de tu biblioteca se autocompletan al escribir.</p>';
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
        <select data-k="supplier_id">${supOpts(l.supplier_id)}</select>` : ''}
        ${part && l.reference ? `<a class="search" href="${searchUrl(l.brand, l.reference)}" target="_blank" rel="noopener">Buscar ${esc(l.reference)} ↗</a>` : ''}
      </div>`;
    for (const inp of row.querySelectorAll('[data-k]')) {
      inp.addEventListener('change', () => { l[inp.dataset.k] = inp.value; afterLineEdit(inp.dataset.k === 'kind' || inp.dataset.k === 'reference', l, inp.dataset.k); });
      inp.addEventListener('input', () => { l[inp.dataset.k] = inp.value; dirty = true; show('jSaved', false); row.querySelector('.tot').textContent = fmtEur(lineTotal(l)); renderTotals(); });
    }
    row.querySelector('.x').onclick = () => { job.lines.splice(i, 1); dirty = true; renderLines(); };
    box.appendChild(row);
  });
  // Autocompletar descripciones con la biblioteca de piezas.
  $('partNames').innerHTML = parts.map((p) => `<option value="${esc(p.description)}">${esc([p.brand, p.reference].filter(Boolean).join(' '))}</option>`).join('');
  renderTotals();
}
function afterLineEdit(rerender, l, key) {
  dirty = true; show('jSaved', false);
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
function addJobLine(l) { job.lines ||= []; job.lines.push(l); dirty = true; renderLines(); }
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
    lines: (job.lines || []).filter((l) => (l.description || '').trim() || num(l.unit_price)).map((l) => ({
      ...l, qty: num(l.qty) ?? 1, unit_price: num(l.unit_price), discount: num(l.discount),
      supplier: suppliers.find((s) => s.id === l.supplier_id)?.name || l.supplier || null,
    })),
  };
}
async function saveJob(extra = {}) {
  $('jErr').textContent = '';
  const patch = { ...collectJob(), ...extra, updated_at: new Date().toISOString() };
  const { data, error } = await sb.from('jobs').update(patch).eq('id', job.id).select('*').single();
  if (error) { $('jErr').textContent = 'No se pudo guardar: ' + error.message; return false; }
  job = data; dirty = false;
  const i = jobs.findIndex((j) => j.id === job.id); if (i >= 0) jobs[i] = data;
  show('jSaved'); renderJobHead(); renderLines();
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
  if (!confirm(`Se enviará el presupuesto (${fmtEur(t.total)} con IVA) al móvil del cliente para que lo apruebe. ¿Enviar?`)) return;
  if (!(await saveJob({ status: 'quote_sent', quote_sent_at: new Date().toISOString(), decision: null, decided_at: null, decision_note: null }))) return;
  await postMessage(`Te hemos enviado el presupuesto: ${fmtEur(t.total)} con IVA. Puedes aprobarlo o rechazarlo desde la app.`, true);
}

// Entregar: pasa los trabajos al historial del coche y enseña a la biblioteca.
async function deliver() {
  if (!confirm('Se marcará como entregado y los trabajos pasarán al historial del coche en el móvil del cliente. ¿Continuar?')) return;
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
      await learnParts(eng);
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
    const existing = parts.find((p) => p.id === l.part_id) ||
      parts.find((p) => p.description === l.description && (p.reference || '') === (l.reference || '') && (p.brand || '') === (l.brand || ''));
    const engineIds = existing ? [...new Set([...(existing.engine_ids || []), ...(engineId ? [engineId] : [])])] : (engineId ? [engineId] : []);
    const row = {
      workshop_id: workshop.id, description: l.description.trim(), brand: l.brand || null, reference: l.reference || null,
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
      <td>${esc(p.brand || '')}${p.reference ? `<small><a href="${searchUrl(p.brand, p.reference)}" target="_blank" rel="noopener">${esc(p.reference)} ↗</a></small>` : ''}</td>
      <td>${esc(sup?.name || '')}</td><td class="num">${fmtEur(p.cost)}</td><td class="num">${fmtEur(p.price)}</td><td class="num">${p.uses}</td>
      <td><a href="#" data-edit>Editar</a></td>`;
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
  const { data } = await sb.from('workshop_suppliers').select('*').eq('workshop_id', workshop.id).order('name');
  suppliers = data || [];
  if (tab === 'suppliers') renderSuppliers();
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
      <div class="actions">${s.phone ? `<a class="btn small" href="tel:${esc(s.phone)}">Llamar</a>` : ''}${s.phone ? `<a class="btn ghost small" href="https://wa.me/${esc(s.phone.replace(/\D/g, '').replace(/^(?!34)(\d{9})$/, '34$1'))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}${s.email ? `<a class="btn ghost small" href="mailto:${esc(s.email)}">Correo</a>` : ''}${s.web ? `<a class="btn ghost small" href="${esc(/^https?:/.test(s.web) ? s.web : 'https://' + s.web)}" target="_blank" rel="noopener">Web ↗</a>` : ''}<a class="btn ghost small" href="#" data-edit>Editar</a></div>`;
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
