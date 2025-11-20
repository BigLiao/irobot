<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

interface Log {
  type: string;
  data: any;
  timestamp: string;
  count?: number; // 调用次数
  eventHash?: string; // 事件哈希，用于去重
  modified?: boolean; // 是否被修改过
  stacks?: { timestamp: string; content: string }[]; // 调用栈历史
  selectedStackIndex?: number; // 当前选中的调用栈索引
}

interface MockRule {
  id: string;
  match: {
    api: string; // API名称完整匹配
    // 未来可扩展: input?: any; // 入参匹配
  };
  response: any; // 返回数据
  enabled: boolean; // 是否启用
}

const logs = ref<Log[]>([]);
const eventHashMap = new Map<string, number>(); // eventHash -> logs数组索引
const targetUrl = ref('https://www.baidu.com');
const isMonitoring = ref(false);
const wsConnected = ref(false);
const selectedCategory = ref<string>('all');
const activeTab = ref<'intercept' | 'mock' | 'cookie'>('intercept');
const mockRules = ref<MockRule[]>([]);
const editingRule = ref<MockRule | null>(null);
const showRuleEditor = ref(false);
const availableScripts = ref<string[]>([]);
const selectedScript = ref<string>('');

// URL历史记录 - 最多保存5个
const urlHistory = ref<string[]>([]);
const HISTORY_KEY = 'irobot_url_history';
const MAX_HISTORY = 5;

// 从localStorage加载历史记录
function loadUrlHistory() {
  try {
    const saved = localStorage.getItem(HISTORY_KEY);
    if (saved) {
      urlHistory.value = JSON.parse(saved);
    }
  } catch (error) {
    console.error('加载URL历史失败:', error);
    urlHistory.value = [];
  }
}

// 保存URL到历史记录
function saveUrlToHistory(url: string) {
  if (!url || !url.trim()) return;
  
  // 移除已存在的相同URL
  urlHistory.value = urlHistory.value.filter(u => u !== url);
  
  // 添加到开头
  urlHistory.value.unshift(url);
  
  // 限制数量
  if (urlHistory.value.length > MAX_HISTORY) {
    urlHistory.value = urlHistory.value.slice(0, MAX_HISTORY);
  }
  
  // 保存到localStorage
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(urlHistory.value));
  } catch (error) {
    console.error('保存URL历史失败:', error);
  }
}

// 快速填充URL
function fillUrl(url: string) {
  targetUrl.value = url;
}

// 删除历史记录
function removeFromHistory(url: string) {
  urlHistory.value = urlHistory.value.filter(u => u !== url);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(urlHistory.value));
  } catch (error) {
    console.error('删除URL历史失败:', error);
  }
}

const categories = computed(() => {
  const categoryCount: Record<string, number> = {
    all: logs.value.length,
  };

  logs.value.forEach((log) => {
    if (log.type === 'FINGERPRINT_EVENT' && log.data?.category) {
      const cat = log.data.category;
      categoryCount[cat] = (categoryCount[cat] || 0) + 1;
    }
  });

  return categoryCount;
});

const filteredLogs = computed(() => {
  if (selectedCategory.value === 'all') {
    return logs.value;
  }
  return logs.value.filter(
    (log) => log.type === 'FINGERPRINT_EVENT' && log.data?.category === selectedCategory.value
  );
});

function getCategoryIcon(category: string): string {
  const icons: Record<string, string> = {
    canvas: '🎨',
    webgl: '🖼️',
    font: '🔤',
    webrtc: '📡',
    audio: '🔊',
    screen: '🖥️',
    navigator: '🧭',
    media: '📹',
    battery: '🔋',
    performance: '⚡',
    cookie: '🍪',
    all: '📊',
  };
  return icons[category] || '📋';
}

let ws: WebSocket | null = null;

const connectWebSocket = () => {
  ws = new WebSocket('ws://localhost:3000/dashboard');

  ws.onopen = () => {
    console.log('Dashboard WebSocket 连接已建立');
    wsConnected.value = true;
  };

  ws.onmessage = (event) => {
    try {
      const log = JSON.parse(event.data);
      
      // 处理特殊消息类型
      if (log.type === 'MONITOR_STARTED') {
        isMonitoring.value = true;
        logs.value.unshift({
          type: 'SYSTEM',
          data: { message: `开始监控: ${log.url}` },
          timestamp: log.timestamp
        });
      } else if (log.type === 'MONITOR_STOPPED') {
        isMonitoring.value = false;
        logs.value.unshift({
          type: 'SYSTEM',
          data: { message: '监控已停止', reason: log.reason },
          timestamp: log.timestamp
        });
      } else if (log.type === 'ERROR') {
        logs.value.unshift({
          type: 'ERROR',
          data: { message: log.message },
          timestamp: log.timestamp
        });
      } else if (log.type === 'FINGERPRINT_MONITOR_READY') {
        logs.value.unshift({
          type: 'SYSTEM',
          data: { message: log.data?.message || '指纹 Hook 已启用' },
          timestamp: log.timestamp
        });
        // 发送修改规则到injector
        sendMockRules();
      } else if (log.type === 'FINGERPRINT_EVENT' && log.data?.eventHash) {
        // 指纹事件：根据 eventHash 去重和计数
        const eventHash = log.data.eventHash;
        const existingIndex = eventHashMap.get(eventHash);
        
        if (existingIndex !== undefined && logs.value[existingIndex]) {
          // 已存在相同事件，增加计数
          const existingLog = logs.value[existingIndex];
          existingLog.count = (existingLog.count || 1) + 1;
          existingLog.timestamp = log.timestamp; // 更新最后调用时间
          
          // 添加新的调用栈到历史记录
          if (log.data.stack) {
            if (!existingLog.stacks) {
              existingLog.stacks = [];
              // 如果之前没有stacks数组，把当前的stack放进去作为第一个
              if (existingLog.data.stack) {
                existingLog.stacks.push({
                  timestamp: existingLog.timestamp, // 注意这里可能时间不准，但作为初始值尚可
                  content: existingLog.data.stack
                });
              }
            }
            existingLog.stacks.push({
              timestamp: log.timestamp,
              content: log.data.stack
            });
            // 限制堆栈历史数量，防止内存无限增长
            if (existingLog.stacks.length > 50) {
              existingLog.stacks.shift();
            }
            // 自动选择最新的堆栈
            existingLog.selectedStackIndex = existingLog.stacks.length - 1;
          }

          // 更新modified标记
          if (log.data?.modified) {
            existingLog.modified = true;
          }
        } else {
          // 新事件，添加到列表
          const newLog: Log = {
            ...log,
            count: 1,
            eventHash,
            modified: log.data?.modified || false,
            stacks: log.data.stack ? [{
              timestamp: log.timestamp,
              content: log.data.stack
            }] : [],
            selectedStackIndex: 0
          };
          logs.value.unshift(newLog);
          // 更新 hash 映射（索引会因为 unshift 而改变，需要重建）
          rebuildHashMap();
        }
      } else {
        logs.value.unshift(log);
      }
      
      // 限制日志数量
      if (logs.value.length > 1000) {
        logs.value = logs.value.slice(0, 1000);
        rebuildHashMap(); // 重建索引
      }
    } catch (error) {
      console.error('解析 WebSocket 消息错误:', error);
    }
  };

  ws.onerror = (error) => {
    console.error('Dashboard WebSocket 错误:', error);
    wsConnected.value = false;
  };

  ws.onclose = () => {
    console.log('Dashboard WebSocket 连接已关闭');
    wsConnected.value = false;
    
    // 3秒后重连
    setTimeout(() => {
      if (!ws || ws.readyState === WebSocket.CLOSED) {
        console.log('尝试重新连接...');
        connectWebSocket();
      }
    }, 3000);
  };
};

