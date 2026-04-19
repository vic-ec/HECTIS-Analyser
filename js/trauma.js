/* ============================================================
   trauma.js — Trauma Breakdown Module
   HECTIS Analyser — VHW Emergency Centre
   ============================================================ */

const Trauma = (() => {

  const NON_TRAUMA_KEY = 'No Trauma';

  // ── Classify row as trauma or not ───────────────────────
  function isValidTraumaValue(v) {
    if (!v || v === "-" || v === "No Trauma") return false;
    if (/\d{1,4}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(v)) return false;
    if (/\d{1,2}:\d{2}/.test(v)) return false;
    if (!/[A-Za-z]/.test(v)) return false;
    return true;
  }

  function isTrauma(r) {
    return r.trauma && isValidTraumaValue(r.trauma);
  }

  // ── Key metrics for a set of rows ───────────────────────
  function calcMetrics(rows) {
    const los  = rows.map(r => r.total_los_min).filter(v => v !== null && v >= 0);
    const ttd  = rows.map(r => r.triage_to_doctor_min).filter(v => v !== null && v >= 0);
    // Disposal→Exit: referral patients only — discharges/absconded have 0min which skews median
    const referrals = rows.filter(r => r.disposal && Utils.isReferral(r.disposal));
    const dte  = referrals.map(r => r.disposal_to_exit_min).filter(v => v !== null && v >= 0);
    const blockable = referrals.filter(r => r.disposal_to_exit_min !== null && r.disposal_to_exit_min >= 0);
    const blocked   = blockable.filter(r => r.access_block_4hr);

    return {
      n:          rows.length,
      medLos:     Utils.r0(Utils.median(los)),
      medDte:     Utils.r0(Utils.median(dte)),
      medTtd:     Utils.r0(Utils.median(ttd)),
      blockRate:  blockable.length ? Utils.r1((blocked.length / blockable.length) * 100) : null,
      p90Dte:     Utils.r0(Utils.percentile(dte, 90)),
    };
  }

  // ── Render split KPIs ────────────────────────────────────
  function renderSplitKPIs(data) {
    const traumaRows    = data.filter(isTrauma);
    const nonTraumaRows = data.filter(r => !isTrauma(r));

    const tm = calcMetrics(traumaRows);
    const nm = calcMetrics(nonTraumaRows);

    const pairs = [
      { id: 'trauma-kpi-n',         t: tm.n,        nt: nm.n,        fmt: v => v.toLocaleString(), label: 'Patients' },
      { id: 'trauma-kpi-los',       t: tm.medLos,   nt: nm.medLos,   fmt: v => Utils.formatMinutes(v, true), label: 'Median LOS' },
      { id: 'trauma-kpi-dte',       t: tm.medDte,   nt: nm.medDte,   fmt: v => Utils.formatMinutes(v, true), label: 'Median Disposal→Exit' },
      { id: 'trauma-kpi-block',     t: tm.blockRate, nt: nm.blockRate, fmt: v => v !== null ? v + '%' : '—', label: 'Access Block Rate' },
      { id: 'trauma-kpi-ttd',       t: tm.medTtd,   nt: nm.medTtd,   fmt: v => Utils.formatMinutes(v, true), label: 'Median Triage→Doctor' },
    ];

    pairs.forEach(({ id, t, nt, fmt }) => {
      const el = document.getElementById(id);
      if (!el) return;
      const tEl  = el.querySelector('.trauma-val');
      const ntEl = el.querySelector('.nontrauma-val');
      if (tEl)  tEl.textContent  = t  !== null && t  !== undefined ? fmt(t)  : '—';
      if (ntEl) ntEl.textContent = nt !== null && nt !== undefined ? fmt(nt) : '—';
    });
  }

  // ── Trauma type abbreviation map ────────────────────────
  const TRAUMA_ABBREV = {
    'Non Accidental Injury(Paed)':   'Paed NAI',
    'Non Accidental Injury (Paed)':  'Paed NAI',
    'Gender Based Violence':          'GBV',
    'Gender-Based Violence':          'GBV',
  };
  function traumaLabel(t) { return TRAUMA_ABBREV[t] || t; }

  // ── Trauma type breakdown bar chart ─────────────────────
  function renderTraumaTypes(id, data) {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const existing = Chart.getChart(canvas); if (existing) existing.destroy();

    const traumaRows = data.filter(isTrauma);
    const grouped    = Utils.groupBy(traumaRows, 'trauma');

    const entries = Object.entries(grouped)
      .map(([type, rows]) => ({
        type,
        n: rows.length,
        medDte: Utils.r0(Utils.median(rows.map(r => r.disposal_to_exit_min).filter(v => v !== null && v >= 0))),
        blockRate: (() => {
          const b = rows.filter(r => r.disposal_to_exit_min !== null && r.disposal_to_exit_min >= 0);
          const bl = b.filter(r => r.access_block_4hr);
          return b.length ? Utils.r1((bl.length / b.length) * 100) : null;
        })(),
      }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 20); // top 20 types

    const colors = entries.map((_, i) => {
      const hues = [210, 195, 160, 45, 25, 0, 280, 330, 120, 240, 60, 300];
      return `hsla(${hues[i % hues.length]}, 70%, 60%, 0.8)`;
    });

    new Chart(canvas, {
      type: 'bar',
      data: {
        labels: entries.map(e => traumaLabel(e.type)),
        datasets: [{
          label: 'Patients',
          data: entries.map(e => e.n),
          backgroundColor: colors,
          borderColor: colors.map(c => c.replace('0.8','1')),
          borderWidth: 1,
          borderRadius: 3,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#21262d',
            borderColor: '#30363d',
            borderWidth: 1,
            titleColor: '#e6edf3',
            bodyColor: '#7d8590',
            titleFont: { family: 'DM Mono', size: 11 },
            bodyFont:  { family: 'DM Mono', size: 11 },
            padding: 10,
            callbacks: {
              label: ctx => {
                const e = entries[ctx.dataIndex];
                return [
                  `n = ${e.n}`,
                  `Median disposal→exit: ${Utils.formatMinutes(e.medDte, true)}`,
                  `Access block rate: ${e.blockRate !== null ? e.blockRate + '%' : '—'}`,
                ];
              }
            }
          }
        },
        scales: {
          x: {
            ticks: { color: '#7d8590', font: { family: 'DM Mono', size: 10 } },
            grid:  { color: '#21262d' },
            border: { color: '#30363d' },
          },
          y: {
            ticks: { color: '#7d8590', font: { family: 'DM Mono', size: 10 } },
            grid:  { color: '#21262d' },
            border: { color: '#30363d' },
          }
        }
      }
    });
  }

  // ── Trauma vs Non-Trauma: disposal→exit comparison ──────
  function renderTraumaVsNonTrauma(id, data) {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const existing = Chart.getChart(canvas); if (existing) existing.destroy();

    const traumaRows    = data.filter(r => isTrauma(r) && r.disposal_to_exit_min !== null && r.disposal_to_exit_min >= 0);
    const nonTraumaRows = data.filter(r => !isTrauma(r) && r.disposal_to_exit_min !== null && r.disposal_to_exit_min >= 0);

    const metrics = (rows) => ({
      median: Utils.r0(Utils.toHours(Utils.median(rows.map(r => r.disposal_to_exit_min)))),
      p75:    Utils.r0(Utils.toHours(Utils.percentile(rows.map(r => r.disposal_to_exit_min), 75))),
      p90:    Utils.r0(Utils.toHours(Utils.percentile(rows.map(r => r.disposal_to_exit_min), 90))),
    });

    const tm = metrics(traumaRows);
    const nm = metrics(nonTraumaRows);

    new Chart(canvas, {
      type: 'bar',
      data: {
        labels: ['Median', '75th %ile', '90th %ile'],
        datasets: [
          {
            label: 'Trauma',
            data: [tm.median, tm.p75, tm.p90],
            backgroundColor: 'rgba(248,81,73,0.7)',
            borderColor: '#f85149',
            borderWidth: 2,
            borderRadius: 4,
          },
          {
            label: 'Non-Trauma',
            data: [nm.median, nm.p75, nm.p90],
            backgroundColor: 'rgba(88,166,255,0.7)',
            borderColor: '#58a6ff',
            borderWidth: 2,
            borderRadius: 4,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            labels: { color: '#7d8590', font: { family: 'DM Mono', size: 11 }, boxWidth: 12 }
          },
          tooltip: {
            backgroundColor: '#21262d',
            borderColor: '#30363d',
            borderWidth: 1,
            titleColor: '#e6edf3',
            bodyColor: '#7d8590',
            titleFont: { family: 'DM Mono', size: 11 },
            bodyFont:  { family: 'DM Mono', size: 11 },
            padding: 10,
            callbacks: {
              label: ctx => `${ctx.dataset.label}: ${ctx.raw} hrs`
            }
          }
        },
        scales: {
          x: {
            ticks: { color: '#7d8590', font: { family: 'DM Mono', size: 11 } },
            grid:  { color: '#21262d' },
            border: { color: '#30363d' },
          },
          y: {
            ticks: { color: '#7d8590', font: { family: 'DM Mono', size: 10 }, callback: v => v + 'h' },
            grid:  { color: '#21262d' },
            border: { color: '#30363d' },
            title: { display: true, text: 'Hours (disposal → exit)', color: '#7d8590', font: { family: 'DM Mono', size: 10 } }
          }
        }
      }
    });
  }

  // ── Triage distribution: trauma vs non-trauma ───────────
  function renderTriageDistribution(id, data) {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const existing = Chart.getChart(canvas); if (existing) existing.destroy();

    const ORDER = ['Red','Orange','Yellow','Green'];
    const traumaRows    = data.filter(isTrauma);
    const nonTraumaRows = data.filter(r => !isTrauma(r));

    const pct = (rows, cat) => {
      const n = rows.filter(r => r.triage_category === cat).length;
      return rows.length ? Utils.r1((n / rows.length) * 100) : 0;
    };

    new Chart(canvas, {
      type: 'bar',
      data: {
        labels: ORDER,
        datasets: [
          {
            label: 'Trauma',
            data: ORDER.map(c => pct(traumaRows, c)),
            backgroundColor: 'rgba(248,81,73,0.7)',
            borderColor: '#f85149',
            borderWidth: 2,
            borderRadius: 4,
          },
          {
            label: 'Non-Trauma',
            data: ORDER.map(c => pct(nonTraumaRows, c)),
            backgroundColor: 'rgba(88,166,255,0.7)',
            borderColor: '#58a6ff',
            borderWidth: 2,
            borderRadius: 4,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            labels: { color: '#7d8590', font: { family: 'DM Mono', size: 11 }, boxWidth: 12 }
          },
          tooltip: {
            backgroundColor: '#21262d',
            borderColor: '#30363d',
            borderWidth: 1,
            titleColor: '#e6edf3',
            bodyColor: '#7d8590',
            titleFont: { family: 'DM Mono', size: 11 },
            bodyFont:  { family: 'DM Mono', size: 11 },
            padding: 10,
            callbacks: {
              label: ctx => `${ctx.dataset.label}: ${ctx.raw}%`
            }
          }
        },
        scales: {
          x: {
            ticks: { color: '#7d8590', font: { family: 'DM Mono', size: 11 } },
            grid:  { color: '#21262d' },
            border: { color: '#30363d' },
          },
          y: {
            ticks: { color: '#7d8590', font: { family: 'DM Mono', size: 10 }, callback: v => v + '%' },
            grid:  { color: '#21262d' },
            border: { color: '#30363d' },
            title: { display: true, text: '% of group', color: '#7d8590', font: { family: 'DM Mono', size: 10 } }
          }
        }
      }
    });
  }

  // ── Trauma detail table ──────────────────────────────────
  function renderDetailTable(data) {
    const el = document.getElementById('trauma-detail-table');
    if (!el) return;

    const traumaRows = data.filter(isTrauma);
    const grouped    = Utils.groupBy(traumaRows, 'trauma');

    const rows = Object.entries(grouped).map(([type, rows]) => {
      const dte = rows.map(r => r.disposal_to_exit_min).filter(v => v !== null && v >= 0);
      const blockable = rows.filter(r => r.disposal_to_exit_min !== null && r.disposal_to_exit_min >= 0);
      const blocked   = blockable.filter(r => r.access_block_4hr);
      return {
        type,
        n: rows.length,
        medDte:    Utils.r0(Utils.median(dte)),
        p90Dte:    Utils.r0(Utils.percentile(dte, 90)),
        blockRate: blockable.length ? Utils.r1((blocked.length / blockable.length) * 100) : null,
      };
    }).sort((a, b) => b.n - a.n);

    el.innerHTML = `
      <div class="discipline-table-wrap">
        <div class="discipline-row header" style="grid-template-columns:1.8fr 0.6fr 1fr 1fr 1fr">
          <span>Trauma Type</span>
          <span>n</span>
          <span>Median Disp→Exit</span>
          <span>90th %ile</span>
          <span>Block Rate</span>
        </div>
        ${rows.map(r => {
          const bc = r.blockRate > 70 ? 'var(--red)' : r.blockRate > 40 ? 'var(--orange)' : 'var(--green)';
          return `
            <div class="discipline-row" style="grid-template-columns:1.8fr 0.6fr 1fr 1fr 1fr">
              <span class="discipline-name">${TRAUMA_ABBREV[r.type] || r.type}</span>
              <span class="discipline-stat">${r.n}</span>
              <span class="discipline-stat">${Utils.formatMinutes(r.medDte, true)}</span>
              <span class="discipline-stat">${Utils.formatMinutes(r.p90Dte, true)}</span>
              <div class="block-bar-cell">
                <div class="block-bar">
                  <div class="block-bar-fill" style="width:${r.blockRate !== null ? Math.min(r.blockRate,100) : 0}%;background:${bc}"></div>
                </div>
                <span class="block-pct" style="color:${bc}">${r.blockRate !== null ? r.blockRate + '%' : '—'}</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // ── Main render entry point ──────────────────────────────
  function render(data) {
    renderSplitKPIs(data);
    renderTraumaVsNonTrauma('chart-trauma-vs-nontrauma', data);
    renderTraumaTypes('chart-trauma-types', data);
    renderTriageDistribution('chart-trauma-triage-dist', data);
    renderDetailTable(data);
  }

  return { render };

})();
