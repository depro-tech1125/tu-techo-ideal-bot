# SUPERVISIÓN, MANTENIMIENTO Y RECUPERACIÓN ANTE ERRORES — TU TECHO IDEAL V5.0

---

## 1. SUPERVISIÓN Y MONITOREO DEL SERVICIO

### 1.1 Endpoint Público de Salud (`GET /health`)
El microservicio expone un endpoint público de monitoreo accesible sin autenticación, ideal para verificaciones de uptime (ej. UptimeRobot, Pingdom, BetterStack):
- **URL Staging:** `https://tu-techo-ideal-staging.onrender.com/health`
- **URL Producción:** `https://tu-techo-ideal-bot-1.onrender.com/health`

#### Ejemplo de Respuesta JSON Saludable:
```json
{
  "status": "running",
  "service": "Tu Techo Ideal Bot Microservice - v5.0 Deterministic Central Pipeline Edition",
  "observation_mode": true,
  "pipeline_controller": "pipeline_decision.js",
  "claude_enabled": true,
  "claude_model": "nvidia/nemotron-3.5-lightning:free",
  "credits_remaining_usd": 0,
  "uptime_seconds": 1420
}
```

#### Interpretación de Campos:
- `status`: `"running"` confirma que el bucle de eventos de Node.js y el servidor Express responden normalmente.
- `service`: Identifica la versión activa y el controlador del pipeline.
- `observation_mode`: En Staging debe ser siempre `true` para proteger los canales reales.
- `uptime_seconds`: Segundos continuos desde el último arranque o despliegue.

---

### 1.2 Interpretación de Registros y Logs en Render
Los logs del microservicio están estructurados para identificar con claridad cada decisión operativa:

| Etiqueta en Log | Significado Operativo | Acción del Operador |
| :--- | :--- | :--- |
| `[MUTEX LOCKED]` | Petición concurrente o duplicada interceptada. | Ninguna. Comportamiento normal de protección contra duplicados. |
| `[HUMAN_LOCKED]` | Conversación en bloqueo de 12 horas por intervención humana. | Ninguna. Confirma que el bot no interferirá con el asesor. |
| `[DETERMINISTIC_EXTRACTION]` | Consulta (precio, metros, habitaciones) respondida directamente desde Google Sheets (0 tokens). | Normal. Confirma respuesta inmediata sin costo de IA. |
| `[WASI_LINK_AVAILABLE]` | Confirmación canónica de disponibilidad enviada (*"Bienvenido a Tu Techo Ideal, sí, disponible."*). | Normal. Nuevo lead o propiedad identificada. |
| `[FAIL_CLOSED_SILENCE]` | Falla en proveedor de IA (ej. HTTP 429) o evidencia no verificada. El bot guardó silencio. | Normal. Previene alucinaciones o errores visibles al cliente. |
| `[KOMMO_EVENTS_RECONCILED]` | Reconciliación exitosa de eventos de intervención humana tras reinicio. | Normal en proceso de inicialización. |

---

## 2. PROCEDIMIENTO DE RECUPERACIÓN ANTE INCIDENCIAS (DISASTER RECOVERY)

### 2.1 Reinicio Inesperado del Servidor
- **Diagnóstico:** `uptime_seconds` se reinicia a valores bajos (< 60s) o Render reporta un despliegue/reinicio.
- **Mecanismo Automático de Recuperación:**
  1. El gestor [`HandoffManager`](../pipeline_decision.js) lee inmediatamente el archivo de persistencia local `handoffs.json`.
  2. A continuación, realiza una consulta a la API de Eventos de Kommo (`/api/v4/events?filter[type]=outgoing_chat_message`) para sincronizar cualquier mensaje saliente de asesores ocurrido durante el reinicio.
  3. Los bloqueos de 12 horas se restablecen instantáneamente sin pérdida de estado.
- **Acción Manual Requerida:** Ninguna. El sistema se auto-recupera de manera autónoma.

---

### 2.2 Falla Temporal de la API de Kommo CRM (HTTP 500 / Timeout)
- **Diagnóstico:** Logs reportan `[KOMMO_API_ERROR]` o tiempos de respuesta > 5000 ms al consultar eventos.
- **Comportamiento Seguro (Fail-Closed):**
  - Ante la imposibilidad de confirmar si un asesor intervino o no, el microservicio asume preventivamente que la conversación **está bloqueada**.
  - El bot guarda silencio total para garantizar que ningún cliente reciba un mensaje automático si un asesor estaba atendiéndolo.
- **Acción Manual Requerida:** Verificar el estatus del servicio en [status.kommo.com](https://status.kommo.com). Una vez restablecido el CRM, el microservicio volverá a operar automáticamente.

---

### 2.3 Límite de Cuota en OpenRouter (HTTP 429: Rate Limit Exceeded)
- **Diagnóstico:** Logs reportan `[OPENROUTER_RATE_LIMIT]` al intentar responder consultas complejas no estructuradas.
- **Comportamiento Seguro:**
  - El **Extractor Determinista** continúa respondiendo con total normalidad las consultas de disponibilidad, metraje, precio, habitaciones y baños (el 95% del volumen de chat).
  - Las preguntas abiertas complejas se silencian de forma segura (Fail-Closed) sin emitir mensajes rotos ni alucinaciones.
- **Acción Manual Requerida:** Si se requiere atender preguntas abiertas complejas con IA, añadir saldo a la cuenta de OpenRouter o cambiar al modelo de pago correspondiente en las variables de entorno.

---

### 2.4 Error de Acceso o Actualización en Google Sheets
- **Diagnóstico:** Logs reportan `[SHEETS_SYNC_ERROR]` o respuesta vacía al actualizar el inventario.
- **Mecanismo de Respaldo:**
  - El sistema mantiene en memoria la última versión válida de las 69+ propiedades indexadas.
  - Continúa operando con los datos en memoria hasta que la conexión con Google Cloud se restablezca.
- **Acción Manual Requerida:** Verificar que la URL de Google Sheets o los permisos de la cuenta de servicio sigan activos y no hayan sido revocados.

