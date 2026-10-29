/**
 * Upgrade Pilot — Client Application & Real-Time SSE Consumer
 */

let selectedDemo = "demo_pydantic";
let eventSource = null;
let eventCount = 0;
let lastDiff = "";
let lastPrSummary = "";
let lastTestSummary = null;
let lastChangedFiles = [];

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  fetchPricing();
  fetchDemos();
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("autoplay") === "cached") {
    setTimeout(() => {
      startUpgrade(true);
    }, 300);
  }
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
    cardPyd.className = "cursor-pointer glass-panel-glow border-2 border-nvidia p-5 rounded-xl transition duration-200 hover:scale-[1.01] relative overflow-hidden bg-gradient-to-br from-slate-900/90 to-emerald-950/20 focus-ring";
    cardPyd.setAttribute("aria-checked", "true");
    cardSql.className = "cursor-pointer glass-panel border border-white/10 p-5 rounded-xl transition duration-200 hover:scale-[1.01] hover:border-white/30 relative overflow-hidden bg-gradient-to-br from-slate-900/80 to-slate-950 focus-ring";
    cardSql.setAttribute("aria-checked", "false");
    checkPyd.classList.remove("hidden");
    checkSql.classList.add("hidden");
  } else {
    cardSql.className = "cursor-pointer glass-panel-glow border-2 border-blue-400 p-5 rounded-xl transition duration-200 hover:scale-[1.01] relative overflow-hidden bg-gradient-to-br from-slate-900/90 to-blue-950/20 focus-ring";
    cardSql.setAttribute("aria-checked", "true");
    cardPyd.className = "cursor-pointer glass-panel border border-white/10 p-5 rounded-xl transition duration-200 hover:scale-[1.01] hover:border-white/30 relative overflow-hidden bg-gradient-to-br from-slate-900/80 to-slate-950 focus-ring";
    cardPyd.setAttribute("aria-checked", "false");
    checkSql.classList.remove("hidden");
    checkPyd.classList.add("hidden");
  }
}

// Keyboard navigation for demo cards
function handleDemoKey(event, demoId) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    selectDemo(demoId);
  }
}

