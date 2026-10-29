/**
 * Audio processing utilities using standard Web Audio API and WAV serialization.
 */

function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Creates a WAV file Blob from base64 encoded audio data.
 * If the data already contains a RIFF WAV header (default for Gemini unary TTS),
 * it returns the blob directly. If it is raw PCM, it wraps it in a standard WAV header.
 */
export function createWavBlob(base64Audio: string): Blob {
  const pcmData = decodeBase64(base64Audio);

  // Check if it's already a complete WAV file (starts with 'RIFF' and has 'WAVE' at index 8)
  if (
    pcmData.length >= 12 &&
    pcmData[0] === 0x52 && pcmData[1] === 0x49 && pcmData[2] === 0x46 && pcmData[3] === 0x46 && // 'RIFF'
    pcmData[8] === 0x57 && pcmData[9] === 0x41 && pcmData[10] === 0x56 && pcmData[11] === 0x45    // 'WAVE'
  ) {
    return new Blob([pcmData], { type: 'audio/wav' });
  }

  // Fallback: If raw PCM, synthesize a standard 24kHz mono 16-bit WAV header
  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmData.length;
  const chunkSize = 36 + dataSize;
  const fileSize = 4 + chunkSize;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, fileSize, true);
  writeString(8, 'WAVE');

  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < dataSize; i++) {
    view.setUint8(44 + i, pcmData[i]);
  }

  return new Blob([view], { type: 'audio/wav' });
}

/**
 * Decodes any audio file Blob (mp3, wav, m4a, ogg, webm, etc.) to an AudioBuffer
 */
export async function decodeAudioBlob(blob: Blob): Promise<AudioBuffer> {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  const audioContext = new AudioCtx();
  try {
    return await audioContext.decodeAudioData(arrayBuffer);
  } finally {
    if (audioContext.state !== 'closed') {
      audioContext.close();
    }
  }
}

/**
 * Converts an AudioBuffer into a standard 16-bit PCM WAV Blob
 */
export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;

  const length = buffer.length;
  const dataByteLength = length * blockAlign;
  const headerByteLength = 44;
  const totalLength = headerByteLength + dataByteLength;

  const arrayBuffer = new ArrayBuffer(totalLength);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  /* RIFF chunk descriptor */
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true);
  writeString(8, 'WAVE');

  /* fmt sub-chunk */
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);

  /* data sub-chunk */
  writeString(36, 'data');
  view.setUint32(40, dataByteLength, true);

  // Write channel data interleaved
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numChannels; c++) {
      let sample = channels[c][i];
      // Clamp between -1.0 and 1.0
      if (sample < -1) sample = -1;
      else if (sample > 1) sample = 1;

      // Scale to 16-bit integer
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([view], { type: 'audio/wav' });
}

/**
 * Concatenates multiple AudioBuffers sequentially with an optional gap
 */
export async function concatenateAudioBuffers(buffers: AudioBuffer[], gapSeconds = 0.4): Promise<AudioBuffer> {
  if (buffers.length === 0) {
    throw new Error('Chưa có đoạn âm thanh nào để ghép nối.');
  }
  if (buffers.length === 1) {
    return buffers[0];
  }

  const sampleRate = buffers[0].sampleRate;
  const numChannels = Math.max(...buffers.map(b => b.numberOfChannels), 2);

  let totalSamples = 0;
  for (let i = 0; i < buffers.length; i++) {
    totalSamples += Math.round(buffers[i].duration * sampleRate);
    if (i < buffers.length - 1) {
      totalSamples += Math.round(gapSeconds * sampleRate);
    }
  }

  const OfflineCtx = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  const offlineContext = new OfflineCtx(numChannels, totalSamples, sampleRate);

  let currentTime = 0;
  for (let i = 0; i < buffers.length; i++) {
    const buf = buffers[i];
    const source = offlineContext.createBufferSource();
    source.buffer = buf;
    source.connect(offlineContext.destination);
    source.start(currentTime);
    currentTime += buf.duration + gapSeconds;
  }

  return await offlineContext.startRendering();
}

export interface MixOptions {
  voiceBuffer: AudioBuffer;
  bgmBuffer: AudioBuffer;
  voiceVolume?: number; // 0.0 - 2.0 (default 1.0)
  bgmVolume?: number;   // 0.0 - 1.0 (default 0.22)
  loopBgm?: boolean;    // default true
  fadeInSeconds?: number; // default 1.0
  fadeOutSeconds?: number; // default 2.0
  matchFullMusicDuration?: boolean; // Khi bật: Giữ trọn vẹn độ dài bài nhạc nền hoàn chỉnh
  voiceDelaySeconds?: number; // Độ trễ trước khi bắt đầu giọng đọc (đoạn dạo đầu bài hát)
  duckMusicUnderVoice?: boolean; // Tự động giảm âm lượng nhạc khi đang có giọng đọc (Smart Ducking)
  duckedBgmVolume?: number; // Âm lượng nhạc nền khi đang có giọng đọc
}

