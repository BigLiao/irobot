#!/usr/bin/env node
// packages/injector/src/index.ts
// Puppeteer 启动器和注入器

import puppeteer, { Browser, Page } from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 从命令行参数获取URL
const targetUrl = process.argv[2] || 'https://www.baidu.com';
const dashboardWsUrl = process.env.DASHBOARD_WS_URL || 'ws://localhost:3000/injector';

console.log('===========================================');
console.log('🤖 iRobot Injector 启动中...');
console.log(`目标 URL: ${targetUrl}`);
console.log(`Dashboard WebSocket: ${dashboardWsUrl}`);
console.log('===========================================');

// 读取并准备注入脚本
const monitorScriptPath = path.join(__dirname, 'monitor-bundle.js');
let injectorScript: string;

try {
  injectorScript = fs.readFileSync(monitorScriptPath, 'utf-8');
  // 替换WebSocket URL占位符
  injectorScript = injectorScript.replace('WS_URL_PLACEHOLDER', dashboardWsUrl);
  console.log('✅ 监控脚本已加载');
} catch (error) {
  console.error('❌ 无法读取监控脚本:', error);
  process.exit(1);
}

async function main() {
  let browser: Browser | null = null;

  try {
    console.log('\n🚀 正在启动 Chromium 浏览器...');
    
    browser = await puppeteer.launch({
      headless: false,
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
    page.on('pageerror', (error) => {
      console.error('❌ 页面错误:', error.message);
    });

    console.log(`\n🌐 正在访问: ${targetUrl}`);
    
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
    console.log('\n🎯 监控正在进行中...');
    console.log('💡 提示: 在页面中进行的所有 API 调用都会被捕获');
    console.log('💡 提示: 按 Ctrl+C 停止监控并关闭浏览器\n');

    // 保持进程运行
    await new Promise(() => {});

  } catch (error) {
    console.error('\n❌ 发生错误:', error);
    process.exit(1);
  }
}

// 优雅关闭
process.on('SIGINT', async () => {
  console.log('\n\n🛑 收到停止信号，正在关闭...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n\n🛑 收到终止信号，正在关闭...');
  process.exit(0);
});

// 启动
main().catch((error) => {
  console.error('❌ 启动失败:', error);
  process.exit(1);
});
