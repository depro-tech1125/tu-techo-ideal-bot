# PROCEDIMIENTO OPERATIVO: PILOTO COMERCIAL CONTROLADO DE 7 DÍAS
## TU TECHO IDEAL V5.0 — GUÍA PARA EL RESPONSABLE DEL PROYECTO

---

> [!NOTE]
> Este documento establece el procedimiento paso a paso para ejecutar una prueba comercial en vivo con clientes y conversaciones reales durante siete (7) días continuos, garantizando la supervisión del equipo, la protección de la atención humana y un mecanismo de reversión inmediata en caso de contingencia.
> **El piloto no se iniciará hasta que la dirección del proyecto lo autorice formalmente.**

---

## 1. PREPARATIVOS Y CONFIGURACIONES PREVIAS DEL CLIENTE

Antes de autorizar el pase a producción de la Versión 5.0, el equipo técnico del cliente debe verificar:

1. **Inventario en Google Sheets:**
   - La hoja de cálculo oficial debe contar con la estructura de 13 columnas autorizadas.
   - Opcional pero recomendado: Importar el archivo [`google_sheet_Hoja1_COMPLETA_ACTUALIZADA.xlsx`](../google_sheet_Hoja1_COMPLETA_ACTUALIZADA.xlsx) generado en el repositorio para que todas las propiedades cuenten con el bloque complementario de servicios y condiciones.
2. **Canales de Mensajería en Kommo CRM:**
   - Canal de WhatsApp corporativo activo y conectado al buzón de Kommo.
   - Si se atenderá Instagram Direct o TikTok, comprobar que las cuentas de la agencia estén autenticadas en el módulo de canales de Kommo.
3. **Variables de Entorno en Render Producción (`tu-techo-ideal-bot-1`):**
   - Comprobar que `KOMMO_TOKEN` sea válido y tenga permisos de lectura y escritura en la API v4.
   - Mantener inicialmente `OBSERVATION_MODE=true` durante los primeros 30 minutos de prueba interna antes de abrir a clientes reales.

---

## 2. PROCEDIMIENTO PARA HABILITAR LA VERSIÓN 5.0 EN PRODUCCIÓN

Cuando la dirección autorice formalmente el despliegue:

1. **Ejecutar el Merge en GitHub:**
   ```bash
   git checkout main
   git merge feature/reinicio-logica-inmobiliaria
   git push origin main
   ```
2. **Despliegue Automático en Render:**
   - Render detectará el push a la rama `main` del servicio `tu-techo-ideal-bot-1` e iniciará la compilación.
   - Duración estimada: 90 a 120 segundos.
3. **Comprobación de Salud Post-Despliegue:**
   - Abrir en el navegador: `https://tu-techo-ideal-bot-1.onrender.com/health`
   - Verificar que la respuesta indique:
     ```json
     {
       "status": "running",
       "service": "Tu Techo Ideal Bot Microservice - v5.0 Deterministic Central Pipeline Edition",
       "pipeline_controller": "pipeline_decision.js"
     }
     ```
4. **Activación de Despachos Comerciales:**
   - En el panel de Render Producción -> Pestaña **Environment**, cambiar `OBSERVATION_MODE` de `true` a `false`.
   - Pulsar **Save Changes**. El microservicio se reiniciará en modo operativo en vivo.

---

## 3. PROTOCOLO DE SUPERVISIÓN DIARIA (DÍAS 1 AL 7)

Durante los 7 días de prueba, se debe aplicar el siguiente esquema de supervisión:

| Día | Alcance de la Supervisión | Responsable |
| :---: | :--- | :--- |
| **Día 1** | **Monitoreo Intensivo (Primeras 4 horas):** Supervisar cada lead entrante en Kommo. Comprobar confirmaciones de disponibilidad y respeto del bloqueo humano al intervenir el asesor. | Líder Técnico + Robert |
| **Días 2-3** | **Verificación de Datos:** Cotejar aleatoriamente 10 respuestas de metraje y precio emitidas por el bot contra la columna `DESCRIPCION_BREVE` de Google Sheets. | Asesor Comercial |
| **Días 4-5** | **Supervisión de Duplicados y Silencio:** Revisar logs de Render en busca de etiquetas `[MUTEX LOCKED]` y comprobar que preguntas sobre datos inexistentes se silencien. | Operador Técnico |
| **Días 6-7** | **Evaluación de Rendimiento Global:** Analizar tasa de derivación a asesores, tiempos de respuesta y satisfacción de los clientes atendidos. | Dirección Comercial |

---

## 4. REGISTRO Y REPORTE DE INCIDENCIAS
Si un asesor detecta una respuesta no esperada, debe registrarla en una bitácora con los siguientes campos:

- **Fecha y Hora:** (ej. 05/11/2026 10:15 AM)
- **ID de Conversación (Talk ID / Lead ID en Kommo):**
- **Inmueble Consultado (Enlace Wasi / Código):**
- **Pregunta formulada por el cliente:**
- **Respuesta emitida por el bot (o si guardó silencio):**
- **Respuesta esperada según Google Sheets:**
- **Observaciones:** (ej. El asesor intervino antes o después del mensaje).

---

## 5. PARADA DE EMERGENCIA (KILL SWITCH)
Si durante el piloto se detecta un comportamiento anómalo o se desea suspender temporalmente la atención automática:

1. Entrar al panel de Render: [dashboard.render.com](https://dashboard.render.com).
2. Seleccionar el servicio **`tu-techo-ideal-bot-1`** (Producción).
3. Ir a la pestaña **Environment**.
4. Modificar la variable:
   ```env
   OBSERVATION_MODE=true
   ```
5. Pulsar **Save Changes**.
6. **Efecto Inmediato:** El bot continuará recibiendo webhooks y registrando en logs lo que respondería, pero **no enviará ningún mensaje saliente a WhatsApp**. Los asesores humanos mantendrán el control 100% manual del chat.

---

## 6. PROCEDIMIENTO DE REVERSIÓN INMEDIATA (ROLLBACK A V4.1)
Si por cualquier motivo se decide cancelar el piloto y regresar de inmediato a la Versión 4.1:

### Opción A (Desde el Panel de Render - 1 Clic):
1. En el panel de Render, ir a la pestaña **Deploys**.
2. Ubicar el despliegue correspondiente al commit `e4f82ff` (Versión 4.1).
3. Hacer clic en los tres puntos `...` y seleccionar **Rollback to this deploy**.
4. El servicio volverá a la Versión 4.1 en menos de 60 segundos.

### Opción B (Desde la Consola Git):
```bash
git checkout main
git reset --hard e4f82ff
git push origin main --force
```

---

## 7. CRITERIOS DE ÉXITO PARA LA APROBACIÓN FINAL DEL PILOTO
Al finalizar el séptimo día, el piloto se considerará exitoso si se cumplen los siguientes umbrales:
- **Exactitud Inmobiliaria:** 100% de las respuestas de metraje y precio coinciden con Google Sheets.
- **Respeto a la Atención Humana:** Cero interrupciones del bot mientras un asesor comercial está atendiendo (bloqueo de 12 horas activo).
- **Cero Respuestas Duplicadas:** Ningún cliente recibe mensajes repetidos gracias a la desduplicación activa.
- **Cero Alucinaciones:** Cero datos inventados sobre características inexistentes en el inventario.
