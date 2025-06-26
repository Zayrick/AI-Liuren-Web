/**
 * @file app.js
 * @brief 小六 AI 占卜前端逻辑主脚本
 *
 * 职责：
 * 1. 初始化所有模块 (UI, 历史记录, 数据库)。
 * 2. 管理核心应用状态 (当前会话 ID, 保存开关等)。
 * 3. 处理表单提交，向后端发送 SSE 请求并流式渲染返回结果。
 * 4. 提供占卜会话的保存、加载和清空功能。
 *
 * 所有函数均包含 Doxygen/JSDoc 风格注释，符合企业级审计要求。
 */
import { initDB, addRecord } from './db.js';
import { generateHexagram } from './hexagram.js';
import { getFullBazi } from './ganzhi.js';
import { initHistory, setCurrentChatId, toggleHistoryPanel } from './history.js';
import {
  showLoading,
  clearLoading,
  toggleAiSettings,
  adjustContentPadding,
  handleTextareaAutoResize,
  toggleReasoningCollapse,
  updateReasoningTitle,
  autoCollapseReasoning,
  fixMarkdownHeadings,
  updateReasoningPreviewIfCollapsed,
  clearReasoningPreview
} from './ui.js';

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
    /** @type {HTMLSelectElement} */
    const openrouterSortSelect = document.getElementById('openrouterSort');

    apiKeyInput.value = localStorage.getItem('divination_api_key') || '';
    aiModelInput.value = localStorage.getItem('divination_ai_model') || '';
    aiEndpointInput.value = localStorage.getItem('divination_ai_endpoint') || '';
    openrouterSortSelect.value = localStorage.getItem('divination_openrouter_sort') || '';
    
    // 检查是否需要显示OpenRouter排序选项
    const endpoint = aiEndpointInput.value.toLowerCase();
    if (endpoint.includes('openrouter')) {
      openrouterSortSelect.style.display = 'block';
    } else {
      openrouterSortSelect.style.display = 'none';
    }
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
   * 表单提交事件处理。
   * @param {SubmitEvent} e 事件对象
   * @private
   */
  async function onSubmit(e) {
    e.preventDefault();

    // ---------------- 输入校验：API Key 与模型/端点的依赖关系 ----------------
    const apiKeyInputField = document.getElementById('apiKey');
    const aiModelInputField = document.getElementById('aiModel');
    const aiEndpointInputField = document.getElementById('aiEndpoint');

    const apiKeyVal = apiKeyInputField.value.trim();
    const modelVal = aiModelInputField.value.trim();
    const endpointVal = aiEndpointInputField.value.trim();
    const openrouterSortVal = document.getElementById('openrouterSort').value.trim();

    // 若用户填写了模型或端点（任意一个），则必须同时提供 API Key
    if (!apiKeyVal && (modelVal || endpointVal)) {
      // 使用浏览器原生校验提示：设置 validity 并聚焦 API Key 输入框
      apiKeyInputField.setCustomValidity('如指定模型或 API 地址，则必须填写 API Key。');
      apiKeyInputField.reportValidity();
      apiKeyInputField.focus();
      return;
    } else {
      // 清除自定义校验信息，避免后续无法提交
      apiKeyInputField.setCustomValidity('');
    }
    
    // 特别验证：如果使用OpenRouter且选择了排序选项，必须有API Key
    if (endpointVal.toLowerCase().includes('openrouter') && openrouterSortVal && !apiKeyVal) {
      apiKeyInputField.setCustomValidity('使用 OpenRouter 排序功能必须配置 API Key。');
      apiKeyInputField.reportValidity();
      apiKeyInputField.focus();
      return;
    }

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

    // **本地生成卦象和时间信息，立即显示给用户**
    const now = new Date(); // 直接使用客户端本地时间
    const fullBazi = getFullBazi(now);
    const hexagram = generateHexagram(numbers);
    
    // 立即显示卦象信息，减少用户等待感知
    metaEl.textContent = `所问之事：${question}\n所得之卦：${hexagram}\n所占之时：${fullBazi}`;
    clearLoading(metaEl);

    showLoading(reasoningEl, '等待响应中', 'thinking');
    showLoading(answerEl, '等待响应中', 'thinking');

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
    let isReasoningStarted = false; // 跟踪思考过程是否已开始
    let hasReasoningCompleted = false; // 跟踪思考过程是否已完成
    // ---

    // 切换为停止状态，并绑定一次性停止处理器
    switchToStopState();
    toggleBtn.classList.add('button--processing');

    const stopHandler = (evt) => {
      evt.preventDefault();
      controller.abort();
      toggleBtn.disabled = true;
      toggleBtn.classList.remove('button--processing');
    };
    toggleBtn.addEventListener('click', stopHandler, { once: true });

    // 读取用户配置
    const apiKeyInput = document.getElementById('apiKey');
    const aiModelInput = document.getElementById('aiModel');
    const aiEndpointInput = document.getElementById('aiEndpoint');
    const openrouterSortSelect = document.getElementById('openrouterSort');

    const apiKey = apiKeyInput.value.trim();
    const model = aiModelInput.value.trim();
    const endpoint = aiEndpointInput.value.trim();
    const openrouterSort = openrouterSortSelect.value.trim();

    // 持久化到 localStorage
    localStorage.setItem('divination_api_key', apiKey);
    localStorage.setItem('divination_ai_model', model);
    localStorage.setItem('divination_ai_endpoint', endpoint);
    localStorage.setItem('divination_openrouter_sort', openrouterSort);

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
          openrouterSort,
          hexagram,  // 添加本地生成的卦象
          fullBazi   // 添加本地生成的时间信息
        })
      });

      if (!resp.ok || !resp.body) {
        metaEl.textContent = `请求失败：${resp.status} ${resp.statusText}`;
        clearLoading(reasoningEl);
        clearLoading(answerEl);
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

              // 首次收到 reasoning 数据时，移除隐藏类并清除等待状态
              if (reasoningSection.classList.contains('reasoning-section--hidden')) {
                reasoningSection.classList.remove('reasoning-section--hidden');
                clearLoading(reasoningEl);
                clearLoading(answerEl); // 开始思考后清除答案区域的等待状态
                updateReasoningTitle('thinking');
                // 确保思考过程展开显示
                document.querySelector('.reasoning-section').classList.remove('collapsed');
                isReasoningStarted = true;
              }
              reasoningMarkdown += dataStr.replace(/\\n/g, '\n');
              const fixedReasoning = fixMarkdownHeadings(reasoningMarkdown);
              reasoningEl.innerHTML = DOMPurify.sanitize(marked.parse(fixedReasoning));
              updateReasoningPreviewIfCollapsed(); // 更新预览
              break;
            }
            case 'answer': {
              // 首次进入answer流时，如果思考过程已开始且尚未标记完成，则立即标记完成
              if (isReasoningStarted && !hasReasoningCompleted) {
                updateReasoningTitle('completed');
                autoCollapseReasoning();
                hasReasoningCompleted = true;
              }

              if (answerEl.classList.contains('loading')) {
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
      toggleBtn.classList.remove('button--processing');
      switchToStartState();
      
      // 恢复右上角状态按钮为可用
      statusBtn.disabled = false;

      // 如果思考过程已经开始，但在 stream 结束时仍未标记为完成，则在此处最终标记
      if (isReasoningStarted && !hasReasoningCompleted) {
        updateReasoningTitle('completed');
        autoCollapseReasoning();
      }

      // 占卜结束后，处理记录保存和状态更新
      if (finalAnswer.trim()) {
        if(isSaveEnabled) {
          // 获取渲染后的 HTML 内容
          const renderedAnswer = answerEl.innerHTML;
          const renderedReasoning = reasoningEl.innerHTML;
          await saveCurrentDivination(finalTitle, renderedAnswer, metaEl.textContent, renderedReasoning);
        }
        updateStatusIcon();
      }
    }
  }

  /**
   * 应用初始化：绑定事件、读取配置、注册 Service Worker 等。
   */
  async function init() {
    // 绑定核心事件
    document.getElementById('ai-settings-toggle').addEventListener('click', toggleAiSettings);
    document.getElementById('divination-form').addEventListener('submit', onSubmit);
    document.getElementById('reasoning-toggle').addEventListener('click', onReasoningToggle);
    document.getElementById('reasoning-header').addEventListener('click', toggleReasoningCollapse);
    document.getElementById('reasoning-collapse-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleReasoningCollapse();
    });
    document.getElementById('status-btn').addEventListener('click', handleStatusButtonClick);
    
    // 监听AI端点输入变化
    document.getElementById('aiEndpoint').addEventListener('input', (e) => {
      const endpoint = e.target.value.toLowerCase();
      const openrouterSortSelect = document.getElementById('openrouterSort');
      if (endpoint.includes('openrouter')) {
        openrouterSortSelect.style.display = 'block';
      } else {
        openrouterSortSelect.style.display = 'none';
      }
    });
    
    // 初始化历史记录模块
    initHistory({
      onItemClick: loadChat,
      onItemDelete: (deletedId) => {
        if (currentChatId === deletedId) {
          clearChat();
        }
      },
      onPanelClose: clearChat,
    });

    // 初始化配置
    loadLocalSettings();
    
    // 初始化数据库
    try {
      await initDB();
    } catch (error) {
      console.error("数据库初始化失败，历史记录功能将不可用。", error);
    }
    
    // 初始化UI状态
    updateStatusIcon();
    document.getElementById('reasoning-section').classList.add('reasoning-section--hidden');
    document.querySelector('.reasoning-section').classList.remove('collapsed');

    // 注册 Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js');
    }

    // 禁用旧的 AI 设置标题点击指针样式
    const headerEl = document.getElementById('ai-settings-header');
    headerEl.style.cursor = 'default';

    // 初始化动态UI调整
    adjustContentPadding();
    handleTextareaAutoResize();
  }

  /**
   * 从历史记录中加载一个会话
   * @param {object} record - 从数据库获取的记录对象
   */
  function loadChat(record) {
    if (!record) return;

    clearChat();

    document.querySelector('.page-header__title').textContent = record.title;
    document.getElementById('output-meta').textContent = record.meta;
    const answerEl = document.getElementById('output-answer');
    
    const isHTML = (str) => /<[^>]*>/.test(str);
    
    if (record.result) {
      if (isHTML(record.result)) {
        answerEl.innerHTML = DOMPurify.sanitize(record.result);
      } else {
        answerEl.innerHTML = DOMPurify.sanitize(marked.parse(record.result));
      }
    }
    
    const reasoningEl = document.getElementById('output-reasoning');
    const reasoningSection = document.getElementById('reasoning-section');
    
    if (record.reasoning && record.reasoning.trim()) {
      reasoningSection.classList.remove('reasoning-section--hidden');
      if (isHTML(record.reasoning)) {
        reasoningEl.innerHTML = DOMPurify.sanitize(record.reasoning);
      } else {
        reasoningEl.innerHTML = DOMPurify.sanitize(marked.parse(record.reasoning));
      }
      updateReasoningTitle('completed');
      // 手动折叠并更新预览（如果需要）
      const reasoningDOM = document.querySelector('.reasoning-section');
      reasoningDOM.classList.add('collapsed');
      // 使用公开的 Helper 函数安全更新预览
      updateReasoningPreviewIfCollapsed();
    } else {
      reasoningSection.classList.add('reasoning-section--hidden');
    }
    
    document.querySelector('.results-area').classList.add('results-area--active');
    
    currentChatId = record.id;
    setCurrentChatId(record.id);
    
    updateStatusIcon();
  }

  /**
   * 保存当前占卜结果到数据库
   * @param {string} title - AI生成的标题
   * @param {string} result - AI生成的完整回复（HTML格式）
   * @param {string} meta - 卦象元数据
   * @param {string} reasoning - AI的思考过程内容（HTML格式）
   */
  async function saveCurrentDivination(title, result, meta, reasoning = '') {
    const record = {
      title,
      result,
      meta,
      reasoning,
      timestamp: Date.now()
    };
    try {
      const newId = await addRecord(record);
      currentChatId = newId;
      setCurrentChatId(newId);
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

    const hasContent = answerEl.innerHTML.trim() !== '' || currentChatId !== null;

    if (hasContent) {
      statusIcon.textContent = 'chat_add_on';
      statusIcon.style.color = '';
      statusBtn.dataset.action = 'new';
      isSaveEnabled = true; 
    } else {
      statusIcon.textContent = 'comments_disabled';
      if (isSaveEnabled) {
        statusIcon.style.color = '';
        statusBtn.dataset.action = 'disable-save';
      } else {
        statusIcon.style.color = 'var(--button-active-bg)';
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
    document.querySelector('.page-header__title').textContent = '云占小六壬';
    
    const metaEl = document.getElementById('output-meta');
    const answerEl = document.getElementById('output-answer');
    const reasoningEl = document.getElementById('output-reasoning');
    
    metaEl.textContent = '';
    answerEl.innerHTML = '';
    reasoningEl.innerHTML = '';
    
    clearLoading(metaEl);
    clearLoading(answerEl);
    clearLoading(reasoningEl);
    
    const reasoningSection = document.getElementById('reasoning-section');
    reasoningSection.classList.add('reasoning-section--hidden');
    document.querySelector('.results-area').classList.remove('results-area--active');
    
    const activeHistoryItem = document.querySelector('.history-item.is-active');
    if (activeHistoryItem) {
      activeHistoryItem.classList.remove('is-active');
    }

    currentChatId = null;
    setCurrentChatId(null);
    isSaveEnabled = true;
    
    updateStatusIcon();
    handleTextareaAutoResize();
  }

  document.addEventListener('DOMContentLoaded', init);
})(); 