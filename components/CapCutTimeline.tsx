import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Scissors,
  Plus,
  Trash2,
  ZoomIn,
  ZoomOut,
  Play,
  Pause,
  Clock,
  Edit3,
  X,
  Film,
  Move,
  GripVertical,
  RotateCcw,
  SkipBack,
  SkipForward,
  Maximize2
} from 'lucide-react';
import { Caption } from '../types';

export interface CapCutTimelineProps {
  currentTime: number;
  duration: number;
  captions: Caption[];
  onSeek: (time: number) => void;
  onUpdateCaption: (id: string, updates: Partial<Caption>) => void;
  onDeleteCaption: (id: string) => void;
  onAddCaption: (atTime: number) => void;
  onSplitCaption: (id: string, atTime: number) => void;
  selectedCaptionId: string | null;
  onSelectCaption: (id: string | null) => void;
  videoTrimStart: number;
  videoTrimEnd: number;
  onChangeVideoTrim: (start: number, end: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  videoUrl?: string | null;
}

interface VideoThumbnail {
  time: number;
  url: string;
}

export const CapCutTimeline: React.FC<CapCutTimelineProps> = ({
  currentTime,
  duration,
  captions,
  onSeek,
  onUpdateCaption,
  onDeleteCaption,
  onAddCaption,
  onSplitCaption,
  selectedCaptionId,
  onSelectCaption,
  videoTrimStart,
  videoTrimEnd,
  onChangeVideoTrim,
  isPlaying,
  onTogglePlay,
  videoUrl,
}) => {
  // Zoom level: pixels per second (responsive default)
  const [zoom, setZoom] = useState<number>(60);
  const [isEditingText, setIsEditingText] = useState(false);
  const [editTextVal, setEditTextVal] = useState('');

  // Thumbnails filmstrip state for video track (Requirement 1)
  const [thumbnails, setThumbnails] = useState<VideoThumbnail[]>([]);
  const [isExtractingThumbs, setIsExtractingThumbs] = useState(false);

  // Dragging interaction state (Requirements 2 & 3)
  const [draggingType, setDraggingType] = useState<
    'playhead' | 'caption-move' | 'caption-resize-start' | 'caption-resize-end' | 'video-trim-start' | 'video-trim-end' | null
  >(null);
  const [dragCaptionId, setDragCaptionId] = useState<string | null>(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragInitialTime, setDragInitialTime] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [dragCurrentTimes, setDragCurrentTimes] = useState<{ start: number; end: number } | null>(null);

  const timelineContainerRef = useRef<HTMLDivElement>(null);
  const trackAreaRef = useRef<HTMLDivElement>(null);

  const effectiveDuration = Math.max(duration || 10, 5);
  const currentTrimEnd = (videoTrimEnd && videoTrimEnd > 0) ? Math.min(videoTrimEnd, effectiveDuration) : effectiveDuration;
  // Add 260px right scroll buffer so playhead and captions at the end can be scrolled into comfortable view
  const totalWidth = Math.max(800, effectiveDuration * zoom) + 260;

  const selectedCaption = captions.find((c) => c.id === selectedCaptionId);

  // Smoothly scroll the timeline container to keep target time visible
  const scrollToTime = useCallback((time: number, smooth: boolean = true) => {
    if (!timelineContainerRef.current) return;
    const container = timelineContainerRef.current;
    const playheadPos = time * zoom;
    const visibleWidth = container.clientWidth;
    const targetScrollLeft = Math.max(0, playheadPos - visibleWidth / 2);
    container.scrollTo({
      left: targetScrollLeft,
      behavior: smooth ? 'smooth' : 'auto',
    });
  }, [zoom]);

  // Jump to beginning (00:00 / boporada)
  const handleJumpStart = useCallback(() => {
    const target = videoTrimStart || 0;
    onSeek(target);
    scrollToTime(target, true);
  }, [videoTrimStart, onSeek, scrollToTime]);

  // Jump to end of video (dhammaadka)
  const handleJumpEnd = useCallback(() => {
    const target = currentTrimEnd;
    onSeek(target);
    scrollToTime(target, true);
  }, [currentTrimEnd, onSeek, scrollToTime]);

  // Step 5s backward
  const handleStepBack = useCallback(() => {
    const target = Math.max(videoTrimStart || 0, currentTime - 5);
    onSeek(target);
    scrollToTime(target, true);
  }, [videoTrimStart, currentTime, onSeek, scrollToTime]);

  // Step 5s forward
  const handleStepForward = useCallback(() => {
    const target = Math.min(currentTrimEnd, currentTime + 5);
    onSeek(target);
    scrollToTime(target, true);
  }, [currentTrimEnd, currentTime, onSeek, scrollToTime]);

  // Fit all video onto screen so user sees entire duration without horizontal scroll
  const handleFitToScreen = useCallback(() => {
    if (!timelineContainerRef.current) return;
    const containerWidth = timelineContainerRef.current.clientWidth - 40;
    const fittedZoom = Math.max(12, Math.min(180, Math.floor(containerWidth / effectiveDuration)));
    setZoom(fittedZoom);
    timelineContainerRef.current.scrollTo({ left: 0, behavior: 'smooth' });
  }, [effectiveDuration]);

  // Auto-scroll timeline to follow playhead when playing video
  useEffect(() => {
    if (!isPlaying || !timelineContainerRef.current || draggingType) return;
    const container = timelineContainerRef.current;
    const playheadPos = currentTime * zoom;
    const scrollLeft = container.scrollLeft;
    const visibleWidth = container.clientWidth;

    if (playheadPos > scrollLeft + visibleWidth - 80) {
      container.scrollTo({
        left: playheadPos - visibleWidth * 0.3,
        behavior: 'smooth',
      });
    } else if (playheadPos < scrollLeft) {
      container.scrollTo({
        left: Math.max(0, playheadPos - 40),
        behavior: 'smooth',
      });
    }
  }, [currentTime, isPlaying, zoom, draggingType]);

  // Sync edit text when selected caption changes
  useEffect(() => {
    if (selectedCaption) {
      setEditTextVal(selectedCaption.text);
    } else {
      setIsEditingText(false);
    }
  }, [selectedCaptionId, selectedCaption?.text]);

  // Format seconds to mm:ss.ms
  const formatTimecode = (sec: number) => {
    const s = Math.max(0, sec || 0);
    const m = Math.floor(s / 60);
    const remS = Math.floor(s % 60);
    const ms = Math.floor((s % 1) * 10);
    return `${String(m).padStart(2, '0')}:${String(remS).padStart(2, '0')}.${ms}`;
  };

  // Convert clientX to timeline seconds based on track bounding rect
  const getTimeFromClientX = useCallback(
    (clientX: number) => {
      if (!trackAreaRef.current) return 0;
      const rect = trackAreaRef.current.getBoundingClientRect();
      const clickX = clientX - rect.left;
      const time = clickX / zoom;
      return Math.max(0, Math.min(effectiveDuration, parseFloat(time.toFixed(2))));
    },
    [zoom, effectiveDuration]
  );

  // 1. EXTRACT REAL VIDEO THUMBNAILS FOR THE FILMSTRIP (Requirement 1)
  useEffect(() => {
    setThumbnails([]);
    if (!videoUrl || effectiveDuration <= 0) return;

    let isCancelled = false;
    setIsExtractingThumbs(true);

    const video = document.createElement('video');
    video.src = videoUrl;
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'auto';

    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 68;
    const ctx = canvas.getContext('2d');

    // Extract between 10 and 18 thumbnails across the video
    const sampleCount = Math.min(18, Math.max(10, Math.floor(effectiveDuration / 2)));
    const sampleTimes: number[] = [];
    const step = effectiveDuration / sampleCount;

    for (let i = 0; i < sampleCount; i++) {
      sampleTimes.push(Math.min(effectiveDuration - 0.05, Math.max(0.05, i * step)));
    }

    const capturedThumbs: VideoThumbnail[] = [];
    let idx = 0;

    const captureNext = () => {
      if (isCancelled || idx >= sampleTimes.length) {
        if (!isCancelled && capturedThumbs.length > 0) {
          setThumbnails(capturedThumbs);
        }
        setIsExtractingThumbs(false);
        video.src = '';
        return;
      }
      video.currentTime = sampleTimes[idx];
    };

    video.onseeked = () => {
      if (isCancelled) return;
      if (ctx) {
        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const url = canvas.toDataURL('image/jpeg', 0.55);
          capturedThumbs.push({ time: sampleTimes[idx], url });
        } catch {
          // ignore potential canvas taint
        }
      }
      idx++;
      captureNext();
    };

    video.onerror = () => {
      setIsExtractingThumbs(false);
    };

    const safetyTimeout = setTimeout(() => {
      if (!isCancelled && capturedThumbs.length > 0) {
        setThumbnails(capturedThumbs);
      }
      setIsExtractingThumbs(false);
    }, 6000);

    video.onloadedmetadata = () => {
      captureNext();
    };

    video.load();

    return () => {
      isCancelled = true;
      clearTimeout(safetyTimeout);
      video.src = '';
    };
  }, [videoUrl, effectiveDuration]);

