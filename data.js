/* Mi salud — datos: almacenamiento, precargas, lectura de las otras apps, fusión sin duplicados y estadísticas.
 * Sin dependencias. Expone window.MS. La app (app.js) solo pinta.
 *
 * Clave propia (la única que se escribe):  mi-salud:v1 = { schema: 1, data: {...} }
 * Claves ajenas (SOLO LECTURA):            mi-tension:v1, mi-entrenador:v1, mi-menu:v2, mi-plato:v1
 */
(() => {
  'use strict';

  const ROOT_KEY = 'mi-salud:v1';
  const SCHEMA = 1;
  const TZ = 'Europe/Madrid';
  const DAY = 86400000;
  const NB = ' ';

  /* ================= Precargas (datos ya conocidos; el repo es público) ================= */
  // Mi tensión (SEED de /workspace/mi-tension/app.js)
  const SEED_BP = [
    ['2026-11-18', '19:19', 127, 81, 103], ['2026-11-19', '13:56', 122, 80, 95],
    ['2026-11-20', '16:24', 124, 81, 88], ['2026-11-21', '13:05', 120, 80, 93],
    ['2026-11-22', '13:16', 126, 82, 91], ['2026-11-23', '13:06', 125, 85, 96],
    ['2026-11-24', '20:35', 125, 84, 96], ['2026-11-25', '13:21', 136, 92, 88]
  ];
  // Mi entrenador (REGISTROS, PESOS e INITIAL_WEIGHTS de /workspace/mi-entrenador/src/app.tsx)
  const REGISTROS = [
    { date: '2026-11-16', walkMin: 30, strength: true, glucoseBefore: '', glucoseAfter: '' },
    { date: '2026-11-17', walkMin: 30, strength: true, glucoseBefore: '', glucoseAfter: '' },
    { date: '2026-11-22', walkMin: 36, strength: false, glucoseBefore: '', glucoseAfter: '', walkKm: 3.98, kcalActive: 318, kcalTotal: 388, elevM: 70, pace: '8:56', hrAvg: 136 },
    { date: '2026-11-23', walkMin: 35, strength: true, glucoseBefore: '', glucoseAfter: '', walkKm: 4.01, kcalActive: 318, kcalTotal: 387, elevM: 69, pace: '8:49', hrAvg: 140 }
  ];
  // 20 y 22/11: pesos que Jorge dio de palabra (93,0 kg). Misma lógica que el resto de la precarga:
  // por fecha, lo apuntado aquí o en Mi entrenador manda, y «borrados-pesos» los oculta.
  const PESOS = [{ date: '2026-11-16', kg: 93.3 }, { date: '2026-11-17', kg: 93.3 }, { date: '2026-11-20', kg: 93.0 }, { date: '2026-11-22', kg: 93.0 }];
  const INITIAL_WEIGHTS = [{ date: '2026-11-01', kg: 92.7 }];
  const SEED_WAIST = [{ date: '2026-11-26', cm: 104.6 }];

  const DEFAULT_SETTINGS = { showGlucose: true, heightCm: 180, goalKg: 88, walkGoalMin: 150, strengthGoal: 2 };
  const DEFAULT_MEDS = () => [{
    id: 'ozempic', name: 'Ozempic (semaglutida)', dose: '', freq: 'weekly', weekday: 0, time: '',
    active: false, since: null, pausedAt: null
  }];

  /* ================= Fechas (Europe/Madrid) ================= */
  const pad = (n) => String(n).padStart(2, '0');
  const partsFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  function madridParts(date) {
    const o = {};
    for (const p of partsFmt.formatToParts(date)) o[p.type] = p.value;
    return o;
  }
  function offsetMinutes(date) {
    const p = madridParts(date);
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return Math.round((asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  }
  function toISO(dateStr, timeStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const [h, mi] = timeStr.split(':').map(Number);
    const naive = Date.UTC(y, m - 1, d, h, mi);
    let off = offsetMinutes(new Date(naive));
    off = offsetMinutes(new Date(naive - off * 60000));
    const a = Math.abs(off);
    return `${dateStr}T${timeStr}:00${off >= 0 ? '+' : '-'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
  }
  /** Fecha y hora de Madrid de un instante. */
  function nowInputs(date) {
    const p = madridParts(date || new Date());
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, hour: +p.hour, minute: +p.minute };
  }
  const today = () => (window.__MS_NOW ? nowInputs(new Date(window.__MS_NOW)).date : nowInputs().date);
  const nowParts = () => nowInputs(window.__MS_NOW ? new Date(window.__MS_NOW) : new Date());
  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
  const dayNum = (s) => Math.round(Date.parse(s + 'T00:00:00Z') / DAY);
  const addDays = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
  const diffDays = (a, b) => dayNum(a) - dayNum(b);
  /** 0 = lunes … 6 = domingo */
  const weekdayOf = (s) => (new Date(s + 'T00:00:00Z').getUTCDay() + 6) % 7;
  const mondayOf = (s) => addDays(s, -weekdayOf(s));
  const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const longDate = (s) => { const d = new Date(s + 'T00:00:00Z'); return `${WEEKDAYS[weekdayOf(s)]} ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}`; };
  const shortDate = (s) => `${+s.slice(8, 10)}/${+s.slice(5, 7)}`;
  const dateOfISO = (iso) => nowInputs(new Date(iso)).date;
  const timeOfISO = (iso) => nowInputs(new Date(iso)).time;

  /* ================= Números y formato ================= */
  /** "93,4" / "93.4" → 93.4; NaN si no es un número. */
  function parseNum(s) {
    if (typeof s === 'number') return s;
    const t = String(s == null ? '' : s).trim().replace(',', '.');
    return /^\d+(\.\d+)?$/.test(t) ? parseFloat(t) : NaN;
  }
  const inRange = (n, a, b) => Number.isFinite(n) && n >= a && n <= b;
  const fmtN = (n, dec = 0) => (Math.round(n * 10 ** dec) / 10 ** dec).toFixed(dec).replace('.', ',');
  const fmtN1 = (n) => fmtN(n, 1);
  /** Número + unidad con espacio duro y sin corte de línea. */
  const val = (n, unit, dec = 0) => `<span class="nw">${fmtN(n, dec)}${NB}${unit}</span>`;
  const signed = (n, dec = 1) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmtN(Math.abs(n), dec);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const newId = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'm-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));

  /* ================= Clasificación de la tensión (copia de Mi tensión) ================= */
  function classify(s, d) {
    if (s < 90 || d < 60) return { cls: 'c-baja', label: 'Baja', ok: false };
    if (s >= 180 || d >= 110) return { cls: 'c-g3', label: 'Grado 3', ok: false };
    if (s >= 160 || d >= 100) return { cls: 'c-g2', label: 'Grado 2', ok: false };
    if (s >= 140 || d >= 90) return { cls: 'c-g1', label: 'Grado 1', ok: false };
    if (s >= 130 || d >= 80) return { cls: 'c-above', label: 'Por encima del objetivo', ok: false };
    if (s >= 120) return { cls: 'c-normal', label: 'Normal, en objetivo', ok: true };
    return { cls: 'c-optima', label: 'Óptima, en objetivo', ok: true };
  }

  /** Glucosa en llano (rangos orientativos, diabetes tipo 2). */
  function glucoseInfo(kind, v) {
    if (v < 70) return { cls: 'g-low', label: 'Baja', text: 'Está baja (menos de 70). Toma algo de azúcar y avisa a tu médico si se repite.' };
    if (v > 250) return { cls: 'g-high', label: 'Muy alta', text: 'Está muy alta (más de 250). Consulta a tu médico hoy.' };
    if (kind === 'despues') {
      return v < 180 ? { cls: 'g-ok', label: 'En rango', text: 'Dentro de lo orientativo (menos de 180 entre 1 y 2 horas después de comer).' }
        : { cls: 'g-warn', label: 'Algo alta', text: 'Algo por encima de lo orientativo (menos de 180 entre 1 y 2 horas después de comer).' };
    }
    if (v >= 80 && v <= 130) return { cls: 'g-ok', label: 'En rango', text: 'Dentro de lo orientativo (80 a 130 en ayunas o antes de comer).' };
    return { cls: 'g-warn', label: v > 130 ? 'Algo alta' : 'Algo baja', text: 'Fuera de lo orientativo (80 a 130 en ayunas o antes de comer).' };
  }
  const GLUCOSE_KINDS = { ayunas: 'En ayunas', antes: 'Antes de comer', despues: 'Después de comer' };

  /* ================= Limpieza / validación de datos propios ================= */
  const arr = (a) => (Array.isArray(a) ? a.slice(0, 20000) : []);
  function cleanData(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const out = {
      bp: [], weights: [], waists: [], glucose: [], activity: [], meds: [], medLog: [],
      settings: { ...DEFAULT_SETTINGS }, imports: {}, lastExport: null
    };
    for (const x of arr(r.bp)) {
      if (x && typeof x.id === 'string' && !isNaN(Date.parse(x.datetime)) && inRange(x.systolic, 70, 250) && inRange(x.diastolic, 40, 150) && inRange(x.pulse, 30, 200) && x.systolic > x.diastolic) {
        out.bp.push({ id: x.id, datetime: x.datetime, systolic: x.systolic, diastolic: x.diastolic, pulse: x.pulse, note: String(x.note || '').slice(0, 300) });
      }
    }
    for (const x of arr(r.weights)) if (x && typeof x.id === 'string' && isDate(x.date) && inRange(x.kg, 30, 300)) out.weights.push({ id: x.id, date: x.date, kg: x.kg });
    for (const x of arr(r.waists)) if (x && typeof x.id === 'string' && isDate(x.date) && inRange(x.cm, 40, 250)) out.waists.push({ id: x.id, date: x.date, cm: x.cm });
    for (const x of arr(r.glucose)) {
      if (x && typeof x.id === 'string' && isDate(x.date) && GLUCOSE_KINDS[x.kind] && inRange(x.mgdl, 20, 600)) {
        out.glucose.push({ id: x.id, date: x.date, time: /^\d{2}:\d{2}$/.test(x.time) ? x.time : '', kind: x.kind, mgdl: x.mgdl });
      }
    }
    for (const x of arr(r.activity)) {
      if (x && typeof x.id === 'string' && isDate(x.date) && inRange(x.walkMin, 0, 1000)) {
        out.activity.push({ id: x.id, date: x.date, walkMin: x.walkMin, walkKm: inRange(x.walkKm, 0, 200) ? x.walkKm : null, strength: !!x.strength });
      }
    }
    for (const x of arr(r.meds)) {
      if (x && typeof x.id === 'string' && typeof x.name === 'string' && x.name.trim()) {
        out.meds.push({
          id: x.id, name: x.name.trim().slice(0, 80), dose: String(x.dose || '').slice(0, 60),
          freq: x.freq === 'weekly' ? 'weekly' : 'daily', weekday: inRange(x.weekday, 0, 6) ? Math.round(x.weekday) : 0,
          time: /^\d{2}:\d{2}$/.test(x.time) ? x.time : '', active: !!x.active,
          since: isDate(x.since) ? x.since : null, pausedAt: isDate(x.pausedAt) ? x.pausedAt : null
        });
      }
    }
    if (!Array.isArray(r.meds)) out.meds = DEFAULT_MEDS();
    for (const x of arr(r.medLog)) if (x && typeof x.medId === 'string' && isDate(x.date)) out.medLog.push({ medId: x.medId, date: x.date });
    const s = r.settings || {};
    out.settings.showGlucose = s.showGlucose !== false;
    if (inRange(s.heightCm, 120, 230)) out.settings.heightCm = s.heightCm;
    if (inRange(s.goalKg, 40, 200)) out.settings.goalKg = s.goalKg;
    if (typeof r.lastExport === 'string') out.lastExport = r.lastExport;
    out.imports = cleanImports(r.imports);
    return out;
  }

  function cleanImports(im) {
    const out = {};
    if (!im || typeof im !== 'object') return out;
    const at = (x) => (x && typeof x.at === 'string' ? x.at : new Date().toISOString());
    if (im.tension && Array.isArray(im.tension.readings)) {
      out.tension = { at: at(im.tension), readings: im.tension.readings.map(cleanReading).filter(Boolean).slice(0, 20000) };
    }
    if (im.entrenador && im.entrenador.data && typeof im.entrenador.data === 'object') {
      out.entrenador = { at: at(im.entrenador), data: cleanEntData(im.entrenador.data) };
    }
    if (im.menu && im.menu.goals && typeof im.menu.goals === 'object') {
      const g = {};
      if (inRange(im.menu.goals.kcal, 800, 6000)) g.kcal = im.menu.goals.kcal;
      if (inRange(im.menu.goals.prot, 20, 400)) g.prot = im.menu.goals.prot;
      out.menu = { at: at(im.menu), goals: g };
    }
    if (im.plato && Array.isArray(im.plato.entries)) {
      out.plato = { at: at(im.plato), entries: im.plato.entries.filter((e) => e && isDate(e.date) && inRange(e.kcal, 0, 20000)).map((e) => ({ date: e.date, kcal: e.kcal, p: inRange(e.p, 0, 1000) ? e.p : 0 })).slice(0, 20000) };
    }
    return out;
  }
  function cleanReading(x) {
    if (x && !isNaN(Date.parse(x.datetime)) && inRange(x.systolic, 70, 250) && inRange(x.diastolic, 40, 150) && (x.pulse == null || inRange(x.pulse, 30, 200)) && x.systolic > x.diastolic) {
      return { id: typeof x.id === 'string' ? x.id : '', datetime: x.datetime, systolic: x.systolic, diastolic: x.diastolic, pulse: x.pulse == null ? null : x.pulse, note: String(x.note || '').slice(0, 300) };
    }
    return null;
  }
  /** Datos de Mi entrenador (tal cual guardan sus claves), validados. Solo lo que usamos. */
  function cleanEntData(d) {
    const o = {};
    if (Array.isArray(d['day-logs'])) {
      o['day-logs'] = d['day-logs'].filter((x) => x && isDate(x.date) && inRange(x.walkMin, 0, 1000)).slice(0, 20000).map((x) => ({
        date: x.date, walkMin: x.walkMin, strength: !!x.strength,
        glucoseBefore: typeof x.glucoseBefore === 'string' ? x.glucoseBefore : '', glucoseAfter: typeof x.glucoseAfter === 'string' ? x.glucoseAfter : '',
        walkKm: inRange(x.walkKm, 0, 200) ? x.walkKm : undefined
      }));
    }
    if (Array.isArray(d['weight-logs'])) o['weight-logs'] = d['weight-logs'].filter((x) => x && isDate(x.date) && inRange(x.kg, 30, 300)).slice(0, 20000).map((x) => ({ date: x.date, kg: x.kg }));
    if (Array.isArray(d['cal-logs'])) {
      o['cal-logs'] = d['cal-logs'].filter((x) => x && isDate(x.date) && inRange(x.kcal, 0, 20000)).slice(0, 50000).map((x) => ({ date: x.date, kcal: x.kcal, p: inRange(x.p, 0, 1000) ? x.p : 0 }));
    }
    for (const k of ['borrados-registros', 'borrados-pesos']) if (Array.isArray(d[k])) o[k] = d[k].filter(isDate).slice(0, 20000);
    return o;
  }

  /* ================= Almacenamiento propio ================= */
  let D = cleanData(null);
  let memoryOnly = false;
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(ROOT_KEY));
      if (raw && typeof raw === 'object' && raw.data) { D = cleanData(raw.data); return; }
    } catch (e) { /* ausentes o corruptos: se parte de cero */ }
    D = cleanData(null);
  }
  function save() {
    if (memoryOnly) return false;
    try {
      localStorage.setItem(ROOT_KEY, JSON.stringify({ schema: SCHEMA, data: D }));
      return true;
    } catch (e) { memoryOnly = true; return false; }
  }
  const storageOK = () => !memoryOnly;
  function replaceAll(data) { D = cleanData(data); return save(); }

  /* ================= Lectura de las otras apps (solo lectura, defensiva) ================= */
  function readKey(key) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function liveTension() {
    const j = readKey('mi-tension:v1');
    if (!j || !Array.isArray(j.readings)) return null;
    return { readings: j.readings.map(cleanReading).filter(Boolean) };
  }
  /** Tensión leída del backend «Mis apps» (Mac de casa) por GET, solo lectura. Nunca escribe en mi-tension:v1.
   *  Se guarda la última respuesta en una clave propia para poder verla sin conexión. */
  const TENSION_API = 'https://air-prodesin.tail7b1127.ts.net:8445/api/mi-tension/medidas';
  const TENSION_CACHE = 'mi-salud:tension-api';
  let remote = (() => { const j = readKey(TENSION_CACHE); return j && Array.isArray(j.readings) ? { at: j.at || null, readings: j.readings.map(cleanReading).filter(Boolean) } : null; })();
  function remoteTension() { return remote; }
  /** Pide las lecturas al backend. Devuelve true si ha cambiado algo. Si falla la red, sigue con lo local. */
  async function fetchTension(fetchFn) {
    const f = fetchFn || (typeof fetch === 'function' ? fetch : null);
    if (!f) return false;
    const url = location.origin === 'https://air-prodesin.tail7b1127.ts.net:8445' ? '/api/mi-tension/medidas' : TENSION_API;
    try {
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const t = ctl ? setTimeout(() => ctl.abort(), 8000) : null;
      const res = await f(url, { cache: 'no-store', signal: ctl ? ctl.signal : undefined });
      if (t) clearTimeout(t);
      if (!res.ok) return false;
      const j = await res.json();
      if (!j || !Array.isArray(j.readings)) return false;
      const readings = j.readings.map(cleanReading).filter(Boolean).slice(0, 20000);
      const antes = JSON.stringify(remote && remote.readings);
      remote = { at: new Date().toISOString(), readings };
      try { localStorage.setItem(TENSION_CACHE, JSON.stringify(remote)); } catch (e) { /* sin sitio: solo en memoria */ }
      return JSON.stringify(readings) !== antes;
    } catch (e) { return false; }
  }
  function liveEntrenador() {
    const j = readKey('mi-entrenador:v1');
    if (!j || !j.data || typeof j.data !== 'object' || Array.isArray(j.data)) return null;
    return { data: cleanEntData(j.data) };
  }
  function liveMenu() {
    const j = readKey('mi-menu:v2');
    if (!j || !j.goals) return null;
    const g = {};
    if (inRange(j.goals.kcal, 800, 6000)) g.kcal = j.goals.kcal;
    if (inRange(j.goals.prot, 20, 400)) g.prot = j.goals.prot;
    return Object.keys(g).length ? { goals: g } : null;
  }
  /** Mi plato guarda todo en localStorage «mi-plato:v1» = { schema, data: { comidas: [...] } } (y su exportación
   *  es { app:'mi-plato', schema, data: { comidas, ... } }). Cada comida: { fecha:'AAAA-MM-DD', hora, toma,
   *  items:[{ g, por100:{ kcal, p, ... } }] }. No guarda kcal por comida: se suman los alimentos (g/100 × por100). */
  function platoMeals(list) {
    const out = [];
    for (const m of list.slice(0, 50000)) {
      if (!m || typeof m !== 'object' || !isDate(m.fecha) || !Array.isArray(m.items) || !m.items.length) continue;
      let kcal = 0, p = 0, ok = true;
      for (const it of m.items) {
        const per = it && it.por100;
        if (!per || !Number.isFinite(it.g) || it.g < 0 || !Number.isFinite(per.kcal)) { ok = false; break; }
        kcal += (it.g / 100) * per.kcal;
        p += (it.g / 100) * (Number.isFinite(per.p) ? per.p : 0);
      }
      if (ok && inRange(kcal, 0, 20000)) out.push({ date: m.fecha, kcal: Math.round(kcal), p: inRange(p, 0, 1000) ? Math.round(p * 10) / 10 : 0 });
    }
    return out;
  }
  /** Acepta la raíz de localStorage ({schema,data:{comidas}}), la exportación ({app,data:{comidas}}) o `data` suelto. */
  function extractPlato(root) {
    if (root && typeof root === 'object') {
      const d = root.data && typeof root.data === 'object' && !Array.isArray(root.data) ? root.data : root;
      if (Array.isArray(d.comidas)) return platoMeals(d.comidas);
    }
    return extractPlatoGeneric(root);
  }
  /** Respaldo para formas no previstas: busca listas de objetos con fecha + kcal (+ proteína). */
  function extractPlatoGeneric(root) {
    const out = [];
    const seen = new Set();
    const num = (o, keys) => { for (const k of keys) if (typeof o[k] === 'number' && Number.isFinite(o[k])) return o[k]; return NaN; };
    const visit = (node, depth) => {
      if (!node || typeof node !== 'object' || depth > 4 || seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) {
        for (const x of node.slice(0, 50000)) {
          if (x && typeof x === 'object' && !Array.isArray(x)) {
            const rawDate = typeof x.date === 'string' ? x.date : typeof x.datetime === 'string' ? x.datetime : typeof x.day === 'string' ? x.day : '';
            const date = /^\d{4}-\d{2}-\d{2}/.test(rawDate) ? rawDate.slice(0, 10) : '';
            const kcal = num(x, ['kcal', 'calories', 'calorias', 'energia', 'energy']);
            if (date && isDate(date) && inRange(kcal, 0, 20000)) {
              const p = num(x, ['p', 'prot', 'protein', 'proteina', 'proteinas', 'protG']);
              out.push({ date, kcal, p: inRange(p, 0, 1000) ? p : 0 });
              continue;
            }
          }
          visit(x, depth + 1);
        }
      } else {
        for (const k of Object.keys(node).slice(0, 200)) visit(node[k], depth + 1);
      }
    };
    try { visit(root, 0); } catch (e) { return []; }
    return out.slice(0, 50000);
  }
  function livePlato() {
    const j = readKey('mi-plato:v1');
    if (!j) return null;
    const entries = extractPlato(j);
    return entries.length ? { entries } : null;
  }

  /* ================= Fusión de Mi entrenador (misma lógica que su app) ================= */
  function mergeLogs(stored, embedded) {
    const map = new Map();
    for (const row of embedded) map.set(row.date, { ...row });
    for (const row of stored) {
      const prev = map.get(row.date);
      if (!prev) { map.set(row.date, { ...row }); continue; }
      const defined = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined && v !== null && v !== ''));
      map.set(row.date, {
        ...prev, ...defined, date: row.date, walkMin: Math.max(prev.walkMin, row.walkMin), strength: prev.strength || row.strength,
        glucoseBefore: row.glucoseBefore || prev.glucoseBefore, glucoseAfter: row.glucoseAfter || prev.glucoseAfter
      });
    }
    return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  function mergeWeights(stored, embedded) {
    const map = new Map();
    for (const row of embedded) map.set(row.date, { ...row });
    for (const row of stored) map.set(row.date, { ...row });
    return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  /** Una copia de Mi entrenador (viva o importada) → registros y pesos efectivos, con precarga y «borrados-*». */
  function entEffective(data) {
    const goneL = data['borrados-registros'] || [];
    const goneW = data['borrados-pesos'] || [];
    return {
      logs: mergeLogs(data['day-logs'] || [], REGISTROS.filter((r) => !goneL.includes(r.date))),
      weights: mergeWeights(data['weight-logs'] || INITIAL_WEIGHTS, PESOS.filter((r) => !goneW.includes(r.date))),
      cal: data['cal-logs'] || []
    };
  }

  /* ================= Fusión de todas las fuentes, sin contar nada dos veces ================= */
  const SRC = {
    manual: 'Apuntado aquí', 'tension-live': 'Mi tensión', 'tension-imp': 'Mi tensión (importado)', 'tension-api': 'Mi tensión (Mac de casa)', seed: 'Precargado',
    'ent-live': 'Mi entrenador', 'ent-imp': 'Mi entrenador (importado)', plato: 'Mi plato', 'plato-imp': 'Mi plato (importado)'
  };

  function build() {
    const lt = liveTension(), rt = remoteTension(), le = liveEntrenador(), lm = liveMenu(), lp = livePlato();
    const it = D.imports.tension, ie = D.imports.entrenador, im = D.imports.menu, ip = D.imports.plato;

    // --- Tensión: manual > vivo > importado > precarga. La precarga solo si no hay ninguna copia de Mi tensión
    // (si existe, ya trae las precargadas… o el usuario las borró allí).
    const bp = [];
    const seenBp = new Set();
    const addBp = (r, src, manualId) => {
      const ts = new Date(r.datetime).getTime();
      const k = Math.round(ts / 60000) + '|' + r.systolic + '|' + r.diastolic;
      if (seenBp.has(k)) return;
      seenBp.add(k);
      bp.push({ ts, date: dateOfISO(r.datetime), time: timeOfISO(r.datetime), sys: r.systolic, dia: r.diastolic, pulse: r.pulse, note: r.note || '', src, manualId: manualId || null, id: r.id });
    };
    D.bp.forEach((r) => addBp(r, 'manual', r.id));
    if (lt) lt.readings.forEach((r) => addBp(r, 'tension-live'));
    if (it) it.readings.forEach((r) => addBp(r, 'tension-imp'));
    if (rt) rt.readings.forEach((r) => addBp(r, 'tension-api'));
    if (!lt && !it && !rt) SEED_BP.forEach(([d, t, s, di, p]) => addBp({ id: 'seed-' + d, datetime: toISO(d, t), systolic: s, diastolic: di, pulse: p, note: '' }, 'seed'));
    bp.sort((a, b) => a.ts - b.ts);

    // --- Mi entrenador: una vista por copia disponible (viva, importada); sin copias, solo la precarga.
    const views = [];
    if (le) views.push({ src: 'ent-live', ...entEffective(le.data) });
    if (ie) views.push({ src: 'ent-imp', ...entEffective(ie.data) });
    if (!views.length) views.push({ src: 'seed', ...entEffective({}) });

    // pesos por fecha: manual > vivo > importado > precarga
    const wMap = new Map();
    for (const v of views.slice().reverse()) for (const w of v.weights) wMap.set(w.date, { date: w.date, kg: w.kg, src: v.src, manualId: null });
    D.weights.forEach((w) => wMap.set(w.date, { date: w.date, kg: w.kg, src: 'manual', manualId: w.id }));
    const weights = [...wMap.values()].sort((a, b) => (a.date < b.date ? -1 : 1));

    // cintura por fecha
    const cMap = new Map();
    SEED_WAIST.forEach((c) => cMap.set(c.date, { date: c.date, cm: c.cm, src: 'seed', manualId: null }));
    D.waists.forEach((c) => cMap.set(c.date, { date: c.date, cm: c.cm, src: 'manual', manualId: c.id }));
    const waists = [...cMap.values()].sort((a, b) => (a.date < b.date ? -1 : 1));

    // actividad por fecha: se funde sin sumar (máximo de minutos, fuerza si en alguna)
    const aMap = new Map();
    const addAct = (date, walkMin, walkKm, strength, src, manualId) => {
      const p = aMap.get(date);
      if (!p) { aMap.set(date, { date, walkMin, walkKm: walkKm || null, strength, srcs: [src], manualId: manualId || null }); return; }
      p.walkMin = Math.max(p.walkMin, walkMin);
      p.walkKm = Math.max(p.walkKm || 0, walkKm || 0) || null;
      p.strength = p.strength || strength;
      if (!p.srcs.includes(src)) p.srcs.push(src);
      if (manualId) p.manualId = manualId;
    };
    for (const v of views) for (const l of v.logs) addAct(l.date, l.walkMin, l.walkKm, l.strength, v.src);
    D.activity.forEach((a) => addAct(a.date, a.walkMin, a.walkKm, a.strength, 'manual', a.id));
    const activity = [...aMap.values()].sort((a, b) => (a.date < b.date ? -1 : 1));

    // glucosa: la de Mi entrenador (antes/después por día) + la apuntada aquí
    const glucose = [];
    const seenG = new Set();
    for (const v of views) {
      for (const l of v.logs) {
        for (const [f, kind] of [['glucoseBefore', 'antes'], ['glucoseAfter', 'despues']]) {
          const n = parseNum(l[f]);
          const k = l.date + kind + n;
          if (inRange(n, 20, 600) && !seenG.has(k)) { seenG.add(k); glucose.push({ date: l.date, time: '', kind, mgdl: n, src: v.src, manualId: null }); }
        }
      }
    }
    D.glucose.forEach((g) => glucose.push({ date: g.date, time: g.time, kind: g.kind, mgdl: g.mgdl, src: 'manual', manualId: g.id }));
    glucose.sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));

    // comida por día: Mi plato (vivo o importado) tiene prioridad sobre el contador de Mi entrenador
    const food = new Map();
    const addFood = (entries, src, into) => {
      for (const e of entries) {
        const f = into.get(e.date) || { date: e.date, kcal: 0, p: 0, n: 0, src };
        f.kcal += e.kcal; f.p += e.p || 0; f.n += 1;
        into.set(e.date, f);
      }
    };
    const platoMap = new Map();
    if (lp) addFood(lp.entries, 'plato', platoMap);
    else if (ip) addFood(ip.entries, 'plato-imp', platoMap);
    const entMap = new Map();
    const calSrc = views.find((v) => v.cal.length);
    if (calSrc) addFood(calSrc.cal, calSrc.src, entMap);
    for (const [d, f] of platoMap) food.set(d, f);
    for (const [d, f] of entMap) if (!food.has(d)) food.set(d, f);

    const goals = { ...(im ? im.goals : {}), ...(lm ? lm.goals : {}) };

    const sources = {
      tension: { api: rt ? rt.readings.length : null, live: lt ? lt.readings.length : null, imp: it ? { at: it.at, n: it.readings.length } : null },
      entrenador: { live: le ? { logs: (le.data['day-logs'] || []).length, weights: (le.data['weight-logs'] || INITIAL_WEIGHTS).length } : null, imp: ie ? { at: ie.at } : null },
      menu: { live: !!lm, imp: im ? { at: im.at } : null },
      plato: { live: !!lp, imp: ip ? { at: ip.at, n: ip.entries.length } : null },
      manual: { bp: D.bp.length, weights: D.weights.length, waists: D.waists.length, glucose: D.glucose.length, activity: D.activity.length }
    };
    return { bp, weights, waists, activity, glucose, food, goals, sources };
  }

  /* ================= Medicación ================= */
  const takenOn = (medId, date) => D.medLog.some((l) => l.medId === medId && l.date === date);
  function setTaken(medId, date, taken) {
    D.medLog = D.medLog.filter((l) => !(l.medId === medId && l.date === date));
    if (taken) D.medLog.push({ medId, date });
    return save();
  }
  function setMedActive(med, active) {
    const t = today();
    med.active = active;
    if (active) { med.since = med.since && !med.pausedAt ? med.since : t; med.pausedAt = null; }
    else if (med.since) med.pausedAt = t;
  }
  /** Fechas de toma de una medicación entre a y b (incluidas). */
  function doseDates(med, a, b) {
    const out = [];
    for (let d = a; d <= b; d = addDays(d, 1)) if (med.freq === 'daily' || weekdayOf(d) === med.weekday) out.push(d);
    return out;
  }
  const activeOn = (med, date) => !!med.since && date >= med.since && (!med.pausedAt || date < med.pausedAt);
  /** Recordatorio: { kind: 'today' | 'missed' | 'done', date } o null. */
  function medReminder(med, t) {
    if (!med.active) return null;
    if (med.freq === 'daily') return takenOn(med.id, t) ? { kind: 'done', date: t } : { kind: 'today', date: t };
    const lastDue = doseDates(med, addDays(t, -6), t).pop();
    if (!lastDue) return null;
    const takenSince = D.medLog.some((l) => l.medId === med.id && l.date >= lastDue && l.date <= t);
    if (lastDue === t) return takenSince ? { kind: 'done', date: t } : { kind: 'today', date: t };
    if (!activeOn(med, lastDue) || takenSince) return null;
    return { kind: 'missed', date: lastDue };
  }
  /** Cumplimiento (0–1) de una semana (lunes a domingo), o null si no había nada previsto. */
  function adherenceWeek(monday, meds) {
    const t = today();
    const end = addDays(monday, 6);
    let exp = 0, got = 0;
    for (const m of meds) {
      for (const d of doseDates(m, monday, end)) {
        if (!activeOn(m, d)) continue;
        const taken = m.freq === 'daily' ? takenOn(m.id, d) : D.medLog.some((l) => l.medId === m.id && l.date >= d && l.date <= addDays(d, 3));
        if (d < t || taken) { exp += 1; if (taken) got += 1; }
      }
    }
    return exp ? { exp, got, pct: got / exp } : null;
  }

  /* ================= Estadísticas semanales ================= */
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  /** Últimas n semanas (lunes a domingo), la más reciente al final. */
  function weekly(model, n) {
    const t = today();
    const m0 = mondayOf(t);
    const weeks = [];
    for (let i = n - 1; i >= 0; i--) {
      const start = addDays(m0, -7 * i), end = addDays(start, 6);
      const bps = model.bp.filter((r) => r.date >= start && r.date <= end);
      const ws = model.weights.filter((w) => w.date >= start && w.date <= end);
      const gl = model.glucose.filter((g) => g.date >= start && g.date <= end);
      const act = model.activity.filter((a) => a.date >= start && a.date <= end);
      const fast = gl.filter((g) => g.kind !== 'despues').map((g) => g.mgdl);
      const after = gl.filter((g) => g.kind === 'despues').map((g) => g.mgdl);
      weeks.push({
        start, end, current: i === 0, label: shortDate(start),
        bpN: bps.length,
        sys: mean(bps.map((r) => r.sys)), dia: mean(bps.map((r) => r.dia)), pulse: mean(bps.map((r) => r.pulse).filter((p) => p != null)),
        okPct: bps.length ? bps.filter((r) => classify(r.sys, r.dia).ok).length / bps.length : null,
        kg: ws.length ? ws[ws.length - 1].kg : null,
        gFast: mean(fast), gAfter: mean(after), gN: gl.length,
        walkMin: act.reduce((s, a) => s + a.walkMin, 0), walkDays: act.filter((a) => a.walkMin > 0).length,
        strength: act.filter((a) => a.strength).length,
        adh: adherenceWeek(start, D.meds)
      });
    }
    return weeks;
  }

  /** Peso en una fecha o la última medida anterior a ella. */
  function weightAtOrBefore(weights, date) {
    let r = null;
    for (const w of weights) if (w.date <= date) r = w;
    return r;
  }

  /* ================= Exportar / importar ================= */
  function exportPayload() {
    D.lastExport = new Date().toISOString();
    save();
    return { app: 'mi-salud', schema: SCHEMA, exportedAt: D.lastExport, data: D };
  }
  /** Valida una copia propia. Lanza Error en español. */
  function parseOwnBackup(text) {
    let j;
    try { j = JSON.parse(text); } catch (e) { throw new Error('El archivo no es un JSON válido.'); }
    if (!j || j.app !== 'mi-salud' || !j.data || typeof j.data !== 'object') throw new Error('Este archivo no es una copia de Mi salud.');
    if (Number.isFinite(j.schema) && j.schema > SCHEMA) throw new Error('La copia es de una versión más reciente. Actualiza Mi salud e inténtalo de nuevo.');
    const data = cleanData(j.data);
    const n = data.bp.length + data.weights.length + data.waists.length + data.glucose.length + data.activity.length;
    return { data, summary: `${n} datos apuntados, ${data.meds.length} medicaciones` };
  }

  /** Importa uno o varios ficheros de otras apps. Devuelve un resumen por fichero. */
  function importOthers(files /* [{name, text}] */) {
    const results = [];
    let best = null;
    for (const f of files) {
      try {
        if (f.text.length > 12 * 1024 * 1024) throw new Error('El archivo es demasiado grande.');
        const j = JSON.parse(f.text);
        if (!j || typeof j !== 'object') throw new Error('no es un JSON válido');
        const at = new Date().toISOString();
        if (j.app === 'mi-tension' && Array.isArray(j.readings)) {
          const rs = j.readings.map(cleanReading).filter(Boolean);
          if (!rs.length && j.readings.length) throw new Error('las lecturas no son válidas');
          const prev = D.imports.tension ? D.imports.tension.readings : [];
          const seen = new Set();
          const all = [];
          for (const r of rs.concat(prev)) {
            const k = Math.round(new Date(r.datetime).getTime() / 60000) + '|' + r.systolic + '|' + r.diastolic;
            if (!seen.has(k)) { seen.add(k); all.push(r); }
          }
          D.imports.tension = { at, readings: all };
          results.push({ name: f.name, ok: true, text: `Mi tensión: ${rs.length} lecturas` });
        } else if (j.app === 'mi-entrenador' && j.data && typeof j.data === 'object') {
          if (Number.isFinite(j.schema) && j.schema > 1) throw new Error('versión más reciente de Mi entrenador');
          const data = cleanEntData(j.data);
          const exp = typeof j.exportedAt === 'string' ? j.exportedAt : '';
          if (!best || exp >= best.exp) best = { exp, data, name: f.name };
          results.push({ name: f.name, ok: true, text: `Mi entrenador: ${(data['day-logs'] || []).length} días, ${(data['weight-logs'] || []).length} pesos` });
        } else if (j.app === 'mi-menu' && j.data && j.data.goals) {
          const im = cleanImports({ menu: { at, goals: j.data.goals } });
          if (!im.menu) throw new Error('sin objetivos válidos');
          D.imports.menu = im.menu;
          results.push({ name: f.name, ok: true, text: 'Mi menú: objetivos de comida' });
        } else if (j.app === 'mi-plato') {
          const entries = extractPlato(j.data !== undefined ? j.data : j);
          if (!entries.length) throw new Error('no se han encontrado comidas');
          D.imports.plato = { at, entries };
          results.push({ name: f.name, ok: true, text: `Mi plato: ${entries.length} comidas` });
        } else {
          throw new Error('no es una copia de Mi tensión, Mi entrenador, Mi menú ni Mi plato');
        }
      } catch (e) {
        results.push({ name: f.name, ok: false, text: e.message || 'no se pudo leer' });
      }
    }
    if (best) D.imports.entrenador = { at: new Date().toISOString(), data: best.data };
    if (results.some((r) => r.ok)) save();
    return results;
  }

  load();
  window.MS = {
    ROOT_KEY, NB, WEEKDAYS, GLUCOSE_KINDS, SRC, DEFAULT_SETTINGS,
    get D() { return D; },
    fetchTension, remoteTension, TENSION_API,
    load, save, storageOK, replaceAll, build, exportPayload, parseOwnBackup, importOthers,
    today, nowParts, toISO, nowInputs, isDate, addDays, diffDays, weekdayOf, mondayOf, longDate, shortDate, dateOfISO,
    parseNum, inRange, fmtN, fmtN1, val, signed, esc, newId, classify, glucoseInfo,
    takenOn, setTaken, setMedActive, medReminder, doseDates, activeOn, weekly, weightAtOrBefore, mean, defaultMeds: DEFAULT_MEDS
  };
})();
