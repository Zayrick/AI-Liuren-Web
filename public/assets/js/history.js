/**
 * @file history.js
 * @brief Manages the history panel, including rendering, search, and interactions.
 *
 * This module encapsulates all logic for the divination history feature.
 * It interacts with the IndexedDB via `db.js` and communicates with the main
 * application logic (`app.js`) through callbacks for loose coupling.
 */

import { getRecordById, deleteRecord, searchRecords } from './db.js';

let currentChatId = null;
let currentSearchKeyword = '';
let searchDebounceTimer = null;
let callbacks = {};

/**
 * 将时间戳格式化为 "YYYY年MM月DD日 HH:mm"
 * @param {number} ts - 时间戳
 * @returns {string} 格式化后的日期字符串
 */
function formatTimestamp(ts) {
  const date = new Date(ts);
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${year}年${month}月${day}日 ${hours}:${minutes}`;
}

/**
 * 将记录按时间分组：今天、昨天、最近、七天前
 * @param {Array<object>} records - 待分组的记录数组
 * @returns {object} 分组后的对象
 */
function groupRecordsByTime(records) {
    const groups = { '今天': [], '昨天': [], '最近': [], '七天前': [] };
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayTime = yesterday.getTime();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoTime = sevenDaysAgo.getTime();

    for (const record of records) {
        const recordTime = new Date(record.timestamp).setHours(0, 0, 0, 0);

        if (recordTime === today) {
            groups['今天'].push(record);
        } else if (recordTime === yesterdayTime) {
            groups['昨天'].push(record);
        } else if (recordTime > sevenDaysAgoTime) {
            groups['最近'].push(record);
        } else {
            groups['七天前'].push(record);
        }
    }

    // 清理空分组并返回
    const finalGroups = {};
    if (groups['今天'].length > 0) finalGroups['今天'] = groups['今天'];
    if (groups['昨天'].length > 0) finalGroups['昨天'] = groups['昨天'];
    if (groups['最近'].length > 0) finalGroups['最近'] = groups['最近'];
    if (groups['七天前'].length > 0) finalGroups['七天前'] = groups['七天前'];
    
    return finalGroups;
}

/**
 * 获取并渲染历史记录到面板，支持搜索功能
 * @param {string} [keyword=''] 搜索关键词，为空时显示所有记录
 */
async function renderHistory(keyword = '') {
  const listEl = document.getElementById('history-list');
  listEl.innerHTML = ''; // 清空现有列表
  try {
    const records = await searchRecords(keyword);
    if (!records || records.length === 0) {
      const message = keyword.trim() 
        ? `未找到包含"${keyword}"的历史记录` 
        : '暂无历史记录';
      listEl.innerHTML = `<p style="text-align: center; color: var(--text-muted-color);">${message}</p>`;
      return;
    }
    
    const grouped = groupRecordsByTime(records);

    const fragment = document.createDocumentFragment();
    for (const groupName in grouped) {
      const groupRecords = grouped[groupName];
      
      const groupTitle = document.createElement('div');
      groupTitle.className = 'history-group__title';
      groupTitle.textContent = groupName;
      fragment.appendChild(groupTitle);

      groupRecords.forEach(record => {
        const itemEl = document.createElement('div');
        itemEl.className = 'history-item';
        itemEl.dataset.id = record.id;
        itemEl.innerHTML = `
          <div class="history-item__content">
            <div class="history-item__title">${DOMPurify.sanitize(record.title || '无标题')}</div>
            <div class="history-item__time">${formatTimestamp(record.timestamp)}</div>
          </div>
          <div class="history-item__delete">删除</div>
        `;
        
        initSwipeToDelete(itemEl, record.id);
        fragment.appendChild(itemEl);
      });
    }
    listEl.appendChild(fragment);

    if (currentChatId) {
      const activeItem = listEl.querySelector(`.history-item[data-id="${currentChatId}"]`);
      if (activeItem) {
        activeItem.classList.add('is-active');
      }
    }

  } catch (error) {
    console.error("获取历史记录失败:", error);
    listEl.innerHTML = '<p>无法加载历史记录</p>';
  }
}

/**
 * 切换历史记录面板的显示状态
 * @param {boolean} show - true 为显示, false 为隐藏
 */
export function toggleHistoryPanel(show) {
  const panel = document.getElementById('history-panel');
  const overlay = document.getElementById('page-overlay');
  if (show) {
    renderHistory(currentSearchKeyword);
    panel.classList.add('is-open');
    overlay.classList.add('is-visible');
  } else {
    document.querySelectorAll('.history-item--swiped').forEach(item => {
      item.classList.remove('history-item--swiped');
      const contentEl = item.querySelector('.history-item__content');
      if (contentEl) {
        contentEl.style.transform = '';
        contentEl.style.transition = 'none';
      }
    });
    
    panel.classList.remove('is-open');
    overlay.classList.remove('is-visible');
  }
}

/**
 * 处理历史记录项的点击事件
 * @param {number} id - 被点击记录的ID
 */
async function handleHistoryItemClick(id) {
  try {
    const record = await getRecordById(id);
    if (!record) return;

    document.querySelectorAll('.history-item--swiped').forEach(item => {
      item.classList.remove('history-item--swiped');
      const contentEl = item.querySelector('.history-item__content');
      if (contentEl) {
        contentEl.style.transform = '';
        contentEl.style.transition = 'none';
      }
    });

    if (callbacks.onItemClick) {
      callbacks.onItemClick(record);
    }
    
    currentChatId = record.id;
    const allItems = document.querySelectorAll('.history-item');
    allItems.forEach(item => item.classList.remove('is-active'));
    const currentItemEl = document.querySelector(`.history-item[data-id="${id}"]`);
    if(currentItemEl) currentItemEl.classList.add('is-active');

    toggleHistoryPanel(false);

  } catch (error) {
    console.error("加载记录失败:", error);
  }
}

/**
 * 初始化历史条目的滑动删除功能
 * @param {HTMLElement} itemEl - 历史条目元素
 * @param {number} recordId - 记录ID
 */
function initSwipeToDelete(itemEl, recordId) {
  let startX = 0;
  let currentX = 0;
  let startY = 0;
  let currentY = 0;
  let isDragging = false;
  let startTime = 0;
  
  const contentEl = itemEl.querySelector('.history-item__content');
  const deleteBtn = itemEl.querySelector('.history-item__delete');
  const threshold = 70;
  
  function resetSwipe() {
    itemEl.classList.remove('history-item--swiped');
    contentEl.style.transform = '';
  }
  
  function handleStart(e) {
    document.querySelectorAll('.history-item--swiped').forEach(item => {
      if (item !== itemEl) {
        item.classList.remove('history-item--swiped');
        item.querySelector('.history-item__content').style.transform = '';
      }
    });
    
    isDragging = true;
    startTime = Date.now();
    startX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
    startY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
    contentEl.style.transition = 'none';
  }
  
  function handleMove(e) {
    if (!isDragging) return;
    
    currentX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
    currentY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;

    const deltaX = currentX - startX;
    const deltaY = currentY - startY;

    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      e.preventDefault();
      if (deltaX < 0) {
        const translateX = Math.max(deltaX, -80);
        contentEl.style.transform = `translateX(${translateX}px)`;
      }
    }
  }
  
  function handleEnd(e) {
    if (!isDragging) return;
    
    isDragging = false;
    contentEl.style.transition = '';
    
    const finalX = e.type.includes('mouse') ? e.clientX : (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : startX);
    const finalY = e.type.includes('mouse') ? e.clientY : (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientY : startY);
    const deltaX = finalX - startX;
    const deltaY = finalY - startY;
    
    if (Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10) {
      contentEl.style.transform = '';
      contentEl.style.transition = 'none';
      requestAnimationFrame(() => {
        contentEl.style.transition = '';
      });
      
      if(itemEl.classList.contains('history-item--swiped')) {
          resetSwipe();
      } else {
          handleHistoryItemClick(recordId);
      }
      return;
    } else if (Math.abs(deltaX) < Math.abs(deltaY)) {
      contentEl.style.transform = '';
      return;
    }
    
    const deltaTime = Date.now() - startTime;
    const velocity = Math.abs(deltaX) / deltaTime;
    
    contentEl.style.transform = '';

    if ((deltaX < -threshold) || (velocity > 0.3 && deltaX < 0)) {
      itemEl.classList.add('history-item--swiped');
    } else {
      resetSwipe();
    }
  }
  
  async function handleDelete() {
    itemEl.classList.add('history-item--deleting');
    try {
      await deleteRecord(recordId);
      if (callbacks.onItemDelete) {
        callbacks.onItemDelete(recordId);
      }
      if (currentChatId === recordId) {
        currentChatId = null;
      }
      setTimeout(() => {
        itemEl.remove();
        const remainingItems = document.querySelectorAll('.history-item').length;
        if (remainingItems === 0) {
          document.getElementById('history-list').innerHTML = 
            '<p style="text-align: center; color: var(--text-muted-color);">暂无历史记录</p>';
        }
      }, 300);
    } catch (error) {
      console.error('删除记录失败:', error);
      itemEl.classList.remove('history-item--deleting');
    }
  }
  
  contentEl.addEventListener('touchstart', handleStart, { passive: true });
  contentEl.addEventListener('touchmove', handleMove, { passive: false });
  contentEl.addEventListener('touchend', handleEnd);
  contentEl.addEventListener('mousedown', handleStart);
  document.addEventListener('mousemove', handleMove);
  document.addEventListener('mouseup', handleEnd);
  deleteBtn.addEventListener('click', handleDelete);
}

function toggleSearchClearButton(value) {
  const clearBtn = document.getElementById('history-search-clear');
  if (value.length > 0) {
    clearBtn.classList.add('is-visible');
  } else {
    clearBtn.classList.remove('is-visible');
  }
}

async function performSearch(keyword) {
  try {
    await renderHistory(keyword);
  } catch (error) {
    console.error('搜索失败:', error);
    const listEl = document.getElementById('history-list');
    listEl.innerHTML = '<p style="text-align: center; color: var(--text-muted-color);">搜索时发生错误</p>';
  }
}

function handleSearchInput(e) {
  const keyword = e.target.value.trim();
  currentSearchKeyword = keyword;
  toggleSearchClearButton(keyword);
  
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
  }
  
  searchDebounceTimer = setTimeout(() => {
    performSearch(keyword);
  }, 300);
}

function clearSearch() {
  const searchInput = document.getElementById('history-search-input');
  searchInput.value = '';
  currentSearchKeyword = '';
  toggleSearchClearButton('');
  
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
  
  renderHistory();
}

/**
 * 更新当前会话ID。
 * @param {number|null} id
 */
export function setCurrentChatId(id) {
    currentChatId = id;
}

/**
 * 初始化历史记录模块
 * @param {object} cbs - 回调函数对象 { onItemClick, onItemDelete }
 */
export function initHistory(cbs) {
    callbacks = cbs;
    document.getElementById('history-btn').addEventListener('click', () => toggleHistoryPanel(true));
    document.getElementById('history-panel-close-btn').addEventListener('click', () => {
        if (callbacks.onPanelClose) {
            callbacks.onPanelClose();
        }
        toggleHistoryPanel(false);
    });
    document.getElementById('page-overlay').addEventListener('click', () => toggleHistoryPanel(false));
    document.getElementById('history-search-input').addEventListener('input', handleSearchInput);
    document.getElementById('history-search-clear').addEventListener('click', clearSearch);
} 