const startMonitoring = () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    // 保存URL到历史记录
    saveUrlToHistory(targetUrl.value);
    
    ws.send(JSON.stringify({
      type: 'START_MONITOR',
      url: targetUrl.value,
      script: selectedScript.value
    }));
  } else {
    alert('WebSocket 未连接，请稍后重试');
  }
};

const stopMonitoring = () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'STOP_MONITOR'
    }));
  }
};

const clearLogs = () => {
  logs.value = [];
  eventHashMap.clear();
};

// 重建 eventHash 索引映射
function rebuildHashMap() {
  eventHashMap.clear();
  logs.value.forEach((log, index) => {
    if (log.eventHash) {
      eventHashMap.set(log.eventHash, index);
    }
  });
}

function getLogClass(log: Log): string {
  if (log.type === 'FINGERPRINT_EVENT' && log.data?.category) {
    return `log-fingerprint log-fingerprint-${log.data.category}`;
  }
  return `log-${log.type.toLowerCase()}`;
}

function hasOtherDetails(detail: any): boolean {
  if (!detail) return false;
  const excludeKeys = ['input', 'output', 'snapshot', 'duration', 'width', 'height'];
  return Object.keys(detail).some(key => !excludeKeys.includes(key));
}

function getOtherDetails(detail: any): any {
  if (!detail) return {};
  const excludeKeys = ['input', 'output', 'snapshot', 'duration', 'width', 'height'];
  const result: any = {};
  Object.keys(detail).forEach(key => {
    if (!excludeKeys.includes(key)) {
      result[key] = detail[key];
    }
  });
  return result;
}

function formatDataSize(dataUrl: string): string {
  const bytes = new Blob([dataUrl]).size;
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function getImageFormat(dataUrl: string): string {
  if (!dataUrl) return 'Unknown';
  const match = dataUrl.match(/^data:image\/(\w+);base64,/);
  return match && match[1] ? match[1].toUpperCase() : 'Unknown';
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    alert('已复制到剪贴板');
  } catch (err) {
    console.error('复制失败:', err);
    alert('复制失败');
  }
}

function openImagePreview(dataUrl: string) {
  const win = window.open('', '_blank');
  if (win) {
    win.document.write(`
      <html>
        <head><title>Canvas 快照预览</title></head>
        <body style="margin:0;display:flex;align-items:center;justify-content:center;background:#000;">
          <img src="${dataUrl}" style="max-width:100%;max-height:100vh;"/>
        </body>
      </html>
    `);
  }
}

// ============= 修改规则管理 =============
function createMockRule(api: string = '', response: any = '') {
  editingRule.value = {
    id: Date.now().toString(),
    match: { api },
    response,
    enabled: true,
  };
  showRuleEditor.value = true;
  activeTab.value = 'mock';
}

function editMockRule(rule: MockRule) {
  editingRule.value = { ...rule };
  showRuleEditor.value = true;
}

function saveMockRule() {
  if (!editingRule.value) return;
  
  try {
    // 验证response是否为有效JSON
    if (typeof editingRule.value.response === 'string') {
      JSON.parse(editingRule.value.response);
    }
    
    const index = mockRules.value.findIndex(r => r.id === editingRule.value!.id);
    if (index !== -1) {
      mockRules.value[index] = { ...editingRule.value };
    } else {
      mockRules.value.push({ ...editingRule.value });
    }
    
    showRuleEditor.value = false;
    editingRule.value = null;
    
    // 发送更新后的规则到服务器
    sendMockRules();
  } catch (error) {
    alert('Response 格式错误，请输入有效的 JSON');
  }
}

function deleteMockRule(id: string) {
  if (confirm('确定删除此规则？')) {
    mockRules.value = mockRules.value.filter(r => r.id !== id);
    sendMockRules();
  }
}

function toggleMockRule(rule: MockRule) {
  rule.enabled = !rule.enabled;
  sendMockRules();
}

