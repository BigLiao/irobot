const button = document.getElementById('xhrButton');
const log = document.getElementById('responseLog');


// 2. 定义配置
const sdkConfig = {
  // 钩子配置：决定是否拦截该请求
  hookConfig: (reqConfig) => {
      // reqConfig 包含 url, method 等信息
      console.log("Checking hook for:", reqConfig.url);
      return {
          needProxy: true, // 开启拦截代理
          // onlyProxyReq: false,
          // onlyProxyResp: false
      };
  },

  // 请求前处理：可以修改请求头或做记录
  processRequestConfig: (config, instance) => {
      console.log("Processing Request:", config);
      // 必须返回 Promise
      return Promise.resolve(config);
  },

  // 响应后处理：可以读取响应头或状态码
  processResponseConfig: (resConfig, instance) => {
      // resConfig 包含 headers, httpCode, config 等
      console.log("Processing Response:", resConfig);
      return Promise.resolve(true);
  },

  // 错误处理
  errorRequestConfig: (errInfo) => {
      console.error("Request Error:", errInfo);
  }
};

// 3. 实例化 SDK (这将立即开始拦截网络请求)
const dtraitInstance = new window.DTraitSDK.default(sdkConfig);

console.log('dtraitInstance', dtraitInstance);

dtraitInstance.init();

function setLog(text) {
  log.textContent = text;
}

button.addEventListener('click', () => {
  setLog('⏳ 正在发送请求...');

  const xhr = new XMLHttpRequest();
  xhr.open('GET', '/api/test', true);
  xhr.onreadystatechange = () => {
    if (xhr.readyState === XMLHttpRequest.DONE) {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          setLog('✅ 成功:\n' + JSON.stringify(data, null, 2));
        } catch (error) {
          setLog('⚠️ 无法解析响应: ' + error.message);
        }
      } else {
        setLog(`❌ 请求失败: HTTP ${xhr.status}`);
      }
    }
  };
  xhr.onerror = () => setLog('❌ 网络错误');
  xhr.send();
});
