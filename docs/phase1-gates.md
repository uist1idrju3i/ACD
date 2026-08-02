# Phase 1ゲートと製造準備契約

**ステータス：Draft（smoke fixtureのGate 1〜11を実装済み。goldenは将来）**

## 実装済みsmoke vertical slice

`pnpm phase1:smoke`は`fixtures/phase1/smoke.json`を入力としてGate 1〜11を
順序実行します。KiCad公式symbolを埋め込んだ回路図、fixtureからのcanonical
netlist、IPC-D-356との照合、ERC、2層の決定論的heuristic routing、Gerber／drill、
BOM、manifest、pre-order checklistを`artifacts/phase1-smoke/`へ出力します。
ESP32級golden fixture、実部品library geometryの完全な置換、自動発注、実機Evidence
は本PRの対象外です。

Routingの例外範囲はsmoke fixtureだけです。smokeでは決定論的なtrack/via
projectionを使用できますが、non-smoke fixtureへ適用する場合はjidoka停止します。
ESP32級goldenではFreeroutingのDSN/SES境界、または将来承認されるADRの外部routing
toolを使用します。Phase 1で一般用途routerを実装することは許可しません。

## 目的と権威範囲

Phase 1は、事前変換済みの`Requirement` fixtureから、決定論的な検証を通過した
2層基板と人手発注可能な製造packageを生成する。自然言語入力、LLMによる要求変換、
sourcing API、viewer、自動発注、FW packageはこの受入契約の対象外である。

Phase 1には次の2種類のfixtureを持つ。

- **smoke fixture**：3〜5部品。projection、netlist、ERC/DRC、routing、Gerberの
  内部gateを短時間で回帰する。Phase 1の実装中に必須の内部gateである。
- **golden fixture**：ESP32、センサー、status LED、電源、通信を含む2層基板。Phase 1
  の最終受入対象であり、BOM／manufacturing packageと実機確認Evidenceまで扱う。

## 入力境界

Phase 1 fixtureは次を含む。

- 構造化済み`Requirement`
- resolved `Part`とMPN/AVL
- symbol／footprint mappingとprovenance
- Component、Pin、Net
- board outline、stackup、placement constraints
- BOM lineと発注に必要なsupplier情報

部品候補はfixture提供データの範囲から選択する。外部sourcing APIはPhase 1の必須
依存にせず、後続adapterで追加する。

## Gate matrix

| 順序 | Gate                    | 入力                                      | 合格条件                                                              | 不合格時                                           |
| ---- | ----------------------- | ----------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------- |
| 1    | Fixture/schema          | Requirement fixture、typed Phase 1 schema | Schema valid、全参照解決、MPN/AVLとmappingが存在                      | `schema-invalid`／`reference-integrity`で停止      |
| 2    | Graph semantic          | graph snapshot                            | ID重複なし、revision整合、Component/Pin/Net参照整合                   | `reference-integrity`／`revision-invalid`で停止    |
| 3    | Component selection     | fixture Part/AVL                          | 選択Partがfixture許可範囲、数量・package・lifecycle・provenanceが確定 | 未確定Partを下流へ流さず停止                       |
| 4    | Placement               | outline、keepout、placement constraints   | deterministic座標、outline・穴・高さ・keepout違反なし                 | `verification-failed`で停止                        |
| 5    | Netlist consistency     | graph Component/Pin/Net                   | graph canonical netlistと投影前のcanonical netlistが一致              | 接続差分、pin/pad ambiguityで停止                  |
| 6    | KiCad projection/reopen | schematic、PCB、library manifest          | 固定containerで再オープン、symbol/pad/netが読戻し可能                 | `reopen-failure`で停止                             |
| 7    | Netlist readback        | KiCad schematic netlist、PCB pad table    | reference、pin、pad、net接続集合がgraphと完全一致                     | `verification-failed`で停止                        |
| 8    | ERC/topology            | KiCad schematic、graph rules              | ERC errors=0、許容warningは明示waiverのみ                             | 下流へ流さず停止                                   |
| 9    | Routing                 | PCB、routing profile                      | **unrouted=0**、ratsnestなし、同一入力でdeterministic                 | `convergence-failure`／`verification-failed`で停止 |
| 10   | DRC/DFM                 | routed PCB、fab profile                   | DRC violations=0、unconnected=0、fab critical/high=0                  | 下流へ流さず停止                                   |
| 11   | Manufacturing outputs   | Gerber、drill、BOM、必要なpick-and-place  | 再読込可能、層／部品／net数とrevision/hashが一致                      | `verification-failed`で停止                        |
| 12   | Pre-order readiness     | 全artifact、BOM、cost、availability       | 人手発注に必要な情報が揃い、未解決order-relevant unknownなし          | 発注準備を停止                                     |
| 13   | Physical completion     | 実機測定Evidence                          | golden taskのTestItemが条件・基準付きでpass                           | 後続継続を停止／再設計                             |

