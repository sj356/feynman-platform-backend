// routes/audio.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const auth = require('../middleware/auth');
const { transcribeAudio, evaluateFeynmanAttempt } = require('../controllers/baiduAiController');

const upload = multer({ storage: multer.memoryStorage() });

// POST /api/audio/transcribe  上传音频并语音识别
router.post(
  '/transcribe',
  auth,
  upload.single('audio'),
  transcribeAudio
);

// 👇 新增：POST /api/audio/evaluate  大模型润色 + 评价打分
router.post('/evaluate', auth, evaluateFeynmanAttempt);

module.exports = router;
