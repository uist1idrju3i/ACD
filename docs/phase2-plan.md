# Phase 2実装計画

**ステータス：Draft（WP1実装中、WP2以降は未着手）**

## 目的と権威範囲

Phase 2はREADME §7の「2 検証ゲートと設計根拠」を実装するフェーズです。README
の完了条件は、**Phase 1のgolden taskで、注入した設計ミスが人間の介入なしに検証
gateで検出・修復され、テスト項目リストが出力される**ことです。本書はその完了条件を
work packageへ分解し、各WPの受入基準と停止条件を定義します。フェーズ境界と完了条件の
権威は[`../README.md`](../README.md)であり、本書はそれを実装契約へ落とすだけです。

READMEの「やらないこと」により、Phase 2では高忠実度SI／熱解析を実装しません。
[`verification-gates.md`](verification-gates.md)のシミュレーション忠実度ラダーの
レベル4以上（openEMS、scikit-rf、FEM熱解析）はPhase 2の受入対象外です。

## Phase 1からの入力

- Gate 1〜12は実装・合格済み、Gate 13はcontract実装済みで実機測定待ちです
  （[`phase1-gates.md`](phase1-gates.md)、[`phase1-retrospective.md`](phase1-retrospective.md)）。
- レトロスペクティブが挙げたPhase 2候補：topology-level electrical lint、gate matrixの
  machine-readable single source、AI要件からのfixture生成、live sourcing、
  WP6 schematic readability。

## Work packages

### WP1：gate matrixのmachine-readable single source

**状態：本PRで実装。**

**作業**

- gate契約を[`../schemas/gate-matrix.json`](../schemas/gate-matrix.json)へ集約し、
  [`../schemas/gate-matrix.schema.json`](../schemas/gate-matrix.schema.json)で検証する。
- [`phase1-gates.md`](phase1-gates.md)のgate matrix表を同dataから生成する
  （`pnpm gates:generate`、同期検査は`pnpm schema:validate`と`pnpm gates:check`）。
- `pnpm phase1:smoke`／`pnpm phase1:golden`のgate番号・名称・適用範囲を同dataから読み込み、
  contract上必須のgateを実行しないrunを`verification-failed`で停止する。

**受入基準**

- runnerとdocsのgate番号・名称が乖離した場合、schema validationまたはtestが停止する。
- gateの`errorCodes`が[`error-taxonomy.md`](error-taxonomy.md)のcodeに存在する。
- smoke／goldenそれぞれで、契約済みgateの実行漏れを検出できる。

**リスク**

- 表の手編集が再発するため、生成物であることをdocsに明示し、生成scriptを検証系へ接続する。

### WP2：topology-level electrical lint gate

**状態：未着手。**

Phase 1レビューでUSB-C CC終端欠落、LED電流不足、レギュレータbulk容量欠落、
footprint／MPN不整合が後段で発見されました。KiCad ERCはこれらを検出しません。

**作業**

- 決定論的なelectrical lintルールを実装する：電源ツリー整合、GND接続、
  USB-C CC終端、pull-up／pull-down、LED直列抵抗の電流、デカップリング近接と容量、
  部品定格（電圧・電流・電力）に対するマージン。
- 三値評価（pass／fail／unknown）を[`adr/0011-three-valued-rule-evaluation-and-validity-domain.md`](adr/0011-three-valued-rule-evaluation-and-validity-domain.md)
  に従って実装し、unknownは検証を縮小せず広げる。
- gate matrixへ新gateを追加し、ERCの前段（topology）として順序を固定する。

**受入基準**

- Phase 1 golden fixtureがlintを合格する。
- 既知の4件（CC終端、LED電流、bulk容量、footprint／MPN不整合）を注入したfixtureが
  それぞれ固有のrule IDで停止する。
- 各findingがrule ID、対象entity、期待値、実測値、根拠（datasheet／要求／規格）を持つ。

### WP3：設計根拠（Design Rationale）の構造化記録

**状態：未着手。**

**作業**

- 判断、代替案、前提、既知の懸念をtyped entityとして記録し、revisionとinput hashへ紐付ける。
- 各gate結果とlint findingへrationale IDを付与し、後工程から遡れるようにする。

