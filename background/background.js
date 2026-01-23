// Background script to track tab activity timestamps

// Initialize timestamp for a tab if it doesn't exist
async function ensureTabTimestamp(tabId) {
  const data = await browser.storage.local.get('tabTimestamps');
  const timestamps = data.tabTimestamps || {};
  
  if (!timestamps[tabId]) {
    timestamps[tabId] = Date.now();
    await browser.storage.local.set({ tabTimestamps: timestamps });
  }
}

// Update timestamp when a tab is activated
browser.tabs.onActivated.addListener(async (activeInfo) => {
  const data = await browser.storage.local.get('tabTimestamps');
  const timestamps = data.tabTimestamps || {};
  
  timestamps[activeInfo.tabId] = Date.now();
  await browser.storage.local.set({ tabTimestamps: timestamps });
});

// Initialize timestamps for new tabs
browser.tabs.onCreated.addListener(async (tab) => {
  const data = await browser.storage.local.get('tabTimestamps');
  const timestamps = data.tabTimestamps || {};
  
  timestamps[tab.id] = Date.now();
  await browser.storage.local.set({ tabTimestamps: timestamps });
});

// Clean up storage when tabs are closed to prevent memory bloat
browser.tabs.onRemoved.addListener(async (tabId) => {
  const data = await browser.storage.local.get('tabTimestamps');
  const timestamps = data.tabTimestamps || {};
  
  if (timestamps[tabId]) {
    delete timestamps[tabId];
    await browser.storage.local.set({ tabTimestamps: timestamps });
  }
});

// On startup, initialize timestamps for any existing tabs that don't have them
// This handles tabs that existed before the extension was installed
browser.runtime.onStartup.addListener(initializeExistingTabs);
browser.runtime.onInstalled.addListener(initializeExistingTabs);

async function initializeExistingTabs() {
  const tabs = await browser.tabs.query({});
  const data = await browser.storage.local.get('tabTimestamps');
  const timestamps = data.tabTimestamps || {};
  
  // Also clean up any stale entries for tabs that no longer exist
  const currentTabIds = new Set(tabs.map(t => t.id));
  const cleanedTimestamps = {};
  
  for (const tab of tabs) {
    if (timestamps[tab.id]) {
      // Keep existing timestamp
      cleanedTimestamps[tab.id] = timestamps[tab.id];
    } else {
      // New tab without timestamp - mark as "old" so it surfaces at top
      // No timestamp for pre-existing tabs
      cleanedTimestamps[tab.id] = 0;
    }
  }
  
  await browser.storage.local.set({ tabTimestamps: cleanedTimestamps });
}
