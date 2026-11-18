/* Reflect · export.js
   导出：Markdown 完整报告 + 摘要。均为纯字符串函数，不触碰 DOM。 */
(function (global) {
  'use strict';

  var R = global.Reflect = global.Reflect || {};

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

  function goalById(allGoals, id) {
    if (!allGoals || !allGoals.length) return null;
    for (var i = 0; i < allGoals.length; i++) {
      if (allGoals[i].id === id) return allGoals[i];
    }
    return null;
  }

  // 完整 Markdown 报告
  function buildMarkdown(goal, allGoals) {
    if (!goal) return '';
    var L = [];
    var compare = R.compare;

    L.push('# 复盘报告：' + (goal.goal.description || '未命名目标'));
    L.push('');
    L.push('- 创建时间：' + fmtTime(goal.createdAt));
    L.push('- 更新时间：' + fmtTime(goal.updatedAt));
    L.push('');

    // ---- 目标 ----
    L.push('## 一、目标');
    L.push('');
    L.push('- **目标**：' + (goal.goal.description || '（未填写）'));
    L.push('- **验证标准**：');
    if (goal.goal.criteria && goal.goal.criteria.length) {
      for (var c = 0; c < goal.goal.criteria.length; c++) {
        L.push('  - ' + goal.goal.criteria[c]);
      }
    } else {
      L.push('  - （无）');
    }
    L.push('');

    // ---- 结果 ----
    L.push('## 二、结果');
    L.push('');
    var results = goal.results || [];
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
    var facts = (goal.facts || []).slice().sort(function (a, b) {
      return String(a.timelineAt || '').localeCompare(String(b.timelineAt || ''));
    });
    if (!facts.length) {
      L.push('（尚未记录事实）');
      L.push('');
    } else {
      L.push('| 时间 | 内容 |');
      L.push('| --- | --- |');
      for (var f = 0; f < facts.length; f++) {
        L.push('| ' + cell(facts[f].timelineAt) + ' | ' + cell(facts[f].content) + ' |');
      }
      L.push('');
    }

    // ---- 原因 ----
    L.push('## 四、原因');
    L.push('');
    var causes = goal.causes || [];
    if (!causes.length) {
      L.push('（尚未归因）');
      L.push('');
    } else {
      L.push('| 原因 | 关联事实 |');
      L.push('| --- | --- |');
      for (var cs = 0; cs < causes.length; cs++) {
        var cause = causes[cs];
        var linked = (cause.factIds || []).map(function (id) {
          for (var k = 0; k < facts.length; k++) { if (facts[k].id === id) return facts[k].content; }
          return '';
        }).filter(Boolean).join('；');
        L.push('| ' + cell(cause.text) + ' | ' + cell(linked) + ' |');
      }
      L.push('');
    }

    // ---- 改进措施 ----
    L.push('## 五、改进措施');
    L.push('');
    var actions = goal.actions || [];
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
        L.push('| ' + cell(ac.title) + ' | ' + statusText + ' | ' + cell(resText) + ' |');
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
    var linkedIds = goal.linkedGoalIds || [];
    if (!linkedIds.length) {
      L.push('（未关联历史目标）');
      L.push('');
    } else {
      for (var li = 0; li < linkedIds.length; li++) {
        var other = goalById(allGoals, linkedIds[li]);
        if (!other) {
          L.push('### ' + linkedIds[li] + '（目标不存在）');
          L.push('');
          continue;
        }
        L.push('### 对比《' + (other.goal.description || '（无目标描述）') + '》');
        L.push('');
        var cmp = compare ? compare.compareGoals(goal.id, other.id) : null;
        if (!cmp) continue;

        L.push('**目标差异**');
        L.push('');
        L.push('- 本次目标：' + (cmp.goalDiff.currentDescription || '—'));
        L.push('- 上次目标：' + (cmp.goalDiff.otherDescription || '—'));
        L.push('- 本次验证标准：' + (cmp.goalDiff.currentCriteria || '—'));
        L.push('- 上次验证标准：' + (cmp.goalDiff.otherCriteria || '—'));
        L.push('');

        L.push('**重复原因**');
        L.push('');
        if (cmp.repeatedCauses.length) {
          for (var rp = 0; rp < cmp.repeatedCauses.length; rp++) {
            var pair = cmp.repeatedCauses[rp];
            L.push('- ⚠️ **重复原因**（相似度 ' + Math.round(pair.score * 100) + '%）：' +
              '「' + pair.causeA.text + '」 ←→ 「' + pair.causeB.text + '」');
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
            L.push('- ⚠️ **' + (ia.failed ? '未生效' : '待验证') + '**（来自《' + (ia.goalDescription || '（无目标描述）') + '》）：' +
              ia.action.title +
              (ia.action.verifyResult ? '　验证结论：' + ia.action.verifyResult : ''));
          }
        } else {
          L.push('- （历史改进均已闭环）');
        }
        L.push('');
      }
    }

    return L.join('\n');
  }

  // 全部目标的合集报告
  function buildAllMarkdown(goals) {
    var list = goals || [];
    if (!list.length) return '';
    var L = [];
    L.push('# Reflect 复盘合集');
    L.push('');
    L.push('共 ' + list.length + ' 个目标。');
    L.push('');
    for (var i = 0; i < list.length; i++) {
      L.push(buildMarkdown(list[i], list));
      L.push('');
      L.push('---');
      L.push('');
    }
    return L.join('\n');
  }

  // 简短摘要：目标一句话 + 差距 + 关键原因 + 首要改进 + 状态
  function buildSummary(goal) {
    if (!goal) return '';
    var goalLine = '目标：' + (goal.goal.description || '（未填写）') +
      (goal.goal.criteria && goal.goal.criteria.length
        ? '；验证标准：' + goal.goal.criteria[0] : '');

    var result = (goal.results || [])[(goal.results || []).length - 1];
    var gapLine = result
      ? ('差距：' + (result.gap || '（未填写差距）'))
      : '差距：尚未记录结果';

    var causes = goal.causes || [];
    var causeLine = causes.length
      ? ('关键原因：' + causes.map(function (c) { return c.text; }).join('；'))
      : '关键原因：尚未归因';

    var actions = goal.actions || [];
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

    var statusLine = '改进 ' + actions.filter(function (a) { return a.status === 'verified'; }).length +
      '/' + actions.length + ' 已闭环';

    return [goalLine, gapLine, causeLine, actionLine, statusLine].join('\n');
  }

  R.export = {
    buildMarkdown: buildMarkdown,
    buildAllMarkdown: buildAllMarkdown,
    buildSummary: buildSummary,
    fmtTime: fmtTime,
    esc: esc,
    ACTION_STATE_CN: ACTION_STATE_CN
  };
})(window);
