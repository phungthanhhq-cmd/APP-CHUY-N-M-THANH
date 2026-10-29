import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Scissors,
  Play,
  Pause,
  X,
  Check,
  RotateCcw,
  Sparkles,
  Volume2,
  Clock,
  PlusCircle,
} from 'lucide-react';
import {
  trimAudioBuffer,
  audioBufferToWavBlob,
  formatDuration,
  formatTimeDetailed,
} from '../utils/audioUtils';

interface AudioTrimmerModalProps {
  trackName: string;
  buffer: AudioBuffer;
  onClose: () => void;
  onApplyTrim: (newBuffer: AudioBuffer, newBlob: Blob, newName: string, asNewTrack?: boolean) => void;
}

export const AudioTrimmerModal: React.FC<AudioTrimmerModalProps> = ({
  trackName,
  buffer,
  onClose,
  onApplyTrim,
}) => {
  const duration = buffer.duration;
  const [startTime, setStartTime] = useState<number>(0);
  const [endTime, setEndTime] = useState<number>(duration);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);

  const playbackCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const playStartTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);

  // Generate waveform peaks for visual presentation
  const waveformBars = useMemo(() => {
    const rawData = buffer.getChannelData(0);
    const totalBars = 60;
    const blockSize = Math.floor(rawData.length / totalBars);
    const bars: number[] = [];

    for (let i = 0; i < totalBars; i++) {
      let sum = 0;
      for (let j = 0; j < blockSize; j++) {
        sum += Math.abs(rawData[i * blockSize + j]);
      }
      bars.push(Math.min(1, (sum / blockSize) * 2.8));
    }
    return bars;
  }, [buffer]);

  // Clean up playback on unmount
  useEffect(() => {
    return () => {
      stopPlayback();
    };
  }, []);

  const stopPlayback = () => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
        sourceNodeRef.current.disconnect();
      } catch {
        // Ignored
      }
      sourceNodeRef.current = null;
    }
    if (playbackCtxRef.current && playbackCtxRef.current.state !== 'closed') {
      playbackCtxRef.current.close().catch(() => {});
      playbackCtxRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setIsPlaying(false);
  };

  const playTrimmedSegment = () => {
    if (isPlaying) {
      stopPlayback();
      return;
    }

    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx({ sampleRate: buffer.sampleRate });
    playbackCtxRef.current = ctx;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    sourceNodeRef.current = source;

    const segmentDuration = Math.max(0.05, endTime - startTime);
    playStartTimeRef.current = ctx.currentTime;
    setCurrentTime(startTime);

    source.start(0, startTime, segmentDuration);
    setIsPlaying(true);

    const updateProgress = () => {
      if (!ctx || ctx.state === 'closed') return;
      const elapsed = ctx.currentTime - playStartTimeRef.current;
      const current = startTime + elapsed;
      if (current >= endTime) {
        stopPlayback();
        setCurrentTime(startTime);
      } else {
        setCurrentTime(current);
        animationFrameRef.current = requestAnimationFrame(updateProgress);
      }
    };

    animationFrameRef.current = requestAnimationFrame(updateProgress);

    source.onended = () => {
      stopPlayback();
      setCurrentTime(startTime);
    };
  };

  const handleStartChange = (val: number) => {
    const clamped = Math.max(0, Math.min(val, endTime - 0.2));
    setStartTime(clamped);
    if (isPlaying) stopPlayback();
  };

  const handleEndChange = (val: number) => {
    const clamped = Math.max(startTime + 0.2, Math.min(val, duration));
    setEndTime(clamped);
    if (isPlaying) stopPlayback();
  };

  // Quick preset actions
  const applyPreset = (type: 'first-15' | 'first-30' | 'middle' | 'skip-intro' | 'reset') => {
    stopPlayback();
    if (type === 'reset') {
      setStartTime(0);
      setEndTime(duration);
    } else if (type === 'first-15') {
      setStartTime(0);
      setEndTime(Math.min(15, duration));
    } else if (type === 'first-30') {
      setStartTime(0);
      setEndTime(Math.min(30, duration));
    } else if (type === 'middle') {
      const seg = duration * 0.5;
      const start = (duration - seg) / 2;
      setStartTime(start);
      setEndTime(start + seg);
    } else if (type === 'skip-intro') {
      setStartTime(Math.min(3, duration * 0.2));
      setEndTime(duration);
    }
  };

  const handleApply = (asNewTrack: boolean) => {
    stopPlayback();
    const trimmed = trimAudioBuffer(buffer, startTime, endTime);
    const newBlob = audioBufferToWavBlob(trimmed);
    const newName = `${trackName.replace(/\.[^/.]+$/, '')}_[${formatDuration(startTime)}-${formatDuration(endTime)}].wav`;
    onApplyTrim(trimmed, newBlob, newName, asNewTrack);
    onClose();
  };

  const segmentLength = Math.max(0, endTime - startTime);
  const startPercent = (startTime / duration) * 100;
  const endPercent = (endTime / duration) * 100;
  const currentPercent = (currentTime / duration) * 100;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full border border-gray-100 overflow-hidden space-y-5 p-6 sm:p-7">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shadow-xs">
              <Scissors className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-black text-gray-900 truncate max-w-md">
                Cắt / Chỉnh Đoạn Âm Thanh
              </h3>
              <p className="text-xs text-gray-500 truncate max-w-md">
                {trackName} · Tổng độ dài: <strong>{formatDuration(duration)}</strong>
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              stopPlayback();
              onClose();
            }}
            className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-900 flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Waveform Visualizer & Interactive Trimming Window */}
        <div className="space-y-2">
          <div className="relative h-28 bg-slate-900 rounded-2xl p-3 flex items-end gap-1 overflow-hidden select-none shadow-inner">
            {/* Waveform Bars */}
            {waveformBars.map((h, i) => {
              const barPercent = (i / waveformBars.length) * 100;
              const isInside = barPercent >= startPercent && barPercent <= endPercent;
              return (
                <div
                  key={i}
                  className="flex-1 rounded-full transition-all duration-75"
                  style={{
                    height: `${Math.max(12, h * 90)}%`,
                    backgroundColor: isInside ? '#818cf8' : '#334155',
                    opacity: isInside ? 1 : 0.45,
                  }}
                />
              );
            })}

            {/* Playhead indicator */}
            {isPlaying && (
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-20 shadow-md shadow-amber-400 pointer-events-none"
                style={{ left: `${currentPercent}%` }}
              >
                <div className="w-2.5 h-2.5 rounded-full bg-amber-400 -translate-x-1" />
              </div>
            )}

            {/* Inactive Dimmed Left */}
            <div
              className="absolute top-0 bottom-0 left-0 bg-black/60 pointer-events-none"
              style={{ width: `${startPercent}%` }}
            />

            {/* Inactive Dimmed Right */}
            <div
              className="absolute top-0 bottom-0 right-0 bg-black/60 pointer-events-none"
              style={{ width: `${100 - endPercent}%` }}
            />

            {/* Highlighted Selected Window Border */}
            <div
              className="absolute top-0 bottom-0 border-2 border-indigo-400 rounded-lg pointer-events-none"
              style={{
                left: `${startPercent}%`,
                width: `${Math.max(1, endPercent - startPercent)}%`,
              }}
            />
          </div>

          {/* Timeline markers */}
          <div className="flex justify-between text-[11px] font-mono text-gray-400 px-1">
            <span>00:00.0</span>
            <span className="text-indigo-600 font-bold">
              Đoạn cắt: {formatTimeDetailed(startTime)} ➔ {formatTimeDetailed(endTime)} ({segmentLength.toFixed(1)}s)
            </span>
            <span>{formatDuration(duration)}</span>
          </div>
        </div>

        {/* Sliders for Start & End Time */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-gray-50 p-4 rounded-2xl border border-gray-200">
          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-xs font-bold text-gray-700">
              <span>Bắt đầu (Start):</span>
              <span className="text-indigo-600 font-mono text-sm">{formatTimeDetailed(startTime)}</span>
            </div>
            <input
              type="range"
              min="0"
              max={duration}
              step="0.1"
              value={startTime}
              onChange={(e) => handleStartChange(parseFloat(e.target.value))}
              className="w-full accent-indigo-600 cursor-pointer"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-xs font-bold text-gray-700">
              <span>Kết thúc (End):</span>
              <span className="text-indigo-600 font-mono text-sm">{formatTimeDetailed(endTime)}</span>
            </div>
            <input
              type="range"
              min="0"
              max={duration}
              step="0.1"
              value={endTime}
              onChange={(e) => handleEndChange(parseFloat(e.target.value))}
              className="w-full accent-indigo-600 cursor-pointer"
            />
          </div>
        </div>

        {/* Quick Presets */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-gray-500">Cắt nhanh:</span>
          <button
            onClick={() => applyPreset('first-15')}
            className="px-2.5 py-1 bg-white hover:bg-gray-100 border border-gray-200 rounded-lg text-xs font-medium text-gray-700 transition-colors cursor-pointer"
          >
            Lấy 15s đầu
          </button>
          <button
            onClick={() => applyPreset('first-30')}
            className="px-2.5 py-1 bg-white hover:bg-gray-100 border border-gray-200 rounded-lg text-xs font-medium text-gray-700 transition-colors cursor-pointer"
          >
            Lấy 30s đầu
          </button>
          <button
            onClick={() => applyPreset('middle')}
            className="px-2.5 py-1 bg-white hover:bg-gray-100 border border-gray-200 rounded-lg text-xs font-medium text-gray-700 transition-colors cursor-pointer"
          >
            Lấy đoạn giữa (50%)
          </button>
          <button
            onClick={() => applyPreset('skip-intro')}
            className="px-2.5 py-1 bg-white hover:bg-gray-100 border border-gray-200 rounded-lg text-xs font-medium text-gray-700 transition-colors cursor-pointer"
          >
            Bỏ 3s đầu
          </button>
          <button
            onClick={() => applyPreset('reset')}
            className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-semibold text-gray-600 flex items-center gap-1 transition-colors cursor-pointer ml-auto"
          >
            <RotateCcw className="w-3 h-3" />
            Khôi phục
          </button>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-gray-100">
          <button
            onClick={playTrimmedSegment}
            className={`px-5 py-3 rounded-xl font-bold text-xs uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer shadow-sm ${
              isPlaying
                ? 'bg-amber-500 hover:bg-amber-600 text-white'
                : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700'
            }`}
          >
            {isPlaying ? (
              <>
                <Pause className="w-4 h-4" />
                Tạm dừng
              </>
            ) : (
              <>
                <Play className="w-4 h-4 ml-0.5" />
                Nghe thử đoạn đã chọn
              </>
            )}
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleApply(true)}
              className="px-4 py-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold text-xs uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer"
              title="Giữ nguyên bản gốc và thêm đoạn cắt này thành một đoạn mới"
            >
              <PlusCircle className="w-4 h-4" />
              Lưu thành đoạn mới
            </button>
            <button
              onClick={() => handleApply(false)}
              className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-indigo-200 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Check className="w-4 h-4" />
              Áp dụng cắt đoạn này
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
