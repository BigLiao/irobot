// packages/injector/src/monitor.ts
// 这个脚本会被注入到目标网页，用于监控其指纹采集行为

export {};

declare global {
  interface Window {
    __IROBOT_MONITOR_LOADED__?: boolean;
  }
  // 占位符变量 - 在注入时会被替换为实际值
  const MOCK_RULES_PLACEHOLDER: any;
}

type FingerprintCategory = 'canvas' | 'webgl' | 'font' | 'webrtc' | 'audio' | 'screen' | 'navigator' | 'media' | 'battery' | 'performance';

interface FingerprintEventPayload {
  category: FingerprintCategory;
  api: string;
  detail?: Record<string, any>;
  input?: any;      // API 输入参数
  output?: any;     // API 输出结果
  url: string;
  stack?: string;
  eventHash?: string; // 事件唯一标识，用于去重
  modified?: boolean; // 是否被修改过
}

interface MockRule {
  id: string;
  match: {
    api: string;
  };
  response: any;
  enabled: boolean;
}

const WEBSOCKET_URL = 'WS_URL_PLACEHOLDER';
const MESSAGE_QUEUE_LIMIT = 500;

const pendingMessages: string[] = [];
let ws: WebSocket | null = null;
let reconnectTimer: number | null = null;

// 存储修改规则 - 从注入时的初始规则开始
let mockRules: MockRule[] = MOCK_RULES_PLACEHOLDER as any;

// 快照缓存
const snapshotCache = new WeakMap<HTMLCanvasElement | OffscreenCanvas, string>();

// 保存原始方法，避免递归调用
let originalToDataURL: ((type?: string, quality?: any) => string) | null = null;

if (window.__IROBOT_MONITOR_LOADED__) {
  console.log('[Injector] 指纹 Hook 已存在，跳过重复注入');
} else {
  window.__IROBOT_MONITOR_LOADED__ = true;
  console.log('[Injector] 指纹 Hook 初始化');
  console.log(`[Injector] 初始修改规则数量: ${mockRules.length}`);
  if (mockRules.length > 0) {
    console.log('[Injector] 修改规则:', mockRules.map(r => `${r.match.api}${r.enabled ? '' : ' (已禁用)'}`).join(', '));
  }
  setupHooks();
  initWebSocket();
}

function setupHooks() {
  try {
    hookCanvasApis();
    hookFontApis();
    hookWebGLApis();
    hookWebRTCApis();
    hookAudioApis();
    hookScreenApis();
    hookNavigatorApis();
    hookMediaDevicesApis();
    hookBatteryApis();
    hookPerformanceApis();
    console.log('[Injector] 指纹相关 API Hook 完成');
  } catch (error) {
    console.error('[Injector] Hook 初始化失败:', error);
    sendMessage('FINGERPRINT_HOOK_ERROR', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function initWebSocket() {
  if (ws) {
    try {
      ws.close();
    } catch (error) {
      console.warn('[Injector] 关闭旧的 WebSocket 失败:', error);
    }
    ws = null;
  }
  ws = getWebSocket(WEBSOCKET_URL);
}

function getWebSocket(wsUrl: string) {
  const socket = new WebSocket(wsUrl);

  socket.addEventListener('open', () => {
    console.log('[Injector] WebSocket 连接已建立');
    flushMessageQueue();
    sendMessage('FINGERPRINT_MONITOR_READY', {
      message: '指纹 API Hook 已启用',
    });
  });

  socket.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(event.data);
      
      // 接收修改规则更新
      if (data.type === 'UPDATE_MOCK_RULES' && data.rules) {
        mockRules = data.rules;
        console.log(`[Injector] 运行时更新修改规则，数量: ${mockRules.length}`);
        if (mockRules.length > 0) {
          console.log('[Injector] 当前修改规则:', mockRules.map(r => `${r.match.api}${r.enabled ? '' : ' (已禁用)'}`).join(', '));
        }
      }
    } catch (error) {
      console.error('[Injector] 解析消息错误:', error);
    }
  });

  socket.addEventListener('error', (error) => {
    console.error('[Injector] WebSocket 错误:', error);
  });

  socket.addEventListener('close', () => {
    console.log('[Injector] WebSocket 连接已关闭，3 秒后重连');
    ws = null;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      initWebSocket();
    }, 3000);
  });

  return socket;
}

function sendMessage(type: string, data: any) {
  const payload = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(payload);
  } else {
    if (pendingMessages.length >= MESSAGE_QUEUE_LIMIT) {
      pendingMessages.shift();
      console.warn('[Injector] WebSocket 未连接，丢弃最早的缓存消息');
    }
    pendingMessages.push(payload);
  }
}

function flushMessageQueue() {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }
  while (pendingMessages.length > 0) {
    const message = pendingMessages.shift();
    if (message) {
      ws.send(message);
    }
  }
}

