/ netlify/functions/pedido.js
// Firebase REST API — sin SDK, sin cuenta de servicio

const PROJECT = "am-materiales-12a2e";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

function toFirestore(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) fields[k] = { nullValue: null };
    else if (typeof v === "string") fields[k] = { stringValue: v };
    else if (typeof v === "number") fields[k] = { doubleValue: v };
    else if (typeof v === "boolean") fields[k] = { booleanValue: v };
    else if (Array.isArray(v)) {
      fields[k] = {
        arrayValue: {
          values: v.map((item) =>
            typeof item === "object"
              ? { mapValue: { fields: toFirestore(item) } }
              : typeof item === "string"
              ? { stringValue: item }
              : { doubleValue: item }
          ),
        },
      };
    }
  }
  return fields;
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

  const { negocio, cuit, direccion, telefono, productos, subscriber_id, canal } = body;
  const apiKey = process.env.FIREBASE_API_KEY;

  // Validar campos mínimos
  const faltantes = [];
  if (!negocio) faltantes.push("nombre del negocio");
  if (!cuit) faltantes.push("CUIT");
  if (!direccion) faltantes.push("dirección de entrega");
  if (!telefono) faltantes.push("teléfono");

  if (faltantes.length) {
    return respond({ ok: false, mensaje: `Faltán: ${faltantes.join(", ")}. ¿Me los pasás?` });
  }

  try {
    const total = productos?.reduce((acc, p) => acc + (p.precio_pallet || 0) * (p.pallets || 0), 0) || 0;
    const fecha = new Date().toISOString();

    // Guardar pedido
    const pedidoData = {
      negocio, cuit, direccion, telefono,
      canal: canal || "whatsapp",
      subscriber_id: subscriber_id || "",
      estado: "pendiente",
      total_estimado: total,
      timestamp: fecha,
      fecha: new Date().toLocaleDateString("es-AR"),
    };

    const pedidoRes = await fetch(`${BASE}/pedidos_mayorista?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: toFirestore(pedidoData) }),
    });

    const pedidoDoc = await pedidoRes.json();
    const pedidoId = pedidoDoc.name?.split("/").pop() || "sin-id";

    // Buscar si ya existe el cliente por CUIT
    const busqueda = await fetch(`${BASE}:runQuery?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "clientes_base" }],
          where: { fieldFilter: { field: { fieldPath: "cuit" }, op: "EQUAL", value: { stringValue: cuit } } },
          limit: 1,
        },
      }),
    });

    const clienteRows = await busqueda.json();
    const clienteExistente = clienteRows[0]?.document;

    if (clienteExistente) {
      // Actualizar pedidos_realizados
      const pedidosActuales = clienteExistente.fields?.pedidos_realizados?.integerValue || 0;
      const clientePath = clienteExistente.name;
      await fetch(`${clientePath}?key=${apiKey}&updateMask.fieldPaths=pedidos_realizados&updateMask.fieldPaths=ultimo_pedido`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: {
            pedidos_realizados: { integerValue: Number(pedidosActuales) + 1 },
            ultimo_pedido: { stringValue: fecha },
          },
        }),
      });
    } else {
      // Crear cliente nuevo
      await fetch(`${BASE}/clientes_base?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: toFirestore({
            negocio, cuit, telefono,
            canal: canal || "whatsapp",
            tipo: "mayorista",
            pedidos_realizados: 1,
            primer_contacto: fecha,
            ultimo_pedido: fecha,
          }),
        }),
      });
    }

    const resumen = productos?.length
      ? `\n\n📦 ${productos.map((p) => `${p.nombre} × ${p.pallets} pallets`).join("\n📦 ")}`
      : "";

    return respond({
      ok: true,
      pedido_id: pedidoId,
      mensaje: `✅ Pedido registrado.\n\n🏪 ${negocio}\n🔢 CUIT: ${cuit}\n📍 ${direccion}\n📞 ${telefono}${resumen}\n\nNuestro equipo te contacta en las próximas 2hs hábiles. ¡Gracias!`,
    });
  } catch (err) {
    console.error(err);
    return respond({ ok: false, mensaje: "Hubo un problema registrando el pedido. Escribí *EQUIPO* para que te ayudemos." });
  }
};

function respond(obj) {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(obj),
  };
}
