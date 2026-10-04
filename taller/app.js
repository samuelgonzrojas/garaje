// Panel web de Garaje para talleres y familiares. Habla directamente con
// Supabase: la seguridad la ponen las políticas RLS (solo ves los coches de
// los que eres miembro). Escribe el mismo documento por vehículo que la app,
// que lo fusiona en cada móvil (unión por id de eventos y lecturas).
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://pzgqgligxmwnwvozfwcl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_zPxM3Ul4VYkudB1D_lhUZw_lUy6K52g';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (id) => document.getElementById(id);
const show = (id, on = true) => $(id).classList.toggle('hidden', !on);

let session = null;
let profile = null;        // { display_name, is_workshop }
let roles = {};            // vehicle_id -> role
let vehicles = [];         // filas de public.vehicles
let catalogNames = {};     // catalog_id -> nombre
let current = null;        // fila abierta
let channel = null;

// ------------------------------------------------------------------ utilidades
const fmtKm = (n) => n == null ? '—' : new Intl.NumberFormat('es-ES').format(n) + ' km';
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
const fmtEur = (n) => n == null ? '' : new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n);
const newId = () => (Date.now() * 1000).toString(36) + '-' + Math.floor(Math.random() * 2 ** 30).toString(36);
const today = () => new Date().toISOString().slice(0, 10);
const roleName = (r) => r === 'owner' ? 'propietario' : r === 'workshop' ? 'taller' : 'familiar';

function profileOf(row) {
  try { return JSON.parse(row.data.asset.profile_json); } catch { return {}; }
}
function itemName(catalogId, prof) {
  if (!catalogId) return 'Registro';
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
    plate: prof.plate || '',
    km: r?.value ?? null,
    kmAt: r?.at ?? null,
    itv: doc.inspection?.due_date ?? null,
    last: events[0] ? `${fmtDate(events[0].at)} · ${itemName(events[0].catalog_id, prof)}` : '—',
    role: roles[row.id] || 'family',
    prof, events,
  };
}

// ------------------------------------------------------------------ catálogo
async function loadCatalog() {
  try {
    const c = await (await fetch('catalog.json')).json();
    for (const it of [...(c.interval_items || []), ...(c.watch_items || [])]) catalogNames[it.id] = it.name;
  } catch (e) { console.warn('catálogo', e); }
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
  session = s;
  if (s) enter(); else leave();
});

function leave() {
  show('login'); show('vehicles', false); show('vehicle', false); show('nav', false);
  if (channel) { sb.removeChannel(channel); channel = null; }
}

async function enter() {
  show('login', false); show('nav');
  await ensureProfile();
  await loadVehicles();
  show('vehicles');
  if (!channel) {
    channel = sb.channel('web-vehicles')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, () => loadVehicles())
      .subscribe();
  }
}