function reportFingerprintEvent(category: FingerprintCategory, api: string, detail?: Record<string, any>) {
  // 生成事件 Hash，用于在 Dashboard 端去重和计数
  const eventHash = generateEventHash(category, api, detail);
  
  // 检查是否有匹配的修改规则
  const matchedRule = findMatchingMockRule(api);
  
  const payload: FingerprintEventPayload = {
    category,
    api,
    detail,
    url: window.location.href,
    stack: captureStack(),
    eventHash,
    modified: !!matchedRule, // 标记是否被修改
  };
  sendMessage('FINGERPRINT_EVENT', payload);
}

// 查找匹配的修改规则
function findMatchingMockRule(api: string): MockRule | null {
  for (const rule of mockRules) {
    if (rule.enabled && rule.match.api === api) {
      return rule;
    }
  }
  return null;
}

// 生成事件唯一标识
function generateEventHash(category: FingerprintCategory, api: string, detail?: Record<string, any>): string {
  try {
    // 提取关键信息用于生成 Hash
    const hashData = {
      category,
      api,
      // 从 detail 中提取输入输出（去除快照等大数据）
      input: detail?.input,
      output: detail?.output,
      // 其他关键属性（去除不稳定的属性如 duration）
      width: detail?.width,
      height: detail?.height,
      mimeType: detail?.mimeType,
      quality: detail?.quality,
      parameter: detail?.parameter,
      name: detail?.name,
    };
    
    // 简单的字符串 Hash 算法
    const str = JSON.stringify(hashData);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return `${category}_${api}_${Math.abs(hash).toString(36)}`;
  } catch (e) {
    // 降级方案：使用简单的拼接
    return `${category}_${api}_${Date.now()}`;
  }
}

function hookCanvasApis() {
  if (typeof HTMLCanvasElement !== 'undefined') {
    const canvasProto = HTMLCanvasElement.prototype;
    
    // 保存原始 toDataURL 方法，供 captureCanvasSnapshot 使用
    originalToDataURL = canvasProto.toDataURL;
    
    // toDataURL 是明确的指纹采集信号
    hookMethod(canvasProto, 'toDataURL', 'canvas', 'HTMLCanvasElement.prototype.toDataURL', function (args) {
      return buildCanvasDetail(this as HTMLCanvasElement, args, 'toDataURL', true);
    });
    
    // toBlob 也是明确的指纹采集信号
    hookMethod(canvasProto, 'toBlob', 'canvas', 'HTMLCanvasElement.prototype.toBlob', function (args) {
      return buildCanvasDetail(this as HTMLCanvasElement, args, 'toBlob', true);
    });
    
    // getContext 太频繁，不捕获快照，只记录首次调用
    // hookMethod(canvasProto, 'getContext', 'canvas', function (args) {
    //   const contextId = args[0];
    //   const attributes = args[1] && typeof args[1] === 'object' ? Object.keys(args[1]) : undefined;
    //   return {
    //     contextId,
    //     attributeKeys: attributes,
    //     width: (this as HTMLCanvasElement).width,
    //     height: (this as HTMLCanvasElement).height,
    //   };
    // });
  }

  if (typeof CanvasRenderingContext2D !== 'undefined') {
    const ctxProto = CanvasRenderingContext2D.prototype;
    
    // getImageData 是指纹采集的关键方法
    hookMethod(ctxProto, 'getImageData', 'canvas', 'CanvasRenderingContext2D.prototype.getImageData', function (args) {
      const canvas = (this as CanvasRenderingContext2D).canvas;
      return {
        sx: args[0],
        sy: args[1],
        sw: args[2],
        sh: args[3],
        snapshot: captureCanvasSnapshot(canvas, false), // 不在此处触发 toDataURL
      };
    });
  }

  if (typeof OffscreenCanvas !== 'undefined') {
    const offscreenProto = OffscreenCanvas.prototype as any;
    hookMethod(offscreenProto, 'convertToBlob', 'canvas', 'OffscreenCanvas.prototype.convertToBlob', function (args) {
      const options = args[0] || {};
      return {
        type: options.type,
        quality: options.quality,
        width: (this as OffscreenCanvas).width,
        height: (this as OffscreenCanvas).height,
      };
    });
  }
}

function buildCanvasDetail(canvas: HTMLCanvasElement, args: any[], api: string, captureSnapshot = false) {
  return {
    api,
    width: canvas.width,
    height: canvas.height,
    id: canvas.id || undefined,
    className: canvas.className || undefined,
    mimeType: args[0],
    quality: args[1],
    snapshot: captureSnapshot ? captureCanvasSnapshot(canvas, true) : undefined,
  };
}

