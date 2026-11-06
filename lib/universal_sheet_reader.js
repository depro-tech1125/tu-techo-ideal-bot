/**
 * LECTOR UNIVERSAL DE GOOGLE SHEETS
 * Tu Techo Ideal V5.1 — Depro Tech Solutions
 *
 * Elimina la dependencia de columnas fijas (A-M).
 * Reconoce dinámicamente cualquier columna en el inventario.
 * Detecta enlaces HTTP/HTTPS en celdas de texto, hipervínculos nativos y fórmulas HYPERLINK.
 * Asocia enlaces al ID_PROPIEDAD bajo una estructura dinámica `externalLinks`.
 * Detecta cambios de esquema (columnas agregadas, eliminadas, renombradas o reordenadas)
 * e invalida la caché de forma automática y determinística.
 *
 * Google Sheets es la fuente exclusiva de verdad inmobiliaria.
 */

const XLSX = require('xlsx');

// ============================================================================
// 1. CAMPOS ESTRUCTURALES Y OPCIONALES OFICIALES
// ============================================================================

const MANDATORY_STRUCTURAL_FIELDS = Object.freeze([
  'ID_PROPIEDAD',
  'TIPO',
  'OPERACION',
  'DESCRIPCION_BREVE',
  'ESTATUS'
]);

const KNOWN_OPTIONAL_FIELDS = Object.freeze([
  'LINK_FOTOS',
  'Wasi',
  'Mercado Libre',
  'Pagina Web',
  'Agente',
  'Numero de WhatsApp',
  'Mascotas',
  'Tipo de Mascotas'
]);

// Mapa de alias normalizados a nombres canónicos estructurales y opcionales
const CANONICAL_ALIASES = Object.freeze({
  // ID_PROPIEDAD
  'idpropiedad': 'ID_PROPIEDAD',
  'id': 'ID_PROPIEDAD',
  'ref': 'ID_PROPIEDAD',
  'codigo': 'ID_PROPIEDAD',
  'codinmueble': 'ID_PROPIEDAD',

  // TIPO
  'tipo': 'TIPO',
  'tipodeinmueble': 'TIPO',
  'tipoinmueble': 'TIPO',
  'tipopropiedad': 'TIPO',

  // OPERACION
  'operacion': 'OPERACION',
  'tipooperacion': 'OPERACION',

  // DESCRIPCION_BREVE
  'descripcionbreve': 'DESCRIPCION_BREVE',
  'descripcion': 'DESCRIPCION_BREVE',
  'detalle': 'DESCRIPCION_BREVE',
  'inmueble': 'DESCRIPCION_BREVE',

  // ESTATUS
  'estatus': 'ESTATUS',
  'estado': 'ESTATUS',
  'disponibilidad': 'ESTATUS',
  'status': 'ESTATUS',

  // LINK_FOTOS
  'linkfotos': 'LINK_FOTOS',
  'linkdefotos': 'LINK_FOTOS',
  'fotos': 'LINK_FOTOS',
  'galeria': 'LINK_FOTOS',
  'rexup': 'LINK_FOTOS',

  // Wasi
  'wasi': 'Wasi',
  'linkwasi': 'Wasi',
  'inmueblewasi': 'Wasi',

  // Mercado Libre
  'mercadolibre': 'Mercado Libre',
  'mercadolibrevenezuela': 'Mercado Libre',
  'linkmercadolibre': 'Mercado Libre',
  'ml': 'Mercado Libre',

  // Pagina Web
  'paginaweb': 'Pagina Web',
  'web': 'Pagina Web',
  'sitio': 'Pagina Web',
  'sitioweb': 'Pagina Web',
  'linkweb': 'Pagina Web',

  // Agente
  'agente': 'Agente',
  'asesor': 'Agente',
  'responsable': 'Agente',

  // Numero de WhatsApp
  'numerodewhatsapp': 'Numero de WhatsApp',
  'whatsapp': 'Numero de WhatsApp',
  'telefono': 'Numero de WhatsApp',
  'telefonowhatsapp': 'Numero de WhatsApp',
  'telefonodeasesor': 'Numero de WhatsApp',

  // Mascotas
  'mascotas': 'Mascotas',
  'aceptamascotas': 'Mascotas',

  // Tipo de Mascotas
  'tipodemascotas': 'Tipo de Mascotas',
  'tipomascotas': 'Tipo de Mascotas'
});

