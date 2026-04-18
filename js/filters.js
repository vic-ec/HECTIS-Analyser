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
    // Comparison period B
    compareTo:    false,
    dateFromB:    null,
    dateToB:      null,
  };

  let onChangeCallback = null;

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

  // ── Apply comparison period B filters ───────────────────
  function applyB(data) {
    if (!state.compareTo || !state.dateFromB || !state.dateToB) return null;
    return _applyState(data, { ...state, dateFrom: state.dateFromB, dateTo: state.dateToB });
  }

  function _applyState(data, s) {
    return data.filter(r => {
      if (s.disposals.length && !s.disposals.includes(r.disposal)) return false;
      if (s.triage      && r.triage_category !== s.triage) return false;
      if (s.traumas.length && !s.traumas.includes(r.trauma)) return false;

      if (s.dateFrom) {
        const d = new Date(r.arrival_time);
        if (isNaN(d) || d < new Date(s.dateFrom)) return false;
      }
      if (s.dateTo) {
        const d = new Date(r.arrival_time);
        if (isNaN(d) || d > new Date(s.dateTo + 'T23:59:59')) return false;
      }
      return true;
    });
  }

  // ── Populate dropdowns ───────────────────────────────────
  function populate(data) {
    const disposals = Utils.unique(data.map(r => r.disposal).filter(Boolean));
    const triages   = ['Red','Orange','Yellow','Green'].filter(t => data.some(r => r.triage_category === t));
    const traumas   = Utils.unique(data.map(r => r.trauma).filter(v => v && isValidTrauma(v)));

    _buildMultiSelect('filter-disposal-wrap', 'filter-disposal', disposals, state.disposals, 'All Disposals', v => Utils.shortDiscipline(v));
    _setOptions('filter-triage', triages, 'All Triage');
    _buildMultiSelect('filter-trauma-wrap', 'filter-trauma', traumas, state.traumas, 'All Trauma', v => v);

    // Date range from data
    const dates = data.map(r => r.arrival_time).filter(Boolean).sort();
    if (dates.length) {
      const fromEl = document.getElementById('filter-date-from');
      const toEl   = document.getElementById('filter-date-to');
      if (fromEl && !fromEl.value) fromEl.value = dates[0].slice(0, 10);
      if (toEl   && !toEl.value)   toEl.value   = dates[dates.length - 1].slice(0, 10);
    }
  }

  // ── Build multi-select dropdown ──────────────────────────
  function _buildMultiSelect(wrapperId, triggerId, values, selected, placeholder, labelFn) {
    const wrapper = document.getElementById(wrapperId);
    if (!wrapper) return;

    // Build selected label
    const trigger = document.getElementById(triggerId);
    if (trigger) {
      trigger.textContent = selected.length === 0
        ? placeholder
        : selected.length === 1
          ? labelFn(selected[0])
          : `${selected.length} selected`;
    }

    // Build or update dropdown list
    let list = wrapper.querySelector('.multiselect-list');
    if (!list) {
      list = document.createElement('div');
      list.className = 'multiselect-list';
      wrapper.appendChild(list);
    }

    list.innerHTML = values.map(v => `
      <label class="multiselect-item ${selected.includes(v) ? 'checked' : ''}">
        <input type="checkbox" value="${v}" ${selected.includes(v) ? 'checked' : ''}>
        <span>${labelFn(v)}</span>
      </label>
    `).join('');

    // Wire checkboxes
    list.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', () => {
        const val = cb.value;
        const arr = wrapperId.includes('disposal') ? state.disposals : state.traumas;
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
          trigger.textContent = arr.length === 0 ? placeholder
            : arr.length === 1 ? labelFn(arr[0])
            : `${arr.length} selected`;
        }
        if (onChangeCallback) onChangeCallback();
      });
    });
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
    document.addEventListener('click', e => {
      // Close all open dropdowns when clicking outside
      if (!e.target.closest('.multiselect-wrap')) {
        document.querySelectorAll('.multiselect-list.open').forEach(l => l.classList.remove('open'));
      }
    });

    document.querySelectorAll('.multiselect-trigger').forEach(trigger => {
      trigger.addEventListener('click', e => {
        e.stopPropagation();
        const wrap = trigger.closest('.multiselect-wrap');
        const list = wrap.querySelector('.multiselect-list');
        const isOpen = list.classList.contains('open');
        // Close all others
        document.querySelectorAll('.multiselect-list.open').forEach(l => l.classList.remove('open'));
        if (!isOpen) list.classList.add('open');
      });
    });
  }

  // ── Bind all controls ────────────────────────────────────
  function bind(onChange) {
    onChangeCallback = onChange;
    _setupMultiSelectToggles();

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

    // Comparison toggle
    const compareToggle = document.getElementById('btn-compare-toggle');
    if (compareToggle) {
      compareToggle.addEventListener('click', () => {
        state.compareTo = !state.compareTo;
        compareToggle.classList.toggle('active', state.compareTo);
        const comparePanel = document.getElementById('compare-period-panel');
        if (comparePanel) comparePanel.style.display = state.compareTo ? 'flex' : 'none';
        if (onChangeCallback) onChangeCallback();
      });
    }

    // Date range B
    ['filter-date-from-b','filter-date-to-b'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', () => {
        state.dateFromB = document.getElementById('filter-date-from-b')?.value || null;
        state.dateToB   = document.getElementById('filter-date-to-b')?.value   || null;
        if (onChangeCallback) onChangeCallback();
      });
    });

    // Reset
    const resetBtn = document.getElementById('btn-reset-filters');
    if (resetBtn) resetBtn.addEventListener('click', reset);
  }

  // ── Reset ────────────────────────────────────────────────
  function reset() {
    state.disposals = [];
    state.triage    = null;
    state.traumas   = [];
    state.dateFrom  = null;
    state.dateTo    = null;
    state.compareTo = false;
    state.dateFromB = null;
    state.dateToB   = null;

    document.getElementById('filter-triage') && (document.getElementById('filter-triage').value = '');
    ['filter-date-from','filter-date-to','filter-date-from-b','filter-date-to-b'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

    // Reset multi-select checkboxes
    document.querySelectorAll('.multiselect-item.checked').forEach(item => {
      item.classList.remove('checked');
      const cb = item.querySelector('input');
      if (cb) cb.checked = false;
    });
    document.querySelectorAll('.multiselect-trigger').forEach(t => {
      const placeholder = t.dataset.placeholder || 'All';
      t.textContent = placeholder;
    });

    // Hide compare panel
    const comparePanel = document.getElementById('compare-period-panel');
    if (comparePanel) comparePanel.style.display = 'none';
    const compareToggle = document.getElementById('btn-compare-toggle');
    if (compareToggle) compareToggle.classList.remove('active');

    if (onChangeCallback) onChangeCallback();
  }

  function getState() { return { ...state }; }
  function isComparing() { return state.compareTo && state.dateFromB && state.dateToB; }

  return { apply, applyB, populate, bind, reset, getState, isComparing, isValidTrauma };

})();
