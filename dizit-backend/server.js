const express = require("express")
const mongoose = require("mongoose")
const bcrypt = require("bcryptjs")
const jwt = require("jsonwebtoken")
const cors = require("cors")
const dotenv = require("dotenv")
const path = require("path")
const nodemailer = require("nodemailer")
const crypto = require("crypto")
const Comment = require("./models/Comment")
const sanitizeHtml = require("sanitize-html")

dotenv.config()
const app = express()

app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cors())
app.use(express.static(path.join(__dirname, "../")))
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../index.html"))
})

// MongoDB bağlantısı
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB bağlı"))
  .catch((err) => console.error("MongoDB bağlantı hatası:", err))

// Modeller
const User = require("./models/User")
const Movie = require("./models/Movie")
const Request = require("./models/Request")
const BannedUser = require("./models/BannedUser")

// Nodemailer yapılandırması
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
})

// JWT Middleware
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "")
    if (!token) {
      console.log("Token sağlanmadı")
      return res.status(401).json({ error: "Erişim reddedildi, lütfen giriş yapın" })
    }
    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET tanımlı değil")
      return res.status(500).json({ error: "Sunucu yapılandırma hatası" })
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    console.log("Token doğrulandı, decoded:", decoded)
    if (!decoded.userId) {
      console.error("Token payload'ında userId eksik")
      return res.status(401).json({ error: "Geçersiz token yapısı" })
    }

    // Kullanıcıyı bul ve tokenVersion ile isBanned kontrolü yap
    const user = await User.findById(decoded.userId).select("username isBanned tokenVersion isPremium premiumExpires")
    if (!user) {
      console.log("Kullanıcı bulunamadı:", decoded.userId)
      return res.status(401).json({ error: "Kullanıcı bulunamadı" })
    }
    if (user.isBanned) {
      console.log("Yasaklı kullanıcı istek yaptı:", user.username)
      return res.status(403).json({ error: "Hesabınız yasaklanmıştır. Lütfen destek ekibiyle iletişime geçin." })
    }
    if (decoded.tokenVersion !== user.tokenVersion) {
      console.log("Geçersiz token version:", {
        username: user.username,
        tokenVersion: decoded.tokenVersion,
        current: user.tokenVersion,
      })
      return res.status(401).json({ error: "Oturumunuz geçersiz. Lütfen yeniden giriş yapın." })
    }

    // Premium süresini kontrol et
    if (user.isPremium && user.premiumExpires && new Date(user.premiumExpires) < new Date()) {
      user.isPremium = false
      user.premiumType = "none"
      user.premiumExpires = null
      await user.save()
      console.log(`Premium üyelik süresi doldu: ${user.username}`)
    }

    req.user = decoded
    req.userDocument = user
    next()
  } catch (error) {
    console.error("Auth middleware hatası:", error.message)
    res.status(401).json({ error: "Geçersiz veya süresi dolmuş token" })
  }
}

// Admin Middleware
const adminMiddleware = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId)
    if (!user) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı" })
    }
    if (!user.isAdmin) {
      return res.status(403).json({ error: "Bu işlem için yönetici yetkisi gerekli" })
    }
    next()
  } catch (error) {
    console.error("Admin middleware hatası:", error.message)
    res.status(500).json({ error: "Sunucu hatası" })
  }
}

// Premium Üyelikleri Periyodik Kontrol Et
async function checkPremiumExpirations() {
  try {
    const now = new Date()
    const users = await User.find({
      isPremium: true,
      premiumExpires: { $lte: now },
    })

    for (const user of users) {
      user.isPremium = false
      user.premiumType = "none"
      user.premiumExpires = null
      await user.save()
      console.log(`Premium üyelik süresi doldu ve kaldırıldı: ${user.username}`)
    }
  } catch (error) {
    console.error("Premium üyelik kontrol hatası:", error.message)
  }
}

// Her saat başı premium üyelikleri kontrol et
setInterval(checkPremiumExpirations, 60 * 60 * 1000) // Her saat (60 dakika)

// Sunucu başlatıldığında bir kez kontrol et
checkPremiumExpirations()

// API_URL'yi döndüren endpoint
app.get("/api/config", (req, res) => {
  console.log("API_URL istendi:", process.env.API_URL)
  res.json({
    apiUrl: process.env.API_URL || "http://localhost:3000",
  })
})

// Kullanıcı Detaylarını Getirme
app.get("/api/users/:username", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { username } = req.params
    console.log("Kullanıcı detayları isteniyor:", username)
    const user = await User.findOne({ username })
      .select("username email isAdmin isBanned createdAt likes favorites premiumExpires premiumType isPremium")
      .lean()
    if (!user) {
      console.log("Kullanıcı bulunamadı:", username)
      return res.status(404).json({ error: "Kullanıcı bulunamadı" })
    }
    // Premium süresini kontrol et
    if (user.isPremium && user.premiumExpires && new Date(user.premiumExpires) < new Date()) {
      await User.updateOne({ username }, { isPremium: false, premiumType: "none", premiumExpires: null })
      user.isPremium = false
      user.premiumType = "none"
      user.premiumExpires = null
      console.log(`Premium üyelik süresi doldu (detaylar alınırken): ${username}`)
    }
    console.log("Kullanıcı detayları gönderildi:", username)
    res.json(user)
  } catch (error) {
    console.error("Kullanıcı detayları getirme hatası:", error.message)
    res.status(500).json({ error: "Kullanıcı detayları getirilirken bir hata oluştu" })
  }
})

// Premium Üyelik Güncelleme
app.put("/api/users/:username/premium", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { username } = req.params
    const { premiumType } = req.body // '1-minute', '1-week', '1-month' veya 'none'

    console.log("Premium üyelik güncelleme isteği:", { username, premiumType })

    if (!["none", "1-minute", "1-week", "1-month", "1-year", "unlimited"].includes(premiumType)) {
      return res.status(400).json({ error: "Geçersiz premiumType değeri" })
    }

    const user = await User.findOne({ username })
    if (!user) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı" })
    }

    let premiumExpires = null
    let isPremium = false

    if (premiumType !== "none") {
      isPremium = true
      const now = new Date()
      switch (premiumType) {
        case "1-minute":
          premiumExpires = new Date(now.getTime() + 60 * 1000) // 1 dakika
          break
        case "1-week":
          premiumExpires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) // 1 hafta
          break
        case "1-month":
          premiumExpires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) // 1 ay
          break
        case "1-year":
          premiumExpires = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000) // 1 yıl
          break
        case "unlimited":
          premiumExpires = null // Süresiz premium
          break
      }
    }

    user.isPremium = isPremium
    user.premiumType = premiumType
    user.premiumExpires = premiumExpires
    await user.save()

    console.log(`Kullanıcı premium üyelik güncellendi:`, { username, premiumType, premiumExpires })
    res.json({
      message: `Kullanıcı premium üyeliği ${premiumType === "none" ? "kaldırıldı" : "güncellendi"}`,
      user: {
        username: user.username,
        isPremium: user.isPremium,
        premiumType: user.premiumType,
        premiumExpires: user.premiumExpires,
      },
    })
  } catch (error) {
    console.error("Premium üyelik güncelleme hatası:", error.message)
    res.status(500).json({ error: "Premium üyelik güncellenirken bir hata oluştu" })
  }
})

// Premium Üyelik Kontrolü
app.get("/api/check-premium", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId)
    if (!user) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı" })
    }
    // Premium süresini kontrol et
    if (user.isPremium && user.premiumExpires && new Date(user.premiumExpires) < new Date()) {
      user.isPremium = false
      user.premiumType = "none"
      user.premiumExpires = null
      await user.save()
      console.log(`Premium üyelik süresi doldu (check-premium): ${user.username}`)
    }
    res.json({
      isPremium: user.isPremium || false,
      premiumType: user.premiumType,
      premiumExpires: user.premiumExpires,
    })
  } catch (error) {
    console.error("Premium kontrol hatası:", error.message)
    res.status(500).json({ error: "Premium durumu kontrol edilirken bir hata oluştu" })
  }
})

// İstek/Şikayet Formu Gönderimi (Giriş zorunlu)
app.post("/api/requests", authMiddleware, async (req, res) => {
  try {
    const { type, title, message } = req.body
    if (!type || !title || !message) {
      return res.status(400).json({ error: "Tüm alanlar zorunludur" })
    }
    const sanitizedMessage = sanitizeHtml(message, {
      allowedTags: [],
      allowedAttributes: {},
    })
    const sanitizedTitle = sanitizeHtml(title, {
      allowedTags: [],
      allowedAttributes: {},
    })
    const request = new Request({
      type,
      userId: req.user.userId,
      title: sanitizedTitle,
      messages: [{ sender: "user", content: sanitizedMessage }],
    })
    await request.save()
    console.log("Yeni istek/şikayet oluşturuldu:", request._id)
    res.status(201).json({ message: "Mesajınız başarıyla gönderildi!", requestId: request._id })
  } catch (error) {
    console.error("İstek/Şikayet oluşturma hatası:", error.message)
    res.status(500).json({ error: "Mesaj gönderilirken bir hata oluştu" })
  }
})

// İstek/Şikayet Mesajına Yanıt Verme
app.post("/api/requests/:id/reply", authMiddleware, async (req, res) => {
  try {
    const { message } = req.body
    const requestId = req.params.id
    if (!message) {
      return res.status(400).json({ error: "Yanıt içeriği zorunludur" })
    }
    const request = await Request.findById(requestId)
    if (!request) {
      return res.status(404).json({ error: "İstek/şikayet bulunamadı" })
    }
    if (request.isClosed) {
      return res.status(403).json({ error: "Bu konu kapatılmış, yeni yanıt eklenemez" })
    }
    const sanitizedMessage = sanitizeHtml(message, {
      allowedTags: [],
      allowedAttributes: {},
    })
    const user = await User.findById(req.user.userId)
    if (!user) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı" })
    }
    const sender = user.isAdmin ? "admin" : "user"
    request.messages.push({ sender, content: sanitizedMessage })
    await request.save()
    console.log("Yanıt eklendi:", requestId)
    res.json({ message: "Yanıtınız başarıyla gönderildi!" })
  } catch (error) {
    console.error("Yanıt ekleme hatası:", error.message)
    res.status(500).json({ error: "Yanıt gönderilirken bir hata oluştu" })
  }
})

// Konu Kapatma (Yalnızca admin)
app.post("/api/requests/:id/close", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const requestId = req.params.id
    const request = await Request.findById(requestId)
    if (!request) {
      return res.status(404).json({ error: "İstek/şikayet bulunamadı" })
    }
    if (request.isClosed) {
      return res.status(400).json({ error: "Bu konu zaten kapatılmış" })
    }
    request.isClosed = true
    await request.save()
    console.log("Konu kapatıldı:", requestId)
    res.json({ message: "Konu başarıyla kapatıldı" })
  } catch (error) {
    console.error("Konu kapatma hatası:", error.message)
    res.status(500).json({ error: "Konu kapatılırken bir hata oluştu" })
  }
})

// Kullanıcı Admin Yapma/Kaldırma
app.put("/api/users/:username/admin", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { username } = req.params
    const { isAdmin } = req.body
    console.log("Kullanıcı admin işlemi:", { username, isAdmin })
    if (typeof isAdmin !== "boolean") {
      return res.status(400).json({ error: "isAdmin değeri boolean olmalı" })
    }
    const user = await User.findOne({ username })
    if (!user) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı" })
    }
    if (req.user.username === username && !isAdmin) {
      return res.status(403).json({ error: "Kendi yönetici statünüzü kaldıramazsınız" })
    }
    user.isAdmin = isAdmin
    await user.save()
    console.log(`Kullanıcı ${isAdmin ? "yönetici yapıldı" : "yönetici statüsü kaldırıldı"}:`, username)
    res.json({ message: `Kullanıcı ${isAdmin ? "yönetici yapıldı" : "yönetici statüsü kaldırıldı"}` })
  } catch (error) {
    console.error("Kullanıcı admin işlemi hatası:", error.message)
    res.status(500).json({ error: "Kullanıcı admin işlemi sırasında bir hata oluştu" })
  }
})

