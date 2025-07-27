const mongoose = require('mongoose');

// Video kaynağı için alt şema
const videoSourceSchema = new mongoose.Schema({
    type: { type: String, required: true },
    src: { type: String, required: true }
});

// Bölüm şeması
const episodeSchema = new mongoose.Schema({
    seasonNumber: { type: Number, required: true },
    episodeNumber: { type: Number, required: true },
    title: String,
    videoSrc: [videoSourceSchema],
    addedDate: { type: Date, default: Date.now } // Her bölüm için eklenme tarihi
});

const movieSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    title2: String,
    title_normalized: String,
    title2_normalized: String,
    year: { type: Number, required: true },
    runtime: String,
    rating: Number,
    country: [String],
    language: [String],
    genres: [String],
    plot: String,
    poster: String,
    videoSrc: [videoSourceSchema],
    relatedSeries: [String],
    type: { type: String, required: true },
    premium: { type: Boolean, default: false }, 
    views: {
  type: Number,
  default: 0
},

    episodes: [episodeSchema],
    season: Number
});

module.exports = mongoose.model('Movie', movieSchema);