# Phase 4振り返り（WP1〜WP8）

**ステータス：Accepted（WP1〜WP4、WP6〜WP8実装済み、WP5は部分実装、WP9は未着手）**

## 目的

Phase 4で実装した実行基盤、ブラウザ観測、幾何系WASM境界について、受入時に得た測定結果と、
次の実装で再利用する教訓を記録します。未実装の機能を完了扱いにせず、残債は停止条件とともに
明示します。実装は`main`の`2f740b5`時点、PR #42、#43、#45、#46、#47、#48、#49、#50です。

## READMEの完了条件に対する結果

README §7 Phase 4の完了条件は、**設計ランを途中で強制終了しても、最後のチェックポイントから
完走できる**ことです。ADR-0025に従い、受入測定はworker processの強制終了で行いました。
`artifacts/phase4/resume.json`が記録する3ケースはいずれも、無中断runと再開runで成果物hash、
gate結果、event列（中断・再開イベントとusage更新を除く）、台帳再構成が一致しています。

| ケース                      | 中断したgate               | 使用したcheckpoint                                 | 一致   |
| --------------------------- | -------------------------- | -------------------------------------------------- | ------ |
| `after-drc`                 | `gate:drc`                 | `checkpoint:checkpoint:gate:drc:0`                 | 全項目 |
| `after-knowledge-lifecycle` | `gate:knowledge-lifecycle` | `checkpoint:checkpoint:gate:knowledge-lifecycle:0` | 全項目 |
| `after-pre-order`           | `gate:pre-order`           | `checkpoint:checkpoint:gate:pre-order:0`           | 全項目 |

event列比較から除外するのは`run.stopped`、`run.resumed`、`task.transitioned(kind=usage-updated)`
だけであり、これらが進めたrevisionも比較対象から外さずに整合を検査します。

## 測定結果

### Gate 23〜25

Gate 23〜25は`appliesTo: ["phase4"]`でscopeを分離し、Phase 1 golden artifactへPhase 4結果を
混在させません。判定はrunが動いたことではなく、次のフィールドの実比較に基づきます。

| gate | Evidence                                        | 判定の根拠フィールド                                                                                     |
| ---- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 23   | Phase 4 runnerの`task.transitioned`列とmanifest | `ledgerReconstruction.equal`、`eventSequenceComparison.equalExcludingInterruptions`                      |
| 24   | baseline／interrupted／resumedの比較            | `verification.passed`、`artifactHashComparison.equal`、`gateResultComparison.equal`、`contextValidation` |
| 25   | 注入した予算・無進捗のstop record               | `injectedBudget.stopRecord`、`injectedNoProgress.stopRecord`、`stopTransitions`                          |

### 予算とunknown

`artifacts/phase4/budget-watchdog.json`では、外部process実行回数を7 gateで実測（`gate:spice` 3、
`gate:routing` 3、`gate:library-patch` 3、`gate:kicad-projection` 2、`gate:manufacturing` 2、
`gate:erc` 1、`gate:drc` 1）し、外部processを持たない14 gateは明示的な0として宣言しました。
run／taskのtoken・moneyはPhase 4では計測せず`unknown`のまま保持し、`unknown`は
`unknown-impact`として停止側に倒します。無進捗は`repeated-proposal`、`unchanged-artifact`、
`unchanged-gate`、`oscillation`の4理由すべてを実runで観測しました。停止理由は
`budget-exceeded`と`unknown-impact`です。

### ブラウザ観測

`artifacts/phase4/wp6-browser-semantic.json`は、DOM実測値として`observedWorkerState: stopped`、
`workerStateAvailableAfterBrowserClose: true`、`duplicateEventsSuppressed: true`、cursorの
`initialPosition: 0` → `receivedPositions: [0, 1]` → `cursorPosition: 2`、再接続後の
`reconnectPosition: 1`と`replayedPositions: [1]`を記録します。courtyardとmaskは`unavailable`
であり、正本データ未提供を表示として明示します。

### 幾何parityとWASM

parity fixtureは13ケースで、native TSと実`.wasm`のfinding列が完全一致します。正本データが
無いケースでは`padClearance`／`maskSliver`／`courtyardOverlap`がいずれも`unknown`を返し、
passへ変換しません。

## 教訓

### WP1〜WP3：worker、checkpoint、KiCad境界

