const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

dotenv.config();
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname, '../')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

// MongoDB bağlantısı
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('MongoDB bağlı'))
    .catch(err => console.error('MongoDB bağlantı hatası:', err));

// Modeller
const User = require('./models/User');
const Movie = require('./models/Movie');

// İndeks oluşturma
Movie.createIndexes({ 
    id: 1, 
    title: 'text', 
    title2: 'text', 
    genres: 'text', 
    type: 1 
}).then(() => console.log('İndeksler oluşturuldu'));

// Nodemailer yapılandırması
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// JWT Middleware
const authMiddleware = async (req, res, next) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');
        if (!token) {
            console.log('Token sağlanmadı');
            return res.status(401).json({ error: 'Erişim reddedildi, lütfen giriş yapın' });
        }
        if (!process.env.JWT_SECRET) {
            console.error('JWT_SECRET tanımlı değil');
            return res.status(500).json({ error: 'Sunucu yapılandırma hatası' });
        }
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        console.error('Auth middleware hatası:', error.message);
        res.status(401).json({ error: 'Geçersiz veya süresi dolmuş token' });
    }
};

// Admin Middleware
const adminMiddleware = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
        }
        if (!user.isAdmin) {
            return res.status(403).json({ error: 'Bu işlem için yönetici yetkisi gerekli' });
        }
        next();
    } catch (error) {
        console.error('Admin middleware hatası:', error.message);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

// API_URL'yi döndüren endpoint
app.get('/api/config', (req, res) => {
    console.log('API_URL istendi:', process.env.API_URL);
    res.json({
        apiUrl: process.env.API_URL || 'http://localhost:3000'
    });
});

// Kayıt
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        console.log('Kayıt isteği:', { username, email, password: '[HIDDEN]' });
        if (!username || !email || !password) {
            return res.status(400).json({ error: 'Kullanıcı adı, e-posta ve parola zorunlu' });
        }
        if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
            return res.status(400).json({ error: 'Kullanıcı adı 3-20 karakter olmalı, sadece harf, sayı ve alt çizgi' });
        }
        if (!/^\S+@\S+\.\S+$/.test(email)) {
            return res.status(400).json({ error: 'Geçerli bir e-posta adresi girin' });
        }
        const existingUser = await User.findOne({ $or: [{ username }, { email }] });
        if (existingUser) {
            return res.status(400).json({ error: 'Kullanıcı adı veya e-posta zaten kayıtlı' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ 
            username, 
            email, 
            password: hashedPassword, 
            likes: [], 
            dislikes: [], 
            watched: [], 
            favorites: [],
            isBanned: false
        });
        await user.save();
        console.log('Kullanıcı oluşturuldu:', username);
        res.status(201).json({ message: 'Kullanıcı başarıyla oluşturuldu' });
    } catch (error) {
        console.error('Kayıt hatası:', error.message);
        res.status(500).json({ error: 'Kayıt işlemi sırasında bir hata oluştu' });
    }
});

// Giriş
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        console.log('Giriş isteği:', { username, password: '[HIDDEN]' });
        if (!username || !password) {
            return res.status(400).json({ error: 'Kullanıcı adı ve parola zorunlu' });
        }
        const user = await User.findOne({ username });
        if (!user) {
            console.log('Kullanıcı bulunamadı:', username);
            return res.status(401).json({ error: 'Kullanıcı adı veya parola yanlış' });
        }
        if (user.isBanned) {
            console.log('Kullanıcı yasaklı:', username);
            return res.status(403).json({ error: 'Hesabınız yasaklanmıştır. Lütfen destek ekibiyle iletişime geçin.' });
        }
        if (user.lockUntil && user.lockUntil > new Date()) {
            const minutesLeft = Math.ceil((user.lockUntil - new Date()) / 60000);
            console.log('Hesap kilitli:', username);
            return res.status(403).json({ error: `Hesap kilitli. ${minutesLeft} dakika sonra tekrar deneyin.` });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            user.loginAttempts = (user.loginAttempts || 0) + 1;
            if (user.loginAttempts >= 3) {
                user.lockUntil = new Date(Date.now() + 5 * 60 * 1000);
                user.loginAttempts = 0;
                console.log('Hesap kilitlendi:', username);
            }
            await user.save();
            console.log('Parola eşleşmedi:', username);
            return res.status(401).json({ error: 'Kullanıcı adı veya parola yanlış' });
        }
        user.loginAttempts = 0;
        user.lockUntil = null;
        await user.save();
        if (!process.env.JWT_SECRET) {
            console.error('JWT_SECRET tanımlı değil');
            return res.status(500).json({ error: 'Sunucu yapılandırma hatası' });
        }
        const token = jwt.sign({ userId: user._id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '1h' });
        console.log('Giriş başarılı:', username, 'isAdmin:', user.isAdmin);
        res.json({ 
            token, 
            username: user.username, 
            isAdmin: user.isAdmin, 
            message: 'Giriş başarılı' 
        });
    } catch (error) {
        console.error('Giriş hatası:', error.message);
        res.status(500).json({ error: 'Giriş işlemi sırasında bir hata oluştu' });
    }
});

