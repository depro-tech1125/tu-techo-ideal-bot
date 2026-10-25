// ==========================================================================
// DEPRO TECH IA SOLUTIONS - SIMULADOR INTERACTIVO DE IA
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  const chatBody = document.getElementById('chat-body');
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const btnReset = document.getElementById('btn-reset-chat');
  const alertBanner = document.getElementById('sim-alert-banner');
  const presetChips = document.querySelectorAll('.chip');

  const initialBotMsg = `
    <div class="chat-msg bot">
      <div class="msg-bubble">
        <p>Hola, bienvenido a Tu techo ideal 👋</p>
        <p>Soy el asistente virtual de Bárbara Bravo y Robert Jiménez. ¿En qué podemos ayudarte hoy? ¿Buscas comprar, alquilar o información de algún inmueble?</p>
        <span class="msg-time">Ahora</span>
      </div>
    </div>
  `;

  // Helper to get formatted current time
  function getCurrentTime() {
    const d = new Date();
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Helper to scroll chat to bottom
  function scrollToBottom() {
    chatBody.scrollTop = chatBody.scrollHeight;
  }

  // Append user message
  function appendUserMessage(text) {
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-msg user';
    msgEl.innerHTML = `
      <div class="msg-bubble">
        <p>${escapeHtml(text)}</p>
        <span class="msg-time">${getCurrentTime()}</span>
      </div>
    `;
    chatBody.appendChild(msgEl);
    scrollToBottom();
  }

  // Show typing indicator
  function showTypingIndicator() {
    const typingEl = document.createElement('div');
    typingEl.className = 'chat-msg bot typing-msg';
    typingEl.id = 'typing-indicator';
    typingEl.innerHTML = `
      <div class="msg-bubble">
        <div class="typing-dots">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      </div>
    `;
    chatBody.appendChild(typingEl);
    scrollToBottom();
  }

  // Remove typing indicator
  function removeTypingIndicator() {
    const typingEl = document.getElementById('typing-indicator');
    if (typingEl) typingEl.remove();
  }

  // Append bot message with delay
  function appendBotMessage(htmlContent, delayMs = 1000, isAlert = false) {
    showTypingIndicator();

    setTimeout(() => {
      removeTypingIndicator();
      const msgEl = document.createElement('div');
      msgEl.className = 'chat-msg bot';
      msgEl.innerHTML = `
        <div class="msg-bubble">
          ${htmlContent}
          <span class="msg-time">${getCurrentTime()}</span>
        </div>
      `;
      chatBody.appendChild(msgEl);
      scrollToBottom();

      if (isAlert) {
        alertBanner.classList.add('show');
      } else {
        alertBanner.classList.remove('show');
      }
    }, delayMs);
  }

  // Logic to simulate AI response based on real inventory & safety guards
  function processSimulatedMessage(rawText) {
    const q = rawText.toLowerCase().trim();

    // 1. Bar / negocio no listado en inventario (Flujo de espera y alerta)
    if (q.includes('bar') || q.includes('discoteca') || q.includes('tasca') || q.includes('panaderia') || q.includes('restaurante')) {
      const responseHtml = `
        <p><strong>Ok, déjame consultar con un asesor para atenderte inmediatamente.</strong></p>
        <p style="font-size: 0.78rem; color: #a5b4fc; margin-top: 6px;">
          ⚡ <em>[Sistema Blindado]: El bot no inventó propiedades ni pidió disculpas vacías. Despachó alerta prioritaria y activó silencio de 24h para atención humana.</em>
        </p>
      `;
      appendBotMessage(responseHtml, 900, true);
      return;
    }

    // 2. Apartamento en La Boyera / El Hatillo
    if (q.includes('boyera') || (q.includes('apartamento') && q.includes('hatillo')) || q.includes('apto')) {
      const responseHtml = `
        <p>Hola, bienvenido a Tu techo ideal ✨</p>
        <p>Tenemos disponible en nuestro inventario:</p>
        <p><strong>Apartamento en La Boyera (El Hatillo)</strong><br>
        • <strong>Operación:</strong> Venta<br>
        • <strong>Precio:</strong> US$ 160.000,00<br>
        • <strong>Características:</strong> Penthouse a remodelar de 125,90 m², 4 habitaciones, 3 baños, 1 puesto, piso 14 con hermosa vista panorámica a la montaña.</p>
        <p>¿Te gustaría coordinar una visita presencial con Bárbara Bravo o Robert Jiménez para conocerlo?</p>
      `;
      appendBotMessage(responseHtml, 1100, false);
      return;
    }

    // 3. Casa Comercial en Alta Florida / Macaracuay
    if (q.includes('florida') || q.includes('alta florida') || q.includes('casa comercial')) {
      const responseHtml = `
        <p>Hola, bienvenido a Tu techo ideal ✨</p>
        <p>Tenemos disponible esta excelente opción:</p>
        <p><strong>Casa Comercial en Alta Florida (Libertador)</strong><br>
        • <strong>Operación:</strong> Alquiler (US$ 5.500) o Venta (US$ 600.000)<br>
        • <strong>Características:</strong> 850 m² de terreno, múltiples oficinas, estacionamiento para 10+ vehículos, ideal para sede corporativa o embajada.</p>
        <p>¿Qué día te resulta cómodo para coordinar una visita presencial?</p>
      `;
      appendBotMessage(responseHtml, 1100, false);
      return;
    }

    // 4. Casa en Macaracuay
    if (q.includes('macaracuay')) {
      const responseHtml = `
        <p>Hola, bienvenido a Tu techo ideal ✨</p>
        <p>Disponemos de:</p>
        <p><strong>Casa en Macaracuay Parte Alta</strong><br>
        • <strong>Operación:</strong> Alquiler<br>
        • <strong>Canon:</strong> US$ 2.500 / mes<br>
        • <strong>Detalles:</strong> Amplias áreas sociales, jardín privado, seguridad 24/7 y tanque subterráneo de alta capacidad.</p>
        <p>En este momento le avisé a Robert y a Bárbara para coordinar la cita contigo. ¿Te gustaría agendarla?</p>
      `;
      appendBotMessage(responseHtml, 1100, false);
      return;
    }

    // 5. Charla casual, broma o comentarios informales (Filtro anti-gasto $0)
    if (q.includes('locura') || q.includes('jaja') || q.includes('jeje') || q.includes('broma') || q.includes('muy caro') || q.includes('yo te aviso')) {
      const responseHtml = `
        <div style="background: rgba(16, 185, 129, 0.12); border-left: 3px solid #10b981; padding: 8px 12px; border-radius: 6px;">
          <strong style="color: #34d399; font-size: 0.8rem;">🛡️ FILTRO ANTI-GASTO DETERMINÍSTICO ACTIVADO</strong>
          <p style="font-size: 0.82rem; color: #cbd5e1; margin-top: 4px;">
            El mensaje fue detectado como charla casual o informal. El bot guarda <strong>silencio inteligente</strong> para proteger el presupuesto de tokens del cliente ($0.00 gastados en IA).
          </p>
        </div>
      `;
      appendBotMessage(responseHtml, 600, false);
      return;
    }

    // 6. Enlace de Wasi o propiedad no identificada
    if (q.includes('wasi') || q.includes('http') || q.includes('link') || q.includes('codigo') || q.includes('código')) {
      const responseHtml = `
        <p><strong>Ok, déjame consultar con un asesor para atenderte inmediatamente.</strong></p>
        <p style="font-size: 0.78rem; color: #a5b4fc; margin-top: 6px;">
          ⚡ <em>[Enlace Wasi Detectado]: Robert Jiménez recibió el link directo en su WhatsApp para verificar la red y responderte personalmente.</em>
        </p>
      `;
      appendBotMessage(responseHtml, 900, true);
      return;
    }

    // 7. Respuesta genérica de IA (Claude Sonnet simulation)
    const genericResponseHtml = `
      <p>Hola, bienvenido a Tu techo ideal ✨</p>
      <p>Con gusto te asesoramos. Tenemos propiedades activas en <strong>El Hatillo, Alta Florida, Macaracuay, Los Naranjos y Las Mercedes</strong>.</p>
      <p>¿Buscas una propiedad para <strong>comprar</strong> o para <strong>alquilar</strong>?</p>
    `;
    appendBotMessage(genericResponseHtml, 1000, false);
  }

  // Form submit handler
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    
    appendUserMessage(text);
    chatInput.value = '';
    processSimulatedMessage(text);
  });

  // Chip click handler
  presetChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const msg = chip.getAttribute('data-msg');
      if (msg) {
        appendUserMessage(msg);
        processSimulatedMessage(msg);
      }
    });
  });

  // Reset chat button
  btnReset.addEventListener('click', () => {
    chatBody.innerHTML = initialBotMsg;
    alertBanner.classList.remove('show');
    chatInput.value = '';
  });

  // Escape HTML helper
  function escapeHtml(string) {
    const div = document.createElement('div');
    div.innerText = string;
    return div.innerHTML;
  }
});
