# ADR（Architecture Decision Record）

**ステータス：Draft**

## 目的と権威範囲

ADRはACDの技術選定を、理由・代替案・前提・結果とともに追記専用で記録します。READMEのビジョンを実装へ翻訳する判断を対象とし、会話だけで決めません。

## 状態

- **Proposed**：提案中。実装の前提にしてはいけない。
- **Accepted**：採用済み。実装契約の一部。
- **Superseded**：後続ADRに置き換えられた。
- **Rejected**：検討したが採用しない。

## ルール

1. 技術選択、永続化、外部境界、互換性に影響する判断はADRを作る。
2. 代替案、判断基準、リスク、撤回条件を記録する。
3. 未決定事項を推測で埋めない。
4. ADRを変更する代わりに、後続ADRで置換理由を記録する。

## 一覧

- [`0000-template.md`](0000-template.md)
- [`0001-record-decisions-as-adrs.md`](0001-record-decisions-as-adrs.md)
- [`0002-typed-design-graph.md`](0002-typed-design-graph.md)
- [`0003-deterministic-tools-first.md`](0003-deterministic-tools-first.md)
- [`0004-browser-first-optional-workers.md`](0004-browser-first-optional-workers.md)
- [`0005-byok-self-hosted-llm.md`](0005-byok-self-hosted-llm.md)
- [`0006-implementation-language-storage.md`](0006-implementation-language-storage.md)
- [`0007-kicad-minimum-version.md`](0007-kicad-minimum-version.md)
- [`0008-phase0-provisional-implementation-profile.md`](0008-phase0-provisional-implementation-profile.md)
- [`0009-provisional-kicad-ci-baseline.md`](0009-provisional-kicad-ci-baseline.md)
- [`0010-design-profile-and-rule-tables.md`](0010-design-profile-and-rule-tables.md)
- [`0011-three-valued-rule-evaluation-and-validity-domain.md`](0011-three-valued-rule-evaluation-and-validity-domain.md)
- [`0012-assumptions-as-first-class.md`](0012-assumptions-as-first-class.md)
- [`0013-agent-and-tool-qualification-records.md`](0013-agent-and-tool-qualification-records.md)
- [`0014-as-built-reconciliation.md`](0014-as-built-reconciliation.md)
- [`0015-structural-safety-checks-placement.md`](0015-structural-safety-checks-placement.md)
- [`0016-worst-case-analysis-fidelity.md`](0016-worst-case-analysis-fidelity.md)
- [`0017-open-review-findings-queue.md`](0017-open-review-findings-queue.md)
- [`0018-golden-routing-technology.md`](0018-golden-routing-technology.md)
- [`0019-repair-loop-llm-proposal-with-deterministic-validation.md`](0019-repair-loop-llm-proposal-with-deterministic-validation.md)
- [`0020-spice-engine-ngspice-external-process.md`](0020-spice-engine-ngspice-external-process.md)
- [`0021-fab-feedback-intake-source.md`](0021-fab-feedback-intake-source.md)
- [`0022-knowledge-scope-promotion-approval-boundary.md`](0022-knowledge-scope-promotion-approval-boundary.md)
- [`0023-library-versioning-official-snapshot-overlay-patch.md`](0023-library-versioning-official-snapshot-overlay-patch.md)
- [`0024-long-running-run-ownership-and-persistence.md`](0024-long-running-run-ownership-and-persistence.md)
- [`0025-checkpoint-granularity-and-invalidation.md`](0025-checkpoint-granularity-and-invalidation.md)
- [`0026-fast-check-wasm-scope-and-language.md`](0026-fast-check-wasm-scope-and-language.md)
- [`0027-browser-ui-scope-and-technology.md`](0027-browser-ui-scope-and-technology.md)
- [`0028-phase5-roadmap-revision.md`](0028-phase5-roadmap-revision.md)
- [`0029-jsonl-durability-and-recovery-semantics.md`](0029-jsonl-durability-and-recovery-semantics.md)
- [`0030-wasm-rust-fixed-point-supplement.md`](0030-wasm-rust-fixed-point-supplement.md)
- [`0031-browser-ui-canvas2d-sse-supplement.md`](0031-browser-ui-canvas2d-sse-supplement.md)
- [`0032-deterministic-specctra-ses-projection.md`](0032-deterministic-specctra-ses-projection.md)
- [`0033-typed-tool-envelope-and-runtime-idempotency.md`](0033-typed-tool-envelope-and-runtime-idempotency.md)