// İstek Silme (Yalnızca admin)
app.delete("/api/requests/:id", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const requestId = req.params.id
    const request = await Request.findById(requestId)
    if (!request) {
      return res.status(404).json({ error: "İstek/şikayet bulunamadı" })
    }
    await Request.deleteOne({ _id: requestId })
    console.log("İstek silindi:", requestId)
    res.json({ message: "İstek başarıyla silindi" })
  } catch (error) {
    console.error("İstek silme hatası:", error.message)
    res.status(500).json({ error: "İstek silinirken bir hata oluştu" })
  }
})

// Konu Yeniden Açma (Yalnızca admin)
app.post("/api/requests/:id/reopen", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const requestId = req.params.id
    const request = await Request.findById(requestId)
    if (!request) {
      return res.status(404).json({ error: "İstek/şikayet bulunamadı" })
    }
    if (!request.isClosed) {
      return res.status(400).json({ error: "Bu konu zaten açık" })
    }
    request.isClosed = false
    await request.save()
    console.log("Konu yeniden açıldı:", requestId)
    res.json({ message: "Konu başarıyla yeniden açıldı" })
  } catch (error) {
    console.error("Konu yeniden açma hatası:", error.message)
    res.status(500).json({ error: "Konu yeniden açılırken bir hata oluştu" })
  }
})

// Kullanıcının İstek/Şikayetlerini Listeleme
app.get("/api/requests/user", authMiddleware, async (req, res) => {
  try {
    const requests = await Request.find({ userId: req.user.userId }).sort({ createdAt: -1 }).lean()
    console.log("Kullanıcı istek/şikayetleri listelendi")
    res.json(requests)
  } catch (error) {
    console.error("Kullanıcı istek/şikayet listeleme hatası:", error.message)
    res.status(500).json({ error: "İstek/şikayet listeleme sırasında bir hata oluştu" })
  }
})

// Admin: Tüm İstek/Şikayetleri Listeleme
app.get("/api/requests", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const requests = await Request.find().populate("userId", "username email").sort({ createdAt: -1 }).lean()
    console.log("Tüm istek/şikayetler listelendi")
    res.json(requests)
  } catch (error) {
    console.error("İstek/Şikayet listeleme hatası:", error.message)
    res.status(500).json({ error: "İstek/şikayet listeleme sırasında bir hata oluştu" })
  }
})

// Kayıt endpoint'inde yasaklı kullanıcı kontrolü
app.post("/api/register", async (req, res) => {
  try {
    const { username, email, password } = req.body
    console.log("Kayıt isteği:", { username, email, password: "[HIDDEN]" })
    if (!username || !email || !password) {
      return res.status(400).json({ error: "Kullanıcı adı, e-posta ve parola zorunlu" })
    }
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({ error: "Kullanıcı adı 3-20 karakter olmalı, sadece harf, sayı ve alt çizgi" })
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ error: "Geçerli bir e-posta adresi girin" })
    }
    const bannedUser = await BannedUser.findOne({ $or: [{ username }, { email }] })
    if (bannedUser) {
      return res.status(400).json({ error: "Bu kullanıcı adı veya e-posta yasaklanmıştır ve tekrar kullanılamaz" })
    }
    const existingUser = await User.findOne({ $or: [{ username }, { email }] })
    if (existingUser) {
      return res.status(400).json({ error: "Kullanıcı adı veya e-posta zaten kayıtlı" })
    }
    const hashedPassword = await bcrypt.hash(password, 10)
    const user = new User({
      username,
      email,
      password: hashedPassword,
      likes: [],
      dislikes: [],
      watched: [],
      favorites: [],
      isBanned: false,
    })
    await user.save()
    console.log("Kullanıcı oluşturuldu:", username)
    res.status(201).json({ message: "Kullanıcı başarıyla oluşturuldu" })
  } catch (error) {
    console.error("Kayıt hatası:", error.message)
    res.status(500).json({ error: "Kayıt işlemi sırasında bir hata oluştu" })
  }
})

// Giriş
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body
    console.log("Giriş isteği alındı:", { username, password: "[HIDDEN]" })

    if (!username || !password) {
      console.log("Eksik giriş bilgileri:", { username, password })
      return res.status(400).json({ error: "Kullanıcı adı ve parola zorunlu" })
    }

    const user = await User.findOne({ username: { $regex: `^${username}$`, $options: "i" } })
    if (!user) {
      console.log("Kullanıcı bulunamadı:", username)
      return res.status(401).json({ error: "Kullanıcı adı veya parola yanlış" })
    }
    console.log("Kullanıcı bulundu:", { username, isBanned: user.isBanned, tokenVersion: user.tokenVersion })

    if (user.isBanned) {
      console.log("Yasaklı kullanıcı giriş denemesi:", username)
      return res.status(403).json({ error: "Hesabınız yasaklanmıştır. Lütfen destek ekibiyle iletişime geçin." })
    }

    const bannedUser = await BannedUser.findOne({ username: user.username })
    if (bannedUser) {
      console.log("BannedUser kaydı bulundu:", username)
      return res.status(403).json({ error: "Hesabınız yasaklanmıştır ve giriş yapamazsınız." })
    }

    if (user.lockUntil && user.lockUntil > new Date()) {
      const minutesLeft = Math.ceil((user.lockUntil - new Date()) / 60000)
      console.log("Hesap kilitli:", { username, minutesLeft })
      return res.status(403).json({ error: `Hesap kilitli. ${minutesLeft} dakika sonra tekrar deneyin.` })
    }

    const isMatch = await bcrypt.compare(password, user.password)
    if (!isMatch) {
      user.loginAttempts = (user.loginAttempts || 0) + 1
      if (user.loginAttempts >= 3) {
        user.lockUntil = new Date(Date.now() + 5 * 60 * 1000)
        user.loginAttempts = 0
        console.log("Hesap kilitlendi:", username)
      }
      await user.save()
      console.log("Parola eşleşmedi:", username)
      return res.status(401).json({ error: "Kullanıcı adı veya parola yanlış" })
    }

    user.loginAttempts = 0
    user.lockUntil = null
    await user.save()
    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET tanımlı değil")
      return res.status(500).json({ error: "Sunucu yapılandırma hatası" })
    }
    const token = jwt.sign(
      { userId: user._id, username: user.username, tokenVersion: user.tokenVersion || 0 },
      process.env.JWT_SECRET,
      { expiresIn: "1h" },
    )
    console.log("Giriş başarılı:", { username, isAdmin: user.isAdmin, tokenVersion: user.tokenVersion })
    res.json({
      token,
      username: user.username,
      isAdmin: user.isAdmin,
      userId: user._id.toString(),
      message: "Giriş başarılı",
    })
  } catch (error) {
    console.error("Giriş hatası:", error.message)
    res.status(500).json({ error: "Giriş işlemi sırasında bir hata oluştu" })
  }
})

// Şifre Sıfırlama İsteği
app.post("/api/forgot-password", async (req, res) => {
  try {
    const { email } = req.body
    console.log("Şifre sıfırlama isteği:", { email })
    if (!email) {
      return res.status(400).json({ error: "E-posta adresi zorunlu" })
    }
    const user = await User.findOne({ email })
    if (!user) {
      console.log("E-posta bulunamadı:", email)
      return res.status(404).json({ error: "Bu e-posta adresiyle kayıtlı kullanıcı bulunamadı" })
    }
    const resetToken = crypto.randomBytes(32).toString("hex")
    user.resetPasswordToken = resetToken
    user.resetPasswordExpires = new Date(Date.now() + 3600000)
    await user.save()

    const resetUrl = `${process.env.API_URL}/reset-password.html?token=${resetToken}`
    await transporter.sendMail({
      to: email,
      subject: "DİZİT Şifre Sıfırlama",
      html: `
                <!DOCTYPE html>
                <html lang="tr">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Şifre Sıfırlama</title>
                </head>
                <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #121212; color: #ffffff;">
                    <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; margin: 20px auto; background-color: #1e1e1e; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);">
                        <!-- Header -->
                        <tr>
                            <td style="background-color: #252525; padding: 20px; text-align: center;">
                                <img src="https://via.placeholder.com/150x50?text=D%C4%B0Z%C4%B0T+Logo" alt="DİZİT Logo" style="max-width: 150px; height: auto;">
                            </td>
                        </tr>
                        <!-- Content -->
                        <tr>
                            <td style="padding: 30px; text-align: center;">
                                <h1 style="font-size: 24px; margin: 0 0 20px; color: #ffffff;">Şifrenizi Sıfırlayın</h1>
                                <p style="font-size: 16px; line-height: 1.5; margin: 0 0 20px; color: #aaaaaa;">Merhaba ${user.username},</p>
                                <p style="font-size: 16px; line-height: 1.5; margin: 0 0 20px; color: #aaaaaa;">Şifrenizi sıfırlamak için aşağıdaki butona tıklayın. Bu bağlantı 10 dakika boyunca geçerlidir.</p>
                                <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background-color: #ffcc00; color: #121212; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 5px; transition: background-color 0.3s;">Şifreyi Sıfırla</a>
                                <p style="font-size: 14px; color: #aaaaaa; margin-top: 20px;">Eğer bu isteği siz yapmadıysanız, lütfen bu e-postayı dikkate almayın.</p>
                            </td>
                        </tr>
                        <!-- Footer -->
                        <tr>
                            <td style="background-color: #252525; padding: 20px; text-align: center; font-size: 12px; color: #aaaaaa;">
                                <p style="margin: 0 0 10px;">DİZİT Ekibi</p>
                                <p style="margin: 0;">
                                    <a href="${process.env.API_URL}" style="color: #ffcc00; text-decoration: none;">dizit.com</a> | 
                                    <a href="mailto:destek@dizit.com" style="color: #ffcc00; text-decoration: none;">destek@dizit.com</a>
                                </p>
                                <p style="margin: 10px 0 0;">© ${new Date().getFullYear()} DİZİT. Tüm hakları saklıdır.</p>
                            </td>
                        </tr>
                    </table>
                </body>
                </html>
            `,
    })

    console.log("Şifre sıfırlama e-postası gönderildi:", email)
    res.json({ message: "Şifre sıfırlama bağlantısı e-postanıza gönderildi" })
  } catch (error) {
    console.error("Şifre sıfırlama hatası:", error.message)
    res.status(500).json({ error: "Şifre sıfırlama işlemi sırasında bir hata oluştu" })
  }
})

// Şifre Sıfırlama
app.post("/api/reset-password/:token", async (req, res) => {
  try {
    const { token } = req.params
    const { password } = req.body
    console.log("Şifre sıfırlama işlemi:", { token, password: "[HIDDEN]" })
    if (!password) {
      return res.status(400).json({ error: "Yeni parola zorunlu" })
    }
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: new Date() },
    })
    if (!user) {
      console.log("Geçersiz veya süresi dolmuş token:", token)
      return res.status(400).json({ error: "Geçersiz veya süresi dolmuş sıfırlama bağlantısı" })
    }
    const hashedPassword = await bcrypt.hash(password, 10)
    user.password = hashedPassword
    user.resetPasswordToken = undefined
    user.resetPasswordExpires = undefined
    await user.save()
    console.log("Şifre sıfırlandı:", user.username)
    res.json({ message: "Şifre başarıyla sıfırlandı" })
  } catch (error) {
    console.error("Şifre sıfırlama hatası:", error.message)
    res.status(500).json({ error: "Şifre sıfırlama işlemi sırasında bir hata oluştu" })
  }
})

// Kullanıcıları Listele
app.get("/api/users", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const users = await User.find()
      .select("username email isAdmin isBanned premiumType isPremium loginAttempts lockUntil")
      .lean()
    console.log(`Kullanıcılar listelendi: ${users.length} kullanıcı`)
    res.json(users)
  } catch (error) {
    console.error("Kullanıcı listeleme hatası:", error.message)
    res.status(500).json({ error: "Kullanıcıları listeleme sırasında bir hata oluştu" })
  }
})

