@echo off
chcp 65001 > nul
title TU TECHO IDEAL V5.0 - MONITOR EN VIVO DE PRODUCCION
color 0E

echo ==============================================================================
echo                 TU TECHO IDEAL V5.0 - ESTADO DE SALUD EN RENDER
echo             Verificando Endpoints de Produccion y Staging en Vivo
echo ==============================================================================
echo.

node -e "const https = require('https'); function check(url, name) { return new Promise(resolve => { https.get(url, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve({ name, status: res.statusCode, data: JSON.parse(d) }); } catch(e) { resolve({ name, status: res.statusCode, raw: d }); } }); }).on('error', err => resolve({ name, error: err.message })); }); } (async () => { const prod = await check('https://tu-techo-ideal-bot-1.onrender.com/health', 'Render Production'); const stag = await check('https://tu-techo-ideal-staging.onrender.com/health', 'Render Staging'); console.log('=============================================================================='); console.log('🟢 ' + prod.name + ' [HTTP ' + prod.status + ']'); console.log('   Modo Observacion: ' + (prod.data ? prod.data.observation_mode : 'N/A')); console.log('   Modelo IA:        ' + (prod.data ? prod.data.ai_model : 'N/A')); console.log('   Uptime:           ' + (prod.data ? prod.data.uptime_seconds + 's' : 'N/A')); console.log('------------------------------------------------------------------------------'); console.log('🟡 ' + stag.name + ' [HTTP ' + stag.status + ']'); console.log('   Modo Observacion: ' + (stag.data ? stag.data.observation_mode : 'N/A')); console.log('   Modelo IA:        ' + (stag.data ? stag.data.ai_model : 'N/A')); console.log('   Uptime:           ' + (stag.data ? stag.data.uptime_seconds + 's' : 'N/A')); console.log('=============================================================================='); })();"

echo.
pause
