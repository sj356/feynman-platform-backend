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

/**
 * 从向量数据库中检索与问题最相关的文档片段
 * @param {string} query 用户的问题
 * @param {number} k 返回最相关的 k 个片段，默认 4
 * @returns {Promise<Array<{pageContent:string, metadata:object}>>}
 */
exports.queryVectorStore = async (query, k = 4) => {
  try {
    // 1. 加载本地向量库
    const vectorStore = await HNSWLib.load(VECTOR_STORE_PATH, embeddings);

    // 2. 创建检索器，返回语义最相近的 k 个结果
    const retriever = vectorStore.asRetriever(k);

    // 3. 用问题向量做相似度检索
    const relevantDocs = await retriever.invoke(query);

    console.log(`为问题 "${query}" 检索到 ${relevantDocs.length} 个相关文档。`);
    return relevantDocs;
  } catch (error) {
    // 向量库文件还不存在（还没索引过任何知识点）时按空结果处理，不抛错
    const msg = error?.message || '';
    const notExist =
      error?.code === 'ENOENT' ||
      msg.includes('No such file or directory') ||
      msg.includes('ENOENT') ||
      msg.includes('cannot find') ||
      msg.includes('Cannot find');
    if (notExist) {
      console.log('向量库尚未创建，返回空检索结果。');
      return [];
    }
    console.error('从向量库检索失败:', error?.response?.data || error.message || error);
    throw error;
  }
};

/**
 * 按当前数据库里现存的知识点重建本地向量库。
 * 用途：删除知识点后，把旧向量（含已删除条目）清掉，只保留现存知识点的向量。
 * @param {Array<{_id:any, title?:string, content:string}>} knowledgePoints 现存知识点列表
 */
exports.rebuildIndexForKnowledgePoints = async (knowledgePoints = []) => {
  try {
    // 1. 过滤掉内容为空的条目，并切分文本、挂上知识点 id
    const docs = [];
    for (const kp of knowledgePoints) {
      if (!kp || !kp.content || !String(kp.content).trim()) continue;
      const chunks = await textSplitter.createDocuments(
        [kp.content],
        [{ knowledgePointId: kp._id.toString() }]
      );
      docs.push(...chunks);
    }

    // 2. 没有现存知识点：直接清空本地向量库文件
    if (docs.length === 0) {
      await HNSWLib.delete({ directory: VECTOR_STORE_PATH }).catch(() => {});
      console.log('现存知识点为空，已清空本地向量库。');
      return;
    }

    // 3. 用现存知识点重新向量化并落盘（覆盖旧库）
    const vectorStore = await HNSWLib.fromDocuments(docs, embeddings);
    await vectorStore.save(VECTOR_STORE_PATH);
    console.log(`已按 ${knowledgePoints.length} 条现存知识点重建向量库，共 ${docs.length} 个文本块。`);
  } catch (error) {
    // 重建失败不影响主业务（知识点本身已在数据库），只记录错误
    console.error('重建向量库失败:', error?.response?.data || error.message || error);
  }
};
