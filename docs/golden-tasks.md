# Golden task fixture

**ステータス：Draft（Phase 0の6 fixtureは`pnpm golden`でreplay済み）**

## 目的と権威範囲

既知の入力と期待結果を固定し、Schema、graph-core、patch、KiCad adapter、
deterministic gateの変更を回帰評価します。採点軸の意味は[`testing.md`](testing.md)
を正とし、本書はfixtureと期待結果の粒度だけを定義します。

## 実行方法

`pnpm golden`（`scripts/golden-run.mts`）が`fixtures/golden/*.json`を順にreplayし、
期待するoutcome、jidoka、error code、gate、patchの原子性を照合します。evidenceは
`artifacts/golden/<task>/result.json`と`artifacts/golden/summary.json`へ出力し、
KiCad report、netlist、Gerber/drillも同ディレクトリへ残します。入力は全fixture共通で
`fixtures/design-graphs/normal-2layer.json`であり、故障注入はrunner内の型付き
mutationとして適用します。

## 共通fixture形式

各fixtureは次を持ちます。

- `taskId`、fixture version、schema version
- 入力snapshot、patch JSONL、イベント列
- tool profileとinput hash
- 期待する終端状態、error code、停止／再開条件
- 期待artifactの一覧、hashまたは許容差
- 実行時間・介入・再試行の上限

fixtureはネットワーク、現在時刻、ホストのKiCad、未固定ライブラリに依存しない。

## 必須fixture

### `phase1-golden-esp32`

ESP32-WROOM-32E、USB-C電源入力（CC1/CC2の5.1kΩ Rd終端）、3.3V regulator、
BME280 I2C sensor、UART header、status LED、入力10µF／出力22µFを含む
Phase 1 golden fixture定義です。BME280は公式2.5x2.5mm LGA-8 footprintを使用し、
LED直列抵抗は330Ω、EN/IO0 pull-upは10kΩです。
`pnpm schema:validate`でSchemaとreference-integrityを検証し、公式KiCad
symbol/footprint mappingはcontent-hash pinned snapshotから解決します。

このWPではfixture定義とGate 1/2のみを受入対象とします。golden fixtureをsmoke-only
projection/routerへ渡してはならず、placementはWP3、外部routing toolのDSN/SES
round-tripと`unrouted=0`はWP4で実装します。

### `normal-2layer`

最小2層基板、部品、Pin、Net、Layout、BoardStackupからKiCad投影を生成する。
Schema、semantic validator、再オープン、ERC/DRC、Gerber/drillが合格し、
同一入力で同じsnapshot／artifact hashになることを期待する。

### `intentional-erc-failure`

ピン方向または電源定格の違反を注入する（実装：`duplicate-power-output-driver`、
`pin:flg2-1`を`net:gnd`から`net:vcc`へ移し、同一netを複数のpower outputが駆動
する）。ERCが不合格となり、設計を下流へ流さず、`verification-failed`または具体的な
ERC errorへ分類し、修正候補または停止条件をイベントへ残す。

### `intentional-drc-failure`

幅、間隔、穴、outlineのいずれかの違反を注入する（実装：
`overlapping-component-placement`、`component:d1`を`component:r1`に重ねて配置
する）。DRCが不合格となり、Gerber発注準備へ進まず、findingの対象とseverityを
保存する。

### `patch-conflict`

同一base revisionへ競合するpatchを適用する。片方だけが確定し、他方は
`patch-conflict`として停止する。自動merge、snapshotの部分書込みを許可しない。

### `stale-result`

revision Nで合格したVerificationResultの後に、依存Entityを変更したrevision
N+1を適用する。旧結果はstaleとなり、下流gateの合格証拠に使えない。

### `reopen-failure`

KiCad projectまたはlibraryを壊したfixtureを使う（実装：
`truncate-projected-board`、投影済み`design.kicad_pcb`を途中で切断する）。別プロセス
再オープンが失敗し、`tool-failure`または`reopen-failure`として停止する。exit code
だけで成功扱いにしない。

## 許容差と採点

- JSON snapshot、patch、eventのhashは完全一致を要求する。
- KiCad reportとartifactは、profileが明示したvolatile metadataを除き一致させる。
- 数値測定を含む将来fixtureは、単位、絶対／相対許容差、丸め規則をfixtureに書く。
- 各fixtureはpass/fail、error code、停止の正しさ、再開位置、生成差分、hash、
  不要な人間介入を記録する。

## testing.mdとの関係

`testing.md`は電気的妥当性、製造性、コスト、リードタイム、介入、自働化、
根拠という評価軸と回帰方針を定義する。本書は、その評価を再現する具体的な
入力fixture、故障注入、期待終端状態を定義し、評価軸を重複定義しない。

## 関連文書

- [`testing.md`](testing.md)
- [`phase0-plan.md`](phase0-plan.md)
- [`kicad-ci-profile.md`](kicad-ci-profile.md)
- [`error-taxonomy.md`](error-taxonomy.md)
