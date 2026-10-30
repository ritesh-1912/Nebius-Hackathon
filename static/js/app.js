// Upgrade Pilot Frontend Client - Design System & SSE Event Stream Handler
// Following DESIGN.md: Clean Developer-Tool Aesthetic, No Emoji, Strict Status Colors

let eventSource = null;
let selectedDemo = "demo_pydantic";
let lastDiff = "";
let lastPrSummary = "";
let lastTestSummary = null;
let lastChangedFiles = [];
let eventCount = 0;

// Initialize on DOM ready
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  fetchPricing();
  fetchDemos();
  initDemoSelection();

  // Check autoplay parameter
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("autoplay") === "cached") {
    startUpgrade(true);
  } else if (urlParams.get("autoplay") === "live") {
    startUpgrade(false);
  }
});

// --------------------------------------------------------------------------
// Theme Management (Light / Dark)
// --------------------------------------------------------------------------
function initTheme() {
  const saved = localStorage.getItem("theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = saved ? saved === "dark" : prefersDark;

  applyTheme(isDark);
}

function applyTheme(isDark) {
  if (isDark) {
    document.documentElement.classList.add("dark");
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.classList.remove("dark");
    document.documentElement.setAttribute("data-theme", "light");
  }
  updateThemeIcons(isDark);
}

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle("dark");
  document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  localStorage.setItem("theme", isDark ? "dark" : "light");
  updateThemeIcons(isDark);
}

function updateThemeIcons(isDark) {
  const sun = document.getElementById("themeIconSun");
  const moon = document.getElementById("themeIconMoon");
  if (!sun || !moon) return;
  if (isDark) {
    sun.classList.remove("hidden");
    moon.classList.add("hidden");
  } else {
    sun.classList.add("hidden");
    moon.classList.remove("hidden");
  }
}

// --------------------------------------------------------------------------
// Pricing & Demos Metadata
// --------------------------------------------------------------------------
async function fetchPricing() {
  try {
    const res = await fetch("/api/pricing");
    const data = await res.json();
    console.log("Nebius Token Factory Pricing:", data);
  } catch (err) {
    console.warn("Could not load pricing table:", err);
  }
}

async function fetchDemos() {
  try {
    const res = await fetch("/api/demos");
    const demos = await res.json();
    console.log("Demos loaded:", demos);
  } catch (err) {
    console.warn("Could not load demos list:", err);
  }
}

// --------------------------------------------------------------------------
// Demo Selection
// --------------------------------------------------------------------------
function initDemoSelection() {
  selectDemo("demo_pydantic");
}

function selectDemo(demoId) {
  if (eventSource) return; // Prevent switching while running
  selectedDemo = demoId;

  const cardPyd = document.getElementById("card-demo_pydantic");
  const cardSql = document.getElementById("card-demo_sqlalchemy");
  const checkPyd = document.getElementById("check-demo_pydantic");
  const checkSql = document.getElementById("check-demo_sqlalchemy");

  if (!cardPyd || !cardSql) return;

  if (demoId === "demo_pydantic") {
    cardPyd.classList.add("selected");
    cardPyd.setAttribute("aria-checked", "true");
    cardSql.classList.remove("selected");
    cardSql.setAttribute("aria-checked", "false");
    if (checkPyd) checkPyd.classList.remove("hidden");
    if (checkSql) checkSql.classList.add("hidden");
  } else {
    cardSql.classList.add("selected");
    cardSql.setAttribute("aria-checked", "true");
    cardPyd.classList.remove("selected");
    cardPyd.setAttribute("aria-checked", "false");
    if (checkSql) checkSql.classList.remove("hidden");
    if (checkPyd) checkPyd.classList.add("hidden");
  }
}

function handleDemoKey(event, demoId) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    selectDemo(demoId);
  }
}

