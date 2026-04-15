// =============================================================================
// Utils.gs — Константы и помощники
// =============================================================================

const SKIP_REPLY_CHECK     = true; // Отключает проверку ответов на письма для экономии лимитов Gmail API

const SHEET_CONFIG         = "⚙️ CONFIG";
const SHEET_CAMPAIGNS      = "🎯 CAMPAIGNS";
const SHEET_QUERIES        = "🔍 QUERIES";
const SHEET_SEQUENCES      = "🔄 SEQUENCES";
const SHEET_AB_RESULTS     = "⚖️ AB_RESULTS";
const SHEET_DOMAIN_ARCHIVE = "🛡️ DOMAIN_ARCHIVE";
const SHEET_HOT_LEADS      = "🔥 HOT_LEADS";
const SHEET_TASKS          = "📝 TASKS";
const SHEET_EMAIL_TEMPLATES= "✉️ EMAIL_TEMPLATES";
const SHEET_LOG            = "📊 LOG";
const SHEET_SEND_LOG       = "📤 SEND_LOG";
const SHEET_SCHEDULE       = "⏱️ SCHEDULE";
const SHEET_BLACKLIST      = "🚫 BLACKLIST";

// Ключи Telegram в CONFIG
const CFG_TG_BOT_TOKEN     = "TG_BOT_TOKEN";
const CFG_TG_CHAT_ID       = "TG_CHAT_ID";

function readConfig(ss) {
  const sheet = ss.getSheetByName(SHEET_CONFIG);
  const data = sheet.getDataRange().getValues();
  const cfg = {};
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) cfg[data[i][0]] = data[i][1];
  }
  return cfg;
}

function getTasksByStatus(sheet, statusFilter) {
  const data = sheet.getDataRange().getValues();
  let tasks = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][3] === statusFilter) {
      tasks.push({
        rowNum: i + 1,
        url: data[i][0],
        campaign: data[i][1],
        email: data[i][6],
        threadId: data[i][7],
        score: data[i][8]
      });
    }
  }
  return tasks;
}

function updateTaskStatus(sheet, rowNum, status) {
  sheet.getRange(rowNum, 4).setValue(status);
  sheet.getRange(rowNum, 6).setValue(new Date());
}

function logRow(ss, opts) {
  const sheet = ss.getSheetByName(SHEET_LOG);
  if (!sheet) return;
  sheet.appendRow([
    new Date(), opts.status || "", opts.score || "", opts.campaign || "",
    opts.url || "", opts.email || "", opts.screenshot || "", opts.details || "",
    opts.body || "",    // Колонка I — тело сгенерированного письма
    opts.vision || ""   // Колонка J — ответ Vision API (сырой текст)
  ]);
}

function logSendRow(ss, opts) {
  const sheet = ss.getSheetByName(SHEET_SEND_LOG);
  if (!sheet) return;
  sheet.appendRow([
    new Date(),
    opts.status || "",
    opts.campaign || "",
    opts.email || "",
    opts.subject || "",
    opts.body || "",
    opts.aiModel || "",
    opts.aiPrompt || "",
    opts.aiMode || "",
    opts.threadId || "",
    opts.error || ""
  ]);
}

function updateABStats(ss, campId, promptLabel, type) {
  const s = ss.getSheetByName(SHEET_AB_RESULTS);
  const data = s.getDataRange().getValues();
  let found = false;
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === campId && data[i][1] === promptLabel) {
      found = true;
      if (type === "sent") s.getRange(i+1, 3).setValue(Number(data[i][2]) + 1);
      if (type === "reply") s.getRange(i+1, 4).setValue(Number(data[i][3]) + 1);
      
      let sent = s.getRange(i+1, 3).getValue();
      let replies = s.getRange(i+1, 4).getValue();
      s.getRange(i+1, 5).setValue((sent > 0 ? Math.round((replies/sent)*100) : 0) + "%");
      break;
    }
  }
  
  // Если кампания новая — скрипт сам создаст для неё строку в статистике!
  if (!found && type === "sent") {
    s.appendRow([campId, promptLabel, 1, 0, "0%"]);
  } else if (!found && type === "reply") {
    s.appendRow([campId, promptLabel, 0, 1, "100%"]);
  }
}

function testConnection() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = readConfig(ss);
  if (!cfg.BOT_ID || !cfg.BOT_TOKEN) {
    SpreadsheetApp.getUi().alert("❌ Заполни BOT_ID и BOT_TOKEN в CONFIG");
    return;
  }
  const res = callProTalkFunction(cfg, 489, { // 489 = FN_SEARCH
    query: "тест", country: "ru", num_results: 1
  });
  SpreadsheetApp.getUi().alert(
    res.success
      ? "✅ ProTalk API: OK\nURL: " + JSON.stringify(res.result && res.result.result ? res.result.result[0] : res.result)
      : "❌ Ошибка: " + res.error
  );
}

// --- БЛЭКЛИСТ И ЛИМИТЫ ---

function getBlacklist(ss) {
  const sheet = ss.getSheetByName(SHEET_BLACKLIST);
  const data = sheet.getDataRange().getValues();
  let blacklist = { domains: [], emails: [] };
  for (let i = 1; i < data.length; i++) {
    let val = String(data[i][0]).trim().toLowerCase();
    if (val.includes("@")) blacklist.emails.push(val);
    else if (val) blacklist.domains.push(val.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split('/')[0]);
  }
  return blacklist;
}

