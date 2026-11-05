/**
 * LECTOR SEGURO DE PUBLICACIONES EXTERNAS Y COMPARADOR DE ATRIBUTOS AL 90%
 * Tu Techo Ideal V5.0 — Validación Real de Publicaciones Inmobiliarias
 *
 * Módulo de ciberseguridad, extracción semántica y comparación multi-atributo
 * contra la base de datos de Google Sheets (Fuente Única de Verdad).
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const dns = require('dns');
const {
  cleanUrlForMatching,
  parseAndNormalizeUrl,
  checkSlugContradiction,
  getPropertyUrlAliases
} = require('./multiportal_extractor');

// ============================================================================
// 1. CONFIGURACIÓN Y CACHÉ TEMPORAL DE PUBLICACIONES (TTL: 15 MIN)
// ============================================================================
const CACHE_TTL_MS = 15 * 60 * 1000;
const publicationCache = new Map();

// Control de tasa de peticiones por conversación (Max 3 consultas por charla)
const conversationFetchCounts = new Map();
const MAX_FETCHES_PER_CONVERSATION = 3;

// Límites de descarga y tiempo
const MAX_BODY_BYTES = 512 * 1024; // 512 KB
const FETCH_TIMEOUT_MS = 3500;      // 3.5 segundos max

/**
 * Limpieza periódica de caché
 */
function cleanupExpiredCache() {
  const now = Date.now();
  for (const [key, item] of publicationCache.entries()) {
    if (now - item.timestamp > CACHE_TTL_MS) {
      publicationCache.delete(key);
    }
  }
}
setInterval(cleanupExpiredCache, 5 * 60 * 1000).unref();

// ============================================================================
// 2. SEGURIDAD Y PROTECCIÓN ESTRICTA CONTRA SSRF (CIBERSEGURIDAD)
// ============================================================================

/**
 * Valida si una dirección IP pertenece a rangos privados, loopback o metadata
 */
function isPrivateOrReservedIp(ip) {
  if (!ip) return true;

  // IPv4 Loopback (127.0.0.0/8) y 0.0.0.0
  if (/^127\./.test(ip) || ip === '0.0.0.0') return true;

  // RFC 1918 Rangos Privados
  // 10.0.0.0/8
  if (/^10\./.test(ip)) return true;
  // 172.16.0.0/12 (172.16.0.0 a 172.31.255.255)
  const m172 = ip.match(/^172\.(\d+)\./);
  if (m172) {
    const secondOctet = parseInt(m172[1], 10);
    if (secondOctet >= 16 && secondOctet <= 31) return true;
  }
  // 192.168.0.0/16
  if (/^192\.168\./.test(ip)) return true;

  // Link-Local (169.254.0.0/16) - Incluye metadata AWS/GCP (169.254.169.254)
  if (/^169\.254\./.test(ip)) return true;

  // Multicast y reservadas (224.0.0.0/4 y 240.0.0.0/4)
  const firstOctet = parseInt(ip.split('.')[0], 10);
  if (firstOctet >= 224) return true;

  // IPv6 Loopback, link-local, unique-local, IPv4-mapped
  if (ip === '::1' || ip === '::' || /^fe80:/i.test(ip) || /^fc00:/i.test(ip) || /^fd00:/i.test(ip) || /^::ffff:/i.test(ip)) {
    return true;
  }

  return false;
}

/**
 * Comprobación exhaustiva de URL antes de emitir cualquier petición de red
 */
async function isSafeUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    return { safe: false, reason: 'URL_EMPTY_OR_INVALID' };
  }

  let parsed;
  try {
    parsed = new URL(urlString);
  } catch (e) {
    return { safe: false, reason: 'URL_MALFORMED' };
  }

  // 1. Protocolo estrictamente HTTP o HTTPS
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { safe: false, reason: 'PROTOCOL_DISALLOWED' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // 2. Bloqueo de dominios locales y endpoints de metadata
  const blockedHosts = [
    'localhost',
    'metadata.google.internal',
    'instance-data',
    'metadata.internal'
  ];
  if (blockedHosts.includes(hostname) || hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.localhost')) {
    return { safe: false, reason: 'LOCAL_OR_INTERNAL_DOMAIN_BLOCKED' };
  }

  // 3. Si el hostname es directamente una IP literal:
  if (/^[\d.]+$/.test(hostname) || hostname.includes(':')) {
    if (isPrivateOrReservedIp(hostname)) {
      return { safe: false, reason: 'PRIVATE_IP_BLOCKED', ip: hostname };
    }
  }

  // 4. Resolución DNS preventiva contra ataques DNS Rebinding
  try {
    const lookupResult = await dns.promises.lookup(hostname);
    const resolvedIp = lookupResult.address;
    if (isPrivateOrReservedIp(resolvedIp)) {
      return { safe: false, reason: 'DNS_RESOLVED_TO_PRIVATE_IP', ip: resolvedIp };
    }
    return { safe: true, parsedUrl: parsed, resolvedIp };
  } catch (dnsErr) {
    return { safe: false, reason: 'DNS_LOOKUP_FAILED', error: dnsErr.message };
  }
}

