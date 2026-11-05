/**
 * RECONOCEDOR MULTIPORTAL Y UNIVERSAL DE PROPIEDADES INMOBILIARIAS
 * Tu Techo Ideal V5.0 — Consolidación Operativa
 *
 * Regla:
 * Si el enlace enviado por el cliente existe en Google Sheets, se identifica el inmueble
 * y se continúa con la atención comercial, independientemente del dominio.
 *
 * Portales y fuentes soportadas:
 * 1. Mercado Libre: Subdominios inmueble, casa, apartamento, articulo, y dominios regionales con MLV
 * 2. Wasi: wasi.co, wasi.com, info.wasi.co y códigos numéricos (6 a 9 dígitos)
 * 3. Página Web propia: tutechoideal.com/inmuebles/<slug>
 * 4. Rexup: rexup.net con cod_inmueble (LINK_FOTOS)
 * 5. Universal Sheet Link: Cualquier URL de cualquier dominio registrada en Google Sheets
 * 6. Identificadores internos: REF-001 a REF-999
 * 7. Aliases de publicaciones alternativas verificadas (ej: MLV-1029979186 -> REF-035)
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
 * Normaliza y limpia una URL quitando sufijos de tracking y hashes,
 * preservando parámetros determinantes de identidad (como cod_inmueble o IDs).
 */
