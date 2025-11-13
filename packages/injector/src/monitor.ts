// packages/injector/src/monitor.ts
// 这个文件包含将被注入到页面中的监控脚本

declare global {
  interface Window {
    _fetch: typeof fetch;
    _XMLHttpRequest: typeof XMLHttpRequest;
  }
}

function getWebSocket(wsUrl: string) {
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[Injector] WebSocket 连接已建立');
  };

  ws.onerror = (error) => {
    console.error('[Injector] WebSocket 错误:', error);
  };

  ws.onclose = () => {
    console.log('[Injector] WebSocket 连接已关闭');
  };
  
  return ws;
}

// 注意：这个变量会在注入时被替换
const WEBSOCKET_URL = 'WS_URL_PLACEHOLDER';
const ws = getWebSocket(WEBSOCKET_URL);

function sendMessage(type: string, data: any) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, data, timestamp: new Date().toISOString() }));
  } else {
    console.warn('[Injector] WebSocket 未连接，消息未发送:', type);
  }
}

// --- Fetch Interception ---
window._fetch = window.fetch;
window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const req = new Request(input, init);
  const { method, url } = req;
  
  sendMessage('FETCH_REQUEST', {
    method,
    url,
    headers: Object.fromEntries(req.headers.entries()),
  });

  try {
    const response = await window._fetch(req);
    const responseClone = response.clone();
    
    sendMessage('FETCH_RESPONSE', {
      url,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
    });
    
    return responseClone;
  } catch (error) {
    sendMessage('FETCH_ERROR', {
      url,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

// --- XMLHttpRequest Interception ---
window._XMLHttpRequest = window.XMLHttpRequest;

class MonitoredXMLHttpRequest extends window._XMLHttpRequest {
  private _method: string | undefined;
  private _url: string | undefined;

  open(method: string, url: string | URL): void;
  open(method: string, url: string | URL, async: boolean, username?: string | null, password?: string | null): void;
  open(method: any, url: any, async?: any, username?: any, password?: any) {
    this._method = method;
    this._url = url.toString();
    super.open(method, url, async, username, password);
  }

  send(body?: Document | XMLHttpRequestBodyInit | null): void {
    sendMessage('XHR_REQUEST', {
      method: this._method,
      url: this._url,
      body: body,
    });
    
    this.addEventListener('load', () => {
      sendMessage('XHR_RESPONSE', {
        url: this._url,
        status: this.status,
        statusText: this.statusText,
        response: this.responseText,
      });
    });

    this.addEventListener('error', () => {
      sendMessage('XHR_ERROR', {
        url: this._url,
        status: this.status,
        statusText: this.statusText,
      });
    });

    super.send(body);
  }
}

window.XMLHttpRequest = MonitoredXMLHttpRequest as any;

console.log('✅ iRobot 监控脚本已加载，API 调用正在被监控');

