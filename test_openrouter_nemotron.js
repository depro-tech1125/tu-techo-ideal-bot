/**
 * Verificación auténtica de OpenRouter con nvidia/nemotron-3.5-lightning:free
 */
require('dotenv').config();
const axios = require('axios');

async function testNemotron() {
  console.log('================================================================');
  console.log(' FASE 4: VERIFICACIÓN AUTÉNTICA DE OPENROUTER + NEMOTRON GRATIS ');
  console.log('================================================================\n');

  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.CLAUDE_MODEL || 'nvidia/nemotron-3.5-lightning:free';

  console.log('1. Modelo solicitado:', model);
  console.log('2. Comprobando presencia de API Key:', apiKey ? 'Presente (longitud: ' + apiKey.length + ')' : 'Ausente');

  try {
    const res = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: model,
        messages: [
          { role: 'system', content: 'Responde exclusivamente un objeto JSON con la propiedad "status": "ok".' },
          { role: 'user', content: '¿Estás activo?' }
        ],
        temperature: 0.0,
        max_tokens: 50
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://tutechoideal.com',
          'X-Title': 'Tu Techo Ideal Staging'
        },
        timeout: 15000
      }
    );

    console.log('\n✅ 3. Respuesta HTTP:', res.status, res.statusText);
    console.log('✅ 4. Contenido generado:', res.data?.choices?.[0]?.message?.content);
    console.log('✅ 5. Usage / Tokens:', res.data?.usage);
    return { ok: true, data: res.data };
  } catch (err) {
    console.log('\n❌ Error en solicitud HTTP:');
    if (err.response) {
      console.log('   Status:', err.response.status, err.response.statusText);
      console.log('   Data:', JSON.stringify(err.response.data));
    } else {
      console.log('   Mensaje:', err.message);
    }
    return { ok: false, error: err.response?.data || err.message, status: err.response?.status };
  }
}

testNemotron();