function cleanUrlForMatching(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return '';
  let str = urlStr.trim().replace(/[.,;!?]+$/, '');

  try {
    const parsed = new URL(str);
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');

    // Parámetros de tracking a eliminar con seguridad
    const trackingKeys = [
      'ua', 'origin', 'sid', 'action', 'source', 'ref', 'share',
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'gclid', 'igshid', '_ga'
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
 * Normaliza un slug web (ej: /inmuebles/cubiculos-en-alquiler/ -> cubiculos-en-alquiler)
 */
function extractWebSlug(urlOrText) {
  if (!urlOrText) return null;
  const match = urlOrText.match(/(?:tutechoideal\.com)?\/inmuebles\/([a-zA-Z0-9_-]+)/i);
  return match ? match[1].toLowerCase().replace(/^_+|_+$/g, '') : null;
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
 * Extractor multiportal principal.
 * Analiza el texto en busca de enlaces de Wasi, Mercado Libre, Web propia, Rexup,
 * cualquier URL universal registrada en Sheets o códigos REF.
 * Retorna { count, codes, matches, portalsDetected }
 */
function extractMultiportalPropertyIdentifiers(text, properties = [], adaptPropertyFn = null) {
  if (!text) {
    return { count: 0, codes: [], matches: [], portalsDetected: [] };
  }

  const raw = text.toString();
  const rawClean = raw.trim();
  const aliases = getPropertyUrlAliases();

  // Conjunto de identificadores canónicos detectados
  const detectedPropertyIds = new Set();
  const detectedCodes = new Set();
  const detectedPortals = new Set();

  // Función para adaptar si no fue provista externamente
  const adapt = adaptPropertyFn || (p => p);

  // --------------------------------------------------------------------------
  // 1. RECONOCIMIENTO DE MERCADO LIBRE
  // --------------------------------------------------------------------------
  const mlUrlRegex = /https?:\/\/(?:[a-zA-Z0-9.-]+\.)?mercadolibre\.com(?:\.[a-zA-Z]{2,3})?\/[^\s"'<>]*?MLV[-_]?(\d{7,11})/gi;
  const mlUrlMatches = Array.from(rawClean.matchAll(mlUrlRegex));
  for (const m of mlUrlMatches) {
    const numeric = m[1];
    const fullCode = `MLV-${numeric}`;
    detectedCodes.add(fullCode);
    detectedPortals.add('MERCADOLIBRE');

    if (aliases[fullCode]) {
      detectedPropertyIds.add(aliases[fullCode].toUpperCase());
    }
    if (aliases[numeric]) {
      detectedPropertyIds.add(aliases[numeric].toUpperCase());
    }
  }

  const mlTextRegex = /\bMLV[-_\s]?(\d{7,11})\b/gi;
  const mlTextMatches = Array.from(rawClean.matchAll(mlTextRegex));
  for (const m of mlTextMatches) {
    const numeric = m[1];
    const fullCode = `MLV-${numeric}`;
    detectedCodes.add(fullCode);
    detectedPortals.add('MERCADOLIBRE');

    if (aliases[fullCode]) {
      detectedPropertyIds.add(aliases[fullCode].toUpperCase());
    }
    if (aliases[numeric]) {
      detectedPropertyIds.add(aliases[numeric].toUpperCase());
    }
  }

  for (const [aliasKey, targetRef] of Object.entries(aliases)) {
    if (aliasKey.startsWith('http') && rawClean.includes(aliasKey)) {
      detectedPropertyIds.add(targetRef.toUpperCase());
      detectedPortals.add('MERCADOLIBRE');
    }
  }

  // --------------------------------------------------------------------------
  // 2. RECONOCIMIENTO DE WASI
  // --------------------------------------------------------------------------
  const wasiUrlRegex = /https?:\/\/(?:[a-zA-Z0-9.-]+\.)?wasi\.(?:co|com)\/[^\s"'<>]+\/(\d{6,9})/gi;
  const wasiMatches = Array.from(rawClean.matchAll(wasiUrlRegex));
  for (const m of wasiMatches) {
    if (m[1]) {
      detectedCodes.add(m[1]);
      detectedPortals.add('WASI');
    }
  }

  const explicitTextMatches = Array.from(rawClean.matchAll(/(?:inmueble|c[oó]digo|cod|id|ref|propiedad|wasi)\s*[:#]?\s*(\d{6,9})\b/gi));
  for (const m of explicitTextMatches) {
    const candidateCode = m[1];
    const matchIndex = m.index || 0;
    const precedingText = rawClean.substring(Math.max(0, matchIndex - 15), matchIndex).toLowerCase();
    const isPrice = /[\$€]|usd|bs|precio|canon/i.test(precedingText);
    const isPhone = /tlf|telefono|celular|ws|whatsapp|\+58|04/i.test(precedingText);
    if (!isPrice && !isPhone) {
      detectedCodes.add(candidateCode);
      detectedPortals.add('WASI');
    }
  }

  // --------------------------------------------------------------------------
  // 3. RECONOCIMIENTO DE PÁGINA WEB PROPIA (tutechoideal.com/inmuebles/)
  // --------------------------------------------------------------------------
  const webUrlRegex = /https?:\/\/(?:www\.)?tutechoideal\.com\/inmuebles\/([a-zA-Z0-9_-]+)\/?/gi;
  const webMatches = Array.from(rawClean.matchAll(webUrlRegex));
  for (const m of webMatches) {
    if (m[1]) {
      const slug = m[1].toLowerCase().replace(/^_+|_+$/g, '');
      detectedCodes.add(`WEB:${slug}`);
      detectedPortals.add('WEB_PROPIA');
    }
  }

  // --------------------------------------------------------------------------
  // 4. RECONOCIMIENTO DE FOTOS / REXUP (cod_inmueble)
  // --------------------------------------------------------------------------
  const rexupUrlRegex = /https?:\/\/(?:www\.)?rexup\.net\/[^\s"'<>]*(?:cod_inmueble=)(\d+)/gi;
  const rexupMatches = Array.from(rawClean.matchAll(rexupUrlRegex));
  for (const m of rexupMatches) {
    if (m[1]) {
      detectedCodes.add(`REXUP:${m[1]}`);
      detectedPortals.add('REXUP');
    }
  }

  // --------------------------------------------------------------------------
  // 5. RECONOCIMIENTO DE CÓDIGOS INTERNOS REF-xxx
  // --------------------------------------------------------------------------
  const refMatches = Array.from(rawClean.matchAll(/\bREF-?(\d{2,4})\b/gi));
  for (const m of refMatches) {
    const fullRef = `REF-${m[1].padStart(3, '0')}`.toUpperCase();
    detectedPropertyIds.add(fullRef);
    detectedCodes.add(fullRef);
    detectedPortals.add('REF_CODE');
  }

  // --------------------------------------------------------------------------
  // 6. DETECCIÓN UNIVERSAL DE CUALQUIER URL PRESENTE EN EL MENSAJE
  // --------------------------------------------------------------------------
  const allGenericUrlsRegex = /https?:\/\/[^\s"'<>]+/gi;
  const genericUrlMatches = Array.from(rawClean.matchAll(allGenericUrlsRegex));
  const detectedGenericCleanUrls = [];
  for (const gm of genericUrlMatches) {
    const rawUrl = gm[0];
    const cleaned = cleanUrlForMatching(rawUrl);
    if (cleaned) {
      detectedGenericCleanUrls.push({ raw: rawUrl, clean: cleaned });
    }
  }

  // Si no se detectó ningún código, URL ni REF, retornar vacío
  if (detectedCodes.size === 0 && detectedPropertyIds.size === 0 && detectedGenericCleanUrls.length === 0) {
    return { count: 0, codes: [], matches: [], portalsDetected: [] };
  }

  // --------------------------------------------------------------------------
  // BÚSQUEDA Y ASOCIACIÓN DE PROPIEDADES EN EL INVENTARIO DE GOOGLE SHEETS
  // --------------------------------------------------------------------------
  const matchedPropertyMap = new Map();

  if (Array.isArray(properties) && properties.length > 0) {
    for (const rawProp of properties) {
      const adapted = adapt(rawProp);
      if (!adapted || !adapted.ID_PROPIEDAD) continue;

      const propIdUpper = adapted.ID_PROPIEDAD.toUpperCase();
      let isMatch = false;

      // A. Coincidencia por ID_PROPIEDAD directo o alias
      if (detectedPropertyIds.has(propIdUpper)) {
        isMatch = true;
      }

      // B. Coincidencia por Wasi (código o URL)
      if (!isMatch) {
        const propWasiCode = (adapted.CODIGO_WASI || rawProp.CODIGO_WASI || '').toString().trim();
        const propWasiUrl = (adapted.Wasi || adapted.Wasi_URL || rawProp.Wasi || rawProp.Wasi_URL || '').toString();

        for (const code of detectedCodes) {
          if (/^\d{6,9}$/.test(code)) {
            if (propWasiCode === code || propWasiUrl.includes(`/${code}`)) {
              isMatch = true;
              break;
            }
          }
        }
      }

      // C. Coincidencia por Mercado Libre (código MLV o URL)
      if (!isMatch) {
        const propMlUrl = (adapted.Mercado_Libre || adapted['Mercado Libre'] || rawProp['Mercado Libre_URL'] || rawProp['Mercado Libre'] || '').toString();
        const propMlNorm = normalizeMlCode(propMlUrl);

        for (const code of detectedCodes) {
          if (code.startsWith('MLV-')) {
            const codeNorm = normalizeMlCode(code);
            if (codeNorm && propMlNorm) {
              if (codeNorm.full === propMlNorm.full || codeNorm.numeric === propMlNorm.numeric) {
                isMatch = true;
                break;
              }
            } else if (propMlUrl.includes(code)) {
              isMatch = true;
              break;
            }
          }
        }
      }

      // D. Coincidencia por Página Web propia (slug o URL)
      if (!isMatch) {
        const propWebUrl = (adapted.Pagina_Web || adapted['Pagina Web'] || rawProp['Pagina Web_URL'] || rawProp['Pagina Web'] || '').toString();
        const propSlug = extractWebSlug(propWebUrl);

        for (const code of detectedCodes) {
          if (code.startsWith('WEB:')) {
            const searchSlug = code.substring(4);
            if (propSlug && (propSlug === searchSlug || propSlug.includes(searchSlug) || searchSlug.includes(propSlug))) {
              isMatch = true;
              break;
            }
          }
        }
      }

      // E. Coincidencia por Rexup LINK_FOTOS (cod_inmueble)
      if (!isMatch) {
        const propFotosUrl = (adapted.LINK_FOTOS || adapted.LINK_FOTOS_URL || rawProp.LINK_FOTOS || rawProp.LINK_FOTOS_URL || '').toString();
        for (const code of detectedCodes) {
          if (code.startsWith('REXUP:')) {
            const rexupId = code.substring(6);
            if (propFotosUrl.includes(`cod_inmueble=${rexupId}`)) {
              isMatch = true;
              break;
            }
          }
        }
      }

      // F. COINCIDENCIA UNIVERSAL: Enlace de cualquier dominio registrado literalmente en Sheets
      if (!isMatch && detectedGenericCleanUrls.length > 0) {
        const rowUrls = [
          adapted.Wasi, adapted.Wasi_URL, rawProp.Wasi, rawProp.Wasi_URL,
          adapted.Mercado_Libre, adapted['Mercado Libre'], rawProp['Mercado Libre_URL'], rawProp['Mercado Libre'],
          adapted.Pagina_Web, adapted['Pagina Web'], rawProp['Pagina Web_URL'], rawProp['Pagina Web'],
          adapted.LINK_FOTOS, adapted.LINK_FOTOS_URL, rawProp.LINK_FOTOS, rawProp.LINK_FOTOS_URL
        ];

        // Recorrer cualquier otra columna de la fila que contenga un enlace HTTP
        for (const [k, v] of Object.entries(rawProp)) {
          if (typeof v === 'string' && v.startsWith('http')) {
            rowUrls.push(v);
          }
        }

        const cleanRowUrls = rowUrls.filter(Boolean).map(u => cleanUrlForMatching(u)).filter(Boolean);

        for (const genUrl of detectedGenericCleanUrls) {
          const genNoProto = genUrl.clean.replace(/^https?:\/\/(?:www\.)?/, '');
          if (genNoProto.length < 8) continue;

          for (const cru of cleanRowUrls) {
            const cruNoProto = cru.replace(/^https?:\/\/(?:www\.)?/, '');
            if (cruNoProto.length < 8) continue;

            if (genNoProto === cruNoProto) {
              isMatch = true;
              detectedPortals.add('UNIVERSAL_SHEET_URL');
              detectedCodes.add(`URL:${genUrl.clean}`);
              break;
            }
          }
          if (isMatch) break;
        }
      }

      if (isMatch) {
        matchedPropertyMap.set(propIdUpper, adapted);
      }
    }
  }

  // Si no hubo coincidencia pero se detectaron URLs genéricas, registrar el código para evitar invenciones (silencio)
  if (matchedPropertyMap.size === 0 && detectedGenericCleanUrls.length > 0 && detectedCodes.size === 0) {
    for (const genUrl of detectedGenericCleanUrls) {
      detectedCodes.add(`UNKNOWN_URL:${genUrl.clean}`);
      detectedPortals.add('UNKNOWN_PORTAL');
    }
  }

  // Lista de códigos para reporte
  const allExtractedCodes = Array.from(detectedCodes);
  const matchedPropertiesList = Array.from(matchedPropertyMap.values());

  // Si se detectaron códigos válidos pero no están en Google Sheets, preservar [null] para respetar la regla de "no inventar"
  const finalMatches = matchedPropertiesList.length > 0
    ? matchedPropertiesList
    : (allExtractedCodes.length > 0 ? [null] : []);

  return {
    count: finalMatches.filter(Boolean).length || (allExtractedCodes.length > 0 ? 1 : 0),
    codes: allExtractedCodes,
    matches: finalMatches,
    portalsDetected: Array.from(detectedPortals)
  };
}

module.exports = {
  extractMultiportalPropertyIdentifiers,
  cleanUrlForMatching,
  extractWebSlug,
  normalizeMlCode,
  getPropertyUrlAliases,
  DEFAULT_PROPERTY_URL_ALIASES
};