function cancelEditRule() {
  showRuleEditor.value = false;
  editingRule.value = null;
}

function quickMockFromLog(log: Log) {
  if (log.type !== 'FINGERPRINT_EVENT' || !log.data?.api) return;
  
  const api = log.data.api;
  const output = log.data.detail?.output;
  
  createMockRule(api, output ? JSON.stringify(output, null, 2) : '');
}

function sendMockRules() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const enabledRules = mockRules.value.filter(r => r.enabled);
    ws.send(JSON.stringify({
      type: 'UPDATE_MOCK_RULES',
      rules: enabledRules
    }));
    console.log('发送修改规则:', enabledRules);
  }
}

// 获取可用的自定义脚本列表
async function fetchAvailableScripts() {
  try {
    const response = await fetch('http://localhost:3000/api/scripts');
    const data = await response.json();
    availableScripts.value = data.scripts || [];
  } catch (error) {
    console.error('获取脚本列表失败:', error);
  }
}

onMounted(() => {
  connectWebSocket();
  loadUrlHistory(); // 加载URL历史记录
  // 从localStorage恢复修改规则
  const savedRules = localStorage.getItem('irobot_mock_rules');
  if (savedRules) {
    try {
      mockRules.value = JSON.parse(savedRules);
    } catch (error) {
      console.error('恢复修改规则失败:', error);
    }
  }
  // 获取可用的脚本列表
  fetchAvailableScripts();
  // 从localStorage恢复选定的脚本
  const savedScript = localStorage.getItem('irobot_selected_script');
  if (savedScript) {
    selectedScript.value = savedScript;
  }
});

onUnmounted(() => {
  if (ws) {
    ws.close();
  }
  // 保存修改规则到localStorage
  localStorage.setItem('irobot_mock_rules', JSON.stringify(mockRules.value));
  // 保存选定的脚本到localStorage
  localStorage.setItem('irobot_selected_script', selectedScript.value);
});
// ============= Cookie 模块 =============
const cookieLogs = computed(() => {
  return logs.value.filter(
    (log) =>
      (log.type === 'FINGERPRINT_EVENT' && log.data?.category === 'cookie') ||
      (log.type === 'HTTP_SET_COOKIE')
  );
});

function getCookieDiff(currentLog: Log, index: number) {
  // 找到上一个 cookie log (在 filteredLogs 中是下一个，因为是倒序)
  // 注意：这里应该在所有 logs 中找上一个 cookie log，而不是 filteredLogs
  // 但为了简单起见，我们在 cookieLogs 中找
  
  const allCookieLogs = cookieLogs.value;
  // cookieLogs 也是倒序的，所以"上一个"是 index + 1
  const prevLog = allCookieLogs[index + 1];
  
  if (!prevLog) {
    return { type: 'new', diff: [] };
  }
  
  const currentVal = currentLog.data.detail?.value || '';
  const prevVal = prevLog.data.detail?.value || '';
  
  if (currentVal === prevVal) {
    return { type: 'unchanged', diff: [] };
  }
  
  return {
    type: 'changed',
    diff: [
      { label: 'Old', value: prevVal, class: 'diff-old' },
      { label: 'New', value: currentVal, class: 'diff-new' }
    ]
  };
}
</script>

