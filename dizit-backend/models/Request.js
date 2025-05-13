const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    sender: { type: String, enum: ['user', 'admin'], required: true },
    content: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

const requestSchema = new mongoose.Schema({
    type: { type: String, enum: ['request', 'complaint'], required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    messages: [messageSchema],
    isClosed: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Request', requestSchema);