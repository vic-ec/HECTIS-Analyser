/* ============================================================
   db.js — Supabase integration for HECTIS Analyser
   ============================================================ */

const DB = (() => {

  const SUPABASE_URL = 'https://gjvbltadcdbuukymgjhs.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdqdmJsdGFkY2RidXVreW1namhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNjI4NTMsImV4cCI6MjA5MTkzODg1M30.xmpUKnQzO4ClcqE6kB03RACXTiVIqyXlVwNBoN8zkQM';
  const TABLE = 'ec_access_block';

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
      const count = res.headers.get('content-range');
      if (count) {
        const total = count.split('/')[1];
        return total === '*' ? 0 : parseInt(total);
      }
      return 0;
    } catch { return 0; }
  }

  // ── Fetch All Records (paginated) ────────────────────────
  async function fetchAll(filters = {}, onProgress = null) {
    const PAGE_SIZE = 1000;
    let all  = [];
    let from = 0;
    let total = null;

    while (true) {
      let url = `${SUPABASE_URL}/rest/v1/${TABLE}?select=*`;
      url += buildFilterString(filters);
      url += `&order=arrival_time.asc`;

      const res = await fetch(url, {
        headers: {
          ...headers,
          'Prefer': 'count=exact',
          'Range': `${from}-${from + PAGE_SIZE - 1}`
        }
      });

      if (!res.ok) throw new Error(`DB fetch failed: ${res.status}`);

      const data = await res.json();
      all = all.concat(data);

      if (total === null) {
        const cr = res.headers.get('content-range');
        if (cr) {
          const t = cr.split('/')[1];
          total = t === '*' ? null : parseInt(t);
        }
      }

      if (onProgress && total) onProgress(all.length, total);
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    return all;
  }

  // ── Insert Rows (ON CONFLICT DO NOTHING via upsert) ──────
  // Uses the correct PostgREST upsert syntax to silently skip
  // duplicates on our (arrival_time, triage_time, consultation_time) index.
  async function insertRows(rows) {
    if (rows.length === 0) return { inserted: 0, skipped: 0, errors: [] };

    const CHUNK = 100;
    let inserted = 0;
    let skipped  = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      try {
        // PostgREST upsert: POST with ?on_conflict= query param
        // This maps to INSERT ... ON CONFLICT DO NOTHING
        const url = `${SUPABASE_URL}/rest/v1/${TABLE}?on_conflict=arrival_time,triage_time,consultation_time`;

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            ...headers,
            'Prefer': 'resolution=ignore-duplicates,return=representation'
          },
          body: JSON.stringify(chunk)
        });

        if (!res.ok) {
          let msg = `HTTP ${res.status}`;
          try {
            const err = await res.json();
            msg = err.message || err.details || msg;
          } catch {}
          errors.push(`Chunk ${Math.floor(i / CHUNK) + 1}: ${msg}`);
          continue;
        }

        const result = await res.json();
        inserted += result.length;
        skipped  += chunk.length - result.length;

      } catch (e) {
        errors.push(`Chunk ${Math.floor(i / CHUNK) + 1}: ${e.message}`);
      }
    }

    return { inserted, skipped, errors };
  }

  // ── Get Available Months/Years ───────────────────────────
  async function getAvailableMonths() {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/${TABLE}?select=upload_year,upload_month&order=upload_year.asc,upload_month.asc`,
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

  // ── Delete by source file (for re-uploads) ───────────────
  async function deleteBySourceFile(filename) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/${TABLE}?source_file=eq.${encodeURIComponent(filename)}`,
        { method: 'DELETE', headers }
      );
      return res.ok;
    } catch { return false; }
  }

  return {
    ping, getCount, fetchAll, insertRows,
    getAvailableMonths, deleteBySourceFile
  };

})();