// Şifre Sıfırlama İsteği
app.post('/api/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        console.log('Şifre sıfırlama isteği:', { email });
        if (!email) {
            return res.status(400).json({ error: 'E-posta adresi zorunlu' });
        }
        const user = await User.findOne({ email });
        if (!user) {
            console.log('E-posta bulunamadı:', email);
            return res.status(404).json({ error: 'Bu e-posta adresiyle kayıtlı kullanıcı bulunamadı' });
        }
        const resetToken = crypto.randomBytes(32).toString('hex');
        user.resetPasswordToken = resetToken;
        user.resetPasswordExpires = new Date(Date.now() + 3600000);
        await user.save();

        const resetUrl = `${process.env.API_URL}/reset-password.html?token=${resetToken}`;
        await transporter.sendMail({
            to: email,
            subject: 'DİZİT Şifre Sıfırlama',
            html: `
                <p>Merhaba ${user.username},</p>
                <p>Şifrenizi sıfırlamak için aşağıdaki bağlantıya tıklayın:</p>
                <a href="${resetUrl}">${resetUrl}</a>
                <p>Bu bağlantı 1 saat boyunca geçerlidir.</p>
                <p>Eğer bu isteği siz yapmadıysanız, lütfen bu e-postayı dikkate almayın.</p>
                <p>DİZİT Ekibi</p>
            `
        });

        console.log('Şifre sıfırlama e-postası gönderildi:', email);
        res.json({ message: 'Şifre sıfırlama bağlantısı e-postanıza gönderildi' });
    } catch (error) {
        console.error('Şifre sıfırlama hatası:', error.message);
        res.status(500).json({ error: 'Şifre sıfırlama işlemi sırasında bir hata oluştu' });
    }
});

// Şifre Sıfırlama
app.post('/api/reset-password/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const { password } = req.body;
        console.log('Şifre sıfırlama işlemi:', { token, password: '[HIDDEN]' });
        if (!password) {
            return res.status(400).json({ error: 'Yeni parola zorunlu' });
        }
        const user = await User.findOne({
            resetPasswordToken: token,
            resetPasswordExpires: { $gt: new Date() }
        });
        if (!user) {
            console.log('Geçersiz veya süresi dolmuş token:', token);
            return res.status(400).json({ error: 'Geçersiz veya süresi dolmuş sıfırlama bağlantısı' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        user.password = hashedPassword;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();
        console.log('Şifre sıfırlandı:', user.username);
        res.json({ message: 'Şifre başarıyla sıfırlandı' });
    } catch (error) {
        console.error('Şifre sıfırlama hatası:', error.message);
        res.status(500).json({ error: 'Şifre sıfırlama işlemi sırasında bir hata oluştu' });
    }
});

// Kullanıcıları Listele
app.get('/api/users', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const users = await User.find({ isAdmin: false })
            .select('username email isAdmin isBanned loginAttempts lockUntil')
            .lean();
        res.json(users);
    } catch (error) {
        console.error('Kullanıcı listeleme hatası:', error.message);
        res.status(500).json({ error: 'Kullanıcıları listeleme sırasında bir hata oluştu' });
    }
});

// Kullanıcıyı Yasaklama/Yasağı Kaldırma
app.put('/api/users/:username/ban', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { username } = req.params;
        const { isBanned } = req.body;
        console.log('Kullanıcı ban işlemi:', { username, isBanned });
        if (typeof isBanned !== 'boolean') {
            return res.status(400).json({ error: 'isBanned değeri boolean olmalı' });
        }
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
        }
        if (user.isAdmin && isBanned) {
            return res.status(403).json({ error: 'Yönetici kullanıcılar yasaklanamaz' });
        }
        user.isBanned = isBanned;
        await user.save();
        console.log(`Kullanıcı ${isBanned ? 'yasaklandı' : 'yasağı kaldırıldı'}:`, username);
        res.json({ message: `Kullanıcı ${isBanned ? 'yasaklandı' : 'yasağı kaldırıldı'}` });
    } catch (error) {
        console.error('Kullanıcı ban hatası:', error.message);
        res.status(500).json({ error: 'Kullanıcı ban işlemi sırasında bir hata oluştu' });
    }
});

// Kullanıcı Silme
app.delete('/api/users/:username', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { username } = req.params;
        console.log('Kullanıcı silme isteği:', { username });
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
        }
        if (user.isAdmin) {
            return res.status(403).json({ error: 'Yönetici kullanıcılar silinemez' });
        }
        if (req.user.username === username) {
            return res.status(403).json({ error: 'Kendi hesabınızı silemezsiniz' });
        }
        await User.deleteOne({ username });
        console.log('Kullanıcı silindi:', username);
        res.json({ message: 'Kullanıcı başarıyla silindi' });
    } catch (error) {
        console.error('Kullanıcı silme hatası:', error.message);
        res.status(500).json({ error: 'Kullanıcı silme işlemi sırasında bir hata oluştu' });
    }
});

// Film/Dizi Ekleme
app.post('/api/movies', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const movieData = req.body;
        console.log('Gelen movieData:', movieData);
        if (!/^[a-zA-Z0-9]{3,20}$/.test(movieData.id)) {
            return res.status(400).json({ error: 'ID 3-20 karakter olmalı, sadece harf ve sayı içermeli' });
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
                if (!/^[a-zA-Z0-9]{3,20}$/.test(seriesId)) {
                    return res.status(400).json({ error: 'İlgili seri ID’leri 3-20 karakter olmalı, sadece harf ve sayı' });
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
            movieData.episodes.forEach((ep, index) => {
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
            season: movieData.season
        });
        await newMovie.save();
        console.log('Film kaydedildi:', newMovie.id);
        res.status(201).json({ message: 'Film/Dizi başarıyla eklendi', movie: newMovie });
    } catch (error) {
        console.error('Film ekleme hatası:', error.message);
        res.status(500).json({ error: error.message || 'Film ekleme işlemi sırasında bir hata oluştu' });
    }
});

