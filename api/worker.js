const API = "https://api.github.com";
const JSON_PATH = "assets/data/videos.json";
const MAX_THUMB_BYTES = 5 * 1024 * 1024;

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGIN || "").split(",").map(v => v.trim()).filter(Boolean);
  const permitted = allowed.includes(origin) ? origin : "null";
  return {
    "Access-Control-Allow-Origin": permitted,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-CMS-Password",
    "Vary": "Origin"
  };
}
function response(body, status, origin, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin, env) }
  });
}
function assertConfig(env) {
  for (const key of ["GITHUB_TOKEN", "GITHUB_OWNER", "GITHUB_REPO", "GITHUB_BRANCH", "ALLOWED_ORIGIN", "CMS_PASSWORD"]) {
    if (!env[key]) throw new Error(`Worker belum dikonfigurasi: ${key}`);
  }
}
async function github(env, path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "HyLooks-CMS",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!res.ok) throw new Error(data.message || `GitHub API HTTP ${res.status}`);
  return data;
}
function repo(env) { return `/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}`; }
function branchPath(env) { return `${repo(env)}/git/ref/heads/${encodeURIComponent(env.GITHUB_BRANCH).replace(/%2F/g, "/")}`; }
async function readVideos(env) {
  const data = await github(env, `${repo(env)}/contents/${JSON_PATH}?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`);
  const decoded = atob(data.content.replace(/\n/g, ""));
  const bytes = Uint8Array.from(decoded, c => c.charCodeAt(0));
  const json = JSON.parse(new TextDecoder().decode(bytes));
  return Array.isArray(json.videos) ? json : { version: "1.3", updated: new Date().toISOString(), videos: [] };
}
async function createBlob(env, content, encoding = "utf-8") {
  return github(env, `${repo(env)}/git/blobs`, {
    method: "POST",
    body: JSON.stringify({ content, encoding })
  });
}
async function commitFiles(env, entries, message) {
  const ref = await github(env, branchPath(env));
  const parent = await github(env, `${repo(env)}/git/commits/${ref.object.sha}`);
  const tree = await github(env, `${repo(env)}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: parent.tree.sha, tree: entries })
  });
  const commit = await github(env, `${repo(env)}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message, tree: tree.sha, parents: [ref.object.sha] })
  });
  await github(env, branchPath(env), {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha, force: false })
  });
  return commit.sha;
}
function validateItem(item) {
  if (!item || typeof item !== "object") throw new Error("Objek video tidak valid.");
  if (!/^video\d{3,}$/.test(item.id || "")) throw new Error("ID video tidak valid.");
  if (typeof item.title !== "string" || !item.title.trim()) throw new Error("Judul video wajib diisi.");
  if (item.thumb !== `assets/thumb/${item.id}.webp`) throw new Error("Path thumbnail tidak sesuai ID video.");
  if (!item.video || item.video.provider !== "videy" || !item.video.encrypted || !item.video.iv) throw new Error("Data video terenkripsi tidak valid.");
}
async function handlePost(request, env) {
  const body = await request.json();
  if (body.action === "add") {
    validateItem(body.item);
    if (typeof body.thumbnailBase64 !== "string" || !body.thumbnailBase64) throw new Error("Thumbnail WEBP tidak dikirim.");
    const binary = atob(body.thumbnailBase64);
    if (binary.length > MAX_THUMB_BYTES) throw new Error("Ukuran thumbnail melebihi 5 MB.");
    if (binary.length < 12 || body.thumbnailBase64.length > Math.ceil(MAX_THUMB_BYTES * 4 / 3) + 8) throw new Error("Data thumbnail tidak valid.");

    const json = await readVideos(env);
    if (json.videos.some(v => v.id === body.item.id)) throw new Error(`${body.item.id} sudah ada. Muat ulang halaman CMS lalu coba lagi.`);
    json.videos.push(body.item);
    json.version = json.version || "1.3";
    json.updated = new Date().toISOString();

    const [jsonBlob, thumbBlob] = await Promise.all([
      createBlob(env, JSON.stringify(json, null, 2) + "\n"),
      createBlob(env, body.thumbnailBase64, "base64")
    ]);
    const sha = await commitFiles(env, [
      { path: JSON_PATH, mode: "100644", type: "blob", sha: jsonBlob.sha },
      { path: body.item.thumb, mode: "100644", type: "blob", sha: thumbBlob.sha }
    ], `HyLooks CMS: add ${body.item.id}`);
    return { ok: true, id: body.item.id, commit: sha };
  }

  if (body.action === "delete") {
    if (!/^video\d{3,}$/.test(body.id || "")) throw new Error("ID video tidak valid.");
    const expectedThumb = `assets/thumb/${body.id}.webp`;
    if (body.thumb && body.thumb !== expectedThumb) throw new Error("Path thumbnail tidak valid.");
    const json = await readVideos(env);
    const remaining = json.videos.filter(v => v.id !== body.id);
    if (remaining.length === json.videos.length) throw new Error("Video tidak ditemukan di videos.json.");
    json.videos = remaining;
    json.updated = new Date().toISOString();
    const jsonBlob = await createBlob(env, JSON.stringify(json, null, 2) + "\n");
    const sha = await commitFiles(env, [
      { path: JSON_PATH, mode: "100644", type: "blob", sha: jsonBlob.sha },
      { path: expectedThumb, mode: "100644", type: "blob", sha: null }
    ], `HyLooks CMS: delete ${body.id}`);
    return { ok: true, id: body.id, commit: sha };
  }
  throw new Error("Aksi tidak dikenal.");
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
    }
    try {
      assertConfig(env);
      if (!corsHeaders(origin, env)["Access-Control-Allow-Origin"] || corsHeaders(origin, env)["Access-Control-Allow-Origin"] === "null") {
        return response({ ok: false, error: "Origin tidak diizinkan. Periksa ALLOWED_ORIGIN pada Worker." }, 403, origin, env);
      }
      if (request.method === "GET" && new URL(request.url).pathname === "/health") {
        return response({ ok: true, service: "HyLooks CMS API" }, 200, origin, env);
      }
      if (request.method !== "POST") return response({ ok: false, error: "Method tidak diizinkan." }, 405, origin, env);
      const suppliedPassword = request.headers.get("X-CMS-Password") || "";
      if (suppliedPassword.length < 1 || suppliedPassword !== env.CMS_PASSWORD) {
        return response({ ok: false, error: "Password CMS salah." }, 401, origin, env);
      }
      return response(await handlePost(request, env), 200, origin, env);
    } catch (error) {
      return response({ ok: false, error: error.message || "Terjadi kesalahan pada backend." }, 400, origin, env);
    }
  }
};
