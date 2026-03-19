// background.js
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "smart-element-picker",
    title: "🔍 智能选择元素",
    contexts: ["page"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "smart-element-picker") {
    activatePicker(tab.id);
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "activate-picker") {
    activatePicker(tab.id);
  }
});

// 处理元素定位请求
chrome.runtime.onMessage.addListener((request, sender) => {
  if (request.action === "INSPECT_ELEMENT" && sender.tab) {
    inspectElement(sender.tab.id, request);
  }
});

function activatePicker(tabId) {
  chrome.tabs.sendMessage(tabId, { action: "ACTIVATE_PICKER" }).catch(() => {
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ["content.js"]
    }).then(() => {
      chrome.tabs.sendMessage(tabId, { action: "ACTIVATE_PICKER" });
    });
  });
}

// 真正的DevTools定位函数
function inspectElement(tabId, elementInfo) {
  // 首先确保devtools打开
  chrome.debugger.attach({ tabId: tabId }, "1.3", () => {
    if (chrome.runtime.lastError) {
      console.log("DevTools可能已打开，尝试直接定位");
      // 如果debugger无法附加，尝试使用其他方法
      tryAlternativeInspect(tabId, elementInfo);
      return;
    }
    
    // 启用DOM调试
    chrome.debugger.sendCommand({ tabId: tabId }, "DOM.enable", {}, () => {
      // 查找元素
      let query;
      if (elementInfo.selector) {
        query = { selector: elementInfo.selector };
      } else {
        query = { selector: elementInfo.tagName };
      }
      
      chrome.debugger.sendCommand({ tabId: tabId }, "DOM.querySelector", {
        nodeId: 0, // document
        selector: query.selector
      }, (result) => {
        if (result && result.nodeId) {
          // 定位到元素
          chrome.debugger.sendCommand({ tabId: tabId }, "DOM.highlightNode", {
            nodeId: result.nodeId,
            highlightConfig: {
              contentColor: { r: 16, g: 185, b: 129, a: 0.3 },
              borderColor: { r: 16, g: 185, b: 129, a: 0.8 },
              showInfo: true
            }
          });
          
          // 滚动到元素
          chrome.debugger.sendCommand({ tabId: tabId }, "DOM.scrollIntoViewIfNeeded", {
            nodeId: result.nodeId
          });
          
          // 打开Elements面板
          chrome.debugger.sendCommand({ tabId: tabId }, "Runtime.evaluate", {
            expression: `setTimeout(() => {
              if (window.inspect) inspect(document.querySelector('${query.selector}'));
            }, 100)`
          });
        }
        
        // 保持debugger连接一段时间
        setTimeout(() => {
          chrome.debugger.detach({ tabId: tabId });
        }, 5000);
      });
    });
  });
}

// 备选方案
function tryAlternativeInspect(tabId, elementInfo) {
  chrome.tabs.sendMessage(tabId, {
    action: "SHOW_INSPECT_COMMAND",
    selector: elementInfo.selector
  });
  
  // 尝试打开devtools
  chrome.tabs.update(tabId, { highlighted: true });
  
  // 执行inspect命令
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: (selector) => {
      const el = document.querySelector(selector);
      if (el && typeof inspect === 'function') {
        inspect(el);
      }
    },
    args: [elementInfo.selector]
  });
}