const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

// ── Configuración ────────────────────────────────────────────────────────────
const FB_API_KEY   = process.env.FIREBASE_API_KEY;
const FB_PROJECT   = 'am-materiales-12a2e';
const FB_BASE       = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents`;
const WA_TOKEN      = process.env.WHATSAPP_ACCESS_TOKEN;
const WA_PHONE_ID   = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_NOTIF = process.env.NOTIF_PHONE || ''; // número personal para avisos de nuevo lead (distinto al del bot)

// ── Firebase: Productos ──────────────────────────────────────────────────────
async function getProductos() {
  try {
    const url  = `${FB_BASE}/productos_mayorista?key=${FB_API_KEY}&pageSize=100`;
    const res  = await fetch(url);
    const data = await res.json();
    if (!data.documents) return [];
    return data.documents.map(doc => {
      const f = doc.fields || {};
      return {
        nombre:    f.nombre?.stringValue    || '',
        categoria: f.categoria?.stringValue || '',
      };
    });
  } catch (e) {
    console.error('Error getProductos:', e);
    return [];
  }
}

// ── Firebase: Conversación (se reutiliza la misma colección) ─────────────────
async function getConversacion(userId) {
  try {
    const url  = `${FB_BASE}/conversaciones_bot/${userId}?key=${FB_API_KEY}`;
    const res  = await fetch(url);
    const data = await res.json();
    if (data.fields?.messages?.arrayValue?.values) {
      return data.fields.messages.arrayValue.values.map(v => JSON.parse(v.stringValue));
    }
  } catch (e) {}
  return [];
}

async function guardarConversacion(userId, messages) {
  try {
    const url  = `${FB_BASE}/conversaciones_bot/${userId}?key=${FB_API_KEY}`;
    const vals = messages.slice(-20).map(m => ({ stringValue: JSON.stringify(m) }));
    const body = {
      fields: {
        messages: { arrayValue: { values: vals } },
        updated:  { stringValue: new Date().toISOString() },
        canal:    { stringValue: 'whatsapp' },
      },
    };
    await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error('Error guardarConversacion:', e);
  }
}

// ── Firebase: Lead ───────────────────────────────────────────────────────────
async function guardarLead(lead) {
  try {
    const url  = `${FB_BASE}/leads_mayorista?key=${FB_API_KEY}`;
    const body = {
      fields: {
        userId:    { stringValue: lead.userId    || '' },
        canal:     { stringValue: 'whatsapp'          },
        resumen:   { stringValue: lead.resumen   || '' },
        timestamp: { stringValue: new Date().toISOString() },
      },
    };
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error('Error guardarLead:', e);
  }
}

// ── Notificación WhatsApp vía CallMeBot (a tu número personal, no al del bot) ─
async function notificarWhatsApp(texto) {
  try {
    if (!WHATSAPP_NOTIF) {
      console.log('NOTIF_PHONE no configurado, no se envía notificación');
      return;
    }
    // Usa la misma WhatsApp Cloud API del bot para notificar al número personal
    await enviarMensajeWA(WHATSAPP_NOTIF, texto);
  } catch (e) {
    console.error('Error notificación WhatsApp:', e);
  }
}

// ── System Prompt (idéntico al de Instagram) ─────────────────────────────────
async function buildSystemPrompt() {
  const productos = await getProductos();

  const grupos = {};
  for (const p of productos) {
    const cat = p.categoria || 'General';
    if (!grupos[cat]) grupos[cat] = [];
    grupos[cat].push(p.nombre);
  }

  const listaProductos = Object.entries(grupos)
    .map(([cat, items]) => `${cat}:\n${items.map(i => `  - ${i}`).join('\n')}`)
    .join('\n\n');

  return `Sos el asistente de ventas mayoristas de AM Materiales, corralón en Ruta 58 Km 10.5, Guernica, Buenos Aires.

Atendés ÚNICAMENTE a ferreterías y corralones que compran para revender. No atendés particulares.

OBJETIVO: capturar la consulta en pocos mensajes siguiendo este orden:
1. Saludá, presentate y preguntá qué necesitan cotizar
2. Preguntá cantidad de pallets que necesita
3. Pedí nombre y nombre del negocio
4. Confirmá que un asesor los contacta en breve

