// routes/statistics.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const KnowledgePoint = require('../models/KnowledgePoint');
const StudyRecord = require('../models/StudyRecord');

// GET /api/statistics/overview  首页看板聚合数据
router.get('/overview', auth, async (req, res) => {
  try {
    const oid = new mongoose.Types.ObjectId(req.user.id);

    // 知识点状态分布
    const kpAgg = await KnowledgePoint.aggregate([
      { $match: { user: oid } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          mastered: { $sum: { $cond: [{ $eq: ['$status', 'mastered'] }, 1, 0] } },
          inProgress: { $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 1, 0] } },
          notStarted: { $sum: { $cond: [{ $eq: ['$status', 'not_started'] }, 1, 0] } },
          reviewCount: { $sum: { $cond: ['$reviewList', 1, 0] } },
        },
      },
    ]);

    // 学习记录聚合
    const recAgg = await StudyRecord.aggregate([
      { $match: { user: oid } },
      {
        $group: {
          _id: null,
          answerCount: { $sum: { $cond: [{ $ne: ['$isCorrect', null] }, 1, 0] } },
          correctCount: { $sum: { $cond: [{ $eq: ['$isCorrect', true] }, 1, 0] } },
          wrongCount: { $sum: { $cond: [{ $eq: ['$isCorrect', false] }, 1, 0] } },
          feynmanCount: { $sum: { $cond: [{ $eq: ['$source', 'feynman'] }, 1, 0] } },
          scoreSum: { $sum: { $cond: [{ $ne: ['$score', null] }, '$score', 0] } },
          scoreCount: { $sum: { $cond: [{ $ne: ['$score', null] }, 1, 0] } },
        },
      },
    ]);

    const k = kpAgg[0] || {};
    const r = recAgg[0] || {};

    const answerCount = r.answerCount || 0;
    const correctCount = r.correctCount || 0;
    const accuracy = answerCount ? Math.round((correctCount / answerCount) * 100) : 0;
    const avgScore = r.scoreCount ? Math.round((r.scoreSum / r.scoreCount) * 10) / 10 : 0;

    res.json({
      kpTotal: k.total || 0,
      mastered: k.mastered || 0,
      inProgress: k.inProgress || 0,
      notStarted: k.notStarted || 0,
      reviewCount: k.reviewCount || 0,
      answerCount,
      correctCount,
      wrongCount: r.wrongCount || 0,
      accuracy,
      feynmanCount: r.feynmanCount || 0,
      avgScore,
    });
  } catch (err) {
    console.error('统计聚合失败:', err.message);
    res.status(500).json({ msg: 'Server Error' });
  }
});

// GET /api/statistics/mastery-map  各知识点掌握分（0-100）
// 算法：客观题正确率占 60%，复述均分占 40%；无记录为 0
router.get('/mastery-map', auth, async (req, res) => {
  try {
    const oid = new mongoose.Types.ObjectId(req.user.id);

    const agg = await StudyRecord.aggregate([
      { $match: { user: oid, kp: { $ne: null } } },
      {
        $group: {
          _id: '$kp',
          answerCount: { $sum: { $cond: [{ $ne: ['$isCorrect', null] }, 1, 0] } },
          correctCount: { $sum: { $cond: [{ $eq: ['$isCorrect', true] }, 1, 0] } },
          feynmanCount: { $sum: { $cond: [{ $eq: ['$source', 'feynman'] }, 1, 0] } },
          scoreSum: { $sum: { $cond: [{ $ne: ['$score', null] }, '$score', 0] } },
          scoreCount: { $sum: { $cond: [{ $ne: ['$score', null] }, 1, 0] } },
        },
      },
    ]);

    const map = {};
    let scoreTotal = 0;
    let scoredCount = 0;

    agg.forEach((item) => {
      const answerPart = item.answerCount
        ? (item.correctCount / item.answerCount) * 60
        : 0;
      const feynmanPart = item.scoreCount
        ? ((item.scoreSum / item.scoreCount) / 100) * 40
        : 0;
      const score = Math.max(0, Math.min(100, Math.round(answerPart + feynmanPart)));
      map[item._id.toString()] = score;
      scoreTotal += score;
      scoredCount += 1;
    });

    const avgMastery = scoredCount ? Math.round(scoreTotal / scoredCount) : 0;

    res.json({ map, avgMastery });
  } catch (err) {
    console.error('掌握度聚合失败:', err.message);
    res.status(500).json({ msg: 'Server Error' });
  }
});

module.exports = router;