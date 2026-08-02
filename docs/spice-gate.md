# nominal SPICE解析（Gate 18）

**ステータス：Draft**

## 目的と範囲

Phase 2の多段検証「トポロジー → ERC → SPICE」の最終段です。typed fixtureから
nominal解析deckを導出し、**固定digest containerのngspiceを外部process**として実行し、
測定値を期待範囲と照合します。方式は
[ADR-0020](adr/0020-spice-engine-ngspice-external-process.md)（A案）です。

READMEの「やらないこと」により、Phase 2では**高忠実度SI／熱解析を実装しません**。
本gateは[`verification-gates.md`](verification-gates.md)の忠実度ラダーの下段
（理想素子・線形素子によるnominal解析）に留まります。モンテカルロ、温度・公差の掃引、
伝送線路、電磁界解析は対象外です。

実装は[`../packages/adapters/spice/src/index.ts`](../packages/adapters/spice/src/index.ts)、
実行は[`../scripts/phase1-golden.mts`](../scripts/phase1-golden.mts)です。deck生成と
出力解釈はadapter内の純関数で、containerの起動はrunner側にあります。

## engine境界

- image：`kicad/kicad@sha256:182c...`（Gate 6以降と同じ固定digest。ngspice 44.2を同梱）
- 起動：引数配列で`ngspice -b <deck>`。jar／libraryをACDへvendorせず、in-process linkしません。
- 生成物：`artifacts/phase1-golden/spice/<analysis>.cir`、同`.log`、`results.json`。

## 解析

| analysis                     | 種別 | 導出元                                                        | 判定                                  |
| ---------------------------- | ---- | ------------------------------------------------------------- | ------------------------------------- |
| `spice:led-branch-d1`        | op   | LED分岐（Gate 14と同じtopologyトレース）                      | `i(vled)`が宣言された電流窓に入ること |
| `spice:i2c-rise-i2c-sda/scl` | tran | pull-up抵抗と、その抵抗が実際に接続された電源netのnominal電圧 | `trise`（0.3→0.7 Vdd）が1 µs以下      |

LED分岐はGate 14／16と同じ`ledBranchCurrents`を使い、電流計算が二重実装にならないように
しています。pull-upは「busと電源netの両方に足を持つ抵抗」というtopologyで同定し、rail電圧は
その電源net自身から取ります。net上で最小の抵抗を選ぶと直列・シャント抵抗をpull-upと
取り違え、無関係なnetの電圧をrailとして使ってしまいます。導出できない場合は解析を
省略せず`spice-analysis-derivation`の`unknown`として記録します。

`ngspice`はbannerやversion、診断の多くを正常終了時もstderrへ出すため、logはstdoutと
stderrの両方を残します。engine versionが読み取れない場合は`unknown`で停止します。
I2Cのrise timeは`test:i2c-rise-time`（Gate 16のTestItem）に対応する解析です。

## rule（三値）

| rule                        | 内容                                                                  |
| --------------------------- | --------------------------------------------------------------------- |
| `spice-analysis-derivation` | 宣言不足で導出できなかった解析。skipせず`unknown`として記録する       |
| `spice-convergence`         | 解析が収束し正常終了したか。未収束・異常終了・run欠落は`unknown`      |
| `spice-engine-version`      | engineが自身のversionを報告したか。不明なら`unknown`                  |
| `spice-margin`              | 測定値が期待範囲に入るか。範囲外は`fail`、測定値欠落は`unknown`       |
| `spice-model-provenance`    | 全モデルに出所とライセンスが記録されているか。vendorモデルは`unknown` |

`unknown`は`blocked`へ集約され、合格になりません。**使えないシミュレーションは検証を
縮小せず広げます。**

## モデルの出所

現状のdeckは理想電源と線形受動素子だけで構成し、第三者のモデルファイルを使いません。
vendor提供の`.lib`／`.mod`は再配布せず、利用者が用意する外部入力として扱います。
vendorモデルを含む解析は`spice-model-provenance`が`unknown`となり、Evidenceとして
採用されません（ADR-0020）。

## Evidence

gate Evidenceにengine名、engine version、image digest、解析数、rule数、結果hashを記録し、
`spice/results.json`に解析ごとの測定値、期待範囲、両側マージン、モデル、前提、deck hash、
出力hashを残します。**前提は不確かさとして明示します。** 例：LEDは順電圧の理想源として
扱っており、ダイオードモデルではありません。I2Cのバス容量は100 pFの仮定で、実装基板の
実測ではありません。実測はGate 13（実機測定）の領域です。

## 停止条件

収束失敗、tool異常終了、測定値欠落、モデル出所不明はいずれも`verification-failed`で
golden runを停止します。エラー分類は[`error-taxonomy.md`](error-taxonomy.md)に従います。
