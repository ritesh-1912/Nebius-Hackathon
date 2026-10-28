/**
 * Upgrade Pilot — Client Application & Real-Time SSE Consumer
 */

let selectedDemo = "demo_pydantic";
let eventSource = null;
let eventCount = 0;
let lastDiff = "";
let lastPrSummary = "";

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  fetchPricing();
  fetchDemos();
});

// Fetch backend pricing reference
async function fetchPricing() {
  try {
    const res = await fetch("/api/pricing");
    const data = await res.json();
    console.log("Nebius Token Factory Pricing:", data);
  } catch (err) {
    console.warn("Could not load pricing table:", err);
  }
}

// Fetch demos metadata
async function fetchDemos() {
  try {
    const res = await fetch("/api/demos");
    const demos = await res.json();
    console.log("Demos loaded:", demos);
  } catch (err) {
    console.warn("Could not load demos list:", err);
  }
}

// Demo Selection Handler
function selectDemo(demoId) {
  if (eventSource) return; // Prevent switching while running
  selectedDemo = demoId;

  const cardPyd = document.getElementById("card-demo_pydantic");
  const cardSql = document.getElementById("card-demo_sqlalchemy");
  const checkPyd = document.getElementById("check-demo_pydantic");
  const checkSql = document.getElementById("check-demo_sqlalchemy");

  if (demoId === "demo_pydantic") {
    cardPyd.className = "cursor-pointer glass-panel-glow border-2 border-nvidia p-5 rounded-xl transition duration-200 hover:scale-[1.01] relative overflow-hidden bg-gradient-to-br from-slate-900/90 to-emerald-950/20";
    cardSql.className = "cursor-pointer glass-panel border border-white/10 p-5 rounded-xl transition duration-200 hover:scale-[1.01] hover:border-white/30 relative overflow-hidden bg-gradient-to-br from-slate-900/80 to-slate-950";
    checkPyd.classList.remove("hidden");
    checkSql.classList.add("hidden");
  } else {
    cardSql.className = "cursor-pointer glass-panel-glow border-2 border-blue-400 p-5 rounded-xl transition duration-200 hover:scale-[1.01] relative overflow-hidden bg-gradient-to-br from-slate-900/90 to-blue-950/20";
    cardPyd.className = "cursor-pointer glass-panel border border-white/10 p-5 rounded-xl transition duration-200 hover:scale-[1.01] hover:border-white/30 relative overflow-hidden bg-gradient-to-br from-slate-900/80 to-slate-950";
    checkSql.classList.remove("hidden");
    checkPyd.classList.add("hidden");
  }
}

// Start Upgrade Pipeline
function startUpgrade() {
  if (eventSource) return;

  // UI state transition
  document.getElementById("emptyState").classList.add("hidden");
  document.getElementById("progressSection").classList.remove("hidden");
  document.getElementById("resetBtn").classList.remove("hidden");
  document.getElementById("livePulse").classList.remove("hidden");
  document.getElementById("finalResultsSection").classList.add("hidden");

  const runBtn = document.getElementById("runBtn");
  const runBtnText = document.getElementById("runBtnText");
  const runBtnIcon = document.getElementById("runBtnIcon");
  runBtn.disabled = true;
  runBtn.classList.add("opacity-75", "cursor-not-allowed");
  runBtnIcon.innerHTML = `<svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-black" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg>`;
  runBtnText.innerText = "Agent Upgrading...";

  updateStatus("Agent Running", "running");

  // Reset counters
  eventCount = 0;
  document.getElementById("eventCountLabel").innerText = "0 events";
  document.getElementById("timelineFeed").innerHTML = "";

  // Connect to SSE stream
  const streamUrl = `/api/upgrade/stream?demo=${encodeURIComponent(selectedDemo)}`;
  eventSource = new EventSource(streamUrl);

  eventSource.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data);
      handleAgentEvent(event);
    } catch (err) {
      console.error("Failed to parse event data:", err, e.data);
    }
  };

  eventSource.onerror = (err) => {
    console.warn("EventSource stream closed or disconnected:", err);
    finishRun(false, "Connection closed");
  };
}

// Process individual typed event
function handleAgentEvent(event) {
  eventCount++;
  document.getElementById("eventCountLabel").innerText = `${eventCount} events`;

  // Update Telemetry Panel
  if (event.telemetry && event.telemetry.cumulative) {
    updateTelemetry(event.telemetry.cumulative);
  }

  // Update Test Progress Bar
  if (event.payload && event.payload.test_summary) {
    updateTestProgress(event.payload.test_summary, event.iteration);
  }

  // Render Timeline Card
  renderTimelineCard(event);

  // Check if completed or final diff available
  if (event.payload && event.payload.diff) {
    lastDiff = event.payload.diff;
  }
  if (event.payload && event.payload.pr_summary) {
    lastPrSummary = event.payload.pr_summary;
  }

  if (event.step === "COMPLETED") {
    const isSuccess = event.status === "success";
    finishRun(isSuccess, event.message);
    showFinalResults();
  }
}

