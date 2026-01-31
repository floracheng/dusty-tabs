// New tab page script

const tabListEl = document.getElementById('tab-list');
const tabCountEl = document.getElementById('tab-count');
const viewRecencyBtn = document.getElementById('view-recency');
const viewWindowBtn = document.getElementById('view-window');
const searchInput = document.getElementById('search-input');

// Current view mode: 'recency' or 'window'
let currentView = 'recency';

// Search state
let searchQuery = '';
let totalTabCount = 0;
let cachedTabsWithTimestamps = null;
let searchRenderTimer = null;

// Time constants in milliseconds
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Drag and drop state
let draggedTab = null;
let draggedTabData = null;
let draggedGroup = null;
let isInternalMove = false;

// Loading state to prevent concurrent loadTabs calls
let isLoading = false;
let pendingLoad = false;

// Drag-hold state for creating groups
let dragHoldTimer = null;
let dragHoldTarget = null;
const DRAG_HOLD_DELAY = 1000; // 1 second

// Window number mapping (windowId -> "Window 1", "Window 2", etc.)
let windowNumberMap = new Map();

// Tab Groups API availability
const tabGroupsSupported = typeof browser.tabGroups !== 'undefined';

// Firefox tab group colors
const TAB_GROUP_COLORS = ['blue', 'cyan', 'green', 'grey', 'orange', 'pink', 'purple', 'red', 'yellow'];

// Color hex values for display
const TAB_GROUP_COLOR_VALUES = {
  blue: '#4285f4',
  cyan: '#00bcd4',
  green: '#4caf50',
  grey: '#9e9e9e',
  orange: '#ff9800',
  pink: '#e91e63',
  purple: '#9c27b0',
  red: '#f44336',
  yellow: '#ffeb3b'
};

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

// Tab Group helper functions
async function createTabGroup(tabIds, title, windowId) {
  if (!tabGroupsSupported) return null;
  try {
    const options = { tabIds };
    if (windowId !== undefined) {
      options.createProperties = { windowId };
    }
    const groupId = await browser.tabs.group(options);
    if (title) {
      await browser.tabGroups.update(groupId, { title });
    }
    return groupId;
  } catch (err) {
    console.error('Failed to create tab group:', err);
    return null;
  }
}

async function addTabToGroup(tabId, groupId) {
  if (!tabGroupsSupported) return;
  try {
    await browser.tabs.group({ tabIds: [tabId], groupId });
  } catch (err) {
    console.error('Failed to add tab to group:', err);
  }
}

async function removeTabFromGroup(tabId) {
  if (!tabGroupsSupported) return;
  try {
    await browser.tabs.ungroup([tabId]);
  } catch (err) {
    console.error('Failed to ungroup tab:', err);
  }
}

async function renameTabGroup(groupId, title) {
  if (!tabGroupsSupported) return;
  try {
    await browser.tabGroups.update(groupId, { title });
  } catch (err) {
    console.error('Failed to rename tab group:', err);
  }
}

async function changeTabGroupColor(groupId, color) {
  if (!tabGroupsSupported) return;
  try {
    await browser.tabGroups.update(groupId, { color });
  } catch (err) {
    console.error('Failed to change tab group color:', err);
  }
}

async function moveTabGroup(groupId, windowId, index) {
  if (!tabGroupsSupported) return;
  try {
    await browser.tabGroups.move(groupId, { windowId, index });
  } catch (err) {
    console.error('Failed to move tab group:', err);
  }
}

function getGroupColorValue(color) {
  return TAB_GROUP_COLOR_VALUES[color] || TAB_GROUP_COLOR_VALUES.grey;
}

// Search helper functions
function tabMatchesSearch(tab, query) {
  if (!query) return true;
  const lowerQuery = query.toLowerCase();
  const title = (tab.title || '').toLowerCase();
  const url = (tab.url || '').toLowerCase();
  return title.includes(lowerQuery) || url.includes(lowerQuery);
}

