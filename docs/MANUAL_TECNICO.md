# MANUAL TÉCNICO DEL SISTEMA — TU TECHO IDEAL V5.0

## 1. DESCRIPCIÓN GENERAL
Tu Techo Ideal v5.0 es un microservicio desacoplado de alta confiabilidad diseñado para automatizar la atención inmobiliaria inicial, la verificación de disponibilidad y la respuesta a consultas sobre propiedades en venta y alquiler, integrando **Kommo CRM**, **Google Sheets** y modelos de lenguaje a través de una arquitectura centralizada, determinista y segura.

---

## 2. ARQUITECTURA DEL PIPELINE CENTRAL
El microservicio reemplaza la dispersión de reglas previas por un **Pipeline de Decisión Centralizado** implementado en [`pipeline_decision.js`](../pipeline_decision.js) y orquestado desde [`server.js`](../server.js).

### Flujo de Evaluación por Prioridades Estrictas:
1. **Prioridad 1 — Menciones y Eventos de Redes:**
   - Filtra notificaciones casuales de Instagram, Facebook o menciones en historias (`isSocialMediaEventOrMention`).
   - Resultado: Silencio absoluto sin invocar IA (0 tokens).
2. **Prioridad 2 — Bloqueo por Intervención Humana (12 Horas):**
   - Si un asesor humano intervino (`outgoing_chat_message` de Kommo Web o WhatsApp), el bot permanece en silencio total durante 12 horas (`hoursElapsed < 12`).
   - Resultado: `SILENCE / HUMAN_LOCKED` (0 tokens).
   - Prevalencia absoluta sobre cualquier respuesta automática.
3. **Prioridad 3 — Solicitud de Cita / Reunión / Saludo Plano:**
   - Peticiones de agendar visita, negociación o captación activan derivación a asesor y silencio.
   - Saludos planos sin consulta inmobiliaria se dejan para atención humana.
4. **Prioridad 4 — Múltiples Inmuebles:**
   - Si un mensaje contiene más de un código o enlace Wasi, se prohíbe mezclar fichas y se deriva a humano en silencio (`MULTIPLE_PROPERTIES`).
5. **Prioridad 5 — Enlace Wasi / Disponibilidad Canónica:**
   - Al recibir un enlace oficial de Wasi, valida el estatus en tiempo real en Google Sheets:
     - Si está disponible: responde exactamente `"Bienvenido a Tu Techo Ideal, sí, disponible."` (Constante centralizada `AVAILABILITY_RESPONSE`).
     - Almacena el inmueble en el contexto aislado de la conversación (`ConversationContextManager`).
6. **Prioridad 6 — Extracción Determinista desde Google Sheets (0 Tokens):**
   - Para consultas sencillas sobre la propiedad activa (metraje, precio, habitaciones, baños, condominio):
     - Extrae el dato verificado directamente de `DESCRIPCION_BREVE` mediante [`extractDeterministicPropertyFeature`](../pipeline_decision.js).
     - Si la información es ambigua o no existe en Sheets: guarda silencio absoluto (`PROPERTY_FEATURE_SIN_DATO`).
7. **Prioridad 7 — Consultas Complejas con IA (Fail-Closed):**
   - Preguntas complejas invocan al modelo de lenguaje con esquema estructurado `{ has_data, answer, evidence }`.
   - Se valida que `evidence` exista textualmente en Google Sheets antes de autorizar cualquier envío.
   - Ante errores de API (ej. HTTP 429), opera en **falla cerrada (silencio total)**.

---

## 3. COMPONENTES Y MANAGERS CLAVE

- **`HandoffManager` ([`pipeline_decision.js`](../pipeline_decision.js)):**
  - Gestiona el estado de bloqueo de 12 horas por `talkId`, `leadId` y `contactId`.
  - Persistencia híbrida en disco (`handoffs.json`) y sincronización en vivo con la API de Eventos de Kommo ante reinicios.
  - Reinicio automático a cero ante cada nueva intervención del asesor.
- **`ConversationContextManager` ([`pipeline_decision.js`](../pipeline_decision.js)):**
  - Mantiene el contexto de la propiedad activa por conversación (`talkId`).
  - Garantiza que al cambiar de propiedad en un mismo chat se actualice la ficha sin mezclar datos.
- **`DeduplicationManager` ([`pipeline_decision.js`](../pipeline_decision.js)):**
  - Mutex Lock en memoria para evitar condiciones de carrera por webhooks simultáneos.
  - Ventana de deduplicación de 15 minutos para evitar respuestas dobles.
- **`classifyOutgoingMessage` ([`pipeline_decision.js`](../pipeline_decision.js)):**
  - Clasifica mensajes salientes:
    - Asesor Web (`author.type === 'user'`, `created_by > 0`) $\to$ Inicia bloqueo de 12h.
    - Asesor WhatsApp Móvil (`created_by === 0`, texto manual) $\to$ Inicia bloqueo de 12h.
    - Salesbot / Sistema / App (`author.type === 'bot' | 'system' | 'app'`) $\to$ Descartado como eco del sistema (NO bloquea).

---

## 4. ENDPOINTS DIAGNÓSTICOS Y SEGURIDAD

- **`GET /health`:** Diagnóstico público de salud (uptime, service version, observation_mode, model).
- **`GET /api/staging/controlled-dispatch-status`:** Estado de la lista blanca de despachos (requiere `x-staging-auth`).
- **`POST /api/staging/test-pipeline-evaluation`:** Evaluación determinista del pipeline en Staging con soporte de tiempo simulado (requiere `x-staging-auth`).
- **Guardián de Aislamiento:** Las rutas de prueba exigen estrictamente `NODE_ENV === 'staging'`, hostname autorizado `tu-techo-ideal-staging.onrender.com` y autenticación segura con `crypto.timingSafeEqual`. En producción devuelven HTTP 404/401.



## 13. AUTOMATIZACIÓN DE FACEBOOK MESSENGER Y GESTIÓN MULTICANAL

Tu Techo Ideal V5.0 implementa soporte nativo desacoplado para **Facebook Messenger** integrado en Kommo CRM:
1. **Canal de Origen Inequívoco:** Mediante `resolveCommunicationChannel`, el sistema detecta `origin: "facebook"` o `source_id: 44070 / 44072`.
2. **Exclusión de Comentarios Públicos:** Mediante `isFacebookPublicComment`, se filtran los comentarios en publicaciones, garantizando que el asistente virtual opere exclusivamente en mensajes privados (inbox 1 a 1).
3. **Flujo de Respuesta:** El bot procesa el mensaje con el inventario de Google Sheets, actualiza el campo `2103996` (`Respuesta_IA`) y dispara Salesbot (`POST /api/v4/bots/100766/run`), el cual entrega la respuesta dentro de la misma conversación en Messenger.
4. **Auto-Aceptación de Leads:** La función `ensureLeadInActivePipeline` auto-acepta prospectos en "Leads Entrantes" (`status_id: 108871567`) pasándolos a "Contacto inicial" (`status_id: 108871571`, `responsible_user_id: 15568119`) permitiendo la ejecución de Salesbot.
5. **Alertas a Robert:** Si el cliente solicita visita, reserva o atención humana, se alerta a Robert por WhatsApp con la etiqueta `🌐 *Canal:* Facebook Messenger` y enlace directo para atender el chat en Kommo.
