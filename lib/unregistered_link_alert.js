/**
 * GESTOR DE ALERTAS INTERNAS PARA ROBERT (ENLACES NO REGISTRADOS)
 * Tu Techo Ideal V5.1 — Depro Tech Solutions
 *
 * Genera alertas internas cuando se reciben enlaces de portales externos:
 * - Escenario A: El enlace no está registrado en Google Sheets pero coincide con un inmueble existente.
 * - Escenario B: El enlace no está registrado y no coincide con ninguna propiedad del inventario.
 *
 * Reglas estrictas:
 * 1. Prohibido enviar estas alertas al cliente (solo uso interno en Kommo / logs / WhatsApp Robert).
 * 2. Deduplicación determinística: no generar alertas repetidas para el mismo lead y URL.
 * 3. Indicar el nombre sugerido de la columna para que Robert la agregue en Google Sheets.
 */

class UnregisteredLinkAlertManager {
  constructor() {
    this.sentAlertKeys = new Set();
  }

  /**
   * Detecta el nombre legible del portal a partir de una URL o dominio.
   */
  detectPortalName(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') return 'Portal Inmobiliario';
    try {
      const parsed = new URL(urlStr.trim());
      const host = parsed.hostname.toLowerCase().replace(/^www\./, '');

      if (host.includes('mlscaracas') || host.includes('mls-caracas')) return 'MLS Caracas';
      if (host.includes('mercadolibre') || host.includes('mercadolibre.com.ve')) return 'Mercado Libre';
      if (host.includes('wasi.co') || host.includes('wasi')) return 'Wasi';
      if (host.includes('rexup.net') || host.includes('rexup')) return 'Rexup';
      if (host.includes('conlallave')) return 'Conlallave';
      if (host.includes('inmueblescaracas')) return 'Inmuebles Caracas';
      if (host.includes('tutechoideal')) return 'Pagina Web';

      // Portal desconocido: capitalizar nombre del host
      const mainPart = host.split('.')[0] || 'Portal Nuevo';
      return mainPart.charAt(0).toUpperCase() + mainPart.slice(1);
    } catch (e) {
      return 'Portal Inmobiliario';
    }
  }

  /**
   * Genera el objeto de alerta estructurado con deduplicación.
   */
  generateAlert({
    scenario, // 'MATCHED_UNREGISTERED' o 'UNMATCHED_LINK'
    portalName,
    url,
    publicationCode,
    leadId,
    talkId,
    propertyId,
    suggestedColumnName,
    action
  }) {
    if (!url) return null;

    const cleanUrl = url.trim();
    const cleanPortal = portalName || this.detectPortalName(cleanUrl);
    const cleanCol = suggestedColumnName || cleanPortal;
    const dedupeKey = `${leadId || 'lead_none'}_${propertyId || 'noprop'}_${cleanUrl.toLowerCase()}`;

    if (this.sentAlertKeys.has(dedupeKey)) {
      return {
        isDuplicate: true,
        dedupeKey,
        alertText: null,
        data: null
      };
    }

    this.sentAlertKeys.add(dedupeKey);

    let alertText = '';
    if (scenario === 'MATCHED_UNREGISTERED' || propertyId) {
      alertText =
        `Robert: recibimos un enlace de un portal inmobiliario que no está registrado en Google Sheets. ` +
        `El inmueble coincide con una propiedad existente (${propertyId}).\n\n` +
        `• Portal detectado: ${cleanPortal}\n` +
        `• URL recibida: ${cleanUrl}\n` +
        `• Código de publicación: ${publicationCode || 'N/A'}\n` +
        `• ID del lead: ${leadId || 'N/A'}\n` +
        `• ID de conversación (Talk ID): ${talkId || 'N/A'}\n` +
        `• Inmueble asociado: ${propertyId}\n` +
        `• Columna que debería incorporar Robert: "${cleanCol}"\n\n` +
        `Acción solicitada: ${action || `Agrega una columna con el nombre del portal ("${cleanCol}") y registra allí el enlace correspondiente.`}`;
    } else {
      alertText =
        `Robert: recibimos un enlace de un portal inmobiliario que no está registrado en Google Sheets ` +
        `y no coincide con ninguna propiedad del inventario.\n\n` +
        `• Portal detectado: ${cleanPortal}\n` +
        `• URL recibida: ${cleanUrl}\n` +
        `• Código de publicación: ${publicationCode || 'N/A'}\n` +
        `• ID del lead: ${leadId || 'N/A'}\n` +
        `• ID de conversación (Talk ID): ${talkId || 'N/A'}\n\n` +
        `Acción solicitada: ${action || 'Verificar manualmente si este inmueble debe ser incorporado al inventario oficial en Google Sheets. No se confirmó disponibilidad al cliente.'}`;
    }

    return {
      isDuplicate: false,
      dedupeKey,
      alertText,
      data: {
        scenario: scenario || (propertyId ? 'MATCHED_UNREGISTERED' : 'UNMATCHED_LINK'),
        portalName: cleanPortal,
        url: cleanUrl,
        publicationCode: publicationCode || null,
        leadId: leadId || null,
        talkId: talkId || null,
        propertyId: propertyId || null,
        suggestedColumnName: cleanCol,
        action: action || null
      }
    };
  }

  /**
   * Limpia el registro de deduplicación (útil para pruebas unitarias).
   */
  clear() {
    this.sentAlertKeys.clear();
  }
}

// Instancia singleton para el runtime
const defaultAlertManager = new UnregisteredLinkAlertManager();

module.exports = {
  UnregisteredLinkAlertManager,
  defaultAlertManager
};
