# Phase 0依存インベントリ

**ステータス：Draft**

Phase 0で追加した直接依存のライセンスと用途を記録します。pnpm lockfileの
transitive dependencyもレビュー対象とし、CIでSBOM／ライセンス検査を追加する
までは、依存追加時にlockfileとこの一覧を同時に確認します。

| 依存                        | 版       | SPDX       | 用途                                                        |
| --------------------------- | -------- | ---------- | ----------------------------------------------------------- |
| `ajv`                       | 8.17.1   | MIT        | JSON Schema 2020-12 runtime validation                      |
| `ajv-formats`               | 3.0.1    | MIT        | date-time等のformat validation                              |
| `fast-json-patch`           | 3.1.1    | MIT        | RFC 6902互換性調査用（Phase 0 engineはID addressingを実装） |
| `json-schema-to-typescript` | 15.0.4   | MIT        | Schemaからの型生成                                          |
| `tsx`                       | 4.19.4   | MIT        | TypeScript script実行                                       |
| `typescript`                | 5.8.3    | Apache-2.0 | strict compile/typecheck                                    |
| `vitest`                    | 3.2.4    | MIT        | unit/golden tests                                           |
| `eslint` / `@eslint/js`     | 9.30.1   | MIT        | lint                                                        |
| `typescript-eslint`         | 8.35.1   | MIT        | TypeScript lint integration                                 |
| `prettier`                  | 3.6.2    | MIT        | formatting                                                  |
| `@types/node`               | 22.15.21 | MIT        | Node.js type declarations                                   |

KiCad `10.0.5`は`kicad/kicad:10.0`のDocker外部プロセスとしてのみ実行し、
ACDへリンク・vendor・再配布しません。KiCad本体のライセンスとcontainerの
provenanceは[`kicad-ci-profile.md`](kicad-ci-profile.md)を参照してください。