// --------------------------------------------------------------------------
// Upgrade Pipeline Execution
// --------------------------------------------------------------------------
function startUpgrade(isCached = false) {
  if (eventSource) return;

  // Reveal workspace
  const workspace = document.getElementById("workspaceSection");
  if (workspace) workspace.classList.remove("hidden");

  document.getElementById("emptyState")?.classList.add("hidden");
  document.getElementById("progressSection")?.classList.remove("hidden");
  document.getElementById("resetBtn")?.classList.remove("hidden");
  document.getElementById("livePulse")?.classList.remove("hidden");
  document.getElementById("finalResultsSection")?.classList.add("hidden");

  const runBtn = document.getElementById("runBtn");
  const runBtnText = document.getElementById("runBtnText");
  const runBtnIcon = document.getElementById("runBtnIcon");
  const cachedRunBtn = document.getElementById("cachedRunBtn");

  if (runBtn) {
    runBtn.disabled = true;
    runBtn.classList.add("opacity-50", "cursor-not-allowed");
  }
  if (cachedRunBtn) {
    cachedRunBtn.disabled = true;
    cachedRunBtn.classList.add("opacity-50", "cursor-not-allowed");
  }

  if (isCached) {
    if (runBtnText) runBtnText.innerText = "Replaying Recorded Run...";
    updateStatus("Replaying Recorded", "running");
    const banner = document.getElementById("cachedRunBanner");
    if (banner) banner.classList.remove("hidden");
  } else {
    if (runBtnIcon) {
      runBtnIcon.innerHTML = `<svg class="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-opacity="0.75"/></svg>`;
    }
    if (runBtnText) runBtnText.innerText = "Upgrading...";
    updateStatus("Agent Running", "running");
    const banner = document.getElementById("cachedRunBanner");
    if (banner) banner.classList.add("hidden");
  }

  // Reset counters
  eventCount = 0;
  const countLabel = document.getElementById("eventCountLabel");
  if (countLabel) countLabel.innerText = "0 events";
  const timeline = document.getElementById("timelineFeed");
  if (timeline) timeline.innerHTML = "";

  // Smooth scroll down to workspace
  if (workspace) {
    workspace.scrollIntoView({ behavior: "smooth" });
  }

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
  const countLabel = document.getElementById("eventCountLabel");
  if (countLabel) countLabel.innerText = `${eventCount} events`;

  // Detect cached run
  if (event.run_id && event.run_id.includes("cached")) {
    const banner = document.getElementById("cachedRunBanner");
    if (banner) banner.classList.remove("hidden");
  }

  // Update Status
  if (event.status === "running") {
    updateStatus(`Running: ${event.step}${event.iteration > 0 ? ` (Iter ${event.iteration})` : ""}`, "running");
  }

  // Update Telemetry Panel
  if (event.cost_tracker) {
    updateTelemetry(event.cost_tracker);
  }

  // Update Verification Progress Bar
  if (event.payload && event.payload.test_summary) {
    updateTestProgress(event.payload.test_summary, event.iteration);
    lastTestSummary = event.payload.test_summary;
  }

  // Cache artifacts
  if (event.payload) {
    if (event.payload.diff) lastDiff = event.payload.diff;
    if (event.payload.pr_summary) lastPrSummary = event.payload.pr_summary;
    if (event.payload.changed_files) lastChangedFiles = event.payload.changed_files;
  }

  // Append Timeline Item
  renderTimelineCard(event);

  if (event.step === "COMPLETED") {
    const isSuccess = event.status === "success";
    const isCapHit = !!(event.message && (event.message.includes("cap reached") || event.message.includes("Migration halted") || event.message.includes("Hard cap")));
    finishRun(isSuccess, event.message, isCapHit);
    showFinalResults();
  }
}

