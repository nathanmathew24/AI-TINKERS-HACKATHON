const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Tracker = { company_name?: string; category?: string };
type RiskLevel = "low" | "medium" | "high";

// Must stay identical to extension/popup.js's computeScore() weight formula.
// The popup and this function are two separate surfaces showing the same
// page's risk level — if the formulas ever drift apart, they can disagree
// on the same data, which is the single most damaging inconsistency this
// product can show. The AI below only ever writes the sentence; it never
// decides low/medium/high.
function computeRiskLevel(trackers: Tracker[]): { level: RiskLevel; brokerCount: number } {
  const brokerCount = trackers.filter((t) => t.category === "data_broker").length;
  const advertisingCount = trackers.filter((t) => t.category === "advertising").length;
  const analyticsCount = trackers.filter((t) => t.category === "analytics").length;
  const weight = brokerCount * 3 + advertisingCount * 1.5 + analyticsCount * 1;

  let level: RiskLevel = "low";
  if (weight >= 12 || brokerCount >= 3) level = "high";
  else if (weight >= 5 || brokerCount >= 1) level = "medium";

  return { level, brokerCount };
}

function fallbackSummary(trackers: Tracker[]) {
  const { level, brokerCount } = computeRiskLevel(trackers);
  const brokerPhrase = brokerCount === 1 ? " including 1 data broker" : brokerCount > 1 ? ` including ${brokerCount} data brokers` : "";

  return {
    summary: `This page contacted ${trackers.length} ${trackers.length === 1 ? "company" : "companies"}${brokerPhrase}.`,
    risk_level: level,
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

  // Computed once, always used for risk_level regardless of what the model
  // says — see computeRiskLevel's comment.
  const { level } = computeRiskLevel(trackers);

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
            content: `Return JSON only: {"summary": string}. Write one short, plain-English sentence describing what just happened on this page for a non-technical reader. We have already determined the risk level ourselves as "${level}" - do not state a different risk level or contradict it, just describe the companies and, if relevant, mention data brokers by name.`,
          },
          { role: "user", content: JSON.stringify({ page_url: body.page_url, trackers, risk_level: level }) },
        ],
        temperature: 0.2,
        max_tokens: 100,
      }),
    });
    if (!response.ok) throw new Error(`OpenRouter returned ${response.status}`);
    const completion = await response.json();
    const parsed = JSON.parse(completion.choices?.[0]?.message?.content ?? "{}");
    if (typeof parsed.summary !== "string") throw new Error("Invalid model JSON");
    return jsonResponse({ summary: parsed.summary.slice(0, 350), risk_level: level });
  } catch (error) {
    console.error("Risk summary fallback:", error);
    return jsonResponse(fallback);
  }
});
