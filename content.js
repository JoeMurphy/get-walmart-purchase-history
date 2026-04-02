// Walmart Order Scraper - Chrome Extension Content Script
// Equivalent to Tampermonkey script v3.1

(function () {
  'use strict';

  const CONFIG = {
    maxOrders: 50,
    maxPages: 50,
    maxWaitTime: 15000,
  };

  const STATE_KEY = 'wmt_scraper_state';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ─── State management (sessionStorage) ───

  function getState() {
    try {
      const raw = sessionStorage.getItem(STATE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function setState(s) {
    try {
      sessionStorage.setItem(STATE_KEY, JSON.stringify(s));
    } catch (e) {
      console.error('State save error:', e);
    }
  }

  function clearState() {
    sessionStorage.removeItem(STATE_KEY);
  }

  function waitForSelector(selector, timeout = CONFIG.maxWaitTime) {
    return new Promise((resolve) => {
      const start = Date.now();
      const iv = setInterval(() => {
        const els = document.querySelectorAll(selector);
        if (els.length > 0 || Date.now() - start > timeout) {
          clearInterval(iv);
          resolve(els.length > 0);
        }
      }, 500);
    });
  }

  // ─── STATUS BANNER ───

  function showStatus(msg) {
    let banner = document.getElementById('wmt-scraper-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'wmt-scraper-banner';
      banner.style.cssText =
        'position:fixed;top:0;left:0;right:0;z-index:999999;background:#1a1a2e;color:#0f0;font-family:monospace;font-size:14px;padding:12px 20px;text-align:center;border-bottom:2px solid #0f0;';
      document.body.prepend(banner);
    }
    banner.textContent = msg;
    console.log(`[WMT Scraper] ${msg}`);

    // Notify popup of status updates
    chrome.runtime.sendMessage({ type: 'status', message: msg }).catch(() => {});
  }

  // ─── Extract order IDs currently visible ───

  function extractVisibleOrders() {
    const orders = [];
    const seenIds = new Set();
    document
      .querySelectorAll('[data-automation-id*="view-order-details-link-"]')
      .forEach((btn) => {
        const id = btn
          .getAttribute('data-automation-id')
          .replace('view-order-details-link-', '');
        if (seenIds.has(id)) return;
        seenIds.add(id);

        let orderDate = '';
        let orderTotal = '';

        let card = btn;
        for (let i = 0; i < 12; i++) {
          if (card.parentElement) card = card.parentElement;
          if (
            card.getAttribute &&
            card.getAttribute('data-testid')?.startsWith('order-')
          )
            break;
        }

        const h2 = card.querySelector('h2');
        if (h2) orderDate = h2.textContent.trim().replace(' purchase', '');

        const totalSpan = card.querySelector('span.dark-gray');
        if (totalSpan) {
          const m = totalSpan.textContent.match(/\$[\d,]+\.\d{2}/);
          if (m) orderTotal = m[0];
        }

        // Build the correct detail URL
        // Store orders use ?groupId=0&storePurchase=true
        // Delivery orders use ?groupId=<hash> (extracted from links in the card)
        let detailUrl = '';

        // First check for any link in the card that points to this order's detail page
        const allLinks = card.querySelectorAll('a[href*="/orders/"]');
        for (const link of allLinks) {
          const href = link.getAttribute('href') || '';
          if (href.includes(`/orders/${id}`) && !href.includes('/returns') && href.includes('groupId')) {
            detailUrl = href.startsWith('http') ? href : `https://www.walmart.com${href}`;
            break;
          }
        }

        if (!detailUrl) {
          // Fall back: detect order type from return link
          const isStore = !!document.querySelector(
            `a[href*="/orders/${id}/returns?orderSource=STORE"]`
          );
          if (isStore) {
            detailUrl = `https://www.walmart.com/orders/${id}?groupId=0&storePurchase=true`;
          } else {
            // For delivery orders, try to extract groupId from any link in the card
            let groupId = '';
            for (const link of allLinks) {
              const href = link.getAttribute('href') || '';
              const gm = href.match(/groupId=([a-f0-9]+)/);
              if (gm) { groupId = gm[1]; break; }
            }
            detailUrl = groupId
              ? `https://www.walmart.com/orders/${id}?groupId=${groupId}`
              : `https://www.walmart.com/orders/${id}?groupId=0&storePurchase=true`;
          }
        }

        orders.push({
          id,
          detailUrl,
          orderDate,
          orderTotal,
        });
      });
    return orders;
  }

  // ─── Click next page ───

  function findNextButton() {
    const chevron = document.querySelector('i.ld-ChevronRight');
    if (chevron) {
      let el = chevron;
      for (let i = 0; i < 5; i++) {
        el = el.parentElement;
        if (!el) break;
        if (el.tagName === 'A' || el.tagName === 'BUTTON') return el;
        if (el.getAttribute('role') === 'button') return el;
        if (el.style.cursor === 'pointer') return el;
      }
      return chevron.parentElement || chevron;
    }
    const next = document.querySelector(
      '[aria-label="Next Page"], [aria-label="next page"], [aria-label*="Next"]'
    );
    if (next) return next;
    return null;
  }

  async function clickNextAndWait(knownIds) {
    const nextBtn = findNextButton();
    if (!nextBtn) {
      console.log('   No next button found');
      return false;
    }
    if (
      nextBtn.hasAttribute('disabled') ||
      nextBtn.getAttribute('aria-disabled') === 'true' ||
      nextBtn.classList.contains('disabled')
    ) {
      console.log('   Next button is disabled — last page');
      return false;
    }
    const style = window.getComputedStyle(nextBtn);
    if (style.pointerEvents === 'none' || parseFloat(style.opacity) < 0.5) {
      console.log('   Next button appears disabled (opacity/pointer-events)');
      return false;
    }

    console.log('   Clicking next page button...');
    nextBtn.click();

    const start = Date.now();
    while (Date.now() - start < 10000) {
      await sleep(1500);
      const current = extractVisibleOrders();
      const newIds = current.filter((o) => !knownIds.has(o.id));
      if (newIds.length > 0) {
        console.log(`   Page loaded: ${newIds.length} new orders detected`);
        await sleep(500);
        return true;
      }
    }
    console.log('   Timeout waiting for new orders');
    return false;
  }

  // ─── PHASE 1: Collect all store order IDs ───

  async function collectAllOrders() {
    const allOrders = [];
    const allIds = new Set();

    for (let page = 1; page <= CONFIG.maxPages; page++) {
      showStatus(`Page ${page}: Scanning...`);
      await waitForSelector(
        '[data-automation-id*="view-order-details-link-"]',
        8000
      );
      await sleep(1500);

      const visible = extractVisibleOrders();
      let newCount = 0;

      visible.forEach((o) => {
        if (!allIds.has(o.id) && allOrders.length < CONFIG.maxOrders) {
          allIds.add(o.id);
          allOrders.push(o);
          newCount++;
        }
      });

      showStatus(
        `Page ${page}: +${newCount} orders (${allOrders.length} total)`
      );

      if (allOrders.length >= CONFIG.maxOrders) {
        showStatus(
          `Reached ${CONFIG.maxOrders} order limit. ${allOrders.length} orders collected.`
        );
        break;
      }

      if (page >= CONFIG.maxPages) break;

      const hasMore = await clickNextAndWait(allIds);
      if (!hasMore) {
        showStatus(
          `Last page reached (${page}). ${allOrders.length} orders total.`
        );
        break;
      }
    }
    return allOrders;
  }

  // ─── Extract order details from detail page ───

  function extractOrderDetailsFromDOM(orderId, fallbackDate, fallbackTotal) {
    const text = document.body.innerText;

    let orderDate = 'Unknown';
    const datePats = [
      /(\w+\s+\d{1,2},\s+\d{4})\s+purchase/i,
      /(?:Placed|Ordered|Delivered)\s+(?:on\s+)?(\w+\s+\d{1,2},\s+\d{4})/i,
      /(\w+\s+\d{1,2},\s+\d{4})/,
    ];
    for (const p of datePats) {
      const m = text.match(p);
      if (m) {
        orderDate = m[1] || m[0];
        break;
      }
    }
    if (orderDate === 'Unknown' && fallbackDate) orderDate = fallbackDate;

    const items = [];
    const seen = new Set();
    document.querySelectorAll('a[href*="/ip/"]').forEach((link) => {
      const name = link.textContent.trim();
      if (!name || name.length < 4 || seen.has(name)) return;
      seen.add(name);

      let container = link;
      for (let i = 0; i < 4; i++) {
        if (container.parentElement) container = container.parentElement;
      }
      const ctx = container.innerText || '';

      let quantity = 1;
      let weight = '';
      const qtyMatch = ctx.match(/(?:ShoppedQty|Qty)\s+(\d+)/);
      const wtMatch = ctx.match(/(?:ShoppedWt|Weight[- ]adjusted)\s*([\d.]+)\s*lb/);
      if (qtyMatch) {
        quantity = parseInt(qtyMatch[1]);
      } else if (wtMatch) {
        weight = wtMatch[1] + ' lb';
      }

      const priceMatches = ctx.match(/\$[\d,]+\.\d{2}/g);
      const price = priceMatches
        ? priceMatches[priceMatches.length - 1]
        : 'N/A';

      const pidMatch = link.href.match(/\/ip\/[^/]+\/(\d+)/);
      items.push({
        name,
        price,
        quantity,
        weight,
        product_id: pidMatch ? pidMatch[1] : 'Unknown',
        product_url: link.href,
      });
    });

    const getAmt = (label) => {
      const m = text.match(
        new RegExp(label + '\\s*:?\\s*(\\$[\\d,]+\\.\\d{2})', 'i')
      );
      return m ? m[1] : 'N/A';
    };

    let total = getAmt('Total');
    if (total === 'N/A' && fallbackTotal) total = fallbackTotal;

    let storeName = 'N/A',
      storeAddr = 'N/A';
    const storeMatch = text.match(
      /((?:Walmart Supercenter|Neighborhood Market)[^\n]*)/i
    );
    if (storeMatch) {
      storeName = storeMatch[1].trim();
      const after = text.substring(
        text.indexOf(storeName) + storeName.length
      );
      const addrM = after.match(/\n\s*([^\n]+)/);
      if (addrM) storeAddr = addrM[1].trim();
    }

    return {
      order_id: orderId,
      order_date: orderDate,
      order_url: window.location.href,
      items,
      totals: { subtotal: getAmt('Subtotal'), tax: getAmt('Tax'), total },
      store_location: { name: storeName, address: storeAddr },
      timestamp: new Date().toISOString(),
    };
  }

  // ─── CSV ───

  function escapeCsv(f) {
    if (!f) return '';
    const s = String(f);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? s.replace(/"/g, '""')
      : s;
  }

  function convertToCSV(orders) {
    const header =
      'Order ID,Order Date,Item Name,Quantity,Weight,Price,Product ID,Product URL,Subtotal,Tax,Total,Store Name,Store Address,Order URL,Timestamp\n';
    let rows = '';
    orders.forEach((o) => {
      if (!o) return;
      const {
        order_id,
        order_date,
        items,
        totals,
        store_location,
        order_url,
        timestamp,
      } = o;
      if (items.length === 0) {
        rows += `"\t${order_id}","${order_date}","","","","","","","${totals.subtotal}","${totals.tax}","${totals.total}","${escapeCsv(store_location.name)}","${escapeCsv(store_location.address)}","${order_url}","${timestamp}"\n`;
      } else {
        items.forEach((item, i) => {
          rows += `"\t${order_id}","${order_date}","${escapeCsv(item.name)}",${item.quantity},"${item.weight}","${item.price}","\t${item.product_id}","${item.product_url}","${i === 0 ? totals.subtotal : ''}","${i === 0 ? totals.tax : ''}","${i === 0 ? totals.total : ''}","${i === 0 ? escapeCsv(store_location.name) : ''}","${i === 0 ? escapeCsv(store_location.address) : ''}","${i === 0 ? order_url : ''}","${i === 0 ? timestamp : ''}"\n`;
        });
      }
    });
    return header + rows;
  }

  function downloadCSV(csv, filename) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ═══════════════════════════════════════════
  // MESSAGE HANDLER — triggered by popup or auto-resume
  // ═══════════════════════════════════════════

  async function startScraping(maxOrders) {
    // 0 means unlimited
    if (maxOrders) {
      CONFIG.maxOrders = maxOrders;
    } else {
      CONFIG.maxOrders = Infinity;
    }

    const currentUrl = window.location.href;
    const isOrderListPage =
      currentUrl.includes('/orders') && !currentUrl.match(/\/orders\/\d+/);

    if (!isOrderListPage) {
      showStatus('Navigate to walmart.com/orders first.');
      return;
    }

    const limitLabel = CONFIG.maxOrders === Infinity ? 'all' : `up to ${CONFIG.maxOrders}`;
    showStatus(`Walmart Order Scraper v3.2 — Collecting ${limitLabel} orders...`);
    const found = await waitForSelector(
      '[data-automation-id*="view-order-details-link-"]'
    );
    if (!found) {
      showStatus('No orders found. Are you logged in?');
      return;
    }

    const allOrders = await collectAllOrders();
    if (allOrders.length === 0) {
      showStatus('No orders found.');
      clearState();
      return;
    }

    showStatus(
      `${allOrders.length} orders found. Starting detail extraction...`
    );
    await sleep(2000);

    setState({
      phase: 'extracting_details',
      orders: allOrders,
      orderData: [],
      currentOrderIndex: 0,
    });

    window.location.href = allOrders[0].detailUrl;
  }

  async function resumeExtraction(state) {
    const currentUrl = window.location.href;
    const isDetailPage = currentUrl.match(/\/orders\/\d+/);

    if (!isDetailPage) return;

    const orders = state.orders || [];
    const orderData = state.orderData || [];
    const idx = state.currentOrderIndex || 0;
    const total = orders.length;

    if (total === 0 || !orders[idx]) {
      showStatus('No orders to extract.');
      clearState();
      return;
    }

    const order = orders[idx];
    showStatus(`[${idx + 1}/${total}] Extracting order ${order.id}...`);

    const hasProducts = await waitForSelector('a[href*="/ip/"]', 10000);
    await sleep(2000);

    let details;
    if (hasProducts) {
      details = extractOrderDetailsFromDOM(
        order.id,
        order.orderDate,
        order.orderTotal
      );
    } else {
      console.log(`   No product links found for ${order.id}`);
      details = {
        order_id: order.id,
        order_date: order.orderDate || 'Unknown',
        order_url: window.location.href,
        items: [],
        totals: {
          subtotal: 'N/A',
          tax: 'N/A',
          total: order.orderTotal || 'N/A',
        },
        store_location: { name: 'N/A', address: 'N/A' },
        timestamp: new Date().toISOString(),
      };
    }

    const updatedData = [...orderData, details];
    console.log(
      `   ${details.items.length} items, Total: ${details.totals.total}, Date: ${details.order_date}`
    );

    const nextIdx = idx + 1;
    if (nextIdx >= total) {
      const good = updatedData.filter((d) => d.items.length > 0);
      const totalItems = good.reduce((s, o) => s + o.items.length, 0);
      showStatus(
        `DONE! ${good.length}/${total} orders with items, ${totalItems} total items. Downloading...`
      );

      const csv = convertToCSV(updatedData);
      const filename = `walmart_orders_${new Date().toISOString().split('T')[0]}.csv`;
      downloadCSV(csv, filename);

      window.allOrderData = updatedData;
      console.log(
        `\nFinal: ${total} orders, ${good.length} with items, ${totalItems} items`
      );
      clearState();
      return;
    }

    setState({
      phase: 'extracting_details',
      orders: orders,
      orderData: updatedData,
      currentOrderIndex: nextIdx,
    });

    const next = orders[nextIdx];
    showStatus(
      `[${idx + 1}/${total}] Done (${details.items.length} items). Next: ${next.id}...`
    );
    await sleep(500);
    window.location.href = next.detailUrl;
  }

  // ─── Listen for start message from popup ───
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'start_scraping') {
      startScraping(msg.maxOrders || 0);
      sendResponse({ ok: true });
    }
    if (msg.type === 'stop_scraping') {
      clearState();
      showStatus('Stopped.');
      sendResponse({ ok: true });
    }
    if (msg.type === 'get_status') {
      const state = getState();
      sendResponse({
        running: !!state,
        phase: state?.phase || null,
        progress: state
          ? `${(state.currentOrderIndex || 0) + 1}/${(state.orders || []).length}`
          : null,
      });
    }
  });

  // ─── Auto-resume if in the middle of extraction ───
  const state = getState();
  if (state && state.phase === 'extracting_details') {
    resumeExtraction(state);
  }
})();
