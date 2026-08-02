# Golden task fixture

**ステータス：Draft**

## 目的と権威範囲

既知の入力と期待結果を固定し、Schema、graph-core、patch、KiCad adapter、
deterministic gateの変更を回帰評価します。採点軸の意味は[`testing.md`](testing.md)
を正とし、本書はfixtureと期待結果の粒度だけを定義します。

## 共通fixture形式

各fixtureは次を持ちます。

- `taskId`、fixture version、schema version
- 入力snapshot、patch JSONL、イベント列
- tool profileとinput hash
- 期待する終端状態、error code、停止／再開条件
- 期待artifactの一覧、hashまたは許容差
- 実行時間・介入・再試行の上限

fixtureはネットワーク、現在時刻、ホストのKiCad、未固定ライブラリに依存しない。

## 必須fixture

### `normal-2layer`

最小2層基板、部品、Pin、Net、Layout、BoardStackupからKiCad投影を生成する。
Schema、semantic validator、再オープン、ERC/DRC、Gerber/drillが合格し、
同一入力で同じsnapshot／artifact hashになることを期待する。

### `intentional-erc-failure`

ピン方向または電源定格の違反を注入する。ERCが不合格となり、設計を下流へ
流さず、`verification-failed`または具体的なERC errorへ分類し、修正候補または
停止条件をイベントへ残す。

### `intentional-drc-failure`

幅、間隔、穴、outlineのいずれかの違反を注入する。DRCが不合格となり、Gerber
発注準備へ進まず、findingの対象とseverityを保存する。

### `patch-conflict`

同一base revisionへ競合するpatchを適用する。片方だけが確定し、他方は
`patch-conflict`として停止する。自動merge、snapshotの部分書込みを許可しない。

### `stale-result`

revision Nで合格したVerificationResultの後に、依存Entityを変更したrevision
N+1を適用する。旧結果はstaleとなり、下流gateの合格証拠に使えない。

### `reopen-failure`

KiCad projectまたはlibraryを壊したfixtureを使う。別プロセス再オープンが失敗し、
`tool-failure`または`reopen-failure`として停止する。exit codeだけで成功扱いに
しない。

## 許容差と採点

- JSON snapshot、patch、eventのhashは完全一致を要求する。
- KiCad reportとartifactは、profileが明示したvolatile metadataを除き一致させる。
- 数値測定を含む将来fixtureは、単位、絶対／相対許容差、丸め規則をfixtureに書く。
- 各fixtureはpass/fail、error code、停止の正しさ、再開位置、生成差分、hash、
  不要な人間介入を記録する。

## testing.mdとの関係

`testing.md`は電気的妥当性、製造性、コスト、リードタイム、介入、自働化、
根拠という評価軸と回帰方針を定義する。本書は、その評価を再現する具体的な
入力fixture、故障注入、期待終端状態を定義し、評価軸を重複定義しない。

## 関連文書

- [`testing.md`](testing.md)
- [`phase0-plan.md`](phase0-plan.md)
- [`kicad-ci-profile.md`](kicad-ci-profile.md)
- [`error-taxonomy.md`](error-taxonomy.md)