各gateの合否、対象gate、入力revision、tool version、判定時刻は`VerificationResult`へ
記録する。測定・tool output・library／model provenance、output hash、uncertainty、停止理由は
`Evidence`として記録し、`VerificationResult`からID参照する。

## BOM／manufacturing package契約

Phase 1では自動発注を行わず、人が発注できるpackageを生成する。最低限、次を含む。

- Gerber X2またはfabが受け付けるGerber一式
- drill filesとlayer／stackup情報
- revision、graph hash、netlist hash、生成tool/version
- BOM：reference、MPN、manufacturer、package、quantity、DNP／alternate状態
- AVL／sourcing provenance：supplier、SKU／URL、取得時点、availability、lifecycle、
  価格と通貨（提供される場合）、代替候補
- fabrication profile、board dimensions、layer count、material／thickness
- pick-and-place（実装対象の場合）
- manifestと各artifactのsha256
- 未解決事項、waiver、発注前checklist

MPN、quantity、supplier情報の欠落、fixture AVL外の選択、またはlifecycle／availability
不明は、order-relevant unknownとしてpre-order gateを通過させない。自動checkout、
支払い、発注確定はPhase 1のpackage生成に含めない。

## 実機完了Evidence template

最終golden taskの実機確認は、次の情報を満たすEvidenceとして保存する。

```yaml
id: evidence:phase1-golden:board-bringup
type: Evidence
revision: 0
evidenceKind: measurement
observedAt: "<RFC3339>"
board:
  projectId: project:phase1-golden
  graphRevision: 0
  boardRevision: "<board-revision>"
  pcbArtifactHash: "sha256:<hash>"
  bomArtifactHash: "sha256:<hash>"
  assembledAt: "<RFC3339>"
  lotOrOrderReference: "<redacted-or-reference>"
conditions:
  supplyVoltage: "<value and unit>"
  ambient: "<value and unit>"
  instruments:
    - id: "<instrument-id>"
      calibrationDue: "<RFC3339>"
observations:
  - testItemId: test:power-rail
    claim: "Power rail measurement"
    procedure: "<procedure>"
    value: "<value>"
    unit: "<unit>"
    expected: "<range and unit>"
    pass: true
  - testItemId: test:communication
    claim: "Communication test"
    procedure: "<procedure>"
    value: "<result>"
    expected: "<criterion>"
    pass: true
provenance:
  - kind: measurement
    locator: "measurement://phase1-golden/board-bringup"
    toolVersion: "<measurement-tool-version>"
    capturedAt: "<RFC3339>"
    capturedBy: "<operator-or-redacted-id>"
    contentHash: "sha256:<hash>"
uncertainty:
  state: verified
  description: "<remaining uncertainty or none>"
```

実機が動いたという記述だけではgateを閉じない。電源、通信、sensor、LED、reset／boot
などgolden taskのTestItemごとに、条件、測定器、期待範囲、観測値、判定、artifact／
revision参照を保持する。

## 停止と再開

`unrouted>0`、netlist差分、ERC/DRC不合格、library hash mismatch、BOMのorder-relevant
unknown、stale result、実機Evidence不足はjidoka停止である。修正後は同じgraph revision
または新しいrevisionと新しいinput hashを明示し、影響を受けるgateから再実行する。

未配線ratsnestをwaiverでPhase 1発注準備へ通すことは許可しない。routingが収束しない
場合は、入力fixtureを単純化するか、決定論的な代替routingを実装し、失敗Evidenceを
保存する。fixture単純化は要求・受入範囲の変更として扱い、変更理由、影響分析、必要な承認、
再検証範囲を経てから再開する。代替routingはPhase 1境界内（外部toolまたは承認済みADR）
に限る。

## 関連文書

- [`phase1-plan.md`](phase1-plan.md)：smokeからESP32級goldenまでの順序計画
- [`testing.md`](testing.md)
- [`pipeline.md`](pipeline.md)
- [`verification-gates.md`](verification-gates.md)
- [`kicad-interop.md`](kicad-interop.md)
- [`golden-tasks.md`](golden-tasks.md)
- [`../schemas/phase1-fixture.schema.json`](../schemas/phase1-fixture.schema.json)
