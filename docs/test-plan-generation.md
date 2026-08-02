# テスト項目の自動生成（Gate 16）

**ステータス：Draft**

## 目的と範囲

READMEのPhase 2完了条件は「検証gateで検出・修復され、**テスト項目リストが出力される**」
ことです。本gateは、typed fixtureから`TestItem`リストを決定論的に生成し、
検証方法が割り当てられていない要求を未検証として停止させます。

生成物は正規設計グラフではなく、対象revisionと入力から再生成できる投影です。
golden runは`artifacts/phase1-golden/test-plan.json`として出力します。

実装は[`../packages/graph-core/src/test-items.ts`](../packages/graph-core/src/test-items.ts)、
testは[`../packages/graph-core/src/test-items.test.ts`](../packages/graph-core/src/test-items.test.ts)です。

## TestItemの形

| フィールド   | 意味                                                                       |
| ------------ | -------------------------------------------------------------------------- |
| `id`         | `test:<slug>`。rationaleが宣言した`testItemId`はそのまま採用する           |
| `title`      | 何を確認するか                                                             |
| `subject`    | 対象entity（要求、net、部品、fixture）                                     |
| `method`     | `inspection`／`analysis`／`measurement`                                    |
| `conditions` | 測定・確認条件                                                             |
| `expected`   | 合格基準。数値が導出できない場合は`unknown:`で始まる文字列                 |
| `verifiedBy` | 判定するgate。measurementは`gate:physical-completion`（Gate 13）へ接続する |
| `sources`    | 生成元（acceptance criterion、rule ID、rationale ID、部品ID）              |

## 生成元

| 生成元                          | 生成されるitem                                                  |
| ------------------------------- | --------------------------------------------------------------- |
| 要求のacceptance criteria       | `acceptanceVerifiedBy`がgateを宣言した項目のみ`inspection` item |
| 要求の`electrical.maxCurrentMa` | 総供給電流のmeasurement item                                    |
| `nets[].nominalVoltageV`        | rail電圧のmeasurement item（±5 %）                              |
| LEDと直列抵抗のtopology         | 順電流のmeasurement item（±20 %かつ定格内）                     |
| regulatorの`outputVoltageV`     | 負荷時出力電圧のmeasurement item（±3 %）                        |
| Gate 14の各lint rule            | `analysis` item（`gate:electrical-lint`が判定）                 |
| rationaleの`unconfirmed`な仮定  | measurement item。`tuningNeeded`なら調整を許す条件で生成        |

LED電流はGate 14と同じtopology trace（`ledBranchCurrents`）から導出します。lintの判定と
テスト項目の期待値が別実装で乖離しないようにするためです。

acceptance criterionの検証方法は要求側が`acceptanceVerifiedBy`（criterionとindex整合）で
宣言します。生成器が自分で作ったitemをcoverageの証拠にすると、計画が自身の網羅性を
証明してしまうためです。未宣言のcriterionは`unknown`として検証を広げます。

## ルールとverdict

| rule ID                          | 判定                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `test-item-requirement-coverage` | acceptance criterionが`acceptanceVerifiedBy`でgateまたはtest itemを宣言しているか。未宣言は`unknown`、解決できない宣言は`fail`        |
| `test-item-assumption-coverage`  | `unconfirmed`な仮定が生成済みtest itemを名指ししているか、`confirmed`な仮定がrationale以外のevidenceを持つか。満たさなければ`unknown` |
| `test-item-completeness`         | 合格基準が解決したか。導出不能なら`unknown`                                                                                           |
| `test-item-unique-id`            | idが一意か。重複は`fail`                                                                                                              |

集約はGate 14／15と同じで、`fail`があれば`fail`、無くても`unknown`があれば`blocked`です。
いずれも`verification-failed`で停止します。

## Evidence

- `verdict`
- `rulesEvaluated`
- `testItems`（生成数）
- `measurementItems`（実機測定が必要な数）
- `testPlanHash`（item列のsha256）
- `artifact`（`test-plan.json`）

## Gate 13との接続

`measurement` itemの`verifiedBy`は`gate:physical-completion`です。Gate 13は
[`phase1-gates.md`](phase1-gates.md)のEvidence契約（条件、測定器、期待範囲、観測値、判定、
revision／artifact参照）を要求します。本gateはそのTestItem側の入力を生成するところまでを
担当し、pending／simulated evidenceを合格として扱いません。
