/* ============================================================
   utils.js — Shared utilities for HECTIS Analyser
   ============================================================ */

const Utils = (() => {

  // ── Age Parsing ──────────────────────────────────────────
  function parseAge(raw) {
    if (!raw) return null;
    const s = String(raw).trim().toUpperCase();
    const mMatch = s.match(/^(\d+)M$/);
    if (mMatch) return parseFloat(mMatch[1]) / 12;
    const yMatch = s.match(/^(\d+)Y$/);
    if (yMatch) return parseFloat(yMatch[1]);
    const num = parseFloat(s);
    return isNaN(num) ? null : num;
  }

  // ── Minutes Between Two Dates ────────────────────────────
  function minutesBetween(a, b) {
    if (!a || !b) return null;
    return (b.getTime() - a.getTime()) / 60000;
  }

  // ── Format Minutes to Human-Readable ────────────────────
  function formatMinutes(min, short = false) {
    if (min === null || min === undefined || isNaN(min)) return '—';
    if (min < 0) return '—';
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    if (short) {
      if (h === 0) return `${m}m`;
      if (m === 0) return `${h}h`;
      return `${h}h ${m}m`;
    }
    if (h === 0) return `${m} min`;
    if (m === 0) return `${h} hr`;
    return `${h} hr ${m} min`;
  }

  // ── Format Minutes to Hours (1 decimal) ─────────────────
  function toHours(min) {
    if (min === null || min === undefined || isNaN(min)) return null;
    return parseFloat((min / 60).toFixed(1));
  }

  // ── Percentile ───────────────────────────────────────────
  function percentile(arr, p) {
    const sorted = [...arr].filter(v => v !== null && v !== undefined && !isNaN(v) && v >= 0).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const idx = (p / 100) * (sorted.length - 1);
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  function median(arr) { return percentile(arr, 50); }

  // ── Format Date ──────────────────────────────────────────
  function formatDate(d) {
    if (!d) return '—';
    const dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt.getTime())) return '—';
    return dt.toLocaleString('en-ZA', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
  }

  // ── Disposal classification ──────────────────────────────
  // Returns whether a disposal is a referral to an inpatient discipline
  function isReferral(disposal) {
    return disposal && disposal.toLowerCase().startsWith('referred to');
  }

  // ── Discipline Short Labels ──────────────────────────────
  const DISCIPLINE_SHORT = {
    'Referred to Medicine':     'Medicine',
    'Referred to Surgery':      'Surgery',
    'Referred to Paeds':        'Paeds',
    'Referred to Psychiatry':   'Psychiatry',
    'Referred to Orthopaedics': 'Ortho',
    'Referred to Gynae':        'Gynae',
    'Referred to Urology':      'Urology',
    'Discharged':               'Discharged',
    'Discharged to OPD':        'Discharged to OPD',
    'Discharged to Forensics':  'Discharged to Forensics',
    // Legacy aliases — old short forms stored in early uploads
    'Disch. OPD':               'Discharged to OPD',
    'Disch. Forensics':         'Discharged to Forensics',
    'Disch. Forensics':         'Discharged to Forensics',
    'Absconded':                'Absconded',
    'Deferral':                 'Deferral',
    'Transfer other':           'Transfer',
    'RHT':                      'RHT',
    'Deceased (Natural)':       'Deceased',
    'Deceased (Unnatural)':     'Deceased (Unnat.)',
    'DOA (Natural)':            'DOA',
    'Referred to ENT':          'ENT',
  };

  function shortDiscipline(d) {
    return DISCIPLINE_SHORT[d] || d || '—';
  }

  // ── Disposal Colours ─────────────────────────────────────
  const DISCIPLINE_COLORS = {
    // Referrals
    'Referred to Medicine':     '#f85149',
    'Referred to Surgery':      '#58a6ff',
    'Referred to Paeds':        '#3fb950',
    'Referred to Psychiatry':   '#bc8cff',
    'Referred to Orthopaedics': '#e07b39',
    'Referred to Gynae':        '#f778ba',
    'Referred to Urology':      '#d29922',
    // Other disposals
    'Discharged':               '#7d8590',
    'Discharged to OPD':        '#6e7681',
    'Discharged to Forensics':  '#6e7681',
    'Disch. OPD':               '#6e7681',
    'Disch. Forensics':         '#6e7681',
    'Absconded':                '#484f58',
    'Deferral':                 '#484f58',
    'Transfer other':           '#8b949e',
    'RHT':                      '#8b949e',
    'Deceased (Natural)':       '#30363d',
    'Deceased (Unnatural)':     '#30363d',
    'DOA (Natural)':            '#30363d',
    'Referred to ENT':          '#a0c4ff',
  };

  function disciplineColor(d) {
    return DISCIPLINE_COLORS[d] || '#7d8590';
  }

  // ── Triage Badge Class ───────────────────────────────────
  function triageBadgeClass(t) {
    const map = { Red: 'badge-red', Orange: 'badge-orange', Yellow: 'badge-yellow', Green: 'badge-green' };
    return map[t] || 'badge-yellow';
  }

  // ── Group By ─────────────────────────────────────────────
  function groupBy(arr, key) {
    return arr.reduce((acc, row) => {
      const k = row[key] ?? 'Unknown';
      if (!acc[k]) acc[k] = [];
      acc[k].push(row);
      return acc;
    }, {});
  }

  function unique(arr) {
    return [...new Set(arr.filter(Boolean))].sort();
  }

  const DOW = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  function dowName(d) {
    if (!d) return null;
    const dt = d instanceof Date ? d : new Date(d);
    return DOW[dt.getDay()];
  }

  function r1(n) { return (n === null || n === undefined || isNaN(n)) ? null : Math.round(n * 10) / 10; }
  function r0(n) { return (n === null || n === undefined || isNaN(n)) ? null : Math.round(n); }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function toast(msg, type = 'info', duration = 3500) {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('visible'));
    setTimeout(() => { el.classList.remove('visible'); setTimeout(() => el.remove(), 300); }, duration);
  }

  return {
    parseAge, minutesBetween, formatMinutes, toHours,
    percentile, median, formatDate,
    isReferral, shortDiscipline, disciplineColor,
    triageBadgeClass, groupBy, unique, dowName,
    r0, r1, debounce, toast,
    DOW, DISCIPLINE_SHORT, DISCIPLINE_COLORS
  };
})();
