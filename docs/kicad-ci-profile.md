# KiCad CIプロファイル

**ステータス：Draft**

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
- 最終的なcontainer image digestは、KiCad再現性spikeの成功後に記録する。

## Capability probe

最初に次を実行し、stdout、stderr、終了コード、版をartifactへ保存します。

```sh
kicad-cli --version
kicad-cli help
kicad-cli sch help
kicad-cli pcb help
kicad-cli pcb export help
```

probeでは`sch erc`、`pcb drc`、`pcb gerbers`、`pcb drill`、`pcb export step`
の有無と引数を確認し、未対応操作を暗黙に縮退させません。

## 基準コマンド

以下はKiCad 10.xで検証する基準形です。実装時に`--help`で引数を照合し、
profileへ確定した完全なcommand lineを記録します。

```sh
kicad-cli sch erc --exit-code-violations --output artifacts/erc.rpt design.kicad_sch
kicad-cli pcb drc --exit-code-violations --output artifacts/drc.rpt design.kicad_pcb
kicad-cli pcb gerbers -o artifacts/gerbers/ design.kicad_pcb
kicad-cli pcb drill -o artifacts/drill/ design.kicad_pcb
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

## 合否

固定fixtureを同じcontainerで二回以上実行し、許容された時刻・一時ディレクトリ
差分を除いて同じreportとartifact hashになることを成功条件とします。KiCadの
非決定的なmetadataがある場合は、除外規則を勝手に追加せず、原因と許容差を
profileで明示します。

## 関連文書

- [`adr/0009-provisional-kicad-ci-baseline.md`](adr/0009-provisional-kicad-ci-baseline.md)
- [`kicad-interop.md`](kicad-interop.md)
- [`golden-tasks.md`](golden-tasks.md)
