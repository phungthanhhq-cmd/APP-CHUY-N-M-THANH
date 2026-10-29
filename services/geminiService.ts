interface TTSRequest {
  text: string;
  voiceId: string;
  speed: number;
  pitch: number;
  isSSML: boolean;
  style?: string;
  language?: string;
}

export async function generateSpeech({ text, voiceId, speed, pitch, isSSML, style, language }: TTSRequest): Promise<string> {
  const maxRetries = 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        // Wait 1.2s before retry if server was warming up
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }

      const response = await fetch('/api/generate-speech', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          text,
          voiceId,
          speed,
          pitch,
          isSSML,
          style,
          language,
        }),
      });

      const contentType = response.headers.get('content-type') || '';

      // If the response is HTML (e.g. Nginx warmup page or fallback)
      if (!contentType.includes('application/json')) {
        const textResp = await response.text();
        if (textResp.includes('<!DOCTYPE') || textResp.includes('<html') || textResp.includes('warmup')) {
          throw new Error('Máy chủ đang khởi động hoặc tạm thời bận. Đang kết nối lại...');
        }
        throw new Error(`Phản hồi không đúng định dạng (${response.status}).`);
      }

      let data: any;
      try {
        data = await response.json();
      } catch {
        throw new Error('Máy chủ đang tải lại dịch vụ. Đang thử kết nối lại...');
      }

      if (!response.ok) {
        let errMsg = data?.error || `Yêu cầu thất bại với mã trạng thái ${response.status}`;
        if (typeof errMsg === 'string') {
          if (errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('quota') || errMsg.includes('Quota exceeded')) {
            errMsg = 'Hạn mức lượt dùng thử miễn phí của Google Gemini API hôm nay đã tạm hết (giới hạn 10 lượt/ngày của gói Free Tier). Hệ thống đã kích hoạt các mô hình dự phòng. Vui lòng bấm thử lại hoặc sử dụng tính năng đọc trình duyệt miễn phí.';
          } else {
            try {
              const parsed = JSON.parse(errMsg);
              if (parsed?.error?.message) {
                errMsg = parsed.error.code === 429
                  ? 'Hạn mức lượt dùng thử miễn phí hôm nay đã hết. Vui lòng thử lại sau.'
                  : parsed.error.message;
              }
            } catch {}
          }
        }
        throw new Error(errMsg);
      }

      if (!data?.audio) {
        throw new Error('Không nhận được dữ liệu âm thanh hợp lệ từ máy chủ.');
      }

      return data.audio;
    } catch (err: any) {
      lastError = err;
      // If validation error from client text, don't retry
      if (err.message && err.message.includes('Vui lòng nhập văn bản')) {
        throw err;
      }
      console.warn(`Lần thử ${attempt + 1}/${maxRetries + 1} gặp sự cố:`, err.message);
    }
  }

  throw lastError || new Error('Không thể kết nối đến máy chủ tạo giọng nói. Vui lòng bấm thử lại.');
}
