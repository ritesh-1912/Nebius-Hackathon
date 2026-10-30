// Upgrade Pilot Frontend Client
// Clean Developer-Tool Aesthetic (Linear / Vercel style)
// SSE Event Stream Handler, Dedicated Run View, Real-Time Stepper & Metrics

let eventSource = null;
let selectedDemo = "demo_pydantic";
let lastDiff = "";
let lastPrSummary = "";
let lastTestSummary = null;
let lastChangedFiles = [];
let eventCount = 0;
let runStartTime = null;
let timerInterval = null;
let testHistory = []; // Tracks { label, passed, total, pct }
let uniqueSources = new Map(); // Tracks URL -> { title, domain, note }
let isAutoScrollEnabled = true;

// Demo metadata
const DEMO_CONFIG = {
  demo_pydantic: {
    title: "Pydantic v1 → v2 Migration",
    version: "pydantic 1.10.17 → 2.14.1",
    totalTests: 10,
  },
  demo_sqlalchemy: {
    title: "SQLAlchemy 1.4 → 2.0 Migration",
    version: "sqlalchemy 1.4.54 → 2.0.55",
    totalTests: 8,
  },
};

// Initialize on DOM ready
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  fetchPricing();
  fetchDemos();
  initDemoSelection();
  setupActivityScrollListener();

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
// Navigation: Switch Between Landing & Run View
// --------------------------------------------------------------------------
function navBackToDemos() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  stopElapsedTimer();

  document.getElementById("runView")?.classList.add("hidden");
  document.getElementById("landingView")?.classList.remove("hidden");

  // Scroll back to demo selection
  const demosSection = document.getElementById("demos");
  if (demosSection) {
    demosSection.scrollIntoView({ behavior: "smooth" });
  }
}

// --------------------------------------------------------------------------
// Elapsed Timer Logic
// --------------------------------------------------------------------------
function startElapsedTimer() {
  stopElapsedTimer();
  runStartTime = Date.now();
  updateTimerDisplay(0);
  timerInterval = setInterval(() => {
    const elapsedSec = Math.floor((Date.now() - runStartTime) / 1000);
    updateTimerDisplay(elapsedSec);
  }, 1000);
}

function stopElapsedTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function updateTimerDisplay(seconds) {
  const timerEl = document.getElementById("runElapsedTime");
  if (!timerEl) return;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  timerEl.innerText = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

// --------------------------------------------------------------------------
// Status Indicator (Reflects Current Run Only)
// --------------------------------------------------------------------------
function updateRunStatus(state, label) {
  const badge = document.getElementById("runStatusBadge");
  const textEl = document.getElementById("runStatusText");
  if (!badge || !textEl) return;

  textEl.innerText = label;
  badge.className = `status-badge status-${state}`;
}

// --------------------------------------------------------------------------
// Start Upgrade Pipeline
// --------------------------------------------------------------------------
function startUpgrade(isCached = false) {
  if (eventSource) return;

  const cfg = DEMO_CONFIG[selectedDemo] || DEMO_CONFIG.demo_pydantic;

  // 1. Switch to Run View
  document.getElementById("landingView")?.classList.add("hidden");
  const runView = document.getElementById("runView");
  if (runView) {
    runView.classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // 2. Set Header Strip values
  const nameEl = document.getElementById("runHeaderDemoName");
  const verEl = document.getElementById("runHeaderVersion");
  if (nameEl) nameEl.innerText = cfg.title;
  if (verEl) verEl.innerText = cfg.version;

  // 3. Reset All Run View States (Clean Slate)
  eventCount = 0;
  testHistory = [];
  uniqueSources.clear();
  lastDiff = "";
  lastPrSummary = "";
  lastTestSummary = null;
  lastChangedFiles = [];
  isAutoScrollEnabled = true;

  updateRunStatus("running", isCached ? "Replaying Recorded" : "Running");
  startElapsedTimer();

  // Reset Stepper
  resetStepper();

  // Reset Feed
  const feed = document.getElementById("runActivityFeed");
  if (feed) feed.innerHTML = "";
  const countLabel = document.getElementById("runEventCount");
  if (countLabel) countLabel.innerText = "0 events";

  // Reset Banners & Deliverables
  document.getElementById("capAlertBanner")?.classList.add("hidden");
  document.getElementById("finalResultsSection")?.classList.add("hidden");
  const cachedBanner = document.getElementById("cachedRunBanner");
  if (cachedBanner) {
    if (isCached) cachedBanner.classList.remove("hidden");
    else cachedBanner.classList.add("hidden");
  }

  // Reset Right Metrics Panel
  renderTestHistory();
  renderSourcesList();
  resetUsageMetrics();

  // Reset Buttons in Landing View
  const runBtn = document.getElementById("runBtn");
  const cachedRunBtn = document.getElementById("cachedRunBtn");
  if (runBtn) runBtn.disabled = true;
  if (cachedRunBtn) cachedRunBtn.disabled = true;

  // 4. Connect to SSE Stream
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
    console.warn("EventSource stream disconnected or closed:", err);
    finishRun(false, "Connection closed");
  };
}

// --------------------------------------------------------------------------
// Event Processing
// --------------------------------------------------------------------------
function handleAgentEvent(event) {
  eventCount++;
  const countLabel = document.getElementById("runEventCount");
  if (countLabel) countLabel.innerText = `${eventCount} events`;

  // Detect cached run
  if (event.run_id && event.run_id.includes("cached")) {
    const banner = document.getElementById("cachedRunBanner");
    if (banner) banner.classList.remove("hidden");
  }

  // Update Stepper
  updateStepper(event.step, event.status, event.iteration);

  // Update Telemetry Panel
  if (event.cost_tracker) {
    updateUsageMetrics(event.cost_tracker, event.iteration, event.max_iterations);
  }

  // Update Test Metrics History
  if (event.payload && event.payload.test_summary) {
    recordTestSummary(event.payload.test_summary, event.iteration, event.step);
  }

  // Update Documentation Sources
  if (event.payload && event.payload.research_findings && event.payload.research_findings.length > 0) {
    recordSources(event.payload.research_findings);
  }

  // Cache final deliverables
  if (event.payload) {
    if (event.payload.diff) lastDiff = event.payload.diff;
    if (event.payload.pr_summary) lastPrSummary = event.payload.pr_summary;
    if (event.payload.changed_files) lastChangedFiles = event.payload.changed_files;
  }

  // Append Activity Row
  appendActivityRow(event);

  // Check completion
  if (event.step === "COMPLETED") {
    const isSuccess = event.status === "success";
    const isCapHit = !!(event.message && (event.message.includes("cap reached") || event.message.includes("Migration halted") || event.message.includes("Hard cap")));
    finishRun(isSuccess, event.message, isCapHit);
    showFinalResults();
  } else if (event.step === "FAILED") {
    finishRun(false, event.message, false);
  }
}

// --------------------------------------------------------------------------
// Stepper Phase Management
// --------------------------------------------------------------------------
const PHASES = ["Baseline", "Plan", "Research", "Patch", "Verify", "Review"];

function resetStepper() {
  PHASES.forEach((p, idx) => {
    const item = document.getElementById(`stepPhase${p}`);
    const node = document.getElementById(`nodePhase${p}`);
    if (item) item.className = "stepper-item";
    if (node) node.innerText = String(idx + 1);
  });
  setStepperPhase("Baseline", "active");
}

function setStepperPhase(phaseName, state, badgeText = "") {
  const item = document.getElementById(`stepPhase${phaseName}`);
  const node = document.getElementById(`nodePhase${phaseName}`);
  if (!item || !node) return;

  item.className = `stepper-item ${state}`;
  if (state === "completed") {
    node.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;
  } else if (state === "active") {
    const idx = PHASES.indexOf(phaseName) + 1;
    node.innerText = String(idx);
  }
}

function updateStepper(step, status, iteration) {
  const patchIterEl = document.getElementById("stepperPatchIter");
  const verifyIterEl = document.getElementById("stepperVerifyIter");

  if (iteration > 0) {
    if (patchIterEl) patchIterEl.innerText = `(Iter ${iteration})`;
    if (verifyIterEl) verifyIterEl.innerText = `(Iter ${iteration})`;
  } else {
    if (patchIterEl) patchIterEl.innerText = "";
    if (verifyIterEl) verifyIterEl.innerText = "";
  }

  if (step === "INIT" || step === "BASELINE_TEST") {
    setStepperPhase("Baseline", "active");
  } else if (step === "PLANNING") {
    setStepperPhase("Baseline", "completed");
    setStepperPhase("Plan", "active");
  } else if (step === "RESEARCH") {
    setStepperPhase("Baseline", "completed");
    setStepperPhase("Plan", "completed");
    setStepperPhase("Research", "active");
  } else if (step === "PATCHING") {
    setStepperPhase("Baseline", "completed");
    setStepperPhase("Plan", "completed");
    setStepperPhase("Research", "completed");
    setStepperPhase("Patch", "active");
  } else if (step === "VERIFYING") {
    setStepperPhase("Baseline", "completed");
    setStepperPhase("Plan", "completed");
    setStepperPhase("Research", "completed");
    setStepperPhase("Patch", "completed");
    setStepperPhase("Verify", "active");
  } else if (step === "REVIEW") {
    setStepperPhase("Baseline", "completed");
    setStepperPhase("Plan", "completed");
    setStepperPhase("Research", "completed");
    setStepperPhase("Patch", "completed");
    setStepperPhase("Verify", "completed");
    setStepperPhase("Review", "active");
  } else if (step === "COMPLETED") {
    PHASES.forEach(p => setStepperPhase(p, "completed"));
  }
}

// --------------------------------------------------------------------------
// Activity Feed & Collapsible Rows
// --------------------------------------------------------------------------
function setupActivityScrollListener() {
  const feed = document.getElementById("runActivityFeed");
  const jumpBtn = document.getElementById("jumpToLatestBtn");
  if (!feed || !jumpBtn) return;

  feed.addEventListener("scroll", () => {
    const isAtBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
    if (isAtBottom) {
      isAutoScrollEnabled = true;
      jumpBtn.classList.add("hidden");
    } else {
      isAutoScrollEnabled = false;
      jumpBtn.classList.remove("hidden");
    }
  });
}

function jumpToLatestEvent() {
  const feed = document.getElementById("runActivityFeed");
  const jumpBtn = document.getElementById("jumpToLatestBtn");
  if (!feed) return;
  feed.scrollTo({ top: feed.scrollHeight, behavior: "smooth" });
  isAutoScrollEnabled = true;
  if (jumpBtn) jumpBtn.classList.add("hidden");
}

function getEventPlainTitle(event) {
  const ts = event.payload && event.payload.test_summary;
  const rf = event.payload && event.payload.research_findings;
  const patches = event.payload && event.payload.patches;

  if (event.step === "INIT") {
    return "Sandbox initialized with isolated environment";
  }
  if (event.step === "BASELINE_TEST") {
    if (ts) {
      return ts.passed === ts.total && ts.total > 0
        ? `Baseline tests verified: ${ts.passed} of ${ts.total} passing`
        : `Tests failed: ${ts.failed} of ${ts.total} failing`;
    }
    return "Baseline tests executed in sandbox";
  }
  if (event.step === "PLANNING") {
    return "Migration plan formulated by Nemotron 3 Ultra";
  }
  if (event.step === "RESEARCH") {
    const count = rf ? rf.length : 0;
    return count > 0 ? `Searched documentation: ${count} rules extracted` : "Searched official documentation via Tavily";
  }
  if (event.step === "PATCHING") {
    const pCount = patches ? patches.length : 0;
    return `Applied ${pCount} patch edits to application code`;
  }
  if (event.step === "VERIFYING") {
    if (ts) {
      const pct = ts.total > 0 ? Math.round((ts.passed / ts.total) * 100) : 0;
      return `Test verification: ${ts.passed} of ${ts.total} passing (${pct}%)`;
    }
    return "Running sandbox test suite verification";
  }
  if (event.step === "REVIEW") {
    return "Reviewed unified diff and authored pull request summary";
  }
  if (event.step === "COMPLETED") {
    return event.status === "success"
      ? `Upgrade succeeded in ${event.iteration} iteration(s)`
      : `Migration stopped: Limit reached (${event.message})`;
  }
  return event.message || "Pipeline event";
}

function appendActivityRow(event) {
  const feed = document.getElementById("runActivityFeed");
  if (!feed) return;

  const emptyState = document.getElementById("emptyRunState");
  if (emptyState) emptyState.remove();

  const row = document.createElement("div");
  row.className = "activity-row";

  const plainTitle = getEventPlainTitle(event);
  const timeStr = new Date(event.timestamp).toLocaleTimeString();

  // Status icon
  let statusDotColor = "var(--text-tertiary)";
  if (event.status === "error") statusDotColor = "var(--error-fg)";
  else if (event.status === "success") statusDotColor = "var(--success-fg)";
  else if (event.status === "running") statusDotColor = "var(--accent-base)";

  const summaryHtml = `
    <div class="activity-row-summary" onclick="toggleActivityRow(this)">
      <div class="activity-row-left">
        <span class="status-dot" style="background-color: ${statusDotColor}; flex-shrink: 0;"></span>
        <span class="truncate">${escapeHtml(plainTitle)}</span>
      </div>
      <div class="activity-row-right">
        <span class="activity-row-time">${timeStr}</span>
        <svg class="activity-row-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
    </div>
  `;

  // Details body
  let detailsHtml = "";

  // 1. Pytest summary & trace
  if (event.payload && event.payload.test_summary) {
    const ts = event.payload.test_summary;
    detailsHtml += `
      <div style="font-family: var(--font-mono); font-size: 11px; margin-bottom: 6px;">
        <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 2px;">
          Pytest: ${ts.passed} passed, ${ts.failed} failed of ${ts.total}
        </div>
        ${ts.failed_test_names && ts.failed_test_names.length > 0 ? `
          <div style="color: var(--error-fg); margin: 4px 0;">
            ${ts.failed_test_names.map(t => `<div>• ${escapeHtml(t)}</div>`).join("")}
          </div>
        ` : ""}
        ${ts.output_tail ? `
          <pre style="padding: 6px; background: var(--bg-app); border: 1px solid var(--border-default); border-radius: 4px; overflow-x: auto; max-height: 140px; white-space: pre-wrap; color: var(--text-secondary);">${escapeHtml(ts.output_tail)}</pre>
        ` : ""}
      </div>
    `;
  }

  // 2. Migration Plan markdown
  if (event.payload && event.payload.plan_markdown) {
    detailsHtml += `
      <div class="markdown-body" style="font-size: 12px; max-height: 180px; overflow-y: auto;">
        ${marked.parse(event.payload.plan_markdown)}
      </div>
    `;
  }

  // 3. Research Rules
  if (event.payload && event.payload.research_findings && event.payload.research_findings.length > 0) {
    detailsHtml += `
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <span style="font-size: 11px; font-weight: 600; color: var(--text-primary);">Tavily Documentation Snippets:</span>
        ${event.payload.research_findings.map(rf => `
          <div style="padding: 6px 8px; background: var(--bg-app); border: 1px solid var(--border-default); border-radius: 4px; font-size: 11px;">
            <div style="font-weight: 500; color: var(--text-primary);">${escapeHtml(rf.query || "Documentation Query")}</div>
            <div style="color: var(--text-secondary); margin-top: 2px;">${escapeHtml(rf.summary || rf.rule)}</div>
            ${rf.source_url ? `<a href="${escapeHtml(rf.source_url)}" target="_blank" rel="noopener noreferrer" style="color: var(--accent-fg); text-decoration: none; font-size: 10px; display: inline-flex; align-items: center; gap: 3px; margin-top: 2px;">${escapeHtml(rf.source_title || rf.source_url)} <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg></a>` : ""}
          </div>
        `).join("")}
      </div>
    `;
  }

  // 4. Diff preview
  if (event.payload && event.payload.diff) {
    detailsHtml += `
      <div class="diff-container" style="max-height: 160px; margin-top: 6px;">
        ${formatDiffHtml(event.payload.diff)}
      </div>
    `;
  }

  // Fallback to message text
  if (!detailsHtml) {
    detailsHtml = `<p style="color: var(--text-secondary); font-size: 12px; line-height: 1.4;">${escapeHtml(event.message)}</p>`;
  }

  row.innerHTML = summaryHtml + `<div class="activity-row-details">${detailsHtml}</div>`;
  feed.appendChild(row);

  // Auto-scroll if enabled
  if (isAutoScrollEnabled) {
    feed.scrollTop = feed.scrollHeight;
  }
}

function toggleActivityRow(summaryEl) {
  const row = summaryEl.closest(".activity-row");
  if (row) {
    row.classList.toggle("expanded");
  }
}

// --------------------------------------------------------------------------
// Right Panel: Tests History (Sparklines / Bars)
// --------------------------------------------------------------------------
function recordTestSummary(ts, iteration, step) {
  lastTestSummary = ts;
  const pct = ts.total > 0 ? Math.round((ts.passed / ts.total) * 100) : 0;

  // Update current badge
  const badge = document.getElementById("currentTestSummaryBadge");
  if (badge) {
    badge.innerText = `${ts.passed} / ${ts.total} Passing (${pct}%)`;
    badge.className = `status-badge ${ts.passed === ts.total && ts.total > 0 ? "status-ready" : "status-warning"}`;
  }

  // Label
  const label = iteration === 0 ? "Baseline" : `Iteration ${iteration}`;
  // Avoid duplicate iteration logs
  const existingIdx = testHistory.findIndex(h => h.label === label);
  if (existingIdx >= 0) {
    testHistory[existingIdx] = { label, passed: ts.passed, total: ts.total, pct };
  } else {
    testHistory.push({ label, passed: ts.passed, total: ts.total, pct });
  }

  renderTestHistory();
}

function renderTestHistory() {
  const container = document.getElementById("testHistoryList");
  if (!container) return;

  if (testHistory.length === 0) {
    container.innerHTML = `<span style="color: var(--text-tertiary); font-size: 11px;">Waiting for baseline tests...</span>`;
    return;
  }

  container.innerHTML = testHistory.map(h => {
    const isFull = h.passed === h.total && h.total > 0;
    return `
      <div class="test-history-row">
        <div class="test-history-labels">
          <span style="font-weight: 500; color: var(--text-primary);">${h.label}</span>
          <span style="font-family: var(--font-mono);">${h.passed}/${h.total} (${h.pct}%)</span>
        </div>
        <div class="test-history-bar-track">
          <div class="test-history-bar-fill ${isFull ? "success" : ""}" style="width: ${h.pct}%;"></div>
        </div>
      </div>
    `;
  }).join("");
}

// --------------------------------------------------------------------------
// Right Panel: Sources List
// --------------------------------------------------------------------------
function recordSources(findings) {
  findings.forEach(f => {
    if (f.source_url && !uniqueSources.has(f.source_url)) {
      try {
        const parsed = new URL(f.source_url);
        uniqueSources.set(f.source_url, {
          domain: parsed.hostname,
          title: f.source_title || f.title || f.source_url,
          note: f.summary || f.rule || f.note || "",
          url: f.source_url,
        });
      } catch (err) {
        uniqueSources.set(f.source_url, {
          domain: "web source",
          title: f.source_url,
          note: f.summary || "",
          url: f.source_url,
        });
      }
    }
  });

  const countBadge = document.getElementById("sourcesCountBadge");
  if (countBadge) countBadge.innerText = String(uniqueSources.size);

  renderSourcesList();
}

function renderSourcesList() {
  const container = document.getElementById("runSourcesList");
  if (!container) return;

  if (uniqueSources.size === 0) {
    container.innerHTML = `<div style="color: var(--text-tertiary); font-size: 11px; padding: 4px;">No documentation sources retrieved yet.</div>`;
    return;
  }

  const items = Array.from(uniqueSources.values());
  container.innerHTML = items.map(s => `
    <div class="source-item">
      <span class="source-domain">${escapeHtml(s.domain)}</span>
      <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer" class="source-link">
        <span>${escapeHtml(s.title)}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>
      </a>
      ${s.note ? `<p class="source-note">${escapeHtml(s.note)}</p>` : ""}
    </div>
  `).join("");
}

// --------------------------------------------------------------------------
// Right Panel: Usage & Spend Table
// --------------------------------------------------------------------------
function resetUsageMetrics() {
  const fields = [
    "usageTokensUltra", "usageCostUltra",
    "usageTokensSuper", "usageCostSuper",
    "usageTokensNano", "usageCostNano",
    "usageTavilyCalls",
    "usageTotalTokens", "usageTotalCost",
  ];
  fields.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (id.includes("Cost")) el.innerText = "$0.000000";
      else if (id.includes("Calls")) el.innerText = "0 calls";
      else el.innerText = "0";
    }
  });
  const iterBadge = document.getElementById("runIterationUsageBadge");
  if (iterBadge) iterBadge.innerText = "Iter 0 of 5";
}

