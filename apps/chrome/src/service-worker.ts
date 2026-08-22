const MENU_ID = "read-selection-rsvp";

type PreparationOperation =
  | { kind: "page" }
  | { kind: "selection"; text: string; readingContext: ReadingContext | null };

interface RetryOperation {
  requestId: string;
  operation: PreparationOperation;
}

let requestSequence = 0;
const activeRequestByTab = new Map<number, string>();
const retryOperationByTab = new Map<number, RetryOperation>();
let activePreparation: PreparationState = { kind: "idle" };

function registerAndExtractPage(requestId: string): Promise<ReaderContent | null> {
  const scope = globalThis as typeof globalThis & {
    __rsvpPreparationControllers?: Map<string, AbortController>;
  };
  const controllers = scope.__rsvpPreparationControllers || new Map<string, AbortController>();
  scope.__rsvpPreparationControllers = controllers;
  const controller = new AbortController();
  controllers.set(requestId, controller);
  return globalThis.Extractor.fromPageAsync(undefined, undefined, { signal: controller.signal }).finally(() => {
    if (controllers.get(requestId) === controller) controllers.delete(requestId);
  });
}

function abortPreparationController(requestId: string): void {
  const scope = globalThis as typeof globalThis & {
    __rsvpPreparationControllers?: Map<string, AbortController>;
  };
  const controller = scope.__rsvpPreparationControllers?.get(requestId);
  controller?.abort();
  scope.__rsvpPreparationControllers?.delete(requestId);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "RSVPで読む",
      contexts: ["selection"],
    });
  });
});

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (typeof message !== "object" || message === null) return;
  const value = message as Record<string, unknown>;
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number" || typeof value.requestId !== "string") return;

  if (value.type === "CANCEL_RSVP") {
    cancelPreparation(tabId, value.requestId);
    return;
  }
  if (value.type === "RETRY_RSVP") {
    void retryPreparation(tabId, value.requestId);
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return;

  const text = info.selectionText;
  if (!text || text.trim().length === 0) return;

  await startReader(tab.id, text);
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  await startPreparation(tab.id, { kind: "page" });
});

async function startReader(
  tabId: number,
  text: string,
  readingContext: ReadingContext | null = null,
): Promise<void> {
  await startPreparation(tabId, { kind: "selection", text, readingContext });
}

async function retryPreparation(tabId: number, requestId: string): Promise<void> {
  const retryOperation = retryOperationByTab.get(tabId);
  if (!retryOperation || retryOperation.requestId !== requestId) return;
  await startPreparation(tabId, retryOperation.operation);
}

async function startPreparation(tabId: number, operation: PreparationOperation): Promise<void> {
  const previousRequestId = activeRequestByTab.get(tabId);
  const requestId = beginPreparation(tabId, operation);
  if (previousRequestId) await abortInjectedPreparation(tabId, previousRequestId);
  try {
    await openReader(tabId, requestId);
    if (operation.kind === "selection") {
      await sendReaderContent(tabId, requestId, operation.text, operation.readingContext);
      return;
    }

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
    const reason = classifyPreparationFailure(error);
    activePreparation = { kind: "failed", requestId, reason };
    await showReaderError(tabId, requestId, reason);
  }
}

function beginPreparation(tabId: number, operation: PreparationOperation): string {
  const requestId = `${Date.now()}-${requestSequence += 1}`;
  activeRequestByTab.set(tabId, requestId);
  retryOperationByTab.set(tabId, { requestId, operation });
  activePreparation = { kind: "preparing", requestId, startedAt: Date.now() };
  return requestId;
}

async function openReader(tabId: number, requestId: string): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["engine.js", "extractor.js", "icons.js", "viewer.js"],
  });
  if (!isActiveRequest(tabId, requestId)) return;
  await chrome.tabs.sendMessage(tabId, {
    type: "SHOW_RSVP_LOADING",
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
    type: "START_RSVP",
    text,
    readingContext,
    requestId,
  });
  if (isActiveRequest(tabId, requestId)) {
    activePreparation = { kind: "ready", requestId };
    retryOperationByTab.delete(tabId);
  }
}

async function showReaderError(
  tabId: number,
  requestId: string,
  reason: PreparationFailure,
): Promise<void> {
  if (!isActiveRequest(tabId, requestId)) return;
  await chrome.tabs.sendMessage(tabId, {
    type: "RSVP_ERROR",
    requestId,
    reason,
  }).catch(() => {});
}

function cancelPreparation(tabId: number, requestId: string): void {
  if (!isActiveRequest(tabId, requestId)) return;
  void abortInjectedPreparation(tabId, requestId);
  activeRequestByTab.delete(tabId);
  if (retryOperationByTab.get(tabId)?.requestId === requestId) retryOperationByTab.delete(tabId);
  if (activePreparation.kind !== "idle" && activePreparation.requestId === requestId) {
    activePreparation = { kind: "cancelled", requestId };
  }
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
