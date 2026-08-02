# ACD 設計ドキュメント

**ステータス：Draft**

## 目的

このディレクトリは、ACDの実装に必要なアーキテクチャ、データモデル、パイプライン、検証、運用契約を定義します。ACDのビジョン、設計原則、ロードマップはリポジトリ直下の [`README.md`](../README.md) が権威です。

- `README.md`：プロダクトビジョンと、何を作るかの権威
- `docs/`：どのように実装するかの権威
- `schemas/`：機械検証可能な契約の権威
- `docs/adr/`：技術的な意思決定の履歴

未決定事項は推測で埋めず、`未決定` と記載してADRで決めます。

## 推奨読順

1. [`../README.md`](../README.md) — ビジョン、6ステップ、ロードマップ
2. [`architecture.md`](architecture.md) — 実行形態とシステム境界
3. [`design-graph.md`](design-graph.md) — 正規データモデル
4. [`pipeline.md`](pipeline.md) — 6ステップの状態遷移
5. [`verification-gates.md`](verification-gates.md) — 決定論的な合否判定
6. [`reliability-practices.md`](reliability-practices.md) — 信頼性・安全性設計プラクティス
7. [`agent-runtime.md`](agent-runtime.md) — 長時間実行ハーネス
8. [`knowledge-base.md`](knowledge-base.md) — 知識の蓄積と書き戻し
9. [`qc-tools.md`](qc-tools.md) — QC七つ道具・新QC七つ道具の生成分析
10. [`phase0-plan.md`](phase0-plan.md)、[`patch-revision.md`](patch-revision.md)、
    [`event-log.md`](event-log.md) — Phase 0実装計画と状態契約
11. [`phase1-gates.md`](phase1-gates.md)、[`phase1-plan.md`](phase1-plan.md)、
    [`kicad-ci-profile.md`](kicad-ci-profile.md)、[`golden-tasks.md`](golden-tasks.md)、
    [`../schemas/phase1-fixture.schema.json`](../schemas/phase1-fixture.schema.json) —
    Phase 1受入gate、完了計画、KiCad、fixture契約
12. [`phase2-plan.md`](phase2-plan.md)、[`../schemas/gate-matrix.json`](../schemas/gate-matrix.json) —
    Phase 2実装計画と、machine-readableなgate契約
13. [`error-taxonomy.md`](error-taxonomy.md) — エラー分類
14. [`repo-structure.md`](repo-structure.md)、[`tool-contract.md`](tool-contract.md)、
    [`dependency-inventory.md`](dependency-inventory.md)、[`kicad-interop.md`](kicad-interop.md)、
    [`testing.md`](testing.md) — 構成、ツール境界、依存関係、外部連携、評価
15. [`adr/README.md`](adr/README.md) — ADR運用と既存の設計判断

## ステータス凡例

| 表記       | 意味                                                    |
| ---------- | ------------------------------------------------------- |
| **Draft**  | 実装前の契約案。ADR、実装、実機評価によって変更され得る |
| **Stable** | 実装と検証で契約が確認され、変更に互換性の検討が必要    |

## 権威の範囲

権威の順序は、**README.md（ビジョン・原則・ロードマップ） > `docs/`（実装仕様） > `schemas/`（機械検証可能な契約）**です。ADRはこの判断を置き換えるものではなく、技術的な選択と変更理由を記録します。矛盾がある場合、ビジョンと優先順位についてはREADMEを優先し、実装契約についてはADRで記録して解消します。READMEを変更せずに、このドキュメントだけでビジョンを拡張してはいけません。
