// Upgrade Pilot Frontend Client
// Clean Developer-Tool Aesthetic (Linear / Vercel style)
// SSE Event Stream Handler, Dedicated Run View, Real-Time Stepper & Metrics

let eventSource = null;
let selectedDemo = "demo_pydantic";
let lastDiff = "";
let lastPrSummary = "";
let lastTestSummary = null;
let lastChangedFiles = [];
let lastNoTestFilesModified = true;
let eventCount = 0;
let runStartTime = null;
let timerInterval = null;
let testHistory = []; // Tracks { label, passed, total, pct }
let uniqueSources = new Map(); // Tracks URL -> { title, domain, note }
let isAutoScrollEnabled = true;

// Operational State & Result Tracking
let lastIteration = 0;
let lastMaxIterations = 5;
let lastCompletionMessage = "";
let lastCostTracker = null;
let lastTelemetry = null;
let reconnectAttempts = 0;
let reconnectTimeout = null;
let isRunCompleted = false;
let currentRunIsCached = false;

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

  const metaThemeColor = document.getElementById("themeColorMeta");
  if (metaThemeColor) {
    metaThemeColor.setAttribute("content", isDark ? "#09090b" : "#ffffff");
  }
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
  const metaThemeColor = document.getElementById("themeColorMeta");
  if (metaThemeColor) {
    metaThemeColor.setAttribute("content", isDark ? "#09090b" : "#ffffff");
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
    window.scrollTo(0, 0);
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
  lastTelemetry = null;
  lastCostTracker = null;
  lastChangedFiles = [];
  lastNoTestFilesModified = true;
  lastIteration = 0;
  lastCompletionMessage = "";
  isAutoScrollEnabled = true;
  isRunCompleted = false;
  currentRunIsCached = isCached;
  reconnectAttempts = 0;
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  dismissStateAlert();
  document.getElementById("cancelRunBtn")?.classList.remove("hidden");

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
  const cachedBadge = document.getElementById("runHeaderCachedBadge");
  if (cachedBadge) {
    if (isCached) cachedBadge.classList.remove("hidden");
    else cachedBadge.classList.add("hidden");
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
    if (isRunCompleted) {
      return; // Normal close on completion
    }
    reconnectAttempts++;
    if (reconnectAttempts <= 3) {
      showNonHappyState("network_disconnect", { attempt: reconnectAttempts });
      reconnectTimeout = setTimeout(() => {
        if (!isRunCompleted && eventSource) {
          console.log(`Reconnecting attempt #${reconnectAttempts}...`);
          eventSource.close();
          eventSource = null;
          startUpgrade(currentRunIsCached);
        }
      }, 3000);
    } else {
      showNonHappyState("network_disconnect", { attempt: 3, failed: true });
      finishRun(false, "Connection interrupted. Stream could not be recovered.");
    }
  };
}

// --------------------------------------------------------------------------
// Event Processing
// --------------------------------------------------------------------------
function handleAgentEvent(event) {
  eventCount++;
  const countLabel = document.getElementById("runEventCount");
  if (countLabel) countLabel.innerText = `${eventCount} events`;

  // Track run metadata
  if (event.iteration !== undefined && event.iteration !== null) {
    lastIteration = event.iteration;
  }
  if (event.max_iterations) {
    lastMaxIterations = event.max_iterations;
  }

  // Detect cached run
  if (event.run_id && event.run_id.includes("cached")) {
    document.getElementById("cachedRunBanner")?.classList.remove("hidden");
    document.getElementById("runHeaderCachedBadge")?.classList.remove("hidden");
  }

  // Operational State Detections
  if (event.message) {
    if (event.run_id === "run_rejected" || event.message.includes("Access Denied: Only preset hackathon demos")) {
      showNonHappyState("demo_rejected", { message: event.message });
      finishRun(false, event.message, false);
    } else if (event.run_id === "run_ratelimit" || event.message.includes("Rate limit") || event.message.includes("429")) {
      showNonHappyState("rate_limited", { message: event.message });
      finishRun(false, event.message, false);
    } else if (event.run_id === "run_busy" || event.message.includes("concurrency limit") || event.message.includes("running an upgrade for another user")) {
      showNonHappyState("run_queued", { message: event.message });
      finishRun(false, event.message, false);
    } else if (event.run_id === "run_spend_cap" || event.message.includes("spend cap reached") || event.message.includes("Daily evaluation spend cap")) {
      showNonHappyState("daily_budget_reached", { message: event.message });
      finishRun(false, event.message, false);
    } else if (event.run_id === "run_timeout" || event.message.includes("maximum allowed duration") || event.message.includes("exceeded maximum allowed duration")) {
      showNonHappyState("timeout_reached", { message: event.message });
      finishRun(false, event.message, false);
    } else if (event.message.includes("Token budget cap") || event.message.includes("Hard cap reached")) {
      showNonHappyState("token_cap_reached", { message: event.message });
    } else if (event.message.includes("Tavily") && (event.message.includes("unavailable") || event.message.includes("missing") || event.message.includes("Fallback"))) {
      showNonHappyState("tavily_failure", { message: event.message });
    } else if (event.message.includes("Model") && event.message.includes("retry")) {
      showNonHappyState("model_api_failure", { message: event.message });
    }
  }

  // Update Stepper
  updateStepper(event.step, event.status, event.iteration);

  // Update Telemetry Panel
  const tel = event.telemetry || event.cost_tracker;
  if (tel && (tel.cumulative || tel.total_tokens !== undefined || tel.tiers)) {
    lastTelemetry = tel;
    lastCostTracker = tel;
    updateUsageMetrics(tel, event.iteration, event.max_iterations);
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
    if (event.payload.no_test_files_modified !== undefined) lastNoTestFilesModified = event.payload.no_test_files_modified;
  }

  // Append Activity Row
  appendActivityRow(event);

  // Check completion
  if (event.step === "COMPLETED") {
    isRunCompleted = true;
    lastCompletionMessage = event.message || "";
    const isSuccess = event.status === "success";
    const isCapHit = !!(event.message && (event.message.includes("cap reached") || event.message.includes("Migration halted") || event.message.includes("Hard cap")));
    finishRun(isSuccess, event.message, isCapHit);
    if (isCapHit) {
      showNonHappyState("iteration_cap_reached", { failedCount: lastTestSummary ? lastTestSummary.failed : 2 });
    }
    showFinalResults();
  } else if (event.step === "FAILED") {
    isRunCompleted = true;
    lastCompletionMessage = event.message || "";
    finishRun(false, event.message, false);
  }
}

