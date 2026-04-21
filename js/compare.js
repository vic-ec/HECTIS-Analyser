/* ============================================================
   compare.js — Compare Tab Module
   HECTIS Analyser — Multi-period comparison
   ============================================================ */

const Compare = (() => {

  const MAX_PERIODS = 10;
  const PERIOD_COLORS = [
    '#58a6ff','#f85149','#3fb950','#bc8cff',
    '#d29922','#f778ba','#e07b39','#39c5c8','#a0c4ff','#ff9a3c'
  ];
  const PERIOD_LABELS = ['A','B','C','D','E','F','G','H','I','J'];

  let periods = [];
  let allDataRef = null;
  let onChangeCallback = null;

  // ── Init ─────────────────────────────────────────────────
  function init(getAllData, onChange) {
    allDataRef = getAllData;
    onChangeCallback = onChange;
    _bindAddButton();
  }

  // ── Update data reference ────────────────────────────────
  function setData(data) {
    allDataRef = data;
  }

  // ── Add period ───────────────────────────────────────────
  function addPeriod() {
    if (periods.length >= MAX_PERIODS) {
      Utils.toast('Maximum ' + MAX_PERIODS + ' periods', 'warn');
      return;
    }
    const idx = periods.length;
    const p = {
      id:        'p' + Date.now(),
      label:     PERIOD_LABELS[idx],
      color:     PERIOD_COLORS[idx],
      dateFrom:  null,
      dateTo:    null,
      disposals: [],
      triage:    null,
      traumas:   [],
      locations: [],
    };
    periods.push(p);
    _renderPeriod(p);
    _updateAddButton();
    _renderChart();
  }

  // ── Remove period ────────────────────────────────────────
  function removePeriod(id) {
    periods = periods.filter(p => p.id !== id);
    periods.forEach((p, i) => { p.label = PERIOD_LABELS[i]; p.color = PERIOD_COLORS[i]; });
    _rebuildAll();
    _renderChart();
  }

  // ── Reset a period ───────────────────────────────────────
  function resetPeriod(id) {
    const p = periods.find(p => p.id === id);
    if (!p) return;
    p.dateFrom = null; p.dateTo = null;
    p.disposals = []; p.triage = null; p.traumas = [];
    _rebuildAll();
    _renderChart();
  }

  // ── Apply filters for one period ─────────────────────────
  function _applyPeriod(data, p) {
    return data.filter(r => {
      if (p.dateFrom) {
        const d = new Date(r.arrival_time);
        if (isNaN(d) || d < new Date(p.dateFrom)) return false;
      }
      if (p.dateTo) {
        const d = new Date(r.arrival_time);
        if (isNaN(d) || d > new Date(p.dateTo + 'T23:59:59')) return false;
      }
      if (p.disposals.length  && !p.disposals.includes(r.disposal))  return false;
      if (p.triage             && r.triage_category !== p.triage)    return false;
      if (p.traumas.length     && !p.traumas.includes(r.trauma))     return false;
      if (p.locations.length   && !p.locations.includes(r.location)) return false;
      return true;
    });
  }

  // ── Get all period datasets ──────────────────────────────
  function getDatasets() {
    if (!allDataRef) return [];
    return periods
      .filter(p => p.dateFrom && p.dateTo)
      .map(p => ({
        label:   'Period ' + p.label,
        color:   p.color,
        dateFrom: p.dateFrom,
        dateTo:   p.dateTo,
        data:    _applyPeriod(allDataRef, p),
        period:  p,
      }));
  }

  function hasPeriods() { return periods.some(p => p.dateFrom && p.dateTo); }

  // ── Render chart ─────────────────────────────────────────
  function _renderChart() {
    const container = document.getElementById('compare-chart-container');
    if (!container) return;

    const datasets = getDatasets();

    if (datasets.length === 0) {
      container.innerHTML = '<div class="empty-state" style="padding:3rem"><div class="empty-icon">⇄</div><p>Add periods with date ranges above to see comparison charts</p></div>';
      return;
    }

    container.innerHTML = `
      <div class="grid-2" style="margin-bottom:1rem">
        <div class="card">
          <div class="card-title">KPI Comparison</div>
          <div id="compare-kpi-table"></div>
        </div>
        <div class="card">
          <div class="card-title">Access Block Rate by Period</div>
          <div class="chart-wrap" style="height:280px"><canvas id="compare-chart-blockrate"></canvas></div>
        </div>
      </div>
      <div class="card" style="margin-bottom:1rem">
        <div class="card-title">Disposal → Exit Trend (referrals only)</div>
        <div class="chart-wrap" style="height:320px"><canvas id="compare-chart-trend"></canvas></div>
      </div>
      <div class="card">
        <div class="card-title">Triage Compliance by Period</div>
        <div class="chart-wrap" style="height:280px"><canvas id="compare-chart-triage"></canvas></div>
      </div>
    `;

    _renderKPITable(datasets);
    _renderBlockRateChart(datasets);
    _renderTrendChart(datasets);
    _renderTriageChart(datasets);
  }

  // ── KPI comparison table ──────────────────────────────────
  function _renderKPITable(datasets) {
    const el = document.getElementById('compare-kpi-table');
    if (!el) return;

    const rows = datasets.map(ds => {
      const d = ds.data;
      const refs = d.filter(r => Utils.isReferral(r.disposal) && r.disposal_to_exit_min !== null && r.disposal_to_exit_min >= 0);
      const blockable = refs;
      const blocked = blockable.filter(r => r.access_block_4hr);
      const blockRate = blockable.length ? Utils.r1((blocked.length / blockable.length) * 100) : null;
      const medDte = Utils.r0(Utils.toHours(Utils.median(refs.map(r => r.disposal_to_exit_min))));
      const medLos = Utils.r1(Utils.toHours(Utils.median(d.map(r => r.total_los_min).filter(v => v !== null && v >= 0))));
      const medTtd = Utils.r0(Utils.median(d.map(r => r.triage_to_doctor_min).filter(v => v !== null && v >= 0)));
      return { label: ds.label, color: ds.color, n: d.length, medDte, medLos, blockRate, medTtd };
    });

    el.innerHTML = `
      <div class="discipline-table-wrap">
        <div class="discipline-row header" style="grid-template-columns:1fr 0.7fr 1fr 1fr 1fr 1fr">
          <span>Period</span><span>n</span><span>Median LOS</span>
          <span>Disp→Exit</span><span>Block Rate</span><span>Triage→Dr</span>
        </div>
        ${rows.map(r => `
          <div class="discipline-row" style="grid-template-columns:1fr 0.7fr 1fr 1fr 1fr 1fr">
            <span><span class="compare-label-badge" style="border-color:${r.color};color:${r.color}">${r.label}</span></span>
            <span class="discipline-stat">${r.n.toLocaleString()}</span>
            <span class="discipline-stat">${r.medLos !== null ? r.medLos + 'h' : '—'}</span>
            <span class="discipline-stat">${Utils.formatMinutes(r.medDte * 60, true)}</span>
            <span class="discipline-stat" style="color:${r.blockRate > 70 ? 'var(--red)' : r.blockRate > 40 ? 'var(--orange)' : 'var(--green)'}">${r.blockRate !== null ? r.blockRate + '%' : '—'}</span>
            <span class="discipline-stat">${Utils.formatMinutes(r.medTtd, true)}</span>
          </div>
        `).join('')}
      </div>`;
  }

  // ── Access Block Rate bar chart ───────────────────────────
  function _renderBlockRateChart(datasets) {
    const canvas = document.getElementById('compare-chart-blockrate');
    if (!canvas) return;
    const existing = Chart.getChart(canvas); if (existing) existing.destroy();

    const labels = datasets.map(ds => ds.label);
    const rates  = datasets.map(ds => {
      const refs = ds.data.filter(r => Utils.isReferral(r.disposal) && r.disposal_to_exit_min !== null && r.disposal_to_exit_min >= 0);
      if (!refs.length) return null;
      return Utils.r1((refs.filter(r => r.access_block_4hr).length / refs.length) * 100);
    });

    new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Access Block Rate (%)',
          data: rates,
          backgroundColor: datasets.map(ds => ds.color + '99'),
          borderColor: datasets.map(ds => ds.color),
          borderWidth: 2, borderRadius: 4,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { backgroundColor:'#21262d', borderColor:'#30363d', borderWidth:1, titleColor:'#e6edf3', bodyColor:'#7d8590', titleFont:{family:'DM Mono',size:11}, bodyFont:{family:'DM Mono',size:11}, padding:10,
            callbacks: { label: ctx => ctx.raw !== null ? ctx.raw + '% access blocked' : 'No data' }
          }
        },
        scales: {
          x: { ticks:{color:'#7d8590',font:{family:'DM Mono',size:11}}, grid:{color:'#21262d'}, border:{color:'#30363d'} },
          y: { min:0, max:100, ticks:{color:'#7d8590',font:{family:'DM Mono',size:10},callback:v=>v+'%'}, grid:{color:'#21262d'}, border:{color:'#30363d'} }
        }
      }
    });
  }

  // ── Disposal→Exit trend line chart ───────────────────────
  function _renderTrendChart(datasets) {
    const canvas = document.getElementById('compare-chart-trend');
    if (!canvas) return;
    const existing = Chart.getChart(canvas); if (existing) existing.destroy();

    const MN = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    // Build monthly disposal→exit median per period
    const chartDatasets = datasets.map((ds, i) => {
      const byMonth = {};
      ds.data.filter(r => Utils.isReferral(r.disposal) && r.disposal_to_exit_min !== null && r.disposal_to_exit_min >= 0).forEach(r => {
        if (!r.upload_year || !r.upload_month) return;
        const k = r.upload_year + '-' + String(r.upload_month).padStart(2,'0');
        if (!byMonth[k]) byMonth[k] = [];
        byMonth[k].push(r.disposal_to_exit_min);
      });
      const keys = Object.keys(byMonth).sort();
      return {
        label: ds.label,
        data: keys.map(k => {
          const vals = byMonth[k];
          return vals.length >= 3 ? Utils.r1(Utils.toHours(Utils.median(vals))) : null;
        }),
        _keys: keys,
        borderColor: ds.color,
        backgroundColor: ds.color + '22',
        borderWidth: 2, pointRadius: 3, tension: 0.3, spanGaps: true,
        borderDash: i > 0 ? [] : [],
      };
    });

    // Union of all month keys for x-axis
    const allKeys = [...new Set(chartDatasets.flatMap(d => d._keys))].sort();
    const labels  = allKeys.map(k => { const [y,m]=k.split('-'); return MN[parseInt(m)]+' '+y; });

    // Re-align each dataset to the union of keys
    chartDatasets.forEach(ds => {
      const map = {};
      ds._keys.forEach((k, i) => { map[k] = ds.data[i]; });
      ds.data = allKeys.map(k => map[k] !== undefined ? map[k] : null);
      delete ds._keys;
    });

    new Chart(canvas, {
      type: 'line',
      data: { labels, datasets: chartDatasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels:{color:'#7d8590',font:{family:'DM Mono',size:11},boxWidth:12} },
          tooltip: { backgroundColor:'#21262d', borderColor:'#30363d', borderWidth:1, titleColor:'#e6edf3', bodyColor:'#7d8590', titleFont:{family:'DM Mono',size:11}, bodyFont:{family:'DM Mono',size:11}, padding:10,
            callbacks: { label: ctx => ctx.raw !== null ? ctx.dataset.label+': '+ctx.raw+'h' : 'No data' }
          }
        },
        scales: {
          x: { ticks:{color:'#7d8590',font:{family:'DM Mono',size:10}}, grid:{color:'#21262d'}, border:{color:'#30363d'} },
          y: { ticks:{color:'#7d8590',font:{family:'DM Mono',size:10},callback:v=>v+'h'}, grid:{color:'#21262d'}, border:{color:'#30363d'},
               title:{display:true,text:'Median disposal→exit (hrs)',color:'#7d8590',font:{family:'DM Mono',size:10}} }
        }
      }
    });
  }

  // ── Triage compliance chart ──────────────────────────────
  function _renderTriageChart(datasets) {
    const canvas = document.getElementById('compare-chart-triage');
    if (!canvas) return;
    const existing = Chart.getChart(canvas); if (existing) existing.destroy();

    const CATS = ['Red','Orange','Yellow','Green'];
    const TARGETS = { Red:0, Orange:10, Yellow:60, Green:240 };
    const TCAT_COLORS = { Red:'#f85149', Orange:'#e07b39', Yellow:'#d29922', Green:'#3fb950' };

    const chartDatasets = CATS.map(cat => ({
      label: cat,
      data: datasets.map(ds => {
        const rows = ds.data.filter(r =>
          r.triage_category === cat &&
          r.triage_to_doctor_min !== null && r.triage_to_doctor_min >= 0
        );
        if (rows.length < 5) return null;
        const compliant = rows.filter(r => r.triage_to_doctor_min <= TARGETS[cat]).length;
        return Utils.r1((compliant / rows.length) * 100);
      }),
      backgroundColor: TCAT_COLORS[cat] + '88',
      borderColor: TCAT_COLORS[cat],
      borderWidth: 2, borderRadius: 3,
    }));

    new Chart(canvas, {
      type: 'bar',
      data: { labels: datasets.map(ds => ds.label), datasets: chartDatasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels:{color:'#7d8590',font:{family:'DM Mono',size:11},boxWidth:12} },
          tooltip: { backgroundColor:'#21262d', borderColor:'#30363d', borderWidth:1, titleColor:'#e6edf3', bodyColor:'#7d8590', titleFont:{family:'DM Mono',size:11}, bodyFont:{family:'DM Mono',size:11}, padding:10,
            callbacks: { label: ctx => ctx.raw !== null ? ctx.dataset.label+': '+ctx.raw+'%' : 'Insufficient data' }
          }
        },
        scales: {
          x: { ticks:{color:'#7d8590',font:{family:'DM Mono',size:11}}, grid:{color:'#21262d'}, border:{color:'#30363d'} },
          y: { min:0, max:100, ticks:{color:'#7d8590',font:{family:'DM Mono',size:10},callback:v=>v+'%'}, grid:{color:'#21262d'}, border:{color:'#30363d'} }
        }
      }
    });
  }

  // ── Build period card HTML ────────────────────────────────
  function _renderPeriod(p) {
    const container = document.getElementById('compare-periods-container');
    if (!container) return;

    const minD = window.__hectisMinDate || '';
    const maxD = window.__hectisMaxDate || '';

    // Get available options from data - wait if not loaded yet
    const data = (allDataRef && allDataRef.length > 0) ? allDataRef : [];
    if (data.length === 0) {
      // Data not loaded yet - retry after data loads
      Utils.toast('Data still loading — please try again shortly', 'info', 2000);
      // Remove the period we just added since we can't render it
      periods = periods.filter(pp => pp.id !== p.id);
      _updateAddButton();
      return;
    }
    const disposals = Utils.unique(data.map(r => r.disposal).filter(Boolean));
    const triages   = ['Red','Orange','Yellow','Green'];
    const traumas   = Utils.unique(data.map(r => r.trauma).filter(v => v && _isValidTrauma(v)));
    const OUTCOME_LOCS = new Set(['Home','Discharged Home by Discipline','Discharged Home',
      'Transferred Out','Transferred Out by Discipline','Bereavement Room',
      'Mortuary','Mortuary Contract','Mortuary Forensic(Salt River)','OPD','Clinical Forensics Unit']);
    const locRaw  = Utils.unique(data.map(r => r.location).filter(v => v && _isValidLocation(v)));
    const locations = [...locRaw.filter(v => !OUTCOME_LOCS.has(v)).sort(), ...locRaw.filter(v => OUTCOME_LOCS.has(v)).sort()];

    const card = document.createElement('div');
    card.className = 'compare-period-card';
    card.id = 'card-' + p.id;

    const dispOpts = disposals.map(d =>
      `<label class="multiselect-item ${p.disposals.includes(d)?'checked':''}">
        <input type="checkbox" value="${d}" ${p.disposals.includes(d)?'checked':''}> <span>${Utils.shortDiscipline(d)}</span>
      </label>`).join('');

    const traumaOpts = traumas.map(t =>
      `<label class="multiselect-item ${p.traumas.includes(t)?'checked':''}">
        <input type="checkbox" value="${t}" ${p.traumas.includes(t)?'checked':''}> <span>${t}</span>
      </label>`).join('');

    const locationOpts = locations.map(l =>
      `<label class="multiselect-item ${p.locations.includes(l)?'checked':''}">
        <input type="checkbox" value="${l.replace(/"/g,'&quot;')}" ${p.locations.includes(l)?'checked':''}> <span>${l}</span>
      </label>`).join('');

    const triageOpts = triages.map(t =>
      `<option value="${t}" ${p.triage===t?'selected':''}>${t}</option>`).join('');

    card.innerHTML = `
      <div class="compare-period-header">
        <div class="compare-period-badge" style="background:${p.color}20;border-color:${p.color}60;color:${p.color}">
          Period ${p.label}
        </div>
        <div class="compare-period-controls">
          <button class="btn btn-ghost compare-reset-btn" onclick="Compare.resetPeriod('${p.id}')">↺ Reset</button>
          <button class="btn btn-ghost compare-delete-btn" onclick="Compare.removePeriod('${p.id}')">✕ Delete</button>
        </div>
      </div>
      <div class="compare-period-filters">
        <div class="filter-group">
          <label class="filter-label">From</label>
          <input type="date" class="filter-input cp-from" id="cpfrom-${p.id}" value="${p.dateFrom||''}" min="${minD}" max="${maxD}">
        </div>
        <div class="filter-group">
          <label class="filter-label">To</label>
          <input type="date" class="filter-input cp-to" id="cpto-${p.id}" value="${p.dateTo||''}" min="${minD}" max="${maxD}">
        </div>
        <div class="filter-group" style="position:relative">
          <label class="filter-label">Disposals</label>
          <div class="multiselect-wrap" id="cpd-wrap-${p.id}">
            <button class="multiselect-trigger filter-select" id="cpd-btn-${p.id}" data-placeholder="All Disposals">
              ${p.disposals.length === 0 ? 'All Disposals' : p.disposals.length === disposals.length ? 'All selected' : p.disposals.length + ' selected'}
            </button>
            <div class="multiselect-list">
              <label class="multiselect-item multiselect-select-all">
                <input type="checkbox" class="cp-select-all-disp" ${p.disposals.length === disposals.length || p.disposals.length === 0 ? 'checked' : ''}> <span style="font-weight:600">Select all</span>
              </label>
              <div style="height:1px;background:var(--border);margin:0.25rem 0"></div>
              ${dispOpts}
            </div>
          </div>
        </div>
        <div class="filter-group">
          <label class="filter-label">Triage</label>
          <select class="filter-select cp-triage" id="cpt-${p.id}">
            <option value="">All Triage</option>
            ${triageOpts}
          </select>
        </div>
        <div class="filter-group" style="position:relative">
          <label class="filter-label">Trauma</label>
          <div class="multiselect-wrap" id="cptr-wrap-${p.id}">
            <button class="multiselect-trigger filter-select" id="cptr-btn-${p.id}" data-placeholder="All Trauma">
              ${p.traumas.length === 0 ? 'All Trauma' : p.traumas.length === traumas.length ? 'All selected' : p.traumas.length + ' selected'}
            </button>
            <div class="multiselect-list">
              <label class="multiselect-item multiselect-select-all">
                <input type="checkbox" class="cp-select-all-trauma" ${p.traumas.length === traumas.length || p.traumas.length === 0 ? 'checked' : ''}> <span style="font-weight:600">Select all</span>
              </label>
              <div style="height:1px;background:var(--border);margin:0.25rem 0"></div>
              ${traumaOpts}
            </div>
          </div>
        </div>
        <div class="filter-group" style="position:relative">
          <label class="filter-label">Location</label>
          <div class="multiselect-wrap" id="cploc-wrap-${p.id}">
            <button class="multiselect-trigger filter-select" id="cploc-btn-${p.id}" data-placeholder="All Locations">
              ${p.locations.length === 0 ? 'All Locations' : p.locations.length === locations.length ? 'All selected' : p.locations.length + ' selected'}
            </button>
            <div class="multiselect-list">
              <label class="multiselect-item multiselect-select-all">
                <input type="checkbox" class="cp-select-all-loc" ${p.locations.length === locations.length || p.locations.length === 0 ? 'checked' : ''}> <span style="font-weight:600">Select all</span>
              </label>
              <div style="height:1px;background:var(--border);margin:0.25rem 0"></div>
              ${locationOpts}
            </div>
          </div>
        </div>
      </div>
    `;

    container.appendChild(card);
    _bindPeriodEvents(card, p, disposals, traumas, locations);
  }

  function _isValidTrauma(v) {
    if (!v || v === '-') return false;
    if (/\d{1,4}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(v)) return false;
    if (/\d{1,2}:\d{2}/.test(v)) return false;
    return /[A-Za-z]/.test(v);
  }

  // ── Bind events for a period card ────────────────────────
  function _bindPeriodEvents(card, p, disposals, traumas, locations) {
    // Date inputs
    card.querySelector('.cp-from')?.addEventListener('change', e => { p.dateFrom = e.target.value || null; _renderChart(); });
    card.querySelector('.cp-to')?.addEventListener('change',   e => { p.dateTo   = e.target.value || null; _renderChart(); });

    // Triage
    card.querySelector('.cp-triage')?.addEventListener('change', e => { p.triage = e.target.value || null; _renderChart(); });

    // Disposal multi-select
    _bindMultiSelect(card, '.cp-select-all-disp', 'cpd-btn-' + p.id, p.disposals, disposals, 'All Disposals', v => Utils.shortDiscipline(v), 'input[type=checkbox]:not(.cp-select-all-disp):not(.cp-select-all-trauma)');

    // Trauma multi-select
    _bindMultiSelect(card, '.cp-select-all-trauma', 'cptr-btn-' + p.id, p.traumas, traumas, 'All Trauma', v => v, 'input[type=checkbox]:not(.cp-select-all-disp):not(.cp-select-all-trauma):not(.cp-select-all-loc)');
    // Location multi-select
    _bindMultiSelect(card, '.cp-select-all-loc', 'cploc-btn-' + p.id, p.locations, locations, 'All Locations', v => v, 'input[type=checkbox]:not(.cp-select-all-disp):not(.cp-select-all-trauma):not(.cp-select-all-loc)');
  }

  function _bindMultiSelect(card, selectAllSel, triggerId, arr, allValues, placeholder, labelFn) {
    const selectAll = card.querySelector(selectAllSel);
    const trigger   = document.getElementById(triggerId);

    const updateLabel = () => {
      if (!trigger) return;
      trigger.textContent = arr.length === 0 || arr.length === allValues.length
        ? 'All selected'
        : arr.length + ' selected';
    };

    // Individual checkboxes (in the same list as this select-all)
    const list = selectAll?.closest('.multiselect-list');
    if (!list) return;
    const cbs = list.querySelectorAll('input[type=checkbox]:not(.cp-select-all-disp):not(.cp-select-all-trauma)');

    selectAll?.addEventListener('change', () => {
      arr.length = 0;
      cbs.forEach(cb => {
        cb.checked = selectAll.checked;
        cb.closest('.multiselect-item')?.classList.toggle('checked', selectAll.checked);
        if (selectAll.checked) arr.push(cb.value);
      });
      updateLabel();
      _renderChart();
    });

    cbs.forEach(cb => {
      cb.addEventListener('change', () => {
        const val = cb.value;
        if (cb.checked) { if (!arr.includes(val)) arr.push(val); cb.closest('.multiselect-item')?.classList.add('checked'); }
        else { const i = arr.indexOf(val); if (i > -1) arr.splice(i,1); cb.closest('.multiselect-item')?.classList.remove('checked'); }
        if (selectAll) selectAll.checked = arr.length === allValues.length;
        updateLabel();
        _renderChart();
      });
    });

    // Toggle open/close
    trigger?.addEventListener('click', e => {
      e.stopPropagation();
      const isOpen = list.classList.contains('open');
      document.querySelectorAll('.multiselect-list.open').forEach(l => l.classList.remove('open'));
      if (!isOpen) list.classList.add('open');
    });
  }

  // ── Rebuild all period cards ──────────────────────────────
  function _rebuildAll() {
    const container = document.getElementById('compare-periods-container');
    if (!container) return;
    container.innerHTML = '';
    periods.forEach(p => _renderPeriod(p));
    _updateAddButton();
  }

  function _bindAddButton() {
    const btn = document.getElementById('btn-add-compare-period');
    if (btn) btn.addEventListener('click', () => addPeriod());
    document.addEventListener('click', e => {
      if (!e.target.closest('.multiselect-wrap')) {
        document.querySelectorAll('.multiselect-list.open').forEach(l => l.classList.remove('open'));
      }
    });
  }

  function _updateAddButton() {
    const btn = document.getElementById('btn-add-compare-period');
    if (!btn) return;
    btn.disabled = periods.length >= MAX_PERIODS;
    btn.textContent = periods.length === 0
      ? '+ Add Period'
      : '+ Add Period ' + (PERIOD_LABELS[periods.length] || '');
  }

  function clearAll() {
    periods = [];
    _rebuildAll();
    _renderChart();
  }

  return { init, setData, addPeriod, removePeriod, resetPeriod, clearAll, getDatasets, hasPeriods };

})();
