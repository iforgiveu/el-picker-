// ============================================
// 元素选择器
// ============================================

// 状态管理
let currentState = 'a'; // 'a': 普通, 'b': 选择模式, 'd': 锁定模式

// 全局状态标记（供其他脚本检测）
window.__ELEMENT_PICKER_STATE = currentState;
window.__ELEMENT_PICKER_ACTIVE = false;

// UI元素
let overlay = null;
let tooltip = null;
let exitButton = null;

// 当前预览的元素
let previewElement = null;
let previewPath = [];
let previewIndex = 0;
let lastMouseX = 0, lastMouseY = 0;

// 锁定的元素
let lockedElement = null;
let lockedInfo = null;
let lockedPath = [];
let lockedIndex = 0;

// 拖动相关
let isDragging = false;
let isResizing = false;
let dragOffsetX = 0, dragOffsetY = 0;
let resizeStartX = 0, resizeStartY = 0;
let resizeStartWidth = 0, resizeStartHeight = 0;

// 动画帧ID
let updateOverlayRaf = null;

// 视口尺寸
let lastViewportWidth = window.innerWidth;
let lastViewportHeight = window.innerHeight;

// 悬浮窗尺寸限制
const MIN_WIDTH = 320;
const MIN_HEIGHT = 450;
const MAX_WIDTH = 900;
const MAX_HEIGHT = 900;

// ==================== Shadow DOM 深度查找 ====================

function findDeepestElementAtPoint(x, y, root = document, depth = 0) {
    try {
        let element = root.elementFromPoint(x, y);
        if (!element) return { element: null, depth: -1 };
        
        if (element.shadowRoot) {
            const deeper = findDeepestElementAtPoint(x, y, element.shadowRoot, depth + 1);
            if (deeper.element) {
                return deeper;
            }
        }
        
        return { element, depth };
    } catch (e) {
        return { element: null, depth: -1 };
    }
}

function deepElementFromPoint(x, y) {
    if (window.event && window.event.isTrusted === false) return null;
    
    try {
        const result = findDeepestElementAtPoint(x, y);
        return result.element;
    } catch (e) {
        return document.elementFromPoint(x, y);
    }
}

function getShadowDepth(element) {
    let depth = 0;
    let current = element;
    
    while (current) {
        try {
            const root = current.getRootNode();
            if (root instanceof ShadowRoot) {
                depth++;
                current = root.host;
            } else {
                break;
            }
        } catch (e) {
            break;
        }
    }
    
    return depth;
}

function getFullPath(element) {
    const path = [];
    let current = element;
    let visited = new Set();
    
    while (current && !visited.has(current)) {
        visited.add(current);
        path.push(current);
        
        try {
            const root = current.getRootNode();
            if (root instanceof ShadowRoot) {
                current = root.host;
            } else {
                current = current.parentElement;
            }
        } catch (e) {
            break;
        }
    }
    
    return path;
}

function getSiblings(element) {
    if (!element || !element.parentElement) return [];
    return Array.from(element.parentElement.children);
}

function getPreviousSibling(element) {
    if (!element || !element.parentElement) return null;
    const siblings = getSiblings(element);
    const index = siblings.indexOf(element);
    return index > 0 ? siblings[index - 1] : null;
}

function getNextSibling(element) {
    if (!element || !element.parentElement) return null;
    const siblings = getSiblings(element);
    const index = siblings.indexOf(element);
    return index < siblings.length - 1 ? siblings[index + 1] : null;
}

function getSiblingPosition(element) {
    if (!element || !element.parentElement) return { index: 1, total: 1 };
    
    const siblings = getSiblings(element);
    const index = siblings.indexOf(element) + 1;
    const total = siblings.length;
    
    return { index, total };
}

// ==================== UI 创建 ====================

function createUI() {
    overlay = document.createElement('div');
    overlay.id = 'element-picker-overlay';
    overlay.style.cssText = `
        position: fixed;
        pointer-events: none;
        z-index: 2147483646;
        border: 2px solid #3b82f6;
        background: rgba(59, 130, 246, 0.1);
        transition: all 0.1s ease;
        display: none;
    `;
    
    tooltip = document.createElement('div');
    tooltip.id = 'element-picker-tooltip';
    tooltip.style.cssText = `
        position: fixed;
        z-index: 2147483647;
        background: #1e293b;
        color: white;
        border-radius: 8px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', monospace;
        font-size: 12px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.3);
        border: 1px solid #4b5563;
        min-width: ${MIN_WIDTH}px;
        min-height: ${MIN_HEIGHT}px;
        max-width: ${MAX_WIDTH}px;
        max-height: ${MAX_HEIGHT}px;
        width: ${MIN_WIDTH}px;
        height: ${MIN_HEIGHT}px;
        pointer-events: auto !important;
        display: none;
        overflow: hidden;
        resize: none;
    `;
    
    exitButton = document.createElement('div');
    exitButton.id = 'element-picker-exit-btn';
    exitButton.style.cssText = `
        position: fixed;
        top: 20px;
        left: 20px;
        z-index: 2147483648;
        background: #ef4444;
        color: white;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        display: none;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        font-weight: bold;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        border: 2px solid white;
        transition: all 0.2s;
    `;
    exitButton.innerHTML = '×';
    exitButton.title = '退出选择模式 (ESC 或 `)';
    
    exitButton.addEventListener('click', (e) => {
        e.stopPropagation();
        handleExit();
    });
    
    document.documentElement.appendChild(overlay);
    document.documentElement.appendChild(tooltip);
    document.documentElement.appendChild(exitButton);
    
    window.addEventListener('scroll', handleScrollResize, { passive: true });
    window.addEventListener('resize', handleResize, { passive: true });
}

