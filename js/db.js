/* ============================================================
   db.js — Supabase integration + IndexedDB cache
   HECTIS Analyser

   Cache strategy:
   - First load: fetch all from Supabase, store in IndexedDB
   - Repeat loads: serve from IndexedDB instantly, then check
     Supabase record count in background — if changed, fetch
     only new records (by id > last cached id) and merge
   - After upload: invalidate cache so next load is fresh
   ============================================================ */

const DB = (() => {

  const SUPABASE_URL = 'https://gjvbltadcdbuukymgjhs.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdqdmJsdGFkY2RidXVreW1namhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNjI4NTMsImV4cCI6MjA5MTkzODg1M30.xmpUKnQzO4ClcqE6kB03RACXTiVIqyXlVwNBoN8zkQM';
  const TABLE    = 'vhw_hectis_data';
  const DB_NAME  = 'hectis_cache';
  const DB_VER   = 2;
  const STORE    = 'records';
  const META_KEY = 'cache_meta';

  const headers = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'return=representation'
  };

  // ── IndexedDB helpers ────────────────────────────────────
  let _idb = null;

  async function openIDB() {
    if (_idb) return _idb;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('by_year_month', ['upload_year','upload_month']);
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta');
        }
      };
      req.onsuccess = e => { _idb = e.target.result; resolve(_idb); };
      req.onerror   = () => reject(req.error);
    });
  }

  async function idbGetAll() {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(STORE, 'readonly');
      const req   = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = () => reject(req.error);
    });
  }

  // Write in batches of 2000 to avoid transaction timeouts on large datasets
  async function idbPutAll(records) {
    const BATCH = 2000;
    const db = await openIDB();
    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH);
      await new Promise((resolve, reject) => {
        const tx    = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        batch.forEach(r => store.put(r));
        tx.oncomplete = () => resolve();
        tx.onerror    = () => reject(tx.error);
      });
    }
  }

  async function idbClear() {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE, 'meta'], 'readwrite');
      tx.objectStore(STORE).clear();
      tx.objectStore('meta').clear();
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  }

  async function idbGetMeta() {
    const db = await openIDB();
    return new Promise((resolve) => {
      const req = db.transaction('meta','readonly').objectStore('meta').get(META_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = () => resolve(null);
    });
  }

  async function idbSetMeta(meta) {
    const db = await openIDB();
    return new Promise((resolve) => {
      const tx = db.transaction('meta','readwrite');
      tx.objectStore('meta').put(meta, META_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => resolve();
    });
  }

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

  // ── Get remote record count ──────────────────────────────
  async function getRemoteCount() {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/${TABLE}?select=id`,
        { headers: { ...headers, 'Prefer': 'count=exact', 'Range': '0-0' } }
      );
      const cr = res.headers.get('content-range');
      if (cr) { const t = cr.split('/')[1]; return t === '*' ? 0 : parseInt(t); }
      return 0;
    } catch { return -1; }
  }

  // ── Fetch from Supabase (paginated) ──────────────────────
  async function _fetchFromSupabase(afterId = 0, onProgress = null) {
    const PAGE = 1000;
    let all = [], from = 0, total = null;

    while (true) {
      let url = `${SUPABASE_URL}/rest/v1/${TABLE}?select=*&order=id.asc`;
      if (afterId > 0) url += `&id=gt.${afterId}`;

      const res = await fetch(url, {
        headers: { ...headers, 'Prefer': 'count=exact', 'Range': `${from}-${from + PAGE - 1}` }
      });
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);

      const data = await res.json();
      all = all.concat(data);

      if (total === null) {
        const cr = res.headers.get('content-range');
        if (cr) { const t = cr.split('/')[1]; total = t === '*' ? null : parseInt(t); }
      }

      if (onProgress && total) onProgress(all.length, total);
      if (data.length < PAGE) break;
      from += PAGE;
    }
    return all;
  }

  // ── Main fetchAll — cache-first strategy ─────────────────
  async function fetchAll(filters = {}, onProgress = null) {
    // If filters are active, skip cache and query directly
    // (cache holds all data; filtering is done client-side)
    let cached = [];
    let meta   = null;

    try {
      meta   = await idbGetMeta();
      cached = await idbGetAll();
    } catch (e) {
      console.warn('IndexedDB read failed, falling back to network:', e);
    }

    const hasCachedData = cached.length > 0 && meta;

    // ── Serve cache immediately if available ─────────────
    if (hasCachedData && onProgress) {
      onProgress(cached.length, cached.length);
    }

    // ── Background sync: check for new records ────────────
    const syncInBackground = async (servedData) => {
      try {
        const remoteCount = await getRemoteCount();
        if (remoteCount === servedData.length) return servedData; // Nothing new

        // Fetch only records newer than our last cached id
        const lastId = meta?.lastId || 0;
        const newRecords = await _fetchFromSupabase(lastId);

        if (newRecords.length > 0) {
          const merged = [...servedData, ...newRecords];
          await idbPutAll(newRecords);
          const newLastId = Math.max(...newRecords.map(r => r.id));
          await idbSetMeta({
            lastId: Math.max(lastId, newLastId),
            count:  merged.length,
            fetchedAt: Date.now()
          });
          return merged;
        }
        return servedData;
      } catch (e) {
        console.warn('Background sync failed:', e);
        return servedData;
      }
    };

    if (hasCachedData) {
      // Return cache instantly, sync in background
      // Use a callback pattern so App can update if new data arrives
      setTimeout(async () => {
        const updated = await syncInBackground(cached);
        if (updated.length !== cached.length && window.__hectisSyncCallback) {
          window.__hectisSyncCallback(updated);
        }
      }, 500);
      return cached;
    }

    // ── No cache: full fetch from Supabase ────────────────
    if (onProgress) onProgress(0, 1); // Show loading state
    const all = await _fetchFromSupabase(0, (loaded, total) => {
      if (onProgress) onProgress(loaded, total);
    });

    // Store in IndexedDB
    try {
      await idbPutAll(all);
      const lastId = all.length > 0 ? Math.max(...all.map(r => r.id)) : 0;
      await idbSetMeta({
        lastId,
        count: all.length,
        fetchedAt: Date.now()
      });
    } catch (e) {
      console.warn('IndexedDB write failed:', e);
    }

    return all;
  }

  // ── Invalidate cache (call after upload) ─────────────────
  async function invalidateCache() {
    try {
      await idbClear();
    } catch (e) {
      console.warn('Cache clear failed:', e);
    }
  }

  // ── Build dedup key ───────────────────────────────────────
  function dedupKey(r) {
    const m = iso => iso ? String(iso).slice(0, 16) : 'N';
    return [
      m(r.arrival_time), m(r.triage_time), m(r.consultation_time),
      m(r.disposal_time),
      (r.age_raw || 'N').toString().toUpperCase().trim(),
      (r.sex     || 'N').toString().toUpperCase().trim(),
    ].join('|');
  }

  // ── Fetch existing keys for a month (for upload dedup) ───
  async function fetchExistingKeys(year, month) {
    // Try cache first
    try {
      const cached = await idbGetAll();
      if (cached.length > 0) {
        const keys = new Set();
        cached
          .filter(r => r.upload_year === year && r.upload_month === month)
          .forEach(r => keys.add(dedupKey(r)));
        return keys;
      }
    } catch {}

    // Fall back to Supabase
    const keys = new Set();
    const PAGE = 1000;
    let from = 0;
    while (true) {
      const url = `${SUPABASE_URL}/rest/v1/${TABLE}` +
        `?select=arrival_time,triage_time,consultation_time,disposal_time,age_raw,sex` +
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

  // ── Insert Rows (client-side dedup + plain POST) ──────────
  async function insertRows(rows) {
    if (!rows.length) return { inserted: 0, skipped: 0, errors: [] };

    const byMonth = {};
    rows.forEach(r => {
      const k = `${r.upload_year}-${r.upload_month}`;
      if (!byMonth[k]) byMonth[k] = { year: r.upload_year, month: r.upload_month, rows: [] };
      byMonth[k].rows.push(r);
    });

    let inserted = 0, skipped = 0;
    const errors = [];

    for (const { year, month, rows: monthRows } of Object.values(byMonth)) {
      const existing = await fetchExistingKeys(year, month);
      const newRows  = monthRows.filter(r => !existing.has(dedupKey(r)));
      skipped += monthRows.length - newRows.length;
      if (!newRows.length) continue;

      const CHUNK = 200;
      for (let i = 0; i < newRows.length; i += CHUNK) {
        const chunk = newRows.slice(i, i + CHUNK);
        try {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`, {
            method: 'POST',
            headers: { ...headers, 'Prefer': 'return=representation' },
            body: JSON.stringify(chunk)
          });
          if (!res.ok) {
            let msg = `HTTP ${res.status}`;
            try { const e = await res.json(); msg = e.message || e.details || msg; } catch {}
            errors.push(`Chunk ${Math.floor(i/CHUNK)+1}: ${msg}`);
            continue;
          }
          const result = await res.json();
          inserted += result.length;
          // Add newly inserted records to IndexedDB cache immediately
          try { await idbPutAll(result); } catch {}
        } catch (e) {
          errors.push(`Chunk ${Math.floor(i/CHUNK)+1}: ${e.message}`);
        }
      }
    }

    // Update cache meta after insert
    try {
      const meta = await idbGetMeta();
      const allCached = await idbGetAll();
      const lastId = allCached.length > 0 ? Math.max(...allCached.map(r => r.id)) : 0;
      await idbSetMeta({ lastId, count: allCached.length, fetchedAt: Date.now() });
    } catch {}

    return { inserted, skipped, errors };
  }

  // ── Get Available Months ──────────────────────────────────
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

  // ── Build Filter Query String ─────────────────────────────
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

  return {
    ping, fetchAll, insertRows, invalidateCache,
    getAvailableMonths, buildFilterString
  };

})();
