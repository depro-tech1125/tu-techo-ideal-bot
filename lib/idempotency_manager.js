const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * IdempotencyManager
 * 
 * Garantiza idempotencia estricta para webhooks de mensajería (Kommo / WhatsApp):
 * 1. Identificación unívoca por message_id / event_id.
 * 2. Persistencia atómica en disco compatible con Render (idempotency_store.json).
 * 3. Estados: PROCESSING, SENT, FAILED, IGNORED.
 * 4. Control de concurrencia en vuelo (in-flight locks).
 * 5. Permite preguntas idénticas legítimas siempre que procedan de eventos distintos (distinto ID).
 * 6. Ventana de retención móvil (24 horas) y límite de registros para evitar crecimiento indefinido.
 */
class IdempotencyManager {
  constructor(filePath = null, windowMs = 24 * 60 * 60 * 1000) {
    this.filePath = filePath || path.join(__dirname, '..', 'idempotency_store.json');
    this.windowMs = windowMs;
    this.records = new Map();
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        const now = Date.now();
        if (Array.isArray(raw)) {
          for (const item of raw) {
            if (item && item.key && (now - (item.timestamp || 0) < this.windowMs)) {
              this.records.set(item.key, item);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[IdempotencyManager] Warning al cargar archivo de persistencia:', e.message);
      this.records = new Map();
    }
  }

  save() {
    try {
      const now = Date.now();
      const entries = [];
      for (const [key, item] of this.records.entries()) {
        if (now - (item.timestamp || 0) < this.windowMs) {
          entries.push({ key, ...item });
        } else {
          this.records.delete(key);
        }
      }
      // Conservar un máximo de 5000 entradas más recientes
      const trimmed = entries.slice(-5000);
      const tempPath = `${this.filePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify(trimmed, null, 2), 'utf8');
      fs.renameSync(tempPath, this.filePath);
    } catch (e) {
      console.warn('[IdempotencyManager] Error guardando archivo de persistencia:', e.message);
    }
  }

  resolveMessageKey(body, messageObj) {
    if (messageObj) {
      if (messageObj.id) return `msg_${messageObj.id}`;
      if (messageObj.message_id) return `msg_${messageObj.message_id}`;
      if (messageObj.element_id) return `elem_${messageObj.element_id}`;
    }
    if (body) {
      if (body['message[add][0][id]']) return `msg_${body['message[add][0][id]']}`;
      if (body.message?.add?.[0]?.id) return `msg_${body.message.add[0].id}`;
      if (body.message?.id) return `msg_${body.message.id}`;
    }
    // Clave compuesta única de seguridad para eventos sin ID explícito
    const talkId = messageObj?.talk_id || 'notalk';
    const leadId = messageObj?.entity_id || messageObj?.element_id || 'nolead';
    const text = messageObj?.text || messageObj?.value || '';
    const hash = crypto.createHash('md5').update(text.trim()).digest('hex').substring(0, 12);
    const tsBucket = Math.floor(Date.now() / 5000); // Ventana de 5s para el mismo lead y mismo texto
    return `comp_${talkId}_${leadId}_${tsBucket}_${hash}`;
  }

  acquireLock(messageKey, talkId = null, leadId = null) {
    if (!messageKey) {
      return { allowed: true, key: null, reason: 'NO_KEY' };
    }

    const now = Date.now();
    const existing = this.records.get(messageKey);

    if (existing) {
      if (existing.status === 'SENT') {
        return {
          allowed: false,
          key: messageKey,
          reason: 'ALREADY_SENT',
          record: existing
        };
      }
      if (existing.status === 'PROCESSING') {
        // En vuelo hace menos de 60 segundos
        if (now - existing.timestamp < 60000) {
          return {
            allowed: false,
            key: messageKey,
            reason: 'IN_FLIGHT_PROCESSING',
            record: existing
          };
        }
        // Si han transcurrido más de 60 segundos, se asume timeout o caída anterior y se permite reprocesar
      }
    }

    // Adquisición atómica
    const record = {
      status: 'PROCESSING',
      talkId: talkId ? String(talkId) : null,
      leadId: leadId ? String(leadId) : null,
      timestamp: now
    };

    this.records.set(messageKey, record);
    this.save();

    return { allowed: true, key: messageKey, record };
  }

  markSent(messageKey, responseText, meta = {}) {
    if (!messageKey) return;
    const existing = this.records.get(messageKey) || { timestamp: Date.now() };
    this.records.set(messageKey, {
      ...existing,
      status: 'SENT',
      finishedAt: Date.now(),
      response: responseText,
      ...meta
    });
    this.save();
  }

  markFailed(messageKey, errorMsg) {
    if (!messageKey) return;
    const existing = this.records.get(messageKey) || { timestamp: Date.now() };
    this.records.set(messageKey, {
      ...existing,
      status: 'FAILED',
      finishedAt: Date.now(),
      error: typeof errorMsg === 'string' ? errorMsg : errorMsg?.message
    });
    this.save();
  }

  markIgnored(messageKey, reason) {
    if (!messageKey) return;
    const existing = this.records.get(messageKey) || { timestamp: Date.now() };
    this.records.set(messageKey, {
      ...existing,
      status: 'IGNORED',
      finishedAt: Date.now(),
      reason
    });
    this.save();
  }

  releaseLock(messageKey) {
    if (!messageKey) return;
    this.records.delete(messageKey);
    this.save();
  }

  getStatus(messageKey) {
    if (!messageKey) return null;
    return this.records.get(messageKey) || null;
  }
}

module.exports = { IdempotencyManager };
