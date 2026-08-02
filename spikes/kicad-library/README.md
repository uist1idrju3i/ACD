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

`manifest.json`はmachine-readableなdraftです。明示的なlibrary snapshotの
export方式を決めるまでは`contentHash`は`null`とし、container digestを
再現性のanchorとします。smoke projectionは固定container内のlibrary pathを
指すlocal library tableを書き出します。board reopenとDRC capabilityは
container内で確認済みですが、schematic symbol projectionは未完了です。
