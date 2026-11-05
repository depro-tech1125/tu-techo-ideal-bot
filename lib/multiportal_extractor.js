/**
 * RECONOCEDOR MULTIPORTAL DE PROPIEDADES INMOBILIARIAS
 * Tu Techo Ideal V5.0
 *
 * Portales y fuentes soportadas dinámicamente:
 * 1. Mercado Libre: Subdominios inmueble, casa, apartamento, articulo, mercadolibre.com.ve / .com
 *    Extrae identificadores MLV (ej: MLV-1029979186, MLV-781799115) y limpia parámetros de tracking y fragmentos (_JM, ?ua=, #origin=).
 * 2. Wasi: Dominios wasi.co, wasi.com, info.wasi.co y códigos numéricos de publicación (6 a 9 dígitos).
 * 3. Página Web propia: tutechoideal.com/inmuebles/<slug> comparando rutas y slugs normalizados con Col H.
 * 4. Fotos / Rexup: Enlaces rexup.net con cod_inmueble de Col E (LINK_FOTOS).
 * 5. Identificadores internos: REF-001 a REF-999.
 * 6. Aliases de URLs alternativas: Mapea publicaciones alternas (ej: MLV-1029979186 -> REF-035) sin alterar la Google Sheet oficial.
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
 * Normaliza y limpia una URL quitando query parameters, hashes y sufijos de tracking.
 */
function cleanUrlForMatching(url) {
  if (!url || typeof url !== 'string') return '';
  return url
    .trim()
    .replace(/[?#].*$/, '') // Quita query strings (?ua=...) y fragmentos (#origin=...)
    .replace(/\/+$/, '')     // Quita barras finales
    .toLowerCase();
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
 * Analiza el texto en busca de enlaces de Wasi, Mercado Libre, Web propia, Rexup o códigos REF.
 * Retorna { count, codes, matches, portalsDetected, propertyDetails }
 */
function extractMultiportalPropertyIdentifiers(text, properties = [], adaptPropertyFn = null) {
  if (!text) {
    return { count: 0, codes: [], matches: [], portalsDetected: [] };
  }

  const raw = text.toString();
  const rawClean = raw.trim();
  const aliases = getPropertyUrlAliases();

  // Conjunto de identificadores canónicos detectados (REF-xxx o códigos únicos)
  const detectedPropertyIds = new Set();
  const detectedCodes = new Set();
  const detectedPortals = new Set();

  // Función para adaptar si no fue provista externamente
  const adapt = adaptPropertyFn || (p => p);

  // --------------------------------------------------------------------------
  // 1. RECONOCIMIENTO DE MERCADO LIBRE
  // --------------------------------------------------------------------------
  // URLs: inmueble.mercadolibre.com.ve, casa.mercadolibre.com.ve, apartamento..., articulo..., etc.
  const mlUrlRegex = /https?:\/\/(?:[a-zA-Z0-9.-]+\.)?mercadolibre\.com(?:\.[a-zA-Z]{2,3})?\/[^\s"'<>]*?MLV[-_]?(\d{7,11})/gi;
  const mlUrlMatches = Array.from(rawClean.matchAll(mlUrlRegex));
  for (const m of mlUrlMatches) {
    const numeric = m[1];
    const fullCode = `MLV-${numeric}`;
    detectedCodes.add(fullCode);
    detectedPortals.add('MERCADOLIBRE');

    // Verificar si es un alias directo
    if (aliases[fullCode]) {
      detectedPropertyIds.add(aliases[fullCode].toUpperCase());
    }
    if (aliases[numeric]) {
      detectedPropertyIds.add(aliases[numeric].toUpperCase());
    }
  }

  // Menciones textuales explícitas de MLV (ej: MLV-1029979186, MLV 1029979186)
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

  // Comprobar si la URL completa entrante de ML está en aliases
  for (const [aliasKey, targetRef] of Object.entries(aliases)) {
    if (aliasKey.startsWith('http') && rawClean.includes(aliasKey)) {
      detectedPropertyIds.add(targetRef.toUpperCase());
      detectedPortals.add('MERCADOLIBRE');
    }
  }

  // --------------------------------------------------------------------------
  // 2. RECONOCIMIENTO DE WASI
  // --------------------------------------------------------------------------
  // URLs Wasi oficiales
  const wasiUrlRegex = /https?:\/\/(?:[a-zA-Z0-9.-]+\.)?wasi\.(?:co|com)\/[^\s"'<>]+\/(\d{6,9})/gi;
  const wasiMatches = Array.from(rawClean.matchAll(wasiUrlRegex));
  for (const m of wasiMatches) {
    if (m[1]) {
      detectedCodes.add(m[1]);
      detectedPortals.add('WASI');
    }
  }

  // Menciones textuales con indicador inequívoco
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

  // Si no se detectó nada, retornar vacío de inmediato
  if (detectedCodes.size === 0 && detectedPropertyIds.size === 0) {
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

      // 1. Coincidencia por ID_PROPIEDAD directo o alias
      if (detectedPropertyIds.has(propIdUpper)) {
        isMatch = true;
      }

      // 2. Coincidencia por Wasi (código o URL)
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

      // 3. Coincidencia por Mercado Libre (código MLV o URL)
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

      // 4. Coincidencia por Página Web propia (slug o URL)
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

      // 5. Coincidencia por Rexup LINK_FOTOS (cod_inmueble)
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

      if (isMatch) {
        matchedPropertyMap.set(propIdUpper, adapted);
      }
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
