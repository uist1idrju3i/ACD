# ADR-0009: Phase 0/1 CI用KiCad基準

**ステータス：Accepted（暫定）**

## 目的と権威範囲

Phase 0/1のCIとゴールデンタスクで使用するKiCadの暫定基準、コンテナ、
ライブラリ、能力検出を定めます。長期的な最低対応バージョンは
[`0007-kicad-minimum-version.md`](0007-kicad-minimum-version.md)で未決定の
ままとし、本ADRはCIの再現性だけを扱います。

## 文脈

ACDは設計グラフを正とし、KiCadを投影・検証経路として使います。Phase 0/1の
受入試験には、生成プロジェクトの再オープン、ERC/DRC、Gerber等の出力を同じ
環境で再現できることが必要です。KiCad 10/11の能力差、ライブラリ解決、
回路図IPCの可用性は未検証であり、全対応版で同じ機能を仮定できません。

## 決定

- Phase 0/1のCI基準はKiCad 10.xの固定コンテナを使用する
- パッチ版、OSイメージ、`kicad-cli`、標準symbol／footprint／3Dライブラリの
  取得元と版を固定し、lockまたはdigestで参照する
- 必要な標準ライブラリはCIイメージまたは明示的なfixture依存として同梱し、
  実行時の無条件ネットワーク取得に依存しない
- CI起動時にバージョン、CLI能力、利用可能なライブラリ、主要コマンドを
  capability probeで記録する
- `kicad-cli`のERC/DRC、Gerber、drill、必要な3D出力と、別プロセスでの
  再オープン検証をPhase 0/1の基準経路とする
- KiCad 10で回路図IPCが利用できることは仮定しない。回路図投影は生成S式と
  再オープン検証をフォールバックとする

具体的なcontainer digest、ライブラリ一覧、CLI引数、許容する警告とartifact
hashの期待値は[`../kicad-ci-profile.md`](../kicad-ci-profile.md)で固定する。

## 代替案

- KiCad 11を基準にする：回路図IPC候補は増えるが、Phase 0/1の環境可用性と
  fixture再現性を先に確認する必要がある
- KiCad 10/11のmatrixを直ちに構築する：長期互換性には有利だが、最初の
  vertical sliceの変動要因とCI負荷が増える
- ホスト環境のKiCadを使う：導入は容易だが、ライブラリ・版・出力差を
  再現できないため採用しない

## 結果と撤回条件

Phase 0/1の受入結果をKiCad 10.xの一つの再現可能な環境へ固定できます。
KiCad 11または複数版のサポート、製品の最低対応バージョン、回路図IPCの要求は
ADR-0007のfixture・能力テスト後に後続ADRで決定します。

KiCad 10.xの固定コンテナで必要なCLI、ライブラリ、再オープンが成立しない
場合は、空のAccepted扱いにせず、失敗結果を記録して基準版を見直します。

## 参照

- [`0007-kicad-minimum-version.md`](0007-kicad-minimum-version.md)
- [`../kicad-ci-profile.md`](../kicad-ci-profile.md)
- [`../kicad-interop.md`](../kicad-interop.md)