function highlightText(text, query) {
  if (!query) return document.createTextNode(text);

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);

  if (index === -1) return document.createTextNode(text);

  const fragment = document.createDocumentFragment();

  if (index > 0) {
    fragment.appendChild(document.createTextNode(text.substring(0, index)));
  }

  const highlight = document.createElement('span');
  highlight.className = 'search-highlight';
  highlight.textContent = text.substring(index, index + query.length);
  fragment.appendChild(highlight);

  if (index + query.length < text.length) {
    const rest = highlightText(text.substring(index + query.length), query);
    fragment.appendChild(rest);
  }

  return fragment;
}

function showColorPicker(groupId, currentColor, anchorEl) {
  // Remove any existing color picker
  const existing = document.querySelector('.color-picker-popup');
  if (existing) existing.remove();

  const picker = document.createElement('div');
  picker.className = 'color-picker-popup';

  // injected variables are all known hardcoded strings, safe to use
  picker.append(...TAB_GROUP_COLORS.map(color => {
    const colorBtn = document.createElement("button")
    colorBtn.className = `color-option ${color === currentColor ? 'selected' : ''}`;
    colorBtn.dataset.color = color;
    colorBtn.style.background = TAB_GROUP_COLOR_VALUES[color];
    colorBtn.title = color;
    return colorBtn;
  }));

  // Position near the anchor element
  const rect = anchorEl.getBoundingClientRect();
  picker.style.position = 'absolute';
  picker.style.top = `${rect.bottom + window.scrollY + 4}px`;
  picker.style.left = `${rect.left + window.scrollX}px`;

  picker.addEventListener('click', async (e) => {
    const colorBtn = e.target.closest('.color-option');
    if (colorBtn) {
      const newColor = colorBtn.dataset.color;
      const newColorValue = getGroupColorValue(newColor);

      // Update Firefox
      await changeTabGroupColor(groupId, newColor);

      // Update UI in-place
      const groupContainer = document.querySelector(`.tab-group-container[data-group-id="${groupId}"]`);
      if (groupContainer) {
        const header = groupContainer.querySelector('.tab-group-header');
        const colorButton = groupContainer.querySelector('.tab-group-color');
        const tabsContainer = groupContainer.querySelector('.tab-group-tabs');

        if (header) header.style.borderLeftColor = newColorValue;
        if (colorButton) {
          colorButton.style.background = newColorValue;
          colorButton.dataset.color = newColor;
        }
        if (tabsContainer) tabsContainer.style.borderLeftColor = newColorValue;
      }

      picker.remove();
    }
  });

  // Close on click outside
  setTimeout(() => {
    document.addEventListener('click', function closeHandler(e) {
      if (!picker.contains(e.target)) {
        picker.remove();
        document.removeEventListener('click', closeHandler);
      }
    });
  }, 0);

  document.body.appendChild(picker);
}

async function promptForGroupName(defaultName = '') {
  const name = prompt('Enter group name:', defaultName);
  return name;
}

