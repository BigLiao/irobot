// 验证 Cookie 拦截功能
console.log('开始验证 Cookie 拦截...');

// 1. 设置一个新的 Cookie
console.log('1. 设置新 Cookie: test_cookie=123');
document.cookie = 'test_cookie=123; path=/; max-age=3600';

// 等待一下
setTimeout(() => {
    // 2. 修改 Cookie
    console.log('2. 修改 Cookie: test_cookie=456');
    document.cookie = 'test_cookie=456; path=/; max-age=3600';

    // 3. 添加另一个 Cookie
    setTimeout(() => {
        console.log('3. 添加另一个 Cookie: another_cookie=abc');
        document.cookie = 'another_cookie=abc; secure; samesite=strict';

        console.log('验证完成，请检查 Dashboard 的 Cookies 标签页');
    }, 1000);
}, 1000);
