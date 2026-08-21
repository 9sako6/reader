# Safari拡張リソース

`manifest.json`は、Defuddle、Engine、Extractor、アイコン、Mobile Viewer、bootstrapを依存順に読み込みます。Mobile Viewerのレイアウトと状態はDesktop Viewerから独立しています。

`viewer/`がTypeScriptのソースです。`generated/`は`mise run build:ios`またはXcodeの事前ビルド処理で生成され、リポジトリには保存しません。

- `manifest.json`: Safari Web Extensionの権限とContent Scriptの読み込み順
- `viewer/icons.ts`: Mobile Viewerのアイコン生成
- `viewer/viewer.ts`: Mobile Viewerの表示と操作
- `viewer/bootstrap.ts`: Mobile Viewerの起動
