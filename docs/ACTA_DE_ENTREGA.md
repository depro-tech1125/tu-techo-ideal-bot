# ACTA FORMAL DE ENTREGA Y CIERRE DE DESARROLLO
## PROYECTO: TU TECHO IDEAL V5.0

---

En la fecha **04 de Noviembre de 2026**, se formaliza la entrega técnica y el cierre del ciclo de desarrollo del proyecto **Tu Techo Ideal v5.0**, correspondiente al microservicio de automatización de atención inmobiliaria e integración omnicanal.

---

### 1. DATOS GENERALES DEL PROYECTO
- **Nombre del Software:** Tu Techo Ideal Bot Microservice.
- **Versión Entregada en Staging:** v5.0 (Deterministic Central Pipeline Edition).
- **Commit Oficial de la Versión:** `eb4b622` (en rama `feature/reinicio-logica-inmobiliaria`).
- **Plataformas Involucradas:** Node.js (Express), Kommo CRM, Google Sheets, OpenRouter, Render Cloud Platform.

---

### 2. ALCANCE DESARROLLADO Y COMPROBADO
El equipo de ingeniería entrega las siguientes capacidades comprobadas y validadas mediante pruebas automatizadas y en vivo:

1. **Pipeline de Decisión Centralizado (7 Prioridades):**
   - Arquitectura unificada en [`pipeline_decision.js`](../pipeline_decision.js) que sustituye la dispersión previa de reglas.
2. **Bloqueo por Intervención Humana de 12 Horas:**
   - Detección precisa de intervenciones de asesores comerciales desde Kommo Web o WhatsApp móvil.
   - Apagado total del asistente durante 12 horas exactas (`hoursElapsed < 12`).
   - Reinicio del contador de 12 horas a cero ante cada nueva intervención humana.
   - Persistencia híbrida en disco (`handoffs.json`) y reconciliación automática con la API de Eventos de Kommo ante reinicios.
3. **Extractor Determinista desde Google Sheets (0 Tokens de IA):**
   - Resolución inmediata de preguntas de disponibilidad (*"Bienvenido a Tu Techo Ideal, sí, disponible."*), metraje, precio, habitaciones y baños directamente desde el catálogo de Google Sheets.
   - Latencia menor a 5 milisegundos y costo cero de tokens de IA para el 95% de las consultas habituales.
4. **Política de No Invención y Comportamiento Fail-Closed:**
   - Silencio absoluto ante datos no verificados en Google Sheets (ej. costo de condominio, piscina, áreas deportivas).
   - Silencio absoluto y derivación a asesor ante solicitudes de cita, reunión o negociación.
   - Silencio absoluto ante caídas de red o límites de cuota de proveedores externos (HTTP 429).
5. **Aislamiento y Concurrencia:**
   - Desduplicación de webhooks y protección de carrera con `DeduplicationManager` (Mutex Lock en memoria).
   - Aislamiento estricto de fichas técnicas por conversación (`talkId`) al consultar diferentes propiedades (REF-012 y REF-005).
6. **Seguridad y Blindaje de Entornos:**
   - Rotación y eliminación de tokens expuestos en fases preliminares.
   - Restricción estricta del reloj simulado y endpoints de prueba al entorno de Staging con autenticación segura (`crypto.timingSafeEqual`).
   - Inviolabilidad de Producción con `Date.now()` nativo inmutable.

---

### 3. RESUMEN DE PRUEBAS Y VALIDACIÓN TÉCNICA
- **Pruebas de Regresión Global:** **44 / 44 superadas (100%)** en [`test_suite_nueva_logica.js`](../test_suite_nueva_logica.js).
- **Pruebas de Extracción Determinista:** **10 / 10 superadas (100%)** en [`test_suite_extraccion_determinista.js`](../test_suite_extraccion_determinista.js).
- **Validación Comercial en Vivo en Staging:** **12 / 12 escenarios superados (100%)** en [`scripts/execute_fase2_commercial_validation.js`](../scripts/execute_fase2_commercial_validation.js).

---

### 4. ESTADO DE LOS ENTORNOS DE DESPLIEGUE
- **Entorno de Staging (`tu-techo-ideal-staging.onrender.com`):**
  - Desplegado y operativo con la **Versión 5.0** (Commit `eb4b622`).
  - Modo observador activado (`OBSERVATION_MODE=true`). Despachos reales bloqueados.
