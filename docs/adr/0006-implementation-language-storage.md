# ADR-0006: 実装言語とストレージ

**ステータス：Proposed / 未決定**

## 目的と権威範囲

実装言語とストレージを決めるための候補、基準、未決定事項を記録します。

## 文脈

ACDはブラウザUI、WASM検証、任意ワーカー、イベントログ、設計グラフ、成果物を扱う。単一言語・単一ストレージを先に決めると、ブラウザ優先、セルフホスト、再開可能性のいずれかを損なう可能性がある。

## 決定

まだ最終決定しない。Phase 0の暫定実装プロファイルは
[`ADR-0008`](0008-phase0-provisional-implementation-profile.md)で定めるが、
本ADRの実装言語・フレームワーク・最終ストレージの未決定状態は維持する。
Schema、ゴールデンタスク、小さな実験の結果を比較してから、後続ADRで最終決定
する。

## 候補

- 言語：TypeScript、Rust、Python、または役割ごとの組み合わせ
- ブラウザ実行：WebAssembly、Web Worker、OffscreenCanvas
- ストレージ：IndexedDB、OPFS、SQLite/WASM、サーバーRDB、オブジェクトストレージ、append-onlyイベントログ

## 判断基準

ブラウザ実行性、決定論的再現性、WASMとの相性、型安全性、KiCad／ネイティブツール連携、ストリームとチェックポイント、ローカル・セルフホスト運用、バックアップ・移行、性能、ライセンス、開発者体験を比較する。

## 未決定事項

実装言語、フレームワーク、スキーマの実行時バリデータ、イベントログ形式、同期・競合解決、暗号化、マルチユーザー認証、成果物の物理配置は最終的に未決定である。Phase 0の暫定値はADR-0008で参照する。推測で最終決定とせず、決定時に本ADRを後続ADRで置換する。

## 参照

- [`../../README.md`](../../README.md#10-開発の進め方--aiと共に作るacd)
- [`../architecture.md`](../architecture.md)
- [`0008-phase0-provisional-implementation-profile.md`](0008-phase0-provisional-implementation-profile.md)
