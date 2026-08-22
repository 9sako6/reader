export {};

declare global {
  var __rsvpReaderInstalled: boolean;

  interface ReaderReactMount {
    unmount(): void;
  }

  interface ReaderReactSpikeApi {
    mount(host: Element): ReaderReactMount;
  }

  var ReaderReactSpike: ReaderReactSpikeApi | undefined;
}
