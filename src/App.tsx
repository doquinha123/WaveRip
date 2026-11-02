import React, { useState, useEffect, useRef } from 'react';
import {
  Download,
  Music,
  Video,
  Link as LinkIcon,
  Check,
  Copy,
  Clock,
  Eye,
  Moon,
  Sun,
  AlertCircle,
  ArrowRight,
  History,
  Trash2,
  HelpCircle,
  ShieldCheck,
  Zap,
  Sliders,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';

interface VideoInfo {
  id: string;
  title: string;
  channel: string;
  duration: number;
  durationFormatted: string;
  thumbnail: string;
  viewCount: number;
  uploadDate: string;
  videoQualities: string[];
  audioQualities: string[];
}

interface DownloadHistoryItem {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
  format: 'mp3' | 'mp4';
  quality: string;
  fileSizeFormatted?: string;
  timestamp: number;
  downloadUrl?: string;
}

const SAMPLE_VIDEOS = [
  {
    title: 'Never Gonna Give You Up',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    label: 'Rick Astley (Clássico)',
  },
  {
    title: 'Lofi Hip Hop Radio',
    url: 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
    label: 'Lofi Girl (Música)',
  },
  {
    title: 'Big Buck Bunny 4K',
    url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
    label: 'Animação 4K (Vídeo)',
  },
];

export default function App() {
  const [url, setUrl] = useState('');
  const [selectedFormat, setSelectedFormat] = useState<'mp3' | 'mp4'>('mp3');
  const [selectedQuality, setSelectedQuality] = useState('320 kbps (Alta)');
  const [isLoadingInfo, setIsLoadingInfo] = useState(false);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Active Download Job State
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<
    'idle' | 'starting' | 'analyzing' | 'downloading' | 'converting' | 'ready' | 'error'
  >('idle');
  const [jobProgress, setJobProgress] = useState(0);
  const [jobSpeed, setJobSpeed] = useState('');
  const [jobEta, setJobEta] = useState('');
  const [downloadReadyUrl, setDownloadReadyUrl] = useState<string | null>(null);

  // Theme
  const [isDark, setIsDark] = useState(true);

  // History
  const [history, setHistory] = useState<DownloadHistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem('waverip_history');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [copiedLink, setCopiedLink] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Sync theme
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  // Save history to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('waverip_history', JSON.stringify(history));
    } catch (e) {
      console.error(e);
    }
  }, [history]);

  // Adjust default quality when switching format
  useEffect(() => {
    if (selectedFormat === 'mp3') {
      setSelectedQuality('320 kbps (Alta)');
    } else {
      setSelectedQuality(videoInfo?.videoQualities?.[0] || '1080p');
    }
  }, [selectedFormat, videoInfo]);

  // Poll job status
  useEffect(() => {
    if (!activeJobId || jobStatus === 'ready' || jobStatus === 'error') {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    const poll = async () => {
      try {
        const res = await fetch(`/api/download/progress/${activeJobId}`);
        if (!res.ok) {
          throw new Error('Falha ao verificar status do download.');
        }
        const data = await res.json();

        setJobStatus(data.status);
        setJobProgress(data.progress || 0);
        setJobSpeed(data.speed || '');
        setJobEta(data.eta || '');

        if (data.status === 'ready' && data.downloadUrl) {
          setDownloadReadyUrl(data.downloadUrl);

          // Auto-trigger browser download
          const link = document.createElement('a');
          link.href = data.downloadUrl;
          link.setAttribute('download', '');
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);

          // Format file size
          let sizeStr = '';
          if (data.fileSize) {
            const mb = (data.fileSize / (1024 * 1024)).toFixed(1);
            sizeStr = `${mb} MB`;
          }

          // Add to history
          if (videoInfo) {
            const newItem: DownloadHistoryItem = {
              id: activeJobId,
              title: videoInfo.title,
              channel: videoInfo.channel,
              thumbnail: videoInfo.thumbnail,
              format: selectedFormat,
              quality: selectedQuality,
              fileSizeFormatted: sizeStr,
              timestamp: Date.now(),
              downloadUrl: data.downloadUrl,
            };
            setHistory((prev) => [newItem, ...prev.slice(0, 19)]);
          }

          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
        } else if (data.status === 'error') {
          setErrorMessage(data.error || 'Ocorreu um erro no processamento do vídeo.');
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
        }
      } catch (err: any) {
        console.error('Polling error:', err);
      }
    };

    pollIntervalRef.current = setInterval(poll, 750);
    poll();

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [activeJobId, jobStatus, selectedFormat, selectedQuality, videoInfo]);

  // Handle paste button
  const handlePaste = async () => {
    try {
      if (navigator.clipboard) {
        const text = await navigator.clipboard.readText();
        if (text) {
          setUrl(text.trim());
          fetchInfoForUrl(text.trim());
        }
      }
    } catch {
      // Fallback
    }
  };

  // Fetch video information
  const fetchInfoForUrl = async (inputUrl: string) => {
    const trimmed = inputUrl.trim();
    if (!trimmed) {
      setErrorMessage('Por favor, informe um link do YouTube.');
      return;
    }

    setErrorMessage(null);
    setIsLoadingInfo(true);
    setVideoInfo(null);
    setJobStatus('idle');
    setActiveJobId(null);
    setDownloadReadyUrl(null);

    try {
      const res = await fetch('/api/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Não foi possível carregar os dados deste vídeo.');
      }

      setVideoInfo(data);
      if (selectedFormat === 'mp4' && data.videoQualities?.length > 0) {
        setSelectedQuality(data.videoQualities[0]);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Erro ao conectar ao YouTube.');
    } finally {
      setIsLoadingInfo(false);
    }
  };

  // Trigger download process
  const startDownload = async () => {
    const targetUrl = url.trim() || (videoInfo ? `https://www.youtube.com/watch?v=${videoInfo.id}` : '');
    if (!targetUrl) {
      setErrorMessage('Por favor, insira o link de um vídeo.');
      return;
    }

    setErrorMessage(null);
    setJobStatus('starting');
    setJobProgress(5);
    setDownloadReadyUrl(null);

    try {
      const res = await fetch('/api/download/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: targetUrl,
          format: selectedFormat,
          quality: selectedQuality,
          title: videoInfo?.title || 'download',
          channel: videoInfo?.channel || '',
          duration: videoInfo?.duration || 0,
          thumbnail: videoInfo?.thumbnail || '',
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Falha ao iniciar conversão.');
      }

      setActiveJobId(data.jobId);
    } catch (err: any) {
      setJobStatus('error');
      setErrorMessage(err.message || 'Erro ao iniciar o download.');
    }
  };

  const clearHistory = () => {
    setHistory([]);
    try {
      localStorage.removeItem('waverip_history');
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#090d16] text-slate-900 dark:text-slate-100 transition-colors">
      {/* 1. TOP BAR (Strict 3-zone contract) */}
      <header className="sticky top-0 z-40 bg-white/85 dark:bg-[#090d16]/85 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Wordmark */}
          <a href="#" className="flex items-center gap-2.5 whitespace-nowrap shrink-0 group">
            <div className="w-8 h-8 rounded-lg bg-red-600 flex items-center justify-center text-white shadow-sm group-hover:scale-105 transition-transform">
              <Download className="w-4 h-4 stroke-[2.5]" />
            </div>
            <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              Wave<span className="text-red-600">Rip</span>
            </span>
          </a>

          {/* Zone 2: Navigation Links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-400">
            <a href="#downloader" className="hover:text-red-600 dark:hover:text-white transition-colors whitespace-nowrap shrink-0">
              Início
            </a>
            <a href="#como-funciona" className="hover:text-red-600 dark:hover:text-white transition-colors whitespace-nowrap shrink-0">
              Como Baixar
            </a>
            <a href="#recursos" className="hover:text-red-600 dark:hover:text-white transition-colors whitespace-nowrap shrink-0">
              Recursos
            </a>
            <a href="#faq" className="hover:text-red-600 dark:hover:text-white transition-colors whitespace-nowrap shrink-0">
              Perguntas Frequentes
            </a>
          </nav>

          {/* Zone 3: Actions */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setIsDark(!isDark)}
              className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              aria-label="Alternar tema"
              title="Alternar modo claro / escuro"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <a
              href="#downloader"
              className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 active:bg-red-800 rounded-lg shadow-sm transition-all whitespace-nowrap shrink-0"
            >
              Baixar Agora
            </a>
          </div>
        </div>
      </header>

      {/* 2. HERO & CONVERSION CENTER */}
      <section id="downloader" className="relative pt-12 pb-16 md:pt-16 md:pb-24 overflow-hidden">
        {/* Subtle background ambient mesh */}
        <div className="absolute inset-0 pointer-events-none opacity-40 dark:opacity-20 overflow-hidden">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-red-600/15 rounded-full blur-3xl" />
          <div className="absolute top-1/3 left-1/3 w-[500px] h-[300px] bg-indigo-600/15 rounded-full blur-3xl" />
        </div>

        <div className="max-w-4xl mx-auto px-4 sm:px-6 relative z-10">
          {/* Main Title & Editorial Subtext */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 text-xs font-semibold tracking-wide text-red-600 dark:text-red-400 uppercase mb-3">
              <span>Conversor Direto</span>
              <span aria-hidden="true">·</span>
              <span>MP3 e MP4</span>
              <span aria-hidden="true">·</span>
              <span>Sem Anúncios</span>
            </div>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-slate-900 dark:text-white text-balance">
              Baixe Vídeos e Músicas do YouTube em Segundos
            </h1>
            <p className="mt-3 text-base sm:text-lg text-slate-600 dark:text-slate-400 max-w-2xl mx-auto text-balance">
              Cole o link do vídeo, selecione se deseja áudio <strong className="font-semibold text-slate-900 dark:text-white">MP3</strong> ou vídeo <strong className="font-semibold text-slate-900 dark:text-white">MP4</strong> e faça o download do arquivo real de forma rápida e segura.
            </p>
          </div>

          {/* Interactive Downloader Box */}
          <div className="bg-white dark:bg-[#0f1523] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 sm:p-7 shadow-xl shadow-slate-200/50 dark:shadow-black/40">
            {/* Input Row */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                fetchInfoForUrl(url);
              }}
              className="flex flex-col sm:flex-row gap-3"
            >
              <div className="relative flex-1">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <LinkIcon className="w-5 h-5" />
                </div>
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Cole aqui o link do YouTube (ex: https://www.youtube.com/watch?v=...)"
                  className="w-full pl-11 pr-24 py-3.5 bg-slate-50 dark:bg-slate-900/90 border border-slate-300 dark:border-slate-700/80 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500 transition-all"
                />
                <button
                  type="button"
                  onClick={handlePaste}
                  className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-200/80 dark:bg-slate-800 rounded-lg transition-colors flex items-center gap-1.5"
                  title="Colar da área de transferência"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Colar</span>
                </button>
              </div>

              <button
                type="submit"
                disabled={isLoadingInfo || !url.trim()}
                className="px-6 py-3.5 bg-red-600 hover:bg-red-700 active:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl shadow-md transition-all flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
              >
                {isLoadingInfo ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Analisando...</span>
                  </>
                ) : (
                  <>
                    <span>Analisar Vídeo</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            {/* Quick Sample Links */}
            <div className="mt-3.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-medium text-slate-700 dark:text-slate-300">Testar com exemplos:</span>
              {SAMPLE_VIDEOS.map((sample, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setUrl(sample.url);
                    fetchInfoForUrl(sample.url);
                  }}
                  className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-md transition-colors whitespace-nowrap"
                >
                  {sample.label}
                </button>
              ))}
            </div>

            {/* Error Message Callout */}
            {errorMessage && (
              <div className="mt-5 p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-xl flex items-start gap-3 text-red-700 dark:text-red-400 text-sm">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Erro ao processar</p>
                  <p className="mt-0.5 text-xs text-red-600 dark:text-red-300">{errorMessage}</p>
                </div>
              </div>
            )}

            {/* Format Selection Tab Bar */}
            <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-800/80">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    1. Escolha o Formato
                  </label>
                  {/* Segmented control for Format */}
                  <div className="mt-2 inline-flex p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setSelectedFormat('mp3')}
                      className={`px-4 py-2 text-xs font-bold rounded-lg flex items-center gap-2 transition-all whitespace-nowrap shrink-0 ${
                        selectedFormat === 'mp3'
                          ? 'bg-red-600 text-white shadow-sm'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      <Music className="w-4 h-4" />
                      <span>MP3 (Áudio)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedFormat('mp4')}
                      className={`px-4 py-2 text-xs font-bold rounded-lg flex items-center gap-2 transition-all whitespace-nowrap shrink-0 ${
                        selectedFormat === 'mp4'
                          ? 'bg-red-600 text-white shadow-sm'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      <Video className="w-4 h-4" />
                      <span>MP4 (Vídeo)</span>
                    </button>
                  </div>
                </div>

                {/* Quality Selection */}
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    2. Escolha a Qualidade
                  </label>
                  <div className="mt-2">
                    <select
                      value={selectedQuality}
                      onChange={(e) => setSelectedQuality(e.target.value)}
                      className="px-3.5 py-2 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500 transition-colors"
                    >
                      {selectedFormat === 'mp3' ? (
                        <>
                          <option value="320 kbps (Alta)">320 kbps (Alta Fidelidade)</option>
                          <option value="256 kbps">256 kbps (Muito Boa)</option>
                          <option value="192 kbps (Padrão)">192 kbps (Padrão)</option>
                          <option value="128 kbps">128 kbps (Econômico)</option>
                        </>
                      ) : (
                        (videoInfo?.videoQualities || ['1080p', '720p', '480p', '360p']).map((q) => (
                          <option key={q} value={q}>
                            {q} {q === '1080p' ? '(Full HD)' : q === '720p' ? '(HD)' : ''}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* Video Information Card (When Loaded) */}
            {videoInfo && (
              <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-800/80">
                <div className="flex flex-col md:flex-row gap-5 items-start">
                  {/* Thumbnail with duration overlay */}
                  <div className="relative w-full md:w-56 aspect-video rounded-xl overflow-hidden bg-slate-900 shrink-0 border border-slate-200 dark:border-slate-800">
                    <img
                      src={videoInfo.thumbnail}
                      alt={videoInfo.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-black/80 text-white text-[11px] font-mono rounded">
                      {videoInfo.durationFormatted}
                    </div>
                  </div>

                  {/* Metadata and Download trigger */}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white line-clamp-2">
                      {videoInfo.title}
                    </h3>

                    {/* Unboxed metadata with typographic separators */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-medium text-slate-700 dark:text-slate-300">{videoInfo.channel}</span>
                      <span aria-hidden="true">·</span>
                      <span>{videoInfo.durationFormatted}</span>
                      {videoInfo.viewCount > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="tabular-nums">
                            {new Intl.NumberFormat('pt-BR').format(videoInfo.viewCount)} visualizações
                          </span>
                        </>
                      )}
                      {videoInfo.uploadDate && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>Publicado em {videoInfo.uploadDate}</span>
                        </>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="mt-5 flex flex-wrap items-center gap-3">
                      <button
                        onClick={startDownload}
                        disabled={jobStatus === 'downloading' || jobStatus === 'converting' || jobStatus === 'starting'}
                        className="px-6 py-3 bg-red-600 hover:bg-red-700 active:bg-red-800 disabled:opacity-50 text-white text-sm font-bold rounded-xl shadow-md transition-all flex items-center gap-2"
                      >
                        <Download className="w-4 h-4 stroke-[2.5]" />
                        <span>
                          Baixar {selectedFormat.toUpperCase()} ({selectedQuality})
                        </span>
                      </button>

                      <a
                        href={`https://www.youtube.com/watch?v=${videoInfo.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3.5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800 rounded-xl transition-colors flex items-center gap-1.5"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Ver no YouTube</span>
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Active Download Progress Widget */}
            {(jobStatus === 'starting' ||
              jobStatus === 'analyzing' ||
              jobStatus === 'downloading' ||
              jobStatus === 'converting' ||
              jobStatus === 'ready') && (
              <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-800/80">
                <div className="p-4 sm:p-5 rounded-xl bg-slate-100/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    <div className="flex items-center gap-2">
                      {jobStatus === 'ready' ? (
                        <Check className="w-4 h-4 text-emerald-500 stroke-[3]" />
                      ) : (
                        <RefreshCw className="w-4 h-4 text-red-500 animate-spin" />
                      )}
                      <span>
                        {jobStatus === 'starting' && 'Iniciando pipeline de download...'}
                        {jobStatus === 'analyzing' && 'Conectando ao YouTube e preparando stream...'}
                        {jobStatus === 'downloading' && `Baixando stream ${jobSpeed ? `(${jobSpeed})` : ''} ${jobEta ? `· Restante: ${jobEta}` : ''}`}
                        {jobStatus === 'converting' && `Convertendo com FFmpeg para ${selectedFormat.toUpperCase()}...`}
                        {jobStatus === 'ready' && 'Download concluído com sucesso!'}
                      </span>
                    </div>
                    <span className="font-mono tabular-nums text-slate-900 dark:text-white">{jobProgress}%</span>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full h-2.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 rounded-full ${
                        jobStatus === 'ready' ? 'bg-emerald-500' : 'bg-red-600'
                      }`}
                      style={{ width: `${jobProgress}%` }}
                    />
                  </div>

                  {/* Ready State Action */}
                  {jobStatus === 'ready' && downloadReadyUrl && (
                    <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-slate-200/80 dark:border-slate-800">
                      <span className="text-xs text-slate-600 dark:text-slate-400">
                        O arquivo foi baixado no seu navegador. Se o download não iniciou automaticamente:
                      </span>
                      <a
                        href={downloadReadyUrl}
                        download
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Clique para Salvar Arquivo</span>
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 3. RECENT DOWNLOADS (If any) */}
      {history.length > 0 && (
        <section className="py-10 max-w-4xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-slate-500" />
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Downloads Recentes na Sessão</h2>
            </div>
            <button
              onClick={clearHistory}
              className="text-xs font-medium text-slate-500 hover:text-red-500 dark:text-slate-400 dark:hover:text-red-400 transition-colors flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Limpar Histórico</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {history.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 p-3 bg-white dark:bg-[#0f1523] border border-slate-200 dark:border-slate-800/80 rounded-xl"
              >
                <img
                  src={item.thumbnail}
                  alt={item.title}
                  referrerPolicy="no-referrer"
                  className="w-16 h-12 rounded-lg object-cover shrink-0 bg-slate-900"
                />
                <div className="flex-1 min-w-0">
                  <h4 className="text-xs font-semibold text-slate-900 dark:text-white truncate" title={item.title}>
                    {item.title}
                  </h4>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="font-bold text-red-600 dark:text-red-400">{item.format.toUpperCase()}</span>
                    <span aria-hidden="true">·</span>
                    <span>{item.quality}</span>
                    {item.fileSizeFormatted && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">{item.fileSizeFormatted}</span>
                      </>
                    )}
                  </div>
                </div>
                {item.downloadUrl && (
                  <a
                    href={item.downloadUrl}
                    download
                    className="p-2 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white bg-slate-100 dark:bg-slate-800 rounded-lg transition-colors shrink-0"
                    title="Baixar novamente"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 4. VISUAL SPOTLIGHT SECTION WITH GENERATED IMAGE */}
      <section className="py-12 bg-slate-100/60 dark:bg-[#0c111d] border-y border-slate-200 dark:border-slate-800">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-red-600 dark:text-red-400 mb-2">
                Motor de Áudio e Vídeo de Alta Precisão
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight text-balance">
                Qualidade de Estúdio em MP3 e Vídeo Nítido em MP4
              </h2>
              <p className="mt-3 text-sm sm:text-base text-slate-600 dark:text-slate-400 leading-relaxed">
                Utilizamos processamento avançado direto no servidor com FFmpeg e extratores atualizados para garantir que o áudio seja extraído com bitrate de até 320 kbps e vídeos mantendo sincronia perfeita de áudio e imagem em 1080p Full HD.
              </p>

              <div className="mt-6 grid grid-cols-2 gap-4">
                <div className="p-3.5 bg-white dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800">
                  <div className="text-xl font-bold text-slate-900 dark:text-white tabular-nums">320 kbps</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Áudio MP3 Puro sem compressão excessiva</div>
                </div>
                <div className="p-3.5 bg-white dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800">
                  <div className="text-xl font-bold text-slate-900 dark:text-white tabular-nums">1080p HD</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Vídeos em alta definição com taxa total</div>
                </div>
              </div>
            </div>

            <div className="relative rounded-2xl overflow-hidden shadow-xl border border-slate-200 dark:border-slate-800 group">
              <img
                src="/src/assets/images/hero_audio_waves_1793652860585.jpg"
                alt="Estúdio de processamento de áudio digital e vídeo"
                referrerPolicy="no-referrer"
                className="w-full h-auto aspect-video object-cover group-hover:scale-102 transition-transform duration-500"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent flex items-end p-4">
                <span className="text-xs font-medium text-white/90">
                  Conversão instantânea com codificação direta
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 5. COMO FUNCIONA (3 Passos Claros) */}
      <section id="como-funciona" className="py-16 max-w-5xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-12">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Como Baixar Vídeos do YouTube
          </h2>
          <p className="mt-2 text-sm sm:text-base text-slate-600 dark:text-slate-400">
            Apenas 3 passos simples para ter o arquivo no seu computador ou celular.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-6 bg-white dark:bg-[#0f1523] border border-slate-200 dark:border-slate-800/80 rounded-2xl">
            <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400 font-bold flex items-center justify-center text-base mb-4">
              01
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Copie o Link</h3>
            <p className="mt-2 text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Abra o YouTube pelo aplicativo ou navegador, acesse o vídeo ou Short que você quer e clique em <em>Compartilhar &rarr; Copiar Link</em>.
            </p>
          </div>

          <div className="p-6 bg-white dark:bg-[#0f1523] border border-slate-200 dark:border-slate-800/80 rounded-2xl">
            <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400 font-bold flex items-center justify-center text-base mb-4">
              02
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Escolha MP3 ou MP4</h3>
            <p className="mt-2 text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Cole o link no campo acima. Escolha o formato desejado (MP3 para apenas a faixa musical ou MP4 para o vídeo com imagem) e a qualidade.
            </p>
          </div>

          <div className="p-6 bg-white dark:bg-[#0f1523] border border-slate-200 dark:border-slate-800/80 rounded-2xl">
            <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400 font-bold flex items-center justify-center text-base mb-4">
              03
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Baixe o Arquivo Real</h3>
            <p className="mt-2 text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Clique em <em>Baixar</em>. O servidor processa o arquivo diretamente e entrega o download limpo, sem redirecionamentos chatos ou pop-ups.
            </p>
          </div>
        </div>
      </section>

      {/* 6. RECURSOS PRINCIPAIS */}
      <section id="recursos" className="py-14 bg-slate-100/50 dark:bg-[#0c111d] border-t border-slate-200 dark:border-slate-800">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              Diferenciais do WaveRip
            </h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Criado para ser rápido, direto e livre das pegadinhas de sites de download tradicionais.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <div className="p-5 bg-white dark:bg-[#0f1523] border border-slate-200 dark:border-slate-800/80 rounded-xl">
              <Zap className="w-5 h-5 text-red-600 mb-3" />
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">Conversão Acelerada</h4>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Processamento multithread que agiliza a transcodificação de faixas de áudio e junção de vídeo e som.
              </p>
            </div>

            <div className="p-5 bg-white dark:bg-[#0f1523] border border-slate-200 dark:border-slate-800/80 rounded-xl">
              <ShieldCheck className="w-5 h-5 text-emerald-600 mb-3" />
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">Zero Anúncios Maliciosos</h4>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Sem banners enganosos de vírus, sem botões de download falsos e sem janelas popup indesejadas.
              </p>
            </div>

            <div className="p-5 bg-white dark:bg-[#0f1523] border border-slate-200 dark:border-slate-800/80 rounded-xl">
              <Sliders className="w-5 h-5 text-indigo-600 mb-3" />
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">Opções de Resolução</h4>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Suporte para resoluções de 360p até 1080p Full HD e bitrates de áudio de 128 kbps até 320 kbps.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 7. PERGUNTAS FREQUENTES (FAQ) */}
      <section id="faq" className="py-16 max-w-3xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-10">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Perguntas Frequentes
          </h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Tire suas dúvidas sobre o funcionamento do conversor.
          </p>
        </div>

        <div className="space-y-4">
          <div className="p-5 bg-white dark:bg-[#0f1523] border border-slate-200 dark:border-slate-800/80 rounded-xl">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-red-600" />
              <span>O serviço é totalmente gratuito?</span>
            </h4>
            <p className="mt-2 text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Sim! Você pode baixar quantos vídeos e músicas quiser em MP3 e MP4 sem precisar criar conta ou pagar nenhuma assinatura.
            </p>
          </div>

          <div className="p-5 bg-white dark:bg-[#0f1523] border border-slate-200 dark:border-slate-800/80 rounded-xl">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-red-600" />
              <span>Funciona com vídeos do YouTube Shorts?</span>
            </h4>
            <p className="mt-2 text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Sim! Nosso sistema aceita links normais do YouTube (youtube.com/watch), links encurtados (youtu.be) e links de YouTube Shorts (youtube.com/shorts).
            </p>
          </div>

          <div className="p-5 bg-white dark:bg-[#0f1523] border border-slate-200 dark:border-slate-800/80 rounded-xl">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-red-600" />
              <span>Onde o arquivo é salvo no meu aparelho?</span>
            </h4>
            <p className="mt-2 text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              O arquivo vai direto para a pasta padrão de Downloads do seu computador ou celular (Android / iOS / Windows / Mac).
            </p>
          </div>
        </div>
      </section>

      {/* 8. QUIET FOOTER */}
      <footer className="py-8 bg-white dark:bg-[#090d16] border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-900 dark:text-white">WaveRip</span>
            <span aria-hidden="true">·</span>
            <span>Downloader de Vídeos e Músicas</span>
          </div>

          <div className="text-center sm:text-right text-[11px] text-slate-400">
            Ferramenta para download de conteúdos de uso pessoal e livre de direitos autorais.
          </div>
        </div>
      </footer>
    </div>
  );
}
