/* AskProf 個人學習檔案與 RFID 讀卡展示流程。 */
(function () {
  const originalSave = save;
  const originalRender = render;
  const originalUpdateHeader = updateHeader;
  const originalHandleAction = handleAction;
  const aiEndpoint = window.ASKPROF_AI_ENDPOINT || '/api/analyze-learning';

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value == null ? fallback : value;
    } catch (_) { return fallback; }
  }

  function ownerKey() {
    return encodeURIComponent(String(state.auth?.email || 'guest').trim().toLowerCase());
  }
  function profileKey(name) { return `askProf:${name}:${ownerKey()}`; }
  let loadedOwner = '';
  function loadOwnerData() {
    const nextOwner = ownerKey();
    if (nextOwner === loadedOwner) return;
    loadedOwner = nextOwner;
    state.feedbackEntries = readJson(profileKey('feedback'), []);
    state.cardSessions = readJson(profileKey('cardSessions'), []);
    state.activeCardSession = readJson(profileKey('activeCardSession'), null);
    state.aiAnalysis = readJson(profileKey('aiAnalysis'), null);
    state.aiAnalysisStatus = state.aiAnalysis ? 'ready' : 'idle';
  }
  loadOwnerData();
  state.pendingFeedbackSession = null;

  function persistProfile() {
    originalSave();
    localStorage.setItem(profileKey('feedback'), JSON.stringify(state.feedbackEntries));
    localStorage.setItem(profileKey('cardSessions'), JSON.stringify(state.cardSessions));
    if (state.aiAnalysis) localStorage.setItem(profileKey('aiAnalysis'), JSON.stringify(state.aiAnalysis));
    else localStorage.removeItem(profileKey('aiAnalysis'));
    if (state.activeCardSession) localStorage.setItem(profileKey('activeCardSession'), JSON.stringify(state.activeCardSession));
    else localStorage.removeItem(profileKey('activeCardSession'));
  }
  save = persistProfile;

  function profileDate(value) {
    if (!value) return '尚未記錄';
    return new Date(value).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function subjectOptions() {
    const names = state.courses.map(course => course.name).filter(Boolean);
    return [...new Set([...names, '專題研究', '電子學', '自由學習'])];
  }
  function currentAppointment() {
    return state.appointments.find(item => item.status === 'confirmed') || null;
  }
  function latestBySubject() {
    const map = new Map();
    state.feedbackEntries.forEach(item => {
      if (!map.has(item.subject)) map.set(item.subject, item);
    });
    return [...map.values()];
  }
  function analyzeEntry(entry) {
    const text = `${entry.difficulty || ''} ${entry.nextStep || ''}`;
    const needsHelp = entry.confidence <= 2 || /不懂|困難|卡住|不熟|不會|疑問|混亂|不清楚/.test(text);
    if (needsHelp) return { label: '需要加強', tone: 'attention', reason: '仍有概念或解題卡點' };
    if (entry.confidence >= 5) return { label: '掌握良好', tone: 'good', reason: '能清楚描述本次收穫' };
    return { label: '穩定練習', tone: 'steady', reason: '已有基礎，可透過練習鞏固' };
  }
  function aiSubjectFor(subject) {
    return state.aiAnalysis?.subjects?.find(item => item.subject === subject) || null;
  }
  function entryAnalysis(entry) {
    const ai = aiSubjectFor(entry.subject);
    if (!ai) return analyzeEntry(entry);
    const tone = ai.status === '需要加強' ? 'attention' : ai.status === '掌握良好' ? 'good' : 'steady';
    return { label: ai.status || '穩定練習', tone, reason: ai.reason || 'AI 已完成分析' };
  }
  function profileInsights() {
    const entries = state.feedbackEntries;
    const avg = entries.length ? entries.reduce((sum, item) => sum + Number(item.confidence || 0), 0) / entries.length : 0;
    const topics = latestBySubject().map(item => ({ ...item, analysis: entryAnalysis(item) }));
    const attention = topics.filter(item => item.analysis.tone === 'attention');
    const completed = state.courses.filter(item => item.status === 'done').length;
    const stability = entries.length ? (avg >= 4 ? '穩定' : avg >= 3 ? '持續成長' : '需要陪跑') : '等待建立';
    return { avg, topics, attention, completed, stability };
  }
  function progressBar(value, color) {
    return `<div class="profile-progress"><i style="width:${Math.max(4, Math.min(100, value))}%;background:${color || 'var(--blue)'}"></i></div>`;
  }
  function feedbackRow(item) {
    const analysis = analyzeEntry(item);
    return `<div class="profile-feedback-row"><div class="profile-feedback-icon">${analysis.tone === 'attention' ? '!' : '✓'}</div><div class="profile-feedback-main"><strong>${esc(item.subject)}</strong><span>${esc(item.topic || '學習回饋')}　·　${profileDate(item.createdAt)}</span><small>${esc(item.difficulty || item.nextStep || '已完成一次學習紀錄')}</small></div><span class="profile-status ${analysis.tone}">${analysis.label}</span></div>`;
  }
  function renderProfile() {
    loadOwnerData();
    const insights = profileInsights();
    const session = state.activeCardSession;
    const recent = state.feedbackEntries.slice(0, 5);
    const streak = new Set(state.cardSessions.map(item => new Date(item.checkInAt).toISOString().slice(0, 10))).size;
    const focus = insights.attention[0];
    const suggested = focus?.subject || state.courses.find(item => item.status !== 'done')?.name || '下一個想突破的科目';
    const subjectCards = insights.topics.length ? insights.topics.slice(0, 4).map(item => `<div class="profile-subject-card"><div class="profile-subject-title"><strong>${esc(item.subject)}</strong><span class="profile-status ${item.analysis.tone}">${item.analysis.label}</span></div><p>${esc(item.topic || '學習回饋')}</p><div class="profile-subject-meta"><span>理解程度 ${item.confidence}/5</span><span>${esc(item.nextStep || '持續練習')}</span></div>${progressBar(Number(item.confidence || 0) * 20, item.analysis.tone === 'attention' ? '#ee7b53' : 'var(--blue)')}</div>`).join('') : `<div class="empty-state">完成一次讀卡簽退並留下回饋後，這裡會形成你的學習歷程。</div>`;
    const aiText = state.aiAnalysis?.summary || (insights.attention.length ? `目前在「${focus.subject}」仍有需要釐清的地方。AI 建議把「${focus.topic || '本次討論內容'}」拆成一個小練習，再安排一次專輔或教授預約。` : insights.topics.length ? `你最近的回饋顯示理解度平均 ${insights.avg.toFixed(1)}/5，學習節奏${insights.stability}。送出新的回饋後，正式 AI 服務會重新整理你的學習軌跡。` : '完成第一次簽退回饋後，AskProf 會將資料送至正式 AI 服務，產生個人化分析。');
    const aiLabel = state.aiAnalysisStatus === 'ready' ? '正式 AI 分析' : state.aiAnalysisStatus === 'loading' ? 'AI 分析處理中' : state.aiAnalysisStatus === 'error' ? 'AI 分析連線失敗' : '等待正式 AI 分析';
    const readerState = session ? '已簽到，等待簽退' : '讀卡機已連線（展示模式）';
    app.innerHTML = `<div class="page-heading"><div><p class="eyebrow">PERSONAL LEARNING PROFILE</p><h1>個人學習檔案</h1><p>把每次諮詢、讀卡簽到與自我回饋，整理成看得懂的學習歷程。</p></div><span class="profile-demo-badge">${aiLabel}</span></div>
      <div class="grid profile-stats-grid">${statCard('◉', '學習穩定度', insights.stability, insights.topics.length ? `平均理解 ${insights.avg.toFixed(1)} / 5` : '完成回饋後開始分析', '#2d5bdb')}${statCard('↗', '學習紀錄', state.feedbackEntries.length, '次回饋已保存於本機', '#11a77e')}${statCard('◷', '連續學習天數', streak, streak ? '持續累積中' : '從今天開始', '#ffd529')}${statCard('!', '需要關注科目', insights.attention.length, insights.attention.length ? '建議安排下一步' : '目前沒有標記', '#bd31d8')}</div>
      <section class="panel reader-panel"><div class="reader-panel-copy"><div class="reader-kicker"><span class="reader-dot"></span> RFID × ESP32 學習簽到</div><h2>到場就讀卡，簽退即時留下回饋</h2><p>決賽展示會以按鈕模擬學生證感應；未來由 ESP32／RFID 將簽到事件送到 AskProf，學生手機會自動開啟回饋表單。</p><div class="reader-status"><strong>${readerState}</strong><span>${session ? `開始時間 ${profileDate(session.checkInAt)}${session.appointment ? `｜${esc(session.appointment.topic)}` : ''}` : '可開始一段學習紀錄'}</span></div><div class="reader-actions"><button class="primary-btn" data-action="reader-checkin" ${session ? 'disabled' : ''}>刷卡簽到</button><button class="secondary-btn" data-action="reader-checkout" ${session ? '' : 'disabled'}>刷卡簽退並填回饋</button></div></div><div class="reader-visual"><div class="reader-card-icon">⌁</div><strong>學生證</strong><small>${session ? 'SESSION ACTIVE' : 'READY TO TAP'}</small></div></section>
      <div class="grid two-col profile-main-grid"><section class="panel"><div class="panel-head"><div><h2>個人學習歷程</h2><p>依科目整理最近的回饋與理解狀態</p></div><span class="sub">${insights.topics.length} 個科目</span></div><div class="profile-subject-list">${subjectCards}</div></section><section class="panel ai-profile-panel"><div class="ai-label"><span>✦</span> AI 學習分析</div><h2>${insights.attention.length ? '找到一個可以突破的卡點' : '你的學習節奏摘要'}</h2><p>${esc(aiText)}</p><div class="ai-signal"><span>分析依據</span><strong>回饋 ${state.feedbackEntries.length} 筆｜預約 ${state.appointments.length} 筆｜修課 ${insights.completed} 門</strong></div><div class="ai-panel-actions"><small class="ai-disclaimer">${state.aiAnalysis?.model ? `模型：${esc(state.aiAnalysis.model)}｜分析時間：${profileDate(state.aiAnalysis.generatedAt)}` : '尚未取得正式 AI 後端回應；請部署安全 API 代理後再產生分析。'}</small><button class="link-btn" data-action="refresh-ai" ${state.aiAnalysisStatus === 'loading' ? 'disabled' : ''}>${state.aiAnalysisStatus === 'loading' ? '分析中…' : '重新分析 →'}</button></div></section></div>
      <div class="grid two-col profile-lower-grid"><section class="panel"><div class="panel-head"><div><h2>最近回饋</h2><p>簽退時送出的學習筆記</p></div><span class="sub">${state.feedbackEntries.length} 筆</span></div><div class="profile-feedback-list">${recent.length ? recent.map(feedbackRow).join('') : '<div class="empty-state">還沒有回饋紀錄。</div>'}</div></section><section class="panel next-step-panel"><div class="panel-head"><div><h2>下一步推薦</h2><p>依目前學習狀況安排一個小行動</p></div></div><div class="next-step-card"><span class="next-step-number">01</span><div><strong>${focus ? `再釐清「${esc(focus.subject)}」` : `建立「${esc(suggested)}」的第一筆紀錄`}</strong><p>${focus ? '預約專輔，或帶著一個具體題目再討論一次。' : '到教授探索或專輔專區找到適合的討論入口。'}</p></div><button class="link-btn" data-view="${focus ? 'tutors' : 'professors'}">開始 →</button></div><div class="next-step-card"><span class="next-step-number">02</span><div><strong>簽退後寫下下一步</strong><p>一句話就好，讓下一次討論可以直接接續。</p></div></div></section></div>`;
    bind();
  }

  function openFeedbackModal(session) {
    const options = subjectOptions().map(name => `<option>${esc(name)}</option>`).join('');
    openModal(`<button class="modal-close" data-action="close-modal">×</button><div class="feedback-modal-icon">✦</div><h2>簽退成功，留下今天的學習回饋</h2><p class="modal-sub">回饋會保存到你的個人學習檔案，幫助 AskProf 整理學習歷程。</p><div class="feedback-session-note"><strong>${session.appointment ? esc(session.appointment.topic) : '自由學習紀錄'}</strong><span>簽到 ${profileDate(session.checkInAt)}　·　簽退 ${profileDate(session.checkOutAt)}</span></div><div class="field"><label for="feedbackSubject">科目</label><select id="feedbackSubject">${options}</select></div><div class="field"><label for="feedbackTopic">本次討論／學習主題</label><input id="feedbackTopic" placeholder="例如：Ripple 電壓判讀、資料結構樹狀圖"></div><div class="field"><label for="feedbackConfidence">理解程度（1 最不熟悉，5 已能說明）</label><select id="feedbackConfidence"><option value="1">1｜還不理解</option><option value="2">2｜有明顯卡點</option><option value="3" selected>3｜基本理解</option><option value="4">4｜大致掌握</option><option value="5">5｜可以說明</option></select></div><div class="field"><label for="feedbackDifficulty">哪裡最困難？</label><textarea id="feedbackDifficulty" placeholder="記下卡住的概念、題型或需要再問的地方"></textarea></div><div class="field"><label for="feedbackNextStep">下一步</label><textarea id="feedbackNextStep" placeholder="例如：完成兩題波形判讀，再預約專輔確認"></textarea></div><div class="modal-actions"><button class="ghost-btn" data-action="close-modal">稍後再寫</button><button class="primary-btn" data-action="submit-feedback">保存回饋</button></div>`);
  }

  function syncRoleNavigation() {
    const facultyOnlyHidden = new Set(['courses', 'profile']);
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
      const hidden = state.role === 'professor' && facultyOnlyHidden.has(item.dataset.view);
      item.style.display = hidden ? 'none' : '';
      item.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    });
  }

  async function requestAiAnalysis() {
    state.aiAnalysisStatus = 'loading';
    render();
    try {
      const response = await fetch(aiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedback: state.feedbackEntries.slice(0, 20),
          appointments: state.appointments.slice(0, 20).map(item => ({ topic: item.topic, professor: item.professor, date: item.date })),
          courses: state.courses.map(item => ({ code: item.code, name: item.name, credit: item.credit, status: item.status }))
        })
      });
      if (!response.ok) throw new Error(`AI service ${response.status}`);
      const result = await response.json();
      if (!result.summary || !Array.isArray(result.subjects)) throw new Error('AI response format invalid');
      state.aiAnalysis = { ...result, generatedAt: result.generatedAt || new Date().toISOString() };
      state.aiAnalysisStatus = 'ready';
      persistProfile();
      render();
      toast(`正式 AI 分析完成（${result.model || '已設定模型'}）。`);
    } catch (error) {
      state.aiAnalysisStatus = 'error';
      render();
      toast('正式 AI 分析暫時無法連線，請確認後端 API 已部署。');
      console.warn('AskProf AI analysis failed:', error);
    }
  }

  updateHeader = function () {
    if (state.role === 'professor' && state.view === 'profile') state.view = 'home';
    syncRoleNavigation();
    originalUpdateHeader();
    if (state.view === 'profile') {
      document.getElementById('breadcrumbRoot').textContent = '個人學習檔案';
      document.getElementById('breadcrumbCurrent').textContent = 'AI 學習歷程與回饋分析';
    }
  };
  render = function () {
    if (state.role === 'student' && state.view === 'profile') { updateHeader(); renderProfile(); return; }
    originalRender();
  };
  handleAction = function (action, element) {
    if (action === 'refresh-ai') { if (!state.feedbackEntries.length) return toast('請先完成一次簽退回饋。'); requestAiAnalysis(); return; }
    if (action === 'reader-checkin') {
      if (state.activeCardSession) return toast('目前已有一段進行中的學習紀錄。');
      const appointment = currentAppointment();
      state.activeCardSession = { id: `card-${Date.now()}`, checkInAt: new Date().toISOString(), appointment: appointment ? { id: appointment.id, topic: appointment.topic, professor: appointment.professor } : null };
      persistProfile(); render(); toast('學生證簽到成功，開始記錄這段學習。'); return;
    }
    if (action === 'reader-checkout') {
      if (!state.activeCardSession) return toast('請先刷卡簽到。');
      const session = { ...state.activeCardSession, checkOutAt: new Date().toISOString(), status: 'completed' };
      state.cardSessions = [session, ...state.cardSessions].slice(0, 50);
      state.pendingFeedbackSession = session;
      state.activeCardSession = null;
      persistProfile(); render();
      openFeedbackModal(session);
      toast('簽退成功，已開啟手機回饋表單。'); return;
    }
    if (action === 'submit-feedback') {
      const session = state.pendingFeedbackSession;
      const subject = document.getElementById('feedbackSubject')?.value || '自由學習';
      const topic = document.getElementById('feedbackTopic')?.value.trim() || '本次學習回饋';
      const confidence = Number(document.getElementById('feedbackConfidence')?.value || 3);
      const difficulty = document.getElementById('feedbackDifficulty')?.value.trim() || '未填寫';
      const nextStep = document.getElementById('feedbackNextStep')?.value.trim() || '維持練習並觀察下一次理解程度';
      state.feedbackEntries = [{ id: `feedback-${Date.now()}`, subject, topic, confidence, difficulty, nextStep, createdAt: new Date().toISOString(), sessionId: session?.id || null, checkInAt: session?.checkInAt || null, checkOutAt: session?.checkOutAt || null, relatedAppointment: session?.appointment || null }, ...state.feedbackEntries].slice(0, 100);
      state.pendingFeedbackSession = null;
      persistProfile(); closeModal(); render(); toast('回饋已保存，正在送交正式 AI 分析。');
      requestAiAnalysis(); return;
    }
    return originalHandleAction(action, element);
  };

  syncRoleNavigation();
})();
