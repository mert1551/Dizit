document.addEventListener('DOMContentLoaded', async () => {
    // API_URL'yi global olarak tanımla
    let API_URL = 'http://localhost:3000'; // Varsayılan değer, config'den güncellenecek

    // API_URL'yi çekme fonksiyonu
    async function fetchApiUrl() {
        try {
            const response = await fetch('/api/config');
            const data = await response.json();
            API_URL = data.apiUrl;
            console.log('API_URL fetched:', API_URL);
        } catch (error) {
            console.error('API_URL alınırken hata:', error);
            // Hata durumunda varsayılan URL kullanılacak
        }
    }

    // API_URL'yi sayfa yüklenirken çek
    await fetchApiUrl();

    // DOM Elemanları
    const searchInput = document.getElementById('search-input');
    const searchOverlayInput = document.getElementById('search-overlay-input');
    const searchOverlay = document.getElementById('search-overlay');
    const closeOverlayBtn = document.getElementById('close-overlay');
    const searchResultsGrid = document.getElementById('search-results-grid');
    const totalResults = document.getElementById('total-results');
    const currentPageSpan = document.getElementById('current-page');
    const totalPagesSpan = document.getElementById('total-pages');
    const prevPageBtn = document.getElementById('prev-page');
    const nextPageBtn = document.getElementById('next-page');
    const yearSelect = document.getElementById('year');
    const genreSelect = document.getElementById('genre');
    const sortSelect = document.getElementById('sort');
    const dublajCheckbox = document.getElementById('dublaj');
    const altyaziCheckbox = document.getElementById('altyazi');
    const yerliCheckbox = document.getElementById('yerli');
    const typeSelect = document.getElementById('type');
    const searchButton = document.getElementById('search-button');
    const resetButton = document.getElementById('reset-button');
    const burgerMenu = document.getElementById('burger-menu');
    const navContainer = document.getElementById('nav-container');
    const activeFilters = document.getElementById('active-filters');

    // Sayfalama Değişkenleri
    const itemsPerPage = 18;
    let currentPage = 1;
    let filteredContent = [];

    // Veritabanından veri çekme
    async function fetchMovies(filters = {}) {
        try {
            const queryParams = new URLSearchParams();
    
            if (filters.type) queryParams.append('type', filters.type);
            if (filters.year) queryParams.append('year', filters.year);
            if (filters.genres && filters.genres.length > 0) {
                queryParams.append('genres', filters.genres.join(','));
            }
            const languages = [];
            if (filters.dublaj) languages.push('Türkçe Dublaj');
            if (filters.altyazi) languages.push('Türkçe Altyazı');
            if (filters.yerli) languages.push('Yerli');
            if (languages.length > 0) {
                queryParams.append('language', languages.join(','));
            }
            if (filters.sort) queryParams.append('sort', filters.sort);
    
            console.log('Gönderilen sorgu:', queryParams.toString());
    
            const response = await fetch(`${API_URL}/api/movies?${queryParams.toString()}`);
            if (!response.ok) throw new Error(`HTTP hatası: ${response.status}`);
            const movies = await response.json();
            console.log('Dönen içerik:', {
                total: movies.length,
                years: movies.map(m => m.year),
                sample: movies.slice(0, 5)
            });
            // 2000 öncesi filtresi için doğrulama
            if (filters.year === 'before-2000') {
                const invalidMovies = movies.filter(m => m.year > 2000);
                if (invalidMovies.length > 0) {
                    console.warn('HATA: 2000 sonrası içerikler alındı:', invalidMovies.map(m => ({ id: m.id, title: m.title, year: m.year })));
                    // 2000 sonrası içerikleri filtrele
                    return movies.filter(m => m.year <= 2000);
                }
            }
            return movies;
        } catch (error) {
            console.error('Veri çekme hatası:', error);
            return [];
        }
    }

    // Arama Overlay için veri çekme
    async function fetchSearchResults(query) {
        try {
            const response = await fetch(`${API_URL}/api/search?q=${encodeURIComponent(query)}`);
            if (!response.ok) throw new Error('Arama hatası');
            const results = await response.json();
            return results;
        } catch (error) {
            console.error('Arama hatası:', error);
            return [];
        }
    }

    // Aktif filtreleri gösterme
    function updateActiveFilters(filters) {
        activeFilters.innerHTML = `<span class="total-results" id="total-results">${filteredContent.length} film veya dizi bulundu</span>`;
        
        if (filters.type) {
            const tag = document.createElement('span');
            tag.className = 'filter-tag';
            tag.innerHTML = `İçerik: ${filters.type === 'film' ? 'Film' : 'Dizi'} <i class="fas fa-times" data-filter="type"></i>`;
            activeFilters.appendChild(tag);
        }
        if (filters.year) {
            const tag = document.createElement('span');
            tag.className = 'filter-tag';
            tag.innerHTML = `Yıl: ${filters.year === 'before-2000' ? '2000 ve Öncesi' : filters.year} <i class="fas fa-times" data-filter="year"></i>`;
            activeFilters.appendChild(tag);
        }
        if (filters.genres && filters.genres.length > 0) {
            filters.genres.forEach(genre => {
                const tag = document.createElement('span');
                tag.className = 'filter-tag';
                tag.innerHTML = `Tür: ${genre} <i class="fas fa-times" data-filter="genre" data-value="${genre}"></i>`;
                activeFilters.appendChild(tag);
            });
        }
        if (filters.dublaj) {
            const tag = document.createElement('span');
            tag.className = 'filter-tag';
            tag.innerHTML = `Dil: Türkçe Dublaj <i class="fas fa-times" data-filter="dublaj"></i>`;
            activeFilters.appendChild(tag);
        }
        if (filters.altyazi) {
            const tag = document.createElement('span');
            tag.className = 'filter-tag';
            tag.innerHTML = `Dil: Türkçe Altyazı <i class="fas fa-times" data-filter="altyazi"></i>`;
            activeFilters.appendChild(tag);
        }
        if (filters.yerli) {
            const tag = document.createElement('span');
            tag.className = 'filter-tag';
            tag.innerHTML = `Dil: Yerli <i class="fas fa-times" data-filter="yerli"></i>`;
            activeFilters.appendChild(tag);
        }

        // Filtre kaldırma olayları
        activeFilters.querySelectorAll('.filter-tag i').forEach(icon => {
            icon.addEventListener('click', (e) => {
                const filterType = e.target.dataset.filter;
                const filterValue = e.target.dataset.value;
                if (filterType === 'type') typeSelect.value = '';
                if (filterType === 'year') yearSelect.value = '';
                if (filterType === 'genre') {
                    const options = Array.from(genreSelect.selectedOptions);
                    genreSelect.value = options.filter(opt => opt.value !== filterValue).map(opt => opt.value);
                }
                if (filterType === 'dublaj') dublajCheckbox.checked = false;
                if (filterType === 'altyazi') altyaziCheckbox.checked = false;
                if (filterType === 'yerli') yerliCheckbox.checked = false;
                performSearch();
            });
        });
    }

    // Filtreleme ve sıralama için filtre objesi oluştur
    function getFilters() {
        const sort = sortSelect.value;
        let sortParam = '';
        switch (sort) {
            case 'year-desc':
                sortParam = '-year';
                break;
            case 'year-asc':
                sortParam = 'year';
                break;
            case 'rating-desc':
                sortParam = '-rating';
                break;
            case 'rating-asc':
                sortParam = 'rating';
                break;
            case 'title-asc':
                sortParam = 'title';
                break;
            case 'title-desc':
                sortParam = '-title';
                break;
        }

        const selectedGenres = Array.from(genreSelect.selectedOptions)
            .map(option => option.value)
            .filter(val => val);

        return {
            type: typeSelect.value,
            year: yearSelect.value,
            genres: selectedGenres,
            dublaj: dublajCheckbox.checked,
            altyazi: altyaziCheckbox.checked,
            yerli: yerliCheckbox.checked,
            sort: sortParam
        };
    }

    // Sonuçları Gösterme
    function displayContent(contentList, page) {
        searchResultsGrid.innerHTML = '';
        const start = (page - 1) * itemsPerPage;
        const end = start + itemsPerPage;
        const paginatedContent = contentList.slice(start, end);
    
        if (paginatedContent.length === 0) {
            searchResultsGrid.innerHTML = `
                <div class="no-results">
                    <i class="fas fa-film"></i>
                    <p>Aradığınız kriterlere uygun film veya dizi bulunamadı.</p>
                </div>
            `;
        } else {
            if (yearSelect.value === 'before-2000') {
                const invalidMovies = paginatedContent.filter(item => item.year > 2000);
                if (invalidMovies.length > 0) {
                    console.warn('HATA: 2000 sonrası içerikler görüntüleniyor:', invalidMovies.map(m => ({ id: m.id, title: m.title, year: m.year })));
                }
            }
            paginatedContent.forEach(item => {
                if (yearSelect.value === 'before-2000' && item.year > 2000) {
                    return; // 2000 sonrası içerikleri gösterme
                }
                const contentCard = document.createElement('div');
                contentCard.className = 'movie-card';
                let languageBadge = '';
                const hasDublaj = item.language.includes("Türkçe Dublaj");
                const hasAltyazi = item.language.includes("Türkçe Altyazı");
                const isYerli = item.language.includes("Yerli");
                if (isYerli) {
                    languageBadge = `
                        <span class="language-badge">
                            <img src="../resim/flag-tr.png" alt="TR" class="flag-icon"> Yerli
                        </span>
                    `;
                } else if (hasDublaj && hasAltyazi) {
                    languageBadge = `
                        <span class="language-badge">
                            <img src="../resim/flag-tr.png" alt="TR" class="flag-icon"> Dublaj
                            <i class="fas fa-closed-captioning"></i> Altyazı
                        </span>
                    `;
                } else if (hasDublaj) {
                    languageBadge = `
                        <span class="language-badge">
                            <img src="../resim/flag-tr.png" alt="TR" class="flag-icon"> Dublaj
                        </span>
                    `;
                } else if (hasAltyazi) {
                    languageBadge = `
                        <span class="language-badge">
                            <i class="fas fa-closed-captioning"></i> Altyazı
                        </span>
                    `;
                }
                contentCard.innerHTML = `
                    <div class="poster-wrapper">
                        <img src="${item.poster}" alt="${item.title}" class="movie-poster">
                        ${languageBadge}
                    </div>
                    <div class="movie-info">
                        <h3 class="movie-title">${item.title}${item.title2 ? ` <span class="search-title2">(${item.title2})</span>` : ''}</h3>
                        <div class="movie-meta">
                            <span>${item.year}</span>
                            <span class="rating"><i class="fas fa-star"></i> ${item.rating}</span>
                        </div>
                    </div>
                `;
                contentCard.onclick = () => window.location.href = item.type === "dizi" ? `../dizi.html?id=${item.id}` : `../film.html?id=${item.id}`;
                searchResultsGrid.appendChild(contentCard);
            });
        }
    
        const totalItems = contentList.length;
        const totalPages = Math.ceil(totalItems / itemsPerPage);
        totalResults.textContent = `${totalItems} film veya dizi bulundu`;
        currentPageSpan.textContent = page;
        totalPagesSpan.textContent = totalPages;
    
        prevPageBtn.disabled = page === 1;
        nextPageBtn.disabled = page === totalPages;
    }

    // Arama Overlay Sonuçları
    function displaySearchOverlayResults(results) {
        const searchResults = document.getElementById('search-results');
        searchResults.innerHTML = '';
        if (results.length === 0) {
            searchResults.innerHTML = '<p>Sonuç bulunamadı.</p>';
            return;
        }
        results.forEach(item => {
            const resultItem = document.createElement('div');
            resultItem.className = 'search-result-item';
            resultItem.innerHTML = `
                <img src="${item.poster}" alt="${item.title}" class="search-result-poster">
                <span>${item.title}${item.title2 ? ` <span class="search-title2">(${item.title2})</span>` : ''} (${item.year})</span>
            `;
            resultItem.onclick = () => window.location.href = item.type === "dizi" ? `../dizi.html?id=${item.id}` : `../film.html?id=${item.id}`;
            searchResults.appendChild(resultItem);
        });
    }

    // Arama ve Sayfalama Kontrolleri
    async function performSearch() {
        const filters = getFilters();
        console.log('Uygulanan filtreler:', filters); // Hata ayıklama için
        filteredContent = await fetchMovies(filters);
        currentPage = 1;
        displayContent(filteredContent, currentPage);
        updateActiveFilters(filters);
    }

    searchButton.addEventListener('click', performSearch);

    resetButton.addEventListener('click', () => {
        yearSelect.value = '';
        genreSelect.value = '';
        sortSelect.value = 'year-desc';
        dublajCheckbox.checked = false;
        altyaziCheckbox.checked = false;
        yerliCheckbox.checked = false;
        typeSelect.value = '';
        performSearch();
    });

    prevPageBtn.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            displayContent(filteredContent, currentPage);
        }
    });

    nextPageBtn.addEventListener('click', () => {
        const totalPages = Math.ceil(filteredContent.length / itemsPerPage);
        if (currentPage < totalPages) {
            currentPage++;
            displayContent(filteredContent, currentPage);
        }
    });

    // Arama Overlay Kontrolleri
    searchInput.addEventListener('focus', () => {
        searchOverlay.classList.add('active');
        searchOverlayInput.focus();
        searchOverlayInput.value = searchInput.value;
    });

    searchOverlayInput.addEventListener('input', async () => {
        const searchTerm = searchOverlayInput.value.trim().toLowerCase();
        if (searchTerm === '') {
            displaySearchOverlayResults([]);
        } else {
            const results = await fetchSearchResults(searchTerm);
            displaySearchOverlayResults(results);
        }
    });

    closeOverlayBtn.addEventListener('click', () => {
        searchOverlay.classList.remove('active');
        searchInput.value = '';
        searchOverlayInput.value = '';
    });

    // Burger Menü Kontrolü
    burgerMenu.addEventListener('click', () => {
        navContainer.classList.toggle('active');
    });

    // İlk Yükleme
    performSearch();
});

// Auth Modal (Örnek)
function openAuthModal(type = 'login') {
    alert(type === 'login' ? 'Giriş yapma modalı açılacak.' : 'Üye olma modalı açılacak.');
}
