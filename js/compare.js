/* ============================================================
   compare.js — Multi-period comparison manager
   HECTIS Analyser
   ============================================================ */

const Compare = (() => {

  const MAX_PERIODS = 10;
  const PERIOD_COLORS = [
    '#58a6ff', // A - blue
    '#f85149', // B - red
    '#3fb950', // C - green
    '#bc8cff', // D - purple
    '#d29922', // E - yellow
    '#f778ba', // F - pink
    '#e07b39', // G - orange
    '#39c5c8', // H - teal
    '#a0c4ff', // I - light blue
    '#ff9a3c', // J - amber
  ];

  const PERIOD_LABELS = ['A','B','C','D','E','F','G','H','I','J'];

  // State: array of { id, label, dateFrom, dateTo, color }
  let periods = [];
  let onChangeCallback = null;

  // ── Initialise ───────────────────────────────────────────
  function init(onChange) {
    onChangeCallback = onChange;
    _setupAddButton();
  }

  // ── Add a new period ─────────────────────────────────────
  function addPeriod() {
    if (periods.length >= MAX_PERIODS) {
      Utils.toast(`Maximum ${MAX_PERIODS} comparison periods reached`, 'warn');
      return;
    }
    const idx = periods.length;
    const period = {
      id:       `period-${Date.now()}`,
      label:    PERIOD_LABELS[idx],
      dateFrom: null,
      dateTo:   null,
      color:    PERIOD_COLORS[idx],
    };
    periods.push(period);
    _renderPeriod(period);
    _updateAddButton();
  }

  // ── Remove a period ──────────────────────────────────────
  function removePeriod(id) {
    periods = periods.filter(p => p.id !== id);
    // Re-label remaining periods
    periods.forEach((p, i) => {
      p.label = PERIOD_LABELS[i];
      p.color = PERIOD_COLORS[i];
    });
    _rebuildAll();
    if (onChangeCallback) onChangeCallback();
  }

  // ── Reset a period's dates ───────────────────────────────
  function resetPeriod(id) {
    const p = periods.find(p => p.id === id);
    if (!p) return;
    p.dateFrom = null;
    p.dateTo   = null;
    const fromEl = document.getElementById(`from-${p.id}`);
    const toEl   = document.getElementById(`to-${p.id}`);
    if (fromEl) fromEl.value = '';
    if (toEl)   toEl.value   = '';
    if (onChangeCallback) onChangeCallback();
  }

  // ── Get filtered data for each period ───────────────────
  function applyAll(allData, baseFilters) {
    return periods.map(p => {
      if (!p.dateFrom || !p.dateTo) return null;
      return {
        label: p.label,
        color: p.color,
        dateFrom: p.dateFrom,
        dateTo:   p.dateTo,
        data: allData.filter(r => {
          if (!r.arrival_time) return false;
          const d = new Date(r.arrival_time);
          if (isNaN(d)) return false;
          if (d < new Date(p.dateFrom)) return false;
          if (d > new Date(p.dateTo + 'T23:59:59')) return false;
          // Apply base filters (disposal, triage, trauma) but NOT date range
          if (baseFilters.disposals?.length && !baseFilters.disposals.includes(r.disposal)) return false;
          if (baseFilters.triage && r.triage_category !== baseFilters.triage) return false;
          if (baseFilters.traumas?.length && !baseFilters.traumas.includes(r.trauma)) return false;
          return true;
        })
      };
    }).filter(Boolean);
  }

  // ── Get periods with data ────────────────────────────────
  function getPeriods() { return [...periods]; }
  function hasPeriods()  { return periods.some(p => p.dateFrom && p.dateTo); }
  function getColors()   { return PERIOD_COLORS; }

  // ── Render all periods from scratch ─────────────────────
  function _rebuildAll() {
    const container = document.getElementById('compare-periods-container');
    if (!container) return;
    container.innerHTML = '';
    periods.forEach(p => _renderPeriod(p));
    _updateAddButton();
  }

  // ── Render a single period row ───────────────────────────
  function _renderPeriod(period) {
    const container = document.getElementById('compare-periods-container');
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'compare-period-row';
    row.id = `row-${period.id}`;
    row.innerHTML = `
      <div class="compare-period-label" style="background:${period.color}20;border-color:${period.color}50;color:${period.color}">
        Period ${period.label}
      </div>
      <div class="filter-group" style="min-width:130px">
        <label class="filter-label">From</label>
        <input type="date" id="from-${period.id}" class="filter-input" value="${period.dateFrom || ''}">
      </div>
      <div class="filter-group" style="min-width:130px">
        <label class="filter-label">To</label>
        <input type="date" id="to-${period.id}" class="filter-input" value="${period.dateTo || ''}">
      </div>
      <div class="compare-period-actions">
        <button class="btn btn-ghost compare-reset-btn" title="Reset dates" onclick="Compare.resetPeriod('${period.id}')">↺ Reset</button>
        <button class="btn btn-ghost compare-delete-btn" title="Delete period" onclick="Compare.removePeriod('${period.id}')">✕ Delete</button>
      </div>
    `;

    container.appendChild(row);

    // Wire date inputs
    document.getElementById(`from-${period.id}`)?.addEventListener('change', e => {
      period.dateFrom = e.target.value || null;
      if (onChangeCallback) onChangeCallback();
    });
    document.getElementById(`to-${period.id}`)?.addEventListener('change', e => {
      period.dateTo = e.target.value || null;
      if (onChangeCallback) onChangeCallback();
    });
  }

  // ── Setup Add Period button ──────────────────────────────
  function _setupAddButton() {
    const btn = document.getElementById('btn-add-period');
    if (btn) btn.addEventListener('click', () => addPeriod());
  }

  function _updateAddButton() {
    const btn = document.getElementById('btn-add-period');
    if (btn) {
      btn.disabled = periods.length >= MAX_PERIODS;
      btn.textContent = periods.length === 0
        ? '+ Add comparison period'
        : `+ Add Period ${PERIOD_LABELS[periods.length] || ''}`;
    }
  }

  // ── Clear all periods ────────────────────────────────────
  function clearAll() {
    periods = [];
    _rebuildAll();
    if (onChangeCallback) onChangeCallback();
  }

  return { init, addPeriod, removePeriod, resetPeriod, applyAll,
           getPeriods, hasPeriods, getColors, clearAll };

})();
