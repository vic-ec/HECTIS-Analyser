/* ============================================================
   tabfilters.js — Per-tab independent filter management
   HECTIS Analyser
   ============================================================ */

const TabFilters = (() => {

  // Tabs that get independent filters
  const FILTER_TABS = ['overview','access-block','time-patterns','locations','triage-compliance','trauma','compare'];

  // Filter state per tab — all start as "all selected"
  const tabState = {};

  // Available option lists (populated from data)
  let _disposals  = [];
  let _traumas    = [];
  let _locations  = [];
  let _onChangeCallbacks = {}; // tab → callback

  // ── Initialise state for all tabs ──────────────────────
  function init() {
    FILTER_TABS.forEach(tab => {
      tabState[tab] = _emptyState();
    });
  }

  function _emptyState() {
    return {
      dateFrom:  null,
      dateTo:    null,
      disposals: [],  // empty = all
      triage:    null,
      traumas:   [],  // empty = all
      locations: [],  // empty = all
      stat:      'median',
    };
  }

  // ── Populate available options from data ────────────────
  function populate(data) {
    // Set default date ranges from data for all tabs
    const dates = data.map(r => r.arrival_time).filter(Boolean).sort();
    if (dates.length) {
      const toYMD = s => new Date(s).toISOString().slice(0, 10);
      const minD = toYMD(dates[0]);
      const maxD = toYMD(dates[dates.length - 1]);
      window.__hectisMinDate = minD;
      window.__hectisMaxDate = maxD;
      FILTER_TABS.forEach(tab => {
        const s = tabState[tab];
        if (!s.dateFrom) s.dateFrom = minD;
        if (!s.dateTo)   s.dateTo   = maxD;
      });
    }
    _disposals  = Utils.unique(data.map(r => r.disposal).filter(Boolean)).sort();
    const traumaRaw = Utils.unique(data.map(r => r.trauma).filter(v => v && _isValidTrauma(v)));
    _traumas    = ['No Trauma', ...traumaRaw.filter(v => v !== 'No Trauma').sort()];
    const locRaw = Utils.unique(data.map(r => r.location).filter(v => v && _isValidLocation(v)));
    const OUTCOME = new Set(['Home','Discharged Home by Discipline','Discharged Home',
      'Transferred Out','Transferred Out by Discipline','Bereavement Room',
      'Mortuary','Mortuary Contract','Mortuary Forensic(Salt River)','OPD','Clinical Forensics Unit']);
    _locations = [...locRaw.filter(v => !OUTCOME.has(v)).sort(), ...locRaw.filter(v => OUTCOME.has(v)).sort()];

    // Rebuild all tab filter UIs
    FILTER_TABS.forEach(tab => _buildTabFilterUI(tab));
  }

  // ── Apply filters for a specific tab ───────────────────
  function apply(tab, allData) {
    const s = tabState[tab] || _emptyState();
    const dispSet  = s.disposals.length  > 0 ? new Set(s.disposals)  : null;
    const traumaSet = s.traumas.length   > 0 ? new Set(s.traumas)    : null;
    const locSet   = s.locations.length  > 0 ? new Set(s.locations)  : null;

    const dateFrom = s.dateFrom ? new Date(s.dateFrom).getTime() : null;
    const dateTo   = s.dateTo   ? new Date(s.dateTo + 'T23:59:59').getTime() : null;

    return allData.filter(r => {
      if (dispSet   && !dispSet.has(r.disposal))         return false;
      if (s.triage  && r.triage_category !== s.triage)   return false;
      if (traumaSet && !traumaSet.has(r.trauma))         return false;
      if (locSet    && !locSet.has(r.location))          return false;
      if (dateFrom !== null || dateTo !== null) {
        const t = r.arrival_time ? new Date(r.arrival_time).getTime() : NaN;
        if (isNaN(t)) return false;
        if (dateFrom !== null && t < dateFrom) return false;
        if (dateTo   !== null && t > dateTo)   return false;
      }
      return true;
    });
  }

  function getStat(tab) {
    return (tabState[tab] || _emptyState()).stat;
  }

  function getState(tab) {
    return { ...(tabState[tab] || _emptyState()) };
  }

  function onTabChange(tab, callback) {
    _onChangeCallbacks[tab] = callback;
  }

  function _notify(tab) {
    if (_onChangeCallbacks[tab]) _onChangeCallbacks[tab]();
  }

  // ── Reset a tab's filters ───────────────────────────────
  function resetTab(tab) {
    tabState[tab] = _emptyState();
    _buildTabFilterUI(tab);
    _notify(tab);
  }

  // ── Build filter UI inside a tab ────────────────────────
  function _buildTabFilterUI(tab) {
    const container = document.getElementById(`tab-filter-${tab}`);
    if (!container) return;

    const s = tabState[tab] || _emptyState();
    const TRIAGES = ['Red','Orange','Yellow','Green'];

    const minD = window.__hectisMinDate || '';
    const maxD = window.__hectisMaxDate || '';
    const fromVal = s.dateFrom || minD;
    const toVal   = s.dateTo   || maxD;
    const reportBtn = tab === 'overview'
      ? `<div class="filter-group" style="align-self:flex-end">
           <button class="btn btn-secondary" id="btn-generate-report" style="margin-bottom:0.1rem">🖨 Report</button>
         </div>` : '';

    container.innerHTML = `
      <div class="tab-filter-bar">
        <div class="tab-filter-row">
          <div class="filter-group">
            <label class="filter-label">From</label>
            <input type="date" class="filter-input tf-date-from" data-tab="${tab}"
              value="${fromVal}" min="${minD}" max="${maxD}">
          </div>
          <div class="filter-group">
            <label class="filter-label">To</label>
            <input type="date" class="filter-input tf-date-to" data-tab="${tab}"
              value="${toVal}" min="${minD}" max="${maxD}">
          </div>
          ${_buildMultiSelectHTML(tab, 'disposals', 'Disposals', _disposals, s.disposals, v => Utils.shortDiscipline(v))}
          ${_buildSingleSelectHTML(tab, 'triage', 'Triage', TRIAGES, s.triage)}
          ${_buildMultiSelectHTML(tab, 'traumas', 'Trauma', _traumas, s.traumas, v => v)}
          ${_buildMultiSelectHTML(tab, 'locations', 'Location', _locations, s.locations, v => v)}
          <div class="filter-group">
            <label class="filter-label">Statistic</label>
            <select class="filter-select tab-stat-sel" data-tab="${tab}">
              <option value="median" ${s.stat==='median'?'selected':''}>Median</option>
              <option value="mean"   ${s.stat==='mean'  ?'selected':''}>Mean</option>
              <option value="p25"    ${s.stat==='p25'   ?'selected':''}>25th %ile</option>
              <option value="p75"    ${s.stat==='p75'   ?'selected':''}>75th %ile</option>
              <option value="p90"    ${s.stat==='p90'   ?'selected':''}>90th %ile</option>
            </select>
          </div>
          <div class="filter-group" style="align-self:flex-end;display:flex;gap:0.35rem">
            <button class="btn btn-ghost" onclick="TabFilters.resetTab('${tab}')" style="margin-bottom:0.1rem" title="Reset tab filters">↺ Reset</button>
            ${reportBtn}
          </div>
        </div>
        <div id="tab-date-hint-${tab}" style="font-size:0.65rem;font-family:var(--font-mono);color:var(--text-dim);margin-top:0.3rem"></div>
      </div>`;

    _bindTabFilterEvents(tab, container, s);

    // Wire Report button if present
    const reportBtn2 = container.querySelector('#btn-generate-report');
    if (reportBtn2) {
      reportBtn2.addEventListener('click', () => {
        const data = window.__hectisFiltered || [];
        if (!data.length) { Utils.toast('No data loaded yet', 'warn'); return; }
        if (typeof Report !== 'undefined') { try { Report.generate(data); } catch(e) { Utils.toast('Report error: ' + e.message, 'error'); } } else { Utils.toast('Report module not ready — try again', 'warn'); }
      });
    }

    // Update date range hint
    _updateDateHint(tab);
  }

  function _updateDateHint(tab) {
    const hint = document.getElementById('tab-date-hint-' + tab);
    if (!hint || !window.__hectisMinDate) return;
    const fmt = d => new Date(d).toLocaleDateString('en-ZA', { day:'2-digit', month:'short', year:'numeric' });
    hint.textContent = 'Available: ' + fmt(window.__hectisMinDate) + ' – ' + fmt(window.__hectisMaxDate);
  }

  function _buildMultiSelectHTML(tab, field, label, values, selected, labelFn) {
    const id = `tf-${tab}-${field}`;
    const allSelected = selected.length === 0 || selected.length === values.length;
    const triggerText = allSelected ? `All ${label}`
      : selected.length === 1 ? labelFn(selected[0])
      : `${selected.length} selected`;
    const allChecked = values.length > 0 && values.every(v => selected.includes(v));

    const opts = values.map(v => {
      const checked = selected.includes(v);
      return `<label class="multiselect-item ${checked?'checked':''}">
        <input type="checkbox" value="${String(v).replace(/"/g,'&quot;')}" ${checked?'checked':''}> <span>${labelFn(v)}</span>
      </label>`;
    }).join('');

    return `<div class="filter-group" style="position:relative">
      <label class="filter-label">${label}</label>
      <div class="multiselect-wrap" id="${id}-wrap">
        <button class="multiselect-trigger filter-select" id="${id}-btn">${triggerText}</button>
        <div class="multiselect-list" id="${id}-list">
          <label class="multiselect-item multiselect-select-all ${allChecked?'checked':''}">
            <input type="checkbox" class="tf-select-all" data-field="${field}" ${allChecked?'checked':''}> <span style="font-weight:600">All ${label}</span>
          </label>
          <div style="height:1px;background:var(--border);margin:0.25rem 0"></div>
          ${opts}
        </div>
      </div>
    </div>`;
  }

  function _buildSingleSelectHTML(tab, field, label, values, selected) {
    const opts = values.map(v =>
      `<option value="${v}" ${selected===v?'selected':''}>${v}</option>`
    ).join('');
    return `<div class="filter-group">
      <label class="filter-label">${label}</label>
      <select class="filter-select tf-single" data-tab="${tab}" data-field="${field}">
        <option value="">All ${label}</option>${opts}
      </select>
    </div>`;
  }

  // ── Bind events in a tab filter bar ────────────────────
  function _bindTabFilterEvents(tab, container, s) {
    const state = tabState[tab];

    // Multiselect toggles (open/close)
    container.querySelectorAll('.multiselect-trigger').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const list = btn.closest('.multiselect-wrap').querySelector('.multiselect-list');
        const isOpen = list.classList.contains('open');
        // Close all open lists in this tab
        container.querySelectorAll('.multiselect-list.open').forEach(l => l.classList.remove('open'));
        if (!isOpen) list.classList.add('open');
      });
    });

    // Close on outside click
    document.addEventListener('click', e => {
      if (!e.target.closest('.multiselect-wrap')) {
        container.querySelectorAll('.multiselect-list.open').forEach(l => l.classList.remove('open'));
      }
    });

    // Select All checkboxes
    container.querySelectorAll('.tf-select-all').forEach(cb => {
      cb.addEventListener('change', () => {
        const field = cb.dataset.field;
        const list  = cb.closest('.multiselect-list');
        const items = list.querySelectorAll('input[type=checkbox]:not(.tf-select-all)');
        items.forEach(item => {
          item.checked = cb.checked;
          item.closest('.multiselect-item')?.classList.toggle('checked', cb.checked);
        });
        cb.closest('.multiselect-item')?.classList.toggle('checked', cb.checked);

        if (cb.checked) {
          state[field] = [];  // empty = all
        } else {
          state[field] = []; // also empty but means "none" — shown as "Please select"
        }

        _updateTrigger(container, tab, field, cb.checked ? null : 'none');
        _notify(tab);
      });
    });

    // Individual checkboxes
    container.querySelectorAll('.multiselect-list').forEach(list => {
      const selectAll = list.querySelector('.tf-select-all');
      const field = selectAll?.dataset.field;
      if (!field) return;

      list.querySelectorAll('input[type=checkbox]:not(.tf-select-all)').forEach(cb => {
        cb.addEventListener('change', () => {
          const val = cb.value;
          if (cb.checked) {
            if (!state[field].includes(val)) state[field].push(val);
            cb.closest('.multiselect-item')?.classList.add('checked');
          } else {
            state[field] = state[field].filter(v => v !== val);
            cb.closest('.multiselect-item')?.classList.remove('checked');
          }

          // Update select-all state
          const all = list.querySelectorAll('input[type=checkbox]:not(.tf-select-all)');
          const allChecked = [...all].every(c => c.checked);
          const noneChecked = [...all].every(c => !c.checked);
          if (selectAll) {
            selectAll.checked = allChecked;
            selectAll.closest('.multiselect-item')?.classList.toggle('checked', allChecked);
          }

          // Update trigger label
          const mode = noneChecked ? 'none' : allChecked ? null : 'partial';
          _updateTrigger(container, tab, field, mode);
          _notify(tab);
        });
      });
    });

    // Single selects (Triage)
    container.querySelectorAll('.tf-single').forEach(sel => {
      sel.addEventListener('change', () => {
        const field = sel.dataset.field;
        state[field] = sel.value || null;
        _notify(tab);
      });
    });

    // Stat selector
    container.querySelectorAll('.tab-stat-sel').forEach(sel => {
      sel.addEventListener('change', () => {
        state.stat = sel.value;
        _notify(tab);
      });
    });
  }

  function _updateTrigger(container, tab, field, mode) {
    const btn = container.querySelector(`#tf-${tab}-${field}-btn`);
    if (!btn) return;
    const state = tabState[tab];
    const arr   = state[field] || [];
    const allVals = field === 'disposals' ? _disposals
                  : field === 'traumas'   ? _traumas
                  : field === 'locations' ? _locations : [];
    const label = field === 'disposals' ? 'Disposals'
                : field === 'traumas'   ? 'Trauma'
                : field === 'locations' ? 'Locations' : field;

    if (mode === 'none') {
      btn.textContent = 'Please select\u2026';
    } else if (arr.length === 0 || arr.length === allVals.length) {
      btn.textContent = `All ${label}`;
    } else if (arr.length === 1) {
      const v = arr[0];
      btn.textContent = field === 'disposals' ? Utils.shortDiscipline(v) : v;
    } else {
      btn.textContent = `${arr.length} selected`;
    }
  }

  function _isValidTrauma(v) {
    if (!v || v === '-') return false;
    if (/\d{1,4}[-/]\d{1,2}[-/]\d{2,4}/.test(v)) return false;
    if (/\d{1,2}:\d{2}/.test(v)) return false;
    return /[A-Za-z]/.test(v);
  }

  function _isValidLocation(v) {
    if (!v || v === '-') return false;
    if (/\d{1,4}[-/]\d{1,2}[-/]\d{2,4}/.test(v)) return false;
    if (/\d{1,2}:\d{2}/.test(v)) return false;
    return /[A-Za-z]/.test(v);
  }

  return { init, populate, apply, getStat, getState, resetTab, onTabChange, FILTER_TABS };

})();
