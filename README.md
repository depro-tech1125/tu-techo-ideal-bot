# TU TECHO IDEAL V5.0
## Asistente Virtual Inmobiliario Multicanal & Pipeline Comercial Autónomo
### Kommo CRM + WhatsApp + Google Sheets + NVIDIA Nemotron Free ($0.00 Costo de IA)

---

## 📌 DESCRIPCIÓN DEL PROYECTO

**Tu Techo Ideal V5.0** es un microservicio backend de alta disponibilidad y tolerancia a fallos diseñado para automatizar la atención comercial de clientes inmobiliarios a través de WhatsApp, Instagram Direct, Facebook Messenger y TikTok Direct unificados en **Kommo CRM**.

El sistema opera bajo una estricta **política de no invención (Zero Hallucination)** utilizando **Google Sheets** como la **fuente única de verdad**, respondiendo de forma determinista preguntas sobre disponibilidad, precio y metraje, entregando enlaces limpios y directos a fotografías e información ampliada (Rexup), pausándose ante la intervención de asesores humanos y despachando alertas inmediatas al WhatsApp de Robert Jiménez ante intenciones de compra, alquiler, reserva o visitas.

---

## 📋 ENTREGABLES CONTRACTUALES - FASE 1 (SETUP - PAGO ÚNICO)

| Entregable | Alcance Contractual | Estado |
| :--- | :--- | :---: |
| **A. Bandeja Unificada** | Unificación en Kommo CRM (*Comunicaciones* → *Chats*) de WhatsApp, Instagram Direct, Facebook Messenger y TikTok Direct. | **AUDITADO Y VERIFICADO** |
| **B. Asesor Virtual Entrenado** | Asistente de IA comercial con atención multiportal (Wasi, ML, Web, Rexup), respuestas deterministas de precio y metraje, política de cero invención, bloqueo humano de 12h y $0.00 de costo en IA (NVIDIA Nemotron Free). | **AUDITADO Y VERIFICADO** |
| **C. Inventario Sincronizado** | Google Sheets como fuente única de verdad (69 propiedades verificadas), caché local con TTL, soporte de publicaciones alternativas y entrega directa de `LINK_FOTOS` Rexup sin redirecciones intermedias. | **AUDITADO Y VERIFICADO** |
| **D. Alertas de Cierre Inmediato** | Detección de alta intención comercial (visitas, reservas, firma de contrato, cierres de compra/alquiler), pausa automática de la automatización y despacho de alerta urgente vía WhatsApp a Robert Jiménez. | **AUDITADO Y VERIFICADO** |

---

## 🏛️ REGLAS MAESTRAS Y PRINCIPIOS DE DISEÑO

### 1. Fuente Única de Verdad: Google Sheets
- Google Sheets es la **única fuente oficial** de disponibilidad, precios, metrajes y condiciones comerciales.
- Los portales inmobiliarios externos (Wasi, Mercado Libre, páginas web de agencias) son únicamente **mecanismos auxiliares para identificar** qué propiedad del catálogo está consultando el cliente.
- Bajo ninguna circunstancia se responde al cliente con datos obtenidos de portales externos. Si el precio externo es $128.000 o $300.000 y Google Sheets dice USD 130.000, la respuesta al cliente dirá estrictamente **USD 130.000**.

### 2. Motor de Identificación Ponderada al 90% (Scoring Algorithm)
Para identificar propiedades a partir de enlaces externos, el sistema extrae semánticamente los atributos verificables y calcula una coincidencia ponderada sobre 100 puntos:
- **Tipo de Inmueble (25 pts):** Apartamento, casa, oficina, local, etc. (Contradicción flagrante = Descarte total).
- **Operación Comercial (25 pts):** Venta o Alquiler. (Contradicción flagrante = Descarte total).
- **Zona / Ubicación (25 pts):** Urbanizaciones de Caracas identificadas en ficha, URLs o descripción. (Contradicción flagrante = Descarte total).
- **Metraje Numérico (15 pts):** Tolerancia estricta de ±5% (15 pts), aproximado ±10% (8 pts), secundario en descripción (15 pts). Diferencia >10% sin mención secundaria = Descarte total.
- **Habitaciones (5 pts):** Coincidencia (5 pts). Discrepancia o ausente = 0 pts (sin penalización negativa).
- **Características Distintivas (5 pts):** Pozo de agua, vista al Ávila, cocina con cuarzo, amoblado, etc.
- **TOTAL: 100 PUNTOS.** Umbral mínimo de aceptación: **>= 90%**.
- **Margen de Unicidad:** Si existen dos propiedades similares candidatas, se exige una diferencia mínima de **15 puntos** entre la primera y la segunda. Si la diferencia es menor, se declara ambigüedad comercial y se deriva a humano en silencio.

