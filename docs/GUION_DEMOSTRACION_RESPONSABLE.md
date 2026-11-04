# GUION DE DEMOSTRACIÓN RESPONSABLE — TU TECHO IDEAL V5.0
**Guía Paso a Paso para la Presentación Ejecutiva y Validación con el Responsable del Proyecto**

---

## 1. OBJETIVO DE LA DEMOSTRACIÓN
Demostrar al responsable del proyecto (Robert y equipo directivo de Tu Techo Ideal) la confiabilidad, exactitud comercial y respeto a la atención humana de la versión 5.0 del asistente inmobiliario, utilizando escenarios reproducibles y controlados en el entorno de Staging.

---

## 2. PREPARACIÓN PREVIA
1. **Entorno:** Render Staging (`https://tu-techo-ideal-staging.onrender.com`).
2. **Herramienta:** Script de validación automatizada o cURL autenticado con cabecera `x-staging-auth`.
3. **Modo:** `OBSERVATION_MODE=true` (Garantiza cero despachos no autorizados a teléfonos reales de clientes).

---

## 3. PASO A PASO DE LA DEMOSTRACIÓN

### Paso 1: Confirmación Inmediata de Disponibilidad (Enlace Wasi)
- **Acción:** El cliente envía el enlace oficial de una propiedad activa en Google Sheets (ej. REF-012 en Los Samanes).
  - *Mensaje del cliente:* `https://tutechoideal.com.ve/inmueble/apartamento-en-venta-los-samanes-caracas/1234567`
- **Comportamiento Esperado:**
  - El bot responde en menos de 2 segundos:
    > *"Bienvenido a Tu Techo Ideal, sí, disponible."*
  - El bot almacena `REF-012` como el contexto activo de la conversación.
- **Punto a destacar al responsable:** No hay rodeos, saludos largos ni preguntas intrusivas. Respuesta comercial directa y canónica.

---

### Paso 2: Extracción Determinista Instantánea (Metraje y Precio - 0 Tokens)
- **Acción:** Sobre la misma conversación de REF-012, el cliente consulta el metraje y luego el precio:
  - *Pregunta 1:* *"¿Cuántos metros cuadrados tiene?"*
  - *Respuesta:* *"Tiene 110 m²"*
  - *Pregunta 2:* *"¿Cuál es su precio?"*
  - *Respuesta:* *"$146.000"*
- **Punto a destacar al responsable:** Esta información fue extraída directamente de Google Sheets sin llamar a la inteligencia artificial externa. Latencia de < 5 milisegundos, 0 tokens consumidos y 0% de probabilidad de error o alucinación.

---

### Paso 3: Política de No Invención (Silencio Seguro ante Datos No Verificados)
- **Acción:** El cliente consulta por características no especificadas en la ficha:
  - *Pregunta 1:* *"¿Cuánto se paga de condominio mensual?"*
  - *Pregunta 2:* *"¿El edificio tiene piscina o cancha de tenis?"*
- **Comportamiento Esperado:**
  - El bot guarda **silencio absoluto** (no responde nada).
- **Punto a destacar al responsable:** Tu Techo Ideal jamás inventará datos. Si el dato no está verificado en Google Sheets, el bot prefiere callar para que el asesor humano consulte con el propietario antes de comprometer a la empresa.

---

### Paso 4: La Regla de Oro: Bloqueo Humano de 12 Horas
- **Acción:** Un asesor comercial interviene en el chat enviando un mensaje manual (desde Kommo o WhatsApp):
  - *Mensaje del asesor:* *"Hola, buenas tardes, soy Carlos asesor de Tu Techo Ideal, ¿cuándo le gustaría verlo?"*
- **Comprobación:**
  1. El cliente responde inmediatamente: *"¿Tiene 3 habitaciones?"*
     - **Resultado:** El bot guarda **silencio total** (`HUMAN_LOCKED`).
  2. Mediante el reloj simulado de Staging, avanzamos a **$T_0 + 11\text{ horas } 59\text{ minutos } 59\text{ segundos}$**:
     - **Resultado:** El bot continúa en **silencio total** (bloqueo activo).
  3. Avanzamos a **$T_0 + 12\text{ horas } 1\text{ segundo}$** y el cliente pregunta *"¿Cuántos metros tiene?"*:
     - **Resultado:** El bot se reactiva de forma limpia y responde *"Tiene 110 m²"*.
- **Punto a destacar al responsable:** Se respeta de forma milimétrica el trabajo del asesor comercial. Mientras un humano atienda, el bot no interfiere.

---

### Paso 5: Cambio Limpio de Propiedad y Aislamiento de Fichas
- **Acción:** En la misma conversación, el cliente envía un nuevo enlace Wasi correspondiente a REF-005 (Chacao):
  - *Mensaje del cliente:* Enlace de REF-005.
  - *Respuesta:* *"Bienvenido a Tu Techo Ideal, sí, disponible."*
  - *Pregunta del cliente:* *"¿Cuántos metros tiene?"*
  - *Respuesta:* *"Tiene 80,45 m²"* (Dato exacto de REF-005, sin mezclar los 110 m² de REF-012).
- **Punto a destacar al responsable:** Transición perfecta de propiedades dentro del mismo chat, garantizando cero contaminación cruzada de fichas técnicas.

---

## 4. CONCLUSIÓN DE LA DEMOSTRACIÓN
La versión 5.0 de Tu Techo Ideal cumple con los más altos estándares de confiabilidad inmobiliaria, combinando inmediatez en disponibilidad, exactitud de datos numéricos con costo cero de IA y salvaguarda total de la atención personalizada humana.

