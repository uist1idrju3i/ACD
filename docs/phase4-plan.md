# Phase 4実装計画

**ステータス：Draft（未着手。ADR-0024〜0027は未決定）**

## 目的と権威範囲

Phase 4はREADME §7の「4 実行基盤とブラウザUX」を実装するフェーズです。READMEの
完了条件は、**設計ランを途中でブラウザ強制終了しても、最後のチェックポイントから
完走できる**ことです。本書はその完了条件をwork packageへ分解し、各WPの受入基準と
停止条件を定義します。フェーズ境界と完了条件の権威は[`../README.md`](../README.md)であり、
本書はそれを実装契約へ落とすだけです。

READMEの「やらないこと」により、Phase 4では**全エンジンのWASM化**を行いません。
WASM化は§9の「高速チェック」に限定し、外部processで動く`kicad-cli`とngspiceの置き換えは
対象外です（[`adr/0020-spice-engine-ngspice-external-process.md`](adr/0020-spice-engine-ngspice-external-process.md)）。
FWパッケージと仮想実機はPhase 5、自働発注はPhase 6、cron型の常設運用はPhase 7の範囲です。

## Phase 3からの入力

- Gate 1〜12、14〜22は実装・合格済み、Gate 13は実機測定待ちです
  （[`phase3-retrospective.md`](phase3-retrospective.md)）。
- 再利用できる基盤：append-only event log（`checkpoint.created`／`run.resumed`の
  イベント型を含む）、revision付きpatch、input hashとtool versionを持つEvidence、
  gate matrixの`runsAfter`、KnowledgeItemのライフサイクル、library overlay revision。
- 既に**契約だけ存在し、runtimeが無い**もの（Phase 4の主対象）：
  - `TaskLedgerEntry`（[`../schemas/design-graph.schema.json`](../schemas/design-graph.schema.json)）は
    schemaと[`agent-runtime.md`](agent-runtime.md)にあるが、台帳を駆動するruntimeが無い。
  - `checkpoint.created`／`run.resumed`はイベント型としてあるが、checkpointを書き、
    そこから再開するorchestratorが無い。
  - 予算・ウォッチドッグ・無進捗検知は[`agent-runtime.md`](agent-runtime.md)の記述のみ。
  - tool request／result／error envelopeは[`tool-contract.md`](tool-contract.md)と
    [`error-taxonomy.md`](error-taxonomy.md)の記述のみで、機械検証可能なschemaが無い。
  - ブラウザUI、viewer、WASMモジュールは未実装（`apps/`は存在しない）。
- 現状のPhase 1〜3のrunは`scripts/*.mts`の単発runnerであり、途中終了すると先頭から
  やり直します。README §7 Phase 4の完了条件は、この構造では測定できません。

## 未決定事項（ADR化が必要）

以下の設計判断はADR-0024〜0027に記録済みです。ADRは実装前のProposedとして保持し、
実装時の契約と検証方法を固定します。

| #        | 決定事項                         | 推奨案                                                                                                                                                                                                                                                                                                                                                                              | 影響          |
| -------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| ADR-0024 | 長時間ランの所有者と永続化形式   | [ADR-0024](adr/0024-long-running-run-ownership-and-persistence.md)：ランはworker processが所有し、台帳・checkpointはappend-only JSONL（`.acd/runs/<runId>/`）で保持する。ブラウザは再接続して状態を見る端末に限定し、IndexedDB／OPFSはPhase 4では採用しない                                                                                                                         | WP1、WP2、WP6 |
| ADR-0025 | checkpointの粒度と無効化条件     | [ADR-0025](adr/0025-checkpoint-granularity-and-invalidation.md)：checkpointはgate境界単位。input revision／hash、tool／model／library／container version、provenance、measurement-system qualification、fab／manufacturing profile、参照KnowledgeItem statusのいずれかが変わったcheckpointはstaleとして再実行する（再利用しない）。完了条件の受入測定はworker process強制終了とする | WP2、WP3      |
| ADR-0026 | 高速チェックのWASM対象と実装言語 | [ADR-0026](adr/0026-fast-check-wasm-scope-and-language.md)：対象は幾何系の高速チェック（pad間クリアランス、mask sliver、courtyard重なり）に限定。native TS実装を正とし、WASMは同一入力で同一結果を返すparityテスト付きの高速経路として追加する。言語は未決定（Rust推奨）                                                                                                            | WP7           |
| ADR-0027 | ブラウザUIの技術選択と範囲       | [ADR-0027](adr/0027-browser-ui-scope-and-technology.md)：README §7更新後のPhase 4受入対象をread-onlyの投影ビューア（2D）、リビジョン差分レビュー、タスク台帳／停止理由の表示に限定し、編集UI、3Dビューア、タブレット最適化は後続フェーズへ移す。UIフレームワークは未決定                                                                                                            | WP6           |

