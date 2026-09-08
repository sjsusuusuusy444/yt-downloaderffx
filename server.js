const express = require("express");
const cors = require("cors");
const { execFile, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const YTDLP_PATH = process.platform === "win32"
  ? path.join(__dirname, "yt-dlp.exe")
  : "/usr/local/bin/yt-dlp";

let FFMPEG_PATH;
try { FFMPEG_PATH = require("ffmpeg-static"); } catch { FFMPEG_PATH = null; }

const DOWNLOAD_DIR = path.join(__dirname, "downloads");
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

function runYtdlp(args) {
  return new Promise((resolve, reject) => {
    const fullArgs = FFMPEG_PATH ? ["--ffmpeg-location", FFMPEG_PATH, ...args] : args;
    execFile(YTDLP_PATH, fullArgs, { maxBuffer: 1024 * 1024 * 50, timeout: 120000 }, (error, stdout, stderr) => {
      if (error) { reject(new Error(stderr || error.message)); return; }
      try { resolve(JSON.parse(stdout)); } catch { resolve(stdout); }
    });
  });
}

function extractVideoId(url) {
  try {
    const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
  } catch { return null; }
}

function findDownloadedFile(basePath) {
  if (fs.existsSync(basePath)) return basePath;
  const dir = path.dirname(basePath);
  const base = path.basename(basePath, path.extname(basePath));
  try {
    const files = fs.readdirSync(dir).filter(f => f.startsWith(base))
      .map(f => path.join(dir, f))
      .sort((a, b) => {
        const am = a.endsWith('.mp4') ? 1 : 0;
        const bm = b.endsWith('.mp4') ? 1 : 0;
        if (am !== bm) return bm - am;
        return fs.statSync(b).size - fs.statSync(a).size;
      });
    return files.length > 0 ? files[0] : null;
  } catch { return null; }
}

function cleanupDownloads() {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(DOWNLOAD_DIR)) {
      const fp = path.join(DOWNLOAD_DIR, f);
      if (now - fs.statSync(fp).mtimeMs > 5 * 60 * 1000) fs.unlinkSync(fp);
    }
  } catch {}
}
setInterval(cleanupDownloads, 2 * 60 * 1000);

app.post("/api/info", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL required" });
  const vid = extractVideoId(url);
  if (!vid) return res.status(400).json({ error: "Invalid YouTube URL" });
  const videoUrl = `https://www.youtube.com/watch?v=${vid}`;
  try {
    const info = await runYtdlp(["--dump-json", "--no-warnings", "--no-playlist", "--no-check-certificates", videoUrl]);
    const formats = [];
    const seen = new Set();
    if (info.formats) {
      for (const f of info.formats) {
        if (f.vcodec && f.vcodec !== "none" && f.height) {
          const key = `${f.height}p`;
          const hasAudio = f.acodec && f.acodec !== "none";
          const fk = hasAudio ? key + "_av" : key + "_v";
          if (!seen.has(fk)) {
            seen.add(fk);
            formats.push({
              format_id: f.format_id,
              quality: key,
              height: f.height,
              ext: f.ext || "mp4",
              filesize: f.filesize || f.filesize_approx || 0,
              fps: f.fps || 30,
              has_audio: hasAudio
            });
          }
        }
      }
    }
    formats.sort((a, b) => b.height !== a.height ? b.height - a.height : (b.has_audio ? 1 : 0) - (a.has_audio ? 1 : 0));
    const deduped = [];
    const hs = new Set();
    for (const f of formats) {
      if (!hs.has(f.height)) { hs.add(f.height); deduped.push(f); }
    }
    if (deduped.length === 0) {
      deduped.push({ format_id: "best", quality: "Best", height: 0, ext: "mp4", filesize: 0, fps: 30, has_audio: true });
    }
    res.json({
      title: info.title || "Unknown",
      thumbnail: info.thumbnail || "",
      duration: info.duration || 0,
      author: info.uploader || info.channel || "Unknown",
      views: info.view_count || 0,
      formats: deduped
    });
  } catch (err) {
    res.status(500).json({ error: "ভিডিও তথ্য পেতে সমস্যা হয়েছে।", details: err.message });
  }
});

app.get("/api/download", async (req, res) => {
  const { url, format_id } = req.query;
  if (!url) return res.status(400).json({ error: "URL required" });
  const vid = extractVideoId(url);
  if (!vid) return res.status(400).json({ error: "Invalid YouTube URL" });
  const videoUrl = `https://www.youtube.com/watch?v=${vid}`;
  const ts = Date.now();
  const outBase = `${vid}_${ts}`;
  const outPath = path.join(DOWNLOAD_DIR, `${outBase}.%(ext)s`);
  try {
    const info = await runYtdlp(["--dump-json", "--no-warnings", "--no-playlist", "--no-check-certificates", videoUrl]);
    const title = (info.title || "video").replace(/[^\w\s\-\u0980-\u09FF]/g, "").trim().substring(0, 100);
    const safeFilename = title.replace(/\s+/g, "_") + ".mp4";
    const args = ["-o", outPath, "--no-warnings", "--no-playlist", "--no-check-certificates", "--no-part", "--retries", "3", "--merge-output-format", "mp4"];
    if (FFMPEG_PATH) args.push("--ffmpeg-location", FFMPEG_PATH);
    if (format_id && format_id !== "best") {
      args.push("-f", `${format_id}+bestaudio[ext=m4a]/${format_id}+bestaudio/best[ext=mp4]/best`);
    } else {
      args.push("-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best");
    }
    args.push(videoUrl);
    await new Promise((resolve, reject) => {
      const proc = spawn(YTDLP_PATH, args, { timeout: 300000 });
      let stderr = "";
      proc.stderr.on("data", d => { stderr += d.toString(); });
      proc.stdout.on("data", () => {});
      proc.on("close", code => { if (code === 0) resolve(); else reject(new Error(stderr || `exit code ${code}`)); });
      proc.on("error", reject);
    });
    const downloadedFile = findDownloadedFile(path.join(DOWNLOAD_DIR, `${outBase}.mp4`));
    if (!downloadedFile) throw new Error("Downloaded file not found");
    const stat = fs.statSync(downloadedFile);
    const ext = path.extname(downloadedFile).toLowerCase();
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(safeFilename)}"`);
    res.setHeader("Content-Type", ext === ".webm" ? "video/webm" : "video/mp4");
    res.setHeader("Content-Length", stat.size);
    const rs = fs.createReadStream(downloadedFile);
    rs.pipe(res);
    rs.on("end", () => { setTimeout(() => { try { fs.unlinkSync(downloadedFile); } catch {} }, 5000); });
    rs.on("error", () => { if (!res.headersSent) res.status(500).json({ error: "Stream failed" }); });
  } catch (err) {
    try { for (const f of fs.readdirSync(DOWNLOAD_DIR)) { if (f.startsWith(outBase)) fs.unlinkSync(path.join(DOWNLOAD_DIR, f)); } } catch {}
    if (!res.headersSent) res.status(500).json({ error: "ডাউনলোড ব্যর্থ হয়েছে।", details: err.message });
  }
});

app.get("/api/health", async (req, res) => {
  let v = "unknown";
  try { v = await new Promise((r, j) => { execFile(YTDLP_PATH, ["--version"], (e, o) => { if (e) j(e); else r(o.trim()); }); }); } catch {}
  res.json({ status: "ok", ytdlp: v, ffmpeg: !!FFMPEG_PATH, platform: process.platform });
});

app.get("*", (req, res) => { res.sendFile(path.join(__dirname, "public", "index.html")); });

app.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });
