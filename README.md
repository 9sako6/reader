# reader

SafariとChromeで、PageとSpotsを切り替えて読めるreaderです。

## 開発

```sh
mise install
pnpm install --frozen-lockfile
mise run check
mise run test
```

実ブラウザのviewer E2Eを初めて実行するときは、Playwrightのブラウザをインストールします。

```sh
pnpm exec playwright install chromium webkit
mise run test:e2e
```

## 構成

- [Chrome拡張](apps/chrome/README.md)
- [iOSアプリとSafari拡張](apps/ios/README.md)
- [Engine](packages/engine/README.md)
- [Extractor](packages/extractor/README.md)
