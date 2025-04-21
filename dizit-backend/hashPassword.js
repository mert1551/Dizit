const bcrypt = require('bcryptjs');

const password = 'ahmet1551'; // Buraya kendi parolanı yaz
bcrypt.hash(password, 10, (err, hash) => {
  if (err) {
    console.error('Hata:', err);
    return;
  }
  console.log('Şifrelenmiş parola:', hash);
});