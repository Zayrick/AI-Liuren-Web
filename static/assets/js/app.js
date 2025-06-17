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
   * 切换 AI 设置面板展开/收起。
   * @param {MouseEvent} [evt] 点击事件对象
   */
  function toggleAiSettings(evt) {
    const content = document.getElementById('ai-settings-content');
    const chevron = document.getElementById('chevron');
    const isActive = content.classList.contains('active');
    if (isActive) {
      content.classList.remove('active');
      chevron.classList.remove('rotated');
    } else {
      content.classList.add('active');
      chevron.classList.add('rotated');
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
   * Reasoning 复选框切换事件处理。
   * @param {Event} e 事件对象
   * @private
   */
  function onReasoningSwitch(e) {
    const checkbox = /** @type {HTMLInputElement} */ (e.target);
    const reasoningEl = document.getElementById('output-reasoning');
    if (!checkbox.checked) {
      reasoningEl.parentElement.style.display = 'none';
    } else if (reasoningEl.textContent.trim()) {
      reasoningEl.parentElement.style.display = 'block';
    }
  }

  /**
   * 表单提交事件处理。
   * @param {SubmitEvent} e 事件对象
   * @private
   */
  async function onSubmit(e) {
    e.preventDefault();

    const numbers = [
      parseInt(document.getElementById('n1').value, 10),
      parseInt(document.getElementById('n2').value, 10),
      parseInt(document.getElementById('n3').value, 10)
    ];
    const question = document.getElementById('question').value.trim();
    const showReasoning = document.getElementById('reasoning').checked;

    const metaEl = document.getElementById('output-meta');
    const reasoningEl = document.getElementById('output-reasoning');
    const answerEl = document.getElementById('output-answer');

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
      toggleBtn.textContent = '停止';
      toggleBtn.type = 'button';
      toggleBtn.classList.remove('btn-primary');
      toggleBtn.classList.add('btn-secondary');
      toggleBtn.disabled = false;
    };

    /**
     * 将按钮状态切换回"开始占卜"。
     */
    const switchToStartState = () => {
      toggleBtn.textContent = '开始占卜';
      toggleBtn.type = 'submit';
      toggleBtn.classList.remove('btn-secondary');
      toggleBtn.classList.add('btn-primary');
      toggleBtn.disabled = false;
    };

    // 切换为停止状态，并绑定一次性停止处理器
    switchToStopState();

    const stopHandler = () => {
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

      // 初始隐藏推理面板，只有在收到事件后且用户仍允许时再展示
      reasoningEl.parentElement.style.display = 'none';

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
              if (!document.getElementById('reasoning').checked) break;

              if (reasoningEl.parentElement.style.display === 'none') {
                reasoningEl.parentElement.style.display = 'block';
                clearLoading(reasoningEl);
                reasoningEl.textContent = '';
              }
              reasoningEl.textContent += dataStr.replace(/\\n/g, '\n');
              break;
            }
            case 'answer': {
              if (answerEl.classList.contains('loading')) {
                clearLoading(answerEl);
                answerEl.textContent = '';
              }
              answerEl.textContent += dataStr.replace(/\\n/g, '\n');
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
    document.getElementById('ai-settings-header').addEventListener('click', toggleAiSettings);
    document.getElementById('divination-form').addEventListener('submit', onSubmit);
    document.getElementById('reasoning').addEventListener('change', onReasoningSwitch);

    // 初始化配置
    loadLocalSettings();

    // 默认隐藏推理过程容器
    document.getElementById('output-reasoning').parentElement.style.display = 'none';

    // 注册 Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js');
    }

    // 防止缓存：自动附加时间戳
    if (!window.location.search.includes('_t=')) {
      const sep = window.location.search ? '&' : '?';
      window.location.href = `${window.location.href}${sep}_t=${Date.now()}`;
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})(); 