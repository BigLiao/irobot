#!/usr/bin/env node
// packages/injector/src/index.ts
// Puppeteer 启动器和注入器

import puppeteer, { Browser, Page } from 'puppeteer';
import fs, { mkdtempSync } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tmpUserDir = mkdtempSync(path.join(os.tmpdir(), 'puppeteer_profile_'));


// 从命令行参数获取URL
const targetUrl = process.argv[2] || 'https://www.baidu.com';
const dashboardWsUrl = process.env.DASHBOARD_WS_URL || 'ws://localhost:3000/injector';

// 从环境变量获取修改规则
let mockRules: any[] = [];
try {
  const mockRulesJson = process.env.MOCK_RULES;
  if (mockRulesJson) {
    mockRules = JSON.parse(mockRulesJson);
  }
} catch (error: any) {
  console.error('❌ 解析修改规则失败:', error);
}

// 从环境变量获取自定义脚本文件名
const customScriptFile = process.env.CUSTOM_SCRIPT || '';

console.log('===========================================');
console.log('🤖 iRobot Injector 启动中...');
console.log(`目标 URL: ${targetUrl}`);
console.log(`Dashboard WebSocket: ${dashboardWsUrl}`);
console.log(`修改规则数量: ${mockRules.length}`);
console.log(`自定义脚本: ${customScriptFile || '无'}`);
console.log('===========================================');

// 读取并准备注入脚本
const monitorScriptPath = path.join(__dirname, 'monitor-bundle.js');
let injectorScript: string;

try {
  injectorScript = fs.readFileSync(monitorScriptPath, 'utf-8');
  // 替换WebSocket URL占位符
  injectorScript = injectorScript.replace('WS_URL_PLACEHOLDER', dashboardWsUrl);
  // 替换修改规则占位符 - 注入初始规则
  injectorScript = injectorScript.replace('MOCK_RULES_PLACEHOLDER', JSON.stringify(mockRules));
  console.log('✅ 监控脚本已加载');
} catch (error) {
  console.error('❌ 无法读取监控脚本:', error);
  process.exit(1);
}

// 读取自定义脚本
let customScript = '';
if (customScriptFile) {
  try {
    const customScriptPath = path.join(__dirname, '../scripts', customScriptFile);
    customScript = fs.readFileSync(customScriptPath, 'utf-8');
    console.log(`✅ 自定义脚本已加载: ${customScriptFile}`);
  } catch (error) {
    console.error(`❌ 无法读取自定义脚本 ${customScriptFile}:`, error);
    // 不退出,继续执行
  }
}

async function main() {
  let browser: Browser | null = null;

  try {
    console.log('\n🚀 正在启动 Chromium 浏览器...');

    browser = await puppeteer.launch({
      headless: false,
      userDataDir: tmpUserDir,
      defaultViewport: {
        width: 1280,
        height: 720,
      },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    });

    console.log('✅ 浏览器已启动');

    const page: Page = await browser.newPage();

    // 监听页面控制台输出
    page.on('console', (msg) => {
      const type = msg.type();
      const text = msg.text();

      if (type === 'error') {
        console.log(`❌ 页面控制台 [${type}]:`, text);
      } else if (text.includes('[Injector]')) {
        console.log(`📡 ${text}`);
      }
    });

    // 监听页面错误
    page.on('pageerror', (error: any) => {
      console.error('❌ 页面错误:', error.message);
    });

    console.log(`\n🌐 正在访问: ${targetUrl}`);



    // 读取 override 配置
    const overrideConfigPath = path.join(__dirname, '../override/config.json');
    let overrideConfig: Record<string, string> = {};
    try {
      if (fs.existsSync(overrideConfigPath)) {
        const configContent = fs.readFileSync(overrideConfigPath, 'utf-8');
        overrideConfig = JSON.parse(configContent);
        console.log(`✅ 加载 Override 配置: ${Object.keys(overrideConfig).length} 条规则`);
      }
    } catch (error) {
      console.error('❌ 加载 Override 配置失败:', error);
    }

    // 启用请求拦截
    await page.setRequestInterception(true);

    page.on('request', async (request) => {
      const url = request.url();
      let matched = false;

      console.log(`📡 请求: ${url}`);

      // 检查是否有匹配的 override 规则
      for (const [targetUrl, localFile] of Object.entries(overrideConfig)) {
        // 简单的包含匹配，后续可以扩展为正则
        if (url.includes(targetUrl)) {
          const localFilePath = path.join(__dirname, '../override', localFile);
          if (fs.existsSync(localFilePath)) {
            try {
              const content = fs.readFileSync(localFilePath, 'utf-8');
              console.log(`🔄 Override: ${url} -> ${localFile}`);
              await request.respond({
                status: 200,
                contentType: 'application/javascript',
                body: content,
              });
              matched = true;
              break;
            } catch (error) {
              console.error(`❌ 读取 Override 文件失败: ${localFilePath}`, error);
            }
          } else {
            console.warn(`⚠️ Override 文件不存在: ${localFilePath}`);
          }
        }
      }

      if (!matched) {
        request.continue();
      }
    });

    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    console.log('✅ 页面加载完成');

    console.log('\n💉 正在注入监控脚本...');

    // 注入脚本到页面
    await page.evaluateOnNewDocument(injectorScript);
    await page.evaluate(injectorScript);

    console.log('✅ 监控脚本已注入成功');

    // 注入自定义脚本
    if (customScript) {
      console.log('\n💉 正在注入自定义脚本...');
      try {
        await page.evaluateOnNewDocument(customScript);
        await page.evaluate(customScript);
        console.log('✅ 自定义脚本已注入成功');
      } catch (error) {
        console.error('❌ 自定义脚本注入失败:', error);
      }
    }
    console.log('\n🎯 监控正在进行中...');
    console.log('💡 提示: 在页面中进行的所有 API 调用都会被捕获');
    console.log('💡 提示: 按 Ctrl+C 停止监控并关闭浏览器\n');

    // 保持进程运行
    await new Promise(() => { });

  } catch (error) {
    console.error('\n❌ 发生错误:', error);
    fs.rmSync(tmpUserDir, { recursive: true });
    process.exit(1);
  }
}

// 优雅关闭
process.on('SIGINT', async () => {
  console.log('\n\n🛑 收到停止信号，正在关闭...');
  fs.rmSync(tmpUserDir, { recursive: true });
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n\n🛑 收到终止信号，正在关闭...');
  fs.rmSync(tmpUserDir, { recursive: true });
  process.exit(0);
});

// 启动
main().catch((error) => {
  console.error('❌ 启动失败:', error);
  fs.rmSync(tmpUserDir, { recursive: true });
  process.exit(1);
});
