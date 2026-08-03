# リポジトリ構成とモジュール分割

**ステータス：Draft**

## 目的と権威範囲

大規模化しても、責務が追跡可能でテスト可能な粒度にソースコードを分割する
規約です。Phase 0の実装プロファイルとADR-0008を前提にします。

## 初期レイアウト

```text
packages/
  schema/                 # JSON Schema、生成型、runtime validator
  graph-core/             # snapshot、Entity、semantic validation、knowledge lifecycle、Repository契約
  adapters/
    kicad/                # Graph -> KiCad、再オープン、artifact manifest
    storage-fs/           # snapshot、patch、event log、KnowledgeItemのファイル実装
    freerouting/          # DSN/SES境界
    spice/                # nominal SPICE deck生成とngspice出力の解釈
    fab-feedback/         # recorded/live fab reportのintake adapter
  tool-contract/          # tool request/result/error envelope
  test-support/           # fixture loader、hash、deterministic clocks
fixtures/
  golden-tasks/
  design-graphs/
apps/                     # UI、worker、CLIは必要になった時点で追加
docs/
schemas/
```

KiCadの公式library snapshotは`packages/adapters/kicad/library-snapshot/`に固定保存し、
fab由来の修正は同adapterのoverlay patch modelで別revisionとして保持します。snapshotの
manifest、hash、NOTICEを変更せず、patchはgraph-coreのKnowledgeItem/event契約をsource
として参照します。未検証patchは投影へ渡しません。

実際のpackage名はpnpm workspaceの初期化時に確定する。空のappsを先に作らず、
Phase 0のlibraryから始める。

## 依存方向

依存は次の一方向を基本とします。

```text
schema ← graph-core ← adapters/* ← apps/workers
tool-contract ← graph-core/adapters
test-support → test対象（本番packageから逆参照しない）
```

- `schema`は他のACD packageへ依存しない。
- `graph-core`はSchema、標準library、Repository/tool contractの型だけを参照し、
  KiCad、ブラウザ、Node filesystemへ直接依存しない。
- adapterはgraph-coreの公開APIを使い、内部Entity表現へ直接侵入しない。
- apps/workersはadapterをオーケストレーションするが、gate判定を独自実装しない。
- 循環依存、相互import、adapterからUIへの依存を禁止する。

## 粒度と公開API

- 一つのpackage/moduleは一つの主責務を持つ。Schema、patch、validator、hash、
  repository、KiCad process、UI stateを一つの巨大moduleへ集約しない。
- 分割理由は行数だけで決めない。二つ目の責務、独立した変更頻度、独立した
  テスト境界、異なる依存、公開APIの肥大化が現れたら分割する。
- 小さすぎるwrapperを量産せず、概念的な境界と変更理由がある単位で分割する。
- packageごとに最小の公開APIを`index.ts`等で明示し、内部ファイルへのdeep import
  を禁止する。
- 外部tool、filesystem、clock、randomness、networkはport/interfaceで隔離し、
  coreの決定論的テストで差し替え可能にする。

## 命名と責務

- package、ファイル、関数、変数は既存コードの英語識別子規約に従う。
- `schema`は契約、`core`は純粋ロジック、`adapter`は外部境界、`fixture`は
  再現可能な入力・期待値、`app`はcomposition rootを表す。
- `index.ts`は公開APIのみをexportし、内部実装を再exportしない。
- コメントは設計理由が必要な場合だけ英語で書き、コードから読める事実を重複させない。

## 関連文書

- [`../AGENTS.md`](../AGENTS.md)
- [`adr/0008-phase0-provisional-implementation-profile.md`](adr/0008-phase0-provisional-implementation-profile.md)
- [`tool-contract.md`](tool-contract.md)
- [`phase0-plan.md`](phase0-plan.md)
