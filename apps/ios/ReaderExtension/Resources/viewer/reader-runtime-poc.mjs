export async function installRuntime(scope) {
  if (!scope.document?.documentElement) throw new Error("reader runtime requires a document");
  if (!scope.MobileViewer?.open) throw new Error("reader runtime requires MobileViewer");
  if (!scope.ReaderSession?.init || !scope.ReaderSession?.create) {
    throw new Error("reader runtime requires ReaderSession");
  }
  await scope.ReaderSession.init();
  const handle = scope.ReaderSession.create();
  const phase = handle.state?.phase;
  scope.ReaderSession.destroy(handle);
  return { ready: true, world: "extension-content-script", sessionPhase: phase };
}
