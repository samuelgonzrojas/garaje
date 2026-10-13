// Página pública para pedir cita en un taller (supabase/031_online_booking.sql).
// Sin sesión: solo llama a booking_workshop, booking_busy y request_booking.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const sb = createClient('https://pzgqgligxmwnwvozfwcl.supabase.co', 'sb_publishable_zPxM3Ul4VYkudB1D_lhUZw_lUy6K52g', { auth: { persistSession: false } });
const $ = (id) => document.getElementById(id);
const show = (id, on = true) => $(id).classList.toggle('hidden', !on);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DAYS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const SLOT = 30, LENGTH = 60;   // huecos cada media hora; la cita ocupa una hora

const wsId = new URLSearchParams(location.search).get('t');
let ws = null, busy = [], day = null, slot = null, service = null;

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const sameDay = (a, b) => a.toDateString() === b.toDateString();
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Días que se pueden pedir: de hoy a 3 semanas, sin domingos (ni sábados si no abre). */
function bookableDays() {
  const out = [];
  const d = new Date(); d.setHours(0, 0, 0, 0);
  for (let i = 0; i < 22 && out.length < 18; i++, d.setDate(d.getDate() + 1)) {
    const wd = (d.getDay() + 6) % 7;
    if (wd === 6 || (wd === 5 && !ws.booking_saturday)) continue;
    if (slotsOf(new Date(d)).some((s) => s.free)) out.push(new Date(d));
  }
  return out;
}
/** Huecos del día según las franjas del taller (el sábado, solo por la mañana). */
function slotsOf(d) {
  const out = [];
  const ranges = String(ws.booking_hours || '09:00-13:30,15:30-19:00').split(',');
  const sat = (d.getDay() + 6) % 7 === 5;
  const minStart = Date.now() + 2 * 3600e3;
  for (const r of ranges) {
    const [a, b] = r.split('-').map((t) => t.split(':').map(Number));
    if (!a || !b) continue;
    const start = new Date(d); start.setHours(a[0], a[1], 0, 0);
    const end = new Date(d); end.setHours(b[0], b[1], 0, 0);
    if (sat && start.getHours() >= 14) continue;
    for (let t = new Date(start); t.getTime() + LENGTH * 60e3 <= end.getTime(); t = new Date(t.getTime() + SLOT * 60e3)) {
      const tEnd = t.getTime() + LENGTH * 60e3;
      const taken = busy.some((x) => { const s = new Date(x.starts_at).getTime(); return s < tEnd && s + x.minutes * 60e3 > t.getTime(); });
      out.push({ at: new Date(t), free: !taken && t.getTime() >= minStart });
    }
  }
  return out;
}

function renderDays() {
  const days = bookableDays();
  if (!day || !days.some((d) => sameDay(d, day))) day = days[0] || null;
  $('days').innerHTML = days.map((d) => `<button type="button" class="day${day && sameDay(d, day) ? ' on' : ''}" data-d="${dateKey(d)}"><small>${DAYS[(d.getDay() + 6) % 7]}</small><b>${d.getDate()}</b><small>${d.toLocaleDateString('es-ES', { month: 'short' })}</small></button>`).join('')
    || '<p class="muted">No quedan horas libres en las próximas semanas. Llama al taller.</p>';
  for (const b of $('days').querySelectorAll('[data-d]')) b.onclick = () => { day = days.find((d) => dateKey(d) === b.dataset.d); slot = null; renderDays(); };
  renderSlots();
}
function renderSlots() {
  if (!day) { $('slots').innerHTML = ''; return; }
  const list = slotsOf(day);
  $('slots').innerHTML = list.map((s) => `<button type="button" class="slot${slot && s.at.getTime() === slot.getTime() ? ' on' : ''}" ${s.free ? '' : 'disabled'} data-t="${s.at.getTime()}">${hhmm(s.at)}</button>`).join('');
  for (const b of $('slots').querySelectorAll('[data-t]')) b.onclick = () => { slot = new Date(Number(b.dataset.t)); renderSlots(); };
}

async function loadBusy() {
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const { data } = await sb.rpc('booking_busy', { p_workshop: wsId, p_from: dateKey(from), p_days: 22 });
  busy = data || [];
}

async function start() {
  if (!wsId) { show('loading', false); show('closed'); return; }
  const { data } = await sb.rpc('booking_workshop', { p_workshop: wsId });
  ws = data?.[0];
  show('loading', false);
  if (!ws) { show('closed'); return; }
  document.title = `Pedir cita · ${ws.name}`;
  $('wsName').textContent = ws.name;
  $('wsInfo').innerHTML = [esc([ws.address, ws.city].filter(Boolean).join(', ')), ws.hours ? esc(ws.hours) : '', ws.phone ? `<a href="tel:${esc(ws.phone.replace(/\s/g, ''))}">${esc(ws.phone)}</a>` : ''].filter(Boolean).join(' · ');
  $('logo').innerHTML = ws.logo ? `<img src="${esc(ws.logo)}" alt="">` : `<span>${esc((ws.name.trim()[0] || '?').toUpperCase())}</span>`;
  const services = ws.services?.length ? ws.services : ['Revisión', 'Otro'];
  service = services[0];
  $('services').innerHTML = services.map((x, i) => `<button type="button" class="chip${i === 0 ? ' on' : ''}" data-s="${esc(x)}">${esc(x)}</button>`).join('');
  for (const b of $('services').querySelectorAll('[data-s]')) b.onclick = () => { service = b.dataset.s; for (const o of $('services').children) o.classList.toggle('on', o === b); };
  await loadBusy();
  renderDays();
  show('form');
}

$('form').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  const err = $('err');
  err.textContent = '';
  if (!slot) { err.textContent = 'Elige un día y una hora.'; return; }
  if (f.name.value.trim().length < 2) { err.textContent = 'Escribe tu nombre.'; f.name.focus(); return; }
  if (f.phone.value.replace(/\D/g, '').length < 9) { err.textContent = 'Escribe un teléfono para que el taller te confirme la cita.'; f.phone.focus(); return; }
  if (!f.consent.checked) { err.textContent = 'Marca la casilla de los datos para poder enviar la petición.'; return; }
  $('send').disabled = true;
  const { error } = await sb.rpc('request_booking', {
    p_workshop: wsId, p_when: slot.toISOString(), p_name: f.name.value.trim(), p_phone: f.phone.value.trim(),
    p_plate: f.plate.value.trim() || null, p_service: service, p_note: f.note.value.trim() || null,
  });
  $('send').disabled = false;
  if (error) {
    err.textContent = error.message || 'No se pudo enviar. Inténtalo otra vez o llama al taller.';
    await loadBusy(); renderDays();
    return;
  }
  $('doneText').innerHTML = `<b>${esc(service)}</b> en <b>${esc(ws.name)}</b><br>${slot.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })} a las ${hhmm(slot)}`;
  show('form', false);
  show('done');
  window.scrollTo(0, 0);
};

start();
