# ADR（Architecture Decision Record）

**ステータス：Draft**

## 目的と権威範囲

ADRはACDの技術選定を、理由・代替案・前提・結果とともに追記専用で記録します。READMEのビジョンを実装へ翻訳する判断を対象とし、会話だけで決めません。

## 状態

- **Proposed**：提案中。実装の前提にしてはいけない。
- **Accepted**：採用済み。実装契約の一部。
- **Superseded**：後続ADRに置き換えられた。
- **Rejected**：検討したが採用しない。

## ルール

1. 技術選択、永続化、外部境界、互換性に影響する判断はADRを作る。
2. 代替案、判断基準、リスク、撤回条件を記録する。
3. 未決定事項を推測で埋めない。
4. ADRを変更する代わりに、後続ADRで置換理由を記録する。

## 一覧

- [`0000-template.md`](0000-template.md)
- [`0001-record-decisions-as-adrs.md`](0001-record-decisions-as-adrs.md)
- [`0002-typed-design-graph.md`](0002-typed-design-graph.md)
- [`0003-deterministic-tools-first.md`](0003-deterministic-tools-first.md)
- [`0004-browser-first-optional-workers.md`](0004-browser-first-optional-workers.md)
- [`0005-byok-self-hosted-llm.md`](0005-byok-self-hosted-llm.md)
- [`0006-implementation-language-storage.md`](0006-implementation-language-storage.md)
- [`0007-kicad-minimum-version.md`](0007-kicad-minimum-version.md)
- [`0008-phase0-provisional-implementation-profile.md`](0008-phase0-provisional-implementation-profile.md)
- [`0009-provisional-kicad-ci-baseline.md`](0009-provisional-kicad-ci-baseline.md)