// Film/Dizi Güncelleme
app.put('/api/movies/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const movieData = req.body;
        console.log('Güncelleme isteği:', movieData.id);
        if (!/^[a-zA-Z0-9]{3,20}$/.test(movieData.id)) {
            return res.status(400).json({ error: 'ID 3-20 karakter olmalı, sadece harf ve sayı içermeli' });
        }
        if (movieData.poster && !/^https?:\/\/.+\.(jpg|png|jpeg)$/.test(movieData.poster)) {
            return res.status(400).json({ error: 'Poster URL’si geçerli bir jpg/png resmi olmalı' });
        }
        if (movieData.id !== req.params.id) {
            const existingMovie = await Movie.findOne({ id: movieData.id });
            if (existingMovie && existingMovie._id.toString() !== (await Movie.findOne({ id: req.params.id }))?._id.toString()) {
                return res.status(400).json({ error: 'Bu ID zaten kullanımda' });
            }
        }
        if (movieData.relatedSeries && Array.isArray(movieData.relatedSeries)) {
            for (const seriesId of movieData.relatedSeries) {
                if (!/^[a-zA-Z0-9]{3,20}$/.test(seriesId)) {
                    return res.status(400).json({ error: 'İlgili seri ID’leri 3-20 karakter olmalı, sadece harf ve sayı' });
                }
                const relatedMovie = await Movie.findOne({ id: seriesId });
                if (!relatedMovie) {
                    return res.status(400).json({ error: `İlgili seri ID’si bulunamadı: ${seriesId}` });
                }
            }
        } else {
            movieData.relatedSeries = [];
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
                season: movieData.season
            },
            { new: true, runValidators: true }
        );
        if (!updatedMovie) {
            return res.status(404).json({ error: 'Film/Dizi bulunamadı' });
        }
        console.log('Film güncellendi:', updatedMovie.id);
        res.json({ message: 'Film/Dizi başarıyla güncellendi', movie: updatedMovie });
    } catch (error) {
        console.error('Güncelleme hatası:', error.message);
        res.status(500).json({ error: error.message || 'Güncelleme işlemi sırasında bir hata oluştu' });
    }
});

// Film/Dizi Silme
app.delete('/api/movies/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const deletedMovie = await Movie.findOneAndDelete({ id: req.params.id });
        if (!deletedMovie) {
            return res.status(404).json({ error: 'Film/Dizi bulunamadı' });
        }
        console.log('Film silindi:', req.params.id);
        res.json({ message: 'Film/Dizi başarıyla silindi' });
    } catch (error) {
        console.error('Silme hatası:', error.message);
        res.status(500).json({ error: 'Silme işlemi sırasında bir hata oluştu' });
    }
});

// Film/Dizi Listeleme
app.get('/api/movies', async (req, res) => {
    try {
        const { type, year, genres, language, sort } = req.query;
        console.log('Gelen sorgu parametreleri:', { type, year, genres, language, sort });
        const query = {};

        // İçerik tipi filtresi
        if (type) query.type = type;

        // Yıl filtresi
        if (year) {
            console.log('Yıl filtresi uygulanıyor:', year);
            if (year.includes('-')) {
                const [start, end] = year.split('-').map(Number);
                if (!isNaN(start) && !isNaN(end)) {
                    query.year = { $gte: start, $lte: end, $type: "number" };
                }
            } else if (year === 'before-2000') {
                query.year = { $lte: 2000, $exists: true, $ne: null, $type: "number" };
            } else {
                const parsedYear = parseInt(year);
                if (!isNaN(parsedYear)) {
                    query.year = parsedYear;
                }
            }
        }

        // Tür filtresi
        if (genres) {
            const genreArray = genres.split(',').filter(g => g.trim());
            if (genreArray.length > 0) {
                query.genres = { $all: genreArray };
            }
        }

        // Dil filtresi
        if (language) {
            const languageArray = language.split(',').filter(l => l.trim());
            if (languageArray.length > 0) {
                query.language = { $in: languageArray };
            }
        }

        // Sıralama
        let sortOption = { _id: -1 };
        if (sort) {
            if (sort.startsWith('-')) {
                sortOption = { [sort.substring(1)]: -1 };
            } else {
                sortOption = { [sort]: 1 };
            }
        }

        console.log('MongoDB sorgusu:', query);
        const movies = await Movie.find(query)
            .sort(sortOption)
            .lean();
        // 2000 öncesi filtresi için doğrulama
        if (year === 'before-2000') {
            const invalidMovies = movies.filter(m => m.year > 2000);
            if (invalidMovies.length > 0) {
                console.warn('HATA: 2000 sonrası içerikler döndü:', invalidMovies.map(m => ({ id: m.id, title: m.title, year: m.year })));
            }
        }
        console.log('Dönen içerik sayısı:', movies.length, 'Yıllar:', movies.map(m => m.year));
        res.json(movies);
    } catch (error) {
        console.error('Listeleme hatası:', error.message);
        res.status(500).json({ error: 'İçerik listeleme sırasında bir hata oluştu' });
    }
});

// Film/Dizi Detay
app.get('/api/movies/:id', async (req, res) => {
    console.time(`movies/${req.params.id}`);
    try {
        const movie = await Movie.findOne({ id: req.params.id })
            .select('id title title2 year runtime rating country language genres plot poster videoSrc type episodes season relatedSeries')
            .lean();
        if (!movie) {
            console.timeEnd(`movies/${req.params.id}`);
            return res.status(404).json({ error: 'Film/Dizi bulunamadı' });
        }
        const relatedMovies = await Movie.find({ id: { $in: movie.relatedSeries || [] } })
            .select('id title title2 poster year rating')
            .lean();
        console.timeEnd(`movies/${req.params.id}`);
        res.json({ ...movie, relatedSeriesDetails: relatedMovies });
    } catch (error) {
        console.error('Detay hatası:', error.message);
        console.timeEnd(`movies/${req.params.id}`);
        res.status(500).json({ error: 'Film/dizi detayları getirilirken bir hata oluştu' });
    }
});

