//  // Arama overlay kontrolü
//  const searchInput = document.getElementById('search-input');
//  const searchOverlayInput = document.getElementById('search-overlay-input');
//  const searchOverlay = document.getElementById('search-overlay');
//  const closeOverlayBtn = document.getElementById('close-overlay');

//  searchInput.addEventListener('focus', () => {
//      searchOverlay.classList.add('active');
//      searchOverlayInput.focus();
//      searchOverlayInput.value = searchInput.value;
//  });

//  searchOverlayInput.addEventListener('input', () => {
//      const searchTerm = searchOverlayInput.value.trim().toLowerCase();
//      if (searchTerm === '') {
//          displaySearchResults([]);
//      } else {
//          const filteredMovies = movies.filter(movie => 
//              movie.title.toLowerCase().includes(searchTerm)
//          );
//          displaySearchResults(filteredMovies);
//      }
//  });

//  closeOverlayBtn.addEventListener('click', () => {
//      searchOverlay.classList.remove('active');
//      searchInput.value = '';
//      searchOverlayInput.value = '';
//  });