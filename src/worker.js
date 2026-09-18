const UPSTREAM = "https://digikala-mcp.mmdju.workers.dev/mcp";

const TRACKER_TOOLS = [
  {
    name: "find_real_price_drops",
    description: "Find products whose current price is lower than previously observed prices in this install's D1 history.",
    inputSchema: {
      type: "object",
      properties: {
        min_drop_percent: { type: "number", description: "Minimum price drop percentage. Default 20." },
        hours: { type: "number", description: "Look-back window in hours. Default 168." },
        limit: { type: "number", description: "Maximum results. Default 20, max 50." }
      }
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: "price_history",
    description: "Show locally collected price snapshots for a Digikala product.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "number" },
        hours: { type: "number", description: "Look-back window in hours. Default 168." },
        limit: { type: "number", description: "Maximum observations. Default 30, max 100." }
      }
    },
    annotations: { readOnlyHint: true }
  }
];

async function upstreamRpc(method, params = {}) {
  const res = await fetch(UPSTREAM, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept": "application/json, text/event-stream",
      "user-agent": "payanag2-digikala-mcp/1.0"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method,
      params
    })
  });
  const text = await res.text();
  if (!res.ok) throw new Error("Upstream MCP HTTP " + res.status);
  const lines = text.split("\\n").filter(x => x.startsWith("data:"));
  const payload = lines.map(x => x.slice(5).trim()).filter(Boolean).at(-1) || text;
  return JSON.parse(payload);
}

function rpc(id, result) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: { "content-type": "application/json" }
  });
}

