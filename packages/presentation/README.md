# Reader presentation

ChromeとSafariで共通の、抽出結果から画面表示までの境界です。

`PreparedReaderDocument`は、不変な本文、意味単位、最終RSVPフレーム、図、reading flow、見出しを一つにまとめます。最終フレームは固定書体の実測幅から準備時またはviewport変更時に確定し、そのメタデータをReaderSessionへ渡します。

`presentReader(document, session, uiState)`は、PreparedReaderDocument、ReaderSessionが所有する動的な読書状態、platform固有の一時的なUI状態だけから`ReaderScreen`を返す純粋関数です。Viewは返された画面をそのまま描画します。
