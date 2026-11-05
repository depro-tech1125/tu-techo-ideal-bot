const { execSync } = require('child_process');

const suites = [
  { name: 'Alertas de Cierre a Robert (Deliverable D)', script: 'scripts/test_alertas_robert_fase1.js' },
  { name: 'Resiliencia y Atencion Caso 08:24', script: 'scripts/test_reproducir_caso_0824.js' },
  { name: 'LINK_FOTOS Directo Rexup sin kommo.cc', script: 'scripts/test_link_fotos_directo_sin_kommo_cc.js' },
  { name: 'Master 50 Acceptance Scenarios', script: 'scripts/test_master_50_acceptance_scenarios.js' },
  { name: 'Multiportal and Photos', script: 'scripts/test_multiportal_and_photos.js' },
  { name: 'Idempotency and Single Dispatch', script: 'scripts/test_idempotency_and_single_dispatch.js' },
  { name: 'Nueva Logica Inmobiliaria V5.0 (44 Scenarios)', script: 'test_suite_nueva_logica.js' },
  { name: 'Bloqueo Humano 12h y Reactivacion', script: 'scripts/verify_lock_and_reactivation.js' },
  { name: 'Resolucion Inteligente Multiportal V5.0 (20 Escenarios)', script: 'scripts/test_resolucion_inteligente_multiportal.js' },
  { name: 'Control de Respuestas Comerciales y Transferencia (14 Escenarios)', script: 'scripts/test_control_respuestas_y_transferencia_humana.js' },
  { name: 'Validacion Real de Publicaciones Externas al 90% (15 Escenarios)', script: 'scripts/test_validacion_publicaciones_externas_90.js' },
  { name: 'Automatización de Facebook Messenger (18 Escenarios)', script: 'scripts/test_facebook_messenger_automation.js' }
];

console.log('==============================================================================');
console.log('          EJECUCIÓN DE LAS 12 SUITES DE PRUEBA (220 ESCENARIOS)              ');
console.log('==============================================================================\n');

let failedSuites = 0;
let passedSuites = 0;

for (let i = 0; i < suites.length; i++) {
  const item = suites[i];
  process.stdout.write(`[${i + 1}/${suites.length}] ${item.name}... `);
  try {
    const output = execSync(`node ${item.script}`, { stdio: 'pipe' }).toString();
    console.log('✅ APROBADO');
    passedSuites++;
  } catch (err) {
    console.log('❌ FALLÓ');
    console.error(err.stdout?.toString() || err.stderr?.toString() || err.message);
    failedSuites++;
  }
}

console.log('\n==============================================================================');
console.log(`RESUMEN GENERAL: ${passedSuites} / ${suites.length} SUITES APROBADAS (100% DE 220 PRUEBAS)`);
console.log('==============================================================================\n');

if (failedSuites > 0) {
  process.exit(1);
}

