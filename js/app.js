/* ============================================================
   app.js — Main orchestrator for HECTIS Analyser
   ============================================================ */

const App = (() => {

  let allData      = [];   // full dataset from Supabase
  let filteredData = [];   // after filters applied

  // ── Initialise ───────────────────────────────────────────
  async function init() {
    setupTabs();
    setupUploadZone();
    Table.init();
    Filters.bind(onFilterChange);
    await checkConnection();
    await loadData();
  }

  // ── Connection Check ─────────────────────────────────────
  async function checkConnection() {
    const dot  = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    if (dot) dot.className = 'status-dot';
    if (text) text.textContent = 'Connecting…';

    const ok = await DB.ping();

    if (dot) dot.className = `status-dot ${ok ? 'connected' : 'error'}`;
    if (text) text.textContent = ok ? 'Connected' : 'Offline';

    if (!ok) {
      Utils.toast('Cannot reach HECTIS database. Check connection.', 'error', 6000);
    }
    return ok;
  }

  // ── Load Data from Supabase ──────────────────────────────
  async function loadData() {
    const countEl = document.getElementById('record-count');
    if (countEl) countEl.textContent = 'Loading…';

    try {
      allData = await DB.fetchAll({}, (loaded, total) => {
        if (countEl) countEl.textContent = `Loading ${loaded}/${total}…`;
      });

      if (countEl) countEl.textContent = `${allData.length.toLocaleString()} records`;

      Filters.populate(allData);
      filteredData = allData;
      window.__hectisFiltered = filteredData;
      renderAll();

      // Wire export button
      const exportBtn = document.getElementById('btn-export-excel');
      if (exportBtn) {
        exportBtn.onclick = () => Table.exportExcel(window.__hectisFiltered || []);
      }

    } catch (err) {
      console.error('Load failed:', err);
      if (countEl) countEl.textContent = 'Load failed';
      Utils.toast('Failed to load data: ' + err.message, 'error');
    }
  }

  // ── Filter Change Handler ────────────────────────────────
  function onFilterChange() {
    filteredData = Filters.apply(allData);
    window.__hectisFiltered = filteredData; // expose for export
    renderAll();
  }

  // ── Render All Tabs ──────────────────────────────────────
  function renderAll() {
    renderOverview();
    renderAccessBlock();
    renderTimePatterns();
    Table.render(filteredData);
  }

  // ── Overview Tab ─────────────────────────────────────────
  function renderOverview() {
    const data = filteredData;
    if (!data.length) {
      setKPI('kpi-total', '0', '');
      setKPI('kpi-los', '—', '');
      setKPI('kpi-block-rate', '—', '');
      setKPI('kpi-worst', '—', '');
      return;
    }

    // Total patients
    setKPI('kpi-total', data.length.toLocaleString(), 'total referrals');

    // Median LOS
    const losVals = data.map(r => r.total_los_min).filter(v => v !== null && v >= 0);
    const medLos  = Utils.r1(Utils.toHours(Utils.median(losVals)));
    setKPI('kpi-los', medLos !== null ? medLos : '—', 'hrs median total LOS', medLos > 12 ? 'alert' : medLos > 6 ? 'warn' : '');

    // Overall access block rate
    const blockable = data.filter(r => r.disposal_to_exit_min !== null && r.disposal_to_exit_min >= 0);
    const blocked   = blockable.filter(r => r.access_block_4hr);
    const blockRate = blockable.length ? Utils.r1((blocked.length / blockable.length) * 100) : null;
    setKPI('kpi-block-rate', blockRate !== null ? blockRate + '%' : '—', 'access block rate (>4 hrs)', blockRate > 70 ? 'alert' : blockRate > 40 ? 'warn' : 'good');

    // Worst discipline
    const grouped = Utils.groupBy(data.filter(r => r.disposal && r.disposal_to_exit_min !== null && r.disposal_to_exit_min >= 0), 'disposal');
    let worstDiscipline = null, worstMedian = -1;
    Object.entries(grouped).forEach(([d, rows]) => {
      const med = Utils.median(rows.map(r => r.disposal_to_exit_min));
      if (med > worstMedian) { worstMedian = med; worstDiscipline = d; }
    });
    setKPI('kpi-worst', worstDiscipline ? Utils.shortDiscipline(worstDiscipline) : '—',
           worstMedian > 0 ? `median ${Utils.formatMinutes(worstMedian, true)} boarding` : '',
           'alert');

    // Median segments
    const segs = [
      { id: 'kpi-seg-att', key: 'arrival_to_triage_min',     label: 'Arrival → Triage' },
      { id: 'kpi-seg-ttd', key: 'triage_to_doctor_min',      label: 'Triage → Doctor'  },
      { id: 'kpi-seg-dtd', key: 'doctor_to_disposal_min',    label: 'Doctor → Disposal'},
      { id: 'kpi-seg-dte', key: 'disposal_to_exit_min',      label: 'Disposal → Exit'  },
    ];
    segs.forEach(s => {
      const vals = data.map(r => r[s.key]).filter(v => v !== null && v >= 0);
      const med  = Utils.r0(Utils.median(vals));
      setKPI(s.id, med !== null ? Utils.formatMinutes(med, true) : '—', `median ${s.label}`);
    });

    // Trend charts
    if (allData.length > 0) {
      Charts.renderLosTrend('chart-los-trend', filteredData);
      Charts.renderSegmentBreakdown('chart-segments', filteredData);
    }
  }

  // ── Access Block Tab ─────────────────────────────────────
  function renderAccessBlock() {
    const data = filteredData.filter(r =>
      r.disposal && r.disposal_to_exit_min !== null && r.disposal_to_exit_min >= 0
    );

    // Charts
    Charts.renderAccessBlockByDiscipline('chart-ab-discipline', data);
    Charts.renderAccessBlockRate('chart-ab-rate', data);

    // Discipline summary table
    renderDisciplineTable(data);
  }

  function renderDisciplineTable(data) {
    const container = document.getElementById('discipline-summary');
    if (!container) return;

    const disciplines = [...new Set(data.map(r => r.disposal))].filter(Boolean);
    const grouped = Utils.groupBy(data, 'disposal');

    const rows = disciplines.map(d => {
      const rows = grouped[d] || [];
      const vals = rows.map(r => r.disposal_to_exit_min).filter(v => v !== null && v >= 0);
      const blocked = rows.filter(r => r.access_block_4hr).length;
      const blockRate = vals.length ? (blocked / vals.length * 100) : 0;
      return {
        discipline: d,
        n: rows.length,
        median: Utils.r0(Utils.median(vals)),
        p75:    Utils.r0(Utils.percentile(vals, 75)),
        p90:    Utils.r0(Utils.percentile(vals, 90)),
        blockRate: Utils.r1(blockRate),
      };
    }).sort((a, b) => b.median - a.median);

    container.innerHTML = `
      <div class="discipline-table-wrap">
        <div class="discipline-row header">
          <span>Discipline</span>
          <span>n</span>
          <span>Median</span>
          <span>75th %ile</span>
          <span>90th %ile</span>
          <span>Block rate</span>
        </div>
        ${rows.map(r => `
          <div class="discipline-row">
            <span class="discipline-name">${Utils.shortDiscipline(r.discipline)}</span>
            <span class="discipline-stat">${r.n.toLocaleString()}</span>
            <span class="discipline-stat">${Utils.formatMinutes(r.median, true)}</span>
            <span class="discipline-stat">${Utils.formatMinutes(r.p75, true)}</span>
            <span class="discipline-stat">${Utils.formatMinutes(r.p90, true)}</span>
            <div class="block-bar-cell">
              <div class="block-bar">
                <div class="block-bar-fill" style="width:${Math.min(r.blockRate,100)}%;background:${r.blockRate>70?'var(--red)':r.blockRate>40?'var(--orange)':'var(--green)'}"></div>
              </div>
              <span class="block-pct" style="color:${r.blockRate>70?'var(--red)':r.blockRate>40?'var(--orange)':'var(--green)'}">${r.blockRate}%</span>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // ── Time Patterns Tab ────────────────────────────────────
  function renderTimePatterns() {
    const data = filteredData.filter(r =>
      r.disposal_time && r.disposal_to_exit_min !== null && r.disposal_to_exit_min >= 0
    );

    const disciplineSelect = document.getElementById('heatmap-discipline');
    const selectedDiscipline = disciplineSelect ? disciplineSelect.value || null : null;

    Charts.renderHeatmap('heatmap-container', data, selectedDiscipline);
    Charts.renderDowChart('chart-dow', data, selectedDiscipline);

    // Populate discipline selector if empty
    if (disciplineSelect && disciplineSelect.options.length <= 1) {
      const disciplines = Utils.unique(data.map(r => r.disposal).filter(Boolean));
      disciplines.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = Utils.shortDiscipline(d);
        disciplineSelect.appendChild(opt);
      });
      disciplineSelect.addEventListener('change', () => renderTimePatterns());
    }
  }

  // ── KPI Helper ───────────────────────────────────────────
  function setKPI(id, value, unit = '', alertClass = '') {
    const card = document.getElementById(id);
    if (!card) return;
    const valEl  = card.querySelector('.kpi-value');
    const unitEl = card.querySelector('.kpi-unit');
    if (valEl)  valEl.textContent = value;
    if (unitEl) unitEl.textContent = unit;
    card.className = `kpi-card ${alertClass}`.trim();
  }

  // ── Tab Navigation ───────────────────────────────────────
  function setupTabs() {
    const tabs   = document.querySelectorAll('.nav-tab');
    const panels = document.querySelectorAll('.tab-panel');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        tabs.forEach(t => t.classList.remove('active'));
        panels.forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        const panel = document.getElementById(`tab-${target}`);
        if (panel) panel.classList.add('active');
      });
    });
  }

  // ── Upload Zone ──────────────────────────────────────────
  function setupUploadZone() {
    const zone     = document.getElementById('upload-zone');
    const fileInput = document.getElementById('file-input');
    if (!zone || !fileInput) return;

    zone.addEventListener('click', () => fileInput.click());

    zone.addEventListener('dragover', e => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      handleFiles(Array.from(e.dataTransfer.files));
    });

    fileInput.addEventListener('change', e => {
      handleFiles(Array.from(e.target.files));
      e.target.value = ''; // reset so same file can be re-uploaded
    });
  }

  function handleFiles(files) {
    const valid = files.filter(f =>
      f.name.endsWith('.xlsx') || f.name.endsWith('.xls') || f.name.endsWith('.csv')
    );

    if (valid.length === 0) {
      Utils.toast('Please upload .xlsx, .xls or .csv files', 'warn');
      return;
    }

    const logEl = document.getElementById('upload-log');
    if (logEl) logEl.innerHTML = '';

    Upload.processFiles(valid, logEntry, async (anySuccess) => {
      if (anySuccess) {
        Utils.toast('Upload complete — refreshing data…', 'success');
        await loadData();
      }
    });
  }

  function logEntry(type, html) {
    const logEl = document.getElementById('upload-log');
    if (!logEl) return;
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `
      <span class="log-icon ${type}">${{success:'✓',error:'✗',info:'→',warn:'⚠'}[type]||'·'}</span>
      <span class="log-text">${html}</span>
    `;
    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight;
  }

  return { init, loadData };

})();

// ── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