/**
 * Descarga segura de contenido HTML público con límites estrictos de tamaño y tiempo
 */
async function fetchPublicPublication(urlString, options = {}) {
  const { talkId = null, bypassCache = false, simulatedHtml = null } = options;

  // En entorno de pruebas con HTML simulado inyectado:
  if (simulatedHtml !== null) {
    return {
      success: true,
      accessible: true,
      statusCode: 200,
      html: simulatedHtml,
      fromMock: true,
      url: urlString
    };
  }

  // Control de tasa por conversación
  if (talkId) {
    const currentFetches = conversationFetchCounts.get(talkId) || 0;
    if (currentFetches >= MAX_FETCHES_PER_CONVERSATION) {
      return { success: false, accessible: false, reason: 'RATE_LIMIT_EXCEEDED_PER_CONVERSATION' };
    }
    conversationFetchCounts.set(talkId, currentFetches + 1);
  }

  // Validación de caché
  const cacheKey = urlString.trim().toLowerCase();
  if (!bypassCache && publicationCache.has(cacheKey)) {
    const cached = publicationCache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return { ...cached.data, fromCache: true };
    }
  }

  // Validación preventiva SSRF
  const safetyCheck = await isSafeUrl(urlString);
  if (!safetyCheck.safe) {
    return { success: false, accessible: false, reason: `SSRF_BLOCKED: ${safetyCheck.reason}` };
  }

  return new Promise((resolve) => {
    let redirectsCount = 0;
    const maxRedirects = 3;

    function executeRequest(currentUrlStr) {
      let parsed;
      try {
        parsed = new URL(currentUrlStr);
      } catch (e) {
        return resolve({ success: false, accessible: false, reason: 'REDIRECT_URL_INVALID' });
      }

      const client = parsed.protocol === 'https:' ? https : http;
      const reqOptions = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + (parsed.search || ''),
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 (TuTechoIdeal/5.0 Commercial Bot)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
          'Connection': 'close'
        },
        timeout: FETCH_TIMEOUT_MS
      };

      const req = client.request(reqOptions, (res) => {
        // Manejo de redirecciones
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          redirectsCount++;
          if (redirectsCount > maxRedirects) {
            req.destroy();
            return resolve({ success: false, accessible: false, reason: 'MAX_REDIRECTS_EXCEEDED' });
          }
          const redirectTarget = new URL(res.headers.location, currentUrlStr).toString();
          // Validar target de redirección contra SSRF
          isSafeUrl(redirectTarget).then(redirectSafety => {
            if (!redirectSafety.safe) {
              req.destroy();
              return resolve({ success: false, accessible: false, reason: `SSRF_BLOCKED_ON_REDIRECT: ${redirectSafety.reason}` });
            }
            executeRequest(redirectTarget);
          }).catch(() => {
            req.destroy();
            return resolve({ success: false, accessible: false, reason: 'REDIRECT_SAFETY_CHECK_ERROR' });
          });
          return;
        }

        if (res.statusCode < 200 || res.statusCode >= 400) {
          req.destroy();
          return resolve({ success: false, accessible: false, statusCode: res.statusCode, reason: `HTTP_STATUS_${res.statusCode}` });
        }

        let body = '';
        let totalBytes = 0;

        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
          totalBytes += Buffer.byteLength(chunk, 'utf8');
          // Truncar descarga si excede el límite de seguridad (512 KB)
          if (totalBytes > MAX_BODY_BYTES) {
            req.destroy();
            const resultData = { success: true, accessible: true, statusCode: res.statusCode, html: body, truncated: true };
            publicationCache.set(cacheKey, { timestamp: Date.now(), data: resultData });
            return resolve(resultData);
          }
        });

        res.on('end', () => {
          const resultData = { success: true, accessible: true, statusCode: res.statusCode, html: body, truncated: false };
          publicationCache.set(cacheKey, { timestamp: Date.now(), data: resultData });
          resolve(resultData);
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, accessible: false, reason: 'REQUEST_TIMEOUT' });
      });

      req.on('error', (err) => {
        resolve({ success: false, accessible: false, reason: `NETWORK_ERROR: ${err.message}` });
      });

      req.end();
    }

    executeRequest(urlString);
  });
}

// ============================================================================
// 3. EXTRACCIÓN DE ATRIBUTOS ESTRUCTURADOS Y SEMÁNTICOS (HTML / JSON-LD / META)
// ============================================================================

/**
 * Limpia y desinfecta texto HTML, eliminando tags y evitando inyecciones de prompt
 */
