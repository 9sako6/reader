# Safari拡張リソース

`manifest.json`から`document_idle`で常時注入するcontent scriptは`bootstrap.js`だけです。bootstrapは右端のreader handleと読み込み中のfeedbackを作り、handleが押された後に拡張機能のruntime URLからheavy runtimeをdynamic importします。通常の読み込み順はDefuddle、WASM glue、ReaderSession、Engine、Extractor、アイコン、Mobile Viewerです。本文を読むためのruntimeは、handleが押されるまで読み込まれません。

WASM本体の`reader_session_bg.wasm`を含むruntime生成物は、外部配信に依存しない自己完結したSafari Web Extensionのweb-accessible resourceとして同梱します。ページへscript要素を追加せず、content script側で拡張機能のruntime URLを読み込みます。

`viewer/`にTypeScriptのソース、`generated/`に`mise run build:ios`またはXcodeの事前ビルド処理による生成物が入ります。

- `manifest.json`: Safari Web Extensionの権限、常時注入するbootstrap、runtimeから読み込めるリソース
- `packages/icons`: Chromeと共有する操作アイコン
- `viewer/viewer.ts`: Mobile Viewerの表示と操作
- `viewer/bootstrap.ts`: handleとfeedbackを常時表示し、tap後にruntimeを起動してMobile Viewerへ引き渡すentry point
- `viewer/lazy-runtime.ts`: runtimeの順次dynamic import、同時openの単一promise化、失敗時のretry、close/navigation後のlate completion無効化