  // Current closest thumbnail for floating live scrubber preview
  const closestThumbnail = useMemo(() => {
    if (thumbnails.length === 0) return null;
    return thumbnails.reduce((prev, curr) => {
      return Math.abs(curr.time - currentTime) < Math.abs(prev.time - currentTime) ? curr : prev;
    }, thumbnails[0]);
  }, [thumbnails, currentTime]);

  // Active caption at current playhead
  const activeCaptionNow = useMemo(() => {
    return captions.find((c) => currentTime >= c.startTime && currentTime <= c.endTime);
  }, [captions, currentTime]);

  // 2. UNIFIED TOUCH & POINTER DRAG HANDLING (Requirements 2 & 3)
  // Handles mouse and mobile finger dragging seamlessly with preventDefault to stop mobile screen scroll
  useEffect(() => {
    if (!draggingType) return;

    // Prevent text selection and unwanted gesture scrolling while dragging
    const originalUserSelect = document.body.style.userSelect;
    const originalTouchAction = document.body.style.touchAction;
    document.body.style.userSelect = 'none';
    document.body.style.touchAction = 'none';

    const handlePointerMove = (e: PointerEvent | MouseEvent | TouchEvent) => {
      e.preventDefault();
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      const deltaX = clientX - dragStartX;
      const deltaTime = deltaX / zoom;

      if (draggingType === 'playhead') {
        const newTime = getTimeFromClientX(clientX);
        onSeek(newTime);
        // Auto-scroll timeline container if dragging near container edges
        if (timelineContainerRef.current) {
          const container = timelineContainerRef.current;
          const rect = container.getBoundingClientRect();
          const margin = 50;
          if (clientX > rect.right - margin) {
            container.scrollLeft += 12;
          } else if (clientX < rect.left + margin) {
            container.scrollLeft -= 12;
          }
        }
      } else if (draggingType === 'caption-move' && dragCaptionId) {
        const capDuration = dragInitialTime.end - dragInitialTime.start;
        const proposedStart = dragInitialTime.start + deltaTime;
        const newStart = Math.max(0, Math.min(effectiveDuration - capDuration, parseFloat(proposedStart.toFixed(2))));
        const newEnd = parseFloat((newStart + capDuration).toFixed(2));
        setDragCurrentTimes({ start: newStart, end: newEnd });
        onUpdateCaption(dragCaptionId, { startTime: newStart, endTime: newEnd });
      } else if (draggingType === 'caption-resize-start' && dragCaptionId) {
        // Shorten or lengthen from left (startTime)
        const proposedStart = dragInitialTime.start + deltaTime;
        const maxStart = dragInitialTime.end - 0.2; // minimum length 0.2s
        const newStart = Math.max(0, Math.min(maxStart, parseFloat(proposedStart.toFixed(2))));
        setDragCurrentTimes({ start: newStart, end: dragInitialTime.end });
        onUpdateCaption(dragCaptionId, { startTime: newStart });
      } else if (draggingType === 'caption-resize-end' && dragCaptionId) {
        // Shorten or lengthen from right (endTime)
        const proposedEnd = dragInitialTime.end + deltaTime;
        const minEnd = dragInitialTime.start + 0.2; // minimum length 0.2s
        const newEnd = Math.max(minEnd, Math.min(effectiveDuration, parseFloat(proposedEnd.toFixed(2))));
        setDragCurrentTimes({ start: dragInitialTime.start, end: newEnd });
        onUpdateCaption(dragCaptionId, { endTime: newEnd });
      } else if (draggingType === 'video-trim-start') {
        const proposedStart = dragInitialTime.start + deltaTime;
        const newStart = Math.max(0, Math.min(currentTrimEnd - 0.5, parseFloat(proposedStart.toFixed(2))));
        onChangeVideoTrim(newStart, currentTrimEnd);
      } else if (draggingType === 'video-trim-end') {
        const proposedEnd = dragInitialTime.end + deltaTime;
        const newEnd = Math.max((videoTrimStart || 0) + 0.5, Math.min(effectiveDuration, parseFloat(proposedEnd.toFixed(2))));
        onChangeVideoTrim(videoTrimStart || 0, newEnd);
      }
    };

    const handlePointerUp = () => {
      setDraggingType(null);
      setDragCaptionId(null);
      setDragCurrentTimes(null);
      document.body.style.userSelect = originalUserSelect;
      document.body.style.touchAction = originalTouchAction;
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    window.addEventListener('touchmove', handlePointerMove, { passive: false });
    window.addEventListener('touchend', handlePointerUp);
    window.addEventListener('touchcancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('touchend', handlePointerUp);
      window.removeEventListener('touchcancel', handlePointerUp);
      document.body.style.userSelect = originalUserSelect;
      document.body.style.touchAction = originalTouchAction;
    };
  }, [
    draggingType,
    dragStartX,
    dragInitialTime,
    dragCaptionId,
    zoom,
    effectiveDuration,
    getTimeFromClientX,
    onSeek,
    onUpdateCaption,
    onChangeVideoTrim,
    videoTrimStart,
    videoTrimEnd,
    currentTrimEnd,
  ]);

  // Ruler click/drag: explicitly seeks and starts dragging the playhead
  const handleRulerPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    const clickedTime = getTimeFromClientX(e.clientX);
    onSeek(clickedTime);
    setDraggingType('playhead');
    setDragStartX(e.clientX);
  };

