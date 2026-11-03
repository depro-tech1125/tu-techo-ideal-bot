# 📋 MANUAL MAESTRO DE INSTRUCCIONES Y REGLAS DEL BOT ("TU TECHO IDEAL")

Este documento recopila **todas las instrucciones, reglas de negocio, prompts de inteligencia artificial y filtros de seguridad** implementados en el sistema del bot de WhatsApp / Redes Sociales de **Tu Techo Ideal**, con la ubicación exacta en el código fuente donde está programada cada una.

---

## 🗂️ ÍNDICE DE ARCHIVOS CLAVE DONDE VIVEN LAS INSTRUCCIONES

1. **[`fichas_manager.js`](file:///C:/Users/boss1/.gemini/antigravity-ide/scratch/tu-techo-ideal-bot/fichas_manager.js)**:
   - Cerebro de las Fichas Técnicas Oficiales en Word (`.docx`).
   - Reglas de blindaje total, disponibilidad inmediata con ficha completa, respuestas a restricciones negativas documentadas y política de **Silencio Absoluto (100% callada)**.
2. **[`server.js`](file:///C:/Users/boss1/.gemini/antigravity-ide/scratch/tu-techo-ideal-bot/server.js)**:
   - Servidor principal, integración con Webhooks de Kommo, Google Sheets, OpenRouter (Claude Sonnet 4.5).
   - Prompts de atención inmobiliaria, inventario, detección de humano atendiendo (Handoff), notas de voz, mensajes irrelevantes y alertas de WhatsApp.
3. **[`handoffs.json`](file:///C:/Users/boss1/.gemini/antigravity-ide/scratch/tu-techo-ideal-bot/handoffs.json)**:
   - Registro en tiempo real de leads que ya están en manos de un asesor humano para no volver a responder.

---

## 📌 1. REGLAS DE LAS FICHAS TÉCNICAS EN WORD (CEREBRO DOCUMENTAL)
**Ubicación en código:** [`fichas_manager.js` (Líneas 200 a 275)](file:///C:/Users/boss1/.gemini/antigravity-ide/scratch/tu-techo-ideal-bot/fichas_manager.js#L200-L275)

Estas reglas aplican exclusivamente a los inmuebles documentados en archivos Word oficiales (ej: *La Candelaria* y *Lomas del Sol*):

| Regla | Comportamiento | Ejemplo / Detalle |
|---|---|---|
| **1. Enlaces / Interés General** | Confirma **"Sí, disponible."** y entrega de inmediato el resumen técnico estructurado del Word. | Metraje, ambientes, baños, equipamiento, servicios, canon/precio, negociación y restricciones. |
| **2. Negativas o Restricciones Documentadas** | Responde con la negativa oficial y la alternativa documentada. | - *¿Tiene gas directo?* -> "No posee gas directo, cuenta con cocina eléctrica."<br>- *¿Estacionamiento?* -> "No posee propio; disponible alquiler privado a media cuadra."<br>- *¿Mascotas/niños?* -> "No se admiten niños ni mascotas." |
| **3. Silencio Absoluto (100% Callada)** | Si el dato **NO** está en el Word o dice *"No especificado en la fuente"*, el bot se queda **100% callado** (`[SILENCIO]`). | - Color de paredes, piscina o gimnasio inexistentes.<br>- Gas o pozo en Lomas del Sol (donde dice no especificado). |
| **4. Solicitud de Citas** | Si piden ver el inmueble o agendar visita, responde cordialmente y escala al jefe. | *"Ok, ya consulto con mi jefe para agendar la cita."* |

---

## 📌 2. VALIDACIÓN DE ENLACES Y CÓDIGOS DE INMUEBLE ("SÍ / NO DISPONIBLE")
**Ubicación en código:** [`server.js` (Líneas 3400 a 3450 y 4216)](file:///C:/Users/boss1/.gemini/antigravity-ide/scratch/tu-techo-ideal-bot/server.js#L3400-L3450)

- **Instrucción:** Al recibir un enlace directo (Wasi, Mercado Libre, Web) o código de inmueble, se valida en la base de datos de Google Sheets o Word.
- **Respuesta sin rodeos:**
  - Si el estatus es `Disponible` -> Responde exactamente: **"Si, disponible"** (o la ficha Word si pertenece a un documento oficial).
  - Si el estatus es `No Disponible`, `Reservado`, `Vendido` o `Alquilado` -> Responde exactamente: **"No, disponible"**.
  - **Sin mensaje de bienvenida:** Se suprime el saludo largo de bienvenida para responder rápido y directo.

---

## 📌 3. CONTROL DE INTERVENCIÓN HUMANA (HANDOFF / NO INTERFERIR)
**Ubicación en código:** [`server.js` (Líneas 1939 a 2045 y 4200 a 4222)](file:///C:/Users/boss1/.gemini/antigravity-ide/scratch/tu-techo-ideal-bot/server.js#L1939-L2045)

- **Instrucción:** Si un asesor humano ya está atendiendo al cliente o intervino en la conversación de Kommo:
  1. El bot detecta la actividad humana en vivo o en el historial.
  2. Registra el lead en `handoffs.json`.
  3. Detiene inmediatamente el Salesbot (`stopKommoSalesbot`).
  4. **Se queda en silencio total:** El bot no vuelve a responder en esa conversación para no interferir con la labor del asesor.

---

## 📌 4. MENSAJES IRRELEVANTES Y AHORRO DE TOKENS (DEJAR EN VISTO)
**Ubicación en código:** [`server.js` (Líneas 4160 a 4180 y 4260)](file:///C:/Users/boss1/.gemini/antigravity-ide/scratch/tu-techo-ideal-bot/server.js#L4160-L4180)

- **Instrucción:** Mensajes donde la persona no pregunta por un inmueble, no envía enlace ni busca información inmobiliaria (mensajes casuales, spam, saludos sueltos sin seguimiento):
  - **Acción:** Se dejan en visto (`skip: true`).
  - **Objetivo:** Evitar consumo y gasto innecesario de tokens de inteligencia artificial.
  - **Antiduplicados:** Mutex Lock + Debounce de 15 segundos + Ventana de 15 minutos para mensajes repetidos para evitar doble respuesta.

---

## 📌 5. RESPUESTA CUANDO FALTA INFORMACIÓN Y ALERTA URGENTE A ROBERT
**Ubicación en código:** [`server.js` (Líneas 1446 y 4340 a 4360)](file:///C:/Users/boss1/.gemini/antigravity-ide/scratch/tu-techo-ideal-bot/server.js#L1446)

- **Instrucción:** Si el cliente pregunta por información que no existe o no tenemos acceso en la base de datos:
  - **Respuesta al cliente:**
    > *"Hola, bienvenido a Tu techo ideal, [buenos días/tardes]. Voy a consultar y ya le doy informacion."*
  - **Acción interna:** Se despacha una alerta urgente a Robert por WhatsApp indicando el lead y la consulta para que el equipo humano proceda a responder.

---

## 📌 6. PROMPT DE ATENCIÓN PROFESIONAL (BASE DE DATOS GOOGLE SHEETS)
**Ubicación en código:** [`server.js` (Líneas 1682 a 1732)](file:///C:/Users/boss1/.gemini/antigravity-ide/scratch/tu-techo-ideal-bot/server.js#L1682-L1732)

- **Fuente única autorizada:** Columna `DESCRIPCION_BREVE` de Google Sheets. Prohibido inventar datos de otras columnas.
- **Consultas directas y secas:** Interpreta consultas como *"mts"*, *"m2"*, *"gas"*, *"precio"*, *"amoblado"* y responde directamente.
- **Siglas de Metraje:** "mts", "m2", "metros" equivalen a metros cuadrados.
- **Agendar Cita:** Responde *"Ok, ya consulto con mi jefe para agendar la cita"* y activa la etiqueta interna `[ACCION: AGENDAR_CITA]`.
- **Dato no explícito:** Si no está claro en `DESCRIPCION_BREVE`, responde *"Deme un momento, voy a consultar"*.
- **Sin códigos internos:** Prohibido mencionar códigos internos como `REF-xxx` al cliente.

---

## 📌 7. PROMPT DE INVENTARIO Y RECOMENDACIONES (BÚSQUEDA GENERAL)
**Ubicación en código:** [`server.js` (Líneas 3066 a 3102)](file:///C:/Users/boss1/.gemini/antigravity-ide/scratch/tu-techo-ideal-bot/server.js#L3066-L3102)

- **Saludo oficial:** *"Hola, bienvenido a Tu techo ideal"*.
- **Presupuestos y Rangos:** Si no hay en el presupuesto exacto, se indica con amabilidad y se recomienda **exactamente la 1 opción más cercana** disponible en inventario.
- **Zonas:** Si no hay en la zona solicitada, se recomienda la opción más cercana disponible.
- **Colegas inmobiliarios / Alianzas:** Se comparte el enlace de fotos neutro (Rexup) sin datos de contacto personales.
- **Cierre comercial:** Finaliza con:
  > *"¿Te gustaría coordinar una visita presencial, para conocerlo en persona?"*

---

## 📌 8. NOTAS DE VOZ Y MENCIONES DE INSTAGRAM
**Ubicación en código:** [`server.js` (Líneas 4224 a 4254)](file:///C:/Users/boss1/.gemini/antigravity-ide/scratch/tu-techo-ideal-bot/server.js#L4224-L4254)

- **Notas de voz / Audios:**
  - 0 mensajes al cliente (silencio absoluto).
  - Alerta inmediata a Robert por WhatsApp con el link del chat para que escuche y responda él.
- **Menciones en historias / Reels:**
  - Descarte silencioso (0 mensajes al cliente y 0 alertas a Robert).

---

## 📌 9. DESPACHO DE ALERTA AL ASESOR Y REPORTE GERENCIAL A ROBERT
**Ubicación en código:** [`server.js` (Líneas 894 a 1030)](file:///C:/Users/boss1/.gemini/antigravity-ide/scratch/tu-techo-ideal-bot/server.js#L894-L1030)

- Cuando se atiende una consulta de un inmueble:
  1. Se identifica el asesor comercial asignado en Google Sheets.
  2. Se envía un mensaje al WhatsApp del asesor:
     > *"¡Termina de asesorarlo! [Nombre cliente] por [Red Social], se le acaba de responder esta consulta: [url/mensaje]"*
  3. Se genera un reporte de supervisión gerencial despachado a Robert Jiménez con fecha, hora, asesor notificado e inmueble consultado.
