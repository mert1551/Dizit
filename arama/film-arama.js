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
    const activeFilters = document.getElementById('active-filters');
    const yearSelect = document.getElementById('year');
    const sortSelect = document.getElementById('sort');
    const dublajCheckbox = document.getElementById('dublaj');
    const altyaziCheckbox = document.getElementById('altyazi');
    const yerliCheckbox = document.getElementById('yerli');
    const typeSelect = document.getElementById('type');
    const searchButton = document.getElementById('search-button');
    const resetButton = document.getElementById('reset-button');
    const burgerMenu = document.getElementById('burger-menu');
    const navContainer = document.getElementById('nav-container');
    const exxenCheckbox = document.getElementById('platform-exxen');
    const gainCheckbox = document.getElementById('platform-gain');
    const blutvCheckbox = document.getElementById('platform-blutv');
    const disneyCheckbox = document.getElementById('platform-disney');
    const tabiCheckbox = document.getElementById('platform-tabii');
    const todCheckbox = document.getElementById('platform-tod');
    const loadingIndicator = document.getElementById('loading-indicator');
    const endOfContentMessage = document.getElementById('end-of-content-message');

    // Sonsuz kaydırma değişkenleri
    const itemsPerPage = 12;
    let currentPage = 1;
    let filteredContent = [];
    let isLoading = false;
    let hasMore = true;

    // Veritabanından veri çekme
   async function fetchMovies(filters = {}, page = 1, append = false) {
    if (isLoading || !hasMore) return;

    // Göstergeleri yönet
    const loadingIndicator = document.getElementById('loading-indicator');
    const endOfContentMessage = document.getElementById('end-of-content-message');

    loadingIndicator.style.display = 'block';
    endOfContentMessage.style.display = 'none';

    isLoading = true;
    try {
        const queryParams = new URLSearchParams();
        queryParams.append('page', page);
        queryParams.append('limit', itemsPerPage);

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

        const response = await fetch(`${API_URL}/api/all-movies?${queryParams.toString()}`);
        if (!response.ok) throw new Error(`HTTP hatası: ${response.status}`);
        const data = await response.json();
        console.log('Dönen içerik:', {
            total: data.total,
            currentPage: data.currentPage,
            totalPages: data.totalPages,
            results: data.results.slice(0, 5)
        });

        // 2000 öncesi filtresi
        if (filters.year === 'before-2000') {
            const invalidMovies = data.results.filter(m => m.year > 2000);
            if (invalidMovies.length > 0) {
                console.warn('HATA: 2000 sonrası içerikler alındı:', invalidMovies.map(m => ({ id: m.id, title: m.title, year: m.year })));
                data.results = data.results.filter(m => m.year <= 2000);
            }
        }

        if (!append) {
            filteredContent = data.results;
        } else {
            filteredContent = [...filteredContent, ...data.results];
        }

        hasMore = data.currentPage < data.totalPages;

        displayContent(data.results, append);
        updateActiveFilters(filters, data.total);
    } catch (error) {
        console.error('Veri çekme hatası:', error);
        hasMore = false;
    } finally {
        isLoading = false;
        loadingIndicator.style.display = 'none';

        // Eğer daha fazla içerik yoksa "tüm içerikler gösterildi" mesajını göster
        if (!hasMore) {
            endOfContentMessage.style.display = 'block';
        }
    }
}


const platformCheckboxes = document.querySelectorAll('input[name="platform"]');

