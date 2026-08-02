# ADR-0011: ルール評価の三値化と有効域

**ステータス：Proposed（未決定）**

## 目的と権威範囲

ルール評価の`pass`／`要詳細解析`／`fail`と、ルールの有効域を表す候補を記録する。
本ADRは提案であり、実装の前提にしてはならない。

## 文脈

表の適用範囲を外れた入力を、単純な合格または不合格として扱うと、必要な解析を
省略する危険がある。現行の`VerificationResult.status`は`passed`、`failed`、`blocked`、
`waived`であり、三値の表示と機械状態の対応が未決定である。設計プロファイルとの
関係は[ADR-0010](0010-design-profile-and-rule-tables.md)の候補に依存する。

## 決定

ルール評価の三値と有効域を、現行のVerificationResult契約と矛盾しない形で表現する
ことを提案する。まだ決定していない。`要詳細解析`は未判定の合格を意味せず、unknown
として停止または広い検証へ進む状態であり、有効域の外で得た結果は流用できない。

## 代替案

- **(a) 既存の`blocked`へ写像する**：Schema変更を避けられるが、要詳細解析とツール停止の
  理由が同じ状態に集約され、表示と再開条件が曖昧になる。
- **(b) 新しいstatus値を追加する**：意味を直接表現できるが、Schema、既存fixture、投影、
  downstream判定の変更が必要になる。
- **(c) statusは二値のまま`finding`側の重大度で表現する**：状態を増やさずに済むが、
  有効域外を合格結果から除外する機械契約が別途必要になる。

## 判断基準

三値から`VerificationResult.status`への写像が決定論的であり、未判定を合格として
下流へ流せないことを確認する。有効域外の入力で結果がstaleまたはblockedとなり、
追加解析のEvidenceと再開条件を参照できるfixtureを作り、再現性、既存statusとの互換性、
下流ゲートの停止動作を評価する。

## 結果とリスク

三値化は、表の適用範囲外を明示的に扱い、必要な解析を促せる。一方、表示上の`要詳細解析`
を実装者が合格と誤読する危険が残るため、下流ゲートの停止条件を優先する。候補フェーズ
はPhase 2（検証と設計根拠）での評価とする提案であり、READMEのフェーズ境界を変更しない。
見直し条件は、有効域外の結果が停止・staleとして機械的に伝播できない場合とする。

## 参照

- [ADR-0010](0010-design-profile-and-rule-tables.md)
- [`../reliability-practices.md`](../reliability-practices.md)
- [`../verification-gates.md`](../verification-gates.md)
- [`../design-graph.md`](../design-graph.md)
