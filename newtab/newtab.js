// New tab page script

const tabListEl = document.getElementById('tab-list');
const tabCountEl = document.getElementById('tab-count');
const viewRecencyBtn = document.getElementById('view-recency');
const viewWindowBtn = document.getElementById('view-window');

// Current view mode: 'recency' or 'window'
let currentView = 'recency';

// Time constants in milliseconds
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Drag and drop state
let draggedTab = null;
let draggedTabData = null;
let isInternalMove = false;

function getAgeInfo(timestamp) {
  if (!timestamp) {
    return { className: '', label: '' };
  }

  const now = new Date();
  const tabDate = new Date(timestamp);

  // Get start of today (midnight local time)
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Get start of tab's day (midnight local time)
  const startOfTabDay = new Date(tabDate.getFullYear(), tabDate.getMonth(), tabDate.getDate());

  // Calculate calendar days difference
  const daysDiff = Math.round((startOfToday - startOfTabDay) / DAY);

  // For tabs from today, use elapsed time for granular labels
  if (daysDiff === 0) {
    const age = now.getTime() - timestamp;
    if (age < 1 * HOUR) {
      return { className: 'age-current', label: 'Just now' };
    } else if (age < 6 * HOUR) {
      const hours = Math.floor(age / HOUR);
      return { className: 'age-current', label: `${hours} hour${hours !== 1 ? 's' : ''} ago` };
    } else {
      return { className: 'age-new', label: 'Today' };
    }
  }

  // For older tabs, use calendar days
  if (daysDiff === 1) {
    return { className: 'age-fresh', label: 'Yesterday' };
  } else if (daysDiff === 2) {
    return { className: 'age-recent', label: '2 days ago' };
  } else if (daysDiff === 3) {
    return { className: 'age-recent', label: '3 days ago' };
  } else if (daysDiff === 4) {
    return { className: 'age-moderate', label: '4 days ago' };
  } else if (daysDiff === 5) {
    return { className: 'age-moderate', label: '5 days ago' };
  } else if (daysDiff === 6) {
    return { className: 'age-old', label: '6 days ago' };
  } else if (daysDiff < 14) {
    return { className: 'age-old', label: '1 week ago' };
  } else if (daysDiff < 21) {
    return { className: 'age-very-old', label: '2 weeks ago' };
  } else if (daysDiff < 28) {
    return { className: 'age-very-old', label: '3 weeks ago' };
  } else {
    const weeks = Math.floor(daysDiff / 7);
    if (weeks < 8) {
      return { className: 'age-ancient', label: `${weeks} weeks ago` };
    } else {
      const months = Math.floor(daysDiff / 30);
      return { className: 'age-ancient', label: `${months} month${months !== 1 ? 's' : ''} ago` };
    }
  }
}