// Kullanıcıyı Yasaklama/Yasağı Kaldırma
app.put("/api/users/:username/ban", authMiddleware, adminMiddleware, async (req, res) => {
  const { username } = req.params
  const { isBanned } = req.body

  try {
    if (typeof isBanned !== "boolean") {
      return res.status(400).json({ error: "isBanned değeri boolean olmalı" })
    }

    const user = await User.findOne({ username })
    if (!user) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı" })
    }

    if (user.isAdmin && isBanned) {
      return res.status(400).json({ error: "Yönetici kullanıcılar yasaklanamaz" })
    }

    if (isBanned === user.isBanned) {
      return res.status(400).json({ error: `Kullanıcı zaten ${isBanned ? "yasaklı" : "yasaklı değil"}` })
    }

    if (isBanned) {
      user.isBanned = true
      user.likes = []
      user.dislikes = []
      user.watched = []
      user.favorites = []
      user.tokenVersion = (user.tokenVersion || 0) + 1

      // Önceki BannedUser kaydını sil ve yenisini oluştur
      await BannedUser.deleteOne({ username })
      const bannedUser = new BannedUser({ username, email: user.email })
      await bannedUser.save()
    } else {
      user.isBanned = false
      user.tokenVersion = (user.tokenVersion || 0) + 1
      await BannedUser.deleteOne({ username })
    }

    await user.save()

    // Güncellenmiş kullanıcı verisini döndür
    const updatedUser = await User.findOne({ username })
      .select("username email isAdmin isBanned loginAttempts lockUntil likes favorites")
      .lean()

    return res.status(200).json({
      message: isBanned ? "Kullanıcı başarıyla yasaklandı" : "Kullanıcı yasağı başarıyla kaldırıldı",
      user: updatedUser,
    })
  } catch (error) {
    console.error("Yasaklama hatası:", error)
    if (error.code === 11000) {
      return res.status(400).json({ error: "Kullanıcı zaten yasaklı (tekrarlanan kayıt)" })
    }
    return res.status(500).json({ error: "Sunucu hatası: " + error.message })
  }
})

// Kullanıcı Silme
app.delete("/api/users/:username", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { username } = req.params
    console.log("Kullanıcı silme isteği:", { username })
    const user = await User.findOne({ username })
    if (!user) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı" })
    }
    if (user.isAdmin) {
      return res.status(403).json({ error: "Yönetici kullanıcılar silinemez" })
    }
    if (req.user.username === username) {
      return res.status(403).json({ error: "Kendi hesabınızı silemezsiniz" })
    }
    await User.deleteOne({ username })
    console.log("Kullanıcı silindi:", username)
    res.json({ message: "Kullanıcı başarıyla silindi" })
  } catch (error) {
    console.error("Kullanıcı silme hatası:", error.message)
    res.status(500).json({ error: "Kullanıcı silme işlemi sırasında bir hata oluştu" })
  }
})

// Film/Dizi Ekleme
app.post('/api/movies', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const movieData = req.body;
        console.log('Gelen movieData:', movieData);
        if (!/^[a-zA-Z0-9-$]{1,1000}$/.test(movieData.id)) {
            return res.status(400).json({ error: 'ID 1-100 karakter olmalı, sadece harf ve sayı içermeli' });
        }
        const existingMovie = await Movie.findOne({ id: movieData.id });
        if (existingMovie) {
            return res.status(400).json({ error: 'Bu ID zaten kullanımda' });
        }
        if (movieData.poster && !/^https?:\/\/.+\.(jpg|png|jpeg)$/.test(movieData.poster)) {
            return res.status(400).json({ error: 'Poster URL’si geçerli bir jpg/png resmi olmalı' });
        }
        if (movieData.relatedSeries && Array.isArray(movieData.relatedSeries)) {
            for (const seriesId of movieData.relatedSeries) {
                if (!/^[a-zA-Z0-9-$]{1,100}$/.test(seriesId)) {
                    return res.status(400).json({ error: 'İlgili seri ID’leri 1-100 karakter olmalı, sadece harf ve sayı' });
                }
                const relatedMovie = await Movie.findOne({ id: seriesId });
                if (!relatedMovie) {
                    return res.status(400).json({ error: `İlgili seri ID’si bulunamadı: ${seriesId}` });
                }
            }
        } else {
            movieData.relatedSeries = [];
        }
        if (movieData.videoSrc && Array.isArray(movieData.videoSrc)) {
            movieData.videoSrc.forEach((src, index) => {
                if (!src.type || typeof src.type !== 'string' || !src.src || typeof src.src !== 'string' || !/^https?:\/\/.+/.test(src.src)) {
                    throw new Error(`Geçersiz video kaynağı formatı: videoSrc[${index}]`);
                }
            });
        } else {
            movieData.videoSrc = [];
        }
        if (movieData.episodes && Array.isArray(movieData.episodes)) {
            movieData.episodes = movieData.episodes.map((ep, index) => {
                if (!ep.seasonNumber || !ep.episodeNumber) {
                    throw new Error(`Geçersiz bölüm: episodes[${index}]`);
                }
                if (ep.videoSrc && Array.isArray(ep.videoSrc)) {
                    ep.videoSrc.forEach((src, srcIndex) => {
                        if (!src.type || typeof src.type !== 'string' || !src.src || typeof src.src !== 'string' || !/^https?:\/\/.+/.test(src.src)) {
                            throw new Error(`Geçersiz bölüm video kaynağı: episodes[${index}].videoSrc[${srcIndex}]`);
                        }
                    });
                } else {
                    ep.videoSrc = [];
                }
                // addedDate kontrolü
                let addedDate = ep.addedDate;
                if (addedDate) {
                    const parsedDate = new Date(addedDate);
                    if (isNaN(parsedDate.getTime())) {
                        console.warn(`Geçersiz addedDate formatı, varsayılan kullanılıyor: episodes[${index}]`, addedDate);
                        addedDate = new Date();
                    } else {
                        addedDate = parsedDate;
                    }
                } else {
                    addedDate = new Date();
                }
                return { ...ep, addedDate };
            });
        } else {
            movieData.episodes = [];
}
const newMovie = new Movie({
  id: movieData.id,
  title: movieData.title,
  title2: movieData.title2,
  year: movieData.year,
  runtime: movieData.runtime,
  rating: movieData.rating,
  country: movieData.country,
  language: movieData.language,
  genres: movieData.genres,
  plot: movieData.plot,
  poster: movieData.poster,
  videoSrc: movieData.videoSrc,
  relatedSeries: movieData.relatedSeries,
  type: movieData.type,
  episodes: movieData.episodes,
  season: movieData.season,
  premium: movieData.premium || false,
})
await newMovie.save()
console.log("Film kaydedildi:", newMovie.id)
res.status(201).json({ message: "Film/Dizi başarıyla eklendi", movie: newMovie })
} catch (error)
{
  console.error("Film ekleme hatası:", error.message)
  res.status(500).json({ error: error.message || "Film ekleme işlemi sırasında bir hata oluştu" })
}
})

// Film/Dizi Güncelleme
app.put('/api/movies/:id', authMiddleware, adminMiddleware, async (req, res) =>
{
  try {
        const movieData = req.body;
        console.log('Güncelleme isteği:', movieData.id);
        if (!/^[a-zA-Z0-9-$]{1,100}$/.test(movieData.id)) {
            return res.status(400).json({ error: 'ID 1-100 karakter olmalı, sadece harf ve sayı içermeli' });
        }
        if (movieData.poster && !/^https?:\/\/.+\.(jpg|png|jpeg)$/.test(movieData.poster)) {
            return res.status(400).json({ error: 'Poster URL’si geçerli birjpg/png resmi olmalı' });
        }
        if (movieData.id !== req.params.id) {
            const existingMovie = await Movie.findOne({ id: movieData.id });
            if (existingMovie && existingMovie._id.toString() !== (await Movie.findOne({ id: req.params.id }))?._id.toString()) {
                return res.status(400).json({ error: 'Bu ID zaten kullanımda' });
            }
        }
        if (movieData.relatedSeries && Array.isArray(movieData.relatedSeries)) {
            for (const seriesId of movieData.relatedSeries) {
                if (!/^[a-zA-Z0-9-$]{1,100}$/.test(seriesId)) {
                    return res.status(400).json({ error: 'İlgili seri ID’leri 1-100 karakter olmalı, sadece harf ve sayı' });
                }
                const relatedMovie = await Movie.findOne({ id: seriesId });
                if (!relatedMovie) {
                    return res.status(400).json({ error: `İlgili seri ID’si bulunamadı: ${seriesId}` });
                }
            }
        } else {
            movieData.relatedSeries = [];
        }
        if (movieData.episodes && Array.isArray(movieData.episodes)) {
            movieData.episodes = movieData.episodes.map((ep, index) => {
                if (!ep.seasonNumber || !ep.episodeNumber) {
                    throw new Error(`Geçersiz bölüm: episodes[${index}]`);
                }
                if (ep.videoSrc && Array.isArray(ep.videoSrc)) {
                    ep.videoSrc.forEach((src, srcIndex) => {
                        if (!src.type || typeof src.type !== 'string' || !src.src || typeof src.src !== 'string' || !/^https?:\/\/.+/.test(src.src)) {
                            throw new Error(`Geçersiz bölüm video kaynağı: episodes[${index}].videoSrc[${srcIndex}]`);
                        }
                    });
                } else {
                    ep.videoSrc = [];
                }
                // addedDate kontrolü
                let addedDate = ep.addedDate;
                if (addedDate) {
                    // Eğer addedDate gönderilmişse, geçerli bir tarih mi kontrol et
                    const parsedDate = new Date(addedDate);
                    if (isNaN(parsedDate.getTime())) {
                        console.warn(`Geçersiz addedDate formatı, varsayılan kullanılıyor: episodes[${index}]`, addedDate);
                        addedDate = new Date(); // Geçersizse şu anki tarih
                    } else {
                        addedDate = parsedDate; // Geçerliyse kullan
                    }
                } else {
                    addedDate = new Date(); // Yeni bölüm için varsayılan tarih
                }
                return { ...ep, addedDate };
            }
  )
}
else
{
  movieData.episodes = []
}
const updatedMovie = await Movie.findOneAndUpdate(
  { id: req.params.id },
  {
    id: movieData.id,
    title: movieData.title,
    title2: movieData.title2,
    year: movieData.year,
    runtime: movieData.runtime,
    rating: movieData.rating,
    country: movieData.country,
    language: movieData.language,
    genres: movieData.genres,
    plot: movieData.plot,
    poster: movieData.poster,
    videoSrc: movieData.videoSrc,
    relatedSeries: movieData.relatedSeries,
    type: movieData.type,
    episodes: movieData.episodes,
    season: movieData.season,
    premium: movieData.premium || false,
  },
  { new: true, runValidators: true },
)
if (!updatedMovie) {
  return res.status(404).json({ error: 'Film/Dizi bulunamadı' });
}
console.log("Film güncellendi:", updatedMovie.id)
res.json({ message: "Film/Dizi başarıyla güncellendi", movie: updatedMovie })
} catch (error)
{
  console.error("Güncelleme hatası:", error.message)
  res.status(500).json({ error: error.message || "Güncelleme işlemi sırasında bir hata oluştu" })
}
})

// Film/Dizi Silme
app.delete("/api/movies/:id", authMiddleware, adminMiddleware, async (req, res) =>
{
  try {
    const deletedMovie = await Movie.findOneAndDelete({ id: req.params.id })
    if (!deletedMovie) {
      return res.status(404).json({ error: "Film/Dizi bulunamadı" })
    }
    console.log("Film silindi:", req.params.id)
    res.json({ message: "Film/Dizi başarıyla silindi" })
  } catch (error) {
    console.error("Silme hatası:", error.message)
    res.status(500).json({ error: "Silme işlemi sırasında bir hata oluştu" })
  }
}
)