/**
 * Mixes a voice track with background music (BGM).
 * Supports full-track music preservation, voice delay offset, and smart ducking.
 */
export async function mixVoiceAndBgm({
  voiceBuffer,
  bgmBuffer,
  voiceVolume = 1.0,
  bgmVolume = 0.22,
  loopBgm = true,
  fadeInSeconds = 1.0,
  fadeOutSeconds = 2.0,
  matchFullMusicDuration = false,
  voiceDelaySeconds = 0,
  duckMusicUnderVoice = false,
  duckedBgmVolume = 0.15,
}: MixOptions): Promise<AudioBuffer> {
  const sampleRate = voiceBuffer.sampleRate;
  const numChannels = 2; // Stereo output

  const voiceStartTime = Math.max(0, voiceDelaySeconds);
  const voiceDuration = voiceBuffer.duration;
  const voiceEndTime = voiceStartTime + voiceDuration;

  let totalDuration: number;
  if (matchFullMusicDuration) {
    // Phối hoàn chỉnh cả bài: giữ trọn vẹn toàn bộ độ dài bài hát (hoặc giọng đọc nếu dài hơn)
    totalDuration = Math.max(voiceEndTime + 2.0, bgmBuffer.duration);
  } else {
    // Theo độ dài giọng đọc
    totalDuration = voiceEndTime;
  }

  const totalSamples = Math.ceil(totalDuration * sampleRate);
  const OfflineCtx = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  const offlineContext = new OfflineCtx(numChannels, totalSamples, sampleRate);

  // 1. Voice Source & Gain
  const voiceSource = offlineContext.createBufferSource();
  voiceSource.buffer = voiceBuffer;
  const voiceGain = offlineContext.createGain();
  voiceGain.gain.setValueAtTime(voiceVolume, voiceStartTime);
  voiceSource.connect(voiceGain);
  voiceGain.connect(offlineContext.destination);
  voiceSource.start(voiceStartTime);

  // 2. BGM Source & Gain with dynamic fade & optional ducking
  const bgmSource = offlineContext.createBufferSource();
  bgmSource.buffer = bgmBuffer;
  bgmSource.loop = loopBgm;
  if (loopBgm) {
    bgmSource.loopEnd = bgmBuffer.duration;
  }

  const bgmGain = offlineContext.createGain();
  const effectiveFadeIn = Math.min(fadeInSeconds, totalDuration * 0.25);
  const effectiveFadeOut = Math.min(fadeOutSeconds, totalDuration * 0.4);

  // Initial fade-in
  bgmGain.gain.setValueAtTime(0.001, 0);

  if (duckMusicUnderVoice && voiceStartTime <= 0.2) {
    bgmGain.gain.exponentialRampToValueAtTime(Math.max(0.001, duckedBgmVolume), Math.max(0.05, effectiveFadeIn));
  } else {
    bgmGain.gain.exponentialRampToValueAtTime(Math.max(0.001, bgmVolume), Math.max(0.05, effectiveFadeIn));
  }

  if (duckMusicUnderVoice) {
    if (voiceStartTime > 0.3) {
      // Đoạn dạo đầu bài hát ở âm lượng chuẩn bgmVolume
      bgmGain.gain.setValueAtTime(bgmVolume, Math.max(effectiveFadeIn, voiceStartTime - 0.4));
      // Tự động hạ êm dịu khi giọng đọc cất lên
      bgmGain.gain.linearRampToValueAtTime(duckedBgmVolume, voiceStartTime + 0.3);
    }

    // Khi giọng đọc kết thúc, hồi phục âm lượng tự nhiên để chơi nốt phần còn lại của bài hát
    if (voiceEndTime < totalDuration - 1.0) {
      bgmGain.gain.setValueAtTime(duckedBgmVolume, voiceEndTime);
      bgmGain.gain.linearRampToValueAtTime(bgmVolume, voiceEndTime + 1.2);
    }
  }

  // Fade-out nhẹ nhàng ở nốt cuối cùng của bài hát
  const fadeOutStart = Math.max(0, totalDuration - effectiveFadeOut);
  bgmGain.gain.setValueAtTime(bgmVolume, fadeOutStart);
  bgmGain.gain.linearRampToValueAtTime(0.0001, totalDuration);
  bgmGain.gain.setValueAtTime(0, totalDuration + 0.01);

  bgmSource.connect(bgmGain);
  bgmGain.connect(offlineContext.destination);
  bgmSource.start(0);

  return await offlineContext.startRendering();
}