function updateUsageMetrics(tracker, iteration, maxIterations) {
  const cum = tracker.cumulative;
  const tiers = tracker.tier_usage;

  const iterBadge = document.getElementById("runIterationUsageBadge");
  if (iterBadge) iterBadge.innerText = `Iter ${iteration} of ${maxIterations || 5}`;

  // Ultra
  if (tiers.ultra) {
    const t = document.getElementById("usageTokensUltra");
    const c = document.getElementById("usageCostUltra");
    if (t) t.innerText = tiers.ultra.total_tokens.toLocaleString();
    if (c) c.innerText = `$${tiers.ultra.cost_usd.toFixed(6)}`;
  }
  // Super
  if (tiers.super) {
    const t = document.getElementById("usageTokensSuper");
    const c = document.getElementById("usageCostSuper");
    if (t) t.innerText = tiers.super.total_tokens.toLocaleString();
    if (c) c.innerText = `$${tiers.super.cost_usd.toFixed(6)}`;
  }
  // Nano
  if (tiers.nano) {
    const t = document.getElementById("usageTokensNano");
    const c = document.getElementById("usageCostNano");
    if (t) t.innerText = tiers.nano.total_tokens.toLocaleString();
    if (c) c.innerText = `$${tiers.nano.cost_usd.toFixed(6)}`;
  }
  // Tavily
  if (tracker.tavily_usage) {
    const tc = document.getElementById("usageTavilyCalls");
    if (tc) tc.innerText = `${tracker.tavily_usage.api_calls} calls`;
  }
  // Total
  const totT = document.getElementById("usageTotalTokens");
  const totC = document.getElementById("usageTotalCost");
  if (totT) totT.innerText = cum.total_tokens.toLocaleString();
  if (totC) totC.innerText = `$${cum.total_cost_usd.toFixed(6)}`;
}

