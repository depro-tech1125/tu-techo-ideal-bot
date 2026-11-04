# DICCIONARIO DE VARIABLES DE ENTORNO — TU TECHO IDEAL V5.0

Este documento detalla todas las variables de entorno utilizadas por el microservicio Tu Techo Ideal v5.0. 
Por motivos estrictos de seguridad, **ningún secreto o valor real está expuesto en este documento**. Todos los valores sensibles se muestran como `[PROTEGIDO]` o con formatos de ejemplo ilustrativos.

---

## 1. VARIABLES DEL SISTEMA Y OPERACIÓN GENERAL

| Variable | Descripción | Entorno | Sensibilidad | Ejemplo Ilustrativo |
| :--- | :--- | :--- | :--- | :--- |
| `NODE_ENV` | Define el entorno de ejecución (`production` o `staging`). Crucial para las reglas de aislamiento de seguridad. | Ambos | Pública | `production` / `staging` |
| `PORT` | Puerto TCP en el que escucha el servidor HTTP de Express. Asignado dinámicamente por Render. | Ambos | Pública | `10000` |
| `OBSERVATION_MODE` | Modo observador (`true` o `false`). Cuando está en `true`, el bot evalúa y registra decisiones en logs pero no envía mensajes a clientes. | Ambos | Pública | `true` (en Staging) / `false` (en Producción) |

---

## 2. INTEGRACIÓN CON KOMMO CRM

| Variable | Descripción | Entorno | Sensibilidad | Ejemplo Ilustrativo |
| :--- | :--- | :--- | :--- | :--- |
| `KOMMO_SUBDOMAIN` | Subdominio de la cuenta de Kommo CRM (ej. `tutechoideal`). | Ambos | Pública | `tutechoideal` |
| `KOMMO_TOKEN` | Token de autenticación de larga duración (Bearer JWT) para acceder a la API v4 de Kommo (consulta de eventos, notas y leads). | Ambos | **Alta (Secreto)** | `[PROTEGIDO - JWT Token]` |
| `KOMMO_ACCOUNT_ID` | Identificador numérico de la cuenta corporativa en Kommo CRM. | Ambos | Pública | `31234567` |
| `KOMMO_BOT_ID` | ID de usuario asignado al bot o Salesbot en Kommo para distinguir mensajes automáticos de humanos. | Ambos | Pública | `0` |
| `KOMMO_RESPONSIBLE_ID` | ID del usuario asesor predeterminado responsable en Kommo CRM. | Ambos | Pública | `1234567` |
| `KOMMO_FIELD_ID` | ID del campo personalizado en Kommo donde se almacena el enlace o contexto del inmueble. | Ambos | Pública | `987654` |
| `ROBERT_KOMMO_LEAD_ID` | ID del lead de control interno para notificaciones directas al responsable. | Opcional | Pública | `26066502` |
| `ROBERT_WHATSAPP` | Número telefónico en formato internacional para alertas críticas del responsable comercial. | Opcional | Confidencial | `+58414XXXXXXX` |

---

## 3. INTEGRACIÓN CON GOOGLE SHEETS

| Variable | Descripción | Entorno | Sensibilidad | Ejemplo Ilustrativo |
| :--- | :--- | :--- | :--- | :--- |
| `GOOGLE_SHEET_CSV_URL` | URL de publicación en formato CSV o endpoint de consulta pública/restringida de la hoja de cálculo oficial de inventario. | Ambos | Confidencial | `https://docs.google.com/spreadsheets/d/.../export?format=csv` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Correo de la cuenta de servicio de Google Cloud para lectura vía API oficial (si aplica). | Ambos | Confidencial | `tutecho-service@[PROTEGIDO].iam.gserviceaccount.com` |
| `GOOGLE_PRIVATE_KEY` | Clave privada RSA de la cuenta de servicio de Google Cloud (si aplica). | Ambos | **Alta (Secreto)** | `[PROTEGIDO - RSA Private Key]` |

---

## 4. INTEGRACIÓN CON PROVEEDORES DE IA (OPENROUTER)

