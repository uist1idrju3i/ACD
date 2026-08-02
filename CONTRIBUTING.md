# ACDコントリビューションガイド

## 言語

プロジェクトのREADME、docs、ADR、Issue、Pull Requestは日本語で記述します。
ソースコードのコメント、識別子、API名は英語で記述し、`AGENTS.md`は
エージェント向け文書として英語で維持します。

## 開発環境

Phase 0の暫定基準はNode.js LTS、pnpm、TypeScriptです。KiCad CIの基準は
ADR-0009と[`docs/kicad-ci-profile.md`](docs/kicad-ci-profile.md)に従います。
将来のstorageやworkerはADR-0006の最終決定を待ち、Repository境界の外へ
実装詳細を漏らしません。

## コマンド契約

実装開始時に、package scriptsまたは同等のCI entrypointとして次を提供します。

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm lint
pnpm schema:validate
pnpm schema:generate
pnpm golden
```

`pnpm golden`は[`docs/kicad-ci-profile.md`](docs/kicad-ci-profile.md)の固定KiCad
imageをDocker経由で実行し、`fixtures/golden/`の全fixtureをreplayします。Docker
を使えない環境では、Schema・semantic・fixture期待値のみを検査する
`pnpm golden:unit`を使い、KiCad gateは未実行であることを報告に明記します。

各コマンドは失敗時に非ゼロ終了し、入力版、fixture、tool version、失敗分類を
出力します。`schema:generate`の生成差分、`schema:validate`の不正fixture、
`golden`の期待差分を黙って更新してはいけません。

## 変更の進め方

1. 関連するREADME、docs、Schema、ADR、fixtureを読む。
2. 永続的な技術判断はADRへ記録する。
3. 小さな責務単位で変更し、[`docs/repo-structure.md`](docs/repo-structure.md)
   の依存方向と公開API境界を守る。
4. 仕様、Schema、実装、fixtureを同じ変更で同期する。
5. 型チェック、テスト、lint、Schema検証、golden taskを実行する。
6. 変更理由、未決定事項、検証コマンドと結果をPRへ記録する。

## ADR・文書

ADRは既存文書を黙って書き換えず、後続ADRで置換理由を記録します。Draft仕様を
Accepted契約として実装する場合は、未決定部分と暫定性を明記します。文書の
権威はREADME（ビジョン・原則・ロードマップ）、docs（実装仕様）、Schema
（機械契約）、ADR（技術判断の履歴）です。形状はSchema、運用意味論はdocsで
矛盾しないように維持します。

## IssueとPull Request

IssueとPRは日本語で、目的、スコープ、変更点、検証結果、未解決事項を明記します。
AIが生成した変更も決定論的なCIゲートを通し、ゲートを弱めて通過させません。

## 依存・ライセンス・特許

依存、外部tool、モデル、ライブラリを追加する前に、`AGENTS.md`のOSSライセンス
と特許注意事項を確認します。license-restrictedなバイナリやvendor modelを
リポジトリへ同梱・再配布しません。

## 関連文書

- [`AGENTS.md`](AGENTS.md)
- [`docs/repo-structure.md`](docs/repo-structure.md)
- [`docs/phase0-plan.md`](docs/phase0-plan.md)
- [`docs/tool-contract.md`](docs/tool-contract.md)
