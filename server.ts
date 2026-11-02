import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { spawn } from 'child_process';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

const DOWNLOADS_DIR = path.resolve(__dirname, 'downloads');
const BIN_DIR = path.resolve(__dirname, 'bin');
const YT_DLP_PATH = path.resolve(BIN_DIR, 'yt-dlp');

if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}
if (!fs.existsSync(BIN_DIR)) {
  fs.mkdirSync(BIN_DIR, { recursive: true });
}

// Find Node.js executable path for yt-dlp JS runtime
let nodeExecutable = '/usr/local/bin/node';
if (!fs.existsSync(nodeExecutable)) {
  if (fs.existsSync('/usr/bin/node')) {
    nodeExecutable = '/usr/bin/node';
  } else {
    nodeExecutable = process.execPath;
  }
}

// Helper to sanitize filenames
function sanitizeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'media';
}

// Format duration
function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Clean old files every 10 minutes (files older than 20 minutes)
setInterval(() => {
  try {
    const files = fs.readdirSync(DOWNLOADS_DIR);
    const now = Date.now();
    for (const file of files) {
      const fullPath = path.join(DOWNLOADS_DIR, file);
      const stat = fs.statSync(fullPath);
      if (now - stat.mtimeMs > 20 * 60 * 1000) {
        fs.unlinkSync(fullPath);
      }
    }
  } catch (err) {
    console.error('Error during cleanup:', err);
  }
}, 10 * 60 * 1000);

interface DownloadJob {
  id: string;
  url: string;
  format: 'mp3' | 'mp4';
  quality: string;
  status: 'pending' | 'analyzing' | 'downloading' | 'converting' | 'ready' | 'error';
  progress: number;
  speed: string;
  eta: string;
  error?: string;
  title: string;
  channel: string;
  duration: number;
  thumbnail: string;
  outputFilePath?: string;
  outputFilename?: string;
  fileSize?: number;
  createdAt: number;
}

const jobs = new Map<string, DownloadJob>();

// Clean up stale jobs in memory
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, job] of jobs.entries()) {
    if (job.createdAt < cutoff) {
      jobs.delete(id);
    }
  }
}, 15 * 60 * 1000);

// Validate and extract youtube video ID or URL
function cleanYoutubeUrl(input: string): string {
  let url = input.trim();
  // If user pasted bare 11-char ID like dQw4w9WgXcQ
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) {
    return `https://www.youtube.com/watch?v=${url}`;
  }
  return url;
}

// POST /api/info - Fetch metadata
app.post('/api/info', async (req: Request, res: Response): Promise<void> => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== 'string') {
      res.status(400).json({ error: 'Por favor, insira o link do YouTube.' });
      return;
    }

    const targetUrl = cleanYoutubeUrl(url);

    const args = [
      '--dump-json',
      '--skip-download',
      '--no-warnings',
      '--no-playlist',
      `--js-runtimes=node:${nodeExecutable}`,
      targetUrl,
    ];

    const child = spawn(YT_DLP_PATH, args);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        console.error('yt-dlp error:', stderr);
        res.status(400).json({
          error: 'Não foi possível carregar as informações do vídeo. Verifique se o link é válido e público.',
          details: stderr.slice(0, 300),
        });
        return;
      }

      try {
        const data = JSON.parse(stdout);
        const title = data.title || 'Vídeo sem título';
        const channel = data.channel || data.uploader || 'YouTube';
        const duration = Number(data.duration) || 0;
        const thumbnail =
          data.thumbnail ||
          (data.thumbnails && data.thumbnails.length > 0
            ? data.thumbnails[data.thumbnails.length - 1].url
            : '');
        const viewCount = data.view_count || 0;
        const uploadDate = data.upload_date
          ? `${data.upload_date.slice(6, 8)}/${data.upload_date.slice(4, 6)}/${data.upload_date.slice(0, 4)}`
          : '';

        // Extract available video resolutions
        const availableHeights = new Set<number>();
        if (Array.isArray(data.formats)) {
          for (const f of data.formats) {
            if (f.height && f.height >= 144) {
              availableHeights.add(f.height);
            }
          }
        }

        const sortedHeights = Array.from(availableHeights).sort((a, b) => b - a);
        const videoQualities = ['1080p', '720p', '480p', '360p'].filter((q) => {
          const num = parseInt(q);
          return sortedHeights.some((h) => h >= num) || num <= 720;
        });

        res.json({
          id: data.id,
          title,
          channel,
          duration,
          durationFormatted: formatDuration(duration),
          thumbnail,
          viewCount,
          uploadDate,
          videoQualities: videoQualities.length > 0 ? videoQualities : ['720p', '480p', '360p'],
          audioQualities: ['320 kbps (Alta)', '256 kbps', '192 kbps (Padrão)', '128 kbps'],
        });
      } catch (parseErr) {
        console.error('JSON parse error:', parseErr);
        res.status(500).json({ error: 'Erro ao interpretar resposta do YouTube.' });
      }
    });
  } catch (error: any) {
    console.error('API Info Exception:', error);
    res.status(500).json({ error: error.message || 'Erro interno do servidor.' });
  }
});

