import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import { PATHS } from './config';

// --- Express App Setup ---
const app = express();
app.use(express.json());
app.use(cors());

// --- WebSocket Server Setup ---
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// 存储连接
const dashboardSockets = new Set<WebSocket>();
let injectorSocket: WebSocket | null = null;
let injectorProcess: ChildProcess | null = null;

// 存储修改规则
interface MockRule {
  id: string;
  match: {
    api: string;
  };
  response: any;
  enabled: boolean;
}

let mockRules: MockRule[] = [];
let selectedScript: string | null = null; // 存储选定的脚本文件名

// 变量纠察状态
type VarSnapshot = {
  url: string;
  timestamp: number;
  userAgent?: string;
  cookies: Record<string, string>;
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  // 新版：已扁平化的全局变量（过滤函数），key示例：foo.bar.0.baz
  globalsFlat?: Record<string, string | number | boolean | null>;
  // 兼容旧版
  globals?: { name: string; type: string; value?: string | number | boolean }[];
};

const varPatrolState: {
  running: boolean;
  url: string | null;
  phase: 0 | 1 | 2;
  firstSnapshot: VarSnapshot | null;
} = {
  running: false,
  url: null,
  phase: 0,
  firstSnapshot: null,
};

// WebSocket连接处理
wss.on('connection', (ws, req) => {
  const url = req.url || '';

  if (url.startsWith('/dashboard')) {
    console.log('✅ Dashboard 客户端已连接');
    dashboardSockets.add(ws);

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());

        // 处理来自dashboard的启动请求
        if (data.type === 'START_MONITOR' && data.url) {
          console.log(`\n🚀 启动监控: ${data.url}`);
          // 保存选定的脚本
          if (data.script) {
            selectedScript = data.script;
            console.log(`📜 自定义脚本: ${data.script}`);
          }
          startInjector(data.url);

          // 通知所有dashboard客户端
          broadcastToDashboard({
            type: 'MONITOR_STARTED',
            url: data.url,
            timestamp: new Date().toISOString()
          });
        }

        if (data.type === 'STOP_MONITOR') {
          console.log('\n🛑 停止监控');
          stopInjector();

          broadcastToDashboard({
            type: 'MONITOR_STOPPED',
            timestamp: new Date().toISOString()
          });
        }

        // 处理修改规则更新
        if (data.type === 'UPDATE_MOCK_RULES' && data.rules) {
          console.log(`🔧 更新 Mock 规则: ${data.rules.length} 条`);
          mockRules = data.rules;

          // 转发给injector
          if (injectorSocket && injectorSocket.readyState === WebSocket.OPEN) {
            injectorSocket.send(JSON.stringify({
              type: 'UPDATE_MOCK_RULES',
              rules: mockRules
            }));
          }
        }

        // 发起变量纠察
        if (data.type === 'RUN_VAR_PATROL' && data.url) {
          console.log(`🧪 启动变量纠察: ${data.url}`);
          // 若有正在运行的 injector，先停止
          if (injectorProcess) {
            stopInjector();
          }
          varPatrolState.running = true;
          varPatrolState.url = data.url;
          varPatrolState.phase = 1; // 第一轮
          varPatrolState.firstSnapshot = null;

          broadcastToDashboard({
            type: 'VAR_PATROL_STARTED',
            url: data.url,
            timestamp: new Date().toISOString(),
          });

          // 启动第一轮
          startInjector(data.url);
          // 同步监控状态
          broadcastToDashboard({
            type: 'MONITOR_STARTED',
            url: data.url,
            timestamp: new Date().toISOString(),
          });
        }
      } catch (error) {
        console.error('❌ 处理dashboard消息错误:', error);
      }
    });

    ws.on('close', () => {
      console.log('👋 Dashboard 客户端已断开');
      dashboardSockets.delete(ws);
    });

  } else if (url.startsWith('/injector')) {
    console.log('🔌 Injector 客户端已连接');
    injectorSocket = ws;

    // 发送当前的修改规则给injector
    if (mockRules.length > 0) {
      ws.send(JSON.stringify({
        type: 'UPDATE_MOCK_RULES',
        rules: mockRules
      }));
    }

    // 如果正处于变量纠察流程，立即下发指令
    if (varPatrolState.running) {
      try {
        ws.send(JSON.stringify({ type: 'RUN_VAR_PATROL' }));
        console.log('🧪 已向 Injector 下发变量纠察指令');
      } catch { }
    }

    ws.on('message', (message) => {
      // 只转发消息，不打印日志（避免大量日志输出）
      try {
        const data = JSON.parse(message.toString());

        // 只打印关键事件类型
        if (data.type === 'FINGERPRINT_MONITOR_READY') {
          console.log('🎯 指纹监控已就绪');
        } else if (data.type === 'ERROR') {
          console.error('❌ Injector 错误:', data.data?.message || data.message);
        }

        // 变量纠察流程处理
        if (data.type === 'VAR_PATROL_SNAPSHOT' && varPatrolState.running) {
          if (varPatrolState.phase === 1) {
            // 第一轮快照
            varPatrolState.firstSnapshot = data.data as VarSnapshot;
            console.log('🧪 第一轮变量快照已收到，重启浏览器进行第二轮');
            // 停止并启动第二轮
            stopInjector();
            varPatrolState.phase = 2;
            if (varPatrolState.url) {
              startInjector(varPatrolState.url);
              // 同步监控状态
              broadcastToDashboard({
                type: 'MONITOR_STARTED',
                url: varPatrolState.url,
                timestamp: new Date().toISOString(),
              });
            }
          } else if (varPatrolState.phase === 2) {
            // 第二轮快照
            const second = data.data as VarSnapshot;
            const first = varPatrolState.firstSnapshot;
            console.log('🧪 第二轮变量快照已收到，开始对比');
            const result = first ? compareVarSnapshots(first, second) : null;

            console.log('🧪 变量纠察结果:', result);

            broadcastToDashboard({
              type: 'VAR_PATROL_RESULT',
              url: varPatrolState.url,
              first: first,
              second: second,
              result,
              timestamp: new Date().toISOString(),
            });

            // 结束流程
            stopInjector();
            varPatrolState.running = false;
            varPatrolState.url = null;
            varPatrolState.phase = 0;
            varPatrolState.firstSnapshot = null;
          }
        } else {
          // 转发到所有dashboard客户端
          broadcastToDashboard(data);
        }
      } catch (error) {
        console.error('❌ 处理 injector 消息错误:', error);
      }
    });

    ws.on('close', () => {
      console.log('🔌 Injector 客户端已断开');
      injectorSocket = null;
    });
  }

  ws.on('error', (error) => {
    console.error('❌ WebSocket 错误:', error);
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

  const injectorPath = path.resolve(PATHS.injectorDir, 'index.js');

  // 只打印关键信息
  if (mockRules.length > 0) {
    console.log(`   📋 Mock 规则: ${mockRules.length} 条`);
  }

  injectorProcess = spawn('node', [injectorPath, url], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DASHBOARD_WS_URL: 'ws://localhost:3000/injector',
      MOCK_RULES: JSON.stringify(mockRules), // 通过环境变量传递修改规则
      CUSTOM_SCRIPT: selectedScript || '' // 通过环境变量传递自定义脚本文件名
    }
  });

  injectorProcess.on('error', (error) => {
    console.error('❌ 启动 injector 失败:', error.message);
    broadcastToDashboard({
      type: 'ERROR',
      message: `启动 injector 失败: ${error.message}`,
      timestamp: new Date().toISOString()
    });
  });

  injectorProcess.on('exit', (code) => {
    if (code !== 0) {
      console.log(`⚠️  Injector 进程退出，代码: ${code}`);
    }
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
    injectorProcess.kill();
    injectorProcess = null;
  }
}