function createTabElement(tab, timestamp, isActive = false, draggable = false, windowLabel = null) {
  const ageInfo = getAgeInfo(timestamp);

  const tabEl = document.createElement('div');
  tabEl.className = `tab-item${isActive ? ' active-tab' : ''}`;
  tabEl.dataset.tabId = tab.id;
  tabEl.dataset.windowId = tab.windowId;
  tabEl.dataset.index = tab.index;
  if (tab.groupId && tab.groupId !== -1) {
    tabEl.dataset.groupId = tab.groupId;
  }

  if (draggable) {
    tabEl.draggable = true;
  }
  

  // untrusted input is sanitized in various places, age stuff is internal and safe
  const favIcon = document.createElement("img");
  favIcon.className = "tab-favicon";
  favIcon.src = getFaviconUrl(tab);
  favIcon.alt = "";
  favIcon.onerror = function() {
    this.src = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22%23666%22><rect width=%2224%22 height=%2224%22 rx=%224%22/></svg>';
  };
  tabEl.appendChild(favIcon);
  const tabInfo = document.createElement("div");
  tabInfo.className = "tab-info";
  const title = document.createElement("div");
  title.className = "tab-title";
  title.appendChild(highlightText(tab.title || "Untitled", searchQuery));
  const url = document.createElement("div");
  url.className = "tab-url";
  url.appendChild(highlightText(tab.url || "", searchQuery));
  tabInfo.append(title, url);

  tabEl.appendChild(tabInfo);
  if (windowLabel) {
    // recency view
    const windowLabelHtml = document.createElement("span");
    windowLabelHtml.className = "tab-window-label";
    windowLabelHtml.textContent = windowLabel;
    tabEl.appendChild(windowLabelHtml);
  }
  if (ageInfo.label) {
    const ageLabelHtml = document.createElement("span");
    ageLabelHtml.className = `tab-age ${ageInfo.className}`;
    ageLabelHtml.textContent = ageInfo.label;
    tabEl.appendChild(ageLabelHtml);
  }
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "delete-btn";
  deleteBtn.title = "Close tab";
  deleteBtn.textContent = "✕";
  tabEl.appendChild(deleteBtn);
  
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

      // Clear drag-hold state
      if (dragHoldTimer) {
        clearTimeout(dragHoldTimer);
        dragHoldTimer = null;
      }
      if (dragHoldTarget) {
        dragHoldTarget.classList.remove('drag-hold-active');
        dragHoldTarget = null;
      }

      // Remove all drag-over indicators
      document.querySelectorAll('.drag-over-top').forEach(el => el.classList.remove('drag-over-top'));
      document.querySelectorAll('.drag-over-bottom').forEach(el => el.classList.remove('drag-over-bottom'));
      document.querySelectorAll('.drag-hold-active').forEach(el => el.classList.remove('drag-hold-active'));

      // Remove any tooltips
      document.querySelectorAll('.drag-hold-tooltip').forEach(el => el.remove());
    });

    tabEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (draggedTab === tabEl) return;

      const rect = tabEl.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;

      // Remove previous indicators from other elements
      document.querySelectorAll('.drag-over-top').forEach(el => {
        if (el !== tabEl) el.classList.remove('drag-over-top');
      });
      document.querySelectorAll('.drag-over-bottom').forEach(el => {
        if (el !== tabEl) el.classList.remove('drag-over-bottom');
      });

      if (e.clientY < midY) {
        tabEl.classList.add('drag-over-top');
        tabEl.classList.remove('drag-over-bottom');
      } else {
        tabEl.classList.add('drag-over-bottom');
        tabEl.classList.remove('drag-over-top');
      }

      // Drag-hold detection for creating groups (only for ungrouped tabs)
      if (tabGroupsSupported && !tabEl.dataset.groupId && !draggedTab?.dataset.groupId) {
        if (dragHoldTarget !== tabEl) {
          // Clear previous timer
          if (dragHoldTimer) {
            clearTimeout(dragHoldTimer);
            if (dragHoldTarget) {
              dragHoldTarget.classList.remove('drag-hold-active');
              const oldTooltip = document.querySelector('.drag-hold-tooltip');
              if (oldTooltip) oldTooltip.remove();
            }
          }

          dragHoldTarget = tabEl;

          // Start new timer
          dragHoldTimer = setTimeout(() => {
            tabEl.classList.add('drag-hold-active');

            // Show tooltip
            const tooltip = document.createElement('div');
            tooltip.className = 'drag-hold-tooltip';
            tooltip.textContent = 'Release to create group';
            tooltip.style.position = 'absolute';
            tooltip.style.top = `${rect.top + window.scrollY - 30}px`;
            tooltip.style.left = `${rect.left + window.scrollX + rect.width / 2}px`;
            document.body.appendChild(tooltip);
          }, DRAG_HOLD_DELAY);
        }
      }
    });

    tabEl.addEventListener('dragleave', (e) => {
      // Only handle if actually leaving the element (not just moving to a child)
      if (tabEl.contains(e.relatedTarget)) {
        return;
      }

      tabEl.classList.remove('drag-over-top');
      tabEl.classList.remove('drag-over-bottom');

      // Clear drag-hold if leaving this element
      if (dragHoldTarget === tabEl) {
        if (dragHoldTimer) {
          clearTimeout(dragHoldTimer);
          dragHoldTimer = null;
        }
        tabEl.classList.remove('drag-hold-active');
        dragHoldTarget = null;
        const tooltip = document.querySelector('.drag-hold-tooltip');
        if (tooltip) tooltip.remove();
      }
    });
    
    tabEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Check if drag-hold was active BEFORE removing classes
      const wasHoldActive = dragHoldTarget === tabEl && tabEl.classList.contains('drag-hold-active');

      tabEl.classList.remove('drag-over-top');
      tabEl.classList.remove('drag-over-bottom');
      tabEl.classList.remove('drag-hold-active');

      // Remove tooltip
      const tooltip = document.querySelector('.drag-hold-tooltip');
      if (tooltip) tooltip.remove();

      // Handle group drop on tab
      if (draggedGroup) {
        const groupId = parseInt(draggedGroup.dataset.groupId);
        const targetWindowId = parseInt(tabEl.dataset.windowId);
        const targetIndex = parseInt(tabEl.dataset.index);
        const rect = tabEl.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const insertAfter = e.clientY >= midY;
        const adjustedIndex = insertAfter ? targetIndex + 1 : targetIndex;
        try {
          await moveTabGroup(groupId, targetWindowId, adjustedIndex);
          loadTabs();
        } catch (err) {
          console.error('Failed to move group:', err);
          loadTabs();
        }
        return;
      }

      if (!draggedTab || draggedTab === tabEl) return;

      const targetTabId = parseInt(tabEl.dataset.tabId);
      const targetWindowId = parseInt(tabEl.dataset.windowId);
      const targetIndex = parseInt(tabEl.dataset.index);
      const sourceTabId = parseInt(draggedTab.dataset.tabId);
      const sourceWindowId = parseInt(draggedTab.dataset.windowId);
      const targetGroupId = tabEl.dataset.groupId ? parseInt(tabEl.dataset.groupId) : null;
      const sourceGroupId = draggedTab.dataset.groupId ? parseInt(draggedTab.dataset.groupId) : null;

      const rect = tabEl.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const insertAfter = e.clientY >= midY;

      // Clear drag-hold state
      if (dragHoldTimer) {
        clearTimeout(dragHoldTimer);
        dragHoldTimer = null;
      }
      dragHoldTarget = null;

      try {
        // Handle group creation via drag-hold
        if (tabGroupsSupported && wasHoldActive && !targetGroupId && !sourceGroupId) {
          const groupName = await promptForGroupName('New Group');
          if (groupName !== null) {
            // Create group with both tabs
            await createTabGroup([targetTabId, sourceTabId], groupName, targetWindowId);
            loadTabs();
            return;
          }
        }

        // Handle dropping into an existing group
        if (tabGroupsSupported && targetGroupId && sourceGroupId !== targetGroupId) {
          await addTabToGroup(sourceTabId, targetGroupId);
        }

        // Handle dropping outside of a group (ungroup)
        if (tabGroupsSupported && sourceGroupId && !targetGroupId) {
          await removeTabFromGroup(sourceTabId);
        }

        // Calculate new index
        let newIndex = insertAfter ? targetIndex + 1 : targetIndex;

        // Adjust if moving within same window from earlier position
        if (sourceWindowId === targetWindowId) {
          const sourceIndex = parseInt(draggedTab.dataset.index);
          if (sourceIndex < targetIndex) {
            newIndex--;
          }
        }

        // Move the tab in Firefox
        isInternalMove = true;
        await browser.tabs.move(sourceTabId, {
          windowId: targetWindowId,
          index: newIndex
        });
        isInternalMove = false;

        // Reload to reflect group changes
        if (tabGroupsSupported && (targetGroupId || sourceGroupId || wasHoldActive)) {
          loadTabs();
        } else {
          // Move in DOM (no refresh needed)
          const targetWindowTabs = tabEl.closest('.window-tabs');
          const sourceWindowTabs = draggedTab.closest('.window-tabs');

          if (insertAfter) {
            tabEl.after(draggedTab);
          } else {
            tabEl.before(draggedTab);
          }

          // Update data attributes for target window
          const targetTabs = targetWindowTabs.querySelectorAll('.tab-item');
          targetTabs.forEach((t, idx) => {
            t.dataset.index = idx;
          });

          // If cross-window move, update source window too and handle empty window
          if (sourceWindowId !== targetWindowId && sourceWindowTabs) {
            const sourceTabs = sourceWindowTabs.querySelectorAll('.tab-item');
            if (sourceTabs.length === 0) {
              // Remove empty window group
              sourceWindowTabs.closest('.window-group').remove();
            } else {
              sourceTabs.forEach((t, idx) => {
                t.dataset.index = idx;
              });
            }
            // Update dragged tab's window ID
            draggedTab.dataset.windowId = targetWindowId;
          }
        }

      } catch (err) {
        console.error('Failed to move tab:', err);
        isInternalMove = false;
        loadTabs();
      }
    });
  }

  return tabEl;
}

