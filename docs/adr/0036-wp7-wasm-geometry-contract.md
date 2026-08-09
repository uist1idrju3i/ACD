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

findingsはstable ID、rule ID、対象ID、測定nm値、閾値nm値を含め、ID順に正規化する。
nativeとWASMの正規化結果がbyte一致しない場合はWASMを採用せずnativeへfallbackし、
その理由をEvidence provenanceへ記録する。

## WASM境界とprovenance

WASMは`packages/adapters/wasm-geometry`の外部境界で読み込み、graph-coreはWASM、
filesystem、HTTP、browser APIへ依存しない。WASM不在時はnativeへ決定論的にfallback
する。Evidenceにはengine、理由、module version、build digest、toolchain versionを
記録する。`.wasm`はcommitせず、Rust targetの導入後にCIでビルドする。

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
