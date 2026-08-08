# ADR-0030：WASM実装言語と整数固定小数点

**ステータス：Accepted（ADR-0026追補、Phase 4 WP7）**

## 文脈

ADR-0026は高速チェックのWASM対象とnative TypeScriptを正とする方針を決めたが、
実装言語と数値表現を未決定としていた。Phase 4のparity判定には、ブラウザとnativeで
一致する再現可能な数値契約が必要である。

## 決定

1. WASM実装言語はRustとする。
2. 座標・寸法などの幾何数値はnm単位の整数固定小数点で扱う。
3. findingsは正規化した表現を比較し、native TypeScriptとWASMの完全一致を要求する。
4. WASMのbuild digestをprovenanceへ記録し、`.wasm`バイナリはリポジトリへコミットせず
   CIでRustからビルドする。
5. WASMが失敗または利用不能な場合は、native TypeScriptへ決定論的にフォールバックする。

## 代替案

- TypeScriptまたはC++でWASMを実装する：Phase 4で承認されたRust toolchain境界を採用しないため選択しない。
- 浮動小数点を比較する：環境差によるparity不一致を許容するため採用しない。

## 結果とリスク

整数固定小数点と正規化比較により、数値差を含む不一致を検出できる。Rust toolchainと
CIビルドの再現性、WASM runtime failure時のfallbackを受入テストで固定する。

## 参照

- [`0026-fast-check-wasm-scope-and-language.md`](0026-fast-check-wasm-scope-and-language.md)
- [`../phase4-plan.md`](../phase4-plan.md)
