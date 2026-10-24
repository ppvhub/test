/* HyLooks CMS - GitHub Pages compatible controller */
const form = document.getElementById("videoForm");
const titleInput = document.getElementById("title");
const urlInput = document.getElementById("videyUrl"); // menerima direct MP4 URL dari domain HTTPS mana pun
const viewsInput = document.getElementById("views");
const durationInput = document.getElementById("duration");
const thumbInput = document.getElementById("thumbnail");
const cmsPasswordInput = document.getElementById("cmsPassword");
const preview = document.getElementById("thumbPreview");
const output = document.getElementById("jsonOutput");
const copyBtn = document.getElementById("copyJson");
const downloadBtn = document.getElementById("downloadJson");
const videoList = document.getElementById("videoList");

let database = [];
let thumbnailFile = null;
let isSaving = false;
// Password hanya disimpan di memori halaman; akan hilang saat halaman ditutup/dimuat ulang.
let cmsSessionPassword = "";
const API_URL = String(window.HYLOOKS_CMS_API || "").trim().replace(/\/$/, "");

function setStatus(message) {
  let status = document.getElementById("cmsStatus");
  if (!status) {
    status = document.createElement("p");
    status.id = "cmsStatus";
    status.setAttribute("role", "status");
    status.style.cssText = "margin:12px 0;padding:10px;border-radius:8px;overflow-wrap:anywhere;";
    form.appendChild(status);
  }
  status.textContent = message;
}

function requireAPI() {
  if (!API_URL || API_URL.includes("YOUR-WORKER")) {
    throw new Error("Endpoint CMS belum dikonfigurasi. Atur HYLOOKS_CMS_API di assets/js/cms-config.js setelah Worker dipasang.");
  }
  return API_URL;
}

