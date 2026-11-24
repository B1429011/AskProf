/* AskProf 的可操作功能補充：真實師資預約、教師時段管理與課程搜尋。 */
(function () {
  const originalSave = save;
  const originalHandleAction = handleAction;
  const originalOpenProfessorModal = openProfessorModal;
  const originalFindFacultyByEmail = findFacultyByEmail;
  const demoVerificationCode = '246810';
  const demoStudent = { email: 'student.demo@askprof.test', password: 'AskProfStudent2026!', role: 'student' };
  const demoFaculty = { id: 'demo:faculty', key: 'demo:faculty', name: 'AskProf 展示教師', initials: 'A', role: 'faculty', dept: '展示教師帳號｜電子工程學系', department: '展示教師帳號｜電子工程學系', degree: '展示用帳號', tags: ['展示預約', '系統測試', 'RFID'], research: '這是專門用來驗證搜尋、預約、取消、師生時段同步與 AI 流程的展示教師資料，不代表真實師資。', specialty: '展示預約、系統測試、RFID', email: 'faculty.demo@askprof.test', password: 'AskProfFaculty2026!', phone: 'Demo-0000', location: 'AskProf 展示空間', profileUrl: '', isDemo: true };
  const sharedApiBase = String(window.ASKPROF_API_BASE || '').replace(/\/$/, '');
  let remoteRefreshPending = false;
  let remoteWorkspacePending = false;
  let remoteStudentPending = false;
  let remoteAvailabilitySnapshot = '';
  let remoteAppointmentSnapshot = '';
  const originalIsCguEmail = isCguEmail;
  isCguEmail = value => originalIsCguEmail(value) || [demoStudent.email, demoFaculty.email].includes(String(value || '').trim().toLowerCase());

  let storedCourses = null;
  try { storedCourses = JSON.parse(localStorage.getItem('learningNavCourses') || 'null'); } catch { storedCourses = null; }
  if (Array.isArray(storedCourses)) state.courses = storedCourses;

  function persist() {
    originalSave();
    localStorage.setItem('learningNavFacultyAvailability', JSON.stringify(state.facultyAvailability));
    localStorage.setItem('learningNavCourses', JSON.stringify(state.courses));
  }
  save = persist;

  async function loadSharedAvailability(key) {
    if (!sharedApiBase || !key) return false;
    try {
      const response = await fetch(`${sharedApiBase}/api/faculty-availability?key=${encodeURIComponent(key)}`, { headers: { Accept: 'application/json' } });
      if (!response.ok) return false;
      const data = await response.json();
      if (!Array.isArray(data.slots)) return false;
      const nextSlots = data.slots.map(slot => ({ label: slot.slot_label, status: slot.status || 'open' }));
      const snapshot = JSON.stringify(nextSlots);
      const changed = remoteAvailabilitySnapshot && remoteAvailabilitySnapshot !== snapshot;
      remoteAvailabilitySnapshot = snapshot;
      state.facultyAvailability[key] = nextSlots;
      localStorage.setItem('learningNavFacultyAvailability', JSON.stringify(state.facultyAvailability));
      if (changed && state.role === 'student') toast('教師已更新可預約時段，清單已同步。');
      if (changed && state.role === 'professor') toast('時段狀態已同步。');
      return true;
    } catch { return false; }
  }

  function saveSharedAvailability(key) {
    if (!sharedApiBase || key !== demoFaculty.key) return;
    const slots = facultySlots(key);
    fetch(`${sharedApiBase}/api/faculty-availability`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ facultyKey: key, facultyEmail: demoFaculty.email, slots })
    }).catch(() => {});
  }

  function mapSharedAppointment(item) {
    const slot = item.slot_label || '';
    return {
      id: item.id,
      professor: demoFaculty.name,
      initials: demoFaculty.initials,
      topic: item.topic || '專輔預約',
      date: dateFromLabel(slot),
      time: slot,
      status: item.status || 'confirmed',
      availabilityKey: item.faculty_key,
      slot,
      studentEmail: item.student_email || ''
    };
  }

  async function loadSharedAppointments(key, studentEmail = '') {
    if (!sharedApiBase || key !== demoFaculty.key) return false;
    try {
      const query = new URLSearchParams({ key });
      if (studentEmail) query.set('student', studentEmail);
      const response = await fetch(`${sharedApiBase}/api/faculty-appointments?${query}`, { headers: { Accept: 'application/json' } });
      if (!response.ok) return false;
      const data = await response.json();
      if (!Array.isArray(data.appointments)) return false;
      const mapped = data.appointments.map(mapSharedAppointment);
      const snapshot = JSON.stringify(mapped.map(item => [item.id, item.slot, item.studentEmail, item.status]));
      const changed = remoteAppointmentSnapshot && remoteAppointmentSnapshot !== snapshot;
      remoteAppointmentSnapshot = snapshot;
      if (studentEmail) {
        const other = state.appointments.filter(item => item.availabilityKey !== key);
        state.appointments = [...mapped, ...other];
      } else {
        const other = state.appointments.filter(item => item.availabilityKey !== key);
        state.appointments = [...mapped, ...other];
      }
      localStorage.setItem('learningNavAppointments', JSON.stringify(state.appointments));
      if (changed && state.role === 'professor') toast('有新的學生預約或預約異動。');
      if (changed && state.role === 'student') toast('你的預約資料已更新。');
      return true;
    } catch { return false; }
  }

  async function saveSharedAppointment(appointment) {
    if (!sharedApiBase || appointment?.availabilityKey !== demoFaculty.key) return null;
    try {
      const response = await fetch(`${sharedApiBase}/api/faculty-appointments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ facultyKey: demoFaculty.key, facultyEmail: demoFaculty.email, slotLabel: appointment.slot, studentEmail: appointment.studentEmail, topic: appointment.topic })
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data.appointment ? mapSharedAppointment(data.appointment) : appointment;
    } catch { return null; }
  }

  async function cancelSharedAppointment(appointment, actor = 'student', reason = '') {
    if (!sharedApiBase || appointment?.availabilityKey !== demoFaculty.key || !appointment.id || !String(appointment.id).includes('-')) return true;
    try {
      const response = await fetch(`${sharedApiBase}/api/faculty-appointments`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: actor === 'faculty'
          ? JSON.stringify({ facultyKey: demoFaculty.key, facultyEmail: demoFaculty.email, id: appointment.id, reason })
          : JSON.stringify({ action: 'student-cancel', id: appointment.id, studentEmail: state.auth?.email || '', reason })
      });
      return response.ok;
    } catch { return false; }
  }

  // Keep already-open AskProf tabs in the same browser in sync. GitHub Pages
  // has no shared database, so this only synchronizes tabs on this browser.
  function refreshSharedBrowserData() {
    try {
      const availability = JSON.parse(localStorage.getItem('learningNavFacultyAvailability') || '{}');
      if (availability && typeof availability === 'object' && !Array.isArray(availability)) state.facultyAvailability = availability;
      const appointments = JSON.parse(localStorage.getItem('learningNavAppointments') || 'null');
      if (Array.isArray(appointments)) state.appointments = appointments;
      const tutors = JSON.parse(localStorage.getItem('learningNavTutorAvailability') || '{}');
      if (tutors && typeof tutors === 'object' && !Array.isArray(tutors)) state.tutorAvailability = tutors;
    } catch { /* Keep the last valid in-memory data if browser storage is malformed. */ }
  }
  window.addEventListener('storage', event => {
    if (!['learningNavFacultyAvailability', 'learningNavAppointments', 'learningNavTutorAvailability'].includes(event.key)) return;
    refreshSharedBrowserData();
    if (state.role === 'student' && state.view === 'professors') renderProfessors();
    else if (state.role === 'student' && state.view === 'tutors') renderTutors();
    else if (state.view === 'appointments') renderAppointments();
    else if (state.role === 'professor' && !['appointments', 'professors'].includes(state.view)) renderProfessor();
  });

  function currentFaculty() {
    const email = String(state.auth?.email || '').toLowerCase();
    if (email === demoFaculty.email) return demoFaculty;
    const index = publicFaculty().findIndex(p => email && String(p.email || '').toLowerCase() === email);
    if (index >= 0) return { ...publicFaculty()[index], key: `f:${index}` };
    const tutor = (state.publicData.specialTutors || []).find(item => email && String(item.email || '').toLowerCase() === email);
    if (tutor) return { ...tutor, key: tutor.availabilityKey, isTutor: true, name: tutor.name, dept: tutor.department || '專業科目輔導員', research: tutor.specialty || `輔導科目：${(tutor.subjects || []).join('、')}` };
    // 模擬教師工作台：讓展示帳號或角色切換仍可完整驗證時段與預約流程。
    // 不會覆蓋或修改官方公開師資資料。
    return { id: 'sim:faculty', key: 'sim:faculty', name: 'AskProf 模擬教師', initials: 'A', dept: '模擬教師工作台｜電子工程學系', department: '模擬教師工作台｜電子工程學系', degree: '展示用身分', tags: ['預約管理', 'RFID 簽到', '學習諮詢'], research: '此模擬教師供驗證教授端的時段管理、學生預約與 RFID 流程，不代表校方認證身分。', specialty: '預約管理、RFID 簽到、學習諮詢', email: 'faculty.demo@askprof.test', phone: 'Demo-0000', location: 'AskProf 模擬諮詢室', profileUrl: '', isDemo: true };
  }
  findFacultyByEmail = function (email) {
    const normalized = String(email || '').trim().toLowerCase();
    if (normalized === demoFaculty.email) return demoFaculty;
    return originalFindFacultyByEmail(email) || (state.publicData.specialTutors || []).find(item => String(item.email || '').toLowerCase() === normalized) || null;
  };
  function facultySlots(key) {
    const raw = state.facultyAvailability[key] || [];
    const normalized = raw.map(slot => typeof slot === 'string' ? { label: slot, status: 'open' } : { status: 'open', ...slot });
    state.facultyAvailability[key] = normalized;
    return normalized;
  }
  function slotLabel(date, time) {
    const d = new Date(`${date}T00:00:00`);
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    return `${d.getMonth() + 1}/${d.getDate()}（${weekdays[d.getDay()]}） ${time}`;
  }
  function selectedFacultySlot(key) {
    return facultySlots(key).filter(slot => slot.status === 'open');
  }
  function dateFromLabel(label) {
    const match = String(label).match(/^(\d{1,2})\/(\d{1,2})/);
    return match ? `2026-${String(match[1]).padStart(2, '0')}-${String(match[2]).padStart(2, '0')}` : '2026-11-21';
  }

  realFacultyCard = function (p) {
    const slots = p.id === demoFaculty.id ? selectedFacultySlot(demoFaculty.key).length : (p.id?.startsWith('f:') ? selectedFacultySlot(p.id).length : 0);
    return `<article class="prof-card card-clickable" data-prof="${esc(p.id)}">
      <div class="prof-top">${initialsAvatar(p.initials)}<div><h3>${esc(p.name)}</h3><div class="dept">${esc(p.dept)}</div></div></div>
      <div class="tag-row">${p.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      <p class="research">${esc(p.research || '官方頁面未提供專長文字')}</p>
      <div class="prof-bottom"><span class="availability" style="color:${slots ? 'var(--green)' : '#7a879d'}">${slots ? `${slots} 個可預約時段` : '教授登入後設定時段'}</span><span class="ghost-btn">查看資料</span></div>
    </article>`;
  };

  openProfessorModal = async function (id) {
    refreshSharedBrowserData();
    if (id === demoFaculty.id || String(id).startsWith('f:')) await loadSharedAvailability(id === demoFaculty.id ? demoFaculty.key : id);
    if (id === demoFaculty.id) {
      const slots = selectedFacultySlot(demoFaculty.key);
      openModal(`<button class="modal-close" data-action="close-modal">×</button><h2>${esc(demoFaculty.name)}</h2><p class="modal-sub">${esc(demoFaculty.dept)}｜${esc(demoFaculty.degree)}</p><div class="appointment-highlight" style="margin-bottom:14px"><span class="label">展示帳號說明</span><div class="date" style="font-size:17px">${esc(demoFaculty.tags.join(' × '))}</div><div class="desc">${esc(demoFaculty.research)}</div></div><div class="public-detail-list"><div><span>展示信箱</span><strong>${esc(demoFaculty.email)}</strong></div><div><span>展示分機</span><strong>${esc(demoFaculty.phone)}</strong></div><div><span>展示地點</span><strong>${esc(demoFaculty.location)}</strong></div></div><h3 style="font-size:13px;margin:18px 0 7px">可預約時段</h3><div class="slot-options">${slots.length ? slots.map((slot, i) => `<button class="slot-option ${i === 0 ? 'selected' : ''}" data-slot-choice="${esc(slot.label)}"><strong>${esc(slot.label)}</strong><span>30 分鐘</span></button>`).join('') : '<div class="empty-state">請先用教師展示帳號新增時段</div>'}</div><div class="field"><label>想討論的主題</label><textarea id="topicInput" placeholder="例如：測試預約與取消流程"></textarea></div><div class="modal-actions"><button class="ghost-btn" data-action="close-modal">關閉</button><button class="primary-btn" data-action="confirm-faculty-book" data-faculty-id="${demoFaculty.id}" ${slots.length ? '' : 'disabled'}>確認預約</button></div>`);
      return;
    }
    if (!String(id).startsWith('f:')) return originalOpenProfessorModal(id);
    const p = publicFaculty()[Number(String(id).split(':')[1])];
    if (!p) return;
    const slots = selectedFacultySlot(id);
    openModal(`<button class="modal-close" data-action="close-modal">×</button>
      <h2>${esc(p.name)}</h2><p class="modal-sub">${esc(p.dept)}${p.degree ? `｜${esc(p.degree)}` : ''}</p>
      <div class="appointment-highlight" style="margin-bottom:14px"><span class="label">公開專長與研究方向</span><div class="date" style="font-size:17px">${esc(p.tags.slice(0, 2).join(' × ') || '未提供')}</div><div class="desc">${esc(p.research || '官方頁面未提供專長文字')}</div></div>
      <div class="public-detail-list"><div><span>電子信箱</span><strong>${esc(p.email || '官方頁面未提供')}</strong></div><div><span>電話／分機</span><strong>${esc(p.phone || '官方頁面未提供')}</strong></div><div><span>辦公地點</span><strong>${esc(p.location || '官方頁面未提供')}</strong></div></div>
      <h3 style="font-size:13px;margin:18px 0 7px">可預約時段</h3>
      <div class="slot-options">${slots.length ? slots.map((slot, i) => `<button class="slot-option ${i === 0 ? 'selected' : ''}" data-slot-choice="${esc(slot.label)}"><strong>${esc(slot.label)}</strong><span>30 分鐘</span></button>`).join('') : '<div class="empty-state">教授尚未公開可預約時段</div>'}</div>
      <div class="field"><label>想討論的主題</label><textarea id="topicInput" placeholder="例如：專題方向、選課規劃、研究興趣..."></textarea></div>
      <div class="data-source-banner compact"><span class="source-check">⌕</span><div><strong>${slots.length ? '可直接提出預約' : '預約時間由教授本人維護'}</strong><small>${slots.length ? '選擇時段後送出預約。' : '教授登入後即可設定可預約時間。'}</small></div></div>
      <div class="modal-actions"><a class="secondary-btn" href="${esc(p.profileUrl || '#')}" target="_blank" rel="noopener">查看官方聯絡資料 ↗</a><button class="ghost-btn" data-action="close-modal">關閉</button><button class="primary-btn" data-action="confirm-faculty-book" data-faculty-id="${esc(id)}" ${slots.length ? '' : 'disabled'}>確認預約</button></div>`);
  };

  const officialRenderProfessors = renderProfessors;
  renderProfessors = function (skipRemote = false) {
    refreshSharedBrowserData();
    if (sharedApiBase && !skipRemote && !remoteRefreshPending) {
      remoteRefreshPending = true;
      loadSharedAvailability(demoFaculty.key).then(() => {
        remoteRefreshPending = false;
        if (state.role === 'student' && state.view === 'professors') renderProfessors(true);
      });
    }
    officialRenderProfessors();
    const grid = document.getElementById('profGrid');
    if (!grid || state.role !== 'student') return;
    grid.insertAdjacentHTML('afterbegin', `<div class="data-source-banner compact" style="grid-column:1/-1"><span class="source-check">A</span><div><strong>展示帳號教師</strong><small>用於驗證新增時段、學生預約與取消流程，不會改動官方師資資料。</small></div></div>${realFacultyCard(demoFaculty)}`);
    bind();
  };
  const officialFilterPublicFaculty = filterPublicFaculty;
  filterPublicFaculty = function () {
    officialFilterPublicFaculty();
    const query = document.getElementById('profSearch')?.value || '';
    const department = document.getElementById('deptFilter')?.value || 'all';
    const course = document.getElementById('courseFilter')?.value || 'all';
    const specialty = document.getElementById('specialtyFilter')?.value || 'all';
    if (state.role === 'student' && (department === 'all' || department === demoFaculty.dept) && courseMatches(demoFaculty, course) && (specialty === 'all' || demoFaculty.tags.includes(specialty)) && matchesSearch(`${demoFaculty.name} ${demoFaculty.dept} ${demoFaculty.research} ${demoFaculty.tags.join(' ')}`, query)) {
      document.getElementById('profGrid')?.insertAdjacentHTML('afterbegin', realFacultyCard(demoFaculty));
      bind();
    }
  };

  function openFacultySlotModal() {
    const faculty = currentFaculty();
    if (!faculty) { toast('目前登入信箱尚未對應公開師資資料，請先完成師長信箱驗證。'); return; }
    openModal(`<button class="modal-close" data-action="close-modal">×</button><h2>新增可預約時段</h2><p class="modal-sub">${esc(faculty.name)}｜新增後學生會在教師卡片看到這個時段。</p><div class="field"><label>日期</label><input id="facultySlotDate" type="date" value="2026-11-26"></div><div class="field"><label>時間</label><select id="facultySlotTime"><option>09:00 - 09:30</option><option>10:00 - 10:30</option><option>14:00 - 14:30</option><option>15:00 - 15:30</option><option>16:00 - 16:30</option></select></div><div class="modal-actions"><button class="ghost-btn" data-action="close-modal">取消</button><button class="primary-btn" data-action="save-faculty-slot">公開時段</button></div>`);
  }

  function openCancellationModal(actor, appointment) {
    const title = actor === 'faculty' ? '取消學生預約' : '取消我的預約';
    const target = actor === 'faculty' ? `${appointment.studentEmail || '學生'}｜${appointment.slot}` : `${appointment.professor}｜${appointment.slot}`;
    openModal(`<button class="modal-close" data-action="close-modal">×</button><h2>${title}</h2><p class="modal-sub">${esc(target)}</p><div class="field"><label>取消原因（必填）</label><textarea id="cancelReasonInput" maxlength="500" placeholder="例如：臨時有會議、身體不適或行程異動"></textarea></div><div class="modal-actions"><button class="ghost-btn" data-action="close-modal">返回</button><button class="danger-btn" data-action="${actor === 'faculty' ? 'confirm-faculty-cancel' : 'confirm-student-cancel'}" data-appointment-id="${esc(appointment.id)}">確認取消</button></div>`);
  }

  function renderTutorWorkspace(tutor) {
    const slots = state.tutorAvailability[tutor.key] || [];
    const appointments = state.appointments.filter(item => item.tutorKey === tutor.key);
    app.innerHTML = `<div class="page-heading"><div><p class="eyebrow">SUPPORT TUTOR WORKSPACE</p><h1>${esc(tutor.name)}｜專輔工作台</h1><p>管理輔導科目、公開聯絡資料與可預約時段。</p></div><button class="primary-btn" data-action="add-tutor-slot" data-tutor-id="${esc(tutor.id)}">＋ 新增可預約時段</button></div>
      <div class="grid stats-grid">${statCard('◷', '目前開放時段', slots.length, '學生可直接預約', '#2d5bdb')}${statCard('▤', '輔導科目', (tutor.subjects || []).join('、'), '來自官方公告', '#ffd529')}${statCard('✉', '公開信箱', tutor.email || '未公開', '官方聯絡資料', '#11a77e')}${statCard('⌕', '公開分機', tutor.phone || '未公開', '學生可直接聯絡', '#bd31d8')}</div>
      <div class="grid two-col"><section class="panel"><div class="panel-head"><div><h2>專輔可預約時段</h2><p>新增後會立即顯示在學生端專輔專區。</p></div></div><div class="slot-list">${slots.length ? slots.map(slot => `<div class="slot-row"><div class="slot-time">${esc(slot)}<br><span style="font-size:10px;color:var(--blue)">30 分鐘</span></div><div class="slot-info"><strong>學生可直接預約</strong><span>由你登入後自行維護</span></div><span class="slot-state">開放中</span></div>`).join('') : '<div class="empty-state">尚未建立時段，先新增一個可預約時間吧。</div>'}</div></section><section class="panel"><div class="panel-head"><div><h2>公開專輔資料</h2><p>學生在專輔專區會看到這些欄位。</p></div></div><div class="public-detail-list"><div><span>姓名／身分</span><strong>${esc(tutor.name)}｜${esc(tutor.dept)}</strong></div><div><span>輔導科目</span><strong>${esc((tutor.subjects || []).join('、'))}</strong></div><div><span>信箱</span><strong>${esc(tutor.email || '官方未公開')}</strong></div><div><span>電話／分機</span><strong>${esc(tutor.phone || '官方未公開')}</strong></div><div><span>諮詢地點</span><strong>${esc(tutor.location || '官方未提供')}</strong></div></div></section></div>
      <section class="panel"><div class="panel-head"><div><h2>學生預約</h2><p>學生取消後，時段會回到可預約清單。</p></div><span class="sub">${appointments.length} 筆</span></div>${appointments.length ? `<div class="appointment-list">${appointments.map(item => `<div class="appointment-row">${initialsAvatar(item.initials || '學')}<div class="info"><strong>${esc(item.topic)}</strong><span>${esc(item.studentEmail || '長庚學生')}　·　${esc(item.slot)}</span></div><span class="status-confirmed">已確認</span></div>`).join('')}</div>` : '<div class="empty-state">目前還沒有學生預約。</div>'}</section>`;
    bind();
  }

  function renderFacultyWorkspace(skipRemote = false) {
    const faculty = currentFaculty();
    if (!faculty) return app.innerHTML = `<div class="empty-state panel"><h2>尚未對應師長資料</h2><p>請用官方公開師資信箱登入，才能管理自己的可預約時段。</p></div>`;
    if (faculty.isTutor) return renderTutorWorkspace(faculty);
    if (sharedApiBase && faculty.key === demoFaculty.key && !skipRemote && !remoteWorkspacePending) {
      remoteWorkspacePending = true;
      Promise.all([loadSharedAvailability(faculty.key), loadSharedAppointments(faculty.key)]).then(() => {
        remoteWorkspacePending = false;
        if (state.role === 'professor') renderFacultyWorkspace(true);
      });
    }
    const slots = facultySlots(faculty.key);
    const open = slots.filter(slot => slot.status === 'open').length;
    const booked = slots.filter(slot => slot.status === 'booked').length;
    const appointments = state.appointments.filter(item => item.availabilityKey === faculty.key);
    const orphaned = slots.filter(slot => slot.status === 'booked' && !appointments.some(item => item.slot === slot.label));
    app.innerHTML = `<div class="page-heading"><div><p class="eyebrow">FACULTY WORKSPACE</p><h1>${esc(faculty.name)}｜教師工作台</h1><p>管理公開聯絡資料、可預約時段與學生預約。</p></div><button class="primary-btn" data-action="add-faculty-slot">＋ 新增可預約時段</button></div>
      <div class="grid stats-grid">${statCard('◷', '目前開放時段', open, '學生可直接預約', '#2d5bdb')}${statCard('◎', '已被預約時段', booked, '可在下方查看', '#ffd529')}${statCard('✉', '公開信箱', faculty.email || '未公開', '來自官方師資資料', '#11a77e')}${statCard('⌕', '公開分機', faculty.phone || '未公開', '學生可直接聯絡', '#bd31d8')}</div>
      <div class="grid two-col"><section class="panel"><div class="panel-head"><div><h2>可預約時段</h2><p>開放、暫停與已預約狀態會同步到學生端。</p></div></div><div class="slot-list">${slots.length ? slots.map((slot, i) => `<div class="slot-row"><div class="slot-time">${esc(slot.label)}<br><span style="font-size:10px;color:var(--blue)">30 分鐘</span></div><div class="slot-info"><strong>${slot.status === 'booked' ? '已預約' : slot.status === 'paused' ? '暫停預約' : '學生可直接預約'}</strong><span>${slot.status === 'booked' ? '請至預約管理查看學生資料' : '可隨時更新狀態'}</span></div><span class="slot-state ${slot.status === 'paused' ? 'off' : ''}">${slot.status === 'open' ? '開放中' : slot.status === 'booked' ? '已預約' : '已暫停'}</span>${slot.status !== 'booked' ? `<button class="slot-toggle" data-action="toggle-faculty-slot" data-slot-index="${i}">${slot.status === 'open' ? '暫停' : '開放'}</button>` : ''}</div>`).join('') : '<div class="empty-state">尚未建立時段，先新增一個可預約時間吧。</div>'}</div></section>
      <section class="panel"><div class="panel-head"><div><h2>公開教師資料</h2><p>學生在教師探索頁會看到這些欄位。</p></div></div><div class="public-detail-list"><div><span>姓名／系所</span><strong>${esc(faculty.name)}｜${esc(faculty.dept)}</strong></div><div><span>研究專長</span><strong>${esc(faculty.research || '官方頁面未提供')}</strong></div><div><span>信箱</span><strong>${esc(faculty.email || '官方頁面未公開')}</strong></div><div><span>電話／分機</span><strong>${esc(faculty.phone || '官方頁面未公開')}</strong></div></div></section></div>
      <section class="panel"><div class="panel-head"><div><h2>學生預約</h2><p>預約成功後會從可用時段轉為已預約；取消後時段會重新開放。</p></div><span class="sub">${appointments.length} 筆</span></div>${appointments.length ? `<div class="appointment-list">${appointments.map(item => `<div class="appointment-row">${initialsAvatar(item.initials || '學')}<div class="info"><strong>${esc(item.topic)}</strong><span>${esc(item.studentEmail || '長庚學生')}　·　${esc(item.slot)}</span></div><span class="status-confirmed">已確認</span><button class="danger-btn" data-action="faculty-cancel-appointment" data-id="${esc(item.id)}">取消預約</button></div>`).join('')}</div>` : orphaned.length ? `<div class="empty-state" style="color:#a35b00;background:#fff8e8">有 ${orphaned.length} 個時段顯示為已預約，但目前找不到對應紀錄。請重新整理或聯絡系統管理員處理。</div>` : '<div class="empty-state">目前還沒有這些時段的學生預約。</div>'}</section>`;
    bind();
  }
  renderProfessor = renderFacultyWorkspace;
  renderProfessorSlots = renderFacultyWorkspace;

  const officialRenderAppointments = renderAppointments;
  renderAppointments = function (skipRemote = false) {
    if (sharedApiBase && state.role === 'student' && !skipRemote && !remoteStudentPending) {
      remoteStudentPending = true;
      loadSharedAppointments(demoFaculty.key, state.auth?.email || '').then(() => {
        remoteStudentPending = false;
        if (state.role === 'student' && state.view === 'appointments') renderAppointments(true);
      });
    }
    officialRenderAppointments();
  };

  function courseRows() {
    return state.courseYears.flatMap(year => [
      ...year.required.map(course => ({ year: year.year, category: '系必修', code: course[0], name: course[1], credit: course[2], offer: course[3] })),
      ...year.electives.map(course => ({ year: year.year, category: '系選修', code: course[0], name: course[1], credit: course[2], offer: course[3] }))
    ]);
  }
  function courseStatus(code) { return state.courses.find(course => course.code === code)?.status || 'todo'; }
  function courseStatusText(status) { return status === 'done' ? '已修畢' : status === 'current' ? '進行中' : '未修'; }
  function renderCourseRows() {
    const query = document.getElementById('courseSearch')?.value || '';
    const year = document.getElementById('courseYearSelect')?.value || 'all';
    const filter = document.getElementById('courseStatusFilter')?.value || 'all';
    const list = courseRows().filter(course => (year === 'all' || course.year === year) && (filter === 'all' || courseStatus(course.code) === filter) && matchesSearch(`${course.code} ${course.name} ${course.year} ${course.category}`, query));
    const tbody = document.querySelector('.year-course-table tbody');
    if (!tbody) return;
    tbody.innerHTML = list.length ? list.map(course => { const status = courseStatus(course.code); return `<tr><td><strong>${esc(course.name)}</strong><br><small style="color:var(--muted);font-size:10px">${esc(course.code)}｜${esc(course.year)}</small></td><td><span class="course-category ${course.category === '系必修' ? 'required' : 'elective'}">${course.category}</span></td><td>${course.credit}</td><td>${esc(course.offer)}</td><td><select class="select-input course-status-editor" data-course-code="${esc(course.code)}"><option value="todo" ${status === 'todo' ? 'selected' : ''}>未修</option><option value="current" ${status === 'current' ? 'selected' : ''}>進行中</option><option value="done" ${status === 'done' ? 'selected' : ''}>已修畢</option></select></td></tr>`; }).join('') : '<tr><td colspan="5"><div class="empty-state">找不到符合的課程。</div></td></tr>';
    tbody.querySelectorAll('.course-status-editor').forEach(select => select.addEventListener('change', event => {
      const code = event.target.dataset.courseCode;
      const row = courseRows().find(course => course.code === code);
      const existing = state.courses.find(course => course.code === code);
      if (existing) existing.status = event.target.value;
      else state.courses.push({ code, name: row.name, credit: row.credit, term: row.offer, status: event.target.value });
      persist(); renderCourses(); addCourseSources(); toast('修課狀態已更新。');
    }));
    const count = document.getElementById('courseResultCount');
    if (count) count.textContent = `${list.length} 門課程`;
  }
  renderCourses = function () {
    const all = courseRows();
    const completedCredits = all.filter(course => courseStatus(course.code) === 'done').reduce((sum, course) => sum + course.credit, 0);
    const progress = Math.round((completedCredits / 128) * 100);
    app.innerHTML = `<div class="page-heading"><div><p class="eyebrow">COURSE MAP</p><h1>修課地圖與課程搜尋</h1><p>搜尋每學年的系必修、系選修，並更新自己的修課狀態。</p></div><button class="secondary-btn" data-action="sync-courses">↻ 同步課程資料</button></div>
      <div class="grid course-layout"><section class="panel"><div class="panel-head"><div><h2>系必選修課表</h2><p>目前展示資工系四學年示範課表；正式版可由系辦資料匯入。</p></div><span class="sub" id="courseResultCount">${all.length} 門課程</span></div><div class="filter-row"><input class="search-input" id="courseSearch" placeholder="搜尋課號、課名、學年或必修類別"><select class="select-input" id="courseYearSelect"><option value="all">全部學年</option>${state.courseYears.map(year => `<option value="${year.year}">${year.year}</option>`).join('')}</select><select class="select-input" id="courseStatusFilter"><option value="all">所有修課狀態</option><option value="todo">未修</option><option value="current">進行中</option><option value="done">已修畢</option></select></div><div class="course-legend"><span><i class="legend-dot required"></i>系必修</span><span><i class="legend-dot elective"></i>系選修</span><span><i class="legend-dot done"></i>可更新個人狀態</span></div><table class="course-table year-course-table"><thead><tr><th>課程</th><th>類別</th><th>學分</th><th>開課</th><th>我的狀態</th></tr></thead><tbody></tbody></table><div class="table-footnote">課程搜尋與修課狀態只保存在目前瀏覽器；正式環境應由校務系統登入後同步，不公開學生個人資料。</div></section><section class="panel course-summary"><h2>你的學分進度</h2><p>依目前已修／進行中狀態估算</p><div class="big">${completedCredits}<small> / 128 學分</small></div><span class="summary-label">已完成 ${progress}%</span><div class="progress-line" style="margin-top:12px;background:#ffffff2a"><i style="width:${progress}%;background:var(--yellow)"></i></div><div class="summary-list"><div><span>已修學分</span><strong>${completedCredits}</strong></div><div><span>進行中課程</span><strong>${all.filter(course => courseStatus(course.code) === 'current').length} 門</strong></div><div><span>尚未修習</span><strong>${all.filter(course => courseStatus(course.code) === 'todo').length} 門</strong></div></div></section></div><section class="panel" style="margin-top:18px"><div class="panel-head"><div><h2>使用方式</h2><p>先用搜尋找到課程，再用每列的狀態選單更新自己的進度。</p></div><span class="sub">${state.courseYears.length} 個學年</span></div><div class="mini-list"><div class="mini-list-item"><span class="person-avatar">⌕</span><div><strong>課號／課名搜尋</strong><span>輸入「資料結構」、「大三」或課號即可篩選。</span></div></div><div class="mini-list-item"><span class="person-avatar">✓</span><div><strong>狀態即時重算</strong><span>改成已修畢或進行中後，右側學分進度會同步更新。</span></div></div></div></section>`;
    bind();
    ['courseSearch', 'courseYearSelect', 'courseStatusFilter'].forEach(id => document.getElementById(id).addEventListener(id === 'courseSearch' ? 'input' : 'change', renderCourseRows));
    renderCourseRows();
  };

  handleAction = async function (action, element) {
    if (action === 'add-faculty-slot') return openFacultySlotModal();
    if (action === 'save-faculty-slot') {
      const faculty = currentFaculty();
      const date = document.getElementById('facultySlotDate')?.value;
      const time = document.getElementById('facultySlotTime')?.value;
      if (!faculty || !date || !time) return toast('請先選擇日期與時間。');
      const slots = facultySlots(faculty.key);
      const label = slotLabel(date, time);
      if (slots.some(slot => slot.label === label && slot.status !== 'paused')) return toast('這個時段已經存在。');
      slots.push({ label, status: 'open' }); persist(); saveSharedAvailability(faculty.key); closeModal(); render(); toast('可預約時段已公開。'); return;
    }
    if (action === 'toggle-faculty-slot') {
      const faculty = currentFaculty();
      const index = Number(element.dataset.slotIndex);
      if (!faculty || !Number.isInteger(index)) return;
      const slot = facultySlots(faculty.key)[index];
      if (slot) slot.status = slot.status === 'open' ? 'paused' : 'open';
      persist(); saveSharedAvailability(faculty.key); render(); toast(slot?.status === 'open' ? '時段已重新開放。' : '時段已暫停。'); return;
    }
    if (action === 'confirm-faculty-book') {
      const key = element.dataset.facultyId;
      const p = key === demoFaculty.id ? demoFaculty : publicFaculty()[Number(String(key).split(':')[1])];
      const choice = modal.querySelector('.slot-option.selected')?.dataset.slotChoice;
      if (!p || !choice) return toast('請先選擇可預約時段。');
      const slot = facultySlots(key).find(item => item.label === choice && item.status === 'open');
      if (!slot) return toast('這個時段剛剛已被預約，請重新選擇。');
      slot.status = 'booked';
      const topic = modal.querySelector('#topicInput')?.value.trim() || '專輔預約';
      const localAppointment = { id: `a${Date.now()}`, professor: p.name, initials: p.initials, topic, date: dateFromLabel(choice), time: choice, status: 'confirmed', availabilityKey: key, slot: choice, studentEmail: state.auth?.email || '' };
      if (key === demoFaculty.key && sharedApiBase) {
      const sharedAppointment = await saveSharedAppointment(localAppointment);
        if (!sharedAppointment) { slot.status = 'open'; return toast('預約尚未寫入共用資料庫，請稍後再試。'); }
        Object.assign(localAppointment, sharedAppointment);
      }
      state.appointments = [localAppointment, ...state.appointments];
      persist(); saveSharedAvailability(key); await loadSharedAppointments(key, state.auth?.email || ''); closeModal(); render(); toast('預約成功！教師端已收到通知。'); return;
    }
    if (action === 'confirm-tutor-book') {
      const key = element.dataset.tutorId;
      const tutor = publicTutors().find(item => item.id === key);
      const choice = modal.querySelector('.slot-option.selected')?.dataset.slotChoice;
      if (!tutor || !choice) return toast('請先選擇可預約時段。');
      state.tutorAvailability[tutor.availabilityKey] = (state.tutorAvailability[tutor.availabilityKey] || []).filter(slot => slot !== choice);
      const topic = modal.querySelector('#topicInput')?.value.trim() || `${tutor.subjects?.[0] || '專輔'}預約`;
      state.appointments = [{ id: `a${Date.now()}`, professor: `${tutor.name}老師`, initials: tutor.name[0], topic, date: dateFromLabel(choice), time: choice, status: 'confirmed', tutorKey: tutor.availabilityKey, slot: choice, studentEmail: state.auth?.email || '' }, ...state.appointments];
      persist(); closeModal(); render(); toast('專輔預約成功！時段已標記為已預約。'); return;
    }
    if (action === 'cancel-appointment') {
      const id = element.dataset.id || state.appointments[0]?.id;
      const appointment = state.appointments.find(item => item.id === id);
      if (!appointment) return toast('找不到這筆預約，請重新整理。');
      openCancellationModal('student', appointment); return;
    }
    if (action === 'confirm-student-cancel') {
      const id = element.dataset.appointmentId;
      const appointment = state.appointments.find(item => String(item.id) === String(id));
      const reason = modal.querySelector('#cancelReasonInput')?.value.trim() || '';
      if (!appointment) return toast('找不到這筆預約，請重新整理。');
      if (!reason) return toast('請填寫取消原因。');
      if (appointment?.availabilityKey === demoFaculty.key && sharedApiBase) {
        const cancelled = await cancelSharedAppointment(appointment, 'student', reason);
        if (!cancelled) return toast('取消尚未同步到共用資料庫，請稍後再試。');
      }
      state.appointments = state.appointments.filter(item => item.id !== id);
      if (appointment?.availabilityKey && appointment.slot) { const slot = facultySlots(appointment.availabilityKey).find(item => item.label === appointment.slot); if (slot) slot.status = 'open'; }
      if (appointment?.tutorKey && appointment.slot && !state.tutorAvailability[appointment.tutorKey]?.includes(appointment.slot)) state.tutorAvailability[appointment.tutorKey] = [...(state.tutorAvailability[appointment.tutorKey] || []), appointment.slot];
      persist(); if (appointment?.availabilityKey) saveSharedAvailability(appointment.availabilityKey); closeModal(); render(); toast('預約已取消，教師端已收到通知，時段已重新開放。'); return;
    }
    if (action === 'faculty-cancel-appointment') {
      const appointment = state.appointments.find(item => String(item.id) === String(element.dataset.id));
      if (!appointment) return toast('找不到這筆預約，請重新整理。');
      openCancellationModal('faculty', appointment); return;
    }
    if (action === 'confirm-faculty-cancel') {
      const appointment = state.appointments.find(item => String(item.id) === String(element.dataset.appointmentId));
      const reason = modal.querySelector('#cancelReasonInput')?.value.trim() || '';
      if (!appointment) return toast('找不到這筆預約，請重新整理。');
      if (!reason) return toast('請填寫取消原因。');
      const cancelled = await cancelSharedAppointment(appointment, 'faculty', reason);
      if (!cancelled) return toast('取消預約未能同步，請稍後再試。');
      state.appointments = state.appointments.filter(item => item.id !== appointment.id);
      const slot = facultySlots(demoFaculty.key).find(item => item.label === appointment.slot);
      if (slot) slot.status = 'open';
      persist(); saveSharedAvailability(demoFaculty.key);
      await Promise.all([loadSharedAvailability(demoFaculty.key), loadSharedAppointments(demoFaculty.key)]);
      closeModal();
      renderFacultyWorkspace(true);
      toast(`已取消 ${appointment.studentEmail} 的預約，學生端已收到通知。`);
      return;
    }
    return originalHandleAction(action, element);
  };

  // Poll the shared demo record so a second device receives booking and pause
  // changes without needing to keep a Supabase dashboard open.
  if (sharedApiBase) window.setInterval(async () => {
    if (state.role === 'professor') {
      await Promise.all([loadSharedAvailability(demoFaculty.key), loadSharedAppointments(demoFaculty.key)]);
      if (state.view !== 'tutors' && state.view !== 'university') renderFacultyWorkspace(true);
    } else if (state.role === 'student') {
      await loadSharedAvailability(demoFaculty.key);
      if (state.view === 'professors') renderProfessors(true);
      if (state.view === 'appointments') {
        await loadSharedAppointments(demoFaculty.key, state.auth?.email || '');
        renderAppointments(true);
      }
    }
  }, 12000);

  document.querySelectorAll('[data-demo-account]').forEach(button => button.addEventListener('click', () => {
    const role = button.dataset.demoAccount;
    const account = role === 'faculty' ? demoFaculty : demoStudent;
    document.querySelector(`.auth-role[data-auth-role="${role}"]`)?.click();
    const emailInput = document.getElementById('schoolEmail');
    if (emailInput) emailInput.value = account.email;
    const passwordInput = document.getElementById('schoolPassword');
    if (passwordInput) passwordInput.value = account.password;
    toast(`已填入${role === 'faculty' ? '教師' : '學生'}Demo 帳密，按「寄送驗證碼」繼續。`);
  }));
  document.getElementById('sendCodeBtn')?.addEventListener('click', event => {
    const email = String(document.getElementById('schoolEmail')?.value || '').trim().toLowerCase();
    const password = String(document.getElementById('schoolPassword')?.value || '');
    const account = [demoStudent, demoFaculty].find(item => item.email === email);
    if (account && password !== account.password) {
      event.preventDefault();
      event.stopImmediatePropagation();
      toast('Demo 帳號密碼不正確，請使用登入頁提供的展示密碼。');
    }
  }, true);
  document.getElementById('sendCodeBtn')?.addEventListener('click', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const email = String(document.getElementById('schoolEmail')?.value || '').trim().toLowerCase();
    const password = String(document.getElementById('schoolPassword')?.value || '');
    const selectedRole = document.querySelector('.auth-role.active')?.dataset.authRole || 'student';
    const account = [demoStudent, demoFaculty].find(item => item.email === email);
    if (!account) return toast('目前僅開放 Demo 帳號登入；長庚 SSO 尚待校方設定完成。');
    if (account.role !== selectedRole) return toast('請選擇與此帳號相符的登入身分。');
    if (password !== account.password) return toast('帳號或密碼錯誤，請確認登入頁列出的 Demo 密碼。');
    state.auth = { email: account.email, role: account.role, verifiedAt: Date.now(), provider: 'askprof-demo-password', facultyName: account.role === 'faculty' ? demoFaculty.name : '', facultyDepartment: account.role === 'faculty' ? demoFaculty.department : '', isDemo: true };
    state.role = account.role === 'faculty' ? 'professor' : 'student';
    state.view = 'home';
    save();
    finishAuth();
    toast(`已以${account.role === 'faculty' ? '教師' : '學生'}Demo 帳號登入。`);
  }, true);
  document.getElementById('sendCodeBtn')?.addEventListener('click', () => {
    window.setTimeout(() => { if ([demoStudent.email, demoFaculty.email].includes(state.pendingAuth?.email)) { state.pendingAuth.code = demoVerificationCode; document.getElementById('demoCode').textContent = `展示驗證碼：${demoVerificationCode}`; } }, 350);
  });
  document.getElementById('verifyCodeBtn')?.addEventListener('click', event => {
    if ([demoStudent.email, demoFaculty.email].includes(state.pendingAuth?.email)) state.pendingAuth.code = demoVerificationCode;
  }, true);
})();
