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
let draggedGroup = null;
let isInternalMove = false;

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

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Tab Group helper functions
async function createTabGroup(tabIds, title) {
  if (!tabGroupsSupported) return null;
  try {
    const groupId = await browser.tabGroups.create({ tabIds });
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
    await browser.tabGroups.update(groupId, { addTabIds: [tabId] });
  } catch (err) {
    console.error('Failed to add tab to group:', err);
  }
}

async function removeTabFromGroup(tabId) {
  if (!tabGroupsSupported) return;
  try {
    await browser.tabs.ungroup(tabId);
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

function showColorPicker(groupId, currentColor, anchorEl) {
  // Remove any existing color picker
  const existing = document.querySelector('.color-picker-popup');
  if (existing) existing.remove();

  const picker = document.createElement('div');
  picker.className = 'color-picker-popup';

  picker.innerHTML = TAB_GROUP_COLORS.map(color => `
    <button class="color-option ${color === currentColor ? 'selected' : ''}"
            data-color="${color}"
            style="background: ${TAB_GROUP_COLOR_VALUES[color]}"
            title="${color}"></button>
  `).join('');

  // Position near the anchor element
  const rect = anchorEl.getBoundingClientRect();
  picker.style.position = 'absolute';
  picker.style.top = `${rect.bottom + window.scrollY + 4}px`;
  picker.style.left = `${rect.left + window.scrollX}px`;

  picker.addEventListener('click', async (e) => {
    const colorBtn = e.target.closest('.color-option');
    if (colorBtn) {
      const newColor = colorBtn.dataset.color;
      await changeTabGroupColor(groupId, newColor);
      picker.remove();
      loadTabs();
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
  
   // Build window label HTML if provided (for recency view)
   const windowLabelHtml = windowLabel ? `<span class="tab-window-label">${windowLabel}</span>` : '';

   tabEl.innerHTML = `
     <img class="tab-favicon" src="${escapeHtml(getFaviconUrl(tab))}" alt="" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22%23666%22><rect width=%2224%22 height=%2224%22 rx=%224%22/></svg>'">
     <div class="tab-info">
       <div class="tab-title">${escapeHtml(tab.title || 'Untitled')}</div>
       <div class="tab-url">${escapeHtml(tab.url || '')}</div>
     </div>
     ${windowLabelHtml}
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

    tabEl.addEventListener('dragleave', () => {
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
      tabEl.classList.remove('drag-over-top');
      tabEl.classList.remove('drag-over-bottom');
      tabEl.classList.remove('drag-hold-active');

      // Remove tooltip
      const tooltip = document.querySelector('.drag-hold-tooltip');
      if (tooltip) tooltip.remove();

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

      // Check if drag-hold was active (creating a new group)
      const wasHoldActive = dragHoldTarget === tabEl && tabEl.classList.contains('drag-hold-active');

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
            await createTabGroup([targetTabId, sourceTabId], groupName);
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
      await renderRecencyView(tabsWithTimestamps);
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

async function renderRecencyView(tabsWithTimestamps) {
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

    windowEl.innerHTML = `
      <div class="window-header">
        <span class="window-header-icon">🪟</span>
        <span>${headerLabel}</span>
        <span style="color: #666; margin-left: auto;">${tabs.length} tab${tabs.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="window-tabs"></div>
    `;

    const windowTabsEl = windowEl.querySelector('.window-tabs');

    // Enable drop on the window tabs container for dropping at the end (ungroups tab)
    windowTabsEl.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    windowTabsEl.addEventListener('drop', async (e) => {
      // Only handle drops directly on the container, not bubbled from tab items
      if (e.target !== windowTabsEl) return;

      e.preventDefault();

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

    tabListEl.appendChild(windowEl);
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

  groupEl.innerHTML = `
    <div class="tab-group-header" style="border-left-color: ${colorValue}">
      <button class="tab-group-color" style="background: ${colorValue}" title="Change color" data-color="${color}"></button>
      <span class="tab-group-name" title="Click to rename">${escapeHtml(title)}</span>
      <span class="tab-group-count"></span>
    </div>
    <div class="tab-group-tabs"></div>
  `;

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
