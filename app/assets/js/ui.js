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

  var TABS = [
    { key: 'goals', label: '目标', icon: 'M4 6h16M4 12h16M4 18h10' },
    { key: 'review', label: '复盘', icon: 'M4 19h16M4 9h16M4 14h10' },
    { key: 'stats', label: '统计', icon: 'M4 20V11M10 20V4M16 20v-7M2 20h20' }
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
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#4d8dfa" stroke-width="1.8" stroke-linecap="round">' +
      '<circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="4"></circle><circle cx="12" cy="12" r="1"></circle></svg>';

    var title = 'Reflect';
    var sub = '<span class="sub">把差距变成下一次的动作</span>';
    var right = '';

    if (route.view === 'review') {
      title = '复盘';
      sub = '';
      var g = route.id === 'new' ? null : store.getGoal(route.id);
      if (g) {
        right = '<button class="iconbtn" data-act="open-export" aria-label="导出报告">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M12 3v10m0 0l-4-4m4 4l4-4M4 17v4h16v-4"></path></svg></button>';
      }
    } else if (route.view === 'stats') {
      title = '统计';
      sub = '';
    }

    bar.innerHTML = logo + '<div class="title">' + title + sub + '</div>' + right;
  }

  // ---------- 底部 Tab ----------
  function renderTabbar() {
    var bar = $('tabbar');
    if (!bar) return;
    bar.style.display = 'flex';
    var h = '';
    for (var i = 0; i < TABS.length; i++) {
      var t = TABS[i];
      h += '<button class="tab' + (route.view === t.key ? ' on' : '') + '" data-act="tab" data-tab="' + t.key + '">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="' + t.icon + '"></path></svg>' + esc(t.label) + '</button>';
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

    h += '<div class="card"><div class="row between"><h2 style="margin:0">目标</h2>' +
      '<button class="btn sm ghost" data-act="seed">载入示例</button></div>' +
      '<div class="hint">定过的目标都存在这里，点进去可以继续补录。长按目标可以删除。</div>' +
      '</div>';

    if (!goals.length) {
      h += '<div class="empty"><div class="e-t">还没有目标</div>' +
        '<div>去复盘页写下你要的东西，配一条能检验的标准。</div>' +
        '<button class="btn primary" style="margin-top:12px" data-act="tab" data-tab="review">去复盘页</button></div>';
      return h;
    }

    h += '<h1 class="page-title">全部目标（' + goals.length + '）</h1>';
    for (var i = 0; i < goals.length; i++) {
      var g = goals[i];
      var st = blockStatus(g);
      var done = doneCount(st);
      var pending = openActions(g);
      h += '<div class="proj-card" data-act="open-goal" data-id="' + esc(g.id) + '">' +
        '<div class="row between"><span class="t">' + esc(short(g.goal.description || '未填目标', 26)) + '</span>' +
        '<span class="badge ' + statusBadge(g)[0] + '">' + statusBadge(g)[1] + '</span></div>' +
        '<div class="meta">' + g.goal.criteria.length + ' 条验证标准 · ' + done + '/4 块已填 · 更新于 ' + fmtTime(g.updatedAt) + '</div>' +
        '<div class="progress"><i style="width:' + Math.round(done / 4 * 100) + '%"></i></div>' +
        (pending.length ? '<div class="meta" style="color:var(--warn)">' + pending.length + ' 条改进还没验证</div>' : '') +
        '</div>';
    }
    return h;
  }

  // ---------- 复盘页 ----------
  function blockHead(n, label, done, extra) {
    return '<div class="blk-h"><span class="blk-n">' + n + '</span><h2>' + esc(label) + '</h2>' +
      '<span class="badge ' + (done ? 'verified' : 'open') + '">' + (done ? '已填' : '待填') + '</span>' +
      (extra || '') + '</div>';
  }

  function renderSteps(g) {
    var st = blockStatus(g);
    var order = ['goal', 'result', 'facts', 'causes'];
    var cur = order.length;
    for (var i = 0; i < order.length; i++) {
      if (!st[order[i]]) { cur = i; break; }
    }
    var h = '<div class="bstrip">';
    for (var j = 0; j < order.length; j++) {
      var cls = j < cur ? 'badge verified' : (j === cur ? 'badge running' : 'badge');
      h += '<span class="' + cls + '">' + (j + 1) + '. ' + esc(BLOCKS[j]) + '</span>';
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
      '<button class="btn sm" data-act="add-crit">+ 再加一条</button>' +
      '</div>' +
      '<div class="row end" style="margin-top:12px">' +
      (isNew ? '' : '<button class="btn ghost" data-act="cancel-edit">取消</button>') +
      '<button class="btn primary" data-act="save-goal">' + (isNew ? '创建目标' : '保存') + '</button>' +
      '</div>';
    return h;
  }

  // ① 目标：只读展示
  function renderGoalViewBody(goal) {
    var h = '';
    h += '<div class="field"><span>目标</span>' +
      '<div class="col-body">' + esc(goal.goal.description || '（未填写）') + '</div>' +
      '</div>' +
      '<div class="field"><span>验证标准</span>';
    if (goal.goal.criteria.length) {
      for (var i = 0; i < goal.goal.criteria.length; i++) {
        h += '<div class="col-body" style="margin-top:4px">· ' + esc(goal.goal.criteria[i]) + '</div>';
      }
    } else {
      h += '<div class="badge alert">尚无验证标准</div>';
    }
    h += '</div>';
    return h;
  }

  // ② 结果
  function renderResultBody(goal) {
    var h = '';
    h += '<label class="field"><span>实际结果</span>' +
      '<textarea id="r-actual" placeholder="例：5 人中 3 人完成，导出失败率 12%"></textarea></label>' +
      '<div id="r-metrics"></div>' +
      '<button class="btn sm" data-act="add-metric" style="margin-bottom:10px">+ 添加关键指标</button>' +
      '<label class="field"><span>目标差距</span>' +
      '<textarea id="r-gap" placeholder="例：完成率差 20 个百分点"></textarea></label>' +
      '<button class="btn primary block" data-act="add-result">提交结果</button>';

    if (!goal.results.length) {
      h += '<div class="muted small" style="margin-top:12px">还没有结果。</div>';
      return h;
    }

    h += '<hr class="sep">';
    for (var i = 0; i < goal.results.length; i++) {
      var r = goal.results[i];
      var latest = i === goal.results.length - 1;
      h += '<div class="item">' +
        '<div class="row between"><span class="item-t">' + (latest ? '最新提交' : '历史提交') + '</span>' +
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
      if (!latest) {
        h += '<div class="row end" style="margin-top:8px">' +
          '<button class="btn sm" data-act="merge-result" data-id="' + esc(r.id) + '">以此条为准</button></div>';
      }
      h += '</div>';
    }
    if (goal.results.length > 1) {
      h += '<div class="alert-box">存在 ' + goal.results.length + ' 条提交。导出报告以最新一条为准；' +
        '若需以其它提交为准，点对应记录上的「以此条为准」。</div>';
    }
    return h;
  }

  // ③ 事实：只负责「记一条」，时间线搬到 ④ 去
  function renderFactsBody(goal) {
    var h = '';
    h += '<label class="field"><span>发生了什么</span>' +
      '<textarea id="f-content" placeholder="例：用户在模板入口停留超过 40 秒后退出"></textarea></label>' +
      '<label class="field"><span>时间点</span><input type="text" id="f-time" value="' + esc(nowLocalInput()) + '" placeholder="2026-11-16 14:30"></label>' +
      '<button class="btn primary block" data-act="add-fact">记下来</button>';
    if (goal.facts.length) {
      h += '<div class="muted small" style="margin-top:10px">已记 ' + goal.facts.length +
        ' 条，去下面的「原因与改进」里归因。</div>';
    }
    return h;
  }

  // ④ 原因与改进：事实时间线，每条事实下面挂它的原因和改进
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

  function factText(f) {
    if (!f) return '（事实已删除）';
    return (f.timelineAt ? f.timelineAt + ' · ' : '') + f.content;
  }

  // 改进条目：只留验证结论与闭环动作，不再显示状态徽章
  function actionItemHtml(ac) {
    var h = '';
    if (ac.verifyResult) {
      h += '<div class="kv"><b>验证结论：</b>' + esc(ac.verifyResult) + '</div>' +
        '<div class="muted small">' + fmtTime(ac.closedAt) + ' 闭环</div>';
    } else {
      h += '<div class="row" style="gap:6px;margin-top:6px">' +
        '<button class="btn sm ok" data-act="act-close" data-id="' + esc(ac.id) + '">补录验证</button>' +
        '<button class="btn sm warn" data-act="act-failed" data-id="' + esc(ac.id) + '">未生效</button>' +
        '</div>';
    }
    return h;
  }

  // 原因 / 改进这两行：存完是只读（和目标块一样），点「修改」才回到输入框
  function factLine(label, item, factId, kind) {
    var editing = (kind === 'cause') ? (editCauseFact === factId) : (editActionFact === factId);
    var h = '<div class="fact-ln"><span class="fl-h">' + label + '</span>';
    if (item && !editing) {
      h += '<div class="fl-ro"><span class="grow">' + esc(item.text || item.title) + '</span>' +
        '<button class="btn sm ghost" data-act="edit-' + kind + '" data-fact="' + esc(factId) + '">修改</button></div>';
    } else {
      var val = item ? (item.text || item.title) : '';
      var ph = kind === 'cause' ? '例：模板入口太多，新手卡住了' : '例：默认推荐一个模板';
      h += '<div class="crit-row"><input type="text" class="' + kind + '-in" data-fact="' + esc(factId) +
        '" value="' + esc(val) + '" placeholder="' + ph + '">' +
        '<button class="btn sm ghost" data-act="save-' + kind + '" data-fact="' + esc(factId) + '">存</button></div>';
    }
    h += '</div>';
    return h;
  }

  function renderCausesBody(goal) {
    var h = '';
    h += '<div class="hint">在每条事实下面写它的原因和改进。写下原因，并关联到具体事实；写下要做的事就行。' +
      '验证可以留到以后补——它常常要等一个周期，甚至在别的目标里才闭环。</div>';

    var facts = goal.facts.slice().sort(function (a, b) {
      return String(a.timelineAt || '').localeCompare(String(b.timelineAt || ''));
    });

    if (!facts.length) {
      h += '<div class="muted small" style="margin-top:12px">还没有事实。先在上面记一条，才能归因和改进。</div>';
      return h;
    }

    h += '<div class="muted small" style="margin-top:12px">时间线（' + facts.length + '）</div>';
    h += '<div class="timeline" style="margin-top:8px">';
    for (var i = 0; i < facts.length; i++) {
      var f = facts[i];
      var cause = causeOfFact(goal, f.id);
      var action = actionOfFact(goal, f.id);
      h += '<div class="tl-item">' +
        '<div class="tl-time">' + esc(f.timelineAt || '未标时间') + '</div>' +
        '<div class="tl-body">' +
        '<div class="fact-txt">' + esc(f.content) + '</div>' +
        factLine('原因', cause, f.id, 'cause') +
        factLine('改进', action, f.id, 'action') +
        (action ? actionItemHtml(action) : '') +
        '<div class="row end" style="margin-top:6px">' +
        '<button class="btn sm ghost" data-act="del-fact" data-id="' + esc(f.id) + '">删除事实</button></div>' +
        '</div></div>';
    }
    h += '</div>';

    // 历史数据：没有锚到事实上的原因/改进，只读列出，可删
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
          '<span class="kv" style="color:var(--text)">改进 · ' + esc(orphanActions[oa].title) + '</span>' +
          '<button class="btn sm ghost" data-act="del-action" data-id="' + esc(orphanActions[oa].id) + '">删</button></div>';
      }
      h += '</div>';
    }
    return h;
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

  function renderReview(goal) {
    var h = '';
    var isNew = !goal;
    var g = goal || EMPTY_GOAL;
    var st = blockStatus(g);

    h += renderSteps(g);

    h += '<div class="card">' +
      blockHead('1', '目标', st.goal,
        (isNew || editingGoal) ? '' : '<button class="btn sm blk-act" data-act="edit-goal">修改</button>') +
      ((isNew || editingGoal) ? renderGoalFormBody(isNew) : renderGoalViewBody(goal)) + '</div>';

    h += '<div class="card">' + blockHead('2', '结果', st.result) + renderResultBody(g) + '</div>';
    h += '<div class="card">' + blockHead('3', '事实', st.facts) + renderFactsBody(g) + '</div>';
    h += '<div class="card">' + blockHead('4', '原因与改进', st.causes) + renderCausesBody(g) + '</div>';

    if (!isNew) {
      h += '<button class="btn primary block" data-act="submit-review" style="margin-top:16px">' +
        (goal.submittedAt ? '回到目标页' : '提交复盘') + '</button>';
    }

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
    renderAppbar();
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
      if (actEl === 'open-goal') {
        go('#/review/' + id);
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
        var factTime = ($('f-time') || {}).value || '';
        var fg = ensureGoal();
        if (!fg) return;
        store.addFact(fg.id, { content: content, timelineAt: factTime });
        notify('事实已记下', 'ok');
        render();
        return;
      }
      if (actEl === 'del-fact') {
        confirmBox('确定删除这条事实？', function () {
          store.removeFact(route.id, id);
          notify('事实已删除', 'ok');
          render();
        });
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
