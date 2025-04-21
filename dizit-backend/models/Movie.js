const mongoose = require('mongoose');

// Video kaynağı için alt şema
const videoSourceSchema = new mongoose.Schema({
    type: { type: String, required: true },
    src: { type: String, required: true }
});

const movieSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    title2: String,
    year: { type: Number, required: true }, // year alanını zorunlu yap
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
    episodes: [{
        seasonNumber: Number,
        episodeNumber: Number,
        title: String,
        videoSrc: [videoSourceSchema]
    }],
    season: Number
});
module.exports = mongoose.model('Movie', movieSchema);