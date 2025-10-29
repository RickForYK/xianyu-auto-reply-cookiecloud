// 后台服务脚本 - 处理自动刷新逻辑

let refreshTimers = {}; // 存储每个标签页的刷新定时器
let refreshStats = {}; // 存储每个标签页的统计信息
let nextRefreshTime = {}; // 存储每个标签页下次刷新的时间戳

// 默认配置
const DEFAULT_CONFIG = {
  minInterval: 45,
  maxInterval: 60,
  autoEnable: true
};

// 初始化统计信息
async function initStats(tabId) {
  if (!refreshStats[tabId]) {
    const stored = await chrome.storage.local.get(`stats_${tabId}`);
    refreshStats[tabId] = stored[`stats_${tabId}`] || {
      refreshCount: 0,
      verifyCount: 0,
      lastRefresh: null,
      startTime: Date.now()
    };
  }
  return refreshStats[tabId];
}

// 保存统计信息
async function saveStats(tabId) {
  if (refreshStats[tabId]) {
    await chrome.storage.local.set({
      [`stats_${tabId}`]: refreshStats[tabId]
    });
  }
}

// 监听来自popup和content script的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startRefresh') {
    startAutoRefresh(request.tabId, request.minInterval, request.maxInterval);
    sendResponse({ success: true });
  } else if (request.action === 'stopRefresh') {
    stopAutoRefresh(request.tabId);
    sendResponse({ success: true });
  } else if (request.action === 'getRefreshStatus') {
    const tabId = request.tabId;
    const isActive = !!refreshTimers[tabId];
    const stats = refreshStats[tabId] || { refreshCount: 0, verifyCount: 0 };
    const nextTime = nextRefreshTime[tabId] || null;
    
    // 计算剩余秒数
    let remainingSeconds = 0;
    if (nextTime) {
      remainingSeconds = Math.max(0, Math.floor((nextTime - Date.now()) / 1000));
    }
    
    // 也检查storage中的配置作为备用
    chrome.storage.local.get(`refresh_${tabId}`, (stored) => {
      const config = stored[`refresh_${tabId}`];
      const configActive = config && config.active;
      
      // 如果storage显示active但没有timer，说明需要恢复任务
      if (configActive && !isActive) {
        console.log(`⚠️ 标签页 ${tabId} 配置显示active但没有运行中的任务，可能需要恢复`);
      }
      
      sendResponse({ 
        isActive: isActive || configActive, // 任一为true就显示为active
        stats: stats,
        config: config,
        nextRefreshTime: nextTime,
        remainingSeconds: remainingSeconds
      });
    });
    
    return true; // 保持消息通道开启
  } else if (request.action === 'verifyCompleted') {
    // 验证完成，增加计数
    if (sender.tab && sender.tab.id) {
      incrementVerifyCount(sender.tab.id);
    }
    sendResponse({ success: true });
  } else if (request.action === 'resetStats') {
    if (refreshStats[request.tabId]) {
      refreshStats[request.tabId] = {
        refreshCount: 0,
        verifyCount: 0,
        lastRefresh: null,
        startTime: Date.now()
      };
      saveStats(request.tabId);
    }
    sendResponse({ success: true });
  }
  return true;
});

// 开始自动刷新（支持随机间隔）
async function startAutoRefresh(tabId, minInterval, maxInterval) {
  // 检查是否已有活动任务
  if (refreshTimers[tabId]) {
    console.log(`⚠️ 标签页 ${tabId} 已有刷新任务运行中，先停止旧任务`);
    clearTimeout(refreshTimers[tabId]);
    delete refreshTimers[tabId];
  }

  // 初始化统计信息
  await initStats(tabId);

  console.log(`✅ 启动标签页 ${tabId} 的自动刷新，间隔: ${minInterval}-${maxInterval}秒（随机）`);

  // 递归函数，每次刷新后设置下一次的随机间隔
  async function scheduleNextRefresh() {
    // 计算随机间隔（秒）
    const randomInterval = Math.floor(Math.random() * (maxInterval - minInterval + 1)) + minInterval;
    const nextTime = Date.now() + (randomInterval * 1000);
    nextRefreshTime[tabId] = nextTime;
    
    console.log(`下次刷新将在 ${randomInterval} 秒后执行 (${new Date(nextTime).toLocaleTimeString()})`);

    refreshTimers[tabId] = setTimeout(async () => {
      chrome.tabs.get(tabId, async (tab) => {
        if (chrome.runtime.lastError) {
          // 标签页已关闭，清除定时器
          console.log(`标签页 ${tabId} 已关闭，停止刷新`);
          stopAutoRefresh(tabId);
          return;
        }

        // 检查是否是goofish.com域名
        if (tab.url && tab.url.includes('goofish.com')) {
          console.log(`刷新标签页 ${tabId}: ${tab.url}`);
          
          // 增加刷新计数
          if (!refreshStats[tabId]) {
            await initStats(tabId);
          }
          refreshStats[tabId].refreshCount++;
          refreshStats[tabId].lastRefresh = new Date().toISOString();
          await saveStats(tabId);
          
          // 执行刷新
          chrome.tabs.reload(tabId, {}, () => {
            // 刷新完成后，继续调度下一次刷新
            scheduleNextRefresh();
          });
        } else {
          // 如果不是goofish.com，也继续调度（可能用户会导航回去）
          scheduleNextRefresh();
        }
      });
    }, randomInterval * 1000);
  }

  // 开始第一次调度
  scheduleNextRefresh();

  // 保存刷新配置到storage
  await chrome.storage.local.set({
    [`refresh_${tabId}`]: {
      active: true,
      minInterval: minInterval,
      maxInterval: maxInterval
    }
  });
}