## Work packages

### WP1：タスク台帳runtime（gate 23）

**状態：未着手。** gate契約案はgate 23（`gate:task-ledger-integrity`、`runsAfter: gate:knowledge-application`）。

**作業**

- `packages/graph-core`に台帳のstate machineを実装する。状態はschemaのenumである
  `pending`、`running`、`blocked`、`completed`、`failed`、`cancelled`とし、遷移は決定論的に
  検査する。承認待ちと停止はstatusを増やさず、`blocked`と承認状態／停止理由フィールドで
  表現する。
- エントリは安定ID、目的、入力revision、依存関係、受入条件、試行回数、リトライ予算、
  時間／トークン／金額予算、承認状態、停止理由、checkpoint ID、成果物ID、結果IDを持つ
  （[`agent-runtime.md`](agent-runtime.md)の契約を参照し、状態名の権威は
  [`../schemas/design-graph.schema.json`](../schemas/design-graph.schema.json)とする）。
- 永続化は`packages/adapters/storage-fs`にappend-onlyで実装し、coreはfilesystemを知らない。
- 台帳の各遷移をevent logへ追記し、event列から台帳状態を再構成できることをテストで固定する。
- ラン所有者をworker processとする前提は、AcceptedのADR-0004（browser-first、optional
  workers）および[`architecture.md`](architecture.md)のブラウザのみ／ワーカーモードを
  廃止せず、Phase 4のワーカーモードの実行形態として補完するものとして
  [`adr/0024-long-running-run-ownership-and-persistence.md`](adr/0024-long-running-run-ownership-and-persistence.md)
  で扱う。
- 将来statusの拡張が必要と判明した場合は、WP8でschema更新と`pnpm typegen-sync`まで行う。

**受入基準**

- 台帳状態がevent列から決定論的に再構成でき、両者の不一致で停止する。
- 停止・不合格・承認待ちのエントリが、そのまま可視な形で列挙できる。
- 依存関係が満たされていないエントリは`running`へ遷移できない。
- コンテキスト圧縮や再起動で未完了エントリが消えないことを回帰で示す。

**停止条件**

- 不正な状態遷移、参照先revisionの欠落、event列との不一致、リトライ予算超過。

### WP2：チェックポイントと再開（gate 24）

**状態：未着手。** gate契約案はgate 24（`gate:checkpoint-resume`、`runsAfter: gate:task-ledger-integrity`）。

**作業**

- gate境界ごとにcheckpointを書く。内容はinput revision／hash、設計グラフrevision、
  tool／model／library／container version、provenance、measurement-system qualification、
  fab／manufacturing profile、参照KnowledgeItem status、成果物hash、検証結果ID、event位置、
  実行環境とする。
- 再開orchestratorを実装する。台帳とevent logから最後の**検証済み**checkpointを決め、
  そこから続行する。checkpointの前提が変わっている場合は再利用せず再実行する（ADR-0025）。
- 再開は冪等とし、同じ副作用を二重に起こさない。再開時は`run.resumed`を追記する。
- checkpointの読み書きは明示的なport越しに行い、決定論的テストで差し替えられるようにする。

**受入基準**

- 中断後の再開で、成果物hashが無中断runと一致する。
- checkpointより前のstageが再実行されないことを、実行stageの記録で示す。
- input revision／hash、tool／model／library／container version、provenance、
  measurement-system qualification、fab／manufacturing profile、参照KnowledgeItem statusの
  いずれかが変わったcheckpointは再利用されず、staleとして再実行される（AGENTS.mdの
  Evidence無効化条件およびADR-0025に一致）。
- 未検証・失敗stageのcheckpointからは再開せず、停止してEvidenceを残す。

### WP3：中断・再開のgolden task（README完了条件の測定）

**状態：未着手。**

**作業**

- `scripts/phase4-resume.mts`を追加し、Phase 1〜3のgateパイプラインを台帳＋checkpoint上で
  実行する耐久runとして回す。
- 決定論的なstage境界でランを所有するworker processを強制終了し、再開して完走させる。
  受入gateの測定はworker process killを正とする。ランの所有者はブラウザではなくworkerで
  あり、完了条件の本質はworker側の耐久性にあるためである。
- このworker-owned runの受入経路は、AcceptedのADR-0004（browser-first、optional workers）
  と[`architecture.md`](architecture.md)のブラウザのみ／ワーカーモードを廃止せず補完する
  判断として、[`ADR-0024`](adr/0024-long-running-run-ownership-and-persistence.md)で扱う。