### 3. Exclusión Absoluta del Precio en el Scoring de Identidad
- El precio está **totalmente excluido** del cálculo de identidad de la propiedad.
- El precio no suma puntos, no resta puntos, no genera penalizaciones ni provoca rechazo por desfases comerciales entre portales.
- Si el precio publicado difiere del registrado en Sheets, se genera internamente la marca de diagnóstico `EXTERNAL_PRICE_DIFFERS_SHEETS` para auditoría y trazabilidad.

### 4. Política Comercial: "El Bot Informa. Robert Vende."
- El asistente virtual provee información inmobiliaria rápida, precisa y confirmada (disponibilidad, metraje y precio oficial).
- **Prohibido el empuje comercial agresivo:** El bot no hace preguntas de cierre ("¿Cuándo desea visitarlo?", "¿Cuál es su presupuesto?"), no intenta agendar citas por su cuenta ni forza la venta.
- Deja la conversación servida para que el asesor humano (Robert Jiménez) tome el control de la negociación comercial.

### 5. Bloqueo Humano de 12 Horas (`HandoffManager`)
- Cuando un asesor humano interviene o el cliente solicita atención humana, se activa un bloqueo atómico de 12 horas (`HANDOFF_LOCK_HOURS = 12`).
- El bloqueo se rastrea simultáneamente por `leadId`, `talkId` y `contactId` en `handoffs.json`.
- Durante el bloqueo, el bot guarda **silencio absoluto**. Solo se reactiva tras 12 horas si el cliente comparte un nuevo enlace inmobiliario verificado.

### 6. Ciberseguridad SSRF y Protección de Red
- Resolución DNS previa con verificación de rangos IP privados (RFC 1918), loopback (`127.0.0.0/8`, `::1`), link-local (`169.254.0.0/16`) y metadata de proveedores de nube (`metadata.google.internal`, `169.254.169.254`).
- Límite de descarga estricto (512 KB), timeout rápido (3.5s) y sanitización estática de HTML contra ataques de prompt injection.

---

## 🏗️ ARQUITECTURA DEL SISTEMA

```text
                               +-----------------------------+
                               |     CLIENTES MULTICANAL     |
                               | (WhatsApp, Instagram, etc.) |
                               +--------------+--------------+
                                              |
                                              v
                               +-----------------------------+
                               |   KOMMO CRM (Chats API)     |
                               +--------------+--------------+
                                              |
                                       Webhook HTTPS
                                              v
+------------------------------------------------------------------------------------------+
|                        TU TECHO IDEAL V5.0 BACKEND (Node.js)                             |
|                                                                                          |
|  [Filtro 0] Anti-Spam / Anti-Stories Instagram                                           |
|  [Filtro 1] Detección de Intervención Humana (Bloqueo 12h con HandoffManager)            |
|  [Filtro 2] Idempotencia Atómica (Mutex Lock por Message ID y Talk ID)                   |
|  [Filtro 3] Lector de Publicaciones Externas al 90% (SSRF Safe + Scoring Ponderado)     |
|                                                                                          |
|  [PIPELINE CENTRAL DE DECISIÓN - pipeline_decision.js]                                   |
|      ├── Solicitud de Visita / Reserva / Cierre  ──> SILENCIO + Alerta WhatsApp a Robert |
|      ├── Enlace Inmueble Disponible             ──> "¡Hola! Sí, el apartamento en..."    |
|      ├── Enlace Inmueble No Disponible          ──> Respuesta honesta de No Disponible   |
|      ├── Pregunta de Precio                     ──> Extracción Determinista Ficha Sheets |
|      ├── Pregunta de Metraje                    ──> Extracción Determinista Ficha Sheets |
|      ├── Solicitud de Fotos / Info Ampliada     ──> LINK_FOTOS Directo Rexup             |
|      ├── Pregunta Específica (Inferencia IA)    ──> NVIDIA Nemotron Free ($0.00)         |
|      └── Dato NO Verificado en Sheets           ──> SILENCIO SEGURO (Cero Invención)     |
|                                                                                          |
+------------------------------------------------------------------------------------------+
       |                                      |                                  |
       v                                      v                                  v
+---------------+                     +---------------+                  +---------------+
| GOOGLE SHEETS |                     |  KOMMO CRM    |                  |  WHATSAPP DE  |
| (Inventario)  |                     | (Respuesta)   |                  |    ROBERT     |
+---------------+                     +---------------+                  +---------------+
```

