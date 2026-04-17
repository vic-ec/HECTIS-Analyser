/* ============================================================
   table.js — Data table with sort, filter, paginate & export
   HECTIS Analyser
   ============================================================ */

const Table = (() => {

  const PAGE_SIZE = 50;
  let currentData  = [];
  let sortKey      = 'arrival_time';
  let sortDir      = 'desc';
  let currentPage  = 1;
  let searchQuery  = '';

  const COLUMNS = [
    { key: 'arrival_time',           label: 'Arrival',         fmt: r => Utils.formatDate(r.arrival_time) },
    { key: 'age_raw',                label: 'Age',             fmt: r => r.age_raw || '—' },
    { key: 'sex',                    label: 'Sex',             fmt: r => r.sex || '—' },
    { key: 'triage_category',        label: 'Triage',          fmt: r => r.triage_category
        ? `<span class="badge ${Utils.triageBadgeClass(r.triage_category)}">${r.triage_category}</span>`
        : '—' },
    { key: 'disposal',               label: 'Disposal',        fmt: r => Utils.shortDiscipline(r.disposal) || '—' },
    { key: 'arrival_to_triage_min',  label: 'Arr→Triage',      fmt: r => Utils.formatMinutes(r.arrival_to_triage_min, true) },
    { key: 'triage_to_doctor_min',   label: 'Triage→Dr',       fmt: r => Utils.formatMinutes(r.triage_to_doctor_min, true) },
    { key: 'doctor_to_disposal_min', label: 'Dr→Disposal',     fmt: r => Utils.formatMinutes(r.doctor_to_disposal_min, true) },
    { key: 'disposal_to_exit_min',   label: 'Disposal→Exit',   fmt: r => Utils.formatMinutes(r.disposal_to_exit_min, true) },
    { key: 'total_los_min',          label: 'Total LOS',       fmt: r => Utils.formatMinutes(r.total_los_min, true) },
    { key: 'access_block_4hr',       label: 'Access Block',    fmt: r => r.access_block_4hr
        ? '<span class="badge badge-block">BLOCKED</span>'
        : '<span class="badge badge-ok">OK</span>' },
    { key: 'location',               label: 'Location',        fmt: r => r.location || '—' },
    { key: 'upload_year',            label: 'Month',           fmt: r => r.upload_month && r.upload_year
        ? `${['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][r.upload_month]} ${r.upload_year}`
        : '—' },
  ];

  // ── Render Full Table ────────────────────────────────────
  function render(data) {
    currentData = data;
    currentPage = 1;
    renderPage();
  }

  function renderPage() {
    const tbody = document.getElementById('data-tbody');
    const paginationEl = document.getElementById('pagination-info');
    const pageControlEl = document.getElementById('page-controls');
    if (!tbody) return;

    // Apply search
    let filtered = searchQuery
      ? currentData.filter(r =>
          [r.disposal, r.triage_category, r.location, r.age_raw, r.sex]
            .some(v => v && String(v).toLowerCase().includes(searchQuery.toLowerCase()))
        )
      : currentData;

    // Sort
    filtered = [...filtered].sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    const total = filtered.length;
    const pages = Math.ceil(total / PAGE_SIZE);
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageData = filtered.slice(start, start + PAGE_SIZE);

    // Render rows
    tbody.innerHTML = pageData.map(r =>
      `<tr>${COLUMNS.map(col => `<td>${col.fmt(r)}</td>`).join('')}</tr>`
    ).join('') || `<tr><td colspan="${COLUMNS.length}" class="empty-state" style="padding:2rem">No records match current filters</td></tr>`;

    // Pagination info
    if (paginationEl) {
      paginationEl.textContent = `${start+1}–${Math.min(start+PAGE_SIZE, total)} of ${total.toLocaleString()} records`;
    }

    // Page controls
    if (pageControlEl) {
      pageControlEl.innerHTML = `
        <button class="btn btn-secondary" onclick="Table.goPage(1)" ${currentPage<=1?'disabled':''}>«</button>
        <button class="btn btn-secondary" onclick="Table.goPage(${currentPage-1})" ${currentPage<=1?'disabled':''}>‹</button>
        <span style="font-family:var(--font-mono);font-size:0.78rem;color:var(--text-muted);padding:0 0.5rem">
          ${currentPage} / ${pages}
        </span>
        <button class="btn btn-secondary" onclick="Table.goPage(${currentPage+1})" ${currentPage>=pages?'disabled':''}>›</button>
        <button class="btn btn-secondary" onclick="Table.goPage(${pages})" ${currentPage>=pages?'disabled':''}>»</button>
      `;
    }

    // Update sort indicators
    document.querySelectorAll('#data-table th').forEach(th => {
      th.classList.remove('sort-asc','sort-desc');
      if (th.dataset.key === sortKey) {
        th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });
  }

  // ── Build Table Header ───────────────────────────────────
  function buildHeader() {
    const thead = document.getElementById('data-thead');
    if (!thead) return;
    thead.innerHTML = `<tr>${COLUMNS.map(col =>
      `<th data-key="${col.key}" onclick="Table.sort('${col.key}')">${col.label}</th>`
    ).join('')}</tr>`;
  }

  // ── Sort ─────────────────────────────────────────────────
  function sort(key) {
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      sortDir = 'asc';
    }
    currentPage = 1;
    renderPage();
  }

  // ── Go to Page ───────────────────────────────────────────
  function goPage(n) {
    const pages = Math.ceil(currentData.length / PAGE_SIZE);
    currentPage = Math.max(1, Math.min(n, pages));
    renderPage();
  }

  // ── Search ───────────────────────────────────────────────
  function search(q) {
    searchQuery = q;
    currentPage = 1;
    renderPage();
  }

  // ── Export to Excel ──────────────────────────────────────
  function exportExcel(data) {
    const rows = data.map(r => ({
      'Arrival Time':         r.arrival_time ? Utils.formatDate(r.arrival_time) : '',
      'Age':                  r.age_raw || '',
      'Sex':                  r.sex || '',
      'Triage':               r.triage_category || '',
      'Trauma':               r.trauma || '',
      'Disposal':             r.disposal || '',
      'Location':             r.location || '',
      'Arr→Triage (min)':     r.arrival_to_triage_min ?? '',
      'Triage→Doctor (min)':  r.triage_to_doctor_min ?? '',
      'Doctor→Disposal (min)':r.doctor_to_disposal_min ?? '',
      'Disposal→Exit (min)':  r.disposal_to_exit_min ?? '',
      'Total LOS (min)':      r.total_los_min ?? '',
      'Access Block >4hr':    r.access_block_4hr ? 'Yes' : 'No',
      'Month':                r.upload_month ? ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][r.upload_month] : '',
      'Year':                 r.upload_year ?? '',
      'Source File':          r.source_file || '',
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'HECTIS Data');
    XLSX.writeFile(wb, `HECTIS_Export_${new Date().toISOString().slice(0,10)}.xlsx`);
    Utils.toast('Export downloaded', 'success');
  }

  // ── Init ─────────────────────────────────────────────────
  function init() {
    buildHeader();

    const searchEl = document.getElementById('table-search');
    if (searchEl) {
      searchEl.addEventListener('input', Utils.debounce(e => search(e.target.value), 250));
    }
  }

  return { render, sort, goPage, search, exportExcel, init };

})();
