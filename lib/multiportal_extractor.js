/**
 * RECONOCEDOR MULTIPORTAL INTELIGENTE Y UNIVERSAL DE PROPIEDADES INMOBILIARIAS
 * Tu Techo Ideal V5.0 — Resolución Independiente de Dominio
 *
 * REGLA FUNDAMENTAL:
 * El sistema no asume que una propiedad es desconocida simplemente porque el cliente
 * envió un enlace de un portal inmobiliario o dominio diferente al registrado en Google Sheets.
 * Extrae identificadores, compara rutas y slugs, busca coincidencias cruzadas en todas las
 * columnas de enlaces y valida la información contra la propiedad registrada (Fuente de la Verdad).
 *
 * Niveles de Resolución:
 * NIVEL 1 – COINCIDENCIA EXACTA (PROPERTY_MATCH_EXACT):
 *   Identificador del enlace coincide con una publicación registrada (Wasi, ML, Rexup, etc.)
 *   y el slug o datos complementarios corroboran sin contradicciones.
 * NIVEL 2 – COINCIDENCIA CRUZADA VERIFICADA (PROPERTY_MATCH_CROSS_PORTAL):
 *   Sin identificador numérico, pero con slug normalizado y atributos verificados
 *   (tipo, operación, ubicación) inequívocamente coincidentes con el inventario.
 * NIVEL 3 – COINCIDENCIA INCIERTA (PROPERTY_MATCH_AMBIGUOUS):
 *   Múltiples propiedades posibles, identificadores contradictorios o información insuficiente.
 *   Derivado a atención humana según política de cero invención.
 */

const fs = require('fs');
const path = require('path');

// Aliases conocidos por defecto (conserva el enlace original y asocia enlaces alternos)
const DEFAULT_PROPERTY_URL_ALIASES = Object.freeze({
  'MLV-1029979186': 'REF-035',
  '1029979186': 'REF-035',
  'https://inmueble.mercadolibre.com.ve/MLV-1029979186-alquilo-cubiculos-20m2-torre-profesional-la-california-8420-_JM': 'REF-035'
});

let loadedAliases = null;

function getPropertyUrlAliases() {
  if (loadedAliases) return loadedAliases;
  const aliasFilePath = path.join(__dirname, '..', 'property_url_aliases.json');
  let diskAliases = {};
  if (fs.existsSync(aliasFilePath)) {
    try {
      diskAliases = JSON.parse(fs.readFileSync(aliasFilePath, 'utf8'));
    } catch (e) {
      console.warn('[Multiportal Extractor] Error leyendo property_url_aliases.json:', e.message);
    }
  }
  loadedAliases = { ...DEFAULT_PROPERTY_URL_ALIASES, ...diskAliases };
  return loadedAliases;
}

/**
 * Normaliza y limpia una URL eliminando parámetros de seguimiento y hashes,
 * preservando parámetros determinantes de identidad (como cod_inmueble o IDs).
 */