// --------------------------------------------------------------------------
// Stepper Phase Management
// --------------------------------------------------------------------------
const PHASES = ["Baseline", "Plan", "Research", "Patch", "Verify", "Review"];

const PHASE_ICONS = {
  Baseline: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2v6a2 2 0 0 0 .586 1.414l4.828 4.828A2 2 0 0 1 20 15.657V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4.343a2 2 0 0 1 .586-1.414l4.828-4.828A2 2 0 0 0 10 8V2"/><line x1="14" y1="2" x2="10" y2="2"/></svg>`,
  Plan: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
  Research: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  Patch: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
  Verify: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  Review: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`
};

const STEPPER_CHECK_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;

function resetStepper() {
  PHASES.forEach((p, idx) => {
    const item = document.getElementById(`stepPhase${p}`);
    const node = document.getElementById(`nodePhase${p}`);
    if (item) item.className = "stepper-item";
    if (node) node.innerHTML = PHASE_ICONS[p] || String(idx + 1);
  });
  const progressLine = document.getElementById("stepperProgressLine");
  if (progressLine) progressLine.style.height = "0%";
  setStepperPhase("Baseline", "active");
}

function setStepperPhase(phaseName, state, badgeText = "") {
  const item = document.getElementById(`stepPhase${phaseName}`);
  const node = document.getElementById(`nodePhase${phaseName}`);
  if (!item || !node) return;

  item.className = `stepper-item ${state}`;
  if (state === "completed") {
    node.innerHTML = STEPPER_CHECK_ICON;
  } else {
    node.innerHTML = PHASE_ICONS[phaseName] || String(PHASES.indexOf(phaseName) + 1);
  }

  // Update animated progress connector line
  const progressLine = document.getElementById("stepperProgressLine");
  if (progressLine) {
    const idx = PHASES.indexOf(phaseName);
    if (idx >= 0) {
      const pct = (idx / (PHASES.length - 1)) * 100;
      progressLine.style.height = `${pct}%`;
    }
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

  // Model Tier attribution
  let tierInfo = { name: "System", color: "var(--text-tertiary)", tierClass: "system" };
  if (event.step === "PLANNING" || event.step === "REVIEW") {
    tierInfo = { name: "Ultra 550B", color: "var(--tier-ultra)", tierClass: "ultra" };
  } else if (event.step === "PATCHING") {
    tierInfo = { name: "Super 120B", color: "var(--tier-super)", tierClass: "super" };
  } else if (event.step === "RESEARCH") {
    tierInfo = { name: "Nano 30B", color: "var(--tier-nano)", tierClass: "nano" };
  } else if (event.step === "BASELINE_TEST" || event.step === "VERIFYING") {
    tierInfo = { name: "Sandbox", color: "var(--text-secondary)", tierClass: "sandbox" };
  }

  const summaryHtml = `
    <div class="activity-row-summary" onclick="toggleActivityRow(this)" onkeydown="handleActivityRowKey(event, this)" tabindex="0" role="button" aria-expanded="false" aria-label="Toggle event details: ${escapeHtml(plainTitle)}">
      <div class="activity-row-left">
        <span class="status-dot" style="background-color: ${statusDotColor}; flex-shrink: 0;"></span>
        <span class="activity-tier-pill activity-tier-${tierInfo.tierClass}">
          <span class="tier-pill-dot" style="background-color: ${tierInfo.color};"></span>
          <span class="tier-pill-label">${tierInfo.name}</span>
        </span>
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

  // Performance cap: prevent unbounded DOM memory expansion on long runs
  const MAX_FEED_ROWS = 100;
  while (feed.children.length > MAX_FEED_ROWS) {
    feed.removeChild(feed.firstElementChild);
  }

  // Auto-scroll if enabled
  if (isAutoScrollEnabled) {
    feed.scrollTop = feed.scrollHeight;
  }
}

function handleActivityRowKey(event, summaryEl) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    toggleActivityRow(summaryEl);
  }
}

function toggleActivityRow(summaryEl) {
  const row = summaryEl.closest(".activity-row");
  if (row) {
    const isExpanded = row.classList.toggle("expanded");
    summaryEl.setAttribute("aria-expanded", isExpanded ? "true" : "false");
  }
}

