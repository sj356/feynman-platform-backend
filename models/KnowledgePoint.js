// models/KnowledgePoint.js
const mongoose = require('mongoose');

const KnowledgePointSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User' //关联User模型，代表这条知识点属于哪个用户
    },
    title: {
        type: String,
        required: true
    },
    content: {
        type: String,
        required: true
    },
    status: {
        type: String,
        default: 'not_started' //可选：not_started / in_progress / mastered
    },
    reviewList: {
        type: Boolean,
        default: false
    }
}, { timestamps: true });

module.exports = mongoose.model('KnowledgePoint', KnowledgePointSchema);
