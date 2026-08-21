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
      files: ["vendor/defuddle/defuddle.js", "page-extractor.js"],
    });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => globalThis.RsvpPageExtractor.extractPage(),
    });
    if (!result?.text) throw new Error("No readable page content found");
    await sendReaderContent(tab.id, requestId, result.text, result.readingContext);
  } catch (error) {
    console.error("Failed to read the page with RSVP Reader", error);
    if (requestId) await showReaderError(tab.id, requestId);
  }
});

async function startReader(tabId, text, readingContext = null) {
  let requestId = null;
  try {
    requestId = await openReader(tabId);
    await sendReaderContent(tabId, requestId, text, readingContext);
  } catch (error) {
    console.error("Failed to start RSVP Reader", error);
    if (requestId) await showReaderError(tabId, requestId);
  }
}

async function openReader(tabId) {
  const requestId = `${Date.now()}-${requestSequence += 1}`;
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["core.js", "reader.js"],
  });
  await chrome.tabs.sendMessage(tabId, {
    type: "SHOW_RSVP_LOADING",
    requestId,
  });
  return requestId;
}

async function sendReaderContent(tabId, requestId, text, readingContext) {
  await chrome.tabs.sendMessage(tabId, {
    type: "START_RSVP",
    text,
    readingContext,
    requestId,
  });
}

async function showReaderError(tabId, requestId) {
  await chrome.tabs.sendMessage(tabId, {
    type: "RSVP_ERROR",
    requestId,
  }).catch(() => {});
}
