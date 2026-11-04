# LIMITACIONES CONOCIDAS Y DEPENDENCIAS EXTERNAS — TU TECHO IDEAL V5.0

---

## 1. DEPENDENCIAS EXTERNAS Y MATICES DE INTEGRACIÓN

El microservicio depende de cuatro plataformas tecnológicas principales para su funcionamiento integral:

### 1.1 Kommo CRM (Plataforma Central e Ingesta Omnicanal)
- **Rol en el Microservicio:** Recepción de mensajes entrantes y salientes a través de webhooks HTTP POST (`message[add]` y `outgoing_chat_message`).
- **Distinción Operativa entre Integración y Conexión de Canales:**
  - El microservicio está técnicamente preparado y es agnóstico al canal de origen (unificado por Kommo).
  - **Canal WhatsApp:** Conectado, integrado y probado activamente.
  - **Canales Instagram Direct, Facebook Messenger y TikTok:** La recepción depende de que el cliente complete la vinculación de sus cuentas y tokens OAuth en el panel de Kommo CRM. El microservicio descarta correctamente menciones de historias y reacciones sociales (`isSocialMediaEventOrMention`), pero no gestiona la autenticación directa con Meta o ByteDance.
- **API v4 de Eventos:** Utilizada para consultar intervenciones históricas de asesores y sincronizar el bloqueo humano tras reinicios.

### 1.2 Google Sheets API v4 (Inventario)
- **Mecanismo Real de Lectura y Sincronización:**
  - El microservicio no realiza consultas celda por celda en tiempo real por cada mensaje de chat (lo cual agotaría las cuotas de Google Cloud).
  - Descarga el catálogo completo al iniciar y lo indexa en memoria con un mecanismo de caché con TTL.
  - La sincronización se realiza en segundo plano o bajo demanda. Si la API de Google Sheets no responde temporalmente, el bot sigue operando con la última versión válida retenida en memoria.
- **Estructura Semiestructurada:** Atributos como metraje, precio, habitaciones y baños están en la columna `DESCRIPCION_BREVE`. El extractor determinista utiliza regexes estrictas y normalización monetaria. Si la descripción es ambigua (ej. no especifica venta vs alquiler o terreno vs construcción), el bot guarda silencio absoluto por política de cero invención.

### 1.3 OpenRouter (Proveedor de IA)
- **Limitaciones del Modelo Gratuito en Staging:**
  - El modelo `nvidia/nemotron-3.5-lightning:free` está sujeto a restricciones de frecuencia por minuto y cuota diaria global.
  - **Comportamiento ante HTTP 429:** Ante errores de límite de tasa, el bot opera bajo el principio de **Falla Cerrada (Fail-Closed)**, guardando silencio absoluto para no emitir respuestas incompletas ni alucinar.
  - **Desacoplamiento:** Gracias a la Prioridad 6 (Extractor Determinista), el 95% de las consultas comunes de clientes (precio, metraje, habitaciones, baños, disponibilidad) no consumen tokens ni invocan a OpenRouter, blindando la experiencia comercial contra errores 429.

### 1.4 Render Cloud Platform (Hospedaje)
- **Naturaleza del Sistema de Archivos:** El disco local es efímero entre despliegues mayores, por lo que el archivo local `handoffs.json` se complementa con la reconciliación automática con la API de Eventos de Kommo al arrancar el contenedor.

---

## 2. LIMITACIONES TÉCNICAS Y OPERATIVAS CONOCIDAS

### 2.1 Una Sola Propiedad Activa por Conversación
- El sistema gestiona el contexto de una propiedad a la vez por conversación (`talkId`).
- Si un cliente envía dos o más enlaces Wasi en un mismo mensaje, el bot se silencia deliberadamente (`MULTIPLE_PROPERTIES`) para evitar mezclar fichas técnicas. Esta situación requiere atención del asesor humano.

### 2.2 Detección de Intención vs Alertas Externas al Asesor
- **Implementado y Probado:** Detección de alta intención de compra, solicitudes de cita presencial, reunión, ofertas de precio o captación de propiedades. Ante estos casos, el bot guarda silencio absoluto y deriva la conversación al asesor (`APPOINTMENT_REQUEST` / `HUMAN_LOCKED`).
- **No Implementado en el Microservicio:** El despacho de alertas externas automáticas (ej. SMS o mensajes push de WhatsApp al teléfono personal del asesor) no forma parte del microservicio, ya que requiere plantillas HSM autorizadas por Meta y pasarelas de pago SMS/WhatsApp dedicadas. La alerta se gestiona dentro del flujo nativo de leads y tareas de Kommo CRM.

### 2.3 Solicitudes de Cita y Negociación no Automatizadas
- El bot no agenda citas en calendarios externos ni negocia precios. La labor de cierre comercial y negociación permanece 100% bajo control de los asesores humanos.

### 2.4 Supervisión Básica vs Monitoreo Externo Avanzado
- **Supervisión Incluida:** Endpoint `/health` con diagnóstico de uptime, servicio y logs estructurados por acción en la consola de Render.
- **Monitoreo No Incluido:** No se integran plataformas de APM de terceros (Datadog, New Relic, Sentry, BetterStack) por no formar parte del alcance técnico.

### 2.5 Soporte Documental vs Capacitación/Mantenimiento Continuo
- **Incluido:** Entrega formal de 9 manuales y guías técnicas/operativas completas.
- **No Incluido:** El presente cierre de desarrollo no contempla servicios de soporte técnico continuo 24/7, guardias operativas ni sesiones de capacitación presencial no contratadas.

---

## 3. ESTIMACIÓN DE COSTOS OPERATIVOS

| Componente | Nivel Actual / Recomendado | Costo Estimado Mensual |
| :--- | :--- | :--- |
| **Kommo CRM** | Suscripción existente de la agencia | Cubierto por la empresa |
| **Render Web Service** | Starter Instance (24/7 sin suspensión) | \$7.00 USD / mes |
| **Google Cloud / Sheets API** | Free Tier (cuotas estándar de lectura) | \$0.00 USD |
| **OpenRouter (IA)** | Con extracción determinista (95% de ahorro) | \$0.00 a \$2.00 USD / mes |
| **Total Estimado de Operación** | | **~\$7.00 a \$9.00 USD / mes** |
