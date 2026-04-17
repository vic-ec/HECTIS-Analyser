/* ============================================================
   filters.js — Global filter state & application
   HECTIS Analyser
   ============================================================ */

const Filters = (() => {

  let state = {
    dateFrom:   null,
    dateTo:     null,
    disposal:   null,   // discipline
    triage:     null,
    trauma:     null,
  };

  let onChangeCallback = null;

  // ── Apply filters to a dataset ───────────────────────────
  function apply(data) {
    return data.filter(r => {
      if (state.disposal && r.disposal !== state.disposal) return false;
      if (state.triage   && r.triage_category !== state.triage) return false;
      if (state.trauma   && r.trauma !== state.trauma) return false;

      if (state.dateFrom) {
        const d = new Date(r.arrival_time);
        if (isNaN(d) || d < new Date(state.dateFrom)) return false;
      }
      if (state.dateTo) {
        const d = new Date(r.arrival_time);
        if (isNaN(d) || d > new Date(state.dateTo + 'T23:59:59')) return false;
      }

      return true;
    });
  }

  // ── Populate filter dropdowns from data ──────────────────
  function populate(data) {
    const disposals  = Utils.unique(data.map(r => r.disposal).filter(Boolean));
    const triages    = ['Red','Orange','Yellow','Green'].filter(t =>
      data.some(r => r.triage_category === t)
    );
    const traumas    = Utils.unique(data.map(r => r.trauma).filter(Boolean));

    _setOptions('filter-disposal', disposals, 'All Disciplines');
    _setOptions('filter-triage',   triages,   'All Triage');
    _setOptions('filter-trauma',   traumas,   'All Trauma');

    // Date range from data
    const dates = data.map(r => r.arrival_time).filter(Boolean).sort();
    if (dates.length) {
      const fromEl = document.getElementById('filter-date-from');
      const toEl   = document.getElementById('filter-date-to');
      if (fromEl && !fromEl.value) fromEl.value = dates[0].slice(0, 10);
      if (toEl   && !toEl.value)   toEl.value   = dates[dates.length-1].slice(0, 10);
    }
  }

  function _setOptions(id, values, placeholder) {
    const el = document.getElementById(id);
    if (!el) return;
    const current = el.value;
    el.innerHTML = `<option value="">${placeholder}</option>`;
    values.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = Utils.shortDiscipline ? Utils.shortDiscipline(v) : v;
      if (v === current) opt.selected = true;
      el.appendChild(opt);
    });
  }

  // ── Bind filter controls ─────────────────────────────────
  function bind(onChange) {
    onChangeCallback = onChange;

    const bindings = [
      { id: 'filter-disposal',  key: 'disposal'  },
      { id: 'filter-triage',    key: 'triage'    },
      { id: 'filter-trauma',    key: 'trauma'    },
      { id: 'filter-date-from', key: 'dateFrom'  },
      { id: 'filter-date-to',   key: 'dateTo'    },
    ];

    bindings.forEach(({ id, key }) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', () => {
        state[key] = el.value || null;
        if (onChangeCallback) onChangeCallback();
      });
    });

    const resetBtn = document.getElementById('btn-reset-filters');
    if (resetBtn) {
      resetBtn.addEventListener('click', reset);
    }
  }

  // ── Reset all filters ────────────────────────────────────
  function reset() {
    state = { dateFrom: null, dateTo: null, disposal: null, triage: null, trauma: null };
    ['filter-disposal','filter-triage','filter-trauma'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    ['filter-date-from','filter-date-to'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    if (onChangeCallback) onChangeCallback();
  }

  // ── Get current state ────────────────────────────────────
  function getState() { return { ...state }; }

  return { apply, populate, bind, reset, getState };

})();
