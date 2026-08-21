const MENU_ID = "read-selection-rsvp";

let requestSequence = 0;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "RSVPで読む",
      contexts: ["selection"],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return;

  const text = info.selectionText;
  if (!text || text.trim().length === 0) return;

  await startReader(tab.id, text);
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;

  let requestId = null;
  try {
    requestId = await openReader(tab.id);
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["vendor/defuddle/defuddle.js", "extractor.js"],
    });
    const extraction = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => globalThis.Extractor.fromPage(),
    });
    const result = extraction[0]?.result;
    if (!result?.text) throw new Error("No readable page content found");
    await sendReaderContent(tab.id, requestId, result.text, result.readingContext);
  } catch (error) {
    console.error("Failed to read the page with reader", error);
    if (requestId) await showReaderError(tab.id, requestId);
  }
});

async function startReader(tabId: number, text: string, readingContext: ReadingContext | null = null): Promise<void> {
  let requestId = null;
  try {
    requestId = await openReader(tabId);
    await sendReaderContent(tabId, requestId, text, readingContext);
  } catch (error) {
    console.error("Failed to start reader", error);
    if (requestId) await showReaderError(tabId, requestId);
  }
}

async function openReader(tabId: number): Promise<string> {
  const requestId = `${Date.now()}-${requestSequence += 1}`;
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["engine.js", "extractor.js", "viewer.js"],
  });
  await chrome.tabs.sendMessage(tabId, {
    type: "SHOW_RSVP_LOADING",
    requestId,
  });
  return requestId;
}

async function sendReaderContent(
  tabId: number,
  requestId: string,
  text: string,
  readingContext: ReadingContext | null,
): Promise<void> {
  await chrome.tabs.sendMessage(tabId, {
    type: "START_RSVP",
    text,
    readingContext,
    requestId,
  });
}

async function showReaderError(tabId: number, requestId: string): Promise<void> {
  await chrome.tabs.sendMessage(tabId, {
    type: "RSVP_ERROR",
    requestId,
  }).catch(() => {});
}