/**
 * Formats seconds into mm:ss
 */
export function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Trims an AudioBuffer between startTime and endTime (in seconds)
 */
export function trimAudioBuffer(buffer: AudioBuffer, startTime: number, endTime: number): AudioBuffer {
  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;

  const validStart = Math.max(0, Math.min(startTime, buffer.duration));
  const validEnd = Math.max(validStart + 0.05, Math.min(endTime, buffer.duration));

  const startOffset = Math.floor(validStart * sampleRate);
  const endOffset = Math.floor(validEnd * sampleRate);
  const frameCount = Math.max(1, endOffset - startOffset);

  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new AudioCtx({ sampleRate });
  const trimmed = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let c = 0; c < numChannels; c++) {
    const src = buffer.getChannelData(c);
    const dest = trimmed.getChannelData(c);
    dest.set(src.subarray(startOffset, endOffset));
  }

  if (ctx.state !== 'closed') ctx.close();
  return trimmed;
}

/**
 * Formats seconds with tenths, e.g. 01:23.4
 */
export function formatTimeDetailed(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00.0';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds % 1) * 10);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${tenths}`;
}

export interface IntroVoiceOutroOptions {
  introBuffer: AudioBuffer;
  voiceBuffer: AudioBuffer;
  outroBuffer: AudioBuffer;
  introDuration?: number;
  outroDuration?: number;
  introVolume?: number;
  voiceVolume?: number;
  outroVolume?: number;
  crossfadeSeconds?: number;
  playBgmUnderVoice?: boolean;
  bgmUnderVoiceVolume?: number;
  outroFromEnd?: boolean;
  matchFullSongLength?: boolean; // Khi bật: Phối nhạc hoàn chỉnh toàn bộ cả bài hát
  isContinuousSameSong?: boolean; // Khi bật: Dùng chung 1 bài hát liền mạch từ đầu tới kết thúc
}

/**
 * Mixes audio in the classic [Intro -> Voice -> Outro] broadcast podcast structure
 * with smooth crossfades and optional ducked background music during narration.
 * Supports complete full-song continuous mixing.
 */