function captureCanvasSnapshot(canvas: HTMLCanvasElement | OffscreenCanvas, useCache = true): string | undefined {
  try {
    // 空 Canvas 检查
    if (canvas.width === 0 || canvas.height === 0) {
      return undefined;
    }
    
    // 缓存检查，避免重复捕获同一个 canvas
    if (useCache && snapshotCache.has(canvas)) {
      return snapshotCache.get(canvas);
    }
    
    // 使用原始 toDataURL 方法，避免触发 Hook 导致递归
    if ('toDataURL' in canvas && typeof canvas.toDataURL === 'function') {
      let dataUrl: string;
      
      if (originalToDataURL && canvas instanceof HTMLCanvasElement) {
        // 调用原始方法，避免递归
        dataUrl = originalToDataURL.call(canvas, 'image/png');
      } else {
        // 降级方案：直接调用（可能会触发 Hook，但有缓存保护）
        dataUrl = canvas.toDataURL('image/png');
      }
      
      if (useCache) {
        snapshotCache.set(canvas, dataUrl);
      }
      
      return dataUrl;
    }
    return undefined;
  } catch (error) {
    console.warn('[Injector] Canvas snapshot 失败:', error);
    return undefined;
  }
}

function hookFontApis() {
  // ==================== Font Metrics Measurement ====================
  // 监控通过 Canvas measureText 进行的字体指纹检测
  // 这种技术会尝试大量已知字体，通过测量渲染尺寸来检测系统字体
  
  if (typeof CanvasRenderingContext2D !== 'undefined') {
    const ctxProto = CanvasRenderingContext2D.prototype;
    
    // Hook measureText - 检测 Font Metrics Measurement
    // 使用调用频率和字体变化模式来识别指纹采集行为
    let measureTextCallCount = 0;
    let lastMeasureFont = '';
    let fontChangeCount = 0;
    let lastReportTime = 0;
    
    const originalMeasureText = ctxProto.measureText;
    if (originalMeasureText && typeof originalMeasureText === 'function') {
      ctxProto.measureText = function(this: CanvasRenderingContext2D, text: string): TextMetrics {
        const result = originalMeasureText.call(this, text);
        
        try {
          measureTextCallCount++;
          const currentFont = this.font;
          
          // 检测字体变化（指纹检测的特征）
          if (currentFont !== lastMeasureFont) {
            fontChangeCount++;
            lastMeasureFont = currentFont;
          }
          
          // 当检测到频繁的字体测量时上报（可能是指纹采集）
          // 规则：10 次调用内有 3+ 次字体变化，或总调用次数 > 50
          const now = Date.now();
          const shouldReport = (
            (measureTextCallCount % 10 === 0 && fontChangeCount >= 3) ||
            (measureTextCallCount === 50) ||
            (measureTextCallCount % 100 === 0)
          );
          
          if (shouldReport && now - lastReportTime > 1000) {
            reportFingerprintEvent('font', 'measureText', {
              totalCalls: measureTextCallCount,
              fontChanges: fontChangeCount,
              currentFont: currentFont,
              sampleText: truncateText(text, 50),
              textMetrics: {
                width: result.width,
                actualBoundingBoxLeft: result.actualBoundingBoxLeft,
                actualBoundingBoxRight: result.actualBoundingBoxRight,
                fontBoundingBoxAscent: result.fontBoundingBoxAscent,
                fontBoundingBoxDescent: result.fontBoundingBoxDescent,
              },
            });
            lastReportTime = now;
            
            // 重置计数器
            if (measureTextCallCount >= 100) {
              measureTextCallCount = 0;
              fontChangeCount = 0;
            }
          }
        } catch (e) {
          console.warn('[Injector] measureText Hook 异常:', e);
        }
        
        return result;
      };
      
      Object.defineProperty(ctxProto.measureText, '__irobot_hooked__', {
        value: true,
        enumerable: false,
        configurable: false,
        writable: false,
      });
    }
  }

  // ==================== Unicode Glyphs Measurement ====================
  // 监控 FontFaceSet API - 用于检测系统可用字体
  const fontSetProto = getFontFaceSetPrototype();
  if (fontSetProto) {
    // check() 方法：检查字体是否可用
    hookMethod(fontSetProto, 'check', 'font', 'FontFaceSet.prototype.check', (args) => {
      return {
        font: args[0],
        sample: truncateText(args[1]),
      };
    });
    
    // load() 方法：加载字体
    hookMethod(fontSetProto, 'load', 'font', 'FontFaceSet.prototype.load', (args) => {
      return {
        font: args[0],
        sample: truncateText(args[1]),
      };
    });
  }

  // ==================== DOM-based Font Detection ====================
  // 监控通过 DOM 元素尺寸测量进行的字体检测
  // 这种技术会创建不可见的 DOM 元素，设置不同字体，测量尺寸变化
  
  // Hook offsetWidth/offsetHeight getter（用于字体检测的关键属性）
  if (typeof HTMLElement !== 'undefined') {
    const elementProto = HTMLElement.prototype;
    
    // 跟踪相同文本内容的重复测量（更精确的字体检测特征）
    const textContentMeasureCount = new Map<string, number>(); // textContent -> count
    const textContentFonts = new Map<string, Set<string>>();   // textContent -> Set<fontFamily>
    let lastCleanupTime = Date.now();
    
    // Hook offsetWidth
    const originalOffsetWidthDesc = Object.getOwnPropertyDescriptor(elementProto, 'offsetWidth');
    if (originalOffsetWidthDesc && originalOffsetWidthDesc.get) {
      const originalOffsetWidthGet = originalOffsetWidthDesc.get;
      
      Object.defineProperty(elementProto, 'offsetWidth', {
        get() {
          const value = originalOffsetWidthGet.call(this);
          
          try {
            const element = this as HTMLElement;
            const textContent = element.textContent || '';
            
            // 只跟踪有文本内容的元素
            if (textContent.length > 0 && textContent.length < 200) {
              const now = Date.now();
              
              // 每 5 秒清理一次计数器，避免内存泄漏
              if (now - lastCleanupTime > 5000) {
                textContentMeasureCount.clear();
                textContentFonts.clear();
                lastCleanupTime = now;
              }
              
              // 记录该文本内容的测量次数
              const currentCount = textContentMeasureCount.get(textContent) || 0;
              textContentMeasureCount.set(textContent, currentCount + 1);
              
              // 记录使用的字体
              const computedStyle = window.getComputedStyle(element);
              const fontFamily = computedStyle.fontFamily;
              if (!textContentFonts.has(textContent)) {
                textContentFonts.set(textContent, new Set());
              }
              textContentFonts.get(textContent)!.add(fontFamily);
              
              // 检测特征：相同文本被测量 > 5 次，且使用了不同字体
              const measureCount = textContentMeasureCount.get(textContent)!;
              const fontCount = textContentFonts.get(textContent)!.size;
              
              if (measureCount === 5 || measureCount === 10 || measureCount === 20 || measureCount === 50) {
                reportFingerprintEvent('font', 'offsetWidth', {
                  textContent: truncateText(textContent, 50),
                  measureCount: measureCount,
                  fontCount: fontCount,
                  currentFont: fontFamily,
                  element: element.tagName,
                  fontSize: computedStyle.fontSize,
                  value: value,
                  isHidden: element.offsetParent === null,
                });
              }
            }
          } catch (e) {
            // 忽略错误，避免影响正常网页功能
          }
          
          return value;
        },
        configurable: true,
        enumerable: originalOffsetWidthDesc.enumerable,
      });
    }
    
    // Hook getBoundingClientRect（另一种测量尺寸的方法）
    const originalGetBoundingClientRect = elementProto.getBoundingClientRect;
    if (originalGetBoundingClientRect && typeof originalGetBoundingClientRect === 'function') {
      // 同样跟踪相同文本内容的重复测量
      const rectTextMeasureCount = new Map<string, number>();
      const rectTextFonts = new Map<string, Set<string>>();
      let lastRectCleanupTime = Date.now();
      
      elementProto.getBoundingClientRect = function(this: HTMLElement): DOMRect {
        const result = originalGetBoundingClientRect.call(this);
        
        try {
          const element = this as HTMLElement;
          const textContent = element.textContent || '';
          
          // 只跟踪有文本内容的元素
          if (textContent.length > 0 && textContent.length < 200) {
            const now = Date.now();
            
            // 每 5 秒清理一次
            if (now - lastRectCleanupTime > 5000) {
              rectTextMeasureCount.clear();
              rectTextFonts.clear();
              lastRectCleanupTime = now;
            }
            
            // 记录测量次数
            const currentCount = rectTextMeasureCount.get(textContent) || 0;
            rectTextMeasureCount.set(textContent, currentCount + 1);
            
            // 记录字体
            const computedStyle = window.getComputedStyle(element);
            const fontFamily = computedStyle.fontFamily;
            if (!rectTextFonts.has(textContent)) {
              rectTextFonts.set(textContent, new Set());
            }
            rectTextFonts.get(textContent)!.add(fontFamily);
            
            // 相同文本被测量 > 5 次
            const measureCount = rectTextMeasureCount.get(textContent)!;
            const fontCount = rectTextFonts.get(textContent)!.size;
            
            if (measureCount === 10 || measureCount === 20 || measureCount === 30 || measureCount === 50) {
              reportFingerprintEvent('font', 'getBoundingClientRect', {
                textContent: truncateText(textContent, 50),
                measureCount: measureCount,
                fontCount: fontCount,
                currentFont: fontFamily,
                element: element.tagName,
                fontSize: computedStyle.fontSize,
                width: result.width,
                height: result.height,
                isHidden: element.offsetParent === null,
              });
            }
          }
        } catch (e) {
          // 忽略错误
        }
        
        return result;
      };
      
      Object.defineProperty(elementProto.getBoundingClientRect, '__irobot_hooked__', {
        value: true,
        enumerable: false,
        configurable: false,
        writable: false,
      });
    }
  }
}

