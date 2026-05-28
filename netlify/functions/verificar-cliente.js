// netlify/functions/verificar-cliente.js
// Firebase REST API — sin SDK, sin cuenta de servicio

const PROJECT = "am-materiales-12a2e";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

function limpiarNumero(n) {
  return n.replace(/[\s\-\+]/g, "").replace(/^54/, "").replace(/^0/, "");
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

  const { telefono } = body;
  const apiKey = process.env.FIREBASE_API_KEY;

  if (!telefono) return respond({ es_cliente: false, tipo: null });

  try {
    const numLimpio = limpiarNumero(String(telefono));

    const res = await fetch(`${BASE}:runQuery?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "clientes_base" }],
          where: { fieldFilter: { field: { fieldPath: "telefono" }, op: "EQUAL", value: { stringValue: numLimpio } } },
          limit: 1,
        },
      }),
    });

    const rows = await res.json();
    const doc = rows[0]?.document;

    if (doc?.fields) {
      const f = doc.fields;
      return respond({
        es_cliente: true,
        tipo: f.tipo?.stringValue || "minorista",
        negocio: f.negocio?.stringValue || null,
        pedidos: Number(f.pedidos_realizados?.integerValue || 0),
      });
    }

    return respond({ es_cliente: false, tipo: null });
  } catch (err) {
    console.error(err);
    return respond({ es_cliente: false, tipo: null });
  }
};

function respond(obj) {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(obj),
  };
}
