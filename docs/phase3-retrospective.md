# Phase 3 振り返り

## 完了条件に対する結果

Phase 3の完了条件は、1次試作で受けたDFM指摘とフットプリント修正が、2次試作の
設計で自動的に回避されることです。この条件は、fixtureで再現可能な範囲について
達成しました。

対象は次のUSB-C footprintです。

```text
Connector_USB:USB_C_Receptacle_GCT_USB4135-GF-A_6P_TopMnt_Horizontal
```

公式snapshotを使ったcontrol runでは、隣接pad間の最小mask sliverが
`0.29000000000000004mm`でした。fab profileの最小値`0.3mm`に対して違反し、
`mask-sliver-min` findingは1件でした。

採用済みKnowledgeItemから生成したoverlayを使ったknowledge-enabled runでは、
`solder_mask_margin = -0.02mm`を実geometryへmaterializeしました。最小mask sliverは
`0.33000000000000007mm`となり、違反はなく、findingは0件でした。判定はmarkerではなく、
投影されたKiCad pad geometryの再計算、reopen、DRC Evidenceに基づきます。

## Gate 22の適用証拠

`artifacts/phase1-golden/knowledge-application.json`には、次の決定が記録されています。

- `knowledge:fab-report:prototype-1-jlcpcb-001:JLC-DFM-001:r2`
  - `applied: true`
  - `applicability: pass`
  - `libraryRevision: library:overlay:b5856b8ee9f5e3fbc7c2cb1a31fa188fc8632b9aa43b1d238d53689514d0722e`
- `knowledge:fab-report:prototype-1-jlcpcb-001:JLC-DFM-002:r2`
  - `applied: false`
  - `applicationExemption: no-correction-required`
- `knowledge:fab-report:prototype-1-jlcpcb-001:JLC-DFM-003:r2`
  - `applied: false`
  - `applicationExemption: no-correction-required`

`libraryRevisions`にはoverlay revisionが1件記録され、KnowledgeItem → library revision →
projected artifactの追跡が成立しています。`knowledge.applied`はfab feedbackとlifecycle
eventと同じappend-only event logへ追記され、target revisionとイベントrevisionを保持します。

## レビューで確定した設計判断

### unknownは合格ではなく停止

unknownは適用条件を満たしたことを意味しません。Gate 19では`fab-feedback.json`を
Evidenceとして先に保存し、unknown verdictを`fab-feedback-unknown`で停止します。
「検証範囲を広げる」は停止後に必要な検証範囲を示すものであり、green gateを許可する
ものではありません。

### source findingをtargetの事実にしない

次設計のcontextはtarget fixtureが宣言する値からだけ構成します。source reportのrule ID、
classification、part IDなどを、targetが宣言していないのに推測して補完しません。列挙できない
次元は省略して`unknown`へ広げます。

### exemptionはversioned rule-table data

KnowledgeItemが適用可能なのに correction mechanism がない場合、runnerの都合で適用済みと
扱いません。rule tableが宣言した`applicationExemption`だけを明示的な免除として認め、
correctionも免除もない場合は停止します。

### overlay correctionは実geometryへmaterializeする

overlay markerだけではKiCadが使用するgeometryを変えません。library patchは対象footprint
全instanceの`solder_mask_margin`を実boardへ反映し、Gate 21が再読込後のpad geometryを
確認します。公式snapshotは不変のまま保持します。

## 実装過程で判明した構造的な欠陥と再発防止

- `scripts/*.mts`がどのtsconfig projectにも含まれておらず、`compareIds`の未importが
  `pnpm typecheck`の対象外となってCIをすり抜けた。`tsconfig.scripts.json`を追加し、
  rootのtypecheckへ含めた。
- 完了条件の判定がACD自身のoverlay markerの有無を見る循環になっていた。投影後のKiCad
  pad geometryを再計算して判定し、reopen／DRC Evidenceで裏付ける方式へ変更した。
- jidokaチェックの適用対象を停止条件と同じ述語から導出しており、原理的に発火しなかった。
  artifactでoverlay library revisionを裏付けられる知識だけを`applied`として記録し、
  失敗経路の回帰テストを追加した。
