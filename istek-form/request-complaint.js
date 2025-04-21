document.addEventListener('DOMContentLoaded', () => {
    // Form işlevselliği
    const form = document.getElementById('request-complaint-form');
    const formMessage = document.getElementById('form-message');

    if (!form || !formMessage) {
        console.error('Form veya form mesajı elementi bulunamadı.');
        return;
    }

    form.addEventListener('submit', (e) => {
        e.preventDefault();

        const formType = document.getElementById('form-type').value;
        const name = document.getElementById('name').value.trim();
        const email = document.getElementById('email').value.trim();
        const title = document.getElementById('title').value.trim();
        const message = document.getElementById('message').value.trim();

        // Basit doğrulama
        if (!formType || !email || !title || !message) {
            formMessage.textContent = 'Lütfen tüm zorunlu alanları doldurun.';
            formMessage.className = 'form-message error';
            return;
        }

        if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) {
            formMessage.textContent = 'Lütfen geçerli bir e-posta adresi girin.';
            formMessage.className = 'form-message error';
            return;
        }

        // Form verilerini gönderme simülasyonu
        formMessage.textContent = 'Mesajınız başarıyla gönderildi! En kısa sürede size geri döneceğiz.';
        formMessage.className = 'form-message success';

        // Formu sıfırlama
        form.reset();
    });

    // Burger menü kontrolü
    const burgerMenu = document.getElementById('burger-menu');
    const navContainer = document.getElementById('nav-container');

    if (burgerMenu && navContainer) {
        burgerMenu.addEventListener('click', () => {
            navContainer.classList.toggle('active');
        });
    }

    // Auth modal fonksiyonu (index.html ile uyumlu)
    window.openAuthModal = function(type = 'login') {
        alert(type === 'login' ? 'Giriş yapma modalı açılacak.' : 'Üye olma modalı açılacak.');
    };
});