// Start Upgrade Pipeline
function startUpgrade(isCached = false) {
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
  const cachedRunBtn = document.getElementById("cachedRunBtn");

  runBtn.disabled = true;
  runBtn.classList.add("opacity-75", "cursor-not-allowed");
  if (cachedRunBtn) {
    cachedRunBtn.disabled = true;
    cachedRunBtn.classList.add("opacity-50", "cursor-not-allowed");
  }

  if (isCached) {
    runBtnText.innerText = "Replaying Cached Run...";
    updateStatus("Replaying Cached", "running");
    const banner = document.getElementById("cachedRunBanner");
    if (banner) banner.classList.remove("hidden");
  } else {
    runBtnIcon.innerHTML = `<svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-black" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg>`;
    runBtnText.innerText = "Agent Upgrading...";
    updateStatus("Agent Running", "running");
    const banner = document.getElementById("cachedRunBanner");
    if (banner) banner.classList.add("hidden");
  }

  // Reset counters
  eventCount = 0;
  document.getElementById("eventCountLabel").innerText = "0 events";
  document.getElementById("timelineFeed").innerHTML = "";

  // Connect to SSE stream
  const streamUrl = `/api/upgrade/stream?demo=${encodeURIComponent(selectedDemo)}${isCached ? "&cached=true" : ""}`;
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

  // Detect cached run
  if (event.run_id && event.run_id.includes("cached")) {
    const banner = document.getElementById("cachedRunBanner");
    if (banner) banner.classList.remove("hidden");
  }

  // Update Status in Navbar
  if (event.status === "running") {
    updateStatus(`Running: ${event.step}${event.iteration > 0 ? ` (Iter ${event.iteration})` : ""}`, "running");
  }

  // Update Telemetry Panel
  if (event.telemetry && event.telemetry.cumulative) {
    updateTelemetry(event.telemetry.cumulative);
  }

  // Update Test Progress Bar
  if (event.payload && event.payload.test_summary) {
    lastTestSummary = event.payload.test_summary;
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
  if (event.payload && event.payload.changed_files) {
    lastChangedFiles = event.payload.changed_files;
  }

  if (event.step === "COMPLETED") {
    const isSuccess = event.status === "success";
    const isCapHit = !!(event.message && (event.message.includes("cap reached") || event.message.includes("Migration halted") || event.message.includes("Hard cap")));
    finishRun(isSuccess, event.message, isCapHit);
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

  if (cum.tavily_calls !== undefined) {
    const el = document.getElementById("tavilyCallsCount");
    if (el) el.innerText = cum.tavily_calls;
    const qEl = document.getElementById("tavilyQueriesCount");
    if (qEl) qEl.innerText = cum.tavily_calls;
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

  const container = document.getElementById("testProgressContainer");
  if (container) {
    container.setAttribute("aria-valuenow", pct.toString());
  }

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
    borderColor = "border-l-sky-400";
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
  if (event.status === "running") {
    card.classList.add("active-running-card");
  }

  const headerHtml = `
    <div class="flex items-center justify-between">
      <div class="flex items-center space-x-2">
        <span class="text-base">${stepIcon}</span>
        <span class="font-bold text-sm text-white">${event.step}${event.iteration > 0 ? ` (Iter ${event.iteration})` : ""}</span>
        ${tierBadge}
      </div>
      <span class="text-[11px] font-mono text-gray-400">${new Date(event.timestamp).toLocaleTimeString()}</span>
    </div>
  `;

  // Status message
  const statusColor = event.status === "error" ? "text-rose-400" : (event.status === "success" ? "text-emerald-400" : "text-gray-200");
  const messageHtml = `<p class="text-xs sm:text-sm ${statusColor} leading-relaxed">${escapeHtml(event.message)}</p>`;

  let payloadHtml = "";

  // Payload: Test Summary details
  if (event.payload && event.payload.test_summary) {
    const ts = event.payload.test_summary;
    const testPct = ts.total > 0 ? Math.round((ts.passed / ts.total) * 100) : 0;
    payloadHtml += `
      <div class="p-3 rounded-lg bg-slate-950/70 border border-white/5 space-y-1.5 text-xs font-mono">
        <div class="flex items-center justify-between">
          <span class="text-gray-300 font-semibold">Pytest Results:</span>
          <span class="${ts.passed === ts.total && ts.total > 0 ? 'text-nvidia' : 'text-amber-400'} font-bold">
            ${ts.passed} passed, ${ts.failed} failed (${testPct}%)
          </span>
        </div>
        ${ts.failed_test_names && ts.failed_test_names.length > 0 ? `
          <div class="text-[11px] text-rose-300 space-y-0.5 mt-1">
            ${ts.failed_test_names.slice(0, 4).map(t => `<div>• ❌ ${escapeHtml(t)}</div>`).join("")}
            ${ts.failed_test_names.length > 4 ? `<div>... and ${ts.failed_test_names.length - 4} more</div>` : ""}
          </div>
        ` : ""}
        ${ts.output_tail ? `
          <pre class="p-2 rounded bg-black/50 text-[11px] text-gray-400 overflow-x-auto max-h-32 mt-1 whitespace-pre-wrap">${escapeHtml(ts.output_tail)}</pre>
        ` : ""}
      </div>
    `;
  }

  // Payload: Migration Plan preview
  if (event.payload && event.payload.plan_markdown) {
    payloadHtml += `
      <div class="p-4 rounded-lg bg-slate-950/80 border border-white/10 markdown-body text-xs max-h-64 overflow-y-auto">
        ${marked.parse(event.payload.plan_markdown)}
      </div>
    `;
  }

  // Payload: Research findings with Tavily source links
  if (event.payload && event.payload.research_findings && event.payload.research_findings.length > 0) {
    payloadHtml += `
      <div class="space-y-2 mt-2">
        <div class="text-[11px] font-bold uppercase tracking-wider text-sky-400 flex items-center justify-between">
          <span>Tavily Live Grounding & Nano Synthesized Rules</span>
          <span class="text-gray-400 font-mono text-[10px]">${event.payload.research_findings.length} rules</span>
        </div>
        <div class="space-y-1.5">
          ${event.payload.research_findings.map(rf => `
            <div class="p-2.5 rounded-lg bg-slate-950/70 border border-sky-500/20 text-xs space-y-1">
              <div class="text-sky-300 font-semibold text-[11px] flex items-center space-x-1">
                <span>🔎</span>
                <span>${escapeHtml(rf.query || "Documentation Query")}</span>
              </div>
              <p class="text-gray-200 text-[11px] leading-relaxed">${escapeHtml(rf.summary || rf.rule)}</p>
              ${rf.source_url ? `
                <a href="${escapeHtml(rf.source_url)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center space-x-1 text-[11px] text-sky-400 hover:text-sky-300 hover:underline">
                  <span>🔗</span>
                  <span>${escapeHtml(rf.source_title || rf.source_url)}</span>
                </a>
              ` : ""}
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  // Payload: Structured Edits
  if (event.payload && event.payload.structured_edits && event.payload.structured_edits.length > 0) {
    payloadHtml += `
      <div class="space-y-1 text-xs">
        <div class="text-[11px] font-semibold text-gray-300">Targeted Code Modifications:</div>
        <div class="flex flex-wrap gap-1.5">
          ${event.payload.structured_edits.map(se => `
            <span class="px-2 py-0.5 rounded bg-white/5 border border-white/10 font-mono text-[11px] text-gray-300">
              ${escapeHtml(se.file)} (${escapeHtml(se.explanation || "AST edit")})
            </span>
          `).join("")}
        </div>
      </div>
    `;
  }

  // Payload: Unified Diff preview
  if (event.payload && event.payload.diff) {
    payloadHtml += `
      <div class="diff-container p-3 max-h-48 overflow-y-auto">
        ${formatDiffHtml(event.payload.diff)}
      </div>
    `;
  }

  card.innerHTML = headerHtml + messageHtml + payloadHtml;
  container.prepend(card);
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
    diffContainer.innerHTML = `<span class="text-gray-400">No diff generated.</span>`;
  }

  // Render PR Summary
  const prContainer = document.getElementById("prSummaryContainer");
  if (lastPrSummary) {
    prContainer.innerHTML = marked.parse(lastPrSummary);
    document.getElementById("prSummaryMarkdown").value = lastPrSummary;
  } else {
    prContainer.innerHTML = `<span class="text-gray-400">No PR summary generated.</span>`;
  }

  // Update Test Badge
  const badge = document.getElementById("finalTestBadge");
  if (badge && lastTestSummary) {
    const isFullPass = lastTestSummary.passed === lastTestSummary.total && lastTestSummary.total > 0;
    badge.innerText = `${lastTestSummary.passed}/${lastTestSummary.total} Tests Passing`;
    if (isFullPass) {
      badge.className = "text-xs px-2 py-0.5 rounded font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30";
    } else {
      badge.className = "text-xs px-2 py-0.5 rounded font-mono bg-amber-500/20 text-amber-300 border border-amber-500/30";
    }
  }

  // Render Changed Files
  const filesList = document.getElementById("changedFilesList");
  if (filesList) {
    if (lastChangedFiles && lastChangedFiles.length > 0) {
      filesList.classList.remove("hidden");
      filesList.innerHTML = `<span class="text-[11px] text-gray-400 font-medium mr-1">Modified Files:</span>` +
        lastChangedFiles.map(f => `<span class="text-[11px] px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono border border-blue-500/30">📄 ${f}</span>`).join(" ");
    } else {
      filesList.classList.add("hidden");
    }
  }

  section.scrollIntoView({ behavior: "smooth" });
}

// Switch between PR summary and Unified diff tabs in the final results
function switchResultTab(tabName) {
  const prContent = document.getElementById("tabPrContent");
  const diffContent = document.getElementById("tabDiffContent");
  const prBtn = document.getElementById("tabPrSummaryBtn");
  const diffBtn = document.getElementById("tabDiffBtn");

  if (tabName === "pr") {
    prContent.classList.remove("hidden");
    diffContent.classList.add("hidden");
    prBtn.className = "tab-btn active px-3.5 py-1.5 rounded-lg text-xs border border-transparent font-medium flex items-center space-x-1.5 focus-ring";
    diffBtn.className = "tab-btn px-3.5 py-1.5 rounded-lg text-xs border border-transparent font-medium text-gray-400 hover:text-white flex items-center space-x-1.5 focus-ring";
  } else {
    diffContent.classList.remove("hidden");
    prContent.classList.add("hidden");
    diffBtn.className = "tab-btn active px-3.5 py-1.5 rounded-lg text-xs border border-transparent font-medium flex items-center space-x-1.5 focus-ring";
    prBtn.className = "tab-btn px-3.5 py-1.5 rounded-lg text-xs border border-transparent font-medium text-gray-400 hover:text-white flex items-center space-x-1.5 focus-ring";
  }
}

// Download patch as a .diff file
function downloadPatchFile() {
  if (!lastDiff) {
    showToast("No diff available to download");
    return;
  }
  const blob = new Blob([lastDiff], { type: "text/x-diff;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${selectedDemo}_upgrade_patch.diff`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("Downloaded patch file!");
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
function finishRun(success, message, isCapHit = false) {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  const runBtn = document.getElementById("runBtn");
  const runBtnText = document.getElementById("runBtnText");
  const runBtnIcon = document.getElementById("runBtnIcon");
  const cachedRunBtn = document.getElementById("cachedRunBtn");

  runBtn.disabled = false;
  runBtn.classList.remove("opacity-75", "cursor-not-allowed");
  if (cachedRunBtn) {
    cachedRunBtn.disabled = false;
    cachedRunBtn.classList.remove("opacity-50", "cursor-not-allowed");
  }
  runBtnIcon.innerText = "🚀";
  runBtnText.innerText = "Run Upgrade Pilot";

  document.getElementById("livePulse").classList.add("hidden");

  if (isCapHit) {
    updateStatus("Limit Cap Enforced", "warning");
    const capAlert = document.getElementById("capAlertBanner");
    const capText = document.getElementById("capAlertText");
    if (capAlert && capText) {
      capAlert.classList.remove("hidden");
      capText.innerText = message;
    }
  } else {
    updateStatus(success ? "Upgrade Succeeded" : "Run Completed", success ? "ready" : "warning");
    const capAlert = document.getElementById("capAlertBanner");
    if (capAlert) capAlert.classList.add("hidden");
  }
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
  const capAlert = document.getElementById("capAlertBanner");
  if (capAlert) capAlert.classList.add("hidden");
  const cachedBanner = document.getElementById("cachedRunBanner");
  if (cachedBanner) cachedBanner.classList.add("hidden");

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

  const tavCalls = document.getElementById("tavilyCallsCount");
  if (tavCalls) tavCalls.innerText = "0";
  const tavQueries = document.getElementById("tavilyQueriesCount");
  if (tavQueries) tavQueries.innerText = "0";

  document.getElementById("testProgressBar").style.width = "0%";
  document.getElementById("testRatioLabel").innerText = "0 / 0 Tests Passing";

  updateStatus("System Ready", "ready");
}

// Clipboard Copy Helper with Visual Feedback on Button
function copyToClipboard(elementId, label, btnId) {
  const el = document.getElementById(elementId);
  if (!el || !el.value) {
    showToast(`Nothing to copy for ${label}`);
    return;
  }

  navigator.clipboard.writeText(el.value).then(() => {
    showToast(`Copied ${label} to clipboard!`);
    if (btnId) {
      const btn = document.getElementById(btnId);
      const textSpan = document.getElementById(`${btnId}Text`);
      if (textSpan) {
        const originalText = textSpan.innerText;
        textSpan.innerText = "Copied! ✓";
        setTimeout(() => {
          textSpan.innerText = originalText;
        }, 2000);
      }
    }
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
