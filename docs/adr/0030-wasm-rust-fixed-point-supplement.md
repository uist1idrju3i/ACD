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
5. `.wasm` moduleが不在、または実行環境がWASMを提供しない場合だけ、native TypeScriptへ
   決定論的にfallbackする。module version、build digest、toolchain version、fallback理由を
   provenanceへ記録する。instantiate失敗、C ABI／linear memory不備、入力／出力長超過、
   packed output破損、runtime error、native/WASM parity mismatchは
   `verification-failed`で停止し、native結果へfallbackしない。

## 代替案

- TypeScriptまたはC++でWASMを実装する：Phase 4で承認されたRust toolchain境界を採用しないため選択しない。
- 浮動小数点を比較する：環境差によるparity不一致を許容するため採用しない。

## 結果とリスク

整数固定小数点と正規化比較により、数値差を含む不一致を検出できる。Rust toolchainと
CIビルドの再現性、module不在時のfallback、runtime failureとparity mismatch時の停止を
受入テストで固定する。

## 参照

- [`0026-fast-check-wasm-scope-and-language.md`](0026-fast-check-wasm-scope-and-language.md)
- [`../phase4-plan.md`](../phase4-plan.md)