function getFontFaceSetPrototype() {
  if (typeof FontFaceSet !== 'undefined' && FontFaceSet.prototype) {
    return FontFaceSet.prototype;
  }
  if (document.fonts) {
    return Object.getPrototypeOf(document.fonts);
  }
  return null;
}

function hookWebGLApis() {
  // WebGLRenderingContext (WebGL 1.0)
  if (typeof WebGLRenderingContext !== 'undefined') {
    const proto = WebGLRenderingContext.prototype;
    hookMethod(proto, 'getParameter', 'webgl', 'WebGLRenderingContext.prototype.getParameter', (args) => ({ parameter: args[0] }));
    hookMethod(proto, 'getExtension', 'webgl', 'WebGLRenderingContext.prototype.getExtension', (args) => ({ name: args[0] }));
    hookMethod(proto, 'getSupportedExtensions', 'webgl', 'WebGLRenderingContext.prototype.getSupportedExtensions');
    hookMethod(proto, 'readPixels', 'webgl', 'WebGLRenderingContext.prototype.readPixels', function (args) {
      return {
        x: args[0],
        y: args[1],
        width: args[2],
        height: args[3],
        format: args[4],
        type: args[5],
      };
    });
  }
  
  // WebGL2RenderingContext (WebGL 2.0)
  if (typeof WebGL2RenderingContext !== 'undefined') {
    const proto = WebGL2RenderingContext.prototype;
    hookMethod(proto, 'getParameter', 'webgl', 'WebGL2RenderingContext.prototype.getParameter', (args) => ({ parameter: args[0] }));
    hookMethod(proto, 'getExtension', 'webgl', 'WebGL2RenderingContext.prototype.getExtension', (args) => ({ name: args[0] }));
    hookMethod(proto, 'getSupportedExtensions', 'webgl', 'WebGL2RenderingContext.prototype.getSupportedExtensions');
    hookMethod(proto, 'readPixels', 'webgl', 'WebGL2RenderingContext.prototype.readPixels', function (args) {
      return {
        x: args[0],
        y: args[1],
        width: args[2],
        height: args[3],
        format: args[4],
        type: args[5],
      };
    });
  }
}