// Film/Dizi Listeleme
app.get("/api/movies", async (req, res) =>
{
  try {
    const { type, year, genres, language, sort } = req.query
    console.log("Gelen sorgu parametreleri:", { type, year, genres, language, sort })
    const query = {}

    // İçerik tipi filtresi
    if (type) query.type = type

    // Yıl filtresi
    if (year) {
      console.log("Yıl filtresi uygulanıyor:", year)
      if (year.includes("-")) {
        const [start, end] = year.split("-").map(Number)
        if (!isNaN(start) && !isNaN(end)) {
          query.year = { $gte: start, $lte: end, $type: "number" }
        }
      } else if (year === "before-2000") {
        query.year = { $lte: 2000, $exists: true, $ne: null, $type: "number" }
      } else {
        const parsedYear = Number.parseInt(year)
        if (!isNaN(parsedYear)) {
          query.year = parsedYear
        }
      }
    }

    // Tür filtresi
    if (genres) {
      const genreArray = genres.split(",").filter((g) => g.trim())
      if (genreArray.length > 0) {
        query.genres = { $all: genreArray }
      }
    }

    // Dil filtresi
    if (language) {
      const languageArray = language.split(",").filter((l) => l.trim())
      if (languageArray.length > 0) {
        query.language = { $in: languageArray }
      }
    }

    // Sıralama
    let sortOption = { _id: -1 }
    if (sort) {
      if (sort.startsWith("-")) {
        sortOption = { [sort.substring(1)]: -1 }
      } else {
        sortOption = { [sort]: 1 }
      }
    }

    console.log("MongoDB sorgusu:", query)
    const movies = await Movie.find(query).sort(sortOption).lean()
    // 2000 öncesi filtresi için doğrulama
    if (year === "before-2000") {
      const invalidMovies = movies.filter((m) => m.year > 2000)
      if (invalidMovies.length > 0) {
        console.warn(
          "HATA: 2000 sonrası içerikler döndü:",
          invalidMovies.map((m) => ({ id: m.id, title: m.title, year: m.year })),
        )
      }
    }
   
    res.json(movies)
  } catch (error) {
    console.error("Listeleme hatası:", error.message)
    res.status(500).json({ error: "İçerik listeleme sırasında bir hata oluştu" })
  }
}
)

// Film/Dizi Detay
app.get("/api/movies/:id", async (req, res) =>
{
  console.time(`movies/${req.params.id}`)
  try {
    const movie = await Movie.findOne({ id: req.params.id })
      .select(
        "id title title2 year runtime rating country language genres plot poster videoSrc type episodes season relatedSeries premium",
      )
      .lean()
    if (!movie) {
      console.timeEnd(`movies/${req.params.id}`)
      return res.status(404).json({ error: "Film/Dizi bulunamadı" })
    }
    // relatedSeries sırasına göre ilgili filmleri getir
    const relatedMovies = await Movie.find({ id: { $in: movie.relatedSeries || [] } })
      .select("id title title2 poster year rating language")
      .lean()

    // relatedMovies dizisini relatedSeries sırasına göre sırala
    const sortedRelatedMovies = (movie.relatedSeries || [])
      .map((seriesId) => relatedMovies.find((rm) => rm.id === seriesId))
      .filter((rm) => rm) // null/undefined olanları filtrele

    console.timeEnd(`movies/${req.params.id}`)
    res.json({ ...movie, relatedSeriesDetails: sortedRelatedMovies })
  } catch (error) {
    console.error("Detay hatası:", error.message)
    console.timeEnd(`movies/${req.params.id}`)
    res.status(500).json({ error: "Film/dizi detayları getirilirken bir hata oluştu" })
  }
}
)

// Film Detay ve Durum
app.get("/api/movie-details/:id", authMiddleware, async (req, res) =>
{
  console.time(`movie-details/${req.params.id}`)
  try {
    const movie = await Movie.findOne({ id: req.params.id })
      .select(
        "id title title2 year runtime rating country language genres plot poster videoSrc type episodes season relatedSeries premium",
      )
      .lean()
    if (!movie) {
      console.timeEnd(`movie-details/${req.params.id}`)
      return res.status(404).json({ error: "Film/Dizi bulunamadı" })
    }

    const user = await User.findById(req.user.userId)
    if (!user) {
      console.timeEnd(`movie-details/${req.params.id}`)
      return res.status(404).json({ error: "Kullanıcı bulunamadı" })
    }
    const movieId = req.params.id

    const isLiked = user.likes.some(
      (like) => like.seriesId === movieId && like.seasonNumber === 0 && like.episodeNumber === 0,
    )
    const isDisliked = user.dislikes.some(
      (dislike) => dislike.seriesId === movieId && dislike.seasonNumber === 0 && dislike.episodeNumber === 0,
    )
    const isWatched = user.watched.some((w) => w.seriesId === movieId && w.seasonNumber === 0 && w.episodeNumber === 0)
    const isFavorited = user.favorites.some((fav) => fav.seriesId === movieId)

    const isWatchLater = user.watchLater?.some((item) => item.seriesId === movieId)

    const totalLikes = await User.countDocuments({
      likes: { $elemMatch: { seriesId: movieId, seasonNumber: 0, episodeNumber: 0 } },
    })
    const totalDislikes = await User.countDocuments({
      dislikes: { $elemMatch: { seriesId: movieId, seasonNumber: 0, episodeNumber: 0 } },
    })

    const episodeStatuses =
      movie.episodes?.map((ep) => ({
        seasonNumber: ep.seasonNumber,
        episodeNumber: ep.episodeNumber,
        isLiked: user.likes.some(
          (l) => l.seriesId === movie.id && l.seasonNumber === ep.seasonNumber && l.episodeNumber === ep.episodeNumber,
        ),
        isDisliked: user.dislikes.some(
          (d) => d.seriesId === movie.id && d.seasonNumber === ep.seasonNumber && d.episodeNumber === ep.episodeNumber,
        ),
        isWatched: user.watched.some(
          (w) => w.seriesId === movie.id && w.seasonNumber === ep.seasonNumber && w.episodeNumber === ep.episodeNumber,
        ),
        likeCount: 0,
        dislikeCount: 0,
      })) || []

    console.timeEnd(`movie-details/${req.params.id}`)
    res.json({
      movie,
      userStatus: { isLiked, isDisliked, isWatched, isFavorited, isWatchLater },
      publicStatus: { likeCount: totalLikes, dislikeCount: totalDislikes },
      episodeStatuses,
    })
  } catch (error) {
    console.error("Detay hatası:", error.message)
    res.status(500).json({ error: "Film/dizi detayları getirilirken bir hata oluştu" })
  }
}
)
// Kullanıcı Profil Verilerini Getirme
app.put("/api/user-profile", authMiddleware, async (req, res) =>
{
  try {
    const { username, avatar, bio, privacySettings } = req.body
    console.log("Profil güncelleme isteği:", { username, avatar, bio, privacySettings })

    const user = await User.findById(req.user.userId)
    if (!user) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı" })
    }

    // Kullanıcı adı güncelleme
    if (username && username !== user.username) {
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
        return res.status(400).json({ error: "Kullanıcı adı 3-20 karakter olmalı, sadece harf, sayı ve alt çizgi" })
      }
      const existingUser = await User.findOne({ username })
      if (existingUser) {
        return res.status(400).json({ error: "Bu kullanıcı adı zaten kullanımda" })
      }
      const bannedUser = await BannedUser.findOne({ username })
      if (bannedUser) {
        return res.status(400).json({ error: "Bu kullanıcı adı yasaklanmıştır" })
      }
      user.username = username
      user.tokenVersion = (user.tokenVersion || 0) + 1
    }

    // Avatar güncelleme
    if (avatar) {
      const isPremiumAvatar = avatar.includes("/premium-avatar/")
      if (isPremiumAvatar && !user.isPremium) {
        return res.status(403).json({ error: "Premium avatar seçmek için premium üyelik gerekli" })
      }
      user.avatar = avatar
    }

    // Biyografi güncelleme
    if (bio !== undefined) {
      const sanitizedBio = sanitizeHtml(bio, {
        allowedTags: [],
        allowedAttributes: {},
      })
      user.bio = sanitizedBio.slice(0, 500)
    }

    // Gizlilik ayarları güncelleme
    if (privacySettings) {
      if (typeof privacySettings.showLikedSeries === "boolean") {
        user.privacySettings.showLikedSeries = privacySettings.showLikedSeries
      }
      if (typeof privacySettings.showLikedMovies === "boolean") {
        user.privacySettings.showLikedMovies = privacySettings.showLikedMovies
      }
      if (typeof privacySettings.showWatched === "boolean") {
        user.privacySettings.showWatched = privacySettings.showWatched
      }
    }

    await user.save()
    console.log("Profil güncellendi:", user.username)
    const newToken =
      username && username !== req.user.username
        ? jwt.sign(
            { userId: user._id, username: user.username, tokenVersion: user.tokenVersion },
            process.env.JWT_SECRET,
            { expiresIn: "1h" },
          )
        : null

    res.json({
      message: "Profil başarıyla güncellendi",
      user: {
        username: user.username,
        avatar: user.avatar,
        bio: user.bio,
        privacySettings: user.privacySettings,
        isPremium: user.isPremium,
      },
      newToken,
    })
  } catch (error) {
    console.error("Profil güncelleme hatası:", error.message)
    res.status(500).json({ error: "Profil güncellenirken bir hata oluştu" })
  }
}
)

// Kullanıcı Adı Kullanılabilirlik Kontrolü
app.get("/api/check-username", authMiddleware, async (req, res) =>
{
  try {
    const { username } = req.query
    console.log("Kullanıcı adı kontrol isteği:", { username })
    if (!username) {
      return res.status(400).json({ error: "Kullanıcı adı parametresi zorunlu" })
    }
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({ error: "Kullanıcı adı 3-20 karakter olmalı, sadece harf, sayı ve alt çizgi" })
    }
    const user = await User.findOne({ username })
    if (user && user._id.toString() !== req.user.userId) {
      return res.json({ isAvailable: false })
    }
    const bannedUser = await BannedUser.findOne({ username })
    if (bannedUser) {
      return res.json({ isAvailable: false })
    }
    res.json({ isAvailable: true })
  } catch (error) {
    console.error("Kullanıcı adı kontrol hatası:", error.message)
    res.status(500).json({ error: "Kullanıcı adı kontrolü sırasında bir hata oluştu" })
  }
}
)

// Kullanıcı Detaylarını Getirme
app.get("/api/users/:username", authMiddleware, async (req, res) =>
{
  try {
    const { username } = req.params
    console.log("Kullanıcı detayları isteniyor:", username)
    const isOwnProfile = req.user.username === username
    const user = await User.findOne({ username })
      .select(
        "username email isAdmin isBanned createdAt likes favorites premiumExpires premiumType isPremium avatar bio privacySettings",
      )
      .lean()
    if (!user) {
      console.log("Kullanıcı bulunamadı:", username)
      return res.status(404).json({ error: "Kullanıcı bulunamadı" })
    }
    // Premium süresini kontrol et
    if (user.isPremium && user.premiumExpires && new Date(user.premiumExpires) < new Date()) {
      await User.updateOne({ username }, { isPremium: false, premiumType: "none", premiumExpires: null })
      user.isPremium = false
      user.premiumType = "none"
      user.premiumExpires = null
      console.log(`Premium üyelik süresi doldu (detaylar alınırken): ${username}`)
    }
    // Kendi profili değilse ve yönetici değilse gizlilik ayarlarını uygula
    if (!isOwnProfile && !req.userDocument.isAdmin) {
      if (!user.privacySettings.showLikedSeries) {
        user.likes = user.likes.filter((like) => like.seasonNumber !== 0 || like.episodeNumber !== 0)
      }
      if (!user.privacySettings.showLikedMovies) {
        user.likes = user.likes.filter((like) => like.seasonNumber === 0 && like.episodeNumber === 0)
      }
      if (!user.privacySettings.showWatched) {
        user.watched = []
      }
    }
    console.log("Kullanıcı detayları gönderildi:", username)
    res.json(user)
  } catch (error) {
    console.error("Kullanıcı detayları getirme hatası:", error.message)
    res.status(500).json({ error: "Kullanıcı detayları getirilirken bir hata oluştu" })
  }
}
)

