/* ============================================================
   patientflow.js — Patient Flow Tab
   Admissions rate, exits rate, access block vs EC deaths
   HECTIS Analyser — VHW Emergency Centre
   ============================================================ */

const PatientFlow = (() => {

  // ── Age group bins ────────────────────────────────────────
  const AGE_GROUPS = [
    { label: '0–4',   min: 0,  max: 4  },
    { label: '5–17',  min: 5,  max: 17 },
    { label: '18–39', min: 18, max: 39 },
    { label: '40–59', min: 40, max: 59 },
    { label: '60–74', min: 60, max: 74 },
    { label: '75+',   min: 75, max: 999 },
  ];

  const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const EXIT_DISPOSALS = ['Discharged','Absconded','RHT','Deferral',
    'Discharged to OPD','Discharged to Forensics','Discharged to Minor Ops',
    'Deceased','DOA','DOA (Natural)','DOA (Unnatural)','Deceased (Natural)'];

  // ── Parse age_raw to numeric years ───────────────────────
  function parseAge(raw) {
    if (!raw) return null;
    const s = String(raw).toUpperCase().trim();
    const mY = s.match(/^(\d+)Y/);
    if (mY) return parseInt(mY[1]);
    const mD = s.match(/^(\d+)D/);
    if (mD) return 0;
    const mM = s.match(/^(\d+)M/);
    if (mM) return Math.floor(parseInt(mM[1]) / 12);
    const mN = s.match(/^(\d+)/);
    if (mN) return parseInt(mN[1]);
    return null;
  }

  function ageGroup(raw) {
    const age = parseAge(raw);
    if (age === null) return null;
    const grp = AGE_GROUPS.find(g => age >= g.min && age <= g.max);
    return grp ? grp.label : null;
  }

  // ── Month key helper ─────────────────────────────────────
  function monthKey(r) {
    if (!r.upload_year || !r.upload_month) return null;
    return `${r.upload_year}-${String(r.upload_month).padStart(2,'0')}`;
  }

  function monthLabel(k) {
    const [y, m] = k.split('-');
    return `${MONTH_NAMES[parseInt(m)]} ${y}`;
  }

  // ── Main render ──────────────────────────────────────────
  function render(data, stat = 'median') {
    if (!data || !data.length) {
      const pfEl = document.getElementById('pf-content');
    if (pfEl) pfEl.innerHTML = '<div class="empty-state"><div class="empty-icon">⊘</div><p>No data available</p></div>';
      return;
    }

    renderAdmissionsChart(data);
    renderExitsChart(data);
    renderAccessVsDeathsChart(data, stat);
    populateFilters(data);
  }

  // ── 1. Admissions rate ───────────────────────────────────
  function renderAdmissionsChart(data) {
    const canvas = document.getElementById('chart-pf-admissions');
    if (!canvas) return;
    const existing = Chart.getChart(canvas); if (existing) existing.destroy();

    const byMonth = {};
    data.forEach(r => {
      const k = monthKey(r);
      if (!k) return;
      if (!byMonth[k]) byMonth[k] = 0;
      byMonth[k]++;
    });

    const keys   = Object.keys(byMonth).sort();
    const labels = keys.map(monthLabel);
    const counts = keys.map(k => byMonth[k]);

    // Age breakdown datasets
    const ageDatasets = AGE_GROUPS.map((grp, i) => {
      const hues = [200, 160, 40, 20, 340, 280];
      const color = `hsl(${hues[i]},70%,55%)`;
      return {
        label: grp.label,
        data: keys.map(k => {
          return data.filter(r => {
            if (monthKey(r) !== k) return false;
            const ag = ageGroup(r.age_raw);
            return ag === grp.label;
          }).length;
        }),
        backgroundColor: color + '99',
        borderColor: color,
        borderWidth: 1,
        stack: 'age',
      };
    });

    new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets: ageDatasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels:{color:'#7d8590',font:{family:'DM Mono',size:11},boxWidth:12} },
          tooltip: {
            backgroundColor:'#21262d',borderColor:'#30363d',borderWidth:1,
            titleColor:'#e6edf3',bodyColor:'#7d8590',
            titleFont:{family:'DM Mono',size:11},bodyFont:{family:'DM Mono',size:11},padding:10,
            callbacks: {
              footer: items => {
                const total = items.reduce((s, i) => s + i.raw, 0);
                return `Total: ${total.toLocaleString()}`;
              }
            }
          },
          title: { display: false }
        },
        scales: {
          x: { stacked:true, ticks:{color:'#7d8590',font:{family:'DM Mono',size:9}}, grid:{color:'#21262d'}, border:{color:'#30363d'} },
          y: { stacked:true, min:0, ticks:{color:'#7d8590',font:{family:'DM Mono',size:10}}, grid:{color:'#21262d'}, border:{color:'#30363d'},
               title:{display:true,text:'Patient arrivals',color:'#7d8590',font:{family:'DM Mono',size:10}} }
        }
      }
    });
  }

  // ── 2. Exits rate ────────────────────────────────────────
  function renderExitsChart(data) {
    const canvasTrend  = document.getElementById('chart-pf-exits-trend');
    const canvasHour   = document.getElementById('chart-pf-exits-hour');
    if (!canvasTrend || !canvasHour) return;

    const exitData = data.filter(r => r.disposal && !Utils.isReferral(r.disposal));

    // Monthly trend by exit type
    const exitTypes = Utils.unique(exitData.map(r => r.disposal).filter(Boolean)).sort();
    const exitColors = {};
    const palette = ['#58a6ff','#3fb950','#d29922','#f85149','#bc8cff','#f778ba','#e07b39','#39c5c8','#a0c4ff'];
    exitTypes.forEach((t,i) => exitColors[t] = palette[i % palette.length]);

    const byMonthExit = {};
    exitData.forEach(r => {
      const k = monthKey(r);
      if (!k) return;
      if (!byMonthExit[k]) byMonthExit[k] = {};
      byMonthExit[k][r.disposal] = (byMonthExit[k][r.disposal] || 0) + 1;
    });
    const keys = Object.keys(byMonthExit).sort();

    const existingTrend = Chart.getChart(canvasTrend); if (existingTrend) existingTrend.destroy();
    new Chart(canvasTrend, {
      type: 'bar',
      data: {
        labels: keys.map(monthLabel),
        datasets: exitTypes.map(t => ({
          label: t,
          data: keys.map(k => byMonthExit[k]?.[t] || 0),
          backgroundColor: exitColors[t] + '99',
          borderColor: exitColors[t],
          borderWidth: 1, stack: 'exits',
        }))
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels:{color:'#7d8590',font:{family:'DM Mono',size:10},boxWidth:10} },
          tooltip: { backgroundColor:'#21262d',borderColor:'#30363d',borderWidth:1,
            titleColor:'#e6edf3',bodyColor:'#7d8590',
            titleFont:{family:'DM Mono',size:11},bodyFont:{family:'DM Mono',size:11},padding:10 }
        },
        scales: {
          x: { stacked:true, ticks:{color:'#7d8590',font:{family:'DM Mono',size:9}}, grid:{color:'#21262d'} },
          y: { stacked:true, min:0, ticks:{color:'#7d8590',font:{family:'DM Mono',size:10}}, grid:{color:'#21262d'},
               title:{display:true,text:'Patient exits',color:'#7d8590',font:{family:'DM Mono',size:10}} }
        }
      }
    });

    // Hourly distribution of exits
    const byHour = Array(24).fill(0);
    exitData.forEach(r => {
      if (!r.exit_time) return;
      const h = new Date(r.exit_time).getHours();
      if (!isNaN(h)) byHour[h]++;
    });
    const hourLabels = Array.from({length:24},(_,i)=>
      i===0?'12am':i<12?`${i}am`:i===12?'12p':`${i-12}p`);

    const existingHour = Chart.getChart(canvasHour); if (existingHour) existingHour.destroy();
    new Chart(canvasHour, {
      type: 'bar',
      data: {
        labels: hourLabels,
        datasets: [{
          label: 'Exits',
          data: byHour,
          backgroundColor: '#58a6ff88',
          borderColor: '#58a6ff',
          borderWidth: 1, borderRadius: 2,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display:false },
          tooltip: { backgroundColor:'#21262d',borderColor:'#30363d',borderWidth:1,
            titleColor:'#e6edf3',bodyColor:'#7d8590',
            titleFont:{family:'DM Mono',size:11},bodyFont:{family:'DM Mono',size:11},padding:10,
            callbacks: { label: ctx => `${ctx.raw.toLocaleString()} exits` }
          }
        },
        scales: {
          x: { ticks:{color:'#7d8590',font:{family:'DM Mono',size:10}}, grid:{color:'#21262d'} },
          y: { min:0, ticks:{color:'#7d8590',font:{family:'DM Mono',size:10}}, grid:{color:'#21262d'},
               title:{display:true,text:'Number of exits',color:'#7d8590',font:{family:'DM Mono',size:10}} }
        }
      }
    });
  }

  // ── 3. Referral boarding vs EC deaths — side-by-side bars ──
  function renderAccessVsDeathsChart(data, stat) {
    const canvas = document.getElementById('chart-pf-access-deaths');
    if (!canvas) return;
    const existing = Chart.getChart(canvas); if (existing) existing.destroy();

    const statLabels = {median:'Median',mean:'Mean',min:'Min',max:'Max'};
    const statLabel  = statLabels[stat] || 'Median';

    const calcS = (vals) => {
      if (!vals.length) return null;
      switch(stat) {
        case 'mean': return vals.reduce((a,b)=>a+b,0)/vals.length;
        case 'min':  return Math.min(...vals);
        case 'max':  return Math.max(...vals);
        default:     return Utils.median(vals);
      }
    };

    // All referrals with boarding time
    const refData = data.filter(r =>
      Utils.isReferral(r.disposal) &&
      r.disposal_to_exit_min !== null && r.disposal_to_exit_min >= 0
    );

    // EC deaths (bereavement room / mortuary / deceased/DOA disposals)
    const deathData = data.filter(r =>
      (r.location && (
        r.location.toLowerCase().includes('bereavement') ||
        r.location.toLowerCase().includes('mortuary')
      )) ||
      (r.disposal && (
        r.disposal.toLowerCase().includes('deceased') ||
        r.disposal.toLowerCase().includes('doa')
      ))
    );

    const allKeys = [...new Set([...refData, ...deathData].map(monthKey).filter(Boolean))].sort();
    const labels  = allKeys.map(monthLabel);

    // Boarding time by discipline for referrals
    const disciplines = [...new Set(refData.map(r => r.disposal).filter(Utils.isReferral))];
    const refDatasets = disciplines.map((d, i) => {
      const palette = ['#f85149','#58a6ff','#3fb950','#bc8cff','#d29922','#f778ba','#e07b39','#39c5c8'];
      const color = palette[i % palette.length];
      return {
        label: Utils.shortDiscipline(d),
        data: allKeys.map(k => {
          const vals = refData.filter(r => monthKey(r) === k && r.disposal === d)
            .map(r => r.disposal_to_exit_min);
          const v = calcS(vals);
          return v !== null ? Utils.r1(Utils.toHours(v)) : null;
        }),
        backgroundColor: color + '99',
        borderColor: color,
        borderWidth: 1, borderRadius: 2,
        stack: 'ref',
        yAxisID: 'y1',
      };
    });

    // EC deaths per month
    const deathDataset = {
      label: 'EC deaths (n)',
      data: allKeys.map(k => deathData.filter(r => monthKey(r) === k).length),
      backgroundColor: '#8b949e44',
      borderColor: '#8b949e',
      borderWidth: 2, borderRadius: 2,
      type: 'line',
      pointRadius: 3, tension: 0.3,
      yAxisID: 'y2',
    };

    new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets: [...refDatasets, deathDataset] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels:{color:'#7d8590',font:{family:'DM Mono',size:10},boxWidth:10} },
          tooltip: {
            backgroundColor:'#21262d',borderColor:'#30363d',borderWidth:1,
            titleColor:'#e6edf3',bodyColor:'#7d8590',
            titleFont:{family:'DM Mono',size:11},bodyFont:{family:'DM Mono',size:11},padding:10,
            mode:'index', intersect:false,
          }
        },
        scales: {
          x: { stacked:false, ticks:{color:'#7d8590',font:{family:'DM Mono',size:9}}, grid:{color:'#21262d'}, border:{color:'#30363d'} },
          y1: { type:'linear', position:'left', min:0, stacked:false,
            ticks:{color:'#7d8590',font:{family:'DM Mono',size:10},callback:v=>v+'h'},
            grid:{color:'#21262d'}, border:{color:'#30363d'},
            title:{display:true,text:`${statLabel} boarding time (hrs)`,color:'#7d8590',font:{family:'DM Mono',size:10}} },
          y2: { type:'linear', position:'right', min:0,
            ticks:{color:'#8b949e',font:{family:'DM Mono',size:10}},
            grid:{drawOnChartArea:false}, border:{color:'#30363d'},
            title:{display:true,text:'EC deaths (n)',color:'#8b949e',font:{family:'DM Mono',size:10}} }
        }
      }
    });
  }

  // ── Populate age/sex filters ─────────────────────────────
  function populateFilters(data) {
    // Age groups are fixed - just update the label
    const totalEl = document.getElementById('pf-total');
    if (totalEl) totalEl.textContent = data.length.toLocaleString() + ' patients';
  }

  return { render };

})();