platformCheckboxes.forEach(checkbox => {
    checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
            platformCheckboxes.forEach(other => {
                if (other !== checkbox) other.checked = false;
            });
        }
    });
});


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
    function updateActiveFilters(filters, totalItems) {
        activeFilters.innerHTML = `<span class="total-results" id="total-results">${totalItems} film veya dizi bulundu</span>`;

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
                const label = ['Exxen', 'Gain', 'BluTV', 'Disney+', 'Tabii', 'Tod'].includes(genre) ? 'Platform' : 'Tür';
                tag.innerHTML = `${label}: ${genre} <i class="fas fa-times" data-filter="${label.toLowerCase()}" data-value="${genre}"></i>`;
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
                if (filterType === 'tür') {
                    const checkbox = document.getElementById(`genre-${filterValue.toLowerCase().replace(' ', '-')}`);
                    if (checkbox) checkbox.checked = false;
                }
                if (filterType === 'platform') {
                    const checkbox = document.getElementById(`platform-${filterValue.toLowerCase().replace('+', '').replace(' ', '-')}`);
                    if (checkbox) checkbox.checked = false;
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

        const selectedGenres = Array.from(document.querySelectorAll('input[name="genre"]:checked')).map(checkbox => checkbox.value);
        const selectedPlatforms = Array.from(document.querySelectorAll('input[name="platform"]:checked')).map(checkbox => checkbox.value);
        const allGenres = [...selectedGenres, ...selectedPlatforms];

        return {
            type: typeSelect.value,
            year: yearSelect.value,
            genres: allGenres,
            dublaj: dublajCheckbox.checked,
            altyazi: altyaziCheckbox.checked,
            yerli: yerliCheckbox.checked,
            sort: sortParam
        };
    }

    // Sonuçları Gösterme
    function displayContent(contentList, append = false) {
    const searchResultsGrid = document.getElementById('search-results-grid');
    const searchResultsContainer = document.querySelector('.search-results-container');
    const existingNoResults = searchResultsContainer.querySelector('.no-results');
    if (existingNoResults) existingNoResults.remove();

    // Eğer içerik yoksa mesaj göster
    if (!contentList.length) {
        const noResultsDiv = document.createElement('div');
        noResultsDiv.className = 'no-results';
        noResultsDiv.innerHTML = `
            <i class="fas fa-film"></i>
            <p>Aradığınız kriterlere uygun film veya dizi bulunamadı.</p>
        `;
        searchResultsContainer.appendChild(noResultsDiv);
        return;
    }

    // Eğer append değilse temizle
    if (!append) {
        searchResultsGrid.innerHTML = '';
    }

    // Mevcut içeriklerin id'lerini al
    const existingIds = new Set(
        Array.from(searchResultsGrid.children).map(el => el.dataset.id)
    );

    contentList.forEach(item => {
        if (existingIds.has(String(item.id))) return;
        if (yearSelect.value === 'before-2000' && item.year > 2000) return;

        const contentCard = document.createElement('div');
        contentCard.className = 'movie-card';
        contentCard.dataset.id = item.id;

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
                <h3 class="movie-title">${item.title}</h3>
                <div class="movie-meta">
                    <span>${item.year}</span>
                    <div class="imdb-rating">
                        <i class="fas fa-star"></i> ${item.rating}
                    </div>
                </div>
            </div>
        `;
        contentCard.onclick = () => window.location.href = item.type === "dizi"
            ? `../dizi.html?id=${item.id}`
            : `../film.html?id=${item.id}`;
        searchResultsGrid.appendChild(contentCard);
    });
}


    // Arama Overlay Sonuçları
    function displaySearchOverlayResults(results) {
        const searchResults = document.getElementById('search-results');
        searchResults.innerHTML = '';
        if (results.length === 0) {
            searchResults.innerHTML = '<p style="color: var(--text-secondary, #b3b3b3); text-align: center;">Sonuç bulunamadı.</p>';
            return;
        }
        results.forEach(item => {
            const resultItem = document.createElement('div');
            resultItem.className = 'search-result-item';
            resultItem.innerHTML = `
                <img src="${item.poster || 'https://via.placeholder.com/150'}" alt="${item.title}" class="search-result-poster">
                <div class="search-result-info">
                    <div class="search-result-title">
                        ${item.title || 'Bilinmeyen İçerik'}
                        ${item.title2 ? `<span class="search-result-title2">(${item.title2})</span>` : ''}
                    </div>
                    <div class="search-result-year">${item.year || 'N/A'}</div>
                    <div class="search-result-genres">${Array.isArray(item.genres) ? item.genres.join(', ') : 'N/A'}</div>
                </div>
            `;
            resultItem.onclick = () => window.location.href = item.type === "dizi" ? `../dizi.html?id=${item.id}` : `../film.html?id=${item.id}`;
            searchResults.appendChild(resultItem);
        });
    }

    // Arama ve Sonsuz Kaydırma Kontrolleri
    async function performSearch() {
        currentPage = 1;
        hasMore = true;
        searchResultsGrid.innerHTML = '';
        const filters = getFilters();
        console.log('Uygulanan filtreler:', filters);
        await fetchMovies(filters, currentPage);
    }

    searchButton.addEventListener('click', performSearch);

    resetButton.addEventListener('click', () => {
        yearSelect.value = '';
        document.querySelectorAll('input[name="genre"]:checked').forEach(cb => cb.checked = false);
        document.querySelectorAll('input[name="platform"]:checked').forEach(cb => cb.checked = false);
        sortSelect.value = 'year-desc';
        dublajCheckbox.checked = false;
        altyaziCheckbox.checked = false;
        yerliCheckbox.checked = false;
        typeSelect.value = '';
        performSearch();
    });

    // Sonsuz kaydırma için olay dinleyici
    window.addEventListener('scroll', async () => {
        if (isLoading || !hasMore) return;

        const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
        if (scrollTop + clientHeight >= scrollHeight - 100) {
            currentPage++;
            const filters = getFilters();
            await fetchMovies(filters, currentPage, true);
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

// Auth Modal
function openAuthModal(type = 'login') {
    const modal = document.getElementById('auth-modal');
    modal.classList.add('active');
    switchTab(type);
}