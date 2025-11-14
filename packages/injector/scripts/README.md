# 自定义注入脚本

这个目录用于存放自定义的 JavaScript 脚本文件,这些脚本会在监控启动时注入到目标网页中。

## 使用方法

1. 在这个目录下创建 `.js` 文件
2. 在 Dashboard 中选择要注入的脚本
3. 启动监控时,选定的脚本会自动注入到目标网页

## 示例脚本

### console-hello.js
最简单的示例,输出 "hello world!"

### alert-welcome.js
在页面加载 1 秒后输出欢迎信息和页面基本信息

### page-info.js
输出详细的页面信息,包括标题、URL、用户代理、屏幕尺寸等

## 注意事项

- 脚本会在页面加载前(`evaluateOnNewDocument`)和页面加载后(`evaluate`)各执行一次
- 脚本运行在页面的上下文中,可以访问 `window`、`document` 等对象
- 如果脚本有错误,会在控制台显示错误信息,但不会影响监控功能的正常运行
- 脚本可以使用 `console.log` 输出调试信息

## 脚本示例

```javascript
// 修改页面标题
document.title = '已被监控 - ' + document.title;

// 监听特定事件
window.addEventListener('load', () => {
  console.log('页面加载完成！');
});

// 修改特定函数
const originalFetch = window.fetch;
window.fetch = function(...args) {
  console.log('拦截到 fetch 请求:', args[0]);
  return originalFetch.apply(this, args);
};
```

