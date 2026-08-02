# ADR-0008: Phase 0暫定実装プロファイル

**ステータス：Accepted（暫定・可逆）**

## 目的と権威範囲

Phase 0を開始するための実装言語、開発ツール、Schema検証、型生成、暫定保存
方式を定めます。本ADRは最終的な実装言語・ストレージを確定せず、
[`0006-implementation-language-storage.md`](0006-implementation-language-storage.md)
の未決定範囲を維持したまま、再現可能なPhase 0実験を可能にします。

## 文脈

ADR-0006は実装言語、フレームワーク、runtime validator、イベントログ、成果物
配置、最終ストレージを未決定としています。しかし、Phase 0のSchema、
graph-core、patch/replay、fixture、CIを実装するには、暫定的な開発プロファイル
が必要です。最終ストレージを先に固定すると、ブラウザ優先・セルフホスト・
移行可能性を不必要に制約します。

## 決定

Phase 0では次の暫定プロファイルを使用します。

- 実装言語：TypeScript
- 実行環境：Node.js LTS
- パッケージマネージャ：pnpm。workspaceとlockfileを一貫して扱い、将来の
  package分割でも依存解決を再現しやすくする
- Schema：JSON Schema draft 2020-12を正規の機械契約とする
- runtime検証：AJV系のJSON Schema validatorを使用する
- TypeScript型生成：`json-schema-to-typescript`を使用する。既存Schemaを
  source of truthとして維持でき、Schemaから型を生成する方向が明確である。
  TypeBoxのようにTypeScript型をSchemaの生成元にする方式は、現行のJSON Schema
  契約を置き換えるため採用しない
- Phase 0保存：canonical JSON snapshotとappend-only patch JSONL
- 保存境界：graph-coreは`Repository`インターフェースだけに依存し、ファイル、
  IndexedDB、OPFS、SQLite、サーバーRDB等の実装詳細を直接参照しない

型生成物は手編集せず、Schemaから再生成します。runtime検証と型生成の入力は
同じSchemaファイルです。

## 代替案

- npm：Node.js標準に近いが、workspace間の依存・キャッシュ・lockfile運用を
  本プロジェクトの分割方針に合わせる理由がpnpmより弱い
- TypeBox：型とSchemaを一つのTypeScript表現から生成できるが、現行のJSON
  Schemaを正規契約として維持する方針と相性が悪い
- Rust／Python：workerや外部ツールadapterでは将来候補だが、Phase 0の
  ブラウザ共有契約とJSON処理の初期コストが高い
- SQLite/WASMやIndexedDB：最終保存候補だが、Phase 0ではRepository実装を
  差し替え可能にして比較を後回しにする

## 結果と撤回条件

この決定により、Phase 0の型生成、Schema検証、fixture、patch/replay、CIを
同じNode.js系ツールチェーンで再現できます。pnpm、TypeScript、validator、
型生成器、snapshot形式は、性能、ブラウザ実行性、worker連携、バックアップ、
移行、ライセンスの実験結果に基づき後続ADRで置き換え可能です。

本ADRはADR-0006をAcceptedへ変更しません。最終的な実装言語、フレームワーク、
永続ストレージ、同期・競合解決、成果物配置は未決定です。

## 参照

- [`0006-implementation-language-storage.md`](0006-implementation-language-storage.md)
- [`../phase0-plan.md`](../phase0-plan.md)
- [`../../schemas/design-graph.schema.json`](../../schemas/design-graph.schema.json)