function getFaviconUrl(tab) {
  if (tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://')) {
    return tab.favIconUrl;
  }
  return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23666"><rect width="24" height="24" rx="4"/></svg>';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function createTabElement(tab, timestamp, isActive = false, draggable = false) {
  const ageInfo = getAgeInfo(timestamp);
  
  const tabEl = document.createElement('div');
  tabEl.className = `tab-item${isActive ? ' active-tab' : ''}`;
  tabEl.dataset.tabId = tab.id;
  tabEl.dataset.windowId = tab.windowId;
  tabEl.dataset.index = tab.index;
  
  if (draggable) {
    tabEl.draggable = true;
  }
  
  tabEl.innerHTML = `
    <img class="tab-favicon" src="${escapeHtml(getFaviconUrl(tab))}" alt="" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22%23666%22><rect width=%2224%22 height=%2224%22 rx=%224%22/></svg>'">
    <div class="tab-info">
      <div class="tab-title">${escapeHtml(tab.title || 'Untitled')}</div>
      <div class="tab-url">${escapeHtml(tab.url || '')}</div>
    </div>
    <span class="tab-age ${ageInfo.className}">${ageInfo.label || ''}</span>
    <button class="delete-btn" title="Close tab">✕</button>
  `;
  
  // Click on tab to switch to it
  tabEl.addEventListener('click', async (e) => {
    if (e.target.classList.contains('delete-btn')) return;
    
    try {
      await browser.tabs.update(tab.id, { active: true });
      await browser.windows.update(tab.windowId, { focused: true });
    } catch (err) {
      console.error('Failed to switch to tab:', err);
      loadTabs();
    }
  });
  
  // Delete button
  const deleteBtn = tabEl.querySelector('.delete-btn');
  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    
    tabEl.classList.add('removing');
    
    try {
      await browser.tabs.remove(tab.id);
      
      setTimeout(() => {
        tabEl.remove();
        updateTabCount();
        
        // Check if window group is now empty
        const windowGroup = document.querySelector(`.window-group[data-window-id="${tab.windowId}"]`);
        if (windowGroup) {
          const remainingTabs = windowGroup.querySelectorAll('.tab-item');
          if (remainingTabs.length === 0) {
            windowGroup.remove();
          }
        }
      }, 300);
    } catch (err) {
      console.error('Failed to close tab:', err);
      tabEl.classList.remove('removing');
      loadTabs();
    }
  });
  
  // Drag and drop handlers (only for window view)
  if (draggable) {
    tabEl.addEventListener('dragstart', (e) => {
      draggedTab = tabEl;
      draggedTabData = { tab, timestamp };
      tabEl.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    
    tabEl.addEventListener('dragend', () => {
      tabEl.classList.remove('dragging');
      draggedTab = null;
      draggedTabData = null;
      
      // Remove all drag-over indicators
      document.querySelectorAll('.drag-over-top').forEach(el => el.classList.remove('drag-over-top'));
      document.querySelectorAll('.drag-over-bottom').forEach(el => el.classList.remove('drag-over-bottom'));
    });
    
    tabEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (draggedTab === tabEl) return;
      
      const rect = tabEl.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      
      // Remove previous indicators
      document.querySelectorAll('.drag-over-top').forEach(el => el.classList.remove('drag-over-top'));
      document.querySelectorAll('.drag-over-bottom').forEach(el => el.classList.remove('drag-over-bottom'));
      
      if (e.clientY < midY) {
        tabEl.classList.add('drag-over-top');
      } else {
        tabEl.classList.add('drag-over-bottom');
      }
    });
    
    tabEl.addEventListener('dragleave', () => {
      tabEl.classList.remove('drag-over-top');
      tabEl.classList.remove('drag-over-bottom');
    });
    
    tabEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      tabEl.classList.remove('drag-over-top');
      tabEl.classList.remove('drag-over-bottom');
      
      if (!draggedTab || draggedTab === tabEl) return;
      
      const targetWindowId = parseInt(tabEl.dataset.windowId);
      const targetIndex = parseInt(tabEl.dataset.index);
      const sourceTabId = parseInt(draggedTab.dataset.tabId);
      const sourceWindowId = parseInt(draggedTab.dataset.windowId);
      
      const rect = tabEl.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const insertAfter = e.clientY >= midY;
      
      try {
        // Calculate new index
        let newIndex = insertAfter ? targetIndex + 1 : targetIndex;
        
        // Adjust if moving within same window from earlier position
        if (sourceWindowId === targetWindowId) {
          const sourceIndex = parseInt(draggedTab.dataset.index);
          if (sourceIndex < targetIndex) {
            newIndex--;
          }
        }
        
        // Move in DOM first (no refresh)
        const windowTabs = tabEl.closest('.window-tabs');
        if (insertAfter) {
          tabEl.after(draggedTab);
        } else {
          tabEl.before(draggedTab);
        }
        
        // Update data attributes for all tabs in this window
        const tabs = windowTabs.querySelectorAll('.tab-item');
        tabs.forEach((tab, idx) => {
          tab.dataset.index = idx;
        });
        
        // Move the tab in Firefox
        isInternalMove = true;
        await browser.tabs.move(sourceTabId, {
          windowId: targetWindowId,
          index: newIndex
        });
        isInternalMove = false;
        
      } catch (err) {
        console.error('Failed to move tab:', err);
        isInternalMove = false;
        loadTabs();
      }
    });
  }
  
  return tabEl;
}

function updateTabCount() {
  const count = tabListEl.querySelectorAll('.tab-item').length;
  
  if (currentView === 'window') {
    const windowCount = tabListEl.querySelectorAll('.window-group').length;
    tabCountEl.textContent = `${count} tab${count !== 1 ? 's' : ''} across ${windowCount} window${windowCount !== 1 ? 's' : ''}`;
  } else {
    tabCountEl.textContent = `${count} tab${count !== 1 ? 's' : ''}`;
  }
}

async function loadTabs() {
  tabListEl.innerHTML = '<div class="loading">Loading tabs...</div>';
  
  try {
    const [tabs, storageData] = await Promise.all([
      browser.tabs.query({}),
      browser.storage.local.get(['tabTimestamps', 'viewPreference'])
    ]);
    
    const timestamps = storageData.tabTimestamps || {};
    
    // Restore view preference
    if (storageData.viewPreference && storageData.viewPreference !== currentView) {
      currentView = storageData.viewPreference;
      updateToggleButtons();
    }
    
    // Filter out pinned tabs and current new tab page
    const currentTab = await browser.tabs.getCurrent();
    const filteredTabs = tabs.filter(tab => tab.id !== currentTab?.id && !tab.pinned);
    
    if (filteredTabs.length === 0) {
      tabListEl.innerHTML = `
        <div class="empty-state">
          <h2>No other tabs open</h2>
          <p>Open some tabs and come back here to organize them!</p>
        </div>
      `;
      tabCountEl.textContent = '0 tabs';
      return;
    }
    
    // Add timestamps to tabs
    const tabsWithTimestamps = filteredTabs.map(tab => ({
      tab,
      timestamp: timestamps[tab.id] ?? 0
    }));
    
    tabListEl.innerHTML = '';
    
    if (currentView === 'recency') {
      renderRecencyView(tabsWithTimestamps);
    } else {
      await renderWindowView(tabsWithTimestamps);
    }
    
    updateTabCount();
    
  } catch (err) {
    console.error('Failed to load tabs:', err);
    tabListEl.innerHTML = `
      <div class="empty-state">
        <h2>Error loading tabs</h2>
        <p>${escapeHtml(err.message)}</p>
      </div>
    `;
  }
}

