process.env.OBSERVATION_MODE = 'true';
const { updateKommoLead, triggerKommoSalesbot, stopKommoSalesbot, ensureLeadInActivePipeline, dispatchDirectWhatsAppToRobert } = require('./server.js');

async function main() {
  const r1 = await updateKommoLead('999', 'Hola');
  const r2 = await triggerKommoSalesbot('999');
  const r3 = await stopKommoSalesbot('999');
  const r4 = await ensureLeadInActivePipeline('999');
  const r5 = await dispatchDirectWhatsAppToRobert('alerta');
  console.log('OBS_RESULT:' + JSON.stringify({ r1, r2, r3, r4, r5 }));
  process.exit(0);
}
main();