PRODUCTOS DISPONIBLES:
${listaProductos}

REGLAS:
- Tono informal, tuteo, directo. Zona sur GBA
- Máximo 3 líneas por respuesta
- Texto plano, sin asteriscos ni markdown. Máximo 1 emoji por mensaje
- No menciones mínimos de cantidad. Tomá el pedido tal como lo pida el cliente, sea la cantidad que sea. El asesor se encarga de negociar cantidades y condiciones al contactarlo.
- NO des precios bajo ningún concepto. El asesor los cierra
- NO menciones IVA ni condiciones impositivas bajo ningún concepto
- Si el producto no está en la lista, decí que no trabajás con eso
- Podés manejar varios productos en un mismo pedido

CIERRE: cuando tengas producto(s), cantidad(es), nombre y empresa → escribí [LEAD_COMPLETO] al final de tu mensaje.`;
}

// ── Enviar mensaje por WhatsApp Cloud API ────────────────────────────────────
async function enviarMensajeWA(to, texto) {
  if (!WA_TOKEN || !WA_PHONE_ID) {
    console.log('WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID no configurado');
    return;
  }
  await fetch(`https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${WA_TOKEN}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: texto },
    }),
  });
}

// ── Handler principal ─────────────────────────────────────────────────────────
exports.handler = async function (event) {

  // Verificación webhook Meta (GET) — mismo patrón que Instagram
  if (event.httpMethod === 'GET') {
    const params    = new URLSearchParams(event.rawQuery || '');
    const mode      = params.get('hub.mode');
    const token     = params.get('hub.verify_token');
    const challenge = params.get('hub.challenge');
    if (mode === 'subscribe' && token === process.env.BOT_SECRET_TOKEN) {
      return { statusCode: 200, body: challenge };
    }
    return { statusCode: 403, body: 'Forbidden' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: 'Bad request' };
  }

  try {
    // Estructura del payload de WhatsApp Cloud API:
    // entry[0].changes[0].value.messages[0]
    const entry   = body.entry?.[0];
    const change  = entry?.changes?.[0];
    const value   = change?.value;
    const message = value?.messages?.[0];

    if (!message) return { statusCode: 200, body: 'ok' }; // ej: status updates, sin mensaje de texto

    const userId  = message.from;           // número del cliente, ej "5491122334455"
    const msgText = message.text?.body;

    if (!userId || !msgText) return { statusCode: 200, body: 'ok' };

    // Reenvío en vivo del mensaje del cliente (para monitoreo)
    await notificarWhatsApp(`📩 Cliente ${userId} escribió:\n"${msgText}"\n\nChat directo: https://wa.me/${userId}`);

    // Cargar historial
    const historial = await getConversacion(userId);
    historial.push({ role: 'user', content: msgText });

    // Llamar a Claude
    const systemPrompt = await buildSystemPrompt();
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system:     systemPrompt,
        messages:   historial,
      }),
    });

    const claudeData = await claudeRes.json();
    let respuesta = claudeData.content?.[0]?.text || 'Disculpá, hubo un problema. Intentá de nuevo.';

    // Detectar lead completo
    if (respuesta.includes('[LEAD_COMPLETO]')) {
      respuesta = respuesta.replace('[LEAD_COMPLETO]', '').trim();

      const resumen = historial
        .filter(m => m.role === 'user')
        .map(m => m.content)
        .join(' | ')
        .slice(0, 500);

      await guardarLead({ userId, resumen });

      const notif = `Nuevo lead mayorista WhatsApp!\nResumen: ${resumen}\nContactar: https://wa.me/${userId}`;
      await notificarWhatsApp(notif);
    }

    // Guardar conversación y responder
    historial.push({ role: 'assistant', content: respuesta });
    await guardarConversacion(userId, historial);
    await enviarMensajeWA(userId, respuesta);
    await notificarWhatsApp(`🤖 Bot le respondió a ${userId}:\n"${respuesta}"`);

    return { statusCode: 200, body: 'ok' };

  } catch (err) {
    console.error('Error agente WhatsApp:', err);
    return { statusCode: 200, body: 'ok' };
  }
};
