/**
 * 🏢 FICHAS TÉCNICAS MANAGER (WORD / DOCX GROUNDED KNOWLEDGE ENGINE)
 * =================================================================
 * Carga, indexa y responde consultas sobre inmuebles basadas EXCLUSIVAMENTE
 * en las Fichas Técnicas oficiales en formato Word (.docx).
 * 
 * Regla de Oro del Negocio:
 * Si la información está explícita en el documento -> Responde con precisión quirúrgica.
 * Si NO está en el documento (o dice "No especificado en la fuente") -> SILENCIO ABSOLUTO (100% callada).
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const axios = require('axios');

const FICHAS_DIR = path.join(__dirname, 'fichas');

let loadedFichas = [];
let lastFichasLoadTime = 0;

/**
 * Normaliza texto para comparaciones insensibles a mayúsculas, tildes y caracteres especiales.
 */
function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Extrae texto plano limpio de un archivo .docx usando adm-zip
 */
function extractDocxText(filePath) {
  try {
    const zip = new AdmZip(filePath);
    const xmlEntry = zip.getEntry('word/document.xml');
    if (!xmlEntry) return '';
    const xmlText = xmlEntry.getData().toString('utf8');

    const paragraphs = xmlText.split(/<\/w:p>/);
    const lines = [];
    for (const p of paragraphs) {
      const textMatches = p.match(/<w:t[^>]*>(.*?)<\/w:t>/g) || [];
      const text = textMatches.map(m => m.replace(/<[^>]+>/g, '')).join('');
      if (text.trim()) lines.push(text.trim());
    }
    return lines.join('\n');
  } catch (err) {
    console.error(`[Fichas Manager] Error extrayendo .docx de ${filePath}:`, err.message);
    return '';
  }
}

/**
 * Carga e indexa todas las fichas técnicas Word en la carpeta 'fichas/'
 */
function loadFichasTecnicas(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && loadedFichas.length > 0 && now - lastFichasLoadTime < 60000) {
    return loadedFichas;
  }

  if (!fs.existsSync(FICHAS_DIR)) {
    fs.mkdirSync(FICHAS_DIR, { recursive: true });
  }

  const files = fs.readdirSync(FICHAS_DIR);
  const fichas = [];
  const processedZones = new Set();

  // Filtrar archivos Word .docx válidos (o .txt de respaldo si no hay .docx)
  for (const file of files) {
    if (!file.toLowerCase().endsWith('.docx') && !file.toLowerCase().endsWith('.txt')) continue;
    // Si ya procesamos el .docx para esta propiedad, saltar el .txt de respaldo
    const baseName = path.parse(file).name;
    const fullPath = path.join(FICHAS_DIR, file);

    let text = '';
    if (file.toLowerCase().endsWith('.docx')) {
      text = extractDocxText(fullPath);
    } else if (file.toLowerCase().endsWith('.txt')) {
      text = fs.readFileSync(fullPath, 'utf8');
    }

    if (!text.trim()) continue;

    const normFile = normalizeText(file);
    const normText = normalizeText(text);

    let id = baseName;
    let zona = '';
    let operacion = 'Venta';
    let aliases = [];
    let refCode = '';
    let codigoWasi = '';
    let wasiUrl = '';
    let photoUrl = '';

    if (normFile.includes('lomas del sol') || normText.includes('lomas del sol')) {
      id = 'FICHA-LOMAS-DEL-SOL';
      zona = 'Lomas del Sol';
      operacion = 'Venta';
      refCode = 'REF-062';
      codigoWasi = '10544010';
      wasiUrl = 'https://info.wasi.co/apartamento-venta-lomas-del-sol-caracas/10544010';
      photoUrl = '-';
      aliases = [
        'lomas del sol', 'loma del sol', 'lomas', 'cerro verde', 'parque cerro verde',
        'rio market', '83 m2', '83m2', '83 metros', '170.000', '170000', '170 mil',
        '170k', '10544010', 'ref-062', 'ref 062', 'ref062'
      ];
    } else if (normFile.includes('candelaria') || normText.includes('candelaria') || normText.includes('fuerzas armadas') || normText.includes('torre 200')) {
      id = 'FICHA-LA-CANDELARIA';
      zona = 'La Candelaria';
      operacion = 'Alquiler';
      refCode = 'REF-061';
      codigoWasi = '10539723';
      wasiUrl = 'https://info.wasi.co/apartamento-venta-la-candelaria-caracas/10539723';
      photoUrl = 'https://www.rexup.net/AAAAAAA/ver_inmueble_c.php?cod_inmueble=3431321309';
      aliases = [
        'candelaria', 'la candelaria', 'fuerzas armadas', 'av fuerzas armadas',
        'torre 200', 'socorro', 'san ramon', 'bus caracas', '55 m2', '55m2',
        '55 metros', '500$', '500 $', '500 dolares', '500', '10539723', 'ref-061', 'ref 061', 'ref061'
      ];
    }

    if (processedZones.has(id)) continue;
    processedZones.add(id);

    fichas.push({
      id,
      fileName: file,
      zona,
      operacion,
      aliases,
      refCode,
      codigoWasi,
      wasiUrl,
      photoUrl,
      rawText: text,
      normalizedText: normText
    });
  }

  loadedFichas = fichas;
  lastFichasLoadTime = now;
  console.log(`[Fichas Manager] Cargadas ${fichas.length} fichas técnicas oficiales desde Word: ${fichas.map(f => f.zona || f.id).join(', ')}`);
  return fichas;
}

