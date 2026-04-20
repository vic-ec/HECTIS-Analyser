/* ============================================================
   location.js — Ward/Location Bottleneck Analysis
   HECTIS Analyser — VHW Emergency Centre
   ============================================================ */

const Location = (() => {

  // Locations that represent actual ward destinations (not outcomes)
  const OUTCOME_LOCS = new Set([
    'Discharged Home by Discipline', 'Discharged Home', 'Home',
    'Transferred Out by Discipline', 'Transferred Out',
    'Bereavement Room', 'Mortuary',
    'OPD', 'Discharged to OPD',
    'Absconded', 'Left Without Being Seen',
  ]);

  function isWard(loc) {
    return loc && !OUTCOME_LOCS.has(loc) && loc !== '-' && loc !== '';
  }

  // ── Render ───────────────────────────────────────────────
  function render(data) {
    // Discipline filter now from tab filter bar via disposal filter
    // Remove reference to standalone loc-filter-discipline dropdown
    const wardData = data.filter(r =>
      r.location && isWard(r.location) &&
      r.disposal_to_exit_min !== null && r.disposal_to_exit_min >= 0 &&
      Utils.isReferral(r.disposal)
    );

    if (!wardData.length) {
      const el = document.getElementById('location-content');
      if (el) el.innerHTML = '<div class="empty-state"><div class="empty-icon">⊘</div><p>No ward destination data available</p></div>';
      return;
    }

    renderKPIs(wardData);
    renderWardTable(wardData);
    renderWardChart(wardData);
    renderDisciplineByWard(wardData);
    populateWardFilter(wardData);
  }

  // ── KPIs ─────────────────────────────────────────────────
  function renderKPIs(data) {
    const grouped = Utils.groupBy(data, 'location');
    let worstWard = null, worstMedian = -1;
    let bestWard  = null, bestMedian  = Infinity;

    Object.entries(grouped).forEach(([loc, rows]) => {
      if (rows.length < 5) return;
      const med = Utils.median(rows.map(r => r.disposal_to_exit_min));
      if (med > worstMedian) { worstMedian = med; worstWard = loc; }
      if (med < bestMedian)  { bestMedian  = med; bestWard  = loc; }
    });

    const setEl = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setEl('loc-kpi-worst-val',  worstWard  || '—');
    setEl('loc-kpi-worst-unit', worstMedian > 0  ? 'median ' + Utils.formatMinutes(worstMedian, true) + ' boarding' : '');
    setEl('loc-kpi-best-val',   bestWard   || '—');
    setEl('loc-kpi-best-unit',  bestMedian < Infinity ? 'median ' + Utils.formatMinutes(bestMedian, true) + ' boarding' : '');
    setEl('loc-kpi-n-val',      Object.keys(grouped).length.toString());
    setEl('loc-kpi-n-unit',     'wards / destinations');
  }

  // ── Ward summary table ───────────────────────────────────
  function renderWardTable(data) {
    const el = document.getElementById('location-table');
    if (!el) return;

    const filterVal = ''; // Discipline filter handled by tab filter bar
    const filtered  = filterVal ? data.filter(r => r.disposal === filterVal) : data;
    const grouped   = Utils.groupBy(filtered, 'location');

    const rows = Object.entries(grouped).map(([loc, rows]) => {
      const vals    = rows.map(r => r.disposal_to_exit_min);
      const blocked = rows.filter(r => r.access_block_4hr).length;
      // Discipline breakdown for this ward
      const discMap = {};
      rows.forEach(r => { discMap[r.disposal] = (discMap[r.disposal]||0)+1; });
      const topDisc = Object.entries(discMap).sort((a,b)=>b[1]-a[1])[0];
      return {
        loc,
        n:         rows.length,
        median:    Utils.r0(Utils.median(vals)),
        p75:       Utils.r0(Utils.percentile(vals, 75)),
        p90:       Utils.r0(Utils.percentile(vals, 90)),
        blockRate: Utils.r1((blocked / rows.length) * 100),
        topDisc:   topDisc ? Utils.shortDiscipline(topDisc[0]) + ' (' + topDisc[1] + ')' : '—',
      };
    }).sort((a, b) => b.median - a.median);

    el.innerHTML = `
      <div class="discipline-table-wrap">
        <div class="discipline-row header" style="grid-template-columns:2fr 0.6fr 1fr 1fr 1fr 1fr 1.4fr">
          <span>Ward / Location</span><span>n</span><span>Median</span>
          <span>75th %ile</span><span>90th %ile</span><span>Block rate</span><span>Top discipline</span>
        </div>
        ${rows.map(r => {
          const bc = r.blockRate > 70 ? 'var(--red)' : r.blockRate > 40 ? 'var(--orange)' : 'var(--green)';
          return `
            <div class="discipline-row" style="grid-template-columns:2fr 0.6fr 1fr 1fr 1fr 1fr 1.4fr">
              <span class="discipline-name">${r.loc}</span>
              <span class="discipline-stat">${r.n.toLocaleString()}</span>
              <span class="discipline-stat">${Utils.formatMinutes(r.median, true)}</span>
              <span class="discipline-stat">${Utils.formatMinutes(r.p75, true)}</span>
              <span class="discipline-stat">${Utils.formatMinutes(r.p90, true)}</span>
              <div class="block-bar-cell">
                <div class="block-bar"><div class="block-bar-fill" style="width:${Math.min(r.blockRate,100)}%;background:${bc}"></div></div>
                <span class="block-pct" style="color:${bc}">${r.blockRate}%</span>
              </div>
              <span class="discipline-stat" style="font-size:0.72rem;color:var(--text-muted)">${r.topDisc}</span>
            </div>`;
        }).join('')}
      </div>`;
  }

  // ── Ward median boarding bar chart ───────────────────────
  function renderWardChart(data) {
    const canvas = document.getElementById('chart-location-ward');
    if (!canvas) return;
    const existing = Chart.getChart(canvas); if (existing) existing.destroy();

    const filterVal = ''; // Discipline filter handled by tab filter bar
    const filtered  = filterVal ? data.filter(r => r.disposal === filterVal) : data;
    const grouped   = Utils.groupBy(filtered, 'location');

    const entries = Object.entries(grouped)
      .filter(([, rows]) => rows.length >= 5)
      .map(([loc, rows]) => ({
        loc,
        median: Utils.r0(Utils.toHours(Utils.median(rows.map(r => r.disposal_to_exit_min)))),
        n: rows.length,
      }))
      .sort((a, b) => b.median - a.median)
      .slice(0, 15);

    new Chart(canvas, {
      type: 'bar',
      data: {
        labels: entries.map(e => e.loc),
        datasets: [{
          label: 'Median boarding (hrs)',
          data: entries.map(e => e.median),
          backgroundColor: entries.map(e =>
            e.median > 16 ? 'rgba(248,81,73,0.7)' :
            e.median > 8  ? 'rgba(224,123,57,0.7)' :
            'rgba(88,166,255,0.7)'
          ),
          borderColor: entries.map(e =>
            e.median > 16 ? '#f85149' : e.median > 8 ? '#e07b39' : '#58a6ff'
          ),
          borderWidth: 2, borderRadius: 4,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor:'#21262d', borderColor:'#30363d', borderWidth:1,
            titleColor:'#e6edf3', bodyColor:'#7d8590',
            titleFont:{family:'DM Mono',size:11}, bodyFont:{family:'DM Mono',size:11}, padding:10,
            callbacks: { label: ctx => {
              const e = entries[ctx.dataIndex];
              return [`Median: ${ctx.raw}h boarding`, `n = ${e.n} patients`];
            }}
          }
        },
        scales: {
          x: { ticks:{color:'#7d8590',font:{family:'DM Mono',size:10},callback:v=>v+'h'}, grid:{color:'#21262d'}, border:{color:'#30363d'} },
          y: { ticks:{color:'#7d8590',font:{family:'DM Mono',size:10}}, grid:{color:'#21262d'}, border:{color:'#30363d'} }
        }
      }
    });
  }

  // ── Discipline breakdown by ward (stacked) ───────────────
  function renderDisciplineByWard(data) {
    const canvas = document.getElementById('chart-location-discipline');
    if (!canvas) return;
    const existing = Chart.getChart(canvas); if (existing) existing.destroy();

    const grouped = Utils.groupBy(data, 'location');
    const topWards = Object.entries(grouped)
      .filter(([, rows]) => rows.length >= 5)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 10)
      .map(([loc]) => loc);

    const disciplines = [...new Set(data.map(r => r.disposal))].filter(Utils.isReferral);

    const datasets = disciplines.map(d => ({
      label: Utils.shortDiscipline(d),
      data: topWards.map(w => {
        const rows = (grouped[w]||[]).filter(r => r.disposal === d);
        return rows.length;
      }),
      backgroundColor: Utils.disciplineColor(d) + 'bb',
      borderColor: Utils.disciplineColor(d),
      borderWidth: 1,
    }));

    new Chart(canvas, {
      type: 'bar',
      data: { labels: topWards, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels:{color:'#7d8590',font:{family:'DM Mono',size:11},boxWidth:12} },
          tooltip: {
            backgroundColor:'#21262d', borderColor:'#30363d', borderWidth:1,
            titleColor:'#e6edf3', bodyColor:'#7d8590',
            titleFont:{family:'DM Mono',size:11}, bodyFont:{family:'DM Mono',size:11}, padding:10,
          }
        },
        scales: {
          x: { stacked:true, ticks:{color:'#7d8590',font:{family:'DM Mono',size:9}}, grid:{color:'#21262d'}, border:{color:'#30363d'} },
          y: { stacked:true, ticks:{color:'#7d8590',font:{family:'DM Mono',size:10}}, grid:{color:'#21262d'}, border:{color:'#30363d'} }
        }
      }
    });
  }

  // ── Populate discipline filter for ward view ─────────────
  function populateWardFilter(data) {
    const sel = document.getElementById('loc-filter-discipline');
    if (!sel || sel.options.length > 1) return;
    const discs = Utils.unique(data.map(r => r.disposal).filter(Utils.isReferral));
    discs.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d; opt.textContent = Utils.shortDiscipline(d);
      sel.appendChild(opt);
    });
    // Discipline filter events removed — handled by tab filter bar
  }

  return { render };

})();
