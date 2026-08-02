# Agent Working Rules

**Status: Draft**

## Purpose

This file is the agent-facing working contract for ACD. Normative terms **MUST**,
**MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are intentional. When a task
or a later accepted ADR is more specific, follow the more specific contract and
record the resulting scope.

## Authority and language

- `README.md` is the canonical authority for product vision, principles, roadmap,
  and phase boundaries.
- `docs/` is the implementation-specification authority.
- `schemas/` contains machine-checkable contracts. Documentation and schemas MUST
  remain synchronized; do not silently change one to compensate for the other.
- `docs/adr/` records durable technical decisions. A durable technology, storage,
  data-model, license-boundary, or external-integration choice MUST NOT be made only
  in chat.
- Shape and validation rules are authoritative in Schema; operational semantics,
  lifecycle, and gate behavior are authoritative in `docs/`. A conflict MUST be
  reported and resolved explicitly.
- This project is conducted in Japanese. `README.md`, `docs/`, ADRs, GitHub Issues,
  and Pull Requests MUST be written in Japanese. Source-code comments and
  identifiers MUST remain in English. This file is agent-facing and MUST remain in
  English.
- Agents MUST read the relevant README sections, linked specifications, Schema,
  ADRs, and existing tests/fixtures before changing a contract.
- Do not modify `README.md`, `assets/`, or `LICENSE` unless the task explicitly
  requires it.

## Product and safety invariants

- The typed, versioned design graph is canonical. Schematic, KiCad, Gerber,
  firmware, MCAD, and manufacturing files are projections or outputs.
- AI MAY propose; deterministic tools and gates decide. LLM explanations, visual
  similarity, or generated text MUST NOT be treated as pass evidence.
- Jidoka is mandatory: abnormal runs MUST stop and notify; defective, stale, or
  unverified artifacts MUST NOT flow downstream.
- Human review is optional by default, but configured approvals and explicit
  waivers remain enforceable.
- Artifact generation is pull-based and MUST be revision- and input-hash-aware.
- Total order cost includes board fabrication, components, assembly, shipping, taxes,
  and enclosure/mechanical parts. An order MAY execute without an approval ID only
  when the pre-order final gate passes and total cost is within the configured cap.
  Budget overruns, waivers, configured approval gates, and other irreversible
  operations MUST require an explicit approval ID.
- Unknown impact MUST widen verification, never narrow or skip it.

## Phase boundaries

These boundaries come from README §7 and the detailed Phase 0 plan:

- **Phase 0 — Data model:** MUST NOT build UI, AI, or a custom engine.
- **Phase 1 — Thin vertical slice:** MUST NOT build a custom router, WASM engine,
  knowledge base, `FirmwarePackage`, or automatic ordering. Target-state Step 4
  firmware output is excluded from Phase 1 acceptance and output verification; it
  becomes active in Phase 5.
- **Phase 2 — Verification and rationale:** MUST NOT add high-fidelity SI or thermal
  analysis.
- **Phase 3 — Knowledge loop:** MUST NOT implement organization-wide knowledge
  sharing.
- **Phase 4 — Runtime and browser UX:** MUST NOT WASM-ify every engine.
- **Phase 5 — Firmware and virtual hardware:** MUST NOT build a proprietary simulator.
- **Phase 6 — Autonomous ordering:** MUST NOT target large-scale boards.
- **Phase 7 — Scale and operations:** preserve all regression and audit gates.
- **Phase 8 — Local manufacturing:** preserve printer/manufacturing-profile
  verification.

Phase 0 uses the reversible provisional profile in
[`docs/adr/0008-phase0-provisional-implementation-profile.md`](docs/adr/0008-phase0-provisional-implementation-profile.md).
Phase 0/1 KiCad CI uses the provisional profile in
[`docs/adr/0009-provisional-kicad-ci-baseline.md`](docs/adr/0009-provisional-kicad-ci-baseline.md).
Neither ADR closes the final decisions in ADR-0006 or ADR-0007.

## Source decomposition

- Large projects MUST be split into cohesive packages/modules at responsibility
  boundaries. Follow [`docs/repo-structure.md`](docs/repo-structure.md).
- Each package/module SHOULD have one primary responsibility and an explicit,
  minimal public API. Split when a second responsibility, independent change
  cadence, distinct dependency boundary, or independent test seam appears; do not
  split solely by line count or create trivial wrappers.
- Dependency direction MUST remain `schema ← graph-core ← adapters/* ← apps/workers`.
  Core MUST NOT import KiCad, browser APIs, filesystem details, network clients, or
  UI state. Cycles and deep imports into another package's internals are forbidden.
- External processes, clocks, randomness, filesystem, and network MUST cross
  explicit ports/interfaces so deterministic tests can replace them.
- New tool boundaries MUST follow [`docs/tool-contract.md`](docs/tool-contract.md);
  error behavior MUST follow [`docs/error-taxonomy.md`](docs/error-taxonomy.md).

## Determinism and jidoka stop conditions

- A gate MUST record tool name/version, input conditions, input hash, model/material
  provenance, revision, output hash, convergence/status, and uncertainty where
  applicable.
