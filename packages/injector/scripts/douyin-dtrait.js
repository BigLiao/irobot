(function hookDTraitSDK() {
  let retryCount = 0;
  const maxRetries = 5;
  const retryInterval = 1000; // 每 500ms 重试一次

  function tryHook() {
    const root = window.DTraitSDK?.default;
    if (!root) {
      retryCount++;
      if (retryCount < maxRetries) {
        setTimeout(tryHook, retryInterval);
      } else {
        console.log('[Hook] DTraitSDK not found after maximum retries.');
      }
      return;
    }

    console.log('[Hook] DTraitSDK before', root);

    // 为避免重复 Hook
    if (root.__isHooked__) {
      console.log("[Hook] DTraitSDK already hooked.");
      return;
    }
    root.__isHooked__ = true;

    // 使用 WeakSet 跟踪已访问的对象，避免循环引用
    const visited = new WeakSet();

    // Hook 函数的通用逻辑
    function hookFunction(fn, path) {
      if (fn.__wrapped__) return fn; // 避免重复包裹
      console.log('[Hook] hookFunction', path, fn, typeof(fn));

      const original = fn;
      const wrapped = function (...args) {
        try {
          console.groupCollapsed(
            `%c[DTraitSDK Hook] CALL ${path}`,
            "color:#d9534f;font-weight:bold;"
          );

          console.log("Arguments:", args);

          // 打印 JS 调用堆栈
          const stack = new Error().stack
            .split("\n")
            .slice(1)
            .join("\n");
          console.log("Stack:\n", stack);

          const ret = original.apply(this, args);
          console.log("Return:", ret);

          console.groupEnd();
          return ret;
        } catch (err) {
          console.error("[Hook Error]", err);
          throw err;
        }
      };

      wrapped.__wrapped__ = true;

      // 复制原函数的属性到包装函数
      try {
        Object.keys(original).forEach(prop => {
          try {
            wrapped[prop] = original[prop];
          } catch (copyErr) {
            console.warn(`[Hook] Cannot copy property ${path}.${prop}:`, copyErr.message);
          }
        });
      } catch (copyErr) {
        console.warn(`[Hook] Error copying properties of ${path}:`, copyErr.message);
      }

      return wrapped;
    }

    function wrapObject(obj, path) {
      console.log('[Hook] wrapObject', path, obj, typeof(obj));
      // 1. 基础类型检查
      if (obj == null) return;
      
      const objType = typeof obj;
      if (objType !== "object" && objType !== "function") return;

      // 2. 检测循环引用
      if (visited.has(obj)) {
        console.log(`[Hook] Circular reference detected at ${path}, skipping.`);
        return;
      }
      visited.add(obj);

      // 3. 遍历对象/函数的所有属性
      if (typeof obj === 'function') {
        hookFunction(obj, path);
        return;
      }
      try {
        Object.keys(obj).forEach(key => {
          const fullPath = `${path}.${key}`;
          let val;
          
          try {
            val = obj[key];
          } catch (accessErr) {
            console.warn(`[Hook] Cannot access property ${fullPath}:`, accessErr.message);
            return;
          }

          try {
            // 如果属性是函数，Hook 它
            if (typeof val === "function") {
              const wrapped = hookFunction(val, fullPath);
              
              // 尝试替换函数
              try {
                Object.defineProperty(obj, key, {
                  configurable: true,
                  enumerable: true,
                  writable: true,
                  value: wrapped,
                });
                
                // 递归处理 wrapped 函数的属性
                wrapObject(wrapped, fullPath);
              } catch (defineErr) {
                console.warn(`[Hook] Cannot redefine property ${fullPath}:`, defineErr.message);
                // 如果无法替换，至少递归处理原函数的属性
                wrapObject(val, fullPath);
              }
            }
            // 如果属性是对象，递归处理
            else if (val !== null && typeof val === "object") {
              wrapObject(val, fullPath);
            }
          } catch (err) {
            console.warn(`[Hook] Error processing ${fullPath}:`, err.message);
          }
        });
      } catch (err) {
        console.warn(`[Hook] Error iterating ${path}:`, err.message);
      }
    }

    wrapObject(root, "DTraitSDK.default");
    console.log("[Hook] DTraitSDK Hooked! All methods are wrapped.");
  }

  // 开始尝试 Hook
  tryHook();
})();