<template>
  <div class="dashboard">
    <header class="header">
      <h1>🤖 iRobot - 网页行为监控系统</h1>
      <div class="status">
        <span class="status-indicator" :class="{ connected: wsConnected }"></span>
        <span>{{ wsConnected ? 'WebSocket 已连接' : 'WebSocket 未连接' }}</span>
      </div>
    </header>

    <div class="control-panel">
      <div class="input-group">
        <label for="url-input">目标网址：</label>
        <input 
          id="url-input"
          v-model="targetUrl" 
          type="text" 
          placeholder="请输入要监控的网址"
          :disabled="isMonitoring"
          @keyup.enter="startMonitoring"
        />
        
        <!-- URL历史记录快捷按钮 -->
        <div v-if="urlHistory.length > 0" class="url-history">
          <div class="history-label">历史记录：</div>
          <div class="history-buttons">
            <button 
              v-for="(url, index) in urlHistory" 
              :key="index"
              class="history-btn"
              @click="fillUrl(url)"
              :title="url"
              :disabled="isMonitoring"
            >
              <span class="history-url">{{ url }}</span>
              <span 
                class="history-remove" 
                @click.stop="removeFromHistory(url)"
                title="删除"
              >×</span>
            </button>
          </div>
        </div>
      </div>

      <div class="input-group">
        <label for="script-select">注入自定义脚本（可选）：</label>
        <select 
          id="script-select"
          v-model="selectedScript" 
          :disabled="isMonitoring"
          class="script-select"
        >
          <option value="">无</option>
          <option v-for="script in availableScripts" :key="script" :value="script">
            {{ script }}
          </option>
        </select>
      </div>
      
      <div class="button-group">
        <button 
          class="btn btn-primary" 
          @click="startMonitoring" 
          :disabled="!wsConnected || isMonitoring || !targetUrl"
        >
          {{ isMonitoring ? '监控中...' : '开始监控' }}
        </button>
        
        <button 
          class="btn btn-danger" 
          @click="stopMonitoring" 
          :disabled="!isMonitoring"
        >
          停止监控
        </button>
        
        <button 
          class="btn btn-secondary" 
          @click="clearLogs"
        >
          清空日志
        </button>
      </div>
      
      <div class="stats">
        <span>日志数量: {{ logs.length }}</span>
        <span v-if="isMonitoring" class="monitoring-badge">● 监控中</span>
      </div>
    </div>

    <div class="tab-container">
      <button 
        class="tab-btn" 
        :class="{ active: activeTab === 'intercept' }"
        @click="activeTab = 'intercept'"
      >
        📡 拦截
      </button>
      <button 
        class="tab-btn" 
        :class="{ active: activeTab === 'mock' }"
        @click="activeTab = 'mock'"
      >
        🔧 修改
      </button>
      <button 
        class="tab-btn" 
        :class="{ active: activeTab === 'cookie' }"
        @click="activeTab = 'cookie'"
      >
        🍪 Cookies
      </button>
    </div>

    <!-- 拦截模块 -->
    <div v-show="activeTab === 'intercept'">
      <div class="category-filter">
        <button
          v-for="(count, cat) in categories"
          :key="cat"
          class="category-btn"
          :class="{ active: selectedCategory === cat }"
          @click="selectedCategory = cat"
        >
          <span class="category-icon">{{ getCategoryIcon(cat) }}</span>
          <span class="category-name">{{ cat === 'all' ? '全部' : cat }}</span>
          <span class="category-count">{{ count }}</span>
        </button>
      </div>

      <div class="logs-container">
      <div v-if="filteredLogs.length === 0" class="empty-state">
        <p>暂无日志记录</p>
        <p class="hint">输入URL并点击"开始监控"按钮开始监控网页行为</p>
      </div>
      
      <div v-for="(log, index) in filteredLogs" :key="index" class="log-entry" :class="getLogClass(log)">
        <div class="log-header">
          <span class="log-type-badge">
            <span v-if="log.type === 'FINGERPRINT_EVENT' && log.data?.category" class="category-badge">
              {{ getCategoryIcon(log.data.category) }} {{ log.data.category }}
            </span>
            <span v-else>{{ log.type }}</span>
          </span>
          <span class="log-timestamp">{{ new Date(log.timestamp).toLocaleTimeString() }}</span>
        </div>

        <div v-if="log.type === 'FINGERPRINT_EVENT'" class="fingerprint-detail">
          <div class="api-info">
            <strong>API:</strong> {{ log.data.api }}
            <span v-if="log.count && log.count > 1" class="call-count-badge">
              调用 {{ log.count }} 次
            </span>
            <span v-if="log.data.detail?.duration" class="duration-badge">
              {{ log.data.detail.duration.toFixed(2) }}ms
            </span>
            <span v-if="log.modified" class="modified-badge">
              ✅ 已修改
            </span>
            <button class="quick-mock-btn" @click="quickMockFromLog(log)" title="快捷添加到修改模块">
              🔧 修改
            </button>
          </div>
          <div v-if="log.data.url" class="url-info">
            <strong>URL:</strong> <span class="url-text">{{ log.data.url }}</span>
          </div>

          <!-- 输入参数 -->
          <details v-if="log.data.detail?.input" class="param-section" open>
            <summary>📥 输入参数</summary>
            <pre class="param-data">{{ JSON.stringify(log.data.detail.input, null, 2) }}</pre>
          </details>

          <!-- 输出结果 -->
          <details v-if="log.data.detail?.output" class="param-section" open>
            <summary>📤 输出结果</summary>
            <pre class="param-data">{{ JSON.stringify(log.data.detail.output, null, 2) }}</pre>
          </details>

          <!-- Canvas 快照 -->
          <div v-if="log.data.detail?.snapshot" class="snapshot-container">
            <div class="snapshot-header">
              <div class="snapshot-label">📸 Canvas 快照</div>
              <div class="snapshot-info">
                <span v-if="log.data.detail?.width">{{ log.data.detail.width }}x{{ log.data.detail.height }}</span>
              </div>
            </div>
            <img :src="log.data.detail.snapshot" alt="Canvas Snapshot" class="canvas-snapshot" @click="openImagePreview(log.data.detail.snapshot)" />
            
            <!-- 原始数据预览 -->
            <details class="snapshot-raw-data">
              <summary>🔍 原始 Base64 数据</summary>
              <div class="raw-data-preview">
                <div class="data-stats">
                  <span>大小: {{ formatDataSize(log.data.detail.snapshot) }}</span>
                  <span>格式: {{ getImageFormat(log.data.detail.snapshot) }}</span>
                </div>
                <textarea class="raw-data-text" :value="log.data.detail.snapshot" readonly></textarea>
                <button class="copy-btn" @click="copyToClipboard(log.data.detail.snapshot)">📋 复制</button>
              </div>
            </details>
          </div>

          <!-- 其他详情 -->
          <details v-if="hasOtherDetails(log.data.detail)" class="param-section">
            <summary>ℹ️ 其他详情</summary>
            <pre class="param-data">{{ JSON.stringify(getOtherDetails(log.data.detail), null, 2) }}</pre>
          </details>

          <!-- 调用栈 -->
          <details v-if="log.data.stack" class="stack-trace">
            <summary>
              📚 调用栈 
              <span v-if="log.stacks && log.stacks.length > 1" class="stack-count-badge">
                {{ log.stacks.length }} 个记录
              </span>
            </summary>
            
            <div v-if="log.stacks && log.stacks.length > 1" class="stack-switcher">
              <div class="stack-controls">
                <label>选择调用记录:</label>
                <select 
                  v-model="log.selectedStackIndex" 
                  @click.stop 
                  class="stack-select"
                >
                  <option 
                    v-for="(stack, i) in log.stacks" 
                    :key="i" 
                    :value="i"
                  >
                    #{{ i + 1 }} - {{ new Date(stack.timestamp).toLocaleTimeString() }}
                  </option>
                </select>
              </div>
              <pre class="stack-content">{{ log.stacks?.[(log.selectedStackIndex || 0)]?.content || '' }}</pre>
              <div class="stack-time">时间: {{ new Date(log.stacks?.[(log.selectedStackIndex || 0)]?.timestamp || log.timestamp).toLocaleTimeString() }}</div>
            </div>
            <pre v-else class="stack-content">{{ log.data.stack }}</pre>
          </details>
        </div>

        <pre v-else class="log-data">{{ JSON.stringify(log.data, null, 2) }}</pre>
      </div>
    </div>
    </div>

    <!-- Cookie 模块 -->
    <div v-show="activeTab === 'cookie'" class="cookie-container">
      <div class="cookie-header">
        <h2>🍪 Cookie 变更记录</h2>
        <span class="cookie-count">共 {{ cookieLogs.length }} 条记录</span>
      </div>

      <div v-if="cookieLogs.length === 0" class="empty-state">
        <p>暂无 Cookie 记录</p>
        <p class="hint">当页面修改 document.cookie 或响应包含 Set-Cookie 时会显示在这里</p>
      </div>

      <div v-else class="cookie-list">
        <div v-for="(log, index) in cookieLogs" :key="index" class="cookie-item">
          <!-- document.cookie 事件展示 -->
          <template v-if="log.type === 'FINGERPRINT_EVENT'">
            <div class="cookie-item-header">
              <span class="cookie-time">{{ new Date(log.timestamp).toLocaleTimeString() }}</span>
              <span class="cookie-action">SET</span>
              <span class="cookie-key">{{ log.data.detail?.parsed?.key }}</span>
            </div>
            
            <div class="cookie-content">
              <div class="cookie-value-row">
                <span class="label">Value:</span>
                <span class="value">{{ log.data.detail?.parsed?.value }}</span>
              </div>
              
              <div v-if="log.data.detail?.parsed?.attributes" class="cookie-attributes">
                <span v-for="(val, key) in log.data.detail.parsed.attributes" :key="key" class="cookie-attr">
                  {{ key }}{{ val === true ? '' : `=${val}` }}
                </span>
              </div>
              
              <!-- Diff View -->
              <div v-if="getCookieDiff(log, index).type === 'changed'" class="cookie-diff">
                <div class="diff-row old">
                  <span class="diff-label">Old:</span>
                  <span class="diff-val">{{ getCookieDiff(log, index).diff?.[0]?.value }}</span>
                </div>
                <div class="diff-row new">
                  <span class="diff-label">New:</span>
                  <span class="diff-val">{{ getCookieDiff(log, index).diff?.[1]?.value }}</span>
                </div>
              </div>
            </div>
            
            <!-- Stack Trace -->
            <details v-if="log.data.stack" class="cookie-stack">
              <summary>📚 调用栈</summary>
              <pre class="stack-content">{{ log.data.stack }}</pre>
            </details>
          </template>

          <!-- HTTP Set-Cookie 响应展示 -->
          <template v-else-if="log.type === 'HTTP_SET_COOKIE'">
            <div class="cookie-item-header">
              <span class="cookie-time">{{ new Date(log.timestamp).toLocaleTimeString() }}</span>
              <span class="cookie-action">HTTP</span>
              <span class="cookie-key">Set-Cookie</span>
            </div>
            <div class="cookie-content">
              <div class="cookie-value-row">
                <span class="label">URL:</span>
                <span class="value">{{ log.data.url }}</span>
              </div>
              <div class="cookie-value-row">
                <span class="label">Value:</span>
                <span class="value">{{ log.data.cookie }}</span>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- 修改模块 -->
    <div v-show="activeTab === 'mock'" class="mock-container">
      <div class="mock-header">
        <h2>返回值修改规则</h2>
        <button class="btn btn-primary" @click="createMockRule()">
          ➕ 新建规则
        </button>
      </div>

      <div v-if="mockRules.length === 0" class="empty-state">
        <p>暂无修改规则</p>
        <p class="hint">点击"新建规则"或在拦截模块中点击"修改"按钮快捷添加</p>
      </div>

      <div v-else class="mock-rules-list">
        <div v-for="rule in mockRules" :key="rule.id" class="mock-rule-item">
          <div class="rule-header">
            <div class="rule-toggle">
              <input 
                type="checkbox" 
                :checked="rule.enabled" 
                @change="toggleMockRule(rule)"
                class="toggle-checkbox"
              />
              <span class="rule-api">{{ rule.match.api }}</span>
            </div>
            <div class="rule-actions">
              <button class="btn-icon" @click="editMockRule(rule)" title="编辑">
                ✏️
              </button>
              <button class="btn-icon" @click="deleteMockRule(rule.id)" title="删除">
                🗑️
              </button>
            </div>
          </div>
          <div class="rule-response">
            <strong>Response:</strong>
            <pre>{{ typeof rule.response === 'string' ? rule.response : JSON.stringify(rule.response, null, 2) }}</pre>
          </div>
        </div>
      </div>

      <!-- 规则编辑器 -->
      <div v-if="showRuleEditor" class="rule-editor-overlay" @click.self="cancelEditRule">
        <div class="rule-editor">
          <h3>{{ editingRule?.id && mockRules.find(r => r.id === editingRule?.id) ? '编辑' : '新建' }}规则</h3>
          
          <div class="form-group">
            <label>API 名称 (完整匹配):</label>
            <input 
              v-model="editingRule!.match.api" 
              type="text" 
              placeholder="例如: toDataURL"
              class="form-input"
            />
          </div>

          <div class="form-group">
            <label>Response (JSON格式):</label>
            <textarea 
              v-model="editingRule!.response" 
              placeholder='例如: "data:image/png;base64,..."'
              class="form-textarea"
              rows="10"
            ></textarea>
            <p class="hint">输入要返回的数据，支持JSON格式</p>
          </div>

          <div class="form-actions">
            <button class="btn btn-primary" @click="saveMockRule">
              保存
            </button>
            <button class="btn btn-secondary" @click="cancelEditRule">
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
* {
  box-sizing: border-box;
}

