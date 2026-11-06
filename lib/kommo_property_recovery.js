const axios = require('axios');

/**
 * Recupera el historial y la propiedad activa de una conversación consultando Kommo CRM.
 * Se utiliza como respaldo de resiliencia cuando la memoria RAM y el disco efímero
 * se han reiniciado (ej: redespliegue de Render, caída del contenedor).
 *
 * Prioridades:
 * 1. Eventos cronológicos del Lead (reconstruye el historial ordenado de inmuebles consultados).
 * 2. Notas históricas del Lead (TTI_PROPERTY_HISTORY).
 * 3. Etiquetas (Tags) vigentes en el Lead (sin descartar etiquetas previas).
 * 4. Eventos en el Contacto (para casos de Leads no clasificados / Unsorted).
 */
async function recoverActivePropertyFromKommo({ leadId, talkId, contactId, properties = [] }) {
  const token = process.env.KOMMO_TOKEN;
  const subdomain = process.env.KOMMO_SUBDOMAIN;
  if (!token || !subdomain || !leadId || !Array.isArray(properties) || properties.length === 0) {
    return null;
  }

  const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  const headers = { Authorization: authHeader };
  const foundProperties = [];
  const seenIds = new Set();

  function addPropertyMatch(prop) {
    if (prop && prop.ID_PROPIEDAD && !seenIds.has(prop.ID_PROPIEDAD.toUpperCase())) {
      seenIds.add(prop.ID_PROPIEDAD.toUpperCase());
      foundProperties.push(prop);
    }
  }

  // 1. Prioridad: Eventos cronológicos del Lead (descendentes por created_at)
  try {
    const evRes = await axios.get(`https://${subdomain}.kommo.com/api/v4/events?filter[entity]=lead&filter[entity_id]=${leadId}&limit=50`, {
      headers,
      timeout: 4000
    });
    const events = evRes.data?._embedded?.events || [];
    for (const ev of events) {
      // AISLAMIENTO ESTRICTO: Si talkId está definido, ignorar eventos de otros chats
      const evTalkId = ev.value_after?.[0]?.message?.talk_id || ev.value_before?.[0]?.message?.talk_id || ev.talk_id;
      if (talkId && evTalkId && String(evTalkId) !== String(talkId)) {
        continue;
      }

      // 1.A: Etiqueta agregada
      const tagName = ev.value_after?.[0]?.tag?.name || '';
      const tagMatch = tagName.match(/REF-\d+/i);
      if (tagMatch && (!talkId || evTalkId === talkId)) {
        const propId = tagMatch[0].toUpperCase();
        const found = properties.find(p => (p.ID_PROPIEDAD || '').toUpperCase() === propId);
        if (found) addPropertyMatch(found);
      }

      // 1.B: Texto de mensaje, nota o campo personalizado
      const text = ev.value_after?.[0]?.custom_field_value?.text ||
                   ev.value_after?.[0]?.message?.text ||
                   ev.value_before?.[0]?.custom_field_value?.text ||
                   ev.value_after?.[0]?.note?.text || '';
      if (text) {
        const rexMatch = text.match(/cod_inmueble=(\d+)/i);
        if (rexMatch) {
          const cod = rexMatch[1];
          const found = properties.find(p => (p.LINK_FOTOS || p.LINK_FOTOS_URL || '').includes(cod));
          if (found) addPropertyMatch(found);
        }

        const wasiMatch = text.match(/\/(\d{5,10})\b/);
        if (wasiMatch) {
          const cod = wasiMatch[1];
          const found = properties.find(p => (p.CODIGO_WASI || p.Wasi || '').includes(cod));
          if (found) addPropertyMatch(found);
        }

        const refMatch = text.match(/\b(REF-\d+)\b/i);
        if (refMatch) {
          const propId = refMatch[1].toUpperCase();
          const found = properties.find(p => (p.ID_PROPIEDAD || '').toUpperCase() === propId);
          if (found) addPropertyMatch(found);
        }
      }
    }
  } catch (e) {
    // Continuar si falla
  }

  // 2. Respaldo: Etiquetas (Tags) vigentes en el Lead en Kommo (ÚNICAMENTE si no se especificó talkId)
  if (!talkId) {
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
          if (found) addPropertyMatch(found);
        }
      }
    } catch (e) {
      // Continuar si falla
    }
  }

  // 3. Respaldo para Leads No Clasificados (Unsorted): Historial de eventos en el Contacto
  if (contactId && foundProperties.length === 0) {
    try {
      const cEvRes = await axios.get(`https://${subdomain}.kommo.com/api/v4/events?filter[entity]=contact&filter[entity_id]=${contactId}&limit=20`, {
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
          if (found) addPropertyMatch(found);
        }

        const wasiMatch = text.match(/\/(\d{5,10})\b/);
        if (wasiMatch) {
          const cod = wasiMatch[1];
          const found = properties.find(p => (p.CODIGO_WASI || p.Wasi || '').includes(cod));
          if (found) addPropertyMatch(found);
        }

        const refMatch = text.match(/\b(REF-\d+)\b/i);
        if (refMatch) {
          const propId = refMatch[1].toUpperCase();
          const found = properties.find(p => (p.ID_PROPIEDAD || '').toUpperCase() === propId);
          if (found) addPropertyMatch(found);
        }
      }
    } catch (e) {}
  }

  if (foundProperties.length > 0) {
    const activeProperty = foundProperties[0]; // El evento más reciente en Kommo
    const chronologicalHistory = [...foundProperties].reverse(); // De más antiguo a más reciente
    return {
      ...activeProperty,
      activeProperty,
      history: chronologicalHistory
    };
  }

  return null;
}

/**
 * Etiqueta un Lead en Kommo CRM con el identificador de la propiedad activa.
 * Proporciona persistencia permanente fuera del contenedor efímero de Render.
 * Conserva todas las etiquetas REF previas para mantener el historial cronológico completo.
 */
async function tagLeadWithProperty(leadId, propertyId) {
  const token = process.env.KOMMO_TOKEN;
  const subdomain = process.env.KOMMO_SUBDOMAIN;
  if (!token || !subdomain || !leadId || !propertyId) return false;

  try {
    const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;

    // Obtener tags existentes para conservar todas las etiquetas de negocio y REF anteriores
    let existingTags = [];
    try {
      const getRes = await axios.get(`https://${subdomain}.kommo.com/api/v4/leads/${leadId}`, {
        headers: { Authorization: authHeader },
        timeout: 4000
      });
      existingTags = (getRes.data?._embedded?.tags || [])
        .map(t => typeof t === 'string' ? t : t.name)
        .filter(Boolean);
    } catch (_) {}

    const tagSet = new Set(existingTags);
    tagSet.add(propertyId);

    await axios.patch(`https://${subdomain}.kommo.com/api/v4/leads/${leadId}`, {
      _embedded: {
        tags: Array.from(tagSet).map(name => ({ name }))
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
