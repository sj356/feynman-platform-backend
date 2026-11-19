// test-embedding.js —— 验证千帆向量化是否打通，测完可删除
require('dotenv').config();
const { OpenAIEmbeddings } = require('@langchain/openai');

async function test() {
  const emb = new OpenAIEmbeddings({
    apiKey: process.env.QIANFAN_API_KEY,
    model: process.env.QIANFAN_EMBEDDING_MODEL || 'Embedding-V1',
    configuration: {
      baseURL: process.env.QIANFAN_BASE_URL || 'https://qianfan.baidubce.com/v2',
    },
  });
  const vec = await emb.embedQuery('React Hooks 是函数组件里管理状态和副作用的方式');
  console.log('向量维度：', vec.length);
  console.log('前 5 个值：', vec.slice(0, 5));
}

test().catch((e) => console.error('报错：', e.message || e));
