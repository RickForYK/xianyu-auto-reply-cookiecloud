// 内容脚本 - 检测验证码并自动完成滑块验证

//console.log('闲鱼自动刷新助手：内容脚本已加载 ✅');
//console.log('当前页面URL:', window.location.href);
//console.log('是否在iframe中:', window.self !== window.top ? '是' : '否');
//console.log('Frame深度:', window.frameElement ? 'iframe' : 'top');

// 配置参数
const CHECK_INTERVAL = 1000; // 每1秒检查一次是否出现验证码
let isSliding = false; // 防止重复滑动
let checkCount = 0; // 检查次数计数器（用于调试）
let verifyFailCount = 0; // 验证失败计数
let lastRefreshTime = 0; // 上次刷新时间（防止频繁刷新）

// 启动验证码监测
startVerificationMonitor();

// 启动错误监测（验证失败、连接中断等）
startErrorMonitor();

function startVerificationMonitor() {
  //console.log('🔍 开始监测滑块验证码...');
  //console.log('检测间隔:', CHECK_INTERVAL + 'ms');
  
  setInterval(() => {
    if (!isSliding) {
      checkCount++;
      // 每30次检查输出一次心跳日志（避免刷屏）
      if (checkCount % 30 === 0) {
        console.log(`💓 验证码监测运行中... (已检查${checkCount}次)`);
      }
      detectAndSlideVerification();
    }
  }, CHECK_INTERVAL);
}

// 启动错误监测（验证失败、连接中断等）
function startErrorMonitor() {
  console.log('🔍 开始监测错误提示（验证失败、连接中断）...');
  
  setInterval(() => {
    checkVerificationFailure();
    checkConnectionError();
  }, 2000); // 每2秒检查一次
}

// 检测验证失败
function checkVerificationFailure() {
  // 检测验证失败的文字提示
  const errorTexts = [
    '验证失败',
    '请再次体验',
    'error:D2WXXu',
    'error:DWXXX',
    '验证异常',
    '验证超时',
    '请再次尝试'
  ];
  
  for (let text of errorTexts) {
    const xpath = `//*[contains(text(), '${text}')]`;
    const result = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    
    if (result.singleNodeValue) {
      console.log(`⚠️ 检测到验证失败提示: "${text}"`);
      verifyFailCount++;
      console.log(`验证失败次数: ${verifyFailCount}`);
      
      // 如果验证失败，刷新页面
      if (shouldRefreshOnError()) {
        console.log('🔄 验证失败，准备刷新页面...');
        refreshPageWithDelay(2000);
      }
      return;
    }
  }
  
  // 也检测DOM元素中的错误提示
  const errorElements = document.querySelectorAll('.nc_scale_text, .nc-lang-cnt, .errloading, .error-text');
  errorElements.forEach(el => {
    const text = el.textContent || '';
    if (text.includes('验证失败') || text.includes('error:') || text.includes('请再次')) {
      console.log(`⚠️ 检测到验证失败元素:`, text);
      if (shouldRefreshOnError()) {
        console.log('🔄 验证失败，准备刷新页面...');
        refreshPageWithDelay(2000);
      }
    }
  });
}

// 检测连接中断
function checkConnectionError() {
  // 检测连接中断的提示
  const connectionTexts = [
    '连接中断',
    '请重连',
    '连接超时',
    '网络异常',
    '请检查网络',
    '连接失败',
    '连接断开'
  ];
  
  for (let text of connectionTexts) {
    const xpath = `//*[contains(text(), '${text}')]`;
    const result = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    
    if (result.singleNodeValue) {
      console.log(`⚠️ 检测到连接错误提示: "${text}"`);
      
      if (shouldRefreshOnError()) {
        console.log('🔄 连接中断，准备刷新页面...');
        refreshPageWithDelay(1000);
      }
      return;
    }
  }
}

