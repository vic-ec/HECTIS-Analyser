/* ============================================================
   charts.js — Chart.js visualisations for HECTIS Analyser
   ============================================================ */

const Charts = (() => {

  // Registry of active chart instances for cleanup
  const registry = {};

  // ── Default Chart Options ────────────────────────────────
  const baseOptions = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: {
        labels: {
          color: '#7d8590',
          font: { family: 'DM Mono', size: 11 },
          boxWidth: 12,
          padding: 16
        }
      },
      tooltip: {
        backgroundColor: '#21262d',
        borderColor: '#30363d',
        borderWidth: 1,
        titleColor: '#e6edf3',
        bodyColor: '#7d8590',
        titleFont: { family: 'DM Mono', size: 11 },
        bodyFont: { family: 'DM Mono', size: 11 },
        padding: 10,
        cornerRadius: 6,
      }
    },
    scales: {
      x: {
        ticks: { color: '#7d8590', font: { family: 'DM Mono', size: 10 } },
        grid:  { color: '#21262d' },
        border: { color: '#30363d' }
      },
      y: {
        ticks: { color: '#7d8590', font: { family: 'DM Mono', size: 10 } },
        grid:  { color: '#21262d' },
        border: { color: '#30363d' }
      }
    }
  };

  function destroyChart(id) {
    if (registry[id]) {
      registry[id].destroy();
      delete registry[id];
    }
  }

  function getCanvas(id) {
    const el = document.getElementById(id);
    if (!el) return null;
    destroyChart(id);
    return el;
  }

  // ── Disposal-to-Exit by Discipline (Box-style Bar) ───────
  function renderAccessBlockByDiscipline(id, data) {
    const canvas = getCanvas(id);
    if (!canvas) return;

    const disciplines = [...new Set(data.map(r => r.disposal))].filter(Boolean);
    const grouped = Utils.groupBy(data, 'disposal');

    const labels = disciplines.map(Utils.shortDiscipline);
    const medians = disciplines.map(d => {
      const vals = (grouped[d] || []).map(r => r.disposal_to_exit_min).filter(v => v !== null && v >= 0);
      return Utils.r0(Utils.median(vals));
    });
    const p75 = disciplines.map(d => {
      const vals = (grouped[d] || []).map(r => r.disposal_to_exit_min).filter(v => v !== null && v >= 0);
      return Utils.r0(Utils.percentile(vals, 75));
    });
    const p90 = disciplines.map(d => {
      const vals = (grouped[d] || []).map(r => r.disposal_to_exit_min).filter(v => v !== null && v >= 0);
      return Utils.r0(Utils.percentile(vals, 90));
    });

    const colors = disciplines.map(d => Utils.disciplineColor(d));

    registry[id] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Median',
            data: medians,
            backgroundColor: colors.map(c => c + '99'),
            borderColor: colors,
            borderWidth: 2,
            borderRadius: 4,
          },
          {
            label: '75th %ile',
            data: p75,
            backgroundColor: colors.map(c => c + '44'),
            borderColor: colors.map(c => c + '88'),
            borderWidth: 1,
            borderRadius: 4,
          },
          {
            label: '90th %ile',
            data: p90,
            backgroundColor: colors.map(c => c + '22'),
            borderColor: colors.map(c => c + '55'),
            borderWidth: 1,
            borderRadius: 4,
          }
        ]
      },
      options: {
        ...baseOptions,
        plugins: {
          ...baseOptions.plugins,
          tooltip: {
            ...baseOptions.plugins.tooltip,
            callbacks: {
              label: ctx => `${ctx.dataset.label}: ${Utils.formatMinutes(ctx.raw, true)}`
            }
          }
        },
        scales: {
          ...baseOptions.scales,
          y: {
            ...baseOptions.scales.y,
            title: { display: true, text: 'Minutes', color: '#7d8590', font: { family: 'DM Mono', size: 10 } }
          }
        }
      }
    });
  }

  // ── Access Block % by Discipline ────────────────────────
  function renderAccessBlockRate(id, data) {
    const canvas = getCanvas(id);
    if (!canvas) return;

    const disciplines = [...new Set(data.map(r => r.disposal))].filter(Boolean);
    const grouped = Utils.groupBy(data, 'disposal');

    const labels = disciplines.map(Utils.shortDiscipline);
    const rates = disciplines.map(d => {
      const rows = (grouped[d] || []).filter(r => r.disposal_to_exit_min !== null && r.disposal_to_exit_min >= 0);
      if (rows.length === 0) return 0;
      const blocked = rows.filter(r => r.access_block_4hr).length;
      return Utils.r1((blocked / rows.length) * 100);
    });

    const colors = disciplines.map(d => Utils.disciplineColor(d));

    // Sort by rate descending
    const sorted = labels.map((l, i) => ({ l, r: rates[i], c: colors[i] }))
                         .sort((a, b) => b.r - a.r);

    registry[id] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: sorted.map(s => s.l),
        datasets: [{
          label: 'Access Block Rate (%)',
          data: sorted.map(s => s.r),
          backgroundColor: sorted.map(s => s.c + '99'),
          borderColor: sorted.map(s => s.c),
          borderWidth: 2,
          borderRadius: 4,
        }]
      },
      options: {
        ...baseOptions,
        indexAxis: 'y',
        plugins: {
          ...baseOptions.plugins,
          tooltip: {
            ...baseOptions.plugins.tooltip,
            callbacks: {
              label: ctx => `Access block: ${ctx.raw}%`
            }
          }
        },
        scales: {
          ...baseOptions.scales,
          x: {
            ...baseOptions.scales.x,
            max: 100,
            title: { display: true, text: '% patients blocked >4 hrs', color: '#7d8590', font: { family: 'DM Mono', size: 10 } }
          }
        }
      }
    });
  }

  // ── Total LOS Trend by Month ─────────────────────────────
  function renderLosTrend(id, data) {
    const canvas = getCanvas(id);
    if (!canvas) return;

    // Group by year-month
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

    const disciplines = [...new Set(data.map(r => r.disposal))].filter(Boolean);
    const datasets = disciplines.map(d => ({
      label: Utils.shortDiscipline(d),
      data: keys.map(k => {
        const rows = byMonth[k].filter(r => r.disposal === d && r.disposal_to_exit_min !== null && r.disposal_to_exit_min >= 0);
        return rows.length >= 3 ? Utils.r0(Utils.toHours(Utils.median(rows.map(r => r.disposal_to_exit_min)))) : null;
      }),
      borderColor: Utils.disciplineColor(d),
      backgroundColor: Utils.disciplineColor(d) + '22',
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 5,
      tension: 0.3,
      spanGaps: true,
    }));

    registry[id] = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        ...baseOptions,
        plugins: {
          ...baseOptions.plugins,
          tooltip: {
            ...baseOptions.plugins.tooltip,
            callbacks: {
              label: ctx => `${ctx.dataset.label}: ${ctx.raw !== null ? ctx.raw + ' hrs' : 'N/A'}`
            }
          }
        },
        scales: {
          ...baseOptions.scales,
          y: {
            ...baseOptions.scales.y,
            title: { display: true, text: 'Median disposal→exit (hours)', color: '#7d8590', font: { family: 'DM Mono', size: 10 } }
          }
        }
      }
    });
  }

  // ── LOS Segments Stacked (Overall) ──────────────────────
  function renderSegmentBreakdown(id, data) {
    const canvas = getCanvas(id);
    if (!canvas) return;

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

    const segments = [
      { key: 'arrival_to_triage_min',     label: 'Arrival→Triage',      color: '#58a6ff' },
      { key: 'triage_to_doctor_min',       label: 'Triage→Doctor',        color: '#3fb950' },
      { key: 'doctor_to_disposal_min',     label: 'Doctor→Disposal',      color: '#d29922' },
      { key: 'disposal_to_exit_min',       label: 'Disposal→Exit',        color: '#f85149' },
    ];

    const datasets = segments.map(s => ({
      label: s.label,
      data: keys.map(k => {
        const vals = byMonth[k].map(r => r[s.key]).filter(v => v !== null && v >= 0);
        return vals.length >= 3 ? Utils.r0(Utils.toHours(Utils.median(vals))) : null;
      }),
      backgroundColor: s.color + 'bb',
      borderColor: s.color,
      borderWidth: 1,
    }));

    registry[id] = new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        ...baseOptions,
        plugins: {
          ...baseOptions.plugins,
          tooltip: {
            ...baseOptions.plugins.tooltip,
            callbacks: {
              label: ctx => `${ctx.dataset.label}: ${ctx.raw !== null ? ctx.raw + ' hrs' : 'N/A'}`
            }
          }
        },
        scales: {
          ...baseOptions.scales,
          x: { ...baseOptions.scales.x, stacked: true },
          y: {
            ...baseOptions.scales.y,
            stacked: true,
            title: { display: true, text: 'Median hours', color: '#7d8590', font: { family: 'DM Mono', size: 10 } }
          }
        }
      }
    });
  }

  // ── Hourly Heatmap (disposal-to-exit by hour + day) ──────
  function renderHeatmap(containerId, data, discipline = null) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const filtered = discipline
      ? data.filter(r => r.disposal === discipline)
      : data;

    const DOW = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const HOURS = Array.from({length:24}, (_,i) => i);

    // Build matrix: DOW x Hour → median disposal_to_exit_min
    const matrix = DOW.map((_, di) => {
      return HOURS.map(h => {
        const rows = filtered.filter(r => {
          if (!r.disposal_time) return false;
          const dt = new Date(r.disposal_time);
          const dow = (dt.getDay() + 6) % 7; // Mon=0
          return dow === di && dt.getHours() === h &&
                 r.disposal_to_exit_min !== null && r.disposal_to_exit_min >= 0;
        });
        return rows.length >= 2 ? Utils.median(rows.map(r => r.disposal_to_exit_min)) : null;
      });
    });

    // Find max for colour scaling
    const allVals = matrix.flat().filter(v => v !== null);
    const maxVal = allVals.length ? Math.max(...allVals) : 1;

    // Build HTML heatmap
    let html = '<div class="heatmap-grid">';
    // Header row
    html += '<div class="heatmap-label"></div>';
    HOURS.forEach(h => {
      html += `<div class="heatmap-hour-label">${h === 0 ? '12am' : h < 12 ? h+'am' : h === 12 ? '12p' : (h-12)+'p'}</div>`;
    });

    DOW.forEach((day, di) => {
      html += `<div class="heatmap-label">${day}</div>`;
      HOURS.forEach(h => {
        const val = matrix[di][h];
        if (val === null) {
          html += `<div class="heatmap-cell" style="background:var(--surface-2)"></div>`;
        } else {
          const intensity = Math.min(val / maxVal, 1);
          // Color: low=green, mid=yellow, high=red
          const r = Math.round(intensity * 248);
          const g = Math.round((1 - intensity) * 185);
          const b = 73;
          const alpha = 0.2 + intensity * 0.75;
          const label = Utils.formatMinutes(val, true);
          html += `<div class="heatmap-cell" 
            style="background:rgba(${r},${g},${b},${alpha})"
            title="${day} ${h}:00 — median: ${label} (n=${getCount(filtered, di, h)})"
          ></div>`;
        }
      });
    });

    html += '</div>';
    container.innerHTML = html;

    function getCount(rows, di, h) {
      return rows.filter(r => {
        if (!r.disposal_time) return false;
        const dt = new Date(r.disposal_time);
        const dow = (dt.getDay() + 6) % 7;
        return dow === di && dt.getHours() === h;
      }).length;
    }
  }

  // ── Day-of-Week Bar Chart ────────────────────────────────
  function renderDowChart(id, data, discipline = null) {
    const canvas = getCanvas(id);
    if (!canvas) return;

    const filtered = discipline
      ? data.filter(r => r.disposal === discipline)
      : data;

    const DOW_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const medians = DOW_LABELS.map((_, di) => {
      const rows = filtered.filter(r => {
        if (!r.disposal_time || r.disposal_to_exit_min === null || r.disposal_to_exit_min < 0) return false;
        const dt = new Date(r.disposal_time);
        return (dt.getDay() + 6) % 7 === di;
      });
      return rows.length >= 3 ? Utils.r0(Utils.toHours(Utils.median(rows.map(r => r.disposal_to_exit_min)))) : null;
    });

    const counts = DOW_LABELS.map((_, di) =>
      filtered.filter(r => {
        if (!r.disposal_time) return false;
        return (new Date(r.disposal_time).getDay() + 6) % 7 === di;
      }).length
    );

    registry[id] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: DOW_LABELS,
        datasets: [{
          label: 'Median disposal→exit (hrs)',
          data: medians,
          backgroundColor: medians.map(v => {
            if (v === null) return '#21262d';
            if (v > 20) return '#f8514999';
            if (v > 12) return '#e07b3999';
            if (v > 6)  return '#d2992299';
            return '#3fb95099';
          }),
          borderColor: medians.map(v => {
            if (v === null) return '#30363d';
            if (v > 20) return '#f85149';
            if (v > 12) return '#e07b39';
            if (v > 6)  return '#d29922';
            return '#3fb950';
          }),
          borderWidth: 2,
          borderRadius: 4,
        }]
      },
      options: {
        ...baseOptions,
        plugins: {
          ...baseOptions.plugins,
          tooltip: {
            ...baseOptions.plugins.tooltip,
            callbacks: {
              label: ctx => ctx.raw !== null ? `Median: ${ctx.raw} hrs (n=${counts[ctx.dataIndex]})` : 'No data'
            }
          }
        },
        scales: {
          ...baseOptions.scales,
          y: {
            ...baseOptions.scales.y,
            title: { display: true, text: 'Hours', color: '#7d8590', font: { family: 'DM Mono', size: 10 } }
          }
        }
      }
    });
  }

  return {
    renderAccessBlockByDiscipline,
    renderAccessBlockRate,
    renderLosTrend,
    renderSegmentBreakdown,
    renderHeatmap,
    renderDowChart,
    destroyChart
  };

})();
