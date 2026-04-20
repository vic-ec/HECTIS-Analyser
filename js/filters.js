/* ============================================================
   filters.js — Global filter state & application
   HECTIS Analyser — v3: multi-select + comparison period
   ============================================================ */

const Filters = (() => {

  let state = {
    dateFrom:     null,
    dateTo:       null,
    disposals:    [],    // multi-select array
    triage:       null,  // single-select
    traumas:      [],    // multi-select array
    locations:    [],    // multi-select array
    stat:         'median', // median | mean | p25 | p75 | p90

  };

  let onChangeCallback = null;

  // ── Validate location value ─────────────────────────────
  function isValidLocation(v) {
    if (!v || v === '-') return false;
    if (/\d{1,4}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(v)) return false;
    if (/\d{1,2}:\d{2}/.test(v)) return false;
    return /[A-Za-z]/.test(v);
  }

  // ── Validate trauma value ────────────────────────────────
  function isValidTrauma(v) {
    if (!v || v === '-') return false;
    if (/\d{1,4}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(v)) return false;
    if (/\d{1,2}:\d{2}/.test(v)) return false;
    if (!/[A-Za-z]/.test(v)) return false;
    return true;
  }

  // ── Apply primary filters ────────────────────────────────
  function apply(data) {
    return _applyState(data, state);
  }

  function applyB(data) { return null; } // Legacy - use Compare module

  function _applyState(data, s) {
    // Pre-compute once outside the loop — critical for 137k record performance
    // If array has items, filter to them. If empty, no filter (all pass).
    // Note: when all items selected, every value matches → same result as no filter
    const dispSet   = s.disposals.length  > 0 ? new Set(s.disposals)  : null;
    const traumaSet = s.traumas.length    > 0 ? new Set(s.traumas)    : null;
    const locSet    = s.locations.length  > 0 ? new Set(s.locations)  : null;
    const dateFrom     = s.dateFrom ? new Date(s.dateFrom).getTime() : null;
    const dateTo       = s.dateTo   ? new Date(s.dateTo + 'T23:59:59').getTime() : null;

    return data.filter(r => {
      if (dispSet  && !dispSet.has(r.disposal))          return false;
      if (s.triage && r.triage_category !== s.triage)    return false;
      if (traumaSet && !traumaSet.has(r.trauma))         return false;
      if (locSet   && !locSet.has(r.location))           return false;
      if (dateFrom !== null || dateTo !== null) {
        const t = r.arrival_time ? new Date(r.arrival_time).getTime() : NaN;
        if (isNaN(t)) return false;
        if (dateFrom !== null && t < dateFrom) return false;
        if (dateTo   !== null && t > dateTo)   return false;
      }
      return true;
    });
  }

  // ── Populate dropdowns ───────────────────────────────────
  function populate(data) {
    const disposals = Utils.unique(data.map(r => r.disposal).filter(Boolean));
    const triages   = ['Red','Orange','Yellow','Green'].filter(t => data.some(r => r.triage_category === t));
    const traumaRaw = Utils.unique(data.map(r => r.trauma).filter(v => v && isValidTrauma(v)));
    // No Trauma first, then rest alphabetically
    const traumas = [
      ...traumaRaw.filter(v => v === 'No Trauma'),
      ...traumaRaw.filter(v => v !== 'No Trauma').sort()
    ];

    // Locations: wards first (alpha), then outcome locations
    const locationRaw = Utils.unique(data.map(r => r.location).filter(v => v && isValidLocation(v)));
    const OUTCOME_LOCS = new Set(['Home','Discharged Home by Discipline','Discharged Home',
      'Transferred Out','Transferred Out by Discipline','Bereavement Room',
      'Mortuary','Mortuary Contract','Mortuary Forensic(Salt River)','OPD','Clinical Forensics Unit']);
    const locations = [
      ...locationRaw.filter(v => !OUTCOME_LOCS.has(v)).sort(),
      ...locationRaw.filter(v =>  OUTCOME_LOCS.has(v)).sort(),
    ];

    // Pre-populate ALL items so "all selected" state is explicit
    // This way: full array = "All X", empty array = "Please select...", partial = count
    if (state.disposals.length === 0 && disposals.length > 0) state.disposals.push(...disposals);
    if (state.traumas.length   === 0 && traumas.length   > 0) state.traumas.push(...traumas);
    if (state.locations.length === 0 && locations.length > 0) state.locations.push(...locations);
    // Store total counts so _applyState can short-circuit when all selected
    state._totalDisposals  = disposals.length;
    state._totalTraumas    = traumas.length;
    state._totalLocations  = locations.length;

    // But _applyState must treat full array same as empty (no filter) - already does this

    // Empty array = all selected = no filter applied (correct default state)
    // Do NOT pre-populate - empty means "all" in _applyState

    _buildMultiSelect('filter-disposal-wrap', 'filter-disposal', disposals, state.disposals, 'All Disposals', v => Utils.shortDiscipline(v));
    _setOptions('filter-triage', triages, 'All Triage');
    _buildMultiSelect('filter-trauma-wrap', 'filter-trauma', traumas, state.traumas, 'All Trauma', v => v);
    if (document.getElementById('filter-location-wrap')) {
      _buildMultiSelect('filter-location-wrap', 'filter-location', locations, state.locations, 'All Locations', v => v);
    }

    // Ensure trigger labels show placeholder when all/none selected
    _syncTriggerLabel('filter-disposal',  state.disposals,  disposals,  'All Disposals');
    _syncTriggerLabel('filter-trauma',    state.traumas,    traumas,    'All Trauma');
    _syncTriggerLabel('filter-location',  state.locations,  locations,  'All Locations');

    // Date range from data — constrain all date pickers to actual data range
    const dates = data.map(r => r.arrival_time).filter(Boolean).sort();
    if (dates.length) {
      // Ensure strict YYYY-MM-DD format for HTML date input min/max
      const toYMD = s => {
        const d = new Date(s);
        if (isNaN(d)) return s.slice(0, 10);
        return d.toISOString().slice(0, 10);
      };
      const minDate = toYMD(dates[0]);
      const maxDate = toYMD(dates[dates.length - 1]);

      // Store globally so compare.js can use them too
      window.__hectisMinDate = minDate;
      window.__hectisMaxDate = maxDate;

      // Main filter date pickers
      const fromEl = document.getElementById('filter-date-from');
      const toEl   = document.getElementById('filter-date-to');
      if (fromEl) {
        fromEl.min = minDate;
        fromEl.max = maxDate;
        if (!fromEl.value) fromEl.value = minDate;
      }
      if (toEl) {
        toEl.min = minDate;
        toEl.max = maxDate;
        if (!toEl.value) toEl.value = maxDate;
      }

      // Update state to match
      if (!state.dateFrom) state.dateFrom = minDate;
      if (!state.dateTo)   state.dateTo   = maxDate;

      // Show data range hint
      const hintEl = document.getElementById('date-range-hint');
      if (hintEl) {
        const fmt = d => new Date(d).toLocaleDateString('en-ZA', { day:'2-digit', month:'short', year:'numeric' });
        hintEl.textContent = `Available data: ${fmt(minDate)} – ${fmt(maxDate)}`;
      }
    }
  }

  // ── Build multi-select dropdown ──────────────────────────
  function _buildMultiSelect(wrapperId, triggerId, values, selected, placeholder, labelFn) {
    const wrapper = document.getElementById(wrapperId);
    if (!wrapper) return;

    // Build selected label
    // All selected = same as none selected = show placeholder ("All Disposals" etc)
    const trigger = document.getElementById(triggerId);
    if (trigger) {
      // All selected = placeholder, none = "Please select...", partial = count
      trigger.textContent = selected.length === values.length ? placeholder
        : selected.length === 0 ? 'Please select…'
        : selected.length === 1 ? labelFn(selected[0])
        : `${selected.length} selected`;
    }

    // Build or update dropdown list
    let list = wrapper.querySelector('.multiselect-list');
    if (!list) {
      list = document.createElement('div');
      list.className = 'multiselect-list';
      wrapper.appendChild(list);
    }

    const allChecked = values.length > 0 && values.every(v => selected.includes(v));
    // Label for Select All matches the placeholder (All Disposals / All Trauma)
    list.innerHTML = `
      <label class="multiselect-item multiselect-select-all ${allChecked ? 'checked' : ''}">
        <input type="checkbox" class="select-all-cb" ${allChecked ? 'checked' : ''}>
        <span class="select-all-label" style="font-weight:600;color:var(--text)">${placeholder}</span>
      </label>
      <div style="height:1px;background:var(--border);margin:0.25rem 0"></div>
    ` + values.map(v => `
      <label class="multiselect-item ${selected.includes(v) ? 'checked' : ''}">
        <input type="checkbox" value="${v}" ${selected.includes(v) ? 'checked' : ''}>
        <span>${labelFn(v)}</span>
      </label>
    `).join('');

    // Wire Select All checkbox
    const selectAllCb = list.querySelector('.select-all-cb');
    if (selectAllCb) {
      selectAllCb.addEventListener('change', () => {
        const arr = wrapperId.includes('disposal') ? state.disposals : state.traumas;
        arr.length = 0;
        list.querySelectorAll('input[type=checkbox]:not(.select-all-cb)').forEach(cb => {
          cb.checked = selectAllCb.checked;
          const item = cb.closest('.multiselect-item');
          if (selectAllCb.checked) {
            if (!arr.includes(cb.value)) arr.push(cb.value);
            item.classList.add('checked');
          } else {
            item.classList.remove('checked');
          }
        });
        selectAllCb.closest('.multiselect-item').classList.toggle('checked', selectAllCb.checked);
        const trigger = document.getElementById(triggerId);
        if (trigger) {
          trigger.textContent = selectAllCb.checked ? placeholder : 'Please select…';
        }
        if (onChangeCallback) onChangeCallback();
      });
    }

    // Wire checkboxes — map wrapper ID to correct state array
    const _stateArr = () => wrapperId.includes('disposal') ? state.disposals
                           : wrapperId.includes('trauma')  ? state.traumas
                           : wrapperId.includes('location') ? state.locations
                           : [];
    list.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', () => {
        const val = cb.value;
        const arr = _stateArr();
        if (cb.checked) {
          if (!arr.includes(val)) arr.push(val);
          cb.closest('.multiselect-item').classList.add('checked');
        } else {
          const idx = arr.indexOf(val);
          if (idx > -1) arr.splice(idx, 1);
          cb.closest('.multiselect-item').classList.remove('checked');
        }
        // Update trigger label
        const trigger = document.getElementById(triggerId);
        if (trigger) {
          const total = list.querySelectorAll('input[type=checkbox]:not(.select-all-cb)').length;
          trigger.textContent = arr.length === total    ? placeholder
            : arr.length === 0                         ? 'Please select…'
            : arr.length === 1                         ? labelFn(arr[0])
            : `${arr.length} selected`;
        }
        if (onChangeCallback) onChangeCallback();
      });
    });
  }

  // ── Sync trigger label to current selection state ──────────
  function _syncTriggerLabel(triggerId, arr, allValues, placeholder) {
    const el = document.getElementById(triggerId);
    if (!el) return;
    el.textContent = arr.length === allValues.length ? placeholder
      : arr.length === 0                             ? 'Please select…'
      : arr.length === 1                             ? arr[0]
      : arr.length + ' selected';
  }

  // ── Standard single-select ───────────────────────────────
  function _setOptions(id, values, placeholder) {
    const el = document.getElementById(id);
    if (!el) return;
    const current = el.value;
    el.innerHTML = `<option value="">${placeholder}</option>`;
    values.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      if (v === current) opt.selected = true;
      el.appendChild(opt);
    });
  }

  // ── Setup multi-select toggle behaviour ──────────────────
  function _setupMultiSelectToggles() {
    // Use event delegation — works for all multiselect triggers including location
    // which is built after initial bind() call
    document.addEventListener('click', e => {
      const trigger = e.target.closest('.multiselect-trigger');
      if (trigger) {
        e.stopPropagation();
        const wrap = trigger.closest('.multiselect-wrap');
        const list = wrap?.querySelector('.multiselect-list');
        if (!list) return;
        const isOpen = list.classList.contains('open');
        document.querySelectorAll('.multiselect-list.open').forEach(l => l.classList.remove('open'));
        if (!isOpen) list.classList.add('open');
        return;
      }
      // Click outside — close all
      if (!e.target.closest('.multiselect-wrap')) {
        document.querySelectorAll('.multiselect-list.open').forEach(l => l.classList.remove('open'));
      }
    });
  }

  // ── Bind all controls ────────────────────────────────────
  function bind(onChange) {
    onChangeCallback = onChange;
    _setupMultiSelectToggles();

    // Location multi-select toggle
    document.querySelectorAll('#filter-location-wrap .multiselect-trigger').forEach(t => {
      t.addEventListener('click', e => {
        e.stopPropagation();
        const wrap = t.closest('.multiselect-wrap');
        const list = wrap.querySelector('.multiselect-list');
        const isOpen = list.classList.contains('open');
        document.querySelectorAll('.multiselect-list.open').forEach(l => l.classList.remove('open'));
        if (!isOpen) list.classList.add('open');
      });
    });

    // Stat selector
    const statEl = document.getElementById('filter-stat');
    if (statEl) {
      statEl.value = state.stat;
      statEl.addEventListener('change', () => {
        state.stat = statEl.value;
        if (onChangeCallback) onChangeCallback();
      });
    }

    // Triage single-select
    const triageEl = document.getElementById('filter-triage');
    if (triageEl) {
      triageEl.addEventListener('change', () => {
        state.triage = triageEl.value || null;
        if (onChangeCallback) onChangeCallback();
      });
    }

    // Date range A
    ['filter-date-from','filter-date-to'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', () => {
        state.dateFrom = document.getElementById('filter-date-from')?.value || null;
        state.dateTo   = document.getElementById('filter-date-to')?.value   || null;
        if (onChangeCallback) onChangeCallback();
      });
    });

    // Compare toggle now handled by Compare module

    // Reset
    const resetBtn = document.getElementById('btn-reset-filters');
    if (resetBtn) resetBtn.addEventListener('click', reset);
  }

  // ── Reset ────────────────────────────────────────────────
  function reset() {
    state.disposals = [];
    state.triage    = null;
    state.traumas   = [];
    // Reset dates to full data range (not null — null means no filter but empty pickers look broken)
    state.dateFrom = window.__hectisMinDate || null;
    state.dateTo   = window.__hectisMaxDate || null;
    state.stat     = 'median';
    const statEl2 = document.getElementById('filter-stat');
    if (statEl2) statEl2.value = 'median';


    document.getElementById('filter-triage') && (document.getElementById('filter-triage').value = '');
    // Restore date pickers to full data range on reset
    const fromEl = document.getElementById('filter-date-from');
    const toEl   = document.getElementById('filter-date-to');
    if (fromEl && window.__hectisMinDate) fromEl.value = window.__hectisMinDate;
    if (toEl   && window.__hectisMaxDate) toEl.value   = window.__hectisMaxDate;
    // Clear comparison period date pickers
    ['filter-date-from-b','filter-date-to-b'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

    // Reset multi-select checkboxes visually — state arrays already cleared above
    document.querySelectorAll('.multiselect-item.checked').forEach(item => {
      item.classList.remove('checked');
      const cb = item.querySelector('input');
      if (cb) cb.checked = false;
    });
    // Restore trigger labels to their placeholders (not "Please select…")
    document.querySelectorAll('.multiselect-trigger').forEach(t => {
      t.textContent = t.dataset.placeholder || 'All';
    });

    // Hide compare panel
    const comparePanel = document.getElementById('compare-period-panel');
    if (comparePanel) comparePanel.style.display = 'none';
    const compareToggle = document.getElementById('btn-compare-toggle');
    if (compareToggle) compareToggle.classList.remove('active');

    if (onChangeCallback) onChangeCallback();
  }

  function getState() { return { ...state }; }
  function getStat()   { return state.stat || 'median'; }
  function isComparing() { return typeof Compare !== 'undefined' && Compare.hasPeriods(); }

  return { apply, applyB, populate, bind, reset, getState, getStat, isComparing, isValidTrauma, isValidLocation };

})();
