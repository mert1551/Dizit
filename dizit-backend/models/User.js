const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isAdmin: { type: Boolean, default: false },
    likes: [{ seriesId: String, seasonNumber: Number, episodeNumber: Number }],
    dislikes: [{ seriesId: String, seasonNumber: Number, episodeNumber: Number }],
    watched: [{ seriesId: String, seasonNumber: Number, episodeNumber: Number }],
    favorites: [{ seriesId: String, seasonNumber: Number, episodeNumber: Number }],
    loginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },
    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date }
});

module.exports = mongoose.model('User', userSchema);