- footprint識別子の形式差（library修飾名とbare名）により、知識が非該当と誤判定されていた。
  識別子生成を共通化した。
- board上のmatching footprint instanceを1件しか検証していなかった。
  `parseAllFootprintSources`で全instanceを検証するよう変更した。
- 「指摘なし」を表す`rawFindings: []`がschemaの`minItems: 1`に反し、runtime castで
  回避されていた。schemaで空配列を明示的に許可し、intake前のschema検証を必須化した。

CIが検査していない領域は、検査されていないのと同じである。

## Phase 4へ持ち越す既知のギャップ

controlとknowledge-enabledの比較は、独立した第三者検証ではなく、同一の決定論的測定器を
両runへ適用した対照実験である。

| 残債                                                                                                                                                                           | 処置先                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 実fab reportではなく、実fab形式を模したfixtureを入力にしている                                                                                                                 | 実fab adapterはPhase 4受入対象外のPhase 3残債。[`phase4-plan.md#wp9phase-3残債phase-4受入対象外`](phase4-plan.md#wp9phase-3残債phase-4受入対象外)で独立契約として扱い、入力源の判断は[`ADR-0021`](adr/0021-fab-feedback-intake-source.md)で管理する |
| live sourcing APIやオンラインdatasheet取得は実装していない                                                                                                                     | 自働発注・外部sourcingはPhase 6範囲、定期的な検証・監視への展開はPhase 7範囲。Phase 4受入対象外とし、datasheet検証経路の追加は別契約として扱う                                                                                                      |
| organization-wide knowledge sharingはPhase 3の範囲外である                                                                                                                     | Phase 4の受入対象外。Phase 3の境界を維持し、組織間共有は後続フェーズの独立判断とする                                                                                                                                                                |
| `fixtures/phase3/component-library.json`のcomponent recordsはprovenance付きで整備したが、projectionがこのcomponent libraryを部品選択・投影へ消費するところまでは実装していない | Phase 3残債として[`phase4-plan.md#wp9phase-3残債phase-4受入対象外`](phase4-plan.md#wp9phase-3残債phase-4受入対象外)に記載し、Phase 4受入gateには含めない                                                                                            |
| component recordの未取得datasheetや未検証属性は`unknown`として残している                                                                                                       | Phase 4受入対象外。検証経路は別契約またはADR化し、unknownを合格扱いにしない                                                                                                                                                                         |
| Gate 22のreopen/DRC拡張は未実装である                                                                                                                                          | [`phase4-plan.md#wp9phase-3残債phase-4受入対象外`](phase4-plan.md#wp9phase-3残債phase-4受入対象外)の独立残債。Phase 4の完了条件には含めない                                                                                                         |
| overlay libraryがboardから直接参照されない                                                                                                                                     | [`phase4-plan.md#wp9phase-3残債phase-4受入対象外`](phase4-plan.md#wp9phase-3残債phase-4受入対象外)でモデル変更の要否を扱う                                                                                                                          |
| process conditionの片方向チェックで未宣言必須条件を`fail`ではなく`unknown`とするか未決定である                                                                                 | [`phase4-plan.md#wp9phase-3残債phase-4受入対象外`](phase4-plan.md#wp9phase-3残債phase-4受入対象外)で独立した契約変更として扱う                                                                                                                      |

## 参照

- [`phase3-plan.md`](phase3-plan.md)
- [`gates.md`](gates.md)
- [`knowledge-base.md`](knowledge-base.md)
- [`event-log.md`](event-log.md)
- [`../schemas/gate-matrix.json`](../schemas/gate-matrix.json)
- [`adr/0021-fab-feedback-intake-source.md`](adr/0021-fab-feedback-intake-source.md)
- [`adr/0022-knowledge-scope-promotion-approval-boundary.md`](adr/0022-knowledge-scope-promotion-approval-boundary.md)
- [`adr/0023-library-versioning-official-snapshot-overlay-patch.md`](adr/0023-library-versioning-official-snapshot-overlay-patch.md)