// Film Detay ve Durum
app.get('/api/movie-details/:id', authMiddleware, async (req, res) => {
    console.time(`movie-details/${req.params.id}`);
    try {
        const movie = await Movie.findOne({ id: req.params.id })
            .select('id title title2 year runtime rating country language genres plot poster videoSrc type episodes season relatedSeries')
            .lean();
        if (!movie) {
            console.timeEnd(`movie-details/${req.params.id}`);
            return res.status(404).json({ error: 'Film/Dizi bulunamadı' });
        }

        const user = await User.findById(req.user.userId);
        if (!user) {
            console.timeEnd(`movie-details/${req.params.id}`);
            return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
        }

        const isLiked = user.likes.some(like => like.seriesId === movie.id && like.seasonNumber === 0 && like.episodeNumber === 0);
        const isDisliked = user.dislikes.some(dislike => dislike.seriesId === movie.id && dislike.seasonNumber === 0 && like.episodeNumber === 0);
        const isWatched = user.watched.some(w => w.seriesId === movie.id && w.seasonNumber === 0 && w.episodeNumber === 0);
        const isFavorited = user.favorites.some(fav => fav.seriesId === movie.id);

        const totalLikes = await User.countDocuments({
            likes: { $elemMatch: { seriesId: movie.id, seasonNumber: 0, episodeNumber: 0 } }
        });
        const totalDislikes = await User.countDocuments({
            dislikes: { $elemMatch: { seriesId: movie.id, seasonNumber: 0, episodeNumber: 0 } }
        });

        const episodeStatuses = movie.episodes?.map(ep => ({
            seasonNumber: ep.seasonNumber,
            episodeNumber: ep.episodeNumber,
            isLiked: user.likes.some(l => l.seriesId === movie.id && l.seasonNumber === ep.seasonNumber && l.episodeNumber === ep.episodeNumber),
            isDisliked: user.dislikes.some(d => d.seriesId === movie.id && d.seasonNumber === ep.seasonNumber && d.episodeNumber === ep.episodeNumber),
            isWatched: user.watched.some(w => w.seriesId === movie.id && w.seasonNumber === ep.seasonNumber && w.episodeNumber === ep.episodeNumber),
            likeCount: 0,
            dislikeCount: 0
        })) || [];

        console.timeEnd(`movie-details/${req.params.id}`);
        res.json({
            movie,
            userStatus: { isLiked, isDisliked, isWatched, isFavorited },
            publicStatus: { likeCount: totalLikes, dislikeCount: totalDislikes },
            episodeStatuses
        });
    } catch (error) {
        console.error('Detay hatası:', error.message);
        console.timeEnd(`movie-details/${req.params.id}`);
        res.status(500).json({ error: 'Film/dizi detayları getirilirken bir hata oluştu' });
    }
});

// Arama
app.get('/api/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) {
            return res.json([]);
        }
        const movies = await Movie.find({
            $or: [
                { title: { $regex: query, $options: 'i' } },
                { title2: { $regex: query, $options: 'i' } },
                { genres: { $regex: query, $options: 'i' } }
            ]
        }).lean();
        res.json(movies);
    } catch (error) {
        console.error('Arama hatası:', error.message);
        res.status(500).json({ error: 'Arama işlemi sırasında bir hata oluştu' });
    }
});

