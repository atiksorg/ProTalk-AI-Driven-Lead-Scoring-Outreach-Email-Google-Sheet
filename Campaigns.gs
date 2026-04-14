// =============================================================================
// Campaigns.gs — Управление Кампаниями, Секвенциями, Дедупликацией
// =============================================================================

function getActiveCampaigns(ss) {
  const s = ss.getSheetByName(SHEET_CAMPAIGNS);
  const data = s.getDataRange().getValues();
  let campaigns = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === "active") {
      campaigns.push({
        id: data[i][0],
        mode: data[i][2],
        seqId: data[i][3],
        threshold: Number(data[i][4]) || 50,
        hotLeadScore: Number(data[i][5]) || 80,
        visionPrompt: data[i][6],
        promptA: data[i][7],
        promptB: data[i][8],
        autoSendHotLeads: String(data[i][9]).trim().toLowerCase() === "yes" // Колонка J: авто-отправка HOT_LEADS
      });
    }
  }
  return campaigns;
}

function getQueriesForCampaign(ss, campaignId) {
  const s = ss.getSheetByName(SHEET_QUERIES);
  if (!s) return [];
  const data = s.getDataRange().getValues();
  let queries = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === campaignId && data[i][4] === "active") {
      queries.push({
        query: data[i][1],
        country: data[i][2] || "ru",
        num_results: Number(data[i][3]) || 10
      });
    }
  }
  return queries;
}

function getSequence(ss, seqId) {
  const s = ss.getSheetByName(SHEET_SEQUENCES);
  const data = s.getDataRange().getValues();
  let steps = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === seqId) {
      steps.push({
        stepNum: Number(data[i][1]),
        delayDays: Number(data[i][2]),
        subject: data[i][3],
        template: data[i][4]
      });
    }
  }
  return steps.sort((a,b) => a.stepNum - b.stepNum);
}

// Дедупликация домена (90 дней кулдаун)
function checkDomainCooldown(ss, domain) {
  const s = ss.getSheetByName(SHEET_DOMAIN_ARCHIVE);
  const data = s.getDataRange().getValues();
  const now = new Date();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === domain) {
      let lastDate = new Date(data[i][1]);
      let diffDays = (now - lastDate) / (1000 * 60 * 60 * 24);
      if (diffDays < 90) return false; // Запрещено отправлять
    }
  }
  return true; // Можно отправлять
}

function logDomainContact(ss, domain, campaignId) {
  ss.getSheetByName(SHEET_DOMAIN_ARCHIVE).appendRow([domain, new Date(), campaignId]);
}

// Выбор лучшего промпта (A/B тест)
function selectVariant(ss, campaign) {
  if (!campaign.promptB) return { label: "A", prompt: campaign.promptA };
  
  const s = ss.getSheetByName(SHEET_AB_RESULTS);
  const data = s.getDataRange().getValues();
  let statsA = { sent: 0, replies: 0 }, statsB = { sent: 0, replies: 0 };
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === campaign.id) {
      if (data[i][1] === "A") { statsA.sent = data[i][2]; statsA.replies = data[i][3]; }
      if (data[i][1] === "B") { statsB.sent = data[i][2]; statsB.replies = data[i][3]; }
    }
  }
  
  // Если отправлено больше 20 и есть явный победитель, выбираем его.
  if (statsA.sent > 20 && statsB.sent > 20) {
    let convA = statsA.replies / statsA.sent;
    let convB = statsB.replies / statsB.sent;
    if (convA > convB + 0.05) return { label: "A", prompt: campaign.promptA };
    if (convB > convA + 0.05) return { label: "B", prompt: campaign.promptB };
  }
  
  // Иначе 50/50
  let isA = Math.random() > 0.5;
  return isA ? { label: "A", prompt: campaign.promptA } : { label: "B", prompt: campaign.promptB };
}