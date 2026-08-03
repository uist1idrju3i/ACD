# Phase 3実装計画

**ステータス：Draft（WP1〜WP7実装済み。振り返りは[`phase3-retrospective.md`](phase3-retrospective.md)）**

## 目的と権威範囲

Phase 3はREADME §7の「3 知識ループ」を実装するフェーズです。READMEの完了条件は、
**1次試作で受けたDFM指摘・フットプリント修正が、2次試作の設計で自動的に回避される**
ことです。本書はその完了条件をwork packageへ分解し、各WPの受入基準と停止条件を
定義します。フェーズ境界と完了条件の権威は[`../README.md`](../README.md)であり、
本書はそれを実装契約へ落とすだけです。

README §7の完了条件にある「1枚目…2枚目」は、本計画ではそれぞれ「1次試作」「2次試作」
を意味します。

READMEの「やらないこと」により、Phase 3では**組織間の知識共有**を実装しません。
`library-wide`は[`knowledge-base.md`](knowledge-base.md)の定義どおり「同一ユーザーが
複数プロジェクトで再利用する個人ライブラリ」に限定し、テナント、fab共有、コミュニティ
配布は対象外です。ブラウザUX、タスク台帳、チェックポイント再開はPhase 4、FWパッケージは
Phase 5、自働発注はPhase 6の範囲であり、本フェーズでは扱いません。

## Phase 2からの入力

- Gate 1〜12、14〜18は実装・合格済み、Gate 13は実機測定待ちです
  （[`phase2-retrospective.md`](phase2-retrospective.md)）。
- 既存の再利用可能な基盤：append-only event log（[`event-log.md`](event-log.md)）、
  revision付きpatch（[`patch-revision.md`](patch-revision.md)）、`Rationale`／`Evidence`／
  `VerificationResult`／`TestItem`、KiCad library snapshot（container digest、content hash、
  license manifest）、Gate 10のDRC/DFM検証、gate matrixの`runsAfter`。
- `KnowledgeItem`はschemaに形だけ存在し（[`../schemas/design-graph.schema.json`](../schemas/design-graph.schema.json)）、
  生成・遷移・適用のいずれも未実装です。fab報告の取り込み、footprint修正のlibrary反映、
  次設計への自動適用も未実装です。
- Phase 2のレトロスペクティブが挙げた残課題のうち、**未知故障への一般化**は本フェーズの
  知識ループと合わせて評価します。

## 設計上の前提（決定済み）

以下はWP着手前に確定した決定であり、対応するADRを実装契約とします。

1. **fab報告の入力源**：実fabのDFM指摘を継続的に取得できる保証がないため、CIは
   記録済みfab report fixtureで回し、実報告の取り込みはopt-inのadapterとします
   （[`ADR-0021`](adr/0021-fab-feedback-intake-source.md)、Phase 2のrepair loopと同じ考え方）。記録済みfixtureは実際のfab指摘の
   書式を模したものであり、fixtureであることをEvidenceのprovenanceへ明記します。
2. **library-wide昇格の承認**：`knowledge-base.md`は「プロジェクト固有の知識を、同意なく
   library-wideへ昇格させない」と定めます。一方READMEのデフォルトは無人実行です。
   本計画では、`project-local`での採用と適用は自働で行い、`library-wide`への昇格のみ
   承認IDを要求します（[`ADR-0022`](adr/0022-knowledge-scope-promotion-approval-boundary.md)）。
3. **libraryの版管理モデル**：公式KiCad snapshotは不変の上流とし、ACDの修正は
   snapshotを書き換えず、出所付きのfootprint overlay patchとその版として保持します
   （[`ADR-0023`](adr/0023-library-versioning-official-snapshot-overlay-patch.md)）。

## Work packages

### WP1：fabフィードバックの構造化取り込み（gate 19）

**状態：未着手。** gate契約はgate 19（`gate:fab-feedback-intake`、`runsAfter: gate:spice`）。

**作業**

- `schemas/fab-feedback.schema.json`を追加し、fab job ID、fab profile、対象設計revision、
  対象part／net／座標、ルール、重大度、原文、構造化した問題分類、再現条件、信頼度を型付ける。
- 記録済みfab report fixtureからの取り込みadapterを実装し、対象設計revisionとの
  ID照合、既知指摘との重複判定、信頼度の下限を検査する。
- 取り込みは`fab.feedback.received`イベントとして追記し、payload hashで固定する。

**受入基準**

