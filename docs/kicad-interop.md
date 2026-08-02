# EDA／MCAD相互運用（KiCad境界）

**ステータス：Draft（smoke fixture投影とnetlist readbackを実装済み）**

## 目的と権威範囲

READMEの「オープンなエンジンとフォーマット」およびロードマップの「借りられるものは借りる」を、EDA／MCADとの境界として定義します。ACDの正は設計グラフであり、KiCad回路図とMCAD形状は生成された投影です。

## 出力・入力ターゲット

- KiCadプロジェクト（回路図、PCB、ライブラリ参照）
- Gerber X2、drill、BOM、pick-and-place
- IPC-2581
- STEP、glTF/GLB、DXFによるMCAD向け形状・2D境界
- IDFv3（レガシーな基板・部品外形交換）
- IDX（ProSTEP iViPの増分交換）は将来候補
- 必要に応じてSpecctra DSN/SESによるfreerouting交換
- IBIS／IBIS-AMIモデル、Touchstone 2.1（`.s2p`／`.s4p`）等のSI／PI解析入力
- Verilog-A／SystemVerilog-AMSモデル、FMI／Modelica連成の将来入力候補

KiCadの`kicad-cli`は3DモデルをSTEP、GLB、BREP、STL等へ出力できます。IDFv3は基板外形、カットアウト、穴、部品外形などの基本機械情報を扱いますが、全ての機械意味論を表現するものではありません。IDXの初期対応とSTEPのみの初期対応のどちらを採用するかは未決定です。

KiCadの回路図エディタはngspiceを統合し、SPICE解析と波形確認を提供します。これは回路図を正とする設計へ戻す根拠ではなく、KiCad投影のレビュー・互換性経路です。ACDの決定論的なバッチ検証では、生成したSPICEネットリストを明示的なシミュレーションワーカーへ渡し、エンジン版、SPICE方言、モデル出所、収束状態、入力ハッシュを記録します。KiCad 10の`kicad-cli`は回路図のネットリスト出力などを提供しますが、独立したSPICE実行CLIやシミュレーションIPCを本仕様で仮定しません。