async function loadDatabase() {
  try {
    const res = await fetch("assets/data/videos.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    database = Array.isArray(json.videos) ? json.videos : [];
    window.hylooksJSON = {
      version: json.version || "1.3",
      updated: json.updated || new Date().toISOString(),
      videos: database
    };
    renderDatabase();
  } catch (err) {
    database = [];
    window.hylooksJSON = { version: "1.3", updated: new Date().toISOString(), videos: [] };
    renderDatabase();
    setStatus(`Gagal memuat videos.json: ${err.message}`);
  }
}

function randomViews() {
  const count = Math.floor(Math.random() * (900000 - 50000 + 1)) + 50000;
  viewsInput.value = `${(count / 1000).toFixed(1)}K`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
}

let durationRequest = 0;
let durationTimer = null;
urlInput.addEventListener("change", readVideoDuration);
urlInput.addEventListener("blur", readVideoDuration);

function readVideoDuration() {
  const url = urlInput.value.trim();
  const requestId = ++durationRequest;
  if (durationTimer) clearTimeout(durationTimer);

  if (!url) {
    durationInput.placeholder = "Isi durasi manual jika diperlukan (mm:ss)";
    return;
  }

  let parsed;
  try { parsed = new URL(url); } catch (_) {
    durationInput.placeholder = "URL tidak valid; isi durasi manual";
    return;
  }

  if (parsed.protocol !== "https:" || !parsed.pathname.toLowerCase().endsWith(".mp4")) {
    durationInput.placeholder = "URL bukan MP4 langsung; isi durasi manual";
    return;
  }

  durationInput.placeholder = "Mencoba membaca durasi... atau isi manual";
  const probe = document.createElement("video");
  probe.preload = "metadata";
  probe.muted = true;

  const cleanup = () => {
    probe.onloadedmetadata = null;
    probe.onerror = null;
    probe.removeAttribute("src");
    probe.load();
  };

  durationTimer = setTimeout(() => {
    if (requestId !== durationRequest) return;
    durationInput.placeholder = "Deteksi timeout; isi durasi manual (mm:ss)";
    cleanup();
  }, 12000);

  probe.onloadedmetadata = () => {
    if (requestId !== durationRequest) { cleanup(); return; }
    clearTimeout(durationTimer);
    const detected = formatDuration(probe.duration);
    if (detected && !durationInput.dataset.manual) {
      durationInput.value = detected;
      durationInput.dataset.manual = "";
      durationInput.placeholder = "Durasi terdeteksi otomatis";
    } else if (!detected) {
      durationInput.placeholder = "Durasi tidak tersedia; isi manual (mm:ss)";
    }
    cleanup();
  };

  probe.onerror = () => {
    if (requestId !== durationRequest) return;
    clearTimeout(durationTimer);
    durationInput.placeholder = "Metadata gagal dibaca; isi durasi manual (mm:ss)";
    setStatus("Durasi otomatis gagal dibaca. Kamu bisa mengisi durasi secara manual, misalnya 12:35.");
    cleanup();
  };

  probe.src = url;
  probe.load();
}

durationInput.addEventListener("input", () => {
  durationInput.dataset.manual = durationInput.value ? "1" : "";
});

cmsPasswordInput.addEventListener("input", () => {
  cmsSessionPassword = cmsPasswordInput.value;
});

randomViews();

thumbInput.addEventListener("change", () => {
  thumbnailFile = thumbInput.files && thumbInput.files[0] ? thumbInput.files[0] : null;
  preview.replaceChildren();
  if (!thumbnailFile) return;
  const image = document.createElement("img");
  image.alt = "Thumbnail Preview";
  image.style.maxWidth = "100%";
  image.style.height = "auto";
  const reader = new FileReader();
  reader.onload = () => { image.src = String(reader.result || ""); };
  reader.readAsDataURL(thumbnailFile);
  preview.appendChild(image);
});

function nextID() {
  const numbers = database.map(video => Number(String(video.id || "").replace(/^video/i, ""))).filter(Number.isFinite);
  const next = (numbers.length ? Math.max(...numbers) : 0) + 1;
  const num = String(next).padStart(3, "0");
  return { id: `video${num}`, thumb: `assets/thumb/video${num}.webp` };
}

async function convertThumbnail(file, id) {
  if (!file) throw new Error("Pilih thumbnail terlebih dahulu.");
  if (!window.createImageBitmap) throw new Error("Browser ini tidak mendukung konversi thumbnail. Gunakan Chrome atau Edge terbaru.");
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas tidak tersedia untuk mengolah thumbnail.");
    // Fit-and-crop ke 16:9 agar thumbnail tidak gepeng.
    const scale = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    ctx.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(result => result ? resolve(result) : reject(new Error("Gagal membuat thumbnail WEBP.")), "image/webp", 0.9);
    });
    return new File([blob], `${id}.webp`, { type: "image/webp" });
  } finally {
    if (typeof bitmap.close === "function") bitmap.close();
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Gagal membaca thumbnail WEBP."));
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      if (comma < 0) return reject(new Error("Format thumbnail tidak valid."));
      resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

async function sendToCMS(payload) {
  const password = cmsPasswordInput.value || cmsSessionPassword;
  if (!password) throw new Error("Masukkan password CMS terlebih dahulu.");
  cmsSessionPassword = password;
  const response = await fetch(requireAPI(), {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CMS-Password": password },
    body: JSON.stringify(payload)
  });
  let result = {};
  try { result = await response.json(); } catch (_) {}
  if (!response.ok || !result.ok) throw new Error(result.error || `Penyimpanan gagal (HTTP ${response.status}).`);
  return result;
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (isSaving) return;
  if (!form.reportValidity()) return;
  if (!thumbnailFile) {
    alert("Pilih thumbnail terlebih dahulu.");
    return;
  }
  if (!cmsPasswordInput.value && !cmsSessionPassword) {
    alert("Masukkan password CMS terlebih dahulu.");
    cmsPasswordInput.focus();
    return;
  }
  const durationValue = durationInput.value.trim();
  if (!/^(?:\d{1,2}:)?[0-5]?\d:[0-5]\d$/.test(durationValue)) {
    alert("Isi durasi dengan format mm:ss atau hh:mm:ss, contoh 12:35 atau 1:02:35.");
    durationInput.focus();
    return;
  }
  randomViews();

  isSaving = true;
  const submitButton = form.querySelector('button[type="submit"]');
  const originalLabel = submitButton ? submitButton.textContent : "Generate Video JSON";
  if (submitButton) { submitButton.disabled = true; submitButton.textContent = "Menyimpan ke GitHub..."; }

  try {
    const ids = nextID();
    const encoded = window.HyLooksEncoder.encodeVidey(urlInput.value.trim(), ids.id);
    const thumbWebp = await convertThumbnail(thumbnailFile, ids.id);
    const thumbnailBase64 = await fileToBase64(thumbWebp);
    const item = {
      id: ids.id,
      title: titleInput.value.trim(),
      thumb: ids.thumb,
      views: viewsInput.value.trim(),
      duration: durationInput.value.trim(),
      video: encoded
    };

    setStatus("Mengirim video dan thumbnail ke GitHub...");
    await sendToCMS({ action: "add", item, thumbnailBase64 });

    // Baru perbarui UI setelah backend mengonfirmasi commit GitHub.
    database.push(item);
    window.hylooksJSON = { version: "1.3", updated: new Date().toISOString(), videos: database };
    output.value = JSON.stringify(item, null, 2);
    renderDatabase();
    form.reset();
    cmsPasswordInput.value = cmsSessionPassword;
    randomViews();
    durationInput.placeholder = "Otomatis dari metadata; isi manual jika gagal (mm:ss atau hh:mm:ss)";
    durationInput.dataset.manual = "";
    preview.replaceChildren();
    thumbnailFile = null;
    titleInput.focus();
    setStatus(`${ids.id} berhasil disimpan ke GitHub. JSON dan thumbnail ${ids.id}.webp sudah masuk repository.`);
    alert(`${ids.id} berhasil disimpan ke GitHub. Tidak ada file yang di-download.`);
  } catch (err) {
    setStatus(`Gagal menyimpan: ${err.message}`);
    alert(`Video belum disimpan ke GitHub.\n\n${err.message}`);
  } finally {
    isSaving = false;
    if (submitButton) { submitButton.disabled = false; submitButton.textContent = originalLabel; }
  }
});

