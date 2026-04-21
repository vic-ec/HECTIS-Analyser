/* ============================================================
   table.js — Data table with sort, column filters, export
   HECTIS Analyser
   ============================================================ */

const Table = (() => {

  const PAGE_SIZE = 50;
  let currentData  = [];
  let sortKey      = 'arrival_time';
  let sortDir      = 'desc';
  let currentPage  = 1;
  let searchQuery  = '';
  let dateFrom     = null;
  let dateTo       = null;

  // Column filters: key → Set of selected values (empty = all)
  const colFilters = {};

  // Filterable columns (dropdown filter)
  const FILTERABLE = ['triage_category','disposal','location','trauma','sex','access_block_4hr'];

  const COLUMNS = [
    { key: 'arrival_time',           label: 'Arrival',        fmt: r => Utils.formatDate(r.arrival_time),    filterable: false, sortable: true  },
    { key: 'age_raw',                label: 'Age',            fmt: r => r.age_raw || '—',                   filterable: false, sortable: true  },
    { key: 'sex',                    label: 'Sex',            fmt: r => r.sex || '—',                       filterable: true,  sortable: false },
    { key: 'triage_category',        label: 'Triage',         fmt: r => r.triage_category
        ? `<span class="badge ${Utils.triageBadgeClass(r.triage_category)}">${r.triage_category}</span>`
        : '—',                                                                                               filterable: true,  sortable: false },
    { key: 'disposal',               label: 'Disposal',       fmt: r => Utils.shortDiscipline(r.disposal) || '—', filterable: true, sortable: false },
    { key: 'trauma',                 label: 'Trauma',         fmt: r => r.trauma || '—',                    filterable: true,  sortable: false },
    { key: 'location',               label: 'Location',       fmt: r => r.location || '—',                  filterable: true,  sortable: false },
    { key: 'arrival_to_triage_min',  label: 'Arr→Triage',     fmt: r => Utils.formatMinutes(r.arrival_to_triage_min, true),  filterable: false, sortable: true  },
    { key: 'triage_to_doctor_min',   label: 'Triage→Dr',      fmt: r => Utils.formatMinutes(r.triage_to_doctor_min, true),   filterable: false, sortable: true  },
    { key: 'doctor_to_disposal_min', label: 'Dr→Disposal',    fmt: r => Utils.formatMinutes(r.doctor_to_disposal_min, true), filterable: false, sortable: true  },
    { key: 'disposal_to_exit_min',   label: 'Disp→Exit',      fmt: r => Utils.formatMinutes(r.disposal_to_exit_min, true),   filterable: false, sortable: true  },
    { key: 'total_los_min',          label: 'Total LOS',      fmt: r => Utils.formatMinutes(r.total_los_min, true),          filterable: false, sortable: true  },
    { key: 'access_block_4hr',       label: 'Access Blk',     fmt: r => r.access_block_4hr
        ? '<span class="badge badge-block">BLOCKED</span>'
        : '<span class="badge badge-ok">OK</span>',                                                          filterable: true,  sortable: false },
  ];


  // ── Apply column filters ────────────────────────────────
  function applyColFilters(data) {
    return data.filter(r => {
      for (const [key, vals] of Object.entries(colFilters)) {
        if (!vals || vals.size === 0) continue;
        // access_block_4hr is boolean in data but stored as 'true'/'false' string in filter
        const rVal = key === 'access_block_4hr'
          ? String(r[key])
          : r[key];
        if (!vals.has(rVal)) return false;
      }
      return true;
    });
  }

  // ── Render full table ───────────────────────────────────
  function render(data) {
    currentData = data;
    currentPage = 1;
    // Rebuild column filter dropdowns when new data arrives
    _buildColFilterOptions(data);
    renderPage();
  }

  function renderPage() {
    const tbody = document.getElementById('data-tbody');
    const paginationEl = document.getElementById('pagination-info');
    const pageControlEl = document.getElementById('page-controls');
    if (!tbody) return;

    // Apply search + column filters
    let filtered = currentData;

    if (searchQuery) {
      filtered = filtered.filter(r =>
        [r.disposal, r.triage_category, r.location, r.age_raw, r.sex, r.trauma]
          .some(v => v && String(v).toLowerCase().includes(searchQuery.toLowerCase()))
      );
    }

    if (dateFrom) {
      const df = new Date(dateFrom).getTime();
      filtered = filtered.filter(r => r.arrival_time && new Date(r.arrival_time).getTime() >= df);
    }
    if (dateTo) {
      const dt = new Date(dateTo + 'T23:59:59').getTime();
      filtered = filtered.filter(r => r.arrival_time && new Date(r.arrival_time).getTime() <= dt);
    }

    filtered = applyColFilters(filtered);

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

    tbody.innerHTML = pageData.map(r =>
      `<tr>${COLUMNS.map(col => `<td>${col.fmt(r)}</td>`).join('')}</tr>`
    ).join('') || `<tr><td colspan="${COLUMNS.length}" class="empty-state" style="padding:2rem">No records match current filters</td></tr>`;

    // Sync floating scrollbar width after render
    const tbl = document.getElementById('data-table');
    const scInner = document.getElementById('table-scroll-inner');
    if (tbl && scInner) scInner.style.width = tbl.scrollWidth + 'px';

    if (paginationEl) paginationEl.textContent = `${start+1}–${Math.min(start+PAGE_SIZE, total)} of ${total.toLocaleString()} records`;

    if (pageControlEl) {
      pageControlEl.innerHTML = `
        <button class="btn btn-secondary" onclick="Table.goPage(1)" ${currentPage<=1?'disabled':''}>«</button>
        <button class="btn btn-secondary" onclick="Table.goPage(${currentPage-1})" ${currentPage<=1?'disabled':''}>‹</button>
        <span style="font-family:var(--font-mono);font-size:0.78rem;color:var(--text-muted);padding:0 0.5rem">${currentPage} / ${pages||1}</span>
        <button class="btn btn-secondary" onclick="Table.goPage(${currentPage+1})" ${currentPage>=pages?'disabled':''}>›</button>
        <button class="btn btn-secondary" onclick="Table.goPage(${pages})" ${currentPage>=pages?'disabled':''}>»</button>
      `;
    }

    // Update sort indicators
    document.querySelectorAll('#data-table th').forEach(th => {
      th.classList.remove('sort-asc','sort-desc');
      if (th.dataset.key === sortKey) th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
    });

    // Update active filter indicators on column headers
    FILTERABLE.forEach(key => {
      const th = document.querySelector(`#data-table th[data-key="${key}"]`);
      if (th) {
        const hasFilter = colFilters[key] && colFilters[key].size > 0;
        th.classList.toggle('col-filter-active', hasFilter);
      }
    });
  }

  // ── Build column filter options ─────────────────────────
  function _buildColFilterOptions(data) {
    FILTERABLE.forEach(key => {
      const vals = [...new Set(data.map(r => r[key]).filter(Boolean))].sort();
      const dropdown = document.getElementById(`col-filter-dropdown-${key}`);
      if (!dropdown) return;

      const current = colFilters[key] || new Set();
      // For sex and access_block, use fixed option lists
      const fixedOpts = { sex: ['M','F'], access_block_4hr: ['true','false'] };
      const displayVals = fixedOpts[key] || vals;
      const labelFor = (k, v) => {
        if (k === 'disposal')         return Utils.shortDiscipline(v);
        if (k === 'access_block_4hr') return v === 'true' ? 'BLOCKED' : 'OK';
        if (k === 'sex')              return v === 'M' ? 'Male' : v === 'F' ? 'Female' : v;
        return v;
      };
      const showSearch = key !== 'sex' && key !== 'access_block_4hr';

      dropdown.innerHTML = `
        <div class="col-filter-header">
          <span style="font-size:0.7rem;font-family:var(--font-mono);color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em">Filter ${key.replace('_category','').replace('_4hr','').replace(/_/g,' ')}</span>
          <button class="btn btn-ghost" style="font-size:0.68rem;padding:0.15rem 0.4rem" onclick="Table.clearColFilter('${key}')">Clear</button>
        </div>
        ${showSearch ? `<div class="col-filter-search"><input type="search" placeholder="Search..." style="width:100%;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);font-size:0.75rem;padding:0.3rem 0.5rem;font-family:var(--font-mono)" oninput="Table.filterColOptions(this, '${key}')"></div>` : ''}
        <div class="col-filter-options">
          ${displayVals.map(v => {
            const lbl = labelFor(key, String(v));
            return `<label class="col-filter-option ${current.has(String(v))?'checked':''}"><input type="checkbox" value="${String(v).replace(/"/g,'&quot;')}" ${current.has(String(v))?'checked':''} onchange="Table.toggleColFilter('${key}', this.value, this.checked)"><span>${lbl}</span></label>`;
          }).join('')}
        </div>`;
    });
  }

  // ── Toggle a column filter value ────────────────────────
  function toggleColFilter(key, value, checked) {
    if (!colFilters[key]) colFilters[key] = new Set();
    if (checked) colFilters[key].add(value);
    else colFilters[key].delete(value);
    currentPage = 1;
    renderPage();
  }

  // ── Filter visible options in dropdown ──────────────────
  function filterColOptions(input, key) {
    const q = input.value.toLowerCase();
    const dropdown = document.getElementById(`col-filter-dropdown-${key}`);
    if (!dropdown) return;
    dropdown.querySelectorAll('.col-filter-option').forEach(opt => {
      const text = opt.querySelector('span')?.textContent?.toLowerCase() || '';
      opt.style.display = text.includes(q) ? '' : 'none';
    });
  }

  // ── Clear a column filter ───────────────────────────────
  function clearColFilter(key) {
    delete colFilters[key];
    _buildColFilterOptions(currentData);
    currentPage = 1;
    renderPage();
    // Close dropdown
    document.querySelectorAll('.col-filter-dropdown.open').forEach(d => d.classList.remove('open'));
  }

  // ── Reset all column filters ────────────────────────────
  function resetAllColFilters() {
    Object.keys(colFilters).forEach(k => delete colFilters[k]);
    searchQuery = '';
    dateFrom = null;
    dateTo   = null;
    const searchEl = document.getElementById('table-search');
    if (searchEl) searchEl.value = '';
    const dfEl = document.getElementById('table-date-from');
    const dtEl = document.getElementById('table-date-to');
    if (dfEl) dfEl.value = '';
    if (dtEl) dtEl.value = '';
    _buildColFilterOptions(currentData);
    currentPage = 1;
    renderPage();
  }

  // ── Build table header ──────────────────────────────────
  function buildHeader() {
    const thead = document.getElementById('data-thead');
    if (!thead) return;

    thead.innerHTML = `<tr>${COLUMNS.map(col => {
      const sortable  = col.sortable  ? `onclick="Table.sort('${col.key}')"` : '';
      const filterBtn = col.filterable
        ? `<button class="col-filter-btn" onclick="event.stopPropagation();Table.toggleColFilterDropdown('${col.key}')" title="Filter ${col.label}">▾</button>
           <div class="col-filter-dropdown" id="col-filter-dropdown-${col.key}"></div>`
        : '';
      return `<th data-key="${col.key}" ${sortable} style="${col.filterable?'position:relative':''}">${col.label}${filterBtn}</th>`;
    }).join('')}</tr>`;
  }

  // ── Toggle column filter dropdown ──────────────────────
  function toggleColFilterDropdown(key) {
    const dropdown = document.getElementById(`col-filter-dropdown-${key}`);
    if (!dropdown) return;
    const isOpen = dropdown.classList.contains('open');
    // Close all
    document.querySelectorAll('.col-filter-dropdown.open').forEach(d => d.classList.remove('open'));
    if (!isOpen) dropdown.classList.add('open');
  }

  // ── Sort ────────────────────────────────────────────────
  function sort(key) {
    if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    else { sortKey = key; sortDir = 'asc'; }
    currentPage = 1;
    renderPage();
  }

  function goPage(n) {
    const pages = Math.ceil(currentData.length / PAGE_SIZE);
    currentPage = Math.max(1, Math.min(n, pages));
    renderPage();
  }

  function search(q) {
    searchQuery = q;
    currentPage = 1;
    renderPage();
  }

  // ── Export to Excel ─────────────────────────────────────
  function exportExcel(data) {
    const filtered = applyColFilters(data);
    const rows = filtered.map(r => ({
      'Arrival Time':          r.arrival_time ? Utils.formatDate(r.arrival_time) : '',
      'Age':                   r.age_raw || '',
      'Sex':                   r.sex || '',
      'Triage':                r.triage_category || '',
      'Trauma':                r.trauma || '',
      'Disposal':              r.disposal || '',
      'Location':              r.location || '',
      'Arr→Triage (min)':      r.arrival_to_triage_min ?? '',
      'Triage→Doctor (min)':   r.triage_to_doctor_min ?? '',
      'Doctor→Disposal (min)': r.doctor_to_disposal_min ?? '',
      'Disposal→Exit (min)':   r.disposal_to_exit_min ?? '',
      'Total LOS (min)':       r.total_los_min ?? '',
      'Access Block >4hr':     r.access_block_4hr ? 'Yes' : 'No',
      'Month':                 r.upload_month ? ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][r.upload_month] : '',
      'Year':                  r.upload_year ?? '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'HECTIS Data');
    XLSX.writeFile(wb, `HECTIS_Export_${new Date().toISOString().slice(0,10)}.xlsx`);
    Utils.toast('Export downloaded', 'success');
  }

  // ── Init ────────────────────────────────────────────────
  function init() {
    buildHeader();
    const searchEl = document.getElementById('table-search');
    if (searchEl) searchEl.addEventListener('input', Utils.debounce(e => search(e.target.value), 250));
    const dfEl = document.getElementById('table-date-from');
    const dtEl = document.getElementById('table-date-to');
    if (dfEl) dfEl.addEventListener('change', e => { dateFrom = e.target.value || null; currentPage = 1; renderPage(); });
    if (dtEl) dtEl.addEventListener('change', e => { dateTo   = e.target.value || null; currentPage = 1; renderPage(); });

    // Close dropdowns when clicking outside table
    document.addEventListener('click', e => {
      if (!e.target.closest('.col-filter-dropdown') && !e.target.closest('.col-filter-btn')) {
        document.querySelectorAll('.col-filter-dropdown.open').forEach(d => d.classList.remove('open'));
      }
    });

    // Floating horizontal scrollbar — synced with table-wrap
    const tableWrap    = document.getElementById('table-wrap-outer');
    const scrollTrack  = document.getElementById('table-scroll-track');
    const scrollInner  = document.getElementById('table-scroll-inner');
    const tableEl      = document.getElementById('data-table');

    function syncScrollWidth() {
      if (tableEl && scrollInner) {
        scrollInner.style.width = tableEl.scrollWidth + 'px';
      }
    }

    if (tableWrap && scrollTrack) {
      // Sync scroll position both ways
      scrollTrack.addEventListener('scroll', () => {
        tableWrap.scrollLeft = scrollTrack.scrollLeft;
      });
      tableWrap.addEventListener('scroll', () => {
        scrollTrack.scrollLeft = tableWrap.scrollLeft;
      });
      // Update width when table content changes
      const resizeObs = new ResizeObserver(syncScrollWidth);
      if (tableEl) resizeObs.observe(tableEl);
      syncScrollWidth();
    }

    // Update date picker min/max from global data range
    const updateDateBounds = () => {
      const min = window.__hectisMinDate || '';
      const max = window.__hectisMaxDate || '';
      const dfEl = document.getElementById('table-date-from');
      const dtEl = document.getElementById('table-date-to');
      if (dfEl) { dfEl.min = min; dfEl.max = max; }
      if (dtEl) { dtEl.min = min; dtEl.max = max; }
    };
    // Try now and also after data loads
    updateDateBounds();
    setTimeout(updateDateBounds, 2000);
  }

  return { render, sort, goPage, search, exportExcel, init,
           toggleColFilter, filterColOptions, clearColFilter,
           resetAllColFilters, toggleColFilterDropdown };

})();