async function renderFilteredTabs() {
  if (!cachedTabsWithTimestamps) return;

  let tabsWithTimestamps = cachedTabsWithTimestamps;

  // Apply search filter
  if (searchQuery) {
    tabsWithTimestamps = tabsWithTimestamps.filter(({ tab }) => tabMatchesSearch(tab, searchQuery));

    if (tabsWithTimestamps.length === 0) {
      const emptyStateDiv = document.createElement("div");
      emptyStateDiv.className = "empty-state";

      const h2 = document.createElement("h2");
      h2.textContent = "No dust here - try another search";

      emptyStateDiv.appendChild(h2);

      tabListEl.replaceChildren(emptyStateDiv);
      updateTabCount();
      return;
    }
  }

  // Build content in a temp container first, then swap in
  const tempContainer = document.createElement('div');

  if (currentView === 'recency') {
    await renderRecencyView(tabsWithTimestamps, tempContainer);
  } else {
    await renderWindowView(tabsWithTimestamps, tempContainer);
  }

  // Swap content in one operation
  tabListEl.replaceChildren(...tempContainer.childNodes);

  updateTabCount();
}

function updateTabCount() {
  const count = tabListEl.querySelectorAll('.tab-item').length;

  if (searchQuery) {
    tabCountEl.textContent = `${count} of ${totalTabCount} tab${totalTabCount !== 1 ? 's' : ''}`;
  } else if (currentView === 'window') {
    const windowCount = tabListEl.querySelectorAll('.window-group').length;
    tabCountEl.textContent = `${count} tab${count !== 1 ? 's' : ''} across ${windowCount} window${windowCount !== 1 ? 's' : ''}`;
  } else {
    tabCountEl.textContent = `${count} tab${count !== 1 ? 's' : ''}`;
  }
}