function renderDatabase() {
  videoList.replaceChildren();
  database.forEach((video, index) => {
    const card = document.createElement("div");
    card.className = "video-item";
    const img = document.createElement("img");
    img.src = video.thumb || "";
    img.alt = "";
    const info = document.createElement("div");
    info.className = "video-info";
    const title = document.createElement("h3");
    title.textContent = video.title || "";
    const views = document.createElement("p");
    views.textContent = `${video.views || "0"} Views`;
    const duration = document.createElement("p");
    duration.textContent = video.duration || "";
    const id = document.createElement("p");
    id.textContent = video.id || "";
    info.append(title, views, duration, id);
    const actions = document.createElement("div");
    actions.className = "video-actions";
    const del = document.createElement("button");
    del.className = "delete-btn";
    del.type = "button";
    del.dataset.index = String(index);
    del.textContent = "🗑";
    del.setAttribute("aria-label", `Hapus ${video.id}`);
    actions.appendChild(del);
    card.append(img, info, actions);
    videoList.appendChild(card);
  });
}

videoList.addEventListener("click", async event => {
  const button = event.target.closest(".delete-btn");
  if (!button) return;
  const index = Number(button.dataset.index);
  const item = database[index];
  if (!item || !confirm(`Hapus ${item.id} dari repository GitHub?`)) return;
  button.disabled = true;
  try {
    await sendToCMS({ action: "delete", id: item.id, thumb: item.thumb });
    database.splice(index, 1);
    window.hylooksJSON = { version: "1.3", updated: new Date().toISOString(), videos: database };
    renderDatabase();
    setStatus(`${item.id} dihapus dari videos.json dan repository GitHub.`);
  } catch (err) {
    button.disabled = false;
    setStatus(`Gagal menghapus ${item.id}: ${err.message}`);
    alert(`Penghapusan gagal.\n\n${err.message}`);
  }
});

downloadBtn.addEventListener("click", () => {
  const json = window.hylooksJSON || { version: "1.3", updated: new Date().toISOString(), videos: database };
  const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "videos.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

copyBtn.addEventListener("click", async () => {
  if (!output.value) { alert("Belum ada JSON."); return; }
  try {
    await navigator.clipboard.writeText(output.value);
    alert("JSON berhasil disalin.");
  } catch (_) {
    output.select();
    document.execCommand("copy");
    alert("JSON berhasil disalin.");
  }
});

loadDatabase();
