const jwt = require('jsonwebtoken');
module.exports = function(req, res, next) {
  // 从 Authorization 请求头拿token，格式 Bearer xxxxx
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ msg: 'No token, authorization denied' });
  }
  const token = authHeader.split(' ')[1];
  try {
    // 校验token密钥
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // 把用户id挂载到req对象，后续接口直接使用 req.user.id
    req.user = decoded;
    next(); //放行，进入接口处理函数
  } catch (err) {
    return res.status(401).json({ msg: 'Token is not valid' });
  }
};
