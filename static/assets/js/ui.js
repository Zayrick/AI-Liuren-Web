/**
 * @file ui.js
 * @brief UI helper functions for the AI Divination app.
 *
 * This module contains functions for manipulating the DOM, handling UI events,
 * and managing visual components like loading states, panels, and dynamic layouts.
 */

'use strict';

/** @typedef {HTMLElement} HTMLElementAlias */

/**
 * 显示加载状态并更新文案。
 * @param {HTMLElementAlias} element 目标元素
 * @param {string} [text='处理中'] 文案前缀
 * @param {string} [type='default'] 加载类型：'thinking' | 'default'
 */
export function showLoading(element, text = '处理中', type = 'default') {
  if (!element) return;
  
  // 清除之前的内容和状态类
  element.classList.remove('loading', 'reasoning-thinking', 'processing');
  
  // 创建加载动画容器
  const loadingContainer = document.createElement('div');
  loadingContainer.className = 'loading-container';
  
  // 创建文本容器
  const textContainer = document.createElement('span');
  textContainer.className = 'loading-text';
  textContainer.textContent = text;
  
  // 组装结构
  loadingContainer.appendChild(textContainer);
  
  // 清空元素并添加新的加载内容
  element.innerHTML = '';
  element.appendChild(loadingContainer);
  
  // 添加相应的状态类
  element.classList.add('loading');
  if (type === 'thinking') {
    // 直接在元素本身添加统一的思考中动画类
    element.classList.add('reasoning-thinking');
  }
}

/**
 * 清除加载状态。
 * @param {HTMLElementAlias} element 目标元素
 */
export function clearLoading(element) {
  if (!element) return;
  element.classList.remove('loading', 'reasoning-thinking', 'processing');
  
  // 如果内容只是加载动画，清空内容
  const loadingContainer = element.querySelector('.loading-container');
  if (loadingContainer && loadingContainer.parentNode === element && element.children.length === 1) {
    element.innerHTML = '';
  }
}

/**
 * 切换 AI 设置面板显示/隐藏。
 * 由右侧齿轮按钮触发：展开时显示整个容器，折叠时完全隐藏。
 */
export function toggleAiSettings() {
  const container = document.querySelector('.ai-settings');
  const content = document.getElementById('ai-settings-content');
  const chevron = document.getElementById('chevron');

  if (!container || !content || !chevron) return;

  const isHidden = container.style.display === 'none' || getComputedStyle(container).display === 'none';
  if (isHidden) {
    container.style.display = 'block';
    content.classList.add('active');
    chevron.classList.add('rotated');
  } else {
    container.style.display = 'none';
    content.classList.remove('active');
    chevron.classList.remove('rotated');
  }
}

/**
 * 切换思考过程的折叠状态。
 */
export function toggleReasoningCollapse() {
  const reasoningSection = document.querySelector('.reasoning-section');
  if (!reasoningSection) return;
  reasoningSection.classList.toggle('collapsed');
}

/**
 * 更新思考过程标题文案。
 * @param {string} status 状态：'thinking' | 'completed'
 */
export function updateReasoningTitle(status) {
  const titleEl = document.getElementById('reasoning-title');
  if (!titleEl) return;
  
  const titleClasses = titleEl.classList;
  const reasoningBox = titleEl.closest('.reasoning-box');
  
  // 清除所有状态类
  titleClasses.remove('reasoning-thinking', 'reasoning-completed');
  if (reasoningBox) {
    reasoningBox.classList.remove('reasoning-thinking', 'reasoning-completed');
  }
  
  if (status === 'thinking') {
    // 为思考状态创建动画加载效果
    const loadingContainer = document.createElement('div');
    loadingContainer.className = 'loading-container';
    
    const textContainer = document.createElement('span');
    textContainer.className = 'loading-text';
    textContainer.textContent = '思考中';
    
    loadingContainer.appendChild(textContainer);
    
    titleEl.innerHTML = '';
    titleEl.appendChild(loadingContainer);
    titleClasses.add('reasoning-thinking');
    if (reasoningBox) {
      reasoningBox.classList.add('reasoning-thinking');
    }
  } else if (status === 'completed') {
    titleEl.textContent = '思考完成';
    titleClasses.add('reasoning-completed');
    if (reasoningBox) {
      reasoningBox.classList.add('reasoning-completed');
    }
  }
}

/**
 * 自动折叠思考过程（仅在思考完成后调用）。
 */
export function autoCollapseReasoning() {
  const reasoningSection = document.querySelector('.reasoning-section');
  if (!reasoningSection) return;
  
  // 立即收起思考过程，不延迟
  reasoningSection.classList.add('collapsed');
}

/**
 * 动态调整内容区域的内边距。
 */
export function adjustContentPadding() {
  const pageContainer = document.querySelector('.page-container');
  const pageContent = document.querySelector('.page-content');
  const pageHeader = document.querySelector('.page-header');
  const inputArea = document.querySelector('.input-area');

  if (!pageContainer || !pageContent || !pageHeader || !inputArea) return;

  const observer = new ResizeObserver(() => {
    if (window.getComputedStyle(pageContainer).display !== 'grid') {
      const headerHeight = pageHeader.getBoundingClientRect().height;
      const inputAreaHeight = inputArea.getBoundingClientRect().height;
      pageContent.style.paddingTop = `calc(${headerHeight}px + 1rem)`;
      pageContent.style.paddingBottom = `calc(${inputAreaHeight}px + env(safe-area-inset-bottom) + 1rem)`;
    } else {
      pageContent.style.paddingTop = '';
      pageContent.style.paddingBottom = '';
    }
  });

  observer.observe(pageHeader);
  observer.observe(inputArea);
}

/**
 * 实现文本域（textarea）高度根据内容自动调整的功能。
 */
export function handleTextareaAutoResize() {
  const textarea = document.getElementById('question');
  if (!textarea) return;

  const adjustHeight = () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  };

  textarea.addEventListener('input', adjustHeight);
  adjustHeight();
}

/**
 * 修复不符合 GFM 规范的 Markdown 标题。
 * @param {string} markdown
 * @returns {string}
 */
export function fixMarkdownHeadings(markdown) {
  return markdown.replace(/^(#+)([^ #\n\r])/gm, '$1 $2');
} 