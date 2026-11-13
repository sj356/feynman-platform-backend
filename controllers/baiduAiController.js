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

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    // 容错：模型常在题干/解析里写 LaTeX（如 \int \alpha），单反斜杠不是合法 JSON 转义。
    // 把“后面不是合法 JSON 转义字符”的单反斜杠补成双反斜杠，再解析一次。
    const fixed = cleaned.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
    return JSON.parse(fixed);
  }
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

// ========== 三、AI 出题（单选 / 多选 / 判断对错 / 简答） ==========

// 单选题 Prompt
function buildChoicePrompt(content, difficulty) {
  return `
你是一个专业的计算机科学出题专家。请根据以下知识点内容和指定难度，生成一道相关的单项选择题。

【知识点内容】:
"""
${content}
"""

【指定难度】: ${difficulty}（可选值：基础 / 中等 / 困难）

请严格按照以下 JSON 格式返回题目，不要包含任何额外解释、Markdown 代码块或文字，确保所有字段都存在：
{
  "type": "single-choice",
  "difficulty": "${difficulty}",
  "question": "这里是题干",
  "options": {
    "A": "选项A的内容",
    "B": "选项B的内容",
    "C": "选项C的内容",
    "D": "选项D的内容"
  },
  "answer": "C",
  "explanation": "这里是对正确答案的简短解释"
}
`;
}

// 多项选择题 Prompt（answer 为多个选项组成的数组）
function buildMultiplePrompt(content, difficulty) {
  return `
你是一个专业的计算机科学出题专家。请根据以下知识点内容和指定难度，生成一道相关的多项选择题（有两个或两个以上正确选项）。

【知识点内容】:
"""
${content}
"""

【指定难度】: ${difficulty}（可选值：基础 / 中等 / 困难）

请严格按照以下 JSON 格式返回题目，不要包含任何额外解释、Markdown 代码块或文字，确保所有字段都存在：
{
  "type": "multiple-choice",
  "difficulty": "${difficulty}",
  "question": "这里是题干（题干需提示有多个正确选项）",
  "options": {
    "A": "选项A的内容",
    "B": "选项B的内容",
    "C": "选项C的内容",
    "D": "选项D的内容"
  },
  "answer": ["A", "C"],
  "explanation": "这里是对正确答案的简短解释"
}
`;
}

// 判断对错题 Prompt（answer 为 "true" 或 "false"）
function buildTrueFalsePrompt(content, difficulty) {
  return `
你是一个专业的计算机科学出题专家。请根据以下知识点内容和指定难度，生成一道相关的判断对错题。

【知识点内容】:
"""
${content}
"""

【指定难度】: ${difficulty}（可选值：基础 / 中等 / 困难）

注意：题干和解释中不要使用 LaTeX 公式，不要出现反斜杠字符；数学符号用普通文字或常见符号描述（例如“积分”“F(b)-F(a)”）。

请严格按照以下 JSON 格式返回题目，不要包含任何额外解释、Markdown 代码块或文字，确保所有字段都存在：
{
  "type": "true-false",
  "difficulty": "${difficulty}",
  "question": "这里是一句需要判断正误的陈述句",
  "answer": "true",
  "explanation": "这里是判断理由的简短解释"
}
注意：answer 只能是 "true"（正确）或 "false"（错误）。
`;
}

// 简答题 Prompt（输出“答案要点”而非唯一标准答案）
function buildShortAnswerPrompt(content, difficulty) {
  return `
你是一个专业的计算机科学出题专家。请根据以下知识点内容和指定难度，生成一道相关的简答题。

【知识点内容】:
"""
${content}
"""

【指定难度】: ${difficulty}（可选值：基础 / 中等 / 困难）

请严格按照以下 JSON 格式返回题目，不要包含任何额外解释、Markdown 代码块或文字，确保所有字段都存在：
{
  "type": "short-answer",
  "difficulty": "${difficulty}",
  "question": "这里是简答题题干",
  "answer_key_points": [
    "答案要点1",
    "答案要点2",
    "答案要点3"
  ]
}
`;
}