// 判断是否应该刷新页面
function shouldRefreshOnError() {
  const now = Date.now();
  // 避免频繁刷新，至少间隔10秒
  if (now - lastRefreshTime < 10000) {
    console.log('⏱️ 距离上次刷新不足10秒，跳过');
    return false;
  }
  return true;
}

// 延迟刷新页面
function refreshPageWithDelay(delay = 1000) {
  console.log(`⏳ 将在 ${delay/1000} 秒后刷新页面...`);
  
  setTimeout(() => {
    lastRefreshTime = Date.now();
    console.log('🔄 执行页面刷新');
    window.location.reload();
  }, delay);
}

// 检测并处理滑块验证
function detectAndSlideVerification() {
  // 查找常见的滑块验证容器（按优先级排序）
  const verificationSelectors = [
    // 闲鱼/淘宝常见的滑块验证选择器
    '#nc_1_wrapper',           // 最常见的nc验证码容器
    'div[id*="nc_"][id*="wrapper"]', // nc验证码包装器
    'div[id^="nc_"]',          // 以nc_开头的ID
    '.nc-container',           // nc容器类
    '.nc_wrapper',             // nc包装器
    '#nc_1_n1z',               // 阿里系验证码ID
    'span.nc_iconfont',        // 滑块按钮
    '.slide-verify',           // 通用滑块验证
    '.slidetounlock',          // 滑动解锁
    'div[class*="slider-verify"]', // slider-verify相关类
    'div[class*="slide-verify"]',  // slide-verify相关类
    '[class*="nc_scale"]',     // nc滑动条
    'div.nc-lang-cnt',         // nc语言容器
  ];

  // 调试：定期输出页面中存在的可能相关元素
  if (checkCount % 60 === 0) {
    //console.log('🔎 页面元素诊断:');
    verificationSelectors.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        //console.log(`  找到 ${elements.length} 个 ${selector} 元素`);
      }
    });
  }

  for (let selector of verificationSelectors) {
    const element = document.querySelector(selector);
    if (element && isElementVisible(element)) {
      //console.log(`✅ 检测到验证码元素: ${selector}`);
      console.log('元素信息:', {
        id: element.id,
        className: element.className,
        offsetWidth: element.offsetWidth,
        offsetHeight: element.offsetHeight
      });
      handleSliderVerification(element);
      return true; // 返回true表示找到了
    }
  }

  // 检查是否有包含特定文字的验证提示（更多关键词）
  const verificationTexts = [
    '请拖动下方滑块完成验证',
    '向右滑动完成验证',
    '请按住滑块',
    '拖动滑块',
    '滑动验证',
    '请完成验证',
    '请拖动滑块填充拼图',
    '验证'
  ];

  for (let text of verificationTexts) {
    const xpath = `//*[contains(text(), '${text}')]`;
    const result = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );

    if (result.singleNodeValue) {
      //console.log(`📝 检测到验证文字提示: "${text}"`);
      // 尝试查找滑块元素
      const slider = findSliderElement();
      if (slider) {
        //console.log('✅ 通过文字提示找到滑块元素');
        handleSliderVerification(slider);
        return;
      } else {
        //console.log('⚠️ 检测到验证文字但未找到滑块元素');
      }
    }
  }
}

// 查找滑块元素
function findSliderElement() {
  //console.log('🔍 开始查找滑块按钮元素...');
  
  // 查找可拖动的滑块按钮（按优先级）
  const sliderSelectors = [
    'span.nc_iconfont.btn_slide',   // 最常见的滑块
    'span.nc_iconfont',              // nc滑块按钮
    'div.nc_scale span',             // nc滑动条中的span
    '#nc_1_n1t',                     // nc滑块ID
    '.nc_iconfont',                  // nc图标
    '.slide-verify-slider-mask',     // 滑块遮罩
    '.slide-verify-slider',          // 滑块
    '[class*="slider-button"]',      // 滑块按钮
    '[class*="slide-btn"]',          // 滑动按钮
    '[id*="nc_"][id*="n1t"]',       // nc滑块ID模式
  ];

  for (let selector of sliderSelectors) {
    const slider = document.querySelector(selector);
    if (slider && isElementVisible(slider)) {
      //console.log(`✅ 找到滑块按钮: ${selector}`);
      console.log('滑块信息:', {
        id: slider.id,
        className: slider.className,
        tagName: slider.tagName,
        rect: slider.getBoundingClientRect()
      });
      return slider;
    }
  }

  //console.log('❌ 未找到滑块按钮元素');
  return null;
}

