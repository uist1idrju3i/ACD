# 正規設計グラフ

**ステータス：Draft**

## 目的と権威範囲

本書はREADMEの「設計原則」と「0 データモデル」を具体化します。ACDの正規成果物は回路図ではなく、意図・制約・電気接続・物理成果物・根拠を持つ型付き設計グラフです。機械可読なPhase-0契約は [`../schemas/design-graph.schema.json`](../schemas/design-graph.schema.json) です。今回追加したEntity型以外の固有フィールドのSchema厳密度は、フェーズごとに段階的に強化し、判断は後続の設計更新で行います。

## 基本契約

- 各エンティティは安定した`id`、`type`、整数の`revision`を持つ。
- リビジョンは不変です。変更はappend-onlyのパッチとして記録し、新しいリビジョンを生成します。
- 設計グラフのスナップショット、パッチ、検証結果、承認、測定は相互にIDで参照します。
- 不確実性、未確認の仮定、チューニングが必要な値を省略せず明示します。
- LLMの文章は根拠ではありません。根拠は証拠オブジェクトと検証ゲートの結果です。

## エンティティ

| 型                     | 役割                                                  | 主なリンク                                     |
| ---------------------- | ----------------------------------------------------- | ---------------------------------------------- |
| `Project`              | 設計ランと目的の入れ物                                | requirements, layouts, packages, revisions     |
| `Requirement`          | ユーザーの目的、性能、コスト、納期                    | constraints, evidence, test items              |
| `Constraint`           | 電気、機械、製造、調達、予算、ライセンス条件          | source, severity, verification                 |
| `FunctionalBlock`      | 電源、MCU、センサーなどの機能分解                     | components, nets, rationale                    |
| `Component`            | 設計上の論理部品                                      | part, pins, footprint, rationale               |
| `Part`                 | MPN、代替、データシート、在庫を持つ実部品             | datasheet evidence, sourcing evidence          |
| `Footprint`            | パッド、穴、courtyard、3Dモデル、製造制約             | part, fab rules, revisions                     |
| `Net`                  | ピン間の電気接続とネットクラス                        | pins, constraints, verification                |
| `Pin`                  | 部品の物理・論理ピン                                  | component, net, datasheet page                 |
| `Layout`               | 配置、配線、ゾーン、層、ルール                        | board stackup, DRC results                     |
| `BoardStackup`         | 層構成、材料、厚さ、銅厚、インピーダンス              | fab profile, SI evidence                       |
| `ManufacturingPackage` | Gerber、drill、IPC-2581、BOM、pick-and-place          | layout revision, output checks                 |
| `FirmwarePackage`      | ピン割り当て、ペリフェラル設定、HALスタブ、ビルド情報 | components, test items                         |
| `TestItem`             | 仮想・実機の試験項目と合否                            | rationale, measurement evidence                |
| `Rationale`            | 判断理由、代替案、仮定、リスク                        | evidence, test items                           |
| `Evidence`             | データシート、fabルール、シミュレーション、測定       | evidence kind, observations, provenance        |
| `KnowledgeItem`        | 再利用可能な標準、修正、経験則                        | source events, scope, confidentiality, content |
| `TaskLedgerEntry`      | 実行状態、依存、予算、停止、完了条件                  | graph revision, checkpoint, retry budget       |
| `VerificationResult`   | 検証ゲートの入力、結果、所見                          | gate, status, tool version, evidence           |
| `Approval`             | 人間または認可主体による範囲付き承認                  | approval ID, scope, expiry                     |
| `Waiver`               | 検証警告・免除の理由と期限                            | gate, risk, approval ID, expiry                |

`KnowledgeItem`は`sourceEventIds`、`provenance`、`scope`、`status`、`knowledgeId`を必須の
ライフサイクル情報として持ちます。`appliesWhen`と`excludesWhen`は
`{ field, operator, value }`の構造化条件で、fab profile、part、footprint、rule、分類、
再現条件を表します。元の設計revisionは`provenance`に記録し、適用条件には含めません。
版の変更は`previousRevisionId`で旧版を参照し、却下理由、承認ID、信頼度、stale理由を
追加記録できます。

## 設計根拠

`Rationale`は最低限、次を持ちます。

- `reason`：何を達成する判断か
- `alternativesConsidered`：比較した代替案と不採用理由
- `assumptions`：設計時点の仮定と確認状態
- `evidenceLinks`：証拠IDの一覧
- `risks`：残存リスク、重大度、軽減策
- `tuningNeeded`：実機での調整が必要か
- `generatedTestItemIds`：チューニングや高リスク判断から生成したStep-6試験項目

「この容量は実機で要チューニング」のような注記は単なるコメントではなく、`TestItem`を生成する入力です。

## 出所と不確実性

`provenance`は「どこから来たか」を表すソースメタデータです。たとえば、部品選定のデータシートURLとページ番号、fabルールの版、在庫APIの応答ハッシュを記録します。

`Evidence`は、そのソースまたは検査で観測された事実・検証成果物です。たとえば、指定リビジョンの基板で測定した3.31 V、測定条件、測定器、時刻、合否、対応する測定ファイルを`Evidence`として保存し、データシートのページを`provenance`として参照します。部品、フットプリント、ネット、ルールは出所なしに確定状態へ進めません。

`uncertainty`には、少なくとも状態（`unknown`、`assumed`、`inferred`、`verified`、`rejected`）、説明、解消方法（`resolution`）、影響範囲（`impactScope`）、期限（`dueAt`）を記録します。期限の到達で自動的に解消扱いにせず、期限切れの未解消事項は停止条件として扱います。解消は測定、ツール出力、出所付き資料などの`Evidence`で示します。黙った補完は禁止です。

