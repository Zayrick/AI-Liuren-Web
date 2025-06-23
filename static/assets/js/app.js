/**
 * @file app.js
 * @brief 小六 AI 占卜前端逻辑脚本
 *
 * 职责：
 * 1. 处理表单提交，向后端发送 SSE 请求并流式渲染返回结果。
 * 2. 管理本地存储的用户设置（API Key、模型、端点）。
 * 3. 提供基础 UI 工具函数（加载态、AI 设置面板切换等）。
 * 4. 实现占卜历史记录的本地存储与展示。
 *
 * 所有函数均包含 Doxygen/JSDoc 风格注释，符合企业级审计要求。
 */
import { initDB, addRecord, getAllRecords, getRecordById, deleteRecord, searchRecords } from './db.js';

(() => {
  'use strict';

  /** @typedef {HTMLElement} HTMLElementAlias */

  // --- 全局状态变量 ---
  /** @type {boolean} 是否保存当前对话 */
  let isSaveEnabled = true;
  /** @type {number|null} 当前显示的聊天记录ID */
  let currentChatId = null;
  /** @type {string} 当前搜索关键词 */
  let currentSearchKeyword = '';
  /** @type {number|null} 搜索防抖定时器ID */
  let searchDebounceTimer = null;

  /**
   * 显示加载状态并更新文案。
   * @param {HTMLElementAlias} element 目标元素
   * @param {string} [text='处理中'] 文案前缀
   */
  function showLoading(element, text = '处理中') {
    element.textContent = `${text}...`;
    element.classList.add('loading');
  }

  /**
   * 清除加载状态。
   * @param {HTMLElementAlias} element 目标元素
   */
  function clearLoading(element) {
    element.classList.remove('loading');
  }

  /**
   * 切换 AI 设置面板显示/隐藏。
   * 由右侧齿轮按钮触发：展开时显示整个容器，折叠时完全隐藏。
   * @param {MouseEvent} [evt]
   */
  function toggleAiSettings(evt) {
    const container = document.querySelector('.ai-settings');
    const content = document.getElementById('ai-settings-content');
    const chevron = document.getElementById('chevron');

    const isHidden = container.style.display === 'none' || getComputedStyle(container).display === 'none';
    if (isHidden) {
      // 展开：显示容器并激活内容
      container.style.display = 'block';
      content.classList.add('active');
      chevron.classList.add('rotated');
    } else {
      // 折叠：隐藏容器并关闭内容
      container.style.display = 'none';
      content.classList.remove('active');
      chevron.classList.remove('rotated');
    }
  }

  /**
   * 读取 localStorage 中的用户配置并填充到输入框。 
   * @private
   */
  function loadLocalSettings() {
    /** @type {HTMLInputElement} */
    const apiKeyInput = document.getElementById('apiKey');
    /** @type {HTMLInputElement} */
    const aiModelInput = document.getElementById('aiModel');
    /** @type {HTMLInputElement} */
    const aiEndpointInput = document.getElementById('aiEndpoint');

    apiKeyInput.value = localStorage.getItem('divination_api_key') || '';
    aiModelInput.value = localStorage.getItem('divination_ai_model') || '';
    aiEndpointInput.value = localStorage.getItem('divination_ai_endpoint') || '';
  }

  /**
   * Reasoning 按钮切换事件处理。
   * @param {Event} e 事件对象
   * @private
   */
  function onReasoningToggle(e) {
    const button = e.currentTarget;
    const isActive = button.getAttribute('data-active') === 'true';

    // 仅切换按钮本身的状态，DOM 的可见性由 onsubmit 逻辑处理
    if (isActive) {
      button.setAttribute('data-active', 'false');
      button.classList.remove('active');
    } else {
      button.setAttribute('data-active', 'true');
      button.classList.add('active');
    }
  }

  /**
   * 获取推理开关的状态。
   * @returns {boolean} 是否显示推理过程
   * @private
   */
  function isReasoningEnabled() {
    const button = document.getElementById('reasoning-toggle');
    return button.getAttribute('data-active') === 'true';
  }

  /**
   * 修复不符合 GFM 规范的 Markdown 标题。
   * marked.js 遵循的 GFM 规范要求 # 和标题文本之间必须有空格。
   * 此函数为缺失空格的标题（如 ###标题）自动添加空格。
   * @param {string} markdown
   * @returns {string}
   */
  function fixMarkdownHeadings(markdown) {
    // 使用正则表达式在 # 和标题文本之间插入空格
    // m flag: multiline mode, ^ matches start of line
    return markdown.replace(/^(#+)([^ #\n\r])/gm, '$1 $2');
  }

  /**
   * 表单提交事件处理。
   * @param {SubmitEvent} e 事件对象
   * @private
   */
  async function onSubmit(e) {
    e.preventDefault();

    const statusBtn = document.getElementById('status-btn');
    const statusIcon = statusBtn.querySelector('span');

    // 立即更新图标为"新建会话"并禁用，防止在生成期间操作
    statusIcon.textContent = 'chat_add_on';
    statusIcon.style.color = ''; // 确保移除高亮
    statusBtn.disabled = true;

    // 为结果区域添加激活状态类，用于控制分割线的显示
    document.querySelector('.results-area').classList.add('results-area--active');

    const numbers = [
      parseInt(document.getElementById('n1').value, 10),
      parseInt(document.getElementById('n2').value, 10),
      parseInt(document.getElementById('n3').value, 10)
    ];
    const question = document.getElementById('question').value.trim();
    const showReasoning = isReasoningEnabled();

    const metaEl = document.getElementById('output-meta');
    const reasoningEl = document.getElementById('output-reasoning');
    const answerEl = document.getElementById('output-answer');
    const reasoningSection = document.getElementById('reasoning-section');

    // 初始隐藏推理面板，只有在收到事件后且用户仍允许时再展示
    reasoningSection.classList.add('reasoning-section--hidden');

    showLoading(metaEl, '连接中');
    showLoading(reasoningEl, '等待');
    showLoading(answerEl, '等待');

    /** @type {HTMLButtonElement} 单一开始/停止按钮 */
    const toggleBtn = document.getElementById('toggle-btn');

    // 初始化 AbortController 用于随时中断请求
    const controller = new AbortController();

    /**
     * 将按钮状态切换为"停止"。
     */
    const switchToStopState = () => {
      toggleBtn.innerHTML = '<span class="material-symbols-rounded">stop</span>';
      toggleBtn.type = 'button';
      toggleBtn.setAttribute('type', 'button');
      toggleBtn.classList.remove('btn-primary');
      toggleBtn.classList.add('btn-secondary');
      toggleBtn.disabled = false;
    };

    /**
     * 将按钮状态切换回"开始占卜"。
     */
    const switchToStartState = () => {
      toggleBtn.innerHTML = '<span class="material-symbols-rounded">arrow_upward</span>';
      toggleBtn.type = 'submit';
      toggleBtn.setAttribute('type', 'submit');
      toggleBtn.classList.remove('btn-secondary');
      toggleBtn.classList.add('btn-primary');
      toggleBtn.disabled = false;
    };

    // --- Markdown 解析相关 ---
    // 为流式输出配置 Marked.js
    marked.setOptions({
      gfm: true,
      breaks: true,
      mangle: false,
      headerIds: false
    });
    // 初始化两个部分的内容字符串
    let reasoningMarkdown = '';
    let answerMarkdown = '';
    let isTitleStarted = false;
    // ---

    // 切换为停止状态，并绑定一次性停止处理器
    switchToStopState();

    const stopHandler = (evt) => {
      evt.preventDefault();
      controller.abort();
      toggleBtn.disabled = true;
    };
    toggleBtn.addEventListener('click', stopHandler, { once: true });

    // 读取用户配置
    const apiKeyInput = document.getElementById('apiKey');
    const aiModelInput = document.getElementById('aiModel');
    const aiEndpointInput = document.getElementById('aiEndpoint');

    const apiKey = apiKeyInput.value.trim();
    const model = aiModelInput.value.trim();
    const endpoint = aiEndpointInput.value.trim();

    // 持久化到 localStorage
    localStorage.setItem('divination_api_key', apiKey);
    localStorage.setItem('divination_ai_model', model);
    localStorage.setItem('divination_ai_endpoint', endpoint);

    let finalAnswer = '';
    let finalTitle = '';

    try {
      const resp = await fetch('/api/divination', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream'
        },
        signal: controller.signal,
        body: JSON.stringify({
          numbers,
          question,
          show_reasoning: showReasoning,
          apiKey,
          model,
          endpoint,
          clientTime: { ts: Date.now(), tz_offset: new Date().getTimezoneOffset() }
        })
      });

      if (!resp.ok || !resp.body) {
        metaEl.textContent = `请求失败：${resp.status} ${resp.statusText}`;
        return;
      }

      clearLoading(metaEl);

      const decoder = new TextDecoder('utf-8');
      const reader = resp.body.getReader();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, boundary).trim();
          buffer = buffer.slice(boundary + 2);

          const lines = rawEvent.split('\n');
          /** @type {string} */
          let eventType = 'message';
          const dataParts = [];
          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              dataParts.push(line.slice(5).replace(/^\s/, ''));
            }
          }
          const dataStr = dataParts.join('\n');

          switch (eventType) {
            case 'meta': {
              const meta = JSON.parse(dataStr);
              /*
               * 在卦象解析中显示更完整的信息：
               *  1) 所问之事：question
               *  2) 所得之卦：hexagram
               *  3) 所占之时：fullBazi
               */
              metaEl.textContent = `所问之事：${question}\n所得之卦：${meta.hexagram}\n所占之时：${meta.time}`;
              clearLoading(metaEl);
              break;
            }
            case 'title': {
              if (!isTitleStarted) {
                document.querySelector('.page-header__title').textContent = '';
                isTitleStarted = true;
              }
              document.querySelector('.page-header__title').textContent += dataStr.replace(/\\n/g, '\n');
              break;
            }
            case 'reasoning': {
              if (!isReasoningEnabled()) break;

              // 首次收到 reasoning 数据时，移除隐藏类
              if (reasoningSection.classList.contains('reasoning-section--hidden')) {
                reasoningSection.classList.remove('reasoning-section--hidden');
                clearLoading(reasoningEl);
                updateReasoningTitle('thinking');
                // 确保思考过程展开显示
                document.querySelector('.reasoning-section').classList.remove('collapsed');
              }
              reasoningMarkdown += dataStr.replace(/\\n/g, '\n');
              const fixedReasoning = fixMarkdownHeadings(reasoningMarkdown);
              reasoningEl.innerHTML = DOMPurify.sanitize(marked.parse(fixedReasoning));
              break;
            }
            case 'answer': {
              if (answerEl.classList.contains('loading')) {
                // 首次进入 answer 流，标记思考完成并可自动折叠
                if (isReasoningEnabled() && reasoningEl.textContent.trim()) {
                  updateReasoningTitle('completed');
                  autoCollapseReasoning();
                }

                clearLoading(answerEl);
              }
              answerMarkdown += dataStr.replace(/\\n/g, '\n');
              const fixedAnswer = fixMarkdownHeadings(answerMarkdown);
              answerEl.innerHTML = DOMPurify.sanitize(marked.parse(fixedAnswer));
              break;
            }
            case 'error': {
              answerEl.textContent += `\n\n[错误] ${dataStr}`;
              break;
            }
            default:
              break;
          }
        }
      }
      finalAnswer = answerMarkdown;
      finalTitle = document.querySelector('.page-header__title').textContent;

    } catch (err) {
      if (err.name === 'AbortError') {
        answerEl.textContent += '\n\n[已停止] 用户中止生成';
      } else {
        answerEl.textContent = `错误：${err}`;
      }
    } finally {
      // 无论正常结束、错误或手动中止，均恢复按钮至"开始占卜"状态
      toggleBtn.removeEventListener('click', stopHandler);
      switchToStartState();
      
      // 恢复右上角状态按钮为可用
      statusBtn.disabled = false;

      // 占卜结束后，处理记录保存和状态更新
      if (finalAnswer.trim()) {
        if(isSaveEnabled) {
          await saveCurrentDivination(finalTitle, finalAnswer, metaEl.textContent);
        }
        updateStatusIcon();
      }
    }
  }

  /**
   * 应用初始化：绑定事件、读取配置、注册 Service Worker 等。
   */
  async function init() {
    // 绑定事件
    document.getElementById('ai-settings-toggle').addEventListener('click', toggleAiSettings);
    document.getElementById('divination-form').addEventListener('submit', onSubmit);
    document.getElementById('reasoning-toggle').addEventListener('click', onReasoningToggle);
    document.getElementById('reasoning-header').addEventListener('click', toggleReasoningCollapse);
    document.getElementById('reasoning-collapse-btn').addEventListener('click', (e) => {
      e.stopPropagation(); // 防止触发标题栏点击事件
      toggleReasoningCollapse();
    });
    // -- 新增历史记录事件绑定 --
    document.getElementById('history-btn').addEventListener('click', () => toggleHistoryPanel(true));
    document.getElementById('history-panel-close-btn').addEventListener('click', () => {
      // 关闭时清空当前对话，实现"新占卜"功能
      clearChat();
      toggleHistoryPanel(false);
    });
    document.getElementById('page-overlay').addEventListener('click', () => toggleHistoryPanel(false));
    document.getElementById('status-btn').addEventListener('click', handleStatusButtonClick);
    
    // -- 搜索功能事件绑定 --
    document.getElementById('history-search-input').addEventListener('input', handleSearchInput);
    document.getElementById('history-search-clear').addEventListener('click', clearSearch);

    // 初始化配置
    loadLocalSettings();
    // -- 新增数据库和状态初始化 --
    try {
        await initDB();
    } catch (error) {
        console.error("数据库初始化失败，历史记录功能将不可用。", error);
    }
    updateStatusIcon(); // 设置初始状态

    // 默认隐藏推理过程容器
    document.getElementById('reasoning-section').classList.add('reasoning-section--hidden');
    
    // 确保思考过程默认展开状态
    document.querySelector('.reasoning-section').classList.remove('collapsed');

    // 注册 Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js');
    }

    // 禁用旧的 AI 设置标题点击指针样式
    const headerEl = document.getElementById('ai-settings-header');
    headerEl.style.cursor = 'default';

    // 动态调整内容区域的底部 padding 以适应输入区域
    adjustContentPadding();

    // 初始化文本域自动高度功能
    handleTextareaAutoResize();
  }

  /**
   * 切换思考过程的折叠状态。
   * @private
   */
  function toggleReasoningCollapse() {
    const reasoningSection = document.querySelector('.reasoning-section');
    const isCollapsed = reasoningSection.classList.contains('collapsed');
    
    if (isCollapsed) {
      reasoningSection.classList.remove('collapsed');
    } else {
      reasoningSection.classList.add('collapsed');
    }
  }

  /**
   * 更新思考过程标题文案。
   * @param {string} status 状态：'thinking' | 'completed'
   * @private
   */
  function updateReasoningTitle(status) {
    const titleEl = document.getElementById('reasoning-title');
    const titleClasses = titleEl.classList;
    
    // 清除之前的状态类
    titleClasses.remove('reasoning-thinking', 'reasoning-completed');
    
    if (status === 'thinking') {
      titleEl.textContent = '思考中';
      titleClasses.add('reasoning-thinking');
    } else if (status === 'completed') {
      titleEl.textContent = '思考完成';
      titleClasses.add('reasoning-completed');
    }
  }

  /**
   * 自动折叠思考过程（仅在思考完成后调用）。
   * @private
   */
  function autoCollapseReasoning() {
    const reasoningSection = document.querySelector('.reasoning-section');
    // 延迟1秒后自动折叠，给用户时间看到"思考完成"状态
    setTimeout(() => {
      reasoningSection.classList.add('collapsed');
    }, 1000);
  }

  /**
   * 动态调整内容区域的内边距，以完美适配顶部页头和底部输入区域的高度。
   * 此函数使用 ResizeObserver 监测页头和输入区域的高度变化，
   * 确保内容不会被遮挡，同时避免了硬编码带来的设备兼容性问题。
   * @private
   */
  function adjustContentPadding() {
    const pageContainer = document.querySelector('.page-container');
    const pageContent = document.querySelector('.page-content');
    const pageHeader = document.querySelector('.page-header');
    const inputArea = document.querySelector('.input-area');

    if (!pageContainer || !pageContent || !pageHeader || !inputArea) return;

    const observer = new ResizeObserver(() => {
      // 只要有任何一个被监测元素尺寸变化，就重新计算所有动态 padding
      if (window.getComputedStyle(pageContainer).display !== 'grid') {
        const headerHeight = pageHeader.getBoundingClientRect().height;
        const inputAreaHeight = inputArea.getBoundingClientRect().height;

        // 为上下都增加 1rem 的舒适间距
        pageContent.style.paddingTop = `calc(${headerHeight}px + 1rem)`;
        // 同时考虑 inputArea 的高度、安全区域和舒适间距，彻底解决遮挡
        pageContent.style.paddingBottom = `calc(${inputAreaHeight}px + env(safe-area-inset-bottom) + 1rem)`;
      } else {
        // 桌面端恢复默认值
        pageContent.style.paddingTop = '';
        pageContent.style.paddingBottom = '';
      }
    });

    // 同时监测页头和输入区域
    observer.observe(pageHeader);
    observer.observe(inputArea);
  }

  /**
   * 实现文本域（textarea）高度根据内容自动调整的功能。
   * - 初始高度由 CSS `min-height` 设定。
   * - 输入时，高度会增长以容纳内容，直至达到 CSS `max-height`。
   * - 超过 `max-height` 后，将出现滚动条。
   * @private
   */
  function handleTextareaAutoResize() {
    const textarea = document.getElementById('question');
    if (!textarea) return;

    const adjustHeight = () => {
      textarea.style.height = 'auto'; // 重置高度以获取准确的 scrollHeight
      textarea.style.height = `${textarea.scrollHeight}px`; // 设置为内容的实际高度
    };

    textarea.addEventListener('input', adjustHeight);

    // 初始加载时也调用一次，以防有缓存内容
    adjustHeight();
  }

  // --- 历史记录相关功能 ---

  /**
   * 切换历史记录面板的显示状态
   * @param {boolean} show - true 为显示, false 为隐藏
   */
  function toggleHistoryPanel(show) {
    const panel = document.getElementById('history-panel');
    const overlay = document.getElementById('page-overlay');
    if (show) {
      renderHistory(currentSearchKeyword); // 显示前根据当前搜索关键词重新渲染列表
      panel.classList.add('is-open');
      overlay.classList.add('is-visible');
    } else {
      // 关闭面板前，立即重置所有滑动状态，防止删除按钮在动画过程中显示
      document.querySelectorAll('.history-item--swiped').forEach(item => {
        item.classList.remove('history-item--swiped');
        const contentEl = item.querySelector('.history-item__content');
        if (contentEl) {
          contentEl.style.transform = '';
          contentEl.style.transition = 'none'; // 立即重置，不要动画
        }
      });
      
      panel.classList.remove('is-open');
      overlay.classList.remove('is-visible');
    }
  }

  /**
   * 获取并渲染历史记录到面板，支持搜索功能
   * @param {string} [keyword=''] 搜索关键词，为空时显示所有记录
   * @private
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
          
          // 初始化滑动和点击功能
          initSwipeToDelete(itemEl, record.id);
          
          fragment.appendChild(itemEl);
        });
      }
      listEl.appendChild(fragment);

      // 如果当前正在查看某个历史记录，则在列表中高亮它
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
   * 处理历史记录项的点击事件
   * @param {number} id - 被点击记录的ID
   * @private
   */
  async function handleHistoryItemClick(id) {
    try {
      const record = await getRecordById(id);
      if (!record) return;

      // 立即重置所有滑动状态，防止在界面更新过程中出现视觉问题
      document.querySelectorAll('.history-item--swiped').forEach(item => {
        item.classList.remove('history-item--swiped');
        const contentEl = item.querySelector('.history-item__content');
        if (contentEl) {
          contentEl.style.transform = '';
          contentEl.style.transition = 'none';
        }
      });

      // 1. 清空当前聊天界面
      clearChat();

      // 2. 从记录加载新内容
      document.querySelector('.page-header__title').textContent = record.title;
      document.getElementById('output-meta').textContent = record.meta;
      const answerEl = document.getElementById('output-answer');
      answerEl.innerHTML = DOMPurify.sanitize(marked.parse(record.result));
      document.getElementById('reasoning-section').classList.add('reasoning-section--hidden');
      document.querySelector('.results-area').classList.add('results-area--active');
      
      // 3. 更新当前聊天ID和历史列表中的UI状态
      currentChatId = record.id;
      const allItems = document.querySelectorAll('.history-item');
      allItems.forEach(item => item.classList.remove('is-active'));
      const currentItemEl = document.querySelector(`.history-item[data-id="${id}"]`);
      if(currentItemEl) currentItemEl.classList.add('is-active');

      // 4. 更新全局UI状态并关闭面板
      updateStatusIcon();
      toggleHistoryPanel(false);

    } catch (error) {
      console.error("加载记录失败:", error);
    }
  }

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
   * 保存当前占卜结果到数据库
   * @param {string} title - AI生成的标题
   * @param {string} result - AI生成的完整回复
   * @param {string} meta - 卦象元数据
   */
  async function saveCurrentDivination(title, result, meta) {
    const record = {
      title,
      result,
      meta,
      timestamp: Date.now()
    };
    try {
      const newId = await addRecord(record);
      currentChatId = newId;
      console.log('记录已保存, ID:', newId);
    } catch (error) {
      console.error('保存记录失败:', error);
    }
  }

  /**
   * 更新右上角状态图标的逻辑
   * @private
   */
  function updateStatusIcon() {
    const statusBtn = document.getElementById('status-btn');
    const statusIcon = statusBtn.querySelector('span');
    const answerEl = document.getElementById('output-answer');

    // 检查是否有内容（answer区域或meta区域）
    const hasContent = answerEl.innerHTML.trim() !== '' || currentChatId !== null;

    if (hasContent) {
      statusIcon.textContent = 'chat_add_on'; // 有内容时：新建对话
      statusIcon.style.color = ''; // 确保重置颜色
      statusBtn.dataset.action = 'new';
      // 恢复保存开关为开启状态，以便下次默认保存
      isSaveEnabled = true; 
    } else {
      // 无内容时：控制是否保存
      statusIcon.textContent = 'comments_disabled';
      if (isSaveEnabled) {
        statusIcon.style.color = ''; // 默认颜色，表示"将保存"
        statusBtn.dataset.action = 'disable-save';
      } else {
        statusIcon.style.color = 'var(--button-active-bg)'; // 高亮表示"不保存"
        statusBtn.dataset.action = 'enable-save';
      }
    }
  }

  /**
   * 处理右上角状态按钮的点击事件
   * @private
   */
  function handleStatusButtonClick() {
    const action = document.getElementById('status-btn').dataset.action;
    
    switch (action) {
      case 'new':
        clearChat();
        break;
      case 'disable-save':
        isSaveEnabled = false;
        updateStatusIcon();
        break;
      case 'enable-save':
        isSaveEnabled = true;
        updateStatusIcon();
        break;
    }
  }
  
  /**
   * 清空当前聊天界面和状态
   * @private
   */
  function clearChat() {
    document.getElementById('question').value = '';
    document.getElementById('n1').value = '';
    document.getElementById('n2').value = '';
    document.getElementById('n3').value = '';
    document.querySelector('.page-header__title').textContent = 'AI小六壬';
    document.getElementById('output-meta').textContent = '';
    document.getElementById('output-answer').innerHTML = '';
    document.getElementById('output-reasoning').innerHTML = '';
    
    const reasoningSection = document.getElementById('reasoning-section');
    reasoningSection.classList.add('reasoning-section--hidden');
    // 移除激活状态，隐藏结果区的分割线
    document.querySelector('.results-area').classList.remove('results-area--active');
    
    // 清除历史列表中的选中状态
    const activeHistoryItem = document.querySelector('.history-item.is-active');
    if (activeHistoryItem) {
      activeHistoryItem.classList.remove('is-active');
    }

    currentChatId = null;
    isSaveEnabled = true; // 新聊天默认开启保存
    
    updateStatusIcon(); // 更新图标状态为"无内容"
    handleTextareaAutoResize(); // 重置输入框高度
  }

  /**
   * 初始化历史条目的滑动删除功能
   * @param {HTMLElement} itemEl - 历史条目元素
   * @param {number} recordId - 记录ID
   * @private
   */
  function initSwipeToDelete(itemEl, recordId) {
    let startX = 0;
    let currentX = 0;
    let isDragging = false;
    let startTime = 0;
    
    const contentEl = itemEl.querySelector('.history-item__content');
    const deleteBtn = itemEl.querySelector('.history-item__delete');
    const threshold = 50; // 触发滑动的最小距离
    
    // 重置滑动状态
    function resetSwipe() {
      itemEl.classList.remove('history-item--swiped');
      contentEl.style.transform = '';
    }
    
    // 处理滑动开始
    function handleStart(e) {
      // 如果已经有其他条目处于滑动状态，先重置它们
      document.querySelectorAll('.history-item--swiped').forEach(item => {
        if (item !== itemEl) {
          item.classList.remove('history-item--swiped');
          item.querySelector('.history-item__content').style.transform = '';
        }
      });
      
      isDragging = true;
      startTime = Date.now();
      startX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
      contentEl.style.transition = 'none';
    }
    
    // 处理滑动中
    function handleMove(e) {
      if (!isDragging) return;
      
      e.preventDefault();
      currentX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
      const deltaX = currentX - startX;
      
      // 只允许向左滑动
      if (deltaX < 0) {
        const translateX = Math.max(deltaX, -80);
        contentEl.style.transform = `translateX(${translateX}px)`;
      }
    }
    
    // 处理滑动结束/点击
    function handleEnd(e) {
      if (!isDragging) return;
      
      isDragging = false;
      contentEl.style.transition = '';
      
      const finalX = e.type.includes('mouse') ? e.clientX : (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : startX);
      const deltaX = finalX - startX;
      
      // 判断是点击还是滑动
      if (Math.abs(deltaX) < 10) {
        // --- 这是一次点击 ---
        // 立即重置任何可能的滑动状态，防止视觉残留
        contentEl.style.transform = '';
        contentEl.style.transition = 'none';
        
        // 确保在下一帧恢复过渡效果
        requestAnimationFrame(() => {
          contentEl.style.transition = '';
        });
        
        // 如果当前项已滑开，则重置它
        if(itemEl.classList.contains('history-item--swiped')) {
            resetSwipe();
        } else {
            // 否则，执行加载操作
            handleHistoryItemClick(recordId);
        }
        return;
      }
      
      // --- 这是一次滑动 ---
      const deltaTime = Date.now() - startTime;
      const velocity = Math.abs(deltaX) / deltaTime;
      
      // 根据滑动距离或速度决定是否显示删除按钮
      if ((deltaX < -threshold) || (velocity > 0.3 && deltaX < 0)) {
        itemEl.classList.add('history-item--swiped');
      } else {
        resetSwipe();
      }
    }
    
    // 处理删除
    async function handleDelete() {
      itemEl.classList.add('history-item--deleting');
      
      try {
        // 从数据库删除记录
        await deleteRecord(recordId);
        
        // 如果删除的是当前查看的记录，清空界面
        if (currentChatId === recordId) {
          clearChat();
        }
        
        // 动画结束后移除元素
        setTimeout(() => {
          itemEl.remove();
          
          // 检查是否还有记录
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
    
    // 绑定事件
    // 触摸事件
    contentEl.addEventListener('touchstart', handleStart, { passive: true });
    contentEl.addEventListener('touchmove', handleMove, { passive: false });
    contentEl.addEventListener('touchend', handleEnd);
    
    // 鼠标事件（用于开发测试）
    contentEl.addEventListener('mousedown', handleStart);
    // 注意：move 和 up 事件需要绑定在 document 上，以处理鼠标在元素外释放的情况
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleEnd);
    
    // 删除按钮点击
    deleteBtn.addEventListener('click', handleDelete);
  }

  // --- 搜索功能相关函数 ---

  /**
   * 处理搜索输入事件
   * @param {Event} e - 输入事件
   * @private
   */
  function handleSearchInput(e) {
    const keyword = e.target.value.trim();
    currentSearchKeyword = keyword;
    
    // 显示或隐藏清除按钮
    toggleSearchClearButton(keyword);
    
    // 使用防抖处理搜索
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
    }
    
    searchDebounceTimer = setTimeout(() => {
      performSearch(keyword);
    }, 300); // 300ms防抖延迟
  }

  /**
   * 执行搜索操作
   * @param {string} keyword - 搜索关键词
   * @private
   */
  async function performSearch(keyword) {
    try {
      await renderHistory(keyword);
    } catch (error) {
      console.error('搜索失败:', error);
      const listEl = document.getElementById('history-list');
      listEl.innerHTML = '<p style="text-align: center; color: var(--text-muted-color);">搜索时发生错误</p>';
    }
  }

  /**
   * 清除搜索内容
   * @private
   */
  function clearSearch() {
    const searchInput = document.getElementById('history-search-input');
    searchInput.value = '';
    currentSearchKeyword = '';
    toggleSearchClearButton('');
    
    // 清除防抖定时器
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }
    
    // 重新渲染所有历史记录
    renderHistory();
  }

  /**
   * 显示或隐藏搜索清除按钮
   * @param {string} value - 当前输入值
   * @private
   */
  function toggleSearchClearButton(value) {
    const clearBtn = document.getElementById('history-search-clear');
    if (value.length > 0) {
      clearBtn.classList.add('is-visible');
    } else {
      clearBtn.classList.remove('is-visible');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})(); 