// --------------------------------------------------------------------------
// Mobile Run Tabs
// --------------------------------------------------------------------------
function switchMobileRunTab(tabName) {
  const actPanel = document.getElementById("activityPanel");
  const metPanel = document.getElementById("metricsPanel");
  const cardTests = document.getElementById("metricCardTests");
  const cardSources = document.getElementById("metricCardSources");
  const cardUsage = document.getElementById("metricCardUsage");

  // Tab buttons
  ["activity", "tests", "sources", "usage"].forEach(t => {
    const btn = document.getElementById(`mobileTab${t.charAt(0).toUpperCase() + t.slice(1)}`);
    if (btn) {
      if (t === tabName) btn.classList.add("active");
      else btn.classList.remove("active");
    }
  });

  if (!actPanel || !metPanel) return;

  if (tabName === "activity") {
    actPanel.classList.remove("mobile-hidden");
    metPanel.classList.remove("mobile-active");
  } else {
    actPanel.classList.add("mobile-hidden");
    metPanel.classList.add("mobile-active");

    if (cardTests) cardTests.style.display = tabName === "tests" ? "flex" : "none";
    if (cardSources) cardSources.style.display = tabName === "sources" ? "flex" : "none";
    if (cardUsage) cardUsage.style.display = tabName === "usage" ? "flex" : "none";
  }
}

