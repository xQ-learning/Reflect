/* Reflect · compare.js
   横向对比：重复原因识别、未生效改进识别。
   文本相似度采用中文友好的方案（不使用英文分词）：
     - 字符二元组(bigram) 的 Jaccard / Dice
     - 三元组(term) 关键词集合重叠
     - 内容字符集合重叠
     - 最长公共子串比例
   四路信号混合后得到 score，score >= 0.45 判定为重复原因。 */
(function (global) {
  'use strict';

  var R = global.Reflect = global.Reflect || {};

  var REPEAT_THRESHOLD = 0.45;

  // 高频功能词/连接词：单独出现不携带信息量
  var STOPWORDS = [
    '的', '了', '着', '是', '在', '和', '与', '及', '或', '有', '就', '也', '都',
    '把', '被', '而', '但', '并', '更', '很', '非常', '以及', '导致', '造成', '使得',
    '一个', '一些', '我们', '他们', '这个', '那个', '因为', '所以', '如果', '就是',
    '没有', '进行', '出现', '发生', '相关', '方面', '问题', '时候', '之后', '之前'
  ];

  // 中文近义归一：把常见同义表达折叠成同一个词，提升"换句话说"的召回
  var SYNONYMS = [
    ['太多', '多'], ['过多', '多'], ['太高', '多'], ['偏高', '多'], ['过大', '多'],
    ['太少', '少'], ['过少', '少'], ['偏低', '少'],
    ['卡住', '卡'], ['卡顿', '卡'], ['卡壳', '卡'], ['阻塞', '卡'], ['停留', '卡'],
    // 角色词统一：同一批人换着说也算同一原因
    ['新用户', '用户'], ['新手', '用户'], ['首次使用', '用户'], ['小白', '用户'],
    ['使用者', '用户'], ['客户', '用户'],
    ['流失', '流失'], ['跳出', '流失'], ['退出', '流失'], ['放弃', '流失'],
    ['入口', '入口'], ['首页', '入口'], ['主页', '入口'], ['门户', '入口'],
    ['模板', '模板'], ['模版', '模板'],
    ['导出', '导出'], ['输出', '导出'],
    ['失败', '失败'], ['报错', '失败'], ['无法', '失败'], ['不能', '失败'],
    ['步骤', '步骤'], ['环节', '步骤'], ['阶段', '步骤'],
    ['选择', '选'], ['挑选', '选'], ['点击', '选'],
    ['缺失', '缺'], ['不全', '缺'], ['缺少', '缺'], ['没有', '缺'],
    ['变高', '多'], ['成本高', '成本多'], ['工单积压', '积压']
  ];

  function isCJK(code) {
    return (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0xf900 && code <= 0xfaff);
  }

  function isWordChar(code) {
    return isCJK(code) ||
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a);
  }

  // 归一化：只保留中英文与数字，小写，再做近义词折叠
  function normalize(text) {
    var s = String(text == null ? '' : text).toLowerCase();
    var out = '';
    for (var i = 0; i < s.length; i++) {
      if (isWordChar(s.charCodeAt(i))) out += s.charAt(i);
    }
    for (var k = 0; k < SYNONYMS.length; k++) {
      var pair = SYNONYMS[k];
      if (out.indexOf(pair[0]) >= 0) {
        out = out.split(pair[0]).join(pair[1]);
      }
    }
    return out;
  }

  // 字符 n 元组集合（n=2 或 3）
  function ngrams(str, n) {
    var set = {};
    if (!str) return set;
    if (str.length < n) { set[str] = true; return set; }
    for (var i = 0; i <= str.length - n; i++) {
      set[str.substr(i, n)] = true;
    }
    return set;
  }

  function jaccard(a, b) {
    var ka = Object.keys(a), kb = Object.keys(b);
    if (!ka.length && !kb.length) return 0;
    var inter = 0;
    for (var i = 0; i < ka.length; i++) {
      if (b[ka[i]]) inter++;
    }
    var union = ka.length + kb.length - inter;
    return union ? inter / union : 0;
  }

  // Dice 系数：短文本下比 Jaccard 更宽容
  function dice(a, b) {
    var ka = Object.keys(a), kb = Object.keys(b);
    if (!ka.length || !kb.length) return 0;
    var inter = 0;
    for (var i = 0; i < ka.length; i++) {
      if (b[ka[i]]) inter++;
    }
    return (2 * inter) / (ka.length + kb.length);
  }

  // 内容字符集合（去掉高频单字功能词）
  function contentChars(str) {
    var set = {};
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      var isStop = false;
      for (var w = 0; w < STOPWORDS.length; w++) {
        if (STOPWORDS[w].length === 1 && STOPWORDS[w] === ch) { isStop = true; break; }
      }
      if (isStop) continue;
      set[ch] = true;
    }
    return set;
  }

  // 最长公共子串长度（连续）
  function lcsLength(a, b) {
    if (!a.length || !b.length) return 0;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = 0;
    var best = 0;
    for (i = 1; i <= a.length; i++) {
      cur = new Array(b.length + 1);
      cur[0] = 0;
      for (j = 1; j <= b.length; j++) {
        if (a.charAt(i - 1) === b.charAt(j - 1)) {
          cur[j] = prev[j - 1] + 1;
          if (cur[j] > best) best = cur[j];
        } else {
          cur[j] = 0;
        }
      }
      prev = cur;
    }
    return best;
  }

  // 最长公共子序列长度（不连续）：捕捉"换了个说法"的中文改写
  function lcsSeqLength(a, b) {
    if (!a.length || !b.length) return 0;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = 0;
    for (i = 1; i <= a.length; i++) {
      cur = new Array(b.length + 1);
      cur[0] = 0;
      for (j = 1; j <= b.length; j++) {
        cur[j] = (a.charAt(i - 1) === b.charAt(j - 1))
          ? prev[j - 1] + 1
          : (prev[j] > cur[j - 1] ? prev[j] : cur[j - 1]);
      }
      prev = cur;
    }
    return prev[b.length];
  }

  // 单条文本相似度（0~1）
  function similarity(a, b) {
    var na = normalize(a), nb = normalize(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;

    var bgA = ngrams(na, 2), bgB = ngrams(nb, 2);
    var tmA = ngrams(na, 3), tmB = ngrams(nb, 3);
    var ccA = contentChars(na), ccB = contentChars(nb);

    var minLen = Math.min(na.length, nb.length);
    var sBgJ = jaccard(bgA, bgB);
    var sBgD = dice(bgA, bgB);
    var sTmD = dice(tmA, tmB);
    var sCcJ = jaccard(ccA, ccB);
    var sLcs = lcsLength(na, nb) / minLen;
    var sSeq = lcsSeqLength(na, nb) / minLen;

    // 多路信号混合：二元组 Jaccard/Dice + 三元组关键词 + 字符集合 + 连续/非连续公共序列
    var score = 0.15 * sBgJ + 0.17 * sBgD + 0.18 * sTmD +
      0.18 * sCcJ + 0.15 * sLcs + 0.17 * sSeq;
    if (score > 1) score = 1;
    if (score < 0) score = 0;
    return score;
  }

  function causesOf(p) {
    return (p && p.causes && p.causes.length) ? p.causes : [];
  }

  // 两份复盘之间重复出现的原因
  function repeatedCauses(currentProject, otherProject) {
    var out = [];
    var ca = causesOf(currentProject);
    var cb = causesOf(otherProject);
    for (var i = 0; i < ca.length; i++) {
      for (var j = 0; j < cb.length; j++) {
        var score = similarity(ca[i].text, cb[j].text);
        if (score >= REPEAT_THRESHOLD) {
          out.push({
            causeA: ca[i],
            causeB: cb[j],
            score: Math.round(score * 100) / 100,
            layer: ca[i].layer
          });
        }
      }
    }
    out.sort(function (x, y) { return y.score - x.score; });
    return out;
  }

  // 其它复盘中尚未闭环的改进项（待验证 或 已判定未生效）
  function ineffectiveActions(currentProject, otherProject) {
    var out = [];
    var acts = (otherProject && otherProject.actions) ? otherProject.actions : [];
    var title = (otherProject && otherProject.title) ? otherProject.title : '';
    for (var i = 0; i < acts.length; i++) {
      if (acts[i].status !== 'verified') {
        out.push({
          action: acts[i],
          projectTitle: title,
          // failed = 已判定未生效；open = 尚未闭环（可能还没验证）
          failed: acts[i].status === 'failed'
        });
      }
    }
    return out;
  }

  // 汇总对比：目标/结果概览差异 + 重复原因 + 未生效改进
  function compareProjects(projectId, otherId) {
    var store = R.store;
    if (!store) return null;
    var cur = store.getProject(projectId);
    var other = store.getProject(otherId);
    if (!cur || !other) return null;

    var gCur = store.getCurrentGoal(cur.id);
    var gOther = store.getCurrentGoal(other.id);

    var rep = repeatedCauses(cur, other);
    var ineff = ineffectiveActions(cur, other);

    var goalDiff = {
      currentWish: gCur ? gCur.originalWish : '',
      otherWish: gOther ? gOther.originalWish : '',
      currentScenario: gCur ? gCur.scenarioHypothesis : '',
      otherScenario: gOther ? gOther.scenarioHypothesis : '',
      currentCriteria: gCur ? gCur.verificationCriteria.length : 0,
      otherCriteria: gOther ? gOther.verificationCriteria.length : 0,
      sameScenario: !!(gCur && gOther &&
        normalize(gCur.scenarioHypothesis) === normalize(gOther.scenarioHypothesis))
    };

    var resultDiff = {
      currentActual: cur.results.length ? cur.results[cur.results.length - 1].actual : '',
      otherActual: other.results.length ? other.results[other.results.length - 1].actual : '',
      currentGap: cur.results.length ? cur.results[cur.results.length - 1].gap : '',
      otherGap: other.results.length ? other.results[other.results.length - 1].gap : ''
    };

    var actionDiff = {
      currentTotal: cur.actions.length,
      currentVerified: cur.actions.filter(function (a) { return a.status === 'verified'; }).length,
      otherTotal: other.actions.length,
      otherVerified: other.actions.filter(function (a) { return a.status === 'verified'; }).length
    };

    return {
      current: cur,
      other: other,
      repeatedCauses: rep,
      ineffectiveActions: ineff,
      goalDiff: goalDiff,
      resultDiff: resultDiff,
      actionDiff: actionDiff,
      hasRepeat: rep.length > 0,
      hasIneffective: ineff.length > 0
    };
  }

  R.compare = {
    THRESHOLD: REPEAT_THRESHOLD,
    normalize: normalize,
    similarity: similarity,
    repeatedCauses: repeatedCauses,
    ineffectiveActions: ineffectiveActions,
    compareProjects: compareProjects
  };
})(window);
