// packages/injector/src/monitor.ts
// 这个脚本会被注入到目标网页，用于监控其指纹采集行为

export {};

declare global {
  interface Window {
    __IROBOT_MONITOR_LOADED__?: boolean;
  }
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
}

const WEBSOCKET_URL = 'WS_URL_PLACEHOLDER';
const MESSAGE_QUEUE_LIMIT = 500;

const pendingMessages: string[] = [];
let ws: WebSocket | null = null;
let reconnectTimer: number | null = null;

// 快照缓存
const snapshotCache = new WeakMap<HTMLCanvasElement | OffscreenCanvas, string>();

// 保存原始方法，避免递归调用
let originalToDataURL: ((type?: string, quality?: any) => string) | null = null;

if (window.__IROBOT_MONITOR_LOADED__) {
  console.log('[Injector] 指纹 Hook 已存在，跳过重复注入');
} else {
  window.__IROBOT_MONITOR_LOADED__ = true;
  console.log('[Injector] 指纹 Hook 初始化');
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
  
  const payload: FingerprintEventPayload = {
    category,
    api,
    detail,
    url: window.location.href,
    stack: captureStack(),
    eventHash,
  };
  sendMessage('FINGERPRINT_EVENT', payload);
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
    hookMethod(canvasProto, 'toDataURL', 'canvas', function (args) {
      return buildCanvasDetail(this as HTMLCanvasElement, args, 'toDataURL', true);
    });
    
    // toBlob 也是明确的指纹采集信号
    hookMethod(canvasProto, 'toBlob', 'canvas', function (args) {
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
    hookMethod(ctxProto, 'getImageData', 'canvas', function (args) {
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
    hookMethod(offscreenProto, 'convertToBlob', 'canvas', function (args) {
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
  // measureText 太频繁，不监控
  // if (typeof CanvasRenderingContext2D !== 'undefined') {
  //   const ctxProto = CanvasRenderingContext2D.prototype;
  //   hookMethod(ctxProto, 'measureText', 'font', function (args) {
  //     return {
  //       text: truncateText(args[0]),
  //       font: (this as CanvasRenderingContext2D).font,
  //     };
  //   });
  // }

  // 只监控明确的字体检测行为
  const fontSetProto = getFontFaceSetPrototype();
  if (fontSetProto) {
    hookMethod(fontSetProto, 'check', 'font', (args) => {
      return {
        font: args[0],
        sample: truncateText(args[1]),
      };
    });
    hookMethod(fontSetProto, 'load', 'font', (args) => {
      return {
        font: args[0],
        sample: truncateText(args[1]),
      };
    });
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
  const prototypes: any[] = [];
  if (typeof WebGLRenderingContext !== 'undefined') {
    prototypes.push(WebGLRenderingContext.prototype);
  }
  if (typeof WebGL2RenderingContext !== 'undefined') {
    prototypes.push(WebGL2RenderingContext.prototype);
  }

  prototypes.forEach((proto) => {
    // getParameter 是关键的指纹采集方法
    hookMethod(proto, 'getParameter', 'webgl', (args) => ({ parameter: args[0] }));
    
    // getExtension 用于检测支持的扩展
    hookMethod(proto, 'getExtension', 'webgl', (args) => ({ name: args[0] }));
    
    // getSupportedExtensions 是明确的指纹采集
    hookMethod(proto, 'getSupportedExtensions', 'webgl');
    
    // readPixels 可能频繁调用，不捕获快照
    hookMethod(proto, 'readPixels', 'webgl', function (args) {
      return {
        x: args[0],
        y: args[1],
        width: args[2],
        height: args[3],
        format: args[4],
        type: args[5],
        // 不捕获快照，readPixels 可能被频繁调用
      };
    });
  });
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
  hookMethod(proto, 'createDataChannel', 'webrtc', (args) => ({
    label: args[0],
    ordered: args[1]?.ordered,
    negotiated: args[1]?.negotiated,
    protocol: args[1]?.protocol,
  }));
  hookMethod(proto, 'createOffer', 'webrtc', (args) => ({
    hasOptions: Boolean(args[0]),
    optionKeys: args[0] ? Object.keys(args[0]) : [],
  }));
  hookMethod(proto, 'createAnswer', 'webrtc', (args) => ({
    hasOptions: Boolean(args[0]),
    optionKeys: args[0] ? Object.keys(args[0]) : [],
  }));
  hookMethod(proto, 'setLocalDescription', 'webrtc', (args) => {
    const desc = args[0];
    if (!desc) {
      return undefined;
    }
    return {
      type: desc.type,
      sdpLength: desc.sdp ? desc.sdp.length : 0,
    };
  });
  hookMethod(proto, 'addIceCandidate', 'webrtc', (args) => {
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

function hookMethod(target: any, methodName: string, category: FingerprintCategory, detailBuilder?: DetailBuilder) {
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
    
    try {
      result = original.apply(this, args);
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
              reportFingerprintEvent(category, String(methodName), {
                ...detail,
                duration,
                input,
                output: serializeValue(resolvedValue),
              });
            },
            (rejectedError) => {
              reportFingerprintEvent(category, String(methodName), {
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
        
        reportFingerprintEvent(category, String(methodName), {
          ...detail,
          duration,
          input,
          output,
        });
      } catch (reportError) {
        console.error('[Injector] Hook 上报异常:', methodName, reportError);
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
    hookMethod(proto, 'createOscillator', 'audio');
    hookMethod(proto, 'createAnalyser', 'audio');
    hookMethod(proto, 'createDynamicsCompressor', 'audio');
    hookMethod(proto, 'createScriptProcessor', 'audio', (args) => ({
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
      reportFingerprintEvent('media', 'enumerateDevices', undefined);
      const result = await original.apply(this, arguments as any);
      reportFingerprintEvent('media', 'enumerateDevices.result', {
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
      reportFingerprintEvent('media', 'getUserMedia', {
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
    reportFingerprintEvent('battery', 'getBattery', undefined);
    const battery = await original.apply(this, arguments as any);
    reportFingerprintEvent('battery', 'getBattery.result', {
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
      reportFingerprintEvent('performance', 'getEntriesByType', { type });
      return original.apply(this, arguments as any);
    };
  }
}

console.log('✅ iRobot 指纹监控脚本已加载');

