require('dotenv').config()
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// 连接数据库（硬编码，你当前能正常连接的版本，增加超时配置）
mongoose.connect("mongodb+srv://2991455971_db_user:%40Gsj20060313@cluster0.5zs5wpk.mongodb.net/feynman-db?appName=Cluster0", {
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 45000
})
.then(()=>{
    console.log("✅ MongoDB connected successfully!")
})
.catch(err=>{
    console.log("❌ 数据库连接失败：", err)
})

app.get('/', (req,res)=>{
    res.send("Hello, Feynman Learner!")
})

// =========新增挂载路由=========
// =========新增挂载路由=========
console.log("准备加载users路由");
console.log("准备加载knowledgePoints路由");
//app.use('/api/knowledge-points', require('./routes/knowledgePoints'));

app.use('/api/users', require('./routes/users'));
app.use('/api/knowledge-points', require('./routes/knowledgePoints'));
app.use('/api/audio', require('./routes/audio'));
console.log("准备加载questions路由");
// 获取当前登录用户信息接口
app.get('/api/user', async (req,res)=>{
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({msg:"未携带token，请先登录"});
        }
        const token = authHeader.split(' ')[1];
        // ✅这里改成读取环境变量，和登录接口密钥统一
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        // .select("-password") 不返回密码字段，更安全
        const user = await User.findById(decoded.id).select("-password");
        if(!user){
            return res.status(404).json({msg:"用户不存在"})
        }
        res.json({ username: user.username, email: user.email })
    } catch (e) {
        return res.status(401).json({msg:"token无效或已过期", error:e.message})
    }
})

app.listen(PORT, ()=>{
    console.log(`Feynman Platform backend is running at http://localhost:${PORT}`)
})