function rpcError(id, code, message) {
  return new Response(JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: { code, message }
  }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

async function callUpstreamTool(name, args) {
  const r = await upstreamRpc("tools/call", {
    name,
    arguments: args || {}
  });
  const text = r.result?.content?.find(x => x.type === "text")?.text || "";
  if (r.result?.isError) throw new Error(text || "Upstream tool failed");
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function collectOffers(env) {
  if (!env.DB) return;

  const data = await callUpstreamTool("incredible_offers", {
    limit: 30,
    only_marketable: true
  });

  const items = Array.isArray(data?.items) ? data.items : [];
  const now = Math.floor(Date.now() / 1000);

  for (const p of items) {
    const productId = Number(p.id);
    const price = Number(p.price_toman);
    if (!Number.isFinite(productId) || !Number.isFinite(price) || price <= 0) continue;

    await env.DB.prepare(
      "INSERT INTO price_history (product_id,title,url,price_toman,discount_percent,captured_at) VALUES (?,?,?,?,?,?)"
    ).bind(
      productId,
      String(p.title || ""),
      String(p.url || ""),
      Math.round(price),
      Number.isFinite(Number(p.discount_percent)) ? Number(p.discount_percent) : null,
      now
    ).run();
  }

  await env.DB.prepare(
    "INSERT INTO tracker_meta(key,value) VALUES('last_collection',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
  ).bind(String(now)).run();

  await env.DB.prepare(
    "DELETE FROM price_history WHERE captured_at < ?"
  ).bind(now - 90 * 86400).run();
}

async function findRealDrops(env, args) {
  const minDrop = Math.max(0, Number(args?.min_drop_percent ?? 20));
  const hours = Math.min(24 * 90, Math.max(1, Number(args?.hours ?? 168)));
  const limit = Math.min(50, Math.max(1, Number(args?.limit ?? 20)));
  const since = Math.floor(Date.now() / 1000) - hours * 3600;

  const sql =
    "WITH current AS (" +
    " SELECT ph.* FROM price_history ph" +
    " JOIN (SELECT product_id, MAX(captured_at) AS max_time FROM price_history GROUP BY product_id) x" +
    " ON x.product_id=ph.product_id AND x.max_time=ph.captured_at" +
    "), previous AS (" +
    " SELECT ph.product_id, MIN(ph.price_toman) AS min_previous_price" +
    " FROM price_history ph JOIN current c ON c.product_id=ph.product_id" +
    " WHERE ph.captured_at >= ? AND ph.captured_at < c.captured_at" +
    " GROUP BY ph.product_id" +
    ") SELECT c.product_id AS id,c.title,c.url,c.price_toman AS current_price_toman," +
    "p.min_previous_price AS previous_best_price_toman," +
    "ROUND((p.min_previous_price-c.price_toman)*100.0/p.min_previous_price,2) AS drop_percent," +
    "c.discount_percent,c.captured_at FROM current c JOIN previous p ON p.product_id=c.product_id" +
    " WHERE p.min_previous_price>c.price_toman" +
    " AND ((p.min_previous_price-c.price_toman)*100.0/p.min_previous_price)>=?" +
    " ORDER BY drop_percent DESC LIMIT ?";

  const { results } = await env.DB.prepare(sql)
    .bind(since, minDrop, limit)
    .all();

  return {
    source: "locally collected price history",
    window_hours: hours,
    min_drop_percent: minDrop,
    items: results || []
  };
}

async function getHistory(env, args) {
  const id = Number(args?.id);
  if (!Number.isFinite(id)) throw new Error("id must be a number");

  const hours = Math.min(24 * 90, Math.max(1, Number(args?.hours ?? 168)));
  const limit = Math.min(100, Math.max(1, Number(args?.limit ?? 30)));
  const since = Math.floor(Date.now() / 1000) - hours * 3600;

  const { results } = await env.DB.prepare(
    "SELECT product_id AS id,title,url,price_toman,discount_percent,captured_at" +
    " FROM price_history WHERE product_id=? AND captured_at>=?" +
    " ORDER BY captured_at DESC LIMIT ?"
  ).bind(id, since, limit).all();

  return {
    id,
    window_hours: hours,
    points: results || []
  };
}

async function localTool(env, name, args) {
  if (!env.DB) throw new Error(
    "D1 is not configured. Create the D1 database and bind it as DB in wrangler.toml."
  );

  if (name === "find_real_price_drops") return findRealDrops(env, args);
  if (name === "price_history") return getHistory(env, args);
  return null;
}

async function handle(request, env) {
  if (request.method !== "POST") {
    return new Response("Digikala MCP price tracker", { status: 200 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return rpcError(null, -32700, "Invalid JSON");
  }

  const id = body.id ?? null;
  const method = body.method;

  if (method === "initialize") {
    return rpc(id, {
      protocolVersion: body.params?.protocolVersion || "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: {
        name: "digikala-mcp-payanag2",
        version: "1.0.0-price-tracker"
      }
    });
  }

  if (method === "notifications/initialized") {
    return new Response(null, { status: 204 });
  }

  if (method === "tools/list") {
    const upstream = await upstreamRpc("tools/list", {});
    return rpc(id, {
      tools: [...(upstream.result?.tools || []), ...TRACKER_TOOLS]
    });
  }

  if (method === "tools/call") {
    const name = body.params?.name;
    const args = body.params?.arguments || {};
    const local = name === "find_real_price_drops" || name === "price_history";

    if (local) {
      try {
        const data = await localTool(env, name, args);
        return rpc(id, {
          content: [{ type: "text", text: JSON.stringify(data) }]
        });
      } catch (e) {
        return rpc(id, {
          isError: true,
          content: [{ type: "text", text: String(e.message || e) }]
        });
      }
    }

    const upstream = await upstreamRpc("tools/call", {
      name,
      arguments: args
    });

    return rpc(id, upstream.result || upstream.error);
  }

  return rpcError(id, -32601, "Method not found");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/mcp") return new Response("Digikala MCP", { status: 200 });

    try {
      return await handle(request, env);
    } catch (e) {
      return rpcError(null, -32000, String(e.message || e));
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      collectOffers(env).catch(() => {})
    );
  }
};