// ==================== 自定义调整大小 ====================

function initResizeHandles() {
    const oldHandles = document.querySelectorAll('.resize-handle');
    oldHandles.forEach(h => h.remove());
    
    const handles = ['nw', 'ne', 'sw', 'se'];
    handles.forEach(pos => {
        const handle = document.createElement('div');
        handle.className = `resize-handle resize-${pos}`;
        handle.style.cssText = `
            position: absolute;
            width: 16px;
            height: 16px;
            background: #4b5563;
            border: 2px solid #94a3b8;
            border-radius: 4px;
            z-index: 2147483648;
            cursor: ${pos}-resize;
            ${pos.includes('n') ? 'top: -2px;' : 'bottom: -2px;'}
            ${pos.includes('w') ? 'left: -2px;' : 'right: -2px;'}
        `;
        
        handle.addEventListener('mousedown', (e) => startResize(e, pos));
        tooltip.appendChild(handle);
    });
}

function startResize(e, position) {
    e.stopPropagation();
    e.preventDefault();
    
    isResizing = true;
    resizeStartX = e.clientX;
    resizeStartY = e.clientY;
    resizeStartWidth = tooltip.offsetWidth;
    resizeStartHeight = tooltip.offsetHeight;
    
    document.addEventListener('mousemove', onResize);
    document.addEventListener('mouseup', stopResize);
}

function onResize(e) {
    if (!isResizing) return;
    
    let newWidth = resizeStartWidth + (e.clientX - resizeStartX);
    let newHeight = resizeStartHeight + (e.clientY - resizeStartY);
    
    newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, newWidth));
    newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, newHeight));
    
    tooltip.style.width = newWidth + 'px';
    tooltip.style.height = newHeight + 'px';
    
    ensureTooltipInViewport();
}

function stopResize() {
    isResizing = false;
    document.removeEventListener('mousemove', onResize);
    document.removeEventListener('mouseup', stopResize);
}

// ==================== 祖先链 ====================

function getAncestorChain(element) {
    if (!element) return '';
    
    const path = getFullPath(element);
    let html = '<div style="margin: 12px 0; background: #2d3748; padding: 10px; border-radius: 6px;">';
    html += '<div style="color: #94a3b8; margin-bottom: 6px; font-weight: 500;">📋 祖先链 (共 ' + path.length + ' 级):</div>';
    
    for (let i = 0; i < path.length; i++) {
        const el = path[i];
        const tag = el.tagName ? el.tagName.toLowerCase() : 'unknown';
        const id = el.id ? `#${el.id}` : '';
        let classText = '';
        if (el.classList && el.classList.length > 0) {
            classText = '.' + Array.from(el.classList).slice(0, 2).join('.');
            if (el.classList.length > 2) classText += '…';
        }
        
        const shadowDepth = getShadowDepth(el);
        const isInShadow = shadowDepth > 0;
        const bgColor = i === 0 ? '#3b82f6' : `rgba(55, 65, 81, ${1 - i * 0.1})`;
        const shadowMark = isInShadow ? '⚡'.repeat(shadowDepth) + ' ' : '';
        
        html += `<div style="
            padding: 5px 10px;
            margin: 3px 0;
            background: ${bgColor};
            border-radius: 4px;
            font-size: 11px;
            display: flex;
            align-items: center;
            gap: 8px;
            border-left: 2px solid ${i === 0 ? '#fbbf24' : '#4b5563'};
        ">
            <span style="color: #94a3b8; min-width: 24px;">${i + 1}.</span>
            <span style="color: ${i === 0 ? 'white' : '#fbbf24'}; word-break: break-all; flex: 1;">
                ${shadowMark}${tag}${id}${classText}
            </span>
            ${i === 0 ? '<span style="color: #fbbf24; font-size: 10px;">当前元素</span>' : ''}
            ${isInShadow ? `<span style="color: #a5b4fc; font-size: 10px;">Shadow深度:${shadowDepth}</span>` : ''}
        </div>`;
    }
    
    html += '</div>';
    return html;
}

// ==================== 元素信息提取 ====================

function generateSelector(el) {
    if (!el) return '';
    
    try {
        if (el.id) return `#${el.id}`;
        
        if (el.classList && el.classList.length > 0) {
            return `${el.tagName.toLowerCase()}${Array.from(el.classList).map(c => `.${c}`).join('')}`;
        }
        
        return el.tagName.toLowerCase();
    } catch (e) {
        return '';
    }
}

