// services/vectorStoreService.js
// RAG 索引服务：知识点切分 → 千帆向量化 → 存入本地 HNSWLib 向量库
const path = require('path');
const { HNSWLib } = require('@langchain/community/vectorstores/hnswlib');
const { OpenAIEmbeddings } = require('@langchain/openai');
const {
  RecursiveCharacterTextSplitter,
} = require('@langchain/textsplitters');

// 向量库在本地磁盘的保存目录（后端根目录下的 vector_store）
const VECTOR_STORE_PATH = path.join(__dirname, '../vector_store');

// 初始化千帆 Embedding 模型（ModelBuilder OpenAI 兼容接口）
// 鉴权使用单串 Bearer Key（bce-v3/ALTAK-...），走 https://qianfan.baidubce.com/v2
const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.QIANFAN_API_KEY,
  model: process.env.QIANFAN_EMBEDDING_MODEL || 'Embedding-V1',
  configuration: {
    baseURL: process.env.QIANFAN_BASE_URL || 'https://qianfan.baidubce.com/v2',
  },
});

// 文本分割器：把长知识点切成带重叠的小块，保证语义连续
const textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 500,    // 每个文本块最大长度（字符）
  chunkOverlap: 50,  // 相邻块重叠长度，避免上下文被切断
});

/**
 * 将单个知识点的内容写入向量数据库
 * @param {object} knowledgePoint 含 _id 和 content 的知识点对象
 */
exports.addKnowledgePointToStore = async (knowledgePoint) => {
  try {
    // 空内容跳过，避免产生空向量触发接口报错
    if (!knowledgePoint || !knowledgePoint.content || !knowledgePoint.content.trim()) {
      console.log('知识点内容为空，跳过向量化。');
      return;
    }

    console.log(`正在为知识点 ${knowledgePoint._id} 创建向量...`);

    // 1. 切分文本，并给每个文本块挂上知识点 id 作为元数据
    const docs = await textSplitter.createDocuments(
      [knowledgePoint.content],
      [{ knowledgePointId: knowledgePoint._id.toString() }]
    );

    console.log(`知识点被分割成 ${docs.length} 个文本块。`);

    // 2. 向量库已存在则加载后追加；不存在则新建
    let vectorStore;
    try {
      vectorStore = await HNSWLib.load(VECTOR_STORE_PATH, embeddings);
      await vectorStore.addDocuments(docs);
      console.log('向已存在的向量库中添加了新文档。');
    } catch (e) {
      console.log('未找到向量库，正在创建新的...');
      vectorStore = await HNSWLib.fromDocuments(docs, embeddings);
    }

    // 3. 把向量库持久化到本地文件
    await vectorStore.save(VECTOR_STORE_PATH);
    console.log(`知识点 ${knowledgePoint._id} 的向量已成功保存。`);
  } catch (error) {
    // 索引失败不影响主业务（知识点本身已入库），只记录错误
    console.error('添加到向量库失败:', error?.response?.data || error.message || error);
  }
};
