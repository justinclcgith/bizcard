/**
 * Claude Messages API（REST，GAS 無官方 SDK）。格式見 docs/05 §4。
 */

var CLAUDE_ENDPOINT = 'https://api.anthropic.com/v1/messages';

function buildClaudeRequest_(props, image, prompt, opts) {
  var key = props.getProperty('ANTHROPIC_API_KEY');
  if (!key) throw new AppError('AI_ERROR', '尚未設定 Claude 金鑰');
  var body = {
    model: props.getProperty('CLAUDE_MODEL') || 'claude-opus-5-5',
    max_tokens: 16000,
    fallbacks: 'default',
    output_config: {
      effort: (opts && opts.claudeEffort) || props.getProperty('CLAUDE_EFFORT') || 'low',
      format: { type: 'json_schema', schema: CARD_SCHEMA_V1 }
    },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: image.mime, data: image.base64 } },
        { type: 'text', text: prompt }
      ]
    }]
  };
  return {
    url: CLAUDE_ENDPOINT,
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2026-10-21',
      'anthropic-beta': 'server-side-fallback-2026-07-01'
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  };
}

/** @return {{output: Object, model: string, usage: {input: number, output: number}}} */
function parseClaudeResponse_(resp) {
  var code = resp.getResponseCode();
  var json;
  try { json = JSON.parse(resp.getContentText()); } catch (e) { json = null; }
  if (code !== 200 || !json) {
    var msg = json && json.error ? json.error.type : ('HTTP ' + code);
    if (code === 429 || code === 529) throw new AppError('AI_ERROR', 'Claude 目前忙碌，請稍後再試（' + msg + '）');
    throw new AppError('AI_ERROR', 'Claude 呼叫失敗（' + msg + '）');
  }
  if (json.stop_reason === 'refusal') throw new AppError('AI_REFUSED', 'Claude 拒絕處理這張圖片');
  if (json.stop_reason === 'max_tokens') throw new AppError('AI_ERROR', 'Claude 輸出被截斷，請減少單張照片中的名片數');
  var text = (json.content || [])
    .filter(function (b) { return b.type === 'text'; })
    .map(function (b) { return b.text; })
    .join('');
  var output;
  try { output = JSON.parse(text); } catch (e) {
    throw new AppError('AI_ERROR', 'Claude 回傳格式無法解析');
  }
  return {
    output: output,
    model: json.model || '',
    usage: { input: (json.usage && json.usage.input_tokens) || 0, output: (json.usage && json.usage.output_tokens) || 0 }
  };
}
