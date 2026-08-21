# ReaderExtension

ReaderのSafari Web Extensionターゲットです。SwiftのハンドラーはSafari拡張との接続を担当し、文章の抽出とMobile Viewerの表示はWebリソース内で完結します。

- `SafariWebExtensionHandler.swift`: Safari Web Extensionのネイティブ側ハンドラー
- `Info.plist`: 拡張ターゲットのメタデータ
- [Resources](Resources/README.md): manifestとブラウザへ読み込むリソース
