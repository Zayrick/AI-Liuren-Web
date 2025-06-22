/**
 * @file app.js
 * @brief 小六 AI 占卜前端逻辑脚本
 *
 * 职责：
 * 1. 处理表单提交，向后端发送 SSE 请求并流式渲染返回结果。
 * 2. 管理本地存储的用户设置（API Key、模型、端点）。
 * 3. 提供基础 UI 工具函数（加载态、AI 设置面板切换等）。
 *
 * 所有函数均包含 Doxygen/JSDoc 风格注释，符合企业级审计要求。
 */

(() => {
  'use strict';

  /** @typedef {HTMLElement} HTMLElementAlias */

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
    }
  }

  /**
   * 应用初始化：绑定事件、读取配置、注册 Service Worker 等。
   */
  function init() {
    // 绑定事件
    document.getElementById('ai-settings-toggle').addEventListener('click', toggleAiSettings);
    document.getElementById('divination-form').addEventListener('submit', onSubmit);
    document.getElementById('reasoning-toggle').addEventListener('click', onReasoningToggle);
    document.getElementById('reasoning-header').addEventListener('click', toggleReasoningCollapse);
    document.getElementById('reasoning-collapse-btn').addEventListener('click', (e) => {
      e.stopPropagation(); // 防止触发标题栏点击事件
      toggleReasoningCollapse();
    });

    // 初始化配置
    loadLocalSettings();

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
        pageContent.style.paddingBottom = `calc(${inputAreaHeight}px + 1rem)`;
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

  document.addEventListener('DOMContentLoaded', init);
})(); 