/* Reflect · wizard.js
   愿望 → 验证标准 引导向导（多步弹层）。
   关键约束：向导必须产出至少 1 条带指标/阈值的验证标准才能写入目标。 */
(function (global) {
  'use strict';

  var R = global.Reflect = global.Reflect || {};

  // 模糊词表：命中即标记"待翻译"
  var VAGUE_WORDS = ['爽', '快', '好用', '漂亮', '舒服', '高效', '牛逼', '完美', '厉害',
    '更好', '更强', '智能', '顺畅', '爽一点', '更方便', '顺手', '酷', '美', '高级'];

  // 场景候选（谁 / 在什么场景下 / 做什么）
  var SCENARIOS = [
    { id: 'newbie-video', label: '新手 10 分钟出片', who: '新手', where: '第一次剪视频', task: '产出一个可用的短视频' },
    { id: 'newbie-basic', label: '新手完成基础操作', who: '新手', where: '第一次使用', task: '完成一次核心操作' },
    { id: 'daily-quick', label: '日常快速记录', who: '普通用户', where: '日常随手记录', task: '在碎片时间里完成一次记录' },
    { id: 'pro-batch', label: '高频批量处理', who: '专业用户', where: '批量处理场景', task: '稳定完成一批任务' },
    { id: 'team-collab', label: '团队协作评审', who: '团队成员', where: '多人协作评审', task: '完成一次协作交付' },
    { id: 'custom', label: '自定义场景', who: '', where: '', task: '' }
  ];

  // 指标类型 → 阈值候选
  var METRIC_TYPES = [
    {
      id: 'completion', label: '完成率',
      thresholds: [
        '5 人测试中 ≥4 人在 {t} 分钟内完成',
        '7 人测试中 ≥5 人在 {t} 分钟内完成',
        '首周新用户任务完成率 ≥ 60%'
      ],
      metric: '完成率', t: 10
    },
    {
      id: 'duration', label: '耗时',
      thresholds: [
        '首次成功完成 ≤ {t} 分钟',
        'P90 完成耗时 ≤ {t} 分钟',
        '从打开到出结果的中位耗时 ≤ {t} 秒'
      ],
      metric: '耗时', t: 10
    },
    {
      id: 'error', label: '错误率',
      thresholds: [
        '导出失败率 < {t}%',
        '关键流程报错率 < {t}%',
        '重复提交导致的脏数据率 < {t}%'
      ],
      metric: '错误率', t: 5
    },
    {
      id: 'satisfaction', label: '满意度',
      thresholds: [
        '5 人中 ≥4 人主观评价"愿意再用一次"',
        '满意度评分 ≥ {t}/5',
        'NPS ≥ {t}'
      ],
      metric: '满意度', t: 4
    },
    {
      id: 'retention', label: '留存',
      thresholds: [
        '次日留存 ≥ {t}%',
        '7 日回访率 ≥ {t}%',
        '首周再次使用 ≥ {t}%'
      ],
      metric: '留存', t: 30
    },
    {
      id: 'count', label: '数量',
      thresholds: [
        '单次至少产出 {t} 个可用结果',
        '一个工作流覆盖 ≥ {t} 个场景',
        '模板库内置 ≥ {t} 个可直接使用的起点'
      ],
      metric: '数量', t: 1
    }
  ];

  var state = null;      // 向导运行时状态
  var root = null;       // 弹层根节点

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // 模糊度检测：返回命中的模糊词
  function detectVague(text) {
    var hits = [];
    var t = String(text || '');
    for (var i = 0; i < VAGUE_WORDS.length; i++) {
      if (t.indexOf(VAGUE_WORDS[i]) >= 0 && hits.indexOf(VAGUE_WORDS[i]) < 0) {
        hits.push(VAGUE_WORDS[i]);
      }
    }
    return hits;
  }

  function metricById(id) {
    for (var i = 0; i < METRIC_TYPES.length; i++) {
      if (METRIC_TYPES[i].id === id) return METRIC_TYPES[i];
    }
    return null;
  }

  // 按场景 + 指标类型生成验证标准候选
  function suggestCriteria(scenarioId, metricTypeId) {
    var sc = null;
    for (var i = 0; i < SCENARIOS.length; i++) {
      if (SCENARIOS[i].id === scenarioId) sc = SCENARIOS[i];
    }
    var mt = metricById(metricTypeId);
    if (!mt) return [];
    var out = [];
    for (var t = 0; t < mt.thresholds.length; t++) {
      var text = mt.thresholds[t].replace('{t}', mt.t);
      if (sc && sc.who) {
        // 场景与指标结合成完整口径
        text = sc.who + '在「' + sc.where + '」场景下：' + text;
      }
      out.push({
        text: text,
        metric: mt.metric,
        threshold: mt.thresholds[t].replace('{t}', mt.t)
      });
    }
    return out;
  }

  // 场景假设草稿
  function scenarioDraft(sc) {
    if (!sc) return '';
    if (sc.id === 'custom') return sc.who && sc.where ? (sc.who + '在' + sc.where + '完成' + sc.task) : '';
    return sc.who + '在' + sc.where + '能够' + sc.task;
  }

  function ensureRoot() {
    var host = document.getElementById('modal-root');
    if (!host) {
      host = document.createElement('div');
      host.id = 'modal-root';
      document.body.appendChild(host);
    }
    root = host;
    return root;
  }

  function close() {
    ensureRoot().innerHTML = '';
    state = null;
    root = null;
  }

  // ---- 各步渲染 ----
  function renderStep1() {
    var vague = detectVague(state.wish);
    var h = '';
    h += '<div class="modal-sub">步骤 1 / 4　先写下你最初的愿望。模糊的愿望需要被翻译成可检验的标准。</div>';
    h += '<div class="steps"><i class="st on"></i><i class="st"></i><i class="st"></i><i class="st"></i></div>';
    h += '<label class="field"><span>原始愿望</span>' +
      '<textarea id="w-wish" placeholder="例：我要一个很爽的剪辑工具">' + esc(state.wish) + '</textarea></label>';
    h += '<div class="row between small"><span class="muted">模糊度检测</span><span>' +
      (vague.length
        ? '<span class="badge alert">待翻译：命中「' + esc(vague.join('、')) + '」</span>'
        : '<span class="badge verified">未命中常见模糊词</span>') +
      '</span></div>';
    if (vague.length) {
      h += '<div class="alert-box" style="margin-top:10px">这个愿望里的「' + esc(vague.join('、')) +
        '」无法直接检验。下一两步会把它翻译成「谁在什么场景下」+「可测量阈值」。</div>';
    }
    h += '<div class="modal-foot">' +
      '<button class="btn ghost" data-act="wiz-cancel">取消</button>' +
      '<button class="btn primary" data-act="wiz-next">下一步：选择场景</button>' +
      '</div>';
    return h;
  }

  function renderStep2() {
    var h = '';
    h += '<div class="modal-sub">步骤 2 / 4　谁在什么场景下使用？把愿望落到具体的人和场景上。</div>';
    h += '<div class="steps"><i class="st done"></i><i class="st on"></i><i class="st"></i><i class="st"></i></div>';
    h += '<div class="opts" id="w-scenarios">';
    for (var i = 0; i < SCENARIOS.length; i++) {
      var sc = SCENARIOS[i];
      h += '<button class="opt' + (state.scenarioId === sc.id ? ' on' : '') +
        '" data-act="wiz-scenario" data-id="' + sc.id + '">' + esc(sc.label) + '</button>';
    }
    h += '</div>';
    h += '<label class="field" style="margin-top:12px"><span>使用者（谁）</span>' +
      '<input type="text" id="w-who" value="' + esc(state.who) + '" placeholder="例：新手 / 剪辑师"></label>';
    h += '<label class="field"><span>场景（在什么情况下）</span>' +
      '<input type="text" id="w-where" value="' + esc(state.where) + '" placeholder="例：第一次剪视频"></label>';
    h += '<label class="field"><span>要完成的任务</span>' +
      '<input type="text" id="w-task" value="' + esc(state.task) + '" placeholder="例：产出一个可用的短视频"></label>';
    h += '<label class="field"><span>场景假设草稿（可修改）</span>' +
      '<textarea id="w-scenario-h" placeholder="例：新手在 10 分钟内产出一个可用的短视频">' + esc(state.scenarioHypothesis) + '</textarea></label>';
    h += '<label class="field"><span>依据（为什么这么认为）</span>' +
      '<textarea id="w-basis" placeholder="例：3 位用户访谈都提到导出这一步最卡">' + esc(state.basis) + '</textarea></label>';
    h += '<div class="modal-foot">' +
      '<button class="btn ghost" data-act="wiz-back">上一步</button>' +
      '<button class="btn primary" data-act="wiz-next">下一步：选择验证标准</button>' +
      '</div>';
    return h;
  }

  function renderStep3() {
    var h = '';
    h += '<div class="modal-sub">步骤 3 / 4　选择指标类型，系统给出阈值候选。<b>至少确认或改写 1 条</b>才能继续。</div>';
    h += '<div class="steps"><i class="st done"></i><i class="st done"></i><i class="st on"></i><i class="st"></i></div>';
    h += '<div class="opts" id="w-metrics">';
    for (var i = 0; i < METRIC_TYPES.length; i++) {
      var mt = METRIC_TYPES[i];
      h += '<button class="opt' + (state.metricTypeId === mt.id ? ' on' : '') +
        '" data-act="wiz-metric" data-id="' + mt.id + '">' + esc(mt.label) + '</button>';
    }
    h += '</div>';

    if (!state.criteria.length) {
      h += '<div class="alert-box" style="margin-top:12px">先选一个指标类型，系统会给出带阈值的候选口径；你也可以直接手写一条。</div>';
    }

    h += '<div id="w-criteria" style="margin-top:12px">';
    for (var c = 0; c < state.criteria.length; c++) {
      var cr = state.criteria[c];
      h += '<div class="crit" data-cid="' + esc(cr.id) + '">';
      h += '<div class="c-head">' +
        '<input type="checkbox" class="sel-box" data-act="wiz-toggle" data-id="' + esc(cr.id) + '"' +
        (cr.confirmed ? ' checked' : '') + '>' +
        '<span class="grow">' + (cr.confirmed ? '<span class="badge verified">已确认</span>' : '<span class="badge pending">待确认</span>') +
        ' <span class="muted small">' + esc(cr.metric || '自定义') + '</span></span>' +
        '<button class="btn sm ghost" data-act="wiz-del-crit" data-id="' + esc(cr.id) + '">删除</button>' +
        '</div>';
      h += '<label class="field"><span>验证标准（口径）</span>' +
        '<input type="text" data-act="wiz-crit-text" data-id="' + esc(cr.id) + '" value="' + esc(cr.text) + '"></label>';
      h += '<div class="inline-2">' +
        '<label class="field"><span>指标</span><input type="text" data-act="wiz-crit-metric" data-id="' + esc(cr.id) + '" value="' + esc(cr.metric) + '"></label>' +
        '<label class="field"><span>阈值</span><input type="text" data-act="wiz-crit-threshold" data-id="' + esc(cr.id) + '" value="' + esc(cr.threshold) + '"></label>' +
        '</div>';
      h += '</div>';
    }
    h += '</div>';
    h += '<button class="btn sm" data-act="wiz-add-crit">+ 手写一条验证标准</button>';

    var okCount = confirmedCount();
    h += '<div class="alert-box' + (okCount ? ' ok' : '') + '" style="margin-top:12px">已确认 <b>' + okCount + '</b> 条有效验证标准' +
      (okCount ? '，可以进入下一步。' : '，<b>至少需要 1 条</b>（且写清判定口径）才能继续。') + '</div>';

    h += '<div class="modal-foot">' +
      '<button class="btn ghost" data-act="wiz-back">上一步</button>' +
      '<button class="btn primary" data-act="wiz-next"' + (okCount ? '' : ' disabled') + '>下一步：汇总预览</button>' +
      '</div>';
    return h;
  }

  function renderStep4() {
    var ok = confirmedCriteria();
    var h = '';
    h += '<div class="modal-sub">步骤 4 / 4　汇总确认。写入后将生成目标版本' +
      (state.projectId ? '（新版本，旧版本保留）' : '') + '。</div>';
    h += '<div class="steps"><i class="st done"></i><i class="st done"></i><i class="st done"></i><i class="st on"></i></div>';

    h += '<div class="item"><div class="item-t">原始愿望</div><div class="kv">' + esc(state.wish || '（未填写）') + '</div></div>';
    h += '<div class="item"><div class="item-t">依据</div><div class="kv">' + esc(state.basis || '（未填写）') + '</div></div>';
    h += '<div class="item"><div class="item-t">场景假设</div><div class="kv">' + esc(state.scenarioHypothesis || '（未填写）') + '</div></div>';
    h += '<div class="item"><div class="item-t">验证标准（' + ok.length + ' 条）</div>';
    for (var i = 0; i < ok.length; i++) {
      h += '<div class="kv">· ' + esc(ok[i].text) +
        (ok[i].metric ? '　指标：' + esc(ok[i].metric) : '') +
        (ok[i].threshold ? '　阈值：' + esc(ok[i].threshold) : '') + '</div>';
    }
    h += '</div>';
    h += '<label class="field"><span>调整规则（满足什么条件就修正目标）</span>' +
      '<textarea id="w-adjust" placeholder="例：若 5 人测试中完成率 < 60%，则把目标修正为「新手 15 分钟内出片」">' +
      esc(state.adjustmentRule) + '</textarea></label>';
    h += '<label class="field"><span>本次修订说明</span>' +
      '<input type="text" id="w-note" value="' + esc(state.note) + '" placeholder="例：把模糊愿望翻译为可检验标准"></label>';
    h += '<div class="modal-foot">' +
      '<button class="btn ghost" data-act="wiz-back">上一步</button>' +
      '<button class="btn primary" data-act="wiz-submit">写入目标</button>' +
      '</div>';
    return h;
  }

  function confirmedCount() {
    return confirmedCriteria().length;
  }

  // 有效确认的验证标准：已勾选 + 文本非空
  function confirmedCriteria() {
    var out = [];
    for (var i = 0; i < state.criteria.length; i++) {
      var c = state.criteria[i];
      if (c.confirmed && String(c.text || '').trim()) out.push(c);
    }
    return out;
  }

  function paint() {
    ensureRoot();
    var html = '';
    if (state.step === 1) html = renderStep1();
    else if (state.step === 2) html = renderStep2();
    else if (state.step === 3) html = renderStep3();
    else html = renderStep4();
    root.innerHTML = '<div class="modal-mask" data-act="wiz-mask"><div class="modal">' + html + '</div></div>';
  }

  function next() {
    if (state.step === 1) {
      state.wish = val('#w-wish');
      if (!state.wish.trim()) { R.ui.toast('请先写下原始愿望', 'err'); return; }
      state.step = 2; paint(); return;
    }
    if (state.step === 2) {
      state.who = val('#w-who');
      state.where = val('#w-where');
      state.task = val('#w-task');
      state.scenarioHypothesis = val('#w-scenario-h');
      state.basis = val('#w-basis');
      if (!state.scenarioHypothesis.trim()) {
        // 没有草稿就用场景模板兜底
        for (var i = 0; i < SCENARIOS.length; i++) {
          if (SCENARIOS[i].id === state.scenarioId) state.scenarioHypothesis = scenarioDraft(SCENARIOS[i]);
        }
      }
      if (!state.scenarioHypothesis.trim()) {
        R.ui.toast('请填写场景假设，或选择一个场景模板', 'err'); return;
      }
      state.step = 3; paint(); return;
    }
    if (state.step === 3) {
      var ok = confirmedCriteria();
      if (!ok.length) {
        R.ui.toast('至少需要确认 1 条验证标准（含判定口径）', 'err'); return;
      }
      state.step = 4; paint(); return;
    }
  }

  function back() {
    if (state.step > 1) { state.step--; paint(); }
  }

  function val(sel) {
    var el = document.querySelector(sel);
    return el ? el.value : '';
  }

  function findCrit(id) {
    for (var i = 0; i < state.criteria.length; i++) {
      if (state.criteria[i].id === id) return state.criteria[i];
    }
    return null;
  }

  function onClick(e) {
    var t = e.target;
    if (!t) return;
    var directAct = t.getAttribute ? t.getAttribute('data-act') : null;
    var actEl = directAct;
    if (!actEl && t.closest) {
      var actHost = t.closest('[data-act]');
      actEl = actHost ? actHost.getAttribute('data-act') : null;
    }
    if (!actEl) return;
    if (!state) return;
    var id = t.getAttribute ? t.getAttribute('data-id') : null;
    if (!id && t.closest) {
      var host = t.closest('[data-id]');
      if (host) id = host.getAttribute('data-id');
    }

    // 只有点击遮罩本身才关闭，点击弹层内部不应关闭
    if (actEl === 'wiz-mask' && directAct === 'wiz-mask') { close(); return; }
    if (actEl === 'wiz-cancel') { close(); return; }
    if (actEl === 'wiz-next') { next(); return; }
    if (actEl === 'wiz-back') { back(); return; }

    if (actEl === 'wiz-scenario') {
      state.scenarioId = id;
      for (var i = 0; i < SCENARIOS.length; i++) {
        if (SCENARIOS[i].id === id) {
          var sc = SCENARIOS[i];
          if (sc.id !== 'custom') {
            state.who = sc.who; state.where = sc.where; state.task = sc.task;
            state.scenarioHypothesis = scenarioDraft(sc);
          }
        }
      }
      paint(); return;
    }

    if (actEl === 'wiz-metric') {
      state.metricTypeId = id;
      var sugg = suggestCriteria(state.scenarioId, id);
      // 已存在同源候选则不重复添加
      for (var s = 0; s < sugg.length; s++) {
        var exists = false;
        for (var c = 0; c < state.criteria.length; c++) {
          if (state.criteria[c].text === sugg[s].text) { exists = true; break; }
        }
        if (!exists) {
          sugg[s].id = 'c' + (state.criteria.length + 1) + '_' + Math.random().toString(36).slice(2, 6);
          sugg[s].confirmed = false;
          state.criteria.push(sugg[s]);
        }
      }
      paint(); return;
    }

    if (actEl === 'wiz-add-crit') {
      state.criteria.push({
        id: 'c' + (state.criteria.length + 1) + '_' + Math.random().toString(36).slice(2, 6),
        text: '', metric: '', threshold: '', confirmed: false
      });
      paint(); return;
    }

    if (actEl === 'wiz-del-crit') {
      for (var d = 0; d < state.criteria.length; d++) {
        if (state.criteria[d].id === id) { state.criteria.splice(d, 1); break; }
      }
      paint(); return;
    }

    if (actEl === 'wiz-submit') { submit(); return; }
  }

  function onChange(e) {
    if (!state) return;
    var t = e.target;
    var act = t.getAttribute ? t.getAttribute('data-act') : null;
    if (!act && t.closest) {
      var h = t.closest('[data-act]');
      if (h) act = h.getAttribute('data-act');
    }
    if (act === 'wiz-toggle') {
      var id = t.getAttribute('data-id');
      var cr = findCrit(id);
      if (!cr) return;
      // 先从 DOM 同步该条标准的最新文本，保证校验基于用户实际填写的内容
      var live = root && root.querySelector
        ? root.querySelector('[data-act="wiz-crit-text"][data-id="' + id + '"]')
        : null;
      if (live) cr.text = live.value;
      cr.confirmed = !!t.checked;
      if (cr.confirmed && !String(cr.text || '').trim()) {
        R.ui.toast('这条标准的口径还是空的，请先写清判定口径', 'err');
        t.checked = false;
        cr.confirmed = false;
      }
      paint(); return;
    }
    if (act === 'wiz-crit-text' || act === 'wiz-crit-metric' || act === 'wiz-crit-threshold') {
      var cid = t.getAttribute('data-id');
      var c2 = findCrit(cid);
      if (!c2) return;
      if (act === 'wiz-crit-text') c2.text = t.value;
      else if (act === 'wiz-crit-metric') c2.metric = t.value;
      else c2.threshold = t.value;
      if (act === 'wiz-crit-text' && c2.confirmed && !String(c2.text || '').trim()) {
        c2.confirmed = false;
      }
      return;
    }
  }

  // 写入目标：最后一道强制校验
  function submit() {
    state.adjustmentRule = val('#w-adjust');
    state.note = val('#w-note');

    var list = confirmedCriteria();
    // ---- 强制校验点 1：至少 1 条有效验证标准 ----
    if (!list.length) {
      R.ui.toast('至少需要 1 条有效验证标准才能写入目标', 'err');
      state.step = 3; paint();
      return;
    }
    // ---- 强制校验点 2：每条 text 非空 ----
    for (var i = 0; i < list.length; i++) {
      if (!String(list[i].text || '').trim()) {
        R.ui.toast('验证标准的口径不能为空', 'err');
        state.step = 3; paint();
        return;
      }
    }
    // ---- 强制校验点 3：至少一条带指标/阈值（口径可检验）----
    var payloadCriteria = [];
    for (var j = 0; j < list.length; j++) {
      payloadCriteria.push({
        text: String(list[j].text).trim(),
        metric: String(list[j].metric || '').trim(),
        threshold: String(list[j].threshold || '').trim()
      });
    }
    var check = R.store.validateCriteria(payloadCriteria);
    if (!check.ok) {
      R.ui.toast(check.error, 'err');
      state.step = 3; paint();
      return;
    }

    var pid = state.projectId;
    if (!pid) {
      var proj = R.store.createProject({
        title: state.wish.slice(0, 30) || '新建复盘',
        template: state.template || 'light',
        status: 'draft'
      });
      pid = proj.id;
    }

    R.store.addGoalVersion(pid, {
      originalWish: state.wish,
      basis: state.basis,
      scenarioHypothesis: state.scenarioHypothesis,
      verificationCriteria: payloadCriteria,
      adjustmentRule: state.adjustmentRule,
      note: state.note || (state.isRevision ? '生成修订版本' : '由向导翻译愿望为验证标准')
    });

    close();
    if (state.onDone) {
      try { state.onDone({ projectId: pid, criteria: payloadCriteria }); } catch (e) { /* ignore */ }
    }
    if (R.ui && R.ui.render) R.ui.render();
  }

  // 入口
  function open(projectId, opts) {
    opts = opts || {};
    ensureRoot();
    var existing = null;
    if (projectId) existing = R.store.getProject(projectId);

    state = {
      step: 1,
      projectId: existing ? projectId : null,
      template: existing ? existing.template : 'light',
      isRevision: !!opts.isRevision,
      onDone: opts.onDone || null,
      wish: '',
      basis: '',
      who: '',
      where: '',
      task: '',
      scenarioId: '',
      scenarioHypothesis: '',
      metricTypeId: '',
      criteria: [],
      adjustmentRule: '',
      note: ''
    };

    // 修订场景：带入当前版本内容
    if (existing && opts.isRevision) {
      var cur = R.store.getCurrentGoal(projectId);
      if (cur) {
        state.wish = cur.originalWish || '';
        state.basis = cur.basis || '';
        state.scenarioHypothesis = cur.scenarioHypothesis || '';
        state.adjustmentRule = cur.adjustmentRule || '';
        state.who = '';
        state.where = '';
        state.task = '';
        state.criteria = cur.verificationCriteria.map(function (c, i) {
          return {
            id: 'r' + i + '_' + Math.random().toString(36).slice(2, 6),
            text: c.text || '', metric: c.metric || '', threshold: c.threshold || '',
            confirmed: !!c.text
          };
        });
        if (state.criteria.length) state.metricTypeId = '';
      }
      state.step = 2;
      state.note = state.note || '修订目标版本';
    }

    paint();

    if (!root._bound) {
      root._bound = true;
      root.addEventListener('click', onClick);
      root.addEventListener('change', onChange);
      root.addEventListener('input', onInput);
    }
    return state;
  }

  // input 事件：实时回写到状态（不重绘，避免打断输入）
  function onInput(e) {
    if (!state) return;
    var t = e.target;
    var act = t.getAttribute ? t.getAttribute('data-act') : null;
    if (!act && t.closest) {
      var h = t.closest('[data-act]');
      if (h) act = h.getAttribute('data-act');
    }
    if (!act) return;
    if (act === 'wiz-crit-text' || act === 'wiz-crit-metric' || act === 'wiz-crit-threshold') {
      var cid = t.getAttribute('data-id');
      var c2 = findCrit(cid);
      if (!c2) return;
      if (act === 'wiz-crit-text') c2.text = t.value;
      else if (act === 'wiz-crit-metric') c2.metric = t.value;
      else c2.threshold = t.value;
    }
  }

  R.wizard = {
    open: open,
    close: close,
    detectVague: detectVague,
    suggestCriteria: suggestCriteria,
    scenarioDraft: scenarioDraft,
    VAGUE_WORDS: VAGUE_WORDS,
    METRIC_TYPES: METRIC_TYPES,
    SCENARIOS: SCENARIOS
  };
})(window);
