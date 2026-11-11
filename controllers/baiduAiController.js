// controllers/baiduAiController.js
const AipSpeechClient = require("baidu-aip-sdk").speech;
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { Readable } = require('stream');

ffmpeg.setFfmpegPath(ffmpegPath);

const APP_ID = process.env.BAIDU_APP_ID;
const API_KEY = process.env.BAIDU_API_KEY;
const SECRET_KEY = process.env.BAIDU_SECRET_KEY;

const client = new AipSpeechClient(APP_ID, API_KEY, SECRET_KEY);

// ========== 一、语音识别（原有逻辑，保留） ==========

function convertToWav(inputBuffer) {
  return new Promise((resolve, reject) => {
    const stream = Readable.from(inputBuffer);
    const chunks = [];
    ffmpeg(stream)
      .toFormat('wav')
      .audioFrequency(16000)
      .audioChannels(1)
      .audioCodec('pcm_s16le')
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
    console.log('正在转码为 wav 16k...');
    const wavBuffer = await convertToWav(inputBuffer);
    console.log('转码完成，wav 大小:', wavBuffer.length, '字节');

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

// ========== 二、豆包（火山方舟）AI 润色与评价 ==========

// 从大模型返回里把文本内容抠出来（兼容 choices[0].message.content 和老格式 result）
function extractLlmText(data) {
  if (data.choices && data.choices[0] && data.choices[0].message) {
    return data.choices[0].message.content || '';
  }
  if (data.message && data.message.content) return data.message.content;
  if (typeof data.result === 'string') return data.result;
  return '';
}

// 兜底解析大模型返回的 JSON（去掉 ```json 代码块包裹再解析）
function parseLlmJson(text) {
  let cleaned = String(text).trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();
  return JSON.parse(cleaned);
}

// 评价费曼复述：润色文本 + 综合评价 + 优缺点 + 打分
exports.evaluateFeynmanAttempt = async (req, res) => {
  const { originalContent, transcribedText } = req.body;

  if (!originalContent || !transcribedText) {
    return res.status(400).json({ msg: '缺少原始知识点或复述文本' });
  }

  const arkApiKey = process.env.ARK_API_KEY;
  const arkModel = process.env.ARK_MODEL;

  if (!arkApiKey || !arkModel) {
    return res.status(500).json({ msg: '后端未配置 ARK_API_KEY 或 ARK_MODEL' });
  }

  try {
    const url = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';

    const prompt = `
你是一个严格而友善的计算机科学学习教练。你的任务是评估学生对一个知识点的复述，并给出反馈。
【原始知识点】:
\`\`\`
${originalContent}
\`\`\`
【学生的口头复述文本】:
\`\`\`
${transcribedText}
\`\`\`

请你完成以下三项任务:
1. 文本润色：将学生的复述文本润色成一段通顺、专业、书面化的文字。修正明显的语法错误和口语化表达，但保持其核心观点不变。
2. 综合评价：基于原始知识点，对学生的复述进行评价，指出优点和可以改进的地方。
3. 评分：综合考虑准确性、完整性、逻辑性和流畅性，给出一个 0 到 100 的整数分数。

请严格按照以下 JSON 格式返回结果，不要包含任何额外的解释、Markdown 代码块或文字。
{
  "polishedText": "这里是润色后的文本",
  "evaluation": "这里是你的综合评价",
  "strengths": ["优点1", "优点2"],
  "weaknesses": ["可以改进的地方1", "可以改进的地方2"],
  "score": 85
}
`;

    const response = await axios.post(
      url,
      {
        model: arkModel,
        messages: [{ role: 'user', content: prompt }],
        // 关闭深度思考，加快响应并避免思考链混进最终答案
        thinking: { type: 'disabled' },
      },
      {
        headers: {
          Authorization: `Bearer ${arkApiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    console.log('豆包大模型原始返回:', response.data);

    const llmText = extractLlmText(response.data);
    const feedback = parseLlmJson(llmText);

    res.json({
      polishedText: feedback.polishedText || '',
      evaluation: feedback.evaluation || '',
      strengths: Array.isArray(feedback.strengths) ? feedback.strengths : [],
      weaknesses: Array.isArray(feedback.weaknesses) ? feedback.weaknesses : [],
      score: Number(feedback.score) || 0,
    });
  } catch (error) {
    console.error(
      '调用豆包大模型出错:',
      error.response ? error.response.data : error.message
    );
    res.status(500).json({
      msg: 'AI 评价失败',
      error: error.response ? error.response.data : error.message,
    });
  }
};