function generateXPath(el) {
    if (!el) return '';
    
    try {
        if (el.id) {
            return `//*[@id="${el.id}"]`;  // 直接返回，不经过后面的逻辑
        }
        
        const parts = [];
        let current = el;
        
        while (current && current.nodeType === Node.ELEMENT_NODE) {
            // 如果遇到有id的元素
            if (current.id) {
                // 使用 //*[@id="..."] 格式
                parts.unshift(`//*[@id="${current.id}"]`);
                break;
            }
            
            // 普通元素处理...
            let part = current.tagName.toLowerCase();
            if (current.parentElement) {
                const siblings = Array.from(current.parentElement.children)
                    .filter(c => c.tagName === current.tagName);
                if (siblings.length > 1) {
                    const index = siblings.indexOf(current) + 1;
                    part += `[${index}]`;
                }
            }
            
            parts.unshift(part);
            current = current.parentElement;
        }
        
        // 判断返回格式
        if (parts[0] && parts[0].startsWith('//')) {
            // 如果第一个元素已经是 // 开头，直接拼接
            return parts.join('/');
        } else {
            // 否则返回绝对路径
            return '/' + parts.join('/');
        }
        
    } catch (e) {
        return '';
    }
}

function getElementInfo(el) {
    if (!el) return { tag: 'unknown' };
    
    try {
        const tag = el.tagName ? el.tagName.toLowerCase() : 'unknown';
        const id = el.id ? `#${el.id}` : '';
        
        let classList = [];
        if (el.classList && el.classList.length > 0) {
            classList = Array.from(el.classList);
        }
        
        const attributes = [];
        if (el.attributes) {
            for (let attr of el.attributes) {
                attributes.push({
                    name: attr.name,
                    value: attr.value
                });
            }
        }
        
        const shadowDepth = getShadowDepth(el);
        const isInShadow = shadowDepth > 0;
        
        let displayName = tag;
        if (id) displayName += id;
        if (classList.length > 0) {
            const shortClasses = classList.slice(0, 2).map(c => `.${c}`).join('');
            displayName += shortClasses;
            if (classList.length > 2) displayName += ` +${classList.length - 2}`;
        }
        
        if (isInShadow) {
            displayName = '⚡'.repeat(shadowDepth) + ' ' + displayName;
        }
        
        return {
            tag,
            id,
            classList,
            attributes,
            displayName,
            isInShadow,
            shadowDepth,
            innerText: el.innerText ? el.innerText.substring(0, 500) : '',
            childCount: el.children ? el.children.length : 0,
            cssSelector: generateSelector(el),
            xpath: generateXPath(el),
            siblingPos: getSiblingPosition(el),
            element: el
        };
    } catch (e) {
        return { tag: 'error', displayName: '获取信息失败' };
    }
}

// ==================== 控制台输出 ====================

function logElementInfo(el, type = 'locked') {
    if (!el) return;
    
    const info = getElementInfo(el);
    const prefix = type === 'locked' ? '🔒 已锁定元素' : '📍 定位元素';
    
    console.log(`%c${prefix}:`, 'background: #3b82f6; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold;', el);
    console.log(`%c📋 标签: ${info.tag}`, 'color: #94a3b8;');
    if (info.id) console.log(`%c📋 ID: ${info.id}`, 'color: #94a3b8;');
    if (info.classList.length > 0) console.log(`%c📋 类名: ${info.classList.join(' ')}`, 'color: #94a3b8;');
    console.log(`%c📋 子元素数: ${info.childCount}`, 'color: #94a3b8;');
    console.log(`%c📋 同级位次: ${info.siblingPos.index}/${info.siblingPos.total}`, 'color: #94a3b8;');
    if (info.isInShadow) console.log(`%c⚡ 位于 Shadow DOM 中 (深度: ${info.shadowDepth})`, 'color: #fbbf24;');
    if (info.cssSelector) console.log(`%c🔧 CSS选择器: ${info.cssSelector}`, 'color: #10b981;');
    if (info.xpath) console.log(`%c🔧 XPath: ${info.xpath}`, 'color: #10b981;');
    
    showNotification(`已输出元素信息到控制台`, 'success');
}

// ==================== 统一的锁定/解锁入口 ====================

