#!/bin/bash

# iRobot 监控系统启动脚本

echo "🤖 iRobot - 网页行为监控系统"
echo "================================"
echo ""

# 检查是否已构建
if [ ! -d "packages/dashboard/dist" ] || [ ! -d "packages/injector/dist" ]; then
    echo "⚠️  检测到项目未构建，正在构建..."
    pnpm build
    
    if [ $? -ne 0 ]; then
        echo "❌ 构建失败，请检查错误信息"
        exit 1
    fi
    echo "✅ 构建完成"
    echo ""
fi

echo "🚀 正在启动 Dashboard 服务器..."
echo ""
echo "访问地址: http://localhost:3000"
echo "按 Ctrl+C 停止服务器"
echo "================================"
echo ""

# 启动服务器
pnpm start