.dashboard {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
}

.header {
  background: white;
  padding: 20px 30px;
  border-radius: 12px;
  margin-bottom: 20px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header h1 {
  margin: 0;
  color: #333;
  font-size: 28px;
}

.status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: #666;
}

.status-indicator {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background-color: #e74c3c;
  transition: background-color 0.3s;
}

.status-indicator.connected {
  background-color: #2ecc71;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.control-panel {
  background: white;
  padding: 20px 30px;
  border-radius: 12px;
  margin-bottom: 20px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.input-group {
  margin-bottom: 15px;
}

.input-group label {
  display: block;
  margin-bottom: 8px;
  font-weight: 600;
  color: #333;
}

.input-group input {
  width: 100%;
  padding: 12px;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  font-size: 14px;
  transition: border-color 0.3s;
}

.input-group input:focus {
  outline: none;
  border-color: #667eea;
}

.input-group input:disabled {
  background-color: #f5f5f5;
  cursor: not-allowed;
}

/* URL历史记录样式 */
.url-history {
  margin-top: 12px;
  padding: 12px;
  background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
  border-radius: 8px;
  border: 1px solid #dee2e6;
}

.history-label {
  font-size: 12px;
  color: #666;
  margin-bottom: 8px;
  font-weight: 600;
}

.history-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.history-btn {
  display: inline-flex;
  align-items: center;
  padding: 6px 12px;
  background: white;
  border: 1px solid #d0d0d0;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
  max-width: 100%;
  overflow: hidden;
}

.history-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border-color: #667eea;
  transform: translateY(-2px);
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
}