// Kullanıcı Profil Verilerini Getirme
app.get("/api/user-profile", authMiddleware, async (req, res) =>
{
  try {
    const user = await User.findById(req.user.userId)
      .select(
        "username email likes dislikes watched favorites isPremium premiumType premiumExpires isAdmin isBanned avatar bio privacySettings watchLater",
      )
      .lean()
    if (!user) {
      console.log("Kullanıcı bulunamadı:", req.user.userId)
      return res.status(404).json({ error: "Kullanıcı bulunamadı" })
    }
    // Premium süresini kontrol et
    if (user.isPremium && user.premiumExpires && new Date(user.premiumExpires) < new Date()) {
      await User.updateOne({ _id: req.user.userId }, { isPremium: false, premiumType: "none", premiumExpires: null })
      user.isPremium = false
      user.premiumType = "none"
      user.premiumExpires = null
      console.log(`Premium üyelik süresi doldu: ${user.username}`)
    }
    console.log("Kullanıcı profili gönderildi:", user.username)
    res.json(user)
  } catch (error) {
    console.error("Kullanıcı profili getirme hatası:", error.message)
    res.status(500).json({ error: "Kullanıcı profili getirilirken bir hata oluştu" })
  }
}
)
// Arama
app.get("/api/search", async (req, res) =>
{
  try {
    const query = req.query.q
    if (!query) {
      return res.json([])
    }
    const movies = await Movie.find({
      $or: [
        { title: { $regex: query, $options: "i" } },
        { title2: { $regex: query, $options: "i" } },
        { genres: { $regex: query, $options: "i" } },
      ],
    }).lean()
    res.json(movies)
  } catch (error) {
    console.error("Arama hatası:", error.message)
    res.status(500).json({ error: "Arama işlemi sırasında bir hata oluştu" })
  }
}
)

// Akıllı Benzer Diziler
app.get("/api/similar/:id", async (req, res) =>
{
  try {
    console.time(`similar/${req.params.id}`)
    const current = await Movie.findOne({ id: req.params.id }).lean()
    if (!current) {
      return res.status(404).json({ error: "İçerik bulunamadı" })
    }

    let watchedIds = []
    const token = req.headers.authorization?.split(" ")[1]
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET)
        const user = await User.findById(decoded.userId)
        if (user) {
          watchedIds = user.watched.map((w) => w.seriesId)
        }
      } catch (error) {
        console.log("Token doğrulama başarısız, izlenenler hariç tutulmayacak:", error.message)
      }
    }

    const targetType = req.query.type || current.type
    const allItems = await Movie.find({
      type: targetType,
      id: { $ne: current.id, $nin: watchedIds },
    })
      .select("id title title2 year rating poster language genres country premium")
      .lean()

    const watchCounts = await User.aggregate([
      { $unwind: "$watched" },
      { $group: { _id: "$watched.seriesId", count: { $sum: 1 } } },
    ])

    const scoreItem = (item) => {
  let score = 0;

  // GENRE - en büyük etki
  const currentGenres = Array.isArray(current.genres) ? current.genres : [];
  const itemGenres = Array.isArray(item.genres) ? item.genres : [];
  const genreMatches = itemGenres.filter((g) => currentGenres.includes(g)).length;
  score += (genreMatches / Math.max(currentGenres.length, 1)) * 40;

  // LANGUAGE - "Yerli" azaltılarak
  const currentLanguages = Array.isArray(current.language) ? current.language : [];
  const itemLanguages = Array.isArray(item.language) ? item.language : [];
  const langMatches = itemLanguages.filter((l) => currentLanguages.includes(l)).length;

  // Yerli içerik için ceza (çok çıkmaması için)
  const yerliPenalty = itemLanguages.includes("Yerli") ? -5 : 0;
  score += (langMatches / Math.max(currentLanguages.length, 1)) * 10 + yerliPenalty;

  // COUNTRY - düşük katkı
  const currentCountries = Array.isArray(current.country) ? current.country : [];
  const itemCountries = Array.isArray(item.country) ? item.country : [];
  const countryMatches = itemCountries.filter((c) => currentCountries.includes(c)).length;
  score += (countryMatches / Math.max(currentCountries.length, 1)) * 8;

  // RATING - fark ne kadar küçükse o kadar iyi
  const currentRating = parseFloat(current.rating) || 0;
  const itemRating = parseFloat(item.rating) || 0;
  const ratingDiff = Math.abs(currentRating - itemRating);
  score += (1 - Math.min(ratingDiff / 10, 1)) * 15;

  // WATCH COUNT - popülerlik
  const watchCount = watchCounts.find((w) => w._id === item.id)?.count || 0;
  const maxWatches = Math.max(...watchCounts.map((w) => w.count), 1);
  score += (watchCount / maxWatches) * 7;

  return score;
};


    const scoredItems = allItems.map((item) => ({
      ...item,
      score: scoreItem(item),
    }))

    const sorted = scoredItems.sort((a, b) => b.score - a.score).slice(0, 10)

    console.timeEnd(`similar/${req.params.id}`)
    res.json(sorted)
  } catch (error) {
    console.error("Benzer içerik hatası:", error.message)
    res.status(500).json({ error: "Benzer içerikler getirilirken bir hata oluştu" })
  }
}
)

// Film Beğenme
app.post("/api/movie-like", authMiddleware, async (req, res) =>
{
  try {
    const { movieId } = req.body
    console.log("Film beğeni isteği:", { movieId })
    if (!movieId) {
      return res.status(400).json({ error: "movieId zorunlu" })
    }
    const user = await User.findById(req.user.userId)
    if (!user) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı" })
    }
    const likeKey = { seriesId: movieId, seasonNumber: 0, episodeNumber: 0 }
    const isLiked = user.likes.some(
      (like) => like.seriesId === movieId && like.seasonNumber === 0 && like.episodeNumber === 0,
    )
    const isDisliked = user.dislikes.some(
      (dislike) => dislike.seriesId === movieId && dislike.seasonNumber === 0 && dislike.episodeNumber === 0,
    )
    if (isLiked) {
      user.likes = user.likes.filter(
        (like) => !(like.seriesId === movieId && like.seasonNumber === 0 && like.episodeNumber === 0),
      )
    } else {
      user.likes.push(likeKey)
      if (isDisliked) {
        user.dislikes = user.dislikes.filter(
          (dislike) => !(dislike.seriesId === movieId && dislike.seasonNumber === 0 && dislike.episodeNumber === 0),
        )
      }
    }
    await user.save()
    const totalLikes = await User.countDocuments({
      likes: { $elemMatch: { seriesId: movieId, seasonNumber: 0, episodeNumber: 0 } },
    })
    const totalDislikes = await User.countDocuments({
      dislikes: { $elemMatch: { seriesId: movieId, seasonNumber: 0, episodeNumber: 0 } },
    })
    res.json({
      isLiked: !isLiked,
      isDisliked: false,
      likeCount: totalLikes,
      dislikeCount: totalDislikes,
    })
  } catch (error) {
    console.error("Film beğeni hatası:", error.message)
    res.status(500).json({ error: "Film beğenme işlemi sırasında bir hata oluştu" })
  }
}
)

// Film Beğenmeme
app.post("/api/movie-dislike", authMiddleware, async (req, res) =>
{
  try {
    const { movieId } = req.body
    console.log("Film beğenmeme isteği:", { movieId })
    if (!movieId) {
      return res.status(400).json({ error: "movieId zorunlu" })
    }
    const user = await User.findById(req.user.userId)
    if (!user) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı" })
    }
    const dislikeKey = { seriesId: movieId, seasonNumber: 0, episodeNumber: 0 }
    const isDisliked = user.dislikes.some(
      (dislike) => dislike.seriesId === movieId && dislike.seasonNumber === 0 && dislike.episodeNumber === 0,
    )
    const isLiked = user.likes.some(
      (like) => like.seriesId === movieId && like.seasonNumber === 0 && like.episodeNumber === 0,
    )
    if (isDisliked) {
      user.dislikes = user.dislikes.filter(
        (dislike) => !(dislike.seriesId === movieId && dislike.seasonNumber === 0 && dislike.episodeNumber === 0),
      )
    } else {
      user.dislikes.push(dislikeKey)
      if (isLiked) {
        user.likes = user.likes.filter(
          (like) => !(like.seriesId === movieId && like.seasonNumber === 0 && like.episodeNumber === 0),
        )
      }
    }
    await user.save()
    const totalLikes = await User.countDocuments({
      likes: { $elemMatch: { seriesId: movieId, seasonNumber: 0, episodeNumber: 0 } },
    })
    const totalDislikes = await User.countDocuments({
      dislikes: { $elemMatch: { seriesId: movieId, seasonNumber: 0, episodeNumber: 0 } },
    })
    res.json({
      isDisliked: !isDisliked,
      isLiked: false,
      likeCount: totalLikes,
      dislikeCount: totalDislikes,
    })
  } catch (error) {
    console.error("Film beğenmeme hatası:", error.message)
    res.status(500).json({ error: "Film beğenmeme işlemi sırasında bir hata oluştu" })
  }
}
)

// Film İzledim
app.post("/api/movie-watched", authMiddleware, async (req, res) =>
{
  try {
    const { movieId } = req.body
    console.log("Film izledim isteği:", { movieId })
    if (!movieId) {
      return res.status(400).json({ error: "movieId zorunlu" })
    }
    const user = await User.findById(req.user.userId)
    if (!user) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı" })
    }
    const watchedKey = { seriesId: movieId, seasonNumber: 0, episodeNumber: 0 }
    const isWatched = user.watched.some((w) => w.seriesId === movieId && w.seasonNumber === 0 && w.episodeNumber === 0)
    if (isWatched) {
      user.watched = user.watched.filter(
        (w) => !(w.seriesId === movieId && w.seasonNumber === 0 && w.episodeNumber === 0),
      )
    } else {
      user.watched.push(watchedKey)
    }
    await user.save()
    res.json({ isWatched: !isWatched })
  } catch (error) {
    console.error("Film izledim hatası:", error.message)
    res.status(500).json({ error: "Film izleme durumu güncellenirken bir hata oluştu" })
  }
}
)

// Film Favorilere Ekleme/Çıkarma
app.post("/api/favorite", authMiddleware, async (req, res) => {
  try {
    const { movieId } = req.body;
    if (!movieId || typeof movieId !== "string") {
      return res.status(400).json({ error: "Geçerli bir movieId zorunlu" });
    }
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı" });
    }
    const movie = await Movie.findOne({ id: movieId });
    if (!movie) {
      return res.status(404).json({ error: "Film veya dizi bulunamadı" });
    }
    const isFavorited = user.favorites.some((fav) => fav.seriesId === movieId);
    if (isFavorited) {
      user.favorites = user.favorites.filter((fav) => fav.seriesId !== movieId);
    } else {
      user.favorites.push({ seriesId: movieId, seasonNumber: 0, episodeNumber: 0 });
    }
    await user.save();
    res.json({ isFavorited: !isFavorited });
  } catch (error) {
    console.error("Favori hatası:", error.message);
    res.status(500).json({ error: "Favorilere ekleme/kaldırma işlemi sırasında bir hata oluştu" });
  }
});

// Film/Dizi ID'lerini ara
app.get("/api/movies/search-ids", authMiddleware, adminMiddleware, async (req, res) =>
{
  try {
    const { q } = req.query
    if (!q) {
      return res.json([])
    }
    const movies = await Movie.find({
      id: { $regex: `^${q}`, $options: "i" },
    })
      .select("id title")
      .limit(10)
      .lean()
    res.json(movies)
  } catch (error) {
    console.error("ID arama hatası:", error.message)
    res.status(500).json({ error: "ID arama işlemi sırasında bir hata oluştu" })
  }
}
)

// Benzersiz türleri getir
app.get("/api/genres", async (req, res) =>
{
  try {
    const genres = await Movie.distinct("genres")
    res.json(genres)
  } catch (error) {
    console.error("Tür listeleme hatası:", error.message)
    res.status(500).json({ error: "Türler getirilirken bir hata oluştu" })
  }
}
)

