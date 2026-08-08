# ADR-0034: 予算ウォッチドッグの純粋コア契約

## ステータス

Accepted（Step A のコア契約。runner統合とGate 25証跡は後続handoff）

## 決定

1. Phase 4で測定するのは、task ledgerの`pending -> running`によるattempt数、
   injected monotonic clockの経過時間、外部process実行数の3つとする。
   registry replayのlogical request数は別カウンタで記録する。
2. budgetのcap宣言とusage snapshotを分離する。tokensとmoneyは測定せず、
   usageでは`{"status":"unknown"}`として明示的に保持し、0やpassへ変換しない。
3. run scopeとtask scopeを独立に判定する。task capは既存ledger entryのbudget、
   run capはrunnerが宣言し、停止したscopeをstop recordへ残す。
4. graph-coreには数値monotonic時刻を返す`MonotonicClockPort`を置き、実clock、
   sleep、timerはadapter/workerに置く。既存の`ClockPort`と`CheckpointClock`の
   重複統合は今回行わない。
5. 操作前にusageと見積りコストを加算して判定する。tool callは外部process
   1回、時間は呼び出し側が宣言する秒数を見積りとする。必要な見積りがない場合は
   `unknown-impact`として実行せず停止する。上限到達または到達見込みは
   `budget-exceeded`とする。
6. 無進捗の改善は、未解決finding数の減少、gate statusの改善、成果物hashの変化
   のいずれかとする。同一input＋proposal、成果物不変、gate結果の非改善、既訪問
   state hashへの復帰を、引数で与えた閾値で検知する。既定値2回は、1回の再試行を
   許容し、同一状態の連続を次の反復で停止する最小値である。
7. 機械可読の停止情報は`stop-record.schema.json`を正本とし、既存taxonomy、
   Evidence ID、checkpoint/event positionを参照する。ledgerの`stopReason`文字列
   は人間向け互換情報として残す。
8. tool observationはlogical request、registry replay、external process startを
   相関情報（run/task/attempt）付きで区別する。replayは外部実行数に加算しない。

## 代替案と理由

- 壁時計を使う案は時刻補正の影響を受けるため採用しない。
- registry record数をtool call数とする案はreplayと副作用実行を混同するため採用しない。
- token/moneyを省略する案はunknownと未計測を区別できないため採用しない。

## 範囲外

`scripts/phase4-resume.mts`、`scripts/phase1-stages.mts`のrunner統合、
Gate 25の証跡出力、Gate matrixのstatus変更は後続作業とする。