// Telemetry Panel Update
function updateTelemetry(cum) {
  if (!cum) return;
  document.getElementById("telemetryTotalCost").innerText = `$${cum.total_cost_usd.toFixed(6)}`;
  document.getElementById("telemetryTotalTokens").innerText = cum.total_tokens.toLocaleString();

  const tiers = cum.tiers || {};
  if (tiers.ultra) {
    document.getElementById("costUltra").innerText = `$${tiers.ultra.cost_usd.toFixed(6)}`;
    document.getElementById("tokensUltra").innerText = tiers.ultra.total_tokens.toLocaleString();
  }
  if (tiers.super) {
    document.getElementById("costSuper").innerText = `$${tiers.super.cost_usd.toFixed(6)}`;
    document.getElementById("tokensSuper").innerText = tiers.super.total_tokens.toLocaleString();
    document.getElementById("reasoningSuper").innerText = tiers.super.reasoning_tokens.toLocaleString();
  }
  if (tiers.nano) {
    document.getElementById("costNano").innerText = `$${tiers.nano.cost_usd.toFixed(6)}`;
    document.getElementById("tokensNano").innerText = tiers.nano.total_tokens.toLocaleString();
  }
}

// Update Test Progress Bar
function updateTestProgress(ts, iteration) {
  const total = ts.total || 0;
  const passed = ts.passed || 0;
  const pct = total > 0 ? Math.round((passed / total) * 100) : 0;

  document.getElementById("iterationBadge").innerText = iteration > 0 ? `Iteration ${iteration}` : "Baseline";
  document.getElementById("testRatioLabel").innerText = `${passed} / ${total} Tests Passing (${pct}%)`;

  const bar = document.getElementById("testProgressBar");
  bar.style.width = `${pct}%`;

  if (pct === 100) {
    bar.className = "h-full bg-nvidia rounded-full transition-all duration-500 shadow-md shadow-nvidia/50";
  } else if (pct > 50) {
    bar.className = "h-full bg-gradient-to-r from-amber-500 to-nvidia rounded-full transition-all duration-500";
  } else {
    bar.className = "h-full bg-gradient-to-r from-red-500 to-amber-500 rounded-full transition-all duration-500";
  }
}