// POST /api/download/start - Initiate asynchronous download
app.post('/api/download/start', async (req: Request, res: Response): Promise<void> => {
  try {
    const { url, format = 'mp3', quality = 'best', title = '', channel = '', duration = 0, thumbnail = '' } = req.body;
    if (!url || typeof url !== 'string') {
      res.status(400).json({ error: 'URL do vídeo é obrigatória.' });
      return;
    }

    const jobId = crypto.randomUUID();
    const targetUrl = cleanYoutubeUrl(url);

    const job: DownloadJob = {
      id: jobId,
      url: targetUrl,
      format: format === 'mp4' ? 'mp4' : 'mp3',
      quality: quality || 'best',
      status: 'pending',
      progress: 0,
      speed: '',
      eta: '',
      title: title || 'audio_video',
      channel: channel || '',
      duration: duration || 0,
      thumbnail: thumbnail || '',
      createdAt: Date.now(),
    };

    jobs.set(jobId, job);
    res.json({ jobId });

    // Start background process
    executeDownload(job);
  } catch (error: any) {
    console.error('Download start error:', error);
    res.status(500).json({ error: error.message || 'Erro ao iniciar download.' });
  }
});

// GET /api/download/progress/:jobId - Poll progress
app.get('/api/download/progress/:jobId', (req: Request, res: Response): void => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  if (!job) {
    res.status(404).json({ error: 'Download não encontrado ou expirado.' });
    return;
  }

  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    speed: job.speed,
    eta: job.eta,
    error: job.error,
    title: job.title,
    channel: job.channel,
    duration: job.duration,
    durationFormatted: formatDuration(job.duration),
    thumbnail: job.thumbnail,
    fileSize: job.fileSize,
    downloadUrl: job.status === 'ready' ? `/api/download/file/${job.id}` : null,
  });
});

// GET /api/download/file/:jobId - Direct file download
app.get('/api/download/file/:jobId', (req: Request, res: Response): void => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);

  if (!job || job.status !== 'ready' || !job.outputFilePath) {
    res.status(404).json({ error: 'Arquivo ainda não está pronto ou expirou.' });
    return;
  }

  if (!fs.existsSync(job.outputFilePath)) {
    res.status(404).json({ error: 'Arquivo não encontrado no servidor.' });
    return;
  }

  const filename = job.outputFilename || `audio_${job.id}.${job.format}`;
  const contentType = job.format === 'mp3' ? 'audio/mpeg' : 'video/mp4';

  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.setHeader('Content-Type', contentType);

  const fileStream = fs.createReadStream(job.outputFilePath);
  fileStream.pipe(res);
});

