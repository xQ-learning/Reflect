/* Reflect · store.js
   本地数据层：localStorage 读写、迁移、领域操作。
   以经典脚本方式挂载到全局 Reflect.store（无 ES module，兼容 file:// 加载）。 */
(function (global) {
  'use strict';

  var R = global.Reflect = global.Reflect || {};

  var KEY = 'reflect.v1';
  var CORRUPT_KEY = 'reflect.v1.corrupted';
  var CAUSE_LAYERS = ['目标翻译', '执行', '资源', '外部', '其他'];
  var CONFIDENCE = ['low', 'medium', 'high'];
  var FACT_STATUS = ['pending', 'verified', 'disputed'];
  var ACTION_STATUS = ['open', 'doing', 'verified', 'failed'];

  var state = null;          // 内存态
  var lastError = '';        // 最近一次错误信息

  // ---------- 基础工具 ----------
  function now() { return Date.now(); }

  function uid(prefix) {
    return (prefix || 'id') + '-' + now().toString(36) + '-' +
      Math.random().toString(36).slice(2, 8);
  }

  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }

  function str(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }

  function emptyState() { return { projects: [] }; }

  function safeLS() {
    try { return global.localStorage; } catch (e) { return null; }
  }

  // ---------- 迁移 / 规范化 ----------
  function normCriteria(list) {
    if (!isArr(list)) return [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i] || {};
      var text = str(c.text).trim();
      if (!text) continue;                    // 空口径直接丢弃
      out.push({ text: text, metric: str(c.metric).trim(), threshold: str(c.threshold).trim() });
    }
    return out;
  }

  function normGoal(g) {
    var goal = (g && typeof g === 'object') ? g : {};
    var versions = isArr(goal.versions) ? goal.versions : [];
    var vs = [];
    for (var i = 0; i < versions.length; i++) {
      var v = versions[i] || {};
      vs.push({
        version: Number(v.version) || (i + 1),
        originalWish: str(v.originalWish),
        basis: str(v.basis),
        scenarioHypothesis: str(v.scenarioHypothesis),
        verificationCriteria: normCriteria(v.verificationCriteria),
        adjustmentRule: str(v.adjustmentRule),
        note: str(v.note),
        revisedFrom: (v.revisedFrom === null || v.revisedFrom === undefined) ? null : Number(v.revisedFrom),
        createdAt: Number(v.createdAt) || now()
      });
    }
    var cur = Number(goal.currentVersion);
    if (!cur || !vs.length) cur = vs.length ? vs[vs.length - 1].version : 0;
    // 若 currentVersion 指向不存在的版本，回退到最大版本号
    var has = false;
    for (var j = 0; j < vs.length; j++) { if (vs[j].version === cur) { has = true; break; } }
    if (!has) cur = vs.length ? vs[vs.length - 1].version : 0;
    return { versions: vs, currentVersion: cur };
  }

  function normProject(p) {
    var pr = (p && typeof p === 'object') ? p : {};
    var proj = {
      id: str(pr.id) || uid('p'),
      title: str(pr.title) || '未命名复盘',
      template: pr.template === 'standard' ? 'standard' : 'light',
      status: ['draft', 'running', 'archived'].indexOf(pr.status) >= 0 ? pr.status : 'draft',
      participants: isArr(pr.participants) ? pr.participants.map(str).filter(Boolean) : [],
      createdAt: Number(pr.createdAt) || now(),
      updatedAt: Number(pr.updatedAt) || now(),
      goal: normGoal(pr.goal),
      results: [],
      facts: [],
      causes: [],
      actions: [],
      linkedProjectIds: isArr(pr.linkedProjectIds) ? pr.linkedProjectIds.map(str) : []
    };

    if (isArr(pr.results)) {
      for (var i = 0; i < pr.results.length; i++) {
        var r = pr.results[i] || {};
        var metrics = [];
        if (isArr(r.metrics)) {
          for (var m = 0; m < r.metrics.length; m++) {
            var mm = r.metrics[m] || {};
            metrics.push({ name: str(mm.name), value: str(mm.value), target: str(mm.target) });
          }
        }
        proj.results.push({
          id: str(r.id) || uid('r'),
          actual: str(r.actual),
          metrics: metrics,
          gap: str(r.gap),
          author: str(r.author),
          createdAt: Number(r.createdAt) || now()
        });
      }
    }

    if (isArr(pr.facts)) {
      for (var f = 0; f < pr.facts.length; f++) {
        var fa = pr.facts[f] || {};
        var contributors = [];
        if (isArr(fa.contributors)) {
          for (var c = 0; c < fa.contributors.length; c++) {
            var ct = fa.contributors[c] || {};
            contributors.push({
              author: str(ct.author),
              content: str(ct.content),
              evidence: str(ct.evidence),
              createdAt: Number(ct.createdAt) || now()
            });
          }
        }
        proj.facts.push({
          id: str(fa.id) || uid('f'),
          kind: ['fact', 'judgment', 'emotion'].indexOf(fa.kind) >= 0 ? fa.kind : 'fact',
          content: str(fa.content),
          timelineAt: str(fa.timelineAt),
          source: str(fa.source),
          evidence: str(fa.evidence),
          confidence: CONFIDENCE.indexOf(fa.confidence) >= 0 ? fa.confidence : 'medium',
          status: FACT_STATUS.indexOf(fa.status) >= 0 ? fa.status : 'pending',
          author: str(fa.author),
          mergedInto: fa.mergedInto ? str(fa.mergedInto) : null,
          contributors: contributors,
          createdAt: Number(fa.createdAt) || now()
        });
      }
    }

    if (isArr(pr.causes)) {
      for (var k = 0; k < pr.causes.length; k++) {
        var cs = pr.causes[k] || {};
        proj.causes.push({
          id: str(cs.id) || uid('c'),
          layer: CAUSE_LAYERS.indexOf(cs.layer) >= 0 ? cs.layer : '其他',
          text: str(cs.text),
          factIds: isArr(cs.factIds) ? cs.factIds.map(str) : [],
          createdAt: Number(cs.createdAt) || now()
        });
      }
    }

    if (isArr(pr.actions)) {
      for (var a = 0; a < pr.actions.length; a++) {
        var ac = pr.actions[a] || {};
        proj.actions.push({
          id: str(ac.id) || uid('a'),
          causeId: ac.causeId ? str(ac.causeId) : null,
          title: str(ac.title),
          owner: str(ac.owner),
          due: str(ac.due),
          verifyMetric: str(ac.verifyMetric),
          verifyResult: str(ac.verifyResult),
          status: ACTION_STATUS.indexOf(ac.status) >= 0 ? ac.status : 'open',
          closedAt: ac.closedAt ? Number(ac.closedAt) : null,
          createdAt: Number(ac.createdAt) || now()
        });
      }
    }

    return proj;
  }

  function migrate(raw) {
    var out = emptyState();
    var list = isArr(raw && raw.projects) ? raw.projects : [];
    for (var i = 0; i < list.length; i++) {
      var p = normProject(list[i]);
      if (!p.id) p.id = uid('p');
      out.projects.push(p);
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

    if (!parsed || typeof parsed !== 'object' || !isArr(parsed.projects)) {
      // 数据损坏：保留原始串到 reflect.v1.corrupted，并重置为空态
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

  function persist(projectId) {
    if (projectId) {
      var p = findProject(projectId);
      if (p) p.updatedAt = now();
    }
    save(state);
    if (R.ui && typeof R.ui.render === 'function') {
      try { R.ui.render(); } catch (e) { /* 渲染失败不应中断数据写入 */ }
    }
  }

  // ---------- 项目 ----------
  function getProjects() { return getState().projects; }

  function findProject(id) {
    var list = getState().projects;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function getProject(id) { return findProject(id); }

  function createProject(data) {
    data = data || {};
    var p = normProject({
      id: uid('p'),
      title: data.title || '未命名复盘',
      template: data.template || 'light',
      status: data.status || 'draft',
      participants: isArr(data.participants)
        ? data.participants
        : (data.participants ? String(data.participants).split(/[,，、;；\s]+/) : []),
      createdAt: now(),
      updatedAt: now(),
      linkedProjectIds: data.linkedProjectIds || []
    });
    getState().projects.push(p);
    persist(p.id);
    return p;
  }

  function updateProject(id, patch) {
    var p = findProject(id);
    if (!p) return null;
    patch = patch || {};
    if (patch.title !== undefined) p.title = str(patch.title);
    if (patch.template !== undefined) p.template = patch.template === 'standard' ? 'standard' : 'light';
    if (patch.status !== undefined && ['draft', 'running', 'archived'].indexOf(patch.status) >= 0) p.status = patch.status;
    if (patch.participants !== undefined) {
      p.participants = isArr(patch.participants)
        ? patch.participants.map(str).filter(Boolean)
        : String(patch.participants).split(/[,，、;；\s]+/).filter(Boolean);
    }
    if (patch.goal && typeof patch.goal === 'object') {
      // 允许改 currentVersion 等元信息，但不丢版本链
      if (patch.goal.currentVersion !== undefined) {
        var cv = Number(patch.goal.currentVersion);
        var ok = false;
        for (var i = 0; i < p.goal.versions.length; i++) {
          if (p.goal.versions[i].version === cv) { ok = true; break; }
        }
        if (ok) p.goal.currentVersion = cv;
      }
    }
    persist(id);
    return p;
  }

  function deleteProject(id) {
    var list = getState().projects;
    var removed = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) { removed = list.splice(i, 1)[0]; break; }
    }
    // 清理其它项目对它的关联
    for (var j = 0; j < list.length; j++) {
      var li = list[j].linkedProjectIds;
      var k = li.indexOf(id);
      if (k >= 0) li.splice(k, 1);
    }
    persist();
    return removed;
  }

  // ---------- 目标 / 版本链 ----------
  function addGoalVersion(projectId, payload) {
    var p = findProject(projectId);
    if (!p) return null;
    payload = payload || {};
    var versions = p.goal.versions;
    var maxV = 0;
    for (var i = 0; i < versions.length; i++) {
      if (versions[i].version > maxV) maxV = versions[i].version;
    }
    var version = maxV + 1;
    var revisedFrom = payload.revisedFrom;
    if (revisedFrom === undefined || revisedFrom === null) {
      revisedFrom = versions.length ? p.goal.currentVersion : null;
    }
    var v = {
      version: version,
      originalWish: str(payload.originalWish),
      basis: str(payload.basis),
      scenarioHypothesis: str(payload.scenarioHypothesis),
      verificationCriteria: normCriteria(payload.verificationCriteria),
      adjustmentRule: str(payload.adjustmentRule),
      note: str(payload.note),
      revisedFrom: revisedFrom === null ? null : Number(revisedFrom),
      createdAt: now()
    };
    versions.push(v);
    p.goal.currentVersion = version;
    persist(projectId);
    return v;
  }

  function getGoalVersions(projectId) {
    var p = findProject(projectId);
    return p ? p.goal.versions : [];
  }

  function getCurrentGoal(projectId) {
    var p = findProject(projectId);
    if (!p || !p.goal.versions.length) return null;
    for (var i = 0; i < p.goal.versions.length; i++) {
      if (p.goal.versions[i].version === p.goal.currentVersion) return p.goal.versions[i];
    }
    return p.goal.versions[p.goal.versions.length - 1];
  }

  // 验证标准校验：至少 1 条，且每条 text 非空
  function validateCriteria(list) {
    var arr = isArr(list) ? list.filter(function (c) { return c && str(c.text).trim(); }) : [];
    if (!arr.length) {
      return { ok: false, error: '至少需要 1 条验证标准，且每条标准都要写清判定口径。' };
    }
    var withThreshold = 0;
    for (var i = 0; i < arr.length; i++) {
      if (str(arr[i].metric).trim() || str(arr[i].threshold).trim()) withThreshold++;
    }
    if (!withThreshold) {
      return { ok: false, error: '验证标准必须带可测量的指标与阈值（如「完成率 ≥ 80%」）。' };
    }
    return { ok: true, error: '', criteria: arr };
  }

  // ---------- 结果 ----------
  function addResult(projectId, data) {
    var p = findProject(projectId);
    if (!p) return null;
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
      author: str(data.author),
      createdAt: now()
    };
    p.results.push(r);
    persist(projectId);
    return r;
  }

  // 多条独立提交的结果：合并（以指定的一条为准）
  function mergeResults(projectId, resultId) {
    var p = findProject(projectId);
    if (!p) return { ok: false, error: '项目不存在' };
    var keep = null;
    for (var i = 0; i < p.results.length; i++) {
      if (p.results[i].id === resultId) keep = p.results[i];
    }
    if (!keep) return { ok: false, error: '未找到该提交' };
    p.results = [keep];
    persist(projectId);
    return { ok: true, result: keep };
  }

  // ---------- 事实 ----------
  function addFact(projectId, data) {
    var p = findProject(projectId);
    if (!p) return null;
    data = data || {};
    var f = {
      id: uid('f'),
      kind: ['fact', 'judgment', 'emotion'].indexOf(data.kind) >= 0 ? data.kind : 'fact',
      content: str(data.content),
      timelineAt: str(data.timelineAt),
      source: str(data.source),
      evidence: str(data.evidence),
      confidence: CONFIDENCE.indexOf(data.confidence) >= 0 ? data.confidence : 'medium',
      status: FACT_STATUS.indexOf(data.status) >= 0 ? data.status : 'pending',
      author: str(data.author),
      mergedInto: null,
      contributors: [],
      createdAt: now()
    };
    p.facts.push(f);
    persist(projectId);
    return f;
  }

  function updateFact(projectId, factId, patch) {
    var p = findProject(projectId);
    if (!p) return null;
    patch = patch || {};
    for (var i = 0; i < p.facts.length; i++) {
      var f = p.facts[i];
      if (f.id !== factId) continue;
      if (patch.kind !== undefined && ['fact', 'judgment', 'emotion'].indexOf(patch.kind) >= 0) f.kind = patch.kind;
      if (patch.content !== undefined) f.content = str(patch.content);
      if (patch.timelineAt !== undefined) f.timelineAt = str(patch.timelineAt);
      if (patch.source !== undefined) f.source = str(patch.source);
      if (patch.evidence !== undefined) f.evidence = str(patch.evidence);
      if (patch.confidence !== undefined && CONFIDENCE.indexOf(patch.confidence) >= 0) f.confidence = patch.confidence;
      if (patch.status !== undefined && FACT_STATUS.indexOf(patch.status) >= 0) f.status = patch.status;
      if (patch.author !== undefined) f.author = str(patch.author);
      persist(projectId);
      return f;
    }
    return null;
  }

  // 合并独立提交的事实：把被合并条目的内容转入主线事实的 contributors
  function mergeFacts(projectId, factIds, mainId) {
    var p = findProject(projectId);
    if (!p) return { ok: false, error: '项目不存在' };
    if (!mainId) return { ok: false, error: '请选择主线事实' };
    var ids = isArr(factIds) ? factIds.slice() : [];
    var main = null;
    for (var i = 0; i < p.facts.length; i++) {
      if (p.facts[i].id === mainId) main = p.facts[i];
    }
    if (!main) return { ok: false, error: '主线事实不存在' };
    if (!main.contributors) main.contributors = [];

    var merged = 0;
    for (var j = 0; j < p.facts.length; j++) {
      var f = p.facts[j];
      if (f.id === mainId) continue;
      if (ids.indexOf(f.id) < 0) continue;
      main.contributors.push({
        author: f.author || f.source,
        content: f.content,
        evidence: f.evidence,
        createdAt: f.createdAt
      });
      f.mergedInto = mainId;   // 界面上不再单独显示
      merged++;
    }
    if (!merged) return { ok: false, error: '请至少选择一条需要合并的事实' };
    persist(projectId);
    return { ok: true, mainId: mainId, merged: merged };
  }

  // ---------- 原因 ----------
  function addCause(projectId, data) {
    var p = findProject(projectId);
    if (!p) return null;
    data = data || {};
    var c = {
      id: uid('c'),
      layer: CAUSE_LAYERS.indexOf(data.layer) >= 0 ? data.layer : '其他',
      text: str(data.text),
      factIds: isArr(data.factIds) ? data.factIds.map(str) : [],
      createdAt: now()
    };
    p.causes.push(c);
    persist(projectId);
    return c;
  }

  function updateCause(projectId, causeId, patch) {
    var p = findProject(projectId);
    if (!p) return null;
    patch = patch || {};
    for (var i = 0; i < p.causes.length; i++) {
      var c = p.causes[i];
      if (c.id !== causeId) continue;
      if (patch.layer !== undefined && CAUSE_LAYERS.indexOf(patch.layer) >= 0) c.layer = patch.layer;
      if (patch.text !== undefined) c.text = str(patch.text);
      if (patch.factIds !== undefined) {
        c.factIds = isArr(patch.factIds) ? patch.factIds.map(str) : [];
      }
      persist(projectId);
      return c;
    }
    return null;
  }

  function removeCause(projectId, causeId) {
    var p = findProject(projectId);
    if (!p) return false;
    for (var i = 0; i < p.causes.length; i++) {
      if (p.causes[i].id === causeId) {
        p.causes.splice(i, 1);
        persist(projectId);
        return true;
      }
    }
    return false;
  }

  // ---------- 改进项 ----------
  function addAction(projectId, data) {
    var p = findProject(projectId);
    if (!p) return null;
    data = data || {};
    var a = {
      id: uid('a'),
      causeId: data.causeId ? str(data.causeId) : null,
      title: str(data.title),
      owner: str(data.owner),
      due: str(data.due),
      verifyMetric: str(data.verifyMetric),
      verifyResult: '',
      status: 'open',
      closedAt: null,
      createdAt: now()
    };
    p.actions.push(a);
    persist(projectId);
    return a;
  }

  function findAction(actionId) {
    var list = getState().projects;
    for (var i = 0; i < list.length; i++) {
      var acts = list[i].actions;
      for (var j = 0; j < acts.length; j++) {
        if (acts[j].id === actionId) return { project: list[i], action: acts[j] };
      }
    }
    return null;
  }

  function updateAction(id, patch) {
    var hit = findAction(id);
    if (!hit) return { ok: false, error: '改进项不存在' };
    var a = hit.action;
    patch = patch || {};
    if (patch.causeId !== undefined) a.causeId = patch.causeId ? str(patch.causeId) : null;
    if (patch.title !== undefined) a.title = str(patch.title);
    if (patch.owner !== undefined) a.owner = str(patch.owner);
    if (patch.due !== undefined) a.due = str(patch.due);
    if (patch.verifyMetric !== undefined) a.verifyMetric = str(patch.verifyMetric);
    if (patch.verifyResult !== undefined) a.verifyResult = str(patch.verifyResult);
    if (patch.status !== undefined) {
      var st = patch.status;
      if (ACTION_STATUS.indexOf(st) < 0) return { ok: false, error: '改进项状态非法' };
      // 硬性约束：终态（已验证 / 未生效）必须先有验证指标与验证结果（验收 C）
      if (st === 'verified' || st === 'failed') {
        if (!a.verifyMetric.trim()) {
          return { ok: false, error: '缺少验证指标，不能关闭改进项。请先填写「如何证明改进生效」。' };
        }
        if (!a.verifyResult.trim()) {
          return { ok: false, error: '未填写验证结果，不能关闭改进项。改进项必须验证后才能关闭。' };
        }
      }
      a.status = st;
      if (st === 'verified' || st === 'failed') a.closedAt = now();
      if (st === 'open' || st === 'doing') a.closedAt = null;
    }
    persist(hit.project.id);
    return { ok: true, action: a, project: hit.project };
  }

  // 关闭改进：必须有验证指标 + 验证结果（验收 C 的硬约束）
  // status 可选，默认 'verified'（已验证关闭）；'failed' 表示未生效。
  function closeAction(id, verifyResult, status) {
    var hit = findAction(id);
    if (!hit) return { ok: false, error: '改进项不存在' };
    var a = hit.action;
    var target = status === 'failed' ? 'failed' : 'verified';
    if (!a.verifyMetric.trim()) {
      return { ok: false, error: '关闭前必须填写验证指标（如何证明改进生效）。' };
    }
    var vr = verifyResult === undefined ? a.verifyResult : str(verifyResult);
    if (!vr.trim()) {
      return { ok: false, error: '关闭前必须填写验证结果（实际数据 / 观察结论）。' };
    }
    a.verifyResult = vr.trim();
    a.status = target;
    a.closedAt = now();
    persist(hit.project.id);
    return { ok: true, action: a, project: hit.project };
  }

  function removeAction(id) {
    var hit = findAction(id);
    if (!hit) return false;
    var acts = hit.project.actions;
    for (var i = 0; i < acts.length; i++) {
      if (acts[i].id === id) { acts.splice(i, 1); persist(hit.project.id); return true; }
    }
    return false;
  }

  // ---------- 关联复盘 ----------
  function linkProject(projectId, otherId) {
    var p = findProject(projectId);
    if (!p || projectId === otherId) return { ok: false, error: '无法关联' };
    if (p.linkedProjectIds.indexOf(otherId) < 0) p.linkedProjectIds.push(otherId);
    persist(projectId);
    return { ok: true };
  }

  function unlinkProject(projectId, otherId) {
    var p = findProject(projectId);
    if (!p) return { ok: false, error: '项目不存在' };
    var i = p.linkedProjectIds.indexOf(otherId);
    if (i >= 0) p.linkedProjectIds.splice(i, 1);
    persist(projectId);
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
    if (!parsed || typeof parsed !== 'object' || !isArr(parsed.projects)) {
      return { ok: false, error: '数据格式不正确：缺少 projects 数组' };
    }
    state = migrate(parsed);
    persist();
    return { ok: true, projects: state.projects.length };
  }

  // ---------- 示例数据 ----------
  var DEMO_CURRENT = 'demo-current-clip';
  var DEMO_PREV = 'demo-prev-template';

  function seedExample() {
    var existing = findProject(DEMO_CURRENT);
    if (existing) {
      // 已载入过：不污染已有数据，直接返回
      return { ok: true, project: existing, created: false };
    }
    var t = now();
    var fTemplate = 'demo-fact-template-block';
    var fTemplate2 = 'demo-fact-template-block-2';

    var prev = normProject({
      id: DEMO_PREV,
      title: '【示例】剪辑模板 v1 上线复盘',
      template: 'standard',
      status: 'archived',
      participants: ['张三', '李四'],
      createdAt: t - 86400000 * 30,
      updatedAt: t - 86400000 * 20,
      goal: {
        versions: [{
          version: 1,
          originalWish: '模板要更好用一点',
          basis: '客服工单里反复提到不会选模板',
          scenarioHypothesis: '新手 5 分钟内选到合适的模板',
          verificationCriteria: [
            { text: '模板选择中位耗时 ≤ 30 秒', metric: '耗时', threshold: '≤ 30 秒' }
          ],
          adjustmentRule: '若耗时 > 60 秒则暂停推广，先做入口收敛',
          note: '首次版本',
          revisedFrom: null,
          createdAt: t - 86400000 * 30
        }],
        currentVersion: 1
      },
      results: [{
        id: 'demo-prev-result',
        actual: '上线后模板页停留时长上升，新用户大量从模板区跳出。',
        metrics: [{ name: '模板选择中位耗时', value: '52 秒', target: '≤ 30 秒' }],
        gap: '耗时超出目标 22 秒',
        author: '李四',
        createdAt: t - 86400000 * 28
      }],
      facts: [{
        id: 'demo-prev-fact',
        kind: 'fact',
        content: '新用户在模板区平均浏览 9 个模板后离开',
        timelineAt: '2026-10-20 11:00',
        source: '埋点数据',
        evidence: '埋点看板 v1.2',
        confidence: 'high',
        status: 'verified',
        author: '李四',
        mergedInto: null,
        contributors: [],
        createdAt: t - 86400000 * 28
      }],
      causes: [
        {
          id: 'demo-prev-cause-1',
          layer: '执行',
          text: '模板入口过多导致新手在选择模板时卡住',
          factIds: ['demo-prev-fact'],
          createdAt: t - 86400000 * 27
        },
        {
          id: 'demo-prev-cause-2',
          layer: '资源',
          text: '素材加载慢导致导出排队',
          factIds: [],
          createdAt: t - 86400000 * 27
        }
      ],
      actions: [
        {
          id: 'demo-prev-action-1',
          causeId: 'demo-prev-cause-1',
          title: '优化模板入口排序',
          owner: '张三',
          due: '2026-10-30',
          verifyMetric: '模板选择中位耗时 ≤ 30 秒',
          verifyResult: '',
          status: 'failed',
          closedAt: null,
          createdAt: t - 86400000 * 26
        },
        {
          id: 'demo-prev-action-2',
          causeId: 'demo-prev-cause-2',
          title: '导出队列限流',
          owner: '李四',
          due: '2026-11-05',
          verifyMetric: '导出排队时间 ≤ 5 秒',
          verifyResult: '',
          status: 'open',
          closedAt: null,
          createdAt: t - 86400000 * 26
        }
      ],
      linkedProjectIds: []
    });

    var cur = normProject({
      id: DEMO_CURRENT,
      title: '【示例】剪辑工具「很爽」目标复盘',
      template: 'standard',
      status: 'running',
      participants: ['张三', '李四', '王五'],
      createdAt: t - 86400000 * 7,
      updatedAt: t,
      goal: {
        versions: [
          {
            version: 1,
            originalWish: '我要一个很爽的剪辑工具',
            basis: '用户访谈里多人提到「剪辑起来很爽」，但没人说得清爽在哪',
            scenarioHypothesis: '新手在 10 分钟内产出一个可用的短视频',
            verificationCriteria: [
              { text: '5 个用户中 4 个在 10 分钟内完成剪辑并导出', metric: '完成率', threshold: '完成率 ≥ 80%' },
              { text: '导出失败率低于 5%', metric: '错误率', threshold: '失败率 < 5%' }
            ],
            adjustmentRule: '若完成率 < 60% 或导出失败率 > 10%，则修正目标为「新手 15 分钟内出片」并重新验证',
            note: '初始版本：先把模糊愿望翻译成可检验标准',
            revisedFrom: null,
            createdAt: t - 86400000 * 7
          },
          {
            version: 2,
            originalWish: '我要一个很爽的剪辑工具',
            basis: '首轮测试暴露出口径缺口：只测了完成率，没测导出稳定性',
            scenarioHypothesis: '新手在 15 分钟内产出一个可用的短视频',
            verificationCriteria: [
              { text: '5 个用户中至少 3 个在 15 分钟内完成剪辑并导出', metric: '完成率', threshold: '完成率 ≥ 60%' },
              { text: '导出失败率低于 10%', metric: '错误率', threshold: '失败率 < 10%' }
            ],
            adjustmentRule: '若完成率 < 60% 或导出失败率 > 10%，则继续修正目标并缩小场景',
            note: '修正：目标翻译不完整（漏测失败率），时间口径从 10 分钟放宽到 15 分钟',
            revisedFrom: 1,
            createdAt: t - 86400000 * 3
          }
        ],
        currentVersion: 2
      },
      results: [{
        id: 'demo-cur-result',
        actual: '5 人测试中 3 人完成剪辑导出，完成率 60%；导出失败率 12%，主要卡在模板入口与素材加载。',
        metrics: [
          { name: '完成率', value: '60%（3/5）', target: '≥ 80%' },
          { name: '导出失败率', value: '12%', target: '< 5%' },
          { name: '平均耗时', value: '13 分钟', target: '≤ 10 分钟' }
        ],
        gap: '完成率差 20 个百分点；失败率超出 7 个百分点；耗时超出 3 分钟',
        author: '产品负责人',
        createdAt: t - 86400000 * 2
      }],
      facts: [
        {
          id: fTemplate,
          kind: 'fact',
          content: '用户在模板入口停留超过 40 秒后退出',
          timelineAt: '2026-11-16 14:30',
          source: '李四（用户测试观察）',
          evidence: '录屏 R-03',
          confidence: 'high',
          status: 'verified',
          author: '李四',
          mergedInto: null,
          contributors: [{
            author: '赵六',
            content: '新用户首次进入被 24 个模板的数量劝退，直接返回首页',
            evidence: '录屏 R-05',
            createdAt: t - 86400000 * 2
          }],
          createdAt: t - 86400000 * 2
        },
        {
          id: fTemplate2,
          kind: 'fact',
          content: '新用户首次进入被 24 个模板的数量劝退，直接返回首页',
          timelineAt: '2026-11-16 14:32',
          source: '赵六（用户测试观察）',
          evidence: '录屏 R-05',
          confidence: 'medium',
          status: 'verified',
          author: '赵六',
          mergedInto: fTemplate,
          contributors: [],
          createdAt: t - 86400000 * 2
        },
        {
          id: 'demo-cur-fact-3',
          kind: 'fact',
          content: '素材加载失败会丢失已编辑的时间线',
          timelineAt: '2026-11-16 15:10',
          source: '王五（客服工单）',
          evidence: '工单 #2211',
          confidence: 'medium',
          status: 'verified',
          author: '王五',
          mergedInto: null,
          contributors: [],
          createdAt: t - 86400000 * 2
        },
        {
          id: 'demo-cur-fact-4',
          kind: 'judgment',
          content: '导出流程过长是未达标的主要原因',
          timelineAt: '2026-11-16 16:00',
          source: '产品内部讨论',
          evidence: '会议纪要 11-16',
          confidence: 'medium',
          status: 'disputed',
          author: '王五',
          mergedInto: null,
          contributors: [],
          createdAt: t - 86400000 * 2
        },
        {
          id: 'demo-cur-fact-5',
          kind: 'emotion',
          content: '用户表达「剪辑起来很爽」，但不知道从哪一步开始',
          timelineAt: '2026-11-16 16:20',
          source: '用户访谈',
          evidence: '访谈录音片段',
          confidence: 'medium',
          status: 'pending',
          author: '王五',
          mergedInto: null,
          contributors: [],
          createdAt: t - 86400000 * 2
        }
      ],
      causes: [
        {
          id: 'demo-cur-cause-1',
          layer: '目标翻译',
          text: '目标把「很爽」直接当验收标准，没有定义新手可完成的最小路径',
          factIds: ['demo-cur-fact-4', 'demo-cur-fact-5'],
          createdAt: t - 86400000 * 2
        },
        {
          id: 'demo-cur-cause-2',
          layer: '执行',
          text: '模板入口过多导致新手在选择模板时卡住',
          factIds: [fTemplate, fTemplate2],
          createdAt: t - 86400000 * 2
        },
        {
          id: 'demo-cur-cause-3',
          layer: '资源',
          text: '缺少可复用的默认工程模板与预置素材',
          factIds: [],
          createdAt: t - 86400000 * 2
        }
      ],
      actions: [
        {
          id: 'demo-cur-action-1',
          causeId: 'demo-cur-cause-2',
          title: '优化模板入口，默认推荐一个模板',
          owner: '张三',
          due: '2026-12-01',
          verifyMetric: '模板入口到首次成功导出的中位耗时 ≤ 30 秒',
          verifyResult: '',
          status: 'doing',
          closedAt: null,
          createdAt: t - 86400000 * 2
        },
        {
          id: 'demo-cur-action-2',
          causeId: 'demo-cur-cause-3',
          title: '导出流程增加断点保存',
          owner: '李四',
          due: '2026-12-05',
          verifyMetric: '导出失败率 < 5%',
          verifyResult: '',
          status: 'open',
          closedAt: null,
          createdAt: t - 86400000 * 2
        },
        {
          id: 'demo-cur-action-3',
          causeId: 'demo-cur-cause-1',
          title: '补齐目标翻译模板（愿望 → 指标）',
          owner: '王五',
          due: '2026-11-25',
          verifyMetric: '下次复盘目标 100% 含可测量阈值',
          verifyResult: '11-18 检查：近 3 次复盘目标均含阈值与口径',
          status: 'verified',
          closedAt: t - 86400000,
          createdAt: t - 86400000 * 3
        }
      ],
      linkedProjectIds: [DEMO_PREV]
    });

    getState().projects.push(prev);
    getState().projects.push(cur);
    persist();
    return { ok: true, project: cur, created: true };
  }

  // ---------- 导出 API ----------
  R.store = {
    KEY: KEY,
    CORRUPT_KEY: CORRUPT_KEY,
    CAUSE_LAYERS: CAUSE_LAYERS,
    load: load,
    save: save,
    getState: getState,
    getProjects: getProjects,
    getProject: getProject,
    createProject: createProject,
    updateProject: updateProject,
    deleteProject: deleteProject,
    addGoalVersion: addGoalVersion,
    getCurrentGoal: getCurrentGoal,
    getGoalVersions: getGoalVersions,
    validateCriteria: validateCriteria,
    addResult: addResult,
    mergeResults: mergeResults,
    addFact: addFact,
    updateFact: updateFact,
    mergeFacts: mergeFacts,
    addCause: addCause,
    updateCause: updateCause,
    removeCause: removeCause,
    addAction: addAction,
    updateAction: updateAction,
    closeAction: closeAction,
    removeAction: removeAction,
    linkProject: linkProject,
    unlinkProject: unlinkProject,
    seedExample: seedExample,
    exportState: exportState,
    importState: importState,
    getLastError: function () { return lastError; },
    _uid: uid,
    _clone: clone
  };
})(window);
