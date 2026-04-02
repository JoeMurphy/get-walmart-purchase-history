const statusEl = document.getElementById('status');
const startBtn = document.getElementById('startBtn');
const limitBtns = document.querySelectorAll('.order-limit .options button');

let selectedLimit = 50;

function setStatus(msg) {
  statusEl.textContent = msg;
}

// Order limit selection
limitBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    limitBtns.forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedLimit = parseInt(btn.dataset.limit);
  });
});

// Check if we're on the right page and if scraping is already running
async function checkState() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !tab.url.includes('walmart.com/orders')) {
      setStatus('Navigate to walmart.com/orders first.');
      startBtn.disabled = true;
      return;
    }

    const response = await chrome.tabs.sendMessage(tab.id, { type: 'get_status' });
    if (response && response.running) {
      setStatus(`Scraping in progress... ${response.progress || ''}`);
      startBtn.disabled = true;
      startBtn.textContent = 'Scraping...';
    } else {
      startBtn.disabled = false;
    }
  } catch (e) {
    // Content script might not be loaded yet
    setStatus('Navigate to walmart.com/orders first.');
    startBtn.disabled = true;
  }
}

startBtn.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    startBtn.disabled = true;
    startBtn.textContent = 'Scraping...';
    setStatus('Starting...');

    await chrome.tabs.sendMessage(tab.id, {
      type: 'start_scraping',
      maxOrders: selectedLimit,
    });
  } catch (e) {
    setStatus('Error: Could not connect. Refresh the Walmart orders page.');
    startBtn.disabled = false;
    startBtn.textContent = 'Start Scraping';
  }
});

// Listen for status updates from content script
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'status') {
    setStatus(msg.message);
  }
});

checkState();
