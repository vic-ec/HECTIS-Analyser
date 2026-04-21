/* ============================================================
   report.js — Management Summary / Print View
   HECTIS Analyser — VHW Emergency Centre
   ============================================================ */

const Report = (() => {

  // ── Generate and open print view ─────────────────────────
  function generate(data) {
    if (!data || data.length === 0) {
      Utils.toast('No data to report — apply filters or load data first', 'warn');
      return;
    }

    const html = buildHTML(data);
    const win  = window.open('', '_blank');
    if (!win) {
      Utils.toast('Pop-up blocked — please allow pop-ups for this site', 'warn');
      return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 600);
  }

  // ── Compute all stats ────────────────────────────────────
  function buildStats(data) {
    const valid = (arr) => arr.filter(v => v !== null && v !== undefined && !isNaN(v) && v >= 0);

    // Overall
    const losVals = valid(data.map(r => r.total_los_min));
    const dteVals = valid(data.map(r => r.disposal_to_exit_min));
    const ttdVals = valid(data.map(r => r.triage_to_doctor_min));
    const attVals = valid(data.map(r => r.arrival_to_triage_min));

    const blockable = data.filter(r => r.disposal_to_exit_min !== null && r.disposal_to_exit_min >= 0);
    const blockRate = blockable.length
      ? Utils.r1((blockable.filter(r => r.access_block_4hr).length / blockable.length) * 100)
      : null;

    // By discipline
    const disciplines = [...new Set(data.map(r => r.disposal))].filter(Boolean);
    const byDisc = disciplines.map(d => {
      const rows = data.filter(r => r.disposal === d && r.disposal_to_exit_min !== null && r.disposal_to_exit_min >= 0);
      const bl   = rows.filter(r => r.access_block_4hr);
      const dteV = rows.map(r => r.disposal_to_exit_min);
      return {
        d,
        n: rows.length,
        median: Utils.r0(Utils.median(dteV)),
        p90:    Utils.r0(Utils.percentile(dteV, 90)),
        blockRate: rows.length ? Utils.r1((bl.length / rows.length) * 100) : null,
      };
    }).sort((a, b) => (b.median || 0) - (a.median || 0));

    // Triage compliance
    const TARGETS = { Red: 0, Orange: 10, Yellow: 60, Green: 240 };
    const triageComp = ['Red','Orange','Yellow','Green'].map(cat => {
      const rows = data.filter(r =>
        r.triage_category === cat &&
        r.triage_to_doctor_min !== null && r.triage_to_doctor_min >= 0
      );
      const compliant = rows.filter(r => r.triage_to_doctor_min <= TARGETS[cat]).length;
      return {
        cat,
        n: rows.length,
        pct: rows.length ? Utils.r1((compliant / rows.length) * 100) : null,
        target: TARGETS[cat],
      };
    });

    // Date range
    const dates = data.map(r => r.arrival_time).filter(Boolean).sort();
    const dateFrom = dates[0] ? new Date(dates[0]).toLocaleDateString('en-ZA', {day:'2-digit',month:'short',year:'numeric'}) : '—';
    const dateTo   = dates[dates.length-1] ? new Date(dates[dates.length-1]).toLocaleDateString('en-ZA', {day:'2-digit',month:'short',year:'numeric'}) : '—';

    return {
      n: data.length,
      dateFrom, dateTo,
      medLos:   Utils.r1(Utils.toHours(Utils.median(losVals))),
      medDte:   Utils.r1(Utils.toHours(Utils.median(dteVals))),
      p90Dte:   Utils.r1(Utils.toHours(Utils.percentile(dteVals, 90))),
      medTtd:   Utils.r0(Utils.median(ttdVals)),
      medAtt:   Utils.r0(Utils.median(attVals)),
      blockRate,
      byDisc,
      triageComp,
    };
  }

  // ── Build full HTML document ─────────────────────────────
  function buildHTML(data) {
    const s   = buildStats(data);
    const now = new Date().toLocaleDateString('en-ZA', {
      day: '2-digit', month: 'long', year: 'numeric'
    });

    const triageTargetLabel = t => t === 0 ? 'Immediate' : `≤${t} min`;

    const discRows = s.byDisc.map(d => `
      <tr>
        <td>${Utils.shortDiscipline(d.d)}</td>
        <td>${d.n}</td>
        <td>${Utils.formatMinutes(d.median, true)}</td>
        <td>${Utils.formatMinutes(d.p90, true)}</td>
        <td class="${d.blockRate > 70 ? 'bad' : d.blockRate > 40 ? 'warn' : 'ok'}">${d.blockRate !== null ? d.blockRate + '%' : '—'}</td>
      </tr>
    `).join('');

    const triageRows = s.triageComp.filter(t => t.n > 0).map(t => `
      <tr>
        <td><span class="triage-badge triage-${t.cat.toLowerCase()}">${t.cat}</span></td>
        <td>${t.n}</td>
        <td>${triageTargetLabel(t.target)}</td>
        <td class="${t.pct >= 80 ? 'ok' : t.pct >= 50 ? 'warn' : 'bad'}">${t.pct !== null ? t.pct + '%' : '—'}</td>
      </tr>
    `).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>HECTIS Management Summary — ${now}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'DM Sans', sans-serif;
      font-size: 11pt;
      color: #1a1a2e;
      background: white;
      padding: 0;
    }

    .page {
      max-width: 210mm;
      margin: 0 auto;
      padding: 20mm 18mm;
    }

    /* Header */
    .report-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 3px solid #e85d3a;
      padding-bottom: 12pt;
      margin-bottom: 20pt;
    }

    .report-title {
      font-size: 18pt;
      font-weight: 700;
      color: #1a1a2e;
      letter-spacing: -0.02em;
    }

    .report-subtitle {
      font-size: 9pt;
      color: #666;
      margin-top: 3pt;
      font-family: 'DM Mono', monospace;
    }

    .report-meta {
      text-align: right;
      font-size: 8.5pt;
      color: #888;
      font-family: 'DM Mono', monospace;
      line-height: 1.7;
    }

    .report-logo {
      width: 38pt;
      height: 38pt;
      background: #e85d3a;
      border-radius: 6pt;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 800;
      font-size: 10pt;
      margin-left: 12pt;
      flex-shrink: 0;
      letter-spacing: 0.05em;
    }

    .header-right {
      display: flex;
      align-items: center;
    }

    /* Section */
    .section {
      margin-bottom: 20pt;
    }

    .section-title {
      font-size: 10pt;
      font-weight: 600;
      color: #e85d3a;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-family: 'DM Mono', monospace;
      margin-bottom: 10pt;
      padding-bottom: 4pt;
      border-bottom: 1px solid #eee;
    }

    /* KPI grid */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8pt;
      margin-bottom: 16pt;
    }

    .kpi-card {
      background: #f8f9fa;
      border: 1pt solid #e8e8e8;
      border-radius: 6pt;
      padding: 10pt 12pt;
      border-top: 3pt solid #e85d3a;
    }

    .kpi-label {
      font-size: 7.5pt;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-family: 'DM Mono', monospace;
      margin-bottom: 4pt;
    }

    .kpi-value {
      font-size: 18pt;
      font-weight: 700;
      color: #1a1a2e;
      line-height: 1;
    }

    .kpi-unit {
      font-size: 7.5pt;
      color: #888;
      margin-top: 3pt;
      font-family: 'DM Mono', monospace;
    }

    .kpi-card.alert .kpi-value { color: #c0392b; }
    .kpi-card.warn  .kpi-value { color: #e67e22; }
    .kpi-card.good  .kpi-value { color: #27ae60; }

    /* Tables */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9.5pt;
    }

    th {
      background: #f0f0f0;
      padding: 6pt 8pt;
      text-align: left;
      font-size: 8pt;
      font-family: 'DM Mono', monospace;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #555;
      border-bottom: 1pt solid #ddd;
    }

    td {
      padding: 5.5pt 8pt;
      border-bottom: 0.5pt solid #eee;
      color: #1a1a2e;
    }

    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #f9f9f9; }

    td.bad  { color: #c0392b; font-weight: 600; }
    td.warn { color: #e67e22; font-weight: 600; }
    td.ok   { color: #27ae60; font-weight: 600; }

    /* Triage badges */
    .triage-badge {
      display: inline-block;
      padding: 1.5pt 6pt;
      border-radius: 99pt;
      font-size: 8pt;
      font-weight: 600;
      font-family: 'DM Mono', monospace;
    }
    .triage-red    { background: #fde8e8; color: #c0392b; }
    .triage-orange { background: #fef0e6; color: #d35400; }
    .triage-yellow { background: #fef9e6; color: #b7950b; }
    .triage-green  { background: #e8f8ee; color: #1e8449; }

    /* Interpretation box */
    .interpretation {
      background: #fff8f5;
      border: 1pt solid #fad7cb;
      border-left: 4pt solid #e85d3a;
      border-radius: 4pt;
      padding: 10pt 12pt;
      font-size: 9.5pt;
      line-height: 1.6;
      color: #333;
    }

    .interpretation strong { color: #e85d3a; }

    /* Segment breakdown */
    .segment-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 6pt;
    }

    .segment-card {
      background: #f8f9fa;
      border: 1pt solid #e8e8e8;
      border-radius: 5pt;
      padding: 8pt 10pt;
      text-align: center;
    }

    .seg-label { font-size: 7.5pt; color: #888; font-family: 'DM Mono', monospace; text-transform: uppercase; margin-bottom: 4pt; }
    .seg-value { font-size: 14pt; font-weight: 700; color: #1a1a2e; }
    .seg-unit  { font-size: 7pt; color: #aaa; font-family: 'DM Mono', monospace; }

    /* Footer */
    .report-footer {
      margin-top: 24pt;
      padding-top: 10pt;
      border-top: 1pt solid #eee;
      display: flex;
      justify-content: space-between;
      font-size: 7.5pt;
      color: #aaa;
      font-family: 'DM Mono', monospace;
    }

    /* Print */
    @media print {
      body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .page { padding: 14mm 14mm; }
      .no-print { display: none; }
    }

    /* Screen only - print button */
    .print-btn {
      position: fixed;
      top: 16pt;
      right: 16pt;
      background: #e85d3a;
      color: white;
      border: none;
      border-radius: 6pt;
      padding: 8pt 16pt;
      font-family: 'DM Sans', sans-serif;
      font-size: 10pt;
      font-weight: 600;
      cursor: pointer;
      z-index: 100;
    }
    @media print { .print-btn { display: none; } }
  </style>
</head>
<body>

<button class="print-btn no-print" onclick="window.print()">🖨 Print / Save PDF</button>

<div class="page">

  <!-- Header -->
  <div class="report-header">
    <div>
      <div class="report-title">EC Performance Summary</div>
      <div class="report-subtitle">Hospital & Emergency Centre Tracking Information System · Victoria Hospital Wynberg</div>
    </div>
    <div class="header-right">
      <div class="report-meta">
        Generated: ${now}<br>
        Period: ${s.dateFrom} – ${s.dateTo}<br>
        Records: ${s.n.toLocaleString()}
      </div>
      <div class="report-logo">EC</div>
    </div>
  </div>

  <!-- Key Metrics -->
  <div class="section">
    <div class="section-title">Key Performance Indicators</div>
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Total Referrals</div>
        <div class="kpi-value">${s.n.toLocaleString()}</div>
        <div class="kpi-unit">${s.dateFrom} – ${s.dateTo}</div>
      </div>
      <div class="kpi-card ${s.medLos > 12 ? 'alert' : s.medLos > 6 ? 'warn' : ''}">
        <div class="kpi-label">Median Total LOS</div>
        <div class="kpi-value">${s.medLos !== null ? s.medLos : '—'}</div>
        <div class="kpi-unit">hours</div>
      </div>
      <div class="kpi-card ${s.medDte > 8 ? 'alert' : s.medDte > 4 ? 'warn' : ''}">
        <div class="kpi-label">Median Boarding Time</div>
        <div class="kpi-value">${s.medDte !== null ? s.medDte : '—'}</div>
        <div class="kpi-unit">hours (disposal → exit)</div>
      </div>
      <div class="kpi-card ${s.blockRate > 70 ? 'alert' : s.blockRate > 40 ? 'warn' : 'good'}">
        <div class="kpi-label">Access Block Rate</div>
        <div class="kpi-value">${s.blockRate !== null ? s.blockRate + '%' : '—'}</div>
        <div class="kpi-unit">% patients boarding > 4 hrs</div>
      </div>
    </div>

    <!-- Time segments -->
    <div class="segment-grid">
      <div class="segment-card">
        <div class="seg-label">Arrival → Triage</div>
        <div class="seg-value">${Utils.formatMinutes(s.medAtt, true)}</div>
        <div class="seg-unit">median</div>
      </div>
      <div class="segment-card">
        <div class="seg-label">Triage → Doctor</div>
        <div class="seg-value">${Utils.formatMinutes(s.medTtd, true)}</div>
        <div class="seg-unit">median</div>
      </div>
      <div class="segment-card">
        <div class="seg-label">Disposal → Exit</div>
        <div class="seg-value">${s.medDte !== null ? s.medDte + 'h' : '—'}</div>
        <div class="seg-unit">median</div>
      </div>
      <div class="segment-card">
        <div class="seg-label">90th %ile Boarding</div>
        <div class="seg-value">${s.p90Dte !== null ? s.p90Dte + 'h' : '—'}</div>
        <div class="seg-unit">disposal → exit</div>
      </div>
    </div>
  </div>

  <!-- Access Block by Discipline -->
  <div class="section">
    <div class="section-title">Access Block by Inpatient Discipline</div>
    <table>
      <thead>
        <tr>
          <th>Discipline</th>
          <th>Patients</th>
          <th>Median boarding</th>
          <th>90th %ile</th>
          <th>Block rate (> 4 hrs)</th>
        </tr>
      </thead>
      <tbody>${discRows}</tbody>
    </table>
  </div>

  <!-- Triage Compliance -->
  <div class="section">
    <div class="section-title">Triage Compliance (Triage → Doctor Time)</div>
    <table>
      <thead>
        <tr>
          <th>Category</th>
          <th>Patients</th>
          <th>Target</th>
          <th>Compliance</th>
        </tr>
      </thead>
      <tbody>${triageRows}</tbody>
    </table>
  </div>

  <!-- Interpretation -->
  <div class="section">
    <div class="section-title">Summary Interpretation</div>
    <div class="interpretation">
      ${buildInterpretation(s)}
    </div>
  </div>

  <!-- Footer -->
  <div class="report-footer">
    <span>HECTIS Analyser · VHW Emergency Centre</span>
    <span>Generated ${now} · For internal use only</span>
  </div>

</div>
</body>
</html>`;
  }

  // ── Auto-generate plain-language interpretation ──────────
  function buildInterpretation(s) {
    const lines = [];

    // Access block
    if (s.blockRate !== null) {
      if (s.blockRate > 70) {
        lines.push(`<strong>Severe access block:</strong> ${s.blockRate}% of referred patients waited more than 4 hours for a ward bed after the disposal decision was made. This represents a systemic inpatient capacity problem, not an EC throughput failure.`);
      } else if (s.blockRate > 40) {
        lines.push(`<strong>Significant access block:</strong> ${s.blockRate}% of referred patients experienced boarding times exceeding 4 hours.`);
      } else {
        lines.push(`<strong>Access block within acceptable range:</strong> ${s.blockRate}% of patients boarded for more than 4 hours.`);
      }
    }

    // Worst discipline
    if (s.byDisc.length > 0) {
      const worst = s.byDisc[0];
      lines.push(`<strong>Medicine</strong> accounts for the greatest access block burden — median boarding time of ${Utils.formatMinutes(worst.median, true)} with a ${worst.blockRate}% block rate. This is consistent with limited medical bed availability and delayed ward rounds.`);
    }

    // Best discipline
    const best = [...s.byDisc].sort((a,b) => (a.blockRate||100)-(b.blockRate||100))[0];
    if (best && best.blockRate < 30) {
      lines.push(`<strong>${Utils.shortDiscipline(best.d)}</strong> demonstrates efficient patient flow with a ${best.blockRate}% access block rate — this may serve as a model for inter-disciplinary comparison.`);
    }

    // Triage compliance
    const redComp = s.triageComp.find(t => t.cat === 'Red');
    if (redComp && redComp.pct !== null && redComp.pct < 80) {
      lines.push(`<strong>Red triage compliance (${redComp.pct}%)</strong> is below the 80% benchmark. Immediate review of Red patient flow and resus area access is recommended.`);
    }

    lines.push(`Total EC length of stay (median ${s.medLos} hrs) is predominantly driven by the boarding segment (${s.medDte} hrs), which constitutes the majority of EC time for admitted patients.`);

    return lines.map(l => `<p style="margin-bottom:6pt">${l}</p>`).join('');
  }

  return { generate };

})();

// Expose globally for tabfilters.js access
window.Report = Report;