- 比較対象は「無中断run」と「強制終了→再開run」で、最終成果物hash、gate結果、
  event列（中断・再開イベントを除く）が一致することを検証する。
- 結果を`artifacts/phase4/resume.json`としてEvidence化する（中断位置、再開したcheckpoint、
  再実行したstage一覧、再実行しなかったstage一覧、hash比較）。

**受入基準**

- 強制終了→再開で完走し、成果物hashが無中断runと一致する。
- 再開が「要件からのやり直し」になっていないことが、再実行stage一覧で示される。
- 中断位置を変えた複数ケース（配線後、DRC後、gate 20後など）で同じ結論が得られる。
- worker process強制終了後の再開で、無中断runと同じ完了条件を満たす。
- 両runが決定論的である。

### WP4：予算、ウォッチドッグ、無進捗検知（gate 25）

**状態：未着手。** gate契約案はgate 25（`gate:run-budget-watchdog`、`runsAfter: gate:checkpoint-resume`）。

**作業**

- ランとタスクに、時間、ツール呼び出し回数、トークン、金額、反復回数の上限を持たせる。
- 上限に達する**前**に停止するウォッチドッグを実装する。clockは明示的なportにする。
- 無進捗検知を実装する：同一入力hashに対する同一修正の反復、成果物hashの変化なし、
  gate結果の改善なし、修復の振動。
- 停止時は理由、既知・不確実、選択肢、推奨、再開位置を台帳とEvidenceへ記録する。

**受入基準**

- 予算超過が停止として記録され、下流へ流れない。
- 無進捗パターンを注入した回帰で、上限到達前に停止する。
- 停止理由と再開条件が機械可読に残る。
- ウォッチドッグ自身が決定論的（注入clockで再現可能）である。

### WP5：型付き冪等ツール境界のschema化

**状態：未着手。**

**作業**

- [`tool-contract.md`](tool-contract.md)のrequest／result envelopeと
  [`error-taxonomy.md`](error-taxonomy.md)のerror envelopeを、機械検証可能なschemaにする
  （現状は文書のみで、error envelope schemaは未定義と明記されている）。
- 相関ID、冪等性キー、timeout、cancel、retry予算、Evidence IDを必須項目として型付ける。
- 既存の外部process呼び出し（`kicad-cli`、ngspice、freerouting）をこのenvelope越しにそろえ、
  再試行で二重の副作用が起きないことをテストで固定する。

**受入基準**

- envelopeが`pnpm schema:validate`の対象になり、docsとschemaが同期する。
- 同じ冪等性キーでの再試行が副作用を二重化しない。
- エラーがtaxonomyのコードへ必ず分類され、未分類は停止する。

### WP6：ブラウザUX（read-onlyビューアと差分レビュー）

**状態：未着手。**

**作業**

- `apps/web`を追加し、台帳、gate結果、停止理由、checkpoint、Evidenceをread-onlyで表示する。
- 設計グラフのrevision間差分レビュー（変更したnet、部品、配置、gate結果、根拠）を表示する。
- 2Dの投影ビューア（pad、track、via、courtyard、mask）をread-onlyで表示する。
  表示は成果物からの投影に限定し、UIが正のデータを作らない。
- ブラウザ切断・再接続でランが継続していることを表示できる（ランの所有者はworker）。
- 実ブラウザをPlaywrightで強制終了し、再接続後もworkerがランを継続していることを
  表示できるUI回帰を追加する。
- README §7更新後のPhase 4範囲として、3Dビューア／タブレット対応は後続フェーズへ移し、
  Phase 4ではread-only 2Dビューアを受け入れる（[`ADR-0027`](adr/0027-browser-ui-scope-and-technology.md)）。

**受入基準**

- UIは設計グラフとEvidenceを変更しない（read-only）。
- 表示値は必ず成果物IDまたはEvidence IDへ辿れる。要約値を権威として表示しない。
- ブラウザを閉じてもランが継続し、再接続で最新状態が見える。
- Playwrightによる実ブラウザ強制終了後、再接続してラン継続と最新状態を確認できる。

**やらないこと**

- 編集UI、対話的な設計変更（Phase 4受入対象外）。
- 3Dビューアの本格実装、タブレット最適化は、更新済みREADME §7のPhase 4範囲外として
  後続フェーズで扱う（[`ADR-0027`](adr/0027-browser-ui-scope-and-technology.md)）。

### WP7：高速チェックのWASM化

**状態：未着手。**

**作業**

- 対象は幾何系の高速チェックに限定する（pad間クリアランス、mask sliver、courtyard重なり）。
- native TS実装を正とし、WASM経路は同一入力で同一結果になるparityテストを必須にする。
- WASMモジュールのversion、build digest、tool chainをEvidenceへ記録する。

