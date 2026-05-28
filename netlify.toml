// netlify/functions/cotizar.js
// Firebase REST API — sin SDK, sin cuenta de servicio
// Solo necesita FIREBASE_API_KEY y BOT_SECRET_TOKEN en Netlify env vars

const PROJECT = "am-materiales-12a2e";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

// Palabras clave → categoría
const KEYWORDS = {
  weber: "weber", ceramico: "weber", porcellanato: "weber",
  porcelanato: "weber", pegamento: "weber", revoque: "weber",
  promex: "weber", fino: "weber", superflex: "weber",
  pastina: "weber", hormivisto: "weber", flex: "weber",
  cemento: "cemento", "loma negra": "cemento", cacique: "cemento", portland: "cemento",
  hidrofugo: "hidrofugo", ceresita: "hidrofugo",
  yeso: "yeso", tuyango: "yeso", proyectable: "yeso",
  membrana: "membranas", megaflex: "membranas", clipperflex: "membranas",
  malla: "mallas",
  aditivo: "aditivos", vinilico: "aditivos", tacuru: "aditivos",
};

function detectCategoria(texto) {
  const lower = texto.toLowerCase();
  for (const [kw, cat] of Object.entries(KEYWORDS)) {
    if (lower.includes(kw)) return cat;
  }
  return null;
}

// Convierte documento Firestore REST a objeto JS plano
function fromFirestore(doc) {
  if (!doc.fields) return null;
  const obj = {};
  for (const [key, val] of Object.entries(doc.fields)) {
    if (val.stringValue !== undefined) obj[key] = val.stringValue;
    else if (val.doubleValue !== undefined) obj[key] = val.doubleValue;
    else if (val.integerValue !== undefined) obj[key] = Number(val.integerValue);
    else if (val.booleanValue !== undefined) obj[key] = val.booleanValue;
    else if (val.nullValue !== undefined) obj[key] = null;
  }
  return obj;
}

function formatPrecio(n) {
  return "$" + Math.round(n).toLocaleString("es-AR");
}

function buildMensaje(productos) {
  if (!productos.length) {
    return "No encontré ese producto en la lista. Escribí *EQUIPO* para hablar con alguien del equipo.";
  }
  const lineas = productos.map((p) => {
    const pallet = p.unidades_pallet
      ? ` · ${p.unidades_pallet} u/pallet · Pallet: ${formatPrecio(p.precio_pallet)}`
      : "";
    return `• ${p.nombre} — ${formatPrecio(p.precio_unitario)}${pallet}`;
  });
  const footer = productos.some((p) => p.unidades_pallet)
    ? "\n\nMínimo 8 pallets. ¿Cuántos necesitás?"
    : "\n\nEscribí la cantidad que necesitás.";
  return lineas.join("\n") + footer;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-bot-token" }, body: "" };
  }
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  const token = event.headers["x-bot-token"];
  if (token !== process.env.BOT_SECRET_TOKEN) return { statusCode: 401, body: "Unauthorized" };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: "Bad Request" }; }

  const { texto, subscriber_id } = body;
  const apiKey = process.env.FIREBASE_API_KEY;

  if (!texto) {
    return respond({ mensaje: "¿Qué producto querés cotizar? (ej: weber, cemento, yeso, hidrófugo)" });
  }

  try {
    const categoria = detectCategoria(texto);

    // Query a Firestore REST API
    const query = {
      structuredQuery: {
        from: [{ collectionId: "productos_mayorista" }],
        where: {
          compositeFilter: {
            op: "AND",
            filters: [
              { fieldFilter: { field: { fieldPath: "activo" }, op: "EQUAL", value: { booleanValue: true } } },
              ...(categoria ? [{ fieldFilter: { field: { fieldPath: "categoria" }, op: "EQUAL", value: { stringValue: categoria } } }] : []),
            ],
          },
        },
        orderBy: [{ field: { fieldPath: "precio_unitario" }, direction: "ASCENDING" }],
      },
    };

    const res = await fetch(`${BASE}:runQuery?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
    });

    const rows = await res.json();
    let productos = rows
      .filter((r) => r.document)
      .map((r) => fromFirestore(r.document))
      .filter(Boolean);

    // Si no hay categoría, filtrar por nombre
    if (!categoria) {
      const lower = texto.toLowerCase();
      productos = productos.filter((p) => p.nombre?.toLowerCase().includes(lower));
    }

    const mensaje = buildMensaje(productos);

    // Log consulta (sin await para no demorar la respuesta)
    fetch(`${BASE}/consultas_bot?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          subscriber_id: { stringValue: subscriber_id || "desconocido" },
          texto: { stringValue: texto },
          categoria: { stringValue: categoria || "ninguna" },
          resultados: { integerValue: productos.length },
          timestamp: { stringValue: new Date().toISOString() },
        },
      }),
    }).catch(() => {});

    return respond({ mensaje });
  } catch (err) {
    console.error(err);
    return respond({ mensaje: "Hubo un problema consultando los precios. Escribí *EQUIPO* para que te ayudemos." });
  }
};

function respond(obj) {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(obj),
  };
}
