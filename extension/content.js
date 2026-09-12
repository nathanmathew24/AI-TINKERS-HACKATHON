// Secondary signal: scan the page's own <script> tags for known tracker
// domains. This catches some tracking that the network-request listener in
// background.js might narrowly miss, and doubles as a signal source that
// doesn't depend on timing. It does NOT catch server-side tracking - nothing
// running in the browser can see that.

function collectScriptHosts() {
  const hosts = new Set();
  document.querySelectorAll("script[src]").forEach((el) => {
    try {
      hosts.add(new URL(el.src, location.href).hostname);
    } catch {
      /* ignore malformed src */
    }
  });
  return [...hosts];
}

chrome.runtime.sendMessage({
  type: "SCRIPT_HOSTS_FOUND",
  pageUrl: location.href,
  hosts: collectScriptHosts(),
}).catch(() => {});
