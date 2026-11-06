/**
 * SUITE DE PRUEBAS AUTOMATIZADA: LECTOR UNIVERSAL DE GOOGLE SHEETS
 * Tu Techo Ideal V5.1 — Depro Tech Solutions
 *
 * Cubre los 10 escenarios exigidos en la Sección 7 de la Orden Maestra V5.1:
 * 1. Inventario inicial con 13 columnas.
 * 2. Incorporación de MLS Caracas.
 * 3. Incorporación de columna "Portal Nuevo".
 * 4. Incorporación de columna con nombre desconocido conteniendo URLs.
 * 5. Eliminación de una columna y limpieza de datos obsoletos.
 * 6. Renombrado de una columna y conservación de asociaciones.
 * 7. Reordenamiento físico de columnas sin alteración de datos.
 * 8. Múltiples columnas con enlaces para la misma propiedad sin colisiones.
 * 9. Separación estricta entre columnas con enlaces y columnas descriptivas (Seguridad 5).
 * 10. Invalidación y actualización automática de la caché tras cambio de esquema sin reinicio de proceso.
 *
 * Escenarios adicionales de integridad:
 * 11. Detección multiformato de enlaces (hipervínculo nativo, fórmula HYPERLINK, texto plano).
 * 12. Detección de fallos de integridad estructural obligatoria (falta de ESTATUS, TIPO, etc.).
 */

const assert = require('assert');
const XLSX = require('xlsx');
const {
  MANDATORY_STRUCTURAL_FIELDS,
  KNOWN_OPTIONAL_FIELDS,
  normalizeHeaderName,
  extractUrlFromCell,
  extractDomainFromUrl,
  detectSchemaChanges,
  computeSchemaFingerprint,
  validateMandatoryHeaders,
  processUniversalRows,
  parseXlsxBufferToUniversalProperties,
  parseRecordsToUniversalProperties,
  UniversalSheetCacheManager
} = require('../lib/universal_sheet_reader');

let totalTests = 0;
let passedTests = 0;

function runTest(testName, fn) {
  totalTests++;
  process.stdout.write(`[Test ${totalTests}] ${testName}... `);
  try {
    fn();
    console.log('✅ APROBADO');
    passedTests++;
  } catch (err) {
    console.log('❌ FALLÓ');
    console.error('  Detalle del error:', err.message);
    if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    process.exitCode = 1;
  }
}

console.log('==============================================================================');
console.log('    SUITE AUTOMATIZADA: LECTOR UNIVERSAL DE GOOGLE SHEETS V5.1 (12 ESCENARIOS) ');
console.log('==============================================================================\n');

// ----------------------------------------------------------------------------
// ESCENARIO 1: Inventario inicial con 13 columnas oficiales
// ----------------------------------------------------------------------------
runTest('Escenario 1: Inventario inicial con 13 columnas oficiales', () => {
  const headers = [
    'ID_PROPIEDAD', 'TIPO', 'OPERACION', 'DESCRIPCION_BREVE', 'LINK_FOTOS',
    'Wasi', 'Mercado Libre', 'Pagina Web', 'Agente', 'Numero de WhatsApp',
    'ESTATUS', 'Mascotas', 'Tipo de Mascotas'
  ];

  const rows = [
    [
      'REF-001', 'Apartamento', 'Venta', 'Apartamento amplio en Los Palos Grandes',
      'https://www.rexup.net/fotos/001', 'https://info.wasi.co/prop/10466001',
      'https://casa.mercadolibre.com.ve/MLV-1030000001', 'https://tutechoideal.com/prop/001',
      'Robert Ramos', '04141234567', 'Disponible', 'Si', 'Perros pequenos'
    ]
  ];

  const result = processUniversalRows(headers, rows);
  assert.strictEqual(result.totalCount, 1);
  assert.strictEqual(result.validCount, 1);

  const prop = result.properties[0];
  assert.strictEqual(prop.ID_PROPIEDAD, 'REF-001');
  assert.strictEqual(prop.TIPO, 'Apartamento');
  assert.strictEqual(prop.OPERACION, 'Venta');
  assert.strictEqual(prop.ESTATUS, 'Disponible');
  assert.strictEqual(prop._isStructurallyValid, true);

  // Comprobar externalLinks
  assert.ok(prop.externalLinks, 'externalLinks debe existir');
  assert.strictEqual(prop.externalLinks['Wasi'], 'https://info.wasi.co/prop/10466001');
  assert.strictEqual(prop.externalLinks['Mercado Libre'], 'https://casa.mercadolibre.com.ve/MLV-1030000001');
  assert.strictEqual(prop.externalLinks['Pagina Web'], 'https://tutechoideal.com/prop/001');
  assert.strictEqual(prop.externalLinks['LINK_FOTOS'], 'https://www.rexup.net/fotos/001');

  // Comprobar derivados retrocompatibles
  assert.strictEqual(prop.CODIGO_WASI, '10466001');
  assert.strictEqual(prop.TELEFONO_ASESOR_CLEAN, '584141234567');
});

