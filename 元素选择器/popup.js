document.getElementById('activatePicker').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  chrome.tabs.sendMessage(tab.id, { action: "ACTIVATE_PICKER" }).catch(() => {
    // 如果content script没加载，注入它
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    }).then(() => {
      chrome.tabs.sendMessage(tab.id, { action: "ACTIVATE_PICKER" });
    });
  });
  
  window.close();
});

// popup.js
document.addEventListener('DOMContentLoaded', function() {
  const cspCheckbox = document.getElementById('disableCSP');
  const cspStatus = document.getElementById('cspStatus');
  const siteInfo = document.getElementById('siteInfo');
  const warning = document.getElementById('warning');

  // 获取当前标签页信息
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    const currentTab = tabs[0];
    const url = new URL(currentTab.url);
    const hostname = url.hostname;
    
    // 显示当前网站
    siteInfo.innerHTML = `当前网站: <strong>${hostname}</strong>`;

    // 检查当前标签页的CSP禁用状态
    checkCSPStatusForTab(currentTab.id, function(isEnabled) {
      // 更新UI状态
      cspCheckbox.checked = isEnabled;
      updateStatusDisplay(isEnabled);
      
      // 如果启用，显示警告
      if (isEnabled) {
        warning.style.display = 'block';
      }
    });

    // 监听复选框变化
    cspCheckbox.addEventListener('change', function(e) {
      const enabled = e.target.checked;
      
      // 更新当前标签页的CSP状态
      toggleCSPForTab(currentTab.id, enabled, function(success) {
        if (success) {
          updateStatusDisplay(enabled);
          
          // 显示/隐藏警告
          warning.style.display = enabled ? 'block' : 'none';
          
          // 保存设置到存储（可选）
          chrome.storage.local.set({ 
            [`csp_${hostname}`]: enabled 
          });
        } else {
          // 如果失败，恢复复选框状态
          cspCheckbox.checked = !enabled;
          alert('切换CSP状态失败，请刷新页面后重试');
        }
      });
    });
  });

  // 检查指定标签页的CSP状态
  function checkCSPStatusForTab(tabId, callback) {
    // 方法1：通过declarativeNetRequest查询规则集状态
    chrome.declarativeNetRequest.getEnabledRulesets(function(rulesets) {
      const isEnabled = rulesets.includes('remove_csp');
      callback(isEnabled);
    });
    
    // 方法2：也可以配合content_scripts检测实际效果
    // 这里留个钩子，如果需要更精确的按站点控制可以扩展
  }

  // 切换指定标签页的CSP状态
  function toggleCSPForTab(tabId, enable, callback) {
    // 注意：declarativeNetRequest规则是全局的，不能按tab单独控制
    // 这里演示全局切换，如果需要更精细的控制，需要用不同的规则集
    
    if (enable) {
      // 启用CSP禁用
      chrome.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: ["remove_csp"],
        disableRulesetIds: []
      }, function() {
        if (chrome.runtime.lastError) {
          console.error('启用失败:', chrome.runtime.lastError);
          callback(false);
        } else {
          // 刷新页面使CSP变更生效
          chrome.tabs.reload(tabId, { bypassCache: true });
          callback(true);
        }
      });
    } else {
      // 禁用CSP禁用（恢复CSP）
      chrome.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: [],
        disableRulesetIds: ["remove_csp"]
      }, function() {
        if (chrome.runtime.lastError) {
          console.error('禁用失败:', chrome.runtime.lastError);
          callback(false);
        } else {
          // 刷新页面使CSP恢复生效
          chrome.tabs.reload(tabId, { bypassCache: true });
          callback(true);
        }
      });
    }
  }

  // 更新状态显示
  function updateStatusDisplay(enabled) {
    const cspStatus = document.getElementById('cspStatus');
    if (enabled) {
      cspStatus.textContent = '已禁用（当前网站无CSP保护）';
      cspStatus.className = 'enabled';
    } else {
      cspStatus.textContent = '未禁用（网站CSP正常生效）';
      cspStatus.className = 'disabled';
    }
  }
});