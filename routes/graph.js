// routes/graph.js
// 知识图谱数据接口：把当前用户的知识点整理成 ECharts 力导向图需要的 nodes / links
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const KnowledgePoint = require('../models/KnowledgePoint');

// @route   GET /api/graph/knowledge-map
// @desc    获取知识图谱数据（节点 + 引用关系边）
// @access  Private
router.get('/knowledge-map', auth, async (req, res) => {
  try {
    // 只取当前登录用户自己的知识点
    const kps = await KnowledgePoint.find({ user: req.user.id }).sort({ createdAt: 1 });

    if (kps.length === 0) {
      return res.json({ nodes: [], links: [] });
    }

    // 1. 节点列表：标题 + 内容摘要 + 状态（供前端按状态着色）
    const nodes = kps.map((kp) => ({
      id: kp._id.toString(),
      name: kp.title,
      value: kp.content ? kp.content.substring(0, 100) : '',
      status: kp.status || 'not_started',
      reviewList: !!kp.reviewList,
      createdAt: kp.createdAt,
      // 节点大小：内容越长越大，限制在 20~50 之间
      symbolSize: 20 + Math.min((kp.content ? kp.content.length : 0) / 50, 30),
    }));

    // 2. 边列表：知识点 A 的 content 里提到了知识点 B 的 title，就建一条 A -> B 的「引用」边
    const titleToId = new Map(kps.map((kp) => [kp.title, kp._id.toString()]));
    const links = [];
    const seen = new Set(); // 去重，避免重复建边

    for (const sourceKp of kps) {
      const sourceId = sourceKp._id.toString();
      for (const targetTitle of titleToId.keys()) {
        const targetId = titleToId.get(targetTitle);
        // 跳过自己指向自己
        if (sourceId === targetId) continue;
        if (sourceKp.content && sourceKp.content.includes(targetTitle)) {
          const key = `${sourceId}->${targetId}`;
          if (!seen.has(key)) {
            seen.add(key);
            links.push({
              source: sourceId,
              target: targetId,
              label: { show: true, formatter: '引用' },
            });
          }
        }
      }
    }

    res.json({ nodes, links });
  } catch (error) {
    console.error('Error generating knowledge graph:', error);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
