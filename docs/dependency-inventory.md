# Phase 0依存インベントリ

**ステータス：Draft**

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

## コミット済みKiCad公式library snapshot

smoke fixtureで実際に使用するsymbol／footprintだけを、
`kicad/kicad:10.0`（KiCad `10.0.5`、digest
`sha256:182c8005cb775a2c448a4c18681d489f1ff472a761885eba3e08b07e3c0564de`）
から`packages/adapters/kicad/library-snapshot/`へ抽出してコミットしています。
抽出元、container、version、license、各ファイルのSHA-256は
[`packages/adapters/kicad/library-snapshot/manifest.json`](../packages/adapters/kicad/library-snapshot/manifest.json)
が正本です。`scripts/extract-kicad-library.mts`で再生成できます。

snapshotのsymbol／footprintはKiCad公式library由来で、
`CC-BY-SA-4.0-with-exception`のnoticeをsnapshotディレクトリ内に保持します。
ACDはKiCad本体やDocker imageをvendorせず、公式libraryの必要最小限の
snapshotだけを、帰属とhash manifest付きで再配布します。projection前に
manifest hashを検証し、欠落、manifest entry不在、改変、未知pad形式は
`verification-failed`として停止します。
