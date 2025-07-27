// update-normalized-fields.js
const mongoose = require('mongoose');
const Movie = require('./models/Movie'); // Model dosyan neredeyse onu buraya yaz
const dotenv = require('dotenv');

dotenv.config(); // Aynı dizindeyse, path belirtmene gerek yok
 // .env dosyası varsa bağlantı için

function normalizeTurkish(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u')
    .replace(/\s+/g, ' ')
    .trim();
}

async function updateMovies() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/dizit', {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });

  const movies = await Movie.find({});
  console.log(`Toplam ${movies.length} film bulundu.`);

  for (let movie of movies) {
    movie.title_normalized = normalizeTurkish(movie.title || '');
    movie.title2_normalized = normalizeTurkish(movie.title2 || '');
    await movie.save();
    console.log(`Güncellendi: ${movie.title}`);
  }

  console.log("Tüm filmler güncellendi.");
  process.exit();
}

updateMovies().catch(err => {
  console.error("Hata oluştu:", err);
  process.exit(1);
});
