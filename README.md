# Reader

SafariまたはChromeで表示している文章を、通常表示またはRSVPへ切り替えるReaderです。本文、URL、読書位置は保存しません。

## 開発

miseでNode.js、pnpm、XcodeGenを揃え、依存パッケージをインストールします。

```sh
mise install
pnpm install --frozen-lockfile
```

TypeScriptの型検査とテストを実行します。

```sh
pnpm check
pnpm test
```

Chrome拡張の配布用ファイルを生成します。

```sh
pnpm build:chrome
```

iOSプロジェクトを再生成する場合はXcodeGenを使います。生成済みのプロジェクトを使うだけならXcodeGenは不要です。

```sh
pnpm build:ios
mise exec -- xcodegen generate --spec apps/ios/project.yml
```

## iPhoneで試す

1. Xcodeで `apps/ios/Reader.xcodeproj` を開く
2. `Reader` と `ReaderExtension` のSigningで自分のPersonal Teamを選ぶ
3. Bundle Identifierの競合が表示された場合は、両ターゲットの識別子を自分用の一意な値へ変更する
4. 接続したiPhoneを実行先に選び、`Reader` を実行する
5. iPhoneの「設定」から「アプリ」→「Safari」→「拡張機能」→「Reader」を開き、拡張機能とWebサイトへのアクセスを許可する
6. Safariで記事を開き、画面右端の青い取っ手を押す

無料のPersonal Teamで署名したアプリは有効期限が切れるため、その場合はXcodeから再度実行します。

開発中の変更を実機へ反映するときは、アプリのコピーだけでなくXcodeのProduct > Runを使います。完了後、対象のSafariページを再読み込みします。

## Chromeで試す

1. `pnpm build:chrome`を実行する
2. `chrome://extensions`を開く
3. デベロッパーモードを有効にする
4. 「パッケージ化されていない拡張機能を読み込む」から`apps/chrome/dist`を選ぶ
5. 読みたい文章を選択してコンテキストメニューの「RSVPで読む」を選ぶか、拡張機能のアイコンを押す

## 構成

- `apps/chrome`: Chrome拡張とDesktop Viewer
- `apps/ios`: iOSホストアプリ、Safari Web Extension、Mobile Viewer
- `packages/extractor`: ページまたは文字列から共通のContentを生成
- `packages/engine`: 入力元と表示先に依存しない文章分割、表示時間、読書位置の計算
- `package.json`: DefuddleとTypeScriptを含むJavaScript依存関係
