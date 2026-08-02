# ADR-0010: 設計プロファイルとルール表の表現

**ステータス：Proposed（未決定）**

## 目的と権威範囲

ディレーティング基準表、環境プロファイル、設計プロファイルをACDの設計入力として
追跡可能に表現する候補を記録する。本ADRは提案であり、実装の前提にしてはならない。

## 文脈

`hobby`、`small-production`、`high-reliability`等の設計プロファイルは、適用する解析、
ゲート、Evidence要求を変える可能性がある。基準表や環境条件は版を持ち、変更時には
依存する判定をstaleにする必要がある。詳細な背景は
[`../reliability-practices.md`](../reliability-practices.md)を参照する。

## 決定

`Constraint`の属性、独立Entity、外部プロファイル参照のいずれかで表現することを提案
する。まだ決定していない。Phase 0/1の既存Schemaとfixtureで表現できる最小案を先に
評価する。

## 代替案

- **(a) `Constraint`の属性として持つ**：既存Entityで完結するが、基準表と個別制約が
  混在し、属性が肥大化する可能性がある。
- **(b) `DesignProfile`／`RuleTable`等の独立Entityを追加する**：版、差分、参照関係を
  明確にできるが、Schema、投影、移行の追加設計が必要になる。
- **(c) 外部プロファイル参照にする**：fabプロファイルと同じ境界を使えるが、外部内容の
  可用性、hash、版、差分検証を別途保証する必要がある。

## 判断基準

プロファイル自体の版管理、差分検証、変更時のstale伝播を再現可能に判定できること、
`Constraint`が肥大化しないこと、Phase 0/1のfixtureで適用条件とゲート差分を表現できる
ことを基準とする。候補をfixtureに記録し、再生成、影響分析、stale検出のEvidenceで
決定する。

## 結果とリスク

採用案は、設計プロファイルとルール表の変更を設計判断と検証へ結び付けやすくする。
一方、独立Entityを先に仮定するとSchema変更を先取りし、外部参照だけにすると内容を
取得できない場合に判定できない。候補フェーズはPhase 0/1での表現評価とする提案で
あり、READMEのフェーズ境界を変更しない。版、hash、適用域、stale伝播を記録できない
見直し条件は、版、hash、適用域、stale伝播を記録できない場合、またはfixtureで再現
できない場合とする。

## 参照

- [`../reliability-practices.md`](../reliability-practices.md)
- [`../design-graph.md`](../design-graph.md)
- [`../verification-gates.md`](../verification-gates.md)
- [`0008-phase0-provisional-implementation-profile.md`](0008-phase0-provisional-implementation-profile.md)
