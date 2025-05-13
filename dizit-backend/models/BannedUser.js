const mongoose = require('mongoose');

const bannedUserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    bannedAt: { type: Date, default: Date.now }
    
});

module.exports = mongoose.model('BannedUser', bannedUserSchema);