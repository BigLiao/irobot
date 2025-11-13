<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';

interface Log {
  type: string;
  data: any;
  timestamp: string;
}

const logs = ref<Log[]>([]);
const targetUrl = ref('https://www.baidu.com');
const isMonitoring = ref(false);
const wsConnected = ref(false);

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
      } else {
        logs.value.unshift(log);
      }
      
      // 限制日志数量
      if (logs.value.length > 1000) {
        logs.value = logs.value.slice(0, 1000);
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
};

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

    <div class="logs-container">
      <div v-if="logs.length === 0" class="empty-state">
        <p>暂无日志记录</p>
        <p class="hint">输入URL并点击"开始监控"按钮开始监控网页行为</p>
      </div>
      
      <div v-for="(log, index) in logs" :key="index" class="log-entry" :class="`log-${log.type.toLowerCase()}`">
        <div class="log-header">
          <span class="log-type">{{ log.type }}</span>
          <span class="log-timestamp">{{ new Date(log.timestamp).toLocaleTimeString() }}</span>
        </div>
        <pre class="log-data">{{ JSON.stringify(log.data, null, 2) }}</pre>
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

.logs-container {
  background: white;
  border-radius: 12px;
  padding: 20px;
  height: calc(100vh - 380px);
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
