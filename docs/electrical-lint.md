# Topology-level electrical lint（Gate 14）

**ステータス：Draft**

## 目的と範囲

KiCad ERC（gate 8）は「接続の整合」を検査しますが、終端抵抗値・電流・容量・定格と
いった**電気的な妥当性**は検査しません。Phase 1レビューでは、USB-C CC終端欠落・LED
電流・レギュレータbulk容量・footprint／MPN不整合が後工程で発見されました。本gateは
これらをtopologyとtyped parameterだけで決定論的に判定します。

範囲はtopologyレベルに限定します。高忠実度SI／熱解析はREADMEの「やらないこと」により
Phase 2の対象外です。SPICEによる回路レベル検証はWP6
（[`adr/0020-spice-engine-ngspice-external-process.md`](adr/0020-spice-engine-ngspice-external-process.md)）
で別gateとして扱います。

実装は[`../packages/graph-core/src/electrical-lint.ts`](../packages/graph-core/src/electrical-lint.ts)、
故障注入testは[`../packages/graph-core/src/electrical-lint.test.ts`](../packages/graph-core/src/electrical-lint.test.ts)です。
graph-coreはfilesystem／network／KiCadへ依存せず、入力はtyped fixtureのみです。

## 入力契約

[`../schemas/phase1-fixture.schema.json`](../schemas/phase1-fixture.schema.json)へ次を追加しました。

| 位置                     | フィールド                                                                                                                                                                                                | 意味                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `parts[].package`        | 文字列                                                                                                                                                                                                    | package記述子                  |
| `parts[].parameters`     | `source`（必須）、`resistanceOhm`、`capacitanceUf`、`ratedVoltageV`、`forwardVoltageV`、`forwardCurrentMinMa`、`forwardCurrentMaxMa`、`outputVoltageV`、`inputCapacitanceMinUf`、`outputCapacitanceMinUf` | ruleが使う電気parameterと出所  |
| `nets[].role`            | `usb-cc`／`i2c`／`uart`／`led`／`bootstrap`／`other`                                                                                                                                                      | ruleの適用対象を宣言で決める   |
| `nets[].nominalVoltageV` | 数値                                                                                                                                                                                                      | 定格ディレーティングの基準電圧 |

MPN文字列からの推定は行いません。値が無い場合は推定せず`unknown`とします。

## 三値評価とverdict

[`adr/0011-three-valued-rule-evaluation-and-validity-domain.md`](adr/0011-three-valued-rule-evaluation-and-validity-domain.md)
に従い、各findingは`pass`／`fail`／`unknown`のいずれかです。集約verdictは次のとおりです。

| 条件                              | verdict   | runnerの扱い                |
| --------------------------------- | --------- | --------------------------- |
| 全findingが`pass`                 | `pass`    | gate 14合格                 |
| `fail`が1件以上                   | `fail`    | `verification-failed`で停止 |
| `fail`は0件だが`unknown`が1件以上 | `blocked` | `verification-failed`で停止 |

`unknown`は検証を縮小せず広げます。parameter欠落を合格として下流へ流しません。

## Rule一覧

| rule ID                         | 判定内容                                                       | `unknown`になる条件               |
| ------------------------------- | -------------------------------------------------------------- | --------------------------------- |
| `pin-connected`                 | power pinおよび二端子受動部品（R／C／LED）の全pinがnetに属する | なし（欠落は`fail`）              |
| `power-net-voltage-declared`    | power netが`nominalVoltageV`を宣言している                     | 未宣言                            |
| `regulator-bulk-capacitance`    | レギュレータ入出力のbulk容量が要求値以上                       | 要求値または容量が未宣言          |
| `decoupling-present`            | IC／module／sensorの供給pinに電源—GND間の小容量capacitorがある | 容量が未宣言                      |
| `led-series-current`            | `I = (Vdrive − Vf) / R`がLEDの電流窓に入る                     | Vf・R・駆動電圧のいずれかが未宣言 |
| `usb-cc-termination`            | USB-C CC netにGNDへの約5.1 kΩ pull-downがある                  | 抵抗値が未宣言                    |
| `i2c-pullup`                    | I2C netにpower netへの1 k〜10 kΩ pull-upがある                 | 抵抗値が未宣言                    |
| `capacitor-voltage-derating`    | capacitorの定格電圧 ≥ net公称電圧 × 1.5                        | 定格またはnet電圧が未宣言         |
| `footprint-package-consistency` | footprint名がpackage記述子またはMPN先頭tokenを含む             | 比較可能なtokenを取り出せない     |

しきい値（ディレーティング係数、pull-up範囲、CC抵抗値と許容比、デカップリング上限容量）は
`ElectricalLintProfile`として明示し、既定値を`defaultElectricalLintProfile`に固定します。

## Evidence

gate 14は`artifacts/phase1-golden/gate-results.json`へ`verdict`、評価rule数、finding数、
finding列のhashを記録します。`fail`／`blocked`時はrule ID・対象entity・期待値・実測値・
根拠を含む停止理由を残します。

## golden fixtureへ反映した設計修正

lint導入時に、gate 1〜12を通過していた実在の欠陥を2件検出しました。lintを緩めず
fixture側を修正しています。

1. I2C（`net:i2c-sda`／`net:i2c-scl`）にpull-upが無い。ESP32もBME280も内蔵しないため
   バスが成立しない。R8／R9（4.7 kΩ）を3V3へ追加。
2. BME280のSDO_SEL抵抗R5のpin 2がどのnetにも接続されておらずI2Cアドレスが不定。
   pin 2をGNDへ接続。

## 関連文書

- [`gates.md`](gates.md)
- [`phase2-plan.md`](phase2-plan.md)
- [`verification-gates.md`](verification-gates.md)
- [`error-taxonomy.md`](error-taxonomy.md)
- [`adr/0011-three-valued-rule-evaluation-and-validity-domain.md`](adr/0011-three-valued-rule-evaluation-and-validity-domain.md)