// Akıllı Benzer Diziler
// Akıllı Benzer Diziler
// Akıllı Benzer Diziler
app.get('/api/similar/:id', async (req, res) => {
    try {
        console.time(`similar/${req.params.id}`);
        const current = await Movie.findOne({ id: req.params.id }).lean();
        if (!current) {
            return res.status(404).json({ error: 'İçerik bulunamadı' });
        }

        let watchedIds = [];
        const token = req.headers.authorization?.split(' ')[1];
        if (token) {
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                const user = await User.findById(decoded.userId);
                if (user) {
                    watchedIds = user.watched.map(w => w.seriesId);
                }
            } catch (error) {
                console.log('Token doğrulama başarısız, izlenenler hariç tutulmayacak:', error.message);
            }
        }

        const targetType = req.query.type || current.type;
        const allItems = await Movie.find({ 
            type: targetType, 
            id: { $ne: current.id, $nin: watchedIds }
        })
            .select('id title title2 year rating poster language genres country')
            .lean();

        const watchCounts = await User.aggregate([
            { $unwind: '$watched' },
            { $group: { _id: '$watched.seriesId', count: { $sum: 1 } } }
        ]);

        const scoreItem = (item) => {
            let score = 0;
            const currentGenres = Array.isArray(current.genres) ? current.genres : [];
            const itemGenres = Array.isArray(item.genres) ? item.genres : [];
            const genreMatches = itemGenres.filter(g => currentGenres.includes(g)).length;
            const genreWeight = current.country?.length > 0 ? 40 : 45;
            score += (genreMatches / Math.max(currentGenres.length, 1)) * genreWeight;

            const currentLanguages = Array.isArray(current.language) ? current.language : [];
            const itemLanguages = Array.isArray(item.language) ? item.language : [];
            const langMatches = itemLanguages.filter(l => currentLanguages.includes(l)).length;
            const langWeight = current.country?.length > 0 ? 20 : 25;
            score += (langMatches / Math.max(currentLanguages.length, 1)) * langWeight;

            if (current.country?.length > 0 && item.country?.length > 0) {
                const currentCountries = Array.isArray(current.country) ? current.country : [];
                const itemCountries = Array.isArray(item.country) ? item.country : [];
                const countryMatches = itemCountries.filter(c => currentCountries.includes(c)).length;
                score += (countryMatches / Math.max(currentCountries.length, 1)) * 15;
            }

            const currentRating = parseFloat(current.rating) || 0;
            const itemRating = parseFloat(item.rating) || 0;
            const ratingDiff = Math.abs(currentRating - itemRating);
            score += (1 - Math.min(ratingDiff / 10, 1)) * 15;

            const watchCount = watchCounts.find(w => w._id === item.id)?.count || 0;
            const maxWatches = Math.max(...watchCounts.map(w => w.count), 1);
            score += (watchCount / maxWatches) * 10;

            return score;
        };

        const scoredItems = allItems.map(item => ({
            ...item,
            score: scoreItem(item)
        }));

        const sorted = scoredItems
            .sort((a, b) => b.score - a.score)
            .slice(0, 10);

        console.timeEnd(`similar/${req.params.id}`);
        res.json(sorted);
    } catch (error) {
        console.error('Benzer içerik hatası:', error.message);
        res.status(500).json({ error: 'Benzer içerikler getirilirken bir hata oluştu' });
    }
});
// Film Beğenme
app.post('/api/movie-like', authMiddleware, async (req, res) => {
    try {
        const { movieId } = req.body;
        console.log('Film beğeni isteği:', { movieId });
        if (!movieId) {
            return res.status(400).json({ error: 'movieId zorunlu' });
        }
        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
        }
        const likeKey = { seriesId: movieId, seasonNumber: 0, episodeNumber: 0 };
        const isLiked = user.likes.some(like =>
            like.seriesId === movieId &&
            like.seasonNumber === 0 &&
            like.episodeNumber === 0
        );
        const isDisliked = user.dislikes.some(dislike =>
            dislike.seriesId === movieId &&
            dislike.seasonNumber === 0 &&
            dislike.episodeNumber === 0
        );
        if (isLiked) {
            user.likes = user.likes.filter(like =>
                !(like.seriesId === movieId && like.seasonNumber === 0 && like.episodeNumber === 0)
            );
        } else {
            user.likes.push(likeKey);
            if (isDisliked) {
                user.dislikes = user.dislikes.filter(dislike =>
                    !(dislike.seriesId === movieId && dislike.seasonNumber === 0 && dislike.episodeNumber === 0)
                );
            }
        }
        await user.save();
        const totalLikes = await User.countDocuments({
            likes: { $elemMatch: { seriesId: movieId, seasonNumber: 0, episodeNumber: 0 } }
        });
        const totalDislikes = await User.countDocuments({
            dislikes: { $elemMatch: { seriesId: movieId, seasonNumber: 0, episodeNumber: 0 } }
        });
        res.json({
            isLiked: !isLiked,
            isDisliked: false,
            likeCount: totalLikes,
            dislikeCount: totalDislikes
        });
    } catch (error) {
        console.error('Film beğeni hatası:', error.message);
        res.status(500).json({ error: 'Film beğenme işlemi sırasında bir hata oluştu' });
    }
});

// Film Beğenmeme
app.post('/api/movie-dislike', authMiddleware, async (req, res) => {
    try {
        const { movieId } = req.body;
        console.log('Film beğenmeme isteği:', { movieId });
        if (!movieId) {
            return res.status(400).json({ error: 'movieId zorunlu' });
        }
        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
        }
        const dislikeKey = { seriesId: movieId, seasonNumber: 0, episodeNumber: 0 };
        const isDisliked = user.dislikes.some(dislike =>
            dislike.seriesId === movieId &&
            dislike.seasonNumber === 0 &&
            dislike.episodeNumber === 0
        );
        const isLiked = user.likes.some(like =>
            like.seriesId === movieId &&
            like.seasonNumber === 0 &&
            like.episodeNumber === 0
        );
        if (isDisliked) {
            user.dislikes = user.dislikes.filter(dislike =>
                !(dislike.seriesId === movieId && dislike.seasonNumber === 0 && dislike.episodeNumber === 0)
            );
        } else {
            user.dislikes.push(dislikeKey);
            if (isLiked) {
                user.likes = user.likes.filter(like =>
                    !(like.seriesId === movieId && like.seasonNumber === 0 && like.episodeNumber === 0)
                );
            }
        }
        await user.save();
        const totalLikes = await User.countDocuments({
            likes: { $elemMatch: { seriesId: movieId, seasonNumber: 0, episodeNumber: 0 } }
        });
        const totalDislikes = await User.countDocuments({
            dislikes: { $elemMatch: { seriesId: movieId, seasonNumber: 0, episodeNumber: 0 } }
        });
        res.json({
            isDisliked: !isDisliked,
            isLiked: false,
            likeCount: totalLikes,
            dislikeCount: totalDislikes
        });
    } catch (error) {
        console.error('Film beğenmeme hatası:', error.message);
        res.status(500).json({ error: 'Film beğenmeme işlemi sırasında bir hata oluştu' });
    }
});

// Film İzledim
app.post('/api/movie-watched', authMiddleware, async (req, res) => {
    try {
        const { movieId } = req.body;
        console.log('Film izledim isteği:', { movieId });
        if (!movieId) {
            return res.status(400).json({ error: 'movieId zorunlu' });
        }
        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
        }
        const watchedKey = { seriesId: movieId, seasonNumber: 0, episodeNumber: 0 };
        const isWatched = user.watched.some(w =>
            w.seriesId === movieId &&
            w.seasonNumber === 0 &&
            w.episodeNumber === 0
        );
        if (isWatched) {
            user.watched = user.watched.filter(w =>
                !(w.seriesId === movieId && w.seasonNumber === 0 && w.episodeNumber === 0)
            );
        } else {
            user.watched.push(watchedKey);
        }
        await user.save();
        res.json({ isWatched: !isWatched });
    } catch (error) {
        console.error('Film izledim hatası:', error.message);
        res.status(500).json({ error: 'Film izleme durumu güncellenirken bir hata oluştu' });
    }
});