// Core download worker
function executeDownload(job: DownloadJob) {
  job.status = 'analyzing';
  job.progress = 5;

  const outputPattern = path.join(DOWNLOADS_DIR, `${job.id}.%(ext)s`);
  const args: string[] = [
    `--js-runtimes=node:${nodeExecutable}`,
    '--newline',
    '--no-playlist',
    '-o',
    outputPattern,
  ];

  if (job.format === 'mp3') {
    // Audio extraction to mp3 with ffmpeg
    args.push('-x', '--audio-format', 'mp3');
    if (job.quality.includes('320')) {
      args.push('--audio-quality', '0');
    } else if (job.quality.includes('256')) {
      args.push('--audio-quality', '2');
    } else if (job.quality.includes('192')) {
      args.push('--audio-quality', '4');
    } else {
      args.push('--audio-quality', '5');
    }
    args.push('-f', 'ba/b');
  } else {
    // Video extraction to mp4
    let height = 720;
    if (job.quality.includes('1080')) height = 1080;
    else if (job.quality.includes('720')) height = 720;
    else if (job.quality.includes('480')) height = 480;
    else if (job.quality.includes('360')) height = 360;

    args.push(
      '-f',
      `bv*[height<=${height}][ext=mp4]+ba[ext=m4a]/b[height<=${height}][ext=mp4]/bv*[height<=${height}]+ba/b[height<=${height}]/b`,
      '--merge-output-format',
      'mp4'
    );
  }

  args.push(job.url);

  console.log(`Starting job ${job.id}: yt-dlp ${args.join(' ')}`);

  const child = spawn(YT_DLP_PATH, args);
  let stderr = '';

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    const lines = text.split('\n');

    for (const line of lines) {
      // Check title if printed
      if (line.includes('[download] Destination:')) {
        job.status = 'downloading';
      }

      // Check download percentage: [download]  45.2% of  15.00MiB at  3.50MiB/s ETA 00:03
      const progressMatch = line.match(/\[download\]\s+(\d+\.?\d*)%\s+of\s+~?([^\s]+)\s+at\s+([^\s]+)\s+ETA\s+([^\s]+)/i);
      if (progressMatch) {
        job.status = 'downloading';
        const pct = parseFloat(progressMatch[1]);
        // Map 0-100% download to 10-85% overall
        job.progress = Math.min(85, Math.max(10, Math.round(pct * 0.85)));
        job.speed = progressMatch[3] || '';
        job.eta = progressMatch[4] || '';
      }

      // Check post-processing / ffmpeg converting
      if (
        line.includes('[ExtractAudio]') ||
        line.includes('[Merger]') ||
        line.includes('[Fixup') ||
        line.includes('Destination:')
      ) {
        job.status = 'converting';
        job.progress = 92;
      }
    }
  });

  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  child.on('close', (code) => {
    if (code !== 0) {
      console.error(`Job ${job.id} failed with code ${code}:`, stderr);
      job.status = 'error';
      job.error = 'Ocorreu um erro ao baixar o conteúdo. Verifique se o vídeo possui restrições ou tente outro formato.';
      return;
    }

    // Locate generated file in downloads directory
    try {
      const files = fs.readdirSync(DOWNLOADS_DIR);
      const expectedExt = job.format === 'mp3' ? '.mp3' : '.mp4';
      const matched = files.find((f) => f.startsWith(job.id) && f.endsWith(expectedExt));

      if (matched) {
        const fullPath = path.join(DOWNLOADS_DIR, matched);
        const stats = fs.statSync(fullPath);
        job.outputFilePath = fullPath;
        job.fileSize = stats.size;
        job.outputFilename = `${sanitizeFilename(job.title || 'download')}.${job.format}`;
        job.progress = 100;
        job.status = 'ready';
        console.log(`Job ${job.id} completed successfully: ${job.outputFilename} (${job.fileSize} bytes)`);
      } else {
        // Fallback: check any file starting with job.id
        const anyMatch = files.find((f) => f.startsWith(job.id));
        if (anyMatch) {
          const fullPath = path.join(DOWNLOADS_DIR, anyMatch);
          const stats = fs.statSync(fullPath);
          job.outputFilePath = fullPath;
          job.fileSize = stats.size;
          job.outputFilename = `${sanitizeFilename(job.title || 'download')}.${job.format}`;
          job.progress = 100;
          job.status = 'ready';
        } else {
          job.status = 'error';
          job.error = 'Arquivo gerado não pôde ser localizado.';
        }
      }
    } catch (e: any) {
      job.status = 'error';
      job.error = 'Falha ao processar arquivo final.';
    }
  });
}

// Vite integration in Dev vs Production Static Serving
async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