function hookWebRTCApis() {
  const OriginalRTCPeerConnection = window.RTCPeerConnection;
  if (typeof OriginalRTCPeerConnection !== 'function' || typeof Proxy === 'undefined') {
    console.warn('[Injector] 当前环境不支持 WebRTC Hook');
    return;
  }

  window.RTCPeerConnection = new Proxy(OriginalRTCPeerConnection, {
    construct(target, args, newTarget) {
      const configuration = (args && args[0]) as RTCConfiguration | undefined;
      reportFingerprintEvent('webrtc', 'RTCPeerConnection', summarizeRtcConfiguration(configuration));
      return Reflect.construct(target, args, newTarget);
    },
    apply(target, thisArg, args) {
      return Reflect.apply(target, thisArg, args);
    },
    get(target, prop, receiver) {
      return Reflect.get(target, prop, receiver);
    },
    set(target, prop, value, receiver) {
      return Reflect.set(target, prop, value, receiver);
    },
  }) as typeof OriginalRTCPeerConnection;

  const proto = OriginalRTCPeerConnection.prototype as any;
  hookMethod(proto, 'createDataChannel', 'webrtc', 'RTCPeerConnection.prototype.createDataChannel', (args) => ({
    label: args[0],
    ordered: args[1]?.ordered,
    negotiated: args[1]?.negotiated,
    protocol: args[1]?.protocol,
  }));
  hookMethod(proto, 'createOffer', 'webrtc', 'RTCPeerConnection.prototype.createOffer', (args) => ({
    hasOptions: Boolean(args[0]),
    optionKeys: args[0] ? Object.keys(args[0]) : [],
  }));
  hookMethod(proto, 'createAnswer', 'webrtc', 'RTCPeerConnection.prototype.createAnswer', (args) => ({
    hasOptions: Boolean(args[0]),
    optionKeys: args[0] ? Object.keys(args[0]) : [],
  }));
  hookMethod(proto, 'setLocalDescription', 'webrtc', 'RTCPeerConnection.prototype.setLocalDescription', (args) => {
    const desc = args[0];
    if (!desc) {
      return undefined;
    }
    return {
      type: desc.type,
      sdpLength: desc.sdp ? desc.sdp.length : 0,
    };
  });
  hookMethod(proto, 'addIceCandidate', 'webrtc', 'RTCPeerConnection.prototype.addIceCandidate', (args) => {
    const candidate = args[0];
    if (!candidate) {
      return undefined;
    }
    if (typeof candidate === 'string') {
      return { candidate: truncateText(candidate, 120) };
    }
    return {
      type: candidate.type,
      protocol: candidate.protocol,
      address: candidate.address || candidate.ip,
      port: candidate.port || candidate.address,
      sdpMLineIndex: candidate.sdpMLineIndex,
    };
  });
}