- A run MUST stop on schema-invalid input, reference-integrity failure, patch
  conflict, revision/event replay mismatch, stale result, failed ERC/DRC/DFM,
  tool timeout after its retry budget, convergence failure, license restriction,
  credible patent concern, missing required approval, or budget overrun.
- Retrying MUST be bounded, use the same input hash and idempotency key, and MUST
  not duplicate a side effect.
- An agent MUST preserve failure evidence and report the exact command, code,
  stderr/stdout, recovery condition, and whether the failure is pre-existing.

## OSS license compliance

- Before adding any dependency, tool, engine, model, library, generated code, or
  asset, agents MUST verify its license and record the SPDX identifier, source URL,
  version/commit, and intended use in the project license inventory or relevant ADR.
- Agents MUST check the full dependency tree, not only the top-level package.
  CI SHOULD generate an SBOM and license inventory when code lands; a missing or
  ambiguous license is a stop condition.
- Copyleft boundaries MUST be explicit. GPL/AGPL code MUST NOT be linked into a
  proprietary-compatible in-process module without legal approval. External-process
  invocation (for example KiCad, freerouting, or ngspice) MAY be used only when the
  resulting distribution, source, notices, and runtime boundary comply with the
  applicable license; process isolation is not an automatic license exemption.
- External code MUST NOT be copied, translated, or substantially derived into ACD
  before its license and attribution requirements are checked. Attribution belongs
  in the files or package that actually contain derived code, not as unrelated
  blanket credit.
- `NOTICE`, `LICENSE`, package attributions, source offers, and corresponding-source
  obligations MUST be maintained when applicable.
- License-restricted binaries and models MUST NOT be redistributed. LTspice,
  QSPICE, vendor `.lib` files, and similarly restricted models are user-installed
  external tools or inputs; import only license-compliant metadata/results as
  Evidence.
- A dependency or model with terms incompatible with the intended distribution MUST
  be rejected or isolated pending a documented decision. Never hide it by vendoring,
  renaming, minifying, or downloading it at build time.

## Patent caution

- EDA and manufacturing algorithms MAY be patented, including autorouting, DRC/DFM,
  SI/PI, thermal, and structural-electronics processes.
- Prefer published, expired, openly licensed, or existing OSS algorithms and engines.
  When implementing a non-trivial algorithm based on a paper, product, patent,
  benchmark, or vendor behavior, record provenance and the implementation boundary.
- A credible patent concern MUST trigger jidoka: stop implementation or release,
  preserve the evidence, and escalate for the user's legal decision. Do not make
  unsupported freedom-to-operate claims.
- ACD documentation MUST NOT claim that ACD grants freedom to operate. Commercial
  use, patent clearance, and legal review remain the user's responsibility.

## Change, Git, and PR rules

- Prefer minimal, focused edits and preserve unrelated user changes. Never use
  `git add .`; stage explicit paths and never stage secrets or credentials.
- Before editing, agents MUST inspect the branch, worktree, relevant diff, and
  existing user changes. Before committing, agents MUST review the staged paths,
  `git diff --cached --check`, and the contract impact. Unrelated changes MUST be
  left unstaged.
- Never run destructive commands such as `reset --hard`, `clean -fd`, checkout of
  user files, or stash deletion. Never use `--no-verify`, amend commits, force-push,
  or push directly to `main`/`master`.
- Ordinary implementation handoffs MUST leave commits and pushes to the lead unless
  explicitly requested. When a user explicitly requests staged commits/pushes,
  commit each requested stage with a clear English message, verify the diff, and
  push only the checked-out feature branch.
- PRs and Issues MUST be in Japanese and include scope, changed contracts, tests,
  license/provenance notes, known risks, and unresolved decisions. Agents MUST NOT
  create or update PRs unless explicitly authorized.
- Do not weaken tests, gates, license checks, or approval rules to make generated
  output pass.
- If a requirement conflicts with an ADR, license, patent concern, phase boundary,
  or safety invariant, agents MUST stop at that boundary, preserve evidence, and
  escalate with a decision-ready explanation rather than silently choosing.

## Validation contract

Once code exists, the repository MUST provide or document equivalent commands for:

```sh
pnpm typecheck
pnpm test
pnpm lint
pnpm schema:validate
pnpm schema:generate
pnpm golden
```

Documentation-only changes MUST at least run relative-link/anchor checks,
`git diff --check`, and Mermaid validation for touched diagrams. Code changes MUST
also run typecheck, tests, lint, Schema validation, and relevant golden tasks.
KiCad changes MUST run the fixed CI profile's capability probe, reopen, ERC/DRC,
and artifact checks where available. Reports MUST contain exact commands and
evidence; never claim a check was run when it was not.

## Related contracts

- [`CONTRIBUTING.md`](CONTRIBUTING.md)
- [`docs/phase0-plan.md`](docs/phase0-plan.md)
- [`docs/repo-structure.md`](docs/repo-structure.md)
- [`docs/tool-contract.md`](docs/tool-contract.md)
- [`docs/error-taxonomy.md`](docs/error-taxonomy.md)
- [`docs/adr/README.md`](docs/adr/README.md)