function cleanUrlForMatching(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return '';
  let str = urlStr.trim().replace(/[.,;!?]+$/, '');

  try {
    const parsed = new URL(str);
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');

    // Parámetros de tracking a eliminar con seguridad
    const trackingKeys = [
      'ua', 'origin', 'sid', 'action', 'source', 'ref', 'share',
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'gclid', 'igshid', '_ga', '_gl', 'mc_cid', 'mc_eid'
    ];
    for (const key of trackingKeys) {
      parsed.searchParams.delete(key);
    }

    parsed.hash = '';
    const search = parsed.searchParams.toString();
    return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}${search ? '?' + search : ''}`.toLowerCase();
  } catch (e) {
    return str
      .replace(/[#].*$/, '')
      .replace(/([?&])(?:ua|origin|sid|action|utm_[a-z]+|fbclid)=[^&]*/gi, '$1')
      .replace(/[?&]+$/, '')
      .replace(/\/+$/, '')
      .toLowerCase();
  }
}

/**
 * Analiza en profundidad cualquier URL inmobiliaria para extraer su dominio,
 * segmentos de ruta, identificadores numéricos, códigos MLV/REF y slug descriptivo.
 */
function parseAndNormalizeUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return null;
  const str = urlStr.trim().replace(/[.,;!?]+$/, '');
  try {
    const parsed = new URL(str);
    const protocol = parsed.protocol.toLowerCase();
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');

    const trackingKeys = [
      'ua', 'origin', 'sid', 'action', 'source', 'ref', 'share',
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'gclid', 'igshid', '_ga', '_gl', 'mc_cid', 'mc_eid'
    ];
    for (const key of trackingKeys) {
      parsed.searchParams.delete(key);
    }
    parsed.hash = '';

    const pathname = parsed.pathname.replace(/\/+$/, '');
    const cleanUrl = `${protocol}//${hostname}${pathname}${parsed.searchParams.toString() ? '?' + parsed.searchParams.toString() : ''}`;
    const segments = pathname.split('/').map(s => s.trim().toLowerCase()).filter(Boolean);

    const numericIds = [];
    for (const seg of segments) {
      if (/^\d{6,10}$/.test(seg)) {
        numericIds.push(seg);
      } else {
        const endNumMatch = seg.match(/[-_](\d{6,10})$/);
        if (endNumMatch) numericIds.push(endNumMatch[1]);
      }
    }

    for (const [k, v] of parsed.searchParams.entries()) {
      if (['cod_inmueble', 'id', 'code', 'inmueble', 'property_id', 'wasi_id'].includes(k.toLowerCase()) && /^\d{4,11}$/.test(v)) {
        numericIds.push(v);
      }
    }

    let mlvCode = null;
    const mlvMatch = str.match(/MLV[-_ ]?(\d{7,11})/i);
    if (mlvMatch) {
      mlvCode = { full: `MLV-${mlvMatch[1]}`, numeric: mlvMatch[1] };
      numericIds.push(mlvMatch[1]);
    }

    let refCode = null;
    const refMatch = str.match(/\bREF-?(\d{2,4})\b/i);
    if (refMatch) {
      refCode = `REF-${refMatch[1].padStart(3, '0')}`.toUpperCase();
    }

    let slug = null;
    const ignoreSegments = new Set(['inmuebles', 'inmueble', 'propiedades', 'propiedad', 'detalle', 'ver', 'ficha', 'item', 'listing', 'property']);
    for (const seg of segments) {
      if (!/^\d+$/.test(seg) && !ignoreSegments.has(seg)) {
        const cleanSeg = seg.replace(/\.(html?|php|aspx?)$/i, '').replace(/^_+|_+$/g, '');
        if (cleanSeg.length >= 4 && /[a-z]/.test(cleanSeg)) {
          slug = cleanSeg;
          break;
        }
      }
    }

    return {
      raw: urlStr,
      cleanUrl,
      protocol,
      hostname,
      pathname,
      segments,
      numericIds: Array.from(new Set(numericIds)),
      mlvCode,
      refCode,
      slug,
      queryParams: Object.fromEntries(parsed.searchParams.entries())
    };
  } catch (e) {
    return null;
  }
}

/**
 * Normaliza un slug web (ej: /inmuebles/cubiculos-en-alquiler/ -> cubiculos-en-alquiler)
 */
function extractWebSlug(urlOrText) {
  if (!urlOrText) return null;
  const match = urlOrText.match(/(?:tutechoideal\.com)?\/inmuebles\/([a-zA-Z0-9_-]+)/i);
  if (match) return match[1].toLowerCase().replace(/^_+|_+$/g, '');

  const parsed = parseAndNormalizeUrl(urlOrText);
  return parsed?.slug || null;
}

/**
 * Extrae tokens significativos de un slug descartando conectores comunes en español.
 */