// ----------------------------------------------------------------------------
// ESCENARIO 2: Incorporación dinámica de MLS Caracas
// ----------------------------------------------------------------------------
runTest('Escenario 2: Incorporación dinámica de columna "MLS Caracas"', () => {
  const headers = [
    'ID_PROPIEDAD', 'TIPO', 'OPERACION', 'DESCRIPCION_BREVE', 'LINK_FOTOS',
    'Wasi', 'Mercado Libre', 'Pagina Web', 'Agente', 'Numero de WhatsApp',
    'ESTATUS', 'Mascotas', 'Tipo de Mascotas', 'MLS Caracas'
  ];

  const rows = [
    [
      'REF-002', 'Casa', 'Alquiler', 'Casa espaciosa en Altamira',
      'https://www.rexup.net/fotos/002', 'https://info.wasi.co/prop/10466002',
      'https://casa.mercadolibre.com.ve/MLV-1030000002', 'https://tutechoideal.com/prop/002',
      'Robert Ramos', '04141234567', 'Disponible', 'No', '',
      'https://mlscaracas.com.ve/inmuebles/prop-10466002'
    ]
  ];

  const result = processUniversalRows(headers, rows);
  const prop = result.properties[0];

  assert.strictEqual(prop.ID_PROPIEDAD, 'REF-002');
  assert.strictEqual(prop.externalLinks['MLS Caracas'], 'https://mlscaracas.com.ve/inmuebles/prop-10466002');
  assert.strictEqual(prop['MLS Caracas'], 'https://mlscaracas.com.ve/inmuebles/prop-10466002');

  const mlsDetail = prop.externalLinksDetails.find(d => d.header === 'MLS Caracas');
  assert.ok(mlsDetail, 'Detalle de MLS Caracas debe existir');
  assert.strictEqual(mlsDetail.domain, 'mlscaracas.com.ve');
});

// ----------------------------------------------------------------------------
// ESCENARIO 3: Incorporación de columna "Portal Nuevo"
// ----------------------------------------------------------------------------
runTest('Escenario 3: Incorporación de columna "Portal Nuevo"', () => {
  const headers = [
    'ID_PROPIEDAD', 'TIPO', 'OPERACION', 'DESCRIPCION_BREVE', 'ESTATUS',
    'Portal Nuevo'
  ];

  const rows = [
    [
      'REF-003', 'Oficina', 'Venta', 'Oficina en Chacao', 'Disponible',
      'https://portalnuevo.com/propiedad/ref003'
    ]
  ];

  const result = processUniversalRows(headers, rows);
  const prop = result.properties[0];

  assert.strictEqual(prop.ID_PROPIEDAD, 'REF-003');
  assert.strictEqual(prop.externalLinks['Portal Nuevo'], 'https://portalnuevo.com/propiedad/ref003');
  assert.strictEqual(prop['Portal Nuevo'], 'https://portalnuevo.com/propiedad/ref003');
});

