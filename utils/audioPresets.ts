/**
 * Generates pleasant ambient background music buffers and intro/outro jingles in-memory
 * using Web Audio API so users can test mixing instantly without needing external audio files.
 */

export interface PresetTrack {
  id: string;
  name: string;
  category: string;
  description: string;
  generate: (sampleRate?: number) => AudioBuffer;
}

export interface PresetJinglePack {
  id: string;
  name: string;
  category: string;
  description: string;
  generateIntro: (sampleRate?: number) => AudioBuffer;
  generateOutro: (sampleRate?: number) => AudioBuffer;
}

export function generateZenMeditation(sampleRate = 44100): AudioBuffer {
  const duration = 24; // 24 seconds loopable
  const length = sampleRate * duration;
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new AudioCtx({ sampleRate });
  const buffer = ctx.createBuffer(2, length, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  const freqs = [108, 136.1, 216, 272.2, 432, 544.4];

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    let sampleL = 0;
    let sampleR = 0;

    for (let f = 0; f < freqs.length; f++) {
      const freq = freqs[f];
      const slowModL = Math.sin(2 * Math.PI * 0.12 * t + f);
      const slowModR = Math.cos(2 * Math.PI * 0.14 * t + f);
      const amp = (0.28 / (f + 1.2)) * (0.6 + 0.4 * slowModL);

      sampleL += amp * Math.sin(2 * Math.PI * freq * t);
      sampleR += amp * Math.sin(2 * Math.PI * (freq * 1.002) * t + 0.3 * slowModR);
    }

    const bellInterval = 8;
    const bellT = t % bellInterval;
    const bellDecay = Math.exp(-bellT * 0.85);
    const bellL = 0.2 * bellDecay * (Math.sin(2 * Math.PI * 528 * t) + 0.5 * Math.sin(2 * Math.PI * 1056 * t));
    const bellR = 0.2 * bellDecay * (Math.sin(2 * Math.PI * 530 * t) + 0.5 * Math.sin(2 * Math.PI * 1058 * t));

    const env = Math.sin((Math.PI * t) / duration);

    left[i] = (sampleL * 0.4 + bellL * 0.6) * Math.min(1, env * 1.5);
    right[i] = (sampleR * 0.4 + bellR * 0.6) * Math.min(1, env * 1.5);
  }

  if (ctx.state !== 'closed') ctx.close();
  return buffer;
}

