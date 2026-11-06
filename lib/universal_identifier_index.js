/**
 * ============================================================================
 * ÍNDICE UNIVERSAL DE IDENTIFICADORES Y ENLACES INMOBILIARIOS
 * ============================================================================
 * Tu Techo Ideal V5.1 — DEPRO TECH SOLUTIONS
 *
 * Arquitectura:
 * 1. Extracción exhaustiva y multiportal de identificadores:
 *    - URLs completas (Mercado Libre, Wasi, Rexup, Tu Techo Ideal, nuevos portales)
 *    - Enlaces nativos de celdas XLSX y fórmulas HYPERLINK
 *    - Códigos en celdas de columnas dinámicas o conocidas (MLV-xxx, IDs numéricos)
 * 2. Estructura de índice multi-candidato O(1):
 *    - Cada código/URL mapea a un array de candidatos: { propertyId, property, rowIndex, sourceColumn, originalCellValue }
 *    - NUNCA sobrescribe una coincidencia previa ni guarda únicamente la primera.
 * 3. Resolución profunda de colisiones y códigos duplicados:
 *    - Caso A: Un único candidato inequívoco por discriminantes (Tipo, Operación, Zona, Metraje, Precio, Habitaciones, etc.)
 *    - Caso B: Múltiples candidatos idénticos o sin información suficiente -> Silencio / Handoff
 *    - Caso C: Contradicción total -> Bloqueo
 * 4. Actualización atómica e invalidación automática ante cambios en Google Sheets.
 * ============================================================================
 */

const { cleanUrlForMatching } = require('./multiportal_extractor');

/**
 * Normaliza una cadena eliminando acentos/diacríticos y espacios superfluos.
 */
