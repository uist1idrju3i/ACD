# ADR-0036：WP7幾何系高速チェックのRust/WASM契約

**ステータス：Accepted（Phase 4 WP7）**

## 決定

WP7はADR-0026およびADR-0030を実装へ落とし、正本の幾何データへ次のoptionalな
契約を加える。

- Footprintのcourtyard輪郭
- pad shape
- padごとのmask expansion
- 製造profileの型付き閾値（銅クリアランス、mask sliver、courtyard clearance）

既存fixtureはこれらを持たないまま有効であり、自由文の`processConditions`から閾値を
推定しない。欠落時は`unknown / canonical-data-not-provided`とし、passへ変換しない。

## 数値と判定

TS側でmmをnm（1mm = 1,000,000nm）へ一度だけ量子化する。量子化は最近接整数への
`Math.round`に固定し、placementの回転もこの段階で適用する。Rust/WASMとnative TSは
同じ整数DTOを入力し、距離比較は平方距離と整数演算だけで行う。

rect padの寸法はpadローカル座標系で四隅を構成し、placementの回転を適用してから
一度だけ量子化する。回転後のmask開口については下記のAABB近似を適用する。

findingsはstable ID、rule ID、対象ID、測定nm値、閾値nm値を含め、ID順に正規化する。
nativeとWASMの正規化結果がbyte一致しない場合は`verification-failed`として停止する。
nativeへfallbackできるのはWASM moduleが利用不能な場合だけであり、その理由をEvidence
provenanceへ記録する。

pad間銅クリアランスは、同一実装layerかつ異なるnetの対だけを比較する。netは
BoardNetの`pinIds`からBoardPinの`padNumber`を経由して解決し、解決できないpadは
`pad-connectivity-not-provided`のunknownとする。courtyard重なりも同一実装面の対だけを
比較し、表裏の部品を重なりとは扱わない。

mask sliverは開口の融合（測定値0、`mask-fusion`）と、正の幅を持つ細いsliver
（`mask-sliver`）を別ruleとして報告する。回転padのmask開口は量子化後のpolygonを
AABBへ落として膨らませる近似であり、実開口より保守側に大きく評価される。閾値は
manufacturing profileの型付き`geometryThresholdsNm`から供給し、自由文の
`processConditions`はparseしない。

## WASM境界、ABI、provenance

WASMは`packages/adapters/wasm-geometry`の外部境界でNode組み込みの
`WebAssembly.instantiate`から読み込み、graph-coreはWASM、filesystem、HTTP、browser
APIへ依存しない。wasm-bindgen、wasmtime、wasm-packは依存とlicense面を増やすため採用
しない。

TSは量子化済み整数DTOを固定長のlittle-endian `i64`レコードへpacked encodingし、
Rustの素のC ABIとlinear memoryで受け渡す。入力はmagic、entity count、3閾値、polygon
point列、net/layer ordinal、mask expansionからなり、出力はmagic、ruleごとのstatus、
unknown reason、finding count、entity index、測定nm、閾値nmからなる。文字列は境界を
越えず、TS側でstable IDへ復元する。parity比較は`canonicalize`を使い、key順の違いを
誤差として扱わない。
入力・出力の長さ、magic、index、status、unknown時のfinding欠如を検証し、超過や破損は
明示的な`verification-failed`停止とする。

入力bufferと出力bufferは固定アドレスに依存せず、moduleがexportする`__heap_base`から
実行時に導出する。`__heap_base`が欠落または不正なmoduleはABI不一致として停止する。

WASM moduleが利用不能な場合だけnativeへ決定論的にfallbackする。Evidenceにはengine、
理由、module version、build digest、toolchain versionを記録する。`.wasm`はcommitせず、
`rustup target add wasm32-unknown-unknown`後にCIとローカルscriptでビルドする。

## 実装根拠とライセンス

判定はSAT、点包含、線分交差、線分間距離という一般的な計算幾何だけで実装し、既存
DRC engineの移植・派生は行わない。Rust crateは依存なし、MIT、Rust公式toolchain
である。特許の不存在や自由な商用利用は主張せず、credible concernはjidokaで停止し
法務判断へエスカレートする。

## 受入

pad間clearance、mask sliver、courtyard重なりについて違反、非違反、canonical data
欠如をparity fixtureへ固定し、閾値ちょうどは違反にせず1nm下回りを違反とする。

## 参照

- [`0026-fast-check-wasm-scope-and-language.md`](0026-fast-check-wasm-scope-and-language.md)
- [`0030-wasm-rust-fixed-point-supplement.md`](0030-wasm-rust-fixed-point-supplement.md)
