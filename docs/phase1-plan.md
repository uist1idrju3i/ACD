# Phase 1完了計画

**ステータス：Draft（smoke vertical slice後の実装計画）**

## 目的と前提

Phase 1は、事前変換済みの`Requirement` fixtureから、ESP32級golden taskの
製造準備と実機確認Evidenceまでを、決定論的なgateで閉じるフェーズです。
`pnpm phase1:smoke`による3〜5部品の内部gateは実装済みですが、golden taskへ
そのまま一般化できるとはみなしません。

自然言語入力、LLMによるRequirement変換、sourcing API、viewer（read-onlyの
最小投影を除く）、自動発注はPhase 1の対象外です。`unrouted=0`はsmokeとgolden
の両方で必須であり、ratsnestを合格扱いにしません。

## Work packages

### WP1：公式symbol／footprint library snapshot

**状態：smoke fixture範囲で完了。**

**作業**

- 固定KiCad containerから公式symbol／footprintを機械的に抽出する。
- mapping、library version、source URL、license、container digest、各snapshotの
  content hashをmanifestへ記録する。
- 手書きのsmoke geometry tableを、抽出した実geometryへ段階的に置き換える。
- projection前にmanifest hashを検証し、不一致ならjidoka停止する。

実装済み範囲は`packages/adapters/kicad/library-snapshot/`のsmokeおよびgolden定義用
スナップショットです。golden fixture追加時も同じ抽出scriptでmanifestを再生成します。
固定digestから抽出したsymbol blockとfootprint `.kicad_mod`をmanifestへ登録し、
projectionは公式pad位置、size、layer、THT drillを使用します。生成symbol moduleは
抽出scriptから再生成され、projection前のruntime hash検証と未知construct停止を
実装しています。未完了なのはsmoke/golden範囲を越えた全library同期です。

**受入基準**

- 同じcontainer digestから同じsnapshot hashが得られる。
- symbol pin、footprint pad、pad番号、原点、回転規則をfixture mappingと照合できる。
- hash mismatch、未知library、未知padがtyped errorで停止する。

**リスク**

- KiCad libraryの内部形式やpropertyの差分で、単純な文字列snapshotが安定しない。
- CC-BY-SA-4.0-with-exceptionの帰属・配布境界をmanifestとNOTICEで継続管理する。

### WP2：ESP32級golden fixture定義

**状態：fixture定義・Gate 1/2検証・必要library snapshot拡張まで完了。**

**作業**

- ESP32、電源、センサー、status LED、通信、デカップリングを含む部品・netを定義する。
- placement constraint、keepout、board outline、stackup、fixture-provided MPN/AVLを定義する。
- まずfixtureとschema／semantic validationだけを追加し、projectionやroutingとは分離する。

**受入基準**

- `fixtures/phase1/golden-esp32.json`が`phase1-fixture.schema.json`とsemantic
  validatorを通過する。
- 全partにmapping、placement、BOM、provenanceがあり、全net pinが解決する。
- ESP32-WROOM-32E、USB-C、regulator、BME280、passive、header、switchの
  official mappingとhash-pinned footprint snapshotが存在する。
- canonical netlist hashとfixture revisionを再現できる。

本WPはfixture定義とGate 1/2の検証までを対象とした。AMS1117-3.3の公式symbolは
`extends`で親symbolへ依存し、固定snapshotへ直接pin geometryを埋め込めないため、
schematic projectionでは同じ公式Regulator_Linear libraryの`AP1117-15`をsymbol
substitutionとして使用する。BOM/MPNはAMS1117-3.3のまま保持し、理由をfixture
mapping provenanceへ記録した。goldenのplacement・projection・Gate 3以降はWP3、
golden routingと`unrouted=0`はWP4で実装する。

**リスク**

- ESP32 symbol／footprintのpin function、thermal pad、alternate pinがfixtureの
  単純なPinモデルを越える可能性がある。
- golden fixtureを先に複雑化すると、projection failureとfixture設計不備を
  切り分けられない。

### WP3：一般化された決定論的placement

**状態：golden placement、KiCad schematic/PCB projection、Gate 1〜8 runnerを実装済み。
Gate 9〜11（routing、DRC、manufacturing）はWP4へ延期。**

**作業**

- module-first配置、電源・デカップリング近接、connector位置、keepout、最大高さを
  constraintとして扱う。
- smokeの固定座標を汎用placementと混同せず、候補生成とdeterministic scoringを分離する。
- placement結果に理由、入力hash、seed、constraint violationを記録する。

**受入基準**

- 同一fixture・同一seedでplacement hashが一致する。
- keepout、board outline、connector、decoupling proximityの違反を停止できる。
- placement変更がrouting、netlist、DRCの再検証対象へ伝播する。

**リスク**

- 配置最適化を早く一般化すると、局所的な解を「最適」と誤認する。
- AI提案は候補に限定し、合否はdeterministic constraint checkerで決める。

### WP4：golden routing

**作業**

- 改良したpad geometry、board boundary、wiring ruleを含むDSN exportを作る。
- FreeroutingのDSN/SES round-tripを、smokeで再評価したうえでgoldenへ適用する。
- SES import後にKiCad DRC／unconnectedを再実行する。
- Freeroutingが採用できない場合は、将来ADRで承認された外部routing toolまたは
  fixture限定の明示的な代替策を選択する。

**受入基準**

