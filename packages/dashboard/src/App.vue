<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

interface Log {
  type: string;
  data: any;
  timestamp: string;
  count?: number; // 调用次数
  eventHash?: string; // 事件哈希，用于去重
}

const logs = ref<Log[]>([]);
const eventHashMap = new Map<string, number>(); // eventHash -> logs数组索引
const targetUrl = ref('https://www.baidu.com');
const isMonitoring = ref(false);
const wsConnected = ref(false);
const selectedCategory = ref<string>('all');

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
      } else if (log.type === 'FINGERPRINT_EVENT' && log.data?.eventHash) {
        // 指纹事件：根据 eventHash 去重和计数
        const eventHash = log.data.eventHash;
        const existingIndex = eventHashMap.get(eventHash);
        
        if (existingIndex !== undefined && logs.value[existingIndex]) {
          // 已存在相同事件，增加计数
          logs.value[existingIndex].count = (logs.value[existingIndex].count || 1) + 1;
          logs.value[existingIndex].timestamp = log.timestamp; // 更新最后调用时间
        } else {
          // 新事件，添加到列表
          const newLog: Log = {
            ...log,
            count: 1,
            eventHash,
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
    ws.send(JSON.stringify({
      type: 'START_MONITOR',
      url: targetUrl.value
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

onMounted(() => {
  connectWebSocket();
});

onUnmounted(() => {
  if (ws) {
    ws.close();
  }
});
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
            <summary>📚 调用栈</summary>
            <pre class="stack-content">{{ log.data.stack }}</pre>
          </details>
        </div>

        <pre v-else class="log-data">{{ JSON.stringify(log.data, null, 2) }}</pre>
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
</style>
