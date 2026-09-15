// 1. 引入 express 工具包
const express = require('express');

// 2. 创建 express 应用实例
const app = express();

// 3. 定义服务器监听端口号
const port = 3000;

// 4. 定义GET接口：访问根路径 /
app.get('/', (req, res) => {
  res.send('Hello, Feynman Learner!');
});

// 5. 启动服务器，监听端口
app.listen(port, () => {
  console.log(`Feynman Platform backend is running at http://localhost:${port}`);
});