function sanitizeHtmlSnippet(text) {
  if (!text) return '';
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizador de palabras clave
 */
function normalizeKeyword(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Extrae atributos verificables de la publicación desde el HTML público
 */
function extractPublicationAttributes(html, urlStr = '') {
  const result = {
    publicationId: null,
    tipo: null,
    operacion: null,
    zona: null,
    ciudad: 'Caracas',
    precioNum: null,
    moneda: 'USD',
    metrajeNum: null,
    habitacionesNum: null,
    banosNum: null,
    estacionamientosNum: null,
    distinctiveFeatures: [],
    rawTitle: '',
    rawDescription: ''
  };

  if (!html || typeof html !== 'string') {
    return result;
  }

  // 1. Extraer Título y Metatags
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const ogTitleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
                       html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  const rawTitle = sanitizeHtmlSnippet(ogTitleMatch?.[1] || titleMatch?.[1] || '');
  result.rawTitle = rawTitle;

  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
                    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  const rawDesc = sanitizeHtmlSnippet(descMatch?.[1] || '');
  result.rawDescription = rawDesc;

  // Texto consolidado para análisis semántico (Título + Descripción + primeros 80 KB de texto)
  const bodyText = sanitizeHtmlSnippet(html.substring(0, 100000));
  const fullText = `${rawTitle} ${rawDesc} ${bodyText}`;
  const fullNorm = normalizeKeyword(fullText);
  const titleAndUrlNorm = normalizeKeyword(`${urlStr} ${rawTitle}`);

  // 2. Extraer Bloques JSON-LD si existen
  const jsonLdBlocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of jsonLdBlocks) {
    try {
      const jsonContent = block.replace(/<\/?script[^>]*>/gi, '').trim();
      const parsed = JSON.parse(jsonContent);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        if (item.name && !result.rawTitle) result.rawTitle = item.name;
        if (item.description && !result.rawDescription) result.rawDescription = item.description;

        // Precio en JSON-LD
        const offers = item.offers || item;
        if (offers.price) {
          const p = parseFloat(String(offers.price).replace(/[^0-9.]/g, ''));
          if (!isNaN(p) && p > 0) result.precioNum = p;
        }
        if (offers.priceCurrency) result.moneda = offers.priceCurrency;

        // Metraje en JSON-LD
        if (item.floorSize?.value) {
          const m = parseFloat(item.floorSize.value);
          if (!isNaN(m) && m > 0) result.metrajeNum = m;
        }
        // Habitaciones en JSON-LD
        if (item.numberOfRooms || item.numberOfBedrooms) {
          const h = parseInt(item.numberOfRooms || item.numberOfBedrooms, 10);
          if (!isNaN(h)) result.habitacionesNum = h;
        }
      }
    } catch (e) {
      // Ignorar JSON-LD malformado sin interrumpir
    }
  }

  // 3. Extracción de Identificador de Publicación (Wasi, MLV, Rexup)
  const idWasiMatch = html.match(/(?:id[_-]?inmueble|c[oó]digo[_-]?wasi|wasi\.co\/[^"'\s]*\/)(\d{6,11})/i) ||
                      urlStr.match(/(\d{6,9})(?:[^\d]|$)/);
  if (idWasiMatch && idWasiMatch[1]) {
    result.publicationId = idWasiMatch[1];
  } else {
    const mlvMatch = html.match(/MLV[ -]?(\d{8,11})/i) || urlStr.match(/MLV[ -]?(\d{8,11})/i);
    if (mlvMatch) result.publicationId = `MLV-${mlvMatch[1]}`;
  }

  // 4. Extracción de Tipo de Inmueble (Priorizar URL y Título sobre body general)
  function detectTipo(textNorm) {
    if (/\b(?:apartamento|apto|penthouse|ph)\b/i.test(textNorm)) return 'apartamento';
    if (/\b(?:casa\s*comercial)\b/i.test(textNorm)) return 'casa comercial';
    if (/\b(?:casa|quinta|chalet)\b/i.test(textNorm)) return 'casa';
    if (/\b(?:oficina|cub[ií]culo|cub[ií]culos)\b/i.test(textNorm)) return 'oficina';
    if (/\b(?:local|local\s*comercial)\b/i.test(textNorm)) return 'local';
    if (/\b(?:terreno|parcela|lote)\b/i.test(textNorm)) return 'terreno';
    if (/\b(?:galp[oó]n|nave\s*industrial)\b/i.test(textNorm)) return 'galpon';
    return null;
  }
  result.tipo = detectTipo(titleAndUrlNorm) || detectTipo(fullNorm);

  // 5. Extracción de Operación Comercial (Priorizar URL y Título sobre footer/menús)
  if (/\b(?:vendo|venta|en\s*venta|se\s*vende)\b/i.test(titleAndUrlNorm)) {
    result.operacion = 'venta';
  } else if (/\b(?:alquilo|alquiler|arriendo|canon|renta|en\s*alquiler)\b/i.test(titleAndUrlNorm)) {
    result.operacion = 'alquiler';
  } else if (/\b(?:vendo|venta|en\s*venta|se\s*vende)\b/i.test(fullNorm)) {
    result.operacion = 'venta';
  } else if (/\b(?:alquilo|alquiler|arriendo|canon|renta|en\s*alquiler)\b/i.test(fullNorm)) {
    result.operacion = 'alquiler';
  }

  // 6. Extracción de Zona / Ubicación en Caracas
  const caracasZones = [
    'los palos grandes', 'los samanes', 'lomas del sol', 'la candelaria', 'prados del este',
    'la boyera', 'chacao', 'altamira', 'el hatillo', 'la california norte', 'la california sur',
    'la california', 'alta florida', 'la florida', 'las mercedes', 'san bernardino', 'valle arriba',
    'colinas de bello monte', 'bello monte', 'santa fe', 'el encantado', 'la castellana',
    'campo alegre', 'los ruices', 'macaracuay', 'san antonio de los altos'
  ];

  for (const z of caracasZones) {
    const zRegex = new RegExp(`\\b${z}\\b`, 'i');
    if (zRegex.test(titleAndUrlNorm) || zRegex.test(fullNorm)) {
      result.zona = z.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      break;
    }
  }

  // 7. Extracción de Precio Numérico si no vino por JSON-LD
  if (result.precioNum === null) {
    const priceMatch = rawTitle.match(/(?:us\$|\$|usd)\s*([\d.,]+)/i) ||
                       rawDesc.match(/(?:precio|canon|inversi[oó]n)[^$€\n]*([\$€]\s*[\d.,]+)/i) ||
                       fullText.match(/\$\s*([\d.,]+)/);
    if (priceMatch) {
      const rawDigits = priceMatch[1].replace(/[^0-9]/g, '');
      const numVal = parseInt(rawDigits, 10);
      if (!isNaN(numVal) && numVal > 0) {
        result.precioNum = numVal;
      }
    }
  }

  // 8. Extracción de Metraje Numérico si no vino por JSON-LD
  if (result.metrajeNum === null) {
    const metrajeMatch = rawTitle.match(/(\d+(?:[.,]\d+)?)\s*(?:m2|m²|metros)\b/i) ||
                         rawDesc.match(/(\d+(?:[.,]\d+)?)\s*(?:m2|m²|metros)\b/i) ||
                         fullText.match(/(?:metraje|superficie|área)[\s:]*(\d+(?:[.,]\d+)?)\s*(?:m2|m²)?/i) ||
                         fullText.match(/(\d+(?:[.,]\d+)?)\s*(?:m2|m²|metros)\b/i);
    if (metrajeMatch) {
      const numM = parseFloat(metrajeMatch[1].replace(',', '.'));
      if (!isNaN(numM) && numM > 0) {
        result.metrajeNum = numM;
      }
    }
  }

  // 9. Extracción de Habitaciones
  if (result.habitacionesNum === null) {
    const habMatch = fullText.match(/(\d+|un[ao]?|dos|tres|cuatro|cinco)\s*(?:habitación|habitaciones|cuartos|dormitorios)/i);
    if (habMatch) {
      const wordMap = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5 };
      result.habitacionesNum = wordMap[habMatch[1].toLowerCase()] || parseInt(habMatch[1], 10);
    }
  }

  // 10. Características Distintivas (Pozo de agua, vista al Ávila, amoblado, etc.)
  const featureKeywords = [
    { key: 'pozo de agua', pattern: /\b(?:pozo|pozo\s*de\s*agua)\b/i },
    { key: 'vista al ávila', pattern: /\b(?:vista\s*(?:al)?\s*[aá]vila)\b/i },
    { key: 'amoblado', pattern: /\b(?:amoblado|completamente\s*amoblado)\b/i },
    { key: 'cocina actualizada', pattern: /\b(?:cocina\s*actualizada|tope\s*de\s*cuarzo)\b/i },
    { key: 'tanque de agua', pattern: /\b(?:tanque|tanque\s*interno)\b/i },
    { key: 'planta eléctrica', pattern: /\b(?:planta|generador)\b/i }
  ];
  for (const fk of featureKeywords) {
    if (fk.pattern.test(fullNorm)) {
      result.distinctiveFeatures.push(fk.key);
    }
  }

  return result;
}

// ============================================================================
// 4. MOTOR DE COINCIDENCIA PONDERADA AL 90% (SCORING ALGORITHM)
// ============================================================================

/**
 * Normaliza metraje y precio de una propiedad de Google Sheets para comparación matemática
 */

/**
 * Extrae la zona/urbanización normalizada de una propiedad de Google Sheets.
 * Evalúa columnas ZONA, UBICACION, URLs registradas (Wasi, Web, ML, Fotos) y descripción.
 */
function extractSheetZone(sheetProp) {
  if (!sheetProp) return '';
  if (sheetProp.ZONA && String(sheetProp.ZONA).trim()) return normalizeKeyword(sheetProp.ZONA);
  if (sheetProp.UBICACION && String(sheetProp.UBICACION).trim()) return normalizeKeyword(sheetProp.UBICACION);

  const caracasZones = [
    'los palos grandes', 'los samanes', 'lomas del sol', 'la candelaria', 'prados del este',
    'la boyera', 'chacao', 'altamira', 'el hatillo', 'la california norte', 'la california sur',
    'la california', 'alta florida', 'la florida', 'las mercedes', 'san bernardino', 'valle arriba',
    'colinas de bello monte', 'bello monte', 'santa fe', 'el encantado', 'la castellana',
    'campo alegre', 'los ruices', 'macaracuay', 'san antonio de los altos', 'maracay'
  ];

  const rowUrls = [
    sheetProp.Wasi, sheetProp.Wasi_URL,
    sheetProp['Pagina Web'], sheetProp['Pagina Web_URL'],
    sheetProp['Mercado Libre'], sheetProp['Mercado Libre_URL'],
    sheetProp.LINK_FOTOS, sheetProp.LINK_FOTOS_URL
  ].filter(Boolean);

  for (const u of rowUrls) {
    const cleanU = String(u).replace(/[-_]/g, ' ').toLowerCase();
    for (const z of caracasZones) {
      if (cleanU.includes(z)) return z;
    }
  }

  const desc = (sheetProp.DESCRIPCION_BREVE || '').toLowerCase();
  for (const z of caracasZones) {
    if (desc.includes(z)) return z;
  }

  return '';
}

function extractSheetNumericAttributes(sheetProp) {
  const desc = sheetProp.DESCRIPCION_BREVE || '';

  // Precio numérico
  let sheetPrice = null;
  if (sheetProp.PRECIO) {
    sheetPrice = parseInt(String(sheetProp.PRECIO).replace(/[^0-9]/g, ''), 10);
  } else {
    const pMatch = desc.match(/(?:Precio|Canon|Inversión)[\s:]*[\$€]?\s*([\d.,]+)/i) || desc.match(/\$\s*([\d.,]+)/);
    if (pMatch) {
      sheetPrice = parseInt(pMatch[1].replace(/[^0-9]/g, ''), 10);
    }
  }

  // Metraje numérico
  let sheetMetraje = null;
  const mMatch = desc.match(/Metraje:\s*(\d+(?:[.,]\d+)?)/i) ||
                 desc.match(/(\d+(?:[.,]\d+)?)\s*(?:m²|m2|metros)/i);
  if (mMatch) {
    sheetMetraje = parseFloat(mMatch[1].replace(',', '.'));
  }

  // Habitaciones
  let sheetRooms = null;
  const rMatch = desc.match(/(\d+|un[ao]?|dos|tres|cuatro|cinco)\s*habitaci[oó]n/i);
  if (rMatch) {
    const wordMap = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5 };
    sheetRooms = wordMap[rMatch[1].toLowerCase()] || parseInt(rMatch[1], 10);
  }

  return { sheetPrice, sheetMetraje, sheetRooms };
}

/**
 * Calcula la similitud ponderada del 90% entre la publicación externa y una propiedad de Sheets.
 *
 * PESOS DOCUMENTADOS (Total: 100 Puntos):
 * - Tipo de Inmueble:         25 pts (Contradicción = RECHAZO TOTAL / Score 0)
 * - Operación Comercial:      25 pts (Contradicción = RECHAZO TOTAL / Score 0)
 * - Zona / Urbanización:      25 pts (Contradicción = RECHAZO TOTAL / Score 0)
 * - Metraje (±5% tolerancia): 15 pts (Diferencia >10% = Contradicción / Score 0)
 * - Habitaciones:              5 pts (Coincidencia = 5 pts; ausente/diferente = 0 pts, sin penalización)
 * - Rasgos Distintivos:        5 pts (Al menos 1 confirmado = 5 pts; 0 si no documentado)
 *
 * PRECIO: EXCLUIDO TOTALMENTE DEL SCORING DE IDENTIDAD.
 * El precio NO suma puntos, NO resta puntos, NO genera penalizaciones ni anula coincidencias.
 * Si el precio externo difiere de Google Sheets, se registra la auditoría informativa EXTERNAL_PRICE_DIFFERS_SHEETS.
 *
 * REGLAS FUNDAMENTALES:
 * 1. Mínimo 90 pts para coincidencia positiva.
 * 2. Un campo ausente en la publicación otorga 0 puntos (no se regalan puntos artificiales).
 * 3. Características genéricas solas no pueden sumar 90 pts (Tipo + Operación + Zona = 75 pts, insuficiente).
 */
function calculateWeightedMatchScore(extAttrs, sheetProp) {
  let score = 0;
  const matchDetails = [];
  const contradictions = [];

  const sheetTipo = normalizeKeyword(sheetProp.TIPO || '');
  const sheetOperacion = normalizeKeyword(sheetProp.OPERACION || '');
  const sheetZona = extractSheetZone(sheetProp);
  const { sheetPrice, sheetMetraje, sheetRooms } = extractSheetNumericAttributes(sheetProp);
  const sheetDesc = (sheetProp.DESCRIPCION_BREVE || '').toLowerCase();

  // 1. TIPO DE INMUEBLE (25 pts)
  if (extAttrs.tipo) {
    const normExtTipo = normalizeKeyword(extAttrs.tipo);
    if (normExtTipo === sheetTipo || (normExtTipo.includes('apartamento') && sheetTipo.includes('apartamento'))) {
      score += 25;
      matchDetails.push(`Tipo coincidente (${sheetTipo}): +25`);
    } else {
      contradictions.push(`Tipo contradictorio: externo="${extAttrs.tipo}" vs sheets="${sheetProp.TIPO}"`);
      return { score: 0, criticalContradiction: true, contradictions, matchDetails };
    }
  }

  // 2. OPERACIÓN COMERCIAL (25 pts)
  if (extAttrs.operacion) {
    const normExtOp = normalizeKeyword(extAttrs.operacion);
    if (normExtOp === sheetOperacion || (normExtOp.includes('alquiler') && sheetOperacion.includes('alquiler'))) {
      score += 25;
      matchDetails.push(`Operación coincidente (${sheetOperacion}): +25`);
    } else {
      contradictions.push(`Operación contradictoria: externo="${extAttrs.operacion}" vs sheets="${sheetProp.OPERACION}"`);
      return { score: 0, criticalContradiction: true, contradictions, matchDetails };
    }
  }

  // 3. ZONA / UBICACIÓN (25 pts)
  if (extAttrs.zona) {
    const normExtZona = normalizeKeyword(extAttrs.zona);
    const inSheetDesc = sheetDesc.includes(normExtZona);
    const inSheetZona = sheetZona && (sheetZona.includes(normExtZona) || normExtZona.includes(sheetZona));

    if (inSheetZona || inSheetDesc) {
      score += 25;
      matchDetails.push(`Zona coincidente (${extAttrs.zona}): +25`);
    } else {
      contradictions.push(`Zona contradictoria: externo="${extAttrs.zona}" vs sheets="${sheetZona || 'no documentada'}" en ${sheetProp.ID_PROPIEDAD}`);
      return { score: 0, criticalContradiction: true, contradictions, matchDetails };
    }
  }

  // 4. METRAJE (15 pts)
  if (extAttrs.metrajeNum) {
    let metrajeMatched = false;
    let diffPct = 999;
    if (sheetMetraje) {
      diffPct = Math.abs(extAttrs.metrajeNum - sheetMetraje) / sheetMetraje;
      if (diffPct <= 0.05) { // Tolerancia 5%
        score += 15;
        matchDetails.push(`Metraje exacto/cercano (${extAttrs.metrajeNum}m² vs ${sheetMetraje}m²): +15`);
        metrajeMatched = true;
      } else if (diffPct <= 0.10) {
        score += 8;
        matchDetails.push(`Metraje aproximado (diff ${Math.round(diffPct*100)}%): +8`);
        metrajeMatched = true;
      }
    }

    if (!metrajeMatched) {
      const extMStr = String(Math.round(extAttrs.metrajeNum));
      const mInDesc = sheetDesc.match(new RegExp(`\\b${extMStr}(?:[.,]\\d+)?\\s*(?:m2|m²|metros)\\b`, 'i'));
      if (mInDesc) {
        score += 15;
        matchDetails.push(`Metraje secundario confirmado en descripción (${extAttrs.metrajeNum}m²): +15`);
        metrajeMatched = true;
      } else if (sheetMetraje && diffPct > 0.10) {
        contradictions.push(`Metraje contradictorio: externo=${extAttrs.metrajeNum}m² vs sheets=${sheetMetraje}m² (diff > 10%)`);
        return { score: 0, criticalContradiction: true, contradictions, matchDetails };
      }
    }
  }

  // 5. HABITACIONES (5 pts)
  if (extAttrs.habitacionesNum && sheetRooms) {
    if (extAttrs.habitacionesNum === sheetRooms) {
      score += 5;
      matchDetails.push(`Habitaciones coincidentes (${sheetRooms}): +5`);
    } else {
      matchDetails.push(`Habitaciones discrepantes (ext: ${extAttrs.habitacionesNum} vs sheets: ${sheetRooms}): 0 pts (sin penalización)`);
    }
  }

  // 6. CARACTERÍSTICAS DISTINTIVAS (5 pts)
  if (extAttrs.distinctiveFeatures && extAttrs.distinctiveFeatures.length > 0) {
    let matchedFeat = 0;
    for (const feat of extAttrs.distinctiveFeatures) {
      if (sheetDesc.includes(feat)) matchedFeat++;
    }
    if (matchedFeat > 0) {
      score += 5;
      matchDetails.push(`Características distintivas confirmadas (${matchedFeat}): +5`);
    }
  }

  // 7. AUDITORÍA DE PRECIO (INFORMATIVA - EXCLUIDA TOTALMENTE DEL SCORING DE IDENTIDAD)
  // El precio NO suma puntos, NO resta puntos, NO genera penalizaciones ni anula coincidencias.
  let priceAudit = null;
  if (extAttrs.precioNum && sheetPrice) {
    const diffPct = Math.abs(extAttrs.precioNum - sheetPrice) / sheetPrice;
    if (diffPct > 0.001) { // Diferencia comercial > 0.1%
      const diffPctRounded = Math.round(diffPct * 1000) / 10;
      priceAudit = {
        code: 'EXTERNAL_PRICE_DIFFERS_SHEETS',
        externalPrice: extAttrs.precioNum,
        sheetsPrice: sheetPrice,
        diffPercentage: diffPctRounded
      };
      matchDetails.push(`Auditoría de precio: EXTERNAL_PRICE_DIFFERS_SHEETS (Externo: $${extAttrs.precioNum} vs Sheets: $${sheetPrice}, diff: ${diffPctRounded}%)`);
    } else {
      priceAudit = {
        code: 'EXTERNAL_PRICE_MATCHES_SHEETS',
        externalPrice: extAttrs.precioNum,
        sheetsPrice: sheetPrice,
        diffPercentage: 0
      };
      matchDetails.push(`Auditoría de precio: COINCIDE (Externo: $${extAttrs.precioNum} vs Sheets: $${sheetPrice})`);
    }
  }

  return {
    score,
    criticalContradiction: contradictions.length > 0,
    contradictions,
    matchDetails,
    priceAudit
  };
}

/**
 * Compara los atributos extraídos contra todas las propiedades registradas en Google Sheets.
 * Exige >= 90% de puntaje, evidencia suficiente y margen de unicidad >= 15 pts.
 */
function matchPublicationAgainstProperties(extAttrs, properties = [], urlStr = '') {
  if (!extAttrs || !Array.isArray(properties) || properties.length === 0) {
    return { matched: false, candidate: null, score: 0, reason: 'NO_ATTRIBUTES_OR_PROPERTIES' };
  }

  const cleanIncomingUrl = urlStr ? cleanUrlForMatching(urlStr) : '';
  const parsedIncoming = urlStr ? parseAndNormalizeUrl(urlStr) : null;
  const aliases = typeof getPropertyUrlAliases === 'function' ? getPropertyUrlAliases() : {};

  // 0. Comprobación directa de Alias Registrado
  if (cleanIncomingUrl && aliases[cleanIncomingUrl]) {
    const aliasRef = aliases[cleanIncomingUrl].toUpperCase();
    const candidate = properties.find(p => (p.ID_PROPIEDAD || '').toUpperCase() === aliasRef);
    if (candidate) {
      return {
        matched: true,
        candidate,
        score: 100,
        matchType: 'PROPERTY_MATCH_EXACT',
        details: [`Alias directo registrado (${aliasRef})`]
      };
    }
  }

  if (urlStr && aliases[urlStr]) {
    const aliasRef = aliases[urlStr].toUpperCase();
    const candidate = properties.find(p => (p.ID_PROPIEDAD || '').toUpperCase() === aliasRef);
    if (candidate) {
      return {
        matched: true,
        candidate,
        score: 100,
        matchType: 'PROPERTY_MATCH_EXACT',
        details: [`Alias directo registrado (${aliasRef})`]
      };
    }
  }

  if (extAttrs.publicationId && aliases[extAttrs.publicationId]) {
    const aliasRef = aliases[extAttrs.publicationId].toUpperCase();
    const candidate = properties.find(p => (p.ID_PROPIEDAD || '').toUpperCase() === aliasRef);
    if (candidate) {
      return {
        matched: true,
        candidate,
        score: 100,
        matchType: 'PROPERTY_MATCH_EXACT',
        details: [`Alias directo registrado (${aliasRef})`]
      };
    }
  }
  if (!extAttrs || !Array.isArray(properties) || properties.length === 0) {
    return { matched: false, candidate: null, score: 0, reason: 'NO_ATTRIBUTES_OR_PROPERTIES' };
  }

  const scoredCandidates = [];

  for (const prop of properties) {
    // 1. Coincidencia por URL registrada en cualquier columna (Pagina Web, Wasi, ML, Rexup)
    if (cleanIncomingUrl) {
      const rowUrls = [
        prop.Wasi, prop.Wasi_URL,
        prop.Mercado_Libre, prop['Mercado Libre'], prop['Mercado Libre_URL'],
        prop.Pagina_Web, prop['Pagina Web'], prop['Pagina Web_URL'],
        prop.LINK_FOTOS, prop.LINK_FOTOS_URL
      ].filter(Boolean);

      let isLiteralMatch = false;
      for (const rUrl of rowUrls) {
        if (cleanUrlForMatching(rUrl) === cleanIncomingUrl) {
          isLiteralMatch = true;
          break;
        }
      }

      if (isLiteralMatch) {
        return {
          matched: true,
          candidate: prop,
          score: 100,
          matchType: 'PROPERTY_MATCH_EXACT',
          details: [`Enlace literal registrado en Google Sheets (${urlStr})`]
        };
      }
    }

    // 2. Comprobar contradicción flagrante de slug en URL enviada contra la propiedad
    if (parsedIncoming && parsedIncoming.slug) {
      const slugContra = checkSlugContradiction(parsedIncoming.slug, prop);
      if (slugContra.hasContradiction) {
        // Conflicto crítico evidente en la URL recibida: descartar este candidato
        continue;
      }
    }

    // 3. Si la publicación contiene un código exacto de Wasi, ML o Rexup registrado:
    if (extAttrs.publicationId) {
      const codeClean = String(extAttrs.publicationId).replace(/[^0-9]/g, '');
      const propWasi = String(prop.CODIGO_WASI || '').replace(/[^0-9]/g, '');
      const propMl = String(prop['Mercado Libre'] || prop['Mercado Libre_URL'] || '').replace(/[^0-9]/g, '');
      const propRexup = String(prop.LINK_FOTOS || prop.LINK_FOTOS_URL || '').replace(/[^0-9]/g, '');

      if ((propWasi && propWasi === codeClean) || (propMl && propMl.includes(codeClean)) || (propRexup && propRexup.includes(codeClean))) {
        // Mecanismo A: Identidad Exacta Comprobada
        // Verificar que no existan contradicciones críticas en tipo u operación
        const normPropTipo = (prop.TIPO || '').toLowerCase();
        const normPropOp = (prop.OPERACION || '').toLowerCase();
        const normExtTipo = (extAttrs.tipo || '').toLowerCase();
        const normExtOp = (extAttrs.operacion || '').toLowerCase();

        const tipoConflict = normExtTipo && normPropTipo &&
          !normPropTipo.includes(normExtTipo) && !normExtTipo.includes(normPropTipo);
        const opConflict = normExtOp && normPropOp &&
          !normPropOp.includes(normExtOp) && !normExtOp.includes(normPropOp);

        if (!tipoConflict && !opConflict) {
          return {
            matched: true,
            candidate: prop,
            score: 100,
            matchType: 'PROPERTY_MATCH_EXACT',
            details: [`Identificador exacto comprobado (${extAttrs.publicationId})`]
          };
        }
      }
    }

    // 4. Mecanismo B: Evaluación por Atributos Ponderados
    const evalResult = calculateWeightedMatchScore(extAttrs, prop);
    if (!evalResult.criticalContradiction && evalResult.score > 0) {
      scoredCandidates.push({
        property: prop,
        score: evalResult.score,
        details: evalResult.matchDetails,
        contradictions: evalResult.contradictions,
        priceAudit: evalResult.priceAudit
      });
    }
  }

  // Ordenar candidatos por puntaje descendente
  scoredCandidates.sort((a, b) => b.score - a.score);

  if (scoredCandidates.length === 0) {
    return { matched: false, candidate: null, score: 0, reason: 'NO_CANDIDATES_MATCHED' };
  }

  const top1 = scoredCandidates[0];
  const top2 = scoredCandidates[1] || null;

  // Criterio de aceptación estricto: >= 90% de coincidencia
  if (top1.score < 90) {
    return {
      matched: false,
      candidate: null,
      score: top1.score,
      reason: `SCORE_BELOW_THRESHOLD_90 (${top1.score}%)`,
      topCandidateId: top1.property.ID_PROPIEDAD
    };
  }

  // Criterio de unicidad: margen mínimo de 15 puntos sobre el segundo candidato
  if (top2 && (top1.score - top2.score < 15)) {
    return {
      matched: false,
      isAmbiguous: true,
      candidate: null,
      score: top1.score,
      reason: `AMBIGUOUS_MATCH_TWO_SIMILAR_PROPERTIES (${top1.property.ID_PROPIEDAD}:${top1.score}% vs ${top2.property.ID_PROPIEDAD}:${top2.score}%)`
    };
  }

  // Coincidencia exitosa al 90%+
  return {
    matched: true,
    candidate: top1.property,
    score: top1.score,
    matchType: 'WEIGHTED_ATTRIBUTE_VERIFIED_90',
    details: top1.details,
    priceAudit: top1.priceAudit || null
  };
}

/**
 * Resuelve una propiedad inmobiliaria a partir de una URL externa consultando su contenido
 * y aplicando la regla del 90% de coincidencia ponderada.
 */
async function resolvePropertyFromUrlOrContent(urlString, properties = [], options = {}) {
  if (!urlString || typeof urlString !== 'string' || !urlString.startsWith('http')) {
    return { resolved: false, reason: 'INVALID_URL' };
  }

  // 1. Fetch seguro del contenido público
  const fetchRes = await fetchPublicPublication(urlString, options);

  // 2. Si la página fue accesible:
  if (fetchRes.accessible && fetchRes.html) {
    const attrs = extractPublicationAttributes(fetchRes.html, urlString);
    const matchResult = matchPublicationAgainstProperties(attrs, properties, urlString);

    if (matchResult.matched && matchResult.candidate) {
      return {
        resolved: true,
        candidate: matchResult.candidate,
        score: matchResult.score,
        matchType: matchResult.matchType,
        details: matchResult.details,
        priceAudit: matchResult.priceAudit || null,
        accessible: true,
        extractedAttrs: attrs
      };
    }

    return {
      resolved: false,
      isAmbiguous: matchResult.isAmbiguous || false,
      reason: matchResult.reason,
      score: matchResult.score || 0,
      accessible: true,
      extractedAttrs: attrs
    };
  }

  // 3. Si la página no fue accesible (inaccesible, timeout, 403, 404, blocked):
  return {
    resolved: false,
    accessible: false,
    reason: fetchRes.reason || 'EXTERNAL_PAGE_INACCESSIBLE',
    statusCode: fetchRes.statusCode
  };
}

// ============================================================================
// EXPORTACIÓN DEL MÓDULO
// ============================================================================
module.exports = {
  isSafeUrl,
  fetchPublicPublication,
  extractPublicationAttributes,
  calculateWeightedMatchScore,
  matchPublicationAgainstProperties,
  resolvePropertyFromUrlOrContent,
  isPrivateOrReservedIp
};
