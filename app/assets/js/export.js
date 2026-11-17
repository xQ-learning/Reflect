/* Reflect · export.js
   导出：Markdown 完整报告 + 摘要。均为纯字符串函数，不触碰 DOM。 */
(function (global) {
  'use strict';

  var R = global.Reflect = global.Reflect || {};

  var TEMPLATE_CN = { light: '轻量', standard: '标准' };
  var PROJECT_STATUS_CN = { draft: '草稿', running: '进行中', archived: '已归档' };
  var ACTION_STATE_CN = { open: '待验证', verified: '已闭环', failed: '未生效' };

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function fmtTime(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function cell(s) {
    // Markdown 表格单元格：转义竖线与换行
    var v = String(s == null ? '' : s).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
    return v.trim() ? v : '—';
  }

  function projectById(allProjects, id) {
    if (!allProjects || !allProjects.length) return null;
    for (var i = 0; i < allProjects.length; i++) {
      if (allProjects[i].id === id) return allProjects[i];
    }
    return null;
  }

  function criteriaLines(list) {
    if (!list || !list.length) return ['（无）'];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i] || {};
      var txt = '- ' + (c.text || '');
      if (c.metric) txt += '　（指标：' + c.metric + '）';
      if (c.threshold) txt += '（阈值：' + c.threshold + '）';
      out.push(txt);
    }
    return out;
  }

  function goalBlock(v, title) {
    var out = [];
    out.push('### ' + title);
    out.push('');
    out.push('- **目标**：' + (v.originalWish || '（未填写）'));
    if (v.scenarioHypothesis) out.push('  - 场景：' + v.scenarioHypothesis);
    if (v.basis) out.push('  - 依据：' + v.basis);
    out.push('- **可验证的标准**：');
    var cs = criteriaLines(v.verificationCriteria);
    for (var i = 0; i < cs.length; i++) out.push('  ' + cs[i]);
    if (v.adjustmentRule) out.push('- 调整规则：' + v.adjustmentRule);
    if (v.note) out.push('- 修订说明：' + v.note);
    out.push('');
    return out;
  }

  // 完整 Markdown 报告
  function buildMarkdown(project, allProjects) {
    if (!project) return '';
    var L = [];
    var compare = R.compare;
    var store = R.store;

    L.push('# 复盘报告：' + (project.title || '未命名复盘'));
    L.push('');
    L.push('- 模板：' + (TEMPLATE_CN[project.template] || '轻量'));
    L.push('- 状态：' + (PROJECT_STATUS_CN[project.status] || '草稿'));
    L.push('- 参与人：' + ((project.participants && project.participants.length) ? project.participants.join('、') : '（未填写）'));
    L.push('- 创建时间：' + fmtTime(project.createdAt));
    L.push('- 更新时间：' + fmtTime(project.updatedAt));
    L.push('');

    // ---- 目标 ----
    L.push('## 一、目标');
    L.push('');
    var versions = (project.goal && project.goal.versions) ? project.goal.versions : [];
    var cur = null, first = null;
    if (versions.length) {
      first = versions[0];
      for (var i = 0; i < versions.length; i++) {
        if (versions[i].version === project.goal.currentVersion) cur = versions[i];
      }
      if (!cur) cur = versions[versions.length - 1];
    }

    if (!versions.length) {
      L.push('（尚未填写目标）');
      L.push('');
    } else {
      // 版本链
      L.push('### 版本链');
      L.push('');
      L.push('| 版本 | 状态 | 目标 | 场景 | 可验证的标准数 | 修订说明 | 时间 |');
      L.push('| --- | --- | --- | --- | --- | --- | --- |');
      for (var v = 0; v < versions.length; v++) {
        var gv = versions[v];
        var isCur = gv.version === project.goal.currentVersion;
        var state = isCur ? '当前版本' : '已修正';
        L.push('| v' + gv.version +
          ' | ' + state +
          ' | ' + cell(gv.originalWish) +
          ' | ' + cell(gv.scenarioHypothesis) +
          ' | ' + (gv.verificationCriteria ? gv.verificationCriteria.length : 0) +
          ' | ' + cell(gv.note) +
          ' | ' + fmtTime(gv.createdAt) + ' |');
      }
      L.push('');

      // 原目标 vs 修正目标对照
      if (versions.length > 1) {
        L.push('### 原目标与修正目标对照');
        L.push('');
        L.push('> **本次目标已修正。** 下表展示 v' + first.version + ' 原始目标与 v' + cur.version + ' 当前（修正后）目标的差异。');
        L.push('');
        L.push('| 维度 | v' + first.version + ' 原始目标 | v' + cur.version + ' 当前目标（已修正） |');
        L.push('| --- | --- | --- |');
        L.push('| 目标 | ' + cell(first.originalWish) + ' | ' + cell(cur.originalWish) + ' |');
        L.push('| 场景 | ' + cell(first.scenarioHypothesis) + ' | ' + cell(cur.scenarioHypothesis) + ' |');
        L.push('| 可验证的标准 | ' + cell(first.verificationCriteria.map(function (c) { return c.text; }).join('；')) +
          ' | ' + cell(cur.verificationCriteria.map(function (c) { return c.text; }).join('；')) + ' |');
        L.push('| 调整规则 | ' + cell(first.adjustmentRule) + ' | ' + cell(cur.adjustmentRule) + ' |');
        L.push('');
        L.push('**v' + first.version + ' 原始目标详情（已修正）**');
        L.push('');
        var b1 = goalBlock(first, 'v' + first.version + ' 原始目标');
        for (var g1 = 0; g1 < b1.length; g1++) L.push(b1[g1]);
      } else {
        var b2 = goalBlock(cur, 'v' + cur.version + ' 当前目标');
        for (var g2 = 0; g2 < b2.length; g2++) L.push(b2[g2]);
      }
    }

    // ---- 结果 ----
    L.push('## 二、结果');
    L.push('');
    var results = project.results || [];
    if (!results.length) {
      L.push('（尚未记录结果）');
      L.push('');
    } else {
      for (var r = 0; r < results.length; r++) {
        var res = results[r];
        L.push('### 结果 ' + (r + 1) + '　' + fmtTime(res.createdAt));
        L.push('');
        L.push('- 实际结果：' + (res.actual || '（未填写）'));
        L.push('- 目标差距：' + (res.gap || '（未填写）'));
        L.push('');
        if (res.metrics && res.metrics.length) {
          L.push('| 关键指标 | 实际值 | 目标值 |');
          L.push('| --- | --- | --- |');
          for (var m = 0; m < res.metrics.length; m++) {
            L.push('| ' + cell(res.metrics[m].name) + ' | ' + cell(res.metrics[m].value) + ' | ' + cell(res.metrics[m].target) + ' |');
          }
          L.push('');
        }
      }
    }

    // ---- 事实 ----
    L.push('## 三、事实');
    L.push('');
    var facts = (project.facts || []).filter(function (f) { return !f.mergedInto; });
    facts.sort(function (a, b) { return String(a.timelineAt || '').localeCompare(String(b.timelineAt || '')); });
    if (!facts.length) {
      L.push('（尚未记录事实）');
      L.push('');
    } else {
      L.push('| 时间 | 内容 | 关键 |');
      L.push('| --- | --- | --- |');
      for (var f = 0; f < facts.length; f++) {
        var fc = facts[f];
        L.push('| ' + cell(fc.timelineAt) +
          ' | ' + cell(fc.content) +
          ' | ' + (fc.key ? '★' : '') + ' |');
      }
      L.push('');
      var keyFacts = facts.filter(function (x) { return x.key; });
      if (keyFacts.length) {
        L.push('### 关键事实');
        L.push('');
        for (var kf = 0; kf < keyFacts.length; kf++) {
          L.push('- ' + (keyFacts[kf].content || '') +
            (keyFacts[kf].timelineAt ? '　（' + keyFacts[kf].timelineAt + '）' : ''));
        }
        L.push('');
      }
      var anyContrib = false;
      for (var fc2 = 0; fc2 < facts.length; fc2++) {
        if (facts[fc2].contributors && facts[fc2].contributors.length) { anyContrib = true; break; }
      }
      if (anyContrib) {
        L.push('### 合并的独立提交');
        L.push('');
        for (var fc3 = 0; fc3 < facts.length; fc3++) {
          var main = facts[fc3];
          if (!main.contributors || !main.contributors.length) continue;
          L.push('- **主线事实**：' + (main.content || ''));
          for (var ct = 0; ct < main.contributors.length; ct++) {
            var con = main.contributors[ct];
            L.push('  - 独立提交：' + (con.content || '') +
              '　时间：' + fmtTime(con.createdAt));
          }
        }
        L.push('');
      }
    }

    // ---- 原因 ----
    L.push('## 四、原因');
    L.push('');
    var causes = project.causes || [];
    if (!causes.length) {
      L.push('（尚未归因）');
      L.push('');
    } else {
      L.push('| 层级 | 原因 | 关联事实 |');
      L.push('| --- | --- | --- |');
      for (var c = 0; c < causes.length; c++) {
        var cs = causes[c];
        var linked = (cs.factIds || []).map(function (id) {
          for (var k = 0; k < facts.length; k++) { if (facts[k].id === id) return facts[k].content; }
          return '';
        }).filter(Boolean).join('；');
        L.push('| ' + cell(cs.layer) + ' | ' + cell(cs.text) + ' | ' + cell(linked) + ' |');
      }
      L.push('');
    }

    // ---- 改进项 ----
    L.push('## 五、改进项');
    L.push('');
    var actions = project.actions || [];
    if (!actions.length) {
      L.push('（尚未制定改进）');
      L.push('');
    } else {
      L.push('| 改进措施 | 状态 | 验证结论 |');
      L.push('| --- | --- | --- |');
      for (var a = 0; a < actions.length; a++) {
        var ac = actions[a];
        var statusText = ACTION_STATE_CN[ac.status] || ac.status;
        if (ac.status === 'open') statusText += '（**尚未闭环**）';
        var resText = ac.verifyResult ? ac.verifyResult : '（未填写）';
        if (ac.status === 'open') resText += '　——　**尚未闭环**';
        L.push('| ' + cell(ac.title) +
          ' | ' + statusText +
          ' | ' + cell(resText) + ' |');
      }
      L.push('');
      var open = actions.filter(function (x) { return x.status !== 'verified'; });
      if (open.length) {
        L.push('> 有 ' + open.length + ' 项改进尚未闭环。验证可以留到以后补——它常常要等一个周期，甚至在别的目标里才闭环。');
        L.push('');
      }
    }

    // ---- 横向对比 ----
    L.push('## 六、横向对比');
    L.push('');
    var linkedIds = project.linkedProjectIds || [];
    if (!linkedIds.length) {
      L.push('（未关联历史复盘）');
      L.push('');
    } else {
      for (var li = 0; li < linkedIds.length; li++) {
        var other = projectById(allProjects, linkedIds[li]);
        if (!other) {
          L.push('### ' + linkedIds[li] + '（项目不存在）');
          L.push('');
          continue;
        }
        L.push('### 与《' + other.title + '》对比');
        L.push('');
        var cmp = compare ? compare.compareProjects(project.id, other.id) : null;
        if (cmp) {
          L.push('- 目标愿望：本次「' + (cmp.goalDiff.currentWish || '—') + '」　上次「' + (cmp.goalDiff.otherWish || '—') + '」');
          L.push('- 场景假设：本次「' + (cmp.goalDiff.currentScenario || '—') + '」　上次「' + (cmp.goalDiff.otherScenario || '—') + '」' +
            (cmp.goalDiff.sameScenario ? '　（**场景假设未变**）' : ''));
          L.push('');
          L.push('**重复原因**');
          L.push('');
          if (cmp.repeatedCauses.length) {
            for (var rc = 0; rc < cmp.repeatedCauses.length; rc++) {
              var pair = cmp.repeatedCauses[rc];
              L.push('- ⚠️ **重复原因**（相似度 ' + Math.round(pair.score * 100) + '%）：' +
                '「' + pair.causeA.text + '」 ←→ 「' + pair.causeB.text + '」　（层级：' + pair.layer + '）');
            }
          } else {
            L.push('- （未发现重复原因）');
          }
          L.push('');
          L.push('**上次没闭环的改进**');
          L.push('');
          if (cmp.ineffectiveActions.length) {
            for (var ic = 0; ic < cmp.ineffectiveActions.length; ic++) {
              var ia = cmp.ineffectiveActions[ic];
              L.push('- ⚠️ **' + (ia.failed ? '未生效' : '待验证') + '**（来自《' + ia.projectTitle + '》）：' + ia.action.title +
                (ia.action.verifyResult ? '　验证结论：' + ia.action.verifyResult : ''));
            }
          } else {
            L.push('- （历史改进均已闭环）');
          }
          L.push('');
        }
      }
    }

    return L.join('\n');
  }

  // 简短摘要：目标一句话 + 差距 + 关键原因 + 首要改进 + 状态
  function buildSummary(project) {
    if (!project) return '';
    var store = R.store;
    var cur = store ? store.getCurrentGoal(project.id) : null;
    if (!cur && project.goal && project.goal.versions.length) cur = project.goal.versions[project.goal.versions.length - 1];

    var goalLine = cur
      ? ('目标：' + (cur.originalWish || '（未填写愿望）') +
        (cur.scenarioHypothesis ? '；场景假设：' + cur.scenarioHypothesis : '') +
        (cur.verificationCriteria && cur.verificationCriteria.length
          ? '；验证标准：' + cur.verificationCriteria[0].text : ''))
      : '目标：尚未定义';

    var result = (project.results || [])[(project.results || []).length - 1];
    var gapLine = result
      ? ('差距：' + (result.gap || '（未填写差距）'))
      : '差距：尚未记录结果';

    var causes = project.causes || [];
    var causeLine = causes.length
      ? ('关键原因：' + causes.map(function (c) { return '[' + c.layer + '] ' + c.text; }).join('；'))
      : '关键原因：尚未归因';

    var actions = project.actions || [];
    var pending = actions.filter(function (a) { return a.status !== 'verified'; });
    var actionLine;
    if (!actions.length) {
      actionLine = '首要改进：尚未制定';
    } else if (pending.length) {
      var p0 = pending[0];
      actionLine = '首要改进：' + p0.title + '（状态：' + (ACTION_STATE_CN[p0.status] || p0.status) + '，尚未闭环）';
    } else {
      actionLine = '首要改进：' + actions[0].title + '（已闭环）';
    }

    var statusLine = '状态：' + (PROJECT_STATUS_CN[project.status] || '草稿') +
      '　改进 ' + actions.filter(function (a) { return a.status === 'verified'; }).length + '/' + actions.length + ' 已闭环';

    return [goalLine, gapLine, causeLine, actionLine, statusLine].join('\n');
  }

  R.export = {
    buildMarkdown: buildMarkdown,
    buildSummary: buildSummary,
    fmtTime: fmtTime,
    esc: esc,
    ACTION_STATE_CN: ACTION_STATE_CN,
    PROJECT_STATUS_CN: PROJECT_STATUS_CN,
    TEMPLATE_CN: TEMPLATE_CN
  };
})(window);
