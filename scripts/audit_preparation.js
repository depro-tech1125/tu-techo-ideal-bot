const axios = require('axios');
require('dotenv').config();

const token = process.env.KOMMO_TOKEN;
const subdomain = process.env.KOMMO_SUBDOMAIN || 'tutechoidealrd';
const headers = { Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` };

async function searchUserPhone() {
  const targetDigits = '4140128826';
  const rawVariants = ['+584140128826', '584140128826', '04140128826', '4140128826', '0128826'];
  console.log('--- Buscando teléfono en Kommo:', rawVariants.join(', '), '---');

  let foundContacts = [];

  for (const q of rawVariants) {
    try {
      const res = await axios.get(`https://${subdomain}.kommo.com/api/v4/contacts?query=${encodeURIComponent(q)}&with=leads`, { headers });
      const contacts = res.data?._embedded?.contacts || [];
      if (contacts.length > 0) {
        console.log(`Query "${q}" arrojó ${contacts.length} contacto(s)`);
        foundContacts.push(...contacts);
      }
    } catch (e) {
      if (e.response?.status !== 204) {
        // 204 significa No Content (sin coincidencias)
        console.log(`Query error para "${q}":`, e.response?.status, e.response?.data?.detail || e.message);
      }
    }
  }

  // Deduplicar contactos encontrados
  const uniqueContactsMap = new Map();
  for (const c of foundContacts) {
    uniqueContactsMap.set(c.id, c);
  }
  const uniqueContacts = Array.from(uniqueContactsMap.values());
  console.log('Total contactos únicos encontrados por query directa:', uniqueContacts.length);

  for (const c of uniqueContacts) {
    const phones = c.custom_fields_values?.find(f => f.field_code === 'PHONE')?.values?.map(v => v.value) || [];
    const leadIds = c._embedded?.leads?.map(l => l.id) || [];
    console.log('\nContacto Encontrado:', {
      id: c.id,
      name: c.name,
      phones: phones.map(p => p.slice(0, 4) + '***' + p.slice(-3)),
      leadIds: leadIds
    });

    // Buscar talks asociados a este contact_id
    try {
      const talksRes = await axios.get(`https://${subdomain}.kommo.com/api/v4/talks?filter[contact_id]=${c.id}`, { headers });
      const talks = talksRes.data?._embedded?.talks || [];
      console.log(`  Talks vinculados al contacto ${c.id}:`, talks.map(t => ({
        talk_id: t.talk_id,
        entity_id: t.entity_id,
        origin: t.origin,
        status: t.status,
        is_in_work: t.is_in_work
      })));
    } catch (err) {
      console.log(`  Error consultando talks para contacto ${c.id}:`, err.response?.status || err.message);
    }
  }

  // Si no se encontró por query, buscar en leads con query
  if (uniqueContacts.length === 0) {
    console.log('\n--- Buscando en Leads con query del teléfono ---');
    for (const q of rawVariants) {
      try {
        const leadRes = await axios.get(`https://${subdomain}.kommo.com/api/v4/leads?query=${encodeURIComponent(q)}&with=contacts`, { headers });
        const leads = leadRes.data?._embedded?.leads || [];
        if (leads.length > 0) {
          console.log(`Query Leads "${q}" arrojó ${leads.length} lead(s):`, leads.map(l => ({ id: l.id, name: l.name })));
        }
      } catch (e) {
        if (e.response?.status !== 204) {
          console.log(`Error buscando leads con "${q}":`, e.message);
        }
      }
    }
  }
}

searchUserPhone();

