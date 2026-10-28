# Upgrade Pilot — 2:45 Demo Video Script

> **Video Duration**: Exactly 2 minutes and 45 seconds (165 seconds)  
> **Track**: Nebius x NVIDIA Global AI Hackathon (Coding & Agentic Engineering)  
> **Format**: Screen recording with voiceover narration and webcam picture-in-picture

---

## Video Timeline Breakdown

| Timestamp | Visual Screen Action | Voiceover Narration | Component Highlighted |
|---|---|---|---|
| **0:00 – 0:20** *(20s)* | Split screen showing a terminal with failing pytest tests on Pydantic v2 and an intimidating 40-page migration guide. | *"Every developer knows the pain of major dependency upgrades. You bump Pydantic from v1 to v2 or SQLAlchemy from 1.4 to 2.0, your test suite immediately blows up with attribute errors, and you’re stuck manually refactoring syntax across dozens of files. Meet Upgrade Pilot."* | **The Problem**: Breaking dependency upgrades & technical debt. |
| **0:20 – 0:45** *(25s)* | Browser transitions to Upgrade Pilot dashboard (`localhost:8000`). Clean dark UI, NVIDIA Nemotron badge, demo cards. | *"Upgrade Pilot is an autonomous agentic engineer that turns multi-day library upgrades into a verified, one-click migration. It uses a tri-tier model architecture powered by NVIDIA Nemotron on Nebius Token Factory, grounds its changes in real-time official docs via Tavily, and tests every patch in an isolated offline sandbox."* | **Product Architecture**: Nebius Token Factory, NVIDIA Nemotron, Tavily. |
| **0:45 – 1:10** *(25s)* | Cursor clicks **Pydantic v1 → v2 Migration** card and hits **Run Upgrade Pilot**. Timeline card pops up: `BASELINE_TEST`. | *"Let’s watch it in action with our Pydantic v1 to v2 demo. The moment we start, Upgrade Pilot provisions an isolated sandbox from our local wheelhouse in under one second. It runs pytest on the bumped library and catches the immediate failure: `regex` has been removed from `Field()`. Now, our first model tier takes over."* | **Sandbox & Step 1**: Instant offline venv provisioning & baseline pytest failure capture. |
| **1:10 – 1:30** *(20s)* | Timeline card 2 unfolds: `PLANNING` by **Nemotron 3 Ultra**. Expandable Markdown plan appears. | *"Here is Nemotron 3 Ultra, a 550-billion parameter MoE model accessed via Nebius Token Factory. Ultra reads the full codebase AST and failure traces, formulating an architectural, 6-step migration plan covering ConfigDict, field_validator, and model_dump."* | **Nemotron 3 Ultra**: Migration planning, cross-file AST analysis. |
| **1:30 – 1:50** *(20s)* | Timeline card 3: `RESEARCH`. Tavily query pills appear alongside synthesized 1-sentence rules and source links. | *"Next, we ground the agent in reality so it doesn't hallucinate deprecated syntax. Upgrade Pilot queries Tavily for breaking changelogs, and Nemotron 3 Nano—our ultra-fast 30-billion parameter model—condenses each page into crisp migration rules, complete with clickable source documentation links."* | **Tavily + Nemotron 3 Nano**: Real-time official doc search & low-latency summarization. |
| **1:50 – 2:15** *(25s)* | Timeline card 4: `PATCHING` & `VERIFYING`. Progress bar jumps from 0% to 100% (10/10 tests passing). | *"Now, Nemotron 3 Super—our 120-billion parameter coding model—proposes targeted search-and-replace patches. Our sandbox patcher verifies Python syntax with AST parsing before writing to disk, applies the edits, and re-runs pytest. Notice the progress bar: all 10 tests turn green in a single verified loop!"* | **Nemotron 3 Super & Sandbox**: AST-guaranteed patching & deterministic verification. |
| **2:15 – 2:30** *(15s)* | Screen auto-scrolls to the **Final Results Section**. Interactive unified diff and GitHub PR description. Cursor clicks **Copy PR Summary**. | *"With tests passing, Nemotron 3 Ultra conducts a final diff review for regression risks and writes a complete, production-grade GitHub Pull Request description with breaking changes resolved and cited documentation. One click, and it's copied to your clipboard."* | **Nemotron 3 Ultra**: Final diff review & exportable PR summary generation. |
| **2:30 – 2:45** *(15s)* | Zoom in on the **Live Telemetry & Cost Panel**. Highlight total cost ($0.07) and breakdown for Ultra, Super, and Nano. | *"Look at the live cost meter: Ultra, Super, and Nano completed this entire closed-loop migration for just 7 cents—saving hours of high-priced engineering time. That’s the power of NVIDIA Nemotron on Nebius Token Factory. Try Upgrade Pilot today. Thank you!"* | **Cost Transparency & ROI**: Per-tier token and USD accounting. |

---

## Production & Recording Checklist

- [ ] Browser set to 1080p (1920x1080) at 100% zoom.
- [ ] Dark mode enabled.
- [ ] Ensure local server is running (`uvicorn upgrade_pilot.main:app`).
- [ ] Click through:
  1. Card selection
  2. "Run Upgrade Pilot" button
  3. Expand plan accordion
  4. Hover on Tavily source links
  5. Expand patch diff
  6. Highlight cost meter ($0.07)
  7. Click "Copy PR Summary" button (showing green checkmark toast)
