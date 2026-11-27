/* Mi salud — interfaz. Los datos y la fusión de fuentes viven en data.js (window.MS). */
(() => {
  'use strict';
  const M = window.MS;
  const { esc, val, fmtN, fmtN1, signed, NB } = M;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const GOAL = () => M.D.settings.goalKg;
  const HEIGHT = () => M.D.settings.heightCm;
  const WALK_GOAL = 150;
  const LINKS = [
    ['Mi tensión', 'Registro de tensión arterial', location.origin === 'https://air-prodesin.tail7b1127.ts.net:8445' ? '/mi-tension/' : 'https://air-prodesin.tail7b1127.ts.net:8445/mi-tension/'],
    ['Mi entrenador', 'Fuerza, caminata y comida', 'https://prodesin.github.io/mi-entrenador/'],
    ['Mi menú', 'Menú semanal y lista de la compra', 'https://prodesin.github.io/mi-menu/'],
    ['Mi plato', 'Apunta lo que comes', 'https://prodesin.github.io/mi-plato/']
  ];

  let model = M.build();
  let tab = 'hoy';
  let weeksRange = 8;
  let histDays = 30;
  let lastImport = null; // resultados de «Traer datos»

  /* ================= Utilidades de UI ================= */
  let toastTimer;
  function toast(msg, isError) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('error', !!isError);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }
  const srcLabel = (s) => M.SRC[s] || s;
  function persist() {
    if (!M.save()) toast('No se pudo guardar en este dispositivo.', true);
  }
  function afterChange() { model = M.build(); renderAll(); }

  function confirmDlg(title, bodyHTML, okLabel, danger) {
    return new Promise((resolve) => {
      const d = $('#dlg-confirm');
      $('[data-title]', d).textContent = title;
      $('[data-body]', d).innerHTML = bodyHTML;
      const ok = $('[data-ok]', d);
      ok.textContent = okLabel || 'Aceptar';
      ok.className = 'btn ' + (danger ? 'danger' : 'primary');
      let result = false;
      const onClose = () => { d.removeEventListener('close', onClose); resolve(result); };
      d.addEventListener('close', onClose);
      ok.onclick = (e) => { e.preventDefault(); result = true; d.close(); };
      $('[data-cancel]', d).onclick = () => d.close();
      d.showModal();
    });
  }

  /* ================= Cabecera y pestañas ================= */
  const TITLES = { hoy: 'Hoy', tendencia: 'Tendencia', historial: 'Historial', mas: 'Más' };
  function showTab(name, scroll = true) {
    tab = name;
    $$('.panel').forEach((p) => { p.hidden = p.id !== 'panel-' + name; });
    $$('.tabbar button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    $('#title').textContent = TITLES[name];
    renderHeader();
    renderTab();
    if (scroll) window.scrollTo(0, 0);
  }
  function renderHeader() {
    $('#subtitle').textContent = tab === 'hoy' ? M.longDate(M.today()) : ({
      tendencia: 'Cómo vas, semana a semana', historial: 'Todo lo apuntado, por días', mas: 'Ajustes, datos y avisos'
    })[tab];
  }
  $('.tabbar').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) showTab(b.dataset.tab); });

  // Lado del rail: si la safe area grande está a la izquierda (cámara de ese lado), el rail va a la izquierda.
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;width:0;height:0;padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px)';
  document.body.appendChild(probe);
  function syncRailSide() {
    const cs = getComputedStyle(probe);
    const l = parseFloat(cs.paddingLeft) || 0, r = parseFloat(cs.paddingRight) || 0;
    document.documentElement.dataset.rail = l > r ? 'left' : 'right';
  }
  syncRailSide();
  window.addEventListener('resize', syncRailSide);
  window.addEventListener('orientationchange', syncRailSide);

  /* ================= HOY ================= */
  function todayBp() { const t = M.today(); return model.bp.filter((r) => r.date === t).pop() || null; }

  function bpAdvice(c) {
    if (c.cls === 'c-baja') return 'Está baja. Si notas mareo, siéntate y consúltalo con tu médico.';
    if (c.cls === 'c-optima' || c.cls === 'c-normal') return 'Está en objetivo. Sigue así.';
    if (c.cls === 'c-above') return 'Está algo por encima del objetivo (130/80). Una lectura suelta no es un problema.';
    if (c.cls === 'c-g3') return 'Está muy alta. Descansa cinco minutos y repite. Si sigue así o te encuentras mal, llama a tu médico.';
    return 'Está alta. Si se repite varios días, díselo a tu médico.';
  }

  function cardBp() {
    const t = M.today();
    const r = todayBp();
    const np = M.nowParts();
    let body;
    if (r) {
      const c = M.classify(r.sys, r.dia);
      body = `<div class="big"><span class="num">${r.sys}/${r.dia}</span><span class="unit">mmHg</span></div>
        <p class="meta">Pulso ${r.pulse == null ? '—' : val(r.pulse, 'lpm')} · ${r.time}</p>
        <p class="plain"><span class="pill ${c.cls}"><i></i>${c.label}</span></p>
        <p class="plain">${bpAdvice(c)}</p>`;
    } else {
      const min = np.hour * 60 + np.minute; // desde las 13:30 el aviso es más visible
      const [cls, msg] = min < 13 * 60 + 30 ? ['soft', 'Hoy toca antes de comer.']
        : min < 16 * 60 ? ['urgent', 'Es la hora: tómatela antes de comer.']
        : ['soft', 'Hoy aún no la has apuntado. Si te la tomaste, apúntala; si no, mañana antes de comer.'];
      const last = model.bp.filter((x) => x.date < t).pop();
      body = `<div class="notice ${cls}">${msg}</div>
        ${last ? `<p class="meta" style="margin-top:10px">Última lectura: ${last.sys}/${last.dia} mmHg, ${esc(M.longDate(last.date))}.</p>` : ''}`;
    }
    return `<article class="card" id="card-bp"><h2>Tensión</h2>${body}
      <div class="actions"><button class="btn primary" data-act="add-bp">Apuntar tensión</button></div></article>`;
  }

  /** Cambio del ÚLTIMO peso frente al peso más cercano que tenga al menos `days` días de antigüedad respecto a él. */
  function weightChange(days) {
    const w = model.weights;
    if (!w.length) return null;
    const last = w[w.length - 1];
    const ref = M.weightAtOrBefore(w, M.addDays(last.date, -days));
    if (!ref) return null;
    return { d: last.kg - ref.kg, from: ref.date, days: M.diffDays(last.date, ref.date), last };
  }
  function cardWeight() {
    const w = model.weights;
    if (!w.length) {
      return `<article class="card"><h2>Peso</h2><p class="empty">Aún no hay ningún peso.</p><div class="actions"><button class="btn primary" data-act="add-weight">Apuntar peso</button></div></article>`;
    }
    const last = w[w.length - 1];
    const imc = last.kg / ((HEIGHT() / 100) ** 2);
    const c7 = weightChange(7), c30 = weightChange(30);
    const toGoal = last.kg - GOAL();
    const waist = model.waists[model.waists.length - 1];
    const stat = (c, target, word, none) => (c
      ? `<div class="stat"><b>${signed(c.d)}${NB}kg</b><span>${c.days <= target + 2 ? `frente a hace ${word}` : `frente al ${esc(M.shortDate(c.from))} (hace ${c.days} días)`}</span></div>`
      : `<div class="stat"><b>—</b><span>${none}</span></div>`);
    // El texto llano usa EXACTAMENTE la misma comparación (c7) que la primera cifra.
    let plain;
    if (c7) {
      const sp = c7.days <= 9 ? 'en la última semana' : `desde el ${esc(M.shortDate(c7.from))} (hace ${c7.days} días)`;
      plain = Math.abs(c7.d) < 0.2 ? `Tu peso casi no ha cambiado ${sp}.` : c7.d < 0 ? `Has bajado ${fmtN1(-c7.d)}${NB}kg ${sp}.` : `Has subido ${fmtN1(c7.d)}${NB}kg ${sp}.`;
    } else plain = 'Sin dato de hace una semana para comparar. Apunta tu peso una vez por semana para ver cómo evoluciona.';
    const age = M.diffDays(M.today(), last.date);
    if (age > 8) plain += ` Hace ${age} días de tu último peso: pésate esta semana.`;
    return `<article class="card" id="card-weight"><h2>Peso <span class="tag">${esc(M.shortDate(last.date))}</span></h2>
      <div class="big"><span class="num">${fmtN1(last.kg)}</span><span class="unit">kg</span></div>
      <p class="plain">${plain}</p>
      <div class="stats">
        ${stat(c7, 7, 'una semana', 'sin dato de hace una semana')}
        ${stat(c30, 30, 'un mes', 'sin dato de hace un mes')}
        <div class="stat"><b>${fmtN1(imc)}</b><span>IMC (peso según tu altura)</span></div>
        <div class="stat"><b>${toGoal > 0 ? fmtN1(toGoal) + NB + 'kg' : '¡Meta!'}</b><span>${toGoal > 0 ? `para llegar a ${fmtN(GOAL())}${NB}kg` : `ya estás en ${fmtN(GOAL())}${NB}kg o menos`}</span></div>
        ${waist ? `<div class="stat"><b>${fmtN1(waist.cm)}${NB}cm</b><span>cintura, ${esc(M.shortDate(waist.date))}</span></div>` : ''}
      </div>
      <div class="actions"><button class="btn primary" data-act="add-weight">Apuntar peso o cintura</button></div></article>`;
  }

  function cardGlucose() {
    if (!M.D.settings.showGlucose) return '';
    const t = M.today();
    const todays = model.glucose.filter((g) => g.date === t);
    const by = (k) => todays.filter((g) => g.kind === k).pop();
    const chips = [['ayunas', 'Ayunas'], ['antes', 'Antes'], ['despues', 'Después']].map(([k, label]) => {
      const g = by(k);
      if (!g) return `<div class="stat"><b>—</b><span>${label}</span></div>`;
      const gi = M.glucoseInfo(k, g.mgdl);
      return `<div class="stat"><b>${g.mgdl}</b><span>${label}<br><span class="pill sm ${gi.cls}"><i></i>${gi.label}</span></span></div>`;
    }).join('');
    let alerts = '';
    for (const g of todays) {
      if (g.mgdl < 70) alerts += `<div class="notice alert">Glucosa baja (${g.mgdl} mg/dL). Toma algo con azúcar, como un zumo, y vuelve a medirte en 15 minutos. Si se repite, avisa a tu médico.</div>`;
      else if (g.mgdl > 250) alerts += `<div class="notice alert">Glucosa muy alta (${g.mgdl} mg/dL). Consulta a tu médico hoy.</div>`;
    }
    const lastAny = model.glucose[model.glucose.length - 1];
    const info = todays.length
      ? `<p class="hint">Orientativo: en ayunas o antes de comer, entre 80 y 130; una o dos horas después de comer, menos de 180. Consulta a tu médico.</p>`
      : `<p class="plain">Hoy no has apuntado glucosa.${lastAny ? ` Último dato: ${lastAny.mgdl}${NB}mg/dL, ${esc(M.longDate(lastAny.date))}.` : ''}</p>
         <p class="hint">Orientativo: en ayunas o antes de comer, entre 80 y 130; una o dos horas después de comer, menos de 180. Consulta a tu médico.</p>`;
    return `<article class="card" id="card-glucose"><h2>Glucosa <span class="tag">mg/dL</span></h2>${alerts}<div class="stats t3">${chips}</div>${info}
      <div class="actions"><button class="btn primary" data-act="add-glucose">Apuntar glucosa</button></div></article>`;
  }

  function cardMove() {
    const t = M.today();
    const mon = M.mondayOf(t);
    const day = model.activity.find((a) => a.date === t);
    const week = model.activity.filter((a) => a.date >= mon && a.date <= M.addDays(mon, 6));
    const wmin = week.reduce((s, a) => s + a.walkMin, 0);
    const wstr = week.filter((a) => a.strength).length;
    const pct = (n, g) => Math.min(100, Math.round((n / g) * 100));
    const todayTxt = day && (day.walkMin > 0 || day.strength)
      ? `Hoy: ${day.walkMin > 0 ? `has caminado ${val(day.walkMin, 'min')}${day.walkKm ? ` (${val(day.walkKm, 'km', 2)})` : ''}` : 'sin caminata'}${day.strength ? ' y has hecho fuerza' : ''}.`
      : 'Hoy aún no has apuntado movimiento.';
    return `<article class="card" id="card-move"><h2>Movimiento</h2>
      <p class="plain">${todayTxt}</p>
      <div class="stats t3">
        <div class="stat"><b>${day ? fmtN(day.walkMin) + NB + 'min' : '—'}</b><span>caminata de hoy</span></div>
        <div class="stat"><b>${day && day.walkKm ? fmtN(day.walkKm, 2) + NB + 'km' : '—'}</b><span>distancia de hoy</span></div>
        <div class="stat"><b>${day && day.strength ? 'Sí' : 'No'}</b><span>fuerza hoy</span></div>
      </div>
      <div class="prog"><div class="prog-head"><span>Caminar esta semana</span><span>${fmtN(wmin)} de ${WALK_GOAL}${NB}min</span></div>
        <div class="track" role="progressbar" aria-valuenow="${Math.min(wmin, WALK_GOAL)}" aria-valuemin="0" aria-valuemax="${WALK_GOAL}"><div class="fill ${wmin >= WALK_GOAL ? 'ok' : ''}" style="width:${pct(wmin, WALK_GOAL)}%"></div></div></div>
      <div class="prog"><div class="prog-head"><span>Fuerza esta semana</span><span>${wstr} de 2–3 sesiones</span></div>
        <div class="track" role="progressbar" aria-valuenow="${Math.min(wstr, 3)}" aria-valuemin="0" aria-valuemax="3"><div class="fill ${wstr >= 2 ? 'ok' : ''}" style="width:${pct(wstr, 3)}%"></div></div></div>
      <div class="actions"><button class="btn primary" data-act="add-move">Apuntar movimiento</button></div></article>`;
  }

  const medWhen = (m) => (m.freq === 'weekly' ? `Cada ${M.WEEKDAYS[m.weekday]}` : 'Cada día') + (m.time ? ` · sobre las ${m.time}` : '') + (m.dose ? ` · ${esc(m.dose)}` : '');

  function medReminders() {
    const t = M.today();
    const out = [];
    for (const m of M.D.meds) {
      const r = M.medReminder(m, t);
      if (!r) continue;
      if (r.kind === 'today') out.push({ m, r, html: `<div class="notice urgent"><div>${m.freq === 'weekly' ? `Hoy te toca ${esc(m.name)}.` : `Hoy te toca ${esc(m.name)}${m.time ? `, sobre las ${m.time}` : ''}.`}</div>
        <div class="row-btns"><button class="btn primary small" data-act="med-take" data-id="${esc(m.id)}" data-date="${t}">Ya la he tomado</button></div></div>` });
      else if (r.kind === 'missed') out.push({ m, r, html: `<div class="notice alert"><div>Te la saltaste el ${M.WEEKDAYS[M.weekdayOf(r.date)]}: ${esc(m.name)}.</div>
        <div class="row-btns"><button class="btn secondary small" data-act="med-take" data-id="${esc(m.id)}" data-date="${r.date}">La tomé el ${M.WEEKDAYS[M.weekdayOf(r.date)]}</button><button class="btn secondary small" data-act="med-take" data-id="${esc(m.id)}" data-date="${t}">La he tomado hoy</button></div></div>` });
    }
    return out;
  }

  function cardMeds() {
    const t = M.today();
    const meds = M.D.meds;
    const rows = meds.map((m) => {
      const r = M.medReminder(m, t);
      let status = '';
      if (!m.active) status = '<span class="badge">En pausa</span>';
      else if (r && r.kind === 'done') status = '<span class="badge ok">Tomada ✓</span>';
      const wd = m.freq === 'weekly' ? `<label class="inline"><span class="hint">Día:</span><select data-act="med-weekday" data-id="${esc(m.id)}" aria-label="Día de la semana de ${esc(m.name)}">${M.WEEKDAYS.map((d, i) => `<option value="${i}" ${i === m.weekday ? 'selected' : ''}>${d}</option>`).join('')}</select></label>` : '';
      const take = m.active && (!r || r.kind !== 'done')
        ? `<button class="btn primary small" data-act="med-take" data-id="${esc(m.id)}" data-date="${t}">Marcar tomada</button>`
        : m.active ? `<button class="btn secondary small" data-act="med-untake" data-id="${esc(m.id)}" data-date="${t}">Deshacer</button>` : '';
      return `<div class="med"><div class="med-head"><div><div class="med-name">${esc(m.name)}</div><div class="med-sub">${medWhen(m)}</div></div>${status}</div>
        <div class="inline"><label class="switch"><input type="checkbox" role="switch" data-act="med-active" data-id="${esc(m.id)}" ${m.active ? 'checked' : ''}><span>La estoy tomando</span></label></div>
        <div class="inline">${wd}${take}</div></div>`;
    }).join('');
    return `<article class="card" id="card-meds"><h2>Medicación</h2>${rows || '<p class="empty">No hay medicación.</p>'}
      <div class="actions"><button class="btn secondary" data-act="add-med">Añadir medicación</button></div></article>`;
  }

  function cardFood() {
    const f = model.food.get(M.today());
    if (!f) return '';
    const g = model.goals;
    return `<article class="card" id="card-food"><h2>Comida de hoy <span class="tag">${esc(srcLabel(f.src))}</span></h2>
      <div class="stats"><div class="stat"><b>${fmtN(f.kcal)}${NB}kcal</b><span>${g.kcal ? `de unas ${fmtN(g.kcal)}` : 'energía'}</span></div>
      <div class="stat"><b>${fmtN(f.p)}${NB}g</b><span>proteína${g.prot ? ` · objetivo ${fmtN(g.prot)}${NB}g` : ''}</span></div></div></article>`;
  }

  function renderHoy() {
    const rem = medReminders();
    const banner = rem.length ? `<div class="wide banner" id="banner">${rem.map((x) => x.html).join('')}</div>` : '';
    const stale = M.storageOK() ? '' : '<div class="wide notice alert">Este navegador no deja guardar datos: lo que apuntes se perderá al cerrar.</div>';
    $('#panel-hoy').innerHTML = `<div class="cards">${stale}${banner}${cardBp()}${cardWeight()}${cardGlucose()}${cardMove()}${cardMeds()}${cardFood()}${hoySources()}</div>`;
  }
  function hoySources() {
    return `<p class="hint wide" style="padding:0 4px">Los datos salen de varias fuentes. <a href="#" data-act="go-mas" style="color:var(--accent-ink);font-weight:600">Ver de dónde sale cada dato</a></p>`;
  }

  /* ================= TENDENCIA ================= */
  const NS = 'http://www.w3.org/2000/svg';
  function niceRange(lo, hi, minSpan) {
    if (hi - lo < minSpan) { const mid = (hi + lo) / 2; lo = mid - minSpan / 2; hi = mid + minSpan / 2; }
    const span = hi - lo;
    const step = [1, 2, 5, 10, 20, 25, 50, 100].find((s) => span / s <= 4) || 100;
    const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
    const ticks = [];
    for (let v = a; v <= b + 1e-9; v += step) ticks.push(v);
    return { lo: a, hi: b, ticks };
  }
  /** Gráfica SVG. type: 'line' | 'bar'. series: [{name,color,vals[],cls}], refs: [{v,label}] */
  function chartSVG(o) {
    const W = 320, H = 176, L = 34, R = 12, T = 12, B = 26;
    const n = o.labels.length;
    const all = o.series.flatMap((s) => s.vals).filter((v) => v != null).concat((o.refs || []).map((r) => r.v));
    if (!o.series.flatMap((s) => s.vals).some((v) => v != null)) {
      return `<svg viewBox="0 0 ${W} 90" role="img" aria-label="${esc(o.title)}: sin datos"><text class="nodata" x="${W / 2}" y="48">Aún no hay datos en estas semanas</text></svg>`;
    }
    let lo = o.zero ? 0 : Math.min(...all), hi = Math.max(...all);
    if (o.max != null) hi = Math.max(hi, o.max);
    const R_ = niceRange(lo, hi, o.minSpan || 4);
    if (o.zero) R_.lo = 0;
    const X = (i) => L + ((W - L - R) * (i + 0.5)) / n;
    const Y = (v) => T + (H - T - B) * (1 - (v - R_.lo) / (R_.hi - R_.lo));
    let g = '';
    for (const tv of R_.ticks) g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(tv)}" y2="${Y(tv)}"/><text x="${L - 6}" y="${Y(tv) + 4}" text-anchor="end">${o.fmtTick ? o.fmtTick(tv) : tv}</text>`;
    o.labels.forEach((lb, i) => { g += `<text x="${X(i)}" y="${H - 8}" text-anchor="middle">${lb}</text>`; });
    for (const r of o.refs || []) {
      g += `<line class="tg" x1="${L}" x2="${W - R}" y1="${Y(r.v)}" y2="${Y(r.v)}"/>`;
    }
    const bw = Math.min(26, ((W - L - R) / n) * 0.55);
    for (const s of o.series) {
      if (o.type === 'bar') {
        s.vals.forEach((v, i) => {
          if (v == null) return;
          const y = Y(v), y0 = Y(R_.lo), h = Math.max(0, y0 - y), x = X(i) - bw / 2, r = Math.min(4, h, bw / 2);
          const d = h <= 0.5 ? '' : `M${x},${y0}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${y0}Z`;
          g += `<path d="${d}" fill="${s.color}"><title>${esc(o.labels[i])}: ${esc(o.fmtVal ? o.fmtVal(v) : v)}</title></path>`;
          if (n <= 8) g += `<text class="val" x="${X(i)}" y="${y - 4}" text-anchor="middle">${esc(o.fmtVal ? o.fmtVal(v) : v)}</text>`;
        });
      } else {
        let d = '', pen = false, lastI = -1;
        s.vals.forEach((v, i) => { if (v == null) { if (!o.connect) pen = false; return; } d += `${pen ? 'L' : 'M'}${X(i)},${Y(v)}`; pen = true; lastI = i; });
        g += `<path class="ln" d="${d}" stroke="${s.color}"/>`;
        s.vals.forEach((v, i) => { if (v != null) g += `<circle class="pt" cx="${X(i)}" cy="${Y(v)}" r="4" fill="${s.color}"><title>${esc(o.labels[i])}: ${esc(o.fmtVal ? o.fmtVal(v) : v)}</title></circle>`; });
        if (lastI >= 0) g += `<text class="val" x="${Math.min(X(lastI), W - R - 8)}" y="${Y(s.vals[lastI]) - 9}" text-anchor="middle">${esc(o.fmtVal ? o.fmtVal(s.vals[lastI]) : s.vals[lastI])}</text>`;
      }
    }
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title)}. ${esc(o.alt || '')}">${g}</svg>`;
  }
  function chartCard(o) {
    const legend = o.series.length > 1 || (o.refs && o.refs.length) ? `<ul class="legend">${o.series.map((s) => `<li><i class="sw" style="border-color:${s.color}"></i>${esc(s.name)}</li>`).join('')}${(o.refs || []).map((r) => `<li><i class="sw dash"></i>${esc(r.legend || r.label)}</li>`).join('')}</ul>` : '';
    const fv = o.fmtVal || ((v) => v);
    const table = `<details class="tbl"><summary>Ver los datos</summary><table><thead><tr><th>Semana</th>${o.series.map((s) => `<th>${esc(s.name)}</th>`).join('')}</tr></thead><tbody>${o.labels.map((l, i) => `<tr><td>desde ${l}</td>${o.series.map((s) => `<td>${s.vals[i] == null ? '—' : esc(fv(s.vals[i]))}</td>`).join('')}</tr>`).join('')}</tbody></table></details>`;
    return `<article class="card chart"><h2>${esc(o.title)}</h2><p class="chart-sentence">${o.sentence}</p>${chartSVG(o)}${legend}${table}</article>`;
  }

  function summaryText(weeks) {
    const t = M.today();
    const cur = weeks[weeks.length - 1], prev = weeks[weeks.length - 2];
    const parts = [];
    // Peso: la misma comparación que la tarjeta de Hoy (último peso frente al más cercano de ≥ 7 días antes)
    const w = model.weights;
    if (w.length) {
      const last = w[w.length - 1];
      const c = weightChange(7);
      if (c) {
        const sp = c.days <= 9 ? 'en la última semana' : `desde el ${M.shortDate(c.from)} (hace ${c.days} días)`;
        if (c.d <= -0.2) parts.push(`Vas bien: has bajado ${fmtN1(-c.d)}${NB}kg ${sp}.`);
        else if (c.d >= 0.2) parts.push(`Tu peso ha subido ${fmtN1(c.d)}${NB}kg ${sp}.`);
        else parts.push(`Tu peso casi no ha cambiado ${sp}.`);
      } else parts.push(`Tu último peso es ${fmtN1(last.kg)}${NB}kg. Aún no hay un dato de hace una semana para comparar; apúntalo cada semana.`);
    }
    // Tensión
    if (cur.bpN) {
      const here = `${fmtN(cur.sys)}/${fmtN(cur.dia)}`;
      let cmp = '';
      if (prev && prev.bpN) {
        const d = cur.sys - prev.sys;
        cmp = Math.abs(d) < 3 ? 'La tensión de esta semana es parecida a la anterior' : d > 0 ? 'La tensión de esta semana está algo más alta que la anterior' : 'La tensión de esta semana está algo más baja que la anterior';
      } else cmp = '';
      const goalTxt = cur.sys >= 130 || cur.dia >= 80 ? 'y sigue un poco por encima del objetivo (130/80)' : 'y está en objetivo (menos de 130/80)';
      parts.push(cmp ? `${cmp} (media ${here}) ${goalTxt}.` : `Esta semana tu tensión media es ${here} ${goalTxt}.`);
    } else if (prev && prev.bpN) {
      parts.push(`Esta semana aún no tienes lecturas de tensión. La semana pasada la media fue ${fmtN(prev.sys)}/${fmtN(prev.dia)}.`);
    } else parts.push('Apunta la tensión cada día antes de comer para ver cómo va.');
    // Movimiento
    parts.push(`Esta semana llevas ${fmtN(cur.walkMin)}${NB}minutos caminando (la meta son ${WALK_GOAL}) y ${cur.strength} ${cur.strength === 1 ? 'sesión' : 'sesiones'} de fuerza.`);
    // Glucosa
    if (M.D.settings.showGlucose) {
      const gw = cur.gFast != null ? cur : prev && prev.gFast != null ? prev : null;
      if (gw) parts.push(`La glucosa en ayunas o antes de comer ha estado de media en ${fmtN(gw.gFast)}${NB}mg/dL${gw.gFast >= 80 && gw.gFast <= 130 ? ', dentro de lo orientativo' : ', fuera de lo orientativo (80 a 130)'}.`);
    }
    // Medicación (si cabe)
    const adh = [...weeks].reverse().find((x) => x.adh);
    if (adh && parts.length < 5) parts.push(`Medicación: has marcado ${adh.adh.got} de ${adh.adh.exp} tomas previstas${adh.current ? ' esta semana' : ' en la última semana con datos'}.`);
    return parts.slice(0, 5);
  }

  function renderTendencia() {
    const weeks = M.weekly(model, weeksRange);
    const labels = weeks.map((w) => w.label);
    const sum = summaryText(weeks);
    const pctVal = (v) => Math.round(v * 100) + '%';
    const lastWith = (k) => { for (let i = weeks.length - 1; i >= 0; i--) if (weeks[i][k] != null) return weeks[i]; return null; };
    const charts = [];
    const bw = lastWith('sys');
    charts.push(chartCard({
      title: 'Tensión media de cada semana', labels, type: 'line', minSpan: 20,
      sentence: bw ? `Última semana con lecturas: media de ${fmtN(bw.sys)}/${fmtN(bw.dia)}${NB}mmHg.` : 'Aún no hay lecturas en estas semanas.',
      alt: bw ? `Última media ${fmtN(bw.sys)} sobre ${fmtN(bw.dia)}.` : '',
      series: [{ name: 'Alta', color: 'var(--sys)', vals: weeks.map((w) => (w.sys == null ? null : Math.round(w.sys))) }, { name: 'Baja', color: 'var(--dia)', vals: weeks.map((w) => (w.dia == null ? null : Math.round(w.dia))) }],
      refs: [{ v: 130, label: '130', legend: 'Objetivo de la alta (130)' }, { v: 80, label: '80', legend: 'Objetivo de la baja (80)' }]
    }));
    const ok = lastWith('okPct');
    charts.push(chartCard({
      title: 'Lecturas en objetivo', labels, type: 'bar', zero: true, max: 100, minSpan: 100, fmtVal: (v) => Math.round(v) + '%', fmtTick: (v) => v + '%',
      sentence: ok ? `En la última semana con lecturas, ${pctVal(ok.okPct)} estaban en objetivo.` : 'Aún no hay lecturas en estas semanas.',
      alt: ok ? pctVal(ok.okPct) + ' en objetivo.' : '',
      series: [{ name: '% de lecturas en objetivo', color: 'var(--s2)', vals: weeks.map((w) => (w.okPct == null ? null : w.okPct * 100)) }]
    }));
    const kw = lastWith('kg');
    const firstKg = weeks.find((w) => w.kg != null);
    charts.push(chartCard({
      title: 'Peso', labels, type: 'line', connect: true, minSpan: 2, fmtVal: (v) => fmtN1(v),
      sentence: kw ? (firstKg && firstKg !== kw ? `Último peso de cada semana: de ${fmtN1(firstKg.kg)}${NB}kg (semana del ${firstKg.label}) a ${fmtN1(kw.kg)}${NB}kg (semana del ${kw.label}).` : `Último peso: ${fmtN1(kw.kg)}${NB}kg. La meta son ${fmtN(GOAL())}${NB}kg.`) : 'Aún no hay pesos en estas semanas.',
      alt: kw ? `Último peso ${fmtN1(kw.kg)} kilos.` : '',
      series: [{ name: 'Peso (kg), último de la semana', color: 'var(--s1)', vals: weeks.map((w) => w.kg) }]
    }));
    if (M.D.settings.showGlucose) {
      const gw = lastWith('gFast');
      charts.push(chartCard({
        title: 'Glucosa media', labels, type: 'line', connect: true, minSpan: 40, fmtVal: (v) => fmtN(v),
        sentence: gw ? `Antes de comer o en ayunas: ${fmtN(gw.gFast)}${NB}mg/dL de media (orientativo: 80 a 130).` : 'Aún no hay glucosa apuntada en estas semanas.',
        alt: gw ? `Media ${fmtN(gw.gFast)}.` : '',
        series: [{ name: 'En ayunas o antes de comer', color: 'var(--s2)', vals: weeks.map((w) => w.gFast) }, { name: 'Después de comer', color: 'var(--s3)', vals: weeks.map((w) => w.gAfter) }],
        refs: [{ v: 130, label: '130', legend: 'Límite orientativo antes de comer (130)' }]
      }));
    }
    const wlast = weeks[weeks.length - 1];
    charts.push(chartCard({
      title: 'Minutos caminados', labels, type: 'bar', zero: true, max: WALK_GOAL, minSpan: 30, fmtVal: (v) => fmtN(v),
      sentence: `Esta semana: ${fmtN(wlast.walkMin)} de ${WALK_GOAL}${NB}minutos.`, alt: `Esta semana ${fmtN(wlast.walkMin)} minutos.`,
      series: [{ name: 'Minutos por semana', color: 'var(--s1)', vals: weeks.map((w) => w.walkMin) }],
      refs: [{ v: WALK_GOAL, label: '150', legend: 'Meta (150 min)' }]
    }));
    charts.push(chartCard({
      title: 'Sesiones de fuerza', labels, type: 'bar', zero: true, max: 3, minSpan: 3, fmtVal: (v) => String(v), fmtTick: (v) => String(v),
      sentence: `Esta semana: ${wlast.strength} de 2–3 sesiones.`, alt: `Esta semana ${wlast.strength} sesiones.`,
      series: [{ name: 'Sesiones por semana', color: 'var(--s3)', vals: weeks.map((w) => w.strength) }],
      refs: [{ v: 2, label: '2', legend: 'Mínimo recomendado (2)' }]
    }));
    if (weeks.some((w) => w.adh)) {
      const aw = [...weeks].reverse().find((w) => w.adh);
      charts.push(chartCard({
        title: 'Cumplimiento de la medicación', labels, type: 'bar', zero: true, max: 100, minSpan: 100, fmtVal: (v) => Math.round(v) + '%', fmtTick: (v) => v + '%',
        sentence: `${aw.adh.got} de ${aw.adh.exp} tomas marcadas en la última semana con datos.`, alt: pctVal(aw.adh.pct),
        series: [{ name: '% de tomas marcadas', color: 'var(--s2)', vals: weeks.map((w) => (w.adh ? w.adh.pct * 100 : null)) }]
      }));
    }
    $('#panel-tendencia').innerHTML = `
      <div class="seg" role="group" aria-label="Periodo"><button data-act="range" data-n="4" aria-pressed="${weeksRange === 4}">4 semanas</button><button data-act="range" data-n="8" aria-pressed="${weeksRange === 8}">8 semanas</button></div>
      <div class="cards two"><article class="card summary wide"><h2>En resumen</h2>${sum.map((s) => `<p>${s}</p>`).join('')}<p class="hint">Es orientativo: no es un diagnóstico.</p></article>${charts.join('')}</div>`;
  }

  /* ================= HISTORIAL ================= */
  function renderHistorial() {
    const days = new Map();
    const add = (date, o) => { if (!days.has(date)) days.set(date, []); days.get(date).push(o); };
    const act = (src, manualId, edit, del) => (manualId ? `<div class="row-act"><button data-act="${edit}" data-id="${esc(manualId)}">Editar</button><button class="del" data-act="${del}" data-id="${esc(manualId)}">Borrar</button></div>` : '');
    for (const r of model.bp) {
      const c = M.classify(r.sys, r.dia);
      add(r.date, { t: r.time, html: `<div class="item"><div class="item-top"><span class="item-what">Tensión · ${r.time}</span><span class="pill ${c.cls}"><i></i>${c.label}</span></div>
        <div class="item-val">${r.sys}/${r.dia} <small>mmHg · pulso ${r.pulse == null ? '—' : r.pulse}</small></div>${r.note ? `<div class="item-src">${esc(r.note)}</div>` : ''}<div class="item-src">${esc(srcLabel(r.src))}</div>${act(r.src, r.manualId, 'edit-bp', 'del-bp')}</div>` });
    }
    for (const w of model.weights) add(w.date, { t: '00:00', html: `<div class="item"><div class="item-top"><span class="item-what">Peso</span></div><div class="item-val">${fmtN1(w.kg)} <small>kg</small></div><div class="item-src">${esc(srcLabel(w.src))}</div>${act(w.src, w.manualId, 'edit-weight', 'del-weight')}</div>` });
    for (const c of model.waists) add(c.date, { t: '00:00', html: `<div class="item"><div class="item-top"><span class="item-what">Cintura</span></div><div class="item-val">${fmtN1(c.cm)} <small>cm</small></div><div class="item-src">${esc(srcLabel(c.src))}</div>${act(c.src, c.manualId, 'edit-waist', 'del-waist')}</div>` });
    for (const g of model.glucose) {
      const gi = M.glucoseInfo(g.kind, g.mgdl);
      add(g.date, { t: g.time || '00:00', html: `<div class="item"><div class="item-top"><span class="item-what">Glucosa · ${esc(M.GLUCOSE_KINDS[g.kind].toLowerCase())}${g.time ? ' · ' + g.time : ''}</span><span class="pill ${gi.cls}"><i></i>${gi.label}</span></div><div class="item-val">${g.mgdl} <small>mg/dL</small></div><div class="item-src">${esc(srcLabel(g.src))}</div>${act(g.src, g.manualId, 'edit-glucose', 'del-glucose')}</div>` });
    }
    for (const a of model.activity) {
      if (!(a.walkMin > 0 || a.strength)) continue;
      add(a.date, { t: '00:00', html: `<div class="item"><div class="item-top"><span class="item-what">Movimiento</span></div><div class="item-val">${a.walkMin > 0 ? `${fmtN(a.walkMin)} <small>min caminando${a.walkKm ? ` · ${fmtN(a.walkKm, 2)} km` : ''}</small>` : '<small>Sin caminata</small>'}${a.strength ? ' <small>· fuerza</small>' : ''}</div><div class="item-src">${a.srcs.map(srcLabel).join(' + ')}</div>${act('manual', a.manualId, 'edit-move', 'del-move')}</div>` });
    }
    for (const l of M.D.medLog) {
      const m = M.D.meds.find((x) => x.id === l.medId);
      add(l.date, { t: '00:00', html: `<div class="item"><div class="item-top"><span class="item-what">Medicación</span></div><div class="item-val"><small>${esc(m ? m.name : 'Medicación borrada')} · tomada</small></div><div class="item-src">Apuntado aquí</div><div class="row-act"><button class="del" data-act="med-untake" data-id="${esc(l.medId)}" data-date="${l.date}">Quitar</button></div></div>` });
    }
    const dates = [...days.keys()].sort().reverse();
    const shown = dates.slice(0, histDays);
    const html = shown.map((d) => {
      const items = days.get(d).sort((a, b) => (a.t < b.t ? -1 : 1));
      return `<section class="day"><h2>${esc(M.longDate(d))}${d === M.today() ? ' · hoy' : ''}</h2><div class="card">${items.map((i) => i.html).join('')}</div></section>`;
    }).join('');
    $('#panel-historial').innerHTML = dates.length
      ? `<div class="days">${html}</div>${dates.length > histDays ? '<div class="actions"><button class="btn secondary" data-act="more-hist">Ver días anteriores</button></div>' : ''}`
      : '<p class="empty">Aún no hay nada apuntado.</p>';
  }

  /* ================= MÁS ================= */
  const fmtAt = (iso) => { const p = M.nowInputs(new Date(iso)); return `${M.longDate(p.date)} a las ${p.time}`; };
  function sourcesCard() {
    const s = model.sources;
    const rows = [];
    const seedUsed = s.tension.live == null && !s.tension.imp && s.tension.api == null;
    rows.push(['Mi tensión', s.tension.api != null ? `Leída del Mac de casa (${s.tension.api} lecturas).` : '', s.tension.live != null ? `Leída directamente de este navegador (${s.tension.live} lecturas).` : '', s.tension.imp ? `Importada el ${fmtAt(s.tension.imp.at)} (${s.tension.imp.n} lecturas).` : '', seedUsed ? 'Precargadas: 8 lecturas del 18 al 25 de noviembre.' : '']);
    const e = s.entrenador;
    rows.push(['Mi entrenador (peso, caminatas, fuerza, glucosa)', e.live ? `Leído directamente de este navegador (${e.live.logs} días, ${e.live.weights} pesos).` : '', e.imp ? `Importado el ${fmtAt(e.imp.at)}.` : '', !e.live && !e.imp ? 'Precargado: registros y pesos de noviembre.' : '']);
    rows.push(['Mi menú (objetivos de comida)', s.menu.live ? 'Leído directamente de este navegador.' : '', s.menu.imp ? `Importado el ${fmtAt(s.menu.imp.at)}.` : '', !s.menu.live && !s.menu.imp ? 'Sin datos.' : '']);
    rows.push(['Mi plato (comidas)', s.plato.live ? 'Leído directamente de este navegador.' : '', s.plato.imp ? `Importado el ${fmtAt(s.plato.imp.at)} (${s.plato.imp.n} comidas).` : '', !s.plato.live && !s.plato.imp ? 'Sin datos.' : '']);
    const m = s.manual;
    rows.push(['Apuntado aquí', `${m.bp} tensiones, ${m.weights} pesos, ${m.waists} cinturas, ${m.glucose} glucosas, ${m.activity} días de movimiento.`, 'Cintura del 26/11 precargada (104,6 cm).', '']);
    const standalone = (window.navigator.standalone === true) || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
    const noLive = s.tension.live == null && !s.entrenador.live;
    return `<article class="card" id="card-sources"><h2>Fuentes</h2>
      ${rows.map(([n, a, b, c]) => `<div class="src-row"><b>${n}</b>${[a, b, c].filter(Boolean).map((x) => `<span>${x}</span>`).join('')}</div>`).join('')}
      ${standalone && noLive ? '<div class="notice soft" style="margin-top:10px">Has abierto Mi salud desde la pantalla de inicio: aquí no se ven los datos de las otras apps. Impórtalos con «Traer datos de otras apps».</div>' : ''}
      <p class="hint" style="margin-top:10px">¿Por qué hay que importar en el iPhone? Cuando añades una app a la pantalla de inicio, el iPhone le da su propio espacio y no comparte datos con Safari ni con las demás apps. Por eso, desde cada app exporta su copia y tráela aquí. Si lo abres todo en Safari o en un ordenador, los datos se leen solos.</p></article>`;
  }

  function medsCard() {
    const meds = M.D.meds;
    return `<article class="card"><h2>Mi medicación</h2>
      ${meds.map((m) => `<div class="med"><div class="med-head"><div><div class="med-name">${esc(m.name)}</div><div class="med-sub">${medWhen(m)}</div></div>${m.active ? '<span class="badge ok">Activa</span>' : '<span class="badge">En pausa</span>'}</div>
        <div class="row-act"><button data-act="edit-med" data-id="${esc(m.id)}">Cambiar</button></div></div>`).join('') || '<p class="empty">No hay medicación.</p>'}
      <div class="actions"><button class="btn secondary" data-act="add-med">Añadir medicación</button></div>
      <p class="hint">Los avisos aparecen dentro de la app, en Hoy. No usamos notificaciones del móvil.</p></article>`;
  }

  function renderMas() {
    const st = M.D.settings;
    const lastExp = M.D.lastExport ? `Última copia: ${fmtAt(M.D.lastExport)}.` : 'Aún no has hecho ninguna copia.';
    const res = lastImport ? `<ul class="results">${lastImport.map((r) => `<li class="${r.ok ? 'good' : 'bad'}">${esc(r.name)}: ${esc(r.text)}</li>`).join('')}</ul>` : '';
    $('#panel-mas').innerHTML = `<div class="cards two">
      <article class="card"><h2>Ajustes</h2>
        <label class="switch"><input type="checkbox" role="switch" data-act="set-glucose" ${st.showGlucose ? 'checked' : ''}><span>Mostrar la glucosa</span></label>
        <div class="row2"><label class="field"><span>Meta de peso (kg)</span><input type="text" inputmode="decimal" data-act="set-goal" value="${fmtN1(st.goalKg).replace(',0', '')}" autocomplete="off"></label>
        <label class="field"><span>Altura (cm)</span><input type="text" inputmode="numeric" data-act="set-height" value="${st.heightCm}" autocomplete="off"></label></div></article>
      ${medsCard()}
      <article class="card"><h2>Traer datos de otras apps</h2>
        <p class="plain">Elige los ficheros que exportan Mi tensión, Mi entrenador, Mi menú o Mi plato. Puedes elegir varios a la vez. Si ya habías importado, se actualiza sin duplicar.</p>
        <div class="actions"><button class="btn primary" data-act="import-others">Elegir ficheros</button></div>${res}</article>
      ${sourcesCard()}
      <article class="card"><h2>Copia de seguridad</h2>
        <p class="plain">Tus datos están solo en este dispositivo. Haz una copia de vez en cuando. ${lastExp}</p>
        <div class="actions"><button class="btn primary" data-act="export">Exportar copia</button><button class="btn secondary" data-act="import-own">Importar copia</button></div>
        <div class="actions"><button class="btn danger-link" data-act="wipe">Borrar lo que he apuntado</button></div></article>
      <article class="card"><h2>Más apps</h2>${LINKS.map(([n, d, u]) => `<a class="link-row" href="${u}" target="_blank" rel="noopener"><span><b>${n}</b><small>${d}</small></span><i aria-hidden="true">›</i></a>`).join('')}</article>
      <article class="card"><h2>Privacidad</h2><p>Mi salud no usa servidor, cuentas ni analítica, y no carga nada de internet. Lo que apuntas se guarda solo en este dispositivo. Los datos precargados (tensión, peso y registros de noviembre) forman parte del código público de la app. De las otras apps solo se lee; nunca se escribe en ellas.</p></article>
      <article class="card wide"><h2>Aviso médico</h2><div class="notice"><p>Mi salud es orientativa y no sustituye a tu médico ni a tu endocrino. No diagnostica nada. Si tienes dudas sobre tu tensión, tu glucosa o tu medicación (también Ozempic: si dejaste de tomarlo, no lo retomes sin hablar con tu médico), consúltalas con él. Si notas mareo, dolor en el pecho o malestar fuerte, llama a tu médico o al 112.</p></div></article></div>`;
  }


  /* ================= Reparto en columnas (masonry) =================
   * En el interior del Duo (y donde quepan 2–3 columnas) cada tarjeta va a la columna más corta, en orden lógico
   * (Tensión, Peso, Glucosa, Movimiento…), así no quedan huecos bajo las tarjetas cortas. Las tarjetas «wide»
   * (avisos, resumen) ocupan todo el ancho. Con una sola columna no se toca nada. Se rehace al girar o plegar. */
  const MQ_WIDE = window.matchMedia('(min-width: 600px)');
  const MQ_INTERIOR = window.matchMedia('(min-width: 600px) and (min-height: 560px)');
  function colsFor(el) {
    const gap = parseFloat(getComputedStyle(el).columnGap) || 14;
    if (el.classList.contains('two')) return MQ_WIDE.matches ? 2 : 1;
    if (!MQ_INTERIOR.matches) return 1;
    const min = el.classList.contains('days') ? 280 : 260;
    return Math.max(1, Math.min(3, Math.floor((el.clientWidth + gap) / (min + gap))));
  }
  function layoutContainer(el) {
    // 1) deshacer: devolver las tarjetas a su sitio original, en su orden
    if (!el.dataset.o) {
      let i = 0;
      for (const c of Array.from(el.children)) if (!c.classList.contains('wide')) c.dataset.o = String(i++);
      el.dataset.o = '1';
    }
    for (const m of Array.from(el.querySelectorAll(':scope > .mason'))) {
      const cards = Array.from(m.querySelectorAll('.mcol > [data-o]')).sort((a, b) => a.dataset.o - b.dataset.o);
      for (const c of cards) el.insertBefore(c, m);
      m.parentNode.removeChild(m);
    }
    const cols = colsFor(el);
    el.dataset.cols = String(cols);
    if (cols < 2) return;
    // 2) agrupar tramos consecutivos de tarjetas normales y repartirlos
    const kids = Array.from(el.children);
    for (let i = 0; i < kids.length; i++) {
      if (kids[i].classList.contains('wide')) continue;
      const run = [];
      let j = i;
      while (j < kids.length && !kids[j].classList.contains('wide')) run.push(kids[j++]);
      const m = document.createElement('div');
      m.className = 'mason';
      const cs = [];
      for (let k = 0; k < cols; k++) { const c = document.createElement('div'); c.className = 'mcol'; m.appendChild(c); cs.push(c); }
      el.insertBefore(m, run[0]);
      for (const card of run) {
        let best = cs[0];
        for (const c of cs) if (c.offsetHeight < best.offsetHeight - 1) best = c;
        best.appendChild(card);
      }
      i = j - 1;
    }
  }
  function layoutMasonry() {
    const panel = $('#panel-' + tab);
    if (panel) $$('.cards, .days', panel).forEach(layoutContainer);
  }
  let lastLayoutKey = '';
  function relayout(force) {
    const panel = $('#panel-' + tab);
    if (!panel) return;
    const key = [tab, MQ_WIDE.matches, MQ_INTERIOR.matches, Math.round(panel.clientWidth)].join('|');
    if (!force && key === lastLayoutKey) return;
    lastLayoutKey = key;
    layoutMasonry();
  }
  let rl = 0;
  const scheduleRelayout = () => { cancelAnimationFrame(rl); rl = requestAnimationFrame(() => relayout(false)); };
  window.addEventListener('resize', scheduleRelayout);
  window.addEventListener('orientationchange', scheduleRelayout);
  if (window.ResizeObserver) new ResizeObserver(scheduleRelayout).observe($('main'));

  /* ================= Render ================= */
  function renderTab() {
    if (tab === 'hoy') renderHoy();
    else if (tab === 'tendencia') renderTendencia();
    else if (tab === 'historial') renderHistorial();
    else renderMas();
    relayout(true);
  }
  function renderAll() { renderHeader(); renderTab(); }

  /* ================= Diálogos de entrada ================= */
  function openDlg(id, title) { const d = $(id); $('[data-title]', d).textContent = title; return d; }
  function showErrs(form, errs) {
    const msgs = Object.values(errs);
    $('.errors', form).innerHTML = msgs.map((m) => `<span>${esc(m)}</span>`).join('');
    $$('input,select', form).forEach((el) => el.setAttribute('aria-invalid', errs[el.name] ? 'true' : 'false'));
    if (msgs.length) { const f = Object.keys(errs)[0]; if (form.elements[f] && form.elements[f].focus) form.elements[f].focus(); }
    return msgs.length > 0;
  }
  function wireDialog(id, onSubmit) {
    const d = $(id), form = $('form', d);
    $('[data-cancel]', d).addEventListener('click', () => d.close());
    form.addEventListener('input', (e) => { if (e.target.getAttribute && e.target.getAttribute('aria-invalid') === 'true') e.target.setAttribute('aria-invalid', 'false'); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (onSubmit(form, d) !== false) { d.close(); }
    });
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  }
  const nowIn = () => M.nowParts();
  let editing = null;

  // --- Tensión
  function openBp(id) {
    const d = openDlg('#dlg-bp', id ? 'Cambiar tensión' : 'Apuntar tensión'); const f = $('form', d);
    editing = id || null;
    const r = id && M.D.bp.find((x) => x.id === id);
    const n = nowIn();
    f.elements.sys.value = r ? r.systolic : ''; f.elements.dia.value = r ? r.diastolic : ''; f.elements.pul.value = r && r.pulse != null ? r.pulse : '';
    f.elements.date.value = r ? M.dateOfISO(r.datetime) : n.date; f.elements.time.value = r ? M.nowInputs(new Date(r.datetime)).time : n.time;
    f.elements.note.value = r ? r.note : '';
    showErrs(f, {}); d.showModal();
  }
  wireDialog('#dlg-bp', (f) => {
    const int = (s) => (/^\d{1,3}$/.test(String(s).trim()) ? parseInt(s, 10) : NaN);
    const sys = int(f.elements.sys.value), dia = int(f.elements.dia.value), pul = int(f.elements.pul.value);
    const e = {};
    if (isNaN(sys)) e.sys = 'Escribe la presión alta, solo números.'; else if (!M.inRange(sys, 70, 250)) e.sys = 'La alta debe estar entre 70 y 250.';
    if (isNaN(dia)) e.dia = 'Escribe la presión baja, solo números.'; else if (!M.inRange(dia, 40, 150)) e.dia = 'La baja debe estar entre 40 y 150.';
    if (!e.sys && !e.dia && sys <= dia) e.dia = 'La alta debe ser mayor que la baja.';
    if (isNaN(pul)) e.pul = 'Escribe el pulso, solo números.'; else if (!M.inRange(pul, 30, 200)) e.pul = 'El pulso debe estar entre 30 y 200.';
    if (!M.isDate(f.elements.date.value)) e.date = 'Indica una fecha válida.';
    if (!/^\d{2}:\d{2}$/.test(f.elements.time.value)) e.time = 'Indica una hora válida.';
    if (showErrs(f, e)) return false;
    const rec = { id: editing || M.newId(), datetime: M.toISO(f.elements.date.value, f.elements.time.value), systolic: sys, diastolic: dia, pulse: pul, note: f.elements.note.value.trim() };
    const L = M.D.bp; const i = L.findIndex((x) => x.id === rec.id);
    if (i >= 0) L[i] = rec; else L.push(rec);
    persist(); afterChange(); toast('Tensión guardada');
  });

  // --- Peso / cintura
  function openWeight(id, mode) {
    const d = openDlg('#dlg-weight', id ? (mode === 'waist' ? 'Cambiar cintura' : 'Cambiar peso') : 'Apuntar peso o cintura'); const f = $('form', d);
    editing = id ? { id, mode } : { id: null, mode: 'both' };
    const w = id && mode === 'weight' && M.D.weights.find((x) => x.id === id);
    const c = id && mode === 'waist' && M.D.waists.find((x) => x.id === id);
    $('[data-f=kg]', d).hidden = mode === 'waist'; $('[data-f=cm]', d).hidden = mode === 'weight';
    f.elements.kg.value = w ? fmtN1(w.kg) : ''; f.elements.cm.value = c ? fmtN1(c.cm) : '';
    f.elements.date.value = w ? w.date : c ? c.date : nowIn().date;
    showErrs(f, {}); d.showModal();
  }
  wireDialog('#dlg-weight', (f) => {
    const e = {}; const mode = editing.mode;
    const kgS = f.elements.kg.value.trim(), cmS = f.elements.cm.value.trim();
    const kg = M.parseNum(kgS), cm = M.parseNum(cmS);
    if (mode !== 'waist' && (kgS || mode === 'weight')) { if (isNaN(kg)) e.kg = 'Escribe el peso, por ejemplo 93,4.'; else if (!M.inRange(kg, 30, 300)) e.kg = 'El peso debe estar entre 30 y 300 kg.'; }
    if (mode !== 'weight' && (cmS || mode === 'waist')) { if (isNaN(cm)) e.cm = 'Escribe la cintura, por ejemplo 104,6.'; else if (!M.inRange(cm, 40, 250)) e.cm = 'La cintura debe estar entre 40 y 250 cm.'; }
    if (mode === 'both' && !kgS && !cmS) e.kg = 'Escribe el peso o la cintura.';
    if (!M.isDate(f.elements.date.value)) e.date = 'Indica una fecha válida.';
    if (showErrs(f, e)) return false;
    const date = f.elements.date.value;
    const upsert = (key, rec, editId) => { M.D[key] = M.D[key].filter((x) => x.id !== editId && x.date !== rec.date); M.D[key].push(rec); };
    if (mode !== 'waist' && !isNaN(kg) && kgS) upsert('weights', { id: mode === 'weight' ? editing.id : M.newId(), date, kg }, editing.id);
    if (mode !== 'weight' && !isNaN(cm) && cmS) upsert('waists', { id: mode === 'waist' ? editing.id : M.newId(), date, cm }, editing.id);
    persist(); afterChange(); toast('Guardado');
  });

  // --- Glucosa
  function openGlucose(id) {
    const d = openDlg('#dlg-glucose', id ? 'Cambiar glucosa' : 'Apuntar glucosa'); const f = $('form', d);
    editing = id || null;
    const g = id && M.D.glucose.find((x) => x.id === id); const n = nowIn();
    const kind = g ? g.kind : (n.hour < 11 ? 'ayunas' : n.hour < 14 ? 'antes' : 'despues');
    $$('input[name=kind]', f).forEach((r) => { r.checked = r.value === kind; });
    f.elements.mgdl.value = g ? g.mgdl : '';
    f.elements.date.value = g ? g.date : n.date; f.elements.time.value = g ? g.time : n.time;
    showErrs(f, {}); d.showModal();
  }
  wireDialog('#dlg-glucose', (f) => {
    const e = {};
    const kind = (f.querySelector('input[name=kind]:checked') || {}).value;
    const mg = /^\d{2,3}$/.test(f.elements.mgdl.value.trim()) ? parseInt(f.elements.mgdl.value, 10) : NaN;
    if (!kind) e.kind = 'Elige cuándo te la has medido.';
    if (isNaN(mg)) e.mgdl = 'Escribe la glucosa, solo números.'; else if (!M.inRange(mg, 20, 600)) e.mgdl = 'La glucosa debe estar entre 20 y 600.';
    if (!M.isDate(f.elements.date.value)) e.date = 'Indica una fecha válida.';
    if (showErrs(f, e)) return false;
    const rec = { id: editing || M.newId(), date: f.elements.date.value, time: /^\d{2}:\d{2}$/.test(f.elements.time.value) ? f.elements.time.value : '', kind, mgdl: mg };
    const L = M.D.glucose; const i = L.findIndex((x) => x.id === rec.id);
    if (i >= 0) L[i] = rec; else L.push(rec);
    persist(); afterChange();
    const gi = M.glucoseInfo(kind, mg);
    toast(mg < 70 || mg > 250 ? gi.text : 'Glucosa guardada', mg < 70 || mg > 250);
  });

  // --- Movimiento
  function openMove(id) {
    const d = openDlg('#dlg-move', id ? 'Cambiar movimiento' : 'Apuntar movimiento'); const f = $('form', d);
    editing = id || null;
    const a = id && M.D.activity.find((x) => x.id === id);
    const t = M.today();
    const ex = !a && model.activity.find((x) => x.date === t && x.manualId);
    const src = a || (ex && M.D.activity.find((x) => x.id === ex.manualId));
    if (src && !a) editing = src.id;
    f.elements.min.value = src ? src.walkMin : ''; f.elements.km.value = src && src.walkKm ? fmtN(src.walkKm, 2).replace(/,?0+$/, '') : '';
    f.elements.strength.checked = !!(src && src.strength);
    f.elements.date.value = src ? src.date : nowIn().date;
    showErrs(f, {}); d.showModal();
  }
  wireDialog('#dlg-move', (f) => {
    const e = {};
    const minS = f.elements.min.value.trim(), kmS = f.elements.km.value.trim();
    const min = minS === '' ? 0 : /^\d{1,4}$/.test(minS) ? parseInt(minS, 10) : NaN;
    const km = kmS === '' ? null : M.parseNum(kmS);
    if (isNaN(min) || min > 1000) e.min = 'Escribe los minutos, solo números.';
    if (km !== null && !M.inRange(km, 0, 200)) e.km = 'Escribe los km, por ejemplo 3,5.';
    if (!M.isDate(f.elements.date.value)) e.date = 'Indica una fecha válida.';
    if (!e.min && !min && !f.elements.strength.checked) e.min = 'Escribe los minutos o marca la fuerza.';
    if (showErrs(f, e)) return false;
    const date = f.elements.date.value;
    const L = M.D.activity;
    let i = L.findIndex((x) => x.id === editing);
    if (i < 0) i = L.findIndex((x) => x.date === date);
    const rec = { id: i >= 0 ? L[i].id : M.newId(), date, walkMin: min, walkKm: km, strength: f.elements.strength.checked };
    if (i >= 0) L[i] = rec; else L.push(rec);
    // Una sola entrada manual por día
    const seen = new Set(); M.D.activity = L.filter((x) => (seen.has(x.date) ? false : (seen.add(x.date), true)));
    persist(); afterChange(); toast('Movimiento guardado');
  });

  // --- Medicación
  const medForm = () => $('#form-med');
  (function initMedForm() {
    const f = medForm();
    f.elements.weekday.innerHTML = M.WEEKDAYS.map((d, i) => `<option value="${i}">${d}</option>`).join('');
    const sync = () => { $('[data-f=weekday]', f).hidden = f.elements.freq.value !== 'weekly'; };
    f.elements.freq.addEventListener('change', sync); f.sync = sync;
  })();
  function openMed(id) {
    const d = openDlg('#dlg-med', id ? 'Cambiar medicación' : 'Añadir medicación'); const f = medForm();
    editing = id || null;
    const m = id && M.D.meds.find((x) => x.id === id);
    f.elements.name.value = m ? m.name : ''; f.elements.dose.value = m ? m.dose : '';
    f.elements.freq.value = m ? m.freq : 'daily'; f.elements.weekday.value = m ? m.weekday : String(M.weekdayOf(M.today()));
    f.elements.time.value = m ? m.time : ''; f.elements.active.checked = m ? m.active : true;
    f.sync(); $('[data-delete]', f).hidden = !m;
    showErrs(f, {}); d.showModal();
  }
  wireDialog('#dlg-med', (f) => {
    const e = {};
    const name = f.elements.name.value.trim();
    if (!name) e.name = 'Escribe el nombre.';
    if (showErrs(f, e)) return false;
    let m = editing && M.D.meds.find((x) => x.id === editing);
    if (!m) { m = { id: M.newId(), since: null, pausedAt: null, active: false }; M.D.meds.push(m); }
    m.name = name.slice(0, 80); m.dose = f.elements.dose.value.trim().slice(0, 60); m.freq = f.elements.freq.value;
    m.weekday = parseInt(f.elements.weekday.value, 10) || 0; m.time = f.elements.time.value;
    if (f.elements.active.checked !== m.active) M.setMedActive(m, f.elements.active.checked);
    persist(); afterChange(); toast('Medicación guardada');
  });
  $('#form-med [data-delete]').addEventListener('click', async () => {
    const m = M.D.meds.find((x) => x.id === editing); if (!m) return;
    $('#dlg-med').close();
    if (await confirmDlg('¿Borrar esta medicación?', `<p>Se borrará «${esc(m.name)}» y sus tomas marcadas.</p>`, 'Borrar', true)) {
      M.D.meds = M.D.meds.filter((x) => x.id !== m.id); M.D.medLog = M.D.medLog.filter((l) => l.medId !== m.id);
      persist(); afterChange(); toast('Medicación borrada');
    }
  });

  /* ================= Acciones (delegación de eventos) ================= */
  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  const readFile = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsText(f); });

  async function delConfirm(what, fn) {
    if (await confirmDlg(`¿Borrar ${what}?`, '<p>No se puede deshacer.</p>', 'Borrar', true)) { fn(); persist(); afterChange(); toast('Borrado'); }
  }

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
    const a = b.dataset.act, id = b.dataset.id;
    switch (a) {
      case 'add-bp': openBp(); break;
      case 'add-weight': openWeight(null, 'both'); break;
      case 'add-glucose': openGlucose(); break;
      case 'add-move': openMove(); break;
      case 'add-med': openMed(); break;
      case 'edit-bp': openBp(id); break;
      case 'edit-weight': openWeight(id, 'weight'); break;
      case 'edit-waist': openWeight(id, 'waist'); break;
      case 'edit-glucose': openGlucose(id); break;
      case 'edit-move': openMove(id); break;
      case 'edit-med': openMed(id); break;
      case 'del-bp': delConfirm('esta tensión', () => { M.D.bp = M.D.bp.filter((x) => x.id !== id); }); break;
      case 'del-weight': delConfirm('este peso', () => { M.D.weights = M.D.weights.filter((x) => x.id !== id); }); break;
      case 'del-waist': delConfirm('esta cintura', () => { M.D.waists = M.D.waists.filter((x) => x.id !== id); }); break;
      case 'del-glucose': delConfirm('esta glucosa', () => { M.D.glucose = M.D.glucose.filter((x) => x.id !== id); }); break;
      case 'del-move': delConfirm('este movimiento', () => { M.D.activity = M.D.activity.filter((x) => x.id !== id); }); break;
      case 'med-take': M.setTaken(id, b.dataset.date, true); afterChange(); toast('Marcada como tomada'); break;
      case 'med-untake': M.setTaken(id, b.dataset.date, false); afterChange(); break;
      case 'range': weeksRange = parseInt(b.dataset.n, 10); renderTendencia(); relayout(true); break;
      case 'more-hist': histDays += 30; renderHistorial(); relayout(true); break;
      case 'go-mas': e.preventDefault(); showTab('mas'); setTimeout(() => { const c = $('#card-sources'); if (c) c.scrollIntoView(); }, 50); break;
      case 'import-others': $('#file-others').click(); break;
      case 'import-own': $('#file-own').click(); break;
      case 'export': {
        const p = M.exportPayload();
        const n = M.nowParts().date;
        download(`mi-salud-${n}.json`, JSON.stringify(p, null, 2)); toast('Copia exportada'); renderMas(); relayout(true); break;
      }
      case 'wipe':
        if (await confirmDlg('¿Borrar lo que has apuntado?', '<p>Se borrarán de este dispositivo tus apuntes, medicación e importaciones. Los datos precargados volverán a aparecer. Exporta antes una copia si la quieres.</p>', 'Borrar', true)) {
          M.replaceAll(null); lastImport = null; afterChange(); toast('Datos borrados');
        }
        break;
      default:
    }
  });

  document.addEventListener('change', async (e) => {
    const t = e.target;
    const a = t.dataset && t.dataset.act;
    if (a === 'med-active') {
      const m = M.D.meds.find((x) => x.id === t.dataset.id); if (!m) return;
      M.setMedActive(m, t.checked); persist(); afterChange();
    } else if (a === 'med-weekday') {
      const m = M.D.meds.find((x) => x.id === t.dataset.id); if (!m) return;
      m.weekday = parseInt(t.value, 10); persist(); afterChange();
    } else if (a === 'set-glucose') {
      M.D.settings.showGlucose = t.checked; persist(); afterChange();
    } else if (a === 'set-goal') {
      const v = M.parseNum(t.value);
      if (M.inRange(v, 40, 200)) { M.D.settings.goalKg = v; persist(); afterChange(); toast('Meta guardada'); } else toast('La meta debe estar entre 40 y 200 kg.', true);
      t.value = fmtN1(M.D.settings.goalKg).replace(',0', '');
    } else if (a === 'set-height') {
      const v = M.parseNum(t.value);
      if (M.inRange(v, 120, 230)) { M.D.settings.heightCm = Math.round(v); persist(); afterChange(); toast('Altura guardada'); } else toast('La altura debe estar entre 120 y 230 cm.', true);
      t.value = M.D.settings.heightCm;
    } else if (t.id === 'file-others') {
      const files = Array.from(t.files || []); t.value = '';
      if (!files.length) return;
      const loaded = [];
      for (const f of files) {
        try { loaded.push({ name: f.name, text: await readFile(f) }); } catch (err) { loaded.push({ name: f.name, text: '' }); }
      }
      lastImport = M.importOthers(loaded);
      afterChange();
      toast(lastImport.some((r) => r.ok) ? 'Datos importados' : 'No se ha importado nada', !lastImport.some((r) => r.ok));
    } else if (t.id === 'file-own') {
      const f = t.files && t.files[0]; t.value = '';
      if (!f) return;
      try {
        if (f.size > 12 * 1024 * 1024) throw new Error('El archivo es demasiado grande para ser una copia.');
        const p = M.parseOwnBackup(await readFile(f));
        if (await confirmDlg('¿Importar la copia?', `<p>Se reemplazarán tus datos actuales por los de la copia (${esc(p.summary)}). No se puede deshacer.</p>`, 'Importar', true)) {
          M.replaceAll(p.data); afterChange(); toast('Copia importada');
        }
      } catch (err) { toast(err.message || 'No se pudo leer el archivo.', true); }
    }
  });

  /* ================= Refrescos ================= */
  // Datos que cambian en otra pestaña o app del mismo origen
  window.addEventListener('storage', (e) => {
    if (e.key === M.ROOT_KEY) M.load();
    if (!e.key || e.key === M.ROOT_KEY || /^mi-(tension|entrenador|menu|plato)/.test(e.key)) afterChange();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { model = M.build(); renderAll(); } });
  setInterval(() => { if (!document.hidden && tab === 'hoy' && !document.querySelector('dialog[open]')) { model = M.build(); renderHoy(); relayout(true); renderHeader(); } }, 60000);

  showTab('hoy', false);

  // Tensión desde el Mac de casa (si hay red). Si falla, se sigue con lo local.
  const traerTension = async () => { if (await M.fetchTension()) afterChange(); };
  traerTension();
  window.addEventListener('online', traerTension);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) traerTension(); });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
})();
