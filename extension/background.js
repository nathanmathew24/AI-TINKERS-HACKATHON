import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

// --- Load the tracker dataset once at startup ---
let TRACKER_MAP = []; // array of { domain, company, category }

async function loadTrackers() {
  const url = chrome.runtime.getURL("trackers.json");
  const res = await fetch(url);
  TRACKER_MAP = await res.json();
}
loadTrackers().catch((err) => console.error("[Expose] failed to load trackers.json", err));

// --- Helpers ---

// Very simplified "registrable domain" extraction — good enough for a demo,
// not a full public-suffix-list implementation.
function getRegistrableDomain(hostname) {
  const parts = hostname.split(".");
  if (parts.length <= 2) return hostname;
  return parts.slice(-2).join(".");
}

function matchTracker(hostname) {
  return TRACKER_MAP.find(
    (t) => hostname === t.domain || hostname.endsWith("." + t.domain)
  );
}

// Dedupe so we don't insert the same tracker for the same page load 50 times
// (many trackers fire repeatedly, e.g. pixel pings).
const seen = new Set(); // key: `${tabId}::${trackerDomain}`

// What the popup renders: per-tab list of trackers found on the current page.
const tabTrackers = new Map(); // tabId -> [{ company, category, domain }]

// The actual current page URL per tab (webRequest's `initiator` is only an
// origin, not the full URL with path — this is what gives us the real one).
const tabUrls = new Map(); // tabId -> full page URL

function recordForTab(tabId, match) {
  if (!tabTrackers.has(tabId)) tabTrackers.set(tabId, []);
  tabTrackers.get(tabId).push({
    company: match.company,
    category: match.category,
    domain: match.domain,
  });
}

// Reset dedupe + popup state when a tab navigates to a new top-level page.
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) {
    for (const key of [...seen]) {
      if (key.startsWith(details.tabId + "::")) seen.delete(key);
    }
    tabTrackers.set(details.tabId, []);
    tabUrls.set(details.tabId, details.url);
  }
});

async function insertTrackerEvent(pageUrl, trackerDomain, company, category) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/tracker_events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        page_url: pageUrl,
        tracker_domain: trackerDomain,
        company_name: company,
        category: category,
      }),
    });
  } catch (err) {
    console.error("[Expose] insert failed", err);
  }
}

// Every detected company also gets a GPC opt-out log entry, since the
// Sec-GPC header (set via gpc_rules.json) is already being sent to every
// outbound request regardless. This just records that fact per company so
// the dashboard can show it. Status is always "sent" — whether a company
// actually honors it is a separate, unverifiable question the UI is honest
// about, not something this log claims to know.
async function insertOptoutLog(company) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/optout_log`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        company_name: company,
        method: "GPC",
        status: "sent",
      }),
    });
  } catch (err) {
    console.error("[Expose] optout log insert failed", err);
  }
}

// --- Core capture: observe every outbound request, non-blocking ---
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return; // ignore requests not tied to a tab
    if (!details.initiator && !details.url) return;

    let requestHost, pageHost, pageUrl;
    try {
      requestHost = new URL(details.url).hostname;
      // Prefer the real tracked page URL (has the full path); fall back to
      // initiator (origin only) or the request's own URL for edge cases
      // where we haven't seen a navigation event for this tab yet.
      pageUrl = tabUrls.get(details.tabId) || details.initiator || details.url;
      pageHost = new URL(pageUrl).hostname;
    } catch {
      return;
    }

    // Only care about third-party requests
    if (getRegistrableDomain(requestHost) === getRegistrableDomain(pageHost)) {
      return;
    }

    const match = matchTracker(requestHost);
    if (!match) return;

    const dedupeKey = `${details.tabId}::${match.domain}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    insertTrackerEvent(pageUrl, match.domain, match.company, match.category);
    insertOptoutLog(match.company);
    recordForTab(details.tabId, match);

    // Also tell the popup (if open) about this live event for this tab
    chrome.runtime
      .sendMessage({
        type: "TRACKER_DETECTED",
        tabId: details.tabId,
        company: match.company,
        category: match.category,
      })
      .catch(() => {}); // no listener open, ignore
  },
  { urls: ["<all_urls>"] }
);

// --- Popup asks: "what have you seen on this tab so far?" ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "GET_TRACKERS_FOR_TAB") return;
  sendResponse({ trackers: tabTrackers.get(message.tabId) || [] });
  return true; // keep the message channel open for the async response
});

// --- Secondary signal from content.js: script tags found on the page ---
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type !== "SCRIPT_HOSTS_FOUND") return;
  const tabId = sender.tab ? sender.tab.id : -1;

  for (const host of message.hosts) {
    const match = matchTracker(host);
    if (!match) continue;

    const dedupeKey = `${tabId}::${match.domain}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    insertTrackerEvent(message.pageUrl, match.domain, match.company, match.category);
    insertOptoutLog(match.company);
    recordForTab(tabId, match);

    chrome.runtime
      .sendMessage({
        type: "TRACKER_DETECTED",
        tabId,
        company: match.company,
        category: match.category,
      })
      .catch(() => {});
  }
});
