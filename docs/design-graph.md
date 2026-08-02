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

| 型 | 役割 | 主なリンク |
|---|---|---|
| `Project` | 設計ランと目的の入れ物 | requirements, layouts, packages, revisions |
| `Requirement` | ユーザーの目的、性能、コスト、納期 | constraints, evidence, test items |
| `Constraint` | 電気、機械、製造、調達、予算、ライセンス条件 | source, severity, verification |
| `FunctionalBlock` | 電源、MCU、センサーなどの機能分解 | components, nets, rationale |
| `Component` | 設計上の論理部品 | part, pins, footprint, rationale |
| `Part` | MPN、代替、データシート、在庫を持つ実部品 | datasheet evidence, sourcing evidence |
| `Footprint` | パッド、穴、courtyard、3Dモデル、製造制約 | part, fab rules, revisions |
| `Net` | ピン間の電気接続とネットクラス | pins, constraints, verification |
| `Pin` | 部品の物理・論理ピン | component, net, datasheet page |
| `Layout` | 配置、配線、ゾーン、層、ルール | board stackup, DRC results |
| `BoardStackup` | 層構成、材料、厚さ、銅厚、インピーダンス | fab profile, SI evidence |
| `ManufacturingPackage` | Gerber、drill、IPC-2581、BOM、pick-and-place | layout revision, output checks |
| `FirmwarePackage` | ピン割り当て、ペリフェラル設定、HALスタブ、ビルド情報 | components, test items |
| `TestItem` | 仮想・実機の試験項目と合否 | rationale, measurement evidence |
| `Rationale` | 判断理由、代替案、仮定、リスク | evidence, test items |
| `Evidence` | データシート、fabルール、シミュレーション、測定 | evidence kind, observations, provenance |
| `KnowledgeItem` | 再利用可能な標準、修正、経験則 | source events, scope, confidentiality, content |
| `TaskLedgerEntry` | 実行状態、依存、予算、停止、完了条件 | graph revision, checkpoint, retry budget |
| `VerificationResult` | 検証ゲートの入力、結果、所見 | gate, status, tool version, evidence |
| `Approval` | 人間または認可主体による範囲付き承認 | approval ID, scope, expiry |
| `Waiver` | 検証警告・免除の理由と期限 | gate, risk, approval ID, expiry |

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

`uncertainty`には、少なくとも状態（`unknown`、`assumed`、`inferred`、`verified`）、説明、影響範囲、解消方法、期限を記録します。黙った補完は禁止です。

機械制約は既存の`Constraint`で表します。たとえば、`source.kind = "mechanical"`、`source.locator = "enclosure://case-a/rev-3"`、`attributes = { "constraint": "maxComponentHeight", "value": 8, "unit": "mm" }`のように、筐体・取付穴・外形・keepout・コネクタ位置・最大高さを記録します。`Layout.attributes`にはboard outline、mounting holes、keepoutsを、`BoardStackup.attributes`には基板厚・部品高さ包絡・機械クリアランスを保持できます。専用`MechanicalInterface` Entityは、IDXや複数部品の所有権同期が必要になるまで将来候補とします。

## 将来のエンティティ候補

卓上製造機、導電性フィラメント、導電性ペースト／インク印刷を扱うPhase 8では、機体、材料、校正、層・線幅・抵抗率・異方性・電流能力・硬化温度・耐久性を束ねる`PrinterProfile`または`ManufacturingProfile`が必要になる可能性があります。現時点ではEntity enumへ追加せず、`BoardStackup`と`Constraint`で表現できるかを比較する将来候補とします。筐体表面や埋め込み配線を回路として扱う構造エレクトロニクスも将来方向ですが、設計グラフを平面PCBに固定しないことだけを要件とし、Phase 1のスコープには含めません。

## パッチとリビジョン

パッチは`baseRevision`、`patchId`、操作列、作成者（agent/human/tool）、時刻、検証結果を持ちます。パッチ適用は純粋な検査可能操作とし、競合時は自動マージせず停止します。イベントログはグラフリビジョンを参照しますが、過去リビジョンを上書きしません。

## 関連文書

- [`pipeline.md`](pipeline.md)：グラフを更新する6ステップ
- [`verification-gates.md`](verification-gates.md)：グラフを進める合否ゲート
- [`knowledge-base.md`](knowledge-base.md)：知識と根拠の書き戻し
- [`../README.md`](../README.md#設計原則)
