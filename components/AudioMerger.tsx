import React, { useState, useRef, useEffect } from 'react';
import {
  Upload,
  Play,
  Pause,
  Trash2,
  ArrowUp,
  ArrowDown,
  Music,
  Sliders,
  Volume2,
  Download,
  Sparkles,
  Layers,
  Radio,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  Plus,
  Mic,
  Clock,
  ListPlus,
  Scissors,
  RadioTower,
  FastForward,
  VolumeX,
  Check,
} from 'lucide-react';
import {
  decodeAudioBlob,
  audioBufferToWavBlob,
  concatenateAudioBuffers,
  mixVoiceAndBgm,
  mixIntroVoiceOutro,
  formatDuration,
} from '../utils/audioUtils';
import { PRESET_BGM_TRACKS, PRESET_JINGLE_PACKS } from '../utils/audioPresets';
import { AudioTrimmerModal } from './AudioTrimmerModal';

export interface AiVoiceItem {
  id: string;
  name: string;
  blob: Blob;
  url: string;
  duration?: number;
  textSnippet: string;
  createdAt: Date;
}

interface AudioTrack {
  id: string;
  name: string;
  size: number;
  duration: number;
  buffer: AudioBuffer;
  blob: Blob;
  url: string;
}

interface AudioMergerProps {
  initialVoice?: { blob: Blob; name: string } | null;
  availableAiVoices?: AiVoiceItem[];
  onClearInitialVoice?: () => void;
}

