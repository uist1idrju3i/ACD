# 設計根拠の構造化記録（Gate 15）

**ステータス：Draft**

## 目的と範囲

[`design-graph.md`](design-graph.md)は`Rationale`を正規Entityとして定義していますが、
Phase 1のfixtureには判断理由が入っていませんでした。本gateは、要求・機能ブロック・
選定部品のそれぞれに構造化されたrationaleが対応していることを決定論的に検査し、
根拠の無い設計判断が下流へ流れないようにします。

rationaleは**判断の説明**であり、**合否のEvidenceではありません**。`origin`が
`llm-proposed`であっても`human`であっても、gateの合否は変わりません。
[`AGENTS.md`](../AGENTS.md)の「AIはproposeし、決定論的gateがdecideする」に従います。

実装は[`../packages/graph-core/src/design-rationale.ts`](../packages/graph-core/src/design-rationale.ts)、
testは[`../packages/graph-core/src/design-rationale.test.ts`](../packages/graph-core/src/design-rationale.test.ts)です。
三値評価の型は[`../packages/graph-core/src/findings.ts`](../packages/graph-core/src/findings.ts)へ
切り出し、Gate 14のelectrical lintと共有しています。

## 入力契約

[`../schemas/phase1-fixture.schema.json`](../schemas/phase1-fixture.schema.json)へ
`rationales`（任意配列）を追加しました。

| フィールド               | 必須 | 意味                                                                     |
| ------------------------ | ---- | ------------------------------------------------------------------------ |
| `id`                     | ○    | `rationale:<slug>`                                                       |
| `origin`                 | ○    | `human`／`deterministic`／`llm-proposed`。合否には影響しない             |
| `decision`               | ○    | 何を達成する判断か                                                       |
| `appliesTo`              | ○    | 対象subject（要求ID、`block:<機能ブロック>`、部品ID）                    |
| `alternativesConsidered` | ○    | 代替案と不採用理由（1件以上）                                            |
| `assumptions`            | ○    | 仮定と`confirmed`／`unconfirmed`、確認済みEvidenceまたはTestItem参照     |
| `evidenceLinks`          |      | gate／測定Evidenceのid。rationale idは指定できない                       |
| `risks`                  |      | 残存リスク、`low`／`medium`／`high`、軽減策                              |
| `tuningNeeded`           | ○    | 実機調整が必要か。WP4のTestItem生成入力になる                            |
| `generatedTestItemIds`   |      | この判断から生成した試験項目                                             |
| `provenance`             | ○    | source、version、license、contentHash（未確定時は`pendingReason`が必須） |

## subjectの定義

coverage対象は次の集合です。いずれも設計判断の結果であり、根拠なしに下流へ流せません。

1. 要求ID（board、供給、予算の前提）
2. 要求が宣言する各機能ブロック（`block:<name>`）
3. 選定した全部品ID

1つのrationaleは複数subjectを`appliesTo`で束ねられます。golden fixtureでは
機能ブロック単位に8件のrationaleを記録しています。

## ルール

| rule ID                           | 判定                                                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `rationale-coverage`              | 各subjectに1件以上のrationaleが対応するか。無ければ`fail`                                                         |
| `rationale-reference-integrity`   | `appliesTo`が既知subjectを指すか。未解決参照は`fail`                                                              |
| `rationale-assumption-verifiable` | `confirmed`はEvidence引用が必要。`unconfirmed`はTestItemか`tuningNeeded`が必要。どちらも欠ける場合は`unknown`     |
| `rationale-not-evidence`          | `evidenceLinks`および仮定のEvidence参照が`rationale:`名前空間を指していないか。参照先が解決するかに関わらず`fail` |

## verdict

[`adr/0011-three-valued-rule-evaluation-and-validity-domain.md`](adr/0011-three-valued-rule-evaluation-and-validity-domain.md)
に従い、Gate 14と同じ集約規則です。

| 条件                       | verdict   | runnerの扱い                |
| -------------------------- | --------- | --------------------------- |
| 全findingが`pass`          | `pass`    | 継続                        |
| `fail`が1件以上            | `fail`    | `verification-failed`で停止 |
| `fail`が0件で`unknown`あり | `blocked` | `verification-failed`で停止 |

`unknown`は「根拠が曖昧なまま通す」ことを避けるための状態です。未確認の仮定は
検証手段（TestItemまたは実機調整）を宣言するまでgateを通しません。

## Evidence

golden runnerはgate 15で次を記録します。

- `verdict`
- `rulesEvaluated`（rule数）
- `subjects`（coverage対象数）
- `findings`（finding数）
- `findingsHash`（finding列のsha256）

## WP4との接続

`assumptions[].testItemId`、`tuningNeeded`、`generatedTestItemIds`は、WP4の
TestItem自動生成の入力です。「この容量は実機で要チューニング」という注記を、
コメントではなく試験項目へ変換する経路を、本gateが型として保証します。