function lockCurrentElement(source = 'keyboard') {
    if (currentState !== 'b' || !previewElement) {
        showNotification('没有可锁定的元素', 'info');
        return false;
    }
    
    console.log(`🔒 锁定元素 (来源: ${source})`);
    
    lockedElement = previewElement;
    lockedInfo = getElementInfo(lockedElement);
    lockedPath = getFullPath(lockedElement);
    lockedIndex = lockedPath.indexOf(lockedElement);
    if (lockedIndex === -1) lockedIndex = 0;
    
    currentState = 'd';
    window.__ELEMENT_PICKER_STATE = 'd';
    window.__ELEMENT_PICKER_ACTIVE = true;
    
    logElementInfo(lockedElement, 'locked');
    
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('wheel', handleWheel);
    
    updateOverlay(lockedElement);
    
    let rect = lockedElement.getBoundingClientRect();
    updateTooltip(lockedElement, lockedIndex, lockedPath.length, rect.right, rect.top, true);
    updateExitButton();
    
    showNotification('已锁定 - 使用Numpad0解锁，ESC退出', 'success');
    
    let event = new CustomEvent('element-picker-state-change', {
        detail: { 
            state: 'locked',
            source: source
        }
    });
    document.dispatchEvent(event);
	// ========== 新增：焦点检测和自动聚焦逻辑 ==========
    setTimeout(() => {
        if (currentState === 'd' && lockedElement) {
            // 检测焦点是否在锁定元素上
            const activeElement = document.activeElement;
            const isFocusInLockedElement = lockedElement.contains(activeElement);
            
            if (!isFocusInLockedElement) {
                console.log('🎯 自动聚焦到锁定元素');
                
                // 尝试聚焦元素
                try {
                    // 检查元素是否可以聚焦
                    const focusableElements = ['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT', 'A'];
                    
                    if (focusableElements.includes(lockedElement.tagName) ||
                        lockedElement.hasAttribute('tabindex') ||
                        lockedElement.isContentEditable) {
                        
                        // 元素本身可聚焦
                        lockedElement.focus();
                    } else {
                        // 查找元素内的可聚焦子元素
                        const focusableChild = lockedElement.querySelector(
                            'input, textarea, button, select, a, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'
                        );
                        
                        if (focusableChild) {
                            focusableChild.focus();
                        } else {
                            // 如果元素本身不可聚焦，设置tabindex使其可聚焦
                            lockedElement.setAttribute('tabindex', '-1');
                            lockedElement.focus();
                            
                            // 可选：移除tabindex以避免影响页面结构
                            // 但为了保持聚焦状态，可能需要保留
                        }
                    }
                    
                    // 可选：添加视觉提示
                    lockedElement.style.outline = '2px solid #10b981';
                    lockedElement.style.outlineOffset = '2px';
                    
                    // 恢复原有样式（可选）
                    setTimeout(() => {
                        if (lockedElement) {
                            lockedElement.style.outline = '';
                            lockedElement.style.outlineOffset = '';
                        }
                    }, 1000);
                    
                } catch (e) {
                    console.warn('自动聚焦失败:', e);
                }
            }
        }
    }, 500); // 500ms后检测，可以根据需要调整时间
    
    return true;
}

function unlockCurrentElement(source = 'keyboard') {
    if (currentState !== 'd' || !lockedElement) {
        showNotification('没有锁定的元素', 'info');
        return false;
    }
    
    console.log(`🔓 解锁元素 (来源: ${source})`);
    
    lockedElement = null;
    lockedInfo = null;
    lockedPath = [];
    lockedIndex = 0;
    currentState = 'b';
    window.__ELEMENT_PICKER_STATE = 'b';
    window.__ELEMENT_PICKER_ACTIVE = true;
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('wheel', handleWheel);
    
    if (previewElement) {
        updateOverlay(previewElement);
        updateTooltip(previewElement, previewIndex, previewPath.length, lastMouseX, lastMouseY, false);
    } else {
        overlay.style.display = 'none';
        tooltip.style.display = 'none';
    }
    
    updateExitButton();
    showNotification('返回选择模式', 'info');
    
    let event = new CustomEvent('element-picker-state-change', {
        detail: { 
            state: 'preview',
            source: source
        }
    });
    document.dispatchEvent(event);
    
    return true;
}

// ==================== 退出处理 ====================

function handleExit() {
    if (currentState === 'd') {
        unlockCurrentElement('exit');
    } else if (currentState === 'b') {
        exitSelectMode();
    }
    updateExitButton();
}

function updateExitButton() {
    if (!exitButton) return;
    exitButton.style.display = (currentState === 'b' || currentState === 'd') ? 'flex' : 'none';
}

