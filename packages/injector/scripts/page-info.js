// 示例脚本：输出页面基本信息
console.log('=== 页面信息 ===');
console.log('标题:', document.title);
console.log('URL:', window.location.href);
console.log('用户代理:', navigator.userAgent);
console.log('屏幕尺寸:', `${window.screen.width}x${window.screen.height}`);
console.log('浏览器窗口:', `${window.innerWidth}x${window.innerHeight}`);
console.log('Cookie启用:', navigator.cookieEnabled);
console.log('在线状态:', navigator.onLine);
console.log('=================');

