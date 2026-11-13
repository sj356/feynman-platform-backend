// routes/records.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const StudyRecord = require('../models/StudyRecord');

// 1. 新增一条学习记录 POST /api/records
router.post('/', auth, async (req, res) => {
  try {
    const {
      kp,
      source,
      questionType,
      question,
      options,
      userAnswer,
      correctAnswer,
      isCorrect,
      score,
      explanation,
      feedback,
    } = req.body;

    const record = new StudyRecord({
      user: req.user.id,
      kp: kp || null,
      source,
      questionType: questionType || '',
      question: question || '',
      options: options || {},
      userAnswer: userAnswer || '',
      correctAnswer: correctAnswer || '',
      isCorrect: typeof isCorrect === 'boolean' ? isCorrect : null,
      score: typeof score === 'number' ? score : null,
      explanation: explanation || '',
      feedback: feedback || {},
    });
    const result = await record.save();
    res.json(result);
  } catch (err) {
    console.error('新增学习记录失败:', err.message);
    res.status(500).json({ msg: 'Server Error' });
  }
});

// 2. 查询记录列表 GET /api/records?kpId=&wrong=1&source=
router.get('/', auth, async (req, res) => {
  try {
    const filter = { user: req.user.id };
    if (req.query.kpId) filter.kp = req.query.kpId;
    if (req.query.source) filter.source = req.query.source;
    // wrong=1 只看答错的客观题
    if (req.query.wrong === '1') filter.isCorrect = false;

    const list = await StudyRecord.find(filter)
      .populate('kp', 'title status reviewList')
      .sort({ createdAt: -1 });
    res.json(list);
  } catch (err) {
    console.error('查询学习记录失败:', err.message);
    res.status(500).json({ msg: 'Server Error' });
  }
});

// 3. 删除一条记录（移出错题本）DELETE /api/records/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const record = await StudyRecord.findById(req.params.id);
    if (!record) return res.status(404).json({ msg: '记录不存在' });
    if (record.user.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'Not authorized' });
    }
    await StudyRecord.findByIdAndDelete(req.params.id);
    res.json({ msg: '记录已删除' });
  } catch (err) {
    console.error('删除学习记录失败:', err.message);
    res.status(500).json({ msg: 'Server Error' });
  }
});

module.exports = router;