// Film Durum Kontrol
app.get("/api/movie-status/:movieId", authMiddleware, async (req, res) =>
{
  try {
    const { movieId } = req.params
    console.log("Film durum kontrol:", { movieId })
    if (!movieId) {
      return res.status(400).json({ error: "movieId zorunlu" })
    }
    const user = await User.findById(req.user.userId)
    if (!user) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı" })
    }
    const isLiked = user.likes.some(
      (like) => like.seriesId === movieId && like.seasonNumber === 0 && like.episodeNumber === 0,
    )
    const isDisliked = user.dislikes.some(
      (dislike) => dislike.seriesId === movieId && dislike.seasonNumber === 0 && dislike.episodeNumber === 0,
    )
    const isWatched = user.watched.some((w) => w.seriesId === movieId && w.seasonNumber === 0 && w.episodeNumber === 0)
    const isFavorited = user.favorites.some((fav) => fav.seriesId === movieId)
    const isWatchLater = user.watchLater?.some((item) => item.seriesId === movieId)
    const totalLikes = await User.countDocuments({
      likes: { $elemMatch: { seriesId: movieId, seasonNumber: 0, episodeNumber: 0 } },
    })
    const totalDislikes = await User.countDocuments({
      dislikes: { $elemMatch: { seriesId: movieId, seasonNumber: 0, episodeNumber: 0 } },
    })
    res.json({
      isLiked,
      isDisliked,
      isWatched,
      isFavorited,
      isWatchLater,
      likeCount: totalLikes,
      dislikeCount: totalDislikes,
    })
  } catch (error) {
    console.error("Film durum kontrol hatası:", error.message)
    res.status(500).json({ error: "Film durumu kontrol edilirken bir hata oluştu" })
  }
}
)

// Toplu Film Durum Kontrolü
app.post("/api/movie-status/bulk", authMiddleware, async (req, res) =>
{
  try {
    const { ids } = req.body
    console.log("Toplu durum kontrol isteği:", { ids, userId: req.user.userId })

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "Geçerli bir ID dizisi zorunlu" })
    }

    const user = await User.findById(req.user.userId)
    if (!user) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı" })
    }

    // Her bir film için izlenme durumunu kontrol et
    const statuses = ids.reduce((acc, movieId) => {
      const isWatched = user.watched.some(
        (w) => w.seriesId === movieId && w.seasonNumber === 0 && w.episodeNumber === 0,
      )
      acc[movieId] = { isWatched }
      return acc
    }, {})

    res.json(statuses)
  } catch (error) {
    console.error("Toplu durum kontrol hatası:", error.message)
    res.status(500).json({ error: "Toplu durum kontrolü sırasında bir hata oluştu" })
  }
}
)

// Film Genel Durum Kontrol
app.get("/api/public/movie-status/:movieId", async (req, res) =>
{
  try {
    const { movieId } = req.params
    console.log("Film genel durum kontrol:", { movieId })
    if (!movieId) {
      return res.status(400).json({ error: "movieId zorunlu" })
    }
    const totalLikes = await User.countDocuments({
      likes: { $elemMatch: { seriesId: movieId, seasonNumber: 0, episodeNumber: 0 } },
    })
    const totalDislikes = await User.countDocuments({
      dislikes: { $elemMatch: { seriesId: movieId, seasonNumber: 0, episodeNumber: 0 } },
    })
    res.json({
      likeCount: totalLikes,
      dislikeCount: totalDislikes,
    })
  } catch (error) {
    console.error("Film genel durum kontrol hatası:", error.message)
    res.status(500).json({ error: "Film genel durumu kontrol edilirken bir hata oluştu" })
  }
}
)

// Toplu Durum Kontrol
app.post("/api/batch-status", authMiddleware, async (req, res) =>
{
  try {
    const { seriesId, episodes } = req.body
    if (!seriesId || !Array.isArray(episodes)) {
      return res.status(400).json({ error: "seriesId ve episodes dizisi zorunlu" })
    }
    const user = await User.findById(req.user.userId)
    if (!user) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı" })
    }
    const statuses = episodes.map(({ seasonNumber, episodeNumber }) => {
      const seasonNum = Number.parseInt(seasonNumber)
      const episodeNum = Number.parseInt(episodeNumber)
      return {
        seasonNumber: seasonNum,
        episodeNumber: episodeNum,
        isWatched: user.watched.some(
          (w) => w.seriesId === seriesId && w.seasonNumber === seasonNum && w.episodeNumber === episodeNum,
        ),
        isLiked: user.likes.some(
          (l) => l.seriesId === seriesId && l.seasonNumber === seasonNum && l.episodeNumber === episodeNum,
        ),
        isDisliked: user.dislikes.some(
          (d) => d.seriesId === seriesId && d.seasonNumber === seasonNum && d.episodeNumber === episodeNum,
        ),
      }
    })
    const likeCounts = await User.aggregate([
      { $unwind: "$likes" },
      {
        $match: {
          "likes.seriesId": seriesId,
          "likes.seasonNumber": { $in: episodes.map((e) => Number.parseInt(e.seasonNumber)) },
          "likes.episodeNumber": { $in: episodes.map((e) => Number.parseInt(e.episodeNumber)) },
        },
      },
      {
        $group: {
          _id: { seasonNumber: "$likes.seasonNumber", episodeNumber: "$likes.episodeNumber" },
          count: { $sum: 1 },
        },
      },
    ])
    const dislikeCounts = await User.aggregate([
      { $unwind: "$dislikes" },
      {
        $match: {
          "dislikes.seriesId": seriesId,
          "dislikes.seasonNumber": { $in: episodes.map((e) => Number.parseInt(e.seasonNumber)) },
          "dislikes.episodeNumber": { $in: episodes.map((e) => Number.parseInt(e.episodeNumber)) },
        },
      },
      {
        $group: {
          _id: { seasonNumber: "$dislikes.seasonNumber", episodeNumber: "$dislikes.episodeNumber" },
          count: { $sum: 1 },
        },
      },
    ])
    const result = statuses.map((status) => ({
      ...status,
      likeCount:
        likeCounts.find(
          (l) => l._id.seasonNumber === status.seasonNumber && l._id.episodeNumber === status.episodeNumber,
        )?.count || 0,
      dislikeCount:
        dislikeCounts.find(
          (d) => d._id.seasonNumber === status.seasonNumber && d._id.episodeNumber === status.episodeNumber,
        )?.count || 0,
    }))
    res.json(result)
  } catch (error) {
    console.error("Toplu durum hatası:", error.message)
    res.status(500).json({ error: "Toplu durum kontrolü sırasında bir hata oluştu" })
  }
}
)

//izlenme t
const recentViews = new Map(); // Map<movieId, Set<IP>>

app.post('/api/movies/:id/view', async (req, res) => {
  try {
    const movieId = req.params.id;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    if (!recentViews.has(movieId)) {
      recentViews.set(movieId, new Set());
    }

    const movieViewSet = recentViews.get(movieId);

    if (movieViewSet.has(ip)) {
      return res.status(200).json({ message: "Bu IP zaten sayıldı." });
    }

    movieViewSet.add(ip);
    setTimeout(() => movieViewSet.delete(ip), 24 * 60 * 60 * 1000); // 1 gün sonra sil

    const movie = await Movie.findByIdAndUpdate(
      movieId,
      { $inc: { views: 1 } },
      { new: true }
    );

    if (!movie) {
      return res.status(404).json({ error: "Film/Dizi bulunamadı" });
    }

    res.json({ views: movie.views });
  } catch (err) {
    console.error('İzlenme hatası:', err);
    res.status(500).json({ error: 'İzlenme kaydedilemedi' });
  }
});




// Yorum Ekleme
app.post("/api/comments", authMiddleware, async (req, res) => {
  try {
    const { movieId, content } = req.body;
    if (!movieId || !content) return res.status(400).json({ error: "movieId ve content zorunlu" });

    const movie = await Movie.findOne({ id: movieId }).lean();
    if (!movie) return res.status(404).json({ error: "Film/Dizi bulunamadı" });

    const sanitizedContent = sanitizeHtml(content, { allowedTags: [], allowedAttributes: {} });
    if (!sanitizedContent.trim()) return res.status(400).json({ error: "Yorum içeriği boş olamaz" });

    const comment = new Comment({
      movieId,
      userId: req.user.userId,
      username: req.userDocument.username,
      content: sanitizedContent,
      parentId: null
    });
    await comment.save();

    res.status(201).json({ message: "Yorum başarıyla eklendi", comment });
  } catch (error) {
    res.status(500).json({ error: "Yorum eklenirken bir hata oluştu" });
  }
});

// Yorum Silme Endpoint'i
app.delete('/api/comments/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const comment = await Comment.findById(id);

    if (!comment) {
      return res.status(404).json({ error: 'Yorum bulunamadı.' });
    }

    if (comment.userId.toString() !== userId) {
      return res.status(403).json({ error: 'Bu yorumu silme yetkiniz yok.' });
    }

    await Comment.findByIdAndDelete(id);

    return res.json({ message: 'Yorum başarıyla silindi.', commentId: id });
  } catch (error) {
    console.error('Yorum silme hatası:', error.message);
    return res.status(500).json({ error: 'Yorum silme sırasında bir hata oluştu' });
  }
});






// Fetch comments for a movie
app.get("/api/comments/:movieId", async (req, res) => {
  try {
    const { movieId } = req.params;
    console.log("Yorumlar getiriliyor:", { movieId });

    const comments = await getCommentsWithReplies(movieId);
    res.json(comments);
  } catch (error) {
    console.error("Yorum getirme hatası:", error.message);
    res.status(500).json({ error: "Yorumlar getirilirken hata oluştu" });
  }
});

async function getCommentsWithReplies(movieId, parentId = null, depth = 0, maxDepth = 4, includeReplies = true) {
  if (depth > maxDepth) return [];

  try {
    // Ana yorumları veya yanıtları al
    const comments = await Comment.find({ movieId, parentId })
      .populate("userId", "username avatar isPremium _id")
      .sort({ createdAt: -1 })
      .limit(20) // İsteğe bağlı, örn: ilk 20 yorum
      .lean();

    // Eğer replies istenmiyorsa sadece hasReplies ile bilgi ver
    if (!includeReplies || depth === maxDepth) {
      const commentIds = comments.map(c => c._id);
      const repliesGrouped = await Comment.aggregate([
        { $match: { parentId: { $in: commentIds } } },
        { $group: { _id: "$parentId", count: { $sum: 1 } } }
      ]);

      const replyMap = Object.fromEntries(repliesGrouped.map(g => [g._id.toString(), g.count]));

      comments.forEach(comment => {
        comment.hasReplies = Boolean(replyMap[comment._id.toString()]);
        comment.replies = []; // maxDepth sınırı geldiyse boş gönder
      });

      return comments;
    }

    // Derinlik kontrolüne takılmadan yanıtları da getir
    const promises = comments.map(async (comment) => {
      comment.replies = await getCommentsWithReplies(movieId, comment._id, depth + 1, maxDepth, includeReplies);
      comment.hasReplies = comment.replies.length > 0;
      return comment;
    });

    return await Promise.all(promises);
  } catch (error) {
    console.error(`getCommentsWithReplies error (movieId=${movieId}, depth=${depth}):`, error.message);
    return [];
  }
}


// Yorum Yanıtı Ekleme
app.post("/api/comments/:commentId/reply", authMiddleware, async (req, res) => {
  try {
    const { commentId } = req.params;
    const { content } = req.body;

    if (!content) return res.status(400).json({ error: "Yanıt içeriği zorunlu" });

    const parent = await Comment.findById(commentId).lean();
    if (!parent) return res.status(404).json({ error: "Ana yorum bulunamadı" });

    const sanitizedContent = sanitizeHtml(content, { allowedTags: [], allowedAttributes: {} });
    if (!sanitizedContent.trim()) return res.status(400).json({ error: "Yanıt içeriği boş olamaz" });

    const reply = new Comment({
      movieId: parent.movieId,
      userId: req.user.userId,
      username: req.userDocument.username,
      content: sanitizedContent,
      parentId: commentId,
    });
    await reply.save();

    res.status(201).json({ message: "Yanıt başarıyla eklendi", reply });
  } catch (error) {
    res.status(500).json({ error: "Yanıt eklenirken bir hata oluştu" });
  }
});