// --------------------------------------------------------------------------
// Deliverables & Tabs
// --------------------------------------------------------------------------
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

// --------------------------------------------------------------------------
// Finish Run
// --------------------------------------------------------------------------
function finishRun(success, message, isCapHit = false) {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  stopElapsedTimer();

  // Reset landing buttons
  const runBtn = document.getElementById("runBtn");
  const cachedRunBtn = document.getElementById("cachedRunBtn");
  if (runBtn) runBtn.disabled = false;
  if (cachedRunBtn) cachedRunBtn.disabled = false;

  if (isCapHit) {
    updateRunStatus("warning", "Stopped");
    const capAlert = document.getElementById("capAlertBanner");
    const capText = document.getElementById("capAlertText");
    if (capAlert && capText) {
      capAlert.classList.remove("hidden");
      capText.innerText = message;
    }
  } else if (success) {
    updateRunStatus("ready", "Succeeded");
    const capAlert = document.getElementById("capAlertBanner");
    if (capAlert) capAlert.classList.add("hidden");
  } else {
    updateRunStatus("error", "Failed");
    const capAlert = document.getElementById("capAlertBanner");
    const capText = document.getElementById("capAlertText");
    if (capAlert && capText) {
      capAlert.classList.remove("hidden");
      capText.innerText = message || "Pipeline failed.";
    }
  }
}

// --------------------------------------------------------------------------
// Helpers: Diff Formatting, Copy, Toast, Escape
// --------------------------------------------------------------------------
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

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
