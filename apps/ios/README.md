# iOSアプリとSafari拡張

`reader`はSafari Web Extensionを内包するiOSアプリです。ホストアプリと拡張機能はXcodeGenで一つのXcodeプロジェクトとして管理します。

## プロジェクト生成

```sh
mise run build:ios
mise run generate:ios-project
```

`project.yml`を共有するXcodeプロジェクト設定の管理元とし、`reader.xcodeproj`をそこから生成します。生成済みプロジェクトのVersionやBuildを直接変更せず、共有設定の変更後は生成タスクを実行します。Xcodeでビルドすると、Safari拡張のTypeScriptリソースも更新されます。

## GitHub Release

Apple版のVersionはChrome版と同じ`YYYY.M.RELEASE`形式です。共通バージョンを更新するときは、Chromeのmanifest、`project.yml`、Safari Web Extensionのmanifestをまとめて更新します。

```sh
mise run bump:release
```

mainへ反映して実機確認を終えたら、共通のリリースタスクでChromeとAppleのタグを同じコミットへ付けます。

```sh
mise run release
```

`apple-v<version>`タグから作るGitHub Releaseには、署名情報を含まないソーススナップショットとSHA-256チェックサムを添付します。署名済みIPAではないため、GitHub ReleaseからiPhoneへ直接インストールはできません。アプリ画面にはビルド元の短いGitコミットハッシュを表示し、未コミット差分を含む場合は末尾に`-dirty`を付けます。

## 個人用TestFlightビルド

TestFlightへアップロードするたびにBuildを増やします。シミュレータや一時的な実機ビルドでは増やしません。Versionは共通リリースの更新時だけ変更します。

```sh
mise run bump:ios-build
```

このタスクは`project.yml`のBuildを増やし、`reader.xcodeproj`を再生成します。コード変更とBuild更新を同じコミットに含め、そのコミットからArchiveします。利用者固有の署名設定はコミットに含めません。これにより、TestFlightのBuild番号から対応するコードをGit履歴で特定できます。

動作確認できたBuildを長期的な基準にする場合は、そのコミットへ`ios-testflight-v<Version>-build.<Build>`形式の付け替えない注釈付きタグを付けます。過去のコードへ戻して再アップロードするときも、TestFlightで使用済みのBuild番号は再利用せず、新しい番号を割り当てます。

## iPhoneで試す

1. Xcodeで`reader.xcodeproj`を開く
2. `reader`と`reader-extension`のSigningで使用するTeamを選ぶ
3. Bundle Identifierが競合する場合は、両ターゲットを一意な値へ変更する
4. 接続したiPhoneを実行先に選び、`reader`を実行する
5. iPhoneの「設定」から「アプリ」→「Safari」→「拡張機能」→「reader」を開き、拡張機能とWebサイトへのアクセスを許可する
6. Safariで記事を開き、画面右端の取っ手を押す

無料のPersonal Teamで署名したアプリは有効期限が切れるため、その場合はXcodeから再度実行します。開発中の変更を実機へ反映するときはXcodeのProduct > Runを使い、完了後に対象のSafariページを再読み込みします。

リリース前のSafari固有の確認項目は[Safari拡張のリリースチェックリスト](ReaderExtension/RELEASE_CHECKLIST.md)にまとめています。

## 構成

- [iOSホストアプリ](ReaderApp/README.md)
- [Safari Web Extension](ReaderExtension/README.md)
- `project.yml`: バージョン、Build、ターゲット、署名設定、リソース生成処理の管理元
- `reader.xcodeproj`: `project.yml`から生成する共有Xcodeプロジェクト
