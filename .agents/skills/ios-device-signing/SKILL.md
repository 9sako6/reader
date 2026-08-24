---
name: ios-device-signing
description: このリポジトリのiOSアプリを実機または個人用TestFlight向けにビルドするとき、VersionとBuildの追跡、Xcodeプロジェクト生成、Development Team、署名、プロビジョニングを正しく扱う。
---

# iOS個人用ビルド

## VersionとBuild

- 外部配布を予定しない個人用TestFlightでは、`MARKETING_VERSION`をユーザーが区切りを求めるまで固定し、TestFlightへアップロードするたび`CURRENT_PROJECT_VERSION`だけを単調増加させる。シミュレータや一時的な実機ビルドでは増やさない。
- `apps/ios/project.yml`をVersionとBuildの唯一の編集元にする。`apps/ios/reader.xcodeproj`のVersionとBuildを直接編集せず、`mise run bump:ios-build`または`mise run generate:ios-project`で同期する。
- アプリ本体とSafari拡張には同じVersionとBuildを設定する。生成後は`mise run verify:ios-project`で差分がないことを確認する。
- TestFlightへ送るBuildは、Build更新を含むコミット済みのコードから作る。ユーザーが実機で動作確認した後、回帰調査の基準としてタグを求めた場合は`ios-testflight-v<Version>-build.<Build>`形式の付け替えない注釈付きタグを使う。
- 動作中のアプリを新しいBuildで置き換える前に、直前に正常だったBuildに対応するコミットまたはタグを特定できることを確認する。新しいBuildが壊れていた場合は、そのコードへ戻して未使用のBuild番号で再配布する。
- 過去のコードを再配布するときも、App Store Connectで使用済みのBuildへ戻さず、過去コミットから新しいBuild番号を作る。リポジトリの番号より新しいTestFlight Buildが存在し得る場合は、採番前にApp Store Connectの最新値を確認する。
- タグ作成、タグのpush、TestFlightへのアップロードは、それぞれユーザーが依頼した範囲でのみ行う。

## 署名

- 利用者固有のDevelopment Teamはリポジトリへ保存せず、`xcodebuild`の`DEVELOPMENT_TEAM`へ一時的に渡す。
- `security find-identity -v -p codesigning`が表示する証明書名末尾の括弧内IDをTeam IDと決めつけない。証明書Subjectの`OU`またはプロビジョニングプロファイルの`TeamIdentifier`を使い、両者の一致を確認する。
- 誤ったTeam IDを渡した場合も`No Account for Team`は出る。このエラーだけでApple Accountが未ログインだと判断しない。
- 正しいTeam IDに対応する有効な証明書またはプロファイルがないと確認できた場合だけ、XcodeでのTeam選択やサインインを案内する。
- Team ID、メールアドレス、プロファイルUUID、端末ID、ローカルパスをリポジトリへ書き込まない。
- 実機へのインストールや起動は、ユーザーが実機反映を依頼した場合だけ行う。
