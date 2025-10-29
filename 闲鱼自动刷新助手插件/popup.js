// Popup 脚本 - 处理用户界面交互

let currentTabId = null;
let statsInterval = null;

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', async () => {
  await loadCurrentTab();
  await loadGlobalConfig();
  await loadRefreshStatus(); // 在配置加载后再加载状态
  bindEvents();
  
  // 每2秒更新一次统计信息和状态
  statsInterval = setInterval(async () => {
    await updateStats();
    await loadRefreshStatus(); // 也更新状态
  }, 2000);
  await updateStats();
});

// 加载当前标签页信息
async function loadCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = tab.id;
    console.log('当前标签页ID:', currentTabId);
    console.log('当前标签页URL:', tab.url);

    const tabInfo = document.getElementById('tabInfo');
    const url = tab.url || '';
    
    if (url.includes('goofish.com')) {
      tabInfo.innerHTML = `<strong>✅ ${tab.title || 'Goofish'}</strong><br>${url}`;
    } else {
      tabInfo.innerHTML = `<strong>⚠️ 当前页面不是goofish.com</strong><br>${url}`;
      // 如果不是goofish.com，也尝试加载状态（可能之前设置过）
    }
  } catch (error) {
    console.error('获取标签页信息失败:', error);
    document.getElementById('tabInfo').textContent = '❌ 无法获取标签页信息';
  }
}

// 加载全局配置
async function loadGlobalConfig() {
  try {
    const result = await chrome.storage.local.get('globalConfig');
    const config = result.globalConfig || { minInterval: 45, maxInterval: 60 };
    
    document.getElementById('minInterval').value = config.minInterval;
    document.getElementById('maxInterval').value = config.maxInterval;
  } catch (error) {
    console.error('加载配置失败:', error);
  }
}

// 保存全局配置
async function saveGlobalConfig() {
  const minInterval = parseInt(document.getElementById('minInterval').value);
  const maxInterval = parseInt(document.getElementById('maxInterval').value);
  
  await chrome.storage.local.set({
    globalConfig: {
      minInterval: minInterval,
      maxInterval: maxInterval,
      autoEnable: true
    }
  });
}

// 加载刷新状态
async function loadRefreshStatus() {
  if (!currentTabId) {
    console.log('⚠️ currentTabId 未设置，无法加载状态');
    return;
  }

  try {
    console.log('正在获取标签页', currentTabId, '的刷新状态...');
    
    const response = await chrome.runtime.sendMessage({
      action: 'getRefreshStatus',
      tabId: currentTabId
    });

    console.log('收到刷新状态响应:', response);

    const statusElement = document.getElementById('refreshStatus');
    const startButton = document.getElementById('startRefresh');
    const stopButton = document.getElementById('stopRefresh');

    if (response && response.isActive) {
      statusElement.className = 'status active';
      statusElement.innerHTML = '<span class="status-icon"></span><span>自动刷新：运行中</span>';
      startButton.disabled = true;
      stopButton.disabled = false;
      
      // 显示配置信息
      if (response.config) {
        console.log('刷新配置:', response.config);
      }
    } else {
      statusElement.className = 'status inactive';
      statusElement.innerHTML = '<span class="status-icon"></span><span>自动刷新：未启动</span>';
      startButton.disabled = false;
      stopButton.disabled = true;
    }
    
    // 更新统计信息
    if (response && response.stats) {
      document.getElementById('refreshCount').textContent = response.stats.refreshCount || 0;
      document.getElementById('verifyCount').textContent = response.stats.verifyCount || 0;
    }
  } catch (error) {
    console.error('获取刷新状态失败:', error);
    // 尝试从storage直接读取
    await loadStatusFromStorage();
  }
}

// 从storage直接读取状态（备用方案）
async function loadStatusFromStorage() {
  if (!currentTabId) return;
  
  try {
    const stored = await chrome.storage.local.get([`refresh_${currentTabId}`, `stats_${currentTabId}`]);
    const config = stored[`refresh_${currentTabId}`];
    const stats = stored[`stats_${currentTabId}`];
    
    console.log('从storage读取的配置:', config);
    console.log('从storage读取的统计:', stats);
    
    const statusElement = document.getElementById('refreshStatus');
    const startButton = document.getElementById('startRefresh');
    const stopButton = document.getElementById('stopRefresh');
    
    if (config && config.active) {
      statusElement.className = 'status active';
      statusElement.innerHTML = '<span class="status-icon"></span><span>自动刷新：运行中</span>';
      startButton.disabled = true;
      stopButton.disabled = false;
    } else {
      statusElement.className = 'status inactive';
      statusElement.innerHTML = '<span class="status-icon"></span><span>自动刷新：未启动</span>';
      startButton.disabled = false;
      stopButton.disabled = true;
    }
    
    if (stats) {
      document.getElementById('refreshCount').textContent = stats.refreshCount || 0;
      document.getElementById('verifyCount').textContent = stats.verifyCount || 0;
    }
  } catch (error) {
    console.error('从storage读取状态失败:', error);
  }
}

