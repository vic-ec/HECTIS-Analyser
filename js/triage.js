/* ============================================================
   triage.js — Triage Compliance Module
   HECTIS Analyser — VHW Emergency Centre

   Targets (triage → doctor, minutes):
     Red    = 0   (immediate)
     Orange = 10
     Yellow = 60
     Green  = 240
   ============================================================ */

const Triage = (() => {

  const TARGETS = { Red: 0, Orange: 10, Yellow: 60, Green: 240 };
  const COLORS  = {
    Red:    { bg: 'rgba(248,81,73,0.75)',    border: '#f85149' },
    Orange: { bg: 'rgba(224,123,57,0.75)',   border: '#e07b39' },
    Yellow: { bg: 'rgba(210,153,34,0.75)',   border: '#d29922' },
    Green:  { bg: 'rgba(63,185,80,0.75)',    border: '#3fb950' },
  };
  const ORDER = ['Red','Orange','Yellow','Green'];

  // ── Compliance calculation ───────────────────────────────
  function calcCompliance(data) {
    const results = {};
    // Normalise triage categories - treat '-' and null as unknown, skip them
    const validTriage = new Set(['Red','Orange','Yellow','Green']);
    ORDER.forEach(cat => {
      const rows = data.filter(r =>
        r.triage_category === cat &&
        validTriage.has(r.triage_category) &&
        r.triage_to_doctor_min !== null &&
        r.triage_to_doctor_min >= 0
      );
      const target = TARGETS[cat];
      const compliant = rows.filter(r => r.triage_to_doctor_min <= target).length;
      const pct = rows.length ? (compliant / rows.length * 100) : null;
      const vals = rows.map(r => r.triage_to_doctor_min);
      results[cat] = {
        n: rows.length,
        compliant,
        pct: pct !== null ? Utils.r1(pct) : null,
        median: Utils.r0(Utils.median(vals)),
        p90: Utils.r0(Utils.percentile(vals, 90)),
        target,
      };
    });
    return results;
  }

  // ── Render KPI cards ─────────────────────────────────────
  function renderKPIs(compliance) {
    ORDER.forEach(cat => {
      const c = compliance[cat];
      const el = document.getElementById(`triage-kpi-${cat.toLowerCase()}`);
      if (!el) return;
      const pctEl  = el.querySelector('.kpi-value');
      const unitEl = el.querySelector('.kpi-unit');
      const subEl  = el.querySelector('.kpi-sub');
      if (pctEl)  pctEl.textContent  = c.pct !== null ? c.pct + '%' : '—';
      if (unitEl) unitEl.textContent = `target: ≤${cat === 'Red' ? 'immediate' : c.target + ' min'}`;
      if (subEl)  subEl.textContent  = c.n ? `${c.compliant}/${c.n} patients` : 'no data';

      // Colour the card
      el.className = 'kpi-card triage-kpi-card';
      if (c.pct !== null) {
        if (c.pct >= 80)      el.classList.add('good');
        else if (c.pct >= 50) el.classList.add('warn');
        else                  el.classList.add('alert');
      }
    });
  }

  // ── Compliance bar chart ─────────────────────────────────
  function renderComplianceBar(id, compliance) {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const existing = Chart.getChart(canvas); if (existing) existing.destroy();

    const labels = ORDER.filter(c => compliance[c].n > 0);
    const pcts   = labels.map(c => compliance[c].pct);
    const colors = labels.map(c => COLORS[c]);

    new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Compliance %',
          data: pcts,
          backgroundColor: colors.map(c => c.bg),
          borderColor: colors.map(c => c.border),
          borderWidth: 2,
          borderRadius: 4,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
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
                const cat = labels[ctx.dataIndex];
                const c = compliance[cat];
                return [
                  `Compliance: ${ctx.raw}%`,
                  `${c.compliant}/${c.n} patients`,
                  `Median wait: ${Utils.formatMinutes(c.median, true)}`,
                  `Target: ≤${cat === 'Red' ? '0' : c.target} min`,
                ];
              }
            }
          },
          // Target line annotation drawn manually via afterDraw
        },
        scales: {
          x: {
            ticks: { color: '#7d8590', font: { family: 'DM Mono', size: 11 } },
            grid:  { color: '#21262d' },
            border: { color: '#30363d' },
          },
          y: {
            min: 0, max: 100,
            ticks: {
              color: '#7d8590',
              font: { family: 'DM Mono', size: 10 },
              callback: v => v + '%'
            },
            grid:  { color: '#21262d' },
            border: { color: '#30363d' },
          }
        }
      },
      plugins: [{
        id: 'target80line',
        afterDraw(chart) {
          const { ctx, chartArea: { left, right }, scales: { y } } = chart;
          const yPos = y.getPixelForValue(80);
          ctx.save();
          ctx.strokeStyle = 'rgba(255,255,255,0.25)';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(left, yPos);
          ctx.lineTo(right, yPos);
          ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.35)';
          ctx.font = '10px DM Mono';
          ctx.fillText('80% benchmark', right - 100, yPos - 4);
          ctx.restore();
        }
      }]
    });
  }

  // ── Median wait vs target bar chart ─────────────────────
  function renderWaitVsTarget(id, compliance) {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const existing = Chart.getChart(canvas); if (existing) existing.destroy();

    const labels = ORDER.filter(c => compliance[c].n > 0);
    const medians = labels.map(c => compliance[c].median);
    const targets = labels.map(c => compliance[c].target);
    const colors  = labels.map(c => COLORS[c]);

    new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Median actual wait',
            data: medians,
            backgroundColor: colors.map(c => c.bg),
            borderColor: colors.map(c => c.border),
            borderWidth: 2,
            borderRadius: 4,
            order: 2,
          },
          {
            label: 'Target',
            data: targets,
            type: 'line',
            borderColor: 'rgba(255,255,255,0.5)',
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [4, 4],
            pointRadius: 5,
            pointStyle: 'crossRot',
            pointBorderColor: 'rgba(255,255,255,0.7)',
            order: 1,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            labels: {
              color: '#7d8590',
              font: { family: 'DM Mono', size: 11 },
              boxWidth: 12,
            }
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
              label: ctx => `${ctx.dataset.label}: ${Utils.formatMinutes(ctx.raw, true)}`
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
            ticks: {
              color: '#7d8590',
              font: { family: 'DM Mono', size: 10 },
              callback: v => Utils.formatMinutes(v, true)
            },
            grid:  { color: '#21262d' },
            border: { color: '#30363d' },
            title: {
              display: true,
              text: 'Minutes',
              color: '#7d8590',
              font: { family: 'DM Mono', size: 10 }
            }
          }
        }
      }
    });
  }

  // ── Compliance trend over time ───────────────────────────
  function renderComplianceTrend(id, data) {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const existing = Chart.getChart(canvas); if (existing) existing.destroy();

    const byMonth = {};
    for (const r of data) {
      if (!r.upload_year || !r.upload_month) continue;
      const key = `${r.upload_year}-${String(r.upload_month).padStart(2,'0')}`;
      if (!byMonth[key]) byMonth[key] = [];
      byMonth[key].push(r);
    }

    const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const keys = Object.keys(byMonth).sort();
    const labels = keys.map(k => {
      const [y, m] = k.split('-');
      return `${MONTH_NAMES[parseInt(m)]} ${y}`;
    });

    const datasets = ORDER.map(cat => {
      const target = TARGETS[cat];
      return {
        label: cat,
        data: keys.map(k => {
          const rows = byMonth[k].filter(r =>
            r.triage_category === cat &&
            r.triage_to_doctor_min !== null &&
            r.triage_to_doctor_min >= 0
          );
          if (rows.length < 3) return null;
          const compliant = rows.filter(r => r.triage_to_doctor_min <= target).length;
          return Utils.r1((compliant / rows.length) * 100);
        }),
        borderColor: COLORS[cat].border,
        backgroundColor: COLORS[cat].bg.replace('0.75','0.15'),
        borderWidth: 2,
        pointRadius: 3,
        tension: 0.3,
        spanGaps: true,
      };
    });

    new Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
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
              label: ctx => ctx.raw !== null ? `${ctx.dataset.label}: ${ctx.raw}%` : 'Insufficient data'
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
            min: 0, max: 100,
            ticks: {
              color: '#7d8590',
              font: { family: 'DM Mono', size: 10 },
              callback: v => v + '%'
            },
            grid:  { color: '#21262d' },
            border: { color: '#30363d' },
            title: {
              display: true,
              text: 'Compliance %',
              color: '#7d8590',
              font: { family: 'DM Mono', size: 10 }
            }
          }
        }
      },
      plugins: [{
        id: 'bench80',
        afterDraw(chart) {
          const { ctx, chartArea: { left, right }, scales: { y } } = chart;
          const yPos = y.getPixelForValue(80);
          ctx.save();
          ctx.strokeStyle = 'rgba(255,255,255,0.2)';
          ctx.lineWidth = 1;
          ctx.setLineDash([4,4]);
          ctx.beginPath();
          ctx.moveTo(left, yPos);
          ctx.lineTo(right, yPos);
          ctx.stroke();
          ctx.restore();
        }
      }]
    });
  }

  // ── Main render entry point ──────────────────────────────
  function render(data) {
    // Filter to records with valid triage category and triage-to-doctor time
    const validData = data.filter(r =>
      ['Red','Orange','Yellow','Green'].includes(r.triage_category) &&
      r.triage_to_doctor_min !== null &&
      r.triage_to_doctor_min >= 0
    );
    const compliance = calcCompliance(validData);
    renderKPIs(compliance);
    renderComplianceBar('chart-triage-compliance', compliance);
    renderWaitVsTarget('chart-triage-wait', compliance);
    renderComplianceTrend('chart-triage-trend', validData);
    renderDetailTable(compliance);
  }

  // ── Detail table ─────────────────────────────────────────
  function renderDetailTable(compliance) {
    const el = document.getElementById('triage-detail-table');
    if (!el) return;

    el.innerHTML = `
      <div class="discipline-table-wrap">
        <div class="discipline-row header" style="grid-template-columns:1fr 0.6fr 0.8fr 0.8fr 0.8fr 0.8fr 1fr">
          <span>Category</span>
          <span>n</span>
          <span>Target</span>
          <span>Median wait</span>
          <span>90th %ile</span>
          <span>Compliant</span>
          <span>Compliance %</span>
        </div>
        ${ORDER.filter(cat => compliance[cat].n > 0).map(cat => {
          const c = compliance[cat];
          const pctColor = c.pct >= 80 ? 'var(--green)' : c.pct >= 50 ? 'var(--orange)' : 'var(--red)';
          return `
            <div class="discipline-row" style="grid-template-columns:1fr 0.6fr 0.8fr 0.8fr 0.8fr 0.8fr 1fr">
              <span><span class="badge badge-${cat.toLowerCase()}">${cat}</span></span>
              <span class="discipline-stat">${c.n}</span>
              <span class="discipline-stat">${cat === 'Red' ? 'Immediate' : '≤' + c.target + ' min'}</span>
              <span class="discipline-stat">${Utils.formatMinutes(c.median, true)}</span>
              <span class="discipline-stat">${Utils.formatMinutes(c.p90, true)}</span>
              <span class="discipline-stat">${c.compliant}</span>
              <div class="block-bar-cell">
                <div class="block-bar">
                  <div class="block-bar-fill" style="width:${Math.min(c.pct,100)}%;background:${pctColor}"></div>
                </div>
                <span class="block-pct" style="color:${pctColor}">${c.pct}%</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  return { render, TARGETS };

})();