// POST /api/ai/generate-question
// body: { knowledgePointContent, difficulty, type }
// type: 'single-choice' | 'multiple-choice' | 'true-false' | 'short-answer'
exports.generateQuestion = async (req, res) => {
  const { knowledgePointContent, difficulty, type } = req.body;

  if (!knowledgePointContent || !difficulty) {
    return res.status(400).json({ msg: '缺少知识点内容或难度' });
  }

  // 允许的四种题型，非法值默认单选
  const VALID_TYPES = ['single-choice', 'multiple-choice', 'true-false', 'short-answer'];
  const questionType = VALID_TYPES.includes(type) ? type : 'single-choice';

  const arkApiKey = process.env.ARK_API_KEY;
  const arkModel = process.env.ARK_MODEL;
  if (!arkApiKey || !arkModel) {
    return res.status(500).json({ msg: '后端未配置 ARK_API_KEY 或 ARK_MODEL' });
  }

  let prompt;
  if (questionType === 'single-choice') {
    prompt = buildChoicePrompt(knowledgePointContent, difficulty);
  } else if (questionType === 'multiple-choice') {
    prompt = buildMultiplePrompt(knowledgePointContent, difficulty);
  } else if (questionType === 'true-false') {
    prompt = buildTrueFalsePrompt(knowledgePointContent, difficulty);
  } else {
    prompt = buildShortAnswerPrompt(knowledgePointContent, difficulty);
  }

  try {
    const url = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';

    const response = await axios.post(
      url,
      {
        model: arkModel,
        messages: [{ role: 'user', content: prompt }],
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

    console.log('出题模型原始返回:', response.data);

    const llmText = extractLlmText(response.data);

    let questionData;
    try {
      questionData = parseLlmJson(llmText);
    } catch (parseError) {
      console.error('题目 JSON 解析失败:', llmText);
      return res.status(500).json({ msg: 'AI 返回格式错误，请稍后重试' });
    }

    // 兜底补齐字段，避免模型漏传
    questionData.type = questionType;
    questionData.difficulty = difficulty;

    res.json(questionData);
  } catch (error) {
    console.error(
      '调用大模型出题出错:',
      error.response ? error.response.data : error.message
    );
    res.status(500).json({
      msg: 'AI 出题失败',
      error: error.response ? error.response.data : error.message,
    });
  }
};

// POST /api/ai/grade-answer  （简答题 AI 评分）
// body: { question, answerKeyPoints, studentAnswer }
exports.gradeAnswer = async (req, res) => {
  const { question, answerKeyPoints, studentAnswer } = req.body;

  if (!question || !studentAnswer) {
    return res.status(400).json({ msg: '缺少题目或学生回答' });
  }

  const arkApiKey = process.env.ARK_API_KEY;
  const arkModel = process.env.ARK_MODEL;
  if (!arkApiKey || !arkModel) {
    return res.status(500).json({ msg: '后端未配置 ARK_API_KEY 或 ARK_MODEL' });
  }

  const keyPointsText = Array.isArray(answerKeyPoints)
    ? answerKeyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')
    : String(answerKeyPoints || '');

  const prompt = `
你是一个客观的计算机科学阅卷老师。请根据以下题目、答案要点和学生的回答，判断学生的回答是否正确，并给出简短解释。

【题目】:
${question}

【答案要点】:
${keyPointsText}

【学生的回答】:
${studentAnswer}

请严格按照以下 JSON 格式返回评判结果，不要包含任何额外解释、Markdown 代码块或文字：
{
  "isCorrect": true,
  "explanation": "这里是评判理由，例如：回答基本正确，覆盖了主要区别；或：回答混淆了相关概念。"
}
`;

  try {
    const url = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';

    const response = await axios.post(
      url,
      {
        model: arkModel,
        messages: [{ role: 'user', content: prompt }],
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

    console.log('评分模型原始返回:', response.data);

    const llmText = extractLlmText(response.data);
    let result;
    try {
      result = parseLlmJson(llmText);
    } catch (parseError) {
      console.error('评分 JSON 解析失败:', llmText);
      return res.status(500).json({ msg: 'AI 评分返回格式错误，请稍后重试' });
    }

    res.json({
      isCorrect: Boolean(result.isCorrect),
      explanation: result.explanation || '',
    });
  } catch (error) {
    console.error(
      '调用大模型评分出错:',
      error.response ? error.response.data : error.message
    );
    res.status(500).json({
      msg: 'AI 评分失败',
      error: error.response ? error.response.data : error.message,
    });
  }
};

// ========== 四、AI 知识点拆解 + 助教问答 ==========

// POST /api/ai/breakdown  把大主题拆成若干子知识点
// body: { topic }
exports.breakdownTopics = async (req, res) => {
  const { topic } = req.body;
  if (!topic || !String(topic).trim()) {
    return res.status(400).json({ msg: '缺少主题内容' });
  }

  const arkApiKey = process.env.ARK_API_KEY;
  const arkModel = process.env.ARK_MODEL;
  if (!arkApiKey || !arkModel) {
    return res.status(500).json({ msg: '后端未配置 ARK_API_KEY 或 ARK_MODEL' });
  }

  const prompt = `
你是一个计算机科学学习规划专家。请把下面的大主题拆解成 3 到 6 个循序渐进、相对独立的子知识点。

【大主题】:
"""
${topic}
"""

注意：子知识点的标题和讲解中不要使用 LaTeX 公式，不要出现反斜杠字符。

请严格按照以下 JSON 格式返回，不要包含任何额外解释、Markdown 代码块或文字：
{
  "topics": [
    { "title": "子知识点标题", "content": "该子知识点的简明讲解，100-200字，适合作为学习笔记" }
  ]
}
`;

  try {
    const url = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
    const response = await axios.post(
      url,
      {
        model: arkModel,
        messages: [{ role: 'user', content: prompt }],
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

    console.log('拆解模型原始返回:', response.data);

    const llmText = extractLlmText(response.data);
    let data;
    try {
      data = parseLlmJson(llmText);
    } catch (parseError) {
      console.error('拆解 JSON 解析失败:', llmText);
      return res.status(500).json({ msg: 'AI 返回格式错误，请稍后重试' });
    }

    const topics = Array.isArray(data.topics)
      ? data.topics.map((t) => ({ title: t.title || '', content: t.content || '' }))
      : [];
    res.json({ topics });
  } catch (error) {
    console.error('AI 拆解失败:', error.response ? error.response.data : error.message);
    res.status(500).json({
      msg: 'AI 拆解失败',
      error: error.response ? error.response.data : error.message,
    });
  }
};

// POST /api/ai/chat  围绕单个知识点的多轮助教问答
// body: { kpTitle, kpContent, messages: [{ role, content }] }
exports.chatTutor = async (req, res) => {
  const { kpTitle, kpContent, messages } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ msg: '缺少对话内容' });
  }

  const arkApiKey = process.env.ARK_API_KEY;
  const arkModel = process.env.ARK_MODEL;
  if (!arkApiKey || !arkModel) {
    return res.status(500).json({ msg: '后端未配置 ARK_API_KEY 或 ARK_MODEL' });
  }

  const systemContent = `你是一个耐心的计算机科学学习助教。请围绕下面这个知识点原文回答学生的问题，讲解清晰、举例恰当；如果问题超出知识点范围，可简要提示并引导回知识点，不要编造原文中没有的结论。

【知识点标题】: ${kpTitle || '未命名'}
【知识点原文】:
"""
${kpContent || '（无原文）'}
"""`;

  const history = messages.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || ''),
  }));

  try {
    const url = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
    const response = await axios.post(
      url,
      {
        model: arkModel,
        messages: [{ role: 'system', content: systemContent }, ...history],
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

    const reply = extractLlmText(response.data);
    res.json({ reply });
  } catch (error) {
    console.error('AI 问答失败:', error.response ? error.response.data : error.message);
    res.status(500).json({
      msg: 'AI 问答失败',
      error: error.response ? error.response.data : error.message,
    });
  }
};

// ========== 五、错题 AI 讲解 ==========

// POST /api/ai/explain-wrong  结合知识点原文讲清错题，并给变式题
// body: { kpTitle, kpContent, questionType, question, userAnswer, correctAnswer, explanation }
exports.explainWrong = async (req, res) => {
  const { kpTitle, kpContent, questionType, question, userAnswer, correctAnswer, explanation } = req.body;
  if (!question) {
    return res.status(400).json({ msg: '缺少错题内容' });
  }

  const arkApiKey = process.env.ARK_API_KEY;
  const arkModel = process.env.ARK_MODEL;
  if (!arkApiKey || !arkModel) {
    return res.status(500).json({ msg: '后端未配置 ARK_API_KEY 或 ARK_MODEL' });
  }

  const typeMap = {
    'single-choice': '单项选择',
    'multiple-choice': '多项选择',
    'true-false': '判断对错',
    'short-answer': '简答题',
  };

  const prompt = `
你是一名耐心的学习辅导老师。下面是学生答错的一道题，请结合知识点原文给出通俗讲解。

【知识点标题】: ${kpTitle || '未命名'}
【知识点原文】:
"""
${kpContent || '（无原文）'}
"""
【题型】: ${typeMap[questionType] || questionType || '未知'}
【题目】: ${question}
【学生作答】: ${userAnswer || '（未作答）'}
【正确答案】: ${correctAnswer || '（见解析）'}
【原有解析】: ${explanation || '（无）'}

注意：讲解中不要使用 LaTeX 公式，不要出现反斜杠字符。

请严格按以下 JSON 格式返回，不要包含 Markdown 代码块或额外文字：
{
  "explain": "用通俗的话讲清这道题为什么是这个答案，结合知识点原文，150-250字",
  "pitfalls": "学生最容易混淆或出错的点，1-2句话",
  "variant": "一道同知识点的同类变式题（题干 + 正确答案要点），用于巩固"
}
`;

  try {
    const url = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
    const response = await axios.post(
      url,
      {
        model: arkModel,
        messages: [{ role: 'user', content: prompt }],
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

    const llmText = extractLlmText(response.data);
    let data;
    try {
      data = parseLlmJson(llmText);
    } catch (parseError) {
      console.error('错题讲解 JSON 解析失败:', llmText);
      return res.status(500).json({ msg: 'AI 返回格式错误，请稍后重试' });
    }

    res.json({
      explain: data.explain || '',
      pitfalls: data.pitfalls || '',
      variant: data.variant || '',
    });
  } catch (error) {
    console.error('错题讲解失败:', error.response ? error.response.data : error.message);
    res.status(500).json({
      msg: 'AI 讲解失败',
      error: error.response ? error.response.data : error.message,
    });
  }
};

// ========== 六、AI 生成学习笔记 ==========

// POST /api/ai/note  把知识点整理成结构化 Markdown 笔记
// body: { title, content }
exports.generateNote = async (req, res) => {
  const { title, content } = req.body;
  if (!content || !String(content).trim()) {
    return res.status(400).json({ msg: '缺少知识点内容' });
  }

  const arkApiKey = process.env.ARK_API_KEY;
  const arkModel = process.env.ARK_MODEL;
  if (!arkApiKey || !arkModel) {
    return res.status(500).json({ msg: '后端未配置 ARK_API_KEY 或 ARK_MODEL' });
  }

  const prompt = `
你是一名擅长整理笔记的学习助教。请把下面的知识点整理成一份结构清晰、适合复习的 Markdown 学习笔记。

【知识点标题】: ${title || '未命名'}
【知识点原文】:
"""
${content}
"""

要求：
1. 用 Markdown 输出，包含：一句话概述、核心要点（分点列出）、关键术语解释、易错/注意点、一句话总结；
2. 语言简明准确，适合考前快速复习；
3. 不要使用 LaTeX 公式，不要出现反斜杠字符；
4. 直接输出笔记正文，不要额外开场白或代码块包裹。
`;

  try {
    const url = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
    const response = await axios.post(
      url,
      {
        model: arkModel,
        messages: [{ role: 'user', content: prompt }],
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

    const note = extractLlmText(response.data);
    res.json({ note });
  } catch (error) {
    console.error('AI 生成笔记失败:', error.response ? error.response.data : error.message);
    res.status(500).json({
      msg: 'AI 生成笔记失败',
      error: error.response ? error.response.data : error.message,
    });
  }
};
