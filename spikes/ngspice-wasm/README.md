# ngspice WASM feasibility spike

このspikeは、ngspice互換netlistをブラウザ／Node.jsで実行できるWASM実装の
実現可能性を、monorepoへ依存を追加せず確認します。候補の
`eecircuit-engine`はMIT、version 1.7.0、npm registry由来です。

実行：

```sh
bash spikes/ngspice-wasm/run.sh
```

このspikeは一時ディレクトリへpackageを取得して実行し、ACDのlockfileや
`node_modules`を変更しません。
