let currentTabId = null;
let commitments = [];
let scanTimedOut = false;
const state = new Map(); // company -> { company, category } (dedupe in UI too)

const el = {
  siteName: document.getElementById("site-name"),
  scoreBadge: document.getElementById("score-badge"),
  scoreLabel: document.getElementById("score-label"),
  totalNum: document.getElementById("total-num"),
  brokerNum: document.getElementById("broker-num"),
  list: document.getElementById("tracker-list"),
  emptyState: document.getElementById("empty-state"),
  optoutList: document.getElementById("optout-list"),
};

function computeScore() {
  const items = [...state.values()];
  const brokerCount = items.filter((i) => i.category === "data_broker").length;
  const weight =
    brokerCount * 3 +
    items.filter((i) => i.category === "advertising").length * 1.5 +
    items.filter((i) => i.category === "analytics").length * 1;

  let level = "low";
  if (weight >= 12 || brokerCount >= 3) level = "high";
  else if (weight >= 5 || brokerCount >= 1) level = "medium";

  // Only show "still scanning" briefly - after the timeout, zero trackers
  // found is a real result (low risk), not a stuck loading state.
  if (items.length === 0 && !scanTimedOut) level = "unknown";
  return { level, total: items.length, brokerCount };
}

function render() {
  const { level, total, brokerCount } = computeScore();

  el.scoreBadge.className = `score ${level}`;
  el.scoreLabel.textContent =
    level === "unknown"
      ? "Scanning…"
      : total === 0
      ? "None found"
      : level.toUpperCase();

  el.totalNum.textContent = total;
  el.brokerNum.textContent = brokerCount;
  el.emptyState.style.display = total === 0 ? "block" : "none";

  // Tracker list
  el.list.innerHTML = "";
  for (const item of state.values()) {
    const li = document.createElement("li");
    li.className = "tracker-row";
    li.innerHTML = `
      <div class="tracker-left">
        <span class="dot ${item.category}"></span>
        <span class="tracker-name">${item.company}</span>
      </div>
      <span class="cat-pill ${item.category}">${item.category.replace("_", " ")}</span>
    `;
    el.list.appendChild(li);
  }

  // Opt-out list
  el.optoutList.innerHTML = "";
  for (const item of state.values()) {
    const isCommitted = commitments.includes(item.company);
    const li = document.createElement("li");
    li.className = "optout-row";
    li.innerHTML = `
      <span>${item.company}</span>
      <span class="optout-status ${isCommitted ? "committed" : "unknown"}">
        ${isCommitted ? "Sent: committed" : "Sent: no known commitment"}
      </span>
    `;
    el.optoutList.appendChild(li);
  }
}

function addTracker({ company, category }) {
  if (state.has(company)) return; // already shown
  state.set(company, { company, category });
  render();
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  currentTabId = tab.id;

  try {
    el.siteName.textContent = new URL(tab.url).hostname;
  } catch {
    el.siteName.textContent = tab.url || "this page";
  }

  commitments = await fetch(chrome.runtime.getURL("gpc_commitments.json")).then((r) =>
    r.json()
  );

  const res = await chrome.runtime.sendMessage({
    type: "GET_TRACKERS_FOR_TAB",
    tabId: currentTabId,
  });
  (res?.trackers || []).forEach(addTracker);
  render();

  setTimeout(() => {
    scanTimedOut = true;
    render();
  }, 2500);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "TRACKER_DETECTED" && message.tabId === currentTabId) {
    addTracker(message);
  }
});

init();