export const AudioMerger: React.FC<AudioMergerProps> = ({
  initialVoice,
  availableAiVoices = [],
}) => {
  const [activeMode, setActiveMode] = useState<'podcast' | 'bgm' | 'concat'>('podcast');

  // Tracks for Sequential Concatenation
  const [tracks, setTracks] = useState<AudioTrack[]>([]);
  const [concatGap, setConcatGap] = useState(0.4);

  // States for BGM Mixer
  const [voiceTrack, setVoiceTrack] = useState<AudioTrack | null>(null);
  const [bgmTrack, setBgmTrack] = useState<AudioTrack | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('zen-meditation');
  const [usePresetBgm, setUsePresetBgm] = useState<boolean>(true);
  const [voiceVol, setVoiceVol] = useState(1.0);
  const [bgmVol, setBgmVol] = useState(0.22);
  const [loopBgm, setLoopBgm] = useState(true);
  const [autoFade, setAutoFade] = useState(true);

  // States for Intro - Voice - Outro (Podcast / Broadcast Mode)
  const [selectedJinglePackId, setSelectedJinglePackId] = useState<string>('broadcast-news');
  const [customIntroTrack, setCustomIntroTrack] = useState<AudioTrack | null>(null);
  const [customOutroTrack, setCustomOutroTrack] = useState<AudioTrack | null>(null);
  const [useCustomIntro, setUseCustomIntro] = useState<boolean>(false);
  const [useCustomOutro, setUseCustomOutro] = useState<boolean>(false);
  const [useSameTrackForOutro, setUseSameTrackForOutro] = useState<boolean>(true);
  const [outroPlayEnding, setOutroPlayEnding] = useState<boolean>(true);
  const [introDuration, setIntroDuration] = useState<number>(4.0);
  const [outroDuration, setOutroDuration] = useState<number>(5.0);
  const [crossfadeSeconds, setCrossfadeSeconds] = useState<number>(0.8);
  const [playBgmUnderVoice, setPlayBgmUnderVoice] = useState<boolean>(false); // Mặc định tắt nhạc ở đoạn giữa theo yêu cầu
  const [duckedVolume, setDuckedVolume] = useState<number>(0.18);
  const [matchFullSongLength, setMatchFullSongLength] = useState<boolean>(true); // Phối hoàn chỉnh cả bài hát trong Mode 1

  // 3 Chế độ phối nhạc cốt lõi theo yêu cầu người dùng:
  // 1. 'mute_middle': Tắt nhạc đoạn giữa (chỉ lồng đầu & cuối)
  // 2. 'intro_outro_bgm': Lồng đoạn đầu, cuối (nhạc nền êm nhẹ ở giữa, cắt theo giọng đọc)
  // 3. 'full_song': Lồng cả bài (giữ trọn vẹn toàn bộ bài hát từ đầu đến nốt cuối)
  const currentPodcastBgmMode: 'mute_middle' | 'intro_outro_bgm' | 'full_song' =
    !playBgmUnderVoice
      ? 'mute_middle'
      : matchFullSongLength
      ? 'full_song'
      : 'intro_outro_bgm';

  const selectPodcastBgmMode = (mode: 'mute_middle' | 'intro_outro_bgm' | 'full_song') => {
    if (mode === 'mute_middle') {
      setPlayBgmUnderVoice(false);
      setMatchFullSongLength(false);
    } else if (mode === 'intro_outro_bgm') {
      setPlayBgmUnderVoice(true);
      setMatchFullSongLength(false);
    } else if (mode === 'full_song') {
      setPlayBgmUnderVoice(true);
      setMatchFullSongLength(true);
    }
  };

  // Advanced BGM Mixer States (Mode 2)
  const [matchFullMusicDuration, setMatchFullMusicDuration] = useState<boolean>(true); // Giữ nguyên độ dài hoàn chỉnh cả bài nhạc
  const [duckMusicUnderVoice, setDuckMusicUnderVoice] = useState<boolean>(true); // Tự động hạ nhỏ nhạc khi giọng nói cất lên
  const [voiceDelaySeconds, setVoiceDelaySeconds] = useState<number>(2.0); // Dạo nhạc mở đầu trước khi nói

  // Trimming modal state
  const [trimmingTarget, setTrimmingTarget] = useState<{
    type: 'voice' | 'bgm' | 'concat' | 'history' | 'intro' | 'outro';
    trackName: string;
    buffer: AudioBuffer;
    trackId?: string;
  } | null>(null);

  // General processing & result
  const [processing, setProcessing] = useState(false);
  const [processStatus, setProcessStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultDuration, setResultDuration] = useState<number>(0);

  // Previewing track
  const [playingTrackId, setPlayingTrackId] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const resultAudioRef = useRef<HTMLAudioElement | null>(null);

  // Drag and drop state
  const [isDragging, setIsDragging] = useState(false);

  // Helper to load a Blob into an AudioTrack
  const createTrackFromBlob = async (blob: Blob, name: string): Promise<AudioTrack> => {
    const buf = await decodeAudioBlob(blob);
    const url = URL.createObjectURL(blob);
    return {
      id: `track-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name,
      size: blob.size,
      duration: buf.duration,
      buffer: buf,
      blob,
      url,
    };
  };

  // Auto load initialVoice if voiceTrack is empty
  useEffect(() => {
    if (initialVoice) {
      let isCancelled = false;
      createTrackFromBlob(initialVoice.blob, initialVoice.name)
        .then((newTrack) => {
          if (isCancelled) return;
          setVoiceTrack(newTrack);
          // Also pre-seed concat list if empty
          setTracks((prev) => (prev.length === 0 ? [newTrack] : prev));
        })
        .catch((err) => {
          console.error('Failed to load initial voice:', err);
        });

      return () => {
        isCancelled = true;
      };
    }
  }, [initialVoice]);

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      tracks.forEach((t) => URL.revokeObjectURL(t.url));
      if (voiceTrack?.url) URL.revokeObjectURL(voiceTrack.url);
      if (bgmTrack?.url) URL.revokeObjectURL(bgmTrack.url);
      if (customIntroTrack?.url) URL.revokeObjectURL(customIntroTrack.url);
      if (customOutroTrack?.url) URL.revokeObjectURL(customOutroTrack.url);
      if (resultUrl) URL.revokeObjectURL(resultUrl);
    };
  }, []);

  // Use an AI Voice from history as the main Voice Track
  const handleUseAiVoiceAsMain = async (item: AiVoiceItem) => {
    setError(null);
    setProcessing(true);
    setProcessStatus(`Đang chuyển "${item.name}" vào làm Giọng đọc chính...`);
    try {
      const track = await createTrackFromBlob(item.blob, item.name);
      setVoiceTrack(track);
    } catch (e: any) {
      setError(e.message || 'Lỗi khi nạp giọng AI.');
    } finally {
      setProcessing(false);
      setProcessStatus('');
    }
  };

  // Add an AI Voice from history into the concatenation list
  const handleAddAiVoiceToConcat = async (item: AiVoiceItem) => {
    setError(null);
    setProcessing(true);
    setProcessStatus(`Đang thêm "${item.name}" vào danh sách ghép nối...`);
    try {
      const track = await createTrackFromBlob(item.blob, item.name);
      setTracks((prev) => [...prev, track]);
      setActiveMode('concat');
    } catch (e: any) {
      setError(e.message || 'Lỗi khi nạp giọng AI vào danh sách.');
    } finally {
      setProcessing(false);
      setProcessStatus('');
    }
  };

  // Add all available AI voices into concatenation list
  const handleAddAllAiVoicesToConcat = async () => {
    if (availableAiVoices.length === 0) return;
    setError(null);
    setProcessing(true);
    setProcessStatus(`Đang nạp ${availableAiVoices.length} đoạn giọng AI vào danh sách...`);
    try {
      const newTracks: AudioTrack[] = [];
      for (const item of availableAiVoices) {
        const track = await createTrackFromBlob(item.blob, item.name);
        newTracks.push(track);
      }
      setTracks((prev) => [...prev, ...newTracks]);
      setActiveMode('concat');
    } catch (e: any) {
      setError(e.message || 'Lỗi khi thêm danh sách giọng AI.');
    } finally {
      setProcessing(false);
      setProcessStatus('');
    }
  };

  // Handle uploading files
  const processUploadedFiles = async (
    files: FileList | File[],
    target?: 'voice' | 'bgm' | 'concat' | 'intro' | 'outro'
  ) => {
    setError(null);
    setProcessing(true);
    setProcessStatus('Đang đọc và giải mã file âm thanh...');

    try {
      const added: AudioTrack[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.type.startsWith('audio/') && !file.name.match(/\.(mp3|wav|m4a|aac|ogg|webm|flac)$/i)) {
          continue;
        }

        const track = await createTrackFromBlob(file, file.name);

        if (target === 'voice') {
          setVoiceTrack(track);
          return;
        } else if (target === 'bgm') {
          setBgmTrack(track);
          setUsePresetBgm(false);
          return;
        } else if (target === 'intro') {
          setCustomIntroTrack(track);
          setUseCustomIntro(true);
          return;
        } else if (target === 'outro') {
          setCustomOutroTrack(track);
          setUseCustomOutro(true);
          return;
        } else {
          added.push(track);
        }
      }

      if (added.length === 0 && !target) {
        throw new Error('Vui lòng chọn file âm thanh hợp lệ (.mp3, .wav, .m4a, .aac, .ogg, .webm).');
      }

      setTracks((prev) => [...prev, ...added]);
    } catch (e: any) {
      console.error(e);
      setError(e.message || 'Lỗi khi đọc file âm thanh tải lên.');
    } finally {
      setProcessing(false);
      setProcessStatus('');
    }
  };

  const handleFileInput = (
    e: React.ChangeEvent<HTMLInputElement>,
    target?: 'voice' | 'bgm' | 'concat' | 'intro' | 'outro'
  ) => {
    if (e.target.files && e.target.files.length > 0) {
      processUploadedFiles(e.target.files, target);
      e.target.value = '';
    }
  };

  // Open Trimmer for any track
  const handleOpenTrimmer = async (
    targetType: 'voice' | 'bgm' | 'concat' | 'history' | 'intro' | 'outro',
    track: { name: string; buffer?: AudioBuffer; blob?: Blob; id?: string }
  ) => {
    let buf = track.buffer;
    if (!buf && track.blob) {
      setProcessing(true);
      setProcessStatus('Đang tải dạng sóng để chỉnh sửa...');
      try {
        buf = await decodeAudioBlob(track.blob);
      } catch (err: any) {
        setError(err.message || 'Lỗi giải mã âm thanh.');
        setProcessing(false);
        setProcessStatus('');
        return;
      }
      setProcessing(false);
      setProcessStatus('');
    }

    if (!buf) return;

    setTrimmingTarget({
      type: targetType,
      trackName: track.name,
      buffer: buf,
      trackId: track.id,
    });
  };

  // Apply Trim result from Trimmer Modal
  const handleApplyTrim = (newBuffer: AudioBuffer, newBlob: Blob, newName: string, asNewTrack?: boolean) => {
    if (!trimmingTarget) return;

    const url = URL.createObjectURL(newBlob);
    const newTrack: AudioTrack = {
      id: `track-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: newName,
      size: newBlob.size,
      duration: newBuffer.duration,
      buffer: newBuffer,
      blob: newBlob,
      url,
    };

    if (trimmingTarget.type === 'voice') {
      if (asNewTrack) {
        setTracks((prev) => [...prev, newTrack]);
      } else {
        setVoiceTrack(newTrack);
      }
    } else if (trimmingTarget.type === 'bgm') {
      setBgmTrack(newTrack);
      setUsePresetBgm(false);
    } else if (trimmingTarget.type === 'intro') {
      setCustomIntroTrack(newTrack);
      setUseCustomIntro(true);
    } else if (trimmingTarget.type === 'outro') {
      setCustomOutroTrack(newTrack);
      setUseCustomOutro(true);
    } else if (trimmingTarget.type === 'concat') {
      if (asNewTrack) {
        setTracks((prev) => [...prev, newTrack]);
      } else {
        setTracks((prev) =>
          prev.map((t) => (t.id === trimmingTarget.trackId ? newTrack : t))
        );
      }
    } else if (trimmingTarget.type === 'history') {
      if (asNewTrack) {
        setTracks((prev) => [...prev, newTrack]);
      } else {
        setVoiceTrack(newTrack);
      }
    }

    setTrimmingTarget(null);
  };

  // Preview toggle for any track
  const togglePlayTrack = (trackId: string, url: string) => {
    if (playingTrackId === trackId) {
      previewAudioRef.current?.pause();
      setPlayingTrackId(null);
    } else {
      if (previewAudioRef.current) {
        previewAudioRef.current.src = url;
        previewAudioRef.current.play().catch(console.error);
        setPlayingTrackId(trackId);
      }
    }
  };

  // Move tracks up/down
  const moveTrack = (index: number, direction: 'up' | 'down') => {
    setTracks((prev) => {
      const next = [...prev];
      const targetIdx = direction === 'up' ? index - 1 : index + 1;
      if (targetIdx < 0 || targetIdx >= next.length) return prev;
      const temp = next[index];
      next[index] = next[targetIdx];
      next[targetIdx] = temp;
      return next;
    });
  };

  const removeTrack = (id: string) => {
    setTracks((prev) => prev.filter((t) => t.id !== id));
    if (playingTrackId === id) {
      previewAudioRef.current?.pause();
      setPlayingTrackId(null);
    }
  };

  // EXECUTE MODE 1: INTRO -> VOICE -> OUTRO (Podcast & Broadcast)
  const handleExecutePodcastStructure = async () => {
    if (!voiceTrack) {
      setError('Vui lòng chọn hoặc tải lên bản thu Giọng Đọc Chính ở Khối số 2.');
      return;
    }

    const sampleRate = voiceTrack.buffer.sampleRate;
    let finalIntroBuf: AudioBuffer | null = null;
    let finalOutroBuf: AudioBuffer | null = null;

    if (useCustomIntro && customIntroTrack) {
      finalIntroBuf = customIntroTrack.buffer;
    } else {
      const pack = PRESET_JINGLE_PACKS.find((p) => p.id === selectedJinglePackId) || PRESET_JINGLE_PACKS[0];
      finalIntroBuf = pack.generateIntro(sampleRate);
    }

    if (useCustomIntro && customIntroTrack && (useSameTrackForOutro || (!useCustomOutro && !customOutroTrack))) {
      finalOutroBuf = customIntroTrack.buffer;
    } else if (useCustomOutro && customOutroTrack) {
      finalOutroBuf = customOutroTrack.buffer;
    } else {
      const pack = PRESET_JINGLE_PACKS.find((p) => p.id === selectedJinglePackId) || PRESET_JINGLE_PACKS[0];
      finalOutroBuf = pack.generateOutro(sampleRate);
    }

    if (!finalIntroBuf || !finalOutroBuf) {
      setError('Chưa tải được nhạc mở đầu hoặc kết thúc.');
      return;
    }

    const isSameContinuousSong = Boolean(
      playBgmUnderVoice &&
      useCustomIntro &&
      customIntroTrack &&
      (useSameTrackForOutro || (!useCustomOutro && !customOutroTrack))
    );

    setError(null);
    setProcessing(true);
    setProcessStatus(
      !playBgmUnderVoice
        ? 'Đang ghép: Nhạc mở đầu ➔ Giọng đọc (tắt hẳn nhạc ở giữa) ➔ Nhạc kết bài...'
        : matchFullSongLength
        ? 'Đang hòa âm ghép nhạc hoàn chỉnh cả bài (Full Master Track)...'
        : 'Đang hòa âm: Mở đầu ➔ Giọng đọc kèm nhạc ngầm ➔ Nhạc kết thúc...'
    );

    try {
      const mixedBuffer = await mixIntroVoiceOutro({
        introBuffer: finalIntroBuf,
        voiceBuffer: voiceTrack.buffer,
        outroBuffer: finalOutroBuf,
        introDuration,
        outroDuration,
        introVolume: 1.0,
        voiceVolume: voiceVol,
        outroVolume: 1.0,
        crossfadeSeconds,
        playBgmUnderVoice,
        bgmUnderVoiceVolume: duckedVolume,
        outroFromEnd: outroPlayEnding,
        matchFullSongLength: playBgmUnderVoice && matchFullSongLength,
        isContinuousSameSong: isSameContinuousSong,
      });

      const wavBlob = audioBufferToWavBlob(mixedBuffer);

      if (resultUrl) URL.revokeObjectURL(resultUrl);
      const url = URL.createObjectURL(wavBlob);
      setResultUrl(url);
      setResultDuration(mixedBuffer.duration);

      setTimeout(() => {
        resultAudioRef.current?.play().catch(console.error);
      }, 150);
    } catch (e: any) {
      console.error(e);
      setError(e.message || 'Lỗi khi hòa âm cấu trúc Intro - Voice - Outro.');
    } finally {
      setProcessing(false);
      setProcessStatus('');
    }
  };

  // EXECUTE MODE 2: BGM MIXER
  const handleExecuteBgm = async () => {
    if (!voiceTrack) {
      setError('Vui lòng chọn hoặc tải lên bản thu giọng đọc chính (Voice track).');
      return;
    }

    let finalBgmBuffer: AudioBuffer | null = null;
    if (usePresetBgm) {
      const preset = PRESET_BGM_TRACKS.find((p) => p.id === selectedPresetId);
      if (preset) {
        finalBgmBuffer = preset.generate(voiceTrack.buffer.sampleRate);
      }
    } else if (bgmTrack) {
      finalBgmBuffer = bgmTrack.buffer;
    }

    if (!finalBgmBuffer) {
      setError('Vui lòng tải lên file nhạc nền hoặc chọn mẫu nhạc nền có sẵn.');
      return;
    }

    setError(null);
    setProcessing(true);
    setProcessStatus(
      matchFullMusicDuration
        ? 'Đang hòa âm ghép nhạc hoàn chỉnh cả bài hát...'
        : 'Đang hòa âm giọng đọc và nhạc nền (Studio Mixing)...'
    );

    try {
      const mixedBuffer = await mixVoiceAndBgm({
        voiceBuffer: voiceTrack.buffer,
        bgmBuffer: finalBgmBuffer,
        voiceVolume: voiceVol,
        bgmVolume: bgmVol,
        loopBgm,
        fadeInSeconds: autoFade ? 1.0 : 0.05,
        fadeOutSeconds: autoFade ? 2.5 : 0.05,
        matchFullMusicDuration,
        voiceDelaySeconds: autoFade ? voiceDelaySeconds : 0,
        duckMusicUnderVoice,
        duckedBgmVolume: Math.min(bgmVol, 0.15),
      });

      const wavBlob = audioBufferToWavBlob(mixedBuffer);

      if (resultUrl) URL.revokeObjectURL(resultUrl);
      const url = URL.createObjectURL(wavBlob);
      setResultUrl(url);
      setResultDuration(mixedBuffer.duration);

      setTimeout(() => {
        resultAudioRef.current?.play().catch(console.error);
      }, 150);
    } catch (e: any) {
      console.error(e);
      setError(e.message || 'Lỗi khi hòa âm giọng đọc với nhạc nền.');
    } finally {
      setProcessing(false);
      setProcessStatus('');
    }
  };

  // EXECUTE MODE 3: SEQUENTIAL CONCATENATION
  const handleExecuteConcat = async () => {
    if (tracks.length < 2) {
      setError('Vui lòng thêm hoặc tải lên ít nhất 2 đoạn âm thanh để ghép nối tiếp.');
      return;
    }

    setError(null);
    setProcessing(true);
    setProcessStatus('Đang ghép các đoạn âm thanh theo thứ tự...');

    try {
      const buffers = tracks.map((t) => t.buffer);
      const mergedBuffer = await concatenateAudioBuffers(buffers, concatGap);
      const wavBlob = audioBufferToWavBlob(mergedBuffer);

      if (resultUrl) URL.revokeObjectURL(resultUrl);
      const url = URL.createObjectURL(wavBlob);
      setResultUrl(url);
      setResultDuration(mergedBuffer.duration);

      setTimeout(() => {
        resultAudioRef.current?.play().catch(console.error);
      }, 150);
    } catch (e: any) {
      console.error(e);
      setError(e.message || 'Lỗi khi ghép nối âm thanh.');
    } finally {
      setProcessing(false);
      setProcessStatus('');
    }
  };

  const handleDownloadResult = () => {
    if (!resultUrl) return;
    const a = document.createElement('a');
    a.href = resultUrl;
    a.download = `studio_${activeMode}_${Date.now()}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="space-y-6">
      {/* Hidden audio element for preview */}
      <audio
        ref={previewAudioRef}
        onEnded={() => setPlayingTrackId(null)}
        onError={() => setPlayingTrackId(null)}
        className="hidden"
      />

      {/* Trimmer Modal Popup */}
      {trimmingTarget && (
        <AudioTrimmerModal
          trackName={trimmingTarget.trackName}
          buffer={trimmingTarget.buffer}
          onClose={() => setTrimmingTarget(null)}
          onApplyTrim={handleApplyTrim}
        />
      )}

      {/* Mode Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-2 border border-gray-200 rounded-2xl shadow-sm">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setActiveMode('podcast')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all cursor-pointer ${
              activeMode === 'podcast'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            <RadioTower className="w-4 h-4" />
            Mở Đầu ➔ Giọng Đọc ➔ Kết Thúc (Intro - Outro)
            <span className="text-[10px] font-black uppercase tracking-wider bg-amber-400 text-slate-900 px-2 py-0.5 rounded-full">
              Khuyên dùng
            </span>
          </button>

          <button
            onClick={() => setActiveMode('bgm')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all cursor-pointer ${
              activeMode === 'bgm'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            <Music className="w-4 h-4" />
            Lồng Nhạc Nền (BGM Mixer)
          </button>

          <button
            onClick={() => setActiveMode('concat')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all cursor-pointer ${
              activeMode === 'concat'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            <Layers className="w-4 h-4" />
            Ghép Nối Tiếp Nhiều Đoạn
          </button>
        </div>

        <div className="text-xs text-gray-500 font-medium px-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
          Đầu ra chuẩn Studio WAV Lossless
        </div>
      </div>

      {/* 🚀 QUICK ACCESS: GIỌNG ĐỌC AI ĐÃ TẠO TRONG PHIÊN */}
      {availableAiVoices.length > 0 && (
        <div className="bg-gradient-to-r from-indigo-50 via-purple-50 to-amber-50 border border-indigo-200 rounded-2xl p-4 shadow-sm space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-100 pb-2.5">
            <div className="flex items-center gap-2">
              <Mic className="w-5 h-5 text-indigo-600" />
              <h3 className="text-sm font-bold text-gray-900">
                Kho Giọng Đọc AI Vừa Tạo ({availableAiVoices.length} file sẵn sàng)
              </h3>
              <span className="text-[10px] font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full">
                Tự động đồng bộ
              </span>
            </div>

            {availableAiVoices.length > 1 && (
              <button
                onClick={handleAddAllAiVoicesToConcat}
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-xs transition-all cursor-pointer"
              >
                <ListPlus className="w-3.5 h-3.5" />
                Ghép toàn bộ các đoạn AI này nối tiếp nhau
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {availableAiVoices.map((item) => {
              const isSelectedVoice = voiceTrack && voiceTrack.name === item.name;
              return (
                <div
                  key={item.id}
                  className={`p-3 bg-white border rounded-xl shadow-2xs space-y-2 transition-all ${
                    isSelectedVoice
                      ? 'border-indigo-400 ring-2 ring-indigo-200 bg-indigo-50/30'
                      : 'border-gray-200 hover:border-indigo-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        onClick={() => togglePlayTrack(item.id, item.url)}
                        className="w-7 h-7 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center flex-shrink-0 shadow-xs cursor-pointer"
                        title="Nghe thử"
                      >
                        {playingTrackId === item.id ? (
                          <Pause className="w-3 h-3" />
                        ) : (
                          <Play className="w-3 h-3 ml-0.5" />
                        )}
                      </button>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-gray-900 truncate">{item.name}</p>
                        <p className="text-[10px] text-gray-400 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {item.createdAt.toLocaleTimeString()}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => handleOpenTrimmer('history', item)}
                      className="p-1.5 rounded-lg bg-gray-100 hover:bg-indigo-100 text-gray-600 hover:text-indigo-700 transition-colors cursor-pointer text-xs flex items-center gap-1 font-semibold"
                      title="Cắt đoạn đầu / đoạn giữa"
                    >
                      <Scissors className="w-3.5 h-3.5" />
                      Cắt
                    </button>
                  </div>

                  <p className="text-[11px] text-gray-500 line-clamp-1 italic bg-gray-50 p-1 rounded">
                    "{item.textSnippet}"
                  </p>

                  <div className="flex items-center gap-1.5 pt-1">
                    <button
                      onClick={() => handleUseAiVoiceAsMain(item)}
                      className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                        isSelectedVoice
                          ? 'bg-emerald-600 text-white'
                          : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700'
                      }`}
                    >
                      {isSelectedVoice ? '✓ Đang làm Giọng Chính' : 'Chọn làm Giọng Chính'}
                    </button>
                    <button
                      onClick={() => handleAddAiVoiceToConcat(item)}
                      className="py-1.5 px-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1 cursor-pointer"
                      title="Thêm vào danh sách ghép nối"
                    >
                      <Plus className="w-3 h-3" />
                      Ghép nối
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODE 1: MỞ ĐẦU ➔ GIỌNG ĐỌC ➔ KẾT THÚC (PODCAST / BROADCAST) */}
      {/* ======================================================== */}
      {activeMode === 'podcast' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 space-y-5">
            {/* Cấu trúc 3 khối trực quan */}
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-5">
              <div className="border-b border-gray-100 pb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                    <RadioTower className="w-5 h-5 text-indigo-600" />
                    Cấu Trúc 3 Bước: Mở Đầu ➔ Lời Nói ➔ Kết Thúc
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Ghép nhạc mở đầu ấn tượng, tùy chọn tắt hẳn hoặc lồng nhạc nền êm ở giữa, và dứt điểm với nhạc kết bài.
                  </p>
                </div>
                {currentPodcastBgmMode === 'mute_middle' ? (
                  <span className="text-xs font-bold text-emerald-800 bg-emerald-100 border border-emerald-300 px-3 py-1 rounded-full flex items-center gap-1.5 shadow-2xs">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    Đang chọn: 🔇 Tắt hẳn nhạc ở đoạn giữa
                  </span>
                ) : currentPodcastBgmMode === 'full_song' ? (
                  <span className="text-xs font-bold text-purple-900 bg-purple-100 border border-purple-300 px-3 py-1 rounded-full flex items-center gap-1.5 shadow-2xs">
                    <span className="w-2 h-2 rounded-full bg-purple-600 animate-pulse"></span>
                    Đang chọn: 🌟 Lồng phối cả bài (Trọn vẹn bài hát)
                  </span>
                ) : (
                  <span className="text-xs font-bold text-indigo-800 bg-indigo-100 border border-indigo-300 px-3 py-1 rounded-full flex items-center gap-1.5 shadow-2xs">
                    <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
                    Đang chọn: 🎶 Lồng đoạn đầu, cuối (Nhạc ngầm vừa vặn)
                  </span>
                )}
              </div>

              {/* BỘ 3 Ô TÍCH CHỌN CHẾ ĐỘ PHỐI NHẠC TRỰC QUAN */}
              <div className="bg-gradient-to-r from-slate-50 via-indigo-50/40 to-purple-50/40 p-4 rounded-xl border-2 border-indigo-200/90 shadow-xs space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-2.5 w-2.5 rounded-full bg-indigo-600 animate-ping" />
                    <span className="text-xs font-black uppercase tracking-wider text-indigo-950 flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-indigo-600" />
                      Tích chọn chế độ phối nhạc mong muốn:
                    </span>
                  </div>
                  <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-100/70 px-2.5 py-0.5 rounded-full">
                    Bấm ô tích để đổi chế độ tức thì 👇
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {/* Ô tích 1: Tắt nhạc đoạn giữa */}
                  <div
                    onClick={() => selectPodcastBgmMode('mute_middle')}
                    className={`relative p-3.5 rounded-xl border-2 cursor-pointer transition-all flex flex-col justify-between ${
                      currentPodcastBgmMode === 'mute_middle'
                        ? 'border-emerald-600 bg-emerald-50/95 ring-2 ring-emerald-300 shadow-md scale-[1.01]'
                        : 'border-gray-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/30'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
                            currentPodcastBgmMode === 'mute_middle'
                              ? 'bg-emerald-600 border-emerald-600 text-white shadow-xs'
                              : 'bg-white border-gray-300'
                          }`}>
                            {currentPodcastBgmMode === 'mute_middle' && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                          </div>
                          <span className="text-xs font-black text-gray-900 flex items-center gap-1">
                            🔇 Tắt nhạc đoạn giữa
                          </span>
                        </div>
                        {currentPodcastBgmMode === 'mute_middle' && (
                          <span className="text-[9px] font-black uppercase tracking-wider bg-emerald-600 text-white px-1.5 py-0.5 rounded shadow-2xs">
                            Đang chọn
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-600 leading-snug">
                        Nhạc mở đầu ➔ <strong>tắt hẳn nhạc khi nói</strong> để giọng rõ nhất ➔ hết lời mới nổi nhạc kết bài.
                      </p>
                    </div>
                    <div className="mt-2.5 pt-2 border-t border-emerald-200/60 flex items-center justify-between text-[10px] font-bold text-emerald-800">
                      <span>Chỉ phát Đầu & Cuối</span>
                      <span>100% Giọng đọc rõ</span>
                    </div>
                  </div>

                  {/* Ô tích 2: Lồng đoạn đầu, cuối */}
                  <div
                    onClick={() => selectPodcastBgmMode('intro_outro_bgm')}
                    className={`relative p-3.5 rounded-xl border-2 cursor-pointer transition-all flex flex-col justify-between ${
                      currentPodcastBgmMode === 'intro_outro_bgm'
                        ? 'border-indigo-600 bg-indigo-50/95 ring-2 ring-indigo-300 shadow-md scale-[1.01]'
                        : 'border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/30'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
                            currentPodcastBgmMode === 'intro_outro_bgm'
                              ? 'bg-indigo-600 border-indigo-600 text-white shadow-xs'
                              : 'bg-white border-gray-300'
                          }`}>
                            {currentPodcastBgmMode === 'intro_outro_bgm' && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                          </div>
                          <span className="text-xs font-black text-gray-900 flex items-center gap-1">
                            🎶 Lồng đoạn đầu, cuối
                          </span>
                        </div>
                        {currentPodcastBgmMode === 'intro_outro_bgm' && (
                          <span className="text-[9px] font-black uppercase tracking-wider bg-indigo-600 text-white px-1.5 py-0.5 rounded shadow-2xs">
                            Đang chọn
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-600 leading-snug">
                        Nhạc dạo đầu ➔ <strong>tự hạ nhỏ làm nền êm</strong> khi đọc ➔ dứt lời nổi to kết thúc (vừa vặn theo giọng).
                      </p>
                    </div>
                    <div className="mt-2.5 pt-2 border-t border-indigo-200/60 flex items-center justify-between text-[10px] font-bold text-indigo-800">
                      <span>Nhạc nền êm {Math.round(duckedVolume * 100)}%</span>
                      <span>Dừng theo giọng đọc</span>
                    </div>
                  </div>

                  {/* Ô tích 3: Lồng cả bài */}
                  <div
                    onClick={() => selectPodcastBgmMode('full_song')}
                    className={`relative p-3.5 rounded-xl border-2 cursor-pointer transition-all flex flex-col justify-between ${
                      currentPodcastBgmMode === 'full_song'
                        ? 'border-purple-600 bg-purple-50/95 ring-2 ring-purple-300 shadow-md scale-[1.01]'
                        : 'border-gray-200 bg-white hover:border-purple-300 hover:bg-purple-50/30'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
                            currentPodcastBgmMode === 'full_song'
                              ? 'bg-purple-600 border-purple-600 text-white shadow-xs'
                              : 'bg-white border-gray-300'
                          }`}>
                            {currentPodcastBgmMode === 'full_song' && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                          </div>
                          <span className="text-xs font-black text-gray-900 flex items-center gap-1">
                            🌟 Lồng cả bài
                          </span>
                        </div>
                        {currentPodcastBgmMode === 'full_song' && (
                          <span className="text-[9px] font-black uppercase tracking-wider bg-purple-600 text-white px-1.5 py-0.5 rounded shadow-2xs">
                            Đang chọn
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-600 leading-snug">
                        <strong>Giữ trọn vẹn cả bài hát</strong> từ đầu tới nốt nhạc cuối cùng. Lời nói lồng vào giữa, hết lời nhạc vẫn tiếp tục.
                      </p>
                    </div>
                    <div className="mt-2.5 pt-2 border-t border-purple-200/60 flex items-center justify-between text-[10px] font-bold text-purple-800">
                      <span>Trọn vẹn 100% bài hát</span>
                      <span>Master Song Full</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Sơ đồ thời gian âm thanh trực quan theo thời gian thực */}
              <div className="bg-slate-900 text-white rounded-xl p-3.5 shadow-inner space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-300 flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                    Sơ đồ hòa âm xuất bản:
                  </span>
                  <span className="text-[11px] font-mono text-emerald-400">
                    Thời lượng dự kiến: ~{formatDuration(
                      playBgmUnderVoice && matchFullSongLength && useCustomIntro && customIntroTrack
                        ? Math.max(customIntroTrack.duration, (voiceTrack?.duration || 8) + introDuration + outroDuration - crossfadeSeconds * 2)
                        : (voiceTrack?.duration || 8) + introDuration + outroDuration - crossfadeSeconds * 2
                    )}
                    {playBgmUnderVoice && matchFullSongLength && useCustomIntro && customIntroTrack && (
                      <span className="ml-1 text-[10px] text-amber-300 font-sans font-semibold">(Trọn vẹn bài hát)</span>
                    )}
                  </span>
                </div>

                <div className="grid grid-cols-12 gap-1.5 items-center font-mono text-[11px] font-bold text-center">
                  {/* Khối 1: Intro */}
                  <div className="col-span-3 bg-indigo-600 text-white py-2 px-1 rounded-lg border border-indigo-400 shadow-xs flex flex-col justify-center">
                    <span className="truncate">🎵 1. Mở đầu</span>
                    <span className="text-[10px] text-indigo-200 font-normal">{introDuration.toFixed(1)}s (Fade-in)</span>
                  </div>

                  {/* Khối 2: Voice */}
                  <div className={`col-span-6 py-2 px-2 rounded-lg border flex flex-col justify-center transition-all ${
                    currentPodcastBgmMode === 'mute_middle'
                      ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300'
                      : currentPodcastBgmMode === 'full_song'
                      ? 'bg-purple-950/80 border-purple-400 text-purple-200'
                      : 'bg-indigo-950/80 border-indigo-400 text-indigo-200'
                  }`}>
                    <span className="truncate">🎙️ 2. Lời nói ({voiceTrack ? formatDuration(voiceTrack.duration) : '--:--'})</span>
                    <span className="text-[10px] font-semibold">
                      {currentPodcastBgmMode === 'mute_middle'
                        ? '🔇 KHÔNG NHẠC (Chỉ giọng đọc)'
                        : `🎵 Nhạc nền êm (${Math.round(duckedVolume * 100)}%)`}
                    </span>
                  </div>

                  {/* Khối 3: Outro */}
                  <div className={`col-span-3 py-2 px-1 rounded-lg border shadow-xs flex flex-col justify-center transition-all ${
                    currentPodcastBgmMode === 'full_song'
                      ? 'bg-purple-700 text-white border-purple-400'
                      : 'bg-amber-600 text-white border-amber-400'
                  }`}>
                    <span className="truncate">🎵 3. Kết thúc</span>
                    <span className="text-[10px] font-normal">
                      {currentPodcastBgmMode === 'full_song'
                        ? '🌟 Hết bài hát'
                        : `${outroDuration.toFixed(1)}s (Fade-out)`}
                    </span>
                  </div>
                </div>
              </div>

              {/* BƯỚC 1: NHẠC MỞ ĐẦU (INTRO) */}
              <div className="p-4 rounded-xl border border-indigo-100 bg-indigo-50/40 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-md bg-indigo-600 text-white font-bold text-xs flex items-center justify-center">
                      1
                    </span>
                    <h4 className="text-sm font-bold text-gray-900">Đoạn Mở Đầu (Intro Music)</h4>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setUseCustomIntro(false)}
                      className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer transition-all ${
                        !useCustomIntro ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      Mẫu đài phát
                    </button>
                    <label className={`cursor-pointer px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                      useCustomIntro ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:text-gray-900'
                    }`}>
                      Tải file riêng
                      <input
                        type="file"
                        accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.webm"
                        className="hidden"
                        onChange={(e) => handleFileInput(e, 'intro')}
                      />
                    </label>
                  </div>
                </div>

                {!useCustomIntro ? (
                  <div className="space-y-1.5">
                    <select
                      value={selectedJinglePackId}
                      onChange={(e) => setSelectedJinglePackId(e.target.value)}
                      className="w-full text-xs font-semibold p-2.5 bg-white border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {PRESET_JINGLE_PACKS.map((pack) => (
                        <option key={pack.id} value={pack.id}>
                          🎵 {pack.name} ({pack.category})
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-gray-500">
                      {PRESET_JINGLE_PACKS.find((p) => p.id === selectedJinglePackId)?.description}
                    </p>
                  </div>
                ) : (
                  <div>
                    {customIntroTrack ? (
                      <div className="flex items-center justify-between p-2.5 bg-white border border-indigo-200 rounded-lg">
                        <div className="flex items-center gap-2 truncate">
                          <button
                            onClick={() => togglePlayTrack(customIntroTrack.id, customIntroTrack.url)}
                            className="w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center flex-shrink-0 cursor-pointer"
                          >
                            {playingTrackId === customIntroTrack.id ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3 ml-0.5" />}
                          </button>
                          <span className="text-xs font-bold text-gray-900 truncate">{customIntroTrack.name}</span>
                        </div>
                        <button
                          onClick={() => handleOpenTrimmer('intro', customIntroTrack)}
                          className="px-2 py-1 rounded-md bg-indigo-50 text-indigo-700 text-xs font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <Scissors className="w-3 h-3" /> Cắt
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-amber-700 italic">Vui lòng tải file nhạc mở đầu lên</p>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between text-xs pt-1">
                  <span className="text-gray-600">Thời gian nhạc dạo mở đầu:</span>
                  <span className="font-mono font-bold text-indigo-700">{introDuration.toFixed(1)} giây</span>
                </div>
                <input
                  type="range"
                  min="2"
                  max="8"
                  step="0.5"
                  value={introDuration}
                  onChange={(e) => setIntroDuration(parseFloat(e.target.value))}
                  className="w-full accent-indigo-600"
                />
              </div>

              {/* BƯỚC 2: GIỌNG ĐỌC CHÍNH & LỰA CHỌN TẮT/BẬT NHẠC ĐOẠN GIỮA */}
              <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/40 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-md bg-emerald-600 text-white font-bold text-xs flex items-center justify-center">
                      2
                    </span>
                    <h4 className="text-sm font-bold text-gray-900">Giọng Đọc Chính (Main Voice)</h4>
                  </div>
                  <label className="cursor-pointer inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-emerald-300 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold rounded-md transition-colors">
                    <Upload className="w-3 h-3" />
                    Đổi file khác
                    <input
                      type="file"
                      accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.webm"
                      className="hidden"
                      onChange={(e) => handleFileInput(e, 'voice')}
                    />
                  </label>
                </div>

                {voiceTrack ? (
                  <div className="flex items-center justify-between p-2.5 bg-white border border-emerald-200 rounded-lg">
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        onClick={() => togglePlayTrack(voiceTrack.id, voiceTrack.url)}
                        className="w-7 h-7 rounded-full bg-emerald-600 text-white flex items-center justify-center flex-shrink-0 cursor-pointer"
                      >
                        {playingTrackId === voiceTrack.id ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3 ml-0.5" />}
                      </button>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-gray-900 truncate">{voiceTrack.name}</p>
                        <p className="text-[10px] text-gray-500">Độ dài: {formatDuration(voiceTrack.duration)}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleOpenTrimmer('voice', voiceTrack)}
                      className="px-2 py-1 rounded-md bg-emerald-50 text-emerald-800 text-xs font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Scissors className="w-3 h-3" /> Cắt đoạn
                    </button>
                  </div>
                ) : (
                  <div className="text-center py-4 bg-white rounded-lg border border-dashed border-emerald-300 text-xs text-gray-500">
                    Chưa có giọng đọc. Hãy chọn một đoạn giọng từ <strong>Kho Giọng Đọc AI</strong> phía trên hoặc tải file lên.
                  </div>
                )}

                {/* 3 Ô TÍCH CHỌN CHẾ ĐỘ LỒNG NHẠC KHI ĐỌC TIẾNG */}
                <div className="pt-2 border-t border-emerald-200/80 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-gray-800 uppercase tracking-wide flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-indigo-600" />
                      Quy tắc lồng nhạc trong đoạn đọc giọng nói:
                    </span>
                    <span className="text-[10px] text-gray-500 font-semibold">Tích chọn 1 trong 3 ô:</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                    {/* Ô tích 1: Tắt nhạc đoạn giữa */}
                    <div
                      onClick={() => selectPodcastBgmMode('mute_middle')}
                      className={`p-3 rounded-xl border-2 cursor-pointer transition-all flex flex-col justify-between ${
                        currentPodcastBgmMode === 'mute_middle'
                          ? 'border-emerald-600 bg-white ring-2 ring-emerald-300 shadow-sm'
                          : 'border-gray-200 bg-white/70 hover:border-gray-300 opacity-80'
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <div className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center transition-colors flex-shrink-0 ${
                          currentPodcastBgmMode === 'mute_middle'
                            ? 'bg-emerald-600 border-emerald-600 text-white'
                            : 'bg-white border-gray-300'
                        }`}>
                          {currentPodcastBgmMode === 'mute_middle' && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs font-bold text-gray-900 flex items-center gap-1">
                            <span>🔇 Tắt nhạc đoạn giữa</span>
                          </div>
                          <p className="text-[11px] text-gray-600 leading-snug">
                            Hết nhạc mở đầu là <strong>tắt hẳn nhạc</strong>. Đoạn giữa chỉ có giọng nói.
                          </p>
                        </div>
                      </div>
                      <div className="mt-2 pt-1.5 border-t border-gray-100 text-[10px] text-emerald-700 font-semibold flex justify-between">
                        <span>Chỉ đầu & cuối</span>
                        <span>Giọng rõ nét</span>
                      </div>
                    </div>

                    {/* Ô tích 2: Lồng đoạn đầu, cuối */}
                    <div
                      onClick={() => selectPodcastBgmMode('intro_outro_bgm')}
                      className={`p-3 rounded-xl border-2 cursor-pointer transition-all flex flex-col justify-between ${
                        currentPodcastBgmMode === 'intro_outro_bgm'
                          ? 'border-indigo-600 bg-white ring-2 ring-indigo-300 shadow-sm'
                          : 'border-gray-200 bg-white/70 hover:border-gray-300 opacity-80'
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <div className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center transition-colors flex-shrink-0 ${
                          currentPodcastBgmMode === 'intro_outro_bgm'
                            ? 'bg-indigo-600 border-indigo-600 text-white'
                            : 'bg-white border-gray-300'
                        }`}>
                          {currentPodcastBgmMode === 'intro_outro_bgm' && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs font-bold text-gray-900 flex items-center gap-1">
                            <span>🎶 Lồng đoạn đầu, cuối</span>
                          </div>
                          <p className="text-[11px] text-gray-600 leading-snug">
                            Nhạc dạo đầu ➔ <strong>tự hạ nhỏ êm dịu</strong> làm nền ➔ dứt lời nổi to kết bài.
                          </p>
                        </div>
                      </div>
                      <div className="mt-2 pt-1.5 border-t border-gray-100 text-[10px] text-indigo-700 font-semibold flex justify-between">
                        <span>Nhạc nền {Math.round(duckedVolume * 100)}%</span>
                        <span>Cắt theo lời</span>
                      </div>
                    </div>

                    {/* Ô tích 3: Lồng cả bài */}
                    <div
                      onClick={() => selectPodcastBgmMode('full_song')}
                      className={`p-3 rounded-xl border-2 cursor-pointer transition-all flex flex-col justify-between ${
                        currentPodcastBgmMode === 'full_song'
                          ? 'border-purple-600 bg-white ring-2 ring-purple-300 shadow-sm'
                          : 'border-gray-200 bg-white/70 hover:border-gray-300 opacity-80'
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <div className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center transition-colors flex-shrink-0 ${
                          currentPodcastBgmMode === 'full_song'
                            ? 'bg-purple-600 border-purple-600 text-white'
                            : 'bg-white border-gray-300'
                        }`}>
                          {currentPodcastBgmMode === 'full_song' && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs font-bold text-gray-900 flex items-center gap-1">
                            <span>🌟 Lồng cả bài</span>
                          </div>
                          <p className="text-[11px] text-gray-600 leading-snug">
                            <strong>Trọn vẹn 100% bài hát</strong>. Giọng đọc lồng ở giữa, nhạc chạy hết bài.
                          </p>
                        </div>
                      </div>
                      <div className="mt-2 pt-1.5 border-t border-gray-100 text-[10px] text-purple-700 font-semibold flex justify-between">
                        <span>Giữ hết bài hát</span>
                        <span>Full Track</span>
                      </div>
                    </div>
                  </div>

                  {/* Thanh trượt điều chỉnh âm lượng khi có lồng nhạc */}
                  {currentPodcastBgmMode !== 'mute_middle' && (
                    <div className="mt-2.5 pt-2.5 border-t border-indigo-100 bg-indigo-50/60 p-3 rounded-xl space-y-2">
                      <div className="flex justify-between items-center text-xs font-bold text-indigo-950">
                        <span className="flex items-center gap-1.5">
                          <Volume2 className="w-3.5 h-3.5 text-indigo-600" />
                          Âm lượng nhạc nền khi giọng đọc cất lên:
                        </span>
                        <span className="bg-indigo-600 text-white px-2 py-0.5 rounded text-xs font-mono font-bold">
                          {Math.round(duckedVolume * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0.05"
                        max="0.4"
                        step="0.02"
                        value={duckedVolume}
                        onChange={(e) => setDuckedVolume(parseFloat(e.target.value))}
                        className="w-full accent-indigo-600 cursor-pointer"
                      />
                      <div className="flex justify-between text-[10px] text-gray-500 font-medium">
                        <span>5% (Nhạc rất nhỏ)</span>
                        <span className="text-indigo-700 font-bold">18% (Mặc định chuẩn Podcast)</span>
                        <span>40% (Nhạc khá to)</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* BƯỚC 3: NHẠC KẾT THÚC (OUTRO) */}
              <div className="p-4 rounded-xl border border-amber-100 bg-amber-50/40 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-md bg-amber-600 text-white font-bold text-xs flex items-center justify-center">
                      3
                    </span>
                    <h4 className="text-sm font-bold text-gray-900">Đoạn Kết Thúc (Outro Music)</h4>
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    {useCustomIntro && customIntroTrack && (
                      <button
                        onClick={() => {
                          setUseSameTrackForOutro(true);
                          setUseCustomOutro(false);
                        }}
                        className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer transition-all ${
                          useSameTrackForOutro ? 'bg-amber-600 text-white' : 'text-gray-500 hover:text-gray-900'
                        }`}
                      >
                        Dùng chung file Mở Đầu
                      </button>
                    )}

                    <button
                      onClick={() => {
                        setUseSameTrackForOutro(false);
                        setUseCustomOutro(false);
                      }}
                      className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer transition-all ${
                        !useSameTrackForOutro && !useCustomOutro ? 'bg-amber-600 text-white' : 'text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      Mẫu đài phát
                    </button>

                    <label className={`cursor-pointer px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                      !useSameTrackForOutro && useCustomOutro ? 'bg-amber-600 text-white' : 'text-gray-500 hover:text-gray-900'
                    }`}>
                      Tải file riêng
                      <input
                        type="file"
                        accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.webm"
                        className="hidden"
                        onChange={(e) => {
                          setUseSameTrackForOutro(false);
                          handleFileInput(e, 'outro');
                        }}
                      />
                    </label>
                  </div>
                </div>

                {/* Nếu dùng chung file nhạc với Mở Đầu */}
                {useCustomIntro && customIntroTrack && useSameTrackForOutro && (
                  <div className="p-3 bg-white border border-amber-200 rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 truncate">
                        <span className="text-amber-600 font-bold text-xs">🎵 File bài hát:</span>
                        <span className="text-xs font-bold text-gray-900 truncate">{customIntroTrack.name}</span>
                      </div>
                      <span className="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-bold">
                        Dùng chung
                      </span>
                    </div>

                    <div className="flex items-center gap-3 pt-1 border-t border-gray-100 text-xs">
                      <label className="flex items-center gap-1.5 cursor-pointer font-medium text-gray-700">
                        <input
                          type="radio"
                          name="outroSegmentChoice"
                          checked={outroPlayEnding}
                          onChange={() => setOutroPlayEnding(true)}
                          className="accent-amber-600"
                        />
                        <span>Trích xuất đoạn đuôi (kết) của bài hát ({outroDuration}s cuối)</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer font-medium text-gray-700">
                        <input
                          type="radio"
                          name="outroSegmentChoice"
                          checked={!outroPlayEnding}
                          onChange={() => setOutroPlayEnding(false)}
                          className="accent-amber-600"
                        />
                        <span>Lấy từ đầu bài</span>
                      </label>
                    </div>
                  </div>
                )}

                {/* Nếu tải file riêng */}
                {!useSameTrackForOutro && useCustomOutro && customOutroTrack ? (
                  <div className="flex items-center justify-between p-2.5 bg-white border border-amber-200 rounded-lg">
                    <div className="flex items-center gap-2 truncate">
                      <button
                        onClick={() => togglePlayTrack(customOutroTrack.id, customOutroTrack.url)}
                        className="w-7 h-7 rounded-full bg-amber-600 text-white flex items-center justify-center flex-shrink-0 cursor-pointer"
                      >
                        {playingTrackId === customOutroTrack.id ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3 ml-0.5" />}
                      </button>
                      <span className="text-xs font-bold text-gray-900 truncate">{customOutroTrack.name}</span>
                    </div>
                    <button
                      onClick={() => handleOpenTrimmer('outro', customOutroTrack)}
                      className="px-2 py-1 rounded-md bg-amber-50 text-amber-800 text-xs font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Scissors className="w-3 h-3" /> Cắt
                    </button>
                  </div>
                ) : null}

                <div className="flex items-center justify-between text-xs pt-1">
                  <span className="text-gray-600">Thời gian nhạc dạo kết bài:</span>
                  <span className="font-mono font-bold text-amber-700">{outroDuration.toFixed(1)} giây (Fade-out)</span>
                </div>
                <input
                  type="range"
                  min="2"
                  max="8"
                  step="0.5"
                  value={outroDuration}
                  onChange={(e) => setOutroDuration(parseFloat(e.target.value))}
                  className="w-full accent-amber-600"
                />
              </div>
            </div>
          </div>

          {/* Cột phải: Bàn điều khiển kỹ thuật chuyển cảnh & Nút xuất file */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-5">
              <div className="border-b border-gray-100 pb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sliders className="w-5 h-5 text-indigo-600" />
                  <h3 className="text-base font-bold text-gray-900">Kỹ Thuật Chuyển Cảnh</h3>
                </div>
                <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full">
                  Auto-Ducking
                </span>
              </div>

              {/* Crossfade overlap slider */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-xs font-bold text-gray-700">
                  <span>Độ chồng lớp chuyển tiếp (Crossfade):</span>
                  <span className="text-indigo-600 font-mono text-sm">{crossfadeSeconds.toFixed(1)}s</span>
                </div>
                <input
                  type="range"
                  min="0.2"
                  max="2.0"
                  step="0.1"
                  value={crossfadeSeconds}
                  onChange={(e) => setCrossfadeSeconds(parseFloat(e.target.value))}
                  className="w-full accent-indigo-600 cursor-pointer"
                />
                <p className="text-[11px] text-gray-400">
                  Nhạc mở đầu sẽ hạ dần khi giọng bắt đầu nói trong {crossfadeSeconds.toFixed(1)}s để tạo cảm giác tự nhiên nhất.
                </p>
              </div>

              {/* Thông báo trạng thái hoặc Thanh điều chỉnh âm lượng ngầm */}
              {currentPodcastBgmMode === 'mute_middle' ? (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-800">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    Đoạn giữa: Hoàn toàn yên tĩnh (Tắt hẳn nhạc)
                  </div>
                  <p className="text-[11px] text-emerald-700 leading-snug">
                    Nhạc dạo đầu sẽ tắt hẳn sau {introDuration}s. Đoạn đọc ({voiceTrack ? formatDuration(voiceTrack.duration) : '--:--'}) chỉ phát duy nhất giọng nói trong trẻo, không có tiếng nhạc nào chen ngang. Dứt lời mới nổi nhạc kết bài.
                  </p>
                </div>
              ) : currentPodcastBgmMode === 'full_song' ? (
                <div className="space-y-2 pt-2 border-t border-purple-100">
                  <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl space-y-1">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-purple-900">
                      <span className="w-2 h-2 rounded-full bg-purple-600"></span>
                      Lồng cả bài: Trọn vẹn 100% bài hát
                    </div>
                    <p className="text-[11px] text-purple-700 leading-snug">
                      Toàn bộ bài hát sẽ phát đầy đủ từ đầu tới nốt cuối cùng. Giọng đọc chèn vào giữa nhạc tự động hạ nhỏ êm tai ({Math.round(duckedVolume * 100)}%).
                    </p>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-xs font-bold text-gray-700">
                      <span>Âm lượng nhạc nền khi đang đọc:</span>
                      <span className="text-purple-600 font-mono text-sm">{Math.round(duckedVolume * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0.05"
                      max="0.4"
                      step="0.02"
                      value={duckedVolume}
                      onChange={(e) => setDuckedVolume(parseFloat(e.target.value))}
                      className="w-full accent-purple-600 cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-gray-400">
                      <span>5% (Rất nhỏ)</span>
                      <span>18% (Chuẩn Radio)</span>
                      <span>40% (To)</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5 pt-2 border-t border-indigo-100">
                  <div className="flex justify-between items-center text-xs font-bold text-gray-700">
                    <span>Âm lượng nhạc nền khi đang đọc:</span>
                    <span className="text-indigo-600 font-mono text-sm">{Math.round(duckedVolume * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.05"
                    max="0.4"
                    step="0.02"
                    value={duckedVolume}
                    onChange={(e) => setDuckedVolume(parseFloat(e.target.value))}
                    className="w-full accent-indigo-600 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-gray-400">
                    <span>5% (Rất nhỏ)</span>
                    <span>18% (Chuẩn Radio)</span>
                    <span>40% (To)</span>
                  </div>
                </div>
              )}

              {/* Action Button */}
              <button
                onClick={handleExecutePodcastStructure}
                disabled={processing || !voiceTrack}
                className="w-full py-4 px-6 rounded-2xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-black text-sm uppercase tracking-wider shadow-xl shadow-indigo-200 transition-all active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer"
              >
                {processing ? (
                  <>
                    <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>{processStatus || 'Đang tạo bản thu...'}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    <span>
                      {currentPodcastBgmMode === 'mute_middle'
                        ? 'GHÉP NHẠC ĐẦU & CUỐI (TẮT NHẠC Ở GIỮA) NGAY'
                        : currentPodcastBgmMode === 'full_song'
                        ? 'GHÉP PHỐI TRỌN VẸN CẢ BÀI HÁT NGAY'
                        : 'LỒNG NHẠC ĐOẠN ĐẦU, CUỐI & NỀN ÊM NGAY'}
                    </span>
                  </>
                )}
              </button>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-medium flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            {/* Result Player for Podcast Structure */}
            {resultUrl && (
              <div className="bg-gradient-to-br from-indigo-900 to-slate-900 text-white p-5 rounded-2xl shadow-xl space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    <span className="font-black text-sm uppercase tracking-wider">Bản Thu Hoàn Chỉnh</span>
                  </div>
                  <span className="text-xs text-indigo-200 font-mono">
                    {formatDuration(resultDuration)}
                  </span>
                </div>

                <audio ref={resultAudioRef} src={resultUrl} controls className="w-full h-11 rounded-lg" />

                <button
                  onClick={handleDownloadResult}
                  className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-lg shadow-emerald-900/40 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  Tải file âm thanh đã ghép (.WAV)
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODE 2: LỒNG NHẠC NỀN (BGM MIXER) */}
      {/* ======================================================== */}
      {activeMode === 'bgm' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 space-y-6">
            {/* 1. Track Giọng Đọc Chính */}
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-sm">
                    1
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-gray-900">Giọng Đọc Chính (Voice Track)</h3>
                    <p className="text-xs text-gray-500">Giọng AI vừa tạo hoặc file giọng đọc bạn tải lên</p>
                  </div>
                </div>
                <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg transition-colors">
                  <Upload className="w-3.5 h-3.5" />
                  Tải file khác từ máy
                  <input
                    type="file"
                    accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.webm"
                    className="hidden"
                    onChange={(e) => handleFileInput(e, 'voice')}
                  />
                </label>
              </div>

              {voiceTrack ? (
                <div className="flex items-center justify-between p-3.5 bg-indigo-50/70 border border-indigo-100 rounded-xl">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <button
                      onClick={() => togglePlayTrack(voiceTrack.id, voiceTrack.url)}
                      className="w-9 h-9 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow hover:bg-indigo-700 transition-colors flex-shrink-0 cursor-pointer"
                    >
                      {playingTrackId === voiceTrack.id ? (
                        <Pause className="w-4 h-4" />
                      ) : (
                        <Play className="w-4 h-4 ml-0.5" />
                      )}
                    </button>
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-gray-900 truncate">{voiceTrack.name}</div>
                      <div className="text-xs text-indigo-700">Thời lượng: {formatDuration(voiceTrack.duration)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleOpenTrimmer('voice', voiceTrack)}
                      className="p-1.5 rounded-lg bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-100 text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors"
                      title="Cắt đoạn này"
                    >
                      <Scissors className="w-3.5 h-3.5" />
                      Cắt đoạn
                    </button>
                    <button
                      onClick={() => setVoiceTrack(null)}
                      className="text-gray-400 hover:text-red-500 p-2 rounded-lg transition-colors cursor-pointer"
                      title="Xóa giọng này"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="border-2 border-dashed border-gray-200 hover:border-indigo-400 rounded-xl p-6 text-center transition-colors">
                  <Mic className="w-8 h-8 text-indigo-400 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-gray-700 mb-1">Chưa chọn giọng đọc chính</p>
                  <p className="text-xs text-gray-400 mb-3">
                    Chọn giọng từ danh sách "Kho Giọng Đọc AI" ở trên, hoặc tải file âm thanh lên
                  </p>
                  <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-sm">
                    <Upload className="w-3.5 h-3.5" />
                    Chọn file âm thanh từ máy
                    <input
                      type="file"
                      accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.webm"
                      className="hidden"
                      onChange={(e) => handleFileInput(e, 'voice')}
                    />
                  </label>
                </div>
              )}
            </div>

            {/* 2. Track Nhạc Nền (BGM) */}
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center font-bold text-sm">
                    2
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-gray-900">Nhạc Nền (Background Music)</h3>
                    <p className="text-xs text-gray-500">Chọn mẫu có sẵn hoặc tải file nhạc yêu thích</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg">
                  <button
                    onClick={() => setUsePresetBgm(true)}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                      usePresetBgm ? 'bg-white shadow-xs text-amber-700' : 'text-gray-500 hover:text-gray-900'
                    }`}
                  >
                    Mẫu có sẵn
                  </button>
                  <button
                    onClick={() => setUsePresetBgm(false)}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                      !usePresetBgm ? 'bg-white shadow-xs text-amber-700' : 'text-gray-500 hover:text-gray-900'
                    }`}
                  >
                    Tải từ máy
                  </button>
                </div>
              </div>

              {usePresetBgm ? (
                <div className="space-y-2">
                  {PRESET_BGM_TRACKS.map((preset) => (
                    <div
                      key={preset.id}
                      onClick={() => setSelectedPresetId(preset.id)}
                      className={`cursor-pointer p-3.5 rounded-xl border transition-all flex items-start justify-between ${
                        selectedPresetId === preset.id
                          ? 'border-amber-400 bg-amber-50/50 shadow-xs ring-1 ring-amber-300'
                          : 'border-gray-200 hover:border-gray-300 bg-white'
                      }`}
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <Radio
                            className={`w-4 h-4 ${
                              selectedPresetId === preset.id ? 'text-amber-600' : 'text-gray-300'
                            }`}
                          />
                          <span className="font-bold text-sm text-gray-800">{preset.name}</span>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
                            {preset.category}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 pl-6 leading-relaxed">{preset.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div>
                  {bgmTrack ? (
                    <div className="flex items-center justify-between p-3.5 bg-amber-50/70 border border-amber-200 rounded-xl">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <button
                          onClick={() => togglePlayTrack(bgmTrack.id, bgmTrack.url)}
                          className="w-9 h-9 rounded-full bg-amber-600 text-white flex items-center justify-center shadow hover:bg-amber-700 transition-colors flex-shrink-0 cursor-pointer"
                        >
                          {playingTrackId === bgmTrack.id ? (
                            <Pause className="w-4 h-4" />
                          ) : (
                            <Play className="w-4 h-4 ml-0.5" />
                          )}
                        </button>
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-gray-900 truncate">{bgmTrack.name}</div>
                          <div className="text-xs text-amber-700">Thời lượng: {formatDuration(bgmTrack.duration)}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleOpenTrimmer('bgm', bgmTrack)}
                          className="p-1.5 rounded-lg bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors"
                          title="Cắt đoạn nhạc nền"
                        >
                          <Scissors className="w-3.5 h-3.5" />
                          Cắt nhạc
                        </button>
                        <button
                          onClick={() => setBgmTrack(null)}
                          className="text-gray-400 hover:text-red-500 p-2 rounded-lg transition-colors cursor-pointer"
                          title="Xóa nhạc này"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="border-2 border-dashed border-gray-200 hover:border-amber-400 rounded-xl p-6 text-center transition-colors">
                      <Music className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                      <p className="text-sm font-semibold text-gray-700 mb-1">Tải file nhạc nền từ máy tính</p>
                      <p className="text-xs text-gray-400 mb-3">Hỗ trợ các file .mp3, .wav, .m4a, .aac, .ogg</p>
                      <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg shadow-sm">
                        <Upload className="w-3.5 h-3.5" />
                        Chọn file nhạc nền
                        <input
                          type="file"
                          accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.webm"
                          className="hidden"
                          onChange={(e) => handleFileInput(e, 'bgm')}
                        />
                      </label>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-5 space-y-6">
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-5">
              <div className="border-b border-gray-100 pb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sliders className="w-5 h-5 text-indigo-600" />
                  <h3 className="text-base font-bold text-gray-900">Bàn Hòa Âm (Audio Mixer)</h3>
                </div>
                <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full">
                  Real-time DSP
                </span>
              </div>

              {/* Voice Volume */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-xs font-bold">
                  <span className="text-gray-700 flex items-center gap-1.5">
                    <Volume2 className="w-4 h-4 text-indigo-600" />
                    Âm lượng Giọng đọc:
                  </span>
                  <span className="text-indigo-600 font-mono text-sm">{Math.round(voiceVol * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1.8"
                  step="0.05"
                  value={voiceVol}
                  onChange={(e) => setVoiceVol(parseFloat(e.target.value))}
                  className="w-full accent-indigo-600"
                />
              </div>

              {/* BGM Volume */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-xs font-bold">
                  <span className="text-gray-700 flex items-center gap-1.5">
                    <Music className="w-4 h-4 text-amber-600" />
                    Âm lượng Nhạc nền (BGM):
                  </span>
                  <span className="text-amber-600 font-mono text-sm">{Math.round(bgmVol * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="0.8"
                  step="0.02"
                  value={bgmVol}
                  onChange={(e) => setBgmVol(parseFloat(e.target.value))}
                  className="w-full accent-amber-600"
                />
              </div>

              {/* Tùy chọn Độ dài khi Hòa âm / Ghép nhạc cả bài */}
              <div className="space-y-2 pt-2 border-t border-gray-100">
                <div className="text-xs font-bold text-gray-800 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                    Chế độ ghép nhạc & thời lượng:
                  </span>
                  {matchFullMusicDuration && (
                    <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded">
                      Trọn vẹn bài hát
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <label className={`flex items-start gap-2 p-2.5 rounded-xl border cursor-pointer transition-all ${
                    matchFullMusicDuration
                      ? 'bg-amber-50/80 border-amber-500 shadow-xs text-amber-950 font-semibold ring-1 ring-amber-300'
                      : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300'
                  }`}>
                    <input
                      type="radio"
                      name="bgmDurationChoice"
                      checked={matchFullMusicDuration}
                      onChange={() => setMatchFullMusicDuration(true)}
                      className="mt-0.5 accent-amber-600 cursor-pointer"
                    />
                    <div className="space-y-0.5">
                      <div className="font-bold text-[11px] text-gray-900">🌟 Ghép hoàn chỉnh cả bài</div>
                      <div className="text-[10px] text-gray-500 leading-tight">
                        Giữ 100% độ dài trọn vẹn của bài hát đến nốt nhạc cuối cùng
                      </div>
                    </div>
                  </label>

                  <label className={`flex items-start gap-2 p-2.5 rounded-xl border cursor-pointer transition-all ${
                    !matchFullMusicDuration
                      ? 'bg-indigo-50/80 border-indigo-500 shadow-xs text-indigo-950 font-semibold ring-1 ring-indigo-300'
                      : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300'
                  }`}>
                    <input
                      type="radio"
                      name="bgmDurationChoice"
                      checked={!matchFullMusicDuration}
                      onChange={() => setMatchFullMusicDuration(false)}
                      className="mt-0.5 accent-indigo-600 cursor-pointer"
                    />
                    <div className="space-y-0.5">
                      <div className="font-bold text-[11px] text-gray-900">⏱️ Theo độ dài giọng đọc</div>
                      <div className="text-[10px] text-gray-500 leading-tight">
                        Cắt và fade-out nhạc khi hết bài nói
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Tùy chọn Dạo nhạc mở đầu & Smart Ducking */}
              <div className="space-y-3 pt-2 border-t border-gray-100">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-xs font-medium text-gray-700">Tự động hạ nhỏ nhạc khi có giọng đọc (Smart Ducking)</span>
                  <input
                    type="checkbox"
                    checked={duckMusicUnderVoice}
                    onChange={(e) => setDuckMusicUnderVoice(e.target.checked)}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 accent-indigo-600"
                  />
                </label>

                {matchFullMusicDuration && (
                  <div className="space-y-1 bg-amber-50/60 p-2.5 rounded-xl border border-amber-100">
                    <div className="flex justify-between items-center text-xs font-semibold text-gray-700">
                      <span>Dạo nhạc mở đầu trước khi nói:</span>
                      <span className="font-mono text-amber-700 font-bold">{voiceDelaySeconds.toFixed(1)}s</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="8"
                      step="0.5"
                      value={voiceDelaySeconds}
                      onChange={(e) => setVoiceDelaySeconds(parseFloat(e.target.value))}
                      className="w-full accent-amber-600"
                    />
                    <p className="text-[10px] text-gray-500">
                      Cho bài hát vang lên {voiceDelaySeconds.toFixed(1)}s trước khi giọng đọc bắt đầu, tạo cảm giác chuyên nghiệp như phòng thu.
                    </p>
                  </div>
                )}

                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-xs font-medium text-gray-700">Lặp lại nhạc nền nếu giọng đọc dài hơn</span>
                  <input
                    type="checkbox"
                    checked={loopBgm}
                    onChange={(e) => setLoopBgm(e.target.checked)}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 accent-indigo-600"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-xs font-medium text-gray-700">Tự động Fade-in (1s) & Fade-out (2.5s)</span>
                  <input
                    type="checkbox"
                    checked={autoFade}
                    onChange={(e) => setAutoFade(e.target.checked)}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 accent-indigo-600"
                  />
                </label>
              </div>

              {/* Action Button */}
              <button
                onClick={handleExecuteBgm}
                disabled={processing || !voiceTrack}
                className="w-full py-4 px-6 rounded-2xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-black text-sm uppercase tracking-wider shadow-xl shadow-indigo-200 transition-all active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer"
              >
                {processing ? (
                  <>
                    <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>{processStatus || 'Đang hòa âm...'}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    <span>
                      {matchFullMusicDuration
                        ? 'HÒA ÂM & GHÉP NHẠC HOÀN CHỈNH CẢ BÀI NGAY'
                        : 'HÒA ÂM & LỒNG NHẠC NGAY'}
                    </span>
                  </>
                )}
              </button>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-medium flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            {/* Result Player for BGM */}
            {resultUrl && (
              <div className="bg-gradient-to-br from-indigo-900 to-slate-900 text-white p-5 rounded-2xl shadow-xl space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    <span className="font-black text-sm uppercase tracking-wider">Bản Hòa Âm Hoàn Tất</span>
                  </div>
                  <span className="text-xs text-indigo-200 font-mono">
                    {formatDuration(resultDuration)}
                  </span>
                </div>

                <audio ref={resultAudioRef} src={resultUrl} controls className="w-full h-11 rounded-lg" />

                <button
                  onClick={handleDownloadResult}
                  className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-lg shadow-emerald-900/40 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  Tải file âm thanh đã ghép (.WAV)
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODE 3: GHÉP NỐI TIẾP NHIỀU ĐOẠN (CONCATENATION) */}
      {/* ======================================================== */}
      {activeMode === 'concat' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 space-y-5">
            {/* Drag & Drop Upload Zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                  processUploadedFiles(e.dataTransfer.files);
                }
              }}
              className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all bg-white ${
                isDragging ? 'border-indigo-500 bg-indigo-50/50 scale-[1.01]' : 'border-gray-200 hover:border-indigo-400'
              }`}
            >
              <Upload className="w-10 h-10 text-indigo-500 mx-auto mb-3" />
              <h4 className="text-base font-bold text-gray-800 mb-1">
                Kéo & thả file âm thanh từ máy hoặc chọn các đoạn giọng AI ở trên
              </h4>
              <p className="text-xs text-gray-500 mb-4 max-w-md mx-auto">
                Hỗ trợ định dạng MP3, WAV, M4A, AAC, OGG. Bạn có thể bấm biểu tượng ✂️ ở mỗi đoạn để cắt chỉ lấy đoạn đầu, đoạn giữa hoặc chia nhỏ!
              </p>
              <label className="cursor-pointer inline-flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl shadow-md transition-colors">
                <Upload className="w-4 h-4" />
                Chọn file thêm từ máy tính
                <input
                  type="file"
                  multiple
                  accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.webm"
                  className="hidden"
                  onChange={(e) => handleFileInput(e)}
                />
              </label>
            </div>

            {/* Track List */}
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                <div className="flex items-center gap-2">
                  <Layers className="w-5 h-5 text-indigo-600" />
                  <h3 className="text-base font-bold text-gray-900">
                    Danh Sách Thứ Tự Ghép ({tracks.length} đoạn)
                  </h3>
                </div>
                {tracks.length > 0 && (
                  <button
                    onClick={() => setTracks([])}
                    className="text-xs text-red-600 hover:text-red-700 font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Xóa danh sách
                  </button>
                )}
              </div>

              {tracks.length === 0 ? (
                <div className="py-12 text-center text-gray-400 text-sm">
                  Chưa có đoạn âm thanh nào trong danh sách. Hãy nhấn "Ghép nối" ở các giọng AI bên trên hoặc tải file âm thanh lên!
                </div>
              ) : (
                <div className="space-y-2.5">
                  {tracks.map((track, idx) => (
                    <div
                      key={track.id}
                      className="flex items-center justify-between p-3.5 bg-gray-50 hover:bg-indigo-50/40 border border-gray-200 rounded-xl transition-all group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="w-6 h-6 rounded-md bg-gray-200 group-hover:bg-indigo-600 group-hover:text-white text-gray-700 flex items-center justify-center font-bold text-xs flex-shrink-0 transition-colors">
                          {idx + 1}
                        </span>

                        <button
                          onClick={() => togglePlayTrack(track.id, track.url)}
                          className="w-8 h-8 rounded-full bg-white border border-gray-200 text-gray-700 flex items-center justify-center shadow-xs hover:bg-indigo-600 hover:text-white hover:border-transparent transition-colors flex-shrink-0 cursor-pointer"
                        >
                          {playingTrackId === track.id ? (
                            <Pause className="w-3.5 h-3.5" />
                          ) : (
                            <Play className="w-3.5 h-3.5 ml-0.5" />
                          )}
                        </button>

                        <div className="min-w-0">
                          <p className="text-sm font-bold text-gray-900 truncate">{track.name}</p>
                          <p className="text-xs text-gray-500">
                            Thời lượng: {formatDuration(track.duration)} · {(track.size / 1024 / 1024).toFixed(2)} MB
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => handleOpenTrimmer('concat', track)}
                          className="px-2 py-1 rounded-lg bg-white border border-gray-200 hover:border-indigo-400 text-indigo-700 hover:bg-indigo-50 text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                          title="Cắt đoạn"
                        >
                          <Scissors className="w-3.5 h-3.5" />
                          Cắt
                        </button>

                        <button
                          onClick={() => moveTrack(idx, 'up')}
                          disabled={idx === 0}
                          className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-200 disabled:opacity-20 transition-all cursor-pointer"
                          title="Chuyển lên trước"
                        >
                          <ArrowUp className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => moveTrack(idx, 'down')}
                          disabled={idx === tracks.length - 1}
                          className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-200 disabled:opacity-20 transition-all cursor-pointer"
                          title="Chuyển xuống sau"
                        >
                          <ArrowDown className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => removeTrack(track.id)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all ml-1 cursor-pointer"
                          title="Xóa đoạn này"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-4 space-y-6">
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-5">
              <div className="border-b border-gray-100 pb-3">
                <h3 className="text-base font-bold text-gray-900">Cấu Hình Ghép Nối</h3>
                <p className="text-xs text-gray-500">Tùy biến khoảng lặng giữa các đoạn</p>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-xs font-bold">
                  <span className="text-gray-700">Khoảng nghỉ giữa các đoạn:</span>
                  <span className="text-indigo-600 font-mono text-sm">{concatGap.toFixed(1)} giây</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="2.5"
                  step="0.1"
                  value={concatGap}
                  onChange={(e) => setConcatGap(parseFloat(e.target.value))}
                  className="w-full accent-indigo-600"
                />
              </div>

              <div className="p-3.5 bg-gray-50 rounded-xl space-y-2 text-xs text-gray-600">
                <div className="flex justify-between">
                  <span>Tổng số đoạn:</span>
                  <strong className="text-gray-900">{tracks.length}</strong>
                </div>
                <div className="flex justify-between">
                  <span>Tổng thời lượng ước tính:</span>
                  <strong className="text-indigo-600 font-mono">
                    {formatDuration(
                      tracks.reduce((acc, t) => acc + t.duration, 0) +
                        (tracks.length > 1 ? (tracks.length - 1) * concatGap : 0)
                    )}
                  </strong>
                </div>
              </div>

              <button
                onClick={handleExecuteConcat}
                disabled={processing || tracks.length < 2}
                className="w-full py-4 px-6 rounded-2xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-black text-sm uppercase tracking-wider shadow-xl shadow-indigo-200 transition-all active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer"
              >
                {processing ? (
                  <>
                    <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>{processStatus || 'Đang ghép...'}</span>
                  </>
                ) : (
                  <>
                    <Layers className="w-5 h-5" />
                    <span>GHÉP NỐI CÁC ĐOẠN NGAY</span>
                  </>
                )}
              </button>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-medium flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            {/* Result Player for Concat */}
            {resultUrl && (
              <div className="bg-gradient-to-br from-indigo-900 to-slate-900 text-white p-5 rounded-2xl shadow-xl space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    <span className="font-black text-sm uppercase tracking-wider">File Đã Ghép Hoàn Tất</span>
                  </div>
                  <span className="text-xs text-indigo-200 font-mono">
                    {formatDuration(resultDuration)}
                  </span>
                </div>

                <audio ref={resultAudioRef} src={resultUrl} controls className="w-full h-11 rounded-lg" />

                <button
                  onClick={handleDownloadResult}
                  className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-lg shadow-emerald-900/40 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  Tải file âm thanh đã ghép (.WAV)
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
