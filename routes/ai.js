// routes/ai.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
  generateQuestion,
  gradeAnswer,
  breakdownTopics,
  chatTutor,
  explainWrong,
  generateNote,
} = require('../controllers/baiduAiController');

// POST /api/ai/generate-question  AI 出题
router.post('/generate-question', auth, generateQuestion);

// POST /api/ai/grade-answer  AI 评判简答（挑战任务）
router.post('/grade-answer', auth, gradeAnswer);

// POST /api/ai/breakdown  AI 把大主题拆成子知识点
router.post('/breakdown', auth, breakdownTopics);

// POST /api/ai/chat  知识点助教多轮问答
router.post('/chat', auth, chatTutor);

// POST /api/ai/explain-wrong  错题 AI 讲解
router.post('/explain-wrong', auth, explainWrong);

// POST /api/ai/note  AI 生成结构化学习笔记
router.post('/note', auth, generateNote);

module.exports = router;
