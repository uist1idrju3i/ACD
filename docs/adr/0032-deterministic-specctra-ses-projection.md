# ADR-0032：Specctra SESの決定論的ACD投影

**ステータス：Accepted**

## 背景

Phase 1 golden routingでは、KiCadの`pcbnew.ImportSpecctraSES`でFreeRoutingの
SESを`routed.kicad_pcb`へ取り込んでいた。しかし、同一KiCad image、同一
`design.kicad_pcb`、同一SESを別プロセスで2回importして保存した実測で、
footprint順、UUID、segment分割が変化した。

実測では、両方のboardが93本のsegmentを持つ一方、layer・net・端点を含む
unordered tupleは52本だけ共通で、各出力に52本ずつ固有のtupleがあった。
これはtimestampの正規化では吸収できないboard生成の非決定性である。

一方、固定したFreeRouting imageと同一DSN、同一引数で2回routingしたSESは
完全一致した。したがって、SESの内容をACD側で解釈し、設計graphの投影として
boardを生成する境界を採用する。

## 決定

1. `Layout.attributes.tracks`と`Layout.attributes.vias`をrouted geometryの
   受け皿とする。独立した`Trace` entityは追加しない。
2. SESの`resolution`を読み、`um`単位かつPhase 1で許可したresolutionであることを
   検証する。座標・寸法は既存graph契約に合わせてmmで保持するが、1nm分解能で
   厳密に表現できない値は停止し、丸めて通さない。
3. SESのwire/pathは隣接点ごとのtrackへ分解する。viaのpadstack、layer、net、
   座標を厳密に検証する。
4. `tracks`は(netId, layer, start座標, end座標, width)、`vias`は(netId,
   at座標, diameter, drill, layers)の辞書順でcanonical sortする。
5. SESの整数座標、resolution、変換元情報はprovenanceへ記録する。
6. `routed.kicad_pcb`はACDのgraph projectionから生成する。KiCadの
   `ImportSpecctraSES`と`SaveBoard`はこの決定論的board生成経路では使用しない。
7. KiCadはDSN export、DRC、Gerber／drill export、netlist／IPC-D-356 readbackの
   外部境界として継続利用する。

## 実装上の停止条件

- `resolution`の単位が`um`以外、または許可されないresolution
- 1nm分解能で厳密に表現できない座標・寸法
- 未知layer、未知padstack、未知net、重複net名
- 点が1つ以下、または座標個数が奇数のpath
- padstack定義とpadstack名の寸法不一致

## 結果とリスク

KiCad importerのUUID・並び順・segment分割に依存せず、graphから同じboard textを
再生成できる。FreeRouting自体のSES出力が将来変動した場合は、SESのhashと
provenanceを比較し、route geometryの差分を検証で停止する。

KiCad DRCと製造exportは引き続き生成boardを読むため、KiCadのS式互換性と
再open検証は必要である。mm表現は現行graphとの互換性を優先したものであり、
ADR-0030のWASM用nm整数表現へのgraph全体移行は本ADRの範囲外とする。

KiCad 10.0.5固定imageで`SOURCE_DATE_EPOCH=0`を設定してGerber、drill、
ERCを各2回生成したが、timestampを含む生バイト列は一致しなかった。
したがってmanufacturing manifestには生バイトの`sha256`と、timestampだけを
正規化した比較用の`normalizedSha256`を別々に記録する。manifestの
`artifactHashSemantics`にも各フィールドの意味を記録し、`bytes`は生バイト列の
長さを表す。生バイトhashはprovenanceとして保持し、比較時だけ
`normalizedSha256`を使用する。

library overlayの`fp-lib-table`は生成時点から`${KIPRJMOD}/library-overlays`を
出力する。KiCadのDRCとschematic netlist exportがこの表記で実行できることを
確認した。ただし、overlay fileを意図的に壊しても両コマンドは成功したため、
これらのコマンドはoverlay footprint fileを実際にはロードしていない。
Phase 3のoverlay検証はACD側のsnapshot／board materialization検証であり、
KiCad DRC／netlistによるoverlay fileの参照検証ではない。この穴は本変更では
修正しない。

## 証拠

- FreeRouting 2.2.4固定imageで同一DSNを2回実行したSES hashは一致した。
- 同一KiCad image・同一board・同一SESの`ImportSpecctraSES`実行では、footprint順、
  UUID、segment分割が変化した。
- ACDのSES parserは整数座標、resolution、padstack、net、layerを検証し、
  `Layout` route projectionへ変換する。