function isBlacklisted(intel, email, blacklist) {
  if (blacklist.domains.includes(intel.domain)) return true;
  if (email && blacklist.emails.includes(email.toLowerCase())) return true;
  if (email) {
    let emailDomain = email.split('@')[1];
    if (emailDomain && blacklist.domains.includes(emailDomain.toLowerCase())) return true;
  }
  return false;
}

function getDailySentCount(ss) {
  const sheet = ss.getSheetByName(SHEET_LOG);
  const data = sheet.getDataRange().getValues();
  const today = new Date().toDateString();
  let count = 0;
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === "SUCCESS") {
      let logDate = new Date(data[i][0]);
      if (logDate.toDateString() === today) count++;
    }
  }
  return count;
}

function getScheduleConfig(ss) {
  const sheet = ss.getSheetByName(SHEET_SCHEDULE);
  const data = sheet.getDataRange().getValues();
  let config = {
    WORK_HOURS_START: 0,
    WORK_HOURS_END: 24,
    WORK_DAYS: "Mon,Tue,Wed,Thu,Fri",
    MAX_EMAILS_PER_DAY: 50
  };
  for (let i = 1; i < data.length; i++) {
    let key = data[i][0];
    let val = data[i][1];
    if (key === "WORK_HOURS_START") config.WORK_HOURS_START = Number(val) || 0;
    if (key === "WORK_HOURS_END") config.WORK_HOURS_END = Number(val) || 24;
    if (key === "WORK_DAYS") config.WORK_DAYS = val || "Mon,Tue,Wed,Thu,Fri";
    if (key === "MAX_EMAILS_PER_DAY") config.MAX_EMAILS_PER_DAY = Number(val) || 50;
  }
  return config;
}

function getTemplateForCampaign(ss, campaignId) {
  const sheet = ss.getSheetByName(SHEET_EMAIL_TEMPLATES);
  if (!sheet) return null;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === campaignId) {
      // ai_mode: strict | rewrite | full (по умолчанию strict)
      const rawMode = String(data[i][6] || "").trim().toLowerCase();
      const ai_mode = ["strict", "rewrite", "full"].includes(rawMode) ? rawMode : "strict";
      return {
        subject:      data[i][1],
        model:        data[i][2],
        offer_text:   data[i][3],
        followup_text: data[i][4],
        signature:    data[i][5],
        ai_mode:      ai_mode
      };
    }
  }
  return null;
}

function randomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function escapeHtmlForTelegram(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// =============================================================================
// Telegram-уведомления
// =============================================================================

/**
 * Отправляет сообщение в Telegram-чат.
 * Использует cfg.TG_BOT_TOKEN и cfg.TG_CHAT_ID из листа CONFIG.
 * Если токены не заданы — тихо пропускает (не бросает ошибку).
 *
 * @param {Object} cfg   — объект конфига из readConfig()
 * @param {string} text  — текст сообщения (поддерживает HTML-разметку Telegram)
 */
function sendTelegramNotification(cfg, text) {
  const token  = String(cfg[CFG_TG_BOT_TOKEN] || "").trim();
  const chatId = String(cfg[CFG_TG_CHAT_ID]   || "").trim();

  if (!token || !chatId) {
    console.log("⚠️ Telegram: TG_BOT_TOKEN или TG_CHAT_ID не заданы в CONFIG — уведомление пропущено.");
    return;
  }

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const payload = {
      chat_id:    chatId,
      text:       text,
      parse_mode: "HTML",
      disable_web_page_preview: false   // показываем превью скриншота если есть ссылка
    };

    const resp = UrlFetchApp.fetch(url, {
      method:             "post",
      contentType:        "application/json",
      payload:            JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const code = resp.getResponseCode();
    if (code !== 200) {
      console.log(`⚠️ Telegram API вернул ${code}: ${resp.getContentText()}`);
    } else {
      console.log("✅ Telegram-уведомление отправлено.");
    }
  } catch(e) {
    console.log(`⚠️ Ошибка отправки Telegram-уведомления: ${e.message}`);
  }
}

/**
 * Ручной тест Telegram из меню.
 * Отправляет тестовое сообщение в настроенный чат.
 */
function testTelegram() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = readConfig(ss);

  const token  = String(cfg[CFG_TG_BOT_TOKEN] || "").trim();
  const chatId = String(cfg[CFG_TG_CHAT_ID]   || "").trim();

  if (!token || !chatId) {
    SpreadsheetApp.getUi().alert("❌ Заполни TG_BOT_TOKEN и TG_CHAT_ID в листе CONFIG");
    return;
  }

  sendTelegramNotification(cfg,
    "🤖 <b>Комбайн v4.0</b> — тест уведомлений\n\n" +
    "✅ Telegram подключён успешно!\n" +
    "Теперь при появлении нового 🔥 HOT LEAD вы получите уведомление сюда."
  );

  SpreadsheetApp.getUi().alert("✅ Тестовое сообщение отправлено в Telegram. Проверьте чат.");
}