// Film Favorilere Ekleme/Çıkarma
app.post('/api/favorite', authMiddleware, async (req, res) => {
    try {
        const { movieId } = req.body;
        console.log('Favori isteği:', { movieId });
        if (!movieId || typeof movieId !== 'string') {
            return res.status(400).json({ error: 'Geçerli bir movieId zorunlu' });
        }
        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
        }
        const movie = await Movie.findOne({ id: movieId });
        if (!movie) {
            return res.status(404).json({ error: 'Film veya dizi bulunamadı' });
        }
        const isFavorited = user.favorites.some(fav => fav.seriesId === movieId);
        if (isFavorited) {
            user.favorites = user.favorites.filter(fav => fav.seriesId !== movieId);
        } else {
            user.favorites.push({ seriesId: movieId, seasonNumber: 0, episodeNumber: 0 });
        }
        await user.save();
        console.log(`Favori ${isFavorited ? 'kaldırıldı' : 'eklendi'}:`, { movieId });
        res.json({ isFavorited: !isFavorited });
    } catch (error) {
        console.error('Favori hatası:', error.message);
        res.status(500).json({ error: 'Favorilere ekleme/kaldırma işlemi sırasında bir hata oluştu' });
    }
});

// Film/Dizi ID'lerini ara
app.get('/api/movies/search-ids', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) {
            return res.json([]);
        }
        const movies = await Movie.find({
            id: { $regex: `^${q}`, $options: 'i' }
        })
            .select('id title')
            .limit(10)
            .lean();
        res.json(movies);
    } catch (error) {
        console.error('ID arama hatası:', error.message);
        res.status(500).json({ error: 'ID arama işlemi sırasında bir hata oluştu' });
    }
});

// Benzersiz türleri getir
app.get('/api/genres', async (req, res) => {
    try {
        const genres = await Movie.distinct('genres');
        res.json(genres);
    } catch (error) {
        console.error('Tür listeleme hatası:', error.message);
        res.status(500).json({ error: 'Türler getirilirken bir hata oluştu' });
    }
});

// Film Durum Kontrol
app.get('/api/movie-status/:movieId', authMiddleware, async (req, res) => {
    try {
        const { movieId } = req.params;
        console.log('Film durum kontrol:', { movieId });
        if (!movieId) {
            return res.status(400).json({ error: 'movieId zorunlu' });
        }
        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
        }
        const isLiked = user.likes.some(like =>
            like.seriesId === movieId &&
            like.seasonNumber === 0 &&
            like.episodeNumber === 0
        );
        const isDisliked = user.dislikes.some(dislike =>
            dislike.seriesId === movieId &&
            dislike.seasonNumber === 0 &&
            dislike.episodeNumber === 0
        );
        const isWatched = user.watched.some(w =>
            w.seriesId === movieId &&
            w.seasonNumber === 0 &&
            w.episodeNumber === 0
        );
        const isFavorited = user.favorites.some(fav => fav.seriesId === movieId);
        const totalLikes = await User.countDocuments({
            likes: { $elemMatch: { seriesId: movieId, seasonNumber: 0, episodeNumber: 0 } }
        });
        const totalDislikes = await User.countDocuments({
            dislikes: { $elemMatch: { seriesId: movieId, seasonNumber: 0, episodeNumber: 0 } }
        });
        res.json({
            isLiked,
            isDisliked,
            isWatched,
            isFavorited,
            likeCount: totalLikes,
            dislikeCount: totalDislikes
        });
    } catch (error) {
        console.error('Film durum kontrol hatası:', error.message);
        res.status(500).json({ error: 'Film durumu kontrol edilirken bir hata oluştu' });
    }
});

// Film Genel Durum Kontrol
app.get('/api/public/movie-status/:movieId', async (req, res) => {
    try {
        const { movieId } = req.params;
        console.log('Film genel durum kontrol:', { movieId });
        if (!movieId) {
            return res.status(400).json({ error: 'movieId zorunlu' });
        }
        const totalLikes = await User.countDocuments({
            likes: { $elemMatch: { seriesId: movieId, seasonNumber: 0, episodeNumber: 0 } }
        });
        const totalDislikes = await User.countDocuments({
            dislikes: { $elemMatch: { seriesId: movieId, seasonNumber: 0, episodeNumber: 0 } }
        });
        res.json({
            likeCount: totalLikes,
            dislikeCount: totalDislikes
        });
    } catch (error) {
        console.error('Film genel durum kontrol hatası:', error.message);
        res.status(500).json({ error: 'Film genel durumu kontrol edilirken bir hata oluştu' });
    }
});