// 检查元素是否可见
function isElementVisible(element) {
  if (!element) return false;
  
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && 
         style.visibility !== 'hidden' && 
         style.opacity !== '0' &&
         element.offsetWidth > 0 &&
         element.offsetHeight > 0;
}

// 处理滑块验证
async function handleSliderVerification(sliderElement) {
  if (isSliding) {
    //console.log('⚠️ 滑块验证正在进行中，跳过...');
    return;
  }
  
  isSliding = true;
  //console.log('🚀 开始执行滑块验证...');
  console.log('传入的元素:', {
    tagName: sliderElement.tagName,
    id: sliderElement.id,
    className: sliderElement.className
  });

  try {
    // 查找滑块按钮（多种查找方式）
    let slider = null;
    
    // 方式1: 如果传入的就是滑块按钮
    if (sliderElement.classList.contains('nc_iconfont') || 
        sliderElement.id && sliderElement.id.includes('n1t')) {
      slider = sliderElement;
      //console.log('✅ 传入元素本身就是滑块按钮');
    }
    
    // 方式2: 在传入元素内查找
    if (!slider) {
      const selectors = [
        'span.nc_iconfont.btn_slide',
        'span.nc_iconfont',
        '#nc_1_n1t',
        '.nc_iconfont',
        '[class*="slider"]'
      ];
      
      for (let sel of selectors) {
        slider = sliderElement.querySelector(sel);
        if (slider) {
          //console.log(`✅ 在容器内找到滑块: ${sel}`);
          break;
        }
      }
    }
    
    // 方式3: 作为后备，使用传入的元素
    if (!slider) {
      slider = sliderElement;
      //console.log('⚠️ 使用传入元素作为滑块');
    }

    if (!slider) {
      //console.log('❌ 未找到滑块按钮元素');
      isSliding = false;
      return;
    }
    
    console.log('滑块按钮已确认:', {
      id: slider.id,
      className: slider.className,
      offsetWidth: slider.offsetWidth,
      offsetHeight: slider.offsetHeight
    });

    // 获取滑块容器
    let sliderTrack = slider.closest('.nc-container') || 
                      slider.closest('[id^="nc_"]') ||
                      slider.closest('.nc_wrapper') ||
                      slider.parentElement ||
                      sliderElement;

    if (!sliderTrack) {
      //console.log('⚠️ 未找到滑块轨道，使用滑块的父元素');
      sliderTrack = slider.parentElement || slider;
    }
    
    console.log('滑块轨道信息:', {
      tagName: sliderTrack.tagName,
      id: sliderTrack.id,
      className: sliderTrack.className,
      width: sliderTrack.offsetWidth
    });

    // 计算滑动距离
    const sliderRect = slider.getBoundingClientRect();
    const trackRect = sliderTrack.getBoundingClientRect();
    
    // 计算实际可滑动距离（轨道宽度 - 滑块宽度 - 小余量）
    let slideDistance = trackRect.width - sliderRect.width - 5;
    
    // 如果计算出的距离不合理，使用固定距离
    if (slideDistance < 50 || slideDistance > 1000) {
      //console.log(`⚠️ 计算距离异常(${slideDistance}px)，使用默认值280px`);
      slideDistance = 280;
    }

    //console.log(`📏 滑块位置: (${Math.round(sliderRect.left)}, ${Math.round(sliderRect.top)})`);
    //console.log(`📏 滑块尺寸: ${Math.round(sliderRect.width)}x${Math.round(sliderRect.height)}`);
    //console.log(`📏 轨道宽度: ${Math.round(trackRect.width)}px`);
    //console.log(`📏 滑动距离: ${Math.round(slideDistance)}px`);

    // 执行人性化滑动
    console.log('🎬 开始执行滑动动画...');
    await simulateHumanSlide(slider, slideDistance);

    console.log('✅ 滑块验证完成！');
    
    // 通知background增加验证计数
    chrome.runtime.sendMessage({ action: 'verifyCompleted' }, (response) => {
      if (response && response.success) {
        console.log('📊 验证计数已更新');
      }
    });
    
    // 等待3秒后重置状态
    setTimeout(() => {
      isSliding = false;
    }, 3000);

  } catch (error) {
    console.error('滑块验证失败:', error);
    isSliding = false;
  }
}