/**
 * Busca si un mensaje o el contexto del lead corresponde a alguna Ficha Técnica de Word
 */
function findFichaTecnica(query, activeContext = null) {
  const fichas = loadFichasTecnicas();
  if (fichas.length === 0) return null;

  const qNorm = normalizeText(query);

  // 1. Coincidencia directa por alias en el mensaje actual
  for (const ficha of fichas) {
    for (const alias of ficha.aliases) {
      if (qNorm.includes(alias)) {
        return ficha;
      }
    }
  }

  // 2. Si el mensaje actual menciona otro código REF explícito (distinto de 061 o 062), no forzar ficha previa
  if (/REF-(?!061|062)\d{3}/i.test(query)) {
    return null;
  }

  // 3. Si no viene en el texto actual, verificar si el contexto previo del lead ya apuntaba a esta ficha
  if (activeContext) {
    const ctxId = (activeContext.ID_PROPIEDAD || activeContext.propertyRef || '').toUpperCase();
    const ctxWasi = String(activeContext.CODIGO_WASI || activeContext.wasiCode || '');
    const ctxZona = normalizeText(activeContext.ZONA || '');
    const ctxNorm = normalizeText(typeof activeContext === 'string' ? activeContext : JSON.stringify(activeContext));

    for (const ficha of fichas) {
      if (
        ctxId === ficha.id.toUpperCase() ||
        (ficha.refCode && ctxId === ficha.refCode.toUpperCase()) ||
        (ficha.codigoWasi && ctxWasi === ficha.codigoWasi) ||
        (ficha.zona && ctxZona === normalizeText(ficha.zona)) ||
        ctxNorm.includes(normalizeText(ficha.id))
      ) {
        return ficha;
      }
    }
  }

  return null;
}

/**
 * Determina si la pregunta del usuario es una consulta puntual sobre un atributo específico
 * (gas, pozo, medidas, mascotas, precio, baños, estacionamiento, etc.)
 */