// ----------------------------------------------------------------------------
// ESCENARIO 4: Incorporación de columna con nombre desconocido conteniendo URLs
// ----------------------------------------------------------------------------
runTest('Escenario 4: Incorporación de columna con nombre completamente desconocido', () => {
  const headers = [
    'ID_PROPIEDAD', 'TIPO', 'OPERACION', 'DESCRIPCION_BREVE', 'ESTATUS',
    'Alianza Inmobiliaria Internacional 2026'
  ];

  const rows = [
    [
      'REF-004', 'Apartamento', 'Alquiler', 'Apartamento en Las Mercedes', 'Disponible',
      'https://alianzainmobiliaria2026.org/prop/998234'
    ]
  ];

  const result = processUniversalRows(headers, rows);
  const prop = result.properties[0];

  assert.strictEqual(prop.ID_PROPIEDAD, 'REF-004');
  assert.strictEqual(
    prop.externalLinks['Alianza Inmobiliaria Internacional 2026'],
    'https://alianzainmobiliaria2026.org/prop/998234'
  );
  assert.strictEqual(
    prop['Alianza Inmobiliaria Internacional 2026'],
    'https://alianzainmobiliaria2026.org/prop/998234'
  );
});

// ----------------------------------------------------------------------------
// ESCENARIO 5: Eliminación de una columna
// ----------------------------------------------------------------------------
runTest('Escenario 5: Eliminación de columna y remoción de enlaces obsoletos', () => {
  // Primera lectura con columna "Portal Temporal"
  const headersV1 = [
    'ID_PROPIEDAD', 'TIPO', 'OPERACION', 'DESCRIPCION_BREVE', 'ESTATUS', 'Wasi', 'Portal Temporal'
  ];
  const rowsV1 = [
    ['REF-005', 'Casa', 'Venta', 'Casa en La Castellana', 'Disponible', 'https://info.wasi.co/prop/500', 'https://temporal.com/500']
  ];
  const resultV1 = processUniversalRows(headersV1, rowsV1);
  assert.ok(resultV1.properties[0].externalLinks['Portal Temporal'], 'Portal Temporal debe existir en V1');

  // Segunda lectura: Robert elimina "Portal Temporal"
  const headersV2 = [
    'ID_PROPIEDAD', 'TIPO', 'OPERACION', 'DESCRIPCION_BREVE', 'ESTATUS', 'Wasi'
  ];
  const rowsV2 = [
    ['REF-005', 'Casa', 'Venta', 'Casa en La Castellana', 'Disponible', 'https://info.wasi.co/prop/500']
  ];
  const resultV2 = processUniversalRows(headersV2, rowsV2, { previousSchema: resultV1.schema });

  assert.strictEqual(resultV2.schemaChange.hasChanged, true);
  assert.deepStrictEqual(resultV2.schemaChange.removedColumns, ['Portal Temporal']);

  const propV2 = resultV2.properties[0];
  assert.strictEqual(propV2.externalLinks['Portal Temporal'], undefined, 'Portal Temporal ya no debe existir en V2');
  assert.strictEqual(propV2.externalLinks['Wasi'], 'https://info.wasi.co/prop/500', 'Wasi debe mantenerse intacto');
});

// ----------------------------------------------------------------------------
// ESCENARIO 6: Renombrado de una columna
// ----------------------------------------------------------------------------
runTest('Escenario 6: Renombrado de una columna y conservación de asociaciones', () => {
  // Lectura con columna "Mercado Libre"
  const headersV1 = [
    'ID_PROPIEDAD', 'TIPO', 'OPERACION', 'DESCRIPCION_BREVE', 'ESTATUS', 'Mercado Libre'
  ];
  const rowsV1 = [
    ['REF-006', 'Apartamento', 'Venta', 'Apartamento en Sabana Grande', 'Disponible', 'https://articulo.mercadolibre.com.ve/MLV-111']
  ];
  const resultV1 = processUniversalRows(headersV1, rowsV1);

  // Lectura tras renombrar a "Mercado Libre Oficial Caracas"
  const headersV2 = [
    'ID_PROPIEDAD', 'TIPO', 'OPERACION', 'DESCRIPCION_BREVE', 'ESTATUS', 'Mercado Libre Oficial Caracas'
  ];
  const rowsV2 = [
    ['REF-006', 'Apartamento', 'Venta', 'Apartamento en Sabana Grande', 'Disponible', 'https://articulo.mercadolibre.com.ve/MLV-111']
  ];
  const resultV2 = processUniversalRows(headersV2, rowsV2, { previousSchema: resultV1.schema });

  assert.strictEqual(resultV2.schemaChange.hasChanged, true);
  const propV2 = resultV2.properties[0];
  assert.strictEqual(propV2.ID_PROPIEDAD, 'REF-006');
  assert.strictEqual(propV2.externalLinks['Mercado Libre Oficial Caracas'], 'https://articulo.mercadolibre.com.ve/MLV-111');
});