// Telemetry Panel Update
function updateTelemetry(tracker) {
  const cum = tracker.cumulative;
  const tiers = tracker.tier_usage;

  const totalCost = document.getElementById("telemetryTotalCost");
  const totalTokens = document.getElementById("telemetryTotalTokens");
  if (totalCost) totalCost.innerText = `$${cum.total_cost_usd.toFixed(6)}`;
  if (totalTokens) totalTokens.innerText = cum.total_tokens.toLocaleString();

  if (tiers.ultra) {
    const c = document.getElementById("costUltra");
    const t = document.getElementById("tokensUltra");
    if (c) c.innerText = `$${tiers.ultra.cost_usd.toFixed(6)}`;
    if (t) t.innerText = tiers.ultra.total_tokens.toLocaleString();
  }
  if (tiers.super) {
    const c = document.getElementById("costSuper");
    const t = document.getElementById("tokensSuper");
    const r = document.getElementById("reasoningSuper");
    if (c) c.innerText = `$${tiers.super.cost_usd.toFixed(6)}`;
    if (t) t.innerText = tiers.super.total_tokens.toLocaleString();
    if (r) r.innerText = tiers.super.reasoning_tokens.toLocaleString();
  }
  if (tiers.nano) {
    const c = document.getElementById("costNano");
    const t = document.getElementById("tokensNano");
    if (c) c.innerText = `$${tiers.nano.cost_usd.toFixed(6)}`;
    if (t) t.innerText = tiers.nano.total_tokens.toLocaleString();
  }

  if (tracker.tavily_usage) {
    const el = document.getElementById("tavilyCallsCount");
    if (el) el.innerText = tracker.tavily_usage.api_calls;
    const qEl = document.getElementById("tavilyQueriesCount");
    if (qEl) qEl.innerText = tracker.tavily_usage.queries_executed;
  }
}

// Test Progress Bar Update
function updateTestProgress(testSummary, iteration = 0) {
  const passed = testSummary.passed;
  const total = testSummary.total;
  const pct = total > 0 ? Math.round((passed / total) * 100) : 0;

  const iterBadge = document.getElementById("iterationBadge");
  if (iterBadge) {
    iterBadge.innerText = iteration > 0 ? `Iteration ${iteration}` : "Baseline";
  }

  const ratioLabel = document.getElementById("testRatioLabel");
  if (ratioLabel) {
    ratioLabel.innerText = `${passed} / ${total} Tests Passing (${pct}%)`;
  }

  const bar = document.getElementById("testProgressBar");
  if (bar) {
    bar.style.width = `${pct}%`;
    if (pct === 100) {
      bar.classList.add("full");
    } else {
      bar.classList.remove("full");
    }
  }
}

