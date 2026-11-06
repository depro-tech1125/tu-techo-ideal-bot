const axios = require('axios');

/**
 * Recupera la propiedad activa de una conversación consultando Kommo CRM.
 * Se utiliza como respaldo de resiliencia cuando la memoria RAM y el disco efímero
 * se han reiniciado (ej: redespliegue de Render, caída del contenedor).
 */
async function recoverActivePropertyFromKommo({ leadId, talkId, contactId, properties = [] }) {
  const token = process.env.KOMMO_TOKEN;
  const subdomain = process.env.KOMMO_SUBDOMAIN;
  if (!token || !subdomain || !leadId || !Array.isArray(properties) || properties.length === 0) {
    return null;
  }

  const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  const headers = { Authorization: authHeader };

  // 1. Prioridad: Etiquetas (Tags) en el Lead en Kommo (ej: "REF-035")
  try {
    const leadRes = await axios.get(`https://${subdomain}.kommo.com/api/v4/leads/${leadId}`, {
      headers,
      timeout: 4000
    });
    const tags = leadRes.data?._embedded?.tags || [];
    for (const tag of tags) {
      const match = (tag.name || '').match(/REF-\d+/i);
      if (match) {
        const propId = match[0].toUpperCase();
        const found = properties.find(p => (p.ID_PROPIEDAD || '').toUpperCase() === propId);
        if (found) {
          return found;
        }
      }
    }
  } catch (e) {
    // Si falla la consulta de tags, continuar con eventos
  }

  // 2. Historial de eventos recientes en Kommo para el Lead
  try {
    const evRes = await axios.get(`https://${subdomain}.kommo.com/api/v4/events?filter[entity]=lead&filter[entity_id]=${leadId}&limit=15`, {
      headers,
      timeout: 4000
    });
    const events = evRes.data?._embedded?.events || [];
    for (const ev of events) {
      const text = ev.value_after?.[0]?.custom_field_value?.text || '';
      if (!text) continue;

      // Buscar cod_inmueble de Rexup
      const rexMatch = text.match(/cod_inmueble=(\d+)/i);
      if (rexMatch) {
        const cod = rexMatch[1];
        const found = properties.find(p => (p.LINK_FOTOS || p.LINK_FOTOS_URL || '').includes(cod));
        if (found) return found;
      }

      // Buscar código Wasi
      const wasiMatch = text.match(/\/(\d{5,10})\b/);
      if (wasiMatch) {
        const cod = wasiMatch[1];
        const found = properties.find(p => (p.CODIGO_WASI || p.Wasi || '').includes(cod));
        if (found) return found;
      }

      // Buscar mención explícita de REF-XXX
      const refMatch = text.match(/\b(REF-\d+)\b/i);
      if (refMatch) {
        const propId = refMatch[1].toUpperCase();
        const found = properties.find(p => (p.ID_PROPIEDAD || '').toUpperCase() === propId);
        if (found) return found;
      }
    }
  } catch (e) {
    // Continuar si falla
  }

  // 3. Respaldo para Leads No Clasificados (Unsorted): Historial de eventos en el Contacto
  if (contactId) {
    try {
      const cEvRes = await axios.get(`https://${subdomain}.kommo.com/api/v4/events?filter[entity]=contact&filter[entity_id]=${contactId}&limit=15`, {
        headers,
        timeout: 4000
      });
      const cEvents = cEvRes.data?._embedded?.events || [];
      for (const ev of cEvents) {
        const text = ev.value_after?.[0]?.custom_field_value?.text || ev.value_after?.[0]?.message?.text || '';
        if (!text) continue;

        const rexMatch = text.match(/cod_inmueble=(\d+)/i);
        if (rexMatch) {
          const cod = rexMatch[1];
          const found = properties.find(p => (p.LINK_FOTOS || p.LINK_FOTOS_URL || '').includes(cod));
          if (found) return found;
        }

        const wasiMatch = text.match(/\/(\d{5,10})\b/);
        if (wasiMatch) {
          const cod = wasiMatch[1];
          const found = properties.find(p => (p.CODIGO_WASI || p.Wasi || '').includes(cod));
          if (found) return found;
        }

        const refMatch = text.match(/\b(REF-\d+)\b/i);
        if (refMatch) {
          const propId = refMatch[1].toUpperCase();
          const found = properties.find(p => (p.ID_PROPIEDAD || '').toUpperCase() === propId);
          if (found) return found;
        }
      }
    } catch (e) {}
  }

  return null;
}

/**
 * Etiqueta un Lead en Kommo CRM con el identificador de la propiedad activa.
 * Proporciona persistencia permanente fuera del contenedor efímero de Render.
 */
async function tagLeadWithProperty(leadId, propertyId) {
  const token = process.env.KOMMO_TOKEN;
  const subdomain = process.env.KOMMO_SUBDOMAIN;
  if (!token || !subdomain || !leadId || !propertyId) return false;

  try {
    const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
    await axios.patch(`https://${subdomain}.kommo.com/api/v4/leads/${leadId}`, {
      _embedded: {
        tags: [{ name: propertyId }]
      }
    }, {
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      timeout: 5000
    });
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  recoverActivePropertyFromKommo,
  tagLeadWithProperty
};