- KiCadのSES import/saveは同じ入力でも保存結果の生バイトが決定的でなく、同一入力の2回importで
  93本中52本の配線セグメント構成が異なった。FreeRouting自体の出力は一致しており、非決定は
  KiCad側にあった。決定論的経路からKiCadのimporterを外し、SESをACD側で型付きグラフへ取り込んで
  traceをグラフからKiCadへ投影する形へ変更した。**正本はグラフであり、外部toolの保存バイト列を
  設計状態の権威にしない。**
- 失敗の帰属は「直前のresult」ではなく「実行中のstage」から取る。gate評価の前に入場を宣言する
  Phase 2の教訓と同じ構造の欠陥が、resume経路で再発した。
- JSONLの回復は末尾の不完全行だけを切り捨て、完全行のJSON破損はtypedなreplay失敗で停止する。
  部分行の寛容な解釈は、破損の黙認と区別できない。
- checkpointは`checkpoint.created` eventと突き合わせ、payloadとcanonical equalityが取れない
  checkpointは採用しない。永続化された`stale`は再利用しない。
- revisionは`events.length`ではなく直前eventの`resultRevision`から導出する。event数を
  revisionの代理にすると、非台帳writerが追記した時点で契約が崩れる。

### WP4：budget watchdogと無進捗

- 無進捗はrun全体の要約では検知できず、同一taskのattemptごとの観測列で測る必要があった。
  repair loop内はjidokaが1反復で止めるため、検知の実測はattempt境界で行う。
- 宣言のない上限を0と解釈しない。未宣言stageの外部process上限は`undefined`とし、0を宣言した
  stageだけを0として扱う。**「宣言がない」と「0である」は別の事実である。**
- 上限が宣言されていてusageが`unknown`なら`unknown-impact`で停止する。unknownは残余予算の
  計算対象にできない。
- 再開後の予算判定は、経過時間・外部process回数・論理tool要求回数を耐久状態から再構成して
  から行う。再構成しないと再開が予算をリセットする。

### WP5：hash semanticsとEvidence

- hash方式の取り違えで、生成物が同一のままGate 5/7/9/14〜20のEvidence hashが一斉に変わった。
  生バイトhashはartifactの同一性に、canonical hashはkey順に依存しない意味的比較に使う。
  hash方式を変更する場合は、protected artifactとEvidenceの影響範囲を先に固定する。
- 冪等性は「registryに記録があること」ではなく、read-modify-writeの全区間を単一ロックで
  保持することで成立する。partialなcache割り当てとロックの早期解放は、並行実行で二重の
  副作用を許す。
- replayは記録済みresultを返すが、fileの副作用を再現しない。この境界を文書化しないと、
  replayを「再実行と同じ」と誤用する。

### WP6：browser observability

- `.acd/runs/`のrun rootだけを参照すると、CI checkoutでfixtureが存在せず回帰がvacuousになる。
  CIが実際に読み込む入力をtrackedにした。
- 期待値をコードへ書いたbrowser evidenceは、DOMの表示値を検証していない。Evidenceは
  DOMから実測し、表示値からgate result／Evidence IDへ辿れるassertionへ変更した。
- 証跡が「再接続したから重複抑止したはず」と宣言する構造になっていた。実際に重複eventが
  到着した分岐だけがフラグを立てるよう直し、client側の`online`→再接続経路を試験から明示的に
  駆動して実測した。**証跡が自分の前提を根拠にしてはいけない。**
- SSEの`from`と`Last-Event-ID`は別意味論（前者はN件skip、後者はN+1から再開）であり、混同すると
  再接続時に1件落ちる。
- 「stream切断」と「worker停止」を同じ表示に畳むと、観測者は基板が止まったのか画面が
  止まったのか区別できない。状態を分離し、`stopped`は切断表示で上書きしない。

### WP7：geometry WASM parity

- 初期parity testはfake moduleを注入しており、native対nativeの比較になっていた。生成した実
  `.wasm`をinstantiateし、素のC ABIとlinear memoryを通る実runtime parityへ変更した。
- finding IDとsort順はnative／WASMの双方でsubject IDをソートしてからcanonical化する。
  入力順に依存したIDは、component順が非アルファベット順の設計でparity不一致による誤停止を生む。