**受入基準**

- 設計判断がrationale無しに下流へ流れないことをgateで検査できる。
- rationaleがLLM生成テキストであっても、合否判定の証拠として使われない。

### WP4：テスト項目の自動生成

**状態：未着手。**

**作業**

- 要求、制約、rationale、lintルール、部品定格から`TestItem`リストを決定論的に生成する。
- 各TestItemに測定対象、条件、期待範囲、測定方法、対応するgate／要求への参照を持たせる。
- Gate 13の実機Evidence契約（[`phase1-gates.md`](phase1-gates.md)）と同じIDで接続する。

**受入基準**

- golden fixtureから生成したTestItemリストが決定論的（同一入力で同一hash）である。
- 各要求・制約に検証方法が割り当てられ、未割当は未検証として報告される。

### WP5：故障注入と自動検出・自動修復ループ

**状態：未着手。READMEの完了条件そのもの。**

**作業**

- Phase 1 golden taskへ設計ミスを注入するfixtureを追加する
  （[`golden-tasks.md`](golden-tasks.md)の故障注入方式を踏襲）。
- 検出→修復候補生成→再検証のループを実装し、人間の介入なしに閉じる。
- 修復はpatchとして適用し、revision、根拠、影響範囲、再実行gateを記録する。

**受入基準**

- 注入した各設計ミスが、人手介入なしに検出・修復され、全gateが再合格する。
- 修復できない場合はjidoka停止し、停止理由と再開条件を記録する。
- 修復ループが無限ループにならず、試行上限と収束条件を持つ。

**未決定**

- 修復候補の生成方式（決定論的ルールベースか、LLM提案＋決定論的検証か）はADRで決める。
  いずれの場合も合否判定は決定論的gateが行い、LLM出力を合格証拠にしない。

### WP6：SPICEゲート（忠実度ラダー レベル2〜3）

**状態：未着手。**

**作業**

- netlist生成、SPICE engineのprocess境界、結果のEvidence化を実装する。
- engine、版、モデル出所、方言、入力hash、収束状態、マージンを記録する。

**受入基準**

- golden fixtureの電源・LED回路について、nominal解析が収束し、結果がEvidenceになる。
- 収束失敗は`convergence-failure`で停止する。

**未決定**

- engine選定（ngspice共有ライブラリ／WASM、Xyce等）とライセンス境界はADRで決める。
  高忠実度SI／熱解析はPhase 2の対象外。

### WP7：schematic readability（Phase 1 WP6の繰延分）

**状態：未着手・低優先。**

net label中心の投影を、electrical semantics、netlist、ERC結果を変えずに読みやすくします。

## リスク登録簿

| リスク                      | 影響                           | 現在の対策                                  | 次の判断                        |
| --------------------------- | ------------------------------ | ------------------------------------------- | ------------------------------- |
| 自動修復の暴走              | 誤った修復が下流へ流れる       | patch化、再検証必須、試行上限               | WP5でADR化                      |
| lintルールの過剰・過少検出  | 停止過多、または後段発見の再発 | 三値評価、rule IDごとの故障注入fixture      | WP2受入時に評価                 |
| SPICEモデルの出所           | ライセンス制限、再配布不可     | 外部tool境界、モデルはEvidence metadataのみ | WP6のADRで境界を確定            |
| gate matrixとrunnerの再乖離 | 契約と実行の不一致             | 生成物化と実行漏れ検出                      | WP1で解消、以降は回帰testで維持 |
| 高忠実度解析への範囲拡大    | Phase 2境界の逸脱              | READMEの「やらないこと」を受入基準に反映    | 逸脱時は停止しエスカレート      |

## 関連文書

- [`../README.md`](../README.md#7-ロードマップ)
- [`verification-gates.md`](verification-gates.md)
- [`phase1-gates.md`](phase1-gates.md)
- [`phase1-plan.md`](phase1-plan.md)
- [`phase1-retrospective.md`](phase1-retrospective.md)
- [`golden-tasks.md`](golden-tasks.md)
- [`../schemas/gate-matrix.schema.json`](../schemas/gate-matrix.schema.json)
