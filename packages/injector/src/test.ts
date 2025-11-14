import puppeteer from 'puppeteer';
import path from 'node:path';

const chromePath = "/Users/liao/.cache/puppeteer/chrome/mac_arm-142.0.7444.162/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
    timeout: 60000 // 给 Chrome 更多时间初始化
  });

  const page = await browser.newPage();
  await page.goto('https://www.google.com');
})();