---

## 🚀 REQUISITOS PREVIOS E INSTALACIÓN

### Requisitos del Sistema:
- **Node.js**: v18.0.0 o superior (recomendado v20.x LTS).
- **npm**: v9.0.0 o superior.
- **Acceso a Internet**: Conexión saliente HTTPS a Google Sheets y API de Kommo CRM.

### Instalación Local:
1. Clonar el repositorio o descomprimir el paquete ZIP:
   ```powershell
   cd tu-techo-ideal-bot
   ```
2. Instalar dependencias:
   ```powershell
   npm install
   ```
3. Configurar variables de entorno:
   ```powershell
   copy .env.example .env
   ```
   *Edite `.env` e ingrese las credenciales correspondientes a su entorno.*

---

## ⚡ SCRIPTS DE EJECUCIÓN RÁPIDA (WINDOWS .BAT)

Para facilitar la administración operativa en entornos Windows, se incluyen tres archivos ejecutables con un solo clic:

1. **`INICIAR_SERVIDOR.bat`**:
   Inicia el microservicio Express localmente en el puerto configurado (por defecto `3000`), cargando automáticamente las variables de entorno de `.env`.

2. **`EJECUTAR_TESTS.bat`**:
   Ejecuta la suite integral de 202 pruebas automatizadas distribuidas en 11 suites y muestra el informe consolidado.

3. **`VERIFICAR_PRODUCCION.bat`**:
   Realiza una comprobación en vivo del estado de salud (`/health`) y conectividad del servidor de Producción y Staging en Render.

---

## 🧪 SUITE DE PRUEBAS AUTOMATIZADAS (202/202 PRUEBAS APROBADAS - 100%)

El sistema cuenta con una cobertura exhaustiva de pruebas unitarias, de integración, de regresión y de ciberseguridad:

```powershell
# Ejecución unificada de todas las suites:
node scripts/run_all_suites.js

# O ejecución individual de cada suite:
node scripts/test_alertas_robert_fase1.js                      # [1/11] 12 pruebas (Alertas de Cierre a Robert)
node scripts/test_reproducir_caso_0824.js                      # [2/11]  7 pruebas (Resiliencia y Contexto)
node scripts/test_link_fotos_directo_sin_kommo_cc.js           # [3/11] 14 pruebas (Enlaces directos Rexup LINK_FOTOS)
node scripts/test_master_50_acceptance_scenarios.js            # [4/11] 50 pruebas (Aceptación comercial V5.0)
node scripts/test_multiportal_and_photos.js                    # [5/11] 12 pruebas (Reconocimiento multiportal)
node scripts/test_idempotency_and_single_dispatch.js           # [6/11] 10 pruebas (Idempotencia y despacho único)
node test_suite_nueva_logica.js                                # [7/11] 44 pruebas (Lógica de decisión y seguridad)
node scripts/verify_lock_and_reactivation.js                   # [8/11]  4 pruebas (Bloqueo humano 12h y reactivación)
node scripts/test_resolucion_inteligente_multiportal.js         # [9/11] 20 pruebas (Resolución multiportal + Dayana REF-007)
node scripts/test_control_respuestas_y_transferencia_humana.js # [10/11] 14 pruebas (Control comercial: El bot informa. Robert vende.)
node scripts/test_validacion_publicaciones_externas_90.js      # [11/11] 15 pruebas (Scoring 90%, Exclusión Precio, SSRF)
```

---

## 🌐 DESPLIEGUE EN LA NUBE (RENDER)

El microservicio se encuentra desplegado en la nube a través de **Render**:

