const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authMiddleware = (req, res, next) => {
  const authStr = req.headers.authorization;
  if (!authStr || !authStr.startsWith('Bearer ')) {
    return res.status(401).json({msg: "未携带token"});
  }
  const token = authStr.split(' ')[1];
  try {
    // ✅ 和登录保持一致：读取环境变量 JWT_SECRET
    const decode = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decode;
    next();
  } catch(e) {
    return res.status(401).json({msg: "token无效或过期"});
  }
}

// 用户注册接口【新增邮箱格式校验】
router.post('/register', async (req,res)=>{
    try {
        const {username, email, password} = req.body;
        // 邮箱正则校验
        const emailReg = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if(!emailReg.test(email)){
            return res.status(400).json({msg:"邮箱格式不正确！必须包含@和域名，例如 xxx@test.com"})
        }
        // 1. 检查用户名或邮箱是否已存在
        const existUser = await User.findOne({$or:[{email},{username}]});
        if(existUser){
            return res.status(400).json({msg:"用户名或邮箱已存在"})
        }
        // 2. 密码加密（bcrypt自动加盐，存进库的是密文）
        const hashedPassword = await bcrypt.hash(password, 10);
        // 3. 存入数据库
        const newUser = new User({username, email, password: hashedPassword});
        await newUser.save();
        res.status(201).json({msg:"注册成功"})
    } catch (e) {
        res.status(500).json({msg:"服务器错误", error:e.message})
    }
})

// 用户登录接口
router.post('/login', async (req,res)=>{
    try {
        const {username, password} = req.body;
        // 1. 查找用户
        const user = await User.findOne({username});
        if(!user){
            return res.status(400).json({msg:"用户不存在"})
        }
        // 2. 比对密码（明文 vs 库里的密文）
        const isMatch = await bcrypt.compare(password, user.password);
        if(!isMatch){
            return res.status(400).json({msg:"密码错误"})
        }
        // 3. 签发JWT令牌（7天有效）
        const token = jwt.sign(
            { id: user._id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );
        res.json({ msg:"登录成功", token, user:{ username: user.username, email: user.email } })
    } catch (e) {
        res.status(500).json({msg:"服务器错误", error:e.message})
    }
})

// ✅ 新增 获取用户信息接口
router.get('/info', authMiddleware, async (req, res)=>{
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json(user);
  } catch (err) {
    console.log(err)
    res.status(401).json({msg: "token无效"});
  }
})

module.exports = router;
