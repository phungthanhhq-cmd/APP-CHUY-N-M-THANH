import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '15mb' }));

const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';

const ai = new GoogleGenAI({
  apiKey: apiKey,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

const VALID_VOICES = new Set(['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr']);

app.post('/api/generate-speech', async (req, res) => {
  try {
    const { text, voiceId, style, speed, pitch, language } = req.body;

    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Vui lòng nhập văn bản cần chuyển đổi.' });
    }

    if (!apiKey) {
      return res.status(500).json({
        error: 'Chưa cấu hình API Key trên máy chủ. Hãy kiểm tra mục Settings > Secrets.',
      });
    }

    // Strip SSML/HTML tags to prevent TTS reading markup tags aloud
    const cleanText = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    const selectedVoice = VALID_VOICES.has(voiceId) ? voiceId : 'Kore';
    const isVietnamese = !language || language === 'vi';

    // Build natural style description in the matching language without causing code-switching into English
    let styleDescription = style;
    if (isVietnamese) {
      if (!styleDescription || styleDescription.includes('Clear, natural') || styleDescription.includes('professional speaker')) {
        styleDescription = 'Giọng đọc tiếng Việt truyền cảm, tự nhiên, chuẩn phát âm, không chèn từ tiếng Anh, rõ chữ';
      }
      if (speed && typeof speed === 'number') {
        if (speed > 1.25) styleDescription += ', tốc độ đọc nhanh, lưu loát';
        else if (speed < 0.85) styleDescription += ', tốc độ đọc chậm rãi, lắng đọng';
      }
      if (pitch && typeof pitch === 'number') {
        if (pitch >= 3) styleDescription += ', âm điệu thanh thoát, cao và sáng';
        else if (pitch <= -2) styleDescription += ', giọng trầm ấm, sâu lắng, dày dặn';
      }
    } else {
      if (!styleDescription) {
        styleDescription = 'Clear, natural, professional speaker';
      }
      if (speed && typeof speed === 'number') {
        if (speed > 1.25) styleDescription += ', speaking at a brisk pace';
        else if (speed < 0.85) styleDescription += ', speaking at a slow, calm, measured pace';
      }
      if (pitch && typeof pitch === 'number') {
        if (pitch >= 3) styleDescription += ', in a bright, higher-pitched tone';
        else if (pitch <= -2) styleDescription += ', in a deep, warm, resonant tone';
      }
    }

    // System instruction to strictly forbid intro/outro chatter or English hallucination
    const systemInstruction = isVietnamese
      ? `Bạn là công cụ phát thanh viên Text-To-Speech (TTS) tiếng Việt chuẩn xác.
NHIỆM VỤ: Đọc to chính xác nguyên văn từng từ 100% trong văn bản được cung cấp bằng tiếng Việt thuần túy.
CÁC ĐIỀU CẤM TUYỆT ĐỐI:
1. TUYỆT ĐỐI KHÔNG thêm bất kỳ câu chào hỏi, lời mở đầu hoặc dẫn nhập bằng tiếng Anh hay bất cứ ngôn ngữ nào (ví dụ: không bao giờ nói "Sure", "Okay", "Here is", "Certainly", "Alright", "Hello").
2. TUYỆT ĐỐI KHÔNG thêm lời kết thúc, nhận xét, bình luận hoặc cảm ơn ở cuối (ví dụ: không nói "Thank you", "The end", "Goodbye").
3. TUYỆT ĐỐI KHÔNG tự ý dịch sang tiếng Anh hoặc chêm xen từ tiếng Anh vào bài đọc trừ khi trong chính văn bản gốc của người dùng có chứa từ tiếng Anh đó.
4. Bắt đầu đọc ngay từ từ đầu tiên của văn bản và kết thúc ngay tại từ cuối cùng.`
      : `You are a professional Text-To-Speech (TTS) narrator. Read the provided text aloud verbatim word-for-word. Do NOT add any introduction, greeting, commentary, filler, or concluding remarks.`;

    const userPromptText = isVietnamese
      ? `VĂN BẢN TIẾNG VIỆT CẦN ĐỌC CHÍNH XÁC NGUYÊN VĂN (Đọc đúng 100% từng chữ tiếng Việt, không thêm bớt, không chêm từ tiếng Anh):\n\n${cleanText}`
      : cleanText;

    // Use gemini-3.8-flash-lite-tts first (optimized for article reading/screen reader without backchanneling),
    // with gemini-3.8-flash-tts as fallback
    const candidateModels = ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'];
    let lastError: any = null;
    let base64Audio: string | undefined = undefined;

    for (const modelName of candidateModels) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: userPromptText,
                  speechMetadata: {
                    style: styleDescription,
                  },
                },
              ],
            },
          ] as any,
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: selectedVoice },
              },
            },
            systemInstruction: systemInstruction,
          },
        });

        base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (base64Audio) {
          return res.json({ audio: base64Audio, modelUsed: modelName });
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`Model ${modelName} encountered an error:`, err?.message || err);
        // Continue to try next candidate model
      }
    }

    if (!base64Audio) {
      const rawMsg = lastError?.message || '';
      console.error('All TTS models failed. Last error:', rawMsg);

      let friendlyMsg = 'Lỗi khi gọi dịch vụ tạo giọng nói AI.';
      if (rawMsg.includes('429') || rawMsg.includes('RESOURCE_EXHAUSTED') || rawMsg.includes('quota') || rawMsg.includes('Quota exceeded')) {
        friendlyMsg = 'Hạn mức lượt dùng thử miễn phí của Google Gemini API (Free Tier Quota) tạm thời đã đạt giới hạn trong ngày. Vui lòng thử lại sau ít phút hoặc sử dụng tính năng giọng đọc dự phòng.';
      } else if (rawMsg.includes('API_KEY')) {
        friendlyMsg = 'Lỗi cấu hình API Key trên máy chủ. Vui lòng kiểm tra lại thiết lập hệ thống.';
      } else {
        try {
          const parsed = JSON.parse(rawMsg);
          if (parsed?.error?.message) {
            friendlyMsg = parsed.error.code === 429 
              ? 'Hạn mức lượt dùng thử miễn phí hôm nay đã hết. Vui lòng thử lại sau.'
              : parsed.error.message;
          }
        } catch {
          friendlyMsg = rawMsg.length > 200 ? rawMsg.slice(0, 200) + '...' : rawMsg;
        }
      }

      return res.status(500).json({ error: friendlyMsg });
    }
  } catch (error: any) {
    console.error('Error in /api/generate-speech:', error);
    const msg = error?.message || 'Lỗi khi gọi dịch vụ chuyển văn bản thành giọng nói.';
    return res.status(500).json({ error: msg });
  }
});

// Catch-all for undefined /api routes without path-to-regexp syntax error
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: `API route ${req.method} ${req.path} không tồn tại.` });
  }
  next();
});

async function startServer() {
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.use((_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