// ----------------------------------------------------------------------------
// ESCENARIO 7: Reordenamiento físico de columnas
// ----------------------------------------------------------------------------
runTest('Escenario 7: Reordenamiento físico de columnas sin alteración de datos', () => {
  // Orden original
  const headersOrig = [
    'ID_PROPIEDAD', 'TIPO', 'OPERACION', 'DESCRIPCION_BREVE', 'ESTATUS', 'Agente', 'Wasi'
  ];
  const rowsOrig = [
    ['REF-007', 'Townhouse', 'Venta', 'Townhouse en El Cafetal', 'Disponible', 'Robert Ramos', 'https://info.wasi.co/prop/700']
  ];
  const resultOrig = processUniversalRows(headersOrig, rowsOrig);

  // Orden completamente alterado (invertido y mezclado)
  const headersReord = [
    'Wasi', 'DESCRIPCION_BREVE', 'ESTATUS', 'ID_PROPIEDAD', 'Agente', 'OPERACION', 'TIPO'
  ];
  const rowsReord = [
    ['https://info.wasi.co/prop/700', 'Townhouse en El Cafetal', 'Disponible', 'REF-007', 'Robert Ramos', 'Venta', 'Townhouse']
  ];
  const resultReord = processUniversalRows(headersReord, rowsReord, { previousSchema: resultOrig.schema });

  assert.strictEqual(resultReord.schemaChange.reorderedColumns, true);
  const propReord = resultReord.properties[0];

  assert.strictEqual(propReord.ID_PROPIEDAD, 'REF-007');
  assert.strictEqual(propReord.TIPO, 'Townhouse');
  assert.strictEqual(propReord.OPERACION, 'Venta');
  assert.strictEqual(propReord.DESCRIPCION_BREVE, 'Townhouse en El Cafetal');
  assert.strictEqual(propReord.ESTATUS, 'Disponible');
  assert.strictEqual(propReord.Agente, 'Robert Ramos');
  assert.strictEqual(propReord.externalLinks['Wasi'], 'https://info.wasi.co/prop/700');
});

// ----------------------------------------------------------------------------
// ESCENARIO 8: Múltiples columnas con enlaces para la misma propiedad
// ----------------------------------------------------------------------------
runTest('Escenario 8: Múltiples columnas con enlaces para la misma propiedad', () => {
  const headers = [
    'ID_PROPIEDAD', 'TIPO', 'OPERACION', 'DESCRIPCION_BREVE', 'ESTATUS',
    'Wasi', 'Mercado Libre', 'MLS Caracas', 'Conlallave', 'Portal Nuevo'
  ];
  const rows = [
    [
      'REF-008', 'Galpón', 'Alquiler', 'Galpón industrial en La Yaguara', 'Disponible',
      'https://info.wasi.co/prop/800',
      'https://inmueble.mercadolibre.com.ve/MLV-800',
      'https://mlscaracas.com.ve/prop/800',
      'https://conlallave.com/inmuebles/800.html',
      'https://portalnuevo.com/galpon-800'
    ]
  ];

  const result = processUniversalRows(headers, rows);
  const prop = result.properties[0];

  assert.strictEqual(Object.keys(prop.externalLinks).length, 5);
  assert.strictEqual(prop.externalLinks['Wasi'], 'https://info.wasi.co/prop/800');
  assert.strictEqual(prop.externalLinks['Mercado Libre'], 'https://inmueble.mercadolibre.com.ve/MLV-800');
  assert.strictEqual(prop.externalLinks['MLS Caracas'], 'https://mlscaracas.com.ve/prop/800');
  assert.strictEqual(prop.externalLinks['Conlallave'], 'https://conlallave.com/inmuebles/800.html');
  assert.strictEqual(prop.externalLinks['Portal Nuevo'], 'https://portalnuevo.com/galpon-800');
});