function isSpecificAttributeQuestion(query) {
  if (!query) return false;
  const q = normalizeText(query);
  return /(?:cuant[oa]s?\s*(?:mide|habitac|cuarto|bano|puesto|estacion|metro|meses|cuesta|vale|paga)|(?:tiene|cuenta\s*con|hay)\s*(?:gas|pozo|tanque|piscina|balcon|terraza|maletero|aire|internet|wifi|estacion|puesto|lavander|ascensor|consej)|(?:aceptan?|admiten?|permiten?)\s*(?:mascota|perro|gato|nino|binance|cripto|zelle|efectivo|credito|financ)|(?:qu[eé]\s*(?:piso|cocina|internet|bano|tipo|acabado|zona|banco|metodo|forma))|color\s*de|antiguedad)/i.test(q);
}

/**
 * Determina si la pregunta del usuario es una consulta de disponibilidad o interés general
 */
function isAvailabilityQuestion(query) {
  if (!query) return false;
  const q = normalizeText(query);
  return /(?:disponib|est[aá]\s*(?:disponible|libre)|sigue\s*(?:disponible|libre)|a[uú]n\s*(?:disponible|libre)|tienes\s*(?:este|el|un)|sigue\s*en\s*(?:alquiler|venta))/i.test(q);
}

/**
 * Capa de Inteligencia y Blindaje Absoluto con Claude Sonnet 4.5
 * 
 * Si la respuesta ESTÁ en el documento -> Devuelve la respuesta factual exacta.
 * Si NO está en el documento o dice "No especificado en la fuente" -> Devuelve null (SILENCIO ABSOLUTO).
 */
