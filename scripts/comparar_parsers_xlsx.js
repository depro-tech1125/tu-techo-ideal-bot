const fs = require('fs');
const XLSX = require('xlsx');
const { parseXlsxBufferToProperties } = require('../server.js');

function oldParser(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet || !sheet['!ref']) return [];
  const range = XLSX.utils.decode_range(sheet['!ref']);

  const headers = [];
  for (let C = range.s.c; C <= range.e.c; ++C) {
    const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c: C })];
    headers.push(cell ? String(cell.v).trim() : `col_${C}`);
  }

  const records = [];
  for (let R = range.s.r + 1; R <= range.e.r; ++R) {
    const row = {};
    let hasData = false;
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const header = headers[C];
      if (!header) continue;
      const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = sheet[cellRef];
      let val = cell ? (cell.v !== undefined ? String(cell.v).trim() : '') : '';

      // Extraer hipervínculo nativo si existe en la celda
      if (cell && cell.l && cell.l.Target) {
        row[header + '_URL'] = cell.l.Target;
        if (!val || val.startsWith('🏢') || val.startsWith('📷') || val.startsWith('🔗') || val.startsWith('🌐')) {
          val = cell.l.Target;
        }
      }
      row[header] = val;
      if (val) hasData = true;
    }

    if (hasData && row['ID_PROPIEDAD']) {
      // Extraer código WASI (número de 7 a 9 dígitos)
      const wasiUrl = row['Wasi_URL'] || row['Wasi'] || '';
      const wasiMatch = wasiUrl.match(/\/(\d{7,9})(?:\?|$)/);
      row['CODIGO_WASI'] = wasiMatch ? wasiMatch[1] : '';

      // Limpieza de teléfono de asesor
      let agentPhone = (row['Numero de WhatsApp'] || row['WhatsApp'] || '').replace(/[^0-9]/g, '');
      if (agentPhone.length === 10 && agentPhone.startsWith('4')) {
        agentPhone = '58' + agentPhone;
      } else if (agentPhone.length === 11 && agentPhone.startsWith('04')) {
        agentPhone = '58' + agentPhone.substring(1);
      }
      row['TELEFONO_ASESOR_CLEAN'] = agentPhone;

      records.push(row);
    }
  }
  return records;
}

const files = [
  'google_sheet_backup_original.xlsx',
  'google_sheet_live_audit.xlsx',
  'google_sheet_Hoja1_COMPLETA_CORREGIDA_FINAL.xlsx'
];

let totalComparisons = 0;
let totalDiffs = 0;

for (const f of files) {
  if (!fs.existsSync(f)) {
    console.log(`Archivo no encontrado: ${f}`);
    continue;
  }
  const buf = fs.readFileSync(f);
  const oldRes = oldParser(buf);
  const newRes = parseXlsxBufferToProperties(buf);
  console.log(`\n======================================================`);
  console.log(`Auditoría de Compatibilidad en: ${f}`);
  console.log(`======================================================`);
  console.log(`Registros Parser Anterior: ${oldRes.length}`);
  console.log(`Registros Parser Nuevo:    ${newRes.length}`);

  let fileDiffs = 0;
  const maxLen = Math.max(oldRes.length, newRes.length);
  for (let i = 0; i < maxLen; i++) {
    const o = oldRes[i] || {};
    const n = newRes[i] || {};
    const allKeys = Array.from(new Set([...Object.keys(o), ...Object.keys(n)]));
    for (const k of allKeys) {
      totalComparisons++;
      if (o[k] !== n[k]) {
        console.log(`[DIFERENCIA] ${o.ID_PROPIEDAD || n.ID_PROPIEDAD} [${k}]: Anterior="${o[k]}" | Nuevo="${n[k]}"`);
        fileDiffs++;
        totalDiffs++;
      }
    }
  }

  if (fileDiffs === 0) {
    console.log(`✅ EXACTITUD 100%: Cero diferencias entre parser anterior y nuevo.`);
  } else {
    console.log(`⚠️ Se detectaron ${fileDiffs} diferencias.`);
  }
}

console.log(`\nResumen General: ${totalComparisons} campos comparados, ${totalDiffs} diferencias.`);