// Render dynamic timeline card for event (No Emoji, Lucide SVG icons)
function renderTimelineCard(event) {
  const container = document.getElementById("timelineFeed");
  if (!container) return;

  const card = document.createElement("div");
  card.className = "timeline-card";

  // Semantic border accent
  if (event.status === "error") {
    card.style.borderLeft = "3px solid var(--error-base)";
  } else if (event.status === "success" || event.step === "COMPLETED") {
    card.style.borderLeft = "3px solid var(--success-base)";
  } else if (event.status === "running") {
    card.style.borderLeft = "3px solid var(--accent-base)";
  }

  let stepIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
  let tierBadge = "";

  if (event.step === "INIT") {
    stepIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>`;
  } else if (event.step === "BASELINE_TEST") {
    stepIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 2v7.31"/><path d="M14 9.3V2"/><path d="M8.5 2h7"/><path d="M14 9.3a6.5 6.5 0 1 1-4 0"/></svg>`;
  } else if (event.step === "PLANNING") {
    stepIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2a8 8 0 0 0-8 8c0 3.4 2.1 6.3 5 7.4V20a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-2.6c2.9-1.1 5-4 5-7.4a8 8 0 0 0-8-8z"/></svg>`;
    tierBadge = `<span class="timeline-tier-tag">Nemotron 3 Ultra</span>`;
  } else if (event.step === "RESEARCH") {
    stepIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`;
    tierBadge = `<span class="timeline-tier-tag">Tavily + Nemotron 3 Nano</span>`;
  } else if (event.step === "PATCHING") {
    stepIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;
    tierBadge = `<span class="timeline-tier-tag">Nemotron 3 Super</span>`;
  } else if (event.step === "VERIFYING") {
    stepIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
  } else if (event.step === "REVIEW" || event.step === "COMPLETED") {
    stepIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/></svg>`;
    tierBadge = `<span class="timeline-tier-tag">Nemotron 3 Ultra</span>`;
  }

  const headerHtml = `
    <div class="timeline-card-header">
      <div class="timeline-step">
        <span>${stepIcon}</span>
        <span>${event.step}${event.iteration > 0 ? ` (Iter ${event.iteration})` : ""}</span>
        ${tierBadge}
      </div>
      <span class="timeline-timestamp">${new Date(event.timestamp).toLocaleTimeString()}</span>
    </div>
  `;

  // Status message
  const statusColor = event.status === "error" ? "color: var(--error-fg)" : (event.status === "success" ? "color: var(--success-fg)" : "color: var(--text-primary)");
  const messageHtml = `<p class="timeline-message" style="${statusColor}">${escapeHtml(event.message)}</p>`;

  let payloadHtml = "";

  // Payload: Test Summary details
  if (event.payload && event.payload.test_summary) {
    const ts = event.payload.test_summary;
    const testPct = ts.total > 0 ? Math.round((ts.passed / ts.total) * 100) : 0;
    payloadHtml += `
      <div style="padding: 10px 12px; background: var(--bg-subtle); border: 1px solid var(--border-default); border-radius: 6px; font-size: 12px; font-family: var(--font-mono); margin-top: 6px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
          <span style="font-weight: 500; color: var(--text-primary);">Pytest Results:</span>
          <span style="color: ${ts.passed === ts.total && ts.total > 0 ? 'var(--success-fg)' : 'var(--warning-fg)'}; font-weight: 600;">
            ${ts.passed} passed, ${ts.failed} failed (${testPct}%)
          </span>
        </div>
        ${ts.failed_test_names && ts.failed_test_names.length > 0 ? `
          <div style="color: var(--error-fg); font-size: 11px; margin-top: 4px; display: flex; flex-direction: column; gap: 2px;">
            ${ts.failed_test_names.slice(0, 4).map(t => `<div>• ${escapeHtml(t)}</div>`).join("")}
            ${ts.failed_test_names.length > 4 ? `<div>... and ${ts.failed_test_names.length - 4} more</div>` : ""}
          </div>
        ` : ""}
        ${ts.output_tail ? `
          <pre style="padding: 6px 8px; background: var(--bg-app); border: 1px solid var(--border-default); border-radius: 4px; font-size: 11px; color: var(--text-secondary); overflow-x: auto; max-height: 120px; margin-top: 6px; white-space: pre-wrap;">${escapeHtml(ts.output_tail)}</pre>
        ` : ""}
      </div>
    `;
  }

  // Payload: Migration Plan preview
  if (event.payload && event.payload.plan_markdown) {
    payloadHtml += `
      <div style="padding: 12px; background: var(--bg-app); border: 1px solid var(--border-default); border-radius: 6px; font-size: 12px; max-height: 200px; overflow-y: auto; margin-top: 6px;" class="markdown-body">
        ${marked.parse(event.payload.plan_markdown)}
      </div>
    `;
  }

  // Payload: Research findings
  if (event.payload && event.payload.research_findings && event.payload.research_findings.length > 0) {
    payloadHtml += `
      <div style="margin-top: 6px; display: flex; flex-direction: column; gap: 6px;">
        <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); display: flex; justify-content: space-between;">
          <span>Official Migration Rules (Tavily & Nano)</span>
          <span style="font-family: var(--font-mono);">${event.payload.research_findings.length} sources</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 6px;">
          ${event.payload.research_findings.map(rf => `
            <div style="padding: 8px 10px; background: var(--bg-subtle); border: 1px solid var(--border-default); border-radius: 6px; font-size: 12px;">
              <div style="font-weight: 500; color: var(--text-primary); font-size: 11px; margin-bottom: 2px;">
                ${escapeHtml(rf.query || "Documentation Query")}
              </div>
              <p style="color: var(--text-secondary); font-size: 12px; line-height: 1.4;">${escapeHtml(rf.summary || rf.rule)}</p>
              ${rf.source_url ? `
                <a href="${escapeHtml(rf.source_url)}" target="_blank" rel="noopener noreferrer" style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--accent-fg); text-decoration: none; margin-top: 4px;">
                  <span>${escapeHtml(rf.source_title || rf.source_url)}</span>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>
                </a>
              ` : ""}
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  // Payload: Unified Diff preview
  if (event.payload && event.payload.diff) {
    payloadHtml += `
      <div class="diff-container" style="padding: 10px; max-height: 160px; margin-top: 6px;">
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
  if (!section) return;
  section.classList.remove("hidden");

  // Render Diff
  const diffContainer = document.getElementById("finalDiffContainer");
  if (lastDiff) {
    diffContainer.innerHTML = formatDiffHtml(lastDiff);
    const hiddenText = document.getElementById("finalDiffText");
    if (hiddenText) hiddenText.value = lastDiff;
  } else {
    diffContainer.innerHTML = `<span style="color: var(--text-tertiary); padding: 12px; display: block;">No diff generated.</span>`;
  }

  // Render PR Summary
  const prContainer = document.getElementById("prSummaryContainer");
  if (lastPrSummary) {
    prContainer.innerHTML = marked.parse(lastPrSummary);
    const hiddenPr = document.getElementById("prSummaryMarkdown");
    if (hiddenPr) hiddenPr.value = lastPrSummary;
  } else {
    prContainer.innerHTML = `<span style="color: var(--text-tertiary); padding: 12px; display: block;">No PR summary generated.</span>`;
  }

  // Update Test Badge
  const badge = document.getElementById("finalTestBadge");
  if (badge && lastTestSummary) {
    const isFullPass = lastTestSummary.passed === lastTestSummary.total && lastTestSummary.total > 0;
    badge.innerText = `${lastTestSummary.passed}/${lastTestSummary.total} Tests Passing`;
    badge.className = `status-badge ${isFullPass ? "status-ready" : "status-warning"}`;
  }

  // Render Changed Files
  const filesList = document.getElementById("changedFilesList");
  if (filesList) {
    if (lastChangedFiles && lastChangedFiles.length > 0) {
      filesList.classList.remove("hidden");
      filesList.innerHTML = `<span style="font-size: 11px; color: var(--text-secondary); font-weight: 500; margin-right: 6px;">Modified Files:</span>` +
        lastChangedFiles.map(f => `<span class="version-pill">${escapeHtml(f)}</span>`).join(" ");
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

  if (!prContent || !diffContent || !prBtn || !diffBtn) return;

  if (tabName === "pr") {
    prContent.classList.remove("hidden");
    diffContent.classList.add("hidden");
    prBtn.classList.add("active");
    diffBtn.classList.remove("active");
  } else {
    diffContent.classList.remove("hidden");
    prContent.classList.add("hidden");
    diffBtn.classList.add("active");
    prBtn.classList.remove("active");
  }
}

// Format Unified Diff HTML with clean GitHub-like lines
function formatDiffHtml(diffText) {
  if (!diffText) return "";
  const lines = diffText.split("\n");
  return lines.map(line => {
    const escaped = escapeHtml(line);
    if (line.startsWith("+++") || line.startsWith("---")) {
      return `<div class="diff-line-header">${escaped}</div>`;
    } else if (line.startsWith("+")) {
      return `<div class="diff-line-add">${escaped}</div>`;
    } else if (line.startsWith("-")) {
      return `<div class="diff-line-del">${escaped}</div>`;
    } else if (line.startsWith("@@")) {
      return `<div class="diff-line-info">${escaped}</div>`;
    } else {
      return `<div class="diff-line-context">${escaped}</div>`;
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

  if (runBtn) {
    runBtn.disabled = false;
    runBtn.classList.remove("opacity-50", "cursor-not-allowed");
  }
  if (cachedRunBtn) {
    cachedRunBtn.disabled = false;
    cachedRunBtn.classList.remove("opacity-50", "cursor-not-allowed");
  }
  if (runBtnIcon) {
    runBtnIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
  }
  if (runBtnText) {
    runBtnText.innerText = "Run this upgrade";
  }

  document.getElementById("livePulse")?.classList.add("hidden");

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
  if (!badge || !textEl) return;
  textEl.innerText = text;

  badge.className = `status-badge status-${state}`;
}

// Reset State
function resetState() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  const timeline = document.getElementById("timelineFeed");
  if (timeline) timeline.innerHTML = "";

  document.getElementById("emptyState")?.classList.remove("hidden");
  document.getElementById("progressSection")?.classList.add("hidden");
  document.getElementById("finalResultsSection")?.classList.add("hidden");
  document.getElementById("resetBtn")?.classList.add("hidden");
  document.getElementById("livePulse")?.classList.add("hidden");

  const capAlert = document.getElementById("capAlertBanner");
  if (capAlert) capAlert.classList.add("hidden");
  const cachedBanner = document.getElementById("cachedRunBanner");
  if (cachedBanner) cachedBanner.classList.add("hidden");

  // Reset counters
  const totalCost = document.getElementById("telemetryTotalCost");
  if (totalCost) totalCost.innerText = "$0.000000";
  const totalTokens = document.getElementById("telemetryTotalTokens");
  if (totalTokens) totalTokens.innerText = "0";
  const cUltra = document.getElementById("costUltra");
  if (cUltra) cUltra.innerText = "$0.000000";
  const tUltra = document.getElementById("tokensUltra");
  if (tUltra) tUltra.innerText = "0";
  const cSuper = document.getElementById("costSuper");
  if (cSuper) cSuper.innerText = "$0.000000";
  const tSuper = document.getElementById("tokensSuper");
  if (tSuper) tSuper.innerText = "0";
  const rSuper = document.getElementById("reasoningSuper");
  if (rSuper) rSuper.innerText = "0";
  const cNano = document.getElementById("costNano");
  if (cNano) cNano.innerText = "$0.000000";
  const tNano = document.getElementById("tokensNano");
  if (tNano) tNano.innerText = "0";

  const tavCalls = document.getElementById("tavilyCallsCount");
  if (tavCalls) tavCalls.innerText = "0";
  const tavQueries = document.getElementById("tavilyQueriesCount");
  if (tavQueries) tavQueries.innerText = "0";

  const bar = document.getElementById("testProgressBar");
  if (bar) {
    bar.style.width = "0%";
    bar.classList.remove("full");
  }
  const ratio = document.getElementById("testRatioLabel");
  if (ratio) ratio.innerText = "0 / 0 Tests Passing";

  updateStatus("System Ready", "ready");
}

// Clipboard Copy Helper
function copyToClipboard(elementId, btnId, successLabel) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const text = el.value || el.innerText;
  navigator.clipboard.writeText(text).then(() => {
    showToast(successLabel || "Copied to clipboard");
    if (btnId) {
      const textSpan = document.getElementById(`${btnId}Text`);
      if (textSpan) {
        const original = textSpan.innerText;
        textSpan.innerText = "Copied!";
        setTimeout(() => {
          textSpan.innerText = original;
        }, 2000);
      }
    }
  }).catch(err => {
    console.error("Clipboard copy failed:", err);
  });
}

// Download .diff patch file
function downloadPatchFile() {
  if (!lastDiff) return;
  const blob = new Blob([lastDiff], { type: "text/x-diff;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${selectedDemo}_upgrade.patch`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("Downloaded .patch file");
}

// Toast notification
function showToast(msg) {
  const toast = document.getElementById("toast");
  const msgEl = document.getElementById("toastMsg");
  if (!toast || !msgEl) return;
  msgEl.innerText = msg;
  toast.classList.add("show");
  setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
}

// HTML escape helper
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