具体的な最低対応KiCadバージョン、ライブラリ固定方法、IPC APIの対応範囲は未決定（[ADR-0007](adr/0007-kicad-minimum-version.md)で決定）です。KiCad [10.0](https://github.com/KiCad/kicad-source-mirror/releases/tag/10.0.0)は2026年3月にリリースされ、9.xは積極的メンテナンス対象外です。公式ソースでは[2026年3月にSWIG/wxPython旧Python統合が削除](https://github.com/KiCad/kicad-source-mirror/commit/65a442b1d2bf153be7979de8926ab71fd095f4bd)され、IPC APIが今後の経路とされています。公式[`kicad-python`](https://docs.kicad.org/kicad-python-main/kicad.html)では`get_schematic()`がKiCad 11追加として記載されるため、回路図IPCはバージョン別能力として扱います。

## 能力マトリクス

| 経路                      | KiCad 10基準                                                     | KiCad 11以降                                                      | ACDでの用途・境界                                                             |
| ------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `kicad-cli`               | バッチERC/DRC、再読込、Gerber等のエクスポート                    | 同じ責務を継続                                                    | CI・ゲート・再現可能な出力。稼働中エディタの編集経路ではない                  |
| IPC API（PCB）            | 稼働中PCBエディタの取得・検査・ガード付き可逆変更                | 継続利用                                                          | リアルタイム編集、対象・差分・Undo/Redoを監査                                 |
| IPC API（回路図）         | 対応範囲は未決定（ADR-0007で決定）。利用可能な場合も能力検出する | `kicad-python`文書で回路図取得APIがKiCad 11追加と記載             | 生成グラフを正とし、回路図投影の補助経路として利用                            |
| ACD生成S式                | ACDが生成した`.kicad_sch`/`.kicad_pcb`をatomic write             | 同じ再オープン検証を実行                                          | KiCad APIが不足する場合の生成経路。直接編集ではなく、ハッシュ・リビジョン付き |
| 既存KiCadプロジェクト取込 | ファイル解析と変換損失を記録                                     | IPC取得が使える場合は二重検証                                     | KiCadを正に昇格させず、設計グラフへのimport投影とする                         |
| STEP/glTF/DXF/IDF         | KiCad/ACDからMCAD向け形状・外形を出力                            | 同じ形状を再読込し、単位・座標系・外形・穴・高さを照合            | MCADレビューと機械ゲートの交換境界。意味論・所有権は別途グラフで保持          |
| IDX                       | 初期対応は未決定                                                 | 対応する場合はbaseline、accept/reject、変更所有権、コメントを保持 | 増分ECAD↔MCAD同期の将来候補。完全なround-tripを現時点で保証しない            |

`kicad-cli`はバッチ検証・エクスポート、IPC APIは稼働中エディタの検査・ガード付き変更、ACD生成S式は投影ファイルの生成に限定します。いずれの経路でも再オープン、ERC/DRC、成果物ハッシュを検証します。

## 二重検証

生成後は`kicad-cli`でERC、DRC、各種エクスポートを実行し、ACD側のグラフ検証と結果を突き合わせます。ACDの軽量検査だけ、またはKiCadの終了コードだけを信頼しません。入力、コマンド、ツールバージョン、stdout/stderr、レポート、成果物ハッシュを保存します。

## Netlist-driven projection contract（Phase 1）

Phase 1では、設計グラフの`Component`、`Pin`、`Net`を正規入力とし、KiCad回路図と
PCBを同じnetlist projectionから生成します。自然言語やKiCad回路図をnetlistの
source of truthにはしません。

- 各`Component`と`Pin`は安定ID、reference、pin number、電気的属性を保持し、
  KiCad symbol pinおよびPCB footprint padへ一意に対応付ける。
- 各`Net`は安定ID、名称、接続pin集合を持ち、回路図のwire/labelとPCBのpad
  net assignmentへ同じnet IDで投影する。
- 未解決pin、重複pad、net名だけによる曖昧な接続、回路図とPCBの接続集合差分は
  `reference-integrity`または`verification-failed`としてjidoka停止する。
- 投影後に、グラフのnetlistとKiCadから読み戻したsymbol pin／PCB padの接続集合を
  canonical化して比較する。順序や表示名だけの差分は除外するが、接続集合、
  component/pin identity、pad番号の差分は許容しない。
- このnet-consistency gateは、ERC/DRC、再オープン、artifact hash gateより前に
  成功しなければならない。結果には入力revision、netlist hash、tool version、
  読み戻し結果、差分を記録する。

Phase 1 smokeでは、上記契約に基づくembedded official symbol、net label、
PWR_FLAG、PCB pad／track投影と、KiCad netlist／IPC-D-356のreadback比較を実装
しています。ESP32級goldenの全symbol／footprint geometryと汎用routerは後続作業です。

## IPC API

稼働中のPCBエディタに対する検査とガード付きの可逆変更にはKiCad IPC APIを使います。変更前後のグラフリビジョン、対象、差分、検証結果を記録し、直接の無監査編集を禁止します。

## 回路図の位置づけ

回路図は人間が読むための投影であり、正規モデルではありません。回路図への書き込み経路が弱く、S式ファイルの直接編集は壊れやすいため、まず設計グラフから生成し、KiCadから逆に正とすることはしません。既存KiCadプロジェクトを取り込む場合は、読込時に不確実性と変換損失を記録します。

## 再オープン検証

生成したプロジェクトを別プロセスで再オープンし、KiCadが読めること、部品・ネット・層・座標・ルールが期待と一致することを確認します。再オープン後にERC/DRCを再実行し、出力を再生成してハッシュ差分を確認します。

## 関連文書

- [`design-graph.md`](design-graph.md)：KiCadへ投影する正規モデル
- [`verification-gates.md`](verification-gates.md)：ERC/DRCと出力検証
- [`kicad-ci-profile.md`](kicad-ci-profile.md)：Phase 0/1の固定CI環境
- [`testing.md`](testing.md)：ゴールデンタスクと再オープン検証
- [`../README.md`](../README.md#7-ロードマップ)