// ------------------------------------------------------------------ perfil
async function ensureProfile() {
  const uid = session.user.id;
  const { data } = await sb.from('profiles').select('display_name,is_workshop').eq('user_id', uid).maybeSingle();
  profile = data;
  if (!profile || !profile.display_name) {
    const name = prompt('¿Cómo quieres firmar lo que apuntes? (nombre del taller o tuyo)', session.user.email.split('@')[0]);
    profile = { display_name: (name || session.user.email.split('@')[0]).trim(), is_workshop: profile?.is_workshop ?? true };
    await sb.from('profiles').upsert({ user_id: uid, display_name: profile.display_name, is_workshop: profile.is_workshop, updated_at: new Date().toISOString() });
  }
  $('who').textContent = profile.display_name;
}
$('editName').onclick = async (e) => {
  e.preventDefault();
  const name = prompt('Nombre con el que firmas:', profile.display_name);
  if (!name || !name.trim()) return;
  profile.display_name = name.trim();
  await sb.from('profiles').upsert({ user_id: session.user.id, display_name: profile.display_name, is_workshop: profile.is_workshop, updated_at: new Date().toISOString() });
  $('who').textContent = profile.display_name;
};

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
  renderGrid();
  if (current) {
    const fresh = vehicles.find((v) => v.id === current.id);
    if (fresh) { current = fresh; renderVehicle(); }
  }
}
function renderGrid() {
  const g = $('grid');
  g.innerHTML = '';
  show('empty', vehicles.length === 0);
  for (const row of vehicles) {
    const s = summary(row);
    const el = document.createElement('div');
    el.className = 'card vcard';
    el.innerHTML = `<h3>${esc(s.name)}</h3>${s.plate ? `<span class="plate">${esc(s.plate)}</span>` : ''}<span class="badge ${s.role}">${roleName(s.role)}</span>
      <div class="kv"><div><b>${fmtKm(s.km)}</b><small>${s.kmAt ? 'el ' + fmtDate(s.kmAt) : 'sin lectura'}</small></div>
      <div><b>${fmtDate(s.itv)}</b><small>ITV</small></div></div>
      <p class="muted" style="margin:10px 0 0;font-size:14px">Último: ${esc(s.last)}</p>`;
    el.onclick = () => open(row);
    g.appendChild(el);
  }
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

$('joinForm').onsubmit = async (e) => {
  e.preventDefault();
  const code = $('joinCode').value.trim().toUpperCase();
  if (code.length < 6) return;
  const { error } = await sb.rpc('accept_invite', { p_code: code });
  if (error) { $('listErr').textContent = error.message; return; }
  $('joinCode').value = '';
  await loadVehicles();
};

// ------------------------------------------------------------------ un coche
function open(row) {
  current = row;
  show('vehicles', false); show('vehicle');
  $('fDate').value = today();
  $('fKm').value = summary(row).km ?? '';
  $('lines').innerHTML = '';
  addLine();
  show('saveOk', false); $('saveErr').textContent = '';
  renderVehicle();
  window.scrollTo(0, 0);
}
$('back').onclick = (e) => { e.preventDefault(); current = null; show('vehicle', false); show('vehicles'); };

function renderVehicle() {
  const s = summary(current);
  $('vName').textContent = s.name;
  $('vPlate').textContent = s.plate; show('vPlate', !!s.plate);
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

function itemOptions() {
  const prof = profileOf(current);
  const opts = Object.entries(catalogNames).sort((a, b) => a[1].localeCompare(b[1], 'es'));
  for (const c of prof.custom_items || []) opts.push(['custom:' + c.id, c.name + ' (propio)']);
  return opts.map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('');
}
function addLine() {
  const div = document.createElement('div');
  div.className = 'line';
  div.innerHTML = `<div><select class="item"><option value="">— Trabajo —</option>${itemOptions()}</select></div>
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
    cost: l.querySelector('.cost').value === '' ? null : parseFloat(l.querySelector('.cost').value),
    note: l.querySelector('.note').value.trim() || null,
  })).filter((l) => l.catalogId);
  if (!date) { $('saveErr').textContent = 'Falta la fecha.'; return; }
  if (lines.length === 0) { $('saveErr').textContent = 'Elige al menos un trabajo.'; return; }
  const s = summary(current);
  if (km != null && s.km != null && km < s.km - 1000) {
    if (!confirm(`Los km (${fmtKm(km)}) son menores que la última lectura (${fmtKm(s.km)}). ¿Seguro?`)) return;
  }
  // Si es hoy, hora real (gana a las lecturas de esta mañana); si no, mediodía.
  const at = date === today() ? new Date() : new Date(date + 'T12:00:00');
  const atIso = at.toISOString();
  $('save').disabled = true;
  try {
    await withRetry(async (row) => {
      const doc = structuredClone(row.data);
      doc.events ||= []; doc.readings ||= [];
      let first = true;
      for (const l of lines) {
        const id = newId();
        doc.events.push({
          id, catalog_id: l.catalogId, at: atIso, reading_value: km, person_id: null,
          cost: l.cost, note: l.note, author: profile.display_name,
        });
        // Igual que la app: la lectura de km va ligada al primer evento (id-km).
        if (km != null && first) doc.readings.push({ id: id + '-km', value: km, at: atIso });
        first = false;
      }
      return doc;
    });
    show('saveOk'); $('saveOk').textContent = `Guardado. ${lines.length === 1 ? 'El trabajo ya está' : 'Los ' + lines.length + ' trabajos ya están'} en el móvil del dueño.`;
    $('lines').innerHTML = ''; addLine();
    await loadVehicles();
  } catch (e) {
    $('saveErr').textContent = 'No se pudo guardar: ' + (e.message || e);
  } finally {
    $('save').disabled = false;
  }
};

// Lee la fila fresca, aplica el cambio y escribe solo si nadie la tocó entre
// medias (version). Si otro móvil subió algo, vuelve a intentarlo sobre lo nuevo.
async function withRetry(mutate) {
  for (let i = 0; i < 4; i++) {
    const { data: row, error } = await sb.from('vehicles').select('id,name,data,version').eq('id', current.id).single();
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

// ------------------------------------------------------------------ arranque
await loadCatalog();
const { data: { session: s0 } } = await sb.auth.getSession();
session = s0;
if (s0) enter(); else leave();