// 增加验证计数
async function incrementVerifyCount(tabId) {
  await initStats(tabId);
  refreshStats[tabId].verifyCount++;
  await saveStats(tabId);
  console.log(`标签页 ${tabId} 验证次数: ${refreshStats[tabId].verifyCount}`);
}

// 停止自动刷新
async function stopAutoRefresh(tabId) {
  if (refreshTimers[tabId]) {
    clearTimeout(refreshTimers[tabId]);
    delete refreshTimers[tabId];
    delete nextRefreshTime[tabId]; // 清除下次刷新时间
    console.log(`停止标签页 ${tabId} 的自动刷新`);

    // 更新storage
    await chrome.storage.local.set({
      [`refresh_${tabId}`]: {
        active: false
      }
    });
  }
}

// 监听标签页关闭事件
chrome.tabs.onRemoved.addListener((tabId) => {
  stopAutoRefresh(tabId);
  chrome.storage.local.remove(`refresh_${tabId}`);
  chrome.storage.local.remove(`stats_${tabId}`);
  delete refreshStats[tabId];
  delete nextRefreshTime[tabId]; // 清除下次刷新时间
});

// 监听标签页更新事件（自动识别goofish.com）
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  console.log('tabs.onUpdated:', tabId, changeInfo.status, tab.url);
  
  // 只在页面加载完成时检查
  if (changeInfo.status === 'complete' && tab.url) {
    console.log('页面加载完成:', tab.url);
    
    // 检查是否是goofish.com域名
    if (tab.url.includes('goofish.com')) {
      console.log('检测到goofish.com域名');
      
      // 检查是否已经有活动的刷新任务
      const hasActiveTimer = !!refreshTimers[tabId];
      
      // 检查storage中的配置
      const stored = await chrome.storage.local.get(`refresh_${tabId}`);
      const config = stored[`refresh_${tabId}`];
      
      console.log('当前刷新配置:', config);
      console.log('是否有活动任务:', hasActiveTimer);
      
      // 如果有活动任务，不需要重新启动
      if (hasActiveTimer) {
        console.log('✅ 刷新任务正在运行中，无需重新启动');
        return;
      }
      
      // 如果storage中显示active但没有实际任务，或者没有配置，则启动
      if (!config || !config.active || (config.active && !hasActiveTimer)) {
        // 获取全局配置
        const globalConfig = await chrome.storage.local.get('globalConfig');
        const cfg = globalConfig.globalConfig || DEFAULT_CONFIG;
        
        console.log('全局配置:', cfg);
        
        if (cfg.autoEnable) {
          console.log(`✅ 自动检测到 goofish.com，启动自动刷新 (${cfg.minInterval}-${cfg.maxInterval}秒)`);
          await startAutoRefresh(tabId, cfg.minInterval, cfg.maxInterval);
        } else {
          console.log('自动启用已禁用');
        }
      }
    }
  }
});

// 插件启动时恢复之前的刷新任务
chrome.runtime.onStartup.addListener(async () => {
  const items = await chrome.storage.local.get(null);
  for (let key in items) {
    if (key.startsWith('refresh_')) {
      const tabId = parseInt(key.split('_')[1]);
      const config = items[key];
      if (config.active) {
        const minInterval = config.minInterval || DEFAULT_CONFIG.minInterval;
        const maxInterval = config.maxInterval || DEFAULT_CONFIG.maxInterval;
        startAutoRefresh(tabId, minInterval, maxInterval);
      }
    }
  }
});

// 插件安装或更新时初始化默认配置
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('插件安装/更新事件:', details.reason);
  
  // 总是重新设置默认配置，确保有正确的配置
  await chrome.storage.local.set({
    globalConfig: DEFAULT_CONFIG
  });
  
  console.log('✅ 默认配置已设置:', DEFAULT_CONFIG);
  
  // 如果是更新，打印版本信息
  if (details.reason === 'update') {
    console.log('插件已更新到新版本');
  } else if (details.reason === 'install') {
    console.log('插件首次安装');
  }
});

