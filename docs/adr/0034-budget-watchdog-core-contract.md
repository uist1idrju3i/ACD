# ADR-0034: 予算ウォッチドッグの純粋コア契約

## ステータス

Accepted（Step Aのコア契約とStep Bのrunner接続。Gate 25のstatus変更は範囲外）

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
5. 操作前にusageと見積りコストを加算して判定する。tool callの見積りは、
   stageごとに実行し得る外部process数の保守的な上限（通常runでは全stageの
   最大値15、注入runではstage固有の上限）を使い、時間はstage単位の注入値1秒
   とする。必要な見積りがない場合は`unknown-impact`として実行せず停止する。
   上限到達または到達見込みは`budget-exceeded`とする。
   attempt上限の所有者はtask ledgerの`retryBudget`であり、`usage.attempts`は
   実測値として記録するだけである。既存ledgerは`pending -> running`遷移前に
   retry budgetを検査するため、到達後ではなく次のattempt実行前に停止する。
6. 無進捗の改善は、未解決finding数の減少、gate statusの改善、成果物hashの変化
   のいずれかとする。同一input＋proposal、成果物不変、gate結果の非改善、既訪問
   state hashへの復帰を、引数で与えた閾値で検知する。既定値2回は、1回の再試行を
   許容し、同一状態の連続を次の反復で停止する最小値である。
7. 機械可読の停止情報は`stop-record.schema.json`を正本とし、既存taxonomy、
   Evidence ID、checkpoint/event positionを参照する。ledgerの`stopReason`文字列
   は人間向け互換情報として残す。
8. tool observationはlogical request、registry replay、external process startを
   相関情報（run/task/attempt）付きで区別する。replayは外部実行数に加算しない。
9. Step Bのrunnerはrun/taskそれぞれのcapを操作前に判定し、停止時に
   `artifacts/phase4/budget-watchdog.json`を出力する。injected clock、attempt、
   observation counter、stop recordは既存のresume証跡から分離し、既存の
   `artifacts/phase4/resume.json`およびgate結果へ混入させない。
   証跡の`elapsedSeconds`は実時間ではなく、stageごとに1秒進める注入monotonic
   clockの値である。
10. usage更新eventはattempt・budgetの実測を保持するruntime eventであり、
    baselineとresumedで必然的に異なるため、resumeの意味比較対象から除外する。
    除外一覧には`task.transitioned(kind=usage-updated)`を明示する。raw event countは
    実event logの全件数を保持し、比較用の件数は別フィールドで除外後の集合を示す。

## 代替案と理由

- 壁時計を使う案は時刻補正の影響を受けるため採用しない。
- registry record数をtool call数とする案はreplayと副作用実行を混同するため採用しない。
- token/moneyを省略する案はunknownと未計測を区別できないため採用しない。

## 範囲外

Gate matrixのstatus変更、Gate 25の受入status確定は範囲外とする。

なお、taxonomyには存在する`convergence-failure`、`license-restriction`、
`approval-required`、`patent-concern`が、既存コード側の`ERROR_CODES`には未同期で
残っている。この差分は各error codeを所有する後続WPで整理する。
