/**
 * PRUEBAS DE INTEGRIDAD DE HUELLA DIGITAL SHA-256 PARA ÍNDICE UNIVERSAL
 * Tu Techo Ideal — DEPRO TECH SOLUTIONS
 *
 * Valida individualmente las 10 condiciones exigidas:
 *  1. Cambiar precio debe invalidar
 *  2. Cambiar metraje debe invalidar
 *  3. Cambiar habitaciones debe invalidar
 *  4. Cambiar baños debe invalidar
 *  5. Cambiar estatus debe invalidar
 *  6. Cambiar URL debe invalidar
 *  7. Cambiar descripción debe invalidar
 *  8. Cambiar un encabezado debe invalidar
 *  9. Cambiar únicamente la fecha de lectura (_fetchedAt) no debe reconstruir innecesariamente el índice
 * 10. Mantener todos los datos iguales debe conservar la misma huella
 */

const assert = require('assert');
const {
  UniversalIdentifierIndex,
  getGlobalIdentifierIndex,
  invalidateGlobalIdentifierIndex
} = require('../lib/universal_identifier_index');

function runFingerprintTestSuite() {
  console.log('==============================================================================');
  console.log(' PRUEBAS DE INTEGRIDAD DE HUELLA SHA-256 (10 CONDICIONES DE INVALIDACIÓN)    ');
  console.log('==============================================================================\n');

  const baseProp = {
    ID_PROPIEDAD: 'REF-012',
    TIPO: 'Apartamento',
    OPERACION: 'Venta',
    ESTATUS: 'Disponible',
    PRECIO: 'USD 146.000',
    MONEDA: 'USD',
    METRAJE: '110 m²',
    HABITACIONES: '3',
    BANOS: '2',
    ESTACIONAMIENTOS: '2',
    Mascotas: 'No',
    Wasi: 'https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109',
    'Mercado Libre': 'https://apartamento.mercadolibre.com.ve/MLV-1030258090',
    LINK_FOTOS: 'https://www.rexup.net/ver_inmueble_c.php?cod_inmueble=5185804150',
    'Pagina Web': 'https://tutechoideal.com/inmuebles/los-samanes-ref-012',
    DESCRIPCION_BREVE: 'Apartamento en venta en Los Samanes de 110 m2 con 3 habitaciones.'
  };

  const createCatalog = (overrides = {}, schemaFingerprint = 'v5.1_initial_schema', fetchedAt = 1700000000000) => {
    const list = [{ ...baseProp, ...overrides }];
    list._schemaFingerprint = schemaFingerprint;
    list._fetchedAt = fetchedAt;
    return list;
  };

  const catalogBase = createCatalog();
  invalidateGlobalIdentifierIndex();
  const idxBase = getGlobalIdentifierIndex(catalogBase);
  const fpBase = idxBase.fingerprint;
  console.log(`Huella base SHA-256: ${fpBase}\n`);

  // 1. Cambiar precio debe invalidar
  const cat1 = createCatalog({ PRECIO: 'USD 150.000' });
  const idx1 = getGlobalIdentifierIndex(cat1);
  assert.notStrictEqual(idx1.fingerprint, fpBase, 'Condición 1: Cambiar precio debe invalidar');
  console.log('  ✅ [PASS 1/10] Cambiar precio invalida huella correctamente.');

  // 2. Cambiar metraje debe invalidar
  const cat2 = createCatalog({ METRAJE: '120 m²' });
  const idx2 = getGlobalIdentifierIndex(cat2);
  assert.notStrictEqual(idx2.fingerprint, fpBase, 'Condición 2: Cambiar metraje debe invalidar');
  console.log('  ✅ [PASS 2/10] Cambiar metraje invalida huella correctamente.');

  // 3. Cambiar habitaciones debe invalidar
  const cat3 = createCatalog({ HABITACIONES: '4' });
  const idx3 = getGlobalIdentifierIndex(cat3);
  assert.notStrictEqual(idx3.fingerprint, fpBase, 'Condición 3: Cambiar habitaciones debe invalidar');
  console.log('  ✅ [PASS 3/10] Cambiar habitaciones invalida huella correctamente.');

  // 4. Cambiar baños debe invalidar
  const cat4 = createCatalog({ BANOS: '3' });
  const idx4 = getGlobalIdentifierIndex(cat4);
  assert.notStrictEqual(idx4.fingerprint, fpBase, 'Condición 4: Cambiar baños debe invalidar');
  console.log('  ✅ [PASS 4/10] Cambiar baños invalida huella correctamente.');

  // 5. Cambiar estatus debe invalidar
  const cat5 = createCatalog({ ESTATUS: 'Vendido' });
  const idx5 = getGlobalIdentifierIndex(cat5);
  assert.notStrictEqual(idx5.fingerprint, fpBase, 'Condición 5: Cambiar estatus debe invalidar');
  console.log('  ✅ [PASS 5/10] Cambiar estatus invalida huella correctamente.');

  // 6. Cambiar URL debe invalidar
  const cat6 = createCatalog({ Wasi: 'https://info.wasi.co/apartamento-venta/9999999' });
  const idx6 = getGlobalIdentifierIndex(cat6);
  assert.notStrictEqual(idx6.fingerprint, fpBase, 'Condición 6: Cambiar URL debe invalidar');
  console.log('  ✅ [PASS 6/10] Cambiar URL invalida huella correctamente.');

  // 7. Cambiar descripción debe invalidar
  const cat7 = createCatalog({ DESCRIPCION_BREVE: 'Apartamento completamente remodelado y con planta eléctrica.' });
  const idx7 = getGlobalIdentifierIndex(cat7);
  assert.notStrictEqual(idx7.fingerprint, fpBase, 'Condición 7: Cambiar descripción debe invalidar');
  console.log('  ✅ [PASS 7/10] Cambiar descripción invalida huella correctamente.');

  // 8. Cambiar un encabezado (schema fingerprint) debe invalidar
  const cat8 = createCatalog({}, 'v5.1_modified_header_schema');
  const idx8 = getGlobalIdentifierIndex(cat8);
  assert.notStrictEqual(idx8.fingerprint, fpBase, 'Condición 8: Cambiar un encabezado debe invalidar');
  console.log('  ✅ [PASS 8/10] Cambiar un encabezado invalida huella correctamente.');

  // 9. Cambiar únicamente la fecha de lectura (_fetchedAt) no debe reconstruir innecesariamente el índice
  const cat9 = createCatalog({}, 'v5.1_initial_schema', 1700000999999);
  const idx9 = getGlobalIdentifierIndex(cat9);
  assert.strictEqual(idx9.fingerprint, fpBase, 'Condición 9: Cambiar únicamente la fecha de lectura debe conservar la huella');
  console.log('  ✅ [PASS 9/10] Cambiar únicamente fecha de lectura (_fetchedAt) conserva exactamente la huella.');

  // 10. Mantener todos los datos iguales debe conservar la misma huella
  const cat10 = createCatalog();
  const idx10 = getGlobalIdentifierIndex(cat10);
  assert.strictEqual(idx10.fingerprint, fpBase, 'Condición 10: Mantener todos los datos iguales debe conservar la misma huella');
  console.log('  ✅ [PASS 10/10] Mantener todos los datos iguales conserva determinísticamente la misma huella.');

  console.log('\n==============================================================================');
  console.log(' RESULTADO: 10 / 10 CONDICIONES DE HUELLA SHA-256 APROBADAS (100%)            ');
  console.log('==============================================================================');
}

if (require.main === module) {
  runFingerprintTestSuite();
}

module.exports = { runFingerprintTestSuite };

