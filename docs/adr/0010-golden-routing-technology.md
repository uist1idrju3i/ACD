# ADR-0010：Golden routing technology

**ステータス：Proposed**

## 背景

ESP32級golden fixtureのroutingは、smoke fixtureの限定的なheuristic
routingを拡張せず、外部toolとの明示的なDSN/SES境界で実行する。Freeroutingへ
手書きDSNを渡す試行では、UART_RX/TXやLED_Aのwireが欠落し、DSN exporterの
欠陥と真のroutability問題を区別できなかった。

## 決定

golden routingでは、KiCad 10.0.5の`pcbnew` Python APIを固定container内で
使用する。

1. KiCadが生成した`design.kicad_pcb`から`ExportSpecctraDSN`でDSNを生成する。
2. 固定Freerouting containerでDSNをroutingする。
3. 同じKiCad containerの`ImportSpecctraSES`でSESをPCBへ取り込む。
4. KiCad DRC reportを受入判定の権威とし、`unrouted=0`、DRC violations=0、
   unconnected=0、footprint errors=0を要求する。

Freeroutingの境界はGPL external-processのままとし、jarや実装をACDへvendor、
link、copyしない。

## Routing profile

golden fixtureの製造profileは次のとおりとする。

- board：60 mm × 45 mm、2 layer、1.6 mm
- track width：0.25 mm
- clearance：0.127 mm（5 mil）
- via：0.8 mm / drill 0.4 mm
- ESP32 antenna courtyard：component courtyardのうちantenna wingをboard外へ
  延長可能とし、DSNのrouting keepoutとして扱う

`F.CrtYd`はcomponent同士のon-board intersection判定に使用する。courtyardは
board領域そのものではないためboard外へ出てもよい。一方、padはboard edgeから
1 mm以上離す。

## 決定論性

Freerouting imageは次に固定する。

```text
ghcr.io/freerouting/freerouting:2.2.4
sha256:0d010c6bf13b562551e8cb41fb298090006033fa2850e5bfc678c98ecf47111e
```

同一DSNを2回routingし、SES hashを比較する。現在のgolden実測では同一hashを
得ている。将来hashが変動する場合は、受入結果としてSES snapshotをcontent
hash付きでcommitし、現行boardへ再importしてDRCを再検証する。hashが変動した
まま説明できない場合はjidoka停止とする。

## 実測結果

KiCad-generated DSN/SES boundaryで次を確認した。

```text
Freerouting: 43 initial unrouted connections
final: 0 unrouted
KiCad DRC violations: 0
unconnected: 0
footprint errors: 0
SES deterministic: true
```

## 代替案

- 手書きSpecctra DSN：pad rotation、image、netの欠落を起こしたため不採用。
- Phase 1のgeneral-purpose自前router：禁止。
- Freerouting failure時のfixture限定router：Freeroutingが受入に到達しない
  場合に限り、別ADRで明示承認し、失敗Evidenceを保存する。会話だけで黙って
  置換してはならない。

## 制約と今後

- Freeroutingは外部GPL processであり、配布形態・source offer・noticeは
  dependency inventoryとrelease boundaryで管理する。
- KiCad 10 CLIにはこの環境で`pcb export specctra` subcommandが存在しないため、
  KiCad 10.0.5の`pcbnew.ExportSpecctraDSN`を使用する。
- DSN、SES、routed PCB、DRC、manufacturing artifactはgraph revisionとhashを
  manifestへ記録する。