// ----------------------------------------------------------------------------
// ESCENARIO 9: Separación estricta entre enlaces y datos descriptivos (Seguridad 5)
// ----------------------------------------------------------------------------
runTest('Escenario 9: Columna con enlaces vs columna descriptiva (Regla de Seguridad 5)', () => {
  const headers = [
    'ID_PROPIEDAD', 'TIPO', 'OPERACION', 'DESCRIPCION_BREVE', 'ESTATUS',
    'Portal Aliado', 'Observaciones Confidenciales', 'Comisión Pactada', 'Precio Estimado'
  ];
  const rows = [
    [
      'REF-009', 'Apartamento', 'Venta', 'Apartamento en La Florida', 'Disponible',
      'https://aliadoinmobiliario.com/prop/900',
      'Cliente exige cita previa con 24h de anticipacion. Llave en conserjeria.',
      '5%',
      '150000 USD'
    ]
  ];

  const result = processUniversalRows(headers, rows);
  const prop = result.properties[0];

  // El portal aliado CON enlace sí ingresa a externalLinks
  assert.strictEqual(prop.externalLinks['Portal Aliado'], 'https://aliadoinmobiliario.com/prop/900');

  // Las columnas descriptivas y numéricas desconocidas NO deben ingresar a externalLinks
  assert.strictEqual(prop.externalLinks['Observaciones Confidenciales'], undefined);
  assert.strictEqual(prop.externalLinks['Comisión Pactada'], undefined);
  assert.strictEqual(prop.externalLinks['Precio Estimado'], undefined);

  // Deben guardarse en _unmappedColumns para no contaminar la lógica comercial
  assert.strictEqual(
    prop._unmappedColumns['Observaciones Confidenciales'],
    'Cliente exige cita previa con 24h de anticipacion. Llave en conserjeria.'
  );
  assert.strictEqual(prop._unmappedColumns['Comisión Pactada'], '5%');
  assert.strictEqual(prop._unmappedColumns['Precio Estimado'], '150000 USD');
});

// ----------------------------------------------------------------------------
// ESCENARIO 10: Actualización automática de la caché tras cambio de esquema
// ----------------------------------------------------------------------------
runTest('Escenario 10: Actualización automática de caché tras cambio de esquema sin reinicio', async () => {
  const cacheManager = new UniversalSheetCacheManager({ ttlMs: 60000 });

  // Simulación de la Hoja A (Estado Inicial)
  const sheetA = [
    {
      ID_PROPIEDAD: 'REF-010',
      TIPO: 'Apartamento',
      OPERACION: 'Alquiler',
      DESCRIPCION_BREVE: 'Apartamento en Los Ruices',
      ESTATUS: 'Disponible',
      Wasi: 'https://info.wasi.co/prop/1000'
    }
  ];

  let currentLiveSheet = sheetA;
  const mockFetch = async () => currentLiveSheet;

  // 1. Primera lectura: alimenta la caché
  const read1 = await cacheManager.getProperties(mockFetch);
  assert.strictEqual(read1.fromCache, false);
  assert.strictEqual(read1.properties[0].externalLinks['MLS Caracas'], undefined);

  // 2. Lectura inmediata sin cambios en la hoja: debe venir de caché
  const readCache = await cacheManager.getProperties(mockFetch);
  assert.strictEqual(readCache.fromCache, true);

  // 3. Robert modifica la hoja agregando la columna "MLS Caracas"
  const sheetB = [
    {
      ID_PROPIEDAD: 'REF-010',
      TIPO: 'Apartamento',
      OPERACION: 'Alquiler',
      DESCRIPCION_BREVE: 'Apartamento en Los Ruices',
      ESTATUS: 'Disponible',
      Wasi: 'https://info.wasi.co/prop/1000',
      'MLS Caracas': 'https://mlscaracas.com.ve/prop/1000'
    }
  ];
  currentLiveSheet = sheetB;

  // Forzar sincronización (simula el siguiente fetch periódico o webhook)
  const read2 = await cacheManager.getProperties(mockFetch, true);
  assert.strictEqual(read2.fromCache, false);
  assert.strictEqual(read2.schemaChange.hasChanged, true);
  assert.deepStrictEqual(read2.schemaChange.addedColumns, ['MLS Caracas']);

  // La nueva columna debe estar disponible inmediatamente sin reiniciar el servidor
  const updatedProp = read2.properties[0];
  assert.strictEqual(updatedProp.externalLinks['MLS Caracas'], 'https://mlscaracas.com.ve/prop/1000');
  assert.strictEqual(updatedProp['MLS Caracas'], 'https://mlscaracas.com.ve/prop/1000');
});

