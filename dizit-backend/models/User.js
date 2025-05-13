const mongoose = require("mongoose")

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isAdmin: { type: Boolean, default: false },
    premiumExpires: { type: Date, default: null },
    premiumType: {
      type: String,
      enum: ["none", "1-minute", "1-week", "1-month", "1-year", "unlimited"],
      default: "none",
    },
    likes: [{ seriesId: String, seasonNumber: Number, episodeNumber: Number }],
    dislikes: [{ seriesId: String, seasonNumber: Number, episodeNumber: Number }],
    watched: [{ seriesId: String, seasonNumber: Number, episodeNumber: Number }],
    favorites: [{ seriesId: String, seasonNumber: Number, episodeNumber: Number }],
    watchLater: [{ seriesId: String, seasonNumber: Number, episodeNumber: Number }],
    loginAttempts: { type: Number, default: 0 },
    tokenVersion: { type: Number, default: 0 },
    isBanned: { type: Boolean, default: false },
    lockUntil: { type: Date, default: null },
    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date },
    isPremium: { type: Boolean, default: false },
    avatar: { type: String, default: "/resim/avatar/user.png" }, // Default avatar
    bio: { type: String, default: "" }, // Biography
    privacySettings: {
      showLikedSeries: { type: Boolean, default: true }, // Show liked series to others
      showLikedMovies: { type: Boolean, default: true }, // Show liked movies to others
      showWatched: { type: Boolean, default: true }, // Show watched content to others
    },
  },
  { timestamps: true },
)

module.exports = mongoose.model("User", userSchema)
