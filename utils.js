/* ============================================================
   utils.js — Shared utilities for HECTIS Analyser
   ============================================================ */

const Utils = (() => {

  // ── Age Parsing ──────────────────────────────────────────
  // Converts "3Y", "9M", "2M", "45" to decimal years
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

  // ── Excel Serial Date to JS Date ─────────────────────────
  // SheetJS can return dates as numbers (Excel serial) or JS Date objects
  function excelDateToJS(val) {
    if (!val) return null;
    if (val instanceof Date) return val;
    if (typeof val === 'number') {
      // Excel serial: days since 1899-12-30
      const ms = (val - 25569) * 86400 * 1000;
      return new Date(ms);
    }
    if (typeof val === 'string') {
      const d = new Date(val);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  // ── Minutes Between Two Dates ────────────────────────────
  function minutesBetween(a, b) {
    if (!a || !b) return null;
    const diff = (b.getTime() - a.getTime()) / 60000;
    return diff;
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

  // ── Percentile Calculation ───────────────────────────────
  function percentile(arr, p) {
    const sorted = [...arr].filter(v => v !== null && v !== undefined && !isNaN(v) && v >= 0).sort((a, b) => a - b);
    if (sorted.length === 0) return null;
    const idx = (p / 100) * (sorted.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  // ── Median ───────────────────────────────────────────────
  function median(arr) {
    return percentile(arr, 50);
  }

  // ── Format Date for Display ──────────────────────────────
  function formatDate(d) {
    if (!d) return '—';
    const dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt.getTime())) return '—';
    return dt.toLocaleString('en-ZA', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
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
  };

  function shortDiscipline(d) {
    return DISCIPLINE_SHORT[d] || d;
  }

  // ── Discipline Colours ───────────────────────────────────
  const DISCIPLINE_COLORS = {
    'Referred to Medicine':     '#f85149',
    'Referred to Surgery':      '#58a6ff',
    'Referred to Paeds':        '#3fb950',
    'Referred to Psychiatry':   '#bc8cff',
    'Referred to Orthopaedics': '#e07b39',
    'Referred to Gynae':        '#f778ba',
    'Referred to Urology':      '#d29922',
  };

  function disciplineColor(d) {
    return DISCIPLINE_COLORS[d] || '#7d8590';
  }

  // ── Triage Badge Class ───────────────────────────────────
  function triageBadgeClass(t) {
    const map = { 'Red': 'badge-red', 'Orange': 'badge-orange', 'Yellow': 'badge-yellow', 'Green': 'badge-green' };
    return map[t] || 'badge-yellow';
  }

  // ── Group By Key ─────────────────────────────────────────
  function groupBy(arr, key) {
    return arr.reduce((acc, row) => {
      const k = row[key] ?? 'Unknown';
      if (!acc[k]) acc[k] = [];
      acc[k].push(row);
      return acc;
    }, {});
  }

  // ── Get Unique Values ────────────────────────────────────
  function unique(arr) {
    return [...new Set(arr.filter(Boolean))].sort();
  }

  // ── Day of Week Name ─────────────────────────────────────
  const DOW = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  function dowName(d) {
    if (!d) return null;
    const dt = d instanceof Date ? d : new Date(d);
    return DOW[dt.getDay()];
  }

  // ── Round to 1 decimal ───────────────────────────────────
  function r1(n) {
    if (n === null || n === undefined || isNaN(n)) return null;
    return Math.round(n * 10) / 10;
  }

  // ── Round to nearest integer ─────────────────────────────
  function r0(n) {
    if (n === null || n === undefined || isNaN(n)) return null;
    return Math.round(n);
  }

  // ── Debounce ─────────────────────────────────────────────
  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // ── Show Toast Notification ──────────────────────────────
  function toast(msg, type = 'info', duration = 3500) {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('visible'));
    setTimeout(() => {
      el.classList.remove('visible');
      setTimeout(() => el.remove(), 300);
    }, duration);
  }

  return {
    parseAge, excelDateToJS, minutesBetween, formatMinutes, toHours,
    percentile, median, formatDate, shortDiscipline, disciplineColor,
    triageBadgeClass, groupBy, unique, dowName, r0, r1, debounce, toast,
    DOW, DISCIPLINE_SHORT, DISCIPLINE_COLORS
  };
})();