// 更新统计信息
async function updateStats() {
  if (!currentTabId) return;
  
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'getRefreshStatus',
      tabId: currentTabId
    });
    
    if (response.stats) {
      document.getElementById('refreshCount').textContent = response.stats.refreshCount || 0;
      document.getElementById('verifyCount').textContent = response.stats.verifyCount || 0;
    }
    
    // 显示下次刷新倒计时
    const nextRefreshElement = document.getElementById('nextRefresh');
    if (response && response.isActive && response.remainingSeconds !== undefined) {
      const seconds = response.remainingSeconds;
      if (seconds > 0) {
        nextRefreshElement.textContent = `${seconds}秒`;
        nextRefreshElement.style.color = '#667eea';
      } else {
        nextRefreshElement.textContent = '即将刷新...';
        nextRefreshElement.style.color = '#ff9800';
      }
    } else if (response && response.isActive) {
      nextRefreshElement.textContent = '等待中';
      nextRefreshElement.style.color = '#999';
    } else {
      nextRefreshElement.textContent = '--';
      nextRefreshElement.style.color = '#999';
    }
  } catch (error) {
    // 静默失败
  }
}

// 绑定事件
function bindEvents() {
  // 启动自动刷新
  document.getElementById('startRefresh').addEventListener('click', async () => {
    const minInterval = parseInt(document.getElementById('minInterval').value);
    const maxInterval = parseInt(document.getElementById('maxInterval').value);
    
    if (minInterval < 30 || maxInterval > 300) {
      showMessage('❌ 刷新间隔必须在30-300秒之间', 'error');
      return;
    }
    
    if (minInterval > maxInterval) {
      showMessage('❌ 最小间隔不能大于最大间隔', 'error');
      return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.url || !tab.url.includes('goofish.com')) {
      showMessage('❌ 请在goofish.com页面使用此功能', 'error');
      return;
    }

    try {
      // 保存全局配置
      await saveGlobalConfig();
      
      await chrome.runtime.sendMessage({
        action: 'startRefresh',
        tabId: currentTabId,
        minInterval: minInterval,
        maxInterval: maxInterval
      });

      showMessage(`✅ 已启动自动刷新（${minInterval}-${maxInterval}秒随机）`, 'success');
      await loadRefreshStatus();
    } catch (error) {
      console.error('启动刷新失败:', error);
      showMessage('❌ 启动失败，请重试', 'error');
    }
  });

  // 停止自动刷新
  document.getElementById('stopRefresh').addEventListener('click', async () => {
    try {
      await chrome.runtime.sendMessage({
        action: 'stopRefresh',
        tabId: currentTabId
      });

      showMessage('✅ 已停止自动刷新', 'success');
      await loadRefreshStatus();
    } catch (error) {
      console.error('停止刷新失败:', error);
      showMessage('❌ 停止失败，请重试', 'error');
    }
  });

  // 测试滑块
  document.getElementById('testSlider').addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      await chrome.tabs.sendMessage(tab.id, {
        action: 'testSlider'
      });

      showMessage('✅ 已发送测试指令，请查看页面', 'success');
    } catch (error) {
      console.error('测试滑块失败:', error);
      showMessage('❌ 测试失败，请确保在goofish.com页面', 'error');
    }
  });
  
  // 重置统计
  document.getElementById('resetStats').addEventListener('click', async () => {
    if (!confirm('确定要重置统计信息吗？')) {
      return;
    }
    
    try {
      await chrome.runtime.sendMessage({
        action: 'resetStats',
        tabId: currentTabId
      });
      
      await updateStats();
      showMessage('✅ 统计信息已重置', 'success');
    } catch (error) {
      console.error('重置统计失败:', error);
      showMessage('❌ 重置失败', 'error');
    }
  });
}

// 清理定时器
window.addEventListener('beforeunload', () => {
  if (statsInterval) {
    clearInterval(statsInterval);
  }
});

// 显示消息提示
function showMessage(message, type) {
  // 创建消息元素
  const messageDiv = document.createElement('div');
  messageDiv.style.cssText = `
    position: fixed;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    padding: 10px 20px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    z-index: 10000;
    animation: slideDown 0.3s ease;
    ${type === 'success' ? 'background: #4caf50; color: white;' : 'background: #f44336; color: white;'}
  `;
  messageDiv.textContent = message;

  document.body.appendChild(messageDiv);

  // 3秒后移除
  setTimeout(() => {
    messageDiv.style.animation = 'slideUp 0.3s ease';
    setTimeout(() => messageDiv.remove(), 300);
  }, 3000);
}

// 添加动画样式
const style = document.createElement('style');
style.textContent = `
  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(-20px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }
  
  @keyframes slideUp {
    from {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
    to {
      opacity: 0;
      transform: translateX(-50%) translateY(-20px);
    }
  }
`;
document.head.appendChild(style);

