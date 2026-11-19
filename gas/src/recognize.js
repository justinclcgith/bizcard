/**
 * recognize 動作：提示詞、Schema、引擎分派、紀錄（docs/05）。
 */

var PROMPT_VERSION = 'v1';

var PROMPT_V1 = [
  '你是名片辨識系統。圖片中可能有 0 到 20 張名片，可能是正面或背面，可能歪斜或倒置。',
  '',
  '請找出圖片中每一張「完整或大部分可見」的名片，依由上到下、由左到右的順序，對每張輸出：',
  '1. box_2d：名片外框 [ymin, xmin, ymax, xmax]，以整張圖片寬高正規化為 0–1000 的整數。框要包住整張名片，寧可略大不要切到。',
  '2. orientation：讓文字轉正需要順時針旋轉的角度："0" / "90" / "180" / "270"。',
  '3. fields：名片上的資訊。規則：',
  '   - 完全照名片上的字抄寫，繁體中文保持繁體，不要翻譯，不要轉成簡體。',
  '   - 名片上同時有中文與英文時分別填入 *_zh 與 *_en；只有一種語言時只填那一種，另一個留空字串。',
  '   - 姓名：name_zh 為中文姓名（不含職稱），name_en 為英文姓名（保留原大小寫）。',
  '   - 電話：所有號碼依名片原樣抄寫到 mobiles / phones / faxes，分機寫在 ext。手機是 09 開頭或標示 Mobile/M/手機 的號碼。',
  '   - company_short：依常見稱呼建議公司簡稱（例如「台灣積體電路製造股份有限公司」→「台積電」，「PrimoBio Inc.」→「PrimoBio」），沒有把握時用英文名稱的主要字詞或中文名稱去掉「股份有限公司」等字尾。',
  '   - 看不清楚或沒有的欄位填空字串，不要猜。',
  '4. low_confidence_fields：你不確定的欄位名稱清單（例如字太小、反光、手寫）。',
  '5. side："front"（有姓名的一面）、"back"（只有公司資訊或另一語言）、"unknown"。',
  '',
  '只輸出符合 Schema 的 JSON。圖片中沒有名片時，cards 為空陣列。'
].join('\n');

var BACK_SIDE_SUFFIX = '\n\n這是某張名片的背面，請照同樣規則輸出，box_2d 可為整張圖。';

function strProp_() { return { type: 'string' }; }
function strArr_() { return { type: 'array', items: { type: 'string' } }; }

var CARD_SCHEMA_V1 = {
  type: 'object',
  additionalProperties: false,
  required: ['cards'],
  properties: {
    cards: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['box_2d', 'orientation', 'side', 'fields', 'low_confidence_fields'],
        properties: {
          box_2d: { type: 'array', items: { type: 'integer' } },
          orientation: { type: 'string', enum: ['0', '90', '180', '270'] },
          side: { type: 'string', enum: ['front', 'back', 'unknown'] },
          low_confidence_fields: strArr_(),
          fields: {
            type: 'object',
            additionalProperties: false,
            required: ['name_zh', 'name_en', 'title_zh', 'title_en', 'department',
              'company_zh', 'company_en', 'company_short', 'mobiles', 'phones', 'faxes',
              'emails', 'website', 'address_zh', 'address_en', 'line_id', 'linkedin', 'other_social'],
            properties: {
              name_zh: strProp_(), name_en: strProp_(),
              title_zh: strProp_(), title_en: strProp_(),
              department: strProp_(),
              company_zh: strProp_(), company_en: strProp_(), company_short: strProp_(),
              mobiles: strArr_(),
              phones: {
                type: 'array',
                items: {
                  type: 'object', additionalProperties: false, required: ['number', 'ext'],
                  properties: { number: strProp_(), ext: strProp_() }
                }
              },
              faxes: strArr_(),
              emails: strArr_(),
              website: strProp_(),
              address_zh: strProp_(), address_en: strProp_(),
              line_id: strProp_(), linkedin: strProp_(),
              other_social: strArr_()
            }
          }
        }
      }
    }
  }
};