// Toplu Durum Kontrol
app.post('/api/batch-status', authMiddleware, async (req, res) => {
    try {
        const { seriesId, episodes } = req.body;
        if (!seriesId || !Array.isArray(episodes)) {
            return res.status(400).json({ error: 'seriesId ve episodes dizisi zorunlu' });
        }
        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
        }
        const statuses = episodes.map(({ seasonNumber, episodeNumber }) => {
            const seasonNum = parseInt(seasonNumber);
            const episodeNum = parseInt(episodeNumber);
            return {
                seasonNumber: seasonNum,
                episodeNumber: episodeNum,
                isWatched: user.watched.some(w =>
                    w.seriesId === seriesId &&
                    w.seasonNumber === seasonNum &&
                    w.episodeNumber === episodeNum
                ),
                isLiked: user.likes.some(l =>
                    l.seriesId === seriesId &&
                    l.seasonNumber === seasonNum &&
                    l.episodeNumber === episodeNum
                ),
                isDisliked: user.dislikes.some(d =>
                    d.seriesId === seriesId &&
                    d.seasonNumber === seasonNum &&
                    d.episodeNumber === episodeNum
                )
            };
        });
        const likeCounts = await User.aggregate([
            { $unwind: '$likes' },
            {
                $match: {
                    'likes.seriesId': seriesId,
                    'likes.seasonNumber': { $in: episodes.map(e => parseInt(e.seasonNumber)) },
                    'likes.episodeNumber': { $in: episodes.map(e => parseInt(e.episodeNumber)) }
                }
            },
            {
                $group: {
                    _id: { seasonNumber: '$likes.seasonNumber', episodeNumber: '$likes.episodeNumber' },
                    count: { $sum: 1 }
                }
            }
        ]);
        const dislikeCounts = await User.aggregate([
            { $unwind: '$dislikes' },
            {
                $match: {
                    'dislikes.seriesId': seriesId,
                    'dislikes.seasonNumber': { $in: episodes.map(e => parseInt(e.seasonNumber)) },
                    'dislikes.episodeNumber': { $in: episodes.map(e => parseInt(e.episodeNumber)) }
                }
            },
            {
                $group: {
                    _id: { seasonNumber: '$dislikes.seasonNumber', episodeNumber: '$dislikes.episodeNumber' },
                    count: { $sum: 1 }
                }
            }
        ]);
        const result = statuses.map(status => ({
            ...status,
            likeCount: likeCounts.find(l => l._id.seasonNumber === status.seasonNumber && l._id.episodeNumber === status.episodeNumber)?.count || 0,
            dislikeCount: dislikeCounts.find(d => d._id.seasonNumber === status.seasonNumber && d._id.episodeNumber === status.episodeNumber)?.count || 0
        }));
        res.json(result);
    } catch (error) {
        console.error('Toplu durum hatası:', error.message);
        res.status(500).json({ error: 'Toplu durum kontrolü sırasında bir hata oluştu' });
    }
});

// Admin Kontrolü
app.get('/api/check-admin', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
        }
        res.json({ isAdmin: user.isAdmin || false });
    } catch (error) {
        console.error('Admin kontrol hatası:', error.message);
        res.status(500).json({ error: 'Yönetici durumu kontrol edilirken bir hata oluştu' });
    }
});

// Beğeni
app.post('/api/like', authMiddleware, async (req, res) => {
    try {
        const { seriesId, seasonNumber, episodeNumber } = req.body;
        console.log('Beğeni isteği:', { seriesId, seasonNumber, episodeNumber });
        if (!seriesId || !seasonNumber || !episodeNumber) {
            return res.status(400).json({ error: 'seriesId, seasonNumber ve episodeNumber zorunlu' });
        }
        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
        }
        const likeKey = { seriesId, seasonNumber, episodeNumber };
        const isLiked = user.likes.some(like =>
            like.seriesId === seriesId &&
            like.seasonNumber === seasonNumber &&
            like.episodeNumber === episodeNumber
        );
        const isDisliked = user.dislikes.some(dislike =>
            dislike.seriesId === seriesId &&
            dislike.seasonNumber === seasonNumber &&
            dislike.episodeNumber === episodeNumber
        );
        if (isLiked) {
            user.likes = user.likes.filter(like =>
                !(like.seriesId === seriesId && like.seasonNumber === seasonNumber && like.episodeNumber === episodeNumber)
            );
        } else {
            user.likes.push(likeKey);
            if (isDisliked) {
                user.dislikes = user.dislikes.filter(dislike =>
                    !(dislike.seriesId === seriesId && dislike.seasonNumber === seasonNumber && dislike.episodeNumber === episodeNumber)
                );
            }
        }
        await user.save();
        const totalLikes = await User.countDocuments({
            likes: { $elemMatch: { seriesId, seasonNumber, episodeNumber } }
        });
        const totalDislikes = await User.countDocuments({
            dislikes: { $elemMatch: { seriesId, seasonNumber, episodeNumber } }
        });
        res.json({
            isLiked: !isLiked,
            isDisliked: false,
            likeCount: totalLikes,
            dislikeCount: totalDislikes
        });
    } catch (error) {
        console.error('Beğeni hatası:', error.message);
        res.status(500).json({ error: 'Beğenme işlemi sırasında bir hata oluştu' });
    }
});

// Beğenmeme
app.post('/api/dislike', authMiddleware, async (req, res) => {
    try {
        const { seriesId, seasonNumber, episodeNumber } = req.body;
        console.log('Beğenmeme isteği:', { seriesId, seasonNumber, episodeNumber });
        if (!seriesId || !seasonNumber || !episodeNumber) {
            return res.status(400).json({ error: 'seriesId, seasonNumber ve episodeNumber zorunlu' });
        }
        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
        }
        const dislikeKey = { seriesId, seasonNumber, episodeNumber };
        const isDisliked = user.dislikes.some(dislike =>
            dislike.seriesId === seriesId &&
            dislike.seasonNumber === seasonNumber &&
            dislike.episodeNumber === episodeNumber
        );
        const isLiked = user.likes.some(like =>
            like.seriesId === seriesId &&
            like.seasonNumber === seasonNumber &&
            like.episodeNumber === episodeNumber
        );
        if (isDisliked) {
            user.dislikes = user.dislikes.filter(dislike =>
                !(dislike.seriesId === seriesId && dislike.seasonNumber === seasonNumber && dislike.episodeNumber === episodeNumber)
            );
        } else {
            user.dislikes.push(dislikeKey);
            if (isLiked) {
                user.likes = user.likes.filter(like =>
                    !(like.seriesId === seriesId && like.seasonNumber === seasonNumber && like.episodeNumber === episodeNumber)
                );
            }
        }
        await user.save();
        const totalLikes = await User.countDocuments({
            likes: +{ $elemMatch: { seriesId, seasonNumber, episodeNumber } }
        });
        const totalDislikes = await User.countDocuments({
            dislikes: { $elemMatch: { seriesId, seasonNumber, episodeNumber } }
        });
        res.json({
            isDisliked: !isDisliked,
            isLiked: false,
            likeCount: totalLikes,
            dislikeCount: totalDislikes
        });
    } catch (error) {
        console.error('Beğenmeme hatası:', error.message);
        res.status(500).json({ error: 'Beğenmeme işlemi sırasında bir hata oluştu' });
    }
});

