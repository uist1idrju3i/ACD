# KiCad CIプロファイル

**ステータス：Draft（KiCad 10.0.5 spike実測済み）**

## 目的と権威範囲

ADR-0009のKiCad 10.x暫定基準を、CIで再現可能な環境とコマンドへ落とします。
container digest、実際のKiCad patch版、利用可能なライブラリ、許容する警告は
実験で確定し、ここへ追記します。

## Containerとライブラリ

- KiCad 10.xを含む固定containerを使用する。
- OS image、KiCad package、`kicad-cli`のpatch版をdigestまたはlockfileで固定する。
- symbol、footprint、3D model、templateは取得元、版、license、content hashを
  provenanceへ記録する。
- CI実行時の無条件ネットワーク取得を禁止する。必要なライブラリはcontainer
  または明示的fixture artifactとして提供する。
- 実測image：`kicad/kicad:10.0`、KiCad `10.0.5`、
  digest `sha256:182c8005cb775a2c448a4c18681d489f1ff472a761885eba3e08b07e3c0564de`。

## Capability probe

最初に次を実行し、stdout、stderr、終了コード、版をartifactへ保存します。

```sh
kicad-cli --version
kicad-cli --help
kicad-cli sch --help
kicad-cli pcb --help
kicad-cli pcb export --help
```

probeでは`sch erc`、`pcb drc`、`pcb export gerbers`、`pcb export drill`、`pcb export step`
の有無と引数を確認し、未対応操作を暗黙に縮退させません。

## 基準コマンド

以下はKiCad 10.xで検証する基準形です。実装時に`--help`で引数を照合し、
profileへ確定した完全なcommand lineを記録します。

```sh
kicad-cli sch erc --exit-code-violations --output artifacts/erc.rpt design.kicad_sch
kicad-cli pcb drc --exit-code-violations --output artifacts/drc.rpt design.kicad_pcb
kicad-cli pcb export gerbers -o artifacts/gerbers/ design.kicad_pcb
kicad-cli pcb export drill -o artifacts/drill/ design.kicad_pcb
kicad-cli pcb export step -o artifacts/board.step design.kicad_pcb
```

入力は生成したprojectとし、出力先を空にしてから実行します。exit codeだけで
判定せず、reportのseverity、入力revision、tool version、stdout/stderr、生成物
hashを保存します。

## 再オープン検証

生成物を別プロセスまたは別container invocationで再オープンし、次を照合します。

- project、board、symbol／footprintの読込成功
- 層数、ネット数、部品数、座標、board outline
- ERC/DRC reportのseverityと対象
- Gerber、drill、STEPの存在、サイズ、hash、対象revision
- 再生成時のhash差分

KiCadの回路図IPCはPhase 0/1の前提にしない。回路図投影は生成ファイルの再読込
と、利用可能な場合だけ能力検出されたIPCで補助検証する。

## Artifact hashの正規化契約

`SHA256SUMS`は生成されたファイルの生バイト列に対するSHA-256 manifestであり、
監査用に保存します。KiCadが生成時刻を埋め込むartifactでは再実行ごとに生hashが
変化し得るため、再現性ゲートの比較には`STABLE-SHA256SUMS`を使用します。

`STABLE-SHA256SUMS`の対象は、Gerber（`.gbr`、`.gtl`、`.gbl`、`.gto`、`.gbo`、
`.gm1`）、drill（`.drl`）、STEP（`.step`）、ERC/DRC report（`.rpt`）です。
`SHA256SUMS`および`STABLE-SHA256SUMS`自身は、どちらのmanifestにも含めません。

正規化は、任意の日付文字列を置換せず、KiCad metadata行に限定します。現在の
固定規則は次のとおりです。

- Gerberの`%TF.CreationDate`および`TCreationDate`相当のcreation-date行
- GerberのKiCad generator date行
- drill headerの`DRILL file KiCad ... date`行および`TF.CreationDate`行
- ERC reportの先頭`ERC report (timestamp, ...)`行
- STEPの`FILE_NAME('board.step','timestamp'...)`行
- KiCad generatorの`** Created on ... **`行

上記の既知metadata行以外の座標、ネット名、部品値、設計データ、artifact本文は
変更してはなりません。未知のtimestamp形式が見つかった場合は正規化規則を拡張
するまでjidoka停止とします。合格条件は、同一入力revision・tool/container
provenanceで2回以上生成した`STABLE-SHA256SUMS`が一致することです。

Phase 0の実行ラッパーは`pnpm kicad:spike`（`scripts/kicad-spike.sh`）と
`pnpm golden`（`scripts/golden-run.mts`）、Phase 1 smokeの受入runnerは
`pnpm phase1:smoke`（`scripts/phase1-smoke.mts`）です。いずれも
`fixtures/design-graphs/normal-2layer.json`または`fixtures/phase1/smoke.json`を
投影した成果物のみを検査します。Dockerがない、またはimageが取得できない環境では、
`kicad:spike`は`SKIP`を返して終了します。

## 期待artifact

少なくとも次を保存します。

- capability probe
- `erc.rpt`、`drc.rpt`
- Gerber一式、drill
- STEP（fixtureが3D出力を対象とする場合）
- command manifest
- input snapshot／patch／revision
- tool、library、container provenance
- 各artifactのSHA-256 hash
- `STABLE-SHA256SUMS`（KiCadが埋め込む時刻metadataを正規化した比較用hash）

## 合否

KiCad 10.0.5で実測した結果、ERC/DRCはともに違反0、Gerber一式、drill、
STEPを生成し、再実行時の`STABLE-SHA256SUMS`は一致しました。生artifactの
`SHA256SUMS`はGerber、drill、STEP、reportに生成時刻metadataが含まれるため
再実行で変化します。この差分は時刻metadataに限定され、比較時は
`STABLE-SHA256SUMS`を使用します。KiCadが埋め込む非決定的metadataの除外規則は
このprofileで明示したものに限ります。

## 関連文書

- [`phase1-plan.md`](phase1-plan.md)：Phase 1のlibrary／routing移行計画
- [`adr/0009-provisional-kicad-ci-baseline.md`](adr/0009-provisional-kicad-ci-baseline.md)
- [`kicad-interop.md`](kicad-interop.md)
- [`golden-tasks.md`](golden-tasks.md)