// 模拟人性化滑动
async function simulateHumanSlide(element, distance) {
  const rect = element.getBoundingClientRect();
  const startX = rect.left + rect.width / 2;
  const startY = rect.top + rect.height / 2;

  // 生成人性化轨迹
  const trajectory = generateHumanTrajectory(distance);
  
  // 触发mousedown事件
  dispatchMouseEvent(element, 'mousedown', startX, startY);
  await sleep(randomInt(50, 100));

  // 执行拖动轨迹
  let currentX = startX;
  let currentY = startY;

  for (let i = 0; i < trajectory.length; i++) {
    currentX += trajectory[i].dx;
    currentY += trajectory[i].dy;

    dispatchMouseEvent(element, 'mousemove', currentX, currentY);
    
    // 随机停顿
    if (trajectory[i].pause) {
      await sleep(trajectory[i].pause);
    } else {
      await sleep(randomInt(1, 3));
    }
  }

  // 触发mouseup事件
  dispatchMouseEvent(element, 'mouseup', currentX, currentY);
  dispatchMouseEvent(element, 'click', currentX, currentY);
}

// 生成人性化滑动轨迹
function generateHumanTrajectory(totalDistance) {
  const trajectory = [];
  let coveredDistance = 0;
  
  // 加速阶段（前30%）
  const accelSteps = 15;
  for (let i = 0; i < accelSteps; i++) {
    const progress = (i + 1) / accelSteps;
    const speed = 2 + progress * 8; // 从2到10像素
    const dx = speed;
    const dy = randomFloat(-1, 1); // Y轴微小抖动
    
    trajectory.push({ dx, dy });
    coveredDistance += dx;
  }

  // 匀速阶段（中间40%）
  while (coveredDistance < totalDistance * 0.7) {
    const dx = randomFloat(8, 12);
    const dy = randomFloat(-1.5, 1.5);
    
    // 随机犹豫
    const pause = Math.random() < 0.1 ? randomInt(30, 80) : 0;
    
    trajectory.push({ dx, dy, pause });
    coveredDistance += dx;
  }

  // 减速阶段（最后30%）
  const remainingDistance = totalDistance - coveredDistance;
  const decelSteps = 20;
  
  for (let i = 0; i < decelSteps; i++) {
    const progress = (i + 1) / decelSteps;
    const speed = (remainingDistance / decelSteps) * (1 - progress * 0.5);
    const dx = Math.max(speed, 0.5);
    const dy = randomFloat(-0.8, 0.8);
    
    trajectory.push({ dx, dy });
    coveredDistance += dx;
    
    if (coveredDistance >= totalDistance) break;
  }

  // 微调，超出一点再回退（模拟人的修正行为）
  const overshoot = randomInt(5, 15);
  trajectory.push({ dx: overshoot, dy: randomFloat(-0.5, 0.5) });
  trajectory.push({ dx: -overshoot * 0.5, dy: 0 });

  return trajectory;
}