**受入基準**

- 同一fixture集合でnativeとWASMの結果が完全一致する（不一致は停止）。
- WASM経路のprovenance（build digest、toolchain version）がEvidenceに残る。
- WASMが使えない環境ではnative経路へ決定論的にフォールバックする。

**やらないこと**

- `kicad-cli`、ngspice、routerのWASM化（READMEの「やらないこと」）。

### WP8：docsとschemaの同期、振り返り

**状態：未着手。**

**作業**

- gate 23〜25をgate matrixへ登録し、[`gates.md`](gates.md)を再生成する。
- [`agent-runtime.md`](agent-runtime.md)、[`architecture.md`](architecture.md)、
  [`repo-structure.md`](repo-structure.md)、[`event-log.md`](event-log.md)、
  [`error-taxonomy.md`](error-taxonomy.md)を実装に合わせて更新する。
- ADR-0024〜0027を記録し、`docs/phase4-retrospective.md`に測定結果と教訓を残す。

**受入基準**

- `pnpm schema:validate`／`pnpm gates:check`／`pnpm typegen-sync`が同期を示す。
- 実装と乖離した記述が残らない。

### WP9：Phase 3残債（Phase 4受入対象外）

**状態：未着手。着手可否は未決定。**

[`phase3-retrospective.md`](phase3-retrospective.md)が挙げた知識ループの残債です。README §7の
Phase 4完了条件には含まれないため、Phase 4の受入gateには入れず、独立した契約変更として扱います。

- Gate 22でのreopen／DRC拡張（現状のGate 22はprojectionと適用記録までで、patched boardの
  reopen／DRCはGate 21のみが実行している）。
- overlay library revisionをboardから直接参照するモデル（現状はboard sourceへの
  materialize）。
- 未宣言の必須process条件を`fail`とするか`unknown`とするか。
- deprecated知識の伝播範囲の一般化。
- 実fab reportのadapter（現状はfixture、[`adr/0021-fab-feedback-intake-source.md`](adr/0021-fab-feedback-intake-source.md)）。
- `fixtures/phase3/component-library.json`をprojectionの部品選定入力として消費する経路。

## 実行順の案

```text
WP1 → WP2 → WP3 → WP4 → WP5 → WP6 → WP7 → WP8
```

WP3はWP1・WP2の完成後に測定できます。WP5はWP4と独立に進められますが、WP6・WP7が
外部境界を増やす前に入れる方が手戻りが小さくなります。WP9はPhase 4の受入とは独立です。

## リスク登録簿

| リスク                          | 影響                               | 現在の対策                                                                                                      | 次の判断                       |
| ------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 汎用workflow engineへの過剰投資 | 実装が肥大しループが止まる         | 台帳＋不変revision＋checkpoint APIというengine非依存契約から始める                                              | 必要になった時点でADRで判断    |
| checkpointの誤再利用            | 古い前提の結果を合格として引き継ぐ | 無効化条件を[ADR-0025](adr/0025-checkpoint-granularity-and-invalidation.md)で固定し、staleは再実行              | 実装時にstale判定を検証        |
| WASMとnativeの結果差            | 高速経路が別の判定を出す           | parityテスト必須、不一致で停止（[ADR-0026](adr/0026-fast-check-wasm-scope-and-language.md)）                    | 差が出た場合はWASM経路を無効化 |
| ブラウザUIが正のデータを作る    | 設計グラフの権威が崩れる           | UIはread-only、表示値をEvidence IDへ紐付け（[ADR-0027](adr/0027-browser-ui-scope-and-technology.md)）           | 編集UIは範囲外として明示       |
| 完了条件の測定方法の解釈差      | 完走を主張できない                 | worker process強制終了を受入gateの正として[ADR-0025](adr/0025-checkpoint-granularity-and-invalidation.md)で固定 | WP3／WP6の測定を分離           |
| フェーズ境界の逸脱              | 全エンジンWASM化やPhase 5/6へ拡大  | READMEの「やらないこと」を受入基準に反映                                                                        | 逸脱時は停止しエスカレート     |

## 関連文書

- [`../README.md`](../README.md#7-ロードマップ)
- [`agent-runtime.md`](agent-runtime.md)
- [`architecture.md`](architecture.md)
- [`event-log.md`](event-log.md)
- [`tool-contract.md`](tool-contract.md)
- [`error-taxonomy.md`](error-taxonomy.md)
- [`patch-revision.md`](patch-revision.md)
- [`phase3-plan.md`](phase3-plan.md)
- [`phase3-retrospective.md`](phase3-retrospective.md)
- [`golden-tasks.md`](golden-tasks.md)
- [`../schemas/gate-matrix.json`](../schemas/gate-matrix.json)