// Yorum beğenme
app.post("/api/comments/:commentId/like", authMiddleware, async (req, res) => {
  try {
    const { commentId } = req.params;
    const comment = await Comment.findById(commentId);
    if (!comment) return res.status(404).json({ error: "Yorum bulunamadı" });

    const userId = req.user.userId;
    const alreadyLiked = comment.likes.includes(userId);
    const alreadyDisliked = comment.dislikes.includes(userId);

    if (alreadyLiked) {
      comment.likes = comment.likes.filter(id => id.toString() !== userId);
    } else {
      comment.likes.push(userId);
      if (alreadyDisliked) {
        comment.dislikes = comment.dislikes.filter(id => id.toString() !== userId);
      }
    }

    await comment.save();
    res.json({
      message: alreadyLiked ? "Beğeni kaldırıldı" : "Yorum beğenildi",
      isLiked: !alreadyLiked,
      commentId
    });
  } catch (error) {
    res.status(500).json({ error: "Beğeni işlemi sırasında hata oluştu" });
  }
});


// Yorum beğenmeme
app.post("/api/comments/:commentId/dislike", authMiddleware, async (req, res) => {
  try {
    const { commentId } = req.params;
    console.log("Yorum beğenmeme isteği:", { commentId });

    const comment = await Comment.findById(commentId);
    if (!comment) {
      return res.status(404).json({ error: "Yorum bulunamadı" });
    }

    const userId = req.user.userId;
    const isDisliked = comment.dislikes.includes(userId);
    const isLiked = comment.likes.includes(userId);

    if (isDisliked) {
      comment.dislikes = comment.dislikes.filter((id) => id.toString() !== userId.toString());
    } else {
      comment.dislikes.push(userId);
      if (isLiked) {
        comment.likes = comment.likes.filter((id) => id.toString() !== userId.toString());
      }
    }

    await comment.save();
    console.log("Yorum beğenilmedi:", { commentId, isDisliked: !isDisliked });

    // Beğenmeme işleminden sonra güncel yorum ağacını döndür
    const comments = await getCommentsWithReplies(comment.movieId);
    res.json({
      message: isDisliked ? "Beğenmeme kaldırıldı" : "Yorum beğenilmedi",
      comments,
    });
  } catch (error) {
    console.error("Yorum beğenmeme hatası:", error.message);
    res.status(500).json({ error: "Yorum beğenmezken bir hata oluştu" });
  }
});

// Admin Kontrolü
app.get("/api/check-admin", authMiddleware, async (req, res) =>
{
  try {
    const user = await User.findById(req.user.userId)
    if (!user) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı" })
    }
    res.json({ isAdmin: user.isAdmin || false })
  } catch (error) {
    console.error("Admin kontrol hatası:", error.message)
    res.status(500).json({ error: "Yönetici durumu kontrol edilirken bir hata oluştu" })
  }
}
)

// Beğeni
app.post("/api/like", authMiddleware, async (req, res) =>
{
  try {
    const { seriesId, seasonNumber, episodeNumber } = req.body
    console.log("Beğeni isteği:", { seriesId, seasonNumber, episodeNumber })
    if (!seriesId || !seasonNumber || !episodeNumber) {
      return res.status(400).json({ error: "seriesId, seasonNumber ve episodeNumber zorunlu" })
    }
    const user = await User.findById(req.user.userId)
    if (!user) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı" })
    }
    const likeKey = { seriesId, seasonNumber, episodeNumber }
    const isLiked = user.likes.some(
      (like) =>
        like.seriesId === seriesId && like.seasonNumber === seasonNumber && like.episodeNumber === episodeNumber,
    )
    const isDisliked = user.dislikes.some(
      (dislike) =>
        dislike.seriesId === seriesId &&
        dislike.seasonNumber === seasonNumber &&
        dislike.episodeNumber === episodeNumber,
    )
    if (isLiked) {
      user.likes = user.likes.filter(
        (like) =>
          !(like.seriesId === seriesId && like.seasonNumber === seasonNumber && like.episodeNumber === episodeNumber),
      )
    } else {
      user.likes.push(likeKey)
      if (isDisliked) {
        user.dislikes = user.dislikes.filter(
          (dislike) =>
            !(
              dislike.seriesId === seriesId &&
              dislike.seasonNumber === seasonNumber &&
              dislike.episodeNumber === episodeNumber
            ),
        )
      }
    }
    await user.save()
    const totalLikes = await User.countDocuments({
      likes: { $elemMatch: { seriesId, seasonNumber, episodeNumber } },
    })
    const totalDislikes = await User.countDocuments({
      dislikes: { $elemMatch: { seriesId, seasonNumber, episodeNumber } },
    })
    res.json({
      isLiked: !isLiked,
      isDisliked: false,
      likeCount: totalLikes,
      dislikeCount: totalDislikes,
    })
  } catch (error) {
    console.error("Beğeni hatası:", error.message)
    res.status(500).json({ error: "Beğenme işlemi sırasında bir hata oluştu" })
  }
}
)

// Beğenmeme
app.post("/api/dislike", authMiddleware, async (req, res) =>
{
  try {
    const { seriesId, seasonNumber, episodeNumber } = req.body
    console.log("Beğenmeme isteği:", { seriesId, seasonNumber, episodeNumber })
    if (!seriesId || !seasonNumber || !episodeNumber) {
      return res.status(400).json({ error: "seriesId, seasonNumber ve episodeNumber zorunlu" })
    }
    const user = await User.findById(req.user.userId)
    if (!user) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı" })
    }
    const dislikeKey = { seriesId, seasonNumber, episodeNumber }
    const isDisliked = user.dislikes.some(
      (dislike) =>
        dislike.seriesId === seriesId &&
        dislike.seasonNumber === seasonNumber &&
        dislike.episodeNumber === episodeNumber,
    )
    const isLiked = user.likes.some(
      (like) =>
        like.seriesId === seriesId && like.seasonNumber === seasonNumber && like.episodeNumber === episodeNumber,
    )
    if (isDisliked) {
      user.dislikes = user.dislikes.filter(
        (dislike) =>
          !(
            dislike.seriesId === seriesId &&
            dislike.seasonNumber === seasonNumber &&
            dislike.episodeNumber === episodeNumber
          ),
      )
    } else {
      user.dislikes.push(dislikeKey)
      if (isLiked) {
        user.likes = user.likes.filter(
          (like) =>
            !(like.seriesId === seriesId && like.seasonNumber === seasonNumber && like.episodeNumber === episodeNumber),
        )
      }
    }
    await user.save()
    const totalLikes = await User.countDocuments({
      likes: { $elemMatch: { seriesId, seasonNumber, episodeNumber } },
    })
    const totalDislikes = await User.countDocuments({
      dislikes: { $elemMatch: { seriesId, seasonNumber, episodeNumber } },
    })
    res.json({
      isDisliked: !isDisliked,
      isLiked: false,
      likeCount: totalLikes,
      dislikeCount: totalDislikes,
    })
  } catch (error) {
    console.error("Beğenmeme hatası:", error.message)
    res.status(500).json({ error: "Beğenmeme işlemi sırasında bir hata oluştu" })
  }
}
)

// İzledim
app.post("/api/watched", authMiddleware, async (req, res) =>
{
  try {
    const { seriesId, seasonNumber, episodeNumber } = req.body
    console.log("İzledim isteği:", { seriesId, seasonNumber, episodeNumber })
    if (!seriesId || !seasonNumber || !episodeNumber) {
      return res.status(400).json({ error: "seriesId, seasonNumber ve episodeNumber zorunlu" })
    }
    const user = await User.findById(req.user.userId)
    if (!user) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı" })
    }
    const watchedKey = { seriesId, seasonNumber, episodeNumber }
    const isWatched = user.watched.some(
      (w) => w.seriesId === seriesId && w.seasonNumber === seasonNumber && w.episodeNumber === episodeNumber,
    )
    if (isWatched) {
      user.watched = user.watched.filter(
        (w) => !(w.seriesId === seriesId && w.seasonNumber === seasonNumber && w.episodeNumber === episodeNumber),
      )
    } else {
      user.watched.push(watchedKey)
    }
    await user.save()
    res.json({ isWatched: !isWatched })
  } catch (error) {
    console.error("İzledim hatası:", error.message)
    res.status(500).json({ error: "İzleme durumu güncellenirken bir hata oluştu" })
  }
}
)
// Durum Kontrol
app.get("/api/status/:seriesId/:seasonNumber/:episodeNumber", authMiddleware, async (req, res) =>
{
  try {
    const { seriesId, seasonNumber, episodeNumber } = req.params
    const seasonNum = Number.parseInt(seasonNumber)
    const episodeNum = Number.parseInt(episodeNumber)
    console.log("Durum kontrol:", { seriesId, seasonNum, episodeNum })
    if (!seriesId || isNaN(seasonNum) || isNaN(episodeNum)) {
      return res.status(400).json({ error: "Geçersiz seriesId, seasonNumber veya episodeNumber" })
    }
    const user = await User.findById(req.user.userId)
    if (!user) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı" })
    }
    const isLiked = user.likes.some(
      (like) => like.seriesId === seriesId && like.seasonNumber === seasonNum && like.episodeNumber === episodeNum,
    )
    const isDisliked = user.dislikes.some(
      (dislike) =>
        dislike.seriesId === seriesId && dislike.seasonNumber === seasonNum && dislike.episodeNumber === episodeNum,
    )
    const isWatched = user.watched.some(
      (w) => w.seriesId === seriesId && w.seasonNumber === seasonNum && w.episodeNumber === episodeNum,
    )
    const isWatchLater = user.watchLater?.some((item) => item.seriesId === seriesId)
    const totalLikes = await User.countDocuments({
      likes: { $elemMatch: { seriesId, seasonNumber: seasonNum, episodeNumber: episodeNum } },
    })
    const totalDislikes = await User.countDocuments({
      dislikes: { $elemMatch: { seriesId, seasonNumber: seasonNum, episodeNumber: episodeNum } },
    })
    res.json({
      isLiked,
      isDisliked,
      isWatched,
      isWatchLater,
      likeCount: totalLikes,
      dislikeCount: totalDislikes,
    })
  } catch (error) {
    console.error("Durum kontrol hatası:", error.message)
    res.status(500).json({ error: "Durum kontrolü sırasında bir hata oluştu" })
  }
}
)

// Genel Durum Kontrol
app.get("/api/public/status/:seriesId/:seasonNumber/:episodeNumber", async (req, res) =>
{
  try {
    const { seriesId, seasonNumber, episodeNumber } = req.params
    const seasonNum = Number.parseInt(seasonNumber)
    const episodeNum = Number.parseInt(episodeNumber)
    console.log("Genel durum kontrol:", { seriesId, seasonNum, episodeNum })
    if (!seriesId || isNaN(seasonNum) || isNaN(episodeNum)) {
      return res.status(400).json({ error: "Geçersiz seriesId, seasonNumber veya episodeNumber" })
    }
    const totalLikes = await User.countDocuments({
      likes: { $elemMatch: { seriesId, seasonNumber: seasonNum, episodeNumber: episodeNum } },
    })
    const totalDislikes = await User.countDocuments({
      dislikes: { $elemMatch: { seriesId, seasonNumber: seasonNum, episodeNumber: episodeNum } },
    })
    res.json({
      likeCount: totalLikes,
      dislikeCount: totalDislikes,
    })
  } catch (error) {
    console.error("Genel durum kontrol hatası:", error.message)
    res.status(500).json({ error: "Genel durum kontrolü sırasında bir hata oluştu" })
  }
}
)

// Token Doğrulama
app.get("/api/verify-token", authMiddleware, async (req, res) =>
{
  try {
    console.log("Token doğrulama isteği:", req.user.username)
    res.json({ success: true, username: req.user.username, userId: req.user.userId })
  } catch (error) {
    console.error("Token doğrulama hatası:", error.message)
    res.status(500).json({ error: "Token doğrulama işlemi sırasında bir hata oluştu" })
  }
}
)

// Premium Üyelik Kontrolü
app.get("/api/check-premium", authMiddleware, async (req, res) =>
{
  try {
    const user = await User.findById(req.user.userId)
    if (!user) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı" })
    }
    res.json({ isPremium: user.isPremium || false })
  } catch (error) {
    console.error("Premium kontrol hatası:", error.message)
    res.status(500).json({ error: "Premium durumu kontrol edilirken bir hata oluştu" })
  }
}
)