機械制約は既存の`Constraint`で表します。たとえば、`source.kind = "mechanical"`、`source.locator = "enclosure://case-a/rev-3"`、`attributes = { "constraint": "maxComponentHeight", "value": 8, "unit": "mm" }`のように、筐体・取付穴・外形・keepout・コネクタ位置・最大高さを記録します。`Layout.attributes`にはboard outline、mounting holes、keepoutsを、`BoardStackup.attributes`には基板厚・部品高さ包絡・機械クリアランスを保持できます。専用`MechanicalInterface` Entityは、IDXや複数部品の所有権同期が必要になるまで将来候補とします。`source.*`は`Constraint`側の外部出所属性であり、Schemaの`Provenance.kind` enumとは別物です。

## 将来のエンティティ候補

卓上製造機、導電性フィラメント、導電性ペースト／インク印刷を扱うPhase 8では、機体、材料、校正、層・線幅・抵抗率・異方性・電流能力・硬化温度・耐久性を束ねる`PrinterProfile`または`ManufacturingProfile`が必要になる可能性があります。Phase 0/1では独立Entityを追加せず、`fabProfileId`等の外部製造プロファイル参照を属性または入力として扱い、`BoardStackup`と`Constraint`で表現できる範囲を使います。独立したEntityへの昇格と正式名称は将来ADRで決定します。筐体表面や埋め込み配線を回路として扱う構造エレクトロニクスも将来方向ですが、設計グラフを平面PCBに固定しないことだけを要件とし、Phase 1のスコープには含めません。

## パッチとリビジョン

パッチは`baseRevision`、`patchId`、操作列、作成者（agent/human/tool）、時刻、検証結果を持ちます。パッチ適用は純粋な検査可能操作とし、競合時は自動マージせず停止します。イベントログはグラフリビジョンを参照しますが、過去リビジョンを上書きしません。

## 変更影響分析（差分開発）

リビジョン`N`から`N+1`への差分開発では、まず`N+1`へ適用されたパッチの操作列から変更セット（変更されたEntity、属性、リンク、削除・追加）を抽出します。影響分析はこの変更セットを起点に、リンク型ごとの伝播規則で設計グラフを辿ります。たとえば、`Pin → Net → Component → Layout`領域 → ルール → `Rationale` → `TestItem`、または`Requirement → Constraint`のような経路を対象に、直接影響、間接影響、潜在影響を分類し、理由と根拠リンクを保存します。

分析結果から、変更点×影響先Entity／工程の相互影響マトリクス、変更影響レポート、再実行が必要な検証ゲート・`TestItem`、レビューが必要な`Rationale`を生成します。マトリクスとレポートは正規設計グラフではなく、対象リビジョンと`patchId`を参照する再生成可能な投影です。影響伝播のリンクが`unknown`または未定義の場合は影響を狭く見積もらず、より広い再検証へフォールバックします。

`VerificationResult`は検証入力のグラフリビジョン、関連パッチ、入力ハッシュを参照します。依存するEntityまたは属性が変更されたとき、過去の結果は自動的にstale（再検証待ち）となり、staleな結果を合格証拠として下流へ流しません。これにより、差分開発では影響範囲だけを効率的に再検証しつつ、jidokaの停止・通知・証拠追跡を維持できます。

知識のdeprecation伝播では、成功済みの依存結果だけをstaleへ更新し、failed・blocked・waivedなど成功以外の記録は上書きせず保全します。staleへ更新したEntityはrevisionをインクリメントし、伝播時に保全したEntity IDもEvidenceへ記録します。

## 監査文書の生成投影

設計グラフと追記専用イベント履歴から、要求トレーサビリティマトリクス、設計履歴・レビュー記録、変更管理（ECR/ECO相当）、検証・試験報告、出所付きBOM／部品トレーサビリティ、`Rationale.risks`を起点とするFMEA風ビュー、PPAP／PSW相当の量産引き渡し証拠パッケージを生成できます。後者では、設計記録をグラフrevision、ECN/ECOをpatchと影響マトリックス、DFMEAをリスク付きRationale、Process Flow／Control Planを外部製造プロファイル参照（Phase 0/1では`fabProfileId`等）、ゲート、TestPlan、測定・性能結果をEvidence、PSWをApproval／提出記録へ対応させます。`ManufacturingProfile`を独立Entityとして扱うかは将来ADRで決定します。各文書は対象グラフリビジョン、イベント範囲、`patchId`、入力ハッシュ、証拠リンクを含む派生成果物であり、正規設計グラフを置き換えません。再生成時に現在の設計状態と一致しない古い文書はstaleとして扱います。PPAPの提出レベル、顧客固有様式、顧客承認をACD単体で保証するものではありません。

ISO 9001の設計記録、ISO 13485／FDAのDHF・DMR・設計管理、AS9100／IATFのリスク・変更・初回品記録と整合する形へ拡張できますが、これらの文書投影は認証や法規制適合そのものを保証しません。

## 関連文書

- [`pipeline.md`](pipeline.md)：グラフを更新する6ステップ
- [`verification-gates.md`](verification-gates.md)：グラフを進める合否ゲート
- [`knowledge-base.md`](knowledge-base.md)：知識と根拠の書き戻し
- [`patch-revision.md`](patch-revision.md)：patchとリビジョンの適用契約
- [`event-log.md`](event-log.md)：追記専用イベントとreplay
- [`../README.md`](../README.md#設計原則)