function extractSlugTokens(slugStr) {
  if (!slugStr || typeof slugStr !== 'string') return [];
  const normalized = slugStr.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ');
  const words = normalized.split(/\s+/).filter(Boolean);
  const stopwords = new Set(['de', 'del', 'en', 'el', 'la', 'los', 'las', 'un', 'una', 'para', 'con', 'y', 'o', 'al', 'se', 'su']);
  return words.filter(w => w.length > 2 && !stopwords.has(w));
}

/**
 * Detecta contradicciones directas entre el slug recibido y la ficha técnica registrada.
 * Si el cliente envía un enlace con ID coincidente pero tipo, operación o región contradictoria,
 * impide falsos positivos.
 */
function checkSlugContradiction(incomingSlug, prop, isNumericIdMatch = false) {
  if (!incomingSlug) return { hasContradiction: false };
  const tokens = new Set(extractSlugTokens(incomingSlug));

  const propTipo = (prop.TIPO || '').toLowerCase();
  const propOperacion = (prop.OPERACION || '').toLowerCase();
  const descLower = (prop.DESCRIPCION_BREVE || '').toLowerCase();

  // Tipos incompatibles
  const knownTypes = ['apartamento', 'casa', 'oficina', 'local', 'terreno', 'galpon', 'townhouse', 'penthouse', 'cubiculos'];
  for (const t of knownTypes) {
    if (tokens.has(t) && propTipo && !propTipo.includes(t)) {
      return { hasContradiction: true, reason: `Conflicto de tipo: enlace indica "${t}" pero propiedad es "${propTipo}"` };
    }
  }

  // JERARQUÍA DE VERDAD COMERCIAL (Regla V5.1):
  // PROHIBIDO deducir Venta o Alquiler a partir del texto de una URL.
  // Si el enlace contiene la palabra venta, pero OPERACION indica Alquiler, prevalece Alquiler.
  // Cuando existe coincidencia por ID numérico único, la operación en URL no anula la propiedad oficial.
  if (isNumericIdMatch) {
    let operationDiscrepancy = null;
    if (tokens.has('alquiler') && propOperacion === 'venta') {
      operationDiscrepancy = 'Discrepancia detectada: URL indica "alquiler" pero Google Sheets determina "Venta". Prevalece Venta.';
    } else if (tokens.has('venta') && propOperacion === 'alquiler') {
      operationDiscrepancy = 'Discrepancia detectada: URL indica "venta" pero Google Sheets determina "Alquiler". Prevalece Alquiler.';
    }
    // No bloquea la coincidencia exacta
  } else {
    // Si no hay ID numérico y depende del slug:
    if (tokens.has('alquiler') && propOperacion === 'venta' && !descLower.includes('alquiler')) {
      return { hasContradiction: true, reason: 'Conflicto de operación: enlace indica "alquiler" pero propiedad es "Venta"' };
    }
    if (tokens.has('venta') && propOperacion === 'alquiler' && !descLower.includes('venta')) {
      return { hasContradiction: true, reason: 'Conflicto de operación: enlace indica "venta" pero propiedad es "Alquiler"' };
    }
  }

  // Ciudades incompatibles
  const otherCities = ['maracaibo', 'valencia', 'maracay', 'barquisimeto', 'margarita', 'merida', 'puerto la cruz', 'lecheria'];
  for (const c of otherCities) {
    if (tokens.has(c) && !descLower.includes(c)) {
      return { hasContradiction: true, reason: `Conflicto geográfico: enlace indica "${c}" pero inmueble está en Caracas/Miranda` };
    }
  }

  return { hasContradiction: false };
}

/**
 * Normaliza un código MLV (ej: MLV-1029979186, MLV1029979186 -> MLV-1029979186 y 1029979186)
 */
function normalizeMlCode(candidate) {
  if (!candidate) return null;
  const match = candidate.toString().match(/MLV[-_ ]?(\d{7,11})/i);
  if (match) {
    return {
      full: `MLV-${match[1]}`,
      numeric: match[1]
    };
  }
  return null;
}