- 対象設計revisionに存在しないpart／netを指す報告は`verification-failed`で停止する。
- 同一fab job内の重複指摘が一意化され、件数と一意化根拠がEvidenceに残る。
- 構造化できない自由記述は`unknown`として残り、合格扱いにならない。
- 取り込み結果が決定論的（同一入力で同一hash）である。

**リスク**

- fab報告の書式はfabごとに異なる。adapterはfab profileごとに分離し、未知書式は停止する。

### WP2：KnowledgeItemのライフサイクルと永続化（gate 20）

**状態：実装済み。** gate契約はgate 20（`gate:knowledge-lifecycle`、`runsAfter: gate:fab-feedback-intake`）。

**作業**

- 知識の生成・遷移・保存は`packages/graph-core`と`packages/adapters/storage-fs`に実装した。
- `candidate → reviewed → adopted → deprecated`の遷移を実装し、昇格の必須条件
  （provenance、source event、再現条件、`appliesWhen`／`excludesWhen`）を検査する。
- 知識イベント（`knowledge.candidate.created`、`knowledge.transitioned`、
  `knowledge.applied`）を型付きpayloadで追加する。
- `deprecated`化したとき、その知識を根拠に下した判断と`VerificationResult`を
  遡って洗い出し、staleとして再検証対象にする。

**受入基準**

- 必須条件を欠く昇格が停止する。
- 内容の書き換えではなく新版として記録され、過去版が参照可能である。
- 知識をdeprecatedにすると、依存する下流結果がstaleになり、下流へ流れない。
- 却下された候補、再現しなかった結果も理由付きで残る。

### WP3：フットプリント修正のlibrary反映（gate 21）

**状態：実装済み。** gate契約はgate 21（`gate:library-patch`、`runsAfter: gate:pre-order-readiness`）。

**作業**

- 公式snapshotを不変としたまま、出所付きfootprint overlay patchとその版を保持する
  library revision modelを実装する。
- fab指摘からpatch候補を生成し、幾何検査（pad／courtyard／drill）とGate 10の
  DRC/DFM再実行で決定論的に検証する。
- 検証を通ったpatchだけを`project-local`で採用し、`library-wide`昇格は承認IDを要求する。
- projectionはlibrary revisionを明示的に参照し、参照revisionをEvidenceへ記録する。

**受入基準**

- patch適用後のfootprintが幾何検査とDRCに合格し、不合格patchは採用されない。
- 公式snapshotのcontent hashは不変のままである。
- 同じ入力から同じlibrary revision hashが得られる。
- 承認IDなしの`library-wide`昇格が停止する。

### WP4：次設計への自動適用（gate 22）

**状態：実装済み。** gate契約はgate 22（`gate:knowledge-application`、`runsAfter: gate:library-patch`）。

**作業**

- `appliesWhen`／`excludesWhen`を決定論的に評価し、対象設計へ適用すべき`adopted`
  知識を列挙する。適用条件外の再利用は禁止する。
- 適用可能な知識が未適用のまま下流へ流れる場合に停止する検査を入れる。
- 「どの過去イベントが、どの知識版を経由し、どの判断を変えたか」を追える適用記録
  （`knowledge.applied`）を残す。
- 照合結果が空の場合は「該当なし」を明示的に記録し、未照合と区別する
  （[`reliability-practices.md`](reliability-practices.md)）。

**受入基準**

- 1次試作で採用した知識が、条件に合致する2次試作の設計で自動的に適用される。
- 条件外の設計へは適用されず、その判断根拠が記録される。
- 未照合と「該当なし」が区別できる。
- 適用がLLMの説明ではなく決定論的評価で決まる。

### WP5：2次試作のgolden taskと完了条件の測定

**状態：実装済み。**

**作業**

- 1次試作（`fixtures/phase1/golden-esp32.json`）と影響footprintを共有する、別トポロジーの
  2次試作（`fixtures/phase1/prototype-2.json`）を追加し、1次試作で受けたDFM指摘と同種の
  欠陥を検出する。
- 知識ループなしの対照run（指摘が再発する）と、知識ループありのrun（自動回避される）を
  同一fixtureで比較できる回帰を作る。
- 結果を`knowledge-loop.json`としてEvidence化する。

**受入基準**

- 知識ループなしのrunでは1次試作と同じ指摘が再現する。
- 知識ループありのrunでは人手介入なしに回避され、回避根拠が知識版へ辿れる。
- 両runが決定論的である。