async function loadTabs(preserveScroll = true, showLoading = true) {
  // Prevent concurrent loads - queue a reload if already loading
  if (isLoading) {
    pendingLoad = true;
    return;
  }

  isLoading = true;
  pendingLoad = false;

  // Save scroll position before reload
  const scrollY = preserveScroll ? window.scrollY : 0;

  if (showLoading) {
    const loading = document.createElement("div");
    loading.className = "loading";
    loading.textContent = "Loading tabs...";
    tabListEl.appendChild(loading);
  }

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

    // Store total count for search display
    totalTabCount = filteredTabs.length;

    if (filteredTabs.length === 0) {
      tabListEl.textContent = "";

      const emptyStateDiv = document.createElement("div");
      emptyStateDiv.className = "empty-state";

      const h2 = document.createElement("h2");
      h2.textContent = "No other tabs open";

      const p = document.createElement("p");
      p.textContent = "Open some tabs and come back here to organize them!";

      emptyStateDiv.append(h2, p);

      tabListEl.appendChild(emptyStateDiv);
      tabCountEl.textContent = '0 tabs';
      return;
    }

    // Add timestamps to tabs and cache
    cachedTabsWithTimestamps = filteredTabs.map(tab => ({
      tab,
      timestamp: timestamps[tab.id] ?? 0
    }));

    await renderFilteredTabs();

    // Restore scroll position after DOM is fully rendered
    if (preserveScroll && scrollY > 0) {
      requestAnimationFrame(() => {
        window.scrollTo(0, scrollY);
      });
    }

  } catch (err) {
    console.error('Failed to load tabs:', err);
    const emptyStateDiv = document.createElement("div");
    emptyStateDiv.className = "empty-state";

    const h2 = document.createElement("h2");
    h2.textContent = "Error loading tabs";

    const p = document.createElement("p");
    p.textContent = err.message;

    emptyStateDiv.append(h2, p);

    tabListEl.appendChild(emptyStateDiv);
  } finally {
    isLoading = false;

    // If a load was requested while we were loading, do it now
    if (pendingLoad) {
      loadTabs(preserveScroll);
    }
  }
}