/** 用函式回傳，避免 GAS 檔案載入順序影響。 */
function getProviders_() {
  return {
    claude: { build: buildClaudeRequest_, parse: parseClaudeResponse_ },
    gemini: { build: buildGeminiRequest_, parse: parseGeminiResponse_ }
  };
}

function handleRecognize(req) {
  var image = req.image || {};
  if (!image.base64 || !/^image\/(jpeg|png|webp)$/.test(image.mime || '')) {
    throw new AppError('BAD_REQUEST', '缺少圖片或圖片格式不支援');
  }
  var props = PropertiesService.getScriptProperties();
  var PROVIDERS = getProviders_();
  var provider = req.provider || props.getProperty('DEFAULT_PROVIDER') || 'claude';
  var prompt = PROMPT_V1 + (req.side === 'back' ? BACK_SIDE_SUFFIX : '');
  var photoBytes = Math.floor(image.base64.length * 3 / 4);

  if (provider === 'compare') {
    var names = ['claude', 'gemini'];
    var groupId = Utilities.getUuid();
    var started = Date.now();
    var results = {};
    var ready = [];
    var requests = [];
    names.forEach(function (n) {
      try {
        requests.push(PROVIDERS[n].build(props, image, prompt));
        ready.push(n);
      } catch (err) {
        results[n] = { error: { code: err.code || 'INTERNAL', message: err.message || '辨識失敗' } };
      }
    });
    var responses = requests.length ? UrlFetchApp.fetchAll(requests) : [];
    var latency = Date.now() - started;
    ready.forEach(function (n, i) {
      try {
        results[n] = finishResult_(n, PROVIDERS[n].parse(responses[i]), latency, photoBytes, groupId, props);
      } catch (err) {
        logRecognition_(n, '', photoBytes, 0, latency, null, 'error', err.code || 'INTERNAL', groupId);
        results[n] = { error: { code: err.code || 'INTERNAL', message: err.message || '辨識失敗' } };
      }
    });
    return { results: results, compareGroupId: groupId };
  }

  var p = Object.prototype.hasOwnProperty.call(PROVIDERS, provider) ? PROVIDERS[provider] : null;
  if (!p) throw new AppError('BAD_REQUEST', '不支援的辨識引擎：' + provider);
  var t0 = Date.now();
  var parsed;
  try {
    var request = p.build(props, image, prompt);
    parsed = p.parse(UrlFetchApp.fetch(request.url, request));
  } catch (err) {
    logRecognition_(provider, '', photoBytes, 0, Date.now() - t0, null, 'error', err.code || 'INTERNAL', '');
    throw err;
  }
  return finishResult_(provider, parsed, Date.now() - t0, photoBytes, '', props);
}

function finishResult_(provider, parsed, latencyMs, photoBytes, groupId, props) {
  var cards = normalizeRecognition(parsed.output);
  var cost = estimateCost_(provider, parsed.usage, props);
  logRecognition_(provider, parsed.model, photoBytes, cards.length, latencyMs, parsed.usage, 'ok', '', groupId, cost);
  return {
    provider: provider,
    model: parsed.model,
    promptVersion: PROMPT_VERSION,
    latencyMs: latencyMs,
    usage: { inputTokens: parsed.usage.input, outputTokens: parsed.usage.output, estCostUsd: cost },
    cards: cards,
    warnings: []
  };
}

function estimateCost_(provider, usage, props) {
  var key = provider === 'claude' ? 'CLAUDE' : 'GEMINI';
  var pin = Number(props.getProperty('PRICE_' + key + '_IN') || 0);
  var pout = Number(props.getProperty('PRICE_' + key + '_OUT') || 0);
  return Math.round(((usage.input * pin + usage.output * pout) / 1e6) * 1e6) / 1e6;
}

function logRecognition_(provider, model, photoBytes, cards, latency, usage, status, errorCode, groupId, cost) {
  try {
    var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    if (!id) return;
    SpreadsheetApp.openById(id).getSheetByName('RecognitionLog').appendRow([
      new Date(), provider, model || '', photoBytes, cards, latency,
      usage ? usage.input : '', usage ? usage.output : '', cost || '', status, errorCode || '', groupId || ''
    ]);
  } catch (e) { /* 記錄失敗不影響主流程 */ }
}