Gate 22では1次試作設計へのKnowledgeItem適用とlibrary revisionの追跡可能性を記録する。
2次試作のcontrolとknowledge-enabledの対照測定は独立した
`scripts/phase3-knowledge-loop.mts`が担当する。controlでは公式library revisionを使用し、
target boardから同じfab-profile rule pathでmask-sliver findingを導出する。profileの最小値は
0.30mmで、USB-C fine-pitch pad間の実測値を使用する。knowledge-enabledではadopted
KnowledgeItemとWP3 overlay revisionを適用し、同findingが0件になることを検証する。

### WP6：電子部品ライブラリの本格整備

**状態：実装中（provenance-backed component records、coverage test、抽出時subset assertionを追加済み）。**

**作業**

- 1次・2次試作のmappingを抽出対象として検査する。prototype-2の部品集合は
  golden-esp32のstrict subsetであるため、公式snapshotのmanifestと22ファイルは変更しない。
  抽出scriptはこのsubset不変条件を検証し、将来prototype-2専用部品が増えた場合は停止する。
- `fixtures/phase3/component-library.json`に、1次・2次試作で使用するsymbolと
  footprint候補を記録する。未取得のdatasheetと実装上の注意は`unknown`として保持し、
  Phase 4以降のlive sourcingを行わない。
- fab feedback、adopted KnowledgeItem、library overlay revisionで実証されたUSB-C
  mask-sliver補正は、検証済みimplementation noteとして記録する。それ以外の未検証属性は
  推測で補完しない。
- 部品エントリにdatasheet参照、footprint候補、既知の注意（実装上の制約、修正履歴）を
  出所付きで持たせる。
- `verified`のdatasheet参照・implementation noteは`provenance.contentHash`を必須とし、
  `contentHash: null`のエントリは`unknown`として`pendingReason`付きで保持する。
- ライセンス帰属（CC-BY-SA-4.0-with-exception）とNOTICEの範囲を拡張分にも維持する。

**受入基準**

- 拡張後もsnapshot hash検証と未知construct停止が機能する。
- 追加部品がfixture mappingと照合でき、projectionが公式geometryを使う。
- ライセンス表記が拡張分を含めて正しい。
- 公式snapshot、manifest、container digest、ライセンスmetadata、NOTICEは変更しない。

**やらないこと**

- 在庫・価格のlive sourcing API連携（Phase 6／7）。

### WP7：docsとschemaの同期、振り返り

**状態：未着手。**

**作業**

- [`knowledge-base.md`](knowledge-base.md)、[`pipeline.md`](pipeline.md)、
  [`event-log.md`](event-log.md)、[`gates.md`](gates.md)、[`repo-structure.md`](repo-structure.md)を
  実装に合わせて更新し、ADR-0021〜0023を記録する。
- `docs/phase3-retrospective.md`に測定済みの結果と教訓を残す。

**受入基準**

- gate matrix、schema、docsが`pnpm schema:validate`／`pnpm gates:check`で同期している。
- 実装と乖離した記述が残らない。

## リスク登録簿

| リスク                             | 影響                                  | 現在の対策                                                            | 次の判断                              |
| ---------------------------------- | ------------------------------------- | --------------------------------------------------------------------- | ------------------------------------- |
| 実fab指摘データの不足              | 知識ループの入力が仮想的になる        | 記録済みfixtureで回し、fixture由来であることをprovenanceへ明記        | 実報告が得られ次第、adapterで差し替え |
| 誤った知識の水平展開               | 過去の指摘が別条件の設計を壊す        | `appliesWhen`／`excludesWhen`の決定論的評価、deprecated時の遡及再検証 | ADR-0022で昇格条件を確定              |
| library汚染                        | 公式snapshotとACD修正の区別が失われる | snapshotは不変、修正はoverlay patchの版として保持                     | ADR-0023で確定                        |
| 知識の量が増えたときの適用判定劣化 | 停止過多、または見落とし              | 三値評価、適用記録、照合結果空の明示                                  | Phase 3の測定結果で再評価             |
| フェーズ境界の逸脱                 | 組織間共有やUXへ範囲が広がる          | READMEの「やらないこと」を受入基準に反映                              | 逸脱時は停止しエスカレート            |

## 関連文書

- [`../README.md`](../README.md#7-ロードマップ)
- [`knowledge-base.md`](knowledge-base.md)
- [`pipeline.md`](pipeline.md)
- [`event-log.md`](event-log.md)
- [`gates.md`](gates.md)
- [`phase2-plan.md`](phase2-plan.md)
- [`phase2-retrospective.md`](phase2-retrospective.md)
- [`golden-tasks.md`](golden-tasks.md)
- [`../schemas/gate-matrix.schema.json`](../schemas/gate-matrix.schema.json)
