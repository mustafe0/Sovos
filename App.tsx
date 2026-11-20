import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Caption, StyleConfig, Tab, SavedProject } from './types';
import { generateCaptions } from './services/geminiService';
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4ArrayBufferTarget } from 'mp4-muxer';
import confetti from 'canvas-confetti';
import { drawStyledCaption, splitInto3Parts, generateSubtitleOverlays } from './services/subtitleRenderer';
import { STYLE_PRESETS, FONT_FAMILIES, DEFAULT_STYLE, StylePreset } from './services/stylePresets';
import { StylePresetSelector } from './components/StylePresetSelector';
import { 
  exportToSRT, 
  exportToVTT, 
  exportToTXT, 
  downloadTextBlob, 
  formatDigitalTime 
} from './services/captionExporters';
import { extractNormalizedAudioBuffer } from './services/audioHelper';
import { 
  enforceMaxTwoLines, 
  splitCaptionToMaxTwoLines, 
  isLongerThanTwoLines 
} from './services/captionSplitter';
import { CapCutTimeline } from './components/CapCutTimeline';
import {
  Sparkles,
  Wand2,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Download,
  Type,
  Palette,
  Film,
  Clock,
  Plus,
  Trash2,
  Search,
  CheckCircle2,
  FolderOpen,
  SlidersHorizontal,
  Layers,
  UploadCloud,
  FileVideo,
  Check,
  Copy,
  ArrowUpDown,
  X,
  AlertCircle,
  FileText,
  Eye,
  Sliders,
  Maximize2,
  Bookmark,
  Scissors,
  RefreshCw,
  SkipBack,
  SkipForward,
  ExternalLink,
  ShieldAlert,
  Undo2,
  Redo2
} from 'lucide-react';
import { 
  isInIframe, 
  openInNewTab, 
  ensureStorageAccess, 
  warmupAuthSession, 
  isCookieBlockedError 
} from './services/apiClient';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';

const INITIAL_STYLE: StyleConfig = DEFAULT_STYLE;