async function queryFichaTecnicaWithClaude(userQuestion, ficha, clientName = 'Cliente') {
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn('[Fichas QA] No OPENROUTER_API_KEY found.');
    return { text: null, skip: true };
  }

  const model = process.env.CLAUDE_MODEL || 'anthropic/claude-sonnet-4.5';

  const systemPrompt = `Eres el asistente de información técnica oficial de la inmobiliaria Tu Techo Ideal.
Tu única fuente de verdad y conocimiento es el siguiente DOCUMENTO OFICIAL correspondiente al inmueble:

==================== INICIO DOCUMENTO OFICIAL ====================
INMUEBLE: Apartamento en ${ficha.zona}
ARCHIVO FUENTE: ${ficha.fileName}

[CONTENIDO OFICIAL DE LA FICHA]:
${ficha.rawText}
===================== FIN DOCUMENTO OFICIAL =====================

INFORMACIÓN DE CONTEXTO:
- Este documento oficial corresponde al inmueble que el usuario identifica como "${ficha.zona}" (tomado del título/archivo de la ficha).

REGLAS DE ORO OBLIGATORIAS (CERO ALUCINACIÓN - SILENCIO ABSOLUTO):
1. CONSULTA GENERAL / ENLACE / DISPONIBILIDAD:
   Si el cliente consulta de forma general por el inmueble, envía un enlace del inmueble, o pregunta si está disponible:
   Debes confirmar "Sí, disponible." y presentar un resumen completo, profesional y directo con los datos del documento (ubicación exacta, metraje, ambientes, equipamiento, canon/precio, condiciones de negociación y restricciones).

2. PREGUNTAS CON RESPUESTA NEGATIVA O RESTRICCIÓN EN EL DOCUMENTO:
   Si el cliente pregunta por un servicio o característica que el documento aclara explícitamente que NO posee o está restringido (ej: "No posee gas directo", "No posee estacionamiento propio", "No se admiten niños ni mascotas"):
   Debes responder con precisión la respuesta negativa y la alternativa oficial explicada en el documento (ej: "No posee gas directo, cuenta con cocina eléctrica." / "No posee estacionamiento propio; dispone de estacionamiento privado de alquiler a media cuadra." / "No se admiten niños ni mascotas.").

3. SILENCIO ABSOLUTO ([SILENCIO]):
   Única y exclusivamente si el dato NO aparece en absoluto en el documento (o dice explícitamente "No especificado en la fuente", o preguntan por cosas inexistentes como color de paredes, piscina o gimnasio si no se mencionan):
   DEBES responder ÚNICA Y EXCLUSIVAMENTE con la palabra exacta:
   [SILENCIO]
   Está terminantemente prohibido inventar o deducir información que no esté en el documento.

4. TONO: Profesional inmobiliario, educado y directo al grano, sin rodeos innecesarios.`;

  // Si el usuario envió un enlace o consulta general sin atributo específico, preparamos la pregunta para Claude
  let promptUserQuery = (userQuestion || '').trim();
  const hasUrl = /https?:\/\/[^\s]+/i.test(promptUserQuery);
  const isShortOrLink = hasUrl && promptUserQuery.split(/\s+/).length <= 4;
  const isAttribute = isSpecificAttributeQuestion(promptUserQuery);

  if ((isShortOrLink || isAvailabilityQuestion(promptUserQuery)) && !isAttribute) {
    promptUserQuery = `El cliente está consultando por este inmueble (mensaje: "${userQuestion}"). Confirma la disponibilidad ("Sí, disponible.") y presenta un resumen completo, profesional y directo con los datos del documento (ubicación exacta, metraje, ambientes, equipamiento, canon/precio, negociación y restricciones).`;
  }

  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: promptUserQuery }
        ],
        temperature: 0.0,
        max_tokens: 400
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://tutechoideal.com',
          'X-Title': 'Tu Techo Ideal - Word Fichas Engine'
        },
        timeout: 15000
      }
    );

    const reply = response.data.choices?.[0]?.message?.content?.trim();
    console.log(`[Fichas QA] Claude evaluó para ${ficha.zona}: "${reply}"`);

    // Validar si Claude emitió la señal de silencio o falta de información
    const lowerReply = (reply || '').toLowerCase();
    const isSilence = !reply ||
      reply.includes('[SILENCIO]') ||
      lowerReply === 'silencio' ||
      lowerReply.includes('no especificado en la fuente') ||
      lowerReply.includes('no dispongo de esa') ||
      lowerReply.includes('no se especifica') ||
      lowerReply.includes('no se encuentra') ||
      lowerReply.includes('no se menciona') ||
      lowerReply.includes('no aparece') ||
      lowerReply.includes('no contiene') ||
      lowerReply.includes('no indica') ||
      lowerReply.includes('no se detalla') ||
      lowerReply.includes('no hay informacion') ||
      lowerReply.includes('no hay información') ||
      lowerReply.includes('no se aclara') ||
      lowerReply.includes('no tengo esa') ||
      lowerReply.includes('no poseo esa');

    if (isSilence) {
      console.log(`[Fichas QA] Dato no presente en la Ficha Técnica de ${ficha.zona}. Aplicando silencio absoluto (100% callada).`);
      return { text: null, action: 'FICHA_SILENCIO', skip: true };
    }

    // Normalizar formato de negrita de Markdown para WhatsApp (**texto** -> *texto*)
    const formattedReply = reply.replace(/\*\*(.*?)\*\*/g, '*$1*');

    return {
      text: formattedReply,
      action: 'FICHA_TECNICA_QA',
      matchedFicha: ficha,
      exactText: true,
      skip: false
    };
  } catch (err) {
    console.error('[Fichas QA] Error al consultar Claude:', err.message);
    return { text: null, skip: true };
  }
}

/**
 * Controlador Principal de Fichas Técnicas
 */
async function handleFichaTecnicaQuery(userMessage, activeContext = null, clientName = 'Cliente') {
  const ficha = findFichaTecnica(userMessage, activeContext);
  if (!ficha) {
    return null; // No corresponde a ninguna ficha Word, continuar con flujo habitual
  }

  console.log(`[Fichas Manager] Consulta emparejada con Ficha Técnica: ${ficha.zona} (${ficha.id})`);

  // Ejecutar consulta técnica blindada con Claude Sonnet 4.5
  return await queryFichaTecnicaWithClaude(userMessage, ficha, clientName);
}

module.exports = {
  loadFichasTecnicas,
  findFichaTecnica,
  handleFichaTecnicaQuery,
  extractDocxText
};
