const SESSION_HOST_PATH = "session-host.html";

let requestSequence = 0;
const activeRequestByTab = new Map<number, string>();
const failedRequestByTab = new Map<number, string>();
let sessionHostCreation: Promise<void> | null = null;

async function ensureSessionHost(): Promise<void> {
  const sessionHostUrl = chrome.runtime.getURL(SESSION_HOST_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [sessionHostUrl],
  });
  if (contexts.length > 0) return;
  if (!sessionHostCreation) {
    sessionHostCreation = chrome.offscreen.createDocument({
      url: SESSION_HOST_PATH,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: "Run the local ReaderSession worker outside website content security policies.",
    }).finally(() => {
      sessionHostCreation = null;
    });
  }
  await sessionHostCreation;
}

function registerAndExtractPage(requestId: string): Promise<ReaderContent | null> {
  const scope = globalThis as typeof globalThis & {
    __readerPreparationControllers?: Map<string, AbortController>;
  };
  const controllers = scope.__readerPreparationControllers || new Map<string, AbortController>();
  scope.__readerPreparationControllers = controllers;
  const controller = new AbortController();
  controllers.set(requestId, controller);
  return globalThis.Extractor.fromPageAsync(undefined, undefined, { signal: controller.signal }).finally(() => {
    if (controllers.get(requestId) === controller) controllers.delete(requestId);
  });
}

function abortPreparationController(requestId: string): void {
  const scope = globalThis as typeof globalThis & {
    __readerPreparationControllers?: Map<string, AbortController>;
  };
  const controller = scope.__readerPreparationControllers?.get(requestId);
  controller?.abort();
  scope.__readerPreparationControllers?.delete(requestId);
}

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (typeof message !== "object" || message === null) return;
  const value = message as Record<string, unknown>;
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number" || typeof value.requestId !== "string") return;

  if (value.type === "CANCEL_READER") {
    cancelPreparation(tabId, value.requestId);
    return;
  }
  if (value.type === "RETRY_READER") {
    void retryPreparation(tabId, value.requestId);
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  await startPreparation(tab.id);
});

async function retryPreparation(tabId: number, requestId: string): Promise<void> {
  if (failedRequestByTab.get(tabId) !== requestId) return;
  await startPreparation(tabId);
}

async function startPreparation(tabId: number): Promise<void> {
  const previousRequestId = activeRequestByTab.get(tabId);
  const requestId = beginPreparation(tabId);
  if (previousRequestId) await abortInjectedPreparation(tabId, previousRequestId);
  try {
    await openReader(tabId, requestId);
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["vendor/defuddle/defuddle.js"],
    });
    const extraction = await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      args: [requestId],
      func: registerAndExtractPage,
    });
    if (!isActiveRequest(tabId, requestId)) return;
    const result = extraction[0]?.result;
    if (!result?.text) throw createPreparationFailure("content_not_found");
    await sendReaderContent(tabId, requestId, result.text, result.readingContext);
  } catch (error) {
    if (!isActiveRequest(tabId, requestId)) return;
    if (error instanceof Error && error.name === "AbortError") {
      cancelPreparation(tabId, requestId);
      return;
    }
    console.error("Failed to prepare page with reader", error);
    const reason = classifyPreparationFailure(error);
    failedRequestByTab.set(tabId, requestId);
    await showReaderError(tabId, requestId, reason);
  }
}

function beginPreparation(tabId: number): string {
  const requestId = `${Date.now()}-${requestSequence += 1}`;
  activeRequestByTab.set(tabId, requestId);
  failedRequestByTab.delete(tabId);
  return requestId;
}

function loadReaderRuntime(runtimeURL: string): Promise<void> {
  const scope = globalThis as typeof globalThis & {
    __readerRuntimeAttempt?: number;
    __readerRuntimePromise?: Promise<void>;
  };
  if (scope.__readerRuntimePromise) return scope.__readerRuntimePromise;
  const attempt = (scope.__readerRuntimeAttempt ?? 0) + 1;
  scope.__readerRuntimeAttempt = attempt;
  const url = new URL(runtimeURL);
  url.searchParams.set("readerAttempt", String(attempt));
  scope.__readerRuntimePromise = import(url.href)
    .then(() => undefined)
    .catch((error: unknown) => {
      scope.__readerRuntimePromise = undefined;
      throw error;
    });
  return scope.__readerRuntimePromise;
}

async function openReader(tabId: number, requestId: string): Promise<void> {
  await ensureSessionHost();
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    func: loadReaderRuntime,
    args: [chrome.runtime.getURL("runtime.js")],
  });
  if (!isActiveRequest(tabId, requestId)) return;
  await chrome.tabs.sendMessage(tabId, {
    type: "SHOW_READER_LOADING",
    requestId,
  });
}

async function sendReaderContent(
  tabId: number,
  requestId: string,
  text: string,
  readingContext: ReadingContext | null,
): Promise<void> {
  if (!isActiveRequest(tabId, requestId)) return;
  await chrome.tabs.sendMessage(tabId, {
    type: "START_READER",
    text,
    readingContext,
    requestId,
  });
}

async function showReaderError(
  tabId: number,
  requestId: string,
  reason: PreparationFailure,
): Promise<void> {
  if (!isActiveRequest(tabId, requestId)) return;
  await chrome.tabs.sendMessage(tabId, {
    type: "READER_ERROR",
    requestId,
    reason,
  }).catch(() => {});
}

function cancelPreparation(tabId: number, requestId: string): void {
  if (!isActiveRequest(tabId, requestId)) return;
  void abortInjectedPreparation(tabId, requestId);
  activeRequestByTab.delete(tabId);
  if (failedRequestByTab.get(tabId) === requestId) failedRequestByTab.delete(tabId);
}

async function abortInjectedPreparation(tabId: number, requestId: string): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    args: [requestId],
    func: abortPreparationController,
  }).catch(() => {});
}

function isActiveRequest(tabId: number, requestId: string): boolean {
  return activeRequestByTab.get(tabId) === requestId;
}

function createPreparationFailure(reason: PreparationFailure): Error {
  const error = new Error(reason);
  error.name = "PreparationFailure";
  return error;
}

function classifyPreparationFailure(error: unknown): PreparationFailure {
  if (error instanceof Error && error.message === "content_not_found") return "content_not_found";
  if (error instanceof Error && error.message === "unsupported_page") return "unsupported_page";
  if (error instanceof Error && error.message === "extraction_failed") return "extraction_failed";
  if (error instanceof Error && /cannot access|not supported|invalid url|restricted/iu.test(error.message)) {
    return "unsupported_page";
  }
  return "extraction_failed";
}
