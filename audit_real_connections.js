/**
 * ============================================================================
 * AUDITORÍA EN VIVO DE CONEXIONES EXTERNAS (SOLO LECTURA)
 * ============================================================================
 */

require('dotenv').config();
const axios = require('axios');
const XLSX = require('xlsx');

async function auditAllConnections() {
  console.log('================================================================');
  console.log(' AUDITORÍA EN VIVO DE CONEXIONES EXTERNAS - SOLO LECTURA (FASE 4) ');
  console.log('================================================================\n');

  const report = {
    googleSheets: { ok: false, details: null },
    kommo: { ok: false, details: null },
    openRouter: { ok: false, details: null }
  };

  // --------------------------------------------------------------------------
  // 1. GOOGLE SHEETS
  // --------------------------------------------------------------------------
  console.log('>>> [1/3] Verificando conexión en vivo con Google Sheets...');
  try {
    const sheetUrl = process.env.GOOGLE_SHEET_CSV_URL;
    if (!sheetUrl) throw new Error('GOOGLE_SHEET_CSV_URL no definida en .env');

    const downloadUrl = sheetUrl.includes('docs.google.com/spreadsheets')
      ? sheetUrl.replace(/\/edit.*$/, '/export?format=xlsx')
      : sheetUrl;

    const res = await axios.get(downloadUrl, { responseType: 'arraybuffer', timeout: 15000 });
    const workbook = XLSX.read(res.data, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    const rawHeaders = [];
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:Z100');
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: 0, c })];
      if (cell && cell.v) rawHeaders.push(String(cell.v).trim());
    }

    const availableCount = rows.filter(r => (r.ESTATUS || '').toString().toLowerCase().trim() === 'disponible').length;
    const sampleProps = rows.slice(0, 3).map(r => ({
      id: r.ID_PROPIEDAD,
      estatus: r.ESTATUS,
      tipo: r.TIPO,
      operacion: r.OPERACION,
      wasiUrl: r.Wasi || r.Wasi_URL
    }));

    report.googleSheets.ok = true;
    report.googleSheets.details = {
      sheetName,
      totalRows: rows.length,
      availableRows: availableCount,
      headers: rawHeaders,
      sampleProps
    };

    console.log('✅ Google Sheets: Lectura exitosa');
    console.log(`   Hoja: "${sheetName}", Total propiedades: ${rows.length}, Disponibles: ${availableCount}`);
    console.log(`   Columnas oficiales detectadas (${rawHeaders.length}):`, rawHeaders.join(', '));
  } catch (err) {
    report.googleSheets.ok = false;
    report.googleSheets.details = { error: err.message };
    console.error('❌ Google Sheets Error:', err.message);
  }

  // --------------------------------------------------------------------------
  // 2. KOMMO CRM
  // --------------------------------------------------------------------------
  console.log('\n>>> [2/3] Verificando conexión en vivo con Kommo CRM...');
  try {
    const token = process.env.KOMMO_TOKEN;
    const subdomain = process.env.KOMMO_SUBDOMAIN || 'tutechoidealrd';
    const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
    const headers = { Authorization: authHeader };

    // A. Consultar cuenta
    const accountRes = await axios.get(`https://${subdomain}.kommo.com/api/v4/account`, { headers, timeout: 10000 });
    const accountId = accountRes.data?.id;
    const accountName = accountRes.data?.name;

    // B. Consultar eventos salientes (Solo lectura)
    const eventsRes = await axios.get(`https://${subdomain}.kommo.com/api/v4/events?filter[type]=outgoing_chat_message&limit=3`, { headers, timeout: 10000 });
    const recentEvents = eventsRes.data?._embedded?.events || [];

    // C. Consultar campos personalizados de leads para verificar campo 2103996
    const fieldsRes = await axios.get(`https://${subdomain}.kommo.com/api/v4/leads/custom_fields`, { headers, timeout: 10000 });
    const fields = fieldsRes.data?._embedded?.custom_fields || [];
    const targetField = fields.find(f => String(f.id) === '2103996');

    report.kommo.ok = true;
    report.kommo.details = {
      accountId,
      accountName,
      subdomain,
      targetField: targetField ? { id: targetField.id, name: targetField.name, type: targetField.type } : null,
      salesbotIdConfigured: process.env.KOMMO_BOT_ID || '100766',
      eventsFound: recentEvents.length,
      latestEventId: recentEvents[0]?.id
    };

    console.log('✅ Kommo CRM: Conexión y autenticación exitosa (Solo Lectura)');
    console.log(`   Cuenta: ${accountName} (ID: ${accountId})`);
    console.log(`   Campo 2103996 verificado en Kommo: "${targetField?.name}" (Tipo: ${targetField?.type})`);
    console.log(`   ID Salesbot configurado: ${process.env.KOMMO_BOT_ID || '100766'}`);
    console.log(`   Eventos salientes accesibles: ${recentEvents.length} eventos recientes recuperados`);
  } catch (err) {
    report.kommo.ok = false;
    report.kommo.details = { error: err.response?.status ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}` : err.message };
    console.error('❌ Kommo CRM Error:', report.kommo.details.error);
  }

  // --------------------------------------------------------------------------
  // 3. OPENROUTER
  // --------------------------------------------------------------------------
  console.log('\n>>> [3/3] Verificando conexión en vivo con OpenRouter...');
  try {
    const key = process.env.OPENROUTER_API_KEY;
    const model = process.env.CLAUDE_MODEL || 'anthropic/claude-sonnet-4.5';

    // A. Endpoint de autenticación de clave
    let authStatus = null;
    let authData = null;
    try {
      const authRes = await axios.get('https://openrouter.ai/api/v1/auth/key', {
        headers: { Authorization: `Bearer ${key}` },
        timeout: 10000
      });
      authStatus = authRes.status;
      authData = authRes.data;
    } catch (authErr) {
      authStatus = authErr.response?.status || 'ERR';
      authData = authErr.response?.data || authErr.message;
    }

    // B. Intento de generación mínima
    let compStatus = null;
    let compData = null;
    try {
      const compRes = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: model,
          messages: [{ role: 'user', content: 'Ping' }],
          max_tokens: 5
        },
        {
          headers: {
            Authorization: `Bearer ${key}`,
            'HTTP-Referer': 'https://tutechoideal.com',
            'X-Title': 'Tu Techo Ideal Staging'
          },
          timeout: 15000
        }
      );
      compStatus = compRes.status;
      compData = compRes.data;
    } catch (compErr) {
      compStatus = compErr.response?.status || 'ERR';
      compData = compErr.response?.data || compErr.message;
    }

    const isKeyValid = authStatus === 200 && compStatus === 200;
    report.openRouter.ok = isKeyValid;
    report.openRouter.details = {
      model,
      authStatus,
      authData,
      compStatus,
      compData
    };

    if (isKeyValid) {
      console.log('✅ OpenRouter: Autenticación y generación exitosa');
    } else {
      console.log(`⚠️ OpenRouter: Respuesta HTTP ${authStatus}`);
      console.log('   Detalle Auth:', typeof authData === 'object' ? JSON.stringify(authData) : authData);
      console.log('   Detalle Completions:', typeof compData === 'object' ? JSON.stringify(compData) : compData);
    }
  } catch (err) {
    report.openRouter.ok = false;
    report.openRouter.details = { error: err.message };
    console.error('❌ OpenRouter Error:', err.message);
  }

  console.log('\n================================================================');
  console.log(' RESUMEN FINAL DE LA AUDITORÍA DE CONEXIONES EXTERNAS           ');
  console.log('================================================================');
  console.log(` Google Sheets: ${report.googleSheets.ok ? '✅ OPERATIVO' : '❌ ERROR'}`);
  console.log(` Kommo CRM:     ${report.kommo.ok ? '✅ OPERATIVO' : '❌ ERROR'}`);
  console.log(` OpenRouter:    ${report.openRouter.ok ? '✅ OPERATIVO' : '⚠️ LIMITACIÓN IDENTIFICADA (HTTP ' + report.openRouter.details.authStatus + ')'}`);
  console.log('================================================================\n');

  return report;
}

auditAllConnections().catch(console.error);