- routing結果が`unrouted=0`、DRC violations=0、unconnected=0になる。
- DSN、SES、PCB、DRCのrevision／input hash／tool versionをEvidenceへ保存する。
- 同一入力のstable artifact hashが一致する。

**リスク**

- 現行Freerouting spikeはSES生成までで、141 nets中128 netsが未配線だった。
- DSNのimage/component grouping、pad geometry、layer rule、SES importが主リスクである。
- smokeの決定論的track/via projectionは一般用途routerではなく、goldenへ拡張しない。

**実装状況（WP4）**：

- KiCad-generated PCBから`pcbnew.ExportSpecctraDSN`でDSNを生成
- Freerouting 2.2.4 external processでrouting
- `pcbnew.ImportSpecctraSES`でSESをimport
- clearance 0.127 mm、track 0.25 mm、via 0.8/0.4 mmを採用
- golden Gate 9〜11を実行し、unrouted=0、DRC 0、unconnected 0、
  footprint errors 0を実測
- 同一入力を2回実行しSES hash一致を確認
- smokeのrouting pathは変更しない

### WP5：Gate 12/13

**作業**

- pre-order readiness checklistを、BOM／AVL、価格、納期、製造profile、未解決unknown、
  revision/hash linkageまで閉じる。
- 自動発注は行わず、人手発注可能性の確認結果をEvidence化する。
- 手動組立、通電、導通、電源、通信、センサー、LEDの測定項目を定義する。
- `Evidence`に測定器、校正状態、条件、期待範囲、実測値、判定、artifact linkを記録する。

**受入基準**

- order-relevant unknownがゼロである。
- checkout、支払い、発注確定は実行されない。
- golden実機の全TestItemに、[`phase1-gates.md`](phase1-gates.md)の実機完了Evidence契約（条件、測定器、期待範囲、観測値、判定、revision/artifact参照）を満たす条件付きpass Evidenceがある。
- 各受入基準は決定論的runner／ゲート、または実機Evidenceの記録者が判定し、完了判定を`VerificationResult`またはイベントとして残す。

**リスク**

- fixtureのBOM情報だけでは価格・在庫・納期の時点性を閉じられない。
- 実機結果は設計グラフrevisionと紐付けない限り、再利用可能なEvidenceにならない。

### WP6：schematic readability

**作業**

- smokeで実装したnet label中心の回路図を、必要に応じてwire中心の読みやすい投影へ改善する。
- electrical semantics、netlist、ERCを変えず、表示だけを改善する。

**優先度**

低優先度。gate 5〜10、library provenance、golden routing、Gate 12/13を先行する。

## リスク登録簿

| リスク                       | 影響                                 | 現在の対策                          | 次の判断                   |
| ---------------------------- | ------------------------------------ | ----------------------------------- | -------------------------- |
| golden routingの収束         | 最大。Phase 1完了を阻害              | DSN品質を改善し外部tool境界で再検証 | WP4で採否をADR候補化       |
| library geometry／hash drift | netlist、DRC、製造データの信頼性低下 | container digestとmanifest          | WP1で機械snapshot化        |
| ESP32 fixtureの複雑性        | fixture不備とprojection不備の混同    | schema validationを先行             | WP2を段階導入              |
| 実機Evidence不足             | Gate 13を閉じられない                | 手動TestItemとEvidence契約          | WP5で測定条件を固定        |
| sourcing時点性               | 発注準備の不確実性                   | fixture AVL境界、unknownを停止      | Phase 1ではAPIを導入しない |

## Phase 1に残すもの／残さないもの

### 残すもの

- typed fixtureからのgraph、netlist、projection、ERC/DRC、Gerber、drill、BOM生成
- `unrouted=0`必須のdeterministic gate
- fixture-provided MPN/AVL
- CLI／fixture runnerによる受入
- 外部routing toolをprocess boundaryとして呼ぶ契約

### 残さないもの

- 自然言語入力、LLMからRequirementへの変換
- sourcing API
- 自動発注、checkout、支払い
- read-only最小投影を越えるviewer
- 一般用途router、独自WASM engine、独自SPICE engine
- FirmwarePackageとPhase 5の仮想組込み検証

## レトロスペクティブ

- **契約先行の効果：** Gate matrix、typed fixture、reference-integrity、hash、
  `unrouted=0`を先に固定したことで、空schematicやratsnestを成功扱いする誤りを
  実装途中で発見できた。
- **決定論的toolの効果：** KiCadのERC／DRC、netlist readback、IPC-D-356を
  Evidenceとして扱うことで、生成物の見た目やLLM説明に依存せず判断できた。
- **geometry tableの限界：** smokeの手書きpad geometryは短いfixtureには有効だが、
  footprint数、回転、pad形状、thermal padが増えると維持できない。WP1の公式library
  snapshotへ移行する。
- **spikeの扱い：** FreeroutingはDSN parse／SES生成のfeasibilityを示しただけで、
  round-trip routing完了の証拠ではない。negative resultを次の設計判断へ引き継ぐ。

## 関連文書

- [`phase1-gates.md`](phase1-gates.md)
- [`kicad-interop.md`](kicad-interop.md)
- [`kicad-ci-profile.md`](kicad-ci-profile.md)
- [`golden-tasks.md`](golden-tasks.md)
- [`../schemas/phase1-fixture.schema.json`](../schemas/phase1-fixture.schema.json)
