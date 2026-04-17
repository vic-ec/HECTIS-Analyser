/* ============================================================
   upload.js — File parsing & Supabase insertion
   HECTIS Analyser
   ============================================================ */

const Upload = (() => {

  // ── Expected Columns ─────────────────────────────────────
  const REQUIRED_COLS = [
    'Age', 'Sex', 'Arrival Time', 'Triage Time', 'Triage',
    'Consultation Time', 'Trauma', 'Disposal', 'Disposal Time',
    'Exit Time', 'Location'
  ];

  // ── Parse a Single Excel/CSV File ────────────────────────
  async function parseFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const wb = XLSX.read(data, { type: 'array', cellDates: true });
          const sheetName = wb.SheetNames[0];
          const ws = wb.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json(ws, { raw: false, dateNF: 'yyyy-mm-dd hh:mm:ss' });

          if (rows.length === 0) {
            return reject(new Error('File appears to be empty'));
          }

          // Validate columns
          const cols = Object.keys(rows[0]);
          const missing = REQUIRED_COLS.filter(c => !cols.includes(c));
          if (missing.length > 0) {
            return reject(new Error(`Missing columns: ${missing.join(', ')}`));
          }

          resolve({ rows, filename: file.name });
        } catch (err) {
          reject(new Error(`Failed to parse file: ${err.message}`));
        }
      };
      reader.onerror = () => reject(new Error('File read error'));
      reader.readAsArrayBuffer(file);
    });
  }

  // ── Parse Date String from SheetJS ──────────────────────
  function parseDate(val) {
    if (!val) return null;
    if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
    // SheetJS with cellDates:true returns strings like "2026-03-02 11:56:00"
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }

  // ── Transform Rows to DB Format ──────────────────────────
  function transformRows(rows, filename) {
    // Infer upload month/year from filename or data
    let upload_month = null;
    let upload_year  = null;

    // Try filename pattern: "March_2026", "2026_03", etc.
    const fnMonthMatch = filename.match(/(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)/i);
    const fnYearMatch  = filename.match(/20\d{2}/);

    if (fnYearMatch)  upload_year  = parseInt(fnYearMatch[0]);
    if (fnMonthMatch) {
      const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
      upload_month = MONTHS[fnMonthMatch[0].toLowerCase().slice(0,3)];
    }

    const transformed = [];
    let skippedCount = 0;

    for (const row of rows) {
      const arrivalTime    = parseDate(row['Arrival Time']);
      const triageTime     = parseDate(row['Triage Time']);
      const consultTime    = parseDate(row['Consultation Time']);
      const disposalTime   = parseDate(row['Disposal Time']);
      const exitTime       = parseDate(row['Exit Time']);

      // Skip rows with no arrival or exit time
      if (!arrivalTime || !exitTime) {
        skippedCount++;
        continue;
      }

      // Infer month/year from data if not in filename
      const ym = upload_year ? upload_year : arrivalTime.getFullYear();
      const mm = upload_month ? upload_month : (arrivalTime.getMonth() + 1);

      // Calculate time segments
      const atMin = Utils.minutesBetween(arrivalTime, triageTime);
      const tdMin = Utils.minutesBetween(triageTime, consultTime);
      const dcMin = Utils.minutesBetween(consultTime, disposalTime);
      const deMin = Utils.minutesBetween(disposalTime, exitTime);
      const losMin = Utils.minutesBetween(arrivalTime, exitTime);

      // Clean negative triage→doctor (data entry issue, set to null)
      const tdMinClean = (tdMin !== null && tdMin < 0) ? null : tdMin;

      const ageRaw  = row['Age'] ? String(row['Age']).trim() : null;
      const ageYrs  = Utils.parseAge(ageRaw);

      // Sanitise trauma — reject Date objects or timestamp strings (data entry errors)
      const rawTrauma = row['Trauma'];
      const traumaVal = (() => {
        if (!rawTrauma) return null;
        if (rawTrauma instanceof Date) return null;
        const s = String(rawTrauma).trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
        if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(s)) return null;
        if (s === '' || s === '-' || s === 'None') return null;
        return s;
      })();

      // Sanitise triage — only accept known values
      const rawTriage = row['Triage'] ? String(row['Triage']).trim() : null;
      const triageVal = ['Red','Orange','Yellow','Green'].includes(rawTriage) ? rawTriage : null;

      transformed.push({
        age_raw:                ageRaw,
        age_years:              ageYrs,
        sex:                    row['Sex'] ? String(row['Sex']).trim() : null,
        triage_category:        triageVal,
        trauma:                 traumaVal,
        arrival_time:           arrivalTime.toISOString(),
        triage_time:            triageTime ? triageTime.toISOString() : null,
        consultation_time:      consultTime ? consultTime.toISOString() : null,
        disposal_time:          disposalTime ? disposalTime.toISOString() : null,
        exit_time:              exitTime.toISOString(),
        disposal:               row['Disposal'] ? String(row['Disposal']).trim() : null,
        location:               row['Location'] ? String(row['Location']).trim() : null,
        arrival_to_triage_min:  atMin !== null && atMin >= 0 ? Utils.r1(atMin) : null,
        triage_to_doctor_min:   tdMinClean !== null ? Utils.r1(tdMinClean) : null,
        doctor_to_disposal_min: dcMin !== null && dcMin >= 0 ? Utils.r1(dcMin) : null,
        disposal_to_exit_min:   deMin !== null && deMin >= 0 ? Utils.r1(deMin) : null,
        total_los_min:          losMin !== null && losMin >= 0 ? Utils.r1(losMin) : null,
        access_block_4hr:       deMin !== null && deMin >= 240,
        source_file:            filename,
        upload_month:           mm,
        upload_year:            ym,
      });
    }

    return { records: transformed, skipped: skippedCount };
  }

  // ── Process & Upload One File ────────────────────────────
  async function processFile(file, logFn) {
    logFn('info', `Parsing <span class="log-file">${file.name}</span>…`);

    let parsed;
    try {
      parsed = await parseFile(file);
    } catch (err) {
      logFn('error', `${file.name}: ${err.message}`);
      return false;
    }

    const { rows, filename } = parsed;
    logFn('info', `Found <span class="log-count">${rows.length} rows</span> — transforming…`);

    const { records, skipped } = transformRows(rows, filename);
    logFn('info', `<span class="log-count">${records.length} valid records</span>${skipped > 0 ? `, <span class="log-skipped">${skipped} skipped (missing timestamps)</span>` : ''}`);

    if (records.length === 0) {
      logFn('warn', 'No valid records to insert. Check file format.');
      return false;
    }

    logFn('info', `Uploading to HECTIS database…`);

    const result = await DB.insertRows(records);

    if (result.errors.length > 0) {
      result.errors.forEach(e => logFn('error', e));
    }

    const msg = `<span class="log-file">${filename}</span>: ` +
      `<span class="log-count">${result.inserted} inserted</span>` +
      (result.skipped > 0 ? `, <span class="log-skipped">${result.skipped} duplicates skipped</span>` : '');

    logFn(result.inserted > 0 ? 'success' : 'warn', msg);
    return result.inserted > 0;
  }

  // ── Process Multiple Files ───────────────────────────────
  async function processFiles(files, logFn, onDone) {
    let anySuccess = false;
    for (const file of files) {
      const ok = await processFile(file, logFn);
      if (ok) anySuccess = true;
    }
    if (onDone) onDone(anySuccess);
  }

  return { processFiles };

})();
