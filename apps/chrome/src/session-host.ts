import type { SessionClientMessage, SessionWorkerMessage } from "./session-messages";

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "reader-session") return;
  const worker = new Worker(chrome.runtime.getURL("session-worker.js"), { type: "module" });
  let connected = true;

  worker.addEventListener("message", (event: MessageEvent<SessionWorkerMessage>) => {
    if (connected) port.postMessage(event.data);
  });
  worker.addEventListener("error", (event) => {
    if (connected) port.postMessage({ type: "error", message: event.message || "ReaderSession worker failed" });
  });
  port.onMessage.addListener((message: SessionClientMessage) => {
    if (message?.type === "dispatch") worker.postMessage(message);
  });
  port.onDisconnect.addListener(() => {
    connected = false;
    worker.terminate();
  });
});

export {};