async function renderRecencyView(tabsWithTimestamps, container = tabListEl) {
  // Build window number map first
  windowNumberMap.clear();
  const windowIds = [...new Set(tabsWithTimestamps.map(t => t.tab.windowId))];

  // Get current window to show first
  let currentWindowId;
  try {
    const currentWindow = await browser.windows.getCurrent();
    currentWindowId = currentWindow.id;
  } catch (e) {
    currentWindowId = null;
  }

  // Sort window IDs so current window is first
  windowIds.sort((a, b) => {
    if (a === currentWindowId) return -1;
    if (b === currentWindowId) return 1;
    return a - b;
  });

  windowIds.forEach((id, idx) => {
    windowNumberMap.set(id, `Window ${idx + 1}`);
  });

  // Sort by timestamp descending (most recent first)
  tabsWithTimestamps.sort((a, b) => b.timestamp - a.timestamp);

  for (const { tab, timestamp } of tabsWithTimestamps) {
    const windowLabel = windowNumberMap.get(tab.windowId);
    const tabEl = createTabElement(tab, timestamp, false, false, windowLabel);
    container.appendChild(tabEl);
  }
}

async function renderWindowView(tabsWithTimestamps, container = tabListEl) {
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

  // Get tab group info if supported
  let tabGroupsInfo = new Map();
  if (tabGroupsSupported) {
    try {
      const groups = await browser.tabGroups.query({});
      for (const group of groups) {
        tabGroupsInfo.set(group.id, group);
      }
    } catch (err) {
      console.error('Failed to query tab groups:', err);
    }
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

    const windowEl = document.createElement('div');
    windowEl.className = 'window-group';
    windowEl.dataset.windowId = windowId;

    const isCurrentWindow = windowId === currentWindowId;
    const headerLabel = isCurrentWindow ? `Window ${windowNumber} (Current)` : `Window ${windowNumber}`;
    windowEl.textContent = ""; // Clear existing content

    const windowHeader = document.createElement("div");
    windowHeader.className = "window-header";

    const iconSpan = document.createElement("span");
    iconSpan.className = "window-header-icon";
    iconSpan.textContent = "🪟";

    const labelSpan = document.createElement("span");
    labelSpan.textContent = headerLabel;

    const countSpan = document.createElement("span");
    countSpan.style.color = "#666";
    countSpan.style.marginLeft = "auto";
    countSpan.textContent = `${tabs.length} tab${tabs.length !== 1 ? 's' : ''}`;

    windowHeader.append(iconSpan, labelSpan, countSpan);

    const windowTabs = document.createElement("div");
    windowTabs.className = "window-tabs";

    windowEl.append(windowHeader, windowTabs);

    const windowTabsEl = windowEl.querySelector('.window-tabs');

    // Enable drop on the window tabs container for dropping at the end (ungroups tab)
    windowTabsEl.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    windowTabsEl.addEventListener('drop', async (e) => {
      // Handle drops on the container or on group containers (but not on tabs or group-tabs)
      const isOnWindowTabs = e.target === windowTabsEl;
      const isOnGroupContainer = e.target.classList.contains('tab-group-container');
      const isOnGroupHeader = e.target.closest('.tab-group-header') && !e.target.closest('.tab-group-tabs');

      // Skip if drop is on a tab item or inside group tabs (those have their own handlers)
      if (!isOnWindowTabs && !isOnGroupContainer && !isOnGroupHeader) return;

      e.preventDefault();
      e.stopPropagation();

      if (!draggedTab && !draggedGroup) return;

      // Handle group drop
      if (draggedGroup) {
        const groupId = parseInt(draggedGroup.dataset.groupId);
        try {
          await moveTabGroup(groupId, windowId, -1);
          loadTabs();
        } catch (err) {
          console.error('Failed to move group:', err);
          loadTabs();
        }
        return;
      }

      const sourceTabId = parseInt(draggedTab.dataset.tabId);
      const sourceGroupId = draggedTab.dataset.groupId ? parseInt(draggedTab.dataset.groupId) : null;

      try {
        // Ungroup if was in a group
        if (tabGroupsSupported && sourceGroupId) {
          await removeTabFromGroup(sourceTabId);
        }

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

    // Render tabs, grouping consecutive tabs with same groupId
    let currentGroupId = null;
    let currentGroupEl = null;

    for (const { tab, timestamp } of tabs) {
      const tabGroupId = (tab.groupId && tab.groupId !== -1) ? tab.groupId : null;

      // Check if we need to close the current group
      if (currentGroupId !== null && tabGroupId !== currentGroupId) {
        currentGroupEl = null;
        currentGroupId = null;
      }

      // Check if we need to start a new group
      if (tabGroupsSupported && tabGroupId !== null && tabGroupId !== currentGroupId) {
        const groupInfo = tabGroupsInfo.get(tabGroupId);
        currentGroupEl = createTabGroupElement(groupInfo, windowId);
        windowTabsEl.appendChild(currentGroupEl);
        currentGroupId = tabGroupId;
      }

      // Create and append the tab element
      const isActive = tab.active;
      const tabEl = createTabElement(tab, timestamp, isActive, true);

      if (currentGroupEl) {
        currentGroupEl.querySelector('.tab-group-tabs').appendChild(tabEl);
      } else {
        windowTabsEl.appendChild(tabEl);
      }
    }

    container.appendChild(windowEl);
    windowNumber++;
  }
}

function createTabGroupElement(groupInfo, windowId) {
  const groupEl = document.createElement('div');
  groupEl.className = 'tab-group-container';
  groupEl.dataset.groupId = groupInfo.id;
  groupEl.dataset.windowId = windowId;

  const color = groupInfo.color || 'grey';
  const colorValue = getGroupColorValue(color);
  const title = groupInfo.title || 'Unnamed Group';

  // dynamic values are escaped or internally created and secure
  groupEl.textContent = ""; // Clear existing content

  const groupHeader = document.createElement("div");
  groupHeader.className = "tab-group-header";
  groupHeader.style.borderLeftColor = colorValue;

  const colorButton = document.createElement("button");
  colorButton.className = "tab-group-color";
  colorButton.style.background = colorValue;
  colorButton.title = "Change color";
  colorButton.dataset.color = color;

  const nameSpan = document.createElement("span");
  nameSpan.className = "tab-group-name";
  nameSpan.title = "Click to rename";
  nameSpan.textContent = title;

  const countSpan = document.createElement("span");
  countSpan.className = "tab-group-count";

  groupHeader.append(colorButton, nameSpan, countSpan);

  const groupTabs = document.createElement("div");
  groupTabs.className = "tab-group-tabs";
  groupTabs.style.borderLeftColor = colorValue;

  groupEl.append(groupHeader, groupTabs);

  // Make group header draggable
  const headerEl = groupEl.querySelector('.tab-group-header');
  headerEl.draggable = true;

  headerEl.addEventListener('dragstart', (e) => {
    draggedGroup = groupEl;
    groupEl.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  headerEl.addEventListener('dragend', () => {
    groupEl.classList.remove('dragging');
    draggedGroup = null;

    // Clear any stale drag-hold state
    if (dragHoldTimer) {
      clearTimeout(dragHoldTimer);
      dragHoldTimer = null;
    }
    if (dragHoldTarget) {
      dragHoldTarget.classList.remove('drag-hold-active');
      dragHoldTarget = null;
    }
    document.querySelectorAll('.drag-hold-tooltip').forEach(el => el.remove());
    document.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
      el.classList.remove('drag-over-top', 'drag-over-bottom');
    });
  });

  // Click on color to change
  const colorBtn = groupEl.querySelector('.tab-group-color');
  colorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showColorPicker(groupInfo.id, color, colorBtn);
  });

  // Click on name to rename
  const nameEl = groupEl.querySelector('.tab-group-name');
  nameEl.addEventListener('click', async (e) => {
    e.stopPropagation();
    const newName = await promptForGroupName(title);
    if (newName !== null && newName !== title) {
      await renameTabGroup(groupInfo.id, newName);
      loadTabs();
    }
  });

  // Enable drop on group container (for adding tabs to group)
  const groupTabsEl = groupEl.querySelector('.tab-group-tabs');

  groupTabsEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    groupEl.classList.add('drag-over-group');
  });

  groupTabsEl.addEventListener('dragleave', (e) => {
    // Only remove if leaving the group entirely
    if (!groupEl.contains(e.relatedTarget)) {
      groupEl.classList.remove('drag-over-group');
    }
  });

  groupTabsEl.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    groupEl.classList.remove('drag-over-group');

    // Only handle drops directly on the group tabs container
    if (e.target !== groupTabsEl) return;

    if (!draggedTab) return;

    const sourceTabId = parseInt(draggedTab.dataset.tabId);
    const sourceGroupId = draggedTab.dataset.groupId ? parseInt(draggedTab.dataset.groupId) : null;

    try {
      // Add to this group if not already in it
      if (sourceGroupId !== groupInfo.id) {
        await addTabToGroup(sourceTabId, groupInfo.id);
      }

      // Move to end of group
      await browser.tabs.move(sourceTabId, {
        windowId: windowId,
        index: -1
      });

      loadTabs();
    } catch (err) {
      console.error('Failed to add tab to group:', err);
      loadTabs();
    }
  });

  // Update count after tabs are added
  setTimeout(() => {
    const count = groupEl.querySelectorAll('.tab-item').length;
    const countEl = groupEl.querySelector('.tab-group-count');
    countEl.textContent = `${count} tab${count !== 1 ? 's' : ''}`;
  }, 0);

  return groupEl;
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

// Search event listeners
searchInput.addEventListener('input', (e) => {
  searchQuery = e.target.value;
  if (searchRenderTimer) {
    clearTimeout(searchRenderTimer);
  }
  searchRenderTimer = setTimeout(() => {
    renderFilteredTabs();
  }, 100);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    searchQuery = '';
    searchInput.value = '';
    searchInput.blur();
    renderFilteredTabs();
  }
});

// Keyboard shortcut: Ctrl+F to focus search
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault();
    searchInput.focus();
  }
});

// Initial load (don't preserve scroll on first load)
loadTabs(false);

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

// Listen for tab group changes (if supported)
if (tabGroupsSupported) {
  browser.tabGroups.onCreated.addListener(() => {
    if (currentView === 'window') {
      setTimeout(loadTabs, 100);
    }
  });

  browser.tabGroups.onRemoved.addListener(() => {
    if (currentView === 'window') {
      setTimeout(loadTabs, 100);
    }
  });

  browser.tabGroups.onUpdated.addListener(() => {
    if (currentView === 'window') {
      setTimeout(loadTabs, 100);
    }
  });

  browser.tabGroups.onMoved.addListener(() => {
    if (currentView === 'window') {
      setTimeout(loadTabs, 100);
    }
  });
}
