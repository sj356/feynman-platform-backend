// models/StudyRecord.js
// 学习记录：复述 / 测评作答的历史留存，用于错题本与统计看板
const mongoose = require('mongoose');

const StudyRecordSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  // 关联知识点（复述/测评都归属某个知识点；AI 拆解等场景可留空）
  kp: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'KnowledgePoint',
    default: null,
  },
  // 记录来源：feynman 复述 / quiz 单题测评 / exam 综合测评
  source: {
    type: String,
    required: true,
    enum: ['feynman', 'quiz', 'exam'],
  },
  // 题型：single-choice / multiple-choice / true-false / short-answer / feynman
  questionType: {
    type: String,
    default: '',
  },
  question: { type: String, default: '' },
  // 选择题选项快照（{A: 文案, B: 文案...}），用于错题重做时还原原题
  options: { type: Object, default: {} },
  userAnswer: { type: String, default: '' },
  correctAnswer: { type: String, default: '' },
  // 判断题：true/false；复述无对错时为 null
  isCorrect: { type: Boolean, default: null },
  // 复述综合得分（0-100），客观题为空
  score: { type: Number, default: null },
  explanation: { type: String, default: '' },
  // 复述 AI 反馈快照（润色/评价/优缺点）
  feedback: { type: Object, default: {} },
}, { timestamps: true });

module.exports = mongoose.model('StudyRecord', StudyRecordSchema);
