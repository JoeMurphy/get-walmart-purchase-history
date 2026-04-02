// Background service worker — relays status messages from content script to popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'status') {
    // Forward to popup if it's open
    chrome.runtime.sendMessage(msg).catch(() => {
      // Popup not open, ignore
    });
  }
});
