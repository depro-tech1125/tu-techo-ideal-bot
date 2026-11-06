const fs = require('fs');
const assert = require('assert');
const { parseXlsxBufferToUniversalProperties } = require('../lib/universal_sheet_reader');

console.log('Testing live XLSX with Universal Sheet Reader...');
const buffer = fs.readFileSync('google_sheet_live_audit.xlsx');
const result = parseXlsxBufferToUniversalProperties(buffer);

console.log('Sheet parsed successfully:');
console.log('  Total properties:', result.totalCount);
console.log('  Structurally valid:', result.validCount);
console.log('  Properties with integrity warnings:', result.propertyIntegrityWarnings.length);
console.log('  Schema columns:', result.schema.columnCount);

assert.strictEqual(result.totalCount, 69, 'Debe extraer exactamente las 69 propiedades del inventario');
assert.strictEqual(result.validCount, 62, '62 propiedades completas y 7 filas borrador (REF-063 a 069)');
assert.strictEqual(result.propertyIntegrityWarnings.length, 7, '7 filas borrador deben tener advertencias de integridad');

// Verificar una muestra completa
const ref001 = result.properties.find(p => p.ID_PROPIEDAD === 'REF-001');
assert.ok(ref001, 'REF-001 debe existir');
assert.strictEqual(ref001._isStructurallyValid, true);
assert.ok(ref001.externalLinks['Wasi'], 'Wasi debe estar en externalLinks');
assert.ok(ref001.externalLinks['Mercado Libre'], 'Mercado Libre debe estar en externalLinks');
assert.ok(ref001.externalLinks['Pagina Web'], 'Pagina Web debe estar en externalLinks');
assert.ok(ref001.externalLinks['LINK_FOTOS'], 'LINK_FOTOS debe estar en externalLinks');

console.log('\n✅ Prueba contra archivo XLSX real superada con éxito.');