// 封装生成AdGuard规则的函数
function generateAdGuardRules(attr){let rules=[];let host=window.location.hostname;let name=attr.name;let value=attr.value;if(!name||!value)
return rules;switch(name){case'class':if(value){let classes=value.split(/\s+/);classes.forEach(cls=>{if(cls.trim()){rules.push({rule:`${host}##.${cls}`,desc:`类名选择器: .${cls}`});}});rules.push({rule:`${host}##[class="${value}"]`,desc:`精确类名匹配: [class="${value}"]`});if(classes[0]){rules.push({rule:`${host}##[class*="${classes[0]}"]`,desc:`模糊类名匹配: [class*="${classes[0]}"]`});}}
break;case'id':rules.push({rule:`${host}##${value.startsWith('#') ? value : '#' + value}`,desc:`ID选择器: ${value.startsWith('#') ? value : '#' + value}`});break;case'href':case'src':if(value){let ext=value.split('.').pop();if(ext&&ext.length<10){rules.push({rule:`${host}##[${name}$=".${ext}"]`,desc:`${name}后缀匹配: [${name}$=".${ext}"]`});}
let prefix=value.substring(0,Math.min(20,value.length));rules.push({rule:`${host}##[${name}^="${prefix}"]`,desc:`${name}开头匹配: [${name}^="..."]`});}
break;case'role':case'type':case'aria-':rules.push({rule:`${host}##[${name}="${value}"]`,desc:`${name}选择器: [${name}="${value}"]`});break;default:if(name.startsWith('data-')){rules.push({rule:`${host}##[${name}="${value}"]`,desc:`数据属性: [${name}="${value}"]`});}else{rules.push({rule:`${host}##[${name}="${value}"]`,desc:`属性选择器: [${name}="${value}"]`});}}
return rules;}
// 在插件内容脚本中，显式挂载到window
function injectCopyScript(){const script=document.createElement('script');script.src=chrome.runtime.getURL('injectclipboard.js');script.onload=function(){this.remove();};document.documentElement.appendChild(script);}
injectCopyScript();

// ==================== 悬浮窗更新 ====================

function updateTooltip(el, index, total, mouseX, mouseY, isLocked) {
    if (!el) return;
    
    const info = getElementInfo(el);
    
    let attrsHtml = '<div style="max-height: 150px; overflow-y: auto; margin: 8px 0; background: #2d3748; padding: 8px; border-radius: 4px;">';
    if (info.attributes.length > 0) {
        info.attributes.slice(0, 10).forEach(attr => {
            let value = attr.value;
            if (value.length > 200) value = value.substring(0, 200) + '...';
			// 调用函数生成规则
			let adgRules = generateAdGuardRules(attr);

// 显示属性
attrsHtml += `<div style="margin-bottom: 6px; font-size: 11px; word-break: break-all; border-bottom: 1px solid #4a5568; padding-bottom: 4px;">
            <div style="margin-bottom: 2px;">
                <span style="color: #94a3b8;">${attr.name}:</span> 
                <span style="color: #fbbf24;">${escapeHtml(value)}</span>
            </div>`;
        // 显示对应的AdGuard规则和复制按钮
        if (adgRules.length > 0) {
            attrsHtml += '<div style="margin-left: 12px; margin-top: 4px;">';
            adgRules.forEach(rule => {
                attrsHtml += `
                    <div style="display: flex; align-items: center; margin-bottom: 3px; font-family: monospace; font-size: 10px; background: #1e293b; padding: 2px 4px; border-radius: 3px;">
                        <span style="color: #a5d6ff; flex: 1;">${rule.rule}</span>
                        <span style="color: #94a3b8; font-size: 9px; margin: 0 4px;">${rule.desc}</span>
						<button onclick='CopyAdgRuleToClipboard("${rule.rule.replace(/"/g, '\\"')}")' style="background: #4f46e5; color: white; border: none; border-radius: 3px; padding: 2px 6px; font-size: 9px; cursor: pointer; margin-left: 4px;" title="复制规则">复制</button>
                    </div>
                `;
            });
            attrsHtml += '</div>';
        }
        
        attrsHtml += '</div>';
    });
} else {
    attrsHtml += '<div style="color: #94a3b8;">无属性</div>';
}
attrsHtml += '</div>';


    
    let shadowHtml = '';
    if (info.isInShadow) {
        shadowHtml = `<div style="background: #312e81; color: #a5b4fc; padding: 6px 8px; border-radius: 4px; margin: 8px 0; font-size: 11px;">
            ⚡ 位于 Shadow DOM 中 (深度: ${info.shadowDepth})
        </div>`;
    }
    
    tooltip.innerHTML = `
        <div id="tooltip-header" style="padding: 10px 12px; cursor: move; background: #0f172a; border-bottom: 1px solid #334155; user-select: none;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="color: ${isLocked ? '#10b981' : '#3b82f6'}; font-weight: 600; font-size: 13px;">${info.displayName}</span>
                    <span style="background: #374151; padding: 2px 6px; border-radius: 12px; font-size: 10px;">${info.siblingPos.index}/${info.siblingPos.total}</span>
                </div>
                <span style="background: #374151; padding: 2px 8px; border-radius: 12px; font-size: 10px;">${index + 1}/${total}</span>
            </div>
        </div>
        
        <div style="padding: 12px; height: calc(100% - 80px); overflow-y: auto;">
            ${shadowHtml}
            
            <div style="background: #2d3748; padding: 8px; border-radius: 4px; margin: 8px 0;">
                <div><span style="color: #94a3b8;">标签:</span> <span style="color: #fbbf24;">${info.tag}</span></div>
                ${info.id ? `<div><span style="color: #94a3b8;">ID:</span> <span style="color: #fbbf24;">${info.id}</span></div>` : ''}
                <div><span style="color: #94a3b8;">类名数量:</span> <span style="color: #fbbf24;">${info.classList.length}</span></div>
                <div><span style="color: #94a3b8;">子元素数:</span> <span style="color: #fbbf24;">${info.childCount}</span></div>
                <div><span style="color: #94a3b8;">所在网址:</span> <span style="color: #fbbf24;">${window.location.href}</span></div>
            </div>
            
            <div style="margin: 8px 0;">
                <div style="color: #94a3b8; margin-bottom: 4px;">属性列表:</div>
                ${attrsHtml}
            </div>
            
            ${info.innerText ? `<div style="margin: 8px 0; background: #2d3748; padding: 8px; border-radius: 4px;">
                <div style="color: #94a3b8; margin-bottom: 4px;">文本内容:</div>
                <div style="color: #9ca3af; max-height: 60px; overflow-y: auto; font-size: 11px;">${escapeHtml(info.innerText)}</div>
            </div>` : ''}
            
            ${getAncestorChain(el)}
            
            ${info.cssSelector ? `<div style="background: #2d3748; padding: 8px; border-radius: 4px; margin: 8px 0;">
                <div style="color: #94a3b8; margin-bottom: 4px;">CSS选择器:</div>
                <div style="color: #fbbf24; font-size: 11px; word-break: break-all;">${escapeHtml(info.cssSelector)}</div>
            </div>` : ''}
            
            ${info.xpath ? `<div style="background: #2d3748; padding: 8px; border-radius: 4px; margin: 8px 0;">
                <div style="color: #94a3b8; margin-bottom: 4px;">XPath:</div>
                <div style="color: #fbbf24; font-size: 11px; word-break: break-all;">${escapeHtml(info.xpath)}</div>
            </div>` : ''}
            
            <div style="display: flex; gap: 8px; margin-top: 12px;">
                <button id="picker-locate" style="flex:1; background:#3b82f6; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer; font-size:12px; font-weight:500;">📍 定位 (输出到控制台)</button>
            </div>
            
            <div style="margin-top: 8px; font-size: 10px; color: #6b7280; text-align: center; background: #2d3748; padding: 6px; border-radius: 4px;">
                <div><kbd>+</kbd> 祖先 · <kbd>-</kbd> 后代</div>
                <div><kbd>/</kbd> 上一个同级 · <kbd>*</kbd> 下一个同级</div>
                <div><kbd>Numpad0</kbd> 锁定/解锁</div>
                <div><kbd>ESC</kbd> 或 <kbd>\`</kbd> 退出</div>
                ${info.isInShadow ? '<div style="color: #a5b4fc;">⚡ Shadow深度: ' + info.shadowDepth + '</div>' : ''}
            </div>
        </div>
    `;
    
    setTimeout(() => {
        const locateBtn = document.getElementById('picker-locate');
        const header = document.getElementById('tooltip-header');
        
        if (locateBtn) {
            locateBtn.onclick = (e) => {
                e.stopPropagation();
                logElementInfo(el, 'locate');
            };
        }
        
        if (header) {
            header.addEventListener('mousedown', startDrag);
        }
        
        initResizeHandles();
    }, 10);
    
    positionTooltip(mouseX, mouseY);
}

