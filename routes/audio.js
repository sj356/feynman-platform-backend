// routes/audio.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const auth = require('../middleware/auth');
const { transcribeAudio } = require('../controllers/baiduAiController');

// 用内存存储，音频只临时中转给百度，不存硬盘
const upload = multer({ storage: multer.memoryStorage() });

// POST /api/audio/transcribe
router.post(
  '/transcribe',
  auth,
  upload.single('audio'),  // 'audio' 必须和前端 FormData 的字段名一致
  transcribeAudio
);

module.exports = router;
