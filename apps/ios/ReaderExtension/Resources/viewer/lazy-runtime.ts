export interface LazyRuntimeController {
  open(): Promise<boolean>;
  close(): void;
  navigate(): void;
}

export type ExtensionRuntimeImporter = (runtimeURL: string) => Promise<unknown>;

export function createExtensionRuntimeController(
  getRuntimeURL: (resourceName: string) => string,
  importRuntime: ExtensionRuntimeImporter,
): LazyRuntimeController {
  return createLazyRuntimeController(() => importRuntime(getRuntimeURL("reader-runtime.js")).then(() => undefined));
}

export function createLazyRuntimeController(loadRuntime: () => Promise<void>): LazyRuntimeController {
  let runtimePromise: Promise<void> | null = null;
  let generation = 0;

  const ensureRuntime = (): Promise<void> => {
    if (runtimePromise) return runtimePromise;
    runtimePromise = loadRuntime().catch((error: unknown) => {
      runtimePromise = null;
      throw error;
    });
    return runtimePromise;
  };

  return {
    async open(): Promise<boolean> {
      const requestGeneration = generation;
      try {
        await ensureRuntime();
      } catch (error: unknown) {
        if (requestGeneration !== generation) return false;
        throw error;
      }
      return requestGeneration === generation;
    },
    close(): void {
      generation += 1;
    },
    navigate(): void {
      generation += 1;
    },
  };
}
