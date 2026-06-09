const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

// ── Firebase helpers ──────────────────────────────────────────────
const FB_API_KEY = process.env.FIREBASE_API_KEY;
const FB_PROJECT = 'am-materiales-12a2e';
const FB_BASE    = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents`;

async function getProductos() {
  const url = `${FB_BASE}/productos_mayorista?key=${FB_API_KEY}&pageSize=100`;
  const res  = await fetch(url);
  const data = await res.json();
  if (!data.documents) return [];
  return data.documents.map(doc => {
    const f = doc.fields || {};
    return {
      nombre:        f.nombre?.stringValue        || '',
      precio_pallet: f.precio_pallet?.doubleValue || f.precio_pallet?.integerValue || 0,
      unidad:        f.unidad?.stringValue         || 'pallet',
      categoria:     f.categoria?.stringValue      || '',
    };
  });
}

async function guardarLead(lead) {
  const url  = `${FB_BASE}/leads_mayorista?key=${FB_API_KEY}`;
  const body = {
    fields: {
      nombre:    { stringValue: lead.nombre    || '' },
      empresa:   { stringValue: lead.empresa   || '' },
      producto:  { stringValue: lead.producto  || '' },
      cantidad:  { stringValue: lead.cantidad  || '' },
      canal:     { stringValue: 'instagram'         },
      timestamp: { stringValue: new Date().toISOString() },
    }
  };
  await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

// ── Conversación en memoria (Firebase como store) ─────────────────
async function getConversacion(userId) {
  try {
    const url = `${FB_BASE}/conversaciones_bot/${userId}?key=${FB_API_KEY}`;
    const res  = await fetch(url);
    const data = await res.json();
    if (data.fields?.messages?.arrayValue?.values) {
      return data.fields.messages.arrayValue.values.map(v => JSON.parse(v.stringValue));
    }
  } catch(e) {}
  return [];
}

async function guardarConversacion(userId, messages) {
  const url  = `${FB_BASE}/conversaciones_bot/${userId}?key=${FB_API_KEY}`;
  const vals = messages.slice(-20).map(m => ({ stringValue: JSON.stringify(m) }));
  const body = { fields: { messages: { arrayValue: { values: vals } }, updated: { stringValue: new Date().toISOString() } } };
  await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

// ── System prompt ─────────────────────────────────────────────────
async function buildSystemPrompt() {
  const productos = await getProductos();
  const lista = productos.map(p =>
    `- ${p.nombre} (${p.categoria}): $${p.precio_pallet} por pallet`
  ).join('\n');

  return `Sos el asistente de ventas mayoristas de AM Materiales, una empresa de materiales de construcción ubicada en Ruta 58 Km 10.5, Guernica, Buenos Aires.

Atendés SOLO a ferreterías y corralones de la zona sur del GBA. No atendés clientes finales ni particulares.

TU OBJETIVO es capturar el pedido del cliente siguiendo estos pasos en orden:
1. Saludar y presentarte brevemente
2. Preguntar qué producto quieren cotizar
3. Preguntar cantidad en pallets (mínimo 8 pallets por producto)
4. Preguntar nombre de la persona y nombre del negocio
5. Confirmar que un asesor los contacta en menos de 2 horas para cerrar el pedido

PRODUCTOS DISPONIBLES:
${lista}

REGLAS IMPORTANTES:
- Respondé siempre en español, tono informal pero profesional (tuteo)
- El mínimo es 8 pallets por producto, si piden menos explicalo amablemente
- NO des precios en la conversación, decí que el asesor confirma precio y condiciones
- Si preguntan algo fuera de tu alcance, decí que un asesor los va a contactar
- Mensajes cortos y directos, máximo 3 líneas por respuesta
- No uses asteriscos ni markdown, texto plano solamente
- Si el cliente ya dio toda la info (producto + cantidad + nombre + empresa), confirmá y cerrá la conversación

SEÑAL DE CIERRE: cuando tengas producto, cantidad, nombre y empresa, respondé con exactamente esta línea al final: [LEAD_COMPLETO]`;
}

// ── Handler principal ─────────────────────────────────────────────
exports.handler = async function(event) {
  if (event.httpMethod === 'GET') {
    // Verificación webhook de Meta
    const params = new URLSearchParams(event.rawQuery || '');
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
  try { body = JSON.parse(event.body); } catch(e) {
    return { statusCode: 400, body: 'Bad request' };
  }

  // Extraer mensaje de Instagram
  try {
    const entry    = body.entry?.[0];
    const messaging = entry?.messaging?.[0];
    if (!messaging) return { statusCode: 200, body: 'ok' };

    const userId  = messaging.sender?.id;
    const msgText = messaging.message?.text;
    if (!userId || !msgText) return { statusCode: 200, body: 'ok' };

    // Cargar historial
    const historial = await getConversacion(userId);
    historial.push({ role: 'user', content: msgText });

    // Llamar a Claude
    const systemPrompt = await buildSystemPrompt();
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: systemPrompt,
        messages: historial,
      }),
    });

    const claudeData = await claudeRes.json();
    let respuesta = claudeData.content?.[0]?.text || 'Disculpá, hubo un error. Intentá de nuevo.';

    // Detectar lead completo
    if (respuesta.includes('[LEAD_COMPLETO]')) {
      respuesta = respuesta.replace('[LEAD_COMPLETO]', '').trim();
      // Extraer datos básicos del historial para guardar
      const textoCompleto = historial.map(m => m.content).join(' ');
      await guardarLead({
        nombre:   'Ver conversación',
        empresa:  'Ver conversación',
        producto: 'Ver conversación',
        cantidad: 'Ver conversación',
        userId,
        textoCompleto: textoCompleto.slice(0, 500),
      });
    }

    // Guardar historial actualizado
    historial.push({ role: 'assistant', content: respuesta });
    await guardarConversacion(userId, historial);

    // Enviar respuesta por Instagram Graph API
    const igToken = process.env.IG_ACCESS_TOKEN;
    if (igToken) {
      await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${igToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: userId },
          message:   { text: respuesta },
        }),
      });
    }

    return { statusCode: 200, body: 'ok' };
  } catch(err) {
    console.error('Error agente:', err);
    return { statusCode: 200, body: 'ok' };
  }
};
