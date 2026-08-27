import type {
  ReaderScreen as ReaderScreenContract,
  ReaderViewLayout as ReaderViewLayoutContract,
  ReaderViewMount as ReaderViewMountContract,
} from "../../../packages/view/src/types";

declare global {
  var __readerInstalled: boolean;

  type ReaderScreen = ReaderScreenContract;
  type ReaderViewLayout = ReaderViewLayoutContract;
  type ReaderViewMount<Layout extends ReaderViewLayout> = ReaderViewMountContract<Layout>;

  interface ReaderViewApi {
    mount<Layout extends ReaderViewLayout>(host: Element, options: { layout: Layout }): ReaderViewMount<Layout>;
  }

  var ReaderView: ReaderViewApi | undefined;
}