export default function App() {
  // --- Warm up authentication session on startup ---
  useEffect(() => {
    warmupAuthSession();
  }, []);

  // --- Video & Playback State ---
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState<number>(1);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [aspectRatio, setAspectRatio] = useState<number>(16 / 9);
  const [aspectRatioPreset, setAspectRatioPreset] = useState<'original' | '16:9' | '9:16' | '1:1' | '4:5'>('original');
  const [selectedCaptionId, setSelectedCaptionId] = useState<string | null>(null);
  const [videoTrimStart, setVideoTrimStart] = useState<number>(0);
  const [videoTrimEnd, setVideoTrimEnd] = useState<number>(0);

  // --- Caption & Style State ---
  const [styleConfig, setStyleConfig] = useState<StyleConfig>(INITIAL_STYLE);
  const [activeTab, setActiveTab] = useState<Tab>(Tab.TEXT);
  const [searchQuery, setSearchQuery] = useState('');

  // --- AI & Download State ---
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingStatus, setGeneratingStatus] = useState<string>('Creating captions...');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadStatus, setDownloadStatus] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [lastExportedFileName, setLastExportedFileName] = useState<string | null>(null);
  const generateAbortRef = useRef<AbortController | null>(null);
  const downloadAbortRef = useRef<AbortController | null>(null);
  const downloadResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Caption History & Undo / Redo State ---
  const [captionsHistory, setCaptionsHistory] = useState<Caption[][]>([]);
  const [redoHistory, setRedoHistory] = useState<Caption[][]>([]);
  const [initialGeneratedCaptions, setInitialGeneratedCaptions] = useState<Caption[]>([]);

  const pushToHistory = () => {
    if (captions.length > 0) {
      setCaptionsHistory((prev) => [...prev.slice(-30), captions]);
      setRedoHistory([]);
    }
  };

  const handleUndoCaptions = () => {
    if (captionsHistory.length === 0) return;
    const previous = captionsHistory[captionsHistory.length - 1];
    setCaptionsHistory((hist) => hist.slice(0, -1));
    setRedoHistory((redo) => [...redo, captions]);
    setCaptions(previous);
    setSaveToast('Dib ayaa loo celiyay (Undo)');
    setTimeout(() => setSaveToast(null), 2500);
  };

  const handleRedoCaptions = () => {
    if (redoHistory.length === 0) return;
    const next = redoHistory[redoHistory.length - 1];
    setRedoHistory((redo) => redo.slice(0, -1));
    setCaptionsHistory((hist) => [...hist, captions]);
    setCaptions(next);
    setSaveToast('Horay ayaa loo mariyay (Redo)');
    setTimeout(() => setSaveToast(null), 2500);
  };

  // Global Keyboard Shortcuts for Undo (Ctrl+Z) and Redo (Ctrl+Y / Ctrl+Shift+Z)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (!isInput && captionsHistory.length > 0) {
          e.preventDefault();
          handleUndoCaptions();
        }
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        if (!isInput && redoHistory.length > 0) {
          e.preventDefault();
          handleRedoCaptions();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [captionsHistory, redoHistory, captions]);

  const handleResetCaptions = () => {
    if (initialGeneratedCaptions.length > 0) {
      if (window.confirm('Ma hubtaa inaad dib ugu celiso qoraalladii asalka ahaa? (Reset to original version)')) {
        pushToHistory();
        setCaptions(initialGeneratedCaptions);
        setSaveToast('Nuqulkii asalka ahaa ayaa dib loo soo celiyay');
        setTimeout(() => setSaveToast(null), 2500);
      }
    } else if (captions.length > 0) {
      if (window.confirm('Ma hubtaa inaad tirto dhammaan qoraallada si aad dib uga bilowdo?')) {
        pushToHistory();
        setCaptions([]);
        setSaveToast('Dhammaan qoraallada waa la tirtiray');
        setTimeout(() => setSaveToast(null), 2500);
      }
    }
  };

  const handleResetStyle = () => {
    setStyleConfig(DEFAULT_STYLE);
    setSaveToast('Qaabkii caadiga ahaa ayaa dib loo soo celiyay (Style reset to default)');
    setTimeout(() => setSaveToast(null), 2500);
  };

  const handleSelectPreset = (preset: StylePreset) => {
    setStyleConfig((prev) => ({
      ...prev,
      ...preset.style,
      presetId: preset.id,
    }));
    setSaveToast(`Qaabka "${preset.somaliName}" waa la doortay oo qoraalka ayaa lagu dabaqay!`);
    setTimeout(() => setSaveToast(null), 2500);
  };

  // --- Projects State ---
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [copiedFormat, setCopiedFormat] = useState<string | null>(null);

  // --- Refs ---
  const videoRef = useRef<HTMLVideoElement>(null);
  const playPromiseRef = useRef<Promise<void> | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const exportCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceVideoInputRef = useRef<HTMLInputElement>(null);
  const pendingResumeProjectRef = useRef<boolean>(false);
  const isExportingRecordingRef = useRef<boolean>(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  // Safely revoke blob URL only after React commits the new videoUrl or unmounts
  useEffect(() => {
    return () => {
      if (videoUrl) {
        try {
          URL.revokeObjectURL(videoUrl);
        } catch {}
      }
    };
  }, [videoUrl]);

  const isSupportedVideoFile = (file: File) => {
    if (file.type && file.type.startsWith('video/')) return true;
    return /\.(mp4|mov|m4v|webm|mkv|avi|3gp|mpeg|mpg)$/i.test(file.name || '');
  };

  // Unified loader for initial upload and Replace Video - cleanly aborts any active work and resets stale locks
  const loadNewVideoFile = (file: File, options: { isReplace?: boolean } = {}) => {
    if (!isSupportedVideoFile(file)) {
      setErrorMessage('Please upload a valid video file (MP4, MOV, WebM, MKV).');
      return;
    }
    if (file.size > 1024 * 1024 * 1024) {
      setErrorMessage('Muuqaalkaagu wuu ka weyn yahay 1GB. Fadlan soo geli muuqaal ka yar 1GB (Maximum 1024MB).');
      return;
    }

    // Abort any running caption generation or download from the previous video
    if (generateAbortRef.current) {
      generateAbortRef.current.abort();
      generateAbortRef.current = null;
    }
    if (downloadResetTimerRef.current) {
      clearTimeout(downloadResetTimerRef.current);
      downloadResetTimerRef.current = null;
    }
    if (downloadAbortRef.current) {
      downloadAbortRef.current.abort();
      downloadAbortRef.current = null;
    }
    isExportingRecordingRef.current = false;

    const shouldResumeProject = !options.isReplace && pendingResumeProjectRef.current;
    pendingResumeProjectRef.current = false;

    setIsGenerating(false);
    setGeneratingStatus('Creating captions...');
    setIsDownloading(false);
    setDownloadProgress(0);
    setDownloadStatus('');
    setErrorMessage(null);
    setLastExportedFileName(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setVideoTrimStart(0);
    setVideoTrimEnd(0);
    setSelectedCaptionId(null);
    setSearchQuery('');

    const newUrl = URL.createObjectURL(file);
    setVideoFile(file);
    setVideoUrl(newUrl);

    if (!shouldResumeProject) {
      setCaptions([]);
      setCaptionsHistory([]);
      setRedoHistory([]);
      setInitialGeneratedCaptions([]);
      setCurrentProjectId(null);
    }

    setActiveTab(Tab.TEXT);

    if (options.isReplace) {
      setSaveToast('Muuqaalka waa la beddelay, diyaar u ah qoraal cusub.');
      setTimeout(() => setSaveToast(null), 3000);
    }
  };

  // Replace active video without page reload - clears previous captions automatically
  const handleReplaceVideoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    loadNewVideoFile(file, { isReplace: true });
  };

  // Load saved projects on initial mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('caawiye_projects_v2');
      if (saved) {
        setProjects(JSON.parse(saved));
      }
    } catch (e) {
      console.warn('Failed to load projects from storage', e);
    }
  }, []);

  // Save projects helper
  const persistProjects = (updatedProjects: SavedProject[]) => {
    setProjects(updatedProjects);
    try {
      localStorage.setItem('caawiye_projects_v2', JSON.stringify(updatedProjects));
    } catch (e) {
      console.warn('Failed to write projects to storage', e);
    }
  };

  // --- Real-Time Preview Canvas Drawing ---
  const drawPreviewFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = previewCanvasRef.current;
    if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) return;

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const now = video.currentTime;
    const activeCaption = captions.find((c) => now >= c.startTime && now < c.endTime);

    if (activeCaption) {
      drawStyledCaption(
        ctx,
        activeCaption.text,
        styleConfig,
        canvas.width,
        canvas.height,
        canvas.width,
        now,
        activeCaption.startTime,
        activeCaption.endTime
      );
    }
  }, [captions, styleConfig]);

  // Keep preview synced with animation frame
  useEffect(() => {
    let animId: number;
    const loop = () => {
      drawPreviewFrame();
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [drawPreviewFrame]);

  // --- Video Handling ---
  const handleFile = (file: File) => {
    loadNewVideoFile(file, { isReplace: Boolean(videoFile) });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) handleFile(file);
  };

  // Safe playback controllers that handle async promise races and benign AbortError interruptions
  const safePlay = async () => {
    if (!videoRef.current) return;
    const v = videoRef.current;
    try {
      const p = v.play();
      playPromiseRef.current = p;
      await p;
      setIsPlaying(true);
    } catch (err: any) {
      // AbortError is standard browser behavior when play is cancelled by pause() or seek
      if (
        err?.name === 'AbortError' ||
        err?.code === 20 ||
        err?.message?.includes('aborted') ||
        err?.message?.includes('interrupted')
      ) {
        return;
      }
      console.warn('Playback notice:', err?.message || err);
      setIsPlaying(false);
    } finally {
      playPromiseRef.current = null;
    }
  };

  const safePause = async () => {
    if (!videoRef.current) return;
    const v = videoRef.current;
    if (playPromiseRef.current) {
      try {
        await playPromiseRef.current;
      } catch {
        // Ignore aborted promise
      }
    }
    try {
      v.pause();
    } catch {}
    setIsPlaying(false);
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    const v = videoRef.current;
    const endBoundary = (videoTrimEnd > 0 ? videoTrimEnd : duration) || v.duration || 0;

    // Check if video is at or near the end (or already finished)
    const isAtEnd = v.ended || (endBoundary > 0 && v.currentTime >= endBoundary - 0.15);

    if (isAtEnd) {
      // Replay: Rewind to beginning (or videoTrimStart) and start playback cleanly
      const startPoint = videoTrimStart || 0;
      v.currentTime = startPoint;
      setCurrentTime(startPoint);
      safePlay();
      return;
    }

    if (!v.paused) {
      safePause();
    } else {
      safePlay();
    }
  };

  const handleSkip = (seconds: number) => {
    if (!videoRef.current) return;
    const endBoundary = (videoTrimEnd > 0 ? videoTrimEnd : duration) || videoRef.current.duration || 0;
    const target = Math.min(Math.max(videoTrimStart || 0, videoRef.current.currentTime + seconds), endBoundary);
    videoRef.current.currentTime = target;
    setCurrentTime(target);
  };

  const handleSeek = (time: number) => {
    if (!videoRef.current) return;
    const endBoundary = (videoTrimEnd > 0 ? videoTrimEnd : duration) || videoRef.current.duration || 0;
    const target = Math.min(Math.max(videoTrimStart || 0, time), endBoundary);
    videoRef.current.currentTime = target;
    setCurrentTime(target);
  };

  const handleGoToStart = () => {
    if (!videoRef.current) return;
    const startPoint = videoTrimStart || 0;
    videoRef.current.currentTime = startPoint;
    setCurrentTime(startPoint);
  };

  const handleGoToEnd = () => {
    if (!videoRef.current) return;
    const endBoundary = (videoTrimEnd > 0 ? videoTrimEnd : duration) || videoRef.current.duration || 0;
    videoRef.current.currentTime = endBoundary;
    setCurrentTime(endBoundary);
  };

  const handleSpeedChange = (speed: number) => {
    setPlaybackRate(speed);
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    const nextMuted = !isMuted;
    videoRef.current.muted = nextMuted;
    setIsMuted(nextMuted);
    if (!nextMuted && volume === 0) {
      setVolume(1);
      videoRef.current.volume = 1;
    }
  };

  const handleVolumeChange = (newVolume: number) => {
    const val = Math.max(0, Math.min(1, newVolume));
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      const shouldMute = val === 0;
      videoRef.current.muted = shouldMute;
      setIsMuted(shouldMute);
    }
  };

  const testAudioPlay = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = false;
    videoRef.current.volume = 1;
    setIsMuted(false);
    setVolume(1);
    if (videoRef.current.paused) {
      safePlay();
    }
  };

  const handleAspectRatioChange = (preset: 'original' | '16:9' | '9:16' | '1:1' | '4:5') => {
    setAspectRatioPreset(preset);
    setStyleConfig((prev) => ({ ...prev, aspectRatioPreset: preset }));
    if (!videoRef.current) return;
    if (preset === '16:9') setAspectRatio(16 / 9);
    else if (preset === '9:16') setAspectRatio(9 / 16);
    else if (preset === '1:1') setAspectRatio(1);
    else if (preset === '4:5') setAspectRatio(4 / 5);
    else {
      const orig = (videoRef.current.videoWidth || 16) / (videoRef.current.videoHeight || 9);
      setAspectRatio(orig);
    }
  };

  // --- Project Saving & Loading ---
  const saveCurrentProject = () => {
    if (!videoFile) return;
    setIsSaving(true);
    try {
      const id = currentProjectId || `proj-${Date.now()}`;
      const project: SavedProject = {
        id,
        videoName: videoFile.name,
        duration,
        captionsCount: captions.length,
        captions,
        styleConfig,
        updatedAt: new Date().toISOString(),
      };

      const filtered = projects.filter((p) => p.id !== id);
      const updated = [project, ...filtered];
      persistProjects(updated);
      setCurrentProjectId(id);
      setSaveToast('Project saved successfully!');
      setTimeout(() => setSaveToast(null), 3000);
    } catch (err) {
      console.error(err);
      setErrorMessage('An error occurred while saving the project.');
    } finally {
      setIsSaving(false);
    }
  };

  const loadProject = (project: SavedProject) => {
    if (!videoFile) {
      pendingResumeProjectRef.current = true;
    }
    setCaptions(project.captions || []);
    if (project.styleConfig) {
      const cfg = { ...project.styleConfig };
      if (cfg.backgroundColor?.includes('0, 0, 0') && (cfg.backgroundOpacity || 72) > 35) {
        cfg.backgroundColor = 'rgba(0, 0, 0, 0.30)';
        cfg.backgroundOpacity = 30;
      }
      setStyleConfig(cfg);
    }
    setCurrentProjectId(project.id);
    setActiveTab(Tab.TEXT);
    setSaveToast(`Project "${project.videoName}" opened.`);
    setTimeout(() => setSaveToast(null), 3500);
  };

  const deleteProject = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = projects.filter((p) => p.id !== id);
    persistProjects(updated);
  };

  // --- AI Subtitle Generation ---
  const handleCancelGenerateCaptions = () => {
    if (generateAbortRef.current) {
      generateAbortRef.current.abort();
      generateAbortRef.current = null;
    }
    setIsGenerating(false);
    setGeneratingStatus('Creating captions...');
    setSaveToast('Waa la joojiyay abuurista qoraallada.');
    setTimeout(() => setSaveToast(null), 2500);
  };

  const handleGenerateCaptions = async () => {
    if (!videoFile || isGenerating) return;
    const controller = new AbortController();
    generateAbortRef.current = controller;
    setIsGenerating(true);
    setErrorMessage(null);
    setGeneratingStatus('Creating captions...');
    try {
      // In Safari and iframe preview, prompt storage access on user gesture
      await ensureStorageAccess();
      if (controller.signal.aborted) return;
      const generated = await generateCaptions(
        videoFile,
        (status) => {
          if (!controller.signal.aborted) {
            setGeneratingStatus(status);
          }
        },
        controller.signal
      );
      if (controller.signal.aborted) return;
      if (!generated || generated.length === 0) {
        setErrorMessage('No audible speech was detected in this video. Please make sure the video contains clear dialogue and try again.');
      } else {
        // Enforce strict max 2 lines rule (audio and text 100% synchronized, max 2 lines)
        const strictlyEnforced = enforceMaxTwoLines(generated, 7, 40);
        pushToHistory();
        setCaptions(strictlyEnforced);
        setInitialGeneratedCaptions(strictlyEnforced);
        setActiveTab(Tab.TEXT);
        setSaveToast(`Generated ${strictlyEnforced.length} synchronized subtitles (max 2 lines)!`);
        setTimeout(() => setSaveToast(null), 4000);
        try {
          confetti({ particleCount: 60, spread: 60, origin: { y: 0.7 } });
        } catch {}
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || controller.signal.aborted) {
        return;
      }
      if (err?.isCookieBlocked || isCookieBlockedError(err?.message || '')) {
        console.warn('Caption generation notice (cookie/iframe):', err?.message);
        setErrorMessage(
          err?.message || 'Browser-kaagu wuxuu xannibay cookies-ka amniga ee preview-ga. Fadlan ku fur Daaqad Cusub (Open in New Tab).'
        );
      } else {
        console.error('Caption generation error:', err);
        setErrorMessage(err?.message || 'An error occurred while generating subtitles.');
      }
    } finally {
      if (generateAbortRef.current === controller) {
        generateAbortRef.current = null;
        setIsGenerating(false);
        setGeneratingStatus('Creating captions...');
      }
    }
  };

  // --- Subtitle Utilities & 3-Parts / 2-Lines Splitters ---
  const applyThreePartsFormat = () => {
    if (captions.length === 0) return;
    pushToHistory();
    const formatted = captions.map((c) => {
      const parts = splitInto3Parts(c.text);
      return {
        ...c,
        text: parts.join('\n'),
      };
    });
    setCaptions(formatted);
    setSaveToast(`Dhammaan qoraallada waxaa loo habeeyay 3 Qaybood oo kala horeeya (Sida Farta 6aad)!`);
    setTimeout(() => setSaveToast(null), 3500);
    confetti({ particleCount: 50, spread: 60, origin: { y: 0.7 } });
  };

  const applyTwoLinesSplit = () => {
    if (captions.length === 0) return;
    pushToHistory();
    const split = enforceMaxTwoLines(captions, 7, 40);
    setCaptions(split);
    setSaveToast(`All subtitles formatted to max 2 lines (${split.length} speech-synchronized segments)!`);
    setTimeout(() => setSaveToast(null), 3500);
    confetti({ particleCount: 40, spread: 50, origin: { y: 0.7 } });
  };

  const handleSplitSingleCaption = (captionId: string) => {
    const target = captions.find((c) => c.id === captionId);
    if (!target) return;
    const split = splitCaptionToMaxTwoLines(target, 7, 40);
    if (split.length <= 1) return;

    pushToHistory();
    setCaptions((prev) => {
      const idx = prev.findIndex((c) => c.id === captionId);
      if (idx === -1) return prev;
      const next = [...prev];
      next.splice(idx, 1, ...split);
      return next.map((c, i) => ({ ...c, id: `cap-${i + 1}` }));
    });
    setSaveToast('Subtitle split into 2 synchronized lines!');
    setTimeout(() => setSaveToast(null), 3000);
  };

  const shiftAllCaptions = (offsetSeconds: number) => {
    if (captions.length === 0) return;
    pushToHistory();
    const updated = captions.map((c) => ({
      ...c,
      startTime: Math.max(0, parseFloat((c.startTime + offsetSeconds).toFixed(2))),
      endTime: Math.max(0.1, parseFloat((c.endTime + offsetSeconds).toFixed(2))),
    }));
    setCaptions(updated);
    setSaveToast(`All captions shifted by ${offsetSeconds > 0 ? '+' : ''}${offsetSeconds}s`);
    setTimeout(() => setSaveToast(null), 2500);
  };

  const toggleAllUppercase = () => {
    setStyleConfig((prev) => ({ ...prev, isUppercase: !prev.isUppercase }));
  };

  const addCaptionAtPlayhead = () => {
    pushToHistory();
    const start = parseFloat(currentTime.toFixed(1));
    const end = parseFloat(Math.min(duration, currentTime + 2.5).toFixed(1));
    const newCap: Caption = {
      id: `cap-${Date.now()}`,
      startTime: start,
      endTime: end,
      text: 'Enter caption text here...',
    };
    const updated = [...captions, newCap].sort((a, b) => a.startTime - b.startTime);
    setCaptions(updated);
  };

  const handleCancelDownload = () => {
    if (downloadResetTimerRef.current) {
      clearTimeout(downloadResetTimerRef.current);
      downloadResetTimerRef.current = null;
    }
    if (downloadAbortRef.current) {
      downloadAbortRef.current.abort();
      downloadAbortRef.current = null;
    }
    setIsDownloading(false);
    setDownloadProgress(0);
    setDownloadStatus('');
    setSaveToast('Waa la joojiyay soo dejinta muuqaalka.');
    setTimeout(() => setSaveToast(null), 2500);
  };

  // --- Direct Server-Side Subtitle Burn with 100% Original Audio Guarantee (Super-Fast Engine) ---
  const handleServerBurnDownload = async (signal: AbortSignal, controller: AbortController): Promise<boolean> => {
    if (!videoFile) return false;
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    setIsDownloading(true);
    setDownloadProgress(10);
    setDownloadStatus('Diyaarinta naqshadda qoraallada iyo calaamadaha (Studio Quality)...');

    try {
      try {
        const healthRes = await fetch('/api/health', { signal });
        if (healthRes.ok) {
          const healthJson = await healthRes.json().catch(() => null);
          if (healthJson && healthJson.ffmpegAvailable === false) {
            return false;
          }
        }
      } catch (healthErr: any) {
        if (healthErr?.name === 'AbortError' || signal.aborted) throw healthErr;
      }

      let exportWidth = videoRef.current?.videoWidth || 1280;
      let exportHeight = videoRef.current?.videoHeight || 720;
      if (aspectRatioPreset === '9:16' && exportWidth > exportHeight) {
        exportWidth = Math.min(exportWidth, 720);
        exportHeight = Math.min(Math.round(exportWidth * (16 / 9)), 1280);
      }

      const cleanBase = (videoFile.name || 'video')
        .replace(/\.[^/.]+$/, '')
        .replace(/[^a-zA-Z0-9_-]/g, '_') || 'video';
      const downloadFileName = `${cleanBase}_subtitled.mp4`;

      const CHUNK_THRESHOLD = 20 * 1024 * 1024; // 20MB
      let burnRes: Response;

      if (videoFile.size > CHUNK_THRESHOLD) {
        // High-Speed Parallel Chunked Upload (bypasses Cloud Run 32MB payload limit for long/HD/4K videos)
        const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB chunks
        const totalChunks = Math.ceil(videoFile.size / CHUNK_SIZE);
        const fileId = `export_${Date.now()}_${Math.random().toString(36).substring(7)}`;

        setDownloadProgress(15);
        setDownloadStatus(`Soo gelinta muuqaalka weyn (${(videoFile.size / (1024 * 1024)).toFixed(0)}MB) habka degdegga ah...`);

        let uploadedCount = 0;
        const uploadChunk = async (chunkIndex: number) => {
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
          const start = chunkIndex * CHUNK_SIZE;
          const end = Math.min(videoFile.size, start + CHUNK_SIZE);
          const chunkBlob = videoFile.slice(start, end);

          const chunkFormData = new FormData();
          chunkFormData.append('fileId', fileId);
          chunkFormData.append('chunkIndex', String(chunkIndex));
          chunkFormData.append('totalChunks', String(totalChunks));
          chunkFormData.append('chunk', chunkBlob, `chunk_${chunkIndex}`);

          const chunkRes = await fetch('/api/upload-chunk', {
            method: 'POST',
            body: chunkFormData,
            signal,
          });
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
          if (!chunkRes.ok) {
            throw new Error(`Chunk ${chunkIndex} upload failed with status ${chunkRes.status}`);
          }
          uploadedCount++;
          const uploadProgress = 15 + Math.round((uploadedCount / totalChunks) * 45);
          setDownloadProgress(uploadProgress);
          setDownloadStatus(`Soo gelinta muuqaalka weyn (${Math.round((uploadedCount / totalChunks) * 100)}%)...`);
        };

        // Run 3 parallel chunk uploads for high throughput without browser throttling
        const chunkIndices = Array.from({ length: totalChunks }, (_, i) => i);
        const concurrency = 3;
        const workers = Array.from({ length: concurrency }, async () => {
          while (chunkIndices.length > 0) {
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
            const nextIdx = chunkIndices.shift();
            if (nextIdx !== undefined) {
              await uploadChunk(nextIdx);
            }
          }
        });
        await Promise.all(workers);

        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        setDownloadProgress(65);
        setDownloadStatus('Ku daabacaadda qoraallada qurxoon iyo codka asalka ah (Super Fast HD MP4)...');

        const formData = new FormData();
        formData.append('fileId', fileId);
        formData.append('captions', JSON.stringify(captions));
        formData.append('styleConfig', JSON.stringify(styleConfig));
        formData.append('aspectRatioPreset', aspectRatioPreset);
        formData.append('trimStart', String(videoTrimStart || 0));
        formData.append('trimEnd', String(videoTrimEnd || duration || 0));
        formData.append('responseMode', 'id');

        burnRes = await fetch('/api/burn-subtitles', {
          method: 'POST',
          body: formData,
          signal,
        });
      } else {
        // Fast direct upload for standard and short videos (< 20MB)
        setDownloadProgress(25);
        setDownloadStatus('Ku daabacaadda qoraallada qurxoon iyo codka asalka ah (Super Fast HD MP4)...');

        const formData = new FormData();
        const safeName = (videoFile.name || 'video.mp4').replace(/[^a-zA-Z0-9._-]/g, '_') || 'video.mp4';
        formData.append('video', videoFile, safeName);
        formData.append('captions', JSON.stringify(captions));
        formData.append('styleConfig', JSON.stringify(styleConfig));
        formData.append('aspectRatioPreset', aspectRatioPreset);
        formData.append('trimStart', String(videoTrimStart || 0));
        formData.append('trimEnd', String(videoTrimEnd || duration || 0));
        formData.append('responseMode', 'id');

        burnRes = await fetch('/api/burn-subtitles', {
          method: 'POST',
          body: formData,
          signal,
        });
      }

      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const contentType = burnRes.headers.get('content-type') || '';
      if (!burnRes.ok || contentType.includes('text/html')) {
        const errText = await burnRes.text().catch(() => '');
        console.warn('Server burn failed with:', burnRes.status, errText);
        return false;
      }

      setDownloadProgress(90);
      setDownloadStatus('Soo dejinta muuqaalkaaga...');

      let downloadId = burnRes.headers.get('X-Download-Id');
      if (contentType.includes('application/json')) {
        const jsonPayload = await burnRes.json().catch(() => null);
        downloadId = jsonPayload?.downloadId || downloadId;
      } else if (downloadId) {
        // Close any leftover streaming body cleanly before starting direct file download
        try {
          await burnRes.body?.cancel();
        } catch {}
      }

      if (downloadId) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        setLastExportedFileName(downloadFileName);
        const downloadUrl = `/api/download-burned/${downloadId}?filename=${encodeURIComponent(downloadFileName)}`;
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = downloadUrl;
        a.download = downloadFileName;
        a.setAttribute('download', downloadFileName);
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          try {
            if (document.body.contains(a)) document.body.removeChild(a);
          } catch {}
        }, 5000);

        setDownloadProgress(100);
        setDownloadStatus('Success! Muuqaalkaagii oo dhameystiran wuu diyaar yahay.');
        setSaveToast('Muuqaalka waa la soo dejiyay! Waad soo dejin kartaa markale.');
        setTimeout(() => setSaveToast(null), 3500);
        try {
          confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
        } catch {}
        return true;
      }

      const arrayBuffer = await burnRes.arrayBuffer();
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (!arrayBuffer || arrayBuffer.byteLength === 0) {
        return false;
      }

      // Explicitly construct video/mp4 Blob to guarantee standard video recognition
      const safeBlob = new Blob([arrayBuffer], { type: 'video/mp4' });
      setLastExportedFileName(downloadFileName);

      const url = URL.createObjectURL(safeBlob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = downloadFileName;
      a.setAttribute('download', downloadFileName);
      document.body.appendChild(a);
      a.click();

      setTimeout(() => {
        try {
          if (document.body.contains(a)) document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } catch {}
      }, 5000);

      setDownloadProgress(100);
      setDownloadStatus('Success! Muuqaalkaagii oo dhameystiran wuu diyaar yahay.');
      setSaveToast('Muuqaalka waa la soo dejiyay!');
      setTimeout(() => setSaveToast(null), 3500);
      try {
        confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
      } catch {}
      return true;
    } catch (err: any) {
      if (err?.name === 'AbortError' || signal.aborted) {
        throw err?.name === 'AbortError' ? err : new DOMException('Aborted', 'AbortError');
      }
      console.warn('Direct server burn error:', err);
      return false;
    }
  };

  // --- Fast WebCodecs MP4 Export with Muxer ---
  const handleFastDownload = async (signal: AbortSignal, _controller: AbortController) => {
    if (!videoFile || !videoUrl) {
      throw new Error('Video is not loaded yet.');
    }
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const originalVideo = videoRef.current;
    if (!originalVideo || originalVideo.videoWidth === 0) {
      throw new Error('Video is not loaded yet.');
    }

    setIsDownloading(true);
    setDownloadProgress(0);
    setDownloadStatus('Preparing MP4 export engine...');

    const exportVideo = document.createElement('video');
    exportVideo.src = videoUrl;
    exportVideo.crossOrigin = 'anonymous';
    exportVideo.muted = true;
    exportVideo.playsInline = true;
    exportVideo.preload = 'auto';

    let videoEncoder: VideoEncoder | null = null;
    let audioEncoder: AudioEncoder | null = null;

    try {
      await new Promise<void>((resolve) => {
        if (exportVideo.readyState >= 2) {
          resolve();
          return;
        }
        const onLoaded = () => {
          exportVideo.removeEventListener('loadeddata', onLoaded);
          resolve();
        };
        exportVideo.addEventListener('loadeddata', onLoaded);
        setTimeout(resolve, 3000);
      });

      const canvas = exportCanvasRef.current || document.createElement('canvas');
      let exportWidth = originalVideo.videoWidth;
      let exportHeight = originalVideo.videoHeight;
      if (exportWidth % 2 !== 0) exportWidth -= 1;
      if (exportHeight % 2 !== 0) exportHeight -= 1;
      canvas.width = exportWidth;
      canvas.height = exportHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context could not be acquired');

      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      setDownloadStatus('Extracting and normalizing audio track...');
      let audioBuffer: AudioBuffer | null = null;
      try {
        audioBuffer = await extractNormalizedAudioBuffer(videoFile, signal);
      } catch (audioErr: any) {
        if (audioErr?.name === 'AbortError' || signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        console.warn('No audio track or could not decode audio:', audioErr);
      }
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

      const fps = 30;
      const frameDuration = 1 / fps;
      const defaultFrameDurationUs = Math.round(frameDuration * 1e6);

      let audioMuxerConfig: { codec: 'aac' | 'opus'; numberOfChannels: number; sampleRate: number } | undefined = undefined;
      let selectedAudioEncoderCodec = 'mp4a.40.2';

      if (audioBuffer) {
        const sampleRate = audioBuffer.sampleRate;
        const numChannels = audioBuffer.numberOfChannels;
        let chosenCodec: 'aac' | 'opus' = 'aac';

        if (typeof (window as any).AudioEncoder !== 'undefined' && typeof (AudioEncoder as any).isConfigSupported === 'function') {
          try {
            const aacSupport = await (AudioEncoder as any).isConfigSupported({
              codec: 'mp4a.40.2',
              numberOfChannels: numChannels,
              sampleRate: sampleRate,
              bitrate: 128_000,
            });
            if (!aacSupport?.supported) {
              const opusSupport = await (AudioEncoder as any).isConfigSupported({
                codec: 'opus',
                numberOfChannels: numChannels,
                sampleRate: sampleRate,
                bitrate: 128_000,
              });
              if (opusSupport?.supported) {
                chosenCodec = 'opus';
                selectedAudioEncoderCodec = 'opus';
              }
            }
          } catch (e) {
            console.warn('isConfigSupported check failed, using default aac:', e);
          }
        }

        audioMuxerConfig = {
          codec: chosenCodec,
          numberOfChannels: numChannels,
          sampleRate: sampleRate,
        };
      }

      const muxer = new Mp4Muxer({
        target: new Mp4ArrayBufferTarget(),
        video: {
          codec: 'avc',
          width: exportWidth,
          height: exportHeight,
        },
        audio: audioMuxerConfig,
        fastStart: 'in-memory',
      });

      let encoderError: any = null;
      videoEncoder = new VideoEncoder({
        output: (chunk, metadata) => {
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          const durationUs =
            chunk.duration != null && Number.isFinite(chunk.duration) && chunk.duration >= 0
              ? chunk.duration
              : defaultFrameDurationUs;
          muxer.addVideoChunkRaw(data, chunk.type, chunk.timestamp, durationUs, metadata);
        },
        error: (e) => {
          console.error('VideoEncoder error:', e);
          encoderError = e;
        },
      });

      videoEncoder.configure({
        codec: 'avc1.4d002a',
        width: exportWidth,
        height: exportHeight,
        bitrate: 4_500_000,
        framerate: fps,
        hardwareAcceleration: 'prefer-hardware',
        latencyMode: 'realtime',
      });

      const totalSourceDuration = exportVideo.duration || duration || 1;
      const trimStartSec = Math.max(0, videoTrimStart || 0);
      const trimEndSec = (videoTrimEnd > trimStartSec && videoTrimEnd <= totalSourceDuration)
        ? videoTrimEnd
        : totalSourceDuration;

      let audioSuccessfullyMuxed = false;
      if (audioBuffer && audioMuxerConfig) {
        setDownloadStatus('Preparing pristine audio stream...');
        const sampleRate = audioBuffer.sampleRate;
        const numChannels = audioBuffer.numberOfChannels;
        const startSample = Math.min(audioBuffer.length, Math.floor(trimStartSec * sampleRate));
        const endSample = Math.min(audioBuffer.length, Math.ceil(trimEndSec * sampleRate));
        const chunkSize = 1024;
        const defaultAudioDurationUs = Math.round((chunkSize / sampleRate) * 1e6);
        let audioEncoderError: any = null;

        audioEncoder = new AudioEncoder({
          output: (chunk, metadata) => {
            const data = new Uint8Array(chunk.byteLength);
            chunk.copyTo(data);
            const durationUs =
              chunk.duration != null && Number.isFinite(chunk.duration) && chunk.duration >= 0
                ? chunk.duration
                : defaultAudioDurationUs;
            muxer.addAudioChunkRaw(data, chunk.type, chunk.timestamp, durationUs, metadata);
          },
          error: (e) => {
            console.error('AudioEncoder error:', e);
            audioEncoderError = e;
          },
        });

        audioEncoder.configure({
          codec: selectedAudioEncoderCodec,
          numberOfChannels: numChannels,
          sampleRate: sampleRate,
          bitrate: 128_000,
        });

        for (let offset = startSample; offset < endSample; offset += chunkSize) {
          if (signal.aborted) {
            throw new DOMException('Aborted', 'AbortError');
          }
          if (audioEncoderError) throw audioEncoderError;
          const currentChunkSize = Math.min(chunkSize, endSample - offset);
          const planarData = new Float32Array(numChannels * currentChunkSize);
          for (let ch = 0; ch < numChannels; ch++) {
            const channelData = audioBuffer.getChannelData(ch).subarray(offset, offset + currentChunkSize);
            planarData.set(channelData, ch * currentChunkSize);
          }

          const audioData = new AudioData({
            format: 'f32-planar',
            sampleRate,
            numberOfFrames: currentChunkSize,
            numberOfChannels: numChannels,
            timestamp: Math.round(((offset - startSample) / sampleRate) * 1e6),
            data: planarData,
          });

          audioEncoder.encode(audioData);
          audioData.close();
        }

        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        if (audioEncoderError) throw audioEncoderError;
        await audioEncoder.flush();
        try { audioEncoder.close(); } catch {}
        audioEncoder = null;
        audioSuccessfullyMuxed = true;
      }

      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (encoderError) throw encoderError;

      setDownloadStatus('Rendering styled subtitles onto video frames...');
      const activeDur = Math.max(0.1, trimEndSec - trimStartSec);
      const totalFrames = Math.max(1, Math.floor(activeDur * fps));

      const sortedCaptions = [...captions].sort((a, b) => a.startTime - b.startTime);
      let activeCapIdx = 0;

      for (let i = 0; i < totalFrames; i++) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        if (encoderError) throw encoderError;

        const outTime = i * frameDuration;
        const sourceTime = trimStartSec + outTime;
        exportVideo.currentTime = sourceTime;

        await new Promise<void>((resolve) => {
          if (signal.aborted || Math.abs(exportVideo.currentTime - sourceTime) < 0.001) {
            resolve();
            return;
          }
          let timer: any;
          const cleanup = () => {
            clearTimeout(timer);
            exportVideo.removeEventListener('seeked', onSeeked);
            signal.removeEventListener('abort', onAbort);
          };
          const onSeeked = () => {
            cleanup();
            resolve();
          };
          const onAbort = () => {
            cleanup();
            resolve();
          };
          timer = setTimeout(() => {
            cleanup();
            resolve();
          }, 1200);
          exportVideo.addEventListener('seeked', onSeeked);
          signal.addEventListener('abort', onAbort, { once: true });
        });

        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(exportVideo, 0, 0, canvas.width, canvas.height);

        while (activeCapIdx < sortedCaptions.length && sortedCaptions[activeCapIdx].endTime <= sourceTime) {
          activeCapIdx++;
        }
        const activeCaption = sortedCaptions[activeCapIdx] && sourceTime >= sortedCaptions[activeCapIdx].startTime && sourceTime < sortedCaptions[activeCapIdx].endTime
          ? sortedCaptions[activeCapIdx]
          : null;

        if (activeCaption) {
          drawStyledCaption(
            ctx,
            activeCaption.text,
            styleConfig,
            canvas.width,
            canvas.height,
            canvas.width,
            sourceTime,
            activeCaption.startTime,
            activeCaption.endTime
          );
        }

        const isKey = i % 60 === 0;
        const frame = new VideoFrame(canvas, {
          timestamp: Math.round(outTime * 1e6),
          duration: defaultFrameDurationUs,
        });
        videoEncoder.encode(frame, { keyFrame: isKey });
        frame.close();

        if (i % 5 === 0 || i === totalFrames - 1) {
          setDownloadProgress(Math.round((i / totalFrames) * 96));
        }
      }

      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (encoderError) throw encoderError;

      setDownloadStatus('Finalizing MP4 file...');
      await videoEncoder.flush();
      try { videoEncoder.close(); } catch {}
      videoEncoder = null;
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      muxer.finalize();

      const { buffer } = muxer.target;
      const blob = new Blob([buffer], { type: 'video/mp4' });

      const cleanBase = (videoFile.name || 'video')
        .replace(/\.[^/.]+$/, '')
        .replace(/[^a-zA-Z0-9_-]/g, '_') || 'video';
      const downloadFileName = `${cleanBase}_subtitled.mp4`;

      if (!audioSuccessfullyMuxed && videoFile) {
        try {
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
          setDownloadStatus('Merging original studio audio track (MP4)...');
          const formData = new FormData();
          formData.append('subtitledVideo', blob, 'subtitled.mp4');
          const safeOriginalName = (videoFile.name || 'video.mp4').replace(/[^a-zA-Z0-9._-]/g, '_') || 'video.mp4';
          formData.append('originalVideo', videoFile, safeOriginalName);
          const mergeRes = await fetch('/api/merge-video-audio', {
            method: 'POST',
            body: formData,
            signal,
          });
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
          const mergeContentType = mergeRes.headers.get('content-type') || '';
          if (mergeRes.ok && !mergeContentType.includes('text/html')) {
            const ab = await mergeRes.arrayBuffer();
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
            if (ab && ab.byteLength > 0) {
              const finalBlob = new Blob([ab], { type: 'video/mp4' });
              setLastExportedFileName(downloadFileName);

              const finalUrl = URL.createObjectURL(finalBlob);
              const a = document.createElement('a');
              a.style.display = 'none';
              a.href = finalUrl;
              a.download = downloadFileName;
              a.setAttribute('download', downloadFileName);
              document.body.appendChild(a);
              a.click();
              setTimeout(() => {
                try {
                  if (document.body.contains(a)) document.body.removeChild(a);
                  URL.revokeObjectURL(finalUrl);
                } catch {}
              }, 5000);

              setDownloadProgress(100);
              setDownloadStatus('Success! Your subtitled MP4 video is ready.');
              setSaveToast('Muuqaalka waa la soo dejiyay!');
              setTimeout(() => setSaveToast(null), 3500);
              try { confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } }); } catch {}
              return;
            }
          }
        } catch (mergeErr: any) {
          if (mergeErr?.name === 'AbortError' || signal.aborted) {
            throw new DOMException('Aborted', 'AbortError');
          }
          console.warn('Server merge fallback to client blob:', mergeErr);
        }
      }

      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const safeDirectBlob = new Blob([buffer], { type: 'video/mp4' });
      setLastExportedFileName(downloadFileName);
      const url = URL.createObjectURL(safeDirectBlob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = downloadFileName;
      a.setAttribute('download', downloadFileName);
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try {
          if (document.body.contains(a)) document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } catch {}
      }, 5000);

      setDownloadProgress(100);
      setDownloadStatus('Success! Your subtitled MP4 video is ready.');
      setSaveToast('Muuqaalka waa la soo dejiyay!');
      setTimeout(() => setSaveToast(null), 3500);
      try { confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } }); } catch {}
    } finally {
      try { if (audioEncoder && audioEncoder.state !== 'closed') audioEncoder.close(); } catch {}
      try { if (videoEncoder && videoEncoder.state !== 'closed') videoEncoder.close(); } catch {}
      exportVideo.src = '';
    }
  };

  // Fallback real-time recorder with dedicated digital audio pipeline
  const handleLegacyDownload = async (signal: AbortSignal, _controller: AbortController) => {
    if (!videoFile || !videoUrl) {
      throw new Error('Video is not loaded yet.');
    }
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) {
      throw new Error('Video is not loaded yet.');
    }

    setIsDownloading(true);
    setDownloadProgress(0);
    setDownloadStatus('Preparing video recording pipeline...');

    let audioBuffer: AudioBuffer | null = null;
    try {
      audioBuffer = await extractNormalizedAudioBuffer(videoFile, signal);
    } catch (e: any) {
      if (e?.name === 'AbortError' || signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      console.warn('Fallback audio extraction warning:', e);
    }
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    const canvas = exportCanvasRef.current || document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context could not be acquired');

    const stream = canvas.captureStream(30);
    let audioCtx: AudioContext | null = null;
    let bufferSource: AudioBufferSourceNode | null = null;

    if (audioBuffer) {
      try {
        const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
        audioCtx = new AudioCtxClass();
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }
        const dest = audioCtx.createMediaStreamDestination();
        bufferSource = audioCtx.createBufferSource();
        bufferSource.buffer = audioBuffer;
        bufferSource.connect(dest);
        dest.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
      } catch (audioErr) {
        console.warn('Could not setup audio destination track:', audioErr);
      }
    }

    let mimeType = 'video/webm;codecs=vp9,opus';
    if (typeof MediaRecorder === 'undefined') {
      throw new Error('Recording is not supported in this browser.');
    }
    if (MediaRecorder.isTypeSupported('video/mp4')) {
      mimeType = 'video/mp4';
    } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')) {
      mimeType = 'video/webm;codecs=vp8,opus';
    }

    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: Blob[] = [];
    let isRecordingActive = true;

    isExportingRecordingRef.current = true;
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finishResolve = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        const finishReject = (err: any) => {
          if (settled) return;
          settled = true;
          reject(err);
        };

        const cleanupRecording = () => {
          isRecordingActive = false;
          try { video.pause(); } catch {}
          if (bufferSource) {
            try { bufferSource.stop(); } catch {}
          }
          if (audioCtx) {
            try { audioCtx.close().catch(() => {}); } catch {}
          }
          if (recorder.state === 'recording') {
            try { recorder.stop(); } catch {}
          }
          stream.getTracks().forEach((track) => {
            try { track.stop(); } catch {}
          });
        };

        const onAbort = () => {
          cleanupRecording();
          finishReject(new DOMException('Aborted', 'AbortError'));
        };
        signal.addEventListener('abort', onAbort, { once: true });

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };

        recorder.onerror = (ev: any) => {
          signal.removeEventListener('abort', onAbort);
          cleanupRecording();
          finishReject(ev?.error || new Error('MediaRecorder failed during export.'));
        };

        recorder.onstop = async () => {
          isRecordingActive = false;
          signal.removeEventListener('abort', onAbort);
          stream.getTracks().forEach((track) => {
            try { track.stop(); } catch {}
          });
          if (audioCtx) {
            try { audioCtx.close().catch(() => {}); } catch {}
          }
          if (signal.aborted) {
            finishReject(new DOMException('Aborted', 'AbortError'));
            return;
          }
          try {
            setDownloadProgress(92);
            setDownloadStatus('Packaging standard MP4 with studio audio and subtitles...');
            const cleanBase = (videoFile.name || 'video')
              .replace(/\.[^/.]+$/, '')
              .replace(/[^a-zA-Z0-9_-]/g, '_') || 'video';
            const downloadFileName = `${cleanBase}_subtitled.mp4`;
            setLastExportedFileName(downloadFileName);

            const recordedBlob = new Blob(chunks, { type: mimeType });

            try {
              const formData = new FormData();
              formData.append('subtitledVideo', recordedBlob, 'subtitled.webm');
              const safeOriginalName = (videoFile.name || 'video.mp4').replace(/[^a-zA-Z0-9._-]/g, '_') || 'video.mp4';
              formData.append('originalVideo', videoFile, safeOriginalName);
              const mergeRes = await fetch('/api/merge-video-audio', {
                method: 'POST',
                body: formData,
                signal,
              });
              if (signal.aborted) {
                finishReject(new DOMException('Aborted', 'AbortError'));
                return;
              }
              const mergeContentType = mergeRes.headers.get('content-type') || '';
              if (mergeRes.ok && !mergeContentType.includes('text/html')) {
                const ab = await mergeRes.arrayBuffer();
                if (signal.aborted) {
                  finishReject(new DOMException('Aborted', 'AbortError'));
                  return;
                }
                if (ab && ab.byteLength > 0) {
                  const finalBlob = new Blob([ab], { type: 'video/mp4' });
                  const finalUrl = URL.createObjectURL(finalBlob);
                  const a = document.createElement('a');
                  a.style.display = 'none';
                  a.href = finalUrl;
                  a.download = downloadFileName;
                  a.setAttribute('download', downloadFileName);
                  document.body.appendChild(a);
                  a.click();
                  setTimeout(() => {
                    try {
                      if (document.body.contains(a)) document.body.removeChild(a);
                      URL.revokeObjectURL(finalUrl);
                    } catch {}
                  }, 5000);

                  setDownloadProgress(100);
                  setDownloadStatus('Success! Your subtitled MP4 video is ready.');
                  setSaveToast('Muuqaalka waa la soo dejiyay!');
                  setTimeout(() => setSaveToast(null), 3500);
                  try { confetti({ particleCount: 100, spread: 75, origin: { y: 0.6 } }); } catch {}
                  finishResolve();
                  return;
                }
              }
            } catch (err: any) {
              if (err?.name === 'AbortError' || signal.aborted) {
                finishReject(new DOMException('Aborted', 'AbortError'));
                return;
              }
              console.warn('Merge on server failed, falling back to direct MP4 blob:', err);
            }

            if (signal.aborted) {
              finishReject(new DOMException('Aborted', 'AbortError'));
              return;
            }
            const directBlob = new Blob(chunks, { type: 'video/mp4' });
            const url = URL.createObjectURL(directBlob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = downloadFileName;
            a.setAttribute('download', downloadFileName);
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
              try {
                if (document.body.contains(a)) document.body.removeChild(a);
                URL.revokeObjectURL(url);
              } catch {}
            }, 5000);

            setDownloadProgress(100);
            setDownloadStatus('Success! Your subtitled MP4 video has downloaded.');
            setSaveToast('Muuqaalka waa la soo dejiyay!');
            setTimeout(() => setSaveToast(null), 3500);
            try { confetti({ particleCount: 100, spread: 75, origin: { y: 0.6 } }); } catch {}
            finishResolve();
          } catch (onStopErr) {
            finishReject(onStopErr);
          }
        };

        const endLimit = (videoTrimEnd > 0 ? videoTrimEnd : (video.duration || duration || 1));
        const startOffset = Math.max(0, videoTrimStart || 0);

        const drawFrame = () => {
          if (!isRecordingActive || signal.aborted) return;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const activeCaption = captions.find((c) => video.currentTime >= c.startTime && video.currentTime < c.endTime);
          if (activeCaption) {
            drawStyledCaption(
              ctx,
              activeCaption.text,
              styleConfig,
              canvas.width,
              canvas.height,
              canvas.width,
              video.currentTime,
              activeCaption.startTime,
              activeCaption.endTime
            );
          }
          const span = Math.max(0.1, endLimit - startOffset);
          setDownloadProgress(Math.min(90, Math.floor(((video.currentTime - startOffset) / span) * 90)));
          if (!video.ended && !video.paused && video.currentTime < endLimit && isRecordingActive && !signal.aborted) {
            requestAnimationFrame(drawFrame);
          } else {
            try { video.pause(); } catch {}
            if (recorder.state === 'recording') {
              recorder.stop();
            }
          }
        };

        video.addEventListener('ended', () => {
          if (recorder.state === 'recording') {
            recorder.stop();
          }
        }, { once: true });

        recorder.start();
        if (bufferSource) {
          bufferSource.start(0, startOffset, Math.max(0.1, endLimit - startOffset));
        }
        video.currentTime = startOffset;
        video.play()
          .then(() => {
            drawFrame();
          })
          .catch((playErr) => {
            cleanupRecording();
            finishReject(playErr);
          });
      });
    } finally {
      isExportingRecordingRef.current = false;
    }
  };

  const handleDownload = async () => {
    setErrorMessage(null);
    if (!videoFile || isDownloading) return;

    if (downloadResetTimerRef.current) {
      clearTimeout(downloadResetTimerRef.current);
      downloadResetTimerRef.current = null;
    }
    const controller = new AbortController();
    downloadAbortRef.current = controller;
    const { signal } = controller;

    setIsDownloading(true);
    setDownloadProgress(5);
    setDownloadStatus('Preparing video export...');

    try {
      // 1. Primary & Guaranteed: Server-side subtitle burn with 100% original audio stream copy
      let serverBurnSucceeded = false;
      try {
        serverBurnSucceeded = await handleServerBurnDownload(signal, controller);
      } catch (burnErr: any) {
        if (burnErr?.name === 'AbortError' || signal.aborted) return;
        console.warn('Server burn attempt failed, proceeding to fast client download:', burnErr);
      }
      if (serverBurnSucceeded || signal.aborted) return;

      // 2. Secondary: Fast In-Browser WebCodecs export with audio merge
      const supportsWebCodecs = typeof (window as any).VideoEncoder !== 'undefined';
      if (supportsWebCodecs) {
        try {
          await handleFastDownload(signal, controller);
          return;
        } catch (e: any) {
          if (e?.name === 'AbortError' || signal.aborted) return;
          console.warn('Fast MP4 download error, falling back to recorder:', e);
        }
      }

      if (signal.aborted) return;

      // 3. Tertiary: Fallback real-time canvas recorder
      try {
        await handleLegacyDownload(signal, controller);
      } catch (fallbackErr: any) {
        if (fallbackErr?.name === 'AbortError' || signal.aborted) return;
        setErrorMessage('An error occurred while exporting the video: ' + (fallbackErr?.message || 'Export failed'));
      }
    } finally {
      if (downloadAbortRef.current === controller) {
        downloadAbortRef.current = null;
        setIsDownloading(false);
      }
    }
  };

  // Subtitle exports
  const handleExportSRT = () => {
    if (captions.length === 0) return;
    const content = exportToSRT(captions);
    downloadTextBlob(`${videoFile?.name.replace(/\.[^/.]+$/, '') || 'savos'}.srt`, content);
    triggerCopied('SRT');
  };

  const handleExportVTT = () => {
    if (captions.length === 0) return;
    const content = exportToVTT(captions);
    downloadTextBlob(`${videoFile?.name.replace(/\.[^/.]+$/, '') || 'savos'}.vtt`, content);
    triggerCopied('VTT');
  };

  const handleExportTXT = () => {
    if (captions.length === 0) return;
    const content = exportToTXT(captions);
    downloadTextBlob(`${videoFile?.name.replace(/\.[^/.]+$/, '') || 'savos'}.txt`, content);
    triggerCopied('TXT');
  };

  const triggerCopied = (format: string) => {
    setCopiedFormat(format);
    setTimeout(() => setCopiedFormat(null), 2500);
  };

  // Filtered captions by search query
  const filteredCaptions = captions.filter((c) =>
    searchQuery.trim() === '' ? true : c.text.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // =========================================================================
  // SUB-RENDERERS FOR STUDIO (SHARED BETWEEN MOBILE & DESKTOP NATIVE WORKSPACE)
  // =========================================================================

  const renderAiAction = () => {
    if (isGenerating) {
      return (
        <div className="w-full py-2.5 sm:py-3 px-3 sm:px-4 rounded-2xl flex items-center justify-between gap-2.5 bg-emerald-950/60 border border-emerald-800/80 text-emerald-200 shadow-xl">
          <div className="flex items-center gap-2.5 min-w-0 pl-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping shrink-0"></span>
            <span className="text-xs sm:text-sm font-display font-extrabold truncate">{generatingStatus}</span>
          </div>
          <button
            type="button"
            onClick={handleCancelGenerateCaptions}
            className="px-3.5 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/35 text-rose-300 hover:text-white border border-rose-500/40 text-xs font-bold flex items-center gap-1.5 transition-all shrink-0 active:scale-95"
            title="Jooji abuurista qoraallada (Cancel)"
          >
            <X className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Cancel</span>
          </button>
        </div>
      );
    }

    return (
      <button
        onClick={handleGenerateCaptions}
        disabled={isDownloading}
        className={`w-full py-3.5 sm:py-4 px-4 sm:px-6 rounded-2xl flex items-center justify-center gap-2.5 sm:gap-3 font-display font-extrabold text-sm sm:text-base transition-all shadow-xl group ${
          isDownloading
            ? 'bg-emerald-950/60 border border-emerald-800/80 text-emerald-200 cursor-not-allowed'
            : 'bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 shadow-emerald-500/25 hover:shadow-emerald-500/40 active:scale-[0.99]'
        }`}
      >
        <Wand2 className="w-4 h-4 sm:w-5 sm:h-5 group-hover:rotate-12 transition-transform" />
        <span>Create Captions (Somali AI)</span>
      </button>
    );
  };

  const renderSyncStrip = () => {
    if (captions.length === 0 && captionsHistory.length === 0) return null;
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3 bg-[#0A101E] border border-slate-800 p-2.5 sm:p-3 rounded-2xl shadow-lg">
        <div className="flex items-center gap-1.5 text-slate-300 text-xs">
          <Clock className="w-3.5 h-3.5 text-emerald-400" />
          <span className="font-bold uppercase tracking-wide text-[11px] sm:text-xs">Sync & History:</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {/* -0.2s Button */}
          <button
            onClick={() => shiftAllCaptions(-0.2)}
            className="px-2.5 sm:px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-100 hover:text-white rounded-xl border border-slate-700 hover:border-slate-600 transition-all font-mono-code font-bold text-xs shadow-sm flex items-center gap-1 active:scale-95 min-h-[32px]"
            title="Dib ugu riix 0.2 ilbiriqsi (-0.2s)"
          >
            <span className="text-emerald-400 font-bold">◀</span>
            <span>-0.2s</span>
          </button>

          {/* +0.2s Button */}
          <button
            onClick={() => shiftAllCaptions(0.2)}
            className="px-2.5 sm:px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-100 hover:text-white rounded-xl border border-slate-700 hover:border-slate-600 transition-all font-mono-code font-bold text-xs shadow-sm flex items-center gap-1 active:scale-95 min-h-[32px]"
            title="Horay ugu riix 0.2 ilbiriqsi (+0.2s)"
          >
            <span>+0.2s</span>
            <span className="text-emerald-400 font-bold">▶</span>
          </button>

          {/* AA CAPS Button */}
          <button
            onClick={toggleAllUppercase}
            className={`px-2.5 sm:px-3 py-1.5 rounded-xl border transition-all font-black text-xs shadow-sm flex items-center gap-1 active:scale-95 min-h-[32px] ${
              styleConfig.isUppercase
                ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-md shadow-emerald-500/20'
                : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-200 hover:text-white'
            }`}
            title="Xarfo Waaweyn (Toggle AA CAPS)"
          >
            <span className="text-[10px] sm:text-xs">AA</span>
            <span>CAPS</span>
          </button>

          <div className="h-4 w-[1px] bg-slate-700/80 mx-0.5 hidden sm:block"></div>

          {/* Undo Button */}
          <button
            onClick={handleUndoCaptions}
            disabled={captionsHistory.length === 0}
            className="px-2.5 sm:px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 disabled:opacity-30 disabled:hover:bg-amber-500/15 disabled:cursor-not-allowed text-amber-300 hover:text-amber-200 rounded-xl border border-amber-500/40 transition-all font-bold text-xs shadow-sm flex items-center gap-1 active:scale-95 min-h-[32px]"
            title="Dib u noqo (Undo - Ctrl+Z)"
          >
            <Undo2 className="w-3.5 h-3.5 stroke-[2.5]" />
            <span className="hidden sm:inline">Undo</span>
          </button>

          {/* Redo Button */}
          <button
            onClick={handleRedoCaptions}
            disabled={redoHistory.length === 0}
            className="px-2.5 sm:px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 disabled:opacity-30 disabled:hover:bg-amber-500/15 disabled:cursor-not-allowed text-amber-300 hover:text-amber-200 rounded-xl border border-amber-500/40 transition-all font-bold text-xs shadow-sm flex items-center gap-1 active:scale-95 min-h-[32px]"
            title="Horay u soco (Redo - Ctrl+Y)"
          >
            <Redo2 className="w-3.5 h-3.5 stroke-[2.5]" />
            <span className="hidden sm:inline">Redo</span>
          </button>

          {/* Reset Button */}
          <button
            onClick={handleResetCaptions}
            className="px-2.5 sm:px-3 py-1.5 bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 hover:text-white rounded-xl border border-rose-500/40 transition-all font-bold text-xs shadow-sm flex items-center gap-1 active:scale-95 min-h-[32px]"
            title="Dib u celi bilowgii hore (Reset)"
          >
            <RotateCcw className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Reset</span>
          </button>
        </div>
      </div>
    );
  };

  const renderErrorMessage = () => {
    if (!errorMessage) return null;
    return (
      <div className="w-full mt-3 bg-red-950/90 border border-red-800 text-red-200 px-4 py-3 rounded-2xl text-xs flex flex-col gap-2.5 shadow-lg animate-in fade-in">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold text-red-300 text-sm mb-0.5">
                {isCookieBlockedError(errorMessage) ? 'Ogeysiis Amniga Cookies / Preview' : 'Caption Error'}
              </div>
              <div className="text-red-200/90 leading-relaxed">{errorMessage}</div>
            </div>
          </div>
          <button onClick={() => setErrorMessage(null)} className="text-red-400 hover:text-white p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-red-900/60 mt-0.5">
          <button
            onClick={() => {
              setErrorMessage(null);
              handleGenerateCaptions();
            }}
            className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-md shadow-emerald-500/20 active:scale-95"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Iskuday Markale (Retry AI)</span>
          </button>
          {(isCookieBlockedError(errorMessage) || errorMessage.includes('Failed to fetch') || isInIframe()) && (
            <>
              <button
                onClick={openInNewTab}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Ku Fur Daaqad Cusub ↗</span>
              </button>
              {typeof document !== 'undefined' && typeof (document as any).requestStorageAccess === 'function' && (
                <button
                  onClick={async () => {
                    await ensureStorageAccess();
                    setErrorMessage(null);
                    handleGenerateCaptions();
                  }}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all"
                >
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                  <span>Oggolow Cookies & Dib u riix</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  const renderTimeline = () => (
    <div className="w-full">
      <CapCutTimeline
        currentTime={currentTime}
        duration={duration}
        captions={captions}
        onSeek={handleSeek}
        onUpdateCaption={(id, updates) => {
          setCaptions((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)));
        }}
        onDeleteCaption={(id) => {
          pushToHistory();
          setCaptions((prev) => prev.filter((c) => c.id !== id));
          if (selectedCaptionId === id) setSelectedCaptionId(null);
        }}
        onAddCaption={(atTime) => {
          pushToHistory();
          const start = parseFloat(atTime.toFixed(2));
          const end = parseFloat(Math.min(duration || 10, start + 2.0).toFixed(2));
          const newCap: Caption = {
            id: `cap-${Date.now()}`,
            startTime: start,
            endTime: end,
            text: 'New subtitle...',
          };
          setCaptions((prev) => [...prev, newCap].sort((a, b) => a.startTime - b.startTime));
          setSelectedCaptionId(newCap.id);
        }}
        onSplitCaption={(id, atTime) => {
          const cap = captions.find((c) => c.id === id);
          if (!cap) return;
          pushToHistory();
          const splitPoint = parseFloat(atTime.toFixed(2));
          const words = cap.text.split(' ');
          const half = Math.max(1, Math.floor(words.length / 2));
          const part1Text = words.slice(0, half).join(' ') || cap.text;
          const part2Text = words.slice(half).join(' ') || '...';

          const c1: Caption = { ...cap, endTime: splitPoint, text: part1Text };
          const c2: Caption = {
            id: `cap-${Date.now()}`,
            startTime: splitPoint,
            endTime: cap.endTime,
            text: part2Text,
          };
          setCaptions((prev) =>
            prev
              .flatMap((c) => (c.id === id ? [c1, c2] : [c]))
              .sort((a, b) => a.startTime - b.startTime)
          );
          setSelectedCaptionId(c2.id);
        }}
        selectedCaptionId={selectedCaptionId}
        onSelectCaption={setSelectedCaptionId}
        videoTrimStart={videoTrimStart}
        videoTrimEnd={videoTrimEnd || duration}
        onChangeVideoTrim={(start, end) => {
          setVideoTrimStart(start);
          setVideoTrimEnd(end);
          if (videoRef.current && (currentTime < start || currentTime > end)) {
            videoRef.current.currentTime = start;
            setCurrentTime(start);
          }
        }}
        isPlaying={isPlaying}
        onTogglePlay={togglePlay}
        videoUrl={videoUrl}
      />
    </div>
  );

  const renderExportHub = () => (
    <div className="w-full bg-[#0A101E] border border-slate-800/90 rounded-3xl p-4 sm:p-6 shadow-xl">
      {isDownloading ? (
        <div className="space-y-3.5">
          <div className="flex items-center justify-between gap-2 text-xs text-emerald-400 font-semibold">
            <span className="flex items-center gap-2 truncate min-w-0">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping shrink-0"></span>
              <span className="truncate">{downloadStatus || 'Preparing MP4 video export...'}</span>
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-mono-code font-bold text-white bg-emerald-500/20 border border-emerald-500/30 px-3 py-0.5 rounded-full">
                {downloadProgress}%
              </span>
              <button
                type="button"
                onClick={handleCancelDownload}
                className="px-2.5 py-1 rounded-full bg-rose-500/20 hover:bg-rose-500/35 text-rose-300 hover:text-white border border-rose-500/40 text-xs font-bold flex items-center gap-1 transition-all active:scale-95"
                title="Jooji soo dejinta (Cancel Download)"
              >
                <X className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Cancel</span>
              </button>
            </div>
          </div>
          <div className="h-3 bg-slate-900 rounded-full overflow-hidden p-0.5 border border-slate-800">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-300 shadow-sm"
              style={{ width: `${downloadProgress}%` }}
            ></div>
          </div>
          <p className="text-[11px] text-slate-400 text-center">
            Burning subtitles onto video with 100% original audio stream fidelity...
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm sm:text-base font-display font-bold text-white flex items-center gap-2">
                <Download className="w-4 h-4 text-emerald-400" />
                <span>Export & Download Hub</span>
              </h3>
              <p className="text-xs text-slate-400">Save video with subtitles or download subtitle files</p>
            </div>
            {captions.length > 0 && (
              <span className="text-[11px] font-mono-code text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full shrink-0">
                {captions.length} subtitles
              </span>
            )}
          </div>

          {/* Primary MP4 Export Button */}
          <button
            onClick={handleDownload}
            disabled={!videoFile || isDownloading}
            className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 py-3.5 px-5 rounded-2xl flex items-center justify-center gap-3 transition-all font-bold shadow-lg shadow-emerald-500/20 group disabled:opacity-50 hover:scale-[1.01] active:scale-95"
          >
            <Download className="w-5 h-5 text-slate-950 stroke-[2.5] group-hover:scale-110 transition-transform" />
            <span className="text-sm font-display font-black">Download Video (HD MP4)</span>
          </button>

          {/* Subtitle File Exports */}
          <div className="pt-3 border-t border-slate-800/80">
            <div className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-emerald-400" />
                <span>Subtitle Files</span>
              </span>
              {copiedFormat && (
                <span className="text-[11px] text-emerald-400 font-bold animate-in fade-in">
                  ✓ {copiedFormat} Downloaded!
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={handleExportSRT}
                disabled={captions.length === 0}
                className="py-2.5 px-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-emerald-500/50 rounded-xl text-xs font-bold text-slate-200 hover:text-white flex flex-col items-center justify-center gap-1 transition-all disabled:opacity-40 active:scale-95"
                title="Download SubRip Subtitles (.srt)"
              >
                <span className="text-emerald-400 font-mono-code font-bold text-xs">.SRT</span>
                <span className="text-[10px] text-slate-400">SubRip</span>
              </button>
              <button
                onClick={handleExportVTT}
                disabled={captions.length === 0}
                className="py-2.5 px-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-teal-500/50 rounded-xl text-xs font-bold text-slate-200 hover:text-white flex flex-col items-center justify-center gap-1 transition-all disabled:opacity-40 active:scale-95"
                title="Download WebVTT Subtitles (.vtt)"
              >
                <span className="text-teal-400 font-mono-code font-bold text-xs">.VTT</span>
                <span className="text-[10px] text-slate-400">WebVTT</span>
              </button>
              <button
                onClick={handleExportTXT}
                disabled={captions.length === 0}
                className="py-2.5 px-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-sky-500/50 rounded-xl text-xs font-bold text-slate-200 hover:text-white flex flex-col items-center justify-center gap-1 transition-all disabled:opacity-40 active:scale-95"
                title="Download Plain Text Subtitles (.txt)"
              >
                <span className="text-sky-400 font-mono-code font-bold text-xs">.TXT</span>
                <span className="text-[10px] text-slate-400">Text</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderCaptionsTab = () => (
    <div className="space-y-4">
      {/* Search & Action Bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search subtitles..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-xl pl-8 pr-3 py-2 focus:outline-none focus:border-emerald-500"
          />
        </div>
        <button
          onClick={addCaptionAtPlayhead}
          className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-3 py-2 rounded-xl text-xs font-bold transition-colors flex items-center gap-1 shrink-0"
          title="Add subtitle at current playhead position"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add</span>
        </button>
        <button
          onClick={handleUndoCaptions}
          disabled={captionsHistory.length === 0}
          className="bg-amber-500/15 hover:bg-amber-500/25 disabled:opacity-30 disabled:hover:bg-amber-500/15 disabled:cursor-not-allowed text-amber-300 border border-amber-500/40 px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 active:scale-95 shadow-sm"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="w-3.5 h-3.5 stroke-[2.5]" />
          <span>Undo</span>
        </button>
        <button
          onClick={handleRedoCaptions}
          disabled={redoHistory.length === 0}
          className="bg-amber-500/15 hover:bg-amber-500/25 disabled:opacity-30 disabled:hover:bg-amber-500/15 disabled:cursor-not-allowed text-amber-300 border border-amber-500/40 px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 active:scale-95 shadow-sm"
          title="Redo (Ctrl+Y)"
        >
          <Redo2 className="w-3.5 h-3.5 stroke-[2.5]" />
          <span>Redo</span>
        </button>
        {(captions.length > 0 || initialGeneratedCaptions.length > 0) && (
          <button
            onClick={handleResetCaptions}
            className="bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 hover:text-white border border-rose-500/40 px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 active:scale-95 shadow-sm"
            title="Reset captions to initial generated version or clear"
          >
            <RotateCcw className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Reset</span>
          </button>
        )}
      </div>

      {/* Empty State */}
      {captions.length === 0 && (
        <div className="text-center py-12 px-4 border border-dashed border-slate-800 rounded-2xl bg-slate-900/40">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mx-auto mb-3">
            <Sparkles className="w-6 h-6" />
          </div>
          <h4 className="font-bold text-white text-sm mb-1">No subtitles yet</h4>
          <p className="text-xs text-slate-400 mb-4 max-w-xs mx-auto">
            Click "Create Captions" above to transcribe speech with high accuracy.
          </p>
          {isGenerating ? (
            <button
              type="button"
              onClick={handleCancelGenerateCaptions}
              className="bg-rose-500/20 hover:bg-rose-500/35 text-rose-300 hover:text-white border border-rose-500/40 font-bold px-4 py-2 rounded-xl text-xs transition-all inline-flex items-center gap-1.5 active:scale-95"
              title="Jooji abuurista qoraallada (Cancel)"
            >
              <X className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Cancel Creating</span>
            </button>
          ) : (
            <button
              onClick={handleGenerateCaptions}
              disabled={isDownloading}
              className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-4 py-2 rounded-xl text-xs transition-all shadow-md shadow-emerald-500/20 inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <Wand2 className="w-3.5 h-3.5" />
              <span>Create Captions</span>
            </button>
          )}
        </div>
      )}

      {/* Captions List */}
      <div className="space-y-3">
        {filteredCaptions.map((caption) => {
          const isActive = currentTime >= caption.startTime && currentTime < caption.endTime;
          const tooLong = isLongerThanTwoLines(caption.text);

          return (
            <div
              key={caption.id}
              className={`p-3.5 rounded-2xl border transition-all duration-200 ${
                isActive
                  ? 'bg-emerald-950/30 border-emerald-500 ring-1 ring-emerald-500/30 shadow-lg shadow-emerald-500/5 scale-[1.01]'
                  : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
              }`}
            >
              {/* Top Timing & Jump */}
              <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-slate-800/80 text-xs">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleSeek(caption.startTime)}
                    className="p-1 rounded bg-slate-800 hover:bg-emerald-500 hover:text-slate-950 text-slate-300 transition-colors"
                    title="Jump to subtitle start"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                  </button>

                  <input
                    type="number"
                    step="0.1"
                    value={caption.startTime}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setCaptions((prev) =>
                        prev.map((c) => (c.id === caption.id ? { ...c, startTime: val } : c))
                      );
                    }}
                    className="w-14 bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-slate-200 font-mono-code text-[11px] focus:outline-none focus:border-emerald-500"
                  />
                  <span className="text-slate-600">-</span>
                  <input
                    type="number"
                    step="0.1"
                    value={caption.endTime}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setCaptions((prev) =>
                        prev.map((c) => (c.id === caption.id ? { ...c, endTime: val } : c))
                      );
                    }}
                    className="w-14 bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-slate-200 font-mono-code text-[11px] focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="flex items-center gap-2">
                  {isActive && (
                    <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-md animate-pulse">
                      ACTIVE
                    </span>
                  )}
                  <button
                    onClick={() => {
                      pushToHistory();
                      setCaptions((prev) => prev.filter((c) => c.id !== caption.id));
                    }}
                    className="text-slate-500 hover:text-red-400 p-1 transition-colors"
                    title="Delete subtitle"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Editable Subtitle Text */}
              <textarea
                rows={2}
                value={caption.text}
                onChange={(e) => {
                  const newText = e.target.value;
                  setCaptions((prev) =>
                    prev.map((c) => (c.id === caption.id ? { ...c, text: newText } : c))
                  );
                }}
                className="w-full bg-transparent text-white text-xs sm:text-sm focus:outline-none resize-none leading-relaxed"
                placeholder="Type caption text here..."
              />

              {/* Quick Manual Timing Controls */}
              <div className="mt-2 pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
                <div className="flex items-center gap-1">
                  <span className="text-slate-500 font-medium">Duration:</span>
                  <button
                    onClick={() => {
                      const newEnd = Math.max(caption.startTime + 0.2, parseFloat((caption.endTime - 0.2).toFixed(2)));
                      setCaptions((prev) => prev.map((c) => (c.id === caption.id ? { ...c, endTime: newEnd } : c)));
                    }}
                    className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-[10px] transition-colors"
                    title="Shorten end time by 0.2 seconds"
                  >
                    -0.2s
                  </button>
                  <button
                    onClick={() => {
                      const newEnd = parseFloat((caption.endTime + 0.2).toFixed(2));
                      setCaptions((prev) => prev.map((c) => (c.id === caption.id ? { ...c, endTime: newEnd } : c)));
                    }}
                    className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-[10px] transition-colors"
                    title="Extend end time by 0.2 seconds"
                  >
                    +0.2s
                  </button>
                </div>

                <button
                  onClick={() => {
                    const newEnd = parseFloat(currentTime.toFixed(2));
                    if (newEnd > caption.startTime) {
                      setCaptions((prev) => prev.map((c) => (c.id === caption.id ? { ...c, endTime: newEnd } : c)));
                    }
                  }}
                  className="px-2 py-0.5 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-semibold transition-colors flex items-center gap-1"
                  title="Set caption end time to current video playhead"
                >
                  <Clock className="w-3 h-3 text-emerald-400" />
                  <span>Set to Playhead</span>
                </button>
              </div>

              {/* 2-Line Limit Warning and One-Click Split */}
              {tooLong && (
                <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
                  <span className="text-amber-400 flex items-center gap-1 font-medium">
                    <AlertCircle className="w-3 h-3" />
                    Exceeds 2 lines (hard to read)
                  </span>
                  <button
                    onClick={() => handleSplitSingleCaption(caption.id)}
                    className="bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 px-2.5 py-0.5 rounded-lg font-bold transition-colors flex items-center gap-1"
                    title="Split into 2 lines synchronized with speech"
                  >
                    <Scissors className="w-3 h-3" />
                    <span>Split 2-line</span>
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderStyleTab = () => (
    <div className="space-y-5">
      <div className="flex items-center justify-end pb-1">
        <button
          onClick={handleResetStyle}
          className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 px-3 py-1.5 rounded-xl transition-colors flex items-center gap-1.5 shrink-0"
          title="Dib ugu celi qaabkii asalka ahaa"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Dib u celi Asalka</span>
        </button>
      </div>

      {/* Style Presets */}
      <StylePresetSelector
        currentStyle={styleConfig}
        onSelectPreset={handleSelectPreset}
      />

      {/* Subtitle Position */}
      <div className="pt-5 border-t border-slate-800/80 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-emerald-400" />
            <span>Meesha Subtitles-ku Marayo (Vertical Position)</span>
          </h4>
          <span className="text-xs font-mono-code font-bold text-emerald-400">{styleConfig.yPosition}%</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => setStyleConfig((prev) => ({ ...prev, yPosition: 84 }))}
            className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all ${
              styleConfig.yPosition >= 75
                ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            Hoose (84%)
          </button>
          <button
            onClick={() => setStyleConfig((prev) => ({ ...prev, yPosition: 50 }))}
            className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all ${
              styleConfig.yPosition > 25 && styleConfig.yPosition < 75
                ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            Dhexe (50%)
          </button>
          <button
            onClick={() => setStyleConfig((prev) => ({ ...prev, yPosition: 18 }))}
            className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all ${
              styleConfig.yPosition <= 25
                ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            Kore (18%)
          </button>
        </div>
        <input
          type="range"
          min="10"
          max="90"
          value={styleConfig.yPosition}
          onChange={(e) => setStyleConfig((prev) => ({ ...prev, yPosition: parseInt(e.target.value) }))}
          className="w-full accent-emerald-500 cursor-pointer range-slider"
        />
      </div>

      {/* Typography Settings */}
      <div className="pt-4 border-t border-slate-800/80 space-y-3.5">
        <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
          Typography & Size
        </label>

        {/* Font Family */}
        <div>
          <label className="text-[11px] text-slate-400 mb-1.5 block">Font Family</label>
          <select
            value={styleConfig.fontFamily}
            onChange={(e) => setStyleConfig((prev) => ({ ...prev, fontFamily: e.target.value }))}
            className="w-full bg-slate-900 border border-slate-800 text-white rounded-xl p-2.5 text-xs focus:outline-none focus:border-emerald-500"
          >
            {FONT_FAMILIES.map((f, idx) => (
              <option key={`${f.value}-${idx}`} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        {/* Font Size */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[11px] text-slate-400">Font Size</label>
            <span className="text-xs font-mono-code font-bold text-emerald-400">{styleConfig.fontSize}px</span>
          </div>
          <input
            type="range"
            min="20"
            max="72"
            value={styleConfig.fontSize}
            onChange={(e) => setStyleConfig((prev) => ({ ...prev, fontSize: parseInt(e.target.value) }))}
            className="w-full accent-emerald-500 cursor-pointer range-slider"
          />
        </div>

        {/* Font Weight, Uppercase & Italic */}
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={toggleAllUppercase}
            className={`py-2 px-2.5 rounded-xl text-xs font-bold border transition-all truncate ${
              styleConfig.isUppercase
                ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            {styleConfig.isUppercase ? '✓ ALL-CAPS' : 'Normal Case'}
          </button>

          <button
            onClick={() =>
              setStyleConfig((prev) => ({
                ...prev,
                fontStyle: prev.fontStyle === 'italic' ? 'normal' : 'italic',
              }))
            }
            className={`py-2 px-2.5 rounded-xl text-xs font-bold border transition-all truncate ${
              styleConfig.fontStyle === 'italic'
                ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
            title="Italic font style"
          >
            {styleConfig.fontStyle === 'italic' ? '✓ Italic' : 'Upright'}
          </button>

          <button
            onClick={() =>
              setStyleConfig((prev) => ({
                ...prev,
                fontWeight: prev.fontWeight === '900' ? '700' : '900',
              }))
            }
            className="py-2 px-2.5 rounded-xl text-xs font-bold border bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700 transition-all truncate"
          >
            Weight: {styleConfig.fontWeight}
          </button>
        </div>
      </div>

      {/* Outline / Stroke */}
      <div className="pt-4 border-t border-slate-800/80 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-slate-300">Text Stroke / Outline</label>
          <span className="text-xs font-mono-code font-bold text-emerald-400">
            {styleConfig.textStrokeWidth}px
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="8"
          step="1"
          value={styleConfig.textStrokeWidth}
          onChange={(e) => setStyleConfig((prev) => ({ ...prev, textStrokeWidth: parseInt(e.target.value) }))}
          className="w-full accent-emerald-500 cursor-pointer range-slider"
        />
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400">Midabka Stroke:</span>
          <div className="flex items-center gap-1.5">
            {['#000000', '#FFFFFF', '#059669', '#DC2626', '#2563EB'].map((c) => (
              <button
                key={c}
                onClick={() => setStyleConfig((prev) => ({ ...prev, textStrokeColor: c }))}
                className={`w-6 h-6 rounded-full border-2 transition-transform ${
                  styleConfig.textStrokeColor === c ? 'scale-110 border-emerald-400 ring-2 ring-emerald-500/40' : 'border-slate-700'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Text Colors */}
      <div className="pt-4 border-t border-slate-800/80 space-y-3">
        <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
          Subtitle Text Colors
        </label>
        <div>
          <label className="text-[11px] text-slate-400 mb-1.5 block">Midabka Koowaad (Primary Color)</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={styleConfig.textColor}
              onChange={(e) => setStyleConfig((prev) => ({ ...prev, textColor: e.target.value }))}
              className="w-9 h-9 rounded-xl bg-transparent border border-slate-700 cursor-pointer"
            />
            <div className="flex flex-wrap gap-1.5">
              {['#FFFFFF', '#FFE600', '#00FF66', '#00E5FF', '#FF0055'].map((c) => (
                <button
                  key={c}
                  onClick={() => setStyleConfig((prev) => ({ ...prev, textColor: c }))}
                  className="w-7 h-7 rounded-lg border border-slate-700 hover:scale-105 transition-transform"
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>

        <div>
          <label className="text-[11px] text-slate-400 mb-1.5 block">
            Midabka Labaad (Line 2 / Secondary Accent)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={styleConfig.secondaryTextColor || '#FFE600'}
              onChange={(e) => setStyleConfig((prev) => ({ ...prev, secondaryTextColor: e.target.value }))}
              className="w-9 h-9 rounded-xl bg-transparent border border-slate-700 cursor-pointer"
            />
            <div className="flex flex-wrap gap-1.5">
              {['#FFE600', '#00E5FF', '#FF3366', '#00FF88', '#FFFFFF'].map((c) => (
                <button
                  key={c}
                  onClick={() => setStyleConfig((prev) => ({ ...prev, secondaryTextColor: c }))}
                  className="w-7 h-7 rounded-lg border border-slate-700 hover:scale-105 transition-transform"
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Background Capsule */}
      <div className="pt-4 border-t border-slate-800/80 space-y-3">
        <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
          Background Box / Capsule
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setStyleConfig((prev) => ({ ...prev, backgroundColor: 'transparent' }))}
            className={`px-3 py-1.5 text-xs rounded-xl font-bold border transition-colors ${
              styleConfig.backgroundColor === 'transparent'
                ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                : 'border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            Bilaa Sanduuq (None)
          </button>
          <button
            onClick={() =>
              setStyleConfig((prev) => ({ ...prev, backgroundColor: 'rgba(0, 0, 0, 0.30)', backgroundOpacity: 30 }))
            }
            className={`px-3 py-1.5 text-xs rounded-xl font-bold border transition-colors ${
              styleConfig.backgroundColor.includes('0, 0, 0')
                ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                : 'border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            Capsule Madow (Khafiif 30%)
          </button>
          <button
            onClick={() =>
              setStyleConfig((prev) => ({ ...prev, backgroundColor: 'rgba(5, 150, 105, 0.88)' }))
            }
            className={`px-3 py-1.5 text-xs rounded-xl font-bold border transition-colors ${
              styleConfig.backgroundColor.includes('5, 150, 105')
                ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                : 'border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            Emerald Cagaar
          </button>
        </div>
      </div>
    </div>
  );

  const renderProjectsTab = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-display font-bold text-white">Saved Projects</h3>
          <p className="text-xs text-slate-400">Reopen or manage your past subtitling sessions</p>
        </div>
        <button
          onClick={saveCurrentProject}
          disabled={isSaving}
          className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-emerald-500/25 transition-all"
        >
          + Save Current
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="text-center py-10 px-4 border border-dashed border-slate-800 rounded-2xl">
          <FolderOpen className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <p className="text-xs text-slate-400">No saved projects found on this device.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {projects.map((proj) => (
            <div
              key={proj.id}
              onClick={() => loadProject(proj)}
              className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
                currentProjectId === proj.id
                  ? 'bg-emerald-950/20 border-emerald-500/60 ring-1 ring-emerald-500/20'
                  : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <h4 className="font-bold text-white text-xs truncate max-w-[240px]">{proj.videoName}</h4>
                <button
                  onClick={(e) => deleteProject(proj.id, e)}
                  className="text-slate-500 hover:text-red-400 p-1 transition-colors"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono-code">
                <span>{proj.captionsCount || proj.captions?.length || 0} subtitles</span>
                <span>{new Date(proj.updatedAt).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ==========================================
  // VIEW 1: STUDIO LANDING & UPLOAD (NO VIDEO)
  // ==========================================
  if (!videoFile) {
    return (
      <div className="min-h-screen bg-[#070B14] flex flex-col justify-between selection:bg-emerald-500 selection:text-black">
        {/* Top Navbar */}
        <header className="border-b border-slate-800/80 bg-[#0A101D]/90 backdrop-blur-md sticky top-0 z-50 pt-safe">
          <div className="max-w-7xl mx-auto px-3.5 sm:px-6 h-16 sm:h-18 flex items-center justify-between">
            <div className="flex items-center gap-2.5 sm:gap-3.5">
              <div className="relative shrink-0">
                <img
                  src="https://i.ibb.co/7dJC2S3T/364-FE17-A-FAC3-406-E-8-B53-5803-DE3-F524-A.png"
                  alt="Savos"
                  className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl object-cover ring-2 ring-emerald-500/30 shadow-lg shadow-emerald-500/10"
                />
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 sm:w-3 sm:h-3 bg-emerald-500 rounded-full ring-2 ring-[#070B14]"></span>
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <span className="font-display font-extrabold text-lg sm:text-xl tracking-tight text-white">Savos</span>
                  <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 px-2 py-0.5 rounded-full">
                    Studio
                  </span>
                  <span className="text-[10px] font-semibold text-slate-400 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-full hidden sm:inline">
                    Somali AI
                  </span>
                </div>
                <p className="text-[10px] sm:text-[11px] text-slate-400 font-medium truncate">AI Somali Video Caption & Subtitle Generator</p>
              </div>
            </div>

            {/* Header Actions */}
            <div className="flex items-center gap-2">
              <PWAInstallButton />
            </div>
          </div>
        </header>
        <OfflineIndicator />

        {/* Hero & Upload Center */}
        <main className="flex-1 max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-14 w-full flex flex-col items-center">
          {/* Hero Header */}
          <div className="text-center max-w-3xl mb-8">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold mb-5 shadow-sm">
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI Somali Video Captions</span>
            </div>
            <h1 className="text-3xl sm:text-5xl font-display font-black text-white tracking-tight leading-[1.15] mb-4">
              Savos <br className="hidden sm:inline" />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-300 to-emerald-500">
                AI Somali Subtitle Generator
              </span>
            </h1>
            <p className="text-slate-300 text-sm sm:text-base leading-relaxed max-w-2xl mx-auto">
              Create beautiful, accurate Somali captions with AI transcription, professional styling, and instant HD export.
            </p>

            {/* Purpose Workflow Pipeline Indicator */}
            <div className="mt-6 inline-flex flex-wrap items-center justify-center gap-1.5 bg-[#0B1220]/90 border border-slate-800/90 px-3.5 py-2 rounded-2xl text-[11px] font-semibold text-slate-400">
              <span className="text-emerald-400 font-bold">1. Upload Video</span>
              <span className="text-slate-600">→</span>
              <span className="text-white">2. Somali AI Transcription</span>
              <span className="text-slate-600">→</span>
              <span className="text-white">3. Edit Captions</span>
              <span className="text-slate-600">→</span>
              <span className="text-white">4. Style Presets</span>
              <span className="text-slate-600">→</span>
              <span className="text-white">5. Live Preview</span>
              <span className="text-slate-600">→</span>
              <span className="text-teal-400 font-bold">6. HD Export</span>
            </div>
          </div>

          {/* Upload Dropzone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingFile(true);
            }}
            onDragLeave={() => setIsDraggingFile(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDraggingFile(false);
              const file = e.dataTransfer.files?.[0];
              if (file) handleFile(file);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`w-full max-w-2xl p-8 sm:p-12 rounded-3xl border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center text-center group relative overflow-hidden ${
              isDraggingFile
                ? 'border-emerald-400 bg-emerald-500/10 scale-[1.01]'
                : 'border-slate-800 bg-[#0D1424]/80 hover:border-emerald-500/50 hover:bg-[#0F172A] shadow-2xl'
            }`}
          >
            <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/5 to-transparent pointer-events-none"></div>

            <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-emerald-500/20 to-teal-500/10 border border-emerald-500/30 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:border-emerald-400 transition-all duration-300 shadow-xl shadow-emerald-500/5">
              <UploadCloud className="w-10 h-10 text-emerald-400 group-hover:text-emerald-300 transition-colors" />
            </div>

            <h3 className="text-xl font-display font-bold text-white mb-2">Upload Video</h3>
            <p className="text-slate-400 text-sm mb-6 max-w-md">
              Drag and drop your video here, or click to browse from your computer or phone
            </p>

            <div className="flex flex-wrap items-center justify-center gap-2 mb-6">
              <span className="text-[11px] font-semibold bg-slate-800/80 text-slate-300 border border-slate-700/80 px-2.5 py-1 rounded-lg">
                MP4
              </span>
              <span className="text-[11px] font-semibold bg-slate-800/80 text-slate-300 border border-slate-700/80 px-2.5 py-1 rounded-lg">
                MOV
              </span>
              <span className="text-[11px] font-semibold bg-slate-800/80 text-slate-300 border border-slate-700/80 px-2.5 py-1 rounded-lg">
                WebM
              </span>
              <span className="text-[11px] font-semibold bg-slate-800/80 text-slate-300 border border-slate-700/80 px-2.5 py-1 rounded-lg">
                MKV
              </span>
              <span className="text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-lg">
                Up to 1GB (1000MB)
              </span>
            </div>

            <button
              type="button"
              className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-6 py-3.5 rounded-xl transition-all shadow-lg shadow-emerald-500/20 flex items-center gap-2 group-hover:shadow-emerald-500/40"
            >
              <FileVideo className="w-4 h-4" />
              <span>Select Video</span>
            </button>
            <input type="file" accept="video/*,.mp4,.mov,.m4v,.webm,.mkv" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
          </div>

          {/* Error Notification */}
          {errorMessage && (
            <div className="mt-6 w-full max-w-2xl bg-red-950/90 border border-red-800 text-red-200 p-4 rounded-2xl flex flex-col gap-3 text-sm shadow-xl animate-in fade-in">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold text-red-300 text-sm mb-0.5">
                      {isCookieBlockedError(errorMessage) ? 'Ogeysiis Amniga Cookies / Preview' : 'Khalad ayaa dhacay (Error)'}
                    </div>
                    <div className="text-red-200/90 text-xs leading-relaxed">{errorMessage}</div>
                  </div>
                </div>
                <button onClick={() => setErrorMessage(null)} className="text-red-400 hover:text-white p-1">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {(isCookieBlockedError(errorMessage) || errorMessage.includes('Failed to fetch') || isInIframe()) && (
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-red-900/60">
                  <button
                    onClick={openInNewTab}
                    className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-md shadow-emerald-500/20"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Ku Fur Daaqad Cusub (Open in New Tab) ↗</span>
                  </button>
                  {typeof document !== 'undefined' && typeof (document as any).requestStorageAccess === 'function' && (
                    <button
                      onClick={async () => {
                        await ensureStorageAccess();
                        setErrorMessage(null);
                      }}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all"
                    >
                      <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                      <span>Oggolow Cookies (Allow Storage)</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Value Propositions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-4xl mt-12">
            <div className="p-5 rounded-2xl bg-[#0B1220] border border-slate-800/80 flex flex-col items-start">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-3.5">
                <Wand2 className="w-5 h-5" />
              </div>
              <h4 className="font-display font-bold text-white text-base mb-1.5">Somali AI Transcription</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Specialized speech-to-text AI tuned for authentic Somali vocabulary, double vowels, and verbatim accuracy.
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-[#0B1220] border border-slate-800/80 flex flex-col items-start">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mb-3.5">
                <Palette className="w-5 h-5" />
              </div>
              <h4 className="font-display font-bold text-white text-base mb-1.5">🎨 11 Studio Style Presets</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Instant one-click styling including Viral 3-Tier, TikTok, Reels, Classic, Bold, Cinematic, and Karaoke.
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-[#0B1220] border border-slate-800/80 flex flex-col items-start">
              <div className="w-10 h-10 rounded-xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400 mb-3.5">
                <Download className="w-5 h-5" />
              </div>
              <h4 className="font-display font-bold text-white text-base mb-1.5">⚡ HD Export & Social Ratios</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                High-definition MP4 export with 100% original audio preservation and real-time canvas presets (9:16, 16:9, 1:1, 4:5).
              </p>
            </div>
          </div>

          {/* Saved Projects Section */}
          {projects.length > 0 && (
            <div className="w-full max-w-4xl mt-14 pt-10 border-t border-slate-800/80">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-display font-bold text-white flex items-center gap-2">
                  <FolderOpen className="w-5 h-5 text-emerald-400" />
                  <span>Recent Projects ({projects.length})</span>
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {projects.map((proj) => (
                  <div
                    key={proj.id}
                    onClick={() => {
                      loadProject(proj);
                      fileInputRef.current?.click();
                    }}
                    className="p-4 rounded-2xl bg-[#0B1220] border border-slate-800 hover:border-emerald-500/50 hover:bg-[#0E1729] cursor-pointer transition-all duration-200 group relative flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="p-2 rounded-lg bg-slate-800/80 group-hover:bg-emerald-500/20 text-slate-300 group-hover:text-emerald-400 transition-colors">
                          <Film className="w-4 h-4" />
                        </div>
                        <button
                          onClick={(e) => deleteProject(proj.id, e)}
                          className="text-slate-500 hover:text-red-400 p-1 transition-colors"
                          title="Delete project"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <h4 className="font-bold text-white text-sm truncate mb-1" title={proj.videoName}>
                        {proj.videoName}
                      </h4>
                      <p className="text-[11px] text-slate-400 font-mono-code mb-3">
                        {proj.captionsCount || proj.captions?.length || 0} subtitles • {new Date(proj.updatedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                      <span>Open & Resume</span>
                      <span>→</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>
    );
  }

  // ==========================================
  // VIEW 2: STUDIO EDITOR (VIDEO LOADED)
  // ==========================================
  return (
    <div className="min-h-screen bg-[#070B14] flex flex-col selection:bg-emerald-500 selection:text-black">
      <canvas ref={exportCanvasRef} className="hidden" />
      <input
        ref={replaceVideoInputRef}
        type="file"
        accept="video/*,.mp4,.mov,.m4v,.webm,.mkv"
        className="hidden"
        onChange={handleReplaceVideoFile}
      />

      {/* Studio Header */}
      <header className="border-b border-slate-800/90 bg-[#0A101D]/90 backdrop-blur-md sticky top-0 z-40 px-3 sm:px-6 py-2.5 sm:py-0 min-h-14 sm:h-16 flex flex-wrap items-center justify-between gap-2.5 pt-safe">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <div className="flex items-center gap-2 shrink-0">
            <img
              src="https://i.ibb.co/7dJC2S3T/364-FE17-A-FAC3-406-E-8-B53-5803-DE3-F524-A.png"
              alt="Savos"
              className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl object-cover ring-1 ring-emerald-500/40"
            />
            <span className="font-display font-extrabold text-sm sm:text-lg text-white tracking-tight truncate">Savos</span>
            <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 sm:px-2 py-0.5 rounded-full hidden xs:inline">
              Somali
            </span>
          </div>

          <div className="h-4 w-[1px] bg-slate-700 hidden md:block"></div>

          {/* Video Title Chip */}
          <div className="hidden lg:flex items-center gap-2 bg-slate-900/90 border border-slate-800/90 px-3 py-1 rounded-lg max-w-xs truncate text-xs text-slate-300">
            <FileVideo className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="truncate">{videoFile.name}</span>
          </div>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 flex-wrap justify-end">
          <OfflineIndicator />
          <PWAInstallButton />

          {/* Global Undo / Redo Controls */}
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-xs text-slate-400">
            <button
              onClick={handleUndoCaptions}
              disabled={captionsHistory.length === 0}
              className="p-1 sm:p-1.5 rounded-md hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-all"
              title="Dib u noqo (Undo - Ctrl+Z)"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleRedoCaptions}
              disabled={redoHistory.length === 0}
              className="p-1 sm:p-1.5 rounded-md hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-all"
              title="Horay u soco (Redo - Ctrl+Y)"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {saveToast && (
            <span className="text-[11px] sm:text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-2 sm:px-3 py-1 rounded-lg font-medium animate-in fade-in flex items-center gap-1">
              <Check className="w-3 h-3 text-emerald-400" />
              <span className="truncate max-w-[120px]">{saveToast}</span>
            </span>
          )}

          {/* Social Media Canvas Presets Switcher (Desktop / Tablet) */}
          <div className="hidden md:flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-xs font-semibold text-slate-400">
            <button
              onClick={() => handleAspectRatioChange('original')}
              className={`px-2 py-1 rounded-md transition-all ${aspectRatioPreset === 'original' ? 'bg-slate-800 text-white shadow-sm' : 'hover:text-slate-200'}`}
              title="Asalka (Original Ratio)"
            >
              Orig
            </button>
            <button
              onClick={() => handleAspectRatioChange('9:16')}
              className={`px-2 py-1 rounded-md transition-all ${aspectRatioPreset === '9:16' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm' : 'hover:text-slate-200'}`}
              title="9:16 Vertical (TikTok, Reels, Shorts)"
            >
              9:16
            </button>
            <button
              onClick={() => handleAspectRatioChange('16:9')}
              className={`px-2 py-1 rounded-md transition-all ${aspectRatioPreset === '16:9' ? 'bg-slate-800 text-white shadow-sm' : 'hover:text-slate-200'}`}
              title="16:9 Widescreen (YouTube, Landscape)"
            >
              16:9
            </button>
            <button
              onClick={() => handleAspectRatioChange('1:1')}
              className={`px-2 py-1 rounded-md transition-all ${aspectRatioPreset === '1:1' ? 'bg-slate-800 text-white shadow-sm' : 'hover:text-slate-200'}`}
              title="1:1 Square (Instagram Post)"
            >
              1:1
            </button>
            <button
              onClick={() => handleAspectRatioChange('4:5')}
              className={`px-2 py-1 rounded-md transition-all ${aspectRatioPreset === '4:5' ? 'bg-slate-800 text-white shadow-sm' : 'hover:text-slate-200'}`}
              title="4:5 Portrait (Instagram Portrait)"
            >
              4:5
            </button>
          </div>

          {/* Replace Video Button */}
          <button
            onClick={() => replaceVideoInputRef.current?.click()}
            className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm active:scale-95"
            title="Replace the current video with a new file"
          >
            <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Replace</span>
          </button>

          <button
            onClick={saveCurrentProject}
            disabled={isSaving}
            className="bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700/80 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-50 active:scale-95"
            title="Save current project and subtitles"
          >
            <Bookmark className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">{isSaving ? 'Saving...' : 'Save'}</span>
          </button>

          {/* Quick Fast Export / Cancel Button */}
          {isDownloading ? (
            <button
              type="button"
              onClick={handleCancelDownload}
              className="bg-rose-500/20 hover:bg-rose-500/35 text-rose-300 hover:text-white border border-rose-500/40 px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-black flex items-center gap-1.5 transition-all shadow-md active:scale-95"
              title="Jooji soo dejinta muuqaalka (Cancel Download)"
            >
              <X className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Cancel ({downloadProgress}%)</span>
            </button>
          ) : (
            <button
              onClick={handleDownload}
              disabled={!videoFile}
              className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-black flex items-center gap-1.5 transition-all shadow-md shadow-emerald-500/25 active:scale-95 disabled:opacity-50"
              title="Download full video with captions and sound (Fast HD MP4 Export)"
            >
              <Download className="w-3.5 h-3.5 stroke-[2.5]" />
              <span className="hidden xs:inline">Download</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Studio Workspace */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* LEFT / CENTER: Video Stage, Player & AI Actions */}
        <div className="flex-1 p-2.5 sm:p-4 lg:p-6 flex flex-col items-center justify-start overflow-y-auto max-w-5xl mx-auto w-full pb-24 lg:pb-6 custom-scrollbar">
          {/* Dynamic Video Stage Frame matching exact video aspect ratio */}
          <div className="w-full flex items-center justify-center mb-2 sm:mb-3">
            <div
              className="bg-black rounded-2xl sm:rounded-3xl overflow-hidden shadow-2xl relative group border border-slate-800 flex items-center justify-center transition-all duration-300"
              style={{
                aspectRatio: `${aspectRatio}`,
                maxHeight: '40vh',
                maxWidth: '100%',
                width: aspectRatio < 1 ? `min(100%, calc(40vh * ${aspectRatio}))` : `min(100%, calc(40vh * ${aspectRatio}))`,
                height: 'auto',
              }}
            >
              <video
                key={videoUrl || 'empty-video'}
                ref={videoRef}
                src={videoUrl || ''}
                className="w-full h-full object-contain cursor-pointer"
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => {
                  if (isExportingRecordingRef.current) return;
                  setIsPlaying(false);
                  const endBoundary = (videoTrimEnd > 0 ? videoTrimEnd : duration) || videoRef.current?.duration || 0;
                  setCurrentTime(endBoundary);
                }}
                onTimeUpdate={() => {
                  if (isExportingRecordingRef.current) return;
                  const v = videoRef.current;
                  if (!v) return;
                  const cur = v.currentTime || 0;
                  const endBoundary = (videoTrimEnd > 0 ? videoTrimEnd : duration) || v.duration || 0;

                  if (videoTrimStart > 0 && cur < videoTrimStart) {
                    v.currentTime = videoTrimStart;
                    setCurrentTime(videoTrimStart);
                    return;
                  }
                  if (endBoundary > 0 && cur >= endBoundary) {
                    v.pause();
                    setIsPlaying(false);
                    setCurrentTime(endBoundary);
                    return;
                  }
                  setCurrentTime(cur);
                }}
                onSeeked={() => {
                  setCurrentTime(videoRef.current?.currentTime || 0);
                  drawPreviewFrame();
                }}
                onLoadedMetadata={() => {
                  const v = videoRef.current;
                  if (!v) return;
                  const dur = Number.isFinite(v.duration) ? v.duration : 0;
                  setDuration(dur);
                  setVideoTrimEnd((prevEnd) => (prevEnd === 0 || prevEnd > dur ? dur : prevEnd));
                  const naturalRatio = (v.videoWidth && v.videoHeight) ? (v.videoWidth / v.videoHeight) : (16 / 9);
                  if (aspectRatioPreset === 'original') {
                    setAspectRatio(naturalRatio);
                  }
                }}
                onClick={togglePlay}
                playsInline
              />

              {/* Synchronized Real-Time Canvas Overlay */}
              <canvas ref={previewCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

              {/* Centered Play / Replay Button Overlay when paused */}
              {!isPlaying && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePlay();
                  }}
                  className="absolute inset-0 m-auto w-16 h-16 rounded-full bg-emerald-500/90 hover:bg-emerald-400 text-slate-950 flex items-center justify-center shadow-2xl shadow-emerald-500/40 transition-transform transform hover:scale-110 group z-10"
                  title={currentTime >= (duration - 0.2) ? 'Replay video' : 'Play video'}
                >
                  {currentTime >= (duration - 0.2) ? (
                    <RotateCcw className="w-8 h-8 text-slate-950 group-hover:rotate-[-45deg] transition-transform" />
                  ) : (
                    <Play className="w-8 h-8 fill-current ml-1" />
                  )}
                </button>
              )}

              {/* Quick Hover Controls Overlay */}
              <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-2 z-10">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleMute();
                  }}
                  className="p-2 rounded-full bg-black/70 hover:bg-black text-white backdrop-blur-md transition-colors"
                  title={isMuted ? 'Unmute audio' : 'Mute audio'}
                >
                  {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          {/* Professional Video Playback Bar */}
          <div className="w-full mt-4 bg-[#0A101E] border border-slate-800/90 rounded-2xl p-4 shadow-xl">
            {/* Scrubber with Subtitle Markers */}
            <div className="relative mb-3 flex items-center">
              <input
                type="range"
                min="0"
                max={duration || 100}
                step="0.05"
                value={currentTime}
                onChange={(e) => handleSeek(parseFloat(e.target.value))}
                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer range-slider relative z-10"
              />
              {/* Colored Subtitle Markers along timeline */}
              {duration > 0 &&
                captions.map((cap) => {
                  const left = `${(cap.startTime / duration) * 100}%`;
                  const width = `${Math.max(1, ((cap.endTime - cap.startTime) / duration) * 100)}%`;
                  return (
                    <div
                      key={cap.id}
                      onClick={() => handleSeek(cap.startTime)}
                      className="absolute top-1/2 -translate-y-1/2 h-1.5 bg-emerald-400/70 hover:bg-emerald-300 rounded-sm cursor-pointer pointer-events-auto transition-colors z-20"
                      style={{ left, width }}
                      title={`${cap.text} (${cap.startTime}s - ${cap.endTime}s)`}
                    />
                  );
                })}
            </div>

            {/* Playback Controls Row */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {/* Jump to Beginning (00:00) */}
                <button
                  onClick={handleGoToStart}
                  className="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-emerald-400 transition-colors border border-slate-800"
                  title="Jump to start (00:00)"
                >
                  <SkipBack className="w-4 h-4" />
                </button>

                {/* Rewind 5 seconds */}
                <button
                  onClick={() => handleSkip(-5)}
                  className="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white transition-colors border border-slate-800"
                  title="Rewind 5 seconds (-5s)"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>

                {/* Play / Pause / Replay Button */}
                <button
                  onClick={togglePlay}
                  className="w-10 h-10 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 flex items-center justify-center font-bold transition-all shadow-md shadow-emerald-500/20"
                  title={isPlaying ? 'Pause' : (currentTime >= duration - 0.2 ? 'Replay' : 'Play')}
                >
                  {isPlaying ? (
                    <Pause className="w-5 h-5 fill-current" />
                  ) : currentTime >= duration - 0.2 ? (
                    <RotateCcw className="w-5 h-5" />
                  ) : (
                    <Play className="w-5 h-5 fill-current ml-0.5" />
                  )}
                </button>

                {/* Forward 5 seconds */}
                <button
                  onClick={() => handleSkip(5)}
                  className="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white transition-colors border border-slate-800"
                  title="Forward 5 seconds (+5s)"
                >
                  <RotateCw className="w-4 h-4" />
                </button>

                {/* Jump to End */}
                <button
                  onClick={handleGoToEnd}
                  className="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-emerald-400 transition-colors border border-slate-800"
                  title="Jump to end"
                >
                  <SkipForward className="w-4 h-4" />
                </button>

                {/* Digital Timecode Display */}
                <div className="ml-2 font-mono-code text-xs font-semibold text-slate-300 bg-slate-900/90 border border-slate-800 px-3 py-1.5 rounded-lg">
                  <span className="text-emerald-400">{formatDigitalTime(currentTime)}</span>
                  <span className="text-slate-600 mx-1">/</span>
                  <span className="text-slate-400">{formatDigitalTime(duration)}</span>
                </div>
              </div>

              {/* Right Playback Helpers */}
              <div className="flex items-center gap-2">
                {/* Playback Speed */}
                <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-xs font-semibold text-slate-400">
                  {[0.75, 1, 1.25, 1.5].map((speed) => (
                    <button
                      key={speed}
                      onClick={() => handleSpeedChange(speed)}
                      className={`px-2 py-1 rounded-md transition-all ${
                        playbackRate === speed ? 'bg-slate-800 text-emerald-400' : 'hover:text-slate-200'
                      }`}
                    >
                      {speed}x
                    </button>
                  ))}
                </div>

                {/* Volume Controls */}
                <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1">
                  <button
                    onClick={toggleMute}
                    className="p-1 text-slate-300 hover:text-white transition-colors"
                    title={isMuted ? 'Unmute' : 'Mute'}
                  >
                    {isMuted || volume === 0 ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={isMuted ? 0 : volume}
                    onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                    className="w-16 h-1.5 bg-slate-800 rounded-lg cursor-pointer accent-emerald-500"
                    title="Volume"
                  />
                  <span className="text-[11px] font-mono-code font-bold text-slate-400 w-7 text-right">
                    {isMuted ? '0%' : `${Math.round(volume * 100)}%`}
                  </span>
                </div>

                <button
                  onClick={testAudioPlay}
                  className="px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  title="Test audio playback"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Test Audio</span>
                </button>
              </div>
            </div>
          </div>

          {/* Mobile Segmented Navigation Bar (Mobile-Only: < lg) */}
          <div className="lg:hidden w-full mt-3 bg-[#0A101E] border border-slate-800/90 rounded-2xl p-1.5 flex items-center gap-1 shadow-lg overflow-x-auto no-scrollbar">
            <button
              onClick={() => setActiveTab(Tab.TEXT)}
              className={`flex-1 min-w-[68px] py-2 px-1.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 whitespace-nowrap active:scale-95 ${
                activeTab === Tab.TEXT
                  ? 'bg-emerald-500 text-slate-950 font-black shadow-md shadow-emerald-500/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Type className="w-3.5 h-3.5" />
              <span>Captions</span>
              {captions.length > 0 && (
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono-code font-bold ${
                    activeTab === Tab.TEXT ? 'bg-slate-950/20 text-slate-950' : 'bg-slate-800 text-emerald-400'
                  }`}
                >
                  {captions.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab(Tab.TIMELINE)}
              className={`flex-1 min-w-[68px] py-2 px-1.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 whitespace-nowrap active:scale-95 ${
                activeTab === Tab.TIMELINE
                  ? 'bg-emerald-500 text-slate-950 font-black shadow-md shadow-emerald-500/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Timeline</span>
            </button>

            <button
              onClick={() => setActiveTab(Tab.STYLE)}
              className={`flex-1 min-w-[68px] py-2 px-1.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 whitespace-nowrap active:scale-95 ${
                activeTab === Tab.STYLE
                  ? 'bg-emerald-500 text-slate-950 font-black shadow-md shadow-emerald-500/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Palette className="w-3.5 h-3.5" />
              <span>Styling</span>
            </button>

            <button
              onClick={() => setActiveTab(Tab.EXPORT)}
              className={`flex-1 min-w-[68px] py-2 px-1.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 whitespace-nowrap active:scale-95 ${
                activeTab === Tab.EXPORT
                  ? 'bg-emerald-500 text-slate-950 font-black shadow-md shadow-emerald-500/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export</span>
            </button>

            <button
              onClick={() => setActiveTab(Tab.PROJECTS)}
              className={`flex-1 min-w-[68px] py-2 px-1.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 whitespace-nowrap active:scale-95 ${
                activeTab === Tab.PROJECTS
                  ? 'bg-emerald-500 text-slate-950 font-black shadow-md shadow-emerald-500/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>Projects</span>
            </button>
          </div>

          {/* Mobile Active Tab Content (< lg) */}
          <div className="lg:hidden w-full mt-3">
            {activeTab === Tab.TEXT && (
              <div className="w-full space-y-3">
                {renderAiAction()}
                {renderSyncStrip()}
                {renderErrorMessage()}
                <div className="bg-[#0A101E] border border-slate-800/90 rounded-2xl p-3.5 sm:p-4 shadow-xl">
                  {renderCaptionsTab()}
                </div>
              </div>
            )}
            {activeTab === Tab.TIMELINE && (
              <div className="w-full space-y-3">
                {renderTimeline()}
                {renderSyncStrip()}
              </div>
            )}
            {activeTab === Tab.STYLE && (
              <div className="w-full bg-[#0A101E] border border-slate-800/90 rounded-2xl p-4 sm:p-5 shadow-xl">
                {renderStyleTab()}
              </div>
            )}
            {activeTab === Tab.EXPORT && (
              <div className="w-full">
                {renderExportHub()}
              </div>
            )}
            {activeTab === Tab.PROJECTS && (
              <div className="w-full bg-[#0A101E] border border-slate-800/90 rounded-2xl p-4 sm:p-5 shadow-xl">
                {renderProjectsTab()}
              </div>
            )}
          </div>

          {/* Desktop Left Column Under Playback Controls (>= lg) */}
          <div className="hidden lg:flex flex-col gap-4 w-full mt-4">
            {renderTimeline()}
            <div className="w-full flex flex-col gap-3">
              {renderAiAction()}
              {renderSyncStrip()}
            </div>
            {renderErrorMessage()}
            {renderExportHub()}
          </div>
        </div>

        {/* RIGHT: Studio Control Sidebar for Desktop (>= lg) */}
        <aside className="hidden lg:flex w-full lg:w-[420px] bg-[#0A101E] border-l border-slate-800/90 flex-col h-[calc(100vh-4rem)] sticky top-16 shrink-0">
          {/* Tab Navigation */}
          <div className="flex border-b border-slate-800/90 p-2 bg-[#080D18] gap-1">
            <button
              onClick={() => setActiveTab(Tab.TEXT)}
              className={`flex-1 py-2.5 flex items-center justify-center gap-2 text-xs font-bold transition-all rounded-xl ${
                activeTab === Tab.TEXT
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Type className="w-3.5 h-3.5" />
              <span>Captions</span>
              <span className="text-[10px] bg-slate-800 px-1.5 py-0.2 rounded-full font-mono-code">
                {captions.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab(Tab.STYLE)}
              className={`flex-1 py-2.5 flex items-center justify-center gap-2 text-xs font-bold transition-all rounded-xl ${
                activeTab === Tab.STYLE
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Palette className="w-3.5 h-3.5" />
              <span>Styling</span>
            </button>

            <button
              onClick={() => setActiveTab(Tab.EXPORT)}
              className={`flex-1 py-2.5 flex items-center justify-center gap-2 text-xs font-bold transition-all rounded-xl ${
                activeTab === Tab.EXPORT
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export</span>
            </button>

            <button
              onClick={() => setActiveTab(Tab.PROJECTS)}
              className={`flex-1 py-2.5 flex items-center justify-center gap-2 text-xs font-bold transition-all rounded-xl ${
                activeTab === Tab.PROJECTS
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>Projects</span>
            </button>
          </div>

          {/* Tab Body */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 custom-scrollbar">
            {/* ------------------------------------ */}
            {/* TAB 1: CAPTIONS LIST                 */}
            {/* ------------------------------------ */}
            {activeTab === Tab.TEXT && renderCaptionsTab()}

            {activeTab === Tab.STYLE && renderStyleTab()}

            {activeTab === Tab.EXPORT && renderExportHub()}
            {activeTab === Tab.PROJECTS && renderProjectsTab()}
          </div>
        </aside>
      </div>
    </div>
  );
}