// 比较两轮变量快照，找出相同项
function compareVarSnapshots(a: VarSnapshot, b: VarSnapshot) {
  const intersectKV = (ka: Record<string, string>, kb: Record<string, string>) => {
    const out: { key: string; value: string }[] = [];
    for (const k of Object.keys(ka)) {
      if (kb.hasOwnProperty(k) && ka[k] === kb[k]) {
        out.push({ key: k, value: ka[k] });
      }
    }
    return out;
  };

  // Globals 扁平化对比
  const intersectAnyKV = (
    ka?: Record<string, string | number | boolean | null>,
    kb?: Record<string, string | number | boolean | null>
  ) => {
    const out: { key: string; value: string | number | boolean | null }[] = [];
    if (!ka || !kb) return out;
    for (const k of Object.keys(ka)) {
      if (Object.prototype.hasOwnProperty.call(kb, k)) {
        const va = ka[k];
        const vb = kb[k];
        if (va === vb) {
          out.push({ key: k, value: va });
        }
      }
    }
    return out;
  };

  const globals = intersectAnyKV(a.globalsFlat, b.globalsFlat);

  return {
    cookies: intersectKV(a.cookies, b.cookies),
    localStorage: intersectKV(a.localStorage, b.localStorage),
    sessionStorage: intersectKV(a.sessionStorage, b.sessionStorage),
    globals,
  };
}

// --- Static File Server for Dashboard Frontend ---
const dashboardPath = PATHS.webDir;
app.use(express.static(dashboardPath));

// API健康检查
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    injectorRunning: injectorProcess !== null,
    dashboardClients: dashboardSockets.size
  });
});

// 获取 scripts 目录下的 JS 文件列表
app.get('/api/scripts', (req, res) => {
  try {
    const scriptsPath = PATHS.scriptsDir;

    // 检查目录是否存在
    if (!fs.existsSync(scriptsPath)) {
      return res.json({ scripts: [] });
    }

    // 读取目录中的所有文件
    const files = fs.readdirSync(scriptsPath);

    // 过滤出 .js 文件
    const scripts = files.filter(file => file.endsWith('.js'));

    res.json({ scripts });
  } catch (error: any) {
    console.error('❌ 读取 scripts 目录失败:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(dashboardPath, 'index.html'));
});

// --- Server Start ---
const PORT = 3000;
server.listen(PORT, () => {
  console.log('\n╔═══════════════════════════════════════════╗');
  console.log('║  🤖 iRobot Server - 启动成功            ║');
  console.log('╠═══════════════════════════════════════════╣');
  console.log(`║  📊 Dashboard: http://localhost:${PORT}     ║`);
  console.log('╚═══════════════════════════════════════════╝\n');
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n\n🛑 正在关闭服务器...');
  stopInjector();
  server.close(() => {
    console.log('✅ 服务器已关闭\n');
    process.exit(0);
  });
});
