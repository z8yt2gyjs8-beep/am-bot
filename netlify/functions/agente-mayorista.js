const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

// ── Configuración ────────────────────────────────────────────────────────────
const FB_API_KEY  = process.env.FIREBASE_API_KEY;
const FB_PROJECT  = 'am-materiales-12a2e';
const FB_BASE     = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents`;
const WHATSAPP_NOTIF = '5491150052999';

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

// ── Firebase: Conversación ───────────────────────────────────────────────────
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
        canal:     { stringValue: 'instagram'         },
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

// ── Notificación WhatsApp vía CallMeBot ──────────────────────────────────────
// Activar: mandá WhatsApp a +34 644 59 32 05 con el texto:
// "I allow callmebot to send me messages"
// Te llega tu APIKEY → cargala en Netlify como CALLMEBOT_APIKEY
async function notificarWhatsApp(texto) {
  try {
    const apiKey = process.env.CALLMEBOT_APIKEY;
    if (!apiKey) return;
    const msg = encodeURIComponent(texto);
    await fetch(`https://api.callmebot.com/whatsapp.php?phone=${WHATSAPP_NOTIF}&text=${msg}&apikey=${apiKey}`);
  } catch (e) {
    console.error('Error notificación WhatsApp:', e);
  }
}

// ── System Prompt ────────────────────────────────────────────────────────────
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
2. Preguntá cantidad (mínimo 8 pallets por producto)
3. Pedí nombre y nombre del negocio
4. Confirmá que un asesor los contacta en breve

PRODUCTOS DISPONIBLES:
${listaProductos}

REGLAS:
- Tono informal, tuteo, directo. Zona sur GBA
- Máximo 3 líneas por respuesta
- Texto plano, sin asteriscos ni markdown. Máximo 1 emoji por mensaje
- Mínimo 8 pallets. Si piden menos: "El mínimo para mayorista son 8 pallets, ¿te sirve?"
- NO des precios bajo ningún concepto. El asesor los cierra
- NO menciones IVA ni condiciones impositivas bajo ningún concepto
- Si el producto no está en la lista, decí que no trabajás con eso
- Podés manejar varios productos en un mismo pedido

CIERRE: cuando tengas producto(s), cantidad(es), nombre y empresa → escribí [LEAD_COMPLETO] al final de tu mensaje.`;
}

// ── Enviar mensaje por Instagram ─────────────────────────────────────────────
async function enviarMensajeIG(userId, texto) {
  const igToken = process.env.IG_ACCESS_TOKEN;
  if (!igToken) {
    console.log('IG_ACCESS_TOKEN no configurado');
    return;
  }
  await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${igToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: userId },
      message:   { text: texto },
    }),
  });
}

// ── Handler principal ─────────────────────────────────────────────────────────
exports.handler = async function (event) {

  // Verificación webhook Meta (GET)
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
    const entry     = body.entry?.[0];
    const messaging = entry?.messaging?.[0];
    if (!messaging) return { statusCode: 200, body: 'ok' };

    const userId  = messaging.sender?.id;
    const msgText = messaging.message?.text;

    if (!userId || !msgText) return { statusCode: 200, body: 'ok' };
    if (messaging.message?.is_echo) return { statusCode: 200, body: 'ok' };

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

      const notif = `Nuevo lead mayorista Instagram!\nResumen: ${resumen}\nContactar: https://ig.me/m/${userId}`;
      await notificarWhatsApp(notif);
    }

    // Guardar conversación y responder
    historial.push({ role: 'assistant', content: respuesta });
    await guardarConversacion(userId, historial);
    await enviarMensajeIG(userId, respuesta);

    return { statusCode: 200, body: 'ok' };

  } catch (err) {
    console.error('Error agente mayorista:', err);
    return { statusCode: 200, body: 'ok' };
  }
};
