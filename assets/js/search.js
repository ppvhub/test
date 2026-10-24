/* =====================================================
   HYLOOKS v1.1 FINAL PRODUCTION
   Search (MASTER LOCKED)
   ===================================================== */

const searchInput = document.getElementById("searchInput");

let debounceTimer = null;

/* ================= SEARCH ================= */

function handleSearch(value) {

    if (typeof window.filterVideos === "function") {
        window.filterVideos(value);
    }

}

/* ================= DEBOUNCE ================= */

searchInput.addEventListener("input", e => {

    clearTimeout(debounceTimer);

    const keyword = e.target.value;

    debounceTimer = setTimeout(() => {
        handleSearch(keyword);
    }, 180);

});

/* ================= ESC CLEAR ================= */

searchInput.addEventListener("keydown", e => {

    if (e.key === "Escape") {

        searchInput.value = "";

        handleSearch("");

        searchInput.blur();

    }

});

/* ================= FOCUS SHORTCUT ================= */

document.addEventListener("keydown", e => {

    // Tekan "/" untuk fokus ke search
    if (e.key === "/" && document.activeElement !== searchInput) {

        e.preventDefault();

        searchInput.focus();

    }

});