.history-btn:hover:not(:disabled) .history-remove {
  color: white;
  background: rgba(255, 255, 255, 0.2);
}

.history-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.history-url {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 300px;
  text-align: left;
}

.history-remove {
  margin-left: 8px;
  padding: 0 6px;
  background: #e9ecef;
  border-radius: 3px;
  font-size: 16px;
  font-weight: bold;
  color: #6c757d;
  transition: all 0.2s;
  flex-shrink: 0;
}

.history-remove:hover {
  background: #dc3545;
  color: white;
}

.script-select {
  width: 100%;
  padding: 12px;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  font-size: 14px;
  transition: border-color 0.3s;
  background-color: white;
  cursor: pointer;
}

.script-select:focus {
  outline: none;
  border-color: #667eea;
}

.script-select:disabled {
  background-color: #f5f5f5;
  cursor: not-allowed;
}

.button-group {
  display: flex;
  gap: 10px;
  margin-bottom: 15px;
  flex-wrap: wrap;
}

.btn {
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(102, 126, 234, 0.4);
}

.btn-danger {
  background-color: #e74c3c;
  color: white;
}

.btn-danger:hover:not(:disabled) {
  background-color: #c0392b;
  transform: translateY(-2px);
}

.btn-secondary {
  background-color: #95a5a6;
  color: white;
}

.btn-secondary:hover {
  background-color: #7f8c8d;
  transform: translateY(-2px);
}

.stats {
  display: flex;
  gap: 20px;
  align-items: center;
  color: #666;
  font-size: 14px;
}

.monitoring-badge {
  background-color: #2ecc71;
  color: white;
  padding: 4px 12px;
  border-radius: 12px;
  font-weight: 600;
  animation: pulse 2s infinite;
}

.category-filter {
  background: white;
  padding: 15px 20px;
  border-radius: 12px;
  margin-bottom: 20px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.category-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  background: white;
  cursor: pointer;
  transition: all 0.3s;
  font-size: 14px;
}

.category-btn:hover {
  border-color: #667eea;
  background: #f8f9ff;
  transform: translateY(-2px);
}

.category-btn.active {
  border-color: #667eea;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  font-weight: 600;
}

.category-icon {
  font-size: 18px;
}

.category-name {
  text-transform: capitalize;
}

.category-count {
  background: rgba(0, 0, 0, 0.1);
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}

.category-btn.active .category-count {
  background: rgba(255, 255, 255, 0.3);
}

.tab-container {
  background: white;
  padding: 15px 20px;
  border-radius: 12px;
  margin-bottom: 20px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  display: flex;
  gap: 12px;
}

.tab-btn {
  padding: 10px 24px;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  background: white;
  cursor: pointer;
  transition: all 0.3s;
  font-size: 16px;
  font-weight: 600;
}

.tab-btn:hover {
  border-color: #667eea;
  background: #f8f9ff;
}

.tab-btn.active {
  border-color: #667eea;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.logs-container {
  background: white;
  border-radius: 12px;
  padding: 20px;
  height: calc(100vh - 480px);
  overflow-y: auto;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: #999;
}

.empty-state p {
  margin: 10px 0;
  font-size: 16px;
}

.empty-state .hint {
  font-size: 14px;
  color: #bbb;
}

