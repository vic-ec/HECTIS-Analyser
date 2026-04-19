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
    Filters.bind(onFilterChange);
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
    if (typeof Compare !== 'undefined') Compare.init(
      () => allData,   // getter so Compare always has fresh data
      onFilterChange
    );


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
      Filters.populate(allData);
      filteredData  = Filters.apply(allData);
      window.__hectisFiltered = filteredData;

      // Update Compare tab with fresh data
      if (typeof Compare !== 'undefined') Compare.setData(allData);

      // Register background sync callback — fires if new records arrive after cache served
      window.__hectisSyncCallback = (updatedData) => {
        allData      = updatedData;
        filteredData = Filters.apply(allData);
        window.__hectisFiltered = filteredData;
        if (countEl) countEl.textContent = servedFromCache
        ? `${allData.length.toLocaleString()} records (cached)`
        : `${allData.length.toLocaleString()} records`;
        Filters.populate(allData);
        setTimeout(() => renderAll(), 50);
        Utils.toast(`${(updatedData.length - allData.length + updatedData.length - updatedData.length).toLocaleString()} new records synced`, 'info', 2500);
      };

      // Small defer to ensure DOM is ready before rendering heavy modules
      setTimeout(() => renderAll(), 50);

      const exportBtn = document.getElementById('btn-export-excel');
      if (exportBtn) exportBtn.onclick = () => Table.exportExcel(window.__hectisFiltered || []);
    } catch (err) {
      console.error('Load failed:', err);
      if (countEl) countEl.textContent = 'Load failed';
      Utils.toast('Failed to load data: ' + err.message, 'error');
    }
  }

  function onFilterChange() {
    filteredData  = Filters.apply(allData);
    window.__hectisFiltered = filteredData;
    renderAll();
  }

  function renderAll() {
    renderOverview();
    renderAccessBlock();
    renderTimePatterns();
    if (typeof Triage    !== 'undefined') Triage.render(filteredData);
    if (typeof Trauma    !== 'undefined') Trauma.render(filteredData);
    if (typeof Location  !== 'undefined') Location.render(filteredData);
    Table.render(filteredData);
  }

  // ── Overview ─────────────────────────────────────────────
  function renderOverview() {
    const data = filteredData;
    const comparing = false;
    const dataB = null;
    const compPeriods = [];

    if (!data.length) {
      ['kpi-total','kpi-los','kpi-block-rate','kpi-worst'].forEach(id => setKPI(id,'—',''));
      return;
    }

    // Helper to get stats from a dataset
    function stats(d) {
      const losVals   = d.map(r => r.total_los_min).filter(v => v !== null && v >= 0);
      const blockable = d.filter(r => r.disposal_to_exit_min !== null && r.disposal_to_exit_min >= 0);
      const blocked   = blockable.filter(r => r.access_block_4hr);
      const blockRate = blockable.length ? Utils.r1((blocked.length / blockable.length) * 100) : null;
      // Worst discipline: only referral disposals (not discharges/absconded/deceased)
      const referrals = d.filter(r => r.disposal && Utils.isReferral(r.disposal) &&
                                      r.disposal_to_exit_min !== null && r.disposal_to_exit_min >= 0);
      const grouped   = Utils.groupBy(referrals, 'disposal');
      let worstD = null, worstM = -1;
      Object.entries(grouped).forEach(([disc,rows]) => {
        const med = Utils.median(rows.map(r=>r.disposal_to_exit_min));
        if (med > worstM) { worstM = med; worstD = disc; }
      });
      return {
        n: d.length,
        medLos: Utils.r1(Utils.toHours(Utils.median(losVals))),
        blockRate,
        worstD, worstM,
        segs: {
          att: Utils.r0(Utils.median(d.map(r=>r.arrival_to_triage_min).filter(v=>v!==null&&v>=0))),
          ttd: Utils.r0(Utils.median(d.map(r=>r.triage_to_doctor_min).filter(v=>v!==null&&v>=0))),
          dtd: Utils.r0(Utils.median(d.map(r=>r.doctor_to_disposal_min).filter(v=>v!==null&&v>=0))),
          // Disposal→Exit: referral patients only (meaningful boarding time)
          dte: Utils.r0(Utils.median(referrals.map(r=>r.disposal_to_exit_min))),
        }
      };
    }

    const sA = stats(data);
    const sB = comparing ? stats(dataB) : null;

    // Render KPIs with optional delta
    renderKPIWithDelta('kpi-total',
      sA.n.toLocaleString(), comparing ? sB.n.toLocaleString() : null,
      '', comparing ? _delta(sA.n, sB.n, true) : null);

    renderKPIWithDelta('kpi-los',
      sA.medLos !== null ? sA.medLos + 'h' : '—',
      sB ? (sB.medLos !== null ? sB.medLos + 'h' : '—') : null,
      'all patients',
      sB ? _delta(sA.medLos, sB.medLos, false) : null,
      sA.medLos > 12 ? 'alert' : sA.medLos > 6 ? 'warn' : '');

    renderKPIWithDelta('kpi-block-rate',
      sA.blockRate !== null ? sA.blockRate + '%' : '—',
      sB ? (sB.blockRate !== null ? sB.blockRate + '%' : '—') : null,
      'access block rate',
      sB ? _delta(sA.blockRate, sB.blockRate, false) : null,
      sA.blockRate > 70 ? 'alert' : sA.blockRate > 40 ? 'warn' : 'good');

    // Render Highest Bed Pressure with prominent red median time
    _renderWorstKPI('kpi-worst', sA.worstD, sA.worstM);

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
        'median',
        sB ? _delta(vA, vB, false) : null);
    });

    // Charts — year-over-year overlay or comparison
    Charts.renderLosTrend('chart-los-trend', allData, filteredData, null);
    Charts.renderSegmentBreakdown('chart-segments', filteredData);


  }

  // ── Worst Discipline KPI renderer ───────────────────────
  function _renderWorstKPI(id, discipline, medianMin) {
    const card = document.getElementById(id);
    if (!card) return;
    const valEl  = card.querySelector('.kpi-value');
    const unitEl = card.querySelector('.kpi-unit');
    if (valEl)  valEl.textContent = discipline ? Utils.shortDiscipline(discipline) : '—';
    if (unitEl) {
      if (medianMin > 0) {
        unitEl.innerHTML = `median <span style="color:var(--red);font-weight:600">${Utils.formatMinutes(medianMin, true)}</span> boarding`;
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
  function renderAccessBlock() {
    const data = filteredData.filter(r=>r.disposal&&r.disposal_to_exit_min!==null&&r.disposal_to_exit_min>=0);
    Charts.renderAccessBlockByDiscipline('chart-ab-discipline', data);
    Charts.renderAccessBlockRate('chart-ab-rate', data);
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
  function renderTimePatterns() {
    const data = filteredData.filter(r=>r.disposal_time&&r.disposal_to_exit_min!==null&&r.disposal_to_exit_min>=0);
    const sel  = document.getElementById('heatmap-discipline');
    const disc = sel ? sel.value||null : null;
    Charts.renderHeatmap('heatmap-container', data, disc);
    Charts.renderDowChart('chart-dow', data, disc);
    if (sel && sel.options.length <= 1) {
      Utils.unique(data.map(r=>r.disposal).filter(Boolean)).forEach(d => {
        const opt = document.createElement('option');
        opt.value = d; opt.textContent = Utils.shortDiscipline(d);
        sel.appendChild(opt);
      });
      sel.addEventListener('change', () => renderTimePatterns());
    }
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
