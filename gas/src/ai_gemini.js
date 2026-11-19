/**
 * Gemini generateContent（REST）。格式見 docs/05 §5；模型 ID 與參數名稱於 P0.5 查證。
 */

function buildGeminiRequest_(props, image, prompt) {
  var key = props.getProperty('GEMINI_API_KEY');
  if (!key) throw new AppError('AI_ERROR', '尚未設定 Gemini 金鑰');
  var model = props.getProperty('GEMINI_MODEL') || 'gemini-3.6-flash';
  var body = {
    contents: [{
      role: 'user',
      parts: [
        { inline_data: { mime_type: image.mime, data: image.base64 } },
        { text: prompt }
      ]
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: CARD_SCHEMA_V1
    }
  };
  return {
    url: 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': key },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  };
}

function parseGeminiResponse_(resp) {
  var code = resp.getResponseCode();
  var json;
  try { json = JSON.parse(resp.getContentText()); } catch (e) { json = null; }
  if (code !== 200 || !json) {
    var msg = json && json.error ? json.error.status : ('HTTP ' + code);
    throw new AppError('AI_ERROR', 'Gemini 呼叫失敗（' + msg + '）');
  }
  var cand = (json.candidates || [])[0];
  if (!cand) {
    if (json.promptFeedback && json.promptFeedback.blockReason) {
      throw new AppError('AI_REFUSED', 'Gemini 拒絕處理這張圖片');
    }
    throw new AppError('AI_ERROR', 'Gemini 沒有回傳結果');
  }
  if (cand.finishReason === 'SAFETY' || cand.finishReason === 'PROHIBITED_CONTENT') {
    throw new AppError('AI_REFUSED', 'Gemini 拒絕處理這張圖片');
  }
  if (cand.finishReason && cand.finishReason !== 'STOP') {
    throw new AppError('AI_ERROR', 'Gemini 未正常結束（' + cand.finishReason + '）');
  }
  var text = ((cand.content && cand.content.parts) || [])
    .filter(function (p) { return typeof p.text === 'string' && !p.thought; })
    .map(function (p) { return p.text; })
    .join('');
  var output;
  try { output = JSON.parse(text); } catch (e) {
    throw new AppError('AI_ERROR', 'Gemini 回傳格式無法解析');
  }
  var u = json.usageMetadata || {};
  return {
    output: output,
    model: json.modelVersion || '',
    usage: { input: u.promptTokenCount || 0, output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) }
  };
}