- 非正方形rect padがplacement rotationを無視してaxis-aligned矩形として量子化されていた。
  既存goldenが正方形padだったため露見しなかった。量子化はTS側で1回だけ行い、Rust側で
  三角関数を再計算しない。
- ABIのmemory offsetをハードコードすると、module のstatic領域と重なり得る。当初はRust側に
  同名のstaticを定義したが、それはdata segment内のアドレスを返す**偽のheap base**であり、
  export presenceのチェックだけを満たしていた。linker提供の`__heap_base`をexportし、
  実`.wasm`のinstantiate後に1MiB規模のinput／outputを書いてもmodule static dataが不変で
  あることを検証する回帰テストへ置き換えた。
- pad clearanceがnetとlayerを見ておらず、同一netや別layerのpadを違反にしていた。判定意味論は
  BoardNetのpinIdsからpadへ解決し、同一layerかつ異なるnetだけを比較する。
- parity mismatch、ABI不備、output破損、runtime errorはnativeへfallbackせず停止し、module不在
  時だけfallbackする。

### WP8：gate scopeと自己証明

- gate 23の証跡は当初、`assertConsistent(await ledger.load())`という**replay同士の比較**で、
  常に成功する構造だった。台帳runtimeはmutationごとにin-memory projectionをincrementalに
  適用し、耐久logのfresh replayと突き合わせる形へ変更した。片側を改変すると検出される回帰
  テストと、非台帳eventがinterleaveしても一致する回帰テストを追加した。
- 計画文書のheaderが、節の記述と矛盾したまま実装済みを主張していた。status表記は最も詳細な
  節を権威とし、上位のheaderをそこへ従わせる。

## 残債

| 残債                                                                                                                                                                                                                                 | 処置                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| WP5の残り：`kicad-cli`／ngspice／freeroutingの呼び出しは共通process境界（`NodeProcessPort`）は通るが、冪等tool envelopeを経由していない（`scripts/golden-run.mts`、`scripts/phase1-smoke.mts`、`scripts/extract-kicad-library.mts`） | Phase 5でenvelope統合を完了させる。envelope schemaとregistryは実装済み         |
| KiCad overlay footprintがDRC／netlist exportで実際にロードされていない                                                                                                                                                               | WP9として最優先で修正する。Phase 3の残債をPhase 4のpass evidenceとして扱わない |
| courtyard輪郭、mask expansion、pad shapeの正本データ供給経路が未完成                                                                                                                                                                 | 欠如時は`unknown`のまま。供給経路は独立した契約変更として扱う                  |
| event logがunknown event typeをruntime enumとして拒否せず、event種別ごとのpayload schema検証を持たない                                                                                                                               | 既知の制約として記録。挙動変更は独立した契約変更                               |
| Gate 22で、`applicability: unknown`のadopted knowledgeが適用対象に含まれたまま`passed`に到達し得る（`packages/graph-core/src/knowledge-application.ts`、`scripts/phase1-stages.mts`）                                                | 「unknownをpassにしない」原則との整合をWP9で再確認する                         |
| Gate 13は実機測定Evidence待ちで、golden artifactに status を出力しない                                                                                                                                                               | contract-onlyのまま維持。simulated evidenceで代替しない                        |
| token／moneyは未計測（`unknown`）                                                                                                                                                                                                    | Phase 5で実計測する                                                            |

## 参照

- [`phase4-plan.md`](phase4-plan.md)
- [`phase1-4-retrospective.md`](phase1-4-retrospective.md)
- [`adr/0024-long-running-run-ownership-and-persistence.md`](adr/0024-long-running-run-ownership-and-persistence.md)
- [`adr/0026-fast-check-wasm-scope-and-language.md`](adr/0026-fast-check-wasm-scope-and-language.md)
- [`adr/0029-jsonl-durability-and-recovery-semantics.md`](adr/0029-jsonl-durability-and-recovery-semantics.md)
- [`adr/0030-wasm-rust-fixed-point-supplement.md`](adr/0030-wasm-rust-fixed-point-supplement.md)
- [`adr/0031-browser-ui-canvas2d-sse-supplement.md`](adr/0031-browser-ui-canvas2d-sse-supplement.md)
- [`adr/0036-wp7-wasm-geometry-contract.md`](adr/0036-wp7-wasm-geometry-contract.md)
