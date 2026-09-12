const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Tracker = { company_name?: string; category?: string };
type RiskLevel = "low" | "medium" | "high";

function fallbackSummary(trackers: Tracker[]) {
  const dataBrokers = trackers.filter((tracker) =>
    String(tracker.category ?? "").toLowerCase().includes("data_broker")
  ).length;
  const riskLevel: RiskLevel = dataBrokers >= 2 || trackers.length >= 8
    ? "high"
    : dataBrokers >= 1 || trackers.length >= 3
    ? "medium"
    : "low";
  const brokerPhrase = dataBrokers === 1 ? " including 1 data broker" : dataBrokers > 1 ? ` including ${dataBrokers} data brokers` : "";

  return {
    summary: `This page contacted ${trackers.length} ${trackers.length === 1 ? "company" : "companies"}${brokerPhrase}.`,
    risk_level: riskLevel,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Use POST." }, 405);

  let body: { page_url?: unknown; trackers?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Body must be valid JSON." }, 400);
  }

  if (typeof body.page_url !== "string" || !Array.isArray(body.trackers)) {
    return jsonResponse({ error: "page_url (string) and trackers (array) are required." }, 400);
  }

  const trackers: Tracker[] = body.trackers.slice(0, 30).map((tracker) => ({
    company_name: typeof tracker?.company_name === "string" ? tracker.company_name.slice(0, 120) : undefined,
    category: typeof tracker?.category === "string" ? tracker.category.slice(0, 80) : undefined,
  }));
  const fallback = fallbackSummary(trackers);
  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) return jsonResponse(fallback);

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "Return JSON only: {\"summary\": string, \"risk_level\": \"low\"|\"medium\"|\"high\"}. Write one short, plain-English privacy sentence. Risk rises with tracker count and especially data brokers.",
          },
          { role: "user", content: JSON.stringify({ page_url: body.page_url, trackers }) },
        ],
        temperature: 0.2,
        max_tokens: 100,
      }),
    });
    if (!response.ok) throw new Error(`OpenRouter returned ${response.status}`);
    const completion = await response.json();
    const parsed = JSON.parse(completion.choices?.[0]?.message?.content ?? "{}");
    if (typeof parsed.summary !== "string" || !["low", "medium", "high"].includes(parsed.risk_level)) throw new Error("Invalid model JSON");
    return jsonResponse({ summary: parsed.summary.slice(0, 350), risk_level: parsed.risk_level });
  } catch (error) {
    console.error("Risk summary fallback:", error);
    return jsonResponse(fallback);
  }
});