function stripAccents(str) {
  if (!str) return '';
  return String(str).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

class UniversalIdentifierIndex {
  constructor() {
    this.urlMap = new Map();     // normalizedUrl -> indexEntry
    this.codeMap = new Map();    // normalizedCode -> indexEntry
    this.rawEntries = [];        // Registro plano de todas las asociaciones
    this.builtAt = 0;
    this.fingerprint = null;
    this.stats = {
      totalPropertiesIndexed: 0,
      totalEntriesIndexed: 0,
      uniqueUrlKeys: 0,
      uniqueCodeKeys: 0,
      collisionKeysCount: 0,
      portalsBreakdown: {}
    };
  }

  /**
   * Limpia y normaliza un código de portal.
   */
  static normalizeCode(codeStr) {
    if (!codeStr || typeof codeStr !== 'string') return '';
    const trimmed = codeStr.trim().toUpperCase();

    // Mercado Libre: MLV-1030015318 o MLV1030015318 -> MLV-1030015318
    const mlMatch = trimmed.match(/^MLV[-]?(\d+)$/i);
    if (mlMatch) {
      return `MLV-${mlMatch[1]}`;
    }

    // IDs puramente numéricos (Wasi / Rexup / MLV numérico)
    if (/^\d{6,12}$/.test(trimmed)) {
      return trimmed;
    }

    return trimmed;
  }

  /**
   * Extrae todos los identificadores posibles de una celda o URL.
   */
  static extractIdentifiersFromCellOrUrl(val, headerName = '') {
    if (!val || (typeof val !== 'string' && typeof val !== 'number')) {
      return [];
    }

    const rawStr = String(val).trim();
    if (!rawStr || rawStr === '-' || rawStr === 'N/A') return [];

    const results = [];
    const isUrl = /^https?:\/\//i.test(rawStr);

    if (isUrl) {
      const cleanUrl = cleanUrlForMatching(rawStr);
      let portal = 'Portal Web';
      let normCode = null;
      let altCodes = [];

      // 1. Mercado Libre
      const mlMatch = rawStr.match(/MLV[-]?(\d+)/i);
      if (mlMatch) {
        portal = 'Mercado Libre';
        normCode = `MLV-${mlMatch[1]}`;
        altCodes.push(mlMatch[1]); // ID numérico puro
        altCodes.push(`MLV${mlMatch[1]}`);
      }

      // 2. Wasi
      const wasiMatch = rawStr.match(/wasi\.co\/[^\/]+\/(\d{6,10})/i) || rawStr.match(/\/(\d{7,10})(?:[^\d]|$)/);
      if (wasiMatch && !mlMatch) {
        portal = 'Wasi';
        normCode = wasiMatch[1];
      }

      // 3. Rexup
      const rexupMatch = rawStr.match(/cod_inmueble=(\d+)/i) || rawStr.match(/rexup\.net\/[^\/]+\/(\d+)/i);
      if (rexupMatch) {
        portal = 'Rexup';
        normCode = rexupMatch[1];
      }

      // 4. Tu Techo Ideal / Páginas Web Propias
      const ttiMatch = rawStr.match(/tutechoideal\.com\/inmuebles\/([^\/\s?#]+)/i);
      if (ttiMatch) {
        portal = 'Pagina Web Propia';
        normCode = ttiMatch[1].toLowerCase();
      }

      // 5. Otros portales conocidos
      if (!normCode) {
        const domainMatch = rawStr.match(/https?:\/\/([^\/\s?#]+)/i);
        const domain = domainMatch ? domainMatch[1].replace(/^www\./, '').toLowerCase() : 'Desconocido';
        portal = domain;
        // Si hay un ID numérico al final de la ruta
        const genericNum = rawStr.match(/\/(\d{5,12})(?:[^\d]|$)/);
        if (genericNum) {
          normCode = genericNum[1];
        }
      }

      results.push({
        portal,
        cleanUrl,
        rawUrl: rawStr,
        normCode,
        altCodes,
        isUrl: true
      });
    } else {
      // Valor en celda que NO es URL (código escrito directamente)
      const cleanCode = UniversalIdentifierIndex.normalizeCode(rawStr);
      if (cleanCode) {
        let portal = 'Código Directo';
        const hNorm = headerName.toLowerCase();
        if (hNorm.includes('wasi')) portal = 'Wasi';
        else if (hNorm.includes('mercado') || hNorm.includes('ml')) portal = 'Mercado Libre';
        else if (hNorm.includes('rexup') || hNorm.includes('foto')) portal = 'Rexup';

        const altCodes = [];
        if (cleanCode.startsWith('MLV-')) {
          altCodes.push(cleanCode.replace('MLV-', ''));
          altCodes.push(cleanCode.replace('MLV-', 'MLV'));
        }

        results.push({
          portal,
          cleanUrl: null,
          rawUrl: null,
          normCode: cleanCode,
          altCodes,
          isUrl: false
        });
      }
    }

    return results;
  }

  /**
   * Construye el índice de forma atómica e inmutable a partir de la lista de propiedades.
   */
  static buildFromProperties(properties = [], options = {}) {
    const index = new UniversalIdentifierIndex();
    if (!Array.isArray(properties) || properties.length === 0) {
      return index;
    }

    const startTime = Date.now();
    index.fingerprint = properties._schemaFingerprint || `fp_${properties.length}_${Date.now()}`;
    index.stats.totalPropertiesIndexed = properties.length;

    for (let rIdx = 0; rIdx < properties.length; rIdx++) {
      const p = properties[rIdx];
      if (!p || typeof p !== 'object') continue;

      const pId = (p.ID_PROPIEDAD || '').toString().trim().toUpperCase();
      if (!pId) continue;

      const rawRow = p._raw || p;
      const rowIndex = p._rowIndex || rawRow.__rowNum__ || (rIdx + 1);

      // 1. Recorrer enlaces en externalLinks y externalLinksDetails
      const inspectedEntries = [];

      // A: externalLinks
      if (p.externalLinks && typeof p.externalLinks === 'object') {
        for (const [colName, val] of Object.entries(p.externalLinks)) {
          if (val) inspectedEntries.push({ colName, val });
        }
      }

      // B: Todas las columnas en rawRow (detectar celdas con URLs o códigos en columnas dinámicas)
      for (const [colName, val] of Object.entries(rawRow)) {
        if (!val || typeof val !== 'string' && typeof val !== 'number') continue;
        if (colName.startsWith('_') || colName.endsWith('_URL')) continue;
        // Evitar duplicar si ya estaba en externalLinks
        if (!p.externalLinks?.[colName]) {
          const sVal = String(val).trim();
          if (/^https?:\/\//i.test(sVal) || /^MLV[-]?\d+/i.test(sVal) || (/^\d{6,12}$/.test(sVal) && /(?:wasi|rexup|ml|portal|enlace|link|foto)/i.test(colName))) {
            inspectedEntries.push({ colName, val: sVal });
          }
        }
      }

      // C: Campos canónicos directos
      const canonicalFields = ['Wasi', 'Mercado Libre', 'Pagina Web', 'LINK_FOTOS', 'CODIGO_WASI'];
      for (const f of canonicalFields) {
        if (p[f] && !inspectedEntries.some(e => e.colName === f)) {
          inspectedEntries.push({ colName: f, val: p[f] });
        }
      }

      // 2. Indexar cada identificador extraído
      for (const entry of inspectedEntries) {
        const idList = UniversalIdentifierIndex.extractIdentifiersFromCellOrUrl(entry.val, entry.colName);

        for (const item of idList) {
          const candidateRecord = {
            propertyId: pId,
            property: p,
            rowIndex,
            sourceColumn: entry.colName,
            originalCellValue: entry.val,
            portal: item.portal
          };

          index.rawEntries.push(candidateRecord);
          index.stats.totalEntriesIndexed++;
          index.stats.portalsBreakdown[item.portal] = (index.stats.portalsBreakdown[item.portal] || 0) + 1;

          // A. Indexar por URL limpia
          if (item.cleanUrl) {
            index._registerUrlKey(item.cleanUrl, item.portal, item.normCode, candidateRecord);
          }

          // B. Indexar por Código Normalizado
          if (item.normCode) {
            index._registerCodeKey(item.normCode, item.portal, item.cleanUrl, candidateRecord);
          }

          // C. Indexar Códigos Alternativos (ej: versión sin guión o solo numérico)
          if (Array.isArray(item.altCodes)) {
            for (const alt of item.altCodes) {
              if (alt && alt !== item.normCode) {
                index._registerCodeKey(alt, item.portal, item.cleanUrl, candidateRecord);
              }
            }
          }
        }
      }
    }

    // Calcular estadísticas de colisiones
    let collisions = 0;
    for (const entry of index.codeMap.values()) {
      const distinctProps = new Set(entry.candidates.map(c => c.propertyId));
      if (distinctProps.size > 1) {
        collisions++;
      }
    }
    index.stats.uniqueUrlKeys = index.urlMap.size;
    index.stats.uniqueCodeKeys = index.codeMap.size;
    index.stats.collisionKeysCount = collisions;
    index.builtAt = Date.now();

    return index;
  }

  _registerUrlKey(cleanUrl, portal, normCode, candidateRecord) {
    let entry = this.urlMap.get(cleanUrl);
    if (!entry) {
      entry = {
        key: cleanUrl,
        type: 'URL',
        portal,
        normalizedCode: normCode,
        normalizedUrl: cleanUrl,
        candidates: []
      };
      this.urlMap.set(cleanUrl, entry);
    }
    // No duplicar el mismo candidateRecord exacto para el mismo ID_PROPIEDAD en la misma columna
    const exists = entry.candidates.some(c => c.propertyId === candidateRecord.propertyId && c.sourceColumn === candidateRecord.sourceColumn);
    if (!exists) {
      entry.candidates.push(candidateRecord);
    }
  }

  _registerCodeKey(normCode, portal, cleanUrl, candidateRecord) {
    const key = String(normCode).toUpperCase();
    let entry = this.codeMap.get(key);
    if (!entry) {
      entry = {
        key,
        type: 'CODE',
        portal,
        normalizedCode: key,
        normalizedUrl: cleanUrl || null,
        candidates: []
      };
      this.codeMap.set(key, entry);
    }
    const exists = entry.candidates.some(c => c.propertyId === candidateRecord.propertyId && c.sourceColumn === candidateRecord.sourceColumn);
    if (!exists) {
      entry.candidates.push(candidateRecord);
    }
  }

  /**
   * Comprueba si el texto o slug recibido presenta contradicciones críticas con la propiedad.
   */
  static checkCandidateContradiction(cand, text, isNumericMatch = false) {
    if (!cand || !text) return { hasContradiction: false, contradictions: [] };
    const textNorm = stripAccents(String(text).toLowerCase());
    const descNorm = stripAccents(String(cand.DESCRIPCION_BREVE || '').toLowerCase());
    const candTipo = stripAccents(String(cand.TIPO || '').toLowerCase());
    const candOp = stripAccents(String(cand.OPERACION || '').toLowerCase());
    const contradictions = [];

    // 1. Ciudades incompatibles (inmuebles del catálogo están en Caracas/Miranda/Aragua/etc.)
    const otherCities = ['maracaibo', 'valencia', 'maracay', 'barquisimeto', 'margarita', 'merida', 'puerto la cruz', 'lecheria'];
    for (const city of otherCities) {
      const cityRegex = new RegExp(`\\b${city}\\b`, 'i');
      if (cityRegex.test(textNorm) && !descNorm.includes(city)) {
        contradictions.push(`Ciudad incompatible: "${city}"`);
      }
    }

    // 2. Tipo incompatible si se especifica explícitamente en el texto
    if (candTipo) {
      if (/\b(?:apartamento|apto)\b/i.test(textNorm) && (candTipo.includes('oficina') || candTipo.includes('galpon') || candTipo.includes('terreno') || candTipo.includes('local'))) {
        contradictions.push(`Tipo incompatible: texto afirma apartamento pero inmueble es ${candTipo}`);
      } else if (/\b(?:oficina)\b/i.test(textNorm) && (candTipo.includes('apartamento') || candTipo.includes('casa') || candTipo.includes('galpon') || candTipo.includes('terreno'))) {
        contradictions.push(`Tipo incompatible: texto afirma oficina pero inmueble es ${candTipo}`);
      } else if (/\b(?:casa|quinta|townhouse)\b/i.test(textNorm) && (candTipo.includes('apartamento') || candTipo.includes('oficina') || candTipo.includes('galpon') || candTipo.includes('terreno'))) {
        contradictions.push(`Tipo incompatible: texto afirma casa pero inmueble es ${candTipo}`);
      }
    }

    // 3. Operación incompatible (solo si NO hay coincidencia por ID numérico unívoco; en coincidencia numérica prevalece Google Sheets)
    if (!isNumericMatch && candOp) {
      if (/\b(?:alquiler|alquilo|canon|en alquiler)\b/i.test(textNorm) && candOp === 'venta' && !descNorm.includes('alquiler')) {
        contradictions.push('Operación incompatible: texto indica alquiler pero inmueble es Venta');
      } else if (/\b(?:venta|vendo|en venta|se vende)\b/i.test(textNorm) && candOp === 'alquiler' && !descNorm.includes('venta')) {
        contradictions.push('Operación incompatible: texto indica venta pero inmueble es Alquiler');
      }
    }

    return {
      hasContradiction: contradictions.length > 0,
      contradictions
    };
  }

  /**
   * Búsqueda Rápida O(1) con Resolución Profunda de Colisiones.
   *
   * @param {string} input - URL, código, slug o fragmento recibido
   * @param {object} context - Atributos de la publicación entrante para desambiguar
   * @returns {object} Resultado de la búsqueda con candidate único o ambigüedad explícita
   */
  lookup(input, context = {}) {
    const tStart = process.hrtime.bigint ? process.hrtime.bigint() : null;

    if (!input || typeof input !== 'string') {
      return {
        found: false,
        isUnique: false,
        isCollision: false,
        isAmbiguous: false,
        hasContradiction: false,
        matchedKey: null,
        portal: null,
        candidate: null,
        candidates: [],
        disambiguated: false,
        disambiguationReason: 'EMPTY_INPUT',
        lookupTimeMs: 0
      };
    }

    const trimmed = input.trim();
    let entry = null;
    let matchedKey = null;

    // 1. Si es URL: buscar en urlMap
    if (/^https?:\/\//i.test(trimmed)) {
      const clean = cleanUrlForMatching(trimmed);
      if (this.urlMap.has(clean)) {
        entry = this.urlMap.get(clean);
        matchedKey = clean;
      }
    }

    // 2. Si no se encontró por URL completa, extraer identificadores del input y buscar en codeMap
    if (!entry) {
      const extracted = UniversalIdentifierIndex.extractIdentifiersFromCellOrUrl(trimmed);
      for (const item of extracted) {
        if (item.cleanUrl && this.urlMap.has(item.cleanUrl)) {
          entry = this.urlMap.get(item.cleanUrl);
          matchedKey = item.cleanUrl;
          break;
        }
        if (item.normCode) {
          const codeKey = item.normCode.toUpperCase();
          if (this.codeMap.has(codeKey)) {
            entry = this.codeMap.get(codeKey);
            matchedKey = codeKey;
            break;
          }
        }
        if (Array.isArray(item.altCodes)) {
          for (const alt of item.altCodes) {
            const altKey = alt.toUpperCase();
            if (this.codeMap.has(altKey)) {
              entry = this.codeMap.get(altKey);
              matchedKey = altKey;
              break;
            }
          }
          if (entry) break;
        }
      }
    }

    // 3. Fallback: búsqueda directa de código normalizado del string
    if (!entry) {
      const directCode = UniversalIdentifierIndex.normalizeCode(trimmed);
      if (directCode && this.codeMap.has(directCode)) {
        entry = this.codeMap.get(directCode);
        matchedKey = directCode;
      }
    }

    // Si no se encontró en el índice
    if (!entry || entry.candidates.length === 0) {
      const tEnd = process.hrtime.bigint ? process.hrtime.bigint() : null;
      const elapsedMs = tStart && tEnd ? Number(tEnd - tStart) / 1e6 : 0;
      return {
        found: false,
        isUnique: false,
        isCollision: false,
        isAmbiguous: false,
        hasContradiction: false,
        matchedKey: null,
        portal: null,
        candidate: null,
        candidates: [],
        disambiguated: false,
        disambiguationReason: 'NOT_FOUND_IN_INDEX',
        lookupTimeMs: elapsedMs
      };
    }

    // Identificar propiedades únicas
    const uniqueCandidatesMap = new Map();
    for (const c of entry.candidates) {
      if (!uniqueCandidatesMap.has(c.propertyId)) {
        uniqueCandidatesMap.set(c.propertyId, c.property);
      }
    }
    const distinctPropertyList = Array.from(uniqueCandidatesMap.values());

    // CASO 1: Un único candidato registrado para ese código/URL
    if (distinctPropertyList.length === 1) {
      const singleCand = distinctPropertyList[0];
      const textToCheck = [input, context.messageText || '', context.simulatedHtml || ''].join(' ');
      const isNumericMatch = entry.type === 'CODE' || (entry.type === 'URL' && !!entry.normalizedCode);
      const contraCheck = UniversalIdentifierIndex.checkCandidateContradiction(singleCand, textToCheck, isNumericMatch);

      const tEnd = process.hrtime.bigint ? process.hrtime.bigint() : null;
      const elapsedMs = tStart && tEnd ? Number(tEnd - tStart) / 1e6 : 0;

      if (contraCheck.hasContradiction) {
        return {
          found: false,
          isUnique: false,
          isCollision: false,
          isAmbiguous: false,
          hasContradiction: true,
          matchedKey,
          portal: entry.portal,
          candidate: null,
          candidates: entry.candidates,
          disambiguated: false,
          disambiguationReason: `CONTRADICTION_DETECTED: Atributos en URL/consulta (${contraCheck.contradictions.join('; ')}) contradicen la ficha oficial de ${singleCand.ID_PROPIEDAD}.`,
          lookupTimeMs: elapsedMs
        };
      }

      return {
        found: true,
        isUnique: true,
        isCollision: false,
        isAmbiguous: false,
        hasContradiction: false,
        matchedKey,
        portal: entry.portal,
        candidate: singleCand,
        candidates: entry.candidates,
        disambiguated: false,
        disambiguationReason: 'UNIQUE_REGISTERED_IDENTIFIER',
        lookupTimeMs: elapsedMs
      };
    }

    // CASO 2: COLISIÓN DETECTADA (Código duplicado en Google Sheets para 2 o más inmuebles)
    // Se ejecuta VALIDACIÓN PROFUNDA contra los atributos de la publicación recibida
    const disambiguation = this.disambiguateCandidates(distinctPropertyList, context, entry);

    const tEnd = process.hrtime.bigint ? process.hrtime.bigint() : null;
    const elapsedMs = tStart && tEnd ? Number(tEnd - tStart) / 1e6 : 0;

    return {
      found: true,
      isUnique: disambiguation.isUnique,
      isCollision: true,
      isAmbiguous: disambiguation.isAmbiguous,
      hasContradiction: disambiguation.reason?.includes('CONTRADICTORY') || false,
      matchedKey,
      portal: entry.portal,
      candidate: disambiguation.candidate,
      candidates: entry.candidates,
      disambiguated: disambiguation.disambiguated,
      disambiguationReason: disambiguation.reason,
      lookupTimeMs: elapsedMs
    };
  }

  /**
   * Retorna las estadísticas del índice en memoria.
   */
  getStats() {
    return {
      totalPropertiesIndexed: this.stats.totalPropertiesIndexed,
      totalEntriesIndexed: this.stats.totalEntriesIndexed,
      uniqueUrlKeys: this.stats.uniqueUrlKeys,
      uniqueCodeKeys: this.stats.uniqueCodeKeys,
      collisionKeysCount: this.stats.collisionKeysCount,
      portalsBreakdown: this.stats.portalsBreakdown,
      builtAt: this.builtAt
    };
  }

  /**
   * Validación profunda de candidatos en colisión.
   * Compara los atributos disponibles en la publicación entrante contra cada fila oficial.
   */
  disambiguateCandidates(candidates = [], context = {}, indexEntry = null) {
    if (!candidates || candidates.length === 0) {
      return { candidate: null, isUnique: false, isAmbiguous: false, disambiguated: false, reason: 'NO_CANDIDATES' };
    }

    const {
      messageText = '',
      simulatedHtml = '',
      incomingAttributes = null
    } = context;

    // Extraer texto completo disponible para comparar
    const fullText = [messageText, simulatedHtml, JSON.stringify(incomingAttributes || {})].join(' ').toLowerCase();

    // Si no hay información de contexto para discriminar
    if (!fullText.trim() || fullText.length < 5) {
      return {
        candidate: null,
        isUnique: false,
        isAmbiguous: true,
        disambiguated: false,
        reason: `COLLISION_INSUFFICIENT_DATA (Código ${indexEntry?.key || 'duplicado'} compartido por ${candidates.map(c => c.ID_PROPIEDAD).join(', ')} sin datos suficientes para discriminar)`
      };
    }

    // Función auxiliar para normalizar sin acentos
    const stripAccents = (str) => (str ? String(str).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim() : '');
    const cleanFullText = stripAccents(fullText);

    // Evaluar compatibilidad de cada candidato
    const scoredCandidates = [];

    for (const cand of candidates) {
      const pId = (cand.ID_PROPIEDAD || '').toUpperCase();
      const tipo = stripAccents(cand.TIPO || '');
      const op = stripAccents(cand.OPERACION || '');
      const desc = stripAccents(cand.DESCRIPCION_BREVE || '');
      const isAlquiler = op.includes('alquiler') || op.includes('renta');
      const isVenta = op.includes('venta');

      let score = 0;
      const contradictions = [];
      const matches = [];

      // 1. Tipo de Inmueble
      const knownTypes = [
        { key: 'apartamento', aliases: ['apartamento', 'apto', 'departamento'] },
        { key: 'oficina', aliases: ['oficina'] },
        { key: 'casa', aliases: ['casa', 'quinta', 'townhouse'] },
        { key: 'local', aliases: ['local comercial', 'local'] },
        { key: 'galpon', aliases: ['galpon', 'nave industrial'] },
        { key: 'terreno', aliases: ['terreno', 'parcela', 'lote'] },
        { key: 'posada', aliases: ['posada', 'hotel'] }
      ];

      for (const tObj of knownTypes) {
        const textHasType = tObj.aliases.some(a => cleanFullText.includes(a));
        if (textHasType) {
          const candHasType = tObj.aliases.some(a => tipo.includes(a) || desc.includes(a));
          if (candHasType) {
            score += 20;
            matches.push(`Tipo coincidente: ${tObj.key}`);
          } else {
            contradictions.push(`Tipo no coincide (mención de ${tObj.key} vs ${tipo})`);
          }
        }
      }

      // 2. Operación (Alquiler vs Venta)
      if (cleanFullText.includes('alquiler') || cleanFullText.includes('canon') || cleanFullText.includes('renta')) {
        if (isAlquiler) {
          score += 30;
          matches.push('Operación Alquiler coincidente');
        } else if (isVenta && !desc.includes('alquiler')) {
          contradictions.push('Operación contradictoria (inmueble es Venta)');
        }
      }
      if (cleanFullText.includes('venta') || cleanFullText.includes('se vende')) {
        if (isVenta) {
          score += 30;
          matches.push('Operación Venta coincidente');
        } else if (isAlquiler && !desc.includes('venta')) {
          contradictions.push('Operación contradictoria (inmueble es Alquiler)');
        }
      }

      // 3. Zona / Ubicación
      const zoneKeywords = [
        'los samanes', 'la california', 'la castellana', 'los palos grandes',
        'el rosal', 'chacao', 'las mercedes', 'boleita', 'altamira',
        'chichiriviche', 'cagua', 'maracay', 'valencia', 'baruta', 'hatillo',
        'parque carabobo', 'bellas artes', 'fuerzas armadas', 'macaracuay'
      ];
      for (const z of zoneKeywords) {
        if (cleanFullText.includes(z)) {
          if (desc.includes(z) || tipo.includes(z)) {
            score += 25;
            matches.push(`Zona coincidente: ${z}`);
          } else {
            contradictions.push(`Zona distinta (mención de ${z})`);
          }
        }
      }

      // 4. Metraje
      const mMetraje = cleanFullText.match(/(\d+(?:[.,]\d+)?)\s*(?:m2|metros)\b/);
      if (mMetraje) {
        const claimedNum = parseFloat(mMetraje[1].replace(',', '.'));
        const candMetrajeMatch = desc.match(/(\d+(?:[.,]\d+)?)\s*(?:m2|metros)\b/);
        if (candMetrajeMatch) {
          const candNum = parseFloat(candMetrajeMatch[1].replace(',', '.'));
          if (Math.abs(claimedNum - candNum) < 2) {
            score += 20;
            matches.push(`Metraje coincidente: ${claimedNum} m²`);
          } else {
            contradictions.push(`Metraje no coincide (${claimedNum} vs ${candNum})`);
          }
        }
      }

      // 5. Precio
      const mPrice = cleanFullText.match(/(?:usd|\$)\s*([\d.,]+)/i);
      if (mPrice) {
        const claimedDigits = mPrice[1].replace(/\D/g, '');
        const candDigits = (cand.PRECIO || desc.match(/\$\s*([\d.,]+)/)?.[1] || '').replace(/\D/g, '');
        if (claimedDigits && candDigits) {
          if (claimedDigits === candDigits) {
            score += 20;
            matches.push(`Precio exacto coincidente: USD ${mPrice[1]}`);
          } else {
            contradictions.push(`Precio distinto (${claimedDigits} vs ${candDigits})`);
          }
        }
      }

      scoredCandidates.push({
        candidate: cand,
        propertyId: pId,
        score,
        matches,
        contradictions,
        isValid: contradictions.length === 0 && matches.length >= 2,
        hasNoContradictions: contradictions.length === 0
      });
    }

    // Filtrar candidatos viables sin contradicciones y con discriminación positiva
    const viableCandidates = scoredCandidates.filter(c => c.isValid);

    // Caso A: Un único candidato queda identificado inequívocamente
    if (viableCandidates.length === 1) {
      const winner = viableCandidates[0];
      return {
        candidate: winner.candidate,
        isUnique: true,
        isAmbiguous: false,
        disambiguated: true,
        reason: `DISAMBIGUATION_SUCCESS: Inmueble ${winner.propertyId} identificado unívocamente (${winner.matches.join(', ')})`,
        details: winner
      };
    }

    // Caso B: Permanecen dos o más candidatos posibles (ej: REF-043 y REF-044)
    if (viableCandidates.length > 1) {
      return {
        candidate: null,
        isUnique: false,
        isAmbiguous: true,
        disambiguated: false,
        reason: `COLLISION_MULTI_MATCH: Múltiples candidatos (${viableCandidates.map(c => c.propertyId).join(', ')}) cumplen los atributos sin diferenciador concluyente. Derivado a humano.`
      };
    }

    // Caso B2: Ningún candidato alcanzó 2 discriminantes, pero hay candidatos sin contradicciones
    const plausibleCandidates = scoredCandidates.filter(c => c.hasNoContradictions);
    if (plausibleCandidates.length > 0) {
      return {
        candidate: null,
        isUnique: false,
        isAmbiguous: true,
        disambiguated: false,
        reason: `COLLISION_INSUFFICIENT_DATA: Información insuficiente para discriminar entre ${plausibleCandidates.map(c => c.propertyId).join(', ')}. Se requiere asesor humano.`
      };
    }

    // Caso C: Todos los candidatos presentan contradicciones con la publicación
    return {
      candidate: null,
      isUnique: false,
      isAmbiguous: true,
      disambiguated: false,
      reason: `COLLISION_CONTRADICTORY: La información de la publicación contradice a los candidatos registrados (${candidates.map(c => c.ID_PROPIEDAD).join(', ')}). Despacho bloqueado.`
    };
  }
}

// ============================================================================
// INSTANCIA GLOBAL SINGLETON CON INVALIDACIÓN AUTOMÁTICA
// ============================================================================
let globalIndexInstance = null;
let lastIndexedPropertiesRef = null;
let lastIndexedFingerprint = null;

function computePropertiesFingerprint(properties = []) {
  if (!Array.isArray(properties) || properties.length === 0) return 'empty';
  if (properties._schemaFingerprint && !properties._isMock) {
    return `${properties._schemaFingerprint}_${properties.length}_${properties._fetchedAt || 0}`;
  }
  // Generar hash rápido de todo el array (O(N) toma < 0.05ms)
  let hash = properties.length;
  for (let i = 0; i < properties.length; i++) {
    const p = properties[i];
    if (p) {
      const s = (p.ID_PROPIEDAD || '') + ':' + (p.ESTATUS || '') + ':' + (p.OPERACION || '');
      for (let j = 0; j < s.length; j++) {
        hash = ((hash << 5) - hash) + s.charCodeAt(j);
        hash |= 0;
      }
    }
  }
  return `h_${properties.length}_${hash}`;
}

function getGlobalIdentifierIndex(properties = []) {
  const currentFingerprint = computePropertiesFingerprint(properties);

  if (!globalIndexInstance || lastIndexedPropertiesRef !== properties || lastIndexedFingerprint !== currentFingerprint) {
    globalIndexInstance = UniversalIdentifierIndex.buildFromProperties(properties);
    lastIndexedPropertiesRef = properties;
    lastIndexedFingerprint = currentFingerprint;
  }
  return globalIndexInstance;
}

function invalidateGlobalIdentifierIndex() {
  globalIndexInstance = null;
  lastIndexedPropertiesRef = null;
  lastIndexedFingerprint = null;
}

UniversalIdentifierIndex.build = UniversalIdentifierIndex.buildFromProperties;

module.exports = {
  UniversalIdentifierIndex,
  getGlobalIdentifierIndex,
  invalidateGlobalIdentifierIndex
};
