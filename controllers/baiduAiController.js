// controllers/baiduAiController.js
const AipSpeechClient = require("baidu-aip-sdk").speech;
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { Readable } = require('stream');

ffmpeg.setFfmpegPath(ffmpegPath);

const APP_ID = process.env.BAIDU_APP_ID;
const API_KEY = process.env.BAIDU_API_KEY;
const SECRET_KEY = process.env.BAIDU_SECRET_KEY;

const client = new AipSpeechClient(APP_ID, API_KEY, SECRET_KEY);

// 把浏览器录的 webm/opus 转成百度要的 wav(16k, 单声道, 16bit PCM)
function convertToWav(inputBuffer) {
  return new Promise((resolve, reject) => {
    const stream = Readable.from(inputBuffer);
    const chunks = [];
    ffmpeg(stream)
      .toFormat('wav')
      .audioFrequency(16000)   // 百度要求 16000
      .audioChannels(1)         // 单声道
      .audioCodec('pcm_s16le') // 16bit PCM
      .on('error', reject)
      .pipe()
      .on('data', (chunk) => chunks.push(chunk))
      .on('end', () => resolve(Buffer.concat(chunks)));
  });
}

exports.transcribeAudio = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ msg: '没有收到音频文件' });
  }

  const inputBuffer = req.file.buffer;
  console.log('收到音频，大小:', inputBuffer.length, '字节，原始格式:', req.file.mimetype);

  try {
    // 先转码成百度要的 wav
    console.log('正在转码为 wav 16k...');
    const wavBuffer = await convertToWav(inputBuffer);
    console.log('转码完成，wav 大小:', wavBuffer.length, '字节');

    // 调百度短语音识别
    const result = await client.recognize(wavBuffer, 'wav', 16000, {
      dev_pid: 1537,
    });

    console.log('百度ASR返回:', result);

    if (result.err_no === 0) {
      res.json({ result: result.result[0] || '' });
    } else {
      res.status(500).json({
        msg: '百度语音识别失败',
        error_code: result.err_no,
        error_msg: result.err_msg,
      });
    }
  } catch (error) {
    console.error('处理出错:', error);
    res.status(500).json({ msg: '服务器处理出错', error: error.message });
  }
};
