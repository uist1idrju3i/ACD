# ADR-0012: 前提条件の一級要素化

**ステータス：Proposed（未決定）**

## 目的と権威範囲

設計判断に使った前提条件の所有者、期限、解消Evidence、影響を追跡可能にする候補を
記録する。本ADRは提案であり、実装の前提にしてはならない。

## 文脈

現在は`uncertainty`の`state`、`description`、`resolution`、`impactScope`、`dueAt`と
`Rationale`に前提が分散している。前提の所有者やクローズ条件が構造化されていないため、
期限切れや前提の撤回が設計判断へ伝播したことを確認しにくい。

## 決定

前提条件を設計判断と検証へ結び付ける一級の記録として扱う方法を提案する。まだ決定
していない。独立Entityを仮定せず、現行Schemaで所有者、期限、クローズEvidence、影響を
追跡できる最小表現から評価する。

## 代替案

- **(a) `Rationale.assumptions`を拡張する**：既存の設計根拠に近いが、前提単体の期限、
  owner、影響伝播を扱いにくい。
- **(b) 独立Entityを追加する**：ライフサイクルと参照を明確にできるが、新Entity、Schema、
  投影、移行の設計が必要になる。
- **(c) 現行`uncertainty`の運用規則だけで足りるとする**：Schema変更を避けられるが、
  所有者、クローズEvidence、判断への参照を機械的に強制しにくい。

## 判断基準

期限切れ前提が停止条件になること、クローズEvidenceを参照できること、前提の変更が
依存する判断とVerificationResultへ伝播することを確認する。前提を含むfixtureで期限、
owner、解消Evidence、影響範囲を再生し、未解消のまま下流へ流れないことをEvidenceで
評価する。

## 結果とリスク

前提を明示すれば、暗黙の仮定による再利用と検証漏れを減らせる。一方、前提を増やし
すぎると記録負荷と停止件数が増える。候補フェーズはPhase 2（検証と設計根拠）での
評価とする提案であり、READMEのフェーズ境界を変更しない。owner、期限、クローズEvidence、
見直し条件は、owner、期限、クローズEvidence、影響伝播を再現できない場合とする。

## 参照

- [`../reliability-practices.md`](../reliability-practices.md)
- [`../design-graph.md`](../design-graph.md)
- [`../knowledge-base.md`](../knowledge-base.md)