// ============================================================================
// 2. UTILIDADES DE NORMALIZACIÓN Y EXTRACCIÓN DE ENLACES
// ============================================================================

/**
 * Normaliza un encabezado para comparación insensible a mayúsculas,
 * espacios, guiones, acentos y caracteres especiales.
 */
function normalizeHeaderName(header) {
  if (!header || typeof header !== 'string') return '';
  return header
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Extrae una URL HTTP/HTTPS de una celda, soportando:
 * 1. Hipervínculo nativo XLSX (cell.l.Target)
 * 2. Fórmula =HYPERLINK("https://...", "Ver") (cell.f)
 * 3. Texto plano que contiene una URL HTTP/HTTPS (cell.v o string)
 */
function extractUrlFromCell(cell) {
  if (!cell && cell !== 0) return null;

  // 1. Hipervínculo nativo XLSX
  if (typeof cell === 'object' && cell.l && cell.l.Target) {
    const rawTarget = String(cell.l.Target).trim();
    if (/^https?:\/\//i.test(rawTarget)) {
      return rawTarget;
    }
  }

  // 2. Fórmula =HYPERLINK(...) en cell.f
  if (typeof cell === 'object' && cell.f) {
    const formula = String(cell.f).trim();
    const formulaMatch = formula.match(/HYPERLINK\s*\(\s*["']([^"']+)["']/i);
    if (formulaMatch && /^https?:\/\//i.test(formulaMatch[1].trim())) {
      return formulaMatch[1].trim();
    }
  }

  // 3. Valor plano (cell.v o string directo)
  const val = typeof cell === 'object' && cell.v !== undefined && cell.v !== null
    ? String(cell.v).trim()
    : (typeof cell === 'string' ? cell.trim() : '');

  if (val) {
    // Si la cadena contiene una fórmula HYPERLINK en texto plano (ej: exportada a CSV)
    const csvFormulaMatch = val.match(/=HYPERLINK\s*\(\s*["']([^"']+)["']/i);
    if (csvFormulaMatch && /^https?:\/\//i.test(csvFormulaMatch[1].trim())) {
      return csvFormulaMatch[1].trim();
    }

    // Si comienza con http:// o https://
    if (/^https?:\/\//i.test(val)) {
      const match = val.match(/https?:\/\/[^\s"'<>]+/i);
      return match ? match[0] : val;
    }

    // Si contiene una URL en alguna parte del texto
    const match = val.match(/https?:\/\/[^\s"'<>]+/i);
    if (match) {
      return match[0];
    }
  }

  return null;
}

/**
 * Extrae el dominio limpio de una URL
 */
function extractDomainFromUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return '';
  try {
    const parsed = new URL(urlStr.trim());
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch (e) {
    const m = urlStr.match(/https?:\/\/([^\/\s?#]+)/i);
    return m ? m[1].toLowerCase().replace(/^www\./, '') : '';
  }
}

/**
 * Limpia el teléfono de WhatsApp al formato internacional de Venezuela (584...)
 */
function cleanVenezuelanPhone(phoneRaw) {
  if (!phoneRaw) return '';
  let phone = String(phoneRaw).replace(/[^0-9]/g, '');
  if (phone.length === 10 && phone.startsWith('4')) {
    phone = '58' + phone;
  } else if (phone.length === 11 && phone.startsWith('04')) {
    phone = '58' + phone.substring(1);
  }
  return phone;
}

/**
 * Extrae código numérico WASI (6 a 9 dígitos)
 */
function extractWasiCode(wasiValue) {
  if (!wasiValue) return '';
  const str = String(wasiValue).trim();
  const urlMatch = str.match(/\/(\d{6,9})(?:[^\d]|$)/);
  if (urlMatch) return urlMatch[1];
  const plainMatch = str.match(/^\s*(\d{6,9})\s*$/);
  if (plainMatch) return plainMatch[1];
  return '';
}

// ============================================================================
// 3. DETECCIÓN DE ESQUEMA Y HUELLA DIGITAL (FINGERPRINT)
// ============================================================================

/**
 * Genera una huella digital determinística a partir de la lista de encabezados.
 */
function computeSchemaFingerprint(headers = []) {
  const cleanHeaders = headers.map(h => (h || '').toString().trim());
  const normalized = cleanHeaders.map(h => normalizeHeaderName(h));
  return {
    rawHeaders: cleanHeaders,
    normalizedHeaders: normalized,
    columnCount: cleanHeaders.length,
    hash: `${cleanHeaders.length}::${normalized.join('|')}`
  };
}

/**
 * Compara dos esquemas y detecta cambios (columnas agregadas, eliminadas, renombradas o reordenadas).
 */
function detectSchemaChanges(previousSchema, currentSchema) {
  if (!previousSchema) {
    return {
      hasChanged: true,
      isInitial: true,
      addedColumns: [...currentSchema.rawHeaders],
      removedColumns: [],
      renamedColumns: [],
      reorderedColumns: false,
      summary: 'Inicialización de esquema de inventario.'
    };
  }

  const prevNorm = previousSchema.normalizedHeaders || [];
  const currNorm = currentSchema.normalizedHeaders || [];
  const prevRaw = previousSchema.rawHeaders || [];
  const currRaw = currentSchema.rawHeaders || [];

  const added = [];
  const removed = [];

  // Columnas agregadas
  currNorm.forEach((cn, idx) => {
    if (cn && !prevNorm.includes(cn)) {
      added.push(currRaw[idx]);
    }
  });

  // Columnas eliminadas
  prevNorm.forEach((pn, idx) => {
    if (pn && !currNorm.includes(pn)) {
      removed.push(prevRaw[idx]);
    }
  });

  // Reordenamiento
  const commonInPrev = prevNorm.filter(h => currNorm.includes(h));
  const commonInCurr = currNorm.filter(h => prevNorm.includes(h));
  const reordered = commonInPrev.join('|') !== commonInCurr.join('|');

  const hasChanged = added.length > 0 || removed.length > 0 || reordered || previousSchema.hash !== currentSchema.hash;

  return {
    hasChanged,
    isInitial: false,
    addedColumns: added,
    removedColumns: removed,
    reorderedColumns: reordered,
    summary: hasChanged
      ? `Cambio detectado: ${added.length} agregadas (${added.join(', ')}), ${removed.length} eliminadas (${removed.join(', ')}), reordenado: ${reordered}`
      : 'Esquema idéntico sin cambios estructurales.'
  };
}

// ============================================================================
// 4. PARSER UNIVERSAL DE HOJAS DE CÁLCULO
// ============================================================================

/**
 * Valida la presencia de las 5 columnas estructurales obligatorias en los encabezados.
 */
function validateMandatoryHeaders(headers) {
  const normalizedHeaders = headers.map(normalizeHeaderName);
  const missing = [];

  for (const field of MANDATORY_STRUCTURAL_FIELDS) {
    const aliasKey = normalizeHeaderName(field);
    const found = normalizedHeaders.some(h => {
      if (h === aliasKey) return true;
      if (CANONICAL_ALIASES[h] === field) return true;
      return false;
    });
    if (!found) {
      missing.push(field);
    }
  }

  return {
    isValid: missing.length === 0,
    missingFields: missing
  };
}

/**
 * Mapea una celda a su valor de texto plano
 */
function getCellPlainValue(cell) {
  if (cell === undefined || cell === null) return '';
  if (typeof cell === 'object') {
    return (cell.v !== undefined && cell.v !== null) ? String(cell.v).trim() : '';
  }
  return String(cell).trim();
}

/**
 * Procesa un conjunto de filas y encabezados para generar propiedades con
 * estructura dinámica universal `externalLinks`.
 */
function processUniversalRows(headers, rowsData, options = {}) {
  const { previousSchema = null, logChanges = false } = options;

  const currentSchema = computeSchemaFingerprint(headers);
  const schemaChange = detectSchemaChanges(previousSchema, currentSchema);

  if (logChanges && schemaChange.hasChanged) {
    console.log(`[UniversalSheetReader] ${schemaChange.summary}`);
  }

  // Validar cabeceras estructurales a nivel de hoja
  const headerValidation = validateMandatoryHeaders(headers);
  const sheetIntegrityErrors = [];
  if (!headerValidation.isValid) {
    sheetIntegrityErrors.push(
      `Error de Integridad de Hoja: Faltan columnas estructurales obligatorias: ${headerValidation.missingFields.join(', ')}`
    );
  }

  // Mapear cada columna por índice a su encabezado original y normalizado
  const columnMap = headers.map((origHeader, idx) => {
    const cleanOrig = (origHeader || '').toString().trim();
    const norm = normalizeHeaderName(cleanOrig);
    const canonical = CANONICAL_ALIASES[norm] || null;
    return {
      index: idx,
      originalHeader: cleanOrig,
      normalizedHeader: norm,
      canonicalField: canonical,
      isMandatory: canonical ? MANDATORY_STRUCTURAL_FIELDS.includes(canonical) : false,
      isOptional: canonical ? KNOWN_OPTIONAL_FIELDS.includes(canonical) : false,
      isIgnored: !cleanOrig || cleanOrig.startsWith('col_') && !norm
    };
  });

  const records = [];
  const propertyIntegrityWarnings = [];
  const commercialContradictions = [];

  for (let rIdx = 0; rIdx < rowsData.length; rIdx++) {
    const rowCells = rowsData[rIdx];
    if (!rowCells) continue;

    const rawRow = {};
    const externalLinks = {};
    const externalLinksDetails = [];
    const unmappedColumns = {};

    let hasAnyData = false;

    // Primer paso: extraer celdas según el mapeo de columnas
    for (let c = 0; c < columnMap.length; c++) {
      const col = columnMap[c];
      if (col.isIgnored) continue;

      const cell = Array.isArray(rowCells) ? rowCells[c] : rowCells[col.originalHeader];
      const plainVal = getCellPlainValue(cell);
      const cellUrl = extractUrlFromCell(cell);

      if (plainVal || cellUrl) {
        hasAnyData = true;
      }

      const effectiveVal = cellUrl || plainVal;

      // Guardar en rawRow con nombre original
      rawRow[col.originalHeader] = effectiveVal;
      if (cellUrl) {
        rawRow[col.originalHeader + '_URL'] = cellUrl;
      }

      // Si la celda contiene una URL HTTP/HTTPS:
      // Se incorpora a externalLinks conservando el encabezado original
      if (cellUrl) {
        const domain = extractDomainFromUrl(cellUrl);
        externalLinks[col.originalHeader] = cellUrl;
        externalLinksDetails.push({
          header: col.originalHeader,
          url: cellUrl,
          domain: domain,
          canonical: col.canonicalField
        });
      }

      // Si es una columna desconocida (no estructural ni opcional conocida)
      if (!col.canonicalField) {
        // REGLA DE SEGURIDAD 5: Si no contiene URL, es un campo no comercial aislado
        if (!cellUrl && plainVal) {
          unmappedColumns[col.originalHeader] = plainVal;
        }
      }
    }

    if (!hasAnyData) continue;

    // Extracción de campos canónicos estructurales y opcionales
    const getCanonicalValue = (canonicalName) => {
      // Buscar en columnMap qué columnas coinciden con canonicalName
      for (const col of columnMap) {
        if (col.canonicalField === canonicalName) {
          const val = rawRow[col.originalHeader];
          if (val) return val;
        }
      }
      return rawRow[canonicalName] || '';
    };

    const idPropiedad = (getCanonicalValue('ID_PROPIEDAD') || '').toString().trim();

    // Solo procesar filas que posean un ID_PROPIEDAD
    if (!idPropiedad) {
      continue;
    }

    const tipo = (getCanonicalValue('TIPO') || '').toString().trim();
    const operacion = (getCanonicalValue('OPERACION') || '').toString().trim();
    const descripcionBreve = (getCanonicalValue('DESCRIPCION_BREVE') || '').toString().trim();
    const estatus = (getCanonicalValue('ESTATUS') || '').toString().trim();

    // Validar integridad estructural obligatoria por fila
    const missingRowFields = [];
    if (!tipo) missingRowFields.push('TIPO');
    if (!operacion) missingRowFields.push('OPERACION');
    if (!descripcionBreve) missingRowFields.push('DESCRIPCION_BREVE');
    if (!estatus) missingRowFields.push('ESTATUS');

    const isStructurallyValid = missingRowFields.length === 0 && headerValidation.isValid;
    let isQuarantined = false;
    let quarantineReason = null;

    if (!isStructurallyValid) {
      isQuarantined = true;
      quarantineReason = `INCOMPLETE_STRUCTURAL_DATA (Campos faltantes: ${missingRowFields.join(', ')})`;
      propertyIntegrityWarnings.push({
        id: idPropiedad,
        row: rIdx + 1,
        missingFields: missingRowFields,
        message: `Inmueble ${idPropiedad} incompleto en fila ${rIdx + 1}. Campos faltantes: ${missingRowFields.join(', ')}`
      });
    } else {
      const normOp = operacion.toLowerCase();
      const normDesc = descripcionBreve.toLowerCase();
      const normEstatus = estatus.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

      if (normOp.includes('alquiler') && /\b(?:en venta|para la venta|se vende)\b/i.test(normDesc) && !/\b(?:alquiler|arrendamiento|alquila|renta|canon)\b/i.test(normDesc)) {
        isQuarantined = true;
        quarantineReason = 'CONTRADICTION_OPERACION_DESCRIPCION (Registrado como Alquiler pero descripción indica exclusivamente venta)';
        commercialContradictions.push({
          id: idPropiedad,
          row: rIdx + 1,
          missingFields: [],
          message: `Inmueble ${idPropiedad} en cuarentena en fila ${rIdx + 1}: ${quarantineReason}`
        });
      } else if (normOp.includes('venta') && /\b(?:en alquiler|para alquilar|se alquila)\b/i.test(normDesc) && !/\b(?:venta|vende|compra)\b/i.test(normDesc)) {
        isQuarantined = true;
        quarantineReason = 'CONTRADICTION_OPERACION_DESCRIPCION (Registrado como Venta pero descripción indica exclusivamente alquiler)';
        commercialContradictions.push({
          id: idPropiedad,
          row: rIdx + 1,
          missingFields: [],
          message: `Inmueble ${idPropiedad} en cuarentena en fila ${rIdx + 1}: ${quarantineReason}`
        });
      }

      if (normEstatus === 'disponible' && /\b(?:vendido|reservad[oa]|no disponible|ya se alquil[oó]|ya se vendi[oó])\b/i.test(normDesc)) {
        isQuarantined = true;
        quarantineReason = 'CONTRADICTION_ESTATUS_DESCRIPCION (Registrado como Disponible pero descripción indica vendido/reservado)';
        commercialContradictions.push({
          id: idPropiedad,
          row: rIdx + 1,
          missingFields: [],
          message: `Inmueble ${idPropiedad} en cuarentena en fila ${rIdx + 1}: ${quarantineReason}`
        });
      }
    }

    // Campos opcionales conocidos
    const linkFotos = (getCanonicalValue('LINK_FOTOS') || '').toString().trim();
    const wasi = (getCanonicalValue('Wasi') || '').toString().trim();
    const mercadoLibre = (getCanonicalValue('Mercado Libre') || '').toString().trim();
    const paginaWeb = (getCanonicalValue('Pagina Web') || '').toString().trim();
    const agente = (getCanonicalValue('Agente') || '').toString().trim();
    const numeroWhatsApp = (getCanonicalValue('Numero de WhatsApp') || '').toString().trim();
    const mascotas = (getCanonicalValue('Mascotas') || '').toString().trim();
    const tipoMascotas = (getCanonicalValue('Tipo de Mascotas') || '').toString().trim();

    // Enlaces conocidos asegurados en externalLinks
    if (wasi && /^https?:\/\//i.test(wasi) && !externalLinks['Wasi']) {
      externalLinks['Wasi'] = wasi;
    }
    if (mercadoLibre && /^https?:\/\//i.test(mercadoLibre) && !externalLinks['Mercado Libre']) {
      externalLinks['Mercado Libre'] = mercadoLibre;
    }
    if (paginaWeb && /^https?:\/\//i.test(paginaWeb) && !externalLinks['Pagina Web']) {
      externalLinks['Pagina Web'] = paginaWeb;
    }
    if (linkFotos && /^https?:\/\//i.test(linkFotos) && !externalLinks['LINK_FOTOS']) {
      externalLinks['LINK_FOTOS'] = linkFotos;
    }

    // Derivados documentados
    const wasiUrlCandidate = rawRow['Wasi_URL'] || wasi || externalLinks['Wasi'] || '';
    const codigoWasi = extractWasiCode(wasiUrlCandidate);
    const telefonoAsesorClean = cleanVenezuelanPhone(numeroWhatsApp);

    const propertyRecord = {
      // Campos estructurales
      ID_PROPIEDAD: idPropiedad,
      TIPO: tipo,
      OPERACION: operacion,
      DESCRIPCION_BREVE: descripcionBreve,
      ESTATUS: estatus,

      // Campos opcionales retrocompatibles
      LINK_FOTOS: linkFotos,
      LINK_FOTOS_URL: rawRow['LINK_FOTOS_URL'] || (linkFotos.startsWith('http') ? linkFotos : ''),
      Wasi: wasi,
      Wasi_URL: rawRow['Wasi_URL'] || (wasi.startsWith('http') ? wasi : ''),
      'Mercado Libre': mercadoLibre,
      'Mercado Libre_URL': rawRow['Mercado Libre_URL'] || (mercadoLibre.startsWith('http') ? mercadoLibre : ''),
      Mercado_Libre: mercadoLibre,
      'Pagina Web': paginaWeb,
      'Pagina Web_URL': rawRow['Pagina Web_URL'] || (paginaWeb.startsWith('http') ? paginaWeb : ''),
      Pagina_Web: paginaWeb,
      Agente: agente,
      'Numero de WhatsApp': numeroWhatsApp,
      Numero_WhatsApp: numeroWhatsApp,
      Mascotas: mascotas,
      'Tipo de Mascotas': tipoMascotas,
      Tipo_Mascotas: tipoMascotas,

      // Derivados canónicos
      CODIGO_WASI: codigoWasi,
      TELEFONO_ASESOR_CLEAN: telefonoAsesorClean,
      WhatsApp_Limpio: telefonoAsesorClean,

      // Estructura Universal V5.1 Dinámica
      externalLinks: externalLinks,
      externalLinksDetails: externalLinksDetails,
      _unmappedColumns: unmappedColumns,

      // Estado de integridad y verdad comercial
      _isStructurallyValid: isStructurallyValid,
      _isComplete: isStructurallyValid && !isQuarantined,
      _isQuarantined: isQuarantined,
      quarantineReason: quarantineReason,
      _missingFields: missingRowFields,
      _raw: rawRow
    };

    // Exponer claves dinámicas de externalLinks en el objeto raíz para compatibilidad directa
    for (const [key, url] of Object.entries(externalLinks)) {
      if (propertyRecord[key] === undefined) {
        propertyRecord[key] = url;
      }
    }

    records.push(propertyRecord);
  }

  return {
    properties: records,
    schema: currentSchema,
    schemaChange: schemaChange,
    sheetIntegrityErrors: sheetIntegrityErrors,
    propertyIntegrityWarnings: propertyIntegrityWarnings,
    commercialContradictions: commercialContradictions,
    totalCount: records.length,
    validCount: records.filter(p => p._isStructurallyValid).length,
    quarantinedCount: records.filter(p => p._isQuarantined).length,
    eligibleCount: records.filter(p => p._isComplete).length
  };
}

/**
 * Parsea un buffer XLSX directamente en propiedades universales.
 */
function parseXlsxBufferToUniversalProperties(buffer, options = {}) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetNames = workbook.SheetNames || [];
  if (sheetNames.length === 0) {
    return { properties: [], schema: null, sheetIntegrityErrors: ['El archivo XLSX no contiene hojas.'], totalCount: 0 };
  }

  // Utilizar Hoja 1 o la primera pestaña si Hoja 1 no existe
  const targetSheetName = options.sheetName || (sheetNames.includes('Hoja 1') ? 'Hoja 1' : sheetNames[0]);
  const sheet = workbook.Sheets[targetSheetName];
  if (!sheet || !sheet['!ref']) {
    return { properties: [], schema: null, sheetIntegrityErrors: [`La hoja ${targetSheetName} está vacía.`], totalCount: 0 };
  }

  const range = XLSX.utils.decode_range(sheet['!ref']);

  // Leer encabezados de la fila superior (sin detenerse en columna M)
  const headers = [];
  for (let C = range.s.c; C <= range.e.c; ++C) {
    const cellRef = XLSX.utils.encode_cell({ r: range.s.r, c: C });
    const cell = sheet[cellRef];
    const headerVal = (cell && cell.v !== undefined && cell.v !== null) ? String(cell.v).trim() : '';
    headers.push(headerVal);
  }

  // Leer celdas fila por fila con sus objetos completos (para extraer .l y .f)
  const rowsData = [];
  for (let R = range.s.r + 1; R <= range.e.r; ++R) {
    const rowCells = [];
    let hasCell = false;
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = sheet[cellRef] || null;
      if (cell) hasCell = true;
      rowCells.push(cell);
    }
    if (hasCell) {
      rowsData.push(rowCells);
    }
  }

  return processUniversalRows(headers, rowsData, options);
}

/**
 * Parsea un arreglo de objetos (ej: parseado de CSV o JSON) a propiedades universales.
 */
function parseRecordsToUniversalProperties(records = [], options = {}) {
  if (!Array.isArray(records) || records.length === 0) {
    return { properties: [], schema: null, totalCount: 0 };
  }

  // Extraer encabezados dinámicamente de todas las claves de los registros
  const headerSet = new Set();
  records.forEach(row => {
    Object.keys(row).forEach(k => {
      if (k && !k.endsWith('_URL') && !k.startsWith('_')) {
        headerSet.add(k.trim());
      }
    });
  });
  const headers = Array.from(headerSet);

  return processUniversalRows(headers, records, options);
}

// ============================================================================
// 5. GESTOR DE CACHÉ UNIVERSAL CON INVALIDACIÓN POR CAMBIO DE ESQUEMA
// ============================================================================

class UniversalSheetCacheManager {
  constructor(options = {}) {
    this.ttlMs = options.ttlMs || (5 * 60 * 1000); // 5 minutos por defecto
    this.cachedProperties = null;
    this.cachedSchema = null;
    this.lastFetchTime = 0;
    this.onSchemaChangeCallback = options.onSchemaChange || null;
  }

  /**
   * Obtiene propiedades. Si el TTL ha expirado, si forceRefresh es true,
   * o si se detecta un cambio de esquema, actualiza la caché de forma transparente.
   */
  async getProperties(fetchFn, forceRefresh = false) {
    const now = Date.now();
    const isTtlExpired = (now - this.lastFetchTime) >= this.ttlMs;

    if (!forceRefresh && !isTtlExpired && this.cachedProperties) {
      return {
        properties: this.cachedProperties,
        schema: this.cachedSchema,
        fromCache: true
      };
    }

    // Ejecutar fetch
    const rawResult = await fetchFn(this.cachedSchema);
    let parsedResult;

    if (Buffer.isBuffer(rawResult)) {
      parsedResult = parseXlsxBufferToUniversalProperties(rawResult, {
        previousSchema: this.cachedSchema,
        logChanges: true
      });
    } else if (Array.isArray(rawResult)) {
      parsedResult = parseRecordsToUniversalProperties(rawResult, {
        previousSchema: this.cachedSchema,
        logChanges: true
      });
    } else if (rawResult && rawResult.properties) {
      parsedResult = rawResult;
    } else {
      throw new Error('Formato de datos no soportado en fetchFn de UniversalSheetCacheManager.');
    }

    const { properties, schema, schemaChange } = parsedResult;

    if (schemaChange && schemaChange.hasChanged && !schemaChange.isInitial) {
      console.log(`[UniversalSheetCacheManager] Invalidador de caché: Detectado cambio de esquema. Actualizando catálogo.`);
      if (typeof this.onSchemaChangeCallback === 'function') {
        try {
          this.onSchemaChangeCallback(schemaChange, properties);
        } catch (e) {
          console.warn('[UniversalSheetCacheManager] Error en callback de cambio de esquema:', e.message);
        }
      }
    }

    this.cachedProperties = properties;
    this.cachedSchema = schema;
    this.lastFetchTime = now;

    return {
      properties,
      schema,
      schemaChange,
      fromCache: false
    };
  }

  /**
   * Invalida explícitamente la memoria caché.
   */
  invalidate() {
    this.cachedProperties = null;
    this.lastFetchTime = 0;
  }

  /**
   * Retorna el esquema actualmente en memoria
   */
  getSchema() {
    return this.cachedSchema;
  }
}

// ============================================================================
// 6. EXPORTACIONES
// ============================================================================

module.exports = {
  MANDATORY_STRUCTURAL_FIELDS,
  KNOWN_OPTIONAL_FIELDS,
  CANONICAL_ALIASES,
  normalizeHeaderName,
  extractUrlFromCell,
  extractDomainFromUrl,
  cleanVenezuelanPhone,
  extractWasiCode,
  computeSchemaFingerprint,
  detectSchemaChanges,
  validateMandatoryHeaders,
  processUniversalRows,
  parseXlsxBufferToUniversalProperties,
  parseRecordsToUniversalProperties,
  UniversalSheetCacheManager
};