  // Track area tap vs horizontal swipe:
  // If user swipes horizontally on track area, it scrolls without getting blocked.
  // If it's a quick tap without movement, it jumps the playhead to that point.
  const trackTapStart = useRef<{ x: number; y: number; time: number } | null>(null);

  const handleTrackPointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('.timeline-block') || target.closest('.resize-handle') || target.closest('.playhead-handle')) {
      return;
    }
    trackTapStart.current = { x: e.clientX, y: e.clientY, time: Date.now() };
  };

  const handleTrackPointerUp = (e: React.PointerEvent) => {
    if (!trackTapStart.current) return;
    const dx = Math.abs(e.clientX - trackTapStart.current.x);
    const dy = Math.abs(e.clientY - trackTapStart.current.y);
    const dt = Date.now() - trackTapStart.current.time;
    trackTapStart.current = null;

    if (dx < 12 && dy < 12 && dt < 400) {
      const target = e.target as HTMLElement;
      if (target.closest('.timeline-block') || target.closest('.resize-handle') || target.closest('.playhead-handle')) {
        return;
      }
      const clickedTime = getTimeFromClientX(e.clientX);
      onSeek(clickedTime);
    }
  };

  // Start dragging the playhead (diamond head or vertical line) (Requirement 3)
  const handlePlayheadPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDraggingType('playhead');
    setDragStartX(e.clientX);
  };

  // Start dragging a caption block forward / backward (Requirement 2)
  const handleCaptionPointerDown = (e: React.PointerEvent, cap: Caption) => {
    e.stopPropagation();
    e.preventDefault();
    onSelectCaption(cap.id);
    onSeek(cap.startTime);
    setDraggingType('caption-move');
    setDragCaptionId(cap.id);
    setDragStartX(e.clientX);
    setDragInitialTime({ start: cap.startTime, end: cap.endTime });
    setDragCurrentTimes({ start: cap.startTime, end: cap.endTime });
  };

  // Start resizing caption left (startTime - gaabi/dheeree bilowga) (Requirement 2)
  const handleResizeStartPointerDown = (e: React.PointerEvent, cap: Caption) => {
    e.stopPropagation();
    e.preventDefault();
    onSelectCaption(cap.id);
    setDraggingType('caption-resize-start');
    setDragCaptionId(cap.id);
    setDragStartX(e.clientX);
    setDragInitialTime({ start: cap.startTime, end: cap.endTime });
    setDragCurrentTimes({ start: cap.startTime, end: cap.endTime });
  };

  // Start resizing caption right (endTime - gaabi/dheeree dhammaadka) (Requirement 2)
  const handleResizeEndPointerDown = (e: React.PointerEvent, cap: Caption) => {
    e.stopPropagation();
    e.preventDefault();
    onSelectCaption(cap.id);
    setDraggingType('caption-resize-end');
    setDragCaptionId(cap.id);
    setDragStartX(e.clientX);
    setDragInitialTime({ start: cap.startTime, end: cap.endTime });
    setDragCurrentTimes({ start: cap.startTime, end: cap.endTime });
  };

  // Split selected caption at current playhead
  const handleSplitAtPlayhead = () => {
    if (!selectedCaption) return;
    if (currentTime > selectedCaption.startTime + 0.1 && currentTime < selectedCaption.endTime - 0.1) {
      onSplitCaption(selectedCaption.id, currentTime);
    }
  };

  // Set End to Playhead (Jooji Hadda)
  const handleSetEndToPlayhead = () => {
    if (!selectedCaption) return;
    if (currentTime > selectedCaption.startTime + 0.1) {
      onUpdateCaption(selectedCaption.id, { endTime: parseFloat(currentTime.toFixed(2)) });
    }
  };

  // Trim video at playhead
  const handleTrimVideoStartAtPlayhead = () => {
    if (currentTime < videoTrimEnd - 0.5) {
      onChangeVideoTrim(parseFloat(currentTime.toFixed(2)), videoTrimEnd);
    }
  };

  const handleTrimVideoEndAtPlayhead = () => {
    if (currentTime > videoTrimStart + 0.5) {
      onChangeVideoTrim(videoTrimStart, parseFloat(currentTime.toFixed(2)));
    }
  };

  // Generate ruler tick marks
  const renderRulerTicks = () => {
    const ticks: React.ReactNode[] = [];
    const step = zoom >= 80 ? 0.5 : zoom >= 40 ? 1 : 2;

    for (let t = 0; t <= effectiveDuration; t += step) {
      const isMajor = Math.round(t) === t && t % (zoom >= 60 ? 1 : 5) === 0;
      const left = t * zoom;

      ticks.push(
        <div
          key={`tick-${t}`}
          className="absolute top-0 bottom-0 pointer-events-none flex flex-col justify-end"
          style={{ left }}
        >
          {isMajor && (
            <span className="text-[10px] font-mono-code text-slate-400 absolute top-1 -translate-x-1/2 select-none">
              {formatTimecode(t).replace('.0', '')}
            </span>
          )}
          <div
            className={`w-[1px] ${isMajor ? 'h-3 bg-slate-600' : 'h-1.5 bg-slate-800'}`}
          />
        </div>
      );
    }

    // Always render distinct End-of-video indicator on the ruler
    const endLeft = effectiveDuration * zoom;
    ticks.push(
      <div
        key="end-of-video-marker"
        className="absolute top-0 bottom-0 pointer-events-none flex flex-col justify-end items-center z-20"
        style={{ left: `${endLeft}px` }}
      >
        <span className="text-[9px] font-mono-code font-bold text-red-300 bg-red-950/90 px-1.5 py-0.5 rounded border border-red-500/50 absolute top-0.5 -translate-x-1/2 select-none whitespace-nowrap shadow-sm">
          End ({formatTimecode(effectiveDuration)})
        </span>
        <div className="w-[2px] h-full bg-red-500/70" />
      </div>
    );

    return ticks;
  };

  return (
    <div className="w-full bg-[#090E1A] border border-slate-800/90 rounded-2xl overflow-hidden shadow-2xl flex flex-col">
      {/* Sleek Timeline Action Toolbar */}
      <div className="bg-[#0D1424] border-b border-slate-800/80 px-2.5 sm:px-3.5 py-2 sm:py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
        {/* Left: Timecode readout & Primary Subtitle Tools */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
          {/* Timecode badge */}
          <div className="font-mono-code font-bold text-[11px] sm:text-xs bg-slate-900/90 border border-slate-800 px-2.5 py-1.5 rounded-lg text-slate-200 flex items-center gap-1 shadow-sm">
            <span className="text-emerald-400">{formatTimecode(currentTime)}</span>
            <span className="text-slate-600">/</span>
            <span className="text-slate-400">{formatTimecode(effectiveDuration)}</span>
          </div>

          <div className="h-4 w-[1px] bg-slate-800 hidden sm:block" />

          {/* ✂️ Split Subtitle Button */}
          <button
            onClick={handleSplitAtPlayhead}
            disabled={!selectedCaption || currentTime <= selectedCaption.startTime + 0.1 || currentTime >= selectedCaption.endTime - 0.1}
            className="bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-amber-300 border border-slate-800 hover:border-amber-500/40 px-2.5 sm:px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all active:scale-95 disabled:pointer-events-none min-h-[32px]"
            title="Split selected subtitle at playhead cursor"
          >
            <Scissors className="w-3.5 h-3.5" />
            <span>Split<span className="hidden sm:inline"> Subtitle</span></span>
          </button>

          {/* + Add Subtitle Button */}
          <button
            onClick={() => onAddCaption(currentTime)}
            className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2.5 sm:px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all active:scale-95 min-h-[32px]"
            title="Add a new subtitle block at playhead position"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add<span className="hidden sm:inline"> Subtitle</span></span>
          </button>

          {/* Set End to Playhead */}
          {selectedCaption && (
            <button
              onClick={handleSetEndToPlayhead}
              className="bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 px-2 sm:px-2.5 py-1.5 rounded-lg font-medium flex items-center gap-1.5 transition-all text-xs active:scale-95 min-h-[32px]"
              title="Snap end time of selected subtitle to playhead"
            >
              <Clock className="w-3.5 h-3.5 text-sky-400" />
              <span>Trim<span className="hidden sm:inline"> End</span></span>
            </button>
          )}

          {/* Delete Selected Caption */}
          {selectedCaption && (
            <button
              onClick={() => onDeleteCaption(selectedCaption.id)}
              className="p-1.5 sm:p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center"
              title="Delete selected subtitle"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Right: Video Trim Controls & Timeline Zoom */}
        <div className="flex items-center gap-1.5 sm:gap-2.5">
          {/* Video Trim Controls */}
          <div className="hidden sm:flex items-center gap-1 bg-slate-900/90 border border-slate-800 p-0.5 rounded-lg text-xs">
            <button
              onClick={handleTrimVideoStartAtPlayhead}
              className="px-2.5 py-1 hover:bg-slate-800 rounded text-slate-300 hover:text-white transition-colors"
              title="Trim video start to playhead"
            >
              Trim In [
            </button>
            <span className="text-slate-700">|</span>
            <button
              onClick={handleTrimVideoEndAtPlayhead}
              className="px-2.5 py-1 hover:bg-slate-800 rounded text-slate-300 hover:text-white transition-colors"
              title="Trim video end to playhead"
            >
              ] Trim Out
            </button>
            {(videoTrimStart > 0 || videoTrimEnd < effectiveDuration) && (
              <button
                onClick={() => onChangeVideoTrim(0, effectiveDuration)}
                className="px-2 py-1 text-red-400 hover:bg-slate-800 rounded transition-colors"
                title="Reset video trim"
              >
                Reset
              </button>
            )}
          </div>

          {/* Fit to screen */}
          <button
            onClick={handleFitToScreen}
            className="px-2 sm:px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-emerald-400 border border-slate-800 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors min-h-[32px]"
            title="Fit entire video duration to screen width"
          >
            <Maximize2 className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden md:inline">Fit</span>
          </button>

          {/* Zoom Controls */}
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5 sm:p-1">
            <button
              onClick={() => setZoom((z) => Math.max(15, z - 15))}
              className="p-1.5 hover:text-white text-slate-400 transition-colors"
              title="Zoom Out (-)"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] font-mono-code text-slate-400 px-1 select-none">
              {Math.round((zoom / 60) * 100)}%
            </span>
            <button
              onClick={() => setZoom((z) => Math.min(180, z + 15))}
              className="p-1.5 hover:text-white text-slate-400 transition-colors"
              title="Zoom In (+)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Selected Caption Quick Edit Drawer */}
      {selectedCaption && (
        <div className="bg-[#0B1220] border-b border-slate-800 px-3 sm:px-4 py-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 animate-in fade-in">
          <div className="flex items-center gap-2 flex-1 w-full sm:w-auto">
            <Edit3 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <input
              type="text"
              value={editTextVal}
              onChange={(e) => {
                setEditTextVal(e.target.value);
                onUpdateCaption(selectedCaption.id, { text: e.target.value });
              }}
              className="flex-1 min-w-0 bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none transition-colors"
              placeholder="Enter subtitle text..."
            />
          </div>

          {/* Duration Quick Adjusters */}
          <div className="flex items-center justify-between sm:justify-end gap-1.5 text-[11px]">
            <span className="text-slate-400 text-xs">Duration:</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  const newEnd = Math.max(selectedCaption.startTime + 0.2, selectedCaption.endTime - 0.2);
                  onUpdateCaption(selectedCaption.id, { endTime: parseFloat(newEnd.toFixed(2)) });
                }}
                className="bg-slate-900 hover:bg-slate-800 border border-slate-800 px-2 py-1 rounded text-slate-300 font-mono-code transition-colors"
                title="Decrease duration by 0.2s"
              >
                -0.2s
              </button>
              <button
                onClick={() => {
                  const newEnd = Math.min(effectiveDuration, selectedCaption.endTime + 0.2);
                  onUpdateCaption(selectedCaption.id, { endTime: parseFloat(newEnd.toFixed(2)) });
                }}
                className="bg-slate-900 hover:bg-slate-800 border border-slate-800 px-2 py-1 rounded text-emerald-300 font-mono-code font-bold transition-colors"
                title="Increase duration by 0.2s"
              >
                +0.2s
              </button>
            </div>
            <button
              onClick={() => onSelectCaption(null)}
              className="p-1.5 text-slate-500 hover:text-slate-300 ml-1 transition-colors"
              title="Close editor drawer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Scrollable Tracks Area */}
      <div
        ref={timelineContainerRef}
        className="overflow-x-auto overflow-y-hidden select-none relative custom-scrollbar bg-[#070B14]"
        style={{
          minHeight: '210px',
          touchAction: draggingType ? 'none' : 'pan-x',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <div
          ref={trackAreaRef}
          onPointerDown={handleTrackPointerDown}
          onPointerUp={handleTrackPointerUp}
          className="relative py-1 cursor-pointer select-none"
          style={{ width: `${totalWidth}px`, minHeight: '210px' }}
        >
          {/* 1. Time Ruler Bar */}
          <div
            onPointerDown={handleRulerPointerDown}
            className="h-7 border-b border-slate-800/80 relative bg-[#090F1C]/90 cursor-pointer touch-none"
            title="Click or drag anywhere on the ruler to move playhead"
          >
            {renderRulerTicks()}
          </div>

          {/* 2. Tracks Container */}
          <div className="space-y-2 mt-2 px-1">
            {/* TRACK 1: Video Track (FILMSTRIP PREVIEW) */}
            <div className="relative h-14 bg-slate-950 rounded-xl border border-slate-800/90 overflow-hidden flex items-center shadow-inner">
              {/* Active Video Filmstrip Background */}
              <div
                className="absolute top-0 bottom-0 overflow-hidden flex items-center z-0"
                style={{
                  left: `${(videoTrimStart || 0) * zoom}px`,
                  width: `${Math.max(20, (currentTrimEnd - (videoTrimStart || 0)) * zoom)}px`,
                }}
              >
                {thumbnails.length > 0 ? (
                  <div className="w-full h-full flex items-center">
                    {thumbnails.map((thumb, idx) => {
                      const thumbWidth = (effectiveDuration / thumbnails.length) * zoom;
                      return (
                        <div
                          key={`thumb-${idx}`}
                          className="h-full relative overflow-hidden border-r border-slate-900/70 flex-shrink-0 bg-slate-900 group/thumb"
                          style={{ width: `${thumbWidth}px` }}
                        >
                          <img
                            src={thumb.url}
                            alt={`Frame ${thumb.time.toFixed(1)}s`}
                            className="w-full h-full object-cover pointer-events-none opacity-80 group-hover/thumb:opacity-100 transition-opacity"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />
                          <span className="absolute bottom-0.5 right-1 text-[9px] font-mono-code text-white/90 bg-black/70 px-1 rounded font-bold pointer-events-none">
                            {thumb.time.toFixed(1)}s
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="w-full h-full bg-gradient-to-r from-blue-950/60 via-indigo-950/50 to-blue-950/60 border border-blue-500/40 rounded-lg flex items-center px-3">
                    <span className="text-[11px] font-bold text-blue-300 flex items-center gap-1.5 select-none">
                      <Film className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
                      Video Track • {Math.max(0, currentTrimEnd - (videoTrimStart || 0)).toFixed(1)}s
                      {isExtractingThumbs && <span className="text-[10px] text-blue-400/80 font-normal">(Generating filmstrip previews...)</span>}
                    </span>
                  </div>
                )}
              </div>

              {/* Trimmed out left area (dimmed) */}
              {(videoTrimStart || 0) > 0 && (
                <div
                  className="absolute top-0 bottom-0 left-0 bg-black/80 border-r-2 border-amber-500 z-10 flex items-center justify-center pointer-events-none backdrop-blur-[2px]"
                  style={{ width: `${(videoTrimStart || 0) * zoom}px` }}
                >
                  <span className="text-[10px] text-amber-400 font-mono-code font-bold bg-black/60 px-1.5 py-0.5 rounded">
                    Trimmed ({(videoTrimStart || 0).toFixed(1)}s)
                  </span>
                </div>
              )}

              {/* Trimmed out right area (dimmed) */}
              {currentTrimEnd < effectiveDuration - 0.05 && (
                <div
                  className="absolute top-0 bottom-0 right-0 bg-black/80 border-l-2 border-amber-500 z-10 flex items-center justify-center pointer-events-none backdrop-blur-[2px]"
                  style={{ width: `${Math.max(0, (effectiveDuration - currentTrimEnd) * zoom)}px` }}
                >
                  <span className="text-[10px] text-amber-400 font-mono-code font-bold bg-black/60 px-1.5 py-0.5 rounded">
                    Trimmed ({Math.max(0, effectiveDuration - currentTrimEnd).toFixed(1)}s)
                  </span>
                </div>
              )}

              {/* Video Left Trim Handle */}
              <div
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setDraggingType('video-trim-start');
                  setDragStartX(e.clientX);
                  setDragInitialTime({ start: videoTrimStart || 0, end: currentTrimEnd });
                }}
                className="absolute top-0 bottom-0 w-6 bg-amber-500 hover:bg-amber-400 active:bg-amber-300 cursor-ew-resize z-20 flex items-center justify-center rounded-l shadow-lg touch-none"
                style={{ left: `${Math.max(0, (videoTrimStart || 0) * zoom - 3)}px` }}
                title="Drag to trim video start"
              >
                <div className="w-1 h-5 bg-slate-950 rounded-full" />
              </div>

              {/* Video Right Trim Handle */}
              <div
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setDraggingType('video-trim-end');
                  setDragStartX(e.clientX);
                  setDragInitialTime({ start: videoTrimStart || 0, end: currentTrimEnd });
                }}
                className="absolute top-0 bottom-0 w-6 bg-amber-500 hover:bg-amber-400 active:bg-amber-300 cursor-ew-resize z-20 flex items-center justify-center rounded-r shadow-lg touch-none"
                style={{ left: `${Math.max(0, currentTrimEnd * zoom - 21)}px` }}
                title="Drag to trim video end"
              >
                <div className="w-1 h-5 bg-slate-950 rounded-full" />
              </div>
            </div>

            {/* TRACK 2: Subtitles Track */}
            <div className="relative h-16 bg-slate-900/60 rounded-xl border border-dashed border-slate-800/80 flex items-center">
              {captions.length === 0 ? (
                <div className="w-full text-center text-xs text-slate-500 flex items-center justify-center gap-1.5 pointer-events-none">
                  <span>No subtitles yet. Click "+ Add Subtitle" or "Create Captions" above.</span>
                </div>
              ) : (
                captions.map((cap) => {
                  const isSelected = selectedCaptionId === cap.id;
                  const isActiveNow = currentTime >= cap.startTime && currentTime <= cap.endTime;
                  const isBeingDragged = dragCaptionId === cap.id;
                  const blockLeft = cap.startTime * zoom;
                  const blockWidth = Math.max(36, (cap.endTime - cap.startTime) * zoom);

                  return (
                    <div
                      key={cap.id}
                      onPointerDown={(e) => handleCaptionPointerDown(e, cap)}
                      className={`timeline-block absolute top-1.5 bottom-1.5 rounded-lg border transition-all cursor-grab active:cursor-grabbing flex items-center select-none group z-10 touch-none ${
                        isSelected
                          ? 'bg-emerald-600 text-white border-emerald-300 ring-2 ring-emerald-400 shadow-xl shadow-emerald-950/80'
                          : isActiveNow
                          ? 'bg-emerald-800/90 text-emerald-100 border-emerald-400 shadow-md ring-1 ring-emerald-400/50'
                          : 'bg-[#132338] text-slate-200 border-slate-700 hover:border-emerald-500/60 hover:bg-[#182e49]'
                      } ${isBeingDragged ? 'opacity-95 scale-[1.02] shadow-2xl z-30' : ''}`}
                      style={{
                        left: `${blockLeft}px`,
                        width: `${blockWidth}px`,
                      }}
                      title={`${cap.text} (${cap.startTime.toFixed(2)}s - ${cap.endTime.toFixed(2)}s)`}
                    >
                      {/* Left Resize Handle */}
                      <div
                        onPointerDown={(e) => handleResizeStartPointerDown(e, cap)}
                        className="resize-handle absolute left-0 top-0 bottom-0 w-7 -translate-x-1 cursor-ew-resize flex items-center justify-center z-20 touch-none group/lh"
                        title="Drag to adjust start time"
                      >
                        <div className="w-1.5 h-6 bg-white/80 group-hover/lh:bg-white group-active/lh:bg-emerald-300 rounded-full shadow-md flex items-center justify-center transition-colors">
                          <div className="w-[1px] h-3 bg-slate-900/80" />
                        </div>
                      </div>

                      {/* Middle Text Content & Drag Badge */}
                      <div className="flex-1 px-3 truncate text-xs font-semibold flex items-center justify-center pointer-events-none">
                        <span className="truncate">{cap.text}</span>
                      </div>

                      {/* Live Dragging Tooltip Badge */}
                      {isBeingDragged && dragCurrentTimes && (
                        <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-slate-900/95 border border-emerald-400 text-emerald-300 font-mono-code text-[10px] px-1.5 py-0.5 rounded shadow-lg whitespace-nowrap pointer-events-none z-50">
                          {dragCurrentTimes.start.toFixed(2)}s → {dragCurrentTimes.end.toFixed(2)}s ({(dragCurrentTimes.end - dragCurrentTimes.start).toFixed(2)}s)
                        </div>
                      )}

                      {/* Right Resize Handle */}
                      <div
                        onPointerDown={(e) => handleResizeEndPointerDown(e, cap)}
                        className="resize-handle absolute right-0 top-0 bottom-0 w-7 translate-x-1 cursor-ew-resize flex items-center justify-center z-20 touch-none group/rh"
                        title="Drag to adjust end time"
                      >
                        <div className="w-1.5 h-6 bg-white/80 group-hover/rh:bg-white group-active/rh:bg-emerald-300 rounded-full shadow-md flex items-center justify-center transition-colors">
                          <div className="w-[1px] h-3 bg-slate-900/80" />
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* 3. CAPCUT DRAGGABLE PLAYHEAD */}
          <div
            className="absolute top-0 bottom-0 z-40 flex flex-col items-center select-none"
            style={{ left: `${currentTime * zoom}px` }}
          >
            {/* Playhead Diamond Handle */}
            <div
              onPointerDown={handlePlayheadPointerDown}
              className="playhead-handle w-11 h-10 -top-2.5 -translate-x-1/2 absolute flex items-center justify-center cursor-ew-resize touch-none z-50 group"
              title="Drag playhead left/right"
            >
              {/* Visible Diamond Head */}
              <div className="w-4 h-4 bg-emerald-400 group-hover:bg-emerald-300 group-active:bg-white rotate-45 border-2 border-white shadow-[0_0_10px_rgba(52,211,153,0.9)] transition-all group-active:scale-125" />
            </div>

            {/* Playhead Vertical Line */}
            <div
              onPointerDown={handlePlayheadPointerDown}
              className="w-7 -translate-x-1/2 absolute top-4 bottom-0 flex items-center justify-center cursor-ew-resize touch-none z-40 group"
              title="Drag playhead cursor"
            >
              {/* Visible 2px Emerald Laser Line */}
              <div className="w-[2px] h-full bg-emerald-400 group-hover:bg-emerald-300 group-active:bg-white shadow-[0_0_8px_rgba(52,211,153,0.9)] transition-colors" />
            </div>

            {/* FLOATING REAL-TIME VIDEO & TIMECODE PREVIEW */}
            {draggingType === 'playhead' && (
              <div className="absolute -top-20 -translate-x-1/2 bg-slate-900/95 border border-emerald-400/90 rounded-xl p-1.5 shadow-2xl z-50 flex items-center gap-2 pointer-events-none backdrop-blur-md animate-in fade-in zoom-in-95">
                {closestThumbnail && (
                  <img
                    src={closestThumbnail.url}
                    alt="Current frame"
                    className="w-14 h-9 object-cover rounded-md border border-slate-700/80"
                  />
                )}
                <div className="text-left pr-1">
                  <div className="text-[11px] font-mono-code font-bold text-emerald-400">
                    {formatTimecode(currentTime)}
                  </div>
                  <div className="text-[9px] text-slate-300 max-w-[120px] truncate">
                    {activeCaptionNow ? activeCaptionNow.text : 'Video'}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Timeline Status & Tips */}
      <div className="bg-[#080D18] border-t border-slate-800/80 px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <div className="flex items-center gap-2 flex-wrap text-[11px]">
          <span className="text-emerald-400 font-semibold">Pro Tips:</span>
          <span>Click ruler to jump playhead</span>
          <span className="text-slate-600">•</span>
          <span>Drag subtitle blocks to move</span>
          <span className="text-slate-600">•</span>
          <span>Drag block edges to adjust duration</span>
        </div>
        <div className="font-mono-code text-[11px] text-slate-400">
          {captions.length} {captions.length === 1 ? 'caption' : 'captions'}
        </div>
      </div>
    </div>
  );
};
