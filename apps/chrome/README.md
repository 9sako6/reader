# Chrome拡張

Chromeで選択した文章またはページ本文を読み取り、Desktop Viewerで通常表示またはRSVPへ切り替えます。Desktop Viewerのレイアウトと状態はMobile Viewerから独立しています。

## ビルド

```sh
mise run build:chrome
```

生成された`dist/`を、`chrome://extensions`の「パッケージ化されていない拡張機能を読み込む」から選択します。

## 構成

- `manifest.json`: Chrome拡張の権限、Service Worker、配布バージョン
- `src/service-worker.ts`: コンテキストメニュー、拡張アイコン、ページ本文抽出の起点
- `src/viewer/viewer.ts`: Desktop Viewerの表示と操作
- `test/`: Chrome固有のメッセージ、表示、配布物のテスト

配布物にはEngine、Extractor、Defuddle、Desktop Viewerを含みます。本文、URL、読書位置は保存しません。