// Render dynamic timeline card for event
function renderTimelineCard(event) {
  const container = document.getElementById("timelineFeed");
  const card = document.createElement("div");
  card.className = "glass-panel p-5 space-y-3 transition transform duration-300 border-l-4";

  // Border accent based on step and status
  let borderColor = "border-l-gray-600";
  let stepIcon = "⚡";
  let tierBadge = "";

  if (event.step === "INIT") {
    borderColor = "border-l-blue-400";
    stepIcon = "📦";
  } else if (event.step === "BASELINE_TEST") {
    borderColor = event.status === "success" ? "border-l-nvidia" : "border-l-red-500";
    stepIcon = "🧪";
  } else if (event.step === "PLANNING") {
    borderColor = "border-l-purple-400";
    stepIcon = "🧠";
    tierBadge = `<span class="px-2 py-0.5 rounded text-[10px] bg-purple-500/20 text-purple-300 font-mono">Nemotron 3 Ultra</span>`;
  } else if (event.step === "RESEARCH") {
    borderColor = "border-l-nebius";
    stepIcon = "🌐";
    tierBadge = `<span class="px-2 py-0.5 rounded text-[10px] bg-sky-500/20 text-sky-300 font-mono">Tavily + Nemotron 3 Nano</span>`;
  } else if (event.step === "PATCHING") {
    borderColor = event.status === "error" ? "border-l-red-400" : "border-l-nvidia";
    stepIcon = "🛠️";
    tierBadge = `<span class="px-2 py-0.5 rounded text-[10px] bg-nvidia/20 text-nvidia font-mono">Nemotron 3 Super</span>`;
  } else if (event.step === "VERIFYING") {
    borderColor = event.status === "success" ? "border-l-nvidia" : "border-l-amber-500";
    stepIcon = "🔬";
  } else if (event.step === "REVIEW" || event.step === "COMPLETED") {
    borderColor = event.status === "success" ? "border-l-nvidia" : "border-l-amber-400";
    stepIcon = "🏁";
    tierBadge = `<span class="px-2 py-0.5 rounded text-[10px] bg-purple-500/20 text-purple-300 font-mono">Nemotron 3 Ultra</span>`;
  }

  card.classList.add(borderColor);

  const headerHtml = `
    <div class="flex items-center justify-between">
      <div class="flex items-center space-x-2">
        <span class="text-base">${stepIcon}</span>
        <span class="font-bold text-sm text-white">${event.step}${event.iteration > 0 ? ` (Iter ${event.iteration})` : ""}</span>
        ${tierBadge}
      </div>
      <span class="text-[11px] font-mono text-gray-500">${new Date(event.timestamp).toLocaleTimeString()}</span>
    </div>
    <p class="text-xs sm:text-sm text-gray-300 leading-relaxed">${escapeHtml(event.message)}</p>
  `;

  let bodyHtml = "";

  // 1. Baseline Failures Payload
  if (event.step === "BASELINE_TEST" && event.payload && event.payload.test_summary) {
    const ts = event.payload.test_summary;
    bodyHtml = `
      <div class="p-3 rounded-lg bg-red-950/20 border border-red-500/20 text-xs font-mono text-red-300 space-y-1">
        <div class="font-bold text-red-400">Baseline Pytest Failures Detected:</div>
        <div>Passed: ${ts.passed} | Failed: ${ts.failed} of ${ts.total} tests</div>
        ${ts.output_tail ? `<pre class="mt-2 p-2 rounded bg-black/40 text-[11px] text-gray-300 overflow-x-auto whitespace-pre-wrap">${escapeHtml(ts.output_tail.slice(0, 450))}</pre>` : ""}
      </div>
    `;
  }

  // 2. Planning Payload
  if (event.step === "PLANNING" && event.payload && event.payload.plan_markdown) {
    const rendered = marked.parse(event.payload.plan_markdown);
    bodyHtml = `
      <details class="cursor-pointer group">
        <summary class="text-xs font-semibold text-purple-300 hover:text-purple-200 select-none flex items-center space-x-1">
          <span>▶ View Architectural Migration Plan</span>
        </summary>
        <div class="mt-3 p-4 rounded-xl bg-slate-900/80 border border-purple-500/20 markdown-body text-xs leading-relaxed max-h-72 overflow-y-auto">
          ${rendered}
        </div>
      </details>
    `;
  }

  // 3. Research Findings Payload
  if (event.step === "RESEARCH" && event.payload && event.payload.research_findings) {
    const items = event.payload.research_findings;
    const itemsHtml = items.map(item => `
      <div class="p-2.5 rounded-lg bg-slate-900/60 border border-white/5 space-y-1">
        <div class="text-[11px] font-bold text-sky-400">🔍 ${escapeHtml(item.query)}</div>
        <div class="text-xs text-gray-300">${escapeHtml(item.note)}</div>
        <a href="${item.source_url}" target="_blank" rel="noopener noreferrer" class="text-[10px] text-sky-400 hover:underline inline-flex items-center space-x-1">
          <span>Source: ${escapeHtml(item.source_url)}</span> ↗
        </a>
      </div>
    `).join("");
    bodyHtml = `<div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">${itemsHtml}</div>`;
  }

  // 4. Patches Payload
  if (event.step === "PATCHING" && event.payload && event.payload.diff) {
    const diffLines = formatDiffHtml(event.payload.diff);
    bodyHtml = `
      <details class="cursor-pointer group">
        <summary class="text-xs font-semibold text-nvidia hover:text-lime-300 select-none">
          <span>▶ Inspect Patch Diff</span>
        </summary>
        <div class="mt-2 diff-container p-3 max-h-60 overflow-y-auto">${diffLines}</div>
      </details>
    `;
  }

  // 5. Verification Payload
  if (event.step === "VERIFYING" && event.payload && event.payload.test_summary) {
    const ts = event.payload.test_summary;
    const isGreen = ts.failed === 0 && ts.passed > 0;
    bodyHtml = `
      <div class="p-2.5 rounded-lg ${isGreen ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300' : 'bg-amber-950/30 border-amber-500/30 text-amber-300'} border text-xs font-mono flex items-center justify-between">
        <span>Pytest Run: ${ts.passed} passed, ${ts.failed} failed of ${ts.total} total</span>
        <span class="font-bold">${isGreen ? '✅ ALL GREEN' : '⚠️ REMAINING FAILURES'}</span>
      </div>
    `;
  }

  card.innerHTML = headerHtml + bodyHtml;
  container.appendChild(card);
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// Show Final Screen
function showFinalResults() {
  const section = document.getElementById("finalResultsSection");
  section.classList.remove("hidden");

  // Render Diff
  const diffContainer = document.getElementById("finalDiffContainer");
  if (lastDiff) {
    diffContainer.innerHTML = formatDiffHtml(lastDiff);
    document.getElementById("finalDiffText").value = lastDiff;
  } else {
    diffContainer.innerHTML = `<span class="text-gray-500">No diff generated.</span>`;
  }

  // Render PR Summary
  const prContainer = document.getElementById("prSummaryContainer");
  if (lastPrSummary) {
    prContainer.innerHTML = marked.parse(lastPrSummary);
    document.getElementById("prSummaryMarkdown").value = lastPrSummary;
  } else {
    prContainer.innerHTML = `<span class="text-gray-500">No PR summary generated.</span>`;
  }

  section.scrollIntoView({ behavior: "smooth" });
}

// Format Diff HTML
function formatDiffHtml(diffText) {
  if (!diffText) return "";
  const lines = diffText.split("\n");
  return lines.map(line => {
    const escaped = escapeHtml(line);
    if (line.startsWith("+") && !line.startsWith("+++")) {
      return `<span class="diff-line-add">${escaped}</span>`;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      return `<span class="diff-line-del">${escaped}</span>`;
    } else if (line.startsWith("@@")) {
      return `<span class="diff-line-info">${escaped}</span>`;
    } else {
      return `<span class="diff-line-context">${escaped}</span>`;
    }
  }).join("");
}

// Finish Run & Reset Button State
function finishRun(success, message) {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  const runBtn = document.getElementById("runBtn");
  const runBtnText = document.getElementById("runBtnText");
  const runBtnIcon = document.getElementById("runBtnIcon");
  runBtn.disabled = false;
  runBtn.classList.remove("opacity-75", "cursor-not-allowed");
  runBtnIcon.innerText = "🚀";
  runBtnText.innerText = "Run Upgrade Pilot";

  document.getElementById("livePulse").classList.add("hidden");

  updateStatus(success ? "Upgrade Finished" : "Run Completed", success ? "ready" : "warning");
}

// Update Status Pill
function updateStatus(text, state) {
  const badge = document.getElementById("statusBadge");
  const textEl = document.getElementById("statusText");
  textEl.innerText = text;

  if (state === "running") {
    badge.className = "flex items-center space-x-2 text-xs font-medium px-3 py-1.5 rounded-full bg-nvidia/10 text-nvidia border border-nvidia/30";
  } else if (state === "ready") {
    badge.className = "flex items-center space-x-2 text-xs font-medium px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
  } else {
    badge.className = "flex items-center space-x-2 text-xs font-medium px-3 py-1.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20";
  }
}

// Reset State
function resetState() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  document.getElementById("timelineFeed").innerHTML = "";
  document.getElementById("emptyState").classList.remove("hidden");
  document.getElementById("progressSection").classList.add("hidden");
  document.getElementById("finalResultsSection").classList.add("hidden");
  document.getElementById("resetBtn").classList.add("hidden");
  document.getElementById("livePulse").classList.add("hidden");

  // Reset counters
  document.getElementById("telemetryTotalCost").innerText = "$0.000000";
  document.getElementById("telemetryTotalTokens").innerText = "0";
  document.getElementById("costUltra").innerText = "$0.000000";
  document.getElementById("tokensUltra").innerText = "0";
  document.getElementById("costSuper").innerText = "$0.000000";
  document.getElementById("tokensSuper").innerText = "0";
  document.getElementById("reasoningSuper").innerText = "0";
  document.getElementById("costNano").innerText = "$0.000000";
  document.getElementById("tokensNano").innerText = "0";

  document.getElementById("testProgressBar").style.width = "0%";
  document.getElementById("testRatioLabel").innerText = "0 / 0 Tests Passing";

  updateStatus("System Ready", "ready");
}

// Clipboard Copy Helper
function copyToClipboard(elementId, label) {
  const el = document.getElementById(elementId);
  if (!el || !el.value) return;

  navigator.clipboard.writeText(el.value).then(() => {
    showToast(`Copied ${label} to clipboard!`);
  }).catch(err => {
    console.error("Clipboard write error:", err);
  });
}

// Toast notification
function showToast(message) {
  const toast = document.getElementById("toast");
  const msgEl = document.getElementById("toastMsg");
  msgEl.innerText = message;
  toast.classList.remove("translate-y-24", "opacity-0");
  toast.classList.add("translate-y-0", "opacity-100");

  setTimeout(() => {
    toast.classList.remove("translate-y-0", "opacity-100");
    toast.classList.add("translate-y-24", "opacity-0");
  }, 2500);
}

// Utility: Escape HTML
function escapeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
