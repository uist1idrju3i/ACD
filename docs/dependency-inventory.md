# Phase 0依存インベントリ

**ステータス：Draft**

## 目的と権威範囲

Phase 0で追加した直接依存のライセンスと用途を記録します。pnpm lockfileの
transitive dependencyもレビュー対象とし、CIでSBOM／ライセンス検査を追加する
までは、依存追加時にlockfileとこの一覧を同時に確認します。CIの
`pnpm license:check`は`pnpm licenses list --json`の全transitive dependencyを
検査し、許可リスト外、copyleft、またはunknown licenseで失敗します。許可リストは
MIT、Apache-2.0、BSD-2-Clause、BSD-3-Clause、ISC、0BSD、Python-2.0です。

| 依存                        | 版       | SPDX       | 用途                                   |
| --------------------------- | -------- | ---------- | -------------------------------------- |
| `ajv`                       | 8.17.1   | MIT        | JSON Schema 2020-12 runtime validation |
| `ajv-formats`               | 3.0.1    | MIT        | date-time等のformat validation         |
| `json-schema-to-typescript` | 15.0.4   | MIT        | Schemaからの型生成                     |
| `tsx`                       | 4.19.4   | MIT        | TypeScript script実行                  |
| `typescript`                | 5.8.3    | Apache-2.0 | strict compile/typecheck               |
| `vitest`                    | 3.2.4    | MIT        | unit/golden tests                      |
| `eslint` / `@eslint/js`     | 9.30.1   | MIT        | lint                                   |
| `typescript-eslint`         | 8.35.1   | MIT        | TypeScript lint integration            |
| `prettier`                  | 3.6.2    | MIT        | formatting                             |
| `@types/node`               | 22.15.21 | MIT        | Node.js type declarations              |

KiCad `10.0.5`は`kicad/kicad:10.0`のDocker外部プロセスとしてのみ実行し、
ACDへリンク・vendor・再配布しません。KiCad本体のライセンスとcontainerの
provenanceは[`kicad-ci-profile.md`](kicad-ci-profile.md)を参照してください。

## 関連文書

- [`../AGENTS.md`](../AGENTS.md)：依存、ライセンス、固定と更新の作業契約
- [`kicad-ci-profile.md`](kicad-ci-profile.md)：KiCad containerの実行境界とprovenance