// 触发鼠标事件
function dispatchMouseEvent(element, type, clientX, clientY) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: clientX,
    clientY: clientY,
    screenX: clientX,
    screenY: clientY,
    button: 0
  });

  element.dispatchEvent(event);
}

// 工具函数
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min, max) {
  return Math.random() * (max - min) + min;
}

// 监听来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'testSlider') {
    console.log('🎯 收到手动测试滑块指令');
    //console.log('开始强制检测验证码...');
    
    // 强制重置状态
    isSliding = false;
    
    // 执行检测
    const result = detectAndSlideVerification();
    
    // 如果没有找到，尝试直接查找并滑动
    if (!result) {
      //console.log('⚠️ 常规检测未找到验证码，尝试直接查找滑块...');
      forceSlideTest();
    }
    
    sendResponse({ success: true });
  }
  return true;
});

// 强制测试滑动（用于手动测试）
function forceSlideTest() {
  //console.log('🔧 强制测试模式启动...');
  //console.log('当前文档:', document.title || 'no title');
  
  // 检查iframe
  //console.log('\n🔍 检查iframe...');
  const iframes = document.querySelectorAll('iframe');
  //console.log(`页面中有 ${iframes.length} 个iframe`);
  
  if (iframes.length > 0) {
    iframes.forEach((iframe, idx) => {
      console.log(`  iframe[${idx}]:`, {
        src: iframe.src,
        id: iframe.id,
        className: iframe.className
      });
      
      // 尝试访问iframe内容
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        const nc = iframeDoc.querySelector('#nc_1_wrapper') || 
                   iframeDoc.querySelector('.nc_wrapper') ||
                   iframeDoc.querySelector('[id^="nc_"]');
        if (nc) {
          //console.log(`  ✅ 在iframe[${idx}]中找到验证码!`);
          // 在iframe的文档中查找滑块
          const slider = iframeDoc.querySelector('#nc_1_n1z') ||
                        iframeDoc.querySelector('span.nc_iconfont') ||
                        iframeDoc.querySelector('.nc_iconfont');
          if (slider) {
            //console.log(`  ✅ 在iframe[${idx}]中找到滑块!`, slider);
          }
        }
      } catch(e) {
        //console.log(`  ⚠️ 无法访问iframe[${idx}]内容:`, e.message);
      }
    });
  }
  
  // 列出所有可能的滑块选择器
  const allSelectors = [
    '#nc_1_n1z',              // 最精确的滑块ID
    '#nc_1_wrapper',          // 验证码容器
    'span.nc_iconfont.btn_slide',
    'span.nc_iconfont',
    '#nc_1_n1t',
    'div.nc_scale span',
    '.nc_iconfont',
    '[class*="nc_iconfont"]',
    '[id*="nc_"][id*="n1t"]',
    '[id^="nc_"]',            // 任何以nc_开头的ID
    '.slide-verify-slider',
    '[class*="slider"]',
  ];
  
  //console.log('\n🔍 在当前文档中遍历所有可能的选择器...');
  
  for (let selector of allSelectors) {
    const elements = document.querySelectorAll(selector);
    //console.log(`  ${selector}: 找到 ${elements.length} 个元素`);
    
    if (elements.length > 0) {
      elements.forEach((el, idx) => {
        const rect = el.getBoundingClientRect();
        const visible = rect.width > 0 && rect.height > 0;
        console.log(`    [${idx}]`, {
          visible: visible,
          size: `${rect.width}x${rect.height}`,
          position: `(${rect.left}, ${rect.top})`,
          tagName: el.tagName,
          id: el.id,
          className: el.className
        });
        
        // 尝试滑动第一个可见元素
        if (idx === 0 && visible && !isSliding) {
          //console.log(`  ✅ 尝试使用此元素进行滑动...`);
          handleSliderVerification(el);
        }
      });
    }
  }
  
  //console.log('\n🔧 强制测试完成');
  //console.log('💡 提示: 如果验证码在iframe中，插件需要在iframe内运行');
}