// Video Erişim Endpoint'i (Yeni)
app.get("/api/video/:seriesId/:seasonNumber/:episodeNumber", authMiddleware, async (req, res) =>
{
  try {
    const { seriesId, seasonNumber, episodeNumber } = req.params
    const user = await User.findById(req.user.userId)
    if (!user) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı" })
    }
    const movie = await Movie.findOne({ id: seriesId })
    if (!movie) {
      return res.status(404).json({ error: "Dizi bulunamadı" })
    }
    if (movie.premium && !user.isPremium) {
      return res.status(403).json({ error: "Bu içerik için premium üyelik gerekli" })
    }
    const episode = movie.episodes.find((ep) => ep.seasonNumber == seasonNumber && ep.episodeNumber == episodeNumber)
    if (!episode || !episode.videoSrc?.[0]?.src) {
      return res.status(404).json({ error: "Bölüm veya video kaynağı bulunamadı" })
    }
    res.json({ videoSrc: episode.videoSrc[0].src })
  } catch (error) {
    console.error("Video erişim hatası:", error.message)
    res.status(500).json({ error: "Video kaynağına erişilirken bir hata oluştu" })
  }
}
)

// Yeni Eklenen Bölümler
app.get("/api/recent-episodes", async (req, res) =>
{
  try {
    console.log("Yeni bölümler sorgulanıyor")
    const series = await Movie.find({ type: "dizi" }).select("id title poster episodes year language rating").lean()

    const episodesBySeries = {}

    // Dizileri ve bölümleri gruplandır
    series.forEach((serie) => {
      if (serie.episodes && Array.isArray(serie.episodes)) {
        episodesBySeries[serie.id] = {
          seriesId: serie.id,
          seriesTitle: serie.title,
          poster: serie.poster || "https://via.placeholder.com/300x450",
          year: serie.year || "N/A",
          language: serie.language || [],
          rating: serie.rating || "N/A",
          episodes: serie.episodes.map((episode) => ({
            seasonNumber: episode.seasonNumber,
            episodeNumber: episode.episodeNumber,
            episodeTitle: episode.title || `Bölüm ${episode.episodeNumber}`,
            addedDate: episode.addedDate,
            poster: episode.poster || serie.poster || "https://via.placeholder.com/300x450",
          })),
        }
      }
    })

    // Tüm bölümleri birleştir ve sırala
    const allEpisodes = []
    Object.values(episodesBySeries).forEach((series) => {
      series.episodes.forEach((episode) => {
        allEpisodes.push({
          seriesId: series.seriesId,
          seriesTitle: series.seriesTitle,
          poster: episode.poster,
          seasonNumber: episode.seasonNumber,
          episodeNumber: episode.episodeNumber,
          episodeTitle: episode.episodeTitle,
          year: series.year,
          language: series.language,
          rating: series.rating,
          addedDate: episode.addedDate,
        })
      })
    })

    // Bölümleri önce addedDate'e göre (en yeni en üstte), sonra sezon ve bölüm numarasına göre tersten sırala
    const finalSortedEpisodes = allEpisodes
      .sort((a, b) => {
        // Önce addedDate'e göre tersten sırala
        const dateDiff = new Date(b.addedDate) - new Date(a.addedDate)
        if (dateDiff !== 0) return dateDiff

        // Aynı addedDate ise, önce diziye göre (seriesId), sonra sezon (büyükten küçüğe), sonra bölüm (büyükten küçüğe)
        if (a.seriesId !== b.seriesId) return a.seriesId.localeCompare(b.seriesId)
        if (b.seasonNumber !== a.seasonNumber) return b.seasonNumber - a.seasonNumber
        return b.episodeNumber - a.episodeNumber
      })
      .slice(0, req.query.limit ? Number.parseInt(req.query.limit) : 12) // Varsayılan 12 bölüm

    console.log("Yeni bölümler döndü:", finalSortedEpisodes.length)
    res.json(finalSortedEpisodes)
  } catch (error) {
    console.error("Yeni bölümler getirme hatası:", error.message)
    res.status(500).json({ error: "Yeni bölümler getirilirken bir hata oluştu" })
  }
}
)

// Watch Later API endpoint
app.post("/api/watch-later", authMiddleware, async (req, res) =>
{
  try {
    const { movieId } = req.body
    console.log("Daha sonra izle isteği:", { movieId })
    if (!movieId) {
      return res.status(400).json({ error: "movieId zorunlu" })
    }
    const user = await User.findById(req.user.userId)
    if (!user) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı" })
    }
    const movie = await Movie.findOne({ id: movieId })
    if (!movie) {
      return res.status(404).json({ error: "Film veya dizi bulunamadı" })
    }
    const isWatchLater = user.watchLater?.some((item) => item.seriesId === movieId)
    if (isWatchLater) {
      user.watchLater = user.watchLater.filter((item) => item.seriesId !== movieId)
    } else {
      if (!user.watchLater) {
        user.watchLater = []
      }
      user.watchLater.push({ seriesId: movieId, seasonNumber: 0, episodeNumber: 0 })
    }
    await user.save()
    console.log(`Daha sonra izle ${isWatchLater ? "kaldırıldı" : "eklendi"}:`, { movieId })
    res.json({ isWatchLater: !isWatchLater })
  } catch (error) {
    console.error("Daha sonra izle hatası:", error.message)
    res.status(500).json({ error: "Daha sonra izle işlemi sırasında bir hata oluştu" })
  }
}
)


const axios = require('axios');
const cheerio = require('cheerio');
app.get('/api/scrape-dizipal', authMiddleware, adminMiddleware, async (req, res) => {
  const baseUrl = req.query.url;
  if (!baseUrl || !baseUrl.includes('/dizi/')) {
    return res.status(400).json({ error: 'Geçerli bir dizi URL’si gerekli' });
  }

  try {
    const mainPage = await axios.get(baseUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const $main = cheerio.load(mainPage.data);

    const title = $main('.data h1').first().text().trim();
    const altTitle = $main('.data .original-title').text().trim();
    const description = $main('.wp-content p').first().text().trim();
    const year = $main('.data span:contains("Yapım Yılı")').next().text().trim();
    const imdb = $main('.imdb-rat').text().replace(/[^\d.]/g, '').trim();
    const genre = $main('.data span:contains("Tür")').next().text().trim();

    const metadata = {
      title: title || null,
      altTitle: altTitle || null,
      description: description || null,
      year: year || null,
      imdb: imdb || null,
      genre: genre || null,
    };

    // 🔁 Embed scraping (sezon/bölüm döngüsü)
    const results = {};
    const maxSeasons = 20;
    const maxEpisodesPerSeason = 100;
    const max404Limit = 5;

    for (let season = 1; season <= maxSeasons; season++) {
      let foundInSeason = false;
      let errorStreak = 0;

      for (let episode = 1; episode <= maxEpisodesPerSeason; episode++) {
        const epUrl = `${baseUrl}/sezon-${season}/bolum-${episode}`;
        try {
          const response = await axios.get(epUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
          });

          const $ = cheerio.load(response.data);
          const iframe = $('iframe[src^="https"]').first().attr('src');

          if (iframe) {
            if (!results[season]) results[season] = [];
            results[season].push({
              episode,
              embed: iframe.startsWith('http') ? iframe : `https:${iframe}`
            });
            foundInSeason = true;
            errorStreak = 0;
          } else {
            errorStreak++;
          }
        } catch (err) {
          if (err.response?.status === 404) {
            errorStreak++;
          }
        }

        if (errorStreak >= max404Limit) break;
      }

      if (!foundInSeason) break;
    }

    const formattedEpisodes = Object.entries(results).map(([season, eps]) => ({
      season: parseInt(season),
      episodes: eps.sort((a, b) => a.episode - b.episode)
    }));

    res.json({
      metadata,
      episodes: formattedEpisodes
    });
  } catch (err) {
    console.error("Scraping hatası:", err.message);
    res.status(500).json({ error: 'Scraping sırasında hata oluştu' });
  }
});



app.post("/api/scrape-dizipal-meta", async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || !url.includes("dizipal")) {
      return res.status(400).json({ error: "Geçersiz Dizipal URL" });
    }

    const response = await axios.get(url);
    const $ = cheerio.load(response.data);

    const title = $("h5").first().text().trim();
    const plot = $(".popup-summary .summary p").first().text().trim();

    let imdb = "";
    let genre = "";
    let year = "";

    $(".popup-summary ul li").each((_, el) => {
      const key = $(el).find(".key").text().trim().toLowerCase();
      const value = $(el).find(".value").text().trim();

      if (key.includes("imdb")) {
        imdb = value;
      } else if (key.includes("tür")) {
        genre = value
          .split(/\s+/)
          .filter(g => g.toLowerCase() !== "yerli")
          .join(", ")
          .trim();
      } else if (key.includes("yapım yılı")) {
        year = value;
      }
    });

    res.json({
      title,
      plot,
      imdb,
      genre,
      year,
      language: "Türkçe Dublaj & Altyazı"
    });
  } catch (error) {
    console.error("Dizipal meta çekme hatası:", error.message);
    res.status(500).json({ error: "Dizipal verisi çekilemedi" });
  }
});

function setGenres(genresString) {
  const genreInput = document.getElementById("movie-genres"); // görünmeyen alan (hidden veya text)
  const genreList = document.getElementById("genres-list");

  genreList.innerHTML = "";
  const genres = genresString.split(",").map(g => g.trim()).filter(Boolean);

  const selectedGenres = [];

  genres.forEach((g) => {
    const tag = document.createElement("div");
    tag.className = "genre-item";
    tag.innerHTML = `${g} <button onclick="this.parentElement.remove(); updateHiddenGenres()">×</button>`;
    genreList.appendChild(tag);
    selectedGenres.push(g);
  });

  // türleri input’a kaydet (gönderilecek alan)
  genreInput.value = selectedGenres.join(", ");
}

// etiket silindiğinde güncelle
function updateHiddenGenres() {
  const genreItems = document.querySelectorAll("#genres-list .genre-item");
  const genreInput = document.getElementById("movie-genres");
  const genres = Array.from(genreItems).map(el => el.textContent.replace("×", "").trim());
  genreInput.value = genres.join(", ");
}


app.get("/api/platform-content-counts", authMiddleware, adminMiddleware, async (req, res) => {
     try {
       const platforms = ["Exxen", "BluTV", "Gain", "Disney+", "TOD", "Amazon", "Mubi"];
       const stats = await Movie.aggregate([
         { $match: { genres: { $in: platforms } } },
         { $unwind: "$genres" },
         { $match: { genres: { $in: platforms } } },
         { $group: { _id: "$genres", count: { $sum: 1 } } },
         { $project: { _id: 0, platform: "$_id", count: 1 } }
       ]);

       // Tüm platformları dahil et, sayımı sıfır olanlar için bile
       const result = platforms.map(platform => {
         const stat = stats.find(s => s.platform === platform);
         return { platform, count: stat ? stat.count : 0 };
       });

       console.log("Platform içerik sayımları alındı:", result);
       res.json(result);
     } catch (error) {
       console.error("Platform içerik sayımları hatası:", error.message);
       res.status(500).json({ error: "Platform içerik sayımları getirilirken hata oluştu" });
     }
   });


   app.get("/public-profile/:username", async (req, res) => {
  try {
    const username = req.params.username.toLowerCase();

    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı" });

    // Favori içerikleri al
    const favoriteSeriesIds = user.favorites.map(fav => fav.seriesId);

    const favoriteMovies = await Movie.find({
      id: { $in: favoriteSeriesIds },
      type: "film"
    }).select("id title poster year");

    const favoriteSeries = await Movie.find({
      id: { $in: favoriteSeriesIds },
      type: "dizi"
    }).select("id title poster year");

    res.json({
      username: user.username,
      avatar: user.avatar,
      bio: user.bio,
      isPremium: user.isPremium,
      favoriteMovies,
      favoriteSeries
    });

  } catch (error) {
    console.error("Kullanıcı profili alınamadı:", error);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});










// Sunucu Başlatma
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor`)
})

// SEO dostu dizi yönlendirmesi
app.get('/dizi/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '../dizi.html'));
});

app.get("/dizi/:id/sezon-:season/bolum-:episode", (req, res) => {
  res.sendFile(path.join(__dirname, "../dizi.html"))
})
app.get("/film/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "../film.html"))
})
app.get(["/", "/index.html"], (req, res) => {
  res.redirect(301, "/anasayfa")
})
