/* Reflect · store.js
   本地数据层：localStorage 读写、规范化、领域操作。
   主角是「目标」——一个目标就是一次复盘。
   以经典脚本方式挂载到全局 Reflect.store（无 ES module，兼容 file:// 加载）。 */
(function (global) {
  'use strict';

  var R = global.Reflect = global.Reflect || {};

  var KEY = 'reflect.v2';
  var CORRUPT_KEY = 'reflect.v2.corrupted';
  var ACTION_STATUS = ['open', 'verified', 'failed'];

  var state = null;          // 内存态
  var lastError = '';        // 最近一次错误信息

  // ---------- 基础工具 ----------
  function now() { return Date.now(); }

  function uid(prefix) {
    return (prefix || 'id') + '-' + now().toString(36) + '-' +
      Math.random().toString(36).slice(2, 8);
  }

  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }

  function str(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }

  function emptyState() { return { goals: [] }; }

  function safeLS() {
    try { return global.localStorage; } catch (e) { return null; }
  }

  // ---------- 规范化 ----------
  // 验证标准：就是一句话的列表
  function normCriteria(list) {
    if (!isArr(list)) return [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var c = str(list[i]).trim();
      if (c) out.push(c);
    }
    return out;
  }

  function normGoal(g) {
    var goal = (g && typeof g === 'object') ? g : {};
    return {
      description: str(goal.description),
      criteria: normCriteria(goal.criteria)
    };
  }

  function normRecord(g) {
    var gr = (g && typeof g === 'object') ? g : {};
    var rec = {
      id: str(gr.id) || uid('g'),
      goal: normGoal(gr.goal),
      results: [],
      facts: [],
      causes: [],
      actions: [],
      linkedGoalIds: isArr(gr.linkedGoalIds) ? gr.linkedGoalIds.map(str) : [],
      createdAt: Number(gr.createdAt) || now(),
      updatedAt: Number(gr.updatedAt) || now(),
      submittedAt: Number(gr.submittedAt) || 0
    };

    if (isArr(gr.results)) {
      for (var i = 0; i < gr.results.length; i++) {
        var r = gr.results[i] || {};
        var metrics = [];
        if (isArr(r.metrics)) {
          for (var m = 0; m < r.metrics.length; m++) {
            var mm = r.metrics[m] || {};
            var name = str(mm.name).trim();
            if (!name) continue;
            metrics.push({ name: name, value: str(mm.value), target: str(mm.target) });
          }
        }
        rec.results.push({
          id: str(r.id) || uid('r'),
          actual: str(r.actual),
          metrics: metrics,
          gap: str(r.gap),
          createdAt: Number(r.createdAt) || now()
        });
      }
    }

    if (isArr(gr.facts)) {
      for (var f = 0; f < gr.facts.length; f++) {
        var fa = gr.facts[f] || {};
        rec.facts.push({
          id: str(fa.id) || uid('f'),
          content: str(fa.content),
          timelineAt: str(fa.timelineAt),
          createdAt: Number(fa.createdAt) || now()
        });
      }
    }

    if (isArr(gr.causes)) {
      for (var k = 0; k < gr.causes.length; k++) {
        var cs = gr.causes[k] || {};
        var fid = str(cs.factId);
        // 老数据是 factIds 数组：取第一条
        if (!fid && isArr(cs.factIds) && cs.factIds.length) fid = str(cs.factIds[0]);
        // 再兜不住就挂到该目标的第一条事实上，别丢
        if (!fid && rec.facts.length) fid = rec.facts[0].id;
        rec.causes.push({
          id: str(cs.id) || uid('c'),
          text: str(cs.text),
          factId: fid,
          createdAt: Number(cs.createdAt) || now()
        });
      }
    }

    if (isArr(gr.actions)) {
      for (var a = 0; a < gr.actions.length; a++) {
        var ac = gr.actions[a] || {};
        rec.actions.push({
          id: str(ac.id) || uid('a'),
          title: str(ac.title),
          factId: str(ac.factId),
          verifyResult: str(ac.verifyResult),
          status: ACTION_STATUS.indexOf(ac.status) >= 0 ? ac.status : 'open',
          closedAt: ac.closedAt ? Number(ac.closedAt) : null,
          createdAt: Number(ac.createdAt) || now()
        });
      }
    }

    return rec;
  }

  function migrate(raw) {
    var out = emptyState();
    var list = isArr(raw && raw.goals) ? raw.goals : [];
    for (var i = 0; i < list.length; i++) {
      out.goals.push(normRecord(list[i]));
    }
    return out;
  }

  // ---------- 读写 ----------
  function load() {
    var ls = safeLS();
    var raw = null;
    try { raw = ls ? ls.getItem(KEY) : null; } catch (e) { raw = null; }

    if (!raw) { state = emptyState(); return state; }

    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }

    if (!parsed || typeof parsed !== 'object' || !isArr(parsed.goals)) {
      // 数据损坏：保留原始串到备份键，并重置为空态
      try { if (ls) ls.setItem(CORRUPT_KEY, raw); } catch (e2) { /* ignore */ }
      state = emptyState();
      try { if (ls) ls.setItem(KEY, JSON.stringify(state)); } catch (e3) { /* ignore */ }
      return state;
    }

    state = migrate(parsed);
    return state;
  }

  function save(s) {
    if (s) state = s;
    if (!state) state = emptyState();
    var ls = safeLS();
    if (!ls) return state;
    try {
      ls.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      lastError = '本地存储写入失败：' + (e && e.message ? e.message : '未知错误');
    }
    return state;
  }

  function getState() {
    if (!state) load();
    return state;
  }

  function persist(goalId) {
    if (goalId) {
      var g = findGoal(goalId);
      if (g) g.updatedAt = now();
    }
    save(state);
    if (R.ui && typeof R.ui.render === 'function') {
      try { R.ui.render(); } catch (e) { /* 渲染失败不应中断数据写入 */ }
    }
  }

  // ---------- 目标 ----------
  function getGoals() { return getState().goals; }

  function findGoal(id) {
    var list = getState().goals;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function getGoal(id) { return findGoal(id); }

  // 创建目标：描述 + 验证标准
  function createGoal(data) {
    data = data || {};
    var g = normRecord({
      id: uid('g'),
      goal: { description: data.description || '', criteria: data.criteria || [] },
      createdAt: now(),
      updatedAt: now()
    });
    getState().goals.push(g);
    persist(g.id);
    return g;
  }

  // 覆盖目标：没有版本链，改了就是改了
  function updateGoal(id, patch) {
    var g = findGoal(id);
    if (!g) return null;
    patch = patch || {};
    if (patch.description !== undefined) g.goal.description = str(patch.description);
    if (patch.criteria !== undefined) g.goal.criteria = normCriteria(patch.criteria);
    persist(id);
    return g;
  }

  // 提交复盘：给这次复盘打点，之后它算「已提交」
  function submitGoal(id) {
    var g = findGoal(id);
    if (!g) return { ok: false, error: '目标不存在' };
    g.submittedAt = now();
    persist(id);
    return { ok: true, goal: g };
  }

  function deleteGoal(id) {
    var list = getState().goals;
    var removed = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) { removed = list.splice(i, 1)[0]; break; }
    }
    // 清理其它目标对它的关联
    for (var j = 0; j < list.length; j++) {
      var li = list[j].linkedGoalIds;
      var k = li.indexOf(id);
      if (k >= 0) li.splice(k, 1);
    }
    persist();
    return removed;
  }

  // 验证标准校验：至少 1 条
  function validateCriteria(list) {
    var arr = normCriteria(list);
    if (!arr.length) {
      return { ok: false, error: '至少需要 1 条验证标准。' };
    }
    return { ok: true, error: '', criteria: arr };
  }

  // ---------- 结果 ----------
  function addResult(goalId, data) {
    var g = findGoal(goalId);
    if (!g) return null;
    data = data || {};
    var metrics = [];
    if (isArr(data.metrics)) {
      for (var i = 0; i < data.metrics.length; i++) {
        var m = data.metrics[i] || {};
        var name = str(m.name).trim();
        if (!name) continue;
        metrics.push({ name: name, value: str(m.value), target: str(m.target) });
      }
    }
    var r = {
      id: uid('r'),
      actual: str(data.actual),
      metrics: metrics,
      gap: str(data.gap),
      createdAt: now()
    };
    g.results.push(r);
    persist(goalId);
    return r;
  }

  // 多条结果：合并（以指定的一条为准）
  function mergeResults(goalId, resultId) {
    var g = findGoal(goalId);
    if (!g) return { ok: false, error: '目标不存在' };
    var keep = null;
    for (var i = 0; i < g.results.length; i++) {
      if (g.results[i].id === resultId) keep = g.results[i];
    }
    if (!keep) return { ok: false, error: '未找到该条结果' };
    g.results = [keep];
    persist(goalId);
    return { ok: true, result: keep };
  }

  // ---------- 事实 ----------
  function addFact(goalId, data) {
    var g = findGoal(goalId);
    if (!g) return null;
    data = data || {};
    var f = {
      id: uid('f'),
      content: str(data.content),
      timelineAt: str(data.timelineAt),
      createdAt: now()
    };
    g.facts.push(f);
    persist(goalId);
    return f;
  }

  function updateFact(goalId, factId, patch) {
    var g = findGoal(goalId);
    if (!g) return null;
    patch = patch || {};
    for (var i = 0; i < g.facts.length; i++) {
      var f = g.facts[i];
      if (f.id !== factId) continue;
      if (patch.content !== undefined) f.content = str(patch.content);
      if (patch.timelineAt !== undefined) f.timelineAt = str(patch.timelineAt);
      persist(goalId);
      return f;
    }
    return null;
  }

  function removeFact(goalId, factId) {
    var g = findGoal(goalId);
    if (!g) return false;
    for (var i = 0; i < g.facts.length; i++) {
      if (g.facts[i].id === factId) {
        g.facts.splice(i, 1);
        // 挂在它下面的原因和改进一起走，不然就成了没事实的孤儿
        g.causes = g.causes.filter(function (c) { return c.factId !== factId; });
        g.actions = g.actions.filter(function (a) { return a.factId !== factId; });
        persist(goalId);
        return true;
      }
    }
    return false;
  }

  // ---------- 原因 ----------
  function addCause(goalId, data) {
    var g = findGoal(goalId);
    if (!g) return null;
    data = data || {};
    var fid = str(data.factId);
    if (!fid && isArr(data.factIds) && data.factIds.length) fid = str(data.factIds[0]);
    var c = {
      id: uid('c'),
      text: str(data.text),
      factId: fid,
      createdAt: now()
    };
    g.causes.push(c);
    persist(goalId);
    return c;
  }

  function updateCause(goalId, causeId, patch) {
    var g = findGoal(goalId);
    if (!g) return null;
    patch = patch || {};
    for (var i = 0; i < g.causes.length; i++) {
      var c = g.causes[i];
      if (c.id !== causeId) continue;
      if (patch.text !== undefined) c.text = str(patch.text);
      if (patch.factId !== undefined) c.factId = str(patch.factId);
      persist(goalId);
      return c;
    }
    return null;
  }

  function removeCause(goalId, causeId) {
    var g = findGoal(goalId);
    if (!g) return false;
    for (var i = 0; i < g.causes.length; i++) {
      if (g.causes[i].id === causeId) {
        g.causes.splice(i, 1);
        persist(goalId);
        return true;
      }
    }
    return false;
  }

  // ---------- 改进措施 ----------
  // 提交时只需一句话的「改进措施」；验证是可选的，可以在往后的周期里补录。
  function addAction(goalId, data) {
    var g = findGoal(goalId);
    if (!g) return null;
    data = data || {};
    var a = {
      id: uid('a'),
      title: str(data.title),
      factId: str(data.factId),
      verifyResult: '',
      status: 'open',
      closedAt: null,
      createdAt: now()
    };
    g.actions.push(a);
    persist(goalId);
    return a;
  }

  function findAction(actionId) {
    var list = getState().goals;
    for (var i = 0; i < list.length; i++) {
      var acts = list[i].actions;
      for (var j = 0; j < acts.length; j++) {
        if (acts[j].id === actionId) return { goal: list[i], action: acts[j] };
      }
    }
    return null;
  }

  function updateAction(id, patch) {
    var hit = findAction(id);
    if (!hit) return { ok: false, error: '改进项不存在' };
    var a = hit.action;
    patch = patch || {};
    if (patch.title !== undefined) a.title = str(patch.title);
    if (patch.factId !== undefined) a.factId = str(patch.factId);
    if (patch.verifyResult !== undefined) a.verifyResult = str(patch.verifyResult);
    if (patch.status !== undefined) {
      var st = patch.status;
      if (ACTION_STATUS.indexOf(st) < 0) return { ok: false, error: '改进项状态非法' };
      // 闭环（已验证 / 未生效）需要写下验证结论
      if (st === 'verified' || st === 'failed') {
        if (!a.verifyResult.trim()) {
          return { ok: false, error: '请先写下验证结论（实际数据 / 观察结论），再标记闭环。' };
        }
      }
      a.status = st;
      if (st === 'verified' || st === 'failed') a.closedAt = now();
      if (st === 'open') a.closedAt = null;
    }
    persist(hit.goal.id);
    return { ok: true, action: a, goal: hit.goal };
  }

  // 补录验证并闭环改进项。验证结论必填。
  // status 可选，默认 'verified'（已闭环）；'failed' 表示未生效。
  function closeAction(id, verifyResult, status) {
    var hit = findAction(id);
    if (!hit) return { ok: false, error: '改进项不存在' };
    var a = hit.action;
    var target = status === 'failed' ? 'failed' : 'verified';
    var vr = verifyResult === undefined ? a.verifyResult : str(verifyResult);
    if (!vr.trim()) {
      return { ok: false, error: '请写下验证结论（实际数据 / 观察结论），再标记闭环。' };
    }
    a.verifyResult = vr.trim();
    a.status = target;
    a.closedAt = now();
    persist(hit.goal.id);
    return { ok: true, action: a, goal: hit.goal };
  }

  function removeAction(id) {
    var hit = findAction(id);
    if (!hit) return false;
    var acts = hit.goal.actions;
    for (var i = 0; i < acts.length; i++) {
      if (acts[i].id === id) { acts.splice(i, 1); persist(hit.goal.id); return true; }
    }
    return false;
  }

  // ---------- 关联历史目标 ----------
  function linkGoal(goalId, otherId) {
    var g = findGoal(goalId);
    if (!g || goalId === otherId) return { ok: false, error: '无法关联' };
    if (g.linkedGoalIds.indexOf(otherId) < 0) g.linkedGoalIds.push(otherId);
    persist(goalId);
    return { ok: true };
  }

  function unlinkGoal(goalId, otherId) {
    var g = findGoal(goalId);
    if (!g) return { ok: false, error: '目标不存在' };
    var i = g.linkedGoalIds.indexOf(otherId);
    if (i >= 0) g.linkedGoalIds.splice(i, 1);
    persist(goalId);
    return { ok: true };
  }

  // ---------- 导入导出 ----------
  function exportState() {
    return JSON.stringify(getState(), null, 2);
  }

  function importState(json) {
    var parsed = null;
    try { parsed = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) {
      return { ok: false, error: 'JSON 解析失败：' + (e && e.message ? e.message : '格式错误') };
    }
    if (!parsed || typeof parsed !== 'object' || !isArr(parsed.goals)) {
      return { ok: false, error: '数据格式不正确：缺少 goals 数组' };
    }
    state = migrate(parsed);
    persist();
    return { ok: true, goals: state.goals.length };
  }

  // ---------- 示例数据 ----------
  var DEMO_CURRENT = 'demo-current-clip';
  var DEMO_PREV = 'demo-prev-template';

  function seedExample() {
    var existing = findGoal(DEMO_CURRENT);
    if (existing) {
      // 已载入过：不污染已有数据，直接返回
      return { ok: true, goal: existing, created: false };
    }
    var t = now();

    var prev = normRecord({
      id: DEMO_PREV,
      goal: {
        description: '模板要更好用一点',
        criteria: ['模板选择中位耗时 ≤ 30 秒']
      },
      createdAt: t - 86400000 * 30,
      updatedAt: t - 86400000 * 20,
      results: [{
        id: 'demo-prev-result',
        actual: '上线后模板页停留时长上升，新用户大量从模板区跳出。',
        metrics: [{ name: '模板选择中位耗时', value: '52 秒', target: '≤ 30 秒' }],
        gap: '耗时超出目标 22 秒',
        createdAt: t - 86400000 * 28
      }],
      facts: [
        {
          id: 'demo-prev-fact',
          content: '新用户在模板区平均浏览 9 个模板后离开',
          timelineAt: '2026-10-20 11:00',
          createdAt: t - 86400000 * 28
        },
        {
          id: 'demo-prev-fact-2',
          content: '并发导出时素材加载排队，最长等 2 分半',
          timelineAt: '2026-10-20 11:40',
          createdAt: t - 86400000 * 28
        }
      ],
      causes: [
        {
          id: 'demo-prev-cause-1',
          text: '模板入口过多导致新手在选择模板时卡住',
          factId: 'demo-prev-fact',
          createdAt: t - 86400000 * 27
        },
        {
          id: 'demo-prev-cause-2',
          text: '素材加载慢导致导出排队',
          factId: 'demo-prev-fact-2',
          createdAt: t - 86400000 * 27
        }
      ],
      actions: [
        {
          id: 'demo-prev-action-1',
          title: '优化模板入口排序',
          factId: 'demo-prev-fact',
          verifyResult: '',
          status: 'failed',
          closedAt: null,
          createdAt: t - 86400000 * 26
        },
        {
          id: 'demo-prev-action-2',
          title: '导出队列限流',
          factId: 'demo-prev-fact-2',
          verifyResult: '',
          status: 'open',
          closedAt: null,
          createdAt: t - 86400000 * 26
        }
      ],
      linkedGoalIds: []
    });

    var cur = normRecord({
      id: DEMO_CURRENT,
      goal: {
        description: '我要一个很爽的剪辑工具',
        criteria: [
          '5 个用户中 4 个在 10 分钟内完成剪辑并导出',
          '导出失败率低于 5%'
        ]
      },
      createdAt: t - 86400000 * 7,
      updatedAt: t,
      results: [{
        id: 'demo-cur-result',
        actual: '5 人测试中 3 人完成导出，平均耗时 11 分钟，导出失败 2 次。',
        metrics: [
          { name: '完成率', value: '60%', target: '≥ 80%' },
          { name: '导出失败率', value: '12%', target: '< 5%' }
        ],
        gap: '完成率差 20 个百分点；失败率超出 7 个百分点；耗时超出 1 分钟',
        createdAt: t - 86400000 * 2
      }],
      facts: [
        {
          id: 'demo-cur-fact-1',
          content: '用户在模板入口停留超过 40 秒后退出',
          timelineAt: '2026-11-16 14:30',
          createdAt: t - 86400000 * 2
        },
        {
          id: 'demo-cur-fact-2',
          content: '素材加载失败会丢失已编辑的时间线',
          timelineAt: '2026-11-16 15:10',
          createdAt: t - 86400000 * 2
        },
        {
          id: 'demo-cur-fact-3',
          content: '导出流程过长是未达标的主要原因',
          timelineAt: '2026-11-16 16:00',
          createdAt: t - 86400000 * 2
        },
        {
          id: 'demo-cur-fact-4',
          content: '用户表达「剪辑起来很爽」，但不知道从哪一步开始',
          timelineAt: '2026-11-16 16:20',
          createdAt: t - 86400000 * 2
        }
      ],
      causes: [
        {
          id: 'demo-cur-cause-1',
          text: '模板入口过多导致新手在选择模板时卡住',
          factId: 'demo-cur-fact-1',
          createdAt: t - 86400000 * 1
        },
        {
          id: 'demo-cur-cause-2',
          text: '素材加载慢导致导出排队',
          factId: 'demo-cur-fact-2',
          createdAt: t - 86400000 * 1
        },
        {
          id: 'demo-cur-cause-3',
          text: '缺少预设模板，用户不知道从哪一步开始',
          factId: 'demo-cur-fact-4',
          createdAt: t - 86400000 * 1
        }
      ],
      actions: [
        {
          id: 'demo-cur-action-1',
          title: '优化模板入口，默认推荐一个模板',
          factId: 'demo-cur-fact-1',
          verifyResult: '',
          status: 'open',
          closedAt: null,
          createdAt: t - 86400000 * 1
        },
        {
          id: 'demo-cur-action-2',
          title: '导出流程增加断点保存',
          factId: 'demo-cur-fact-2',
          verifyResult: '',
          status: 'open',
          closedAt: null,
          createdAt: t - 86400000 * 1
        }
      ],
      linkedGoalIds: [DEMO_PREV]
    });

    getState().goals.push(prev);
    getState().goals.push(cur);
    persist();
    return { ok: true, goal: cur, created: true };
  }

  // ---------- 对外接口 ----------
  R.store = {
    // 目标
    getGoals: getGoals,
    getGoal: getGoal,
    createGoal: createGoal,
    updateGoal: updateGoal,
    submitGoal: submitGoal,
    deleteGoal: deleteGoal,
    validateCriteria: validateCriteria,
    // 结果
    addResult: addResult,
    mergeResults: mergeResults,
    // 事实
    addFact: addFact,
    updateFact: updateFact,
    removeFact: removeFact,
    // 原因
    addCause: addCause,
    updateCause: updateCause,
    removeCause: removeCause,
    // 改进措施
    addAction: addAction,
    updateAction: updateAction,
    closeAction: closeAction,
    removeAction: removeAction,
    // 关联
    linkGoal: linkGoal,
    unlinkGoal: unlinkGoal,
    // 状态
    getState: getState,
    load: load,
    save: save,
    persist: persist,
    exportState: exportState,
    importState: importState,
    seedExample: seedExample,
    lastError: function () { return lastError; }
  };
})(window);
