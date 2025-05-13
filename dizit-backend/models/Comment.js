const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
movieId: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    username: { type: String, required: true },
    content: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    dislikes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    replies: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Comment' }],
});

commentSchema.index({ movieId: 1, parentId: 1, createdAt: -1 });
commentSchema.index({ parentId: 1 });

module.exports = mongoose.model('Comment', commentSchema);