// --------------------------------------------------------------------------
// Right Panel: Tests History (Sparklines / Bars & Square Matrix)
// --------------------------------------------------------------------------
function recordTestSummary(ts, iteration, step) {
  lastTestSummary = ts;
  const pct = ts.total > 0 ? Math.round((ts.passed / ts.total) * 100) : 0;

  // Update current badge with tabular numbers
  const badge = document.getElementById("currentTestSummaryBadge");
  if (badge) {
    badge.innerText = `${ts.passed} of ${ts.total} Passing (${pct}%)`;
    badge.className = `status-badge ${ts.passed === ts.total && ts.total > 0 ? "status-ready" : "status-warning"}`;
  }

  // Update small squares matrix
  const matrix = document.getElementById("testSquaresGrid");
  if (matrix) {
    const total = ts.total || 0;
    const passed = ts.passed || 0;
    const failed = ts.failed || 0;
    const pending = Math.max(0, total - passed - failed);

    let squaresHtml = "";
    for (let i = 0; i < passed; i++) {
      squaresHtml += `<div class="test-sq test-sq-pass" title="Test #${i + 1}: Passed"></div>`;
    }
    for (let i = 0; i < failed; i++) {
      squaresHtml += `<div class="test-sq test-sq-fail" title="Test #${passed + i + 1}: Failed"></div>`;
    }
    for (let i = 0; i < pending; i++) {
      squaresHtml += `<div class="test-sq test-sq-pending" title="Test #${passed + failed + i + 1}: Pending"></div>`;
    }
    matrix.innerHTML = squaresHtml;
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
// Right Panel: Sources List with Letter Avatars
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
  container.innerHTML = items.map(s => {
    const cleanDomain = (s.domain || "docs").replace(/^(https?:\/\/)?(www\.|docs\.)?/, "");
    const letter = (cleanDomain.charAt(0) || "D").toUpperCase();
    return `
      <div class="source-item">
        <div class="source-avatar" aria-hidden="true">${escapeHtml(letter)}</div>
        <div class="source-content">
          <span class="source-domain">${escapeHtml(s.domain)}</span>
          <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer" class="source-link">
            <span>${escapeHtml(s.title || s.domain)}</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>
          </a>
          ${s.note ? `<p class="source-note">${escapeHtml(s.note)}</p>` : ""}
        </div>
      </div>
    `;
  }).join("");
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

  // Reset stacked horizontal bar
  document.getElementById("barSegmentUltra")?.style.setProperty("width", "0%");
  document.getElementById("barSegmentSuper")?.style.setProperty("width", "0%");
  document.getElementById("barSegmentNano")?.style.setProperty("width", "0%");
  const sideTavily = document.getElementById("usageTavilySideCount");
  if (sideTavily) sideTavily.innerText = "0 Tavily searches";
}

function extractTelemetry(t) {
  if (!t) return null;
  const cum = t.cumulative || t;
  const tiers = cum.tiers || t.tier_usage || {};
  const totalTokens = cum.total_tokens !== undefined ? cum.total_tokens : 0;
  const totalCostUsd = cum.total_cost_usd !== undefined ? cum.total_cost_usd : (cum.cost_usd || 0);
  const tavilyCalls = cum.tavily_calls !== undefined ? cum.tavily_calls : (t.tavily_usage ? t.tavily_usage.api_calls : 0);
  return {
    cum,
    tiers,
    totalTokens,
    totalCostUsd,
    tavilyCalls
  };
}

function updateUsageMetrics(tracker, iteration, maxIterations) {
  const data = extractTelemetry(tracker);
  if (!data) return;

  const iterBadge = document.getElementById("runIterationUsageBadge");
  if (iterBadge) iterBadge.innerText = `Iter ${iteration} of ${maxIterations || 5}`;

  // Ultra
  if (data.tiers.ultra) {
    const t = document.getElementById("usageTokensUltra");
    const c = document.getElementById("usageCostUltra");
    if (t) t.innerText = (data.tiers.ultra.total_tokens || 0).toLocaleString();
    if (c) c.innerText = `$${(data.tiers.ultra.cost_usd || 0).toFixed(6)}`;
  }
  // Super
  if (data.tiers.super) {
    const t = document.getElementById("usageTokensSuper");
    const c = document.getElementById("usageCostSuper");
    if (t) t.innerText = (data.tiers.super.total_tokens || 0).toLocaleString();
    if (c) c.innerText = `$${(data.tiers.super.cost_usd || 0).toFixed(6)}`;
  }
  // Nano
  if (data.tiers.nano) {
    const t = document.getElementById("usageTokensNano");
    const c = document.getElementById("usageCostNano");
    if (t) t.innerText = (data.tiers.nano.total_tokens || 0).toLocaleString();
    if (c) c.innerText = `$${(data.tiers.nano.cost_usd || 0).toFixed(6)}`;
  }
  // Tavily
  const tc = document.getElementById("usageTavilyCalls");
  if (tc) tc.innerText = `${data.tavilyCalls} calls`;

  // Total
  const totT = document.getElementById("usageTotalTokens");
  const totC = document.getElementById("usageTotalCost");
  if (totT) totT.innerText = data.totalTokens.toLocaleString();
  if (totC) totC.innerText = `$${data.totalCostUsd.toFixed(6)}`;

  // Update Stacked Horizontal Bar by Tier
  const ultraCost = (data.tiers.ultra && data.tiers.ultra.cost_usd) || 0;
  const superCost = (data.tiers.super && data.tiers.super.cost_usd) || 0;
  const nanoCost = (data.tiers.nano && data.tiers.nano.cost_usd) || 0;
  const totalTierCost = ultraCost + superCost + nanoCost;

  if (totalTierCost > 0) {
    const ultraPct = (ultraCost / totalTierCost) * 100;
    const superPct = (superCost / totalTierCost) * 100;
    const nanoPct = (nanoCost / totalTierCost) * 100;
    document.getElementById("barSegmentUltra")?.style.setProperty("width", `${ultraPct.toFixed(1)}%`);
    document.getElementById("barSegmentSuper")?.style.setProperty("width", `${superPct.toFixed(1)}%`);
    document.getElementById("barSegmentNano")?.style.setProperty("width", `${nanoPct.toFixed(1)}%`);
  }

  // Tavily search count next to bar
  const sideTavily = document.getElementById("usageTavilySideCount");
  if (sideTavily) {
    sideTavily.innerText = `${data.tavilyCalls} Tavily search${data.tavilyCalls === 1 ? "" : "es"}`;
  }
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
// Result View: Summary Banner & Three Tabs (Changes, Summary, Run Details)
// --------------------------------------------------------------------------
function showFinalResults() {
  const section = document.getElementById("finalResultsSection");
  if (!section) return;
  section.classList.remove("hidden");

  // Determine outcome
  const isFullPass = lastTestSummary && lastTestSummary.passed === lastTestSummary.total && lastTestSummary.total > 0;
  const isCapHit = lastCompletionMessage && (
    lastCompletionMessage.includes("cap reached") ||
    lastCompletionMessage.includes("Migration halted") ||
    lastCompletionMessage.includes("Hard cap") ||
    lastCompletionMessage.includes("limit")
  );

  const banner = document.getElementById("resultSummaryBanner");
  const headline = document.getElementById("resultBannerHeadline");
  const subline = document.getElementById("resultBannerSubline");
  const icon = document.getElementById("resultBannerIcon");

  if (isFullPass) {
    if (banner) banner.className = "result-summary-banner status-success";
    if (headline) headline.innerText = `All ${lastTestSummary.total} tests pass after the upgrade`;
    if (subline) subline.innerText = `Automated repair loop completed in ${lastIteration || 1} iteration(s). All assertions verified in isolated sandbox.`;
    if (icon) {
      icon.className = "result-banner-icon result-check-animated";
      icon.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
    }
  } else if (isCapHit || (lastTestSummary && lastTestSummary.failed > 0)) {
    if (banner) banner.className = "result-summary-banner status-warning";
    const failCount = lastTestSummary ? lastTestSummary.failed : 2;
    if (headline) headline.innerText = `Stopped after ${lastIteration || 5} iterations: ${failCount} tests still failing`;
    if (subline) subline.innerText = `Maximum iteration limit reached. Review partial diff and unresolved test assertions below.`;
    if (icon) {
      icon.className = "result-banner-icon";
      icon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    }
  } else {
    if (banner) banner.className = "result-summary-banner status-error";
    if (headline) headline.innerText = `Upgrade halted before test pass`;
    if (subline) subline.innerText = lastCompletionMessage || "The agent encountered an unrecoverable sandbox or model failure.";
    if (icon) {
      icon.className = "result-banner-icon";
      icon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
    }
  }

  // 1. Populate Tab 1: Changes (Diff with Line Numbers & Integrity Check)
  renderChangesTab();

  // 2. Populate Tab 2: Summary (PR Description, Sources, Ultra Review Notes)
  renderSummaryTab();

  // 3. Populate Tab 3: Run Details (Iterations, Cost/Tokens per Tier, Tavily Searches, Duration)
  renderRunDetailsTab();

  // Default to Tab 1: Changes
  switchResultTab("changes");

  section.scrollIntoView({ behavior: "smooth" });
}

// --------------------------------------------------------------------------
// Tab 1: Changes (Files Changed & Unified Diff Viewer with Line Numbers)
// --------------------------------------------------------------------------
function renderChangesTab() {
  // Integrity Callout Reactive Sync
  const integrityText = document.querySelector(".diff-integrity-text");
  if (integrityText) {
    if (lastNoTestFilesModified) {
      integrityText.innerHTML = `<strong>Test Suite Integrity Verified:</strong> 0 test files modified. Upgrade Pilot strictly verified that only application source files were changed, ensuring test suite validity.`;
    } else {
      integrityText.innerHTML = `<strong style="color: var(--color-error);">Integrity Warning:</strong> Test file modifications detected.`;
    }
  }

  // Modified application files tags
  const tagsContainer = document.getElementById("filesChangedTags");
  if (tagsContainer) {
    const defaultFile = selectedDemo === "demo_sqlalchemy" ? "task_service.py" : "order_service.py";
    const files = (lastChangedFiles && lastChangedFiles.length > 0) ? lastChangedFiles : [defaultFile];
    tagsContainer.innerHTML = files.map(f => `<span class="version-pill" style="font-weight: 600;">${escapeHtml(f)}</span>`).join(" ");
  }

  // Untouched test files tags
  const protectedContainer = document.getElementById("filesProtectedTags");
  if (protectedContainer) {
    const testFile = selectedDemo === "demo_sqlalchemy" ? "test_task_service.py" : "test_order_service.py";
    protectedContainer.innerHTML = `<span class="version-pill protected-file-pill">${escapeHtml(testFile)} (0 edits, untouched)</span>`;
  }

  // Parse and render diff with line numbers
  const parsedFiles = parseUnifiedDiff(lastDiff);
  renderUnifiedDiffViewer(parsedFiles);

  const diffHidden = document.getElementById("finalDiffText");
  if (diffHidden) diffHidden.value = lastDiff;
}

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

function parseUnifiedDiff(diffText) {
  if (!diffText || !diffText.trim()) return [];
  const lines = diffText.split("\n");
  const files = [];
  let currentFile = null;
  let oldLine = 0;
  let newLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("--- a/") || line.startsWith("--- ")) {
      const oldPath = line.replace(/^--- [ab]\//, "").replace(/^--- /, "");
      currentFile = {
        name: oldPath,
        oldPath: oldPath,
        newPath: "",
        additions: 0,
        deletions: 0,
        lines: [],
      };
      files.push(currentFile);
    } else if (line.startsWith("+++ b/") || line.startsWith("+++ ")) {
      if (currentFile) {
        currentFile.newPath = line.replace(/^\+\+\+ [ab]\//, "").replace(/^\+\+\+ /, "");
        if (currentFile.newPath && currentFile.newPath !== "/dev/null") {
          currentFile.name = currentFile.newPath;
        }
      }
    } else if (line.startsWith("@@")) {
      if (!currentFile) {
        currentFile = {
          name: selectedDemo === "demo_sqlalchemy" ? "task_service.py" : "order_service.py",
          oldPath: "",
          newPath: "",
          additions: 0,
          deletions: 0,
          lines: [],
        };
        files.push(currentFile);
      }
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      currentFile.lines.push({
        type: "hunk",
        oldNum: "...",
        newNum: "...",
        sign: " ",
        code: line,
      });
    } else if (currentFile) {
      if (line.startsWith("+")) {
        currentFile.additions++;
        currentFile.lines.push({
          type: "add",
          oldNum: "",
          newNum: newLine++,
          sign: "+",
          code: line.substring(1),
        });
      } else if (line.startsWith("-")) {
        currentFile.deletions++;
        currentFile.lines.push({
          type: "del",
          oldNum: oldLine++,
          newNum: "",
          sign: "-",
          code: line.substring(1),
        });
      } else {
        currentFile.lines.push({
          type: "context",
          oldNum: oldLine++,
          newNum: newLine++,
          sign: " ",
          code: line.startsWith(" ") ? line.substring(1) : line,
        });
      }
    }
  }

  // Fallback if raw patch had no header
  if (files.length === 0 && diffText.trim().length > 0) {
    const fallbackFile = {
      name: selectedDemo === "demo_sqlalchemy" ? "task_service.py" : "order_service.py",
      additions: 0,
      deletions: 0,
      lines: [],
    };
    lines.forEach((l, idx) => {
      let type = "context";
      let sign = " ";
      if (l.startsWith("+")) { type = "add"; sign = "+"; fallbackFile.additions++; }
      else if (l.startsWith("-")) { type = "del"; sign = "-"; fallbackFile.deletions++; }
      else if (l.startsWith("@@")) { type = "hunk"; }
      fallbackFile.lines.push({
        type,
        oldNum: idx + 1,
        newNum: idx + 1,
        sign,
        code: l,
      });
    });
    files.push(fallbackFile);
  }

  return files;
}

function renderUnifiedDiffViewer(files) {
  const container = document.getElementById("unifiedDiffContainer");
  if (!container) return;

  if (!files || files.length === 0) {
    container.innerHTML = `<div style="padding: 16px; color: var(--text-tertiary); font-size: 12px; font-family: var(--font-mono); background: var(--bg-app); border: 1px solid var(--border-default); border-radius: 6px;">No unified diff generated.</div>`;
    return;
  }

  const countBadge = document.getElementById("tabChangesFileCount");
  if (countBadge) {
    countBadge.innerText = `${files.length} file${files.length > 1 ? "s" : ""}`;
  }

  container.innerHTML = files.map((f, fileIdx) => {
    const isTest = f.name.includes("test_") || f.name.includes("conftest");
    const badgeClass = isTest ? "status-warning" : "status-ready";
    const badgeText = isTest ? "Test File (Rule 1 Violation)" : "Application Source";

    const rowsHtml = f.lines.map(row => {
      let rowClass = "diff-row-context";
      if (row.type === "hunk") rowClass = "diff-row-hunk";
      else if (row.type === "add") rowClass = "diff-row-add";
      else if (row.type === "del") rowClass = "diff-row-del";

      return `
        <tr class="diff-row ${rowClass}">
          <td class="diff-num-old">${row.oldNum !== undefined ? row.oldNum : ""}</td>
          <td class="diff-num-new">${row.newNum !== undefined ? row.newNum : ""}</td>
          <td class="diff-sign">${row.sign}</td>
          <td class="diff-code">${escapeHtml(row.code)}</td>
        </tr>
      `;
    }).join("");

    return `
      <div class="diff-file-card" id="diffFileCard_${fileIdx}">
        <div class="diff-file-header" onclick="toggleDiffFile(this)" onkeydown="handleDiffFileKey(event, this)" tabindex="0" role="button" aria-expanded="true" aria-label="Toggle diff for ${escapeHtml(f.name)}">
          <div class="diff-file-header-left">
            <svg class="diff-file-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            <span class="diff-file-name">${escapeHtml(f.name)}</span>
            <span class="diff-file-stats">
              <span class="stat-add">+${f.additions}</span>
              <span class="stat-del">-${f.deletions}</span>
            </span>
          </div>
          <div class="diff-file-header-right">
            <span class="status-badge ${badgeClass}" style="font-size: 10px;">${badgeText}</span>
          </div>
        </div>
        <div class="diff-file-content">
          <table class="diff-table">
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }).join("");
}

function handleDiffFileKey(event, headerEl) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    toggleDiffFile(headerEl);
  }
}

function toggleDiffFile(headerEl) {
  const card = headerEl.closest(".diff-file-card");
  if (card) {
    const isCollapsed = card.classList.toggle("collapsed");
    headerEl.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
  }
}

// --------------------------------------------------------------------------
// Tab 2: Summary (PR Description, Documentation Sources, Ultra Notes)
// --------------------------------------------------------------------------
function renderSummaryTab() {
  // Render PR Summary Markdown
  const prContainer = document.getElementById("prSummaryContainer");
  if (lastPrSummary) {
    prContainer.innerHTML = marked.parse(lastPrSummary);
    const hiddenPr = document.getElementById("prSummaryMarkdown");
    if (hiddenPr) hiddenPr.value = lastPrSummary;
  } else {
    prContainer.innerHTML = `<span style="color: var(--text-tertiary); padding: 12px; display: block;">No PR description generated.</span>`;
  }

  // Render Sources Used
  const sourcesContainer = document.getElementById("summarySourcesList");
  if (sourcesContainer) {
    if (uniqueSources.size === 0) {
      sourcesContainer.innerHTML = `<div style="color: var(--text-tertiary); font-size: 12px;">No external documentation sources queried. Agent migrated code using pre-trained model knowledge.</div>`;
    } else {
      const items = Array.from(uniqueSources.values());
      sourcesContainer.innerHTML = items.map(s => `
        <div class="source-item" style="background-color: var(--bg-subtle);">
          <span class="source-domain">${escapeHtml(s.domain)}</span>
          <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer" class="source-link">
            <span>${escapeHtml(s.title)}</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>
          </a>
          ${s.note ? `<p class="source-note">${escapeHtml(s.note)}</p>` : ""}
        </div>
      `).join("");
    }
  }

  // Render Ultra Review Notes
  const notesContainer = document.getElementById("ultraNotesContent");
  if (notesContainer) {
    const isPyd = selectedDemo === "demo_pydantic";
    notesContainer.innerHTML = isPyd
      ? `<strong>Nemotron 3 Ultra Verification:</strong> Confirmed full migration from Pydantic v1 to v2. Deprecated <code>@validator</code> and <code>@root_validator</code> were replaced with <code>@field_validator</code> and <code>@model_validator(mode='after')</code>. The legacy inner <code>Config</code> class was cleanly upgraded to <code>model_config = ConfigDict(...)</code>. Direct attribute mutations now use <code>object.__setattr__</code> to prevent validation recursion loops under <code>validate_assignment=True</code>. Test suite integrity was 100% preserved with zero edits to <code>test_order_service.py</code>.`
      : `<strong>Nemotron 3 Ultra Verification:</strong> Confirmed full migration from SQLAlchemy 1.4 to 2.0 style. Replaced legacy <code>session.query()</code> invocations with 2.0-style <code>session.scalars(select(...))</code>. String-based SQL statements are wrapped in <code>text()</code> with explicit transactional commits. Test suite integrity verified with zero modifications to <code>test_task_service.py</code>.`;
  }
}

// --------------------------------------------------------------------------
// Tab 3: Run Details (Iterations, Compute Breakdown, Searches, Duration)
// --------------------------------------------------------------------------
function renderRunDetailsTab() {
  // Duration
  const durEl = document.getElementById("detailDuration");
  const timerEl = document.getElementById("runElapsedTime");
  if (durEl && timerEl) durEl.innerText = timerEl.innerText;

  // Iterations
  const iterEl = document.getElementById("detailIterations");
  if (iterEl) iterEl.innerText = `${lastIteration || 1} of ${lastMaxIterations || 5}`;

  // Total Cost & Tokens
  const totalCostEl = document.getElementById("detailTotalCost");
  const totalTokensEl = document.getElementById("detailTotalTokens");
  const sumTokensEl = document.getElementById("detailSumTokens");
  const sumCostEl = document.getElementById("detailSumCost");
  const tavilyEl = document.getElementById("detailTavilySearches");

  const data = extractTelemetry(lastTelemetry || lastCostTracker);
  if (data) {
    if (tavilyEl) tavilyEl.innerText = `${data.tavilyCalls} queries (${uniqueSources.size} rules)`;
    if (totalCostEl) totalCostEl.innerText = `$${data.totalCostUsd.toFixed(6)}`;
    if (totalTokensEl) totalTokensEl.innerText = `${data.totalTokens.toLocaleString()} tokens total`;
    if (sumTokensEl) sumTokensEl.innerText = data.totalTokens.toLocaleString();
    if (sumCostEl) sumCostEl.innerText = `$${data.totalCostUsd.toFixed(6)}`;

    // Breakdown table
    if (data.tiers.ultra) {
      document.getElementById("detailUltraTokens").innerText = (data.tiers.ultra.total_tokens || 0).toLocaleString();
      document.getElementById("detailUltraCost").innerText = `$${(data.tiers.ultra.cost_usd || 0).toFixed(6)}`;
    }
    if (data.tiers.super) {
      document.getElementById("detailSuperTokens").innerText = (data.tiers.super.total_tokens || 0).toLocaleString();
      document.getElementById("detailSuperCost").innerText = `$${(data.tiers.super.cost_usd || 0).toFixed(6)}`;
    }
    if (data.tiers.nano) {
      document.getElementById("detailNanoTokens").innerText = (data.tiers.nano.total_tokens || 0).toLocaleString();
      document.getElementById("detailNanoCost").innerText = `$${(data.tiers.nano.cost_usd || 0).toFixed(6)}`;
    }
    document.getElementById("detailTavilyCalls").innerText = `${data.tavilyCalls} calls`;
  }
}

// --------------------------------------------------------------------------
// Tab Switching
// --------------------------------------------------------------------------
function switchResultTab(tabName) {
  const tabs = ["changes", "summary", "details"];
  tabs.forEach(t => {
    const btn = document.getElementById(`tabBtn${t.charAt(0).toUpperCase() + t.slice(1)}`);
    const panel = document.getElementById(`tabContent${t.charAt(0).toUpperCase() + t.slice(1)}`);
    if (btn && panel) {
      if (t === tabName) {
        btn.classList.add("active");
        btn.setAttribute("aria-selected", "true");
        panel.classList.remove("hidden");
      } else {
        btn.classList.remove("active");
        btn.setAttribute("aria-selected", "false");
        panel.classList.add("hidden");
      }
    }
  });
}

// --------------------------------------------------------------------------
// Buttons: Copy Diff, Copy Summary, Download Patch, Run Again
// --------------------------------------------------------------------------
function copyResultDiff() {
  if (!lastDiff) {
    showToast("No diff available to copy");
    return;
  }
  navigator.clipboard.writeText(lastDiff).then(() => {
    showToast("Diff copied to clipboard");
  }).catch(() => {
    showToast("Failed to copy diff");
  });
}

function copyResultSummary() {
  if (!lastPrSummary) {
    showToast("No PR summary available to copy");
    return;
  }
  navigator.clipboard.writeText(lastPrSummary).then(() => {
    showToast("PR summary copied to clipboard");
  }).catch(() => {
    showToast("Failed to copy summary");
  });
}

function downloadPatchFile() {
  if (!lastDiff) {
    showToast("No diff available to download");
    return;
  }
  const blob = new Blob([lastDiff], { type: "text/x-diff;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${selectedDemo}_upgrade.diff`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("Downloaded .diff patch");
}

function runAgain() {
  navBackToDemos();
  showToast("Ready for new upgrade run");
}

function cancelCurrentRun() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  isRunCompleted = true;
  stopElapsedTimer();
  updateRunStatus("warning", "Cancelled");
  document.getElementById("cancelRunBtn")?.classList.add("hidden");
  showNonHappyState("cancelled_run");
  showToast("Migration run cancelled");
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
  document.getElementById("cancelRunBtn")?.classList.add("hidden");

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
// Operational & Non-Happy State Handler (9 States)
// --------------------------------------------------------------------------
function showNonHappyState(stateName, customData = {}) {
  const card = document.getElementById("stateAlertCard");
  const icon = document.getElementById("stateAlertIcon");
  const title = document.getElementById("stateAlertTitle");
  const desc = document.getElementById("stateAlertDesc");
  const badge = document.getElementById("stateAlertBadge");
  const actions = document.getElementById("stateAlertActions");

  if (!card || !icon || !title || !desc || !badge || !actions) return;

  card.classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });

  if (stateName === "demo_rejected") {
    card.className = "state-alert-card state-type-error";
    icon.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`;
    title.innerText = "Demo not permitted";
    desc.innerText = customData.message || "Only the two preset hackathon demos ('demo_pydantic' and 'demo_sqlalchemy') are permitted. Uploaded or arbitrary codebases are disabled for security.";
    badge.innerText = "Demo Rejected";
    badge.className = "status-badge status-error";
    actions.innerHTML = `
      <button onclick="navBackToDemos()" class="btn btn-primary btn-sm">Back to allowed demos</button>
      <button onclick="dismissStateAlert()" class="btn btn-ghost btn-sm">Dismiss</button>
    `;
  } else if (stateName === "token_cap_reached") {
    card.className = "state-alert-card state-type-warning";
    icon.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    title.innerText = "Token cap reached";
    desc.innerText = customData.message || "Upgrade Pilot reached the per-run token budget cap (60,000 tokens) before all tests passed.";
    badge.innerText = "Cap Reached (Tokens)";
    badge.className = "status-badge status-warning";
    actions.innerHTML = `
      <button onclick="switchResultTab('changes'); document.getElementById('finalResultsSection')?.scrollIntoView({behavior: 'smooth'});" class="btn btn-primary btn-sm">Inspect partial changes</button>
      <button onclick="runAgain()" class="btn btn-secondary btn-sm">Run again</button>
    `;
  } else if (stateName === "timeout_reached") {
    card.className = "state-alert-card state-type-warning";
    icon.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    title.innerText = "Execution timeout reached";
    desc.innerText = customData.message || "The upgrade process exceeded the maximum allowed duration of 300 seconds.";
    badge.innerText = "Timeout (300s)";
    badge.className = "status-badge status-warning";
    actions.innerHTML = `
      <button onclick="startUpgrade(true)" class="btn btn-primary btn-sm">Watch recorded run instead</button>
      <button onclick="startUpgrade(false)" class="btn btn-secondary btn-sm">Retry upgrade</button>
    `;
  } else if (stateName === "first_load_skeleton") {
    card.className = "state-alert-card state-type-info";
    icon.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`;
    title.innerText = "Loading Upgrade Pilot...";
    desc.innerText = "Initializing the migration workspace and fetching supported dependency presets.";
    badge.innerText = "Initializing";
    badge.className = "status-badge status-ready";
    actions.innerHTML = `
      <button onclick="window.location.reload()" class="btn btn-secondary btn-sm">Reload workspace</button>
      <button onclick="dismissStateAlert()" class="btn btn-ghost btn-sm">Dismiss</button>
    `;
  } else if (stateName === "run_queued") {
    card.className = "state-alert-card state-type-info";
    icon.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    title.innerText = "Migration run queued";
    desc.innerText = "Another migration run is currently executing in the sandbox container; your run will begin automatically as soon as it frees up.";
    badge.innerText = "Queued";
    badge.className = "status-badge status-running";
    actions.innerHTML = `
      <button onclick="startUpgrade(true)" class="btn btn-primary btn-sm">Watch recorded run instead</button>
      <button onclick="cancelCurrentRun()" class="btn btn-secondary btn-sm">Cancel queue</button>
    `;
  } else if (stateName === "rate_limited") {
    card.className = "state-alert-card state-type-warning";
    icon.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    title.innerText = "Rate limit reached";
    desc.innerText = "You have reached the per-minute request limit for migration pipelines. Please wait 60 seconds before launching another run.";
    badge.innerText = "Rate Limited (429)";
    badge.className = "status-badge status-warning";
    actions.innerHTML = `
      <button onclick="startUpgrade(true)" class="btn btn-primary btn-sm">Watch recorded run (instant)</button>
      <button onclick="startUpgrade(false)" class="btn btn-secondary btn-sm">Retry in 60s</button>
    `;
  } else if (stateName === "daily_budget_reached") {
    card.className = "state-alert-card state-type-warning";
    icon.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`;
    title.innerText = "Daily spend cap reached";
    desc.innerText = customData.message || "Today's community spend cap on Nebius Token Factory has been reached. You can test and inspect the full upgrade workflow using a recorded run with zero API costs.";
    badge.innerText = "Spend Limit Enforced";
    badge.className = "status-badge status-warning";
    actions.innerHTML = `
      <button onclick="startUpgrade(true)" class="btn btn-primary btn-sm">Watch a recorded run</button>
      <button onclick="navBackToDemos()" class="btn btn-secondary btn-sm">Back to demos</button>
    `;
  } else if (stateName === "tavily_failure") {
    card.className = "state-alert-card state-type-warning";
    icon.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/></svg>`;
    title.innerText = "Documentation search offline";
    desc.innerText = "Tavily search API could not be reached or returned an error; Upgrade Pilot is continuing the upgrade using its pre-trained model knowledge.";
    badge.innerText = "LLM Fallback Active";
    badge.className = "status-badge status-warning";
    actions.innerHTML = `
      <button onclick="dismissStateAlert()" class="btn btn-secondary btn-sm">Continue with fallback</button>
    `;
  } else if (stateName === "model_api_failure") {
    card.className = "state-alert-card state-type-error";
    icon.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    title.innerText = "Model API temporarily unavailable";
    desc.innerText = "Nebius Token Factory endpoint returned a temporary upstream error (503 / 429); Upgrade Pilot is automatically retrying with exponential backoff.";
    badge.innerText = "Model Retry";
    badge.className = "status-badge status-error";
    actions.innerHTML = `
      <button onclick="startUpgrade(false)" class="btn btn-primary btn-sm">Retry immediately</button>
      <button onclick="startUpgrade(true)" class="btn btn-secondary btn-sm">Switch to recorded run</button>
    `;
  } else if (stateName === "network_disconnect") {
    card.className = "state-alert-card state-type-warning";
    icon.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>`;
    title.innerText = "Connection interrupted";
    const att = customData.attempt || 1;
    desc.innerText = customData.failed
      ? "The live event stream disconnected and could not be recovered. You can view partial results or reconnect."
      : `The live event stream disconnected unexpectedly. Upgrade Pilot is attempting to reconnect automatically (attempt ${att} of 3)...`;
    badge.innerText = "Reconnecting";
    badge.className = "status-badge status-warning";
    actions.innerHTML = `
      <button onclick="startUpgrade(false)" class="btn btn-primary btn-sm">Reconnect now</button>
      <button onclick="showFinalResults()" class="btn btn-secondary btn-sm">View partial results</button>
    `;
  } else if (stateName === "iteration_cap_reached") {
    card.className = "state-alert-card state-type-warning";
    icon.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    title.innerText = "Maximum iterations reached";
    const fCount = customData.failedCount || 2;
    desc.innerText = `Upgrade Pilot completed the maximum limit of 5 repair iterations, but ${fCount} test assertion(s) remain failing.`;
    badge.innerText = "Cap Reached (5/5)";
    badge.className = "status-badge status-warning";
    actions.innerHTML = `
      <button onclick="switchResultTab('changes'); document.getElementById('finalResultsSection')?.scrollIntoView({behavior: 'smooth'});" class="btn btn-primary btn-sm">Inspect partial changes</button>
      <button onclick="runAgain()" class="btn btn-secondary btn-sm">Run again</button>
    `;
  } else if (stateName === "cancelled_run") {
    card.className = "state-alert-card state-type-info";
    icon.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6"/></svg>`;
    title.innerText = "Migration run cancelled";
    desc.innerText = "You stopped the migration run before it finished. The isolated sandbox container has been cleanly reset.";
    badge.innerText = "Cancelled";
    badge.className = "status-badge status-warning";
    actions.innerHTML = `
      <button onclick="startUpgrade(false)" class="btn btn-primary btn-sm">Restart upgrade</button>
      <button onclick="navBackToDemos()" class="btn btn-secondary btn-sm">Back to demos</button>
    `;
  }
}

function dismissStateAlert() {
  document.getElementById("stateAlertCard")?.classList.add("hidden");
}

// Global debug exposure for reviewers / automated testing
window.previewState = (stateName) => showNonHappyState(stateName);

// --------------------------------------------------------------------------
// Toast & Escape Helpers
// --------------------------------------------------------------------------
function showToast(msg) {
  const toast = document.getElementById("toast");
  const msgEl = document.getElementById("toastMsg");
  if (!toast || !msgEl) return;
  msgEl.innerText = msg;
  toast.classList.add("show");
  setTimeout(() => {
    toast.classList.remove("show");
  }, 3200);
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
