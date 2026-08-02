# KiCad公式ライブラリ固定spike

このspikeでは、Phase 0/1のCI profileで使用する
`kicad/kicad:10.0` containerと同じ境界で、KiCad公式symbol/footprint
libraryを固定します。

- Image: `kicad/kicad:10.0`
- KiCad: `10.0.5`
- Digest: `sha256:182c8005cb775a2c448a4c18681d489f1ff472a761885eba3e08b07e3c0564de`
- License note: KiCad公式libraryは
  `CC-BY-SA-4.0-with-exception`として扱います。再配布前にはupstreamの
  正確なnoticeを確認し、必要なnoticeを保持します。

## 固定snapshot

`packages/adapters/kicad/library-snapshot/`に、smoke fixtureで使用する
次の9ファイルを固定しています。

- symbol: `Device:R`、`Device:LED`、`Device:C`
- symbol: `Connector_Generic:Conn_01x02`
- symbol: `power:PWR_FLAG`
- footprint: `JST_PH_B2B-PH-K_1x02_P2.00mm_Vertical`
- footprint: `R_0603_1608Metric`
- footprint: `LED_0603_1608Metric`
- footprint: `C_0603_1608Metric`

正本manifestは
`packages/adapters/kicad/library-snapshot/manifest.json`です。
`spikes/kicad-library/manifest.json`にも同じ生成manifestを保持しています。
各entryにはsource path、KiCad version、container digest、license、
`sha256:` content hashを記録し、pending hashは残していません。

再抽出はリポジトリrootで次を実行します。

```sh
pnpm exec tsx scripts/extract-kicad-library.mts
```

このscriptは固定digestのcontainerから必要な公式sourceだけを読み出し、
footprint `.kicad_mod`とsymbol block、manifest、生成symbol moduleを再生成します。
生成された`library-snapshot.ts`はprojectionが使用する公式symbol／footprint
snapshotの埋め込み表現です。公式sourceの帰属情報は
`CC-BY-SA-4.0-with-exception`として保持しています。

projection前にmanifest entryと各snapshot content hashを検証します。
snapshotの欠落、entryの欠落、改変、未知pad type／unsupported pad constructは
typed `verification-failed`で停止し、hand-written geometryへのfallbackは
行いません。SMDとTHTを扱い、THTではdrillと`*.Cu` layerを保持します。

現在の制限は、snapshot対象がsmoke fixtureの使用部品に限定されること、
symbol／footprint全ライブラリの同期ではないこと、ESP32-class golden向けの
追加library抽出はWP2以降で行うことです。
