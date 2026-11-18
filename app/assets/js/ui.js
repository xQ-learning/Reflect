/* Reflect · ui.js
   三页结构：
     目标   —— 过往目标的阅读索引，点进去能补录
     复盘   —— 核心工作台，纵向四块：目标 / 结果 / 事实 / 原因与改进
     统计   —— 总体信息 + 两个目标之间的对比 */
(function (global) {
  'use strict';

  var R = global.Reflect = global.Reflect || {};
  var store = R.store;
  var compare = R.compare;
  var exporter = R.export;

  // 底栏图标：目标=靶心，复盘=时钟倒转，统计=雷达（线性描边，不填充）
  var TABS = [
    {
      key: 'goals', label: '目标',
      icon: '<circle cx="12" cy="12" r="8.4"></circle>' +
            '<circle cx="12" cy="12" r="3.6"></circle>'
    },
    {
      key: 'review', label: '复盘',
      icon: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>' +
            '<path d="M3 3v5h5"></path>' +
            '<path d="M12 8.2v4.2l2.9 1.7"></path>'
    },
    {
      key: 'stats', label: '统计',
      icon: '<circle cx="12" cy="12" r="8.4"></circle>' +
            '<path d="M12 12V4.3A7.7 7.7 0 0 1 19.7 12"></path>' +
            '<path d="M12 12l5.8-5.8"></path>' +
            '<circle cx="15.7" cy="9.2" r="1.1"></circle>'
    }
  ];

  // 复盘页的四块
  var BLOCKS = ['目标', '结果', '事实', '原因与改进'];

  var route = { view: 'goals', id: null };

  var lastMarkdown = '';
  var lastSummary = '';
  var lastFileName = 'Reflect-复盘报告.md';

  // 对比：统计页选中的两个目标
  var cmpA = '';
  var cmpB = '';
  var cmpResult = null;

  // 目标表单草稿：编辑过程中保存在内存里，避免重绘丢内容
  var goalForm = { description: '', criteria: [] };
  var goalFormId = null;         // 草稿所属目标 id
  var editingGoal = false;       // 是否处于「修改目标」状态
  var editCauseFact = null;      // 正在修改「原因」的事实 id
  var editActionFact = null;     // 正在修改「改进」的事实 id
  var expandGoal = false;        // 目标块是否展开编辑
  var expandResult = false;      // 结果块是否展开编辑
  var pendingMood = 'bad';       // 新事实的情绪：翻车 / 爽点 / 平平
  var pendingFactText = '';      // 事实输入框的草稿
  var resultDraft = { actual: '', gap: '' };   // 结果表单的草稿

  // ---------- 工具 ----------
  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function fmtTime(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function nowLocalInput() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function short(text, n) {
    var s = String(text || '');
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  function byUpdatedDesc(a, b) {
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  }

  // 事实按时间点排
  function byTimeline(a, b) {
    return String(a.timelineAt || '').localeCompare(String(b.timelineAt || ''));
  }

  // ---------- Toast ----------
  function toast(msg, kind) {
    var host = $('toast-root');
    if (!host) return;
    var t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.textContent = msg;
    host.appendChild(t);
    setTimeout(function () {
      if (t.parentNode) t.parentNode.removeChild(t);
    }, 2600);
  }

  // ---------- 轻量 confirm ----------
  function confirmBox(msg, onOk) {
    var host = $('modal-root');
    if (!host) return;
    host.innerHTML =
      '<div class="modal-mask"><div class="modal" style="max-width:420px">' +
      '<h3>确认</h3><div class="modal-sub">' + esc(msg) + '</div>' +
      '<div class="modal-foot">' +
      '<button class="btn ghost" data-act="cf-no">取消</button>' +
      '<button class="btn primary" data-act="cf-yes">确定</button>' +
      '</div></div></div>';
    host.__onYes = onOk;
  }

  // 长按目标卡片弹出的删除菜单（不做二次确认）
  function openGoalMenu(id) {
    var host = $('modal-root');
    if (!host) return;
    var g = store.getGoal(id);
    var dname = g ? short(g.goal.description || '未填目标', 16) : '';
    host.innerHTML =
      '<div class="modal-mask"><div class="modal" style="max-width:420px">' +
      '<h3>删除《' + esc(dname) + '》？</h3>' +
      '<div class="modal-sub">它的结果、事实、原因和改进都会一起删掉，撤不回来。</div>' +
      '<div class="modal-foot">' +
      '<button class="btn ghost" data-act="cl-cancel">取消</button>' +
      '<button class="btn danger" data-act="delete-goal-now" data-id="' + esc(id) + '">删除目标</button>' +
      '</div></div></div>';
  }

  function closeModal() {
    var host = $('modal-root');
    if (host) { host.innerHTML = ''; host.__onYes = null; }
  }

  // ---------- 原生桥 ----------
  function hasBridge() {
    return typeof global.AndroidBridge !== 'undefined' && global.AndroidBridge !== null;
  }

  function bridgeToast(msg) {
    try {
      if (hasBridge() && typeof global.AndroidBridge.toast === 'function') {
        global.AndroidBridge.toast(String(msg));
      }
    } catch (e) { /* 忽略 */ }
  }

  function notify(msg, kind) {
    toast(msg, kind);
    bridgeToast(msg);
  }

  function copyText(text) {
    if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
      try {
        global.navigator.clipboard.writeText(text);
        return true;
      } catch (e) { /* fallthrough */ }
    }
    // 老 WebView 降级：临时 textarea + execCommand
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  function saveFile(filename, content) {
    if (hasBridge() && typeof global.AndroidBridge.saveFile === 'function') {
      var res = null;
      try {
        res = global.AndroidBridge.saveFile(filename, content);
      } catch (e) {
        notify('保存失败：' + (e && e.message ? e.message : '调用异常'), 'err');
        return;
      }
      var obj = null;
      try {
        obj = typeof res === 'string' ? JSON.parse(res) : res;
      } catch (e) { obj = null; }
      if (obj && obj.ok) {
        notify('已保存到 ' + (obj.path || '下载/Reflect'), 'ok');
      } else {
        notify('保存失败：' + ((obj && obj.error) || '未知错误'), 'err');
      }
      return;
    }
    // 降级：复制到剪贴板
    if (copyText(content)) {
      notify('当前环境无原生保存功能，已复制 Markdown 到剪贴板', 'ok');
    } else {
      notify('当前环境不支持剪贴板，请手动选择下方文本复制', 'err');
    }
  }

  function shareText(text) {
    if (hasBridge() && typeof global.AndroidBridge.share === 'function') {
      try {
        global.AndroidBridge.share(String(text));
        return;
      } catch (e) {
        notify('分享失败：' + (e && e.message ? e.message : '调用异常'), 'err');
        return;
      }
    }
    if (copyText(text)) {
      notify('当前环境无原生分享功能，已复制到剪贴板', 'ok');
    } else {
      notify('当前环境不支持剪贴板，请手动复制', 'err');
    }
  }

  // ---------- 路由 ----------
  function parseHash() {
    var h = String(global.location.hash || '').replace(/^#\/?/, '');
    var parts = h.split('/').filter(function (x) { return x !== ''; });
    if (parts[0] === 'review' && parts[1]) return { view: 'review', id: parts[1] };
    if (parts[0] === 'view' && parts[1]) return { view: 'view', id: parts[1] };
    if (parts[0] === 'stats') return { view: 'stats', id: null };
    return { view: 'goals', id: null };
  }

  function go(hash) {
    if (global.location.hash === hash) render();
    else global.location.hash = hash;
  }

  // ---------- 顶栏 ----------
  function renderAppbar() {
    var bar = $('appbar');
    if (!bar) return;

    var logo =
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#7f858f" stroke-width="1.7" stroke-linecap="round">' +
      '<circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="4"></circle><circle cx="12" cy="12" r="1"></circle></svg>';

    var title = 'Reflect';
    var sub = '<span class="sub">把差距变成下一次的动作</span>';
    var right = '';
    var left = logo;
    bar.className = 'appbar';

    if (route.view === 'view') {
      title = '【 战报回放 】';
      sub = '';
      bar.className = 'appbar center';
      left = '<button class="bar-back" data-act="back" aria-label="返回">&lt; 返回</button>';
      var vg = store.getGoal(route.id);
      if (vg) {
        right = '<button class="bar-link" data-act="edit-review" data-id="' + esc(vg.id) + '">编辑 &gt;</button>';
      }
    } else if (route.view === 'review') {
      title = '复盘';
      sub = '';
      var g = route.id === 'new' ? null : store.getGoal(route.id);
      right = '<button class="btn sm ghost" data-act="seed">载入示例</button>';
      if (g) {
        right += '<button class="iconbtn" data-act="open-export" aria-label="导出报告">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M12 3v10m0 0l-4-4m4 4l4-4M4 17v4h16v-4"></path></svg></button>';
      }
    } else if (route.view === 'stats') {
      title = '统计';
      sub = '';
    }

    if (route.view !== 'view') bar.className = 'appbar';
    bar.innerHTML = left + '<div class="title">' + title + sub + '</div>' + right;
  }

  // ---------- 底部 Tab ----------
  function renderTabbar() {
    var bar = $('tabbar');
    if (!bar) return;
    // 审阅页要铺满整屏，底部导航栏不显示
    bar.style.display = (route.view === 'view') ? 'none' : 'flex';
    var h = '';
    var activeTab = (route.view === 'view') ? 'goals' : route.view;
    for (var i = 0; i < TABS.length; i++) {
      var t = TABS[i];
      h += '<button class="tab' + (activeTab === t.key ? ' on' : '') + '" data-act="tab" data-tab="' + t.key + '">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
        t.icon + '</svg>' + esc(t.label) + '</button>';
    }
    bar.innerHTML = h;
  }

  // ---------- 目标的完成度 ----------
  function blockStatus(g) {
    return {
      goal: !!(g.goal.description && g.goal.criteria.length),
      result: g.results.length > 0,
      facts: g.facts.length > 0,
      causes: g.causes.length > 0 || g.actions.length > 0
    };
  }

  function doneCount(st) {
    var n = 0;
    if (st.goal) n++;
    if (st.result) n++;
    if (st.facts) n++;
    if (st.causes) n++;
    return n;
  }

  function isClosed(g) {
    return g.actions.length > 0 && g.actions.every(function (a) { return a.status === 'verified'; });
  }

  // 复盘状态：已闭环 / 已提交 / 进行中
  function statusBadge(g) {
    if (isClosed(g)) return ['verified', '已闭环'];
    if (g.submittedAt) return ['running', '已提交'];
    return ['open', '进行中'];
  }

  function openActions(g) {
    return g.actions.filter(function (a) { return a.status !== 'verified'; });
  }

  // ---------- 目标页（过往目标的阅读索引） ----------
  function renderGoals() {
    var goals = store.getGoals().slice().sort(byUpdatedDesc);
    var h = '';

    h += '<div class="card"><h2 style="margin:0">目标集</h2>' +
      '<div class="hint">定过的目标都存在这里。点进去看战报回放，想改点「编辑」。长按目标可以删除。</div>' +
      '</div>';

    if (!goals.length) {
      h += '<div class="empty"><div class="e-t">还没有目标</div>' +
        '<div>去复盘页写下你要的东西，配一条能检验的标准。</div>' +
        '<button class="btn primary" style="margin-top:12px" data-act="tab" data-tab="review">去复盘页</button></div>';
      return h;
    }

    h += '<h1 class="page-title">目标集（' + goals.length + '）</h1>';
    for (var i = 0; i < goals.length; i++) {
      var g = goals[i];
      h += '<div class="proj-card" data-act="view-goal" data-id="' + esc(g.id) + '">' +
        '<div class="row between"><span class="t">💥 ' + esc(short(g.goal.description || '未填目标', 22)) + '</span>' +
        '<span class="badge ' + statusBadge(g)[0] + '">' + statusBadge(g)[1] + '</span></div>' +
        metricsLine(g) +
        gearLine(g) +
        '<div class="meta">' + g.goal.criteria.length + ' 条验证标准 · 更新于 ' + fmtTime(g.updatedAt) + '</div>' +
        '</div>';
    }
    return h;
  }

  // 目标卡片上的核心数据：最新一条结果的指标
  function metricsLine(g) {
    var r = g.results.length ? g.results[g.results.length - 1] : null;
    if (!r) return '<div class="meta">还没有结果</div>';
    var parts = [];
    if (r.metrics) {
      for (var i = 0; i < r.metrics.length; i++) {
        parts.push(esc(r.metrics[i].name) + ' ' + esc(r.metrics[i].value));
      }
    }
    if (!parts.length) parts.push(esc(short(r.actual || '（未填写）', 22)));
    return '<div class="kpi">' + parts.join(' · ') + '</div>';
  }

  // 目标卡片上的掉落感：掉了几件装备，还有几件没验证
  function gearLine(g) {
    var total = g.actions.length;
    var pending = g.actions.filter(function (a) { return a.status !== 'verified'; }).length;
    if (!total) return '<div class="gear muted">还没掉落装备</div>';
    return '<div class="gear">已掉落 ' + total + ' 件装备' +
      (pending ? '<span class="gear-wait">待验证 ' + pending + '</span>' : '<span class="gear-ok">已闭环</span>') +
      '</div>';
  }

  // ---------- 复盘页 ----------
  function blockHead(n, label, done, extra) {
    return '<div class="blk-h"><span class="blk-n">' + n + '</span><h2>' + esc(label) + '</h2>' +
      '<span class="badge ' + (done ? 'verified' : 'open') + '">' + (done ? '已填' : '待填') + '</span>' +
      (extra || '') + '</div>';
  }

  var STEP_ITEMS = [
    { k: 'goal', icon: '🎯', label: '目标' },
    { k: 'result', icon: '📊', label: '结果' },
    { k: 'facts', icon: '📝', label: '事实' },
    { k: 'causes', icon: '🛠️', label: '归因与装备' }
  ];

  function renderSteps(g) {
    var st = blockStatus(g);
    var order = ['goal', 'result', 'facts', 'causes'];
    var cur = order.length;
    for (var i = 0; i < order.length; i++) {
      if (!st[order[i]]) { cur = i; break; }
    }
    var h = '<div class="bstrip">';
    for (var j = 0; j < STEP_ITEMS.length; j++) {
      var it = STEP_ITEMS[j];
      var cls = j < cur ? 'chip done' : (j === cur ? 'chip on' : 'chip');
      h += '<button class="' + cls + '" data-act="goto-sec" data-sec="' + it.k + '">' +
        it.icon + ' ' + (j + 1) + '.' + esc(it.label) + '</button>';
    }
    h += '</div>';
    return h;
  }

  // ① 目标：表单（上下结构：目标描述在上，验证标准在下）
  function renderGoalFormBody(isNew) {
    var h = '';
    h += '<div class="hint">写清你要什么，再定一条能检验的标准。填好就能用。</div>' +
      '<div class="field" style="margin-top:10px"><span>目标</span>' +
      '<textarea id="g-desc" placeholder="例：我要一个很爽的剪辑工具">' + esc(goalForm.description) + '</textarea>' +
      '</div>' +
      '<div class="field"><span>验证标准</span>' +
      '<div id="g-criteria">';
    for (var i = 0; i < goalForm.criteria.length; i++) {
      h += '<div class="crit-row" data-i="' + i + '">' +
        '<input type="text" class="g-crit" data-i="' + i + '" value="' + esc(goalForm.criteria[i]) +
        '" placeholder="例：完成率 ≥ 80%">' +
        '<button class="btn sm ghost" data-act="del-crit" data-i="' + i + '" aria-label="删除">删</button>' +
        '</div>';
    }
    h += '</div>' +
      '<button class="btn sm gold" data-act="add-crit">+ 再加一条</button>' +
      '</div>' +
      '<div class="row end" style="margin-top:12px">' +
      (isNew ? '' : '<button class="btn ghost" data-act="cancel-edit">取消</button>') +
      '<button class="btn primary" data-act="save-goal">' + (isNew ? '创建目标' : '保存') + '</button>' +
      '</div>';
    return h;
  }

  // ① 目标：只读展示
  // ② 结果
  function renderResultBody(goal) {
    var h = '';
    h += '<label class="field"><span>实际结果</span>' +
      '<textarea id="r-actual" data-act="r-actual" placeholder="例：5 人中 3 人完成，导出失败率 12%">' +
      esc(resultDraft.actual) + '</textarea></label>' +
      '<label class="field"><span>目标差距</span>' +
      '<textarea id="r-gap" data-act="r-gap" placeholder="例：完成率差 20 个百分点">' +
      esc(resultDraft.gap) + '</textarea></label>' +
      '<div id="r-metrics"></div>' +
      '<button class="btn sm gold" data-act="add-metric" style="margin-bottom:10px">＋ 添加关键指标</button>' +
      '<button class="btn primary block" data-act="add-result">提交结果</button>';

    if (!goal.results.length) {
      h += '<div class="muted small" style="margin-top:12px">还没有结果。</div>';
      return h;
    }

    // 最新一条搬到「原因与改进」块，这里只留历史提交
    if (goal.results.length > 1) {
      h += '<hr class="sep">';
      h += '<div class="muted small">历史提交（最新一条见下面的「原因与改进」）</div>';
      for (var i = 0; i < goal.results.length - 1; i++) {
        var r = goal.results[i];
        h += '<div class="item">' +
          '<div class="row between"><span class="item-t">历史提交</span>' +
          '<span class="muted small">' + fmtTime(r.createdAt) + '</span></div>' +
          '<div class="kv" style="white-space:pre-wrap">' + esc(r.actual || '（未填写）') + '</div>';
        if (r.metrics && r.metrics.length) {
          h += '<table class="tbl" style="margin-top:8px"><tr><th>指标</th><th>实际</th><th>目标</th></tr>';
          for (var m = 0; m < r.metrics.length; m++) {
            h += '<tr><td>' + esc(r.metrics[m].name) + '</td><td>' + esc(r.metrics[m].value) + '</td><td>' + esc(r.metrics[m].target) + '</td></tr>';
          }
          h += '</table>';
        }
        if (r.gap) h += '<div class="kv"><b>目标差距：</b>' + esc(r.gap) + '</div>';
        h += '<div class="row end" style="margin-top:8px">' +
          '<button class="btn sm" data-act="merge-result" data-id="' + esc(r.id) + '">以此条为准</button></div>' +
          '</div>';
      }
      h += '<div class="alert-box">存在 ' + goal.results.length + ' 条提交。导出报告以最新一条为准；' +
        '若需以其它提交为准，点对应记录上的「以此条为准」。</div>';
    } else {
      h += '<div class="muted small" style="margin-top:12px">最新一条结果显示在下面的「原因与改进」里，方便对着差距归因。</div>';
    }
    return h;
  }

  // 最新的结果（差距汇总）：放在「原因与改进」块的时间线上面
  function renderLatestResult(goal) {
    if (!goal.results.length) return '';
    var r = goal.results[goal.results.length - 1];
    var h = '<div class="item">' +
      '<div class="row between"><span class="item-t">最新提交</span>' +
      '<span class="muted small">' + fmtTime(r.createdAt) + '</span></div>' +
      '<div class="kv" style="white-space:pre-wrap">' + esc(r.actual || '（未填写）') + '</div>';
    if (r.metrics && r.metrics.length) {
      h += '<table class="tbl" style="margin-top:8px"><tr><th>指标</th><th>实际</th><th>目标</th></tr>';
      for (var m = 0; m < r.metrics.length; m++) {
        h += '<tr><td>' + esc(r.metrics[m].name) + '</td><td>' + esc(r.metrics[m].value) + '</td><td>' + esc(r.metrics[m].target) + '</td></tr>';
      }
      h += '</table>';
    }
    if (r.gap) h += '<div class="kv"><b>目标差距：</b>' + esc(r.gap) + '</div>';
    h += '</div>';
    return h;
  }

  // 差距汇总：放在时间线上面，一眼看清这次差在哪
  function renderGapSummary(goal) {
    if (!goal.results.length) return '';
    var r = goal.results[goal.results.length - 1];
    var h = '<div class="gap-sum"><div class="gs-t">差距汇总 · ' + fmtTime(r.createdAt) + '</div>';
    if (r.metrics && r.metrics.length) {
      var parts = [];
      for (var m = 0; m < r.metrics.length; m++) {
        parts.push(esc(r.metrics[m].name) + ' ' + esc(r.metrics[m].value || '—') +
                   ' / 目标 ' + esc(r.metrics[m].target || '—'));
      }
      h += '<div class="gs-s">📊 ' + parts.join(' · ') + '</div>';
    }
    if (r.gap) h += '<div class="gs-s bad">🔴 ' + esc(r.gap) + '</div>';
    h += '</div>';
    return h;
  }

  function factText(f) {
    if (!f) return '（事实已删除）';
    return (f.timelineAt ? f.timelineAt + ' · ' : '') + f.content;
  }

  // 事实下面挂着的原因与装备
  function causeOfFact(goal, factId) {
    for (var i = 0; i < goal.causes.length; i++) {
      if (goal.causes[i].factId === factId) return goal.causes[i];
    }
    return null;
  }

  function actionOfFact(goal, factId) {
    for (var i = 0; i < goal.actions.length; i++) {
      if (goal.actions[i].factId === factId) return goal.actions[i];
    }
    return null;
  }

  function factById(goal, id) {
    for (var i = 0; i < goal.facts.length; i++) {
      if (goal.facts[i].id === id) return goal.facts[i];
    }
    return null;
  }

  // 空目标：复盘页起始时四块都在，只是还没有内容
  var EMPTY_GOAL = {
    goal: { description: '', criteria: [] },
    results: [], facts: [], causes: [], actions: []
  };

  // 折叠时的摘要
  function goalSummary(goal) {
    var h = '<div class="sum-t">' + esc(goal.goal.description || '（未填写）') + '</div>';
    if (goal.goal.criteria.length) {
      var cs = [];
      for (var i = 0; i < goal.goal.criteria.length; i++) cs.push(esc(goal.goal.criteria[i]));
      h += '<div class="sum-s">验证：' + cs.join(' / ') + '</div>';
    } else {
      h += '<div class="sum-s muted">验证：还没写标准</div>';
    }
    return h;
  }

  function resultSummary(goal) {
    var r = goal.results.length ? goal.results[goal.results.length - 1] : null;
    if (!r) return '<div class="sum-s muted">还没有结果</div>';
    var h = '<div class="sum-t">实际：' + esc(r.actual || '（未填写）') + '</div>';
    if (r.metrics && r.metrics.length) {
      var parts = [];
      for (var m = 0; m < r.metrics.length; m++) {
        parts.push(esc(r.metrics[m].name) + ' ' + esc(r.metrics[m].value));
      }
      h += '<div class="sum-s">📊 ' + parts.join(' · ') + '</div>';
    }
    h += '<div class="sum-s bad">' + (r.gap ? '🔴 差距：' + esc(r.gap) : '🔴 差距：还没记') + '</div>';
    return h;
  }

  // 事实卡片：大卡片 + 下面的「回复」（原因 / 装备）
  function renderFactCard(f, goal, anchor) {
    var cause = causeOfFact(goal, f.id);
    var action = actionOfFact(goal, f.id);
    var h = '<div class="chat-card">' +
      '<button class="chat-del" data-act="del-fact" data-id="' + esc(f.id) + '" aria-label="删除事实">🗑️</button>' +
      '<div class="chat-fact">' + MOOD[moodOf(f)] + ' ' + esc(f.content) + '</div>';

    // 原因
    if (editCauseFact === f.id) {
      h += '<div class="reply edit"' + (anchor ? ' id="' + anchor + '"' : '') + '>' +
        '<input type="text" class="cause-in uline" data-fact="' + esc(f.id) + '" value="' + esc(cause ? cause.text : '') +
        '" placeholder="这条事实的原因">' +
        '<span class="row" style="gap:6px;margin-top:6px">' +
        '<button class="btn sm ghost" data-act="save-cause" data-fact="' + esc(f.id) + '">存</button>' +
        '<button class="btn sm ghost" data-act="cancel-cause" data-fact="' + esc(f.id) + '">取消</button>' +
        '</span></div>';
    } else {
      h += '<div class="reply" data-act="edit-cause" data-fact="' + esc(f.id) + '">' +
        (cause ? '<b>🔍 原因：</b>' + esc(cause.text)
               : '<span class="ghost">💬 点击这里补充原因...</span>') + '</div>';
    }

    // 装备
    if (editActionFact === f.id) {
      h += '<div class="reply edit"><input type="text" class="action-in uline" data-fact="' + esc(f.id) +
        '" value="' + esc(action ? action.title : '') + '" placeholder="要做什么改进">' +
        '<span class="row" style="gap:6px;margin-top:6px">' +
        '<button class="btn sm ghost" data-act="save-action" data-fact="' + esc(f.id) + '">存</button>' +
        '<button class="btn sm ghost" data-act="cancel-action" data-fact="' + esc(f.id) + '">取消</button>' +
        '</span></div>';
    } else {
      h += '<div class="reply" data-act="edit-action" data-fact="' + esc(f.id) + '">' +
        (action ? '<b>🔧 装备：</b>' + esc(action.title)
                : '<span class="ghost">🛠️ 点击这里锻造新装备...</span>') + '</div>';
      if (action) {
        var stCls = action.status === 'verified' ? 'verified'
                   : action.status === 'failed' ? 'failed' : 'pending';
        var stTxt = action.status === 'verified' ? '✓ 已闭环' : actionStatusText(action);
        h += '<div class="reply"><button class="st-hit" data-act="toggle-status" data-id="' +
          esc(action.id) + '"><span class="st-chip ' + stCls + '">' + esc(stTxt) + '</span></button></div>';
      }
    }
    h += '</div>';
    return h;
  }

  // 事实与归因：像聊天记录一样，事实是大卡片，原因和装备是下面的回复
  function renderChatBody(goal) {
    var facts = goal.facts.slice().sort(byTimeline);
    var h = renderGapSummary(goal);
    if (facts.length) {
      h += '<div class="chat">';
      for (var i = 0; i < facts.length; i++) {
        h += '<div class="tl-item">' +
          '<div class="tl-time">🕒 ' + esc(shortTime(facts[i].timelineAt) || '未标时间') + '</div>' +
          renderFactCard(facts[i], goal, i === 0 ? 'sec-cause' : null) +
          '</div>';
      }
      h += '</div>';
    } else {
      h += '<div class="muted small">还没有事实。写下第一条，下面就能接着归因、锻造装备。</div>';
    }

    // 写一条新事实
    h += '<div class="newfact">' +
      '<div class="nf-t">▼ 写一条新事实 / 记录新情况</div>' +
      '<div class="nf-moods">' +
      '<button class="mood mood-bad' + (pendingMood === 'bad' ? ' on' : '') + '" data-act="set-mood" data-mood="bad">🔴 翻车</button>' +
      '<button class="mood mood-good' + (pendingMood === 'good' ? ' on' : '') + '" data-act="set-mood" data-mood="good">🟢 爽点</button>' +
      '<button class="mood mood-flat' + (pendingMood === 'flat' ? ' on' : '') + '" data-act="set-mood" data-mood="flat">🟡 平平</button>' +
      '</div>' +
      '<textarea id="f-content" data-act="f-content" placeholder="记录刚刚发生了什么...">' + esc(pendingFactText) + '</textarea>' +
      '<div class="row end" style="margin-top:8px">' +
      '<button class="btn primary" data-act="add-fact">记下来</button></div>' +
      '</div>';

    // 历史数据：没有锚到事实上的原因/改进
    var orphanCauses = goal.causes.filter(function (c) { return !c.factId || !factById(goal, c.factId); });
    var orphanActions = goal.actions.filter(function (a) { return !a.factId || !factById(goal, a.factId); });
    if (orphanCauses.length || orphanActions.length) {
      h += '<hr class="sep"><div class="sub-card"><div class="muted small">历史数据：没有对应事实的条目</div>';
      for (var oc = 0; oc < orphanCauses.length; oc++) {
        h += '<div class="row between" style="margin-top:6px">' +
          '<span class="kv" style="color:var(--text)">原因 · ' + esc(orphanCauses[oc].text) + '</span>' +
          '<button class="btn sm ghost" data-act="del-cause" data-id="' + esc(orphanCauses[oc].id) + '">删</button></div>';
      }
      for (var oa = 0; oa < orphanActions.length; oa++) {
        h += '<div class="row between" style="margin-top:6px">' +
          '<span class="kv" style="color:var(--text)">装备 · ' + esc(orphanActions[oa].title) + '</span>' +
          '<button class="btn sm ghost" data-act="del-action" data-id="' + esc(orphanActions[oa].id) + '">删</button></div>';
      }
      h += '</div>';
    }
    return h;
  }

  function renderReview(goal) {
    var h = '';
    var isNew = !goal;
    var g = goal || EMPTY_GOAL;
    var st = blockStatus(g);

    h += renderSteps(g);

    // ① 目标：填好了就折叠，点一下展开
    var goalOpen = isNew || editingGoal || expandGoal || !st.goal;
    h += '<div class="card sec" id="sec-goal">';
    if (goalOpen) {
      h += blockHead('1', '🎯 目标', st.goal,
        (isNew || editingGoal) ? '' : '<button class="btn sm blk-act" data-act="cancel-edit">收起</button>') +
        renderGoalFormBody(isNew);
    } else {
      h += '<div class="sec-h" data-act="expand-goal"><span class="sec-t">🎯 目标</span>' +
        '<span class="sec-tip">点击展开修改</span></div>' +
        '<div class="sec-sum" data-act="expand-goal">' + goalSummary(goal) + '</div>';
    }
    h += '</div>';

    // ② 结果
    var resultOpen = expandResult || !st.result;
    h += '<div class="card sec" id="sec-result">';
    if (resultOpen) {
      h += blockHead('2', '📊 结果', st.result) + renderResultBody(g);
    } else {
      h += '<div class="sec-h" data-act="expand-result"><span class="sec-t">📊 结果</span>' +
        '<span class="sec-tip">点击展开修改</span></div>' +
        '<div class="sec-sum" data-act="expand-result">' + resultSummary(goal) + '</div>';
    }
    h += '</div>';

    // ③ 事实与归因
    h += '<div class="card sec" id="sec-facts">' +
      blockHead('3', '📝 事实与归因', st.facts) + renderChatBody(g) + '</div>';

    if (!isNew) {
      h += '<button class="btn primary block" data-act="submit-review" style="margin-top:16px">' +
        (goal.submittedAt ? '回到目标页' : '提交复盘') + '</button>';
    }

    return h;
  }

  // ---------- 战报回放（只读）：预期 vs 现实 + 经验时间线 ----------
  // 事实的颜色：文本里带正向词就算好消息
  var GOOD_WORDS = ['爽', '成功', '顺利', '满意', '喜欢', '不错', '顺畅', '提升', '省时', '省心'];
  var MOOD = { bad: '🔴', good: '🟢', flat: '🟡' };

  // 情绪：优先用记录时选的那个，老数据按文本猜
  function moodOf(f) {
    if (f && f.mood && MOOD[f.mood]) return f.mood;
    return isGoodFact(f ? f.content : '') ? 'good' : 'bad';
  }

  function isGoodFact(text) {
    var t = String(text || '');
    for (var i = 0; i < GOOD_WORDS.length; i++) {
      if (t.indexOf(GOOD_WORDS[i]) >= 0) return true;
    }
    return false;
  }

  // 2026-11-16 14:30 → 11-16 14:30
  function shortTime(s) {
    var m = String(s || '').match(/^\d{4}-(\d{2}-\d{2})(.*)$/);
    return m ? m[1] + m[2] : String(s || '');
  }

  function actionStatusText(ac) {
    if (!ac) return '';
    return ac.status === 'verified' ? '已闭环' : ac.status === 'failed' ? '未生效' : '待验证';
  }

  // 模块 2：经验流（事实 + 原因 + 改进，按时间线排）
  function renderExpFlow(goal) {
    var facts = goal.facts.slice().sort(byTimeline);
    if (!facts.length) return '<div class="muted small">还没有事实。</div>';
    var h = '<div class="timeline">';
    for (var i = 0; i < facts.length; i++) {
      var f = facts[i];
      var cause = causeOfFact(goal, f.id);
      var action = actionOfFact(goal, f.id);
      h += '<div class="tl-item">' +
        '<div class="tl-time">🕒 ' + esc(shortTime(f.timelineAt) || '未标时间') + '</div>' +
        '<div class="tl-body">' +
        '<div class="fact-txt">' + (isGoodFact(f.content) ? '🟢 ' : '🔴 ') + esc(f.content) + '</div>' +
        '<div class="exp-ln"><span class="exp-k">🔍 原因</span>' +
        '<div class="exp-v">' +
        (cause ? esc(cause.text) : '<span class="muted">—</span>') + '</div></div>' +
        '<div class="exp-ln"><span class="exp-k">🛠️ 装备</span>' +
        '<div class="exp-v">' + (action
          ? esc(action.title) + ' <span class="exp-st">' + actionStatusText(action) + '</span>' +
            (action.verifyResult
              ? '<div class="muted small">验证结论：' + esc(action.verifyResult) + '</div>' +
                '<div class="muted small">' + fmtTime(action.closedAt) + ' 闭环</div>'
              : '')
          : '<span class="muted small">暂无经验沉淀</span>') + '</div></div>' +
        '</div></div>';
    }
    h += '</div>';
    return h;
  }

  // 模块 1：预期 vs 现实（目标 + 结果合成）
  function renderExpectVsReal(goal) {
    var r = goal.results.length ? goal.results[goal.results.length - 1] : null;
    var badge = statusBadge(goal);
    var h = '<div class="card dark">' +
      '<div class="mdl-h">📊 预期 vs 现实</div>' +
      '<div class="row between" style="align-items:flex-start;gap:8px">' +
      '<div class="goal-t">🎯 ' + esc(goal.goal.description || '（未填目标）') + '</div>' +
      '<span class="badge ' + badge[0] + '">' + badge[1] + '</span></div>';

    // 预期
    h += '<div class="cmp"><div class="cmp-k">💡 预期</div><div class="cmp-v">';
    if (goal.goal.criteria.length) {
      for (var i = 0; i < goal.goal.criteria.length; i++) {
        h += '<div class="cmp-line good">· ' + esc(goal.goal.criteria[i]) + '</div>';
      }
    } else {
      h += '<div class="cmp-line muted">（没写验证标准）</div>';
    }
    h += '</div></div>';

    // 现实
    h += '<div class="cmp"><div class="cmp-k">⚠️ 现实</div><div class="cmp-v">';
    if (r) {
      h += '<div class="cmp-line">' + esc(r.actual || '（未填写）') + '</div>';
      if (r.metrics && r.metrics.length) {
        for (var m = 0; m < r.metrics.length; m++) {
          h += '<div class="cmp-line metric"><b class="bad">' + esc(r.metrics[m].name) + ' ' + esc(r.metrics[m].value) +
            '</b><span class="sep">/</span><span class="muted small">目标</span> <b class="good">' + esc(r.metrics[m].target) + '</b></div>';
        }
      }
      h += '<div class="muted small" style="margin-top:4px">' + fmtTime(r.createdAt) + ' 提交</div>';
    } else {
      h += '<div class="cmp-line muted">（还没有结果）</div>';
    }
    h += '</div></div>';

    // 差距
    h += '<div class="cmp"><div class="cmp-k">🔴 差距</div><div class="cmp-v">';
    if (r && r.gap) {
      h += '<div class="cmp-line bad">' + esc(r.gap) + '</div>';
    } else {
      h += '<div class="cmp-line muted">（还没记差距）</div>';
    }
    h += '</div></div></div>';
    return h;
  }

  function renderBattle(goal) {
    var h = '';
    h += renderExpectVsReal(goal);
    h += '<div class="card"><div class="mdl-h">🕰️ 经验时间线</div>' + renderExpFlow(goal) + '</div>';
    return h;
  }

  // ---------- 统计页 ----------
  function statBox(label, value) {
    return '<div class="stat-box"><div class="n">' + esc(value) + '</div><div class="l">' + esc(label) + '</div></div>';
  }

  function goalOptions(goals, selected) {
    var h = '';
    for (var i = 0; i < goals.length; i++) {
      h += '<option value="' + esc(goals[i].id) + '"' + (goals[i].id === selected ? ' selected' : '') + '>' +
        esc(short(goals[i].goal.description || '（未填目标）', 24)) + '</option>';
    }
    return h;
  }

  function renderCmpPair(currentId, otherId) {
    var h = '';
    var other = store.getGoal(otherId);
    var cmp = compare.compareGoals(currentId, otherId);
    if (!other || !cmp) return '';

    h += '<div class="card"><h2>' + esc(short(other.goal.description || '（无目标描述）', 22)) + '</h2>' +
      '<div class="sub-card"><div class="muted small">目标差异</div>' +
      '<div class="kv">本次目标：' + esc(cmp.goalDiff.currentDescription || '—') + '</div>' +
      '<div class="kv">上次目标：' + esc(cmp.goalDiff.otherDescription || '—') + '</div>' +
      '<div class="kv">本次验证标准：' + esc(cmp.goalDiff.currentCriteria || '—') + '</div>' +
      '<div class="kv">上次验证标准：' + esc(cmp.goalDiff.otherCriteria || '—') + '</div>' +
      '</div>';

    h += '<div class="sub-card"><div class="muted small">重复原因</div>';
    if (cmp.repeatedCauses.length) {
      for (var rc = 0; rc < cmp.repeatedCauses.length; rc++) {
        var pair = cmp.repeatedCauses[rc];
        h += '<div class="item highlight" style="margin-top:8px">' +
          '<div class="hl-tag">重复原因 · 相似度 ' + Math.round(pair.score * 100) + '%</div>' +
          '<div class="kv">本次：' + esc(pair.causeA.text) + '</div>' +
          '<div class="kv">上次：' + esc(pair.causeB.text) + '</div>' +
          '</div>';
      }
    } else {
      h += '<div class="kv">未发现重复原因</div>';
    }
    h += '</div>';

    h += '<div class="sub-card"><div class="muted small">上次没闭环的改进</div>';
    if (cmp.ineffectiveActions.length) {
      for (var ic = 0; ic < cmp.ineffectiveActions.length; ic++) {
        var ia = cmp.ineffectiveActions[ic];
        var af = ia.action.factId ? factById(other, ia.action.factId) : null;
        h += '<div class="item highlight" style="margin-top:8px">' +
          '<div class="hl-tag">未闭环改进 · ' + (ia.failed ? '未生效' : '待验证') + '</div>' +
          '<div class="kv">' + esc(ia.action.title) + '</div>' +
          (af ? '<div class="kv">来自事实：' + esc(factText(af)) + '</div>' : '') +
          (ia.action.verifyResult ? '<div class="kv">验证结论：' + esc(ia.action.verifyResult) + '</div>' : '') +
          '</div>';
      }
    } else {
      h += '<div class="kv">上次的改进都已闭环</div>';
    }
    h += '</div></div>';
    return h;
  }

  function renderStats() {
    var goals = store.getGoals().slice().sort(byUpdatedDesc);
    var h = '';

    var closed = 0, running = 0, actTotal = 0, actVerified = 0;
    for (var i = 0; i < goals.length; i++) {
      var g = goals[i];
      if (isClosed(g)) closed++; else running++;
      actTotal += g.actions.length;
      for (var a = 0; a < g.actions.length; a++) {
        if (g.actions[a].status === 'verified') actVerified++;
      }
    }

    h += '<h1 class="page-title">总览</h1>';
    h += '<div class="stat-grid">' +
      statBox('目标总数', String(goals.length)) +
      statBox('进行中', String(running)) +
      statBox('已闭环', String(closed)) +
      statBox('改进闭环率', actTotal ? (Math.round(actVerified / actTotal * 100) + '%') : '—') +
      '</div>';

    h += '<h1 class="page-title">对比</h1>';
    if (goals.length < 2) {
      h += '<div class="empty"><div class="e-t">还不能对比</div><div>至少要有两个目标。</div></div>';
    } else {
      var ids = goals.map(function (x) { return x.id; });
      if (ids.indexOf(cmpA) < 0) cmpA = ids[0];
      if (ids.indexOf(cmpB) < 0 || cmpB === cmpA) cmpB = ids[1];

      h += '<div class="card">' +
        '<div class="hint">选两个目标，高亮<b>重复原因</b>与<b>上次没闭环的改进</b>。</div>' +
        '<label class="field" style="margin-top:10px"><span>本次目标</span>' +
        '<select id="cmp-a" data-act="cmp-a">' + goalOptions(goals, cmpA) + '</select></label>' +
        '<label class="field"><span>对比目标</span>' +
        '<select id="cmp-b" data-act="cmp-b">' + goalOptions(goals, cmpB) + '</select></label>' +
        '<button class="btn primary block" data-act="cmp-run">开始对比</button>' +
        '<div class="muted small" style="margin-top:8px">对比后会自动关联这两个目标，导出报告会带上这段对比。</div>' +
        '</div>';

      if (cmpResult && cmpResult.a === cmpA && cmpResult.b === cmpB) {
        h += renderCmpPair(cmpA, cmpB);
      }
    }

    if (goals.length) {
      h += '<button class="btn block" data-act="export-all" style="margin-top:16px">导出全部报告</button>';
    }
    return h;
  }

  // ---------- 渲染 ----------
  function render() {
    route = parseHash();
    // 审阅页铺满到底：去掉为导航栏预留的底部空白
    if (document.body) {
      if (route.view === 'view') document.body.classList.add('no-tabs');
      else document.body.classList.remove('no-tabs');
    }
    renderAppbar();
    // 顶栏高度写进 CSS 变量，悬浮步骤条据此定位（要等顶栏渲染完再量）
    var ab0 = $('appbar');
    if (ab0 && document.documentElement) {
      document.documentElement.style.setProperty('--appbar-h', Math.round(ab0.getBoundingClientRect().height) + 'px');
    }
    var view = $('view');
    if (!view) return;

    if (route.view === 'goals') {
      editingGoal = false;
      editCauseFact = null;
      editActionFact = null;
      view.innerHTML = renderGoals();
      renderTabbar();
      return;
    }

    if (route.view === 'stats') {
      editingGoal = false;
      editCauseFact = null;
      editActionFact = null;
      view.innerHTML = renderStats();
      renderTabbar();
      return;
    }

    // ---- 审阅页（只读）----
    if (route.view === 'view') {
      editingGoal = false;
      editCauseFact = null;
      editActionFact = null;
      var vg = store.getGoal(route.id);
      if (!vg) {
        view.innerHTML = '<div class="empty"><div class="e-t">目标不存在</div>' +
          '<button class="btn primary" style="margin-top:12px" data-act="back">返回目标列表</button></div>';
        renderTabbar();
        return;
      }
      view.innerHTML = renderBattle(vg);
      renderTabbar();
      return;
    }

    // ---- 复盘页 ----
    var isNew = route.id === 'new';
    var g = isNew ? null : store.getGoal(route.id);
    if (!isNew && !g) {
      view.innerHTML = '<div class="empty"><div class="e-t">目标不存在</div>' +
        '<button class="btn primary" style="margin-top:12px" data-act="back">返回目标列表</button></div>';
      renderTabbar();
      return;
    }

    // 切换目标时重置表单草稿
    if (goalFormId !== route.id) {
      goalFormId = route.id;
      editingGoal = false;
      expandGoal = false;
      expandResult = false;
      seedGoalForm(g);
      pendingMetrics = [];
    }

    view.innerHTML = renderReview(g);
    renderTabbar();
    if (pendingMetrics.length) renderPendingMetrics();
  }

  function seedGoalForm(g) {
    if (g) {
      goalForm.description = g.goal.description || '';
      goalForm.criteria = (g.goal.criteria || []).slice();
    } else {
      goalForm.description = '';
      goalForm.criteria = [''];
    }
  }

  // ---------- 结果表单的临时指标行 ----------
  var pendingMetrics = [];

  function renderPendingMetrics() {
    var host = $('r-metrics');
    if (!host) return;
    var h = '';
    for (var i = 0; i < pendingMetrics.length; i++) {
      var m = pendingMetrics[i];
      h += '<div class="inline-2" style="margin-bottom:8px">' +
        '<input type="text" placeholder="指标名（如 完成率）" value="' + esc(m.name) + '" data-act="pm-name" data-i="' + i + '">' +
        '<input type="text" placeholder="实际值" value="' + esc(m.value) + '" data-act="pm-value" data-i="' + i + '">' +
        '</div>' +
        '<div class="inline-2" style="margin-bottom:4px">' +
        '<input type="text" placeholder="目标值" value="' + esc(m.target) + '" data-act="pm-target" data-i="' + i + '">' +
        '<button class="btn sm ghost" data-act="pm-del" data-i="' + i + '">移除</button>' +
        '</div>';
    }
    host.innerHTML = h;
  }

  // ---------- 弹层：补录验证 ----------
  // 验证是可选的：改进措施先记下来，验证可以隔很久再补，甚至在别的目标下闭环。
  function openCloseDialog(action, targetStatus) {
    var host = $('modal-root');
    if (!host) return;
    var isFail = targetStatus === 'failed';
    host.innerHTML =
      '<div class="modal-mask"><div class="modal" style="max-width:460px">' +
      '<h3>' + (isFail ? '记录未生效' : '补录验证') + '</h3>' +
      '<div class="modal-sub">' + esc(action.title) + '</div>' +
      '<div class="hint">写下这次验证的结论即可。</div>' +
      '<label class="field" style="margin-top:10px"><span>验证结论（必填）</span>' +
      '<textarea id="cl-result" placeholder="' +
      (isFail ? '例：11-18 复测，中位耗时 52 秒，仍高于 30 秒阈值' : '例：11-18 复测，中位耗时 24 秒，低于 30 秒阈值') +
      '"></textarea></label>' +
      '<div class="alert-box err" id="cl-err" style="display:none"></div>' +
      '<div class="modal-foot">' +
      '<button class="btn ghost" data-act="cl-cancel">取消</button>' +
      '<button class="btn ' + (isFail ? 'warn' : 'primary') + '" data-act="cl-ok" data-id="' + esc(action.id) +
      '" data-target="' + (isFail ? 'failed' : 'verified') + '">' + (isFail ? '记为未生效' : '记为已闭环') + '</button>' +
      '</div></div></div>';
  }

  function showCloseError(msg) {
    var box = $('cl-err');
    if (!box) { toast(msg, 'err'); return; }
    box.style.display = 'block';
    box.className = 'alert-box err';
    box.textContent = msg;
  }

  // ---------- 弹层：导出 ----------
  function openExportModal(title, md, sum, filename) {
    lastMarkdown = md;
    lastSummary = sum || '';
    lastFileName = filename || 'Reflect-复盘报告.md';

    var host = $('modal-root');
    if (!host) return;
    host.innerHTML =
      '<div class="modal-mask"><div class="modal" style="max-width:620px">' +
      '<h3>' + esc(title) + '</h3>' +
      '<div class="modal-sub">Markdown 报告</div>' +
      '<div class="md" style="max-height:34vh;overflow:auto">' + esc(md) + '</div>' +
      (sum ? '<div class="sub-card" style="white-space:pre-wrap;margin-top:10px">' + esc(sum) + '</div>' : '') +
      '<div class="modal-foot">' +
      (sum ? '<button class="btn ghost" data-act="copy-sum">复制摘要</button>' : '') +
      '<button class="btn" data-act="share-md">分享</button>' +
      '<button class="btn primary" data-act="save-md">写入文件</button>' +
      '</div></div></div>';
  }

  function exportCurrentGoal() {
    var g = route.id === 'new' ? null : store.getGoal(route.id);
    if (!g) return;
    var md = exporter.buildMarkdown(g, store.getGoals());
    var sum = exporter.buildSummary(g);
    var fname = short(g.goal.description, 20) + '-复盘报告.md';
    fname = fname.replace(/[\\/:*?"<>|]/g, '_');
    openExportModal('导出《' + short(g.goal.description || '未命名目标', 16) + '》', md, sum, fname);
  }

  function exportAllGoals() {
    var goals = store.getGoals();
    if (!goals.length) { notify('还没有目标可导出', 'err'); return; }
    var md = exporter.buildAllMarkdown(goals);
    openExportModal('导出全部（' + goals.length + ' 个目标）', md, '', 'Reflect-复盘合集.md');
  }

  // 复盘页还没建目标时：先按第①块的内容把目标建出来，再继续往下记
  function ensureGoal() {
    if (route.id !== 'new') return store.getGoal(route.id);

    var desc = ($('g-desc') || {}).value || goalForm.description || '';
    var crits = [];
    var inputs = document.querySelectorAll('#g-criteria .g-crit');
    for (var i = 0; i < inputs.length; i++) {
      var v = String(inputs[i].value || '').trim();
      if (v) crits.push(v);
    }
    if (!desc.trim()) { toast('先写下目标', 'err'); return null; }
    var check = store.validateCriteria(crits);
    if (!check.ok) { toast(check.error, 'err'); return null; }

    var ng = store.createGoal({ description: desc.trim(), criteria: check.criteria });
    goalFormId = ng.id;
    route.id = ng.id;
    global.location.hash = '#/review/' + ng.id;
    notify('目标已创建（' + check.criteria.length + ' 条验证标准）', 'ok');
    return ng;
  }

  // ---------- 长按目标卡片 ----------
  var pressTimer = null;
  var pressCard = null;
  var pressAt = 0;          // 长按弹出的时刻，用来吃掉随之而来的那次点击
  var pressId = null;       // 长按的那张卡片
  var PRESS_MS = 550;
  var PRESS_CLICK_GUARD = 1500;

  function startPress(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var card = t.closest('.proj-card');
    if (!card || !card.getAttribute('data-id')) return;
    cancelPress();
    pressCard = card;
    card.classList.add('pressing');
    pressTimer = setTimeout(function () {
      pressTimer = null;
      pressCard = null;
      var id = card.getAttribute('data-id');
      pressAt = Date.now();
      pressId = id;
      openGoalMenu(id);
    }, PRESS_MS);
  }

  function cancelPress() {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    if (pressCard) { pressCard.classList.remove('pressing'); pressCard = null; }
  }

  // ---------- 事件绑定 ----------
  function bind() {
    var view = $('view');
    var modal = $('modal-root');

    document.addEventListener('mousedown', function (e) { startPress(e); });
    document.addEventListener('touchstart', function (e) { startPress(e); }, { passive: true });
    document.addEventListener('mouseup', cancelPress);
    document.addEventListener('touchend', cancelPress);
    document.addEventListener('touchcancel', cancelPress);
    document.addEventListener('touchmove', cancelPress, { passive: true });
    document.addEventListener('contextmenu', function (e) {
      if (e.target && e.target.closest && e.target.closest('.proj-card')) e.preventDefault();
    });

    document.addEventListener('click', function (e) {
      var el = e.target;
      // 长按刚弹过菜单，这一下点击是抬手带出来的，别让它打开目标
      if (pressAt && (Date.now() - pressAt) < PRESS_CLICK_GUARD && el && el.closest) {
        var pc = el.closest('.proj-card');
        if (pc && pc.getAttribute('data-id') === pressId) {
          pressAt = 0;
          pressId = null;
          return;
        }
      }
      pressAt = 0;
      pressId = null;
      var actEl = null;
      if (el && el.getAttribute) actEl = el.getAttribute('data-act');
      if (!actEl && el && el.closest) {
        var host = el.closest('[data-act]');
        actEl = host ? host.getAttribute('data-act') : null;
      }
      if (!actEl) return;

      var id = el.getAttribute ? el.getAttribute('data-id') : null;
      if (!id && el && el.closest) {
        var h2 = el.closest('[data-id]');
        if (h2) id = h2.getAttribute('data-id');
      }

      // --- 全局 ---
      if (actEl === 'back') { go('#/goals'); return; }
      if (actEl === 'tab') {
        var tab = el.getAttribute('data-tab');
        if (tab === 'goals') { go('#/goals'); return; }
        if (tab === 'stats') { go('#/stats'); return; }
        // 复盘页：一律开一次新的复盘
        go('#/review/new');
        return;
      }
      if (actEl === 'cf-no') { closeModal(); return; }
      if (actEl === 'cf-yes') {
        var cb = modal.__onYes;
        closeModal();
        if (cb) cb();
        return;
      }
      if (actEl === 'cl-cancel') { closeModal(); return; }
      if (actEl === 'cl-ok') {
        var result = ($('cl-result') || {}).value || '';
        var target = el.getAttribute('data-target') || 'verified';
        var res = store.closeAction(id, result, target);
        if (!res.ok) {
          // 拦截：没有验证结论就不能闭环
          showCloseError(res.error);
          return;
        }
        closeModal();
        notify(target === 'failed' ? '已记录为未生效' : '已闭环', 'ok');
        render();
        return;
      }

      // --- 目标列表 ---
      if (actEl === 'seed') {
        var r = store.seedExample();
        if (r && r.ok) {
          notify(r.created ? '示例数据已载入' : '示例数据已存在，直接打开即可', 'ok');
          go('#/review/' + r.goal.id);
        } else {
          notify('载入示例失败', 'err');
        }
        return;
      }
      if (actEl === 'view-goal') {
        go('#/view/' + id);
        return;
      }
      if (actEl === 'edit-review') {
        go('#/review/' + (id || route.id));
        return;
      }
      if (actEl === 'delete-goal-now') {
        closeModal();
        store.deleteGoal(id);
        notify('目标已删除', 'ok');
        render();
        return;
      }
      if (actEl === 'submit-review') {
        var sub = store.submitGoal(route.id);
        if (!sub.ok) { toast(sub.error, 'err'); return; }
        notify('复盘已提交', 'ok');
        go('#/goals');
        return;
      }

      // --- 目标 ---
      if (actEl === 'edit-goal') {
        var eg = store.getGoal(route.id);
        seedGoalForm(eg);
        editingGoal = true;
        render();
        return;
      }
      if (actEl === 'cancel-edit') {
        editingGoal = false;
        expandGoal = false;
        seedGoalForm(store.getGoal(route.id));
        render();
        return;
      }
      if (actEl === 'add-crit') {
        goalForm.criteria.push('');
        render();
        return;
      }
      if (actEl === 'del-crit') {
        var di = parseInt(el.getAttribute('data-i'), 10);
        if (!isNaN(di)) { goalForm.criteria.splice(di, 1); render(); }
        return;
      }
      if (actEl === 'save-goal') {
        var desc = ($('g-desc') || {}).value || '';
        var crits = [];
        var inputs = document.querySelectorAll('#g-criteria .g-crit');
        for (var ci = 0; ci < inputs.length; ci++) {
          var v = String(inputs[ci].value || '').trim();
          if (v) crits.push(v);
        }
        if (!desc.trim()) { toast('请写下目标', 'err'); return; }
        var check = store.validateCriteria(crits);
        if (!check.ok) { toast(check.error, 'err'); return; }
        if (route.id === 'new') {
          var ng = store.createGoal({ description: desc.trim(), criteria: check.criteria });
          notify('目标已创建（' + check.criteria.length + ' 条验证标准）', 'ok');
          goalFormId = ng.id;
          editingGoal = false;
          go('#/review/' + ng.id);
        } else {
          store.updateGoal(route.id, { description: desc.trim(), criteria: check.criteria });
          notify('目标已更新', 'ok');
          editingGoal = false;
          expandGoal = false;
          seedGoalForm(store.getGoal(route.id));
          render();
        }
        return;
      }

      // --- 结果 ---
      if (actEl === 'add-metric') {
        pendingMetrics.push({ name: '', value: '', target: '' });
        renderPendingMetrics();
        return;
      }
      if (actEl === 'pm-del') {
        var mi = parseInt(el.getAttribute('data-i'), 10);
        if (!isNaN(mi)) { pendingMetrics.splice(mi, 1); renderPendingMetrics(); }
        return;
      }
      if (actEl === 'add-result') {
        var actual = ($('r-actual') || {}).value || '';
        var gap = ($('r-gap') || {}).value || '';
        if (!actual.trim()) { toast('请填写实际结果', 'err'); return; }
        var metrics = pendingMetrics.filter(function (m) { return String(m.name || '').trim(); });
        var rg = ensureGoal();
        if (!rg) return;
        store.addResult(rg.id, { actual: actual, gap: gap, metrics: metrics });
        pendingMetrics = [];
        resultDraft = { actual: '', gap: '' };
        expandResult = false;
        notify('结果已记下', 'ok');
        render();
        return;
      }
      if (actEl === 'merge-result') {
        confirmBox('以这条为准，其余提交将被合并掉。', function () {
          var mr = store.mergeResults(route.id, id);
          if (mr.ok) notify('已合并，以该条为准', 'ok');
          else notify(mr.error, 'err');
        });
        return;
      }

      // --- 事实 ---
      if (actEl === 'add-fact') {
        var content = ($('f-content') || {}).value || '';
        if (!content.trim()) { toast('请写下发生了什么', 'err'); return; }
        var fg = ensureGoal();
        if (!fg) return;
        store.addFact(fg.id, { content: content.trim(), timelineAt: nowLocalInput(), mood: pendingMood });
        pendingFactText = '';
        notify('事实已记下', 'ok');
        render();
        return;
      }
      if (actEl === 'set-mood') {
        var mood = el.getAttribute('data-mood') || 'bad';
        pendingMood = (mood === 'good' || mood === 'flat') ? mood : 'bad';
        pendingFactText = ($('f-content') || {}).value || pendingFactText;
        render();
        return;
      }
      if (actEl === 'del-fact') {
        store.removeFact(route.id, id);
        notify('事实已删除', 'ok');
        render();
        return;
      }
      if (actEl === 'expand-goal') {
        expandGoal = true;
        editingGoal = false;
        seedGoalForm(store.getGoal(route.id));
        render();
        return;
      }
      if (actEl === 'expand-result') {
        expandResult = true;
        // 展开时把最近一次提交带回表单，直接改
        var rg2 = store.getGoal(route.id);
        if (rg2 && rg2.results.length) {
          var lr = rg2.results[rg2.results.length - 1];
          resultDraft = { actual: lr.actual || '', gap: lr.gap || '' };
          pendingMetrics = (lr.metrics || []).slice();
        }
        render();
        return;
      }
      if (actEl === 'goto-sec') {
        var sec = el.getAttribute('data-sec');
        var target = $('sec-' + sec);
        if (target && target.scrollIntoView) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        return;
      }
      if (actEl === 'toggle-status') {
        var tid = id;
        var tAct = null;
        var allGoals = store.getGoals();
        for (var ti = 0; ti < allGoals.length; ti++) {
          for (var tj = 0; tj < allGoals[ti].actions.length; tj++) {
            if (allGoals[ti].actions[tj].id === tid) tAct = allGoals[ti].actions[tj];
          }
        }
        if (!tAct) return;
        if (tAct.status === 'verified') {
          var back = store.updateAction(tid, { status: 'open', verifyResult: '' });
          if (!back.ok) { toast(back.error, 'err'); return; }
          notify('改回待验证', 'ok');
          render();
          return;
        }
        openCloseDialog(tAct, 'verified');
        return;
      }
      if (actEl === 'cancel-cause') {
        editCauseFact = null;
        render();
        return;
      }
      if (actEl === 'cancel-action') {
        editActionFact = null;
        render();
        return;
      }

      // --- 原因：写在事实下面 ---
      if (actEl === 'edit-cause') {
        editCauseFact = el.getAttribute('data-fact') || null;
        render();
        return;
      }
      if (actEl === 'edit-action') {
        editActionFact = el.getAttribute('data-fact') || null;
        render();
        return;
      }
      if (actEl === 'save-cause') {
        var factId = el.getAttribute('data-fact') || '';
        var cInput = document.querySelector('.cause-in[data-fact="' + factId + '"]');
        var ctext = (cInput ? cInput.value : '') || '';
        var cg = ensureGoal();
        if (!cg) return;
        var oldCause = causeOfFact(cg, factId);
        if (!ctext.trim()) {
          if (oldCause) {
            store.removeCause(cg.id, oldCause.id);
            notify('原因已清除', 'ok');
          } else {
            toast('还没写原因', 'err');
          }
          editCauseFact = null;
          render();
          return;
        }
        if (oldCause) {
          store.updateCause(cg.id, oldCause.id, { text: ctext.trim() });
          notify('原因已更新', 'ok');
        } else {
          store.addCause(cg.id, { text: ctext.trim(), factId: factId });
          notify('原因已记下', 'ok');
        }
        editCauseFact = null;
        render();
        return;
      }
      if (actEl === 'del-cause') {
        confirmBox('确定删除这条原因？', function () {
          store.removeCause(route.id, id);
          notify('原因已删除', 'ok');
          render();
        });
        return;
      }

      // --- 改进：写在事实下面 ---
      if (actEl === 'save-action') {
        var afactId = el.getAttribute('data-fact') || '';
        var aInput = document.querySelector('.action-in[data-fact="' + afactId + '"]');
        var atitle = (aInput ? aInput.value : '') || '';
        var ag = ensureGoal();
        if (!ag) return;
        var oldAction = actionOfFact(ag, afactId);
        if (!atitle.trim()) {
          if (oldAction) {
            confirmBox('确定删掉这条改进？', function () {
              store.removeAction(oldAction.id);
              notify('改进已删除', 'ok');
              render();
            });
          } else {
            toast('还没写改进', 'err');
          }
          return;
        }
        if (oldAction) {
          store.updateAction(oldAction.id, { title: atitle.trim() });
          notify('改进已更新', 'ok');
        } else {
          store.addAction(ag.id, { title: atitle.trim(), factId: afactId });
          notify('改进措施已记下', 'ok');
        }
        editActionFact = null;
        render();
        return;
      }
      if (actEl === 'del-action') {
        confirmBox('确定删掉这条改进？', function () {
          store.removeAction(id);
          notify('改进已删除', 'ok');
          render();
        });
        return;
      }
      if (actEl === 'act-close' || actEl === 'act-failed') {
        var target = null;
        var gs = store.getGoals();
        for (var ti = 0; ti < gs.length; ti++) {
          for (var tj = 0; tj < gs[ti].actions.length; tj++) {
            if (gs[ti].actions[tj].id === id) target = gs[ti].actions[tj];
          }
        }
        if (target) openCloseDialog(target, actEl === 'act-failed' ? 'failed' : 'verified');
        return;
      }

      // --- 统计：对比 ---
      if (actEl === 'cmp-run') {
        var a = ($('cmp-a') || {}).value || '';
        var b = ($('cmp-b') || {}).value || '';
        if (!a || !b || a === b) { toast('请选两个不同的目标', 'err'); return; }
        cmpA = a; cmpB = b;
        cmpResult = { a: a, b: b };
        store.linkGoal(a, b);
        notify('已关联，导出报告会带上这段对比', 'ok');
        render();
        return;
      }
      if (actEl === 'export-all') { exportAllGoals(); return; }
      if (actEl === 'open-export') { exportCurrentGoal(); return; }

      // --- 导出 ---
      if (actEl === 'save-md') {
        saveFile(lastFileName, lastMarkdown);
        return;
      }
      if (actEl === 'share-md') { shareText(lastMarkdown); return; }
      if (actEl === 'copy-md') {
        if (copyText(lastMarkdown)) notify('已复制到剪贴板', 'ok');
        else notify('复制失败，请手动选择文本复制', 'err');
        return;
      }
      if (actEl === 'share-sum') { shareText(lastSummary); return; }
      if (actEl === 'copy-sum') {
        if (copyText(lastSummary)) notify('摘要已复制到剪贴板', 'ok');
        else notify('复制失败，请手动复制', 'err');
        return;
      }
    });

    // 改变事件：对比的两个下拉
    document.addEventListener('change', function (e) {
      var el = e.target;
      if (!el || !el.id) return;
      if (el.id === 'cmp-a') { cmpA = el.value; cmpResult = null; return; }
      if (el.id === 'cmp-b') { cmpB = el.value; cmpResult = null; }
    });

    // input 事件：目标表单、临时指标行
    document.addEventListener('input', function (e) {
      var el = e.target;
      if (!el || !el.getAttribute) return;

      if (el.id === 'g-desc') { goalForm.description = el.value; return; }
      if (el.id === 'f-content') { pendingFactText = el.value; return; }
      if (el.id === 'r-actual') { resultDraft.actual = el.value; return; }
      if (el.id === 'r-gap') { resultDraft.gap = el.value; return; }
      if (el.className && el.className.indexOf('g-crit') >= 0) {
        var gi = parseInt(el.getAttribute('data-i'), 10);
        if (!isNaN(gi) && goalForm.criteria[gi] !== undefined) goalForm.criteria[gi] = el.value;
        return;
      }

      var act = el.getAttribute('data-act');
      if (!act) return;
      if (act === 'pm-name' || act === 'pm-value' || act === 'pm-target') {
        var i = parseInt(el.getAttribute('data-i'), 10);
        if (isNaN(i) || !pendingMetrics[i]) return;
        if (act === 'pm-name') pendingMetrics[i].name = el.value;
        else if (act === 'pm-value') pendingMetrics[i].value = el.value;
        else pendingMetrics[i].target = el.value;
      }
    });

    global.addEventListener('hashchange', function () { render(); });
  }

  function start() {
    bind();
    render();
  }

  R.ui = {
    render: render,
    toast: toast,
    notify: notify,
    onBack: function () {
      // 返回键：先关弹层，再退回目标页
      var modal = $('modal-root');
      if (modal && modal.innerHTML) { closeModal(); return true; }
      if (route.view !== 'goals') { go('#/goals'); return true; }
      return false;
    },
    start: start,
    esc: esc
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(window);
