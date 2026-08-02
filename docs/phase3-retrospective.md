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

## Phase 4へ持ち越す既知のギャップ

- 実fab reportではなく、実fab形式を模したfixtureを入力にしている。
- live sourcing APIやオンラインdatasheet取得は実装していない。
- organization-wide knowledge sharingはPhase 3の範囲外である。
- `fixtures/phase3/component-library.json`のcomponent recordsはprovenance付きで整備したが、
  projectionがこのcomponent libraryを部品選択・投影へ消費するところまでは実装していない。
- component recordの未取得datasheetや未検証属性は`unknown`として残しており、Phase 4以降で
  検証経路を追加する必要がある。

## 参照

- [`phase3-plan.md`](phase3-plan.md)
- [`gates.md`](gates.md)
- [`knowledge-base.md`](knowledge-base.md)
- [`event-log.md`](event-log.md)
- [`../schemas/gate-matrix.json`](../schemas/gate-matrix.json)
- [`adr/0021-fab-feedback-intake-source.md`](adr/0021-fab-feedback-intake-source.md)
- [`adr/0022-knowledge-scope-promotion-approval-boundary.md`](adr/0022-knowledge-scope-promotion-approval-boundary.md)
- [`adr/0023-library-versioning-official-snapshot-overlay-patch.md`](adr/0023-library-versioning-official-snapshot-overlay-patch.md)