function renderRecencyView(tabsWithTimestamps) {
  // Sort by timestamp descending (most recent first)
  tabsWithTimestamps.sort((a, b) => b.timestamp - a.timestamp);
  
  for (const { tab, timestamp } of tabsWithTimestamps) {
    const tabEl = createTabElement(tab, timestamp, false, false);
    tabListEl.appendChild(tabEl);
  }
}

async function renderWindowView(tabsWithTimestamps) {
  // Group tabs by window
  const windowGroups = new Map();
  
  for (const { tab, timestamp } of tabsWithTimestamps) {
    if (!windowGroups.has(tab.windowId)) {
      windowGroups.set(tab.windowId, []);
    }
    windowGroups.get(tab.windowId).push({ tab, timestamp });
  }
  
  // Sort tabs within each window by index
  for (const tabs of windowGroups.values()) {
    tabs.sort((a, b) => a.tab.index - b.tab.index);
  }
  
  // Get current window to show first
  let currentWindowId;
  try {
    const currentWindow = await browser.windows.getCurrent();
    currentWindowId = currentWindow.id;
  } catch (e) {
    currentWindowId = null;
  }
  
  // Sort window IDs so current window is first
  const sortedWindowIds = Array.from(windowGroups.keys()).sort((a, b) => {
    if (a === currentWindowId) return -1;
    if (b === currentWindowId) return 1;
    return a - b;
  });
  
  let windowNumber = 1;
  for (const windowId of sortedWindowIds) {
    const tabs = windowGroups.get(windowId);
    
    const groupEl = document.createElement('div');
    groupEl.className = 'window-group';
    groupEl.dataset.windowId = windowId;
    
    const isCurrentWindow = windowId === currentWindowId;
    const headerLabel = isCurrentWindow ? `Window ${windowNumber} (Current)` : `Window ${windowNumber}`;
    
    groupEl.innerHTML = `
      <div class="window-header">
        <span class="window-header-icon">🪟</span>
        <span>${headerLabel}</span>
        <span style="color: #666; margin-left: auto;">${tabs.length} tab${tabs.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="window-tabs"></div>
    `;
    
    const windowTabsEl = groupEl.querySelector('.window-tabs');
    
    // Enable drop on the window tabs container for dropping at the end
    windowTabsEl.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    
    windowTabsEl.addEventListener('drop', async (e) => {
      // Only handle drops directly on the container, not bubbled from tab items
      if (e.target !== windowTabsEl) return;
      
      e.preventDefault();
      
      if (!draggedTab) return;
      
      const sourceTabId = parseInt(draggedTab.dataset.tabId);
      
      try {
        // Move to end of this window
        await browser.tabs.move(sourceTabId, {
          windowId: windowId,
          index: -1
        });
        loadTabs();
      } catch (err) {
        console.error('Failed to move tab:', err);
        loadTabs();
      }
    });
    
    for (const { tab, timestamp } of tabs) {
      const isActive = tab.active;
      const tabEl = createTabElement(tab, timestamp, isActive, true);
      windowTabsEl.appendChild(tabEl);
    }
    
    tabListEl.appendChild(groupEl);
    windowNumber++;
  }
}

function updateToggleButtons() {
  if (currentView === 'recency') {
    viewRecencyBtn.classList.add('active');
    viewWindowBtn.classList.remove('active');
  } else {
    viewRecencyBtn.classList.remove('active');
    viewWindowBtn.classList.add('active');
  }
}

async function setView(view) {
  currentView = view;
  updateToggleButtons();
  
  // Save preference
  await browser.storage.local.set({ viewPreference: view });
  
  loadTabs();
}

// View toggle event listeners
viewRecencyBtn.addEventListener('click', () => setView('recency'));
viewWindowBtn.addEventListener('click', () => setView('window'));

// Initial load
loadTabs();

// Listen for tab changes to refresh the list
browser.tabs.onRemoved.addListener((removedTabId) => {
  const existingEl = tabListEl.querySelector(`[data-tab-id="${removedTabId}"]`);
  if (existingEl && !existingEl.classList.contains('removing')) {
    setTimeout(loadTabs, 100);
  }
});

browser.tabs.onCreated.addListener(() => {
  setTimeout(loadTabs, 100);
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // Only reload if a tab's URL changes (navigation), not title/favicon
  if (changeInfo.url) {
    setTimeout(loadTabs, 100);
  }
});

browser.tabs.onMoved.addListener(() => {
  if (currentView === 'window' && !isInternalMove) {
    setTimeout(loadTabs, 100);
  }
});

browser.tabs.onAttached.addListener(() => {
  setTimeout(loadTabs, 100);
});

browser.tabs.onDetached.addListener(() => {
  setTimeout(loadTabs, 100);
});
