# TU TECHO IDEAL V5.0
## Asistente Virtual Inmobiliario Multicanal & Pipeline Comercial Autónomo
### Kommo CRM + WhatsApp + Google Sheets + NVIDIA Nemotron Free ($0.00 Costo de IA)

---

## 📌 DESCRIPCIÓN DEL PROYECTO

**Tu Techo Ideal V5.0** es un microservicio backend de alta disponibilidad diseñado para automatizar la atención comercial de clientes inmobiliarios a través de WhatsApp, Instagram Direct, Facebook Messenger y TikTok Direct unificados en **Kommo CRM**.

El sistema opera bajo una estricta **política de no invención (Zero Hallucination)** utilizando **Google Sheets** como fuente única de verdad, respondiendo de forma determinista preguntas sobre disponibilidad, precio y metraje, entregando enlaces limpios y directos a fotografías e información ampliada (Rexup), pausándose ante la intervención de asesores humanos y despachando alertas inmediatas al WhatsApp de Robert Jiménez ante intenciones de compra, alquiler, reserva o visitas.

---

## 📋 ENTREGABLES CONTRACTUALES - FASE 1 (SETUP - PAGO ÚNICO)

| Entregable | Alcance Contractual | Estado |
| :--- | :--- | :---: |
| **A. Bandeja Unificada** | Unificación en Kommo CRM (*Comunicaciones* → *Chats*) de WhatsApp, Instagram Direct, Facebook Messenger y TikTok Direct. | **AUDITADO Y VERIFICADO** |
| **B. Asesor Virtual Entrenado** | Asistente de IA comercial con atención multiportal (Wasi, ML, Web, Rexup), respuestas deterministas de precio y metraje, política de cero invención, bloqueo humano de 12h y \$0.00 de costo en IA (NVIDIA Nemotron Free). | **AUDITADO Y VERIFICADO** |
| **C. Inventario Sincronizado** | Google Sheets como fuente única de verdad (69 propiedades verificadas), caché local con TTL, soporte de publicaciones alternativas y entrega directa de `LINK_FOTOS` Rexup sin redirecciones intermedias. | **AUDITADO Y VERIFICADO** |
| **D. Alertas de Cierre Inmediato** | Detección de alta intención comercial (visitas, reservas, firma de contrato, cierres de compra/alquiler), pausa automática de la automatización y despacho de alerta urgente vía WhatsApp a Robert Jiménez. | **AUDITADO Y VERIFICADO** |

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
|  [Filtro 2] Idempotencia y Concurrencia (Mutex Lock por Message ID y Talk ID)            |
|  [Filtro 3] Emparejador Multiportal (Wasi, ML, Web, Rexup, Alias)                       |
|                                                                                          |
|  [PIPELINE CENTRAL DE DECISIÓN - pipeline_decision.js]                                   |
|      ├── Solicitud de Visita / Reserva / Cierre  ──> SILENCIO + Alerta WhatsApp a Robert |
|      ├── Enlace Inmueble Disponible             ──> "Bienvenido a Tu Techo Ideal..."     |
|      ├── Enlace Inmueble No Disponible          ──> Respuesta honesta de No Disponible   |
|      ├── Pregunta de Precio                     ──> Extracción Determinista Ficha        |
|      ├── Pregunta de Metraje                    ──> Extracción Determinista Ficha        |
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
- **Acceso a Internet**: Conexión saliente a Google Sheets y API de Kommo CRM.

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
   *Edite el archivo `.env` e ingrese los tokens y credenciales de su entorno.*

---

## ⚡ SCRIPTS DE EJECUCIÓN RÁPIDA (WINDOWS .BAT)

Para mayor comodidad operativa en entornos Windows, se incluyen tres archivos por lotes ejecutables con un solo clic:

1. **`INICIAR_SERVIDOR.bat`**:
   Inicia el microservicio localmente en el puerto configurado (por defecto `3000`), cargando las variables de entorno de `.env`.

2. **`EJECUTAR_TESTS.bat`**:
   Ejecuta la suite integral de 153 pruebas automatizadas (Alertas a Robert, No Duplicación, Fotos Directas, 50 Escenarios de Aceptación, Multiportal, etc.) y muestra el resumen de resultados.

3. **`VERIFICAR_PRODUCCION.bat`**:
   Realiza una comprobación en vivo del estado de salud (`/health`) tanto del servidor de Producción como del servidor de Staging en Render.

---

## 🧪 SUITE DE PRUEBAS AUTOMATIZADAS (153 PRUEBAS APROBADAS - 100%)

El sistema cuenta con una cobertura integral de pruebas que garantizan cero regresiones:

```powershell
# Ejecución individual de suites principales:
node scripts/test_alertas_robert_fase1.js              # 12 pruebas (Alertas de Cierre a Robert)
node scripts/test_reproducir_caso_0824.js              # 7 pruebas (Resiliencia y Contexto)
node scripts/test_link_fotos_directo_sin_kommo_cc.js   # 14 pruebas (Enlaces directos Rexup)
node scripts/test_master_50_acceptance_scenarios.js    # 50 pruebas (Aceptación comercial V5.0)
node scripts/test_multiportal_and_photos.js            # 12 pruebas (Reconocimiento multiportal)
node scripts/test_idempotency_and_single_dispatch.js   # 10 pruebas (Idempotencia y despacho único)
node test_suite_nueva_logica.js                        # 44 pruebas (Lógica de decisión y seguridad)
node scripts/verify_lock_and_reactivation.js           # 4 pruebas (Bloqueo humano 12h y reactivación)
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
├── lib/                                 # Módulos auxiliares
│   └── kommo_property_recovery.js       # Resiliencia de contexto y recuperación en vivo
├── scripts/                             # Scripts de pruebas automatizadas y verificación
│   ├── test_alertas_robert_fase1.js
│   ├── test_link_fotos_directo_sin_kommo_cc.js
│   ├── test_master_50_acceptance_scenarios.js
│   ├── test_multiportal_and_photos.js
│   ├── test_reproducir_caso_0824.js
│   └── ...
├── .env.example                         # Plantilla de variables de entorno
├── EJECUTAR_TESTS.bat                   # Ejecutor de pruebas en Windows
├── INICIAR_SERVIDOR.bat                 # Lanzador del servidor en Windows
├── VERIFICAR_PRODUCCION.bat             # Monitor de salud de servidores en Windows
├── pipeline_decision.js                 # Controlador central determinista V5.0
├── server.js                            # Servidor Express, Webhooks e integración Kommo
├── package.json                         # Dependencias y scripts de Node.js
├── property_url_aliases.json            # Mapeo de publicaciones alternativas multiportal
└── render.yaml                          # Configuración de infraestructura como código en Render
```

---

## 🔒 POLÍTICA DE SEGURIDAD Y PRIVACIDAD

1. **Protección de Datos:** Las credenciales y tokens de acceso nunca se almacenan en código fuente estático. Todas se inyectan a través de variables de entorno (`.env` o configuración secreta de Render).
2. **Anti-Spoofing de Webhooks:** El webhook verifica que el `account.id` recibido coincida exactamente con la cuenta oficial autorizada de Kommo (`36728143`).
3. **Validación de Destinatario:** Las notificaciones comerciales únicamente se despachan a números válidos autorizados con código de país internacional de Venezuela (`+58`).

---

## 📞 SOPORTE Y CONTACTO TÉCNICO

- **Proyecto:** Tu Techo Ideal V5.0
- **Responsable Comercial:** Broker Ing. Robert Jiménez
- **Entorno Activo:** Kommo CRM + WhatsApp Business API + Render Production
