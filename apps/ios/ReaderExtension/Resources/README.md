# Safari拡張リソース

`manifest.json`は、Defuddle、Engine、Extractor、アイコン、Mobile Viewer、bootstrapの順に読み込みます。Mobile Viewerはスマホの画面に合わせた文章表示と操作パネルを組み立てます。

`viewer/`にTypeScriptのソース、`generated/`に`mise run build:ios`またはXcodeの事前ビルド処理による生成物が入ります。

- `manifest.json`: Safari Web Extensionの権限とContent Scriptの読み込み順
- `packages/icons`: Chromeと共有する操作アイコン
- `viewer/viewer.ts`: Mobile Viewerの表示と操作
- `viewer/bootstrap.ts`: Mobile Viewerの起動
