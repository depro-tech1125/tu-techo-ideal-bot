# MANUAL OPERATIVO COMERCIAL — TU TECHO IDEAL V5.0
**Guía de Uso y Protocolos para el Equipo de Asesores Inmobiliarios y Operaciones**

---

## 1. INTRODUCCIÓN Y PROPÓSITO
Tu Techo Ideal v5.0 cuenta con un asistente virtual de alta confiabilidad diseñado para:
1. **Atender inmediatamente** a clientes que consultan propiedades mediante enlaces oficiales de Wasi en WhatsApp o redes sociales unificadas en Kommo CRM.
2. **Responder de forma exacta** preguntas frecuentes sobre el inmueble consultado (metraje, precio, número de habitaciones y baños) extrayendo la información directamente del inventario oficial en Google Sheets.
3. **Respetar estrictamente la labor de los asesores humanos**, apagándose por completo cuando un asesor interviene para garantizar una experiencia de atención personalizada y sin interferencias.

---

## 2. COMPORTAMIENTO DEL ASISTENTE VIRTUAL

### A. Respuestas Automáticas Permitidas
El bot solo responde en dos situaciones específicas:
1. **Recepción de Enlace Oficial de Wasi:**
   - Si el enlace corresponde a un inmueble activo y disponible en Google Sheets, el bot responde textualmente:
     > *"Bienvenido a Tu Techo Ideal, sí, disponible."*
   - Al emitir esta respuesta, el bot fija dicha propiedad como la **propiedad activa** para esa conversación.
2. **Consultas Puntuales de la Propiedad Activa:**
   - Si el cliente pregunta por el área, metraje, precio, costo, habitaciones o baños, el bot extrae el dato exacto de Google Sheets y responde de inmediato (ej. *"Tiene 110 m²"*, *"$146.000"*, *"Tiene 3 habitaciones"*).
   - Esta respuesta es instantánea y se realiza sin margen de alucinación ni costo de IA.

### B. Regla de Silencio Absoluto (Cero Invención / Fail-Closed)
El bot se mantendrá en **silencio absoluto** (no enviará ningún mensaje) ante:
- **Saludos aislados o genéricos:** *"Hola"*, *"Buenas tardes"*, *"Información por favor"* sin enlace ni referencia de propiedad.
- **Menciones o notificaciones de redes sociales:** Reacciones a historias, menciones en Instagram o Facebook.
- **Datos no registrados en Google Sheets:** Si el cliente pregunta por piscina, canchas de tenis, costo de condominio o estacionamiento y dicho dato no está explícito en la ficha, el bot guarda silencio para que el asesor consulte con el propietario.
- **Múltiples inmuebles en el mismo mensaje:** Si el cliente envía dos o más enlaces Wasi a la vez, el bot no responde para evitar cruzar información de fichas distintas.
- **Peticiones de cita, reunión o negociación:** Mensajes que dicen *"quiero visitarlo"*, *"podemos agendar una cita"*, *"ofrezco $120.000"* o solicitudes de captación (*"quiero que vendan mi casa"*).

---

## 3. LA REGLA DE ORO: BLOQUEO HUMANO DE 12 HORAS

### ¿Cómo funciona?
1. **Activación Automática e Inmediata:**
   - En el instante exacto en que un asesor comercial envía un mensaje al cliente (ya sea redactado desde la plataforma web de Kommo CRM o directamente desde la aplicación móvil de WhatsApp vinculada), el sistema activa el **Bloqueo Humano**.
2. **Duración de 12 Horas:**
   - Durante las siguientes 12 horas continuas, el bot queda **completamente desactivado** para esa conversación.
   - Aunque el cliente envíe enlaces Wasi o haga preguntas sobre precios y metrajes, el bot no intervendrá bajo ninguna circunstancia.
3. **Reinicio por Nueva Intervención:**
   - Si el asesor vuelve a enviar un mensaje 6 horas después del primero, el temporizador de 12 horas **se reinicia a cero** (12 horas completas a partir de ese nuevo mensaje).
4. **Vencimiento del Bloqueo:**
   - Una vez transcurridas las 12 horas sin nuevos mensajes del asesor, el bot **NO** iniciará conversación ni enviará saludos.
   - El bot permanecerá dormido y solo se reactivará si el cliente formula una nueva consulta con datos verificados en Google Sheets.

---

## 4. PROTOCOLO OPERATIVO PARA EL ASESOR COMERCIAL

| Situación | Qué hace el Asesor | Qué hace el Bot |
| :--- | :--- | :--- |
| **Cliente envía link Wasi** | Puede dejar que el bot confirme disponibilidad (*"Bienvenido a Tu Techo Ideal, sí, disponible."*). | Responde la disponibilidad en < 5 segundos y espera. |
| **Cliente pregunta precio o metros** | El asesor puede responder si está conectado, o dejar que el bot informe el dato verificado. | Responde el dato exacto según Google Sheets. |
| **Asesor saluda o toma el chat** | Escribe directamente al cliente desde Kommo o WhatsApp. | **Se apaga inmediatamente por 12 horas.** |
| **Cliente pide visita o cita** | El asesor debe coordinar la fecha, hora y requisitos de visita. | Guarda silencio absoluto. No interfiere. |
| **Cliente envía 2 propiedades** | El asesor aclara cuál de las dos desea evaluar en primer lugar. | Guarda silencio absoluto (evita mezcla de datos). |
| **Cambio de propiedad** | Si el cliente envía un nuevo enlace Wasi, se actualiza el contexto. | Reconoce la nueva ficha y responde sobre ella. |

---

## 5. GUÍA DE MANTENIMIENTO DEL INVENTARIO EN GOOGLE SHEETS
Para que el asistente virtual extraiga la información de forma precisa y automática sin requerir tokens de IA, el equipo debe mantener el archivo de Google Sheets conforme a las siguientes pautas:

1. **Columna `ENLACE_PROPIEDAD`:**
   - Debe contener la URL completa de Wasi (ej. `https://tutechoideal.com.ve/inmueble/apartamento-en-venta-los-samanes-caracas/1234567`).
2. **Columna `ESTATUS`:**
   - Debe estar en `"DISPONIBLE"` para que el bot confirme su existencia. Cualquier otro estatus (ej. `"RESERVADO"`, `"VENDIDO"`, `"DISPONIBLE EN 15 DÍAS"`) causará que el bot no confirme disponibilidad.
3. **Columna `DESCRIPCION_BREVE` (Estructura de Redacción Recomendada):**
   - **Metraje:** Escribir el valor numérico acompañado de `m²` o `mts2` (ej. `110 m²`, `80,45 m²`).
   - **Precio:** Indicar la divisa y el monto formateado (ej. `$146.000`, `USD 355.674`). Si la propiedad es tanto para venta como alquiler, especificar claramente `precio de venta: $X` y `canon de alquiler: $Y` para evitar ambigüedades.
   - **Habitaciones y Baños:** Escribir con claridad (ej. `3 habitaciones`, `dos baños completos y un medio baño`).
   - **Condominio / Gastos comunes:** Si se conoce el monto exacto mensual, incluirlo (ej. `condominio aproximado: $80`). Si no está incluido, el bot guardará silencio ante preguntas sobre este tema.

