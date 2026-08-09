# Phase 4振り返り（WP1〜WP7）

**ステータス：Draft（WP8時点の実測と残債）**

## 目的

WP1〜WP7で実装した実行基盤、ブラウザ観測、幾何系WASM境界について、受入時に得た
測定結果と、次の実装で再利用する教訓を記録します。未実装の機能を完了扱いにせず、
残債は停止条件とともに明示します。

## 測定結果と教訓

### WP1〜WP3：worker、checkpoint、KiCad境界

- KiCadのSES import/saveは同じ入力でも保存結果の生バイトが決定的でないケースがあり、
  ACD側で成果物の正規化と比較境界を持つ必要があった。
- 対応として、ACDが正本とする設計グラフ、投影、再読込結果、artifact hashを分離し、
  KiCadの保存バイト列をそのまま設計状態の権威にしない構成へ固定した。
- worker process kill後のcheckpoint resumeは、無中断runとの成果物hash、gate結果、
  event列を比較することで測定した。ブラウザの切断回帰とworker耐久性の測定は別経路に
  分ける必要がある。

### WP4：budget watchdogと無進捗

- 無進捗はrun全体の要約だけでは検知できず、同一taskのattemptごとの観測列で測る必要が
  あった。修正の反復、成果物hashの変化なし、gate結果の改善なしをattempt境界で観測し、
  retry budget内の再実行と停止を区別した。
- token／moneyはPhase 4では計測せず、unknownとして保持した。未計測値をpassへ変換しない
  ことがjidoka条件である。

### WP5：hash semanticsとEvidence

- hash semanticsを取り違えたことで、既存Evidence hashが一斉に変わる問題が発生した。
- 生バイトhashは再現対象のartifact同一性に使い、canonical hashは意味的な比較やkey順に
  依存しない比較に使う、という用途分離が必要だった。hash方式を変更する場合は、
  protected artifactとEvidenceの影響範囲を先に固定する。

### WP6：browser observability

- `.acd/runs/`に生成されたrun rootだけを参照すると、CI checkout上でfixtureが存在せず、
  回帰がvacuousになり得た。受入に必要なrun rootをfixtureへ移し、CIが実際に読み込む
  入力をtrackedにした。
- 期待値をコードへハードコードしたbrowser evidenceは、実際のDOM表示値を検証して
  いなかった。EvidenceはDOMから実測し、表示値からgate result／Evidence IDへ辿れる
  assertionへ変更した。
- `/diff`がsnapshot fileの存在を前提にしていたため、read modelだけで成立する観測経路と
  fixtureが一致しない欠陥が見つかった。browser clientが表示するread modelの実体を
  fixtureとCIで同時に検証する必要がある。
- Playwright Chromiumはbrowser jobで、worker process kill/resumeはphase4-resume jobで
  必須実行する。両者を同じ測定結果として扱わない。
- runnerのcleanupは自分が生成するartifactだけを削除し、trackedなWP6 browser evidenceを保持する。

### WP7：geometry WASM parity

- 初期parity testはfake moduleを注入しており、native対nativeの比較になりかけた。
  生成した実`.wasm`をNode組み込みWebAssembly APIでinstantiateし、素のC ABIとlinear
  memoryを通る実runtime parityへ変更した。
- pad clearanceがnetとlayerを見ていなかったため、同一netまたは別layerのpadを誤って
  比較する偽陽性が出た。BoardNetのpinIdsからpadへ解決し、同一layerかつ異なるnetだけを
  比較する必要がある。
- courtyardの実装面、mask fusionと正のsliver、typed manufacturing thresholdも
  判定意味論へ含める必要があった。未知データをpassへ変換しないことを維持した。
- parity mismatch、ABI不備、output破損、runtime errorはnativeへfallbackせず停止し、
  module不在時だけfallbackする境界を固定した。

## 残債

- KiCad overlay footprint検証には、overlay後のfootprint geometryと再open／DRCの一貫した
  検証経路に穴が残っている。
- event-log単体ではunknown event typeをruntime enumとして拒否せず、event種別ごとの
  payload schema検証も行わない。WP8では挙動を変更せず、既知の制約として記録する。
- courtyard輪郭、mask expansion、pad shapeなどの正本データ供給経路が未完成であり、
  geometry checkは欠如時にunknownを返す。
- WP9では、Phase 3に残るlibrary overlay footprint検証とknowledge application後の
  projection検証を再確認する。Phase 3の残債をPhase 4のpass evidenceとして扱わない。

## 参照

- [`phase4-plan.md`](phase4-plan.md)
- [`adr/0024-long-running-run-ownership-and-persistence.md`](adr/0024-long-running-run-ownership-and-persistence.md)
- [`adr/0026-fast-check-wasm-scope-and-language.md`](adr/0026-fast-check-wasm-scope-and-language.md)
- [`adr/0030-wasm-rust-fixed-point-supplement.md`](adr/0030-wasm-rust-fixed-point-supplement.md)
- [`adr/0031-browser-ui-canvas2d-sse-supplement.md`](adr/0031-browser-ui-canvas2d-sse-supplement.md)
