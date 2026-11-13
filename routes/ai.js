// routes/ai.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { generateQuestion, gradeAnswer } = require('../controllers/baiduAiController');

// POST /api/ai/generate-question  AI 出题
router.post('/generate-question', auth, generateQuestion);

// POST /api/ai/grade-answer  AI 评判简答（挑战任务）
router.post('/grade-answer', auth, gradeAnswer);

module.exports = router;
