# Gate matrix（全Phase）

**ステータス：Draft**

## 目的

このドキュメントは、実行順に並べた全Phaseのgate matrixです。Phase 1のgate契約と実機
Evidence契約は[`phase1-gates.md`](phase1-gates.md)、Phase 2の実装計画は
[`phase2-plan.md`](phase2-plan.md)が権威です。

gate契約の正は[`../schemas/gate-matrix.json`](../schemas/gate-matrix.json)であり、構造は
[`../schemas/gate-matrix.schema.json`](../schemas/gate-matrix.schema.json)で検証します。
以下の表は`pnpm gates:generate`が同dataから生成し、`pnpm gates:check`と
`pnpm schema:validate`が同期を検査します。表を直接編集しないでください。

## 順序とrunsAfter

`順序`列はgate番号で、Evidenceとドキュメントの安定した識別子です。後続Phaseがgateを
追加する場合は既存番号を振り直さず、`runsAfter`で実行位置だけを指定します。表は
`runsAfter`を解決した実行順に並びます。

<!-- generated:gate-matrix:start -->

| 順序 | Gate                            | Phase | 状態          | 適用          | 入力                                                                                | 合格条件                                                                                                                           | 不合格時                                                                                             |
| ---- | ------------------------------- | ----- | ------------- | ------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1    | Fixture/schema                  | 1     | implemented   | smoke／golden | Requirement fixture、typed Phase 1 schema                                           | Schema valid、全参照解決、MPN/AVLとmappingが存在                                                                                   | `schema-invalid`／`reference-integrity`で停止                                                        |
| 2    | Graph semantic                  | 1     | implemented   | smoke／golden | graph snapshot                                                                      | ID重複なし、revision整合、Component/Pin/Net参照整合                                                                                | `reference-integrity`／`revision-invalid`で停止                                                      |
| 3    | Component selection             | 1     | implemented   | smoke／golden | fixture Part/AVL                                                                    | 選択Partがfixture許可範囲、数量・package・lifecycle・provenanceが確定                                                              | 未確定Partを下流へ流さず停止                                                                         |
| 4    | Placement                       | 1     | implemented   | smoke／golden | outline、keepout、placement constraints                                             | deterministic座標、outline・穴・高さ・keepout違反なし                                                                              | `verification-failed`で停止                                                                          |
| 5    | Netlist consistency             | 1     | implemented   | smoke／golden | graph Component/Pin/Net                                                             | graph canonical netlistと投影前のcanonical netlistが一致                                                                           | 接続差分、pin/pad ambiguityで停止                                                                    |
| 14   | Electrical topology lint        | 2     | implemented   | golden        | Typed fixture（part parameters、net role／nominal voltage）                         | 全ruleがpass。failは0件、unknownも0件（unknownは検証を広げるためblocked扱い）                                                      | `verification-failed`で停止し、rule ID・対象・期待値・実測値・根拠を記録                             |
| 15   | Design rationale coverage       | 2     | implemented   | golden        | Typed fixtureのrationale（決定、代替案、仮定、リスク、出所）と要求・部品            | 要求・機能ブロック・全部品にrationaleが対応し、参照が解決し、仮定に検証手段があり、rationaleがEvidenceとして引用されていない       | `verification-failed`で停止し、未記録の判断・未解決参照・未検証の仮定を記録                          |
| 16   | Test item generation            | 2     | implemented   | golden        | 要求のacceptance criteria、電気parameter、net宣言、lint rule、rationaleの未確認仮定 | 全acceptance criteriaに検証方法が割り当たり、rationaleが宣言したTestItemが生成され、各TestItemの方法・条件・合格基準が解決している | `verification-failed`で停止し、未検証の要求・未生成のTestItem・未解決の合格基準を記録                |
| 17   | Fault injection and repair loop | 2     | implemented   | golden        | 注入した設計欠陥のcase、記録済み修復提案（hash固定）、Gate 14〜16のrule             | 各caseで欠陥が期待rule IDで検出され、決定論的gateが受理したpatchだけで全findingが解消し、反復上限内で収束する                      | `verification-failed`で停止し、収束しないcase・未解消のfinding・却下理由を記録                       |
| 18   | Nominal SPICE analysis          | 2     | implemented   | golden        | typed fixtureから導出したnominal解析deck、固定digest containerのngspice             | 全解析が収束し、測定値が期待範囲に入り、モデルの出所とライセンスが記録されている（unknownはblocked）                               | `verification-failed`で停止。収束失敗は`convergence-failure`、tool異常終了は`tool-failure`として記録 |
| 6    | KiCad projection/reopen         | 1     | implemented   | smoke／golden | schematic、PCB、library manifest                                                    | 固定containerで再オープン、symbol/pad/netが読戻し可能                                                                              | `reopen-failure`で停止                                                                               |
| 7    | Netlist readback                | 1     | implemented   | smoke／golden | KiCad schematic netlist、PCB pad table                                              | reference、pin、pad、net接続集合がgraphと完全一致                                                                                  | `verification-failed`で停止                                                                          |
| 8    | ERC/topology                    | 1     | implemented   | smoke／golden | KiCad schematic、graph rules                                                        | ERC errors=0、許容warningは明示waiverのみ                                                                                          | 下流へ流さず停止                                                                                     |
| 9    | Routing                         | 1     | implemented   | smoke／golden | PCB、routing profile                                                                | **unrouted=0**、ratsnestなし、同一入力でdeterministic                                                                              | `convergence-failure`／`verification-failed`で停止                                                   |
| 10   | DRC/DFM                         | 1     | implemented   | smoke／golden | routed PCB、fab profile                                                             | DRC violations=0、unconnected=0、fab critical/high=0                                                                               | 下流へ流さず停止                                                                                     |
| 11   | Manufacturing outputs           | 1     | implemented   | smoke／golden | Gerber、drill、BOM、必要なpick-and-place                                            | 再読込可能、層／部品／net数とrevision/hashが一致                                                                                   | `verification-failed`で停止                                                                          |
| 12   | Pre-order readiness             | 1     | implemented   | golden        | 全artifact、BOM、cost、availability                                                 | 人手発注に必要な情報が揃い、未解決order-relevant unknownなし                                                                       | 発注準備を停止                                                                                       |
| 13   | Physical completion             | 1     | contract-only | golden        | 実機測定Evidence                                                                    | golden taskのTestItemが条件・基準付きでpass                                                                                        | 後続継続を停止／再設計                                                                               |

<!-- generated:gate-matrix:end -->

## 関連文書

- [`phase1-gates.md`](phase1-gates.md)
- [`phase2-plan.md`](phase2-plan.md)
- [`verification-gates.md`](verification-gates.md)
- [`error-taxonomy.md`](error-taxonomy.md)