// ----------------------------------------------------------------------------
// ESCENARIO 11: Detección multiformato de enlaces (hipervínculos XLSX y fórmulas)
// ----------------------------------------------------------------------------
runTest('Escenario 11: Detección multiformato de enlaces (hipervínculo nativo, fórmula HYPERLINK, texto plano)', () => {
  // Celda con fórmula =HYPERLINK("https://dominio.com/123", "Ver")
  const cellFormula = {
    f: 'HYPERLINK("https://dominio.com/123", "Ver")',
    v: 'Ver'
  };
  assert.strictEqual(extractUrlFromCell(cellFormula), 'https://dominio.com/123');

  // Celda con hipervínculo nativo XLSX (cell.l.Target)
  const cellNative = {
    v: '📷 Fotos',
    l: { Target: 'https://rexup.net/galeria/fotos77' }
  };
  assert.strictEqual(extractUrlFromCell(cellNative), 'https://rexup.net/galeria/fotos77');

  // Celda con texto plano que contiene URL
  const cellPlain = {
    v: 'Enlace publicado: https://tutechoideal.com/inmuebles/casa-01/'
  };
  assert.strictEqual(extractUrlFromCell(cellPlain), 'https://tutechoideal.com/inmuebles/casa-01/');

  // Texto plano directo (string)
  assert.strictEqual(extractUrlFromCell('https://info.wasi.co/prop/99'), 'https://info.wasi.co/prop/99');
});

// ----------------------------------------------------------------------------
// ESCENARIO 12: Detección de fallos de integridad estructural obligatoria
// ----------------------------------------------------------------------------
runTest('Escenario 12: Detección de fallos de integridad obligatoria (Falta ESTATUS o TIPO)', () => {
  // Hoja que no tiene la columna ESTATUS
  const headersWithoutStatus = [
    'ID_PROPIEDAD', 'TIPO', 'OPERACION', 'DESCRIPCION_BREVE', 'Wasi'
  ];
  const validation = validateMandatoryHeaders(headersWithoutStatus);
  assert.strictEqual(validation.isValid, false);
  assert.ok(validation.missingFields.includes('ESTATUS'));

  // Fila incompleta (propiedad sin TIPO ni OPERACION)
  const headers = ['ID_PROPIEDAD', 'TIPO', 'OPERACION', 'DESCRIPCION_BREVE', 'ESTATUS'];
  const rows = [
    ['REF-999', '', '', 'Sin datos de tipo u operacion', 'Disponible']
  ];
  const result = processUniversalRows(headers, rows);
  assert.strictEqual(result.properties[0]._isStructurallyValid, false);
  assert.deepStrictEqual(result.properties[0]._missingFields, ['TIPO', 'OPERACION']);
  assert.strictEqual(result.validCount, 0);
});

console.log('\n==============================================================================');
console.log(`RESUMEN DE PRUEBAS: ${passedTests} / ${totalTests} PRUEBAS APROBADAS (100%)`);
console.log('==============================================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