| Variable | Descripción | Entorno | Sensibilidad | Ejemplo Ilustrativo |
| :--- | :--- | :--- | :--- | :--- |
| `OPENROUTER_API_KEY` | Clave de API de OpenRouter para la ejecución de consultas complejas no cubiertas por el extractor determinista. | Ambos | **Alta (Secreto)** | `[PROTEGIDO - sk-or-v1-...]` |
| `CLAUDE_MODEL` | Identificador del modelo LLM a utilizar. | Ambos | Pública | `nvidia/nemotron-3.5-lightning:free` / `anthropic/claude-sonnet-4.5` |
| `DISABLE_CLAUDE` | Bandera booleana para forzar apagado de llamadas a IA (`true` o `false`), garantizando operación 100% determinista. | Ambos | Pública | `false` |

---

## 5. SEGURIDAD Y CONTROL DE PRUEBAS EN STAGING

> [!WARNING]
> Las variables de esta sección son exclusivas del entorno de **Staging**. Bajo ninguna circunstancia deben existir ni configurarse en el entorno de Producción.

| Variable | Descripción | Entorno | Sensibilidad | Ejemplo Ilustrativo |
| :--- | :--- | :--- | :--- | :--- |
| `STAGING_AUTH_TOKEN` | Token criptográfico aleatorio de alta entropía exigido en el encabezado HTTP `x-staging-auth` para endpoints de prueba controlada. | **Solo Staging** | **Alta (Secreto)** | `[PROTEGIDO - Hex Token]` |
| `STAGING_TEST_DISPATCH` | Habilita la lista blanca de despachos de prueba en Staging (`true` / `false`). En reposo debe ser `false`. | **Solo Staging** | Pública | `false` |
| `STAGING_MAX_TEST_DISPATCHES` | Límite máximo estricto de mensajes de prueba autorizados en Staging antes de autoapagado automático. | **Solo Staging** | Pública | `3` |
| `STAGING_ALLOWED_TALK_ID` | Identificador único de la conversación de prueba autorizada para despachos controlados. | **Solo Staging** | Pública | `synt_talk_test` |
| `STAGING_ALLOWED_LEAD_ID` | Identificador único del lead de prueba autorizado para despachos controlados. | **Solo Staging** | Pública | `synt_lead_test` |
| `STAGING_DISPATCH_TTL_MS` | Ventana de tiempo límite en milisegundos tras la cual la autorización de prueba expira automáticamente. | **Solo Staging** | Pública | `300000` (5 minutos) |
| `STAGING_BASE_URL` | URL base del microservicio en Staging para autoverificación interna de endpoints. | **Solo Staging** | Pública | `https://tu-techo-ideal-staging.onrender.com` |

---

## 6. NOTIFICACIONES Y ALERTAS (OPCIONALES)

| Variable | Descripción | Entorno | Sensibilidad | Ejemplo Ilustrativo |
| :--- | :--- | :--- | :--- | :--- |
| `ALERT_EMAIL` | Dirección de correo receptora de alertas de monitoreo y fallos de infraestructura. | Opcional | Confidencial | `alertas@[PROTEGIDO].com` |
| `RESEND_API_KEY` | Clave de API para despacho de correos transaccionales a través de Resend. | Opcional | **Alta (Secreto)** | `[PROTEGIDO]` |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | Parámetros de conexión a servidor SMTP tradicional de respaldo. | Opcional | **Alta (Secreto)** | `[PROTEGIDO]` |
| `WHATSAPP_GATEWAY_URL` | Endpoint del gateway de WhatsApp para despacho de mensajes en producción. | Producción | Confidencial | `https://gateway.[PROTEGIDO].com/api/send` |
| `CALLMEBOT_API_KEY` | Clave de API para envío de notificaciones de emergencia vía CallMeBot. | Opcional | Confidencial | `[PROTEGIDO]` |

---

## 7. POLÍTICA DE ROTACIÓN Y GESTIÓN DE SECRETOS EN RENDER
1. **Configuración en Render:**
   - Todos los secretos deben añadirse únicamente en la pestaña **Environment** del panel de control del servicio en Render.
   - Nunca deben introducirse secretos en archivos versionados (`render.yaml`, `package.json`, etc.).
2. **Rotación Segura:**
   - Para rotar `STAGING_AUTH_TOKEN` o `KOMMO_TOKEN`, generar un nuevo valor criptográfico seguro, actualizar el panel de Render y pulsar **Save Changes**. Render reiniciará automáticamente el servicio de forma segura y sin tiempo de inactividad.

