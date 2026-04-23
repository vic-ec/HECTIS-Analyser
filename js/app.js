/* ============================================================
   app.js — Main orchestrator for HECTIS Analyser v3
   ============================================================ */

const App = (() => {

  let allData      = [];
  let filteredData = [];

  async function init() {
    setupTabs();
    setupUploadZone();
    Table.init();
    // Wire report button early so it works regardless of load state
    const reportBtn = document.getElementById('btn-generate-report');
    if (reportBtn) {
      reportBtn.addEventListener('click', () => {
        if (!filteredData || !filteredData.length) {
          Utils.toast('No data loaded yet', 'warn');
          return;
        }
        // Report is always defined if report.js is loaded
        try {
          Report.generate(filteredData);
        } catch(e) {
          console.error('Report error:', e);
          Utils.toast('Report error: ' + e.message, 'error');
        }
      });
    }
    if (typeof Compare    !== 'undefined') Compare.init(() => allData, () => renderActiveTab());
    if (typeof TabFilters !== 'undefined') {
      TabFilters.init();
      // Register per-tab render callbacks
      TabFilters.FILTER_TABS.forEach(tab => {
        TabFilters.onTabChange(tab, () => renderTab(tab));
      });
    }


    await checkConnection();
    await loadData();
  }

  async function checkConnection() {
    const dot  = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    if (dot)  dot.className    = 'status-dot';
    if (text) text.textContent = 'Connecting…';
    const ok = await DB.ping();
    if (dot)  dot.className    = `status-dot ${ok ? 'connected' : 'error'}`;
    if (text) text.textContent = ok ? 'Connected' : 'Offline';
    if (!ok) Utils.toast('Cannot reach HECTIS database. Check connection.', 'error', 6000);
    return ok;
  }

  async function loadData() {
    const countEl = document.getElementById('record-count');
    if (countEl) countEl.textContent = 'Loading…';
    try {
      let servedFromCache = false;
      allData = await DB.fetchAll({}, (loaded, total) => {
        if (countEl) {
          if (loaded === total && loaded > 0) {
            // Only show (cached) if we got data instantly (no incremental progress)
            servedFromCache = true;
            countEl.textContent = `${loaded.toLocaleString()} records (cached)`;
          } else {
            servedFromCache = false;
            countEl.textContent = `Loading ${loaded}/${total}…`;
          }
        }
      });
      if (countEl) countEl.textContent = servedFromCache
        ? `${allData.length.toLocaleString()} records (cached)`
        : `${allData.length.toLocaleString()} records`;
      if (typeof Filters    !== 'undefined') Filters.populate(allData);
      if (typeof TabFilters !== 'undefined') TabFilters.populate(allData);
      filteredData  = allData; // Tab filters applied per-tab via TabFilters
      window.__hectisFiltered = filteredData;
      window.__hectisAllData  = allData; // Expose for Report button

      // Update Compare tab with fresh data
      if (typeof Compare !== 'undefined') Compare.setData(allData);

      // Register background sync callback — fires if new records arrive after cache served
      window.__hectisSyncCallback = (updatedData) => {
        allData      = updatedData;
        filteredData = allData;
        window.__hectisFiltered = filteredData;
        if (countEl) countEl.textContent = servedFromCache
        ? `${allData.length.toLocaleString()} records (cached)`
        : `${allData.length.toLocaleString()} records`;
        Filters.populate(allData);
        setTimeout(() => renderAll(), 50);
        Utils.toast(`${(updatedData.length - allData.length + updatedData.length - updatedData.length).toLocaleString()} new records synced`, 'info', 2500);
      };

      // Render all tabs on initial load, then switch to lazy mode
      activeTab = document.querySelector('.nav-tab.active')?.dataset?.tab || 'overview';
      dirtyTabs = new Set();
      setTimeout(() => renderAll(), 50);

      const exportBtn = document.getElementById('btn-export-excel');
      if (exportBtn) exportBtn.onclick = () => Table.exportExcel(window.__hectisFiltered || []);
    } catch (err) {
      console.error('Load failed:', err);
      if (countEl) countEl.textContent = 'Load failed';
      Utils.toast('Failed to load data: ' + err.message, 'error');
    }
  }

  let activeTab = 'overview';
  let dirtyTabs = new Set();

  // Legacy stub — kept in case anything references it
  const onFilterChange = () => {};

  // Get filtered data for a specific tab
  function tabData(tab) {
    if (typeof TabFilters !== 'undefined') {
      return TabFilters.apply(tab, filteredData);
    }
    return filteredData;
  }

  // Render a specific tab
  function renderTab(tab) {
    const d = tabData(tab);
    switch (tab) {
      case 'overview':          renderOverview(d);      break;
      case 'access-block':      renderAccessBlock(d);   if (typeof PatientFlow !== 'undefined') PatientFlow.render(d, TabFilters.getStat('access-block')); break;
      case 'time-patterns':     renderTimePatterns(d);  break;
      case 'triage-compliance': if (typeof Triage   !== 'undefined') Triage.render(d);   break;
      case 'trauma':            if (typeof Trauma   !== 'undefined') Trauma.render(d, TabFilters.getStat('trauma'));   break;
      case 'locations':         if (typeof Location !== 'undefined') Location.render(d, TabFilters.getStat('locations')); break;
      case 'data-table':        Table.render(filteredData); break; // data-table uses its own column filters
    }
    dirtyTabs.delete(tab);
  }

  // Render only the currently visible tab
  function renderActiveTab() {
    renderTab(activeTab);
  }

  // Render all tabs (used on initial load)
  function renderAll() {
    dirtyTabs = new Set();
    TabFilters.FILTER_TABS.forEach(tab => renderTab(tab));
    // Data table has its own column filters but needs initial data load
    Table.render(filteredData);
  }

  // ── Stat helper for overview ─────────────────────────────
  function _calcStat(vals, stat) {
    if (!vals || !vals.length) return null;
    switch(stat) {
      case 'mean': return vals.reduce((a,b)=>a+b,0)/vals.length;
      case 'min':  return Math.min(...vals);
      case 'max':  return Math.max(...vals);
      default:     return Utils.median(vals);
    }
  }

  // ── Overview ─────────────────────────────────────────────
  function renderOverview(tabFilteredData) {
    const data = tabFilteredData || filteredData;
    const comparing = false;
    const dataB = null;
    const compPeriods = [];

    if (!data.length) {
      ['kpi-total','kpi-los','kpi-block-rate','kpi-worst'].forEach(id => setKPI(id,'—',''));
      return;
    }

    // Helper to get stats from a dataset
    const stat = TabFilters.getStat('overview');
    const statLabel = {median:'Median',mean:'Mean',min:'Minimum',max:'Maximum'}[stat] || 'Median';

    function stats(d) {
      const losVals   = d.map(r => r.total_los_min).filter(v => v !== null && v >= 0);
      const blockable = d.filter(r => r.disposal_to_exit_min !== null && r.disposal_to_exit_min >= 0);
      const blocked   = blockable.filter(r => r.access_block_4hr);
      const blockRate = blockable.length ? Utils.r1((blocked.length / blockable.length) * 100) : null;
      const referrals = d.filter(r => r.disposal && Utils.isReferral(r.disposal) &&
                                      r.disposal_to_exit_min !== null && r.disposal_to_exit_min >= 0);
      const grouped   = Utils.groupBy(referrals, 'disposal');
      let worstD = null, worstM = -1;
      Object.entries(grouped).forEach(([disc,rows]) => {
        const v = _calcStat(rows.map(r=>r.disposal_to_exit_min), stat);
        if (v > worstM) { worstM = v; worstD = disc; }
      });
      return {
        n: d.length,
        medLos: Utils.r1(Utils.toHours(_calcStat(losVals, stat))),
        blockRate,
        worstD, worstM,
        segs: {
          att: Utils.r0(_calcStat(d.map(r=>r.arrival_to_triage_min).filter(v=>v!==null&&v>=0), stat)),
          ttd: Utils.r0(_calcStat(d.map(r=>r.triage_to_doctor_min).filter(v=>v!==null&&v>=0), stat)),
          dtd: Utils.r0(_calcStat(d.map(r=>r.doctor_to_disposal_min).filter(v=>v!==null&&v>=0), stat)),
          dte: Utils.r0(_calcStat(referrals.map(r=>r.disposal_to_exit_min), stat)),
        }
      };
    }

    const sA = stats(data);
    const sB = comparing ? stats(dataB) : null;

    // Render KPIs with optional delta
    renderKPIWithDelta('kpi-total',
      sA.n.toLocaleString(), comparing ? sB.n.toLocaleString() : null,
      '', comparing ? _delta(sA.n, sB.n, true) : null);

    // Update KPI card labels to reflect selected stat
    const losCard = document.querySelector('#kpi-los .kpi-label');
    if (losCard) losCard.textContent = statLabel + ' Total LOS';
    const segLabels = {
      'kpi-seg-att': 'Arrival → Triage',
      'kpi-seg-ttd': 'Triage → Doctor',
      'kpi-seg-dtd': 'Doctor → Disposal',
      'kpi-seg-dte': 'Disposal → Exit',
    };
    Object.entries(segLabels).forEach(([id, base]) => {
      const el = document.querySelector(`#${id} .kpi-label`);
      if (el) el.textContent = base;  // keep short; stat shown in unit
    });

    // LOS card: use alert colour when value is high (regardless of stat)
    const losColour = sA.medLos !== null && sA.medLos > 12 ? 'alert' : sA.medLos > 6 ? 'warn' : '';
    renderKPIWithDelta('kpi-los',
      sA.medLos !== null ? sA.medLos + 'h' : '—',
      sB ? (sB.medLos !== null ? sB.medLos + 'h' : '—') : null,
      statLabel.toLowerCase() + ' · all patients',
      sB ? _delta(sA.medLos, sB.medLos, false) : null,
      losColour);

    renderKPIWithDelta('kpi-block-rate',
      sA.blockRate !== null ? sA.blockRate + '%' : '—',
      sB ? (sB.blockRate !== null ? sB.blockRate + '%' : '—') : null,
      'access block rate',
      sB ? _delta(sA.blockRate, sB.blockRate, false) : null,
      sA.blockRate > 70 ? 'alert' : sA.blockRate > 40 ? 'warn' : 'good');

    // Render Highest Bed Pressure with prominent red median time
    _renderWorstKPI('kpi-worst', sA.worstD, sA.worstM, statLabel);

    // Segment KPIs
    const segKeys = [
      { id:'kpi-seg-att', key:'att', label:'Arrival → Triage'   },
      { id:'kpi-seg-ttd', key:'ttd', label:'Triage → Doctor'    },
      { id:'kpi-seg-dtd', key:'dtd', label:'Doctor → Disposal'  },
      { id:'kpi-seg-dte', key:'dte', label:'Disposal → Exit'    },
    ];
    segKeys.forEach(s => {
      const vA = sA.segs[s.key];
      const vB = sB ? sB.segs[s.key] : null;
      renderKPIWithDelta(s.id,
        Utils.formatMinutes(vA, true),
        vB !== null && vB !== undefined ? Utils.formatMinutes(vB, true) : null,
        statLabel.toLowerCase(),
        sB ? _delta(vA, vB, false) : null);
    });

    // Charts — year-over-year overlay or comparison
    Charts.renderLosTrend('chart-los-trend', allData, data, null, TabFilters.getStat('overview'));
    Charts.renderSegmentBreakdown('chart-segments', data, TabFilters.getStat('overview'));


  }

  // ── Worst Discipline KPI renderer ───────────────────────
  function _renderWorstKPI(id, discipline, statMin, statLabelStr) {
    const card = document.getElementById(id);
    if (!card) return;
    const valEl  = card.querySelector('.kpi-value');
    const unitEl = card.querySelector('.kpi-unit');
    if (valEl)  valEl.textContent = discipline ? Utils.shortDiscipline(discipline) : '—';
    const lbl = (statLabelStr || 'median').toLowerCase();
    if (unitEl) {
      if (statMin > 0) {
        unitEl.innerHTML = `${lbl} <span style="color:var(--red);font-weight:600">${Utils.formatMinutes(statMin, true)}</span> boarding`;
      } else {
        unitEl.textContent = '';
      }
    }
    card.className = 'kpi-card alert';
  }

  // ── Delta calculation ────────────────────────────────────
  function _delta(a, b, higherIsBetter) {
    if (a === null || b === null || a === undefined || b === undefined) return null;
    const diff = a - b;
    if (diff === 0) return { text: '±0', cls: 'delta-neutral' };
    const better = higherIsBetter ? diff > 0 : diff < 0;
    const sign = diff > 0 ? '+' : '';
    return {
      text: `${sign}${typeof a === 'number' && !Number.isInteger(a) ? Utils.r1(diff) : Math.round(diff)}`,
      cls: better ? 'delta-better' : 'delta-worse'
    };
  }

  // ── KPI with optional comparison delta ──────────────────
  function renderKPIWithDelta(id, valA, valB, unit, delta, alertClass = '') {
    const card = document.getElementById(id);
    if (!card) return;

    const valEl  = card.querySelector('.kpi-value');
    const unitEl = card.querySelector('.kpi-unit');
    const compEl = card.querySelector('.kpi-compare');

    if (valEl)  valEl.textContent  = valA;
    if (unitEl) unitEl.textContent = unit;
    card.className = `kpi-card ${alertClass}`.trim();

    if (compEl) {
      if (valB !== null && valB !== undefined) {
        let html = `<span class="compare-b">${valB}</span>`;
        if (delta) html += ` <span class="delta ${delta.cls}">${delta.text}</span>`;
        compEl.innerHTML = html;
        compEl.style.display = 'block';
      } else {
        compEl.style.display = 'none';
      }
    }
  }

  function setKPI(id, value, unit='', alertClass='') {
    renderKPIWithDelta(id, value, null, unit, null, alertClass);
  }

  // ── Access Block ─────────────────────────────────────────
  function renderAccessBlock(tabFilteredData) { const data = tabFilteredData || filteredData;
    const abData = data.filter(r=>r.disposal&&r.disposal_to_exit_min!==null&&r.disposal_to_exit_min>=0);
    Charts.renderAccessBlockByDiscipline('chart-ab-discipline', data, TabFilters.getStat('access-block'));
    Charts.renderAccessBlockRate('chart-ab-rate', data, TabFilters.getStat('access-block'));
    const container = document.getElementById('discipline-summary');
    if (!container) return;
    const grouped = Utils.groupBy(data, 'disposal');
    const rows = [...new Set(data.map(r=>r.disposal))].filter(Boolean).map(d => {
      const dRows = grouped[d]||[];
      const vals  = dRows.map(r=>r.disposal_to_exit_min).filter(v=>v!==null&&v>=0);
      const blocked = dRows.filter(r=>r.access_block_4hr).length;
      const br = vals.length ? (blocked/vals.length*100) : 0;
      return { discipline:d, n:dRows.length, median:Utils.r0(Utils.median(vals)),
               p75:Utils.r0(Utils.percentile(vals,75)), p90:Utils.r0(Utils.percentile(vals,90)),
               blockRate:Utils.r1(br) };
    }).sort((a,b)=>b.median-a.median);
    container.innerHTML = `
      <div class="discipline-table-wrap">
        <div class="discipline-row header">
          <span>Disposal</span><span>n</span><span>Median</span>
          <span>75th %ile</span><span>90th %ile</span><span>Block rate</span>
        </div>
        ${rows.map(r=>`
          <div class="discipline-row">
            <span class="discipline-name">${Utils.shortDiscipline(r.discipline)}</span>
            <span class="discipline-stat">${r.n.toLocaleString()}</span>
            <span class="discipline-stat">${Utils.formatMinutes(r.median,true)}</span>
            <span class="discipline-stat">${Utils.formatMinutes(r.p75,true)}</span>
            <span class="discipline-stat">${Utils.formatMinutes(r.p90,true)}</span>
            <div class="block-bar-cell">
              <div class="block-bar"><div class="block-bar-fill" style="width:${Math.min(r.blockRate,100)}%;background:${r.blockRate>70?'var(--red)':r.blockRate>40?'var(--orange)':'var(--green)'}"></div></div>
              <span class="block-pct" style="color:${r.blockRate>70?'var(--red)':r.blockRate>40?'var(--orange)':'var(--green)'}">${r.blockRate}%</span>
            </div>
          </div>`).join('')}
      </div>`;
  }

  // ── Time Patterns ────────────────────────────────────────
  function renderTimePatterns(tabFilteredData) {
    const data = tabFilteredData || filteredData;
    const stat = TabFilters.getStat('time-patterns');
    // Discipline filter now handled by tab filter bar — no separate dropdown needed
    Charts.renderHeatmap('heatmap-container', data, null, stat);
    Charts.renderDowChart('chart-dow', data, null, stat);
  }

  // ── Tabs ─────────────────────────────────────────────────
  function setupTabs() {
    const tabs   = document.querySelectorAll('.nav-tab');
    const panels = document.querySelectorAll('.tab-panel');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        tabs.forEach(t=>t.classList.remove('active'));
        panels.forEach(p=>p.classList.remove('active'));
        tab.classList.add('active');
        const panel = document.getElementById(`tab-${target}`);
        if (panel) panel.classList.add('active');
        activeTab = target;
        // For data-table, always re-render on switch to ensure fresh data
        if (activeTab === 'data-table') {
          Table.render(filteredData);
        } else if (dirtyTabs && dirtyTabs.has(activeTab)) {
          renderActiveTab();
        }
      });
    });
  }

  // ── Upload zone ──────────────────────────────────────────
  function setupUploadZone() {
    const zone = document.getElementById('upload-zone');
    const fi   = document.getElementById('file-input');
    if (!zone || !fi) return;
    zone.addEventListener('click', () => fi.click());
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag-over'); handleFiles(Array.from(e.dataTransfer.files)); });
    fi.addEventListener('change', e => { handleFiles(Array.from(e.target.files)); e.target.value=''; });
  }

  function handleFiles(files) {
    const valid = files.filter(f=>f.name.endsWith('.xlsx')||f.name.endsWith('.xls')||f.name.endsWith('.csv'));
    if (!valid.length) { Utils.toast('Please upload .xlsx, .xls or .csv files','warn'); return; }
    const logEl = document.getElementById('upload-log');
    if (logEl) logEl.innerHTML = '';
    Upload.processFiles(valid, logEntry, async ok => {
      if (ok) {
        Utils.toast('Upload complete — refreshing data…', 'success');
        // Invalidate IndexedDB cache so loadData fetches fresh from Supabase
        if (typeof DB !== 'undefined' && DB.invalidateCache) await DB.invalidateCache();
        await loadData();
      }
    });
  }

  function logEntry(type, html) {
    const logEl = document.getElementById('upload-log');
    if (!logEl) return;
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `<span class="log-icon ${type}">${{success:'✓',error:'✗',info:'→',warn:'⚠'}[type]||'·'}</span><span class="log-text">${html}</span>`;
    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight;
  }

  return { init, loadData };
})();

document.addEventListener('DOMContentLoaded', () => {
  App.init();

  // Force Chart.js to redraw when window resizes
  // Chart.js with maintainAspectRatio:false needs explicit resize trigger
  let resizeTimer;
  const resizeObserver = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      // Resize all active Chart.js instances
      Object.values(Chart.instances || {}).forEach(chart => {
        try { chart.resize(); } catch(e) {}
      });
    }, 100);
  });

  // Observe the main content area
  const main = document.getElementById('main');
  if (main) resizeObserver.observe(main);
});