type DetailBuilder = (this: any, args: any[]) => Record<string, any> | void;

function hookMethod(target: any, methodName: string, category: FingerprintCategory, fullApiName: string, detailBuilder?: DetailBuilder) {
  if (!target || typeof target[methodName] !== 'function') {
    return;
  }

  const original = target[methodName];
  if ((original as any).__irobot_hooked__) {
    return;
  }

  const wrapped = function (this: any, ...args: any[]) {
    const startTime = performance.now();
    let result: any;
    let error: any;
    let modified = false;
    
    // 检查是否有匹配的修改规则 - 使用完整API名称
    const matchedRule = findMatchingMockRule(fullApiName);
    
    try {
      result = original.apply(this, args);
      
      // 如果有匹配的修改规则，替换返回值
      if (matchedRule && !error) {
        const mockResponse = matchedRule.response;
        
        // 如果原始返回值是Promise，需要特殊处理
        if (result instanceof Promise) {
          result = result.then(() => {
            // 解析mock响应
            const parsedResponse = typeof mockResponse === 'string' 
              ? (mockResponse.startsWith('{') || mockResponse.startsWith('[') 
                  ? JSON.parse(mockResponse) 
                  : mockResponse)
              : mockResponse;
            
            console.log(`[Injector] 修改了 ${fullApiName} 的返回值:`, parsedResponse);
            return parsedResponse;
          });
        } else {
          // 同步返回值直接替换
          const parsedResponse = typeof mockResponse === 'string' 
            ? (mockResponse.startsWith('{') || mockResponse.startsWith('[') 
                ? JSON.parse(mockResponse) 
                : mockResponse)
            : mockResponse;
          
          result = parsedResponse;
          console.log(`[Injector] 修改了 ${fullApiName} 的返回值:`, result);
        }
        modified = true;
      }
    } catch (e) {
      error = e;
      throw e;
    } finally {
      try {
        const duration = performance.now() - startTime;
        const detailResult = detailBuilder ? detailBuilder.call(this, args) : undefined;
        const detail = detailResult === undefined ? {} : detailResult;
        
        // 序列化输入参数
        const input = serializeValue(args);
        
        // 序列化输出结果
        let output: any;
        if (error) {
          output = { error: error.message || String(error) };
        } else if (result instanceof Promise) {
          // 异步结果，等待 Promise 完成后再上报
          result.then(
            (resolvedValue) => {
              reportFingerprintEvent(category, fullApiName, {
                ...detail,
                duration,
                input,
                output: serializeValue(resolvedValue),
              });
            },
            (rejectedError) => {
              reportFingerprintEvent(category, fullApiName, {
                ...detail,
                duration,
                input,
                output: { error: rejectedError.message || String(rejectedError) },
              });
            }
          );
          return result;
        } else {
          output = serializeValue(result);
        }
        
        reportFingerprintEvent(category, fullApiName, {
          ...detail,
          duration,
          input,
          output,
        });
      } catch (reportError) {
        console.error('[Injector] Hook 上报异常:', fullApiName, reportError);
      }
    }
    
    return result;
  };

  Object.defineProperty(wrapped, '__irobot_hooked__', {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });

  Object.defineProperty(target, methodName, {
    value: wrapped,
    configurable: true,
    writable: true,
  });
}

function serializeValue(value: any, maxDepth = 3, currentDepth = 0): any {
  if (currentDepth > maxDepth) {
    return '[Max Depth Reached]';
  }
  
  if (value === null || value === undefined) {
    return value;
  }
  
  const type = typeof value;
  
  if (type === 'function') {
    return `[Function: ${value.name || 'anonymous'}]`;
  }
  
  if (type === 'symbol') {
    return `[Symbol: ${value.toString()}]`;
  }
  
  if (type !== 'object') {
    return value;
  }
  
  // 特殊对象处理
  if (value instanceof HTMLCanvasElement) {
    return `[HTMLCanvasElement: ${value.width}x${value.height}]`;
  }
  
  if (value instanceof HTMLElement) {
    return `[HTMLElement: ${value.tagName}]`;
  }
  
  if (value instanceof Error) {
    return { error: value.message, stack: value.stack?.split('\n').slice(0, 3).join('\n') };
  }
  
  if (Array.isArray(value)) {
    if (value.length > 10) {
      return [...value.slice(0, 10).map(v => serializeValue(v, maxDepth, currentDepth + 1)), `... ${value.length - 10} more items`];
    }
    return value.map(v => serializeValue(v, maxDepth, currentDepth + 1));
  }
  
  // 普通对象
  try {
    const serialized: any = {};
    const keys = Object.keys(value);
    
    if (keys.length > 20) {
      keys.slice(0, 20).forEach(key => {
        serialized[key] = serializeValue(value[key], maxDepth, currentDepth + 1);
      });
      serialized['...'] = `${keys.length - 20} more properties`;
    } else {
      keys.forEach(key => {
        serialized[key] = serializeValue(value[key], maxDepth, currentDepth + 1);
      });
    }
    
    return serialized;
  } catch (e) {
    return '[Unserializable Object]';
  }
}

