/* Reflect · ui.js
   界面层：hash 路由 + 全量重绘。经典脚本，挂载到全局 Reflect.ui。 */
(function (global) {
  'use strict';

  var R = global.Reflect = global.Reflect || {};
  var store = R.store;
  var compare = R.compare;
  var exporter = R.export;

  var TABS = [
    { key: 'goal', label: '目标', icon: 'M3 12h4l3 8 4-16 3 8h4' },
    { key: 'result', label: '结果', icon: 'M4 19h16M4 9h16M4 14h10' },
    { key: 'facts', label: '事实', icon: 'M12 3v18M5 8l7-5 7 5M5 8v8l7 5 7-5V8' },
    { key: 'causes', label: '原因与改进', icon: 'M12 3l2.5 6.5L21 11l-5 4.5L17.5 22 12 18 6.5 22 8 15.5 3 11l6.5-1.5z' },
    { key: 'compare', label: '对比', icon: 'M4 6h7v12H4zM13 6h7v12h-7M8 12h8' },
    { key: 'export', label: '导出', icon: 'M12 3v10m0 0l-4-4m4 4l4-4M4 17v4h16v-4' }
  ];

  var FLOW_STEPS = [
    '发起', '翻译愿望为验证标准', '独立提交结果/事实', '合并时间线',
    '归因', '改进', '验证', '下次对比'
  ];

  var route = { view: 'projects', id: null, tab: 'goal' };
  var selectedFacts = {};        // 事实多选：id -> true
  var selectedCompare = {};      // 对比项目多选：id -> true
  var factMergeMain = null;      // 合并主线事实 id
  var lastMarkdown = '';
  var lastSummary = '';

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

  function fmtDate(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function nowLocalInput() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
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
    if (parts[0] === 'project' && parts[1]) {
      var tab = parts[2] || 'goal';
      var ok = false;
      for (var i = 0; i < TABS.length; i++) { if (TABS[i].key === tab) ok = true; }
      if (!ok) tab = 'goal';
      return { view: 'project', id: parts[1], tab: tab };
    }
    return { view: 'projects', id: null, tab: 'goal' };
  }

  function go(hash) {
    if (global.location.hash === hash) render();
    else global.location.hash = hash;
  }

  // ---------- 顶栏 ----------
  function renderAppbar() {
    var bar = $('appbar');
    if (!bar) return;
    if (route.view === 'projects') {
      bar.innerHTML =
        '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#4d8dfa" stroke-width="1.8" stroke-linecap="round">' +
        '<circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="4"></circle><circle cx="12" cy="12" r="1"></circle></svg>' +
        '<div class="title">Reflect <span class="sub">目标—结果差距复盘</span></div>';
      return;
    }
    var p = store.getProject(route.id);
    bar.innerHTML =
      '<button class="iconbtn" data-act="back" aria-label="返回">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M15 18l-6-6 6-6"></path></svg></button>' +
      '<div class="title">' + esc(p ? p.title : '复盘') +
      (p ? ' <span class="sub">' + (p.status === 'running' ? '进行中' : p.status === 'archived' ? '已归档' : '草稿') + '</span>' : '') +
      '</div>';
  }

  // ---------- 底部 Tab ----------
  function renderTabbar() {
    var bar = $('tabbar');
    if (!bar) return;
    if (route.view === 'projects') { bar.innerHTML = ''; bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    var h = '';
    for (var i = 0; i < TABS.length; i++) {
      var t = TABS[i];
      h += '<button class="tab' + (route.tab === t.key ? ' on' : '') + '" data-act="tab" data-tab="' + t.key + '">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="' + t.icon + '"></path></svg>' + esc(t.label) + '</button>';
    }
    bar.innerHTML = h;
  }

  // ---------- 流程提示 ----------
  function renderFlow(project) {
    // 依据当前数据推断流程进度
    var step = 0;
    if (project.goal.versions.length) step = 1;
    if (project.results.length && project.facts.length) step = 2;
    if (project.facts.length > 1) step = 3;
    if (project.causes.length) step = 4;
    if (project.actions.length) step = 5;
    if (project.actions.length && project.actions.every(function (a) { return a.status === 'verified'; })) step = 6;
    if (project.linkedProjectIds.length) step = 7;

    var h = '<div class="card" style="padding:12px 14px"><div class="row between" style="margin-bottom:8px">' +
      '<strong style="font-size:14px">复盘主线</strong><span class="muted small">当前：' + esc(FLOW_STEPS[step]) + '</span></div>' +
      '<div class="row" style="gap:6px;flex-wrap:nowrap;overflow-x:auto">';
    for (var i = 0; i < FLOW_STEPS.length; i++) {
      var cls = i < step ? 'badge verified' : (i === step ? 'badge running' : 'badge');
      h += '<span class="' + cls + '" style="flex:0 0 auto">' + (i + 1) + '.' + esc(FLOW_STEPS[i]) + '</span>';
    }
    h += '</div></div>';
    return h;
  }

  // ---------- 项目列表页 ----------
  function renderProjects() {
    var projects = store.getProjects();
    var h = '';
    h += '<div class="card">' +
      '<div class="row between"><h2 style="margin:0">新建复盘项目</h2>' +
      '<button class="btn sm ghost" data-act="seed">载入示例</button></div>' +
      '<div style="margin-top:10px">' +
      '<label class="field"><span>标题</span>' +
      '<input type="text" id="np-title" placeholder="例：剪辑工具新手 10 分钟出片体验"></label>' +
      '<label class="field"><span>模板</span><select id="np-template">' +
      '<option value="light">轻量（目标 → 结果 → 改进）</option>' +
      '<option value="standard">标准（完整四层 + 横向对比）</option></select></label>' +
      '<label class="field"><span>参与人（逗号分隔）</span>' +
      '<input type="text" id="np-participants" placeholder="张三、李四"></label>' +
      '<button class="btn primary block" data-act="new-project">创建项目</button>' +
      '</div></div>';

    if (!projects.length) {
      h += '<div class="empty"><div class="e-t">还没有复盘项目</div>' +
        '<div>从一个模糊的愿望开始，把它翻译成可检验的标准。<br>' +
        '<button class="btn primary" style="margin-top:12px" data-act="seed">载入示例数据</button></div></div>';
      return h;
    }

    h += '<h1 class="page-title">复盘项目（' + projects.length + '）</h1>';
    for (var i = 0; i < projects.length; i++) {
      var p = projects[i];
      var steps = 0;
      if (p.goal.versions.length) steps++;
      if (p.results.length) steps++;
      if (p.facts.length) steps++;
      if (p.causes.length) steps++;
      if (p.actions.length) steps++;
      var pct = Math.round(steps / 5 * 100);
      var st = p.status === 'running' ? 'running' : (p.status === 'archived' ? 'archived' : 'draft');
      var stTxt = p.status === 'running' ? '进行中' : (p.status === 'archived' ? '已归档' : '草稿');
      h += '<button class="proj-card" data-act="open-project" data-id="' + esc(p.id) + '">' +
        '<div class="row between"><span class="t">' + esc(p.title) + '</span>' +
        '<span class="badge ' + st + '">' + stTxt + '</span></div>' +
        '<div class="meta">' +
        (p.template === 'standard' ? '标准模板' : '轻量模板') + ' · ' +
        (p.participants.length ? esc(p.participants.join('、')) : '无参与人') + ' · ' +
        '更新于 ' + fmtTime(p.updatedAt) + '</div>' +
        '<div class="progress"><i style="width:' + pct + '%"></i></div>' +
        '<div class="meta">完成度 ' + steps + '/5 步</div>' +
        '</button>';
    }
    return h;
  }

  // ---------- 目标 Tab ----------
  function renderGoal(project) {
    var h = '';
    h += renderFlow(project);
    var cur = store.getCurrentGoal(project.id);
    var versions = store.getGoalVersions(project.id);

    h += '<div class="card">' +
      '<div class="row between"><h2 style="margin:0">目标三层</h2>' +
      '<div class="row">' +
      '<button class="btn primary sm" data-act="wizard">翻译愿望为验证标准</button>' +
      '<button class="btn sm" data-act="revise">生成修订版本</button>' +
      '</div></div>';

    if (!cur) {
      h += '<div class="empty"><div class="e-t">还没有目标</div>' +
        '<div>点「翻译愿望为验证标准」，用向导把「我要很爽」变成可检验的标准。</div>' +
        '<button class="btn primary" style="margin-top:12px" data-act="wizard">开始翻译</button></div>';
      h += '</div>';
      return h;
    }

    h += '<div class="sub-card" style="margin-top:10px">' +
      '<div class="muted small">第 1 层 · 原始愿望</div>' +
      '<div>' + esc(cur.originalWish || '（未填写）') + '</div></div>';
    h += '<div class="sub-card">' +
      '<div class="muted small">依据</div><div>' + esc(cur.basis || '（未填写）') + '</div></div>';
    h += '<div class="sub-card">' +
      '<div class="muted small">第 2 层 · 场景假设</div>' +
      '<div>' + esc(cur.scenarioHypothesis || '（未填写）') + '</div></div>';
    h += '<div class="sub-card">' +
      '<div class="muted small">第 3 层 · 本次验证标准</div>';
    if (cur.verificationCriteria && cur.verificationCriteria.length) {
      for (var i = 0; i < cur.verificationCriteria.length; i++) {
        var c = cur.verificationCriteria[i];
        h += '<div style="margin-top:6px">· ' + esc(c.text) +
          (c.metric ? ' <span class="badge">' + esc(c.metric) + '</span>' : '') +
          (c.threshold ? ' <span class="badge running">' + esc(c.threshold) + '</span>' : '') +
          '</div>';
      }
    } else {
      h += '<div class="badge alert">尚无验证标准</div>';
    }
    h += '</div>';
    h += '<div class="sub-card"><div class="muted small">调整规则（满足什么条件就修正目标）</div>' +
      '<div>' + esc(cur.adjustmentRule || '（未填写）') + '</div></div>';
    if (cur.note) {
      h += '<div class="sub-card"><div class="muted small">本次修订说明</div><div>' + esc(cur.note) + '</div></div>';
    }
    h += '</div>';

    // 版本链
    h += '<div class="card"><h2>版本链（' + versions.length + '）</h2>';
    if (versions.length <= 1) {
      h += '<div class="hint">尚无修订版本。当目标被修正时，旧版本会保留在这里，报告中同时展示原目标与修正目标。</div>';
    } else {
      h += '<div class="hint">目标可修正：以下为全部历史版本，v' + cur.version + ' 为当前版本。</div>';
      for (var v = 0; v < versions.length; v++) {
        var gv = versions[v];
        var isCur = gv.version === project.goal.currentVersion;
        h += '<div class="item"' + (isCur ? '' : ' style="opacity:.82"') + '>' +
          '<div class="row between"><span class="item-t">v' + gv.version +
          (isCur ? ' <span class="badge running">当前</span>' : ' <span class="badge revised">已修正</span>') +
          '</span><span class="muted small">' + fmtTime(gv.createdAt) + '</span></div>' +
          '<div class="kv"><b>愿望：</b>' + esc(gv.originalWish) + '</div>' +
          '<div class="kv"><b>场景：</b>' + esc(gv.scenarioHypothesis) + '</div>' +
          '<div class="kv"><b>标准：</b>' + esc(gv.verificationCriteria.map(function (x) { return x.text; }).join('；') || '（无）') + '</div>' +
          (gv.note ? '<div class="kv"><b>说明：</b>' + esc(gv.note) + '</div>' : '') +
          (gv.revisedFrom ? '<div class="kv muted small">修订自 v' + gv.revisedFrom + '</div>' : '') +
          '</div>';
      }
    }
    h += '</div>';
    return h;
  }

  // ---------- 结果 Tab ----------
  function renderResult(project) {
    var h = '';
    h += '<div class="card"><h2>独立提交结果</h2>' +
      '<div class="hint">多人可各自提交一条结果；最终以最新一条为准。</div>' +
      '<label class="field" style="margin-top:10px"><span>实际结果</span>' +
      '<textarea id="r-actual" placeholder="例：5 人中 3 人完成，导出失败率 12%"></textarea></label>' +
      '<div id="r-metrics"></div>' +
      '<button class="btn sm" data-act="add-metric" style="margin-bottom:10px">+ 添加关键指标</button>' +
      '<label class="field"><span>目标差距</span>' +
      '<textarea id="r-gap" placeholder="例：完成率差 20 个百分点"></textarea></label>' +
      '<label class="field"><span>提交人</span><input type="text" id="r-author" placeholder="姓名"></label>' +
      '<button class="btn primary block" data-act="add-result">提交结果</button></div>';

    if (!project.results.length) {
      h += '<div class="empty"><div class="e-t">还没有结果</div><div>提交实际结果与关键指标，系统会据此计算目标差距。</div></div>';
      return h;
    }

    h += '<h1 class="page-title">结果记录（' + project.results.length + '）</h1>';
    for (var i = 0; i < project.results.length; i++) {
      var r = project.results[i];
      var latest = i === project.results.length - 1;
      h += '<div class="item">' +
        '<div class="row between"><span class="item-t">' + (latest ? '最新提交' : '历史提交') + '</span>' +
        '<span class="muted small">' + fmtTime(r.createdAt) + ' · ' + esc(r.author || '未署名') + '</span></div>' +
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
          '<button class="btn sm" data-act="merge-result" data-id="' + esc(r.id) + '">以我的提交为准</button></div>';
      }
      h += '</div>';
    }
    if (project.results.length > 1) {
      h += '<div class="alert-box">存在 ' + project.results.length + ' 条独立提交。导出报告以最新一条为准；' +
        '若需以其它提交为准，点对应记录上的「以我的提交为准」。</div>';
    }
    return h;
  }

  // ---------- 事实 Tab ----------
  function renderFacts(project) {
    var h = '';
    h += '<div class="card"><h2>独立提交事实</h2>' +
      '<div class="hint">事实 / 判断 / 情绪分开记录；多人独立提交后可合并为一条主线事实，来源全部保留。</div>' +
      '<div style="margin-top:10px">' +
      '<label class="field"><span>类型</span><select id="f-kind">' +
      '<option value="fact">事实（可观测）</option>' +
      '<option value="judgment">判断（推断）</option>' +
      '<option value="emotion">情绪（感受）</option></select></label>' +
      '<label class="field"><span>内容</span><textarea id="f-content" placeholder="例：用户在模板入口停留超过 40 秒后退出"></textarea></label>' +
      '<label class="field"><span>时间点</span><input type="text" id="f-time" value="' + esc(nowLocalInput()) + '" placeholder="2026-11-16 14:30"></label>' +
      '<label class="field"><span>来源（谁 / 哪次观察）</span><input type="text" id="f-source" placeholder="例：李四（用户测试）"></label>' +
      '<label class="field"><span>证据（录屏 / 访谈 / 数据）</span><input type="text" id="f-evidence" placeholder="例：录屏 R-03"></label>' +
      '<div class="inline-2">' +
      '<label class="field"><span>置信度</span><select id="f-conf">' +
      '<option value="low">低</option><option value="medium" selected>中</option><option value="high">高</option>' +
      '</select></label>' +
      '<label class="field"><span>状态</span><select id="f-status">' +
      '<option value="pending">待验证</option><option value="verified">已验证</option><option value="disputed">有争议</option>' +
      '</select></label>' +
      '</div>' +
      '<label class="field"><span>提交人</span><input type="text" id="f-author" placeholder="姓名"></label>' +
      '<button class="btn primary block" data-act="add-fact">提交事实</button>' +
      '</div></div>';

    var mains = project.facts.filter(function (f) { return !f.mergedInto; });
    mains.sort(function (a, b) { return String(a.timelineAt || '').localeCompare(String(b.timelineAt || '')); });

    if (!mains.length) {
      h += '<div class="empty"><div class="e-t">还没有事实</div><div>记录发生了什么，注明来源与证据。</div></div>';
      return h;
    }

    h += '<h1 class="page-title">时间线（' + mains.length + '）</h1>';
    var picked = 0;
    for (var i = 0; i < mains.length; i++) { if (selectedFacts[mains[i].id]) picked++; }

    if (mains.length > 1) {
      h += '<div class="card" style="padding:12px 14px">' +
        '<div class="row between"><span class="small">已选 <b>' + picked + '</b> 条</span>' +
        '<div class="row">' +
        '<button class="btn sm" data-act="pick-all-facts">全选</button>' +
        '<button class="btn sm" data-act="clear-facts">清空</button>' +
        '<button class="btn primary sm" data-act="merge-facts"' + (picked < 2 ? ' disabled' : '') + '>合并为一条主线</button>' +
        '</div></div>' +
        '<div class="hint" style="margin-top:8px">合并时选择其中一条作为主线，其余条目内容会作为「独立提交来源」保留在主线事实下。</div>' +
        '<label class="field" style="margin-top:10px"><span>主线事实</span><select id="merge-main">' +
        '<option value="">（选择一条作为主线）</option>';
      for (var mi = 0; mi < mains.length; mi++) {
        if (!selectedFacts[mains[mi].id]) continue;
        h += '<option value="' + esc(mains[mi].id) + '"' + (factMergeMain === mains[mi].id ? ' selected' : '') + '>' +
          esc(String(mains[mi].timelineAt || '').slice(5) + ' · ' + mains[mi].content.slice(0, 24)) + '</option>';
      }
      h += '</select></label></div>';
    }

    h += '<div class="timeline">';
    for (var k = 0; k < mains.length; k++) {
      var f = mains[k];
      var kindCls = f.kind === 'judgment' ? 'judgment' : (f.kind === 'emotion' ? 'emotion' : 'fact');
      var kindTxt = f.kind === 'judgment' ? '判断' : (f.kind === 'emotion' ? '情绪' : '事实');
      h += '<div class="tl-item">' +
        '<div class="tl-time">' + esc(f.timelineAt || '未标时间') + ' · ' + esc(f.author || '未署名') + '</div>' +
        '<div class="tl-body">' +
        '<div class="row between" style="align-items:flex-start">' +
        '<span class="grow"><span class="badge ' + kindCls + '">' + kindTxt + '</span> ' +
        '<span class="badge ' + f.confidence + '">置信度' + (f.confidence === 'high' ? '高' : f.confidence === 'low' ? '低' : '中') + '</span> ' +
        '<span class="badge ' + f.status + '">' + (f.status === 'verified' ? '已验证' : f.status === 'disputed' ? '有争议' : '待验证') + '</span></span>' +
        '<label class="sel-wrap"><input type="checkbox" class="sel-box" data-act="pick-fact" data-id="' + esc(f.id) + '"' +
        (selectedFacts[f.id] ? ' checked' : '') + '></label>' +
        '</div>' +
        '<div style="margin-top:6px;white-space:pre-wrap">' + esc(f.content) + '</div>' +
        '<div class="kv"><b>来源：</b>' + esc(f.source || '（未填写）') + '</div>' +
        '<div class="kv"><b>证据：</b>' + esc(f.evidence || '（未填写）') + '</div>';

      if (f.contributors && f.contributors.length) {
        h += '<div class="sub-card"><div class="muted small">已合并 ' + f.contributors.length + ' 条独立提交（来源保留）：</div>';
        for (var c = 0; c < f.contributors.length; c++) {
          var ct = f.contributors[c];
          h += '<div style="margin-top:5px">· ' + esc(ct.content) +
            '<div class="muted small">来源：' + esc(ct.author || '（未填写）') +
            (ct.evidence ? '　证据：' + esc(ct.evidence) : '') + '</div></div>';
        }
        h += '</div>';
      }

      h += '<div class="row" style="margin-top:8px">' +
        '<button class="btn sm" data-act="fact-status" data-id="' + esc(f.id) + '" data-status="verified">标为已验证</button>' +
        '<button class="btn sm warn" data-act="fact-status" data-id="' + esc(f.id) + '" data-status="disputed">标为有争议</button>' +
        '<button class="btn sm ghost" data-act="fact-status" data-id="' + esc(f.id) + '" data-status="pending">待验证</button>' +
        '</div>';
      h += '</div></div>';
    }
    h += '</div>';
    return h;
  }

  // ---------- 原因与改进 Tab ----------
  function renderCauses(project) {
    var h = '';
    var facts = project.facts.filter(function (f) { return !f.mergedInto; });

    h += '<div class="card"><h2>归因</h2>' +
      '<div class="hint">原因分层，并关联到具体事实。层级：目标翻译 / 执行 / 资源 / 外部 / 其他。</div>' +
      '<div style="margin-top:10px">' +
      '<label class="field"><span>层级</span><select id="c-layer">' +
      '<option value="目标翻译">目标翻译（愿望→标准的翻译问题）</option>' +
      '<option value="执行">执行（做错了/没做）</option>' +
      '<option value="资源">资源（缺人缺钱缺工具）</option>' +
      '<option value="外部">外部（环境/依赖/市场）</option>' +
      '<option value="其他">其他</option></select></label>' +
      '<label class="field"><span>原因描述</span><textarea id="c-text" placeholder="例：模板入口过多导致新手在选择模板时卡住"></textarea></label>' +
      '<div class="muted small">关联事实（可多选）</div><div id="c-facts" class="opts" style="margin-top:6px"></div>' +
      '<button class="btn primary block" data-act="add-cause" style="margin-top:10px">添加原因</button>' +
      '</div></div>';

    if (!project.causes.length) {
      h += '<div class="empty"><div class="e-t">还没有归因</div><div>从事实出发判断原因，并分层。</div></div>';
    } else {
      h += '<h1 class="page-title">原因（' + project.causes.length + '）</h1>';
      for (var i = 0; i < project.causes.length; i++) {
        var c = project.causes[i];
        h += '<div class="item">' +
          '<div class="row between"><span class="badge layer">' + esc(c.layer) + '</span>' +
          '<span class="muted small">' + fmtTime(c.createdAt) + '</span></div>' +
          '<div class="kv" style="font-size:14px;color:var(--text)">' + esc(c.text) + '</div>';
        if (c.factIds && c.factIds.length) {
          h += '<div class="muted small" style="margin-top:6px">关联事实：</div>';
          for (var fi = 0; fi < c.factIds.length; fi++) {
            var fid = c.factIds[fi];
            var ft = null;
            for (var q = 0; q < project.facts.length; q++) {
              if (project.facts[q].id === fid) ft = project.facts[q];
            }
            if (ft) h += '<div class="kv">· ' + esc(ft.content) + '</div>';
          }
        }
        h += '<div class="row end" style="margin-top:8px">' +
          '<button class="btn sm ghost" data-act="del-cause" data-id="' + esc(c.id) + '">删除</button></div>';
        h += '</div>';
      }
    }

    // ---- 改进项 ----
    h += '<hr class="sep">';
    h += '<div class="card"><h2>改进项</h2>' +
      '<div class="hint">每条改进必须有验证指标；未填写验证结果不允许关闭。</div>' +
      '<div style="margin-top:10px">' +
      '<label class="field"><span>改进内容</span><input type="text" id="a-title" placeholder="例：优化模板入口，默认推荐一个模板"></label>' +
      '<div class="inline-2">' +
      '<label class="field"><span>负责人</span><input type="text" id="a-owner" placeholder="张三"></label>' +
      '<label class="field"><span>截止日期</span><input type="date" id="a-due"></label>' +
      '</div>' +
      '<label class="field"><span>验证指标（如何证明生效）</span>' +
      '<input type="text" id="a-metric" placeholder="例：模板入口到首次成功导出的中位耗时 ≤ 30 秒"></label>' +
      '<label class="field"><span>关联原因</span><select id="a-cause"><option value="">（不关联）</option>';
    for (var ci = 0; ci < project.causes.length; ci++) {
      h += '<option value="' + esc(project.causes[ci].id) + '">' + esc(project.causes[ci].layer + '：' + project.causes[ci].text.slice(0, 20)) + '</option>';
    }
    h += '</select></label>' +
      '<button class="btn primary block" data-act="add-action">添加改进</button>' +
      '</div></div>';

    if (!project.actions.length) {
      h += '<div class="empty"><div class="e-t">还没有改进项</div><div>每个原因都应落到一条可验证的改进上。</div></div>';
      return h;
    }

    h += '<h1 class="page-title">改进清单（' + project.actions.length + '）</h1>';
    for (var a = 0; a < project.actions.length; a++) {
      var ac = project.actions[a];
      var stTxt = ac.status === 'verified' ? '已验证' : ac.status === 'failed' ? '未生效' : ac.status === 'doing' ? '进行中' : '未开始';
      h += '<div class="item">' +
        '<div class="row between"><span class="item-t grow">' + esc(ac.title) + '</span>' +
        '<span class="badge ' + esc(ac.status) + '">' + stTxt + '</span></div>' +
        '<div class="kv"><b>负责人：</b>' + esc(ac.owner || '（未指定）') +
        (ac.due ? '　<b>截止：</b>' + esc(ac.due) : '') + '</div>' +
        '<div class="kv"><b>验证指标：</b>' + esc(ac.verifyMetric || '（未填写）') + '</div>';
      if (ac.verifyResult) h += '<div class="kv"><b>验证结果：</b>' + esc(ac.verifyResult) + '</div>';
      if (ac.status !== 'verified') {
        h += '<div class="row" style="margin-top:8px">' +
          (ac.status === 'open' ? '<button class="btn sm" data-act="act-doing" data-id="' + esc(ac.id) + '">开始</button>' : '') +
          '<button class="btn sm ok" data-act="act-close" data-id="' + esc(ac.id) + '">验证并关闭</button>' +
          '<button class="btn sm warn" data-act="act-failed" data-id="' + esc(ac.id) + '">标记未生效</button>' +
          '</div>';
      } else {
        h += '<div class="row" style="margin-top:8px"><span class="muted small">已于 ' + fmtTime(ac.closedAt) + ' 验证关闭</span></div>';
      }
      h += '</div>';
    }
    return h;
  }

  // ---------- 对比 Tab ----------
  function renderCompare(project) {
    var h = '';
    var all = store.getProjects().filter(function (p) { return p.id !== project.id; });
    var linked = project.linkedProjectIds || [];

    h += '<div class="card"><h2>关联历史复盘</h2>' +
      '<div class="hint">选择要横向对比的历史复盘，可多选。系统会高亮<b>重复原因</b>与<b>未生效改进</b>。</div>';
    if (!all.length) {
      h += '<div class="hint" style="margin-top:10px">暂无可对比的其他项目。</div>';
    } else {
      h += '<div class="opts" style="margin-top:10px">';
      for (var i = 0; i < all.length; i++) {
        var on = linked.indexOf(all[i].id) >= 0;
        h += '<button class="opt' + (on ? ' on' : '') + '" data-act="toggle-link" data-id="' + esc(all[i].id) + '">' +
          (on ? '✓ ' : '') + esc(all[i].title) + '</button>';
      }
      h += '</div>';
    }
    h += '</div>';

    if (!linked.length) {
      h += '<div class="empty"><div class="e-t">尚未关联历史复盘</div>' +
        '<div>横向对比能发现「同一个坑踩两次」——重复原因与上次未生效的改进。</div></div>';
      return h;
    }

    var anyRep = false, anyIneff = false;
    for (var li = 0; li < linked.length; li++) {
      var other = store.getProject(linked[li]);
      if (!other) continue;
      var cmp = compare.compareProjects(project.id, other.id);
      if (!cmp) continue;
      if (cmp.hasRepeat) anyRep = true;
      if (cmp.hasIneffective) anyIneff = true;

      h += '<div class="card"><div class="row between"><h2 style="margin:0">' + esc(other.title) + '</h2>' +
        '<button class="btn sm ghost" data-act="toggle-link" data-id="' + esc(other.id) + '">取消关联</button></div>';

      h += '<div class="sub-card"><div class="muted small">目标差异</div>' +
        '<div class="kv">本次愿望：' + esc(cmp.goalDiff.currentWish || '—') + '</div>' +
        '<div class="kv">上次愿望：' + esc(cmp.goalDiff.otherWish || '—') + '</div>' +
        '<div class="kv">本次场景：' + esc(cmp.goalDiff.currentScenario || '—') + '</div>' +
        '<div class="kv">上次场景：' + esc(cmp.goalDiff.otherScenario || '—') +
        (cmp.goalDiff.sameScenario ? ' <span class="badge alert">场景假设未变</span>' : '') + '</div>' +
        '</div>';

      h += '<div class="sub-card"><div class="muted small">重复原因</div>';
      if (cmp.repeatedCauses.length) {
        for (var rc = 0; rc < cmp.repeatedCauses.length; rc++) {
          var pair = cmp.repeatedCauses[rc];
          h += '<div class="item highlight" style="margin-top:8px">' +
            '<div class="hl-tag">重复原因 · 相似度 ' + Math.round(pair.score * 100) + '% · ' + esc(pair.layer) + '</div>' +
            '<div class="kv">本次：' + esc(pair.causeA.text) + '</div>' +
            '<div class="kv">上次：' + esc(pair.causeB.text) + '</div>' +
            '</div>';
        }
      } else {
        h += '<div class="kv">未发现重复原因</div>';
      }
      h += '</div>';

      h += '<div class="sub-card"><div class="muted small">未生效改进（来自上次）</div>';
      if (cmp.ineffectiveActions.length) {
        for (var ic = 0; ic < cmp.ineffectiveActions.length; ic++) {
          var ia = cmp.ineffectiveActions[ic];
          var ast = ia.action.status === 'failed' ? '未生效' : ia.action.status === 'doing' ? '进行中' : '未开始';
          h += '<div class="item highlight" style="margin-top:8px">' +
            '<div class="hl-tag">未生效改进 · ' + esc(ast) + '</div>' +
            '<div class="kv">' + esc(ia.action.title) + '</div>' +
            '<div class="kv">负责人：' + esc(ia.action.owner || '—') +
            (ia.action.due ? '　截止：' + esc(ia.action.due) : '') + '</div>' +
            '<div class="kv">验证指标：' + esc(ia.action.verifyMetric || '（未填写）') + '</div>' +
            '</div>';
        }
      } else {
        h += '<div class="kv">上次改进均已验证生效</div>';
      }
      h += '</div></div>';
    }

    if (!anyRep && !anyIneff) {
      h += '<div class="alert-box ok">对比结果：没有发现重复原因，也没有未生效的改进。继续保持。</div>';
    } else {
      h += '<div class="alert-box">对比结果：' +
        (anyRep ? '存在<b>重复原因</b>' : '无重复原因') + '；' +
        (anyIneff ? '存在<b>未生效改进</b>' : '无未生效改进') + '。请在本次改进中重点处理。</div>';
    }
    return h;
  }

  // ---------- 导出 Tab ----------
  function renderExport(project) {
    var md = exporter.buildMarkdown(project, store.getProjects());
    var sum = exporter.buildSummary(project);
    lastMarkdown = md;
    lastSummary = sum;

    var h = '';
    h += '<div class="card"><h2>Markdown 完整报告</h2>' +
      '<div class="hint">包含目标版本链（原目标与修正目标对照）、结果、事实时间线、分层原因、改进项表格与横向对比。</div>' +
      '<div class="row" style="margin-top:10px">' +
      '<button class="btn primary" data-act="save-md">写入文件</button>' +
      '<button class="btn" data-act="share-md">分享</button>' +
      '<button class="btn ghost" data-act="copy-md">复制</button>' +
      '</div>' +
      '<div class="md" style="margin-top:10px">' + esc(md) + '</div></div>';

    h += '<div class="card"><h2>摘要</h2>' +
      '<div class="row" style="margin-bottom:10px">' +
      '<button class="btn sm" data-act="share-sum">分享摘要</button>' +
      '<button class="btn sm ghost" data-act="copy-sum">复制摘要</button>' +
      '</div>' +
      '<div class="sub-card" style="white-space:pre-wrap">' + esc(sum) + '</div></div>';

    return h;
  }

  // ---------- 渲染 ----------
  function render() {
    route = parseHash();
    renderAppbar();
    var view = $('view');
    if (!view) return;

    if (route.view === 'projects') {
      view.innerHTML = renderProjects();
    } else {
      var p = store.getProject(route.id);
      if (!p) {
        view.innerHTML = '<div class="empty"><div class="e-t">项目不存在</div>' +
          '<button class="btn primary" style="margin-top:12px" data-act="back">返回项目列表</button></div>';
        renderTabbar();
        return;
      }
      var h = '';
      if (route.tab === 'goal') h = renderGoal(p);
      else if (route.tab === 'result') h = renderResult(p);
      else if (route.tab === 'facts') h = renderFacts(p);
      else if (route.tab === 'causes') h = renderCauses(p);
      else if (route.tab === 'compare') h = renderCompare(p);
      else h = renderExport(p);
      view.innerHTML = h;
    }
    renderTabbar();
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

  // ---------- 关闭改进弹窗（验收 C 的 UI 拦截） ----------
  function openCloseDialog(action, targetStatus) {
    var host = $('modal-root');
    if (!host) return;
    var isFail = targetStatus === 'failed';
    host.innerHTML =
      '<div class="modal-mask"><div class="modal" style="max-width:460px">' +
      '<h3>' + (isFail ? '记录未生效结论' : '验证并关闭改进') + '</h3>' +
      '<div class="modal-sub">' + esc(action.title) + '</div>' +
      '<div class="alert-box">改进项未经验证不得关闭：验证指标与验证结果都必须填写。</div>' +
      '<label class="field"><span>验证指标</span>' +
      '<input type="text" id="cl-metric" value="' + esc(action.verifyMetric || '') + '"></label>' +
      '<label class="field"><span>验证结果（必填）</span>' +
      '<textarea id="cl-result" placeholder="' +
      (isFail ? '例：11-18 复测，中位耗时 52 秒，仍高于 30 秒阈值，未生效' : '例：11-18 复测，中位耗时 24 秒，低于 30 秒阈值') +
      '"></textarea></label>' +
      '<div class="alert-box err" id="cl-err" style="display:none"></div>' +
      '<div class="modal-foot">' +
      '<button class="btn ghost" data-act="cl-cancel">取消</button>' +
      '<button class="btn ' + (isFail ? 'warn' : 'primary') + '" data-act="cl-ok" data-id="' + esc(action.id) +
      '" data-target="' + (isFail ? 'failed' : 'verified') + '">' + (isFail ? '记录为未生效' : '确认关闭') + '</button>' +
      '</div></div></div>';
  }

  function showCloseError(msg) {
    var box = $('cl-err');
    if (!box) { toast(msg, 'err'); return; }
    box.style.display = 'block';
    box.className = 'alert-box err';
    box.textContent = msg;
  }

  // ---------- 事件绑定 ----------
  function bind() {
    var view = $('view');
    var modal = $('modal-root');

    document.addEventListener('click', function (e) {
      var el = e.target;
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
      if (actEl === 'back') { go('#/projects'); return; }
      if (actEl === 'tab') {
        var tab = el.getAttribute('data-tab');
        if (route.view === 'project') go('#/project/' + route.id + '/' + tab);
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
        var metric = ($('cl-metric') || {}).value || '';
        var result = ($('cl-result') || {}).value || '';
        var target = el.getAttribute('data-target') || 'verified';
        var aid = id;
        var act = null;
        var all = store.getProjects();
        for (var i = 0; i < all.length; i++) {
          for (var j = 0; j < all[i].actions.length; j++) {
            if (all[i].actions[j].id === aid) act = all[i].actions[j];
          }
        }
        if (!act) { closeModal(); toast('改进项不存在', 'err'); return; }
        if (metric.trim() && metric.trim() !== act.verifyMetric) {
          store.updateAction(aid, { verifyMetric: metric.trim() });
        }
        var res = store.closeAction(aid, result, target);
        if (!res.ok) {
          // 拦截：未填写验证指标或验证结果，不允许关闭（验收 C）
          showCloseError(res.error);
          return;
        }
        closeModal();
        notify(target === 'failed' ? '已记录为未生效' : '改进项已验证关闭', 'ok');
        return;
      }

      // --- 项目列表 ---
      if (actEl === 'seed') {
        var r = store.seedExample();
        if (r && r.ok) {
          notify(r.created ? '示例数据已载入' : '示例数据已存在，直接打开即可', 'ok');
          go('#/project/' + r.project.id + '/goal');
        } else {
          notify('载入示例失败', 'err');
        }
        return;
      }
      if (actEl === 'new-project') {
        var title = ($('np-title') || {}).value || '';
        if (!title.trim()) { toast('请填写项目标题', 'err'); return; }
        var tpl = ($('np-template') || {}).value || 'light';
        var parts = (($('np-participants') || {}).value || '').split(/[,，、;；\s]+/).filter(function (x) { return x; });
        var np = store.createProject({ title: title.trim(), template: tpl, participants: parts, status: 'draft' });
        if ($('np-title')) $('np-title').value = '';
        if ($('np-participants')) $('np-participants').value = '';
        notify('项目已创建', 'ok');
        go('#/project/' + np.id + '/goal');
        return;
      }
      if (actEl === 'open-project') {
        go('#/project/' + id + '/goal');
        return;
      }

      // --- 目标 ---
      if (actEl === 'wizard') {
        R.wizard.open(route.id, {
          onDone: function (info) {
            notify('目标已写入（v' + info.criteria.length + ' 条验证标准）', 'ok');
            go('#/project/' + info.projectId + '/goal');
          }
        });
        return;
      }
      if (actEl === 'revise') {
        R.wizard.open(route.id, {
          isRevision: true,
          onDone: function (info) {
            notify('已生成修订版本，旧版本已保留', 'ok');
            go('#/project/' + info.projectId + '/goal');
          }
        });
        return;
      }

      // --- 结果 ---
      if (actEl === 'add-metric') {
        pendingMetrics.push({ name: '', value: '', target: '' });
        renderPendingMetrics();
        return;
      }
      if (actEl === 'pm-del') {
        var di = parseInt(el.getAttribute('data-i'), 10);
        if (!isNaN(di)) { pendingMetrics.splice(di, 1); renderPendingMetrics(); }
        return;
      }
      if (actEl === 'add-result') {
        var actual = ($('r-actual') || {}).value || '';
        var gap = ($('r-gap') || {}).value || '';
        var author = ($('r-author') || {}).value || '';
        if (!actual.trim()) { toast('请填写实际结果', 'err'); return; }
        var metrics = pendingMetrics.filter(function (m) { return String(m.name || '').trim(); });
        store.addResult(route.id, { actual: actual, gap: gap, author: author, metrics: metrics });
        pendingMetrics = [];
        notify('结果已提交', 'ok');
        return;
      }
      if (actEl === 'merge-result') {
        confirmBox('以这条提交为准，其余提交将被合并掉。', function () {
          var mr = store.mergeResults(route.id, id);
          if (mr.ok) notify('已合并，以该提交为准', 'ok');
          else notify(mr.error, 'err');
        });
        return;
      }

      // --- 事实 ---
      if (actEl === 'add-fact') {
        var content = ($('f-content') || {}).value || '';
        if (!content.trim()) { toast('请填写事实内容', 'err'); return; }
        store.addFact(route.id, {
          kind: ($('f-kind') || {}).value || 'fact',
          content: content,
          timelineAt: ($('f-time') || {}).value || '',
          source: ($('f-source') || {}).value || '',
          evidence: ($('f-evidence') || {}).value || '',
          confidence: ($('f-conf') || {}).value || 'medium',
          status: ($('f-status') || {}).value || 'pending',
          author: ($('f-author') || {}).value || ''
        });
        notify('事实已提交', 'ok');
        return;
      }
      if (actEl === 'pick-all-facts') {
        var p2 = store.getProject(route.id);
        p2.facts.forEach(function (f) { if (!f.mergedInto) selectedFacts[f.id] = true; });
        render();
        return;
      }
      if (actEl === 'clear-facts') {
        selectedFacts = {};
        factMergeMain = null;
        render();
        return;
      }
      if (actEl === 'merge-facts') {
        var ids = Object.keys(selectedFacts);
        var mainId = ($('merge-main') || {}).value || factMergeMain || ids[0];
        if (!mainId) { toast('请选择主线事实', 'err'); return; }
        var mr2 = store.mergeFacts(route.id, ids, mainId);
        if (mr2.ok) {
          selectedFacts = {};
          factMergeMain = null;
          notify('已合并 ' + mr2.merged + ' 条独立提交到主线事实，来源全部保留', 'ok');
        } else {
          notify(mr2.error, 'err');
        }
        return;
      }
      if (actEl === 'fact-status') {
        var st = el.getAttribute('data-status');
        store.updateFact(route.id, id, { status: st });
        notify('事实状态已更新', 'ok');
        return;
      }

      // --- 原因 ---
      if (actEl === 'add-cause') {
        var ctext = ($('c-text') || {}).value || '';
        if (!ctext.trim()) { toast('请填写原因描述', 'err'); return; }
        var chosen = [];
        var boxes = document.querySelectorAll('#c-facts input[type=checkbox]');
        for (var bi = 0; bi < boxes.length; bi++) {
          if (boxes[bi].checked) chosen.push(boxes[bi].getAttribute('data-fid'));
        }
        store.addCause(route.id, {
          layer: ($('c-layer') || {}).value || '其他',
          text: ctext.trim(),
          factIds: chosen
        });
        notify('原因已添加', 'ok');
        return;
      }
      if (actEl === 'del-cause') {
        confirmBox('确定删除这条原因？', function () {
          store.removeCause(route.id, id);
          notify('原因已删除', 'ok');
        });
        return;
      }

      // --- 改进 ---
      if (actEl === 'add-action') {
        var atitle = ($('a-title') || {}).value || '';
        if (!atitle.trim()) { toast('请填写改进内容', 'err'); return; }
        var ametric = ($('a-metric') || {}).value || '';
        if (!ametric.trim()) {
          toast('改进项必须填写验证指标，否则无法验证关闭', 'err');
          return;
        }
        store.addAction(route.id, {
          title: atitle.trim(),
          owner: ($('a-owner') || {}).value || '',
          due: ($('a-due') || {}).value || '',
          verifyMetric: ametric.trim(),
          causeId: ($('a-cause') || {}).value || null
        });
        notify('改进项已添加', 'ok');
        return;
      }
      if (actEl === 'act-doing') {
        var rd = store.updateAction(id, { status: 'doing' });
        if (!rd.ok) notify(rd.error, 'err');
        return;
      }
      if (actEl === 'act-close') {
        var target = null;
        var ps = store.getProjects();
        for (var ti = 0; ti < ps.length; ti++) {
          for (var tj = 0; tj < ps[ti].actions.length; tj++) {
            if (ps[ti].actions[j].id === id) target = ps[ti].actions[tj];
          }
        }
        if (target) openCloseDialog(target);
        return;
      }
      if (actEl === 'act-failed') {
        var tgt = null;
        var pfs = store.getProjects();
        for (var fi2 = 0; fi2 < pfs.length; fi2++) {
          for (var fj = 0; fj < pfs[fi2].actions.length; fj++) {
            if (pfs[fi2].actions[fj].id === id) tgt = pfs[fi2].actions[fj];
          }
        }
        if (tgt) openCloseDialog(tgt, 'failed');
        return;
      }

      // --- 对比 ---
      if (actEl === 'toggle-link') {
        var cur = store.getProject(route.id);
        if (cur.linkedProjectIds.indexOf(id) >= 0) {
          store.unlinkProject(route.id, id);
          notify('已取消关联', 'ok');
        } else {
          store.linkProject(route.id, id);
          notify('已关联', 'ok');
        }
        return;
      }

      // --- 导出 ---
      if (actEl === 'save-md') {
        var pj = store.getProject(route.id);
        var fname = (pj ? pj.title : 'Reflect') + '-复盘报告.md';
        fname = fname.replace(/[\\/:*?"<>|]/g, '_');
        saveFile(fname, lastMarkdown);
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

    // input 事件：临时指标行 & 原因关联事实
    document.addEventListener('input', function (e) {
      var el = e.target;
      var act = el.getAttribute ? el.getAttribute('data-act') : null;
      if (!act) return;
      if (act === 'pm-name' || act === 'pm-value' || act === 'pm-target') {
        var i = parseInt(el.getAttribute('data-i'), 10);
        if (isNaN(i) || !pendingMetrics[i]) return;
        if (act === 'pm-name') pendingMetrics[i].name = el.value;
        else if (act === 'pm-value') pendingMetrics[i].value = el.value;
        else pendingMetrics[i].target = el.value;
      }
    });

    // 事实多选的 change 事件（部分 WebView input 不触发 click 冒泡）
    document.addEventListener('change', function (e) {
      var el = e.target;
      var act = el.getAttribute ? el.getAttribute('data-act') : null;
      if (act === 'pick-fact') {
        var fid = el.getAttribute('data-id');
        if (el.checked) selectedFacts[fid] = true; else delete selectedFacts[fid];
        if (!el.checked && factMergeMain === fid) factMergeMain = null;
        render();
        return;
      }
    });

    // 合并主线选择
    document.addEventListener('change', function (e) {
      var el = e.target;
      if (el.id === 'merge-main') {
        factMergeMain = el.value || null;
        render();
      }
    });

    global.addEventListener('hashchange', function () { render(); });
  }

  // 渲染归因面板里的"关联事实"复选框
  function renderCauseFactPicker() {
    var host = $('c-facts');
    if (!host) return;
    var p = store.getProject(route.id);
    if (!p) return;
    var facts = p.facts.filter(function (f) { return !f.mergedInto; });
    if (!facts.length) { host.innerHTML = '<div class="muted small">暂无事实</div>'; return; }
    var h = '';
    for (var i = 0; i < facts.length; i++) {
      h += '<label class="opt" style="display:inline-flex;align-items:center;gap:6px;min-height:44px">' +
        '<input type="checkbox" class="sel-box" data-fid="' + esc(facts[i].id) + '">' +
        esc(String(facts[i].timelineAt || '').slice(5) + ' ' + facts[i].content.slice(0, 16)) +
        '</label>';
    }
    host.innerHTML = h;
  }

  // 在 causes tab 渲染后填充事实选择器
  var origRenderCauses = renderCauses;
  renderCauses = function (project) {
    var h = origRenderCauses(project);
    setTimeout(renderCauseFactPicker, 0);
    return h;
  };

  function start() {
    bind();
    render();
  }

  R.ui = {
    render: render,
    toast: toast,
    notify: notify,
    confirm: confirmBox,
    closeModal: closeModal,
    saveFile: saveFile,
    share: shareText,
    copyText: copyText,
    hasBridge: hasBridge
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(window);
