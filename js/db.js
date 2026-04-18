/* ============================================================
   db.js — Supabase integration for HECTIS Analyser
   ============================================================ */

const DB = (() => {

  const SUPABASE_URL = 'https://gjvbltadcdbuukymgjhs.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdqdmJsdGFkY2RidXVreW1namhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNjI4NTMsImV4cCI6MjA5MTkzODg1M30.xmpUKnQzO4ClcqE6kB03RACXTiVIqyXlVwNBoN8zkQM';
  const TABLE = 'vhw_hectis_data';

  const headers = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'return=representation'
  };

  // ── Health Check ─────────────────────────────────────────
  async function ping() {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/${TABLE}?select=id&limit=1`,
        { headers }
      );
      return res.ok;
    } catch { return false; }
  }

  // ── Get Total Record Count ───────────────────────────────
  async function getCount(filters = {}) {
    try {
      let url = `${SUPABASE_URL}/rest/v1/${TABLE}?select=id`;
      url += buildFilterString(filters);
      const res = await fetch(url, {
        headers: { ...headers, 'Prefer': 'count=exact', 'Range': '0-0' }
      });
      const cr = res.headers.get('content-range');
      if (cr) { const t = cr.split('/')[1]; return t === '*' ? 0 : parseInt(t); }
      return 0;
    } catch { return 0; }
  }

  // ── Fetch All Records (paginated) ────────────────────────
  async function fetchAll(filters = {}, onProgress = null) {
    const PAGE_SIZE = 1000;
    let all = [], from = 0, total = null;

    while (true) {
      let url = `${SUPABASE_URL}/rest/v1/${TABLE}?select=*`;
      url += buildFilterString(filters);
      url += `&order=arrival_time.asc`;

      const res = await fetch(url, {
        headers: { ...headers, 'Prefer': 'count=exact', 'Range': `${from}-${from + PAGE_SIZE - 1}` }
      });

      if (!res.ok) throw new Error(`DB fetch failed: ${res.status}`);
      const data = await res.json();
      all = all.concat(data);

      if (total === null) {
        const cr = res.headers.get('content-range');
        if (cr) { const t = cr.split('/')[1]; total = t === '*' ? null : parseInt(t); }
      }

      if (onProgress && total) onProgress(all.length, total);
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    return all;
  }

  // ── Build dedup key for a row ────────────────────────────
  // Matches the logic of our three partial indexes combined
  function dedupKey(r) {
    const a = r.arrival_time     || 'NULL';
    const t = r.triage_time      || 'NULL';
    const c = r.consultation_time || 'NULL';
    return `${a}|${t}|${c}`;
  }

  // ── Fetch existing keys for a month ─────────────────────
  // Pulls just the three timestamp columns for a given month
  // so we can do client-side dedup without loading full rows
  async function fetchExistingKeys(year, month) {
    const keys = new Set();
    const PAGE = 1000;
    let from = 0;

    while (true) {
      let url = `${SUPABASE_URL}/rest/v1/${TABLE}` +
        `?select=arrival_time,triage_time,consultation_time` +
        `&upload_year=eq.${year}&upload_month=eq.${month}`;

      const res = await fetch(url, {
        headers: { ...headers, 'Prefer': 'count=exact', 'Range': `${from}-${from + PAGE - 1}` }
      });

      if (!res.ok) break;
      const data = await res.json();
      data.forEach(r => keys.add(dedupKey(r)));
      if (data.length < PAGE) break;
      from += PAGE;
    }

    return keys;
  }

  // ── Insert Rows (client-side dedup, plain INSERT) ────────
  // No ON CONFLICT — we filter duplicates ourselves before sending.
  // This works regardless of index type or PostgREST version.
  async function insertRows(rows) {
    if (!rows.length) return { inserted: 0, skipped: 0, errors: [] };

    // Group rows by year+month so we fetch existing keys efficiently
    const byMonth = {};
    rows.forEach(r => {
      const k = `${r.upload_year}-${r.upload_month}`;
      if (!byMonth[k]) byMonth[k] = { year: r.upload_year, month: r.upload_month, rows: [] };
      byMonth[k].rows.push(r);
    });

    let inserted = 0, skipped = 0;
    const errors = [];

    for (const { year, month, rows: monthRows } of Object.values(byMonth)) {
      // Fetch existing keys for this month
      const existing = await fetchExistingKeys(year, month);

      // Filter out duplicates
      const newRows = monthRows.filter(r => !existing.has(dedupKey(r)));
      skipped += monthRows.length - newRows.length;

      if (!newRows.length) continue;

      // Insert in chunks — plain POST, no ON CONFLICT needed
      const CHUNK = 200;
      for (let i = 0; i < newRows.length; i += CHUNK) {
        const chunk = newRows.slice(i, i + CHUNK);
        try {
          const res = await fetch(
            `${SUPABASE_URL}/rest/v1/${TABLE}`,
            {
              method: 'POST',
              headers: { ...headers, 'Prefer': 'return=representation' },
              body: JSON.stringify(chunk)
            }
          );

          if (!res.ok) {
            let msg = `HTTP ${res.status}`;
            try { const e = await res.json(); msg = e.message || e.details || msg; } catch {}
            errors.push(`Chunk ${Math.floor(i/CHUNK)+1}: ${msg}`);
            continue;
          }

          const result = await res.json();
          inserted += result.length;

        } catch (e) {
          errors.push(`Chunk ${Math.floor(i/CHUNK)+1}: ${e.message}`);
        }
      }
    }

    return { inserted, skipped, errors };
  }

  // ── Get Available Months/Years ───────────────────────────
  async function getAvailableMonths() {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/${TABLE}?select=upload_year,upload_month` +
        `&order=upload_year.asc,upload_month.asc`,
        { headers: { ...headers, 'Prefer': 'count=exact', 'Range': '0-999' } }
      );
      const data = await res.json();
      const seen = new Set();
      return data.filter(r => {
        const k = `${r.upload_year}-${r.upload_month}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    } catch { return []; }
  }

  // ── Build Filter Query String ────────────────────────────
  function buildFilterString(filters) {
    let s = '';
    if (filters.disposal)        s += `&disposal=eq.${encodeURIComponent(filters.disposal)}`;
    if (filters.triage_category) s += `&triage_category=eq.${encodeURIComponent(filters.triage_category)}`;
    if (filters.upload_year)     s += `&upload_year=eq.${filters.upload_year}`;
    if (filters.upload_month)    s += `&upload_month=eq.${filters.upload_month}`;
    if (filters.date_from)       s += `&arrival_time=gte.${filters.date_from}`;
    if (filters.date_to)         s += `&arrival_time=lte.${filters.date_to}`;
    return s;
  }

  // ── Delete by source file ────────────────────────────────
  async function deleteBySourceFile(filename) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/${TABLE}?source_file=eq.${encodeURIComponent(filename)}`,
        { method: 'DELETE', headers }
      );
      return res.ok;
    } catch { return false; }
  }

  return { ping, getCount, fetchAll, insertRows, getAvailableMonths, deleteBySourceFile };

})();