// İzledim
app.post('/api/watched', authMiddleware, async (req, res) => {
    try {
        const { seriesId, seasonNumber, episodeNumber } = req.body;
        console.log('İzledim isteği:', { seriesId, seasonNumber, episodeNumber });
        if (!seriesId || !seasonNumber || !episodeNumber) {
            return res.status(400).json({ error: 'seriesId, seasonNumber ve episodeNumber zorunlu' });
        }
        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
        }
        const watchedKey = { seriesId, seasonNumber, episodeNumber };
        const isWatched = user.watched.some(w =>
            w.seriesId === seriesId &&
            w.seasonNumber === seasonNumber &&
            w.episodeNumber === episodeNumber
        );
        if (isWatched) {
            user.watched = user.watched.filter(w =>
                !(w.seriesId === seriesId && w.seasonNumber === seasonNumber && w.episodeNumber === episodeNumber)
            );
        } else {
            user.watched.push(watchedKey);
        }
        await user.save();
        res.json({ isWatched: !isWatched });
    } catch (error) {
        console.error('İzledim hatası:', error.message);
        res.status(500).json({ error: 'İzleme durumu güncellenirken bir hata oluştu' });
    }
});

// Durum Kontrol
app.get('/api/status/:seriesId/:seasonNumber/:episodeNumber', authMiddleware, async (req, res) => {
    try {
        const { seriesId, seasonNumber, episodeNumber } = req.params;
        const seasonNum = parseInt(seasonNumber);
        const episodeNum = parseInt(episodeNumber);
        console.log('Durum kontrol:', { seriesId, seasonNum, episodeNum });
        if (!seriesId || isNaN(seasonNum) || isNaN(episodeNum)) {
            return res.status(400).json({ error: 'Geçersiz seriesId, seasonNumber veya episodeNumber' });
        }
        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
        }
        const isLiked = user.likes.some(like =>
            like.seriesId === seriesId &&
            like.seasonNumber === seasonNum &&
            like.episodeNumber === episodeNum
        );
        const isDisliked = user.dislikes.some(dislike =>
            dislike.seriesId === seriesId &&
            dislike.seasonNumber === seasonNum &&
            dislike.episodeNumber === episodeNum
        );
        const isWatched = user.watched.some(w =>
            w.seriesId === seriesId &&
            w.seasonNumber === seasonNum &&
            w.episodeNumber === episodeNum
        );
        const totalLikes = await User.countDocuments({
            likes: { $elemMatch: { seriesId, seasonNumber: seasonNum, episodeNumber: episodeNum } }
        });
        const totalDislikes = await User.countDocuments({
            dislikes: { $elemMatch: { seriesId, seasonNumber: seasonNum, episodeNumber: episodeNum } }
        });
        res.json({
            isLiked,
            isDisliked,
            isWatched,
            likeCount: totalLikes,
            dislikeCount: totalDislikes
        });
    } catch (error) {
        console.error('Durum kontrol hatası:', error.message);
        res.status(500).json({ error: 'Durum kontrolü sırasında bir hata oluştu' });
    }
});

// Genel Durum Kontrol
app.get('/api/public/status/:seriesId/:seasonNumber/:episodeNumber', async (req, res) => {
    try {
        const { seriesId, seasonNumber, episodeNumber } = req.params;
        const seasonNum = parseInt(seasonNumber);
        const episodeNum = parseInt(episodeNumber);
        console.log('Genel durum kontrol:', { seriesId, seasonNum, episodeNum });
        if (!seriesId || isNaN(seasonNum) || isNaN(episodeNum)) {
            return res.status(400).json({ error: 'Geçersiz seriesId, seasonNumber veya episodeNumber' });
        }
        const totalLikes = await User.countDocuments({
            likes: { $elemMatch: { seriesId, seasonNumber: seasonNum, episodeNumber: episodeNum } }
        });
        const totalDislikes = await User.countDocuments({
            dislikes: { $elemMatch: { seriesId, seasonNumber: seasonNum, episodeNumber: episodeNum } }
        });
        res.json({
            likeCount: totalLikes,
            dislikeCount: totalDislikes
        });
    } catch (error) {
        console.error('Genel durum kontrol hatası:', error.message);
        res.status(500).json({ error: 'Genel durum kontrolü sırasında bir hata oluştu' });
    }
});

// Token Doğrulama
app.get('/api/verify-token', authMiddleware, async (req, res) => {
    try {
        console.log('Token doğrulama isteği:', req.user.username);
        res.json({ success: true, username: req.user.username, userId: req.user.userId });
    } catch (error) {
        console.error('Token doğrulama hatası:', error.message);
        res.status(500).json({ error: 'Token doğrulama işlemi sırasında bir hata oluştu' });
    }
});

// Sunucu Başlatma
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor`);
});
// SEO dostu dizi yönlendirmesi
app.get('/dizi/:id/sezon-:season/bolum-:episode', (req, res) => {
    res.sendFile(path.join(__dirname, '../dizi.html'));
});
app.get('/film/:id', (req, res) => {
    res.sendFile(path.join(__dirname, '../film.html'));
});
app.get(['/', '/index.html'], (req, res) => {
    res.redirect(301, '/anasayfa');
});