function positionTooltip(mouseX, mouseY) {
    if (!tooltip) return;
    
    tooltip.style.display = 'block';
    
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    
    tooltip.style.visibility = 'hidden';
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    tooltip.style.visibility = 'visible';
    
    let left = mouseX + 15;
    let top = mouseY + 15;
    
    if (left + width > vw) left = mouseX - width - 15;
    if (top + height > vh) top = mouseY - height - 15;
    
    left = Math.max(10, Math.min(left, vw - width - 10));
    top = Math.max(10, Math.min(top, vh - height - 10));
    
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
    
    lastViewportWidth = vw;
    lastViewportHeight = vh;
}

function startDrag(e) {
    if (e.button !== 0) return;
    isDragging = true;
    const rect = tooltip.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', stopDrag);
    e.preventDefault();
}

function onDrag(e) {
    if (!isDragging) return;
    
    let left = e.clientX - dragOffsetX;
    let top = e.clientY - dragOffsetY;
    
    left = Math.max(0, Math.min(left, window.innerWidth - tooltip.offsetWidth));
    top = Math.max(0, Math.min(top, window.innerHeight - tooltip.offsetHeight));
    
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
}

function stopDrag() {
    isDragging = false;
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup', stopDrag);
    ensureTooltipInViewport();
}

function handleResize() {
    if (lastViewportWidth !== window.innerWidth || lastViewportHeight !== window.innerHeight) {
        lastViewportWidth = window.innerWidth;
        lastViewportHeight = window.innerHeight;
        if (tooltip.style.display === 'block') ensureTooltipInViewport();
    }
    handleScrollResize();
}