export function generateSoftRain(sampleRate = 44100): AudioBuffer {
  const duration = 20;
  const length = sampleRate * duration;
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new AudioCtx({ sampleRate });
  const buffer = ctx.createBuffer(2, length, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  let b0L = 0, b1L = 0, b2L = 0, b3L = 0;
  let b0R = 0, b1R = 0, b2R = 0, b3R = 0;

  for (let i = 0; i < length; i++) {
    const whiteL = Math.random() * 2 - 1;
    const whiteR = Math.random() * 2 - 1;

    b0L = 0.99886 * b0L + whiteL * 0.0555179;
    b1L = 0.99332 * b1L + whiteL * 0.0750759;
    b2L = 0.969 * b2L + whiteL * 0.153852;
    b3L = 0.8665 * b3L + whiteL * 0.3104856;
    const pinkL = (b0L + b1L + b2L + b3L) * 0.05;

    b0R = 0.99886 * b0R + whiteR * 0.0555179;
    b1R = 0.99332 * b1R + whiteR * 0.0750759;
    b2R = 0.969 * b2R + whiteR * 0.153852;
    b3R = 0.8665 * b3R + whiteR * 0.3104856;
    const pinkR = (b0R + b1R + b2R + b3R) * 0.05;

    left[i] = pinkL * 0.35;
    right[i] = pinkR * 0.35;
  }

  if (ctx.state !== 'closed') ctx.close();
  return buffer;
}

export function generateLofiPiano(sampleRate = 44100): AudioBuffer {
  const duration = 16;
  const length = sampleRate * duration;
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new AudioCtx({ sampleRate });
  const buffer = ctx.createBuffer(2, length, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  const chords = [
    [146.83, 220.00, 261.63, 329.63, 392.00], // Dm9
    [196.00, 246.94, 329.63, 392.00, 440.00], // G13
    [130.81, 196.00, 246.94, 293.66, 392.00], // Cmaj9
    [110.00, 164.81, 220.00, 261.63, 329.63], // Am7
  ];

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const chordIndex = Math.min(3, Math.floor(t / 4));
    const chordT = t % 4;
    const chordFreqs = chords[chordIndex];

    let chordSampleL = 0;
    let chordSampleR = 0;
    const decay = Math.exp(-chordT * 0.7);

    for (let f = 0; f < chordFreqs.length; f++) {
      const freq = chordFreqs[f];
      const toneL = Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(2 * Math.PI * freq * 2 * t);
      const toneR = Math.sin(2 * Math.PI * (freq * 1.003) * t + 0.05) + 0.3 * Math.sin(2 * Math.PI * (freq * 2.002) * t);
      chordSampleL += toneL * (0.16 / (f + 1));
      chordSampleR += toneR * (0.16 / (f + 1));
    }

    const crackle = (Math.random() > 0.997 ? (Math.random() - 0.5) * 0.03 : 0);

    left[i] = (chordSampleL * decay * 0.5 + crackle);
    right[i] = (chordSampleR * decay * 0.5 + crackle);
  }

  if (ctx.state !== 'closed') ctx.close();
  return buffer;
}

// --- Jingle Generators for Intro / Outro ---

export function generateNewsJingle(type: 'intro' | 'outro', sampleRate = 44100): AudioBuffer {
  const duration = type === 'intro' ? 4.5 : 4.0;
  const length = Math.floor(sampleRate * duration);
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new AudioCtx({ sampleRate });
  const buffer = ctx.createBuffer(2, length, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  // Modern broadcast notes: D4 -> F#4 -> A4 -> D5
  const notes = type === 'intro' ? [293.66, 369.99, 440.0, 587.33] : [587.33, 440.0, 369.99, 293.66];
  const stepDur = 0.5;

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const noteIdx = Math.min(notes.length - 1, Math.floor(t / stepDur));
    const noteT = t % stepDur;
    const freq = notes[noteIdx];

    const noteDecay = Math.exp(-noteT * 3.5);
    const pulse = Math.sin(2 * Math.PI * freq * t) + 0.5 * Math.sin(2 * Math.PI * freq * 2 * t);

    // Sub bass riser
    const subBass = Math.sin(2 * Math.PI * 73.42 * t) * Math.exp(-t * 0.4);

    const env = t < duration - 1.2 ? 1 : Math.max(0, (duration - t) / 1.2);

    const s = (pulse * noteDecay * 0.35 + subBass * 0.25) * env;
    left[i] = s;
    right[i] = s * 0.95;
  }

  if (ctx.state !== 'closed') ctx.close();
  return buffer;
}

export function generateZenJingle(type: 'intro' | 'outro', sampleRate = 44100): AudioBuffer {
  const duration = 5.0;
  const length = Math.floor(sampleRate * duration);
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new AudioCtx({ sampleRate });
  const buffer = ctx.createBuffer(2, length, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  // Sing bowl 432Hz with harmonic resonance
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const bellDecay = Math.exp(-t * 0.65);
    const chime1 = Math.sin(2 * Math.PI * 432 * t);
    const chime2 = 0.5 * Math.sin(2 * Math.PI * 864 * t);
    const chime3 = 0.3 * Math.sin(2 * Math.PI * 1296 * t);
    const deepOm = 0.4 * Math.sin(2 * Math.PI * 108 * t);

    const env = t < duration - 1.5 ? 1 : Math.max(0, (duration - t) / 1.5);
    const s = (chime1 + chime2 + chime3 + deepOm) * bellDecay * 0.45 * env;

    left[i] = s;
    right[i] = s;
  }

  if (ctx.state !== 'closed') ctx.close();
  return buffer;
}

export function generateCinematicJingle(type: 'intro' | 'outro', sampleRate = 44100): AudioBuffer {
  const duration = type === 'intro' ? 4.5 : 4.0;
  const length = Math.floor(sampleRate * duration);
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new AudioCtx({ sampleRate });
  const buffer = ctx.createBuffer(2, length, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Low cinematic boom
    const boomT = t;
    const boom = Math.sin(2 * Math.PI * (55 - t * 4) * t) * Math.exp(-boomT * 1.2);
    // Dark cello tension
    const drone = 0.25 * Math.sin(2 * Math.PI * 110 * t) + 0.15 * Math.sin(2 * Math.PI * 112 * t);

    const env = t < duration - 1.2 ? 1 : Math.max(0, (duration - t) / 1.2);
    const s = (boom * 0.5 + drone * 0.35) * env;

    left[i] = s;
    right[i] = s * 0.9;
  }

  if (ctx.state !== 'closed') ctx.close();
  return buffer;
}

export const PRESET_BGM_TRACKS: PresetTrack[] = [
  {
    id: 'zen-meditation',
    name: 'Thiền Định & Chuông Thanh Tịnh',
    category: 'Tâm Linh / Thiền',
    description: 'Âm thanh sóng Om 432Hz kết hợp chuông bát thanh tịnh, phù hợp lời Phật dạy và podcast sâu lắng.',
    generate: generateZenMeditation,
  },
  {
    id: 'lofi-piano',
    name: 'Piano Lofi Êm Đềm',
    category: 'Kể Chuyện / Thư Giãn',
    description: 'Giai điệu piano acoustic nhẹ nhàng, ấm áp, phù hợp kể chuyện đêm khuya và đọc sách.',
    generate: generateLofiPiano,
  },
  {
    id: 'soft-rain',
    name: 'Tiếng Mưa & Thiên Nhiên',
    category: 'Không Gian Thư Giãn',
    description: 'Âm thanh mưa rơi êm ái, mang lại cảm giác tập trung và bình yên.',
    generate: generateSoftRain,
  },
];

export const PRESET_JINGLE_PACKS: PresetJinglePack[] = [
  {
    id: 'broadcast-news',
    name: 'Thời Sự / Bản Tin Chuyên Nghiệp',
    category: 'Tin Tức / Báo Chí',
    description: 'Nhạc hiệu mở đầu dứt khoát, phong cách thời sự đài truyền hình, và nhạc outro kết thúc sang trọng.',
    generateIntro: (sr) => generateNewsJingle('intro', sr),
    generateOutro: (sr) => generateNewsJingle('outro', sr),
  },
  {
    id: 'zen-temple',
    name: 'Chuông Chùa & Thiền Định',
    category: 'Phật Pháp / Tâm Linh',
    description: 'Chuông đại hồng chung mở đầu lắng đọng và chuông bát thanh tịnh kết bài, thích hợp bài giảng và lời Phật dạy.',
    generateIntro: (sr) => generateZenJingle('intro', sr),
    generateOutro: (sr) => generateZenJingle('outro', sr),
  },
  {
    id: 'cinematic-movie',
    name: 'Kịch Tính / Review Phim',
    category: 'Phim Ảnh / Truyện Ma',
    description: 'Hiệu ứng Cinematic Boom trầm hùng mở màn và outro hồi hộp cuốn hút.',
    generateIntro: (sr) => generateCinematicJingle('intro', sr),
    generateOutro: (sr) => generateCinematicJingle('outro', sr),
  },
];
