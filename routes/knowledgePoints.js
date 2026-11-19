// routes/knowledgePoints.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const KnowledgePoint = require('../models/KnowledgePoint');
// 【新增】引入 RAG 向量索引服务
const { addKnowledgePointToStore } = require('../services/vectorStoreService');

//1. 创建知识点 POST /api/knowledge-points
router.post('/', auth, async (req, res) => {
  try {
    const { title, content } = req.body;
    const kp = new KnowledgePoint({
      title,
      content,
      user: req.user.id, // 从中间件拿到当前登录用户ID
    });
    const result = await kp.save();

    // 【新增】异步写入向量库，不 await、不阻塞接口返回；索引失败也不影响建知识点
    addKnowledgePointToStore(result);

    res.json(result);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: 'Server Error' });
  }
});

//2. 获取当前用户所有知识点 GET /api/knowledge-points
router.get('/', auth, async (req, res) => {
  try {
    const list = await KnowledgePoint.find({ user: req.user.id }).sort({ createdAt: -1 });
    res.json(list);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: 'Server Error' });
  }
});

//3. 获取单个知识点详情 GET /api/knowledge-points/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const kp = await KnowledgePoint.findById(req.params.id);
    if (!kp) {
      return res.status(404).json({ msg: 'Knowledge point not found' });
    }
    // 校验：只能查看自己的知识点
    if (kp.user.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'Not authorized' });
    }
    res.json(kp);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: 'Server Error' });
  }
});

//4. 更新知识点 PUT /api/knowledge-points/:id
router.put('/:id', auth, async (req, res) => {
  try {
    // 先查出更新前的对象，便于对比 content 是否真的变了
    const oldKp = await KnowledgePoint.findById(req.params.id);
    if (!oldKp) {
      return res.status(404).json({ msg: 'Knowledge point not found' });
    }
    if (oldKp.user.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'Not authorized' });
    }

    const { title, content, status, reviewList } = req.body;
    const updatedKp = await KnowledgePoint.findByIdAndUpdate(
      req.params.id,
      { $set: { title, content, status, reviewList } },
      { new: true }
    );

    // 【新增】只有内容真正变化时才重新向量化，避免无谓调用 Embedding
    if (updatedKp.content !== oldKp.content) {
      addKnowledgePointToStore(updatedKp);
    }

    res.json(updatedKp);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: 'Server Error' });
  }
});

//5. 删除知识点 DELETE /api/knowledge-points/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    let kp = await KnowledgePoint.findById(req.params.id);
    if (!kp) {
      return res.status(404).json({ msg: 'Knowledge point not found' });
    }
    if (kp.user.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'Not authorized' });
    }
    await KnowledgePoint.findByIdAndDelete(req.params.id);
    res.json({ msg: 'Knowledge point removed' });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: 'Server Error' });
  }
});

module.exports = router;