function summarizeRtcConfiguration(config?: RTCConfiguration) {
  if (!config) {
    return undefined;
  }
  return {
    iceServerCount: Array.isArray(config.iceServers) ? config.iceServers.length : 0,
    bundlePolicy: config.bundlePolicy,
    rtcpMuxPolicy: config.rtcpMuxPolicy,
    iceTransportPolicy: config.iceTransportPolicy,
  };
}

function captureStack(maxDepth = 8) {
  try {
    const err = new Error();
    if (!err.stack) {
      return undefined;
    }
    const lines = err.stack.split('\n').slice(2, 2 + maxDepth);
    return lines.join('\n');
  } catch {
    return undefined;
  }
}

function truncateText(value: any, maxLength = 60) {
  if (value === undefined || value === null) {
    return undefined;
  }
  const text = String(value);
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...(${text.length})`;
}

// ============= Audio Fingerprinting =============
function hookAudioApis() {
  if (typeof AudioContext === 'undefined' && typeof (window as any).webkitAudioContext === 'undefined') {
    return;
  }

  const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) return;

  // Hook AudioContext 构造函数
  const OriginalAudioContext = AudioCtx;
  const AudioContextProxy = new Proxy(OriginalAudioContext, {
    construct(target, args) {
      reportFingerprintEvent('audio', 'AudioContext', {
        sampleRate: args[0]?.sampleRate,
        latencyHint: args[0]?.latencyHint,
      });
      return Reflect.construct(target, args);
    },
  });

  if ((window as any).AudioContext) {
    (window as any).AudioContext = AudioContextProxy;
  }
  if ((window as any).webkitAudioContext) {
    (window as any).webkitAudioContext = AudioContextProxy;
  }

  // Hook AudioContext 关键方法
  const proto = OriginalAudioContext.prototype;
  if (proto) {
    hookMethod(proto, 'createOscillator', 'audio', 'AudioContext.prototype.createOscillator');
    hookMethod(proto, 'createAnalyser', 'audio', 'AudioContext.prototype.createAnalyser');
    hookMethod(proto, 'createDynamicsCompressor', 'audio', 'AudioContext.prototype.createDynamicsCompressor');
    hookMethod(proto, 'createScriptProcessor', 'audio', 'AudioContext.prototype.createScriptProcessor', (args) => ({
      bufferSize: args[0],
      numberOfInputChannels: args[1],
      numberOfOutputChannels: args[2],
    }));
  }

  // Hook OfflineAudioContext（常用于音频指纹）
  if (typeof OfflineAudioContext !== 'undefined') {
    const OriginalOfflineAudioContext = OfflineAudioContext;
    const OfflineAudioContextProxy = new Proxy(OriginalOfflineAudioContext, {
      construct(target, args) {
        reportFingerprintEvent('audio', 'OfflineAudioContext', {
          numberOfChannels: args[0],
          length: args[1],
          sampleRate: args[2],
        });
        return Reflect.construct(target, args);
      },
    });
    (window as any).OfflineAudioContext = OfflineAudioContextProxy;
  }
}

// ============= Screen Fingerprinting =============
function hookScreenApis() {
  // Screen 属性通常通过 getter 访问，我们 Hook 常见的属性读取
  const screenProps = ['width', 'height', 'availWidth', 'availHeight', 'colorDepth', 'pixelDepth'];
  
  screenProps.forEach((prop) => {
    try {
      const original = Object.getOwnPropertyDescriptor(Screen.prototype, prop);
      if (!original || !original.get) return;

      // 保存原始 getter
      const originalGet = original.get;

      Object.defineProperty(Screen.prototype, prop, {
        get() {
          const value = originalGet!.call(this);
          reportFingerprintEvent('screen', `screen.${prop}`, {
            value,
          });
          return value;
        },
        configurable: true,
        enumerable: original.enumerable,
      });
    } catch (e) {
      console.warn(`[Injector] 无法 Hook screen.${prop}:`, e);
    }
  });
}

// ============= Navigator Fingerprinting =============
function hookNavigatorApis() {
  const sensitiveProps = [
    'userAgent',
    'platform',
    'language',
    'languages',
    'hardwareConcurrency',
    'deviceMemory',
    'maxTouchPoints',
    'vendor',
    'doNotTrack',
  ];

  sensitiveProps.forEach((prop) => {
    try {
      const original = Object.getOwnPropertyDescriptor(Navigator.prototype, prop) ||
                       Object.getOwnPropertyDescriptor(window.navigator, prop);
      if (!original || !original.get) return;

      // 保存原始 getter
      const originalGet = original.get;
      
      const descriptor: PropertyDescriptor = {
        get() {
          const value = originalGet!.call(this);
          reportFingerprintEvent('navigator', `navigator.${prop}`, {
            value: typeof value === 'object' ? JSON.stringify(value) : value,
          });
          return value;
        },
        configurable: true,
      };

      if (original.enumerable !== undefined) {
        descriptor.enumerable = original.enumerable;
      }

      Object.defineProperty(Navigator.prototype, prop, descriptor);
    } catch (e) {
      console.warn(`[Injector] 无法 Hook navigator.${prop}:`, e);
    }
  });

  // Hook plugins（插件检测）
  try {
    const originalPluginsDescriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'plugins');
    if (originalPluginsDescriptor && originalPluginsDescriptor.get) {
      const originalPluginsGet = originalPluginsDescriptor.get;
      
      Object.defineProperty(Navigator.prototype, 'plugins', {
        get() {
          // 使用原始 getter 获取值，避免递归
          const pluginsObj = originalPluginsGet.call(this);
          reportFingerprintEvent('navigator', 'navigator.plugins', {
            count: pluginsObj?.length || 0,
          });
          return pluginsObj;
        },
        configurable: true,
        enumerable: originalPluginsDescriptor.enumerable,
      });
    }
  } catch (e) {
    console.warn('[Injector] 无法 Hook navigator.plugins:', e);
  }
}

// ============= MediaDevices Fingerprinting =============
function hookMediaDevicesApis() {
  if (!navigator.mediaDevices) return;

  // Hook enumerateDevices（设备枚举）
  const proto = Object.getPrototypeOf(navigator.mediaDevices);
  if (proto && proto.enumerateDevices) {
    const original = proto.enumerateDevices;
    proto.enumerateDevices = async function () {
      reportFingerprintEvent('media', 'MediaDevices.prototype.enumerateDevices', undefined);
      const result = await original.apply(this, arguments as any);
      reportFingerprintEvent('media', 'MediaDevices.prototype.enumerateDevices.result', {
        deviceCount: result.length,
        kinds: result.map((d: MediaDeviceInfo) => d.kind),
      });
      return result;
    };
  }

  // Hook getUserMedia
  if (proto && proto.getUserMedia) {
    const original = proto.getUserMedia;
    proto.getUserMedia = function (constraints: MediaStreamConstraints) {
      reportFingerprintEvent('media', 'MediaDevices.prototype.getUserMedia', {
        audio: typeof constraints?.audio,
        video: typeof constraints?.video,
      });
      return original.apply(this, arguments as any);
    };
  }
}

// ============= Battery Fingerprinting =============
function hookBatteryApis() {
  const nav = navigator as any;
  if (!nav.getBattery) return;

  const original = nav.getBattery;
  nav.getBattery = async function () {
    reportFingerprintEvent('battery', 'navigator.getBattery', undefined);
    const battery = await original.apply(this, arguments as any);
    reportFingerprintEvent('battery', 'navigator.getBattery.result', {
      charging: battery.charging,
      level: battery.level,
      chargingTime: battery.chargingTime,
      dischargingTime: battery.dischargingTime,
    });
    return battery;
  };
}

// ============= Performance Fingerprinting =============
function hookPerformanceApis() {
  if (!window.performance) return;

  // Hook performance.memory (Chrome)
  const memoryDescriptor = Object.getOwnPropertyDescriptor(Performance.prototype, 'memory');
  if (memoryDescriptor?.get) {
    Object.defineProperty(Performance.prototype, 'memory', {
      get() {
        reportFingerprintEvent('performance', 'performance.memory', undefined);
        return memoryDescriptor.get!.call(this);
      },
      configurable: true,
    });
  }

  // Hook getEntriesByType（可用于性能指纹）
  if (performance.getEntriesByType) {
    const original = performance.getEntriesByType;
    (performance as any).getEntriesByType = function (type: string) {
      reportFingerprintEvent('performance', 'performance.getEntriesByType', { type });
      return original.apply(this, arguments as any);
    };
  }
}

console.log('✅ iRobot 指纹监控脚本已加载');