/**
 * MOTOR DE RECONOCIMIENTO MULTIPORTAL INTELIGENTE (UNIFICADO)
 *
 * Recibe cualquier mensaje o enlace de cualquier portal (Wasi, ML, Web, Rexup, MLSCaracas, etc.)
 * y lo resuelve contra el inventario de Google Sheets utilizando los 3 niveles de prioridad.
 */
function extractMultiportalPropertyIdentifiers(text, properties = [], adaptPropertyFn = null) {
  if (!text) {
    return { count: 0, codes: [], matches: [], portalsDetected: [], matchLevel: 'PROPERTY_NOT_FOUND', diagnostics: null };
  }

  const raw = text.toString();
  const rawClean = raw.trim();
  const aliases = getPropertyUrlAliases();
  const adapt = adaptPropertyFn || (p => p);

  const detectedPropertyIds = new Set();
  const detectedCodes = new Set();
  const detectedPortals = new Set();
  const detectedParsedUrls = [];

  // 1. Extraer todas las URLs presentes
  const allUrlsRegex = /https?:\/\/[^\s"'<>]+/gi;
  const urlMatches = Array.from(rawClean.matchAll(allUrlsRegex));
  for (const m of urlMatches) {
    const p = parseAndNormalizeUrl(m[0]);
    if (p) {
      detectedParsedUrls.push(p);
      detectedPortals.add(p.hostname.toUpperCase());
      for (const nid of p.numericIds) detectedCodes.add(nid);
      if (p.mlvCode) {
        detectedCodes.add(p.mlvCode.full);
        detectedCodes.add(p.mlvCode.numeric);
      }
      if (p.refCode) detectedPropertyIds.add(p.refCode);
    }
  }

  // 2. Extraer códigos en texto plano (REF-xxx, MLV-xxx, código numérico explícito)
  const refMatches = Array.from(rawClean.matchAll(/\bREF-?(\d{2,4})\b/gi));
  for (const m of refMatches) {
    const fullRef = `REF-${m[1].padStart(3, '0')}`.toUpperCase();
    detectedPropertyIds.add(fullRef);
    detectedCodes.add(fullRef);
    detectedPortals.add('REF_CODE');
  }

  const mlTextMatches = Array.from(rawClean.matchAll(/\bMLV[-_\s]?(\d{7,11})\b/gi));
  for (const m of mlTextMatches) {
    const fullCode = `MLV-${m[1]}`;
    detectedCodes.add(fullCode);
    detectedCodes.add(m[1]);
    detectedPortals.add('MERCADOLIBRE');
  }

  const explicitTextMatches = Array.from(rawClean.matchAll(/(?:inmueble|c[oó]digo|cod|id|ref|propiedad|wasi)\s*[:#]?\s*(\d{6,9})\b/gi));
  for (const m of explicitTextMatches) {
    detectedCodes.add(m[1]);
    detectedPortals.add('WASI');
  }

  // 3. Revisar aliases por texto completo
  for (const [aliasKey, targetRef] of Object.entries(aliases)) {
    if (rawClean.includes(aliasKey)) {
      detectedPropertyIds.add(targetRef.toUpperCase());
      detectedPortals.add('ALIAS_MATCH');
    }
  }

  // Si no hay nada que pueda ser un inmueble, retornar 0
  if (detectedCodes.size === 0 && detectedPropertyIds.size === 0 && detectedParsedUrls.length === 0) {
    return { count: 0, codes: [], matches: [], portalsDetected: [], matchLevel: 'PROPERTY_NOT_FOUND', diagnostics: null };
  }

  // --------------------------------------------------------------------------
  // BÚSQUEDA Y ASOCIACIÓN DE PROPIEDADES EN EL INVENTARIO DE GOOGLE SHEETS
  // --------------------------------------------------------------------------
  const exactMatchedMap = new Map();
  const crossMatchedMap = new Map();
  let matchLevel = 'PROPERTY_NOT_FOUND';
  let diagnosticDetail = null;

  if (Array.isArray(properties) && properties.length > 0) {
    // ========================================================================
    // PASO 1: EVALUACIÓN DE NIVEL 1 (COINCIDENCIA EXACTA)
    // ========================================================================
    for (const rawProp of properties) {
      const adapted = adapt(rawProp);
      if (!adapted || !adapted.ID_PROPIEDAD) continue;

      const propIdUpper = adapted.ID_PROPIEDAD.toUpperCase();
      let isExact = false;
      let diag = null;

      // 1.A. ID_PROPIEDAD directo o alias
      if (detectedPropertyIds.has(propIdUpper)) {
        isExact = true;
        diag = { method: 'DIRECT_REF_OR_ALIAS', ref: propIdUpper };
      }

      // 1.B. Coincidencia por Código WASI o Identificador numérico extraído de cualquier portal
      if (!isExact) {
        const propWasiCode = (adapted.CODIGO_WASI || rawProp.CODIGO_WASI || '').toString().trim();
        const propWasiUrl = (adapted.Wasi || adapted.Wasi_URL || rawProp.Wasi || rawProp.Wasi_URL || '').toString();
        const propMlUrl = (adapted.Mercado_Libre || adapted['Mercado Libre'] || rawProp['Mercado Libre_URL'] || rawProp['Mercado Libre'] || '').toString();
        const propFotosUrl = (adapted.LINK_FOTOS || adapted.LINK_FOTOS_URL || rawProp.LINK_FOTOS || rawProp.LINK_FOTOS_URL || '').toString();

        const propNumericIds = new Set();
        if (propWasiCode) propNumericIds.add(propWasiCode);
        const wasiMatch = propWasiUrl.match(/\/(\d{6,10})/);
        if (wasiMatch) propNumericIds.add(wasiMatch[1]);
        const rexupMatch = propFotosUrl.match(/cod_inmueble=(\d+)/i);
        if (rexupMatch) propNumericIds.add(rexupMatch[1]);
        const mlMatch = propMlUrl.match(/MLV[-_]?(\d{7,11})/i);
        if (mlMatch) propNumericIds.add(mlMatch[1]);

        // Extraer identificadores numéricos de cualquier columna dinámica en externalLinks
        if (adapted.externalLinks && typeof adapted.externalLinks === 'object') {
          for (const extUrl of Object.values(adapted.externalLinks)) {
            if (typeof extUrl === 'string') {
              const extNumMatch = extUrl.match(/\/(\d{6,10})(?:[^\d]|$)/);
              if (extNumMatch) propNumericIds.add(extNumMatch[1]);
              const extMlMatch = extUrl.match(/MLV[-_]?(\d{7,11})/i);
              if (extMlMatch) propNumericIds.add(extMlMatch[1]);
            }
          }
        }

        for (const code of detectedCodes) {
          if (propNumericIds.has(code)) {
            // Verificar si el enlace entrante incluye un slug contradictorio
            let hasContradiction = false;
            let contradictionReason = '';
            for (const pUrl of detectedParsedUrls) {
              if (pUrl.numericIds.includes(code) && pUrl.slug) {
                const contraCheck = checkSlugContradiction(pUrl.slug, adapted, true);
                if (contraCheck.hasContradiction) {
                  hasContradiction = true;
                  contradictionReason = contraCheck.reason;
                  break;
                }
              }
            }

            if (!hasContradiction) {
              isExact = true;
              diag = { method: 'NUMERIC_ID_MATCH', code, matchedWasi: propWasiCode };
              break;
            }
          }
        }
      }

      // 1.C. Coincidencia por URL limpia literal (Universal Sheet URL en CUALQUIER columna)
      if (!isExact && detectedParsedUrls.length > 0) {
        const rowUrls = [
          adapted.Wasi, adapted.Wasi_URL, rawProp.Wasi, rawProp.Wasi_URL,
          adapted.Mercado_Libre, adapted['Mercado Libre'], rawProp['Mercado Libre_URL'], rawProp['Mercado Libre'],
          adapted.Pagina_Web, adapted['Pagina Web'], rawProp['Pagina Web_URL'], rawProp['Pagina Web'],
          adapted.LINK_FOTOS, adapted.LINK_FOTOS_URL, rawProp.LINK_FOTOS, rawProp.LINK_FOTOS_URL
        ].filter(Boolean);

        // Incluir cualquier otra columna de la fila que contenga un enlace HTTP
        for (const [k, v] of Object.entries(rawProp)) {
          if (typeof v === 'string' && v.startsWith('http')) {
            rowUrls.push(v);
          }
        }
        if (adapted.externalLinks && typeof adapted.externalLinks === 'object') {
          for (const extUrl of Object.values(adapted.externalLinks)) {
            if (typeof extUrl === 'string' && extUrl.startsWith('http')) {
              rowUrls.push(extUrl);
            }
          }
        }

        for (const rUrl of rowUrls) {
          const cleanRow = cleanUrlForMatching(rUrl);
          for (const pUrl of detectedParsedUrls) {
            const cleanGen = cleanUrlForMatching(pUrl.raw);
            if (cleanGen && cleanRow && cleanGen === cleanRow) {
              isExact = true;
              diag = { method: 'LITERAL_URL_MATCH', url: cleanRow };
              break;
            }
          }
          if (isExact) break;
        }
      }

      if (isExact) {
        exactMatchedMap.set(propIdUpper, { property: adapted, level: 'PROPERTY_MATCH_EXACT', diag });
      }
    }

    // ========================================================================
    // PASO 2: EVALUACIÓN DE NIVEL 2 (COINCIDENCIA CRUZADA VERIFICADA POR SLUG)
    // Se ejecuta ÚNICAMENTE si no hubo ninguna coincidencia exacta de Nivel 1
    // ========================================================================
    if (exactMatchedMap.size === 0 && detectedCodes.size === 0 && detectedParsedUrls.length > 0) {
      for (const rawProp of properties) {
        const adapted = adapt(rawProp);
        if (!adapted || !adapted.ID_PROPIEDAD) continue;

        const propIdUpper = adapted.ID_PROPIEDAD.toUpperCase();
        const propWebUrl = (adapted.Pagina_Web || adapted['Pagina Web'] || rawProp['Pagina Web_URL'] || rawProp['Pagina Web'] || '').toString();
        const propWasiUrl = (adapted.Wasi || adapted.Wasi_URL || rawProp.Wasi || rawProp.Wasi_URL || '').toString();
        const propSlugs = [extractWebSlug(propWebUrl), extractWebSlug(propWasiUrl)].filter(Boolean);

        for (const pUrl of detectedParsedUrls) {
          if (pUrl.slug) {
            const incomingTokens = new Set(extractSlugTokens(pUrl.slug));
            for (const pSlug of propSlugs) {
              const registeredTokens = extractSlugTokens(pSlug);
              if (registeredTokens.length >= 3) {
                const matchCount = registeredTokens.filter(t => incomingTokens.has(t)).length;
                const ratio = matchCount / registeredTokens.length;
                const contra = checkSlugContradiction(pUrl.slug, adapted);
                if (ratio >= 0.80 && !contra.hasContradiction) {
                  crossMatchedMap.set(propIdUpper, {
                    property: adapted,
                    level: 'PROPERTY_MATCH_CROSS_PORTAL',
                    diag: { method: 'CROSS_PORTAL_SLUG_MATCH', slug: pUrl.slug, ratio }
                  });
                  break;
                }
              }
            }
          }
          if (crossMatchedMap.has(propIdUpper)) break;
        }
      }
    }
  }

  // Selección de matches finales respetando jerarquía estricta
  let activeMatchedMap = exactMatchedMap.size > 0 ? exactMatchedMap : crossMatchedMap;
  const matchedEntries = Array.from(activeMatchedMap.values());
  const finalMatches = matchedEntries.map(e => e.property);
  const allExtractedCodes = Array.from(detectedCodes);

  if (matchedEntries.length === 1) {
    matchLevel = matchedEntries[0].level;
    diagnosticDetail = matchedEntries[0].diag;
  } else if (matchedEntries.length > 1) {
    matchLevel = 'PROPERTY_MATCH_AMBIGUOUS';
    diagnosticDetail = { reason: 'Múltiples propiedades coincidieron', candidates: Array.from(activeMatchedMap.keys()) };
  } else {
    matchLevel = 'PROPERTY_NOT_FOUND';
    diagnosticDetail = { reason: 'Ninguna propiedad en Google Sheets coincidió con el enlace o identificador' };
  }

  const effectiveMatches = finalMatches.length > 0
    ? finalMatches
    : (allExtractedCodes.length > 0 || detectedParsedUrls.length > 0 ? [null] : []);

  // Retrocompatibilidad con suites existentes (Wasi específico)
  const isWasiSpecific = detectedPortals.has('WASI') && !detectedPortals.has('MLSCARACAS.COM');

  // Detección de URLs entrantes no registradas en Google Sheets (Escenario A y Escenario B)
  const unregisteredUrls = [];
  if (detectedParsedUrls.length > 0) {
    const matchedProp = finalMatches[0] || null;
    const rowUrls = new Set();
    if (matchedProp) {
      const rawProp = matchedProp._raw || matchedProp;
      for (const [k, v] of Object.entries(rawProp)) {
        if (typeof v === 'string' && v.startsWith('http')) {
          rowUrls.add(cleanUrlForMatching(v));
        }
      }
      if (matchedProp.externalLinks && typeof matchedProp.externalLinks === 'object') {
        for (const extUrl of Object.values(matchedProp.externalLinks)) {
          if (typeof extUrl === 'string' && extUrl.startsWith('http')) {
            rowUrls.add(cleanUrlForMatching(extUrl));
          }
        }
      }
    }

    for (const pUrl of detectedParsedUrls) {
      const cleanGen = cleanUrlForMatching(pUrl.raw);
      const isRegisteredInMatchedRow = rowUrls.has(cleanGen);
      if (!isRegisteredInMatchedRow) {
        unregisteredUrls.push({
          url: pUrl.raw,
          cleanUrl: pUrl.cleanUrl,
          domain: pUrl.hostname,
          publicationCode: pUrl.numericIds[0] || null,
          matchedPropertyId: matchedProp?.ID_PROPIEDAD || null,
          scenario: matchedProp ? 'MATCHED_UNREGISTERED' : 'UNMATCHED_LINK'
        });
      }
    }
  }

  return {
    count: finalMatches.length || (effectiveMatches.length > 0 ? 1 : 0),
    codes: allExtractedCodes.length > 0 ? allExtractedCodes : detectedParsedUrls.map(u => `URL:${u.cleanUrl}`),
    matches: effectiveMatches,
    portalsDetected: Array.from(detectedPortals),
    matchLevel,
    isWasiSpecific,
    unregisteredUrls,
    diagnostics: {
      urlReceived: detectedParsedUrls[0]?.cleanUrl || null,
      identifierExtracted: allExtractedCodes[0] || null,
      slugExtracted: detectedParsedUrls[0]?.slug || null,
      columnsConsulted: ['Wasi', 'Mercado Libre', 'Pagina Web', 'LINK_FOTOS', 'CODIGO_WASI', 'ID_PROPIEDAD'],
      refFound: finalMatches[0]?.ID_PROPIEDAD || null,
      matchLevel,
      propertyStatus: finalMatches[0]?.ESTATUS || null,
      detail: diagnosticDetail,
      unregisteredCount: unregisteredUrls.length
    }
  };
}

module.exports = {
  extractMultiportalPropertyIdentifiers,
  cleanUrlForMatching,
  parseAndNormalizeUrl,
  extractWebSlug,
  extractSlugTokens,
  checkSlugContradiction,
  normalizeMlCode,
  getPropertyUrlAliases,
  DEFAULT_PROPERTY_URL_ALIASES
};
