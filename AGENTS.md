# Agent Working Rules

**Status: Draft**

## Purpose

This file defines the working contract for coding agents contributing to ACD.

## Authority and scope

- `README.md` is the canonical product vision, principles, roadmap, and phase boundaries.
- `docs/` is the implementation-specification authority.
- `schemas/` contains machine-checkable contracts; keep documentation and schemas synchronized.
- `docs/adr/` records technical decisions. Do not make a durable technology choice only in chat.
- Do not modify `README.md`, `assets/`, or `LICENSE` unless the task explicitly requires it.

## Working rules

1. Read the relevant README section and linked design documents before changing a contract.
2. Record technology choices, data-model changes, storage decisions, and external-boundary changes in an ADR.
3. Mark undecided areas as `未決定` or `Proposed`; never fill them by guessing.
4. Prefer small, focused changes. Preserve existing user changes.
5. Treat the typed design graph as canonical; schematic, KiCad, Gerber, and firmware artifacts are projections or outputs.
6. Keep jidoka behavior: deterministic gates decide, abnormal runs stop and notify, and defective artifacts do not flow downstream.
7. Keep human review optional by default. Require explicit approval IDs for configured approvals, waivers, budget overruns, and irreversible operations.
8. Keep artifact generation pull-based and budget-capped.

## Phase do-not-do list

These boundaries come from README §7:

- **Phase 0 — Data model:** do not build UI, AI, or a custom engine.
- **Phase 1 — Thin vertical slice:** do not build a custom router, WASM engine, knowledge base, firmware package, or automatic ordering.
- **Phase 2 — Verification and rationale:** do not add high-fidelity SI or thermal analysis.
- **Phase 3 — Knowledge loop:** do not implement organization-wide knowledge sharing.
- **Phase 4 — Runtime and browser UX:** do not WASM-ify every engine.
- **Phase 5 — Firmware and virtual hardware:** do not build a proprietary simulator.
- **Phase 6 — Autonomous ordering:** do not target large-scale boards.
- **Phase 7 — Scale and operations:** no additional prohibition is specified; preserve regression gates.
- **Phase 8 — Local manufacturing:** no additional prohibition is specified; preserve printer-profile verification.

## Communication and code quality

- Write code comments, GitHub Issues, and Pull Requests in English.
- Keep user-facing design documentation in Japanese unless the file is explicitly agent-facing.
- Do not commit or push unless the lead explicitly requests it.
- Do not weaken deterministic checks to make an AI-generated artifact pass.

## Validation

Once code exists, deterministic CI should include type checks, tests, JSON Schema validation, Mermaid validation, KiCad re-open/ERC/DRC checks where available, and golden-task regression. Report exact commands and failures; do not claim verification without evidence.
