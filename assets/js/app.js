
/* =====================================================
   HYLOOKS v1.2
   Homepage Renderer - Newest Videos First
   ===================================================== */

const grid = document.getElementById("videoGrid");
const loading = document.getElementById("loadingGrid");
const template = document.getElementById("videoTemplate");

let VIDEO_DATABASE = [];
let FILTERED_DATABASE = [];

/* ================= SORT VIDEOS ================= */

function sortNewestFirst(videos) {
    return [...videos].sort((a, b) => {
        const numA = Number(String(a.id).match(/\d+/)?.[0] || 0);
        const numB = Number(String(b.id).match(/\d+/)?.[0] || 0);
        return numB - numA;
    });
}

/* ================= LOAD DATABASE ================= */

async function loadVideos() {
    try {
        const response = await fetch("assets/data/videos.json", {
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error("videos.json not found");
        }

        const data = await response.json();

        VIDEO_DATABASE = sortNewestFirst(data.videos || []);
        FILTERED_DATABASE = [...VIDEO_DATABASE];

        renderVideos(FILTERED_DATABASE);

    } catch (err) {
        console.error(err);

        loading.style.display = "none";

        grid.innerHTML = `
            <div class="empty-state">
                <p>Failed to load videos.</p>
            </div>
        `;
    }
}

/* ================= RENDER ================= */

function renderVideos(list) {
    loading.style.display = "none";
    grid.innerHTML = "";

    if (!list.length) {
        grid.innerHTML = `
            <div class="empty-state">
                <p>No videos found.</p>
            </div>
        `;
        return;
    }

    list.forEach(video => {
        const clone = template.content.cloneNode(true);

        clone.querySelector(".thumb").src = video.thumb;
        clone.querySelector(".thumb").alt = video.title;
        clone.querySelector(".duration").textContent = video.duration;
        clone.querySelector(".title").textContent = video.title;
        clone.querySelector(".views").textContent = `${video.views} Views`;

        clone.querySelector(".video-link").href =
            `watch.html?id=${encodeURIComponent(video.id)}`;

        grid.appendChild(clone);
    });
}

/* ================= SEARCH SUPPORT ================= */

window.filterVideos = function(keyword) {
    keyword = keyword.trim().toLowerCase();

    if (!keyword) {
        FILTERED_DATABASE = [...VIDEO_DATABASE];
    } else {
        FILTERED_DATABASE = VIDEO_DATABASE.filter(video =>
            video.title.toLowerCase().includes(keyword)
        );
    }

    renderVideos(FILTERED_DATABASE);
};

/* ================= INIT ================= */

loadVideos();