- **Entorno de Producción (`tu-techo-ideal-bot-1.onrender.com`):**
  - Operando en la **Versión 4.1** (Commit `e4f82ff`).
  - Rama `main` **completamente intacta**.
  - **No se ha ejecutado ningún despliegue a Producción.** La autorización del pase a producción corresponde exclusivamente a la dirección del proyecto.

---

### 5. RESPONSABILIDADES Y DEPENDENCIAS OPERATIVAS DEL CLIENTE
Para la entrada en operación comercial plena, quedan bajo responsabilidad del cliente las siguientes actividades operativas:
1. **Vinculación de Canales en Kommo CRM:** Vincular las cuentas comerciales de Instagram y TikTok en el módulo de canales de Kommo CRM si se desea recibir mensajes directos de dichas plataformas.
2. **Gestión de Saldo en Proveedor de IA:** En caso de habilitar respuestas abiertas a preguntas complejas no estructuradas, recargar saldo en OpenRouter o configurar una API Key de pago para evitar el límite de tasa gratuito (HTTP 429).
3. **Mantenimiento del Catálogo en Google Sheets:** Mantener la redacción clara de los atributos en la columna `DESCRIPCION_BREVE` según las pautas del Manual Operativo Comercial. Opcionalmente, importar en Google Drive el archivo generado `google_sheet_Hoja1_COMPLETA_ACTUALIZADA.xlsx` (respaldo original en `google_sheet_backup_original.xlsx`).
4. **Pase a Producción:** Evaluar y autorizar el merge de la rama `feature/reinicio-logica-inmobiliaria` hacia `main` en Render conforme al protocolo del Piloto Comercial de 7 Días.

---

### 6. PAQUETE DE DOCUMENTACIÓN ENTREGADO
El paquete documental formal consta de los siguientes 10 documentos alojados en la carpeta [`docs/`](./):
1. [`INFORME_EJECUTIVO_FINAL.md`](./INFORME_EJECUTIVO_FINAL.md) — Evaluación ejecutiva del estado real del sistema y cierre.
2. [`MANUAL_TECNICO.md`](./MANUAL_TECNICO.md) — Especificación técnica del pipeline, prioridades y managers.
3. [`MANUAL_OPERATIVO_COMERCIAL.md`](./MANUAL_OPERATIVO_COMERCIAL.md) — Guía para asesores, reglas de silencio y bloqueo de 12 horas.
4. [`ARQUITECTURA_E_INTEGRACIONES.md`](./ARQUITECTURA_E_INTEGRACIONES.md) — Diagramas de flujo y arquitectura de red.
5. [`VARIABLES_ENTORNO.md`](./VARIABLES_ENTORNO.md) — Diccionario completo de variables sin secretos (`[PROTEGIDO]`).
6. [`SUPERVISION_Y_RECUPERACION.md`](./SUPERVISION_Y_RECUPERACION.md) — Protocolos de monitoreo `/health` y recuperación ante fallos.
7. [`LIMITACIONES_Y_DEPENDENCIAS.md`](./LIMITACIONES_Y_DEPENDENCIAS.md) — Limitaciones técnicas, dependencias externas y costos operativos.
8. [`GUION_DEMOSTRACION_RESPONSABLE.md`](./GUION_DEMOSTRACION_RESPONSABLE.md) — Procedimiento paso a paso para la demostración en vivo.
9. [`PROCEDIMIENTO_PILOTO_COMERCIAL_7_DIAS.md`](./PROCEDIMIENTO_PILOTO_COMERCIAL_7_DIAS.md) — Protocolo para el piloto comercial de 7 días, kill switch y procedimiento de reversión a v4.1.
10. [`ACTA_DE_ENTREGA.md`](./ACTA_DE_ENTREGA.md) — Presente acta formal de entrega y cierre.

---

### 7. FIRMAS DE CONFORMIDAD Y CIERRE DEL DESARROLLO

Se firma la presente acta en señal de entrega formal de la versión de desarrollo y recepción de los entregables técnicos y documentales.

<br><br>

| POR EL EQUIPO DE INGENIERÍA Y DESARROLLO | POR LA DIRECCIÓN / RESPONSABLE DEL PROYECTO |
| :---: | :---: |
| <br><br>_________________________________________<br>**Líder de Desarrollo / Agente Antigravity**<br>Ingeniería de Software Tu Techo Ideal | <br><br>_________________________________________<br>**Robert / Dirección Comercial**<br>Tu Techo Ideal |
| Fecha: 04 / Noviembre / 2026 | Fecha: _____ / __________________ / 2026 |

