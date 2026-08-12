(() => {
  'use strict';

  const STORAGE_KEY = 'gentle-todo-v1';
  const REMINDER_HISTORY_KEY = 'gentle-reminder-history-v1';
  const REMINDER_CHECK_INTERVAL = 30000;
  const COLORS = { red: '#f06162', orange: '#eea33b', blue: '#4b9ed6', green: '#49a77a' };
  const COLOR_NAMES = { red: '重要紧急', orange: '重要不急', blue: '紧急不重要', green: '有空再做' };
  const PROJECT_STATUS_NAMES = { not_started: '未开始', doing: '进行中', waiting: 'Waiting', done: '已完成', paused: '暂停' };
  const WORK_STATUS_NAMES = { todo: 'Todo', doing: 'Doing', waiting: 'Waiting', done: 'Done' };
  const WORK_PRIORITY_NAMES = { high: 'High', medium: 'Medium', low: 'Low' };
  const AREAS = {
    career: { name: '我的职业', icon: '💼', color: '#405f9f' },
    growth: { name: '学无止境', icon: '📚', color: '#c9a668' },
    body: { name: '我的身体', icon: '💪', color: '#67a88e' },
    soul: { name: '我的灵魂', icon: '✨', color: '#9386be' },
    moments: { name: '无聊的重要时光', icon: '⌛', color: '#b57d95' }
  };
  const PERIOD_ORDER = ['上午', '下午', '晚上', '全天'];
  const PAGE_META = {
    today: ['穿越回的今天，\n永远是最美好的一天', 'A GENTLE DAY'],
    calendar: ['把日子铺开来看', 'YOUR MONTH'],
    stats: ['俯瞰生活的五个切面', '上帝之眼'],
    workflow: ['把复杂工作，拆成清楚的下一步', 'WORKFLOW'],
    recurring: ['重复的事，轻松安排', 'ROUTINES'],
    profile: ['留一块地给自己', 'MY GARDEN']
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const pad = (number) => String(number).padStart(2, '0');
  const toISO = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const fromISO = (value) => {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  };
  const shiftDate = (date, days) => {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  };
  const todayISO = () => toISO(new Date());
  const uid = (prefix = 'id') => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const escapeHTML = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const formatChineseDate = (iso, withWeek = true) => {
    const date = fromISO(iso);
    const week = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][date.getDay()];
    return `${date.getMonth() + 1}月${date.getDate()}日${withWeek ? ` · ${week}` : ''}`;
  };

  function normalizeTaskOrders(data) {
    const groups = new Map();
    data.tasks.forEach((task, index) => {
      if (!groups.has(task.date)) groups.set(task.date, []);
      groups.get(task.date).push({ task, index });
    });
    groups.forEach((items) => {
      items.sort((a, b) => {
        const left = Number.isFinite(a.task.manualOrder) ? a.task.manualOrder : Number.MAX_SAFE_INTEGER;
        const right = Number.isFinite(b.task.manualOrder) ? b.task.manualOrder : Number.MAX_SAFE_INTEGER;
        return left - right || a.index - b.index;
      });
      items.forEach(({ task }, index) => { task.manualOrder = (index + 1) * 10; });
    });
  }

  let state = loadState();
  let currentPage = 'today';
  let todayMode = 'timeline';
  let selectedDate = todayISO();
  let calendarCursor = new Date();
  let recordStatus = '完成';
  let recurringDraftItems = [];
  let batchMode = false;
  let showAllTasks = false;
  let openFocusSection = '';
  let selectedTaskIds = new Set();
  let aiDraft = [];
  let aiPlanMeta = null;
  let aiDailyDraft = [];
  let aiDailyMeta = null;
  let activeDocumentReturn = '#aiReviewSheet';
  let draggedDraftId = null;
  let draggedDailyId = null;
  let draggedHomeTaskId = null;
  let focusTimer = { taskId: '', secondsLeft: 300, running: false };
  let focusTimerEndAt = 0;
  let focusTimerHandle = null;
  let workflowFilter = 'all';
  let activeWorkflowProjectId = '';
  let expandedHomeLinks = new Set();
  let cloudbaseApp = null;
  let deferredInstallPrompt = null;
  let reminderTimerHandle = null;
  let toastTimer;

  function makeSeed() {
    const today = new Date();
    const d = (offset) => toISO(shiftDate(today, offset));
    const task = (name, priority, date, period, start, extras = {}) => ({
      id: uid('task'), name, priority, date, period, start, end: '', remind: true,
      area: 'career', urgency: 'best', done: false, carried: false, archived: false, recId: null, record: null,
      createdAt: Date.now(), updatedAt: Date.now(), mustDo: false, ...extras
    });
    const projectOne = uid('project');
    const projectTwo = uid('project');
    const workflowTask = (title, projectId, status, priority, deadline, extras = {}) => ({
      id: uid('work'), title, projectId, status, priority, planDate: '', deadline,
      owner: '', relatedPeople: [], waitingFor: '', waitingReason: '', followUpDate: '', notes: '',
      relatedHomeTodoId: null, createdAt: Date.now(), completedAt: status === 'done' ? Date.now() : null,
      logs: [], ...extras
    });
    return {
      version: 5,
      tasks: [
        task('整理本周的工作重点', 'red', d(0), '上午', '09:30'),
        task('回复妈妈的消息', 'blue', d(0), '上午', '11:00', { area: 'soul', urgency: 'must' }),
        task('散步 20 分钟，晒晒太阳', 'green', d(0), '下午', '16:30', { area: 'body' }),
        task('阅读《也许你该找个人聊聊》', 'orange', d(0), '晚上', '21:00', { area: 'growth' }),
        task('整理书桌', 'green', d(-1), '晚上', '20:00', { area: 'moments' }),
        task('提交设计初稿', 'red', d(-2), '下午', '15:00', { done: true, record: { status: '完成', left: '', feeling: '踏实', memo: '先把框架搭好，再补细节，效率很高。' } }),
        task('预约牙医', 'orange', d(-3), '上午', '10:00', { done: true, record: { status: '完成', left: '', feeling: '放心了', memo: '' } }),
        task('慢跑 3 公里', 'green', d(-4), '晚上', '19:00', { area: 'body', done: true, record: { status: '部分', left: '下次早点出门', feeling: '轻松', memo: '跑了 2 公里也很好。' } }),
        task('更新作品集文案', 'orange', d(2), '下午', '14:00'),
        task('和小周喝咖啡', 'green', d(4), '下午', '15:30')
      ],
      aiPlans: [],
      recurring: [],
      projects: [
        { id: projectOne, name: 'Q3 品牌传播', description: '完成第三季度品牌传播方案与核心素材。', status: 'doing', priority: 'high', owner: '我', relatedPeople: ['设计同学', '业务负责人'], startDate: d(-6), deadline: d(21), createdAt: Date.now(), archivedAt: null },
        { id: projectTwo, name: 'CEO 人物采访', description: '从采访准备到内容定稿的完整执行。', status: 'not_started', priority: 'medium', owner: '我', relatedPeople: [], startDate: d(2), deadline: d(30), createdAt: Date.now(), archivedAt: null }
      ],
      workTasks: [
        workflowTask('整理传播案例与关键数据', projectOne, 'doing', 'high', d(3), { planDate: d(0), notes: '优先看近一年同赛道案例。', logs: [{ id: uid('log'), content: '已经列出第一批案例清单，待补充海外样本。', createdAt: Date.now() - 3600000 }] }),
        workflowTask('和设计确认 KV 方向', projectOne, 'waiting', 'medium', d(5), { waitingFor: '设计同学', waitingReason: '新版 KV 草图', followUpDate: d(2) }),
        workflowTask('准备采访提纲第一版', projectTwo, 'todo', 'medium', d(9))
      ],
      inbox: [{ id: uid('note'), text: '找时间整理旅行照片', createdAt: Date.now() }],
      settings: {
        character: 'cat',
        quotes: [
          '不用一口气走很远，今天向前一点点就很好。',
          '完成比完美更可爱，你已经在路上了。',
          '累了就停一停，休息也算计划的一部分。',
          '把大事切成小块，生活就会慢慢松开。'
        ]
      }
    };
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved?.tasks && saved?.settings) {
        if (saved.settings.character === 'random') saved.settings.character = 'pear';
        saved.inbox ||= [];
        saved.recurring ||= [];
        saved.aiPlans ||= [];
        saved.projects ||= [];
        saved.workTasks ||= [];
        saved.aiPlans.forEach((plan) => {
          plan.references ||= [];
          plan.engine ||= 'local-planner-v2';
        });
        saved.tasks.forEach((task) => {
          task.area ||= 'career';
          task.urgency ||= 'best';
          task.mustDo = Boolean(task.mustDo);
        });
        normalizeTaskOrders(saved);
        const homeTodoIds = new Set(saved.tasks.map((task) => task.id));
        saved.projects.forEach((project) => {
          project.relatedPeople = Array.isArray(project.relatedPeople) ? project.relatedPeople : [];
          project.archivedAt ||= null;
        });
        saved.workTasks.forEach((task) => {
          task.relatedPeople = Array.isArray(task.relatedPeople) ? task.relatedPeople : [];
          task.logs = Array.isArray(task.logs) ? task.logs : [];
          task.relatedHomeTodoId = homeTodoIds.has(task.relatedHomeTodoId) ? task.relatedHomeTodoId : null;
          task.completedAt = task.status === 'done' ? (task.completedAt || Date.now()) : null;
        });
        migrateLegacyAiPlans(saved);
        saved.version = 5;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
        return saved;
      }
    } catch (error) {
      console.warn('无法读取本地数据，已恢复示例。', error);
    }
    const seed = makeSeed();
    normalizeTaskOrders(seed);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    return seed;
  }

  function migrateLegacyAiPlans(data) {
    const groups = new Map();
    data.tasks.filter((task) => task.aiGenerated && task.aiGoal && !task.aiPlanId).forEach((task) => {
      const key = `${task.aiGoal}\u0000${task.aiContext || ''}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(task);
    });
    groups.forEach((tasks) => {
      const first = tasks[0];
      let plan = data.aiPlans.find((item) => item.goal === first.aiGoal && (item.context || '') === (first.aiContext || ''));
      if (!plan) {
        const dates = tasks.map((task) => task.date).sort();
        plan = {
          id: uid('aiplan'), goal: first.aiGoal, context: first.aiContext || '',
          summary: '由早期版本生成的 AI 拆解计划。', granularity: 'week', references: [], engine: 'local-planner-v2',
          start: dates[0], deadline: dates[dates.length - 1], createdAt: Math.min(...tasks.map((task) => task.createdAt || Date.now()))
        };
        data.aiPlans.push(plan);
      }
      tasks.forEach((task) => { task.aiPlanId = plan.id; });
    });
  }

  function saveState() {
    normalizeTaskOrders(state);
    const homeTodoIds = new Set(state.tasks.map((task) => task.id));
    state.workTasks.forEach((task) => {
      if (task.relatedHomeTodoId && !homeTodoIds.has(task.relatedHomeTodoId)) task.relatedHomeTodoId = null;
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function carryOverdueTasks() {
    const today = todayISO();
    let count = 0;
    state.tasks.forEach((task) => {
      if (!task.done && !task.archived && task.date < today) {
        task.date = today;
        task.manualOrder = undefined;
        task.carried = true;
        task.updatedAt = Date.now();
        count += 1;
      }
    });
    if (count) saveState();
    return count;
  }

  function renderAll() {
    renderToday();
    renderAiPlans();
    renderInbox();
    renderCalendar();
    renderStats();
    renderRecurring();
    renderProfile();
    renderWorkflow();
  }

  function linkedWorkTasks(homeTodoId) {
    return state.workTasks.filter((task) => task.relatedHomeTodoId === homeTodoId);
  }

  function homeTaskLinks(homeTask) {
    const linked = linkedWorkTasks(homeTask.id);
    if (!linked.length) return '';
    const expanded = expandedHomeLinks.has(homeTask.id);
    return `<div class="home-work-links ${expanded ? 'expanded' : ''}">
      <button class="home-work-toggle" data-action="toggle-home-links" data-id="${homeTask.id}" aria-expanded="${expanded}"><span>${expanded ? '▼' : '▶'}</span>${linked.length} 个关联待办</button>
      ${expanded ? `<div class="home-work-list">${linked.map((workTask) => `<div class="home-work-item ${workTask.status === 'done' ? 'done' : ''}"><button class="home-work-check" data-action="toggle-work-task" data-id="${workTask.id}" aria-label="${workTask.status === 'done' ? '改回待完成' : '标记完成'}">${workTask.status === 'done' ? '✓' : ''}</button><button class="home-work-title" data-action="open-work-task" data-id="${workTask.id}">${escapeHTML(workTask.title)}</button>${workTask.deadline ? `<small>${formatChineseDate(workTask.deadline, false)}</small>` : ''}</div>`).join('')}</div>` : ''}
    </div>`;
  }

  function taskCard(task, showWorkLinks = false, reorderable = false) {
    const meta = [task.start || task.period, task.end ? `— ${task.end}` : '', task.remind ? '♡ 提醒' : ''].filter(Boolean).join(' ');
    const area = AREAS[task.area] || AREAS.career;
    const record = task.record ? `<div class="record-preview">${escapeHTML(task.record.status)} · ${escapeHTML(task.record.feeling || task.record.memo || '留下了一笔记录')}</div>` : '';
    const selected = selectedTaskIds.has(task.id);
    const checkAction = batchMode ? 'batch-select' : 'toggle';
    const checkLabel = batchMode ? (selected ? '取消选择' : '选择待办') : (task.done ? '取消完成' : '标记完成');
    const checkMark = batchMode ? (selected ? '✓' : '') : (task.done ? '✓' : '');
    const orderControls = reorderable ? `<button type="button" class="task-drag-handle" draggable="true" data-task-drag-id="${task.id}" title="拖动调整顺序" aria-label="拖动调整顺序">⠿</button>` : '';
    const taskActions = reorderable ? `<div class="task-card-actions"><button class="task-order-button" data-action="task-order-up" data-id="${task.id}" aria-label="上移一位">↑</button><button class="task-order-button" data-action="task-order-down" data-id="${task.id}" aria-label="下移一位">↓</button><button class="edit-btn" data-action="edit" data-id="${task.id}" aria-label="编辑">···</button></div>` : `<button class="edit-btn" data-action="edit" data-id="${task.id}" aria-label="编辑">···</button>`;
    return `<article class="task-card ${reorderable ? 'reorderable' : ''} ${task.done ? 'done' : ''} ${batchMode ? 'batch-mode' : ''} ${selected ? 'batch-selected' : ''}" data-home-task-id="${task.id}" style="--priority:${COLORS[task.priority]}">
      ${orderControls}
      <button class="check-btn" data-action="${checkAction}" data-id="${task.id}" aria-label="${checkLabel}">${checkMark}</button>
      <div><strong class="task-name">${escapeHTML(task.name)}</strong><div class="task-meta"><span>${meta}</span><span class="area-tag">${area.icon} ${area.name}</span><span class="urgency-tag ${task.urgency}">${task.urgency === 'must' ? '必须今天' : '最好今天'}</span>${task.carried ? '<span class="carry-tag">↻ 已顺延</span>' : ''}</div></div>
      ${taskActions}${record}${showWorkLinks ? homeTaskLinks(task) : ''}
    </article>`;
  }

  function emptyState(title, copy, icon = '☁️') {
    return `<div class="empty-state"><span>${icon}</span><h3>${title}</h3><p>${copy}</p></div>`;
  }

  function updatePeriodProgress(id, tasks) {
    const done = tasks.filter((task) => task.done).length;
    const rate = tasks.length ? Math.round(done / tasks.length * 100) : 0;
    const node = $(id);
    node.style.setProperty('--progress', `${rate * 3.6}deg`);
    $('strong', node).textContent = `${rate}%`;
    $('small', node).textContent = `${done}/${tasks.length}`;
  }

  function updateTodayProgress(tasks) {
    const done = tasks.filter((task) => task.done).length;
    const total = tasks.length;
    const rate = total ? Math.round(done / total * 100) : 0;
    const remaining = Math.max(0, total - done);
    const message = !total ? '从一件很小的事开始就好。' : rate === 100 ? '今天的你已经很好地完成了计划。' : rate >= 60 ? '已经走过大半，照这个节奏继续。' : done ? '每完成一件，今天就轻一点。' : '先做五分钟，也算真正开始。';
    const node = $('#dayProgress');
    node.style.setProperty('--progress-width', `${rate}%`);
    $('.today-progress-head b', node).textContent = `${rate}%`;
    $('#dayProgressCount').textContent = `${done} / ${total} 已完成`;
    $('#dayProgressRemain').textContent = remaining ? `还剩 ${remaining} 件` : total ? '今天已全部完成' : '今天还没有任务';
    $('#dayProgressMessage').textContent = message;
  }

  function taskSortValue(task) {
    const priority = { red: 0, orange: 1, blue: 2, green: 3 }[task.priority] ?? 4;
    const manualOrder = String(Number.isFinite(task.manualOrder) ? task.manualOrder : 9999999999).padStart(10, '0');
    return `${task.mustDo ? 0 : 1}-${manualOrder}-${priority}-${String(PERIOD_ORDER.indexOf(task.period)).padStart(2, '0')}-${task.start || '99:99'}`;
  }

  function areaTasksInManualOrder(task) {
    return state.tasks.filter((item) => item.date === task.date && item.area === task.area && !item.archived).sort((a, b) => (a.manualOrder || 0) - (b.manualOrder || 0));
  }

  function applyAreaTaskOrder(tasks, orderedTasks) {
    const orderValues = tasks.map((task) => task.manualOrder).sort((a, b) => a - b);
    orderedTasks.forEach((task, index) => { task.manualOrder = orderValues[index]; });
    saveState();
    renderToday();
  }

  function moveTaskInArea(taskId, direction) {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return;
    const tasks = areaTasksInManualOrder(task);
    const index = tasks.findIndex((item) => item.id === taskId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= tasks.length) return showToast(direction < 0 ? '已经是这个板块的第一件' : '已经是这个板块的最后一件');
    const reordered = [...tasks];
    [reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
    applyAreaTaskOrder(tasks, reordered);
    showToast('执行顺序已更新，时间线会同步变化');
  }

  function reorderTaskInArea(sourceId, targetId) {
    if (sourceId === targetId) return;
    const source = state.tasks.find((task) => task.id === sourceId);
    const target = state.tasks.find((task) => task.id === targetId);
    if (!source || !target || source.date !== target.date) return;
    if (source.area !== target.area) return showToast('请在同一个板块内拖动排序');
    const tasks = areaTasksInManualOrder(source);
    const reordered = tasks.filter((task) => task.id !== sourceId);
    const targetIndex = reordered.findIndex((task) => task.id === targetId);
    const insertIndex = source.manualOrder < target.manualOrder ? targetIndex + 1 : targetIndex;
    reordered.splice(Math.max(0, insertIndex), 0, source);
    applyAreaTaskOrder(tasks, reordered);
    showToast('执行顺序已更新，时间线会同步变化');
  }

  function compactFocusTask(task) {
    const area = AREAS[task.area] || AREAS.career;
    return `<article class="task-card focus-queued-task" style="--priority:${COLORS[task.priority]}">
      <button class="check-btn" data-action="toggle" data-id="${task.id}" aria-label="标记完成"></button>
      <div><strong class="task-name">${escapeHTML(task.name)}</strong><div class="task-meta"><span>${escapeHTML(task.start || task.period)}</span><span>${area.icon} ${area.name}</span></div></div>
      <button class="focus-star-button" data-action="must-do" data-id="${task.id}" aria-label="设为今日唯一必做">☆</button><button class="edit-btn" data-action="edit" data-id="${task.id}" aria-label="编辑">···</button>${homeTaskLinks(task)}
    </article>`;
  }

  function renderFocusView(tasks) {
    const pending = tasks.filter((task) => !task.done).sort((a, b) => taskSortValue(a).localeCompare(taskSortValue(b)));
    const now = pending.find((task) => task.mustDo) || pending[0];
    const queued = pending.filter((task) => !now || task.id !== now.id);
    const next = queued.slice(0, 1);
    const later = queued.slice(1);
    const timerActive = now && focusTimer.taskId === now.id;
    const timerLabel = formatFocusTime(focusTimer.secondsLeft);
    const timerProgress = Math.round(focusTimer.secondsLeft / 300 * 100);
    const area = now ? (AREAS[now.area] || AREAS.career) : null;
    const current = now ? `<article class="focus-current-card ${now.mustDo ? 'must-do' : ''}" style="--priority:${COLORS[now.priority]}">
      <div class="focus-current-main"><button class="check-btn" data-action="toggle" data-id="${now.id}" aria-label="标记完成"></button><div><div class="focus-title-line"><strong>${escapeHTML(now.name)}</strong>${now.mustDo ? '<span>唯一必做</span>' : ''}</div><div class="task-meta"><span>${escapeHTML(now.start || now.period)}</span><span>${area.icon} ${area.name}</span></div></div><button class="edit-btn" data-action="edit" data-id="${now.id}">···</button></div>
      <div class="focus-current-actions"><button class="must-do-button ${now.mustDo ? 'active' : ''}" data-action="must-do" data-id="${now.id}">${now.mustDo ? '★ 今日唯一必做' : '☆ 设为唯一必做'}</button><button class="five-minute-button ${timerActive && focusTimer.running ? 'active' : ''}" data-action="focus-timer" data-id="${now.id}">${timerActive && focusTimer.running ? `Ⅱ 暂停 ${timerLabel}` : timerActive && focusTimer.secondsLeft < 300 ? `▶ 继续 ${timerLabel}` : '▶ 先做5分钟'}</button></div>
      ${timerActive ? `<div class="focus-timer-panel"><div><span>${focusTimer.running ? '正在启动，不要求一次做完' : '暂停也没关系，准备好再继续'}</span><button data-action="focus-reset">重置</button></div><div class="focus-timer-track"><i style="width:${timerProgress}%"></i></div></div>` : ''}${homeTaskLinks(now)}
    </article>` : emptyState('今天还没有要做的事', '留白也很好，或者先添加一件最重要的小事。', '🐾');
    const fold = (key, title, copy, list, muted = false) => `<section class="focus-fold-wrap"><button class="focus-fold" data-action="focus-fold" data-section="${key}"><span class="focus-fold-index ${muted ? 'muted' : ''}">${key === 'next' ? 2 : 3}</span><span><strong>${title}</strong><small>${copy}</small></span><b>${list.length} 件</b><i>${openFocusSection === key ? '⌃' : '⌄'}</i></button>${openFocusSection === key ? `<div class="focus-fold-body">${list.length ? list.map(compactFocusTask).join('') : `<p>${key === 'next' ? '暂时没有下一步，安心做好现在这件。' : '稍后列表是空的。'}</p>`}</div>` : ''}</section>`;
    return `<div class="focus-section-label"><span>NOW</span><strong>现在，只看这一件</strong></div>${current}${fold('next', '下一步', '当前任务结束后再看', next)}${fold('later', '稍后', '先收起来，不占用注意力', later, true)}<button class="show-all-tasks" data-action="show-all">查看全部与已完成 ›</button>`;
  }

  function renderToday() {
    const today = todayISO();
    const date = fromISO(today);
    $('#todayDate').textContent = `${date.getMonth() + 1}月${date.getDate()}日 · ${['周日','周一','周二','周三','周四','周五','周六'][date.getDay()]}`;
    const allToday = state.tasks.filter((task) => task.date === today && !task.archived);
    const weekStart = toISO(shiftDate(date, -((date.getDay() + 6) % 7)));
    const weekEnd = toISO(shiftDate(fromISO(weekStart), 6));
    const weekTasks = state.tasks.filter((task) => task.date >= weekStart && task.date <= weekEnd && !task.archived);
    const monthPrefix = today.slice(0, 7);
    const monthTasks = state.tasks.filter((task) => task.date.startsWith(monthPrefix) && !task.archived);
    updateTodayProgress(allToday);
    updatePeriodProgress('#weekProgress', weekTasks);
    updatePeriodProgress('#monthProgress', monthTasks);
    const visible = todayMode === 'done' ? allToday.filter((task) => task.done) : allToday;
    const carried = allToday.filter((task) => task.carried && !task.done).length;
    $('#carryBanner').classList.toggle('hidden', !carried);
    $('#carryCount').textContent = `${carried} 件事从昨天轻轻走来`;
    $('#batchBar').classList.toggle('hidden', !batchMode);
    $('#batchManageBtn').classList.toggle('active', batchMode);
    $('#batchManageBtn').textContent = batchMode ? '管理中' : '批量管理';
    $('#batchCount').textContent = selectedTaskIds.size;
    $('#batchDeleteBtn').disabled = !selectedTaskIds.size;

    if (!batchMode && todayMode === 'timeline' && !showAllTasks) {
      $('#todayTaskList').innerHTML = renderFocusView(allToday);
      return;
    }

    let grouped;
    if (todayMode === 'area') {
      grouped = Object.entries(AREAS).map(([area, info]) => ({ key: area, title: `${info.icon} ${info.name}`, color: info.color, tasks: visible.filter((task) => task.area === area).sort((a, b) => (a.manualOrder || 0) - (b.manualOrder || 0)) })).filter((group) => group.tasks.length);
      $('#todayTaskList').innerHTML = grouped.length ? `${batchMode ? '' : '<div class="task-order-tip"><span>⠿</span><p><strong>按你想做的顺序排列</strong><small>拖动左侧手柄，或使用右侧 ↑ ↓；时间线会同步采用这个顺序。</small></p></div>'}${grouped.map((group) => `<section class="area-group"><h3 class="area-group-title" style="--area-color:${group.color}"><i></i>${group.title}<small>${group.tasks.length} 件</small></h3>${group.tasks.map((task) => taskCard(task, true, !batchMode)).join('')}</section>`).join('')}` : emptyState('今天还没有安排', '从上面的输入框或“添加今天要做的事”开始吧。');
    } else {
      grouped = PERIOD_ORDER.map((period) => ({ period, tasks: visible.filter((task) => task.period === period).sort((a, b) => taskSortValue(a).localeCompare(taskSortValue(b))) })).filter((group) => group.tasks.length);
      $('#todayTaskList').innerHTML = grouped.length ? grouped.map((group) => `<section class="period-group"><div class="period-title"><h3>${group.period}</h3><span>${group.tasks.filter((task) => task.done).length}/${group.tasks.length} 完成</span></div>${group.tasks.map((task) => taskCard(task, true)).join('')}</section>`).join('') : emptyState(todayMode === 'done' ? '还没有完成记录' : '今天还没有安排', todayMode === 'done' ? '完成一件小事后，它会出现在这里。' : '从上面的输入框或“添加今天要做的事”开始吧。', '🐾');
    }
  }

  function renderAiPlans() {
    const plans = [...(state.aiPlans || [])].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const totalPending = state.tasks.filter((task) => task.aiPlanId && !task.done && !task.archived).length;
    $('#aiPlansCount').textContent = plans.length;
    $('#aiPlansSummary').textContent = plans.length ? `${plans.length} 个计划 · ${totalPending} 条待完成` : '查看并管理 AI 拆解任务';
    $('#aiPlansList').innerHTML = plans.length ? plans.map((plan) => {
      const tasks = state.tasks.filter((task) => task.aiPlanId === plan.id);
      const done = tasks.filter((task) => task.done).length;
      const pending = tasks.filter((task) => !task.done && !task.archived).length;
      const dates = tasks.map((task) => task.date).filter(Boolean).sort();
      const start = dates[0] || plan.start;
      const deadline = dates[dates.length - 1] || plan.deadline;
      const stages = plan.weeklyStages || plan.document?.stages || [];
      const plannedWeeks = stages.filter((stage) => stage.planned).length;
      return `<article class="ai-master-card">
        <header><span class="ai-master-icon">✦</span><div><h3>${escapeHTML(plan.goal)}</h3><p>${escapeHTML(plan.summary || '按目标分阶段推进。')}</p></div></header>
        <div class="ai-master-metrics"><span><b>${plannedWeeks}/${stages.length}</b> 周已规划</span><span><b>${pending}</b> 条待完成</span><span>${done}/${tasks.length} 已完成</span><span>${start && deadline ? `${formatChineseDate(start, false)} — ${formatChineseDate(deadline, false)}` : '暂未安排日期'}</span>${plan.references?.length ? `<span>${plan.references.length} 条参考资料</span>` : ''}</div>
        <div class="ai-master-actions"><button class="continue-ai-plan-btn" data-action="continue-ai-plan" data-id="${plan.id}">继续逐周审核</button><button class="read-ai-plan-btn" data-action="read-ai-plan" data-id="${plan.id}">阅读方案文档</button><button class="delete-ai-plan-btn" data-action="delete-ai-plan" data-id="${plan.id}">删除计划与 ${tasks.length} 条待办</button></div>
      </article>`;
    }).join('') : emptyState('还没有 AI 大计划', '审核通过的 AI 拆解计划会集中出现在这里。', '✦');
  }

  function renderInbox() {
    const inbox = state.inbox || [];
    $('#inboxCount').textContent = inbox.length;
    $('#thoughtsBadge').textContent = inbox.length;
    $('#inboxList').innerHTML = inbox.length ? inbox.map((note) => `<div class="inbox-item"><span>${escapeHTML(note.text)}</span><button data-action="inbox-today" data-id="${note.id}">移入今天</button><button data-action="inbox-delete" data-id="${note.id}">删除</button></div>`).join('') : '<div class="subtle">收集箱空空的，脑袋也可以轻一点。</div>';
  }

  function renderCalendar() {
    const year = calendarCursor.getFullYear();
    const month = calendarCursor.getMonth();
    $('#monthLabel').textContent = `${year}年 ${month + 1}月`;
    const first = new Date(year, month, 1);
    const gridStart = shiftDate(first, -((first.getDay() + 6) % 7));
    $('#calendarGrid').innerHTML = Array.from({ length: 42 }, (_, index) => {
      const date = shiftDate(gridStart, index);
      const iso = toISO(date);
      const priorities = [...new Set(state.tasks.filter((task) => task.date === iso && !task.archived).map((task) => task.priority))].slice(0, 3);
      return `<button class="day-cell ${date.getMonth() !== month ? 'muted' : ''} ${iso === todayISO() ? 'today' : ''} ${iso === selectedDate ? 'selected' : ''}" data-date="${iso}"><span>${date.getDate()}</span><span class="day-dots">${priorities.map((priority) => `<i style="--dot:${COLORS[priority]}"></i>`).join('')}</span></button>`;
    }).join('');
    $('#selectedDateTitle').textContent = formatChineseDate(selectedDate);
    const tasks = state.tasks.filter((task) => task.date === selectedDate && !task.archived).sort((a, b) => (a.start || '').localeCompare(b.start || ''));
    $('#selectedDateTasks').innerHTML = tasks.length ? tasks.map(taskCard).join('') : emptyState('这天还空着', '留白也很好，或者安排一件期待的小事。', '🗓️');
  }

  function renderStats() {
    const now = new Date();
    const monthPrefix = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
    const monthTasks = state.tasks.filter((task) => task.date.startsWith(monthPrefix) && !task.archived);
    const doneTasks = monthTasks.filter((task) => task.done);
    const rate = monthTasks.length ? Math.round(doneTasks.length / monthTasks.length * 100) : 0;
    $('#monthRate').textContent = `${rate}%`;
    $('#doneCount').textContent = doneTasks.length;
    $('#totalTasksTop').textContent = monthTasks.length;
    $('#rateTop').textContent = `${rate}%`;
    $('#totalTasksStat').textContent = monthTasks.length;
    $('#statsSentence').textContent = rate >= 80 ? '这个月的你很有力量，也别忘了给自己留白。' : rate >= 45 ? '每一个小小完成，都值得被看见。' : '数字只是记录，不是评判。按自己的节奏来。';

    const days = Array.from({ length: 7 }, (_, i) => shiftDate(now, i - 6));
    $('#weekChart').innerHTML = days.map((date) => {
      const iso = toISO(date);
      const tasks = state.tasks.filter((task) => task.date === iso && !task.archived);
      const dayRate = tasks.length ? Math.round(tasks.filter((task) => task.done).length / tasks.length * 100) : 0;
      return `<div class="bar-col"><div class="bar-track"><div class="bar" style="height:${Math.max(4, dayRate)}%"><span>${tasks.length ? `${dayRate}%` : ''}</span></div></div><label>${['日','一','二','三','四','五','六'][date.getDay()]}</label></div>`;
    }).join('');

    const areaKeys = Object.keys(AREAS);
    const areaTaskCounts = areaKeys.map((area) => monthTasks.filter((task) => task.area === area).length);
    const maxArea = Math.max(1, ...areaTaskCounts);
    const cx = 150, cy = 135, radius = 92;
    const pointAt = (index, value, scale = radius) => {
      const angle = (-90 + index * 72) * Math.PI / 180;
      const r = scale * value;
      return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
    };
    const grids = [0.2,0.4,0.6,0.8,1].map((level) => `<polygon points="${areaKeys.map((_, index) => pointAt(index, level).join(',')).join(' ')}"></polygon>`).join('');
    const axes = areaKeys.map((_, index) => `<line x1="${cx}" y1="${cy}" x2="${pointAt(index, 1)[0]}" y2="${pointAt(index, 1)[1]}"></line>`).join('');
    $('#radarGrid').innerHTML = grids + axes;
    const radarPoints = areaTaskCounts.map((count, index) => pointAt(index, count / maxArea));
    $('#radarShape').setAttribute('points', radarPoints.map((point) => point.join(',')).join(' '));
    $('#radarPoints').innerHTML = radarPoints.map((point) => `<circle cx="${point[0]}" cy="${point[1]}" r="4"></circle>`).join('');
    $('#areaCounts').innerHTML = areaKeys.map((area, index) => `<div><strong>${areaTaskCounts[index]}</strong><small>${AREAS[area].icon} ${AREAS[area].name}</small></div>`).join('');

    const counts = Object.keys(COLORS).reduce((acc, color) => ({ ...acc, [color]: monthTasks.filter((task) => task.priority === color).length }), {});
    const total = Math.max(monthTasks.length, 1);
    let cursor = 0;
    const stops = Object.keys(COLORS).map((color) => {
      const start = cursor;
      cursor += counts[color] / total * 100;
      return `${COLORS[color]} ${start}% ${cursor}%`;
    });
    if (!monthTasks.length) stops.splice(0, stops.length, '#e7dfcf 0 100%');
    $('#priorityDonut').style.background = `conic-gradient(${stops.join(',')})`;
    $('#priorityLegend').innerHTML = Object.keys(COLORS).map((color) => `<div><i style="background:${COLORS[color]}"></i><span>${COLOR_NAMES[color]} · ${counts[color]}</span></div>`).join('');
  }

  function calculateStreak() {
    let streak = 0;
    for (let offset = 0; offset > -60; offset -= 1) {
      const iso = toISO(shiftDate(new Date(), offset));
      if (state.tasks.some((task) => task.date === iso && task.done)) streak += 1;
      else if (offset !== 0) break;
    }
    return streak;
  }

  function renderRecurring() {
    const plans = state.recurring || [];
    renderRecurringDraft();
    $('#recurringList').innerHTML = plans.length ? plans.map((plan) => {
      const generated = state.tasks.filter((task) => task.recId === plan.id).length;
      const dayNames = !plan.days.length || plan.days.length === 7 ? '每天' : plan.days.map((day) => ['日','一','二','三','四','五','六'][day]).join('、');
      return `<article class="recurring-card"><header><div><h3>${escapeHTML(plan.name)}</h3><p>${formatChineseDate(plan.start, false)} — ${formatChineseDate(plan.end, false)}</p></div><span class="carry-tag">${generated} 件</span></header><p>每周${dayNames} · ${plan.items.map((item) => escapeHTML(item.name)).join('、')}</p><div class="recurring-actions"><button data-action="regenerate" data-id="${plan.id}">补充生成</button><button data-action="delete-recurring" data-id="${plan.id}">删除计划</button></div></article>`;
    }).join('') : emptyState('还没有周期计划', '把晨间习惯、学习或运动一次排好，之后就轻松了。', '↻');
  }

  function renderRecurringDraft() {
    $('#recurringDraftItems').innerHTML = recurringDraftItems.map((item, index) => `<div class="draft-rec-item"><div><strong>${escapeHTML(item.name)}</strong><small>${AREAS[item.area].icon} ${AREAS[item.area].name} · ${COLOR_NAMES[item.priority]} · ${item.period}${item.start ? ` ${item.start}` : ''}</small></div><button type="button" data-action="remove-rec-draft" data-index="${index}">×</button></div>`).join('');
  }

  function renderProfile() {
    $$('#characterOptions button').forEach((button) => button.classList.toggle('active', button.dataset.character === state.settings.character));
    $('#quoteList').innerHTML = state.settings.quotes.map((quote, index) => `<div class="quote-item"><span>“${escapeHTML(quote)}”</span><button data-quote-index="${index}" aria-label="删除">×</button></div>`).join('');
    updateNotificationStatus();
  }

  function parsePeople(value = '') {
    return [...new Set(value.split(/[，,]/).map((item) => item.trim()).filter(Boolean))];
  }

  function projectOptions(selected = '', includeEmpty = true) {
    const projects = state.projects.filter((project) => !project.archivedAt || project.id === selected);
    return `${includeEmpty ? '<option value="">暂不归入项目</option>' : ''}${projects.map((project) => `<option value="${project.id}" ${project.id === selected ? 'selected' : ''}>${escapeHTML(project.name)}</option>`).join('')}`;
  }

  function homeTodoOptions(selected = '') {
    const today = todayISO();
    const tomorrow = toISO(shiftDate(new Date(), 1));
    const todos = state.tasks.filter((task) => !task.archived && (!task.done || task.date >= today || task.id === selected));
    const group = (label, list) => list.length ? `<optgroup label="${label}">${list.map((task) => `<option value="${task.id}" ${task.id === selected ? 'selected' : ''}>${escapeHTML(`${task.date === today ? '今天' : task.date === tomorrow ? '明天' : formatChineseDate(task.date, false)} ${task.start || task.period} · ${task.name}`)}</option>`).join('')}</optgroup>` : '';
    return `<option value="">无关联</option>${group('今天', todos.filter((task) => task.date === today))}${group('明天', todos.filter((task) => task.date === tomorrow))}${group('未来', todos.filter((task) => task.date > tomorrow))}${group('更早未完成', todos.filter((task) => task.date < today && !task.done))}`;
  }

  function workflowTaskMatches(task) {
    const today = todayISO();
    const now = new Date();
    const weekStart = toISO(shiftDate(now, -((now.getDay() + 6) % 7)));
    const weekEnd = toISO(shiftDate(fromISO(weekStart), 6));
    const dueSoon = toISO(shiftDate(now, 7));
    if (workflowFilter === 'all') return true;
    if (['todo', 'doing', 'waiting', 'done'].includes(workflowFilter)) return task.status === workflowFilter;
    if (workflowFilter === 'week') return task.planDate >= weekStart && task.planDate <= weekEnd;
    if (workflowFilter === 'due') return task.status !== 'done' && task.deadline >= today && task.deadline <= dueSoon;
    if (workflowFilter === 'overdue') return task.status !== 'done' && task.deadline && task.deadline < today;
    return true;
  }

  function workflowTaskCard(task) {
    const project = state.projects.find((item) => item.id === task.projectId);
    const homeTodo = state.tasks.find((item) => item.id === task.relatedHomeTodoId);
    const date = task.deadline ? `${task.deadline < todayISO() && task.status !== 'done' ? '已逾期 · ' : ''}${formatChineseDate(task.deadline, false)}` : '未设截止日';
    return `<article class="workflow-task-card ${task.status === 'done' ? 'done' : ''}" data-priority="${task.priority}">
      <button class="workflow-check" data-action="toggle-work-task" data-id="${task.id}" aria-label="${task.status === 'done' ? '改回 Todo' : '标记 Done'}">${task.status === 'done' ? '✓' : ''}</button>
      <button class="workflow-task-main" data-action="open-work-task" data-id="${task.id}"><strong>${escapeHTML(task.title)}</strong><span>${project ? escapeHTML(project.name) : '未归入项目'}${task.owner ? ` · ${escapeHTML(task.owner)}` : ''}</span></button>
      <div class="workflow-task-state"><span class="work-status ${task.status}">${WORK_STATUS_NAMES[task.status] || 'Todo'}</span><small>${date}</small></div>
      ${homeTodo ? `<span class="workflow-home-link">⌁ ${escapeHTML(homeTodo.start || homeTodo.period)} ${escapeHTML(homeTodo.name)}</span>` : ''}
    </article>`;
  }

  function renderWorkflow() {
    if (!$('#workflowPage')) return;
    const projects = state.projects.filter((project) => !project.archivedAt);
    if (activeWorkflowProjectId && !projects.some((project) => project.id === activeWorkflowProjectId)) activeWorkflowProjectId = '';
    const openTasks = state.workTasks.filter((task) => task.status !== 'done');
    const waiting = state.workTasks.filter((task) => task.status === 'waiting').length;
    const overdue = openTasks.filter((task) => task.deadline && task.deadline < todayISO()).length;
    $('#workflowMetrics').innerHTML = `<div><span>进行中的项目</span><strong>${projects.filter((project) => project.status === 'doing').length}</strong></div><div><span>待执行任务</span><strong>${openTasks.length}</strong></div><div><span>Waiting</span><strong>${waiting}</strong></div><div class="${overdue ? 'alert' : ''}"><span>已逾期</span><strong>${overdue}</strong></div>`;
    $('#workflowProjects').innerHTML = projects.length ? projects.map((project) => {
      const tasks = state.workTasks.filter((task) => task.projectId === project.id);
      const done = tasks.filter((task) => task.status === 'done').length;
      const rate = tasks.length ? Math.round(done / tasks.length * 100) : 0;
      return `<article class="workflow-project-card ${project.id === activeWorkflowProjectId ? 'active' : ''}" data-priority="${project.priority}"><button class="project-card-main" data-action="open-project" data-id="${project.id}"><span class="project-status-dot ${project.status}"></span><span><small>${PROJECT_STATUS_NAMES[project.status] || '未开始'} · ${WORK_PRIORITY_NAMES[project.priority] || 'Medium'}</small><strong>${escapeHTML(project.name)}</strong><em>${escapeHTML(project.description || '还没有项目说明')}</em></span><b>${done} / ${tasks.length}</b></button><div class="project-progress"><i style="width:${rate}%"></i></div><footer><span>${project.deadline ? `截止 ${formatChineseDate(project.deadline, false)}` : '未设截止日期'}</span><button data-action="edit-project" data-id="${project.id}">编辑</button></footer></article>`;
    }).join('') : emptyState('还没有项目', '创建第一个项目，再把工作拆成清楚的执行任务。', '⌁');
    const activeProject = projects.find((project) => project.id === activeWorkflowProjectId);
    $('#workflowTaskHeading').textContent = activeProject ? activeProject.name : '所有工作任务';
    $('#showAllProjectsBtn').classList.toggle('hidden', !activeProject);
    $('#workflowQuickProject').innerHTML = projectOptions(activeProject?.id || '', true);
    const visibleTasks = state.workTasks.filter((task) => (!activeProject || task.projectId === activeProject.id) && workflowTaskMatches(task)).sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || (a.deadline || '9999-99-99').localeCompare(b.deadline || '9999-99-99') || (b.createdAt || 0) - (a.createdAt || 0));
    $('#workflowTaskList').innerHTML = visibleTasks.length ? visibleTasks.map(workflowTaskCard).join('') : emptyState('这个视图里还没有任务', activeProject ? '用上面的快速输入，立即记下一个下一步。' : '创建任务后，它会出现在这里。', '✓');
  }

  function openProjectForm(project = null) {
    $('#projectForm').reset();
    $('#projectId').value = project?.id || '';
    $('#projectName').value = project?.name || '';
    $('#projectDescription').value = project?.description || '';
    $('#projectStatus').value = project?.status || 'not_started';
    $('#projectPriority').value = project?.priority || 'medium';
    $('#projectOwner').value = project?.owner || '';
    $('#projectPeople').value = (project?.relatedPeople || []).join('，');
    $('#projectStart').value = project?.startDate || todayISO();
    $('#projectDeadline').value = project?.deadline || '';
    $('#projectArchived').checked = Boolean(project?.archivedAt);
    $('#projectArchiveRow').classList.toggle('hidden', !project);
    $('#deleteProjectBtn').classList.toggle('hidden', !project);
    $('#projectDrawerTitle').textContent = project ? '编辑项目' : '新建项目';
    openSheet('#projectDrawer');
    setTimeout(() => $('#projectName').focus(), 240);
  }

  function saveProject(event) {
    event.preventDefault();
    const id = $('#projectId').value;
    const old = state.projects.find((project) => project.id === id);
    const payload = { name: $('#projectName').value.trim(), description: $('#projectDescription').value.trim(), status: $('#projectStatus').value, priority: $('#projectPriority').value, owner: $('#projectOwner').value.trim(), relatedPeople: parsePeople($('#projectPeople').value), startDate: $('#projectStart').value, deadline: $('#projectDeadline').value, archivedAt: $('#projectArchived').checked ? (old?.archivedAt || Date.now()) : null };
    if (!payload.name) return;
    if (old) Object.assign(old, payload);
    else {
      const project = { id: uid('project'), ...payload, createdAt: Date.now() };
      state.projects.push(project);
      activeWorkflowProjectId = project.id;
    }
    saveState(); closeOverlays(); renderWorkflow(); showToast(old ? '项目已经更新' : '项目已建立');
  }

  function deleteProject() {
    const id = $('#projectId').value;
    const project = state.projects.find((item) => item.id === id);
    if (!project || !confirm(`删除“${project.name}”吗？项目内任务会保留为未归类任务。`)) return;
    state.projects = state.projects.filter((item) => item.id !== id);
    state.workTasks.forEach((task) => { if (task.projectId === id) task.projectId = ''; });
    if (activeWorkflowProjectId === id) activeWorkflowProjectId = '';
    saveState(); closeOverlays(); renderWorkflow(); showToast('项目已删除，任务仍然保留');
  }

  function renderWorkTimeline(task) {
    $('#workTimelineList').innerHTML = task.logs.length ? [...task.logs].sort((a, b) => b.createdAt - a.createdAt).map((log) => `<article><time>${new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(log.createdAt))}</time><p>${escapeHTML(log.content).replace(/\n/g, '<br>')}</p></article>`).join('') : '<p class="timeline-empty">还没有工作记录。每次沟通、反馈或进展，都可以留下一笔。</p>';
  }

  function openWorkTask(task = null, defaults = {}) {
    $('#workTaskForm').reset();
    $('#workTaskId').value = task?.id || '';
    $('#workTaskTitle').value = task?.title || '';
    $('#workTaskProject').innerHTML = projectOptions(task?.projectId || defaults.projectId || activeWorkflowProjectId, true);
    $('#workTaskStatus').value = task?.status || 'todo';
    $('#workTaskPriority').value = task?.priority || 'medium';
    $('#workTaskHomeLink').innerHTML = homeTodoOptions(task?.relatedHomeTodoId || '');
    $('#workTaskPlanDate').value = task?.planDate || '';
    $('#workTaskDeadline').value = task?.deadline || '';
    $('#workTaskOwner').value = task?.owner || '';
    $('#workTaskPeople').value = (task?.relatedPeople || []).join('，');
    $('#workTaskWaitingFor').value = task?.waitingFor || '';
    $('#workTaskWaitingReason').value = task?.waitingReason || '';
    $('#workTaskFollowUp').value = task?.followUpDate || '';
    $('#workTaskNotes').value = task?.notes || '';
    $('#workLogContent').value = '';
    $('#waitingFields').classList.toggle('hidden', (task?.status || 'todo') !== 'waiting');
    $('#workTimelineSection').classList.toggle('hidden', !task);
    $('#deleteWorkTaskBtn').classList.toggle('hidden', !task);
    $('#workTaskDrawerTitle').textContent = task ? '任务详情' : '新建工作任务';
    if (task) renderWorkTimeline(task);
    openSheet('#workTaskDrawer');
    setTimeout(() => $('#workTaskTitle').focus(), 240);
  }

  function saveWorkTask(event) {
    event.preventDefault();
    const existing = state.workTasks.find((task) => task.id === $('#workTaskId').value);
    const status = $('#workTaskStatus').value;
    const payload = { title: $('#workTaskTitle').value.trim(), projectId: $('#workTaskProject').value, status, priority: $('#workTaskPriority').value, planDate: $('#workTaskPlanDate').value, deadline: $('#workTaskDeadline').value, owner: $('#workTaskOwner').value.trim(), relatedPeople: parsePeople($('#workTaskPeople').value), waitingFor: $('#workTaskWaitingFor').value.trim(), waitingReason: $('#workTaskWaitingReason').value.trim(), followUpDate: $('#workTaskFollowUp').value, notes: $('#workTaskNotes').value.trim(), relatedHomeTodoId: $('#workTaskHomeLink').value || null, completedAt: status === 'done' ? (existing?.completedAt || Date.now()) : null };
    if (!payload.title) return;
    if (existing) Object.assign(existing, payload);
    else state.workTasks.push({ id: uid('work'), ...payload, createdAt: Date.now(), logs: [] });
    saveState(); closeOverlays(); renderAll(); showToast(existing ? '任务详情已保存' : '工作任务已创建');
  }

  function quickAddWorkTask(event) {
    event.preventDefault();
    const title = $('#workflowQuickTitle').value.trim();
    if (!title) return;
    state.workTasks.push({ id: uid('work'), title, projectId: $('#workflowQuickProject').value, status: 'todo', priority: 'medium', planDate: '', deadline: '', owner: '', relatedPeople: [], waitingFor: '', waitingReason: '', followUpDate: '', notes: '', relatedHomeTodoId: null, createdAt: Date.now(), completedAt: null, logs: [] });
    $('#workflowQuickTitle').value = '';
    saveState(); renderWorkflow(); showToast('任务已记下'); $('#workflowQuickTitle').focus();
  }

  function toggleWorkTask(taskId) {
    const task = state.workTasks.find((item) => item.id === taskId);
    if (!task) return;
    task.status = task.status === 'done' ? 'todo' : 'done';
    task.completedAt = task.status === 'done' ? Date.now() : null;
    saveState(); renderAll(); showToast(task.status === 'done' ? '工作任务已完成' : '已改回 Todo');
  }

  function deleteWorkTask() {
    const task = state.workTasks.find((item) => item.id === $('#workTaskId').value);
    if (!task || !confirm(`删除“${task.title}”吗？首页事项不会受到影响。`)) return;
    state.workTasks = state.workTasks.filter((item) => item.id !== task.id);
    saveState(); closeOverlays(); renderAll(); showToast('工作任务已删除');
  }

  function addWorkLog() {
    const task = state.workTasks.find((item) => item.id === $('#workTaskId').value);
    const content = $('#workLogContent').value.trim();
    if (!task || !content) return showToast('先写下这次工作进展');
    task.logs.push({ id: uid('log'), content, createdAt: Date.now() });
    $('#workLogContent').value = '';
    saveState(); renderWorkTimeline(task); renderWorkflow(); showToast('工作记录已添加');
  }

  function switchPage(target) {
    currentPage = target;
    if (target !== 'today' && batchMode) {
      batchMode = false;
      selectedTaskIds.clear();
      renderToday();
    }
    $$('.page').forEach((page) => page.classList.toggle('active', page.dataset.page === target));
    $$('.tabbar button').forEach((button) => button.classList.toggle('active', button.dataset.target === target));
    $('#pageTitle').textContent = PAGE_META[target][0];
    $('#pageTitle').classList.toggle('handwritten-title', target === 'today');
    $('#headerEyebrow').textContent = PAGE_META[target][1];
    $('#addTaskBtn').classList.toggle('hidden', target !== 'calendar');
    if (target === 'calendar') renderCalendar();
    if (target === 'stats') renderStats();
    if (target === 'workflow') renderWorkflow();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openSheet(id) {
    closeOverlays();
    $('#sheetBackdrop').classList.add('show');
    $(id).classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  function closeOverlays() {
    $('#sheetBackdrop').classList.remove('show');
    $$('.bottom-sheet').forEach((sheet) => sheet.classList.remove('show'));
    $('#encourageModal').classList.remove('show');
    document.body.style.overflow = '';
  }

  function openTaskForm(task = null, date = null) {
    $('#taskForm').reset();
    $('#taskId').value = task?.id || '';
    $('#taskName').value = task?.name || '';
    $(`input[name="priority"][value="${task?.priority || 'orange'}"]`).checked = true;
    $(`input[name="area"][value="${task?.area || 'career'}"]`).checked = true;
    $(`input[name="urgency"][value="${task?.urgency || 'best'}"]`).checked = true;
    $('#taskDate').value = task?.date || date || (currentPage === 'calendar' ? selectedDate : todayISO());
    $('#taskPeriod').value = task?.period || '上午';
    $('#taskStart').value = task?.start || '';
    $('#taskEnd').value = task?.end || '';
    $('#taskRemind').checked = task?.remind ?? true;
    $('#taskSheetTitle').textContent = task ? '编辑这件事' : '添加一件事';
    $('#deleteTaskBtn').classList.toggle('hidden', !task);
    openSheet('#taskSheet');
    setTimeout(() => $('#taskName').focus(), 320);
  }

  function saveTask(event) {
    event.preventDefault();
    const id = $('#taskId').value;
    const payload = {
      name: $('#taskName').value.trim(),
      priority: $('input[name="priority"]:checked').value,
      area: $('input[name="area"]:checked').value,
      urgency: $('input[name="urgency"]:checked').value,
      date: $('#taskDate').value,
      period: $('#taskPeriod').value,
      start: $('#taskStart').value,
      end: $('#taskEnd').value,
      remind: $('#taskRemind').checked,
      updatedAt: Date.now()
    };
    if (!payload.name) return;
    if (id) {
      const existing = state.tasks.find((task) => task.id === id);
      if (existing?.date !== payload.date) payload.manualOrder = undefined;
      Object.assign(existing, payload);
    }
    else state.tasks.push({ id: uid('task'), ...payload, done: false, carried: false, archived: false, mustDo: false, recId: null, record: null, createdAt: Date.now() });
    saveState();
    closeOverlays();
    renderAll();
    showToast(id ? '这件事已经更新' : '已经放进今天啦');
  }

  function handleTaskAction(button) {
    const task = state.tasks.find((item) => item.id === button.dataset.id);
    if (!task) return;
    if (button.dataset.action === 'batch-select') {
      if (selectedTaskIds.has(task.id)) selectedTaskIds.delete(task.id);
      else selectedTaskIds.add(task.id);
      renderToday();
      return;
    }
    if (button.dataset.action === 'edit') openTaskForm(task);
    if (button.dataset.action === 'toggle') {
      if (task.done) {
        task.done = false;
        task.record = null;
        task.updatedAt = Date.now();
        saveState();
        renderAll();
        showToast('已改回待完成');
      } else {
        recordStatus = '完成';
        $('#recordTaskId').value = task.id;
        $('#recordForm').reset();
        $$('#statusChips button').forEach((chip) => chip.classList.toggle('active', chip.dataset.status === '完成'));
        openSheet('#recordSheet');
      }
    }
  }

  function saveRecord(event) {
    event.preventDefault();
    const task = state.tasks.find((item) => item.id === $('#recordTaskId').value);
    if (!task) return;
    task.done = true;
    task.mustDo = false;
    if (focusTimer.taskId === task.id) resetFocusTimer(false);
    task.record = { status: recordStatus, left: $('#recordLeft').value.trim(), feeling: $('#recordFeeling').value.trim(), memo: $('#recordMemo').value.trim() };
    task.updatedAt = Date.now();
    saveState();
    closeOverlays();
    renderAll();
    showToast('完成被好好记下来了 ✓');
    const remaining = state.tasks.filter((item) => item.date === todayISO() && !item.done && !item.archived).length;
    if (!remaining) setTimeout(() => showEncouragement('今天辛苦啦'), 450);
  }

  function deleteCurrentTask() {
    const id = $('#taskId').value;
    if (!id || !confirm('要删除这件事吗？')) return;
    state.tasks = state.tasks.filter((task) => task.id !== id);
    saveState();
    closeOverlays();
    renderAll();
    showToast('这件事已移出清单');
  }

  function saveRecurring(event) {
    event.preventDefault();
    const days = $$('#weekdayOptions input:checked').map((input) => Number(input.value));
    if ($('#recurringItemName').value.trim()) addRecurringDraftItem(false);
    if (!recurringDraftItems.length) return showToast('先加入至少一件要重复做的事');
    const start = $('#recurringStart').value;
    const end = $('#recurringEnd').value;
    if (end < start) return showToast('结束日期要晚于开始日期');
    const plan = { id: uid('rec'), name: $('#recurringName').value.trim(), start, end, days, items: [...recurringDraftItems], createdAt: Date.now() };
    state.recurring.push(plan);
    const count = generateRecurringTasks(plan);
    recurringDraftItems = [];
    $('#recurringForm').reset();
    setRecurringDefaults();
    saveState();
    renderAll();
    showToast(`计划已建立，生成 ${count} 件待办`);
  }

  function addRecurringDraftItem(showMessage = true) {
    const name = $('#recurringItemName').value.trim();
    if (!name) return showMessage ? showToast('先写下要重复做的事') : false;
    recurringDraftItems.push({
      name,
      area: $('input[name="recArea"]:checked').value,
      priority: $('#recurringPriority').value,
      urgency: $('#recurringUrgency').value,
      period: $('#recurringPeriod').value,
      start: $('#recurringTime').value
    });
    $('#recurringItemName').value = '';
    $('#recurringTime').value = '';
    renderRecurringDraft();
    if (showMessage) showToast('已加入周期事项');
    return true;
  }

  function setRecurringDefaults() {
    $('#recurringStart').value = todayISO();
    $('#recurringEnd').value = toISO(shiftDate(new Date(), 30));
    $('input[name="recArea"][value="career"]').checked = true;
  }

  function generateRecurringTasks(plan) {
    let cursor = fromISO(plan.start);
    const end = fromISO(plan.end);
    let count = 0;
    let guard = 0;
    while (cursor <= end && guard < 370) {
      const iso = toISO(cursor);
      if (!plan.days.length || plan.days.includes(cursor.getDay())) {
        plan.items.forEach((item, itemIndex) => {
          const exists = state.tasks.some((task) => task.recId === plan.id && task.date === iso && task.recItem === itemIndex);
          if (!exists) {
            state.tasks.push({ id: uid('task'), ...item, date: iso, end: '', remind: true, done: false, carried: false, archived: false, recId: plan.id, recItem: itemIndex, record: null, createdAt: Date.now(), updatedAt: Date.now() });
            count += 1;
          }
        });
      }
      cursor = shiftDate(cursor, 1);
      guard += 1;
    }
    return count;
  }

  function handleRecurringAction(button) {
    const plan = state.recurring.find((item) => item.id === button.dataset.id);
    if (!plan) return;
    if (button.dataset.action === 'regenerate') {
      const count = generateRecurringTasks(plan);
      saveState(); renderAll(); showToast(count ? `补充生成 ${count} 件待办` : '周期待办已经齐全');
    }
    if (button.dataset.action === 'delete-recurring') {
      const removeTasks = confirm('删除计划后，是否也删除它生成的未完成待办？\n“确定”会一起删除，“取消”只删除计划。');
      state.recurring = state.recurring.filter((item) => item.id !== plan.id);
      if (removeTasks) state.tasks = state.tasks.filter((task) => task.recId !== plan.id || task.done);
      saveState(); renderAll(); showToast('周期计划已删除');
    }
  }

  function setBatchMode(enabled) {
    batchMode = enabled;
    showAllTasks = enabled;
    openFocusSection = '';
    if (!enabled) selectedTaskIds.clear();
    renderToday();
  }

  function formatFocusTime(seconds) {
    return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
  }

  function setMustDo(taskId) {
    const task = state.tasks.find((item) => item.id === taskId && item.date === todayISO() && !item.archived);
    if (!task) return;
    const shouldSet = !task.mustDo;
    state.tasks.forEach((item) => { if (item.date === todayISO()) item.mustDo = shouldSet && item.id === taskId; });
    if (focusTimer.taskId && focusTimer.taskId !== taskId) resetFocusTimer(false);
    openFocusSection = '';
    saveState();
    renderToday();
    showToast(shouldSet ? '已设为今天唯一必做' : '已取消唯一必做');
  }

  function clearFocusTimerHandle() {
    if (focusTimerHandle) clearInterval(focusTimerHandle);
    focusTimerHandle = null;
  }

  function tickFocusTimer() {
    if (!focusTimer.running || !focusTimerEndAt) return;
    focusTimer.secondsLeft = Math.max(0, Math.ceil((focusTimerEndAt - Date.now()) / 1000));
    if (!focusTimer.secondsLeft) {
      const taskId = focusTimer.taskId;
      clearFocusTimerHandle();
      focusTimer.running = false;
      focusTimerEndAt = 0;
      renderToday();
      if (confirm('5分钟到了。你已经跨过最难的启动阶段，要把这件事标记为完成吗？')) {
        const task = state.tasks.find((item) => item.id === taskId);
        if (task) { task.done = true; task.mustDo = false; task.updatedAt = Date.now(); saveState(); renderAll(); }
      }
      resetFocusTimer(false);
      return;
    }
    renderToday();
  }

  function toggleFocusTimer(taskId) {
    if (focusTimer.taskId === taskId && focusTimer.running) {
      tickFocusTimer();
      focusTimer.running = false;
      focusTimerEndAt = 0;
      clearFocusTimerHandle();
      renderToday();
      return;
    }
    const seconds = focusTimer.taskId === taskId && focusTimer.secondsLeft > 0 ? focusTimer.secondsLeft : 300;
    focusTimer = { taskId, secondsLeft: seconds, running: true };
    focusTimerEndAt = Date.now() + seconds * 1000;
    clearFocusTimerHandle();
    focusTimerHandle = setInterval(tickFocusTimer, 1000);
    renderToday();
  }

  function resetFocusTimer(shouldRender = true) {
    clearFocusTimerHandle();
    focusTimerEndAt = 0;
    focusTimer = { taskId: '', secondsLeft: 300, running: false };
    if (shouldRender) renderToday();
  }

  function deleteSelectedTasks() {
    if (!selectedTaskIds.size) return;
    if (!confirm(`确定删除选中的 ${selectedTaskIds.size} 条待办吗？`)) return;
    state.tasks = state.tasks.filter((task) => !selectedTaskIds.has(task.id));
    const count = selectedTaskIds.size;
    selectedTaskIds.clear();
    batchMode = false;
    saveState();
    renderAll();
    showToast(`已删除 ${count} 条待办`);
  }

  function deleteAiPlan(planId) {
    const plan = (state.aiPlans || []).find((item) => item.id === planId);
    if (!plan) return;
    const linkedTasks = state.tasks.filter((task) => task.aiPlanId === planId);
    const completed = linkedTasks.filter((task) => task.done).length;
    const completedCopy = completed ? `，其中包含 ${completed} 条已完成记录` : '';
    if (!confirm(`确定删除“${plan.goal}”吗？\n\n它关联的 ${linkedTasks.length} 条待办会一起删除${completedCopy}，此操作无法撤销。`)) return;
    const linkedIds = new Set(linkedTasks.map((task) => task.id));
    state.tasks = state.tasks.filter((task) => task.aiPlanId !== planId);
    state.aiPlans = state.aiPlans.filter((item) => item.id !== planId);
    linkedIds.forEach((id) => selectedTaskIds.delete(id));
    saveState();
    renderAll();
    showToast(`已删除整个计划和 ${linkedTasks.length} 条待办`);
  }

  function addQuickNote() {
    const text = $('#quickInput').value.trim();
    if (!text) return showToast('先写下脑海里的念头');
    if ($('#quickToday').checked) {
      state.tasks.push({ id: uid('task'), name: text, priority: 'green', area: 'moments', urgency: 'best', date: todayISO(), period: '全天', start: '', end: '', remind: false, done: false, carried: false, archived: false, recId: null, record: null, createdAt: Date.now(), updatedAt: Date.now() });
      showToast('已经放进今天');
    } else {
      state.inbox.push({ id: uid('note'), text, createdAt: Date.now() });
      showToast('念头已收到收集箱');
    }
    $('#quickInput').value = '';
    saveState();
    renderAll();
  }

  function handleInboxAction(button) {
    const note = state.inbox.find((item) => item.id === button.dataset.id);
    if (!note) return;
    if (button.dataset.action === 'inbox-today') {
      state.tasks.push({ id: uid('task'), name: note.text, priority: 'green', area: 'moments', urgency: 'best', date: todayISO(), period: '全天', start: '', end: '', remind: false, done: false, carried: false, archived: false, recId: null, record: null, createdAt: Date.now(), updatedAt: Date.now() });
      showToast('已从收集箱移入今天');
    }
    state.inbox = state.inbox.filter((item) => item.id !== note.id);
    saveState();
    renderAll();
  }

  function parseChineseNumber(value) {
    if (/^\d+$/.test(value)) return Number(value);
    const map = { 一:1, 二:2, 两:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9, 十:10 };
    if (value.length === 1) return map[value] || 0;
    if (value.startsWith('十')) return 10 + (map[value[1]] || 0);
    if (value.endsWith('十')) return (map[value[0]] || 1) * 10;
    return (map[value[0]] || 0) * 10 + (map[value[1]] || 0);
  }

  function inferDeadlineFromGoal(goal) {
    const start = new Date();
    const monthMatch = goal.match(/(\d+|[一二两三四五六七八九十]+)\s*个?月(?:内|后)?/);
    if (monthMatch) {
      const date = new Date(start);
      date.setMonth(date.getMonth() + parseChineseNumber(monthMatch[1]));
      return { date: toISO(date), label: `已识别：${monthMatch[0]}` };
    }
    const weekMatch = goal.match(/(\d+|[一二两三四五六七八九十]+)\s*周(?:内|后)?/);
    if (weekMatch) return { date: toISO(shiftDate(start, parseChineseNumber(weekMatch[1]) * 7)), label: `已识别：${weekMatch[0]}` };
    return null;
  }

  function getPlanArea(goal) {
    return /运动|跑步|健身|身体|睡眠/.test(goal) ? 'body' : /学习|读书|React|课程|考试|雅思|IELTS/i.test(goal) ? 'growth' : /旅行|电影|兴趣|照片/.test(goal) ? 'moments' : /情绪|关系|冥想|家人/.test(goal) ? 'soul' : 'career';
  }

  function buildSmartStages(goal, granularity, count, readiness) {
    const isIelts = /雅思|IELTS/i.test(goal);
    const isExam = isIelts || /考试|备考|考证/.test(goal);
    const ieltsWeek = ['完成全科基线模考，确认目标分与短板', '建立核心词汇与听力精听训练', '训练阅读定位、同义替换与限时节奏', '完成写作 Task 1 结构与批改闭环', '完成写作 Task 2 论证与语料积累', '进行口语题库练习与录音复盘', '完成第一次全真模考并修正策略', '针对最低分科目做集中补强', '完成第二次全真模考与错题归因', '进入考前模拟、作息和材料检查'];
    const ieltsMonth = ['基础诊断月：模考定基线，建立词汇和四科训练习惯', '专项强化月：听说读写分项突破，每周完成一次组合练习', '模考提升月：全真模考、错题归因和薄弱项补强', '考前冲刺月：稳定节奏，收敛错题，完成考前准备'];
    const examWeek = ['确认考试范围、目标分和当前基线', '建立知识框架并完成第一轮学习', '进行重点章节训练和错题整理', '完成阶段测试并定位薄弱点', '针对薄弱点集中补强', '完成模拟考试和复盘', '考前回顾与状态调整'];
    const generalWeek = ['明确完成标准并盘点现状', '收集资源并搭建执行框架', '完成第一阶段核心产出', '验证结果并收集反馈', '集中解决最关键的阻碍', '完成第二版并查漏补缺', '最终检查、交付与复盘'];
    const generalMonth = ['启动与规划：明确目标、范围和验收标准', '核心执行：完成主要内容并建立反馈循环', '优化提升：解决关键问题并迭代成果', '收尾交付：完成检查、交付和复盘'];
    const source = isIelts ? (granularity === 'week' ? ieltsWeek : ieltsMonth) : isExam ? examWeek : (granularity === 'week' ? generalWeek : generalMonth);
    const readinessPrefix = readiness === 'new' ? '从零开始：' : readiness === 'ready' ? '利用已有资料：' : '';
    return Array.from({ length: count }, (_, index) => {
      if (index === count - 1 && count > 1) return `${readinessPrefix}${source[source.length - 1]}（最终阶段）`;
      return `${readinessPrefix}${source[Math.min(index, source.length - 2)] || source[index % source.length]}`;
    });
  }

  function parseReferenceUrls(value = '') {
    return [...new Set(value.split(/\n+/).map((item) => item.trim()).filter(Boolean).map((item) => {
      try {
        const url = new URL(item);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
      } catch (error) {
        return '';
      }
    }).filter(Boolean))].slice(0, 8);
  }

  function buildPlanDocument(meta, items) {
    const isIelts = /雅思|IELTS/i.test(meta.goal);
    const milestones = items.map((item, index) => ({ index: index + 1, name: item.name, date: item.date, period: item.period || '全天' }));
    const commonRationale = [
      '先确认目标、完成标准和当前基线，避免一开始就把时间平均分配到所有内容。',
      '中段围绕最关键能力反复训练，并用阶段结果决定下一步，而不是只按日历机械推进。',
      '最后预留验证、修正和收尾时间，让计划能吸收延期、卡点和临时变化。'
    ];
    const ieltsRationale = [
      '5.5 到 7.5 通常不是单纯增加学习时长，而是要先识别听说读写中限制总分的短板，再集中补强。',
      '前半程建立词汇、精听、阅读定位、写作结构和口语输出的训练闭环；后半程用全真模考检验迁移效果。',
      '模考之后必须做错题归因：区分知识缺口、方法问题、时间分配和临场状态，下一阶段只处理最影响分数的原因。'
    ];
    const methods = isIelts ? [
      '每周至少完成一次可计分的完整练习，记录四科分数、耗时和主要失分原因。',
      '听力和阅读使用“做题—定位原文—分析同义替换—隔天重做”的闭环。',
      '写作保留题目、提纲、初稿、批改意见和重写稿；口语保留录音并复盘流利度、逻辑和词汇重复。',
      '每周复盘时，只选择一至两个最关键短板进入下一周，避免同时改太多导致计划失焦。'
    ] : [
      '为每个阶段定义一个可以检查的产出，而不是只写“学习”或“推进”。',
      '每周固定一次短复盘：保留有效做法，删除低价值动作，并调整下一阶段时间。',
      '遇到延期时优先缩小范围、保住核心结果，不把所有未完成任务无限顺延。'
    ];
    const metrics = isIelts ? ['四科最近一次模考分数与总分', '每科正确率、完成时间和高频错因', '写作重写次数与口语录音复盘次数', '连续执行周数和阶段任务完成率'] : ['阶段产出是否完成', '关键结果的质量或可验证反馈', '本周计划完成率', '下一阶段仍未解决的核心阻碍'];
    return {
      title: `${meta.goal} · 行动方案`,
      lead: isIelts ? '这份方案把提分目标拆成“诊断—专项训练—模考验证—考前收敛”四条相互衔接的路径。重点不是把日程填满，而是让每个阶段都能用结果判断是否真正进步。' : `这份方案围绕“${meta.goal}”建立从目标判断、阶段执行到复盘调整的完整路径，帮助你理解为什么这样拆，以及每一步应该观察什么结果。`,
      rationale: isIelts ? ieltsRationale : commonRationale,
      methods,
      metrics,
      risks: isIelts ? ['只刷题但不分析错因，会让同类错误反复出现。', '目标跨度较大时，阶段分数可能波动，应看两到三次练习的趋势。', '如果连续两周执行率低于 60%，应减少任务数量并重新校准考试日期。'] : ['计划过满会削弱持续性，优先保留最能推动结果的动作。', '如果连续两周没有阶段结果，应调整方法而不是单纯增加任务。', '外部条件变化时，先重设范围与截止日期，再重新排期。'],
      milestones,
      references: meta.references || [],
      engine: meta.engine || 'local-planner-v2'
    };
  }

  function renderPlanDocument(documentData) {
    const section = (index, title, content) => `<section class="document-section"><h4><b>${index}</b>${title}</h4>${content}</section>`;
    const bullets = (items) => `<ul>${items.map((item) => `<li>${escapeHTML(item)}</li>`).join('')}</ul>`;
    const stageItems = documentData.milestones || documentData.stages || [];
    const milestones = `<div class="document-milestones">${stageItems.map((item, index) => `<div class="document-milestone"><b>${item.index || index + 1}</b><div><strong>${escapeHTML(item.name || item.title)}</strong><small>${formatChineseDate(item.date, false)} · ${escapeHTML(item.period || '全天')}</small></div></div>`).join('')}</div>`;
    const referenceItems = documentData.references || [];
    const references = referenceItems.length ? `<div class="reference-list">${referenceItems.map((entry) => { const text = String(entry); const url = text.match(/https:\/\/[^\s—]+/)?.[0]; return url ? `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(text)}</a>` : `<span>${escapeHTML(text)}</span>`; }).join('')}</div><p class="reference-notice">公开网页正文由你的云函数读取后交给 DeepSeek 分析；无法读取的页面不会假装引用。重要考试规则仍建议回到原始页面核对。</p>` : '<p>本次没有添加外部参考资料。</p>';
    $('#aiDocumentTitle').textContent = documentData.title;
    $('#aiDocumentContent').innerHTML = `<div class="document-hero"><span>可阅读行动方案</span><h3>${escapeHTML(documentData.title)}</h3><p>${escapeHTML(documentData.lead || documentData.overview || '')}</p></div>${section(1, '为什么这样拆', bullets(documentData.rationale || documentData.whyThisPlan || []))}${section(2, '阶段安排', milestones)}${section(3, '建议的执行方法', bullets(documentData.methods || documentData.executionMethods || []))}${section(4, '如何判断正在进步', bullets(documentData.metrics || documentData.measurement || []))}${section(5, '风险与调整策略', bullets(documentData.risks || []))}${section(6, '参考资料', references)}`;
  }

  function openAiDocument(meta, items, returnSheet) {
    activeDocumentReturn = returnSheet;
    renderPlanDocument(meta.document || buildPlanDocument(meta, items));
    openSheet('#aiDocumentSheet');
  }

  function renderAiReview() {
    if (!aiPlanMeta) return;
    $('#aiOverviewGoal').textContent = aiPlanMeta.goal;
    $('#aiOverviewSummary').textContent = aiPlanMeta.summary;
    $('#aiOverviewCount').textContent = aiDraft.length;
    $('#aiOverviewGranularity').textContent = aiPlanMeta.granularity === 'week' ? '按周拆解' : '按月拆解';
    $('#aiOverviewRange').textContent = `${formatChineseDate(aiPlanMeta.start, false)} — ${formatChineseDate(aiPlanMeta.deadline, false)}`;
    $('#aiOverviewEngine').textContent = `${aiPlanMeta.engine || 'DeepSeek'}${aiPlanMeta.references.length ? ` · ${aiPlanMeta.references.length} 条资料` : ''}`;
    $('#aiReviewTip').textContent = aiPlanMeta.granularity === 'week' ? '这是每周阶段概览。每一周单独审核，通过后再由 DeepSeek 细化到每天；每日草案确认后才加入待办。' : '当前是按月概览，可以先保存；若要逐周细化到每日，请返回并选择“按周拆解”。';
    $('#aiDraftList').innerHTML = aiDraft.map((item, index) => `<article class="ai-draft-card" data-draft-id="${item.id}" draggable="true">
      <div class="draft-drag-handle" title="拖动调整顺序"><span>⠿</span><b>${index + 1}</b></div>
      <div class="draft-editor">
        <input class="draft-title-input" data-field="name" value="${escapeHTML(item.name)}" aria-label="阶段标题 ${index + 1}" />
        <div class="draft-fields"><input type="date" data-field="date" value="${item.date}" aria-label="阶段日期 ${index + 1}" /><select data-field="period" aria-label="阶段时段 ${index + 1}">${PERIOD_ORDER.map((period) => `<option ${period === item.period ? 'selected' : ''}>${period}</option>`).join('')}</select><select data-field="area" aria-label="阶段板块 ${index + 1}">${Object.entries(AREAS).map(([key, area]) => `<option value="${key}" ${key === item.area ? 'selected' : ''}>${area.icon} ${area.name}</option>`).join('')}</select></div>
        ${item.deliverable ? `<p class="draft-deliverable">完成标志：${escapeHTML(item.deliverable)}</p>` : ''}
        <div class="draft-card-actions"><small>${aiPlanMeta.granularity === 'week' ? `第 ${index + 1} 周` : `第 ${index + 1} 月`} · ${item.planned ? `已规划 ${item.dailyTaskCount || 0} 条每日任务` : '尚未加入日历'}</small><div class="draft-order-buttons"><button data-action="draft-up" data-id="${item.id}" ${index === 0 ? 'disabled' : ''} aria-label="上移">↑</button><button data-action="draft-down" data-id="${item.id}" ${index === aiDraft.length - 1 ? 'disabled' : ''} aria-label="下移">↓</button><button data-action="draft-delete" data-id="${item.id}" aria-label="删除草案">×</button></div></div>
        ${aiPlanMeta.granularity === 'week' ? `<button class="week-plan-button ${item.planned ? 'planned' : ''}" data-action="plan-week" data-id="${item.id}">${item.planned ? `✓ 已规划 ${item.dailyTaskCount || 0} 条 · 重新规划` : '通过并规划本周每日计划'}</button>` : ''}
      </div></article>`).join('');
  }

  function moveAiDraft(id, targetIndex) {
    const currentIndex = aiDraft.findIndex((item) => item.id === id);
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= aiDraft.length || currentIndex === targetIndex) return;
    const dates = aiDraft.map((item) => item.date).sort();
    const [item] = aiDraft.splice(currentIndex, 1);
    aiDraft.splice(targetIndex, 0, item);
    aiDraft.forEach((draft, index) => { draft.date = dates[index] || draft.date; });
    renderAiReview();
  }

  function localAiPayload({ goal, sourceText, deadline, granularity, references }) {
    const start = fromISO(todayISO());
    const end = fromISO(deadline);
    const diffDays = Math.max(1, Math.ceil((end - start) / 86400000));
    const count = granularity === 'week' ? Math.min(16, Math.max(1, Math.ceil(diffDays / 7))) : Math.min(12, Math.max(1, Math.ceil(diffDays / 30)));
    const inferredGoal = goal || sourceText.split(/\n+/).map((line) => line.trim()).find(Boolean)?.slice(0, 80) || '根据粘贴文本整理的计划';
    const area = getPlanArea(`${inferredGoal} ${sourceText}`);
    const stages = buildSmartStages(inferredGoal, granularity, count, 'progress');
    const schedule = stages.map((title, index) => {
      const date = granularity === 'week' ? shiftDate(start, index * 7) : new Date(start.getFullYear(), start.getMonth() + index, start.getDate());
      return { title, date: toISO(date > end ? end : date), period: index % 2 ? '下午' : '上午', area, priority: index === stages.length - 1 ? 'red' : 'orange', rationale: '按阶段成果推进，并在本阶段结束时复盘。', deliverable: '完成本阶段核心产出并记录结果。' };
    });
    const meta = { goal: inferredGoal, context: '', references, granularity, start: todayISO(), deadline, engine: '本地备用规划', summary: `围绕“${inferredGoal}”分阶段推进：先明确标准，再完成核心执行，最后检查与复盘。` };
    const document = buildPlanDocument(meta, schedule.map((item) => ({ ...item, name: item.title })));
    return { summary: meta.summary, schedule, document: { title: document.title, overview: document.lead, whyThisPlan: document.rationale, executionMethods: document.methods, measurement: document.metrics, risks: document.risks, references: document.references } };
  }

  async function initCloudbase() {
    if (cloudbaseApp) return cloudbaseApp;
    const config = window.GENTLE_WEB_CONFIG || {};
    if (!window.cloudbase || !config.env) throw new Error('网页端云开发 SDK 尚未加载');
    const options = { env: config.env, region: config.region || 'ap-shanghai' };
    if (config.accessKey) options.accessKey = config.accessKey;
    cloudbaseApp = window.cloudbase.init(options);
    if (!config.accessKey) {
      const auth = cloudbaseApp.auth();
      const loginState = await auth.getLoginState();
      if (!loginState) await auth.signInAnonymously();
    }
    return cloudbaseApp;
  }

  async function callAiPlanner(data) {
    const app = await initCloudbase();
    const config = window.GENTLE_WEB_CONFIG || {};
    const response = await app.callFunction({ name: config.functionName || 'aiPlanner', data, parse: true });
    const result = typeof response.result === 'string' ? JSON.parse(response.result) : response.result;
    if (!result?.success) throw new Error(result?.message || 'DeepSeek 暂时没有返回计划');
    return result;
  }

  async function generateAiPlan(event) {
    event.preventDefault();
    const mode = $('#aiMode').value === 'text' ? 'text' : 'goal';
    const goal = $('#aiGoal').value.trim();
    const sourceText = $('#aiSourceText').value.trim();
    const context = $('#aiContext').value.trim();
    const references = parseReferenceUrls($('#aiReferences').value);
    const deadline = $('#aiDeadline').value;
    const granularity = $('#aiGranularity').value;
    if (mode === 'goal' && !goal) return showToast('请先写下目标');
    if (mode === 'text' && sourceText.length < 20) return showToast('请粘贴完整计划文本');
    if (!deadline) return showToast('请选择目标日期');
    const start = fromISO(todayISO());
    const end = fromISO(deadline);
    if (end < start) return showToast('目标日期不能早于今天');
    const submit = $('#aiSubmitBtn');
    const originalText = submit.textContent;
    submit.disabled = true;
    submit.textContent = 'DeepSeek 正在规划…';
    try {
      let result;
      try {
        result = await callAiPlanner({ mode, goal, sourceText, context, deadline, granularity, references });
      } catch (cloudError) {
        const useLocal = confirm(`DeepSeek 云函数暂时没有连通：${String(cloudError.message || cloudError).slice(0, 160)}\n\n要先使用本地备用规划查看完整流程吗？`);
        if (!useLocal) throw cloudError;
        result = { model: '本地备用规划', data: localAiPayload({ goal, sourceText, deadline, granularity, references }) };
      }
      const payload = result.data;
      const planGoal = goal || payload.document?.title || '根据粘贴文本整理的计划';
      aiDraft = payload.schedule.map((item) => ({ id: uid('draft'), name: item.title, date: item.date, period: item.period || '全天', area: item.area || getPlanArea(`${planGoal} ${sourceText}`), priority: item.priority || 'orange', urgency: 'best', rationale: item.rationale || '', deliverable: item.deliverable || '', planned: false, dailyTaskCount: 0 }));
      aiPlanMeta = { planId: uid('aiplan'), goal: planGoal, context, references, granularity, sourceMode: mode, start: todayISO(), deadline, engine: result.model || 'DeepSeek', summary: payload.summary, document: { title: payload.document.title, lead: payload.document.overview, rationale: payload.document.whyThisPlan, methods: payload.document.executionMethods, metrics: payload.document.measurement, risks: payload.document.risks, references: payload.document.references, stages: aiDraft } };
      renderAiReview();
      openSheet('#aiReviewSheet');
    } catch (error) {
      alert(`计划生成失败：${String(error.message || error).slice(0, 220)}`);
    } finally {
      submit.disabled = false;
      submit.textContent = originalText;
    }
  }

  function approveAiPlan() {
    if (!aiDraft.length || !aiPlanMeta) return showToast('草案里还没有可加入的阶段');
    const planId = aiPlanMeta.planId || uid('aiplan');
    state.aiPlans ||= [];
    const plan = { id: planId, ...aiPlanMeta, weeklyStages: aiDraft.map((item) => ({ ...item })), document: aiPlanMeta.document || buildPlanDocument(aiPlanMeta, aiDraft), updatedAt: Date.now() };
    const existing = state.aiPlans.findIndex((item) => item.id === planId);
    if (existing >= 0) plan.createdAt = state.aiPlans[existing].createdAt;
    else plan.createdAt = Date.now();
    if (existing >= 0) state.aiPlans.splice(existing, 1, plan); else state.aiPlans.unshift(plan);
    saveState();
    renderAll();
    renderAiPlans();
    openSheet('#aiPlansSheet');
    showToast('阶段概览已保存，可以逐周继续');
  }

  function getAiWeekRange(stage) {
    const later = aiDraft.filter((item) => item.id !== stage.id && item.date > stage.date).sort((a, b) => a.date.localeCompare(b.date));
    const naturalEnd = toISO(shiftDate(fromISO(stage.date), 6));
    const nextBoundary = later.length ? toISO(shiftDate(fromISO(later[0].date), -1)) : aiPlanMeta.deadline;
    return { start: stage.date, end: [naturalEnd, nextBoundary, aiPlanMeta.deadline].sort()[0] };
  }

  function localDailyPayload(stage, range) {
    const schedule = [];
    for (let date = fromISO(range.start); toISO(date) <= range.end; date = shiftDate(date, 1)) {
      const iso = toISO(date);
      schedule.push({ title: `${stage.name}：完成当天最小行动`, date: iso, period: date.getDay() === 0 ? '晚上' : '上午', area: stage.area || 'growth', priority: stage.priority || 'orange', rationale: '把周目标切成当天可以启动的一步。', deliverable: '留下练习、笔记或可检查的完成记录。' });
    }
    return { summary: `已把“${stage.name}”细化为 ${schedule.length} 条每日行动。`, schedule };
  }

  async function generateAiWeek(stage) {
    const range = getAiWeekRange(stage);
    if (range.end < range.start) return showToast('请先调整本周日期');
    const button = $(`[data-action="plan-week"][data-id="${stage.id}"]`);
    if (button) { button.disabled = true; button.textContent = 'DeepSeek 正在规划每日任务…'; }
    try {
      let result;
      try {
        result = await callAiPlanner({ mode: 'week_detail', goal: aiPlanMeta.goal, context: aiPlanMeta.summary || '', deadline: range.end, granularity: 'day', references: [], weekStage: { id: stage.id, title: stage.name, start: range.start, end: range.end, rationale: stage.rationale || '', deliverable: stage.deliverable || '' } });
      } catch (cloudError) {
        const useLocal = confirm(`每日计划暂时无法调用 DeepSeek：${String(cloudError.message || cloudError).slice(0, 150)}\n\n要使用本地备用规划继续审核流程吗？`);
        if (!useLocal) throw cloudError;
        result = { data: localDailyPayload(stage, range) };
      }
      const defaults = { 上午: '09:00', 下午: '14:00', 晚上: '20:00', 全天: '' };
      aiDailyDraft = result.data.schedule.map((item) => ({ id: uid('daily'), name: item.title, date: item.date, period: item.period || '全天', start: defaults[item.period] || '', priority: item.priority || stage.priority || 'orange', area: item.area || stage.area || 'growth', rationale: item.rationale || '', deliverable: item.deliverable || '' }));
      aiDailyMeta = { stageId: stage.id, stageTitle: stage.name, start: range.start, end: range.end, summary: result.data.summary || '已整理为每日可执行任务。' };
      renderAiDailyReview();
      openSheet('#aiDailyReviewSheet');
    } catch (error) {
      alert(`每日计划生成失败：${String(error.message || error).slice(0, 220)}`);
      renderAiReview();
    }
  }

  function renderAiDailyReview() {
    if (!aiDailyMeta) return;
    $('#aiDailyStageTitle').textContent = aiDailyMeta.stageTitle;
    $('#aiDailyRange').textContent = `${formatChineseDate(aiDailyMeta.start, false)} — ${formatChineseDate(aiDailyMeta.end, false)}`;
    $('#aiDailySummary').textContent = aiDailyMeta.summary;
    $('#aiDailyDraftList').innerHTML = aiDailyDraft.map((item, index) => `<article class="ai-draft-card daily-draft-card" data-daily-id="${item.id}" draggable="true"><div class="draft-drag-handle"><span>⠿</span><b>${index + 1}</b></div><div class="draft-editor"><input class="draft-title-input" data-field="name" value="${escapeHTML(item.name)}" aria-label="每日任务标题 ${index + 1}"><div class="draft-fields daily-fields"><input type="date" min="${aiDailyMeta.start}" max="${aiDailyMeta.end}" data-field="date" value="${item.date}"><select data-field="period">${PERIOD_ORDER.map((period) => `<option ${period === item.period ? 'selected' : ''}>${period}</option>`).join('')}</select><input type="time" data-field="start" value="${item.start || ''}"></div>${item.deliverable ? `<p class="draft-deliverable">完成标志：${escapeHTML(item.deliverable)}</p>` : ''}<div class="draft-card-actions"><small>审核后才会进入日历</small><div class="draft-order-buttons"><button data-action="daily-up" data-id="${item.id}" ${index === 0 ? 'disabled' : ''}>↑</button><button data-action="daily-down" data-id="${item.id}" ${index === aiDailyDraft.length - 1 ? 'disabled' : ''}>↓</button><button data-action="daily-delete" data-id="${item.id}">×</button></div></div></div></article>`).join('');
  }

  function moveDailyDraft(id, targetIndex) {
    const currentIndex = aiDailyDraft.findIndex((item) => item.id === id);
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= aiDailyDraft.length || currentIndex === targetIndex) return;
    const dates = aiDailyDraft.map((item) => item.date).sort();
    const [item] = aiDailyDraft.splice(currentIndex, 1);
    aiDailyDraft.splice(targetIndex, 0, item);
    aiDailyDraft.forEach((draft, index) => { draft.date = dates[index] || draft.date; });
    renderAiDailyReview();
  }

  function persistCurrentAiPlan() {
    if (!aiPlanMeta || !aiDraft.length) return '';
    const planId = aiPlanMeta.planId || uid('aiplan');
    aiPlanMeta.planId = planId;
    const existingIndex = state.aiPlans.findIndex((item) => item.id === planId);
    const existing = existingIndex >= 0 ? state.aiPlans[existingIndex] : null;
    const plan = { ...(existing || {}), id: planId, ...aiPlanMeta, weeklyStages: aiDraft.map((item) => ({ ...item })), document: { ...(aiPlanMeta.document || buildPlanDocument(aiPlanMeta, aiDraft)), stages: aiDraft.map((item) => ({ ...item })) }, createdAt: existing?.createdAt || Date.now(), updatedAt: Date.now() };
    if (existingIndex >= 0) state.aiPlans.splice(existingIndex, 1, plan); else state.aiPlans.unshift(plan);
    saveState();
    return planId;
  }

  function approveAiDailyPlan() {
    if (!aiDailyDraft.length || !aiDailyMeta) return showToast('每日草案不能为空');
    aiDraft = aiDraft.map((stage) => stage.id === aiDailyMeta.stageId ? { ...stage, planned: true, dailyTaskCount: aiDailyDraft.length } : stage);
    const planId = persistCurrentAiPlan();
    state.tasks = state.tasks.filter((task) => !(task.aiPlanId === planId && task.aiStageId === aiDailyMeta.stageId));
    aiDailyDraft.forEach((item) => state.tasks.push({ id: uid('task'), name: item.name, priority: item.priority, area: item.area, urgency: 'best', date: item.date, period: item.period, start: item.start || '', end: '', remind: true, done: false, mustDo: false, carried: false, archived: false, recId: null, aiPlanId: planId, aiStageId: aiDailyMeta.stageId, aiGenerated: true, record: null, createdAt: Date.now(), updatedAt: Date.now() }));
    saveState();
    aiDailyDraft = [];
    aiDailyMeta = null;
    renderAll();
    renderAiReview();
    openSheet('#aiReviewSheet');
    showToast('本周每日计划已加入待办');
  }

  function continueAiPlan(planId) {
    const plan = state.aiPlans.find((item) => item.id === planId);
    if (!plan) return;
    aiPlanMeta = { ...plan, planId: plan.id };
    aiDraft = (plan.weeklyStages || plan.document?.stages || []).map((item) => ({ ...item, id: item.id || uid('draft'), planned: Boolean(item.planned), dailyTaskCount: Number(item.dailyTaskCount || 0) }));
    renderAiReview();
    openSheet('#aiReviewSheet');
  }

  function showEncouragement(title = '嘿，慢慢来就很好') {
    const character = state.settings.character;
    $('#petArt').textContent = character === 'dog' ? '🐶' : character === 'pear' ? '🍐' : '🐱';
    $('#encourageTitle').textContent = title;
    const quotes = state.settings.quotes;
    $('#encourageQuote').textContent = quotes[Math.floor(Math.random() * quotes.length)] || '今天也辛苦啦。';
    $('#encourageModal').classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    $('#toast').textContent = message;
    $('#toast').classList.add('show');
    toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 2200);
  }

  function downloadDataSnapshot(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function validateImportedState(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('备份文件不是有效的数据对象');
    if (!Array.isArray(data.tasks)) throw new Error('备份文件缺少首页待办数据');
    if (!data.settings || typeof data.settings !== 'object') throw new Error('备份文件缺少应用设置');
    if (data.tasks.length > 100000) throw new Error('备份文件中的待办数量异常');
    const invalidTask = data.tasks.find((task) => !task || typeof task !== 'object' || typeof task.id !== 'string' || typeof task.name !== 'string');
    if (invalidTask) throw new Error('备份文件中存在无法识别的待办');
    ['aiPlans', 'recurring', 'inbox', 'projects', 'workTasks'].forEach((key) => {
      if (data[key] !== undefined && !Array.isArray(data[key])) throw new Error(`备份文件中的 ${key} 格式不正确`);
    });
    return data;
  }

  async function importDataFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return alert('备份文件超过 10MB，请确认选择的是本应用导出的 JSON 文件。');
    try {
      const imported = validateImportedState(JSON.parse(await file.text()));
      const workTaskCount = Array.isArray(imported.workTasks) ? imported.workTasks.length : 0;
      const projectCount = Array.isArray(imported.projects) ? imported.projects.length : 0;
      const approved = confirm(`将导入 ${imported.tasks.length} 条首页待办、${projectCount} 个项目和 ${workTaskCount} 条工作任务。\n\n导入会覆盖当前浏览器中的数据；系统会先自动下载一份当前数据备份。确定继续吗？`);
      if (!approved) return;
      downloadDataSnapshot(state, `喵汪待办-导入前自动备份-${todayISO()}.json`);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(imported));
      showToast('数据导入成功，正在重新载入');
      setTimeout(() => window.location.reload(), 450);
    } catch (error) {
      alert(`无法导入：${error.message || '文件内容不正确'}`);
    }
  }

  function isStandaloneApp() {
    return Boolean(window.matchMedia?.('(display-mode: standalone)').matches || window.navigator?.standalone);
  }

  function updateInstallButton() {
    const button = $('#installAppBtn');
    if (!button) return;
    button.classList.toggle('installed', isStandaloneApp());
    $('strong', button).textContent = isStandaloneApp() ? '已作为桌面 App 打开' : '安装到桌面 / Dock';
    $('small', button).textContent = isStandaloneApp() ? '当前正在独立窗口中运行' : '以独立 App 窗口打开';
  }

  async function installApp() {
    if (isStandaloneApp()) return showToast('当前已经在独立 App 窗口中');
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      updateInstallButton();
      return;
    }
    alert('在 Mac 上安装：\n\nSafari：菜单栏选择“文件 → 添加到程序坞”。\nChrome：点击地址栏右侧的安装图标，或在菜单中选择“安装喵汪待办”。\n\n安装后会以独立窗口运行。');
  }

  function registerPwa() {
    updateInstallButton();
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !/^https?:$/.test(window.location.protocol)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('离线能力注册失败', error));
    });
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      updateInstallButton();
    });
    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      updateInstallButton();
      showToast('喵汪待办已经安装到桌面');
    });
  }

  function notificationsSupported() {
    return typeof Notification !== 'undefined' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  }

  function updateNotificationStatus() {
    const status = $('#notificationStatus');
    const detail = $('#notificationStatusDetail');
    const button = $('#enableNotificationsBtn');
    if (!status || !detail || !button) return;
    button.classList.remove('active');
    button.disabled = false;
    if (!notificationsSupported()) {
      status.textContent = '当前浏览器不支持系统通知';
      detail.textContent = '请使用 Safari 或 Chrome 打开在线版';
      button.textContent = '暂不支持';
      button.disabled = true;
    } else if (Notification.permission === 'granted') {
      status.textContent = '系统通知已开启';
      detail.textContent = '应用保持运行或最小化时，会持续检查到点任务';
      button.textContent = '已开启';
      button.classList.add('active');
    } else if (Notification.permission === 'denied') {
      status.textContent = '系统通知已被阻止';
      detail.textContent = '请到“系统设置 → 通知”中允许喵汪待办';
      button.textContent = '查看说明';
    } else {
      status.textContent = '系统通知未开启';
      detail.textContent = '开启后，应用最小化时也能收到到点提醒';
      button.textContent = '开启系统通知';
    }
  }

  async function showSystemNotification(title, options = {}) {
    if (!notificationsSupported() || Notification.permission !== 'granted') return false;
    const notificationOptions = {
      icon: new URL('./icons/icon-192.png', window.location.href).href,
      badge: new URL('./icons/icon-192.png', window.location.href).href,
      ...options
    };
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(title, notificationOptions);
      return true;
    } catch (error) {
      try {
        new Notification(title, notificationOptions);
        return true;
      } catch (fallbackError) {
        console.warn('系统提醒发送失败', error, fallbackError);
        return false;
      }
    }
  }

  async function requestNotificationPermission(showTest = false) {
    if (!notificationsSupported()) {
      alert('当前浏览器不支持系统通知，请使用 Safari 或 Chrome 打开 HTTPS 在线版。');
      return false;
    }
    if (Notification.permission === 'denied') {
      alert('系统通知已被关闭。请打开“系统设置 → 通知 → 喵汪待办（或 Safari）”，允许通知后再回来测试。');
      updateNotificationStatus();
      return false;
    }
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    updateNotificationStatus();
    if (permission !== 'granted') {
      showToast('没有获得系统通知权限');
      return false;
    }
    if (showTest) await showSystemNotification('🐱 喵汪待办提醒测试', { body: '设置成功，应用最小化后也会继续检查到点任务。', tag: 'miaowang-reminder-test', data: { url: './' } });
    showToast('系统通知已经开启');
    checkDueReminder();
    return true;
  }

  function loadReminderHistory() {
    try {
      const history = JSON.parse(localStorage.getItem(REMINDER_HISTORY_KEY) || '{}');
      const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
      return Object.fromEntries(Object.entries(history).filter(([, timestamp]) => Number(timestamp) >= cutoff));
    } catch (error) {
      return {};
    }
  }

  function reminderHistoryKey(task) {
    return `${task.id}:${task.date}:${task.start}`;
  }

  function saveReminderHistory(history) {
    localStorage.setItem(REMINDER_HISTORY_KEY, JSON.stringify(history));
  }

  async function checkDueReminder() {
    const now = new Date();
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const history = loadReminderHistory();
    const dueTasks = state.tasks.filter((task) => task.date === todayISO() && !task.done && !task.archived && task.remind && task.start && task.start <= time && !history[reminderHistoryKey(task)]);
    if (!dueTasks.length) return;

    if (notificationsSupported() && Notification.permission === 'granted') {
      for (const task of dueTasks) {
        const area = AREAS[task.area];
        const sent = await showSystemNotification(`⏰ ${task.name}`, {
          body: `${task.start} · ${area ? `${area.icon} ${area.name}` : '到点提醒'}`,
          tag: `task-${reminderHistoryKey(task)}`,
          data: { url: './', taskId: task.id }
        });
        if (sent) history[reminderHistoryKey(task)] = Date.now();
      }
      saveReminderHistory(history);
      return;
    }

    if (document.visibilityState !== 'hidden') {
      dueTasks.forEach((task) => { history[reminderHistoryKey(task)] = Date.now(); });
      saveReminderHistory(history);
      const extra = dueTasks.length > 1 ? `，还有 ${dueTasks.length - 1} 件事也到点了` : '';
      showEncouragement(`“${dueTasks[0].name}”在等你${extra}`);
    }
  }

  function startReminderWatcher() {
    clearInterval(reminderTimerHandle);
    checkDueReminder();
    reminderTimerHandle = setInterval(checkDueReminder, REMINDER_CHECK_INTERVAL);
    document.addEventListener('visibilitychange', () => {
      updateNotificationStatus();
      if (document.visibilityState === 'visible') checkDueReminder();
    });
  }

  function bindEvents() {
    $('.tabbar').addEventListener('click', (event) => {
      const button = event.target.closest('[data-target]');
      if (button) switchPage(button.dataset.target);
    });
    $('#addTaskBtn').addEventListener('click', () => openTaskForm(null, currentPage === 'calendar' ? selectedDate : todayISO()));
    $('#calendarAdd').addEventListener('click', () => openTaskForm(null, selectedDate));
    $('#taskForm').addEventListener('submit', saveTask);
    $('#recordForm').addEventListener('submit', saveRecord);
    $('#recurringForm').addEventListener('submit', saveRecurring);
    $('#aiForm').addEventListener('submit', generateAiPlan);
    $('#projectForm').addEventListener('submit', saveProject);
    $('#workTaskForm').addEventListener('submit', saveWorkTask);
    $('#workflowQuickForm').addEventListener('submit', quickAddWorkTask);
    $('#deleteTaskBtn').addEventListener('click', deleteCurrentTask);
    $('#deleteProjectBtn').addEventListener('click', deleteProject);
    $('#deleteWorkTaskBtn').addEventListener('click', deleteWorkTask);
    $('#addWorkLogBtn').addEventListener('click', addWorkLog);
    $('#newProjectBtn').addEventListener('click', () => openProjectForm());
    $('#newWorkTaskBtn').addEventListener('click', () => openWorkTask(null, { projectId: activeWorkflowProjectId }));
    $('#showAllProjectsBtn').addEventListener('click', () => { activeWorkflowProjectId = ''; renderWorkflow(); });
    $('#workflowFilters').addEventListener('click', (event) => {
      const button = event.target.closest('[data-work-filter]');
      if (!button) return;
      workflowFilter = button.dataset.workFilter;
      $$('#workflowFilters button').forEach((item) => item.classList.toggle('active', item === button));
      renderWorkflow();
    });
    $('#workTaskStatus').addEventListener('change', () => $('#waitingFields').classList.toggle('hidden', $('#workTaskStatus').value !== 'waiting'));
    $('#sheetBackdrop').addEventListener('click', closeOverlays);
    $$('[data-close]').forEach((button) => button.addEventListener('click', closeOverlays));
    $('#encourageBtn').addEventListener('click', () => showEncouragement());
    $('#enableNotificationsBtn').addEventListener('click', () => requestNotificationPermission(true));
    $('#testReminderBtn').addEventListener('click', async () => {
      const allowed = (notificationsSupported() && Notification.permission === 'granted') || await requestNotificationPermission(false);
      if (allowed) {
        const sent = await showSystemNotification('🐱 喵汪待办提醒测试', { body: '测试成功，最小化应用后也能收到提醒。', tag: 'miaowang-reminder-test', data: { url: './' } });
        if (sent) showToast('系统提醒已经发出');
      }
    });
    $('#todayAddMain').addEventListener('click', () => openTaskForm(null, todayISO()));
    $('#addTomorrowBtn').addEventListener('click', () => openTaskForm(null, toISO(shiftDate(new Date(), 1))));
    $('#addWeekBtn').addEventListener('click', () => {
      const now = new Date();
      const untilSunday = now.getDay() === 0 ? 0 : 7 - now.getDay();
      openTaskForm(null, toISO(shiftDate(now, untilSunday)));
    });
    $('#quickAddBtn').addEventListener('click', addQuickNote);
    $('#quickInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') addQuickNote(); });
    $('#quickVoiceBtn').addEventListener('click', () => { $('#quickInput').focus(); showToast('可以直接输入，语音能力将在小程序端接入'); });
    $('#thoughtsToggle').addEventListener('click', () => {
      $('#thoughtsBody').classList.toggle('hidden');
      $('#thoughtsToggle').classList.toggle('open');
    });
    $('#inboxBtn').addEventListener('click', () => $('#inboxPanel').classList.toggle('hidden'));
    const openAiSheet = (prefill = '') => {
      $('#aiForm').reset();
      $('#aiMode').value = 'goal';
      $$('#aiModeRow button').forEach((button) => button.classList.toggle('active', button.dataset.aiMode === 'goal'));
      $('#aiSourceField').classList.add('hidden');
      $('#aiContextField').classList.remove('hidden');
      $('#aiGoalLabel').textContent = '你要完成的目标';
      $('#aiSubmitBtn').textContent = '生成计划概览';
      $('#aiGoal').value = prefill;
      $('#aiDeadline').value = toISO(shiftDate(new Date(), 56));
      openSheet('#aiSheet');
      setTimeout(() => $('#aiGoal').focus(), 320);
    };
    $('#aiPlanBtn').addEventListener('click', () => openAiSheet());
    $('#aiPlansBtn').addEventListener('click', () => { renderAiPlans(); openSheet('#aiPlansSheet'); });
    $('#taskAiHint').addEventListener('click', () => openAiSheet($('#taskName').value.trim()));
    $('#batchManageBtn').addEventListener('click', () => setBatchMode(!batchMode));
    $('#batchCancelBtn').addEventListener('click', () => setBatchMode(false));
    $('#batchSelectAll').addEventListener('click', () => {
      const todayTasks = state.tasks.filter((task) => task.date === todayISO() && !task.archived);
      const allSelected = todayTasks.length && todayTasks.every((task) => selectedTaskIds.has(task.id));
      selectedTaskIds = allSelected ? new Set() : new Set(todayTasks.map((task) => task.id));
      renderToday();
    });
    $('#batchDeleteBtn').addEventListener('click', deleteSelectedTasks);
    $('#aiModeRow').addEventListener('click', (event) => {
      const button = event.target.closest('[data-ai-mode]');
      if (!button) return;
      const mode = button.dataset.aiMode;
      $('#aiMode').value = mode;
      $$('#aiModeRow button').forEach((item) => item.classList.toggle('active', item === button));
      $('#aiSourceField').classList.toggle('hidden', mode !== 'text');
      $('#aiContextField').classList.toggle('hidden', mode === 'text');
      $('#aiGoalLabel').textContent = mode === 'text' ? '大任务名称（可选）' : '你要完成的目标';
      $('#aiSubmitBtn').textContent = mode === 'text' ? '根据以上文本拆解任务' : '生成计划概览';
      (mode === 'text' ? $('#aiSourceText') : $('#aiGoal')).focus();
    });
    $('#aiSourceText').addEventListener('input', () => { $('#aiSourceCount').textContent = $('#aiSourceText').value.length; });
    $('#aiGoal').addEventListener('input', () => {
      const inferred = inferDeadlineFromGoal($('#aiGoal').value);
      if (!inferred) return $('#aiDateHint').textContent = '输入“两个月内”等时长时，会自动推算目标日期。';
      $('#aiDeadline').value = inferred.date;
      $('#aiDateHint').textContent = `${inferred.label}，目标日期已自动更新为 ${formatChineseDate(inferred.date, false)}。`;
    });
    $('#aiBackBtn').addEventListener('click', () => openSheet('#aiSheet'));
    $('#aiApproveBtn').addEventListener('click', approveAiPlan);
    $('#aiReadDocBtn').addEventListener('click', () => openAiDocument(aiPlanMeta, aiDraft, '#aiReviewSheet'));
    $('#aiDocumentBackBtn').addEventListener('click', () => openSheet(activeDocumentReturn));
    $('#aiDailyBackBtn').addEventListener('click', () => { renderAiReview(); openSheet('#aiReviewSheet'); });
    $('#aiDailyCloseBtn').addEventListener('click', () => { renderAiReview(); openSheet('#aiReviewSheet'); });
    $('#aiDailyApproveBtn').addEventListener('click', approveAiDailyPlan);
    $('#carryBanner').addEventListener('click', () => {
      todayMode = 'timeline';
      $$('#taskModes button').forEach((button) => button.classList.toggle('active', button.dataset.mode === 'timeline'));
      renderToday();
    });
    $('#taskModes').addEventListener('click', (event) => {
      const button = event.target.closest('[data-mode]');
      if (!button) return;
      todayMode = button.dataset.mode;
      showAllTasks = button.dataset.mode !== 'timeline' ? true : !showAllTasks;
      if (button.dataset.mode === 'timeline' && showAllTasks) showAllTasks = false;
      $$('#taskModes button').forEach((item) => item.classList.toggle('active', item === button));
      renderToday();
    });
    $('#todayTaskList').addEventListener('dragstart', (event) => {
      const handle = event.target.closest('[data-task-drag-id]');
      if (!handle || todayMode !== 'area') return;
      draggedHomeTaskId = handle.dataset.taskDragId;
      handle.closest('[data-home-task-id]')?.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggedHomeTaskId);
    });
    $('#todayTaskList').addEventListener('dragover', (event) => {
      const card = event.target.closest('.task-card.reorderable[data-home-task-id]');
      if (!card || !draggedHomeTaskId || card.dataset.homeTaskId === draggedHomeTaskId) return;
      event.preventDefault();
      $$('.task-card.reorderable', $('#todayTaskList')).forEach((item) => item.classList.remove('drag-over'));
      card.classList.add('drag-over');
      event.dataTransfer.dropEffect = 'move';
    });
    $('#todayTaskList').addEventListener('drop', (event) => {
      const card = event.target.closest('.task-card.reorderable[data-home-task-id]');
      if (!card || !draggedHomeTaskId) return;
      event.preventDefault();
      reorderTaskInArea(draggedHomeTaskId, card.dataset.homeTaskId);
      draggedHomeTaskId = null;
    });
    $('#todayTaskList').addEventListener('dragend', () => {
      draggedHomeTaskId = null;
      $$('.task-card.reorderable', $('#todayTaskList')).forEach((item) => item.classList.remove('dragging', 'drag-over'));
    });
    document.addEventListener('click', (event) => {
      const action = event.target.closest('[data-action]');
      if (!action) return;
      if (['toggle', 'edit', 'batch-select'].includes(action.dataset.action)) handleTaskAction(action);
      if (action.dataset.action === 'must-do') setMustDo(action.dataset.id);
      if (action.dataset.action === 'focus-timer') toggleFocusTimer(action.dataset.id);
      if (action.dataset.action === 'focus-reset') resetFocusTimer();
      if (action.dataset.action === 'focus-fold') { openFocusSection = openFocusSection === action.dataset.section ? '' : action.dataset.section; renderToday(); }
      if (action.dataset.action === 'show-all') { showAllTasks = true; renderToday(); }
      if (action.dataset.action === 'task-order-up') moveTaskInArea(action.dataset.id, -1);
      if (action.dataset.action === 'task-order-down') moveTaskInArea(action.dataset.id, 1);
      if (action.dataset.action === 'toggle-home-links') {
        if (expandedHomeLinks.has(action.dataset.id)) expandedHomeLinks.delete(action.dataset.id);
        else expandedHomeLinks.add(action.dataset.id);
        renderToday();
      }
      if (action.dataset.action === 'toggle-work-task') toggleWorkTask(action.dataset.id);
      if (action.dataset.action === 'open-work-task') {
        const task = state.workTasks.find((item) => item.id === action.dataset.id);
        if (task) openWorkTask(task);
      }
      if (action.dataset.action === 'open-project') { activeWorkflowProjectId = action.dataset.id; renderWorkflow(); }
      if (action.dataset.action === 'edit-project') {
        const project = state.projects.find((item) => item.id === action.dataset.id);
        if (project) openProjectForm(project);
      }
      if (['regenerate', 'delete-recurring'].includes(action.dataset.action)) handleRecurringAction(action);
      if (['inbox-today', 'inbox-delete'].includes(action.dataset.action)) handleInboxAction(action);
      if (['draft-up', 'draft-down', 'draft-delete'].includes(action.dataset.action)) {
        const index = aiDraft.findIndex((item) => item.id === action.dataset.id);
        if (action.dataset.action === 'draft-delete' && index >= 0) { aiDraft.splice(index, 1); renderAiReview(); }
        if (action.dataset.action === 'draft-up') moveAiDraft(action.dataset.id, index - 1);
        if (action.dataset.action === 'draft-down') moveAiDraft(action.dataset.id, index + 1);
      }
      if (action.dataset.action === 'plan-week') {
        const stage = aiDraft.find((item) => item.id === action.dataset.id);
        if (stage && (!stage.planned || confirm(`重新生成“${stage.name}”的每日计划吗？审核通过后会替换这一周已有的 ${stage.dailyTaskCount || 0} 条待办。`))) generateAiWeek(stage);
      }
      if (['daily-up', 'daily-down', 'daily-delete'].includes(action.dataset.action)) {
        const index = aiDailyDraft.findIndex((item) => item.id === action.dataset.id);
        if (action.dataset.action === 'daily-delete' && index >= 0) { aiDailyDraft.splice(index, 1); renderAiDailyReview(); }
        if (action.dataset.action === 'daily-up') moveDailyDraft(action.dataset.id, index - 1);
        if (action.dataset.action === 'daily-down') moveDailyDraft(action.dataset.id, index + 1);
      }
      if (action.dataset.action === 'delete-ai-plan') deleteAiPlan(action.dataset.id);
      if (action.dataset.action === 'continue-ai-plan') continueAiPlan(action.dataset.id);
      if (action.dataset.action === 'read-ai-plan') {
        const plan = (state.aiPlans || []).find((item) => item.id === action.dataset.id);
        if (plan) openAiDocument(plan, state.tasks.filter((task) => task.aiPlanId === plan.id), '#aiPlansSheet');
      }
      if (action.dataset.action === 'remove-rec-draft') {
        recurringDraftItems.splice(Number(action.dataset.index), 1);
        renderRecurringDraft();
      }
    });
    $('#statusChips').addEventListener('click', (event) => {
      const button = event.target.closest('[data-status]');
      if (!button) return;
      recordStatus = button.dataset.status;
      $$('#statusChips button').forEach((item) => item.classList.toggle('active', item === button));
    });
    $('#aiDraftList').addEventListener('input', (event) => {
      const card = event.target.closest('[data-draft-id]');
      const field = event.target.dataset.field;
      const draft = card && aiDraft.find((item) => item.id === card.dataset.draftId);
      if (draft && field) draft[field] = event.target.value;
    });
    $('#aiDraftList').addEventListener('change', (event) => {
      const card = event.target.closest('[data-draft-id]');
      const field = event.target.dataset.field;
      const draft = card && aiDraft.find((item) => item.id === card.dataset.draftId);
      if (draft && field) draft[field] = event.target.value;
    });
    $('#aiDraftList').addEventListener('dragstart', (event) => {
      const card = event.target.closest('[data-draft-id]');
      if (!card) return;
      draggedDraftId = card.dataset.draftId;
      card.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggedDraftId);
    });
    $('#aiDraftList').addEventListener('dragover', (event) => {
      const card = event.target.closest('[data-draft-id]');
      if (!card || card.dataset.draftId === draggedDraftId) return;
      event.preventDefault();
      $$('.ai-draft-card', $('#aiDraftList')).forEach((item) => item.classList.remove('drag-over'));
      card.classList.add('drag-over');
    });
    $('#aiDraftList').addEventListener('drop', (event) => {
      const card = event.target.closest('[data-draft-id]');
      if (!card || !draggedDraftId) return;
      event.preventDefault();
      moveAiDraft(draggedDraftId, aiDraft.findIndex((item) => item.id === card.dataset.draftId));
      draggedDraftId = null;
    });
    $('#aiDraftList').addEventListener('dragend', () => {
      draggedDraftId = null;
      $$('.ai-draft-card', $('#aiDraftList')).forEach((item) => item.classList.remove('dragging', 'drag-over'));
    });
    $('#aiDailyDraftList').addEventListener('input', (event) => {
      const card = event.target.closest('[data-daily-id]');
      const draft = card && aiDailyDraft.find((item) => item.id === card.dataset.dailyId);
      if (draft && event.target.dataset.field) draft[event.target.dataset.field] = event.target.value;
    });
    $('#aiDailyDraftList').addEventListener('change', (event) => {
      const card = event.target.closest('[data-daily-id]');
      const draft = card && aiDailyDraft.find((item) => item.id === card.dataset.dailyId);
      if (!draft || !event.target.dataset.field) return;
      if (event.target.dataset.field === 'date' && (event.target.value < aiDailyMeta.start || event.target.value > aiDailyMeta.end)) return showToast('日期需要在本周范围内');
      draft[event.target.dataset.field] = event.target.value;
    });
    $('#aiDailyDraftList').addEventListener('dragstart', (event) => {
      const card = event.target.closest('[data-daily-id]');
      if (!card) return;
      draggedDailyId = card.dataset.dailyId;
      card.classList.add('dragging');
      event.dataTransfer.setData('text/plain', draggedDailyId);
    });
    $('#aiDailyDraftList').addEventListener('dragover', (event) => { if (event.target.closest('[data-daily-id]')) event.preventDefault(); });
    $('#aiDailyDraftList').addEventListener('drop', (event) => {
      const card = event.target.closest('[data-daily-id]');
      if (!card || !draggedDailyId) return;
      event.preventDefault();
      moveDailyDraft(draggedDailyId, aiDailyDraft.findIndex((item) => item.id === card.dataset.dailyId));
      draggedDailyId = null;
    });
    $('#prevMonth').addEventListener('click', () => { calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1); renderCalendar(); });
    $('#nextMonth').addEventListener('click', () => { calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1); renderCalendar(); });
    $('#calendarGrid').addEventListener('click', (event) => {
      const cell = event.target.closest('[data-date]');
      if (!cell) return;
      selectedDate = cell.dataset.date;
      const date = fromISO(selectedDate);
      if (date.getMonth() !== calendarCursor.getMonth()) calendarCursor = new Date(date.getFullYear(), date.getMonth(), 1);
      renderCalendar();
    });
    $('#addRecurringItemBtn').addEventListener('click', () => addRecurringDraftItem());
    $('#characterOptions').addEventListener('click', (event) => {
      const button = event.target.closest('[data-character]');
      if (!button) return;
      state.settings.character = button.dataset.character;
      saveState(); renderProfile(); showToast('提醒小伙伴已经换好');
    });
    $('#addQuoteBtn').addEventListener('click', () => {
      const quote = $('#quoteInput').value.trim();
      if (!quote) return showToast('先写一句想对自己说的话');
      state.settings.quotes.push(quote);
      $('#quoteInput').value = '';
      saveState(); renderProfile(); showToast('这句话已经收好');
    });
    $('#quoteInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); $('#addQuoteBtn').click(); } });
    $('#quoteList').addEventListener('click', (event) => {
      const button = event.target.closest('[data-quote-index]');
      if (!button || state.settings.quotes.length <= 1) return showToast('至少留下一句给自己吧');
      state.settings.quotes.splice(Number(button.dataset.quoteIndex), 1);
      saveState(); renderProfile();
    });
    $('#showArchiveBtn').addEventListener('click', () => {
      const archived = state.tasks.filter((task) => task.archived);
      alert(archived.length ? `已归档：\n\n${archived.map((task) => `· ${task.name}`).join('\n')}` : '还没有归档的事情。');
    });
    $('#installAppBtn').addEventListener('click', installApp);
    $('#exportBtn').addEventListener('click', () => {
      downloadDataSnapshot(state, `喵汪待办-${todayISO()}.json`);
      showToast('数据备份已导出');
    });
    $('#importBtn').addEventListener('click', () => $('#importFileInput').click());
    $('#importFileInput').addEventListener('change', importDataFile);
    $('#resetBtn').addEventListener('click', () => {
      if (!confirm('恢复示例数据会覆盖当前内容，确定继续吗？')) return;
      state = makeSeed();
      recurringDraftItems = [];
      carryOverdueTasks();
      saveState(); renderAll(); switchPage('today'); showToast('已经恢复到初始示例');
    });
    window.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeOverlays(); });
  }

  carryOverdueTasks();
  $('#desktopDate').textContent = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
  bindEvents();
  registerPwa();
  setRecurringDefaults();
  renderAll();
  switchPage('today');
  startReminderWatcher();
})();
