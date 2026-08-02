# Phase 1 smoke A/C/D 統合spike

実行日: 2026-08-02（container内の実行時計による）

## 入力と固定環境

- fixture: `fixtures/phase1/smoke.json`
- KiCad image: `kicad/kicad:10.0`
- KiCad version: `10.0.5`
- KiCad digest: `sha256:182c8005cb775a2c448a4c18681d489f1ff472a761885eba3e08b07e3c0564de`
- Freerouting image: `ghcr.io/freerouting/freerouting:2.2.4`
- Freerouting digest: `sha256:0d010c6bf13b562551e8cb41fb298090006033fa2850e5bfc678c98ecf47111e`

## 実行した主なコマンド

```sh
node --import tsx -e 'import { readFile } from "node:fs/promises"; import { projectToKicad } from "./packages/adapters/kicad/src/projection.ts"; const fixture=JSON.parse(await readFile("./fixtures/phase1/smoke.json", "utf8")); await projectToKicad(fixture, "/tmp/acd-phase1-smoke");'
docker run --rm --user root -e HOME=/tmp -e KICAD_CONFIG_HOME=/tmp/kicad-config -v /tmp/acd-phase1-smoke:/work kicad/kicad:10.0 kicad-cli pcb drc --output /work/drc.rpt /work/design.kicad_pcb
docker run --rm --user root -e HOME=/tmp -e KICAD_CONFIG_HOME=/tmp/kicad-config -v /tmp/acd-phase1-smoke:/work kicad/kicad:10.0 kicad-cli sch erc --output /work/erc.rpt /work/design.kicad_sch
docker run --rm --user root -e HOME=/tmp -e KICAD_CONFIG_HOME=/tmp/kicad-config -v /tmp/acd-phase1-smoke:/work kicad/kicad:10.0 kicad-cli pcb export ipcd356 -o /work/design.ipc356 /work/design.kicad_pcb
node spikes/phase1/smoke-dsn.mjs fixtures/phase1/smoke.json /tmp/acd-phase1-spike/smoke.dsn
docker run --rm -e HOME=/tmp -v /tmp/acd-phase1-spike:/work ghcr.io/freerouting/freerouting:2.2.4 java -jar /app/freerouting-executable.jar -de /work/smoke.dsn -do /work/smoke.ses -l en -mp 1
node spikes/phase1/compare-netlist.mjs fixtures/phase1/smoke.json /tmp/acd-phase1-smoke/design.net /tmp/acd-phase1-smoke/design.ipc356 /tmp/acd-phase1-smoke/compare.json
```

## 結果

| 項目                       | 結果                     | 証拠／注記                                                                                 |
| -------------------------- | ------------------------ | ------------------------------------------------------------------------------------------ |
| PCB projection             | spike pass               | 4 real footprint names、3 nets、8 padsを生成                                               |
| KiCad PCB reopen           | pass                     | `pcb drc`がboardを開きreportを生成                                                         |
| DRC                        | fail（想定された未実装） | 5 violations、5 unconnected items。tracks未生成。library copy mismatch 4件とsilkscreen 1件 |
| Schematic projection       | fail / gap               | 現在は空の`lib_symbols`。real symbol/netは未投影                                           |
| ERC                        | 非代表的なpass           | empty schematicのため0 errors/0 warnings。real pins/power flagsのERC成功とは扱わない       |
| KiCad schematic netlist    | fail / gap               | exportは成功したがcomponent/referenceは空                                                  |
| KiCad PCB pad table        | pass                     | IPC-D-356の8 padをfixture期待値と比較し一致                                                |
| graph→PCB round-trip       | pass                     | `compare-netlist.mjs`の`graphVsPcb=true`                                                   |
| graph→schematic round-trip | fail                     | `graphVsSchematic=false`                                                                   |
| KiCad DSN export           | unavailable              | KiCad 10.0.5の`pcb export --help`にSpecctra/DSN exporterがない                             |
| ACD DSN export             | spike pass               | `smoke-dsn.mjs`がfixtureからSpecctra DSNを生成                                             |
| Freerouting parse/SES      | pass                     | own DSNを受理し`smoke.ses`を生成                                                           |
| Freerouting routing        | fail acceptance          | `started with 5 unrouted nets`、final score `998.40`。SESは出力されたが`unrouted=0`未達    |

Freeroutingの`5`はこのown DSNの接続要求数であり、Phase 0で使用した別fixtureの
`141 → 128`とは直接比較しません。`-mp 1/5/10/20`を試しても5 unroutedのままでした。

## production-ready と spike-only の区別

production-readyに近いものは、fixture schema validation、fixtureからのdeterministic
footprint/net/pad生成、IPC-D-356 pad-table比較、container digest pinningです。

spike-onlyなのは、手書きSpecctra DSN、embedded footprintの簡略形、空schematic、
real-pin ERC、Freerouting SESのKiCad re-import、完全routingです。Phase 1の
`unrouted=0` gateは満たしていないため、この結果だけで受入・発注準備完了とはしません。

PCB/DSNのpad geometryは、現在のsmoke fixtureに含まれるJ1/R1/D1/C1の2-pad
tableだけを明示的に持ちます。未知のpartまたはpad番号はprojection/DSN生成を
即時停止します。`fixtureKind=golden`のprojectionも、ESP32級の実geometryを
追加するまでは停止します。これは意図したspike限界であり、任意部品を2-padとして
推測するfallbackではありません。

## 次の停止条件と改善案

1. official symbol/footprint snapshotをcontent hash付きで固定し、embedded footprintの
   library mismatchを解消する。
2. graphのsymbol/pin mappingからreal `kicad_sch`を生成し、power flagsを含むERCで
   0 errors/0 warningsを得る。empty schematicのERC passは受入 evidenceにしない。
3. schematic netlist exportとIPC-D-356を同一canonical netlist diffで比較する。
4. DSN exportはKiCad 10 CLIの機能差を吸収するadapterとして明示し、own exporterの
   round-trip testを増やす。Freerouting SESをPCBへ戻し、DRC後に`unrouted=0`を測定する。