export async function mixIntroVoiceOutro({
  introBuffer,
  voiceBuffer,
  outroBuffer,
  introDuration = 4.0,
  outroDuration = 5.0,
  introVolume = 1.0,
  voiceVolume = 1.0,
  outroVolume = 1.0,
  crossfadeSeconds = 0.8,
  playBgmUnderVoice = false,
  bgmUnderVoiceVolume = 0.18,
  outroFromEnd = false,
  matchFullSongLength = false,
  isContinuousSameSong = false,
}: IntroVoiceOutroOptions): Promise<AudioBuffer> {
  const sampleRate = voiceBuffer.sampleRate;
  const numChannels = 2;

  const validIntroDur = Math.max(1.0, Math.min(introDuration, introBuffer.duration));
  const validOutroDur = Math.max(1.0, Math.min(outroDuration, outroBuffer.duration));
  const safeCrossfade = Math.min(crossfadeSeconds, validIntroDur * 0.4, validOutroDur * 0.4);

  const voiceStartTime = validIntroDur - safeCrossfade;
  const voiceDuration = voiceBuffer.duration;
  const voiceEndTime = voiceStartTime + voiceDuration;

  const outroStartTime = Math.max(voiceStartTime + 0.1, voiceEndTime - safeCrossfade);

  let totalDuration: number;
  if (playBgmUnderVoice && matchFullSongLength) {
    // Phối hoàn chỉnh cả bài: độ dài theo trọn vẹn cả bài hát
    totalDuration = Math.max(outroStartTime + validOutroDur, introBuffer.duration);
  } else {
    // Theo độ dài outro thông thường
    totalDuration = outroStartTime + validOutroDur;
  }

  const totalSamples = Math.ceil(totalDuration * sampleRate);
  const OfflineCtx = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  const offlineContext = new OfflineCtx(numChannels, totalSamples, sampleRate);

  // 1. INTRO / CONTINUOUS MASTER MUSIC TRACK
  const introSource = offlineContext.createBufferSource();
  introSource.buffer = introBuffer;
  const introGain = offlineContext.createGain();

  introGain.gain.setValueAtTime(introVolume, 0);

  if (playBgmUnderVoice) {
    // Duck down when voice starts
    introGain.gain.setValueAtTime(introVolume, voiceStartTime);
    introGain.gain.linearRampToValueAtTime(bgmUnderVoiceVolume, voiceStartTime + safeCrossfade);

    // If intro audio is shorter than total duration, loop it smoothly
    if (introBuffer.duration < totalDuration) {
      introSource.loop = true;
      introSource.loopEnd = introBuffer.duration;
    }

    if (isContinuousSameSong) {
      // BÀI HÁT LIỀN MẠCH HOÀN CHỈNH:
      // Không tắt nhạc, mà khi giọng đọc kết thúc, âm lượng bài hát tự động tăng lên (swell back up)
      introGain.gain.setValueAtTime(bgmUnderVoiceVolume, outroStartTime);
      introGain.gain.linearRampToValueAtTime(outroVolume, outroStartTime + safeCrossfade);

      // Fade-out êm ái ở cuối bài hát
      const songFadeOutStart = Math.max(outroStartTime + safeCrossfade, totalDuration - 2.5);
      introGain.gain.setValueAtTime(outroVolume, songFadeOutStart);
      introGain.gain.linearRampToValueAtTime(0.00001, totalDuration);
      introGain.gain.setValueAtTime(0, totalDuration + 0.01);
    } else {
      // Có file Outro riêng biệt: fade out nhạc intro để nhường chỗ cho outro riêng
      introGain.gain.setValueAtTime(bgmUnderVoiceVolume, outroStartTime);
      introGain.gain.linearRampToValueAtTime(0.0001, outroStartTime + safeCrossfade);
      introGain.gain.setValueAtTime(0, outroStartTime + safeCrossfade + 0.01);
      try {
        introSource.stop(outroStartTime + safeCrossfade + 0.05);
      } catch {
        // ignore
      }
    }
  } else {
    // FADE OUT INTRO COMPLETELY & STOP
    // In this mode, music stops completely so only pure voice is heard in the middle
    introGain.gain.setValueAtTime(introVolume, voiceStartTime);
    introGain.gain.linearRampToValueAtTime(0.00001, voiceStartTime + safeCrossfade);
    introGain.gain.setValueAtTime(0, voiceStartTime + safeCrossfade + 0.01);
    try {
      introSource.stop(voiceStartTime + safeCrossfade + 0.02);
    } catch {
      // ignore
    }
  }

  introSource.connect(introGain);
  introGain.connect(offlineContext.destination);
  introSource.start(0);

  // 2. MAIN VOICE TRACK
  const voiceSource = offlineContext.createBufferSource();
  voiceSource.buffer = voiceBuffer;
  const voiceGain = offlineContext.createGain();
  voiceGain.gain.setValueAtTime(voiceVolume, voiceStartTime);
  voiceSource.connect(voiceGain);
  voiceGain.connect(offlineContext.destination);
  voiceSource.start(voiceStartTime);

  // 3. OUTRO TRACK
  // Chỉ tạo source riêng nếu KHÔNG PHẢI là bài hát liền mạch với Intro
  if (!isContinuousSameSong || !playBgmUnderVoice) {
    const outroSource = offlineContext.createBufferSource();
    outroSource.buffer = outroBuffer;
    const outroGain = offlineContext.createGain();

    // Crossfade in at outroStartTime
    outroGain.gain.setValueAtTime(0.00001, outroStartTime);
    outroGain.gain.linearRampToValueAtTime(outroVolume, outroStartTime + safeCrossfade);

    // Fade out smoothly over the final 1.5s
    const outroFadeOutStart = Math.max(outroStartTime + safeCrossfade, totalDuration - 1.5);
    outroGain.gain.setValueAtTime(outroVolume, outroFadeOutStart);
    outroGain.gain.linearRampToValueAtTime(0.00001, totalDuration);
    outroGain.gain.setValueAtTime(0, totalDuration + 0.01);

    outroSource.connect(outroGain);
    outroGain.connect(offlineContext.destination);

    // Start outro either from beginning or from end of buffer if requested
    const outroBufferOffset = (outroFromEnd && outroBuffer.duration > validOutroDur)
      ? Math.max(0, outroBuffer.duration - validOutroDur)
      : 0;

    outroSource.start(outroStartTime, outroBufferOffset);
    try {
      outroSource.stop(totalDuration + 0.05);
    } catch {
      // ignore
    }
  }

  return await offlineContext.startRendering();
}


