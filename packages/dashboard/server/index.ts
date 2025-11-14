import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, ChildProcess } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Express App Setup ---
const app = express();
app.use(express.json());

// --- WebSocket Server Setup ---
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// 存储连接
const dashboardSockets = new Set<WebSocket>();
let injectorSocket: WebSocket | null = null;
let injectorProcess: ChildProcess | null = null;

// WebSocket连接处理
wss.on('connection', (ws, req) => {
  const url = req.url || '';
  
  if (url.startsWith('/dashboard')) {
    console.log('Dashboard 客户端已连接');
    dashboardSockets.add(ws);
    
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        // 处理来自dashboard的启动请求
        if (data.type === 'START_MONITOR' && data.url) {
          console.log(`收到监控请求: ${data.url}`);
          startInjector(data.url);
          
          // 通知所有dashboard客户端
          broadcastToDashboard({
            type: 'MONITOR_STARTED',
            url: data.url,
            timestamp: new Date().toISOString()
          });
        }
        
        if (data.type === 'STOP_MONITOR') {
          console.log('收到停止监控请求');
          stopInjector();
          
          broadcastToDashboard({
            type: 'MONITOR_STOPPED',
            timestamp: new Date().toISOString()
          });
        }
      } catch (error) {
        console.error('处理dashboard消息错误:', error);
      }
    });
    
    ws.on('close', () => {
      console.log('Dashboard 客户端已断开');
      dashboardSockets.delete(ws);
    });
    
  } else if (url.startsWith('/injector')) {
    console.log('Injector 客户端已连接');
    injectorSocket = ws;
    
    ws.on('message', (message) => {
      const data = message.toString();
      console.log('收到来自 injector 的消息:', data);
      
      // 转发到所有dashboard客户端
      broadcastToDashboard(JSON.parse(data));
    });
    
    ws.on('close', () => {
      console.log('Injector 客户端已断开');
      injectorSocket = null;
    });
  }
  
  ws.on('error', (error) => {
    console.error('WebSocket 错误:', error);
  });
});

// 广播消息到所有dashboard客户端
function broadcastToDashboard(data: any) {
  const message = typeof data === 'string' ? data : JSON.stringify(data);
  dashboardSockets.forEach(socket => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(message);
    }
  });
}

// 启动injector进程
function startInjector(url: string) {
  // 如果已有进程在运行，先停止
  if (injectorProcess) {
    stopInjector();
  }
  
  const injectorPath = path.resolve(__dirname, '../../../injector/dist/index.js');
  
  console.log(`启动 injector 进程: ${injectorPath}`);
  console.log(`目标 URL: ${url}`);
  
  injectorProcess = spawn('node', [injectorPath, url], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DASHBOARD_WS_URL: 'ws://localhost:3000/injector'
    }
  });
  
  injectorProcess.on('error', (error) => {
    console.error('启动 injector 失败:', error);
    broadcastToDashboard({
      type: 'ERROR',
      message: `启动 injector 失败: ${error.message}`,
      timestamp: new Date().toISOString()
    });
  });
  
  injectorProcess.on('exit', (code) => {
    console.log(`Injector 进程退出，代码: ${code}`);
    injectorProcess = null;
    
    broadcastToDashboard({
      type: 'MONITOR_STOPPED',
      reason: `进程退出，代码: ${code}`,
      timestamp: new Date().toISOString()
    });
  });
}

// 停止injector进程
function stopInjector() {
  if (injectorProcess) {
    console.log('停止 injector 进程');
    injectorProcess.kill();
    injectorProcess = null;
  }
}

// --- Static File Server for Dashboard Frontend ---
const dashboardPath = path.join(__dirname, '../../dist');
app.use(express.static(dashboardPath));

// API健康检查
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    injectorRunning: injectorProcess !== null,
    dashboardClients: dashboardSockets.size
  });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(dashboardPath, 'index.html'));
});

// --- Server Start ---
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`===========================================`);
  console.log(`服务器启动成功！`);
  console.log(`Dashboard: http://localhost:${PORT}`);
  console.log(`WebSocket (Dashboard): ws://localhost:${PORT}/dashboard`);
  console.log(`WebSocket (Injector): ws://localhost:${PORT}/injector`);
  console.log(`===========================================`);
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n正在关闭服务器...');
  stopInjector();
  server.close(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
});