function ensureTooltipInViewport() {
    if (!tooltip || tooltip.style.display !== 'block') return;
    
    const rect = tooltip.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    
    let left = rect.left;
    let top = rect.top;
    let changed = false;
    
    if (rect.right > vw) { left = vw - rect.width - 10; changed = true; }
    if (rect.bottom > vh) { top = vh - rect.height - 10; changed = true; }
    if (rect.left < 0) { left = 10; changed = true; }
    if (rect.top < 0) { top = 10; changed = true; }
    
    if (changed) {
        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
    }
}

function handleScrollResize() {
    if (updateOverlayRaf) cancelAnimationFrame(updateOverlayRaf);
    updateOverlayRaf = requestAnimationFrame(() => {
        if (currentState === 'd' && lockedElement) {
            updateOverlay(lockedElement);
        }
    });
}

function updateOverlay(el) {
    if (!el) {
        overlay.style.display = 'none';
        return;
    }
    
    const rect = el.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.left = rect.left + 'px';
    overlay.style.top = rect.top + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    
    overlay.style.borderColor = (currentState === 'd' && el === lockedElement) ? '#10b981' : '#3b82f6';
    overlay.style.backgroundColor = (currentState === 'd' && el === lockedElement) ? 'rgba(16, 185, 129, 0.1)' : 'rgba(59, 130, 246, 0.1)';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== 状态转换 ====================

function enterSelectMode() {
    if (currentState !== 'a') return;
    
    console.log('🎯 进入选择模式');
    currentState = 'b';
    window.__ELEMENT_PICKER_STATE = 'b';
    window.__ELEMENT_PICKER_ACTIVE = true;
    
    if (!overlay) createUI();
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('wheel', handleWheel, { passive: false });
    
    updateExitButton();
    showNotification('选择模式 - 移动鼠标预览，点击或Numpad0锁定', 'info');
    
    let event = new CustomEvent('element-picker-state-change', {
        detail: { state: 'preview', source: 'enter' }
    });
    document.dispatchEvent(event);
}

function exitSelectMode() {
    if (currentState !== 'b') return;
    
    console.log('🚪 退出选择模式');
    currentState = 'a';
    window.__ELEMENT_PICKER_STATE = 'a';
    window.__ELEMENT_PICKER_ACTIVE = false;
    
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('wheel', handleWheel);
    
    previewElement = null;
    overlay.style.display = 'none';
    tooltip.style.display = 'none';
    updateExitButton();
    
    let event = new CustomEvent('element-picker-state-change', {
        detail: { state: 'inactive', source: 'exit' }
    });
    document.dispatchEvent(event);
}

// ==================== 事件处理 ====================

function handleMouseMove(e) {
    if (e.isTrusted === false) return;
    if (currentState !== 'b') return;
    
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    
    const element = deepElementFromPoint(e.clientX, e.clientY);
    if (!element) return;
    
    if (element === previewElement) return;
    
    previewPath = getFullPath(element);
    previewIndex = 0;
    previewElement = previewPath[previewIndex];
    
    updateOverlay(previewElement);
    updateTooltip(previewElement, previewIndex, previewPath.length, e.clientX, e.clientY, false);
}

function handleWheel(e) {
    if (e.isTrusted === false) return;
    if (currentState !== 'b' || !previewElement) return;
    
    if (e.deltaY < 0) {
        if (previewIndex < previewPath.length - 1) {
            previewIndex++;
            previewElement = previewPath[previewIndex];
        }
    } else {
        if (previewIndex > 0) {
            previewIndex--;
            previewElement = previewPath[previewIndex];
        }
    }
    
    updateOverlay(previewElement);
    updateTooltip(previewElement, previewIndex, previewPath.length, lastMouseX, lastMouseY, false);
    e.preventDefault();
}

function handleClick(e) {
    if (e.isTrusted === false) return;
    
    if (e.target.closest && (
        e.target.closest('#element-picker-tooltip') ||
        e.target.closest('#element-picker-exit-btn')
    )) {
        return;
    }
    
    if (currentState === 'd') {
        e.preventDefault();
        e.stopPropagation();
        showNotification('锁定状态，请按Numpad0解锁或ESC退出', 'info');
        return;
    }
    
    if (currentState === 'b' && previewElement) {
        e.preventDefault();
        e.stopPropagation();
        lockCurrentElement('mouse');
    }
}

function handleKeyDown(e) {
    if (!(currentState === 'b' || currentState === 'd')) return;
	if (e.isTrusted === false) return;
    
    if (e.key === 'Escape' || e.key === '`' || e.key === 'Backquote') {
        e.preventDefault();
        if (currentState === 'd') {
            unlockCurrentElement('keyboard');
        } else if (currentState === 'b') {
            exitSelectMode();
        }
        return;
    }
    
    if (e.code === 'Numpad0') {
        e.preventDefault();
        e.stopPropagation();
        
        if (currentState === 'b' && previewElement) {
            lockCurrentElement('keyboard');
        } else if (currentState === 'd') {
            unlockCurrentElement('keyboard');
        }
        return;
    }
    
    if (currentState === 'd' && lockedElement && lockedPath.length > 0) {
        if (e.key === '+' || e.key === '=') {
            e.preventDefault();
            if (lockedIndex < lockedPath.length - 1) {
                lockedIndex++;
                lockedElement = lockedPath[lockedIndex];
                lockedInfo = getElementInfo(lockedElement);
                updateOverlay(lockedElement);
                let rect = lockedElement.getBoundingClientRect();
                updateTooltip(lockedElement, lockedIndex, lockedPath.length, rect.right, rect.top, true);
            }
        } else if (e.key === '-' || e.key === '_') {
            e.preventDefault();
            if (lockedIndex > 0) {
                lockedIndex--;
                lockedElement = lockedPath[lockedIndex];
                lockedInfo = getElementInfo(lockedElement);
                updateOverlay(lockedElement);
                let rect = lockedElement.getBoundingClientRect();
                updateTooltip(lockedElement, lockedIndex, lockedPath.length, rect.right, rect.top, true);
            }
        } else if (e.key === '/') {
            e.preventDefault();
            let prev = getPreviousSibling(lockedElement);
            if (prev) {
                lockedElement = prev;
                lockedInfo = getElementInfo(prev);
                lockedPath = getFullPath(prev);
                lockedIndex = lockedPath.indexOf(prev);
                updateOverlay(prev);
                let rect = prev.getBoundingClientRect();
                updateTooltip(prev, lockedIndex, lockedPath.length, rect.right, rect.top, true);
            }
        } else if (e.key === '*') {
            e.preventDefault();
            let next = getNextSibling(lockedElement);
            if (next) {
                lockedElement = next;
                lockedInfo = getElementInfo(next);
                lockedPath = getFullPath(next);
                lockedIndex = lockedPath.indexOf(next);
                updateOverlay(next);
                let rect = next.getBoundingClientRect();
                updateTooltip(next, lockedIndex, lockedPath.length, rect.right, rect.top, true);
            }
        }
    }
    
    if (currentState === 'b' && previewElement && previewPath.length > 0) {
        if (e.key === '+' || e.key === '=') {
            e.preventDefault();
            if (previewIndex < previewPath.length - 1) {
                previewIndex++;
                previewElement = previewPath[previewIndex];
                updateOverlay(previewElement);
                updateTooltip(previewElement, previewIndex, previewPath.length, lastMouseX, lastMouseY, false);
            }
        } else if (e.key === '-' || e.key === '_') {
            e.preventDefault();
            if (previewIndex > 0) {
                previewIndex--;
                previewElement = previewPath[previewIndex];
                updateOverlay(previewElement);
                updateTooltip(previewElement, previewIndex, previewPath.length, lastMouseX, lastMouseY, false);
            }
        } else if (e.key === '/') {
            e.preventDefault();
            let prev = getPreviousSibling(previewElement);
            if (prev) {
                previewElement = prev;
                previewPath = getFullPath(prev);
                previewIndex = previewPath.indexOf(prev);
                updateOverlay(prev);
                updateTooltip(prev, previewIndex, previewPath.length, lastMouseX, lastMouseY, false);
            }
        } else if (e.key === '*') {
            e.preventDefault();
            let next = getNextSibling(previewElement);
            if (next) {
                previewElement = next;
                previewPath = getFullPath(next);
                previewIndex = previewPath.indexOf(next);
                updateOverlay(next);
                updateTooltip(next, previewIndex, previewPath.length, lastMouseX, lastMouseY, false);
            }
        }
    }
}

function showNotification(message, type = 'info') {
    const notif = document.createElement('div');
    notif.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: ${type === 'success' ? '#10b981' : '#3b82f6'};
        color: white;
        padding: 8px 16px;
        border-radius: 4px;
        font-size: 12px;
        z-index: 2147483647;
        animation: slideIn 0.3s;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        pointer-events: none;
    `;
    notif.textContent = message;
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 2000);
}

// ==================== 键盘监听 ====================

document.addEventListener('keydown', handleKeyDown, true);

// ==================== 消息监听 ====================

chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "ACTIVATE_PICKER") {
        if (currentState === 'a') {
            enterSelectMode();
        } else if (currentState === 'd') {
            unlockCurrentElement('extension');  // 直接调用新函数
        } else if (currentState === 'b') {
            exitSelectMode();
        }
    } else if (request.action === "UNSELECT") {
        handleExit();
    }
});

// 清理资源
window.addEventListener('beforeunload', () => {
    if (updateOverlayRaf) cancelAnimationFrame(updateOverlayRaf);
    document.removeEventListener('keydown', handleKeyDown, true);
});

// 添加样式
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    kbd { background: #374151; padding: 2px 6px; border-radius: 4px; font-size: 10px; border: 1px solid #4b5563; }
    #element-picker-tooltip button:hover { opacity: 0.9; }
    #element-picker-tooltip::-webkit-scrollbar { width: 6px; background: #2d3748; }
    #element-picker-tooltip::-webkit-scrollbar-thumb { background: #4b5563; border-radius: 3px; }
`;
document.head.appendChild(style);

// 初始化
createUI();
console.log('✅ 元素选择器已加载');