.log-entry {
  margin-bottom: 12px;
  padding: 15px;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
  transition: transform 0.2s, box-shadow 0.2s;
  animation: slideIn 0.3s ease-out;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.log-entry:hover {
  transform: translateX(4px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.log-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
  font-weight: 600;
}

.log-type-badge {
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  display: inline-block;
}

.category-badge {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 4px 10px;
  border-radius: 6px;
  text-transform: capitalize;
}

.log-type {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.log-timestamp {
  font-style: italic;
  color: #999;
  font-size: 12px;
  font-weight: normal;
}

.fingerprint-detail {
  margin-top: 12px;
}

.api-info {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  font-size: 14px;
}

.call-count-badge {
  background: #ff6b6b;
  color: white;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  animation: pulse 1s ease-in-out;
}

@keyframes pulse {
  0% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.05);
  }
  100% {
    transform: scale(1);
  }
}

.duration-badge {
  background: #4caf50;
  color: white;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
}

.modified-badge {
  background: #2ecc71;
  color: white;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  animation: pulse 2s ease-in-out infinite;
}

.quick-mock-btn {
  background: #667eea;
  color: white;
  padding: 4px 12px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  transition: all 0.3s;
}

.quick-mock-btn:hover {
  background: #5568d3;
  transform: translateY(-1px);
}

.url-info {
  margin-bottom: 10px;
  font-size: 14px;
}

.url-text {
  color: #667eea;
  word-break: break-all;
}

.param-section {
  margin: 12px 0;
  background: #f8f9fa;
  border-radius: 6px;
  padding: 10px;
  border: 1px solid #e0e0e0;
}

.param-section summary {
  cursor: pointer;
  font-weight: 600;
  color: #555;
  user-select: none;
  padding: 4px;
  font-size: 13px;
}

.param-section summary:hover {
  color: #667eea;
}

.param-data {
  margin: 8px 0 0 0;
  padding: 10px;
  background: white;
  border-radius: 4px;
  font-size: 12px;
  font-family: 'Courier New', monospace;
  overflow-x: auto;
  color: #333;
  line-height: 1.5;
}

.snapshot-container {
  margin: 15px 0;
  padding: 15px;
  background: #f8f9fa;
  border-radius: 8px;
  border: 2px solid #e0e0e0;
}

.snapshot-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.snapshot-label {
  font-weight: 600;
  color: #333;
  font-size: 14px;
}

.snapshot-info {
  font-size: 12px;
  color: #666;
  font-family: 'Courier New', monospace;
}

.canvas-snapshot {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  border: 1px solid #ddd;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  cursor: zoom-in;
  transition: transform 0.3s;
  display: block;
  margin-bottom: 10px;
}

.canvas-snapshot:hover {
  transform: scale(1.02);
}

.snapshot-raw-data {
  margin-top: 10px;
  background: white;
  border-radius: 6px;
  padding: 8px;
  border: 1px solid #e0e0e0;
}

.snapshot-raw-data summary {
  cursor: pointer;
  font-weight: 600;
  color: #555;
  user-select: none;
  padding: 4px;
  font-size: 12px;
}

.snapshot-raw-data summary:hover {
  color: #667eea;
}

.raw-data-preview {
  margin-top: 8px;
}

.data-stats {
  display: flex;
  gap: 15px;
  margin-bottom: 8px;
  font-size: 12px;
  color: #666;
}

.data-stats span {
  background: #e8f5e9;
  padding: 4px 8px;
  border-radius: 4px;
}

.raw-data-text {
  width: 100%;
  min-height: 80px;
  max-height: 200px;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-family: 'Courier New', monospace;
  font-size: 11px;
  resize: vertical;
  background: #fafafa;
}

.copy-btn {
  margin-top: 8px;
  padding: 6px 12px;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.3s;
}

.copy-btn:hover {
  background: #5568d3;
}

.stack-trace {
  margin-top: 12px;
  background: #f5f5f5;
  border-radius: 6px;
  padding: 10px;
}

.stack-trace summary {
  cursor: pointer;
  font-weight: 600;
  color: #555;
  user-select: none;
  padding: 4px;
}

.stack-trace summary:hover {
  color: #667eea;
}

.stack-content {
  margin-top: 8px;
  padding: 10px;
  background: white;
  border-radius: 4px;
  font-size: 12px;
  font-family: 'Courier New', monospace;
  overflow-x: auto;
  color: #666;
}

.log-data {
  white-space: pre-wrap;
  word-wrap: break-word;
  background-color: #f8f9fa;
  padding: 12px;
  border-radius: 6px;
  font-size: 13px;
  font-family: 'Courier New', monospace;
  margin: 0;
  line-height: 1.5;
}

/* 不同类型的日志颜色 */
.log-fetch_request { background-color: #e3f2fd; border-left: 4px solid #2196f3; }
.log-fetch_request .log-type { background-color: #2196f3; color: white; }

.log-fetch_response { background-color: #e8f5e9; border-left: 4px solid #4caf50; }
.log-fetch_response .log-type { background-color: #4caf50; color: white; }

.log-fetch_error { background-color: #ffebee; border-left: 4px solid #f44336; }
.log-fetch_error .log-type { background-color: #f44336; color: white; }

.log-xhr_request { background-color: #fff3e0; border-left: 4px solid #ff9800; }
.log-xhr_request .log-type { background-color: #ff9800; color: white; }

.log-xhr_response { background-color: #f1f8e9; border-left: 4px solid #8bc34a; }
.log-xhr_response .log-type { background-color: #8bc34a; color: white; }

.log-xhr_error { background-color: #fce4ec; border-left: 4px solid #e91e63; }
.log-xhr_error .log-type { background-color: #e91e63; color: white; }

.log-system { background-color: #f3e5f5; border-left: 4px solid #9c27b0; }
.log-system .log-type { background-color: #9c27b0; color: white; }

.log-error { background-color: #ffebee; border-left: 4px solid #d32f2f; }
.log-error .log-type { background-color: #d32f2f; color: white; }

.log-fingerprint { background-color: #e0f7fa; border-left: 4px solid #00bcd4; }
.log-fingerprint .log-type { background-color: #00bcd4; color: white; }

.log-fingerprint_error { background-color: #fff8e1; border-left: 4px solid #ffb300; }
.log-fingerprint_error .log-type { background-color: #ffb300; color: white; }

.log-fingerprint_event { background-color: #e0f2f1; border-left: 4px solid #26a69a; }
.log-fingerprint_event .log-type { background-color: #26a69a; color: white; }

.log-fingerprint-canvas { background-color: #fff3e0; border-left: 4px solid #ff9800; }
.log-fingerprint-webgl { background-color: #e1f5fe; border-left: 4px solid #03a9f4; }
.log-fingerprint-font { background-color: #f3e5f5; border-left: 4px solid #9c27b0; }
.log-fingerprint-webrtc { background-color: #e8f5e9; border-left: 4px solid #4caf50; }
.log-fingerprint-audio { background-color: #fce4ec; border-left: 4px solid #e91e63; }
.log-fingerprint-screen { background-color: #e0f2f1; border-left: 4px solid #009688; }
.log-fingerprint-navigator { background-color: #fff9c4; border-left: 4px solid #fbc02d; }
.log-fingerprint-media { background-color: #ede7f6; border-left: 4px solid #673ab7; }
.log-fingerprint-battery { background-color: #e8eaf6; border-left: 4px solid #3f51b5; }
.log-fingerprint-performance { background-color: #ffebee; border-left: 4px solid #f44336; }

/* 滚动条样式 */
.logs-container::-webkit-scrollbar {
  width: 8px;
}

.logs-container::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 4px;
}

.logs-container::-webkit-scrollbar-thumb {
  background: #888;
  border-radius: 4px;
}

.logs-container::-webkit-scrollbar-thumb:hover {
  background: #555;
}

/* 修改模块样式 */
.mock-container {
  background: white;
  border-radius: 12px;
  padding: 20px;
  min-height: calc(100vh - 480px);
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.mock-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 15px;
  border-bottom: 2px solid #e0e0e0;
}

.mock-header h2 {
  margin: 0;
  color: #333;
  font-size: 20px;
}

.mock-rules-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mock-rule-item {
  padding: 15px;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  background: #f8f9fa;
  transition: all 0.3s;
}

.mock-rule-item:hover {
  border-color: #667eea;
  transform: translateX(4px);
}

.rule-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.rule-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
}

.toggle-checkbox {
  width: 20px;
  height: 20px;
  cursor: pointer;
}

.rule-api {
  font-weight: 600;
  font-size: 16px;
  color: #333;
}

.rule-actions {
  display: flex;
  gap: 8px;
}

.btn-icon {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 18px;
  padding: 4px 8px;
  transition: transform 0.2s;
}

.btn-icon:hover {
  transform: scale(1.2);
}

.rule-response {
  background: white;
  padding: 10px;
  border-radius: 6px;
  border: 1px solid #e0e0e0;
}

.rule-response strong {
  display: block;
  margin-bottom: 8px;
  color: #555;
}

.rule-response pre {
  margin: 0;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  color: #333;
  white-space: pre-wrap;
  word-wrap: break-word;
  max-height: 200px;
  overflow-y: auto;
}

.rule-editor-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.rule-editor {
  background: white;
  padding: 30px;
  border-radius: 12px;
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.2);
  max-width: 600px;
  width: 90%;
  max-height: 80vh;
  overflow-y: auto;
}

.rule-editor h3 {
  margin: 0 0 20px 0;
  color: #333;
  font-size: 20px;
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  font-weight: 600;
  color: #333;
}

.form-input {
  width: 100%;
  padding: 10px;
  border: 2px solid #e0e0e0;
  border-radius: 6px;
  font-size: 14px;
  transition: border-color 0.3s;
}

.form-input:focus {
  outline: none;
  border-color: #667eea;
}

.form-textarea {
  width: 100%;
  padding: 10px;
  border: 2px solid #e0e0e0;
  border-radius: 6px;
  font-size: 13px;
  font-family: 'Courier New', monospace;
  resize: vertical;
  transition: border-color 0.3s;
}

.form-textarea:focus {
  outline: none;
  border-color: #667eea;
}

.form-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 20px;
}

.form-group .hint {
  margin: 5px 0 0 0;
  font-size: 12px;
  color: #999;
}
.stack-count-badge {
  background: #4a5568;
  color: white;
  padding: 2px 6px;
  border-radius: 10px;
  font-size: 11px;
  margin-left: 8px;
  vertical-align: middle;
}

.stack-switcher {
  margin-top: 10px;
}

.stack-controls {
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #4a5568;
}

.stack-select {
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid #cbd5e0;
  background: white;
  font-size: 13px;
  color: #2d3748;
  cursor: pointer;
}

.stack-time {
  margin-top: 4px;
  font-size: 12px;
  color: #718096;
  text-align: right;
}

/* Cookie Tab Styles */
.cookie-container {
  padding: 20px;
}

.cookie-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.cookie-count {
  color: #888;
  font-size: 0.9em;
}

.cookie-list {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.cookie-item {
  background: #1e1e1e;
  border-radius: 8px;
  padding: 15px;
  border: 1px solid #333;
}

.cookie-item-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid #333;
}

.cookie-time {
  color: #888;
  font-size: 0.85em;
  font-family: monospace;
}

.cookie-action {
  background: #2c3e50;
  color: #3498db;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.8em;
  font-weight: bold;
}

.cookie-key {
  color: #e67e22;
  font-weight: bold;
  font-family: monospace;
}

.cookie-content {
  margin-bottom: 10px;
}

.cookie-value-row {
  display: flex;
  gap: 10px;
  margin-bottom: 8px;
  word-break: break-all;
}

.cookie-value-row .label {
  color: #888;
  min-width: 50px;
}

.cookie-value-row .value {
  color: #a5d6a7;
  font-family: monospace;
}

.cookie-attributes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.cookie-attr {
  background: #333;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.85em;
  color: #ccc;
}

.cookie-diff {
  background: #111;
  padding: 10px;
  border-radius: 4px;
  margin-top: 10px;
}

.diff-row {
  display: flex;
  gap: 10px;
  font-family: monospace;
  font-size: 0.9em;
  padding: 2px 0;
}

.diff-row.old {
  color: #e74c3c;
}

.diff-row.new {
  color: #2ecc71;
}

.diff-label {
  width: 40px;
  opacity: 0.7;
}

.diff-val {
  word-break: break-all;
}

.cookie-stack {
  margin-top: 10px;
  border-top: 1px solid #333;
  padding-top: 10px;
}

.cookie-stack summary {
  cursor: pointer;
  color: #888;
  font-size: 0.9em;
}

.cookie-stack summary:hover {
  color: #ccc;
}
</style>