- **Producción:** `https://tu-techo-ideal-bot-1.onrender.com`
  - Rama Git: `main`
  - `OBSERVATION_MODE=false` (Atención comercial activa a clientes reales)
  - `CLAUDE_MODEL=nvidia/nemotron-3.5-lightning:free`
  - Consumo de IA: **$0.00 USD**
- **Staging / Pruebas:** `https://tu-techo-ideal-staging.onrender.com`
  - Rama Git: `main`
  - `OBSERVATION_MODE=true` (Modo seguro de auditoría)

---

## 📂 ESTRUCTURA DEL PROYECTO

```text
tu-techo-ideal-bot/
├── docs/                                # Documentación técnica y comercial de entrega
│   ├── ACTA_DE_ENTREGA.md
│   ├── ARQUITECTURA_E_INTEGRACIONES.md
│   ├── ENTREGA_FASE1_SETUP_PAGO_UNICO.md
│   ├── GUION_DEMOSTRACION_RESPONSABLE.md
│   ├── INFORME_EJECUTIVO_FINAL.md
│   ├── LIMITACIONES_Y_DEPENDENCIAS.md
│   ├── MANUAL_OPERATIVO_COMERCIAL.md
│   ├── MANUAL_TECNICO.md
│   ├── PROCEDIMIENTO_PILOTO_COMERCIAL_7_DIAS.md
│   ├── SUPERVISION_Y_RECUPERACION.md
│   └── VARIABLES_ENTORNO.md
├── lib/                                 # Módulos de lógica central y librerías
│   ├── external_publication_reader.js   # Lector seguro de publicaciones externas y scoring 90%
│   ├── multiportal_extractor.js         # Extractor de identificadores y URLs multiportal
│   ├── idempotency_manager.js           # Gestor de idempotencia y prevención de duplicados
│   └── kommo_property_recovery.js       # Resiliencia de contexto y recuperación en vivo
├── scripts/                             # Suites de prueba y scripts de verificación
│   ├── run_all_suites.js                # Ejecutor consolidado de las 11 suites de prueba
│   ├── test_alertas_robert_fase1.js
│   ├── test_control_respuestas_y_transferencia_humana.js
│   ├── test_idempotency_and_single_dispatch.js
│   ├── test_link_fotos_directo_sin_kommo_cc.js
│   ├── test_master_50_acceptance_scenarios.js
│   ├── test_multiportal_and_photos.js
│   ├── test_reproducir_caso_0824.js
│   ├── test_resolucion_inteligente_multiportal.js
│   ├── test_validacion_publicaciones_externas_90.js
│   └── verify_lock_and_reactivation.js
├── .env.example                         # Plantilla de variables de entorno
├── EJECUTAR_TESTS.bat                   # Ejecutor de pruebas con un clic en Windows
├── INICIAR_SERVIDOR.bat                 # Lanzador del microservicio en Windows
├── VERIFICAR_PRODUCCION.bat             # Monitor de salud de servidores en Windows
├── pipeline_decision.js                 # Pipeline central determinista V5.0
├── server.js                            # Servidor Express, Webhooks e integración Kommo
├── package.json                         # Dependencias y scripts de Node.js
├── property_url_aliases.json            # Mapeo de publicaciones alternativas multiportal
├── properties_cache.json                # Catálogo local de respaldo del inventario
└── render.yaml                          # Configuración de infraestructura como código en Render
```

---

## 🔒 POLÍTICA DE SEGURIDAD Y PRIVACIDAD

1. **Protección de Datos:** Las credenciales y tokens de acceso nunca se almacenan en código fuente estático. Se inyectan exclusivamente a través de variables de entorno seguras.
2. **Anti-Spoofing de Webhooks:** El webhook verifica que el `account.id` recibido coincida exactamente con la cuenta autorizada de Kommo (`36728143`).
3. **Ciberseguridad SSRF:** Se bloquea activamente cualquier intento de invocar direcciones IP privadas, loopback o metadatos de servicios cloud.
4. **Validación de Destinatario:** Las notificaciones comerciales únicamente se despachan a números autorizados de Venezuela (`+58`).

---

## 📞 SOPORTE Y CONTACTO TÉCNICO

- **Proyecto:** Tu Techo Ideal V5.0
- **Responsable Comercial:** Broker Ing. Robert Jiménez
- **Entorno Activo:** Kommo CRM + WhatsApp Business API + Render Production
