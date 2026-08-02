## 概要

<!-- 変更の目的と範囲を日本語で記載してください。 -->

## 変更した契約

- [ ] Schema
- [ ] ADR
- [ ] docs
- [ ] API／tool contract
- [ ] phase boundary
- [ ] なし

## 検証結果

実行したコマンドと結果を記載してください。

```text
pnpm typecheck
pnpm test
pnpm lint
pnpm schema:validate
pnpm typegen-sync
pnpm format:check
```

KiCadまたは外部toolを変更した場合は、capability probe、再オープン、ERC/DRC、
artifact hashの結果も記載してください。

## Provenance／ライセンス確認

- 追加・更新した依存、tool、model、library：
- SPDX identifier：
- version／commit／digest：
- source URL：
- license inventory／NOTICE更新：
- 外部process境界の確認：

## 未決定事項・既知の制約

<!-- 未決定のADR、延期した作業、環境依存、既知の制限を記載してください。 -->

## 安全確認

- [ ] secrets、credentials、個人情報を含めていない
- [ ] license／patent concernを確認した
- [ ] jidoka停止条件を弱めていない
- [ ] 関連文書、Schema、fixture、テストを同期した
