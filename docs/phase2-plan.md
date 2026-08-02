# Phase 2実装計画

**ステータス：Draft（WP1〜WP7実装済み）**

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

**状態：実装済み。**

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

**状態：実装済み。** rule定義と受入結果は[`electrical-lint.md`](electrical-lint.md)、
gate契約はgate 14（`gate:electrical-lint`、gate 5の直後に実行）。

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

**実装で判明した事項**

- golden fixtureにI2C pull-up（SDA/SCL）が存在せず、BME280のSDO_SEL抵抗R5のpin 2が
  どのnetにも接続されていませんでした。いずれもgate 1〜12を通過していた実在の欠陥のため、
  lintを緩めずfixture側を修正しました（R8/R9=4.7 kΩ追加、R5 pin 2をGNDへ接続）。
- gate番号の振り直しを避けるため、gate matrixへ`runsAfter`を追加し、後続Phaseのgateが
  既存番号を保ったまま実行位置だけを宣言できるようにしました。

### WP3：設計根拠（Design Rationale）の構造化記録

**状態：実装済み。** 契約とルールは[`design-rationale-gate.md`](design-rationale-gate.md)、
実行はgate 15（`gate:design-rationale`、`runsAfter: gate:electrical-lint`）。

**作業**

- 判断、代替案、前提、既知の懸念をtyped entityとして記録し、revisionとinput hashへ紐付ける。
- 各gate結果とlint findingへrationale IDを付与し、後工程から遡れるようにする。

**受入基準**

- 設計判断がrationale無しに下流へ流れないことをgateで検査できる。
- rationaleがLLM生成テキストであっても、合否判定の証拠として使われない。

**実装で判明した事項**

- coverage対象を「要求・機能ブロック・全部品」と定義しました。曖昧な対象集合では
  coverage gate自体が形骸化するため、subjectを決定論的に列挙できる集合に限定しています。
- 未確認の仮定は`unknown`とし、TestItem参照または`tuningNeeded`を宣言するまでgateを
  通しません。これがWP4のTestItem自動生成の入力になります。
- 三値評価の型（`RuleFinding`／`RuleVerdict`）を`findings.ts`へ切り出し、gate 14と共有しました。

### WP4：テスト項目の自動生成

**状態：実装済み。** 契約と生成元は[`test-plan-generation.md`](test-plan-generation.md)、
実行はgate 16（`gate:test-plan`、`runsAfter: gate:design-rationale`）。

**作業**

- 要求、制約、rationale、lintルール、部品定格から`TestItem`リストを決定論的に生成する。
- 各TestItemに測定対象、条件、期待範囲、測定方法、対応するgate／要求への参照を持たせる。
- Gate 13の実機Evidence契約（[`phase1-gates.md`](phase1-gates.md)）と同じIDで接続する。

**受入基準**

- golden fixtureから生成したTestItemリストが決定論的（同一入力で同一hash）である。
- 各要求・制約に検証方法が割り当てられ、未割当は未検証として報告される。

**実装で判明した事項**

- LED電流の期待値はGate 14と同じtopology trace（`ledBranchCurrents`）から導出します。
  生成側で同じ計算を再実装すると、lintの判定とテスト項目の期待値が黙って乖離します。
- 合格基準を導出できないitemは`unknown`とし、blockedで停止します。「測ることは決まったが
  合格範囲は不明」という項目を成果物として出さないためです。

### WP5：故障注入と自動検出・自動修復ループ

**状態：実装済み。** 契約は[`repair-loop.md`](repair-loop.md)、
実行はgate 17（`gate:repair-loop`、`runsAfter: gate:test-plan`）。

**作業**

- Phase 1 golden taskへ設計ミスを注入するfixtureを追加する
  （[`golden-tasks.md`](golden-tasks.md)の故障注入方式を踏襲）。
- 検出→修復候補生成→再検証のループを実装し、人間の介入なしに閉じる。
- 修復はpatchとして適用し、revision、根拠、影響範囲、再実行gateを記録する。

**受入基準**

- 注入した各設計ミスが、人手介入なしに検出・修復され、全gateが再合格する。
- 修復できない場合はjidoka停止し、停止理由と再開条件を記録する。
- 修復ループが無限ループにならず、試行上限と収束条件を持つ。

**決定済み**

- 修復候補の生成方式はB案（LLM提案＋決定論的gate判定）。
  [ADR-0019](adr/0019-repair-loop-llm-proposal-with-deterministic-validation.md)。
  CIはoffline再現可能な記録済み提案（hash固定）で回し、live LLM呼び出しはopt-in。

**実装で判明した事項**

- gateの合否だけでは修復を受理できません。LED過電流に対して「LEDの順電圧を高く主張する」
  候補は電流計算を合格範囲へ入れてしまいます。基板は何も直っていないため、datasheet由来parameter、
  part provenance、order-relevantなBOM状態の書き換えを受理前に却下します。
- proposerのルックアップキーは未解決findingのhashです。case名やfixture名で引くと、修復側に
  正解を先に渡すことになります。

### WP6：SPICEゲート（忠実度ラダー レベル2〜3）

**状態：実装済み。** 契約は[`spice-gate.md`](spice-gate.md)、
実行はgate 18（`gate:spice`、`runsAfter: gate:repair-loop`）。

**作業**

- netlist生成、SPICE engineのprocess境界、結果のEvidence化を実装する。
- engine、版、モデル出所、方言、入力hash、収束状態、マージンを記録する。

**受入基準**

- golden fixtureの電源・LED回路について、nominal解析が収束し、結果がEvidenceになる。
- 収束失敗は`convergence-failure`で停止する。

**決定済み**

- engineはngspiceを固定digest containerの外部processで実行するA案
  （[ADR-0020](adr/0020-spice-engine-ngspice-external-process.md)）。KiCad containerが
  ngspice 44.2を同梱するため、image digestを増やさずに同じprocess境界で実行します。
  高忠実度SI／熱解析はPhase 2の対象外です。

**実装で判明した事項**

- 解析は理想電源と線形受動素子だけで構成し、vendorモデルを使いません。vendorモデルを
  含む解析は`spice-model-provenance`が`unknown`となり、Evidenceになりません。
- LED分岐の解析はGate 14／16と同じtopologyトレースから導出し、電流計算の二重実装を
  避けています。

### WP7：schematic readability（Phase 1 WP6の繰延分）

**状態：実装済み。** 契約は[`schematic-readability.md`](schematic-readability.md)。

net label中心の投影を、electrical semantics、netlist、ERC結果を変えずに読みやすくしました。

**作業**

- WP3の設計根拠（`rationale.appliesTo`）からpart→functional blockの割当を導き、
  基板placement順ではなく機能ブロック単位でsymbolを配置する。
- symbol snapshotのpin座標から実寸の外形を求め、重なりのない間隔で積み上げる。
- ブロック見出しとtitle blockという非電気的な注記を追加する。

**受入基準**

- Gate 7（netlist readback）とGate 8（ERC 0/0）が変更前と同じ結果で合格する。
- 同じfixtureから同じ座標が決定論的に得られる。

**実装で判明した事項**

- eeschemaは同一座標のpinを接続するため、読みやすさのための再配置が意図しない接続を
  作り得ます。異なるsymbol間のpin重なりを検出して停止する検査を入れました
  （実際に初回実装でJ1とR7のpin重なりを検出しました）。
- 機能ブロックはfixtureのpartには宣言されておらず、WP3のrationaleにしかありません。
  読みやすさが設計根拠の副産物として得られる形になりました。

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
