import { getStore } from "@netlify/blobs";

export default async (req, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (req.method === "OPTIONS") {
    return new Response("OK", { status: 200, headers });
  }

  const store = getStore("bantay-baha-telemetry");

  try {
    // GET: Serve latest reading and last 30 records to public/index.html
    if (req.method === "GET") {
      const latest = (await store.get("latest", { type: "json" })) || {
        water_cm: 0.0,
        tier: "SAFE",
        source: "WAITING",
        updated_at: null,
        history: [],
      };
      return new Response(JSON.stringify(latest), { status: 200, headers });
    }

    // POST: Receive 4G SIM Packet Data from ESP32 + SIMCom A7670C
    if (req.method === "POST") {
      const contentType = req.headers.get("content-type") || "";
      let waterCm = null;
      let tier = null;
      let source = "4G_DATA";

      if (contentType.includes("application/json")) {
        const body = await req.json();
        if (body.message || body.text || body.sms) {
          const rawSms = String(body.message || body.text || body.sms);
          source = "SMS_GATEWAY";
          const cmMatch = rawSms.match(/([0-9]+(?:\.[0-9]+)?)\s*cm/i);
          const tierMatch = rawSms.match(/\[(SAFE|WARNING|CRITICAL)\]/i);
          if (cmMatch) waterCm = parseFloat(cmMatch[1]);
          if (tierMatch) tier = tierMatch[1].toUpperCase();
        } else {
          waterCm = parseFloat(body.water_cm);
          tier = body.tier ? String(body.tier).toUpperCase() : null;
          source = body.source || "4G_DATA";
        }
      } else {
        const text = await req.text();
        const params = new URLSearchParams(text);
        const rawSms = params.get("Body") || params.get("message") || text;
        source = "SMS_GATEWAY";
        const cmMatch = rawSms.match(/([0-9]+(?:\.[0-9]+)?)\s*cm/i);
        const tierMatch = rawSms.match(/\[(SAFE|WARNING|CRITICAL)\]/i);
        if (cmMatch) waterCm = parseFloat(cmMatch[1]);
        if (tierMatch) tier = tierMatch[1].toUpperCase();
      }

      if (waterCm === null || Number.isNaN(waterCm)) {
        return new Response(
          JSON.stringify({ error: "Invalid or missing water_cm value" }),
          { status: 400, headers }
        );
      }

      // MDRRMO Three-Tier Benchmark Classification
      if (!tier) {
        if (waterCm >= 20.0) tier = "CRITICAL";
        else if (waterCm >= 15.0) tier = "WARNING";
        else tier = "SAFE";
      }

      const timestamp = new Date().toISOString();
      const prev = (await store.get("latest", { type: "json" })) || { history: [] };
      const history = Array.isArray(prev.history) ? prev.history : [];

      const entry = {
        water_cm: Number(waterCm.toFixed(2)),
        tier,
        source,
        updated_at: timestamp,
      };

      history.unshift(entry);
      if (history.length > 30) history.length = 30;

      const updatedState = {
        ...entry,
        history,
      };

      await store.setJSON("latest", updatedState);

      return new Response(JSON.stringify({ ok: true, data: entry }), {
        status: 200,
        headers,
      });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers,
    });
  }
};
