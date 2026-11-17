"""Reflect 验收测试：用 geckodriver 驱动 Firefox 真实渲染前端，校验三条硬性验收。

验收：
  A. 模糊愿望（"我要很爽"）能通过向导引导出至少一个带阈值的验证标准
  B. 目标修改可追溯（版本链），报告展示原目标与修正目标
  C. 改进没有验证结论不能闭环（验证可延后补录）；历史对比能高亮重复问题
另加：
  D. 无外部网络请求 / 无 ES module import
  E. 控制台无 JS 报错
  F. 板块精简：目标两栏、结果无提交人、事实两栏、改进只留措施栏
"""
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from webdriver import WebDriver  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = "file://" + os.path.join(ROOT, "app", "assets", "index.html")
SHOTS = os.path.join(ROOT, "build", "shots")

PASS, FAIL = [], []


def check(name, cond, detail=""):
    if cond:
        PASS.append(name)
        print("  PASS  %s" % name)
    else:
        FAIL.append((name, detail))
        print("  FAIL  %s  %s" % (name, detail))


def main():
    d = WebDriver().start()
    try:
        return run(d)
    finally:
        d.quit()
        d.stop()


def run(d):
    d.new_session(width=430, height=920)
    d.navigate(INDEX)
    time.sleep(1.0)

    # ---------- D. 静态检查：禁止 ES module / 外部网络 ----------
    print("\n[D] 静态约束")
    assets = os.path.join(ROOT, "app", "assets")
    js_files = []
    for dirpath, _, names in os.walk(assets):
        for n in names:
            if n.endswith(".js"):
                js_files.append(os.path.join(dirpath, n))
    all_js = "\n".join(open(f, encoding="utf-8").read() for f in js_files)
    check("无 ES module import/export 语法",
          not re.search(r"^\s*(import\s+[^(]|export\s+(default|const|function|let|var|class))", all_js, re.M))
    ext = re.findall(r"https?://[^\s\"'()]+", all_js)
    ext = [u for u in ext if "w3.org" not in u and "schemas.android" not in u]
    check("JS 无外部网络 URL", not ext, str(ext[:3]))
    html = open(os.path.join(assets, "index.html"), encoding="utf-8").read()
    check("HTML 无 CDN 外链",
          "http://" not in html.replace("http://www.w3.org", "") and "https://" not in html.replace("https://www.w3.org", ""),
          "html 含外链")
    check("无 importmap/module script",
          'type="module"' not in html and "importmap" not in html)

    # ---------- 基础环境 ----------
    print("\n[env] 运行环境")
    check("window.Reflect.store 存在", d.execute("return typeof (window.Reflect && window.Reflect.store)") == "object")
    check("window.Reflect.ui 存在", d.execute("return typeof (window.Reflect && window.Reflect.ui)") == "object")
    check("window.Reflect.wizard 存在", d.execute("return typeof (window.Reflect && window.Reflect.wizard)") == "object")
    check("window.Reflect.compare 存在", d.execute("return typeof (window.Reflect && window.Reflect.compare)") == "object")
    check("window.Reflect.export 存在", d.execute("return typeof (window.Reflect && window.Reflect.export)") == "object")
    check("localStorage 可用",
          d.execute("try{localStorage.setItem('__t','1');return localStorage.getItem('__t')==='1'}catch(e){return false}"))

    # ---------- A. 模糊愿望 → 验证标准 ----------
    print("\n[A] 模糊愿望引导出验证标准")
    d.execute("window.Reflect.store.seedExample(); return true;")
    time.sleep(0.5)

    # 走真实向导：步骤1 输入模糊愿望
    d.execute("window.Reflect.wizard.open(null, {onDone: function(){}}); return true;")
    time.sleep(0.6)
    d.screenshot(os.path.join(SHOTS, "a1-wizard-step1.png"))
    d.execute("""
      var w = document.getElementById('w-wish');
      if (!w) return false;
      w.value = '我要很爽';
      w.dispatchEvent(new Event('input', {bubbles:true}));
      return true;
    """)
    time.sleep(0.3)
    # 模糊度检测应命中「爽」
    blurry = d.execute("""
      var m = document.querySelector('.modal');
      return m ? (m.textContent.indexOf('待翻译') >= 0 && m.textContent.indexOf('爽') >= 0) : false;
    """)
    check("向导检测出模糊愿望并标记待翻译", blurry)
    d.screenshot(os.path.join(SHOTS, "a2-wizard-blurry.png"))

    # 步骤1 → 步骤2
    d.execute("document.querySelector('.modal [data-act=wiz-next]').click(); return true;")
    time.sleep(0.4)
    step2 = d.execute("return !!document.getElementById('w-scenario-h')")
    check("向导可进入步骤2（场景）", step2)

    # 步骤2 填场景假设 → 步骤3
    d.execute("""
      var s = document.getElementById('w-scenario-h');
      s.value = '新手 10 分钟出片';
      s.dispatchEvent(new Event('input', {bubbles:true}));
      document.querySelector('.modal [data-act=wiz-next]').click();
      return true;
    """)
    time.sleep(0.4)
    step3 = d.execute("return !!document.getElementById('w-metrics')")
    check("向导可进入步骤3（验证标准）", step3)

    # 步骤3 关键校验点：没有确认任何验证标准时，下一步必须被禁用
    guard = d.execute("""
      var m = document.querySelector('.modal');
      var btn = m.querySelector('[data-act=wiz-next]');
      var box = document.querySelector('.modal input[type=checkbox]');
      return {hasBtn: !!btn, disabled: btn ? !!btn.disabled : false,
              hasCheckbox: !!box,
              alert: m.textContent.indexOf('至少需要 1 条') >= 0};
    """)
    check("步骤3 在无验证标准时禁用下一步",
          guard["hasBtn"] and guard["disabled"], str(guard))
    check("步骤3 明确提示至少需要 1 条验证标准", guard["alert"], str(guard))

    # 选一个指标类型 → 系统给出带阈值的候选口径
    metric = d.execute("""
      var btn = document.querySelector('.modal [data-act=wiz-metric]');
      if (!btn) return 'NO_METRIC_BTN';
      btn.click();
      return 'OK';
    """)
    time.sleep(0.4)
    cand = d.execute("""
      var m = document.querySelector('.modal');
      return {hasCrit: !!document.querySelector('.modal .crit'),
              hasThreshold: !!document.querySelector('.modal [data-act=wiz-crit-threshold]'),
              nextDisabled: document.querySelector('.modal [data-act=wiz-next]').disabled,
              alertText: m.textContent.replace(/\\s+/g,' ').slice(-120)};
    """)
    check("选择指标类型后生成候选验证标准", cand["hasCrit"], str(cand))
    check("候选标准自带阈值口径", cand["hasThreshold"], str(cand))
    check("候选未确认时下一步仍禁用", cand["nextDisabled"] is True, str(cand))

    # 勾选 + 填口径后应可继续
    d.execute("""
      var box = document.querySelector('.modal input[type=checkbox]');
      if (!box) return 'NO_CHECKBOX';
      box.click();
      var ti = document.querySelector('.modal [data-act=wiz-crit-text]');
      if (ti) { ti.value = '5 个用户中 4 个 10 分钟内完成'; ti.dispatchEvent(new Event('input',{bubbles:true})); }
      var th = document.querySelector('.modal [data-act=wiz-crit-threshold]');
      if (th) { th.value = '>=4/5'; th.dispatchEvent(new Event('input',{bubbles:true})); }
      return 'OK';
    """)
    time.sleep(0.4)
    after = d.execute("""
      var btn = document.querySelector('.modal [data-act=wiz-next]');
      return {disabled: btn ? !!btn.disabled : true};
    """)
    check("确认并填写口径后解除禁用", after["disabled"] is False, str(after))

    d.execute("document.querySelector('.modal [data-act=wiz-next]').click(); return true;")
    time.sleep(0.4)
    step4 = d.execute("return !!document.querySelector('.modal [data-act=wiz-submit]')")
    check("向导可进入步骤4（汇总预览）", step4)
    d.screenshot(os.path.join(SHOTS, "a3-wizard-step4.png"))

    # 写入目标，验证真的落库
    write = d.execute("""
      var before = window.Reflect.store.getProjects().length;
      document.querySelector('.modal [data-act=wiz-submit]').click();
      var ps = window.Reflect.store.getProjects();
      var p = ps[ps.length-1];
      var g = window.Reflect.store.getCurrentGoal(p.id);
      return {before: before, after: ps.length,
              wish: g ? g.originalWish : '',
              criteria: g ? g.verificationCriteria.length : 0,
              first: g ? g.verificationCriteria[0] : null,
              scenario: g ? g.scenarioHypothesis : ''};
    """)
    time.sleep(0.4)
    check("向导写入新项目", write["after"] == write["before"] + 1, str(write))
    check("写入后愿望保持原样", "很爽" in write["wish"], str(write["wish"]))
    check("写入后至少有 1 条验证标准", write["criteria"] >= 1, str(write))
    check("写入后场景假设保留", "10 分钟出片" in write["scenario"], str(write["scenario"]))
    check("写入的验证标准带阈值", bool(write["first"] and write["first"].get("threshold")),
          str(write["first"]))

    # 直接用 API 层验证：必须能产出至少一条带阈值的标准
    wizard_out = d.execute("""
      var s = window.Reflect.store.createProject({title:'验收测试', template:'standard', participants:['A']});
      var g = window.Reflect.store.addGoalVersion(s.id, {
        originalWish:'我要很爽',
        scenarioHypothesis:'新手 10 分钟出片',
        verificationCriteria:[{text:'5 个用户中 4 个 10 分钟内完成', metric:'完成率', threshold:'>=4/5'}],
        adjustmentRule:'完成率<60% 则修正目标'
      });
      var cur = window.Reflect.store.getCurrentGoal(s.id);
      return {n: cur.verificationCriteria.length,
              first: cur.verificationCriteria[0],
              versions: window.Reflect.store.getGoalVersions(s.id).length};
    """)
    check("可写入并读回验证标准", wizard_out["n"] >= 1 and wizard_out["first"]["text"], str(wizard_out))
    check("验证标准带阈值口径",
          bool(wizard_out["first"].get("threshold")) and bool(wizard_out["first"].get("metric")),
          str(wizard_out["first"]))

    # ---------- B. 目标修改可追溯 ----------
    print("\n[B] 目标修改可追溯 + 报告展示原/修正目标")
    rev = d.execute("""
      var ps = window.Reflect.store.getProjects();
      var p = ps[0];
      var before = window.Reflect.store.getCurrentGoal(p.id);
      window.Reflect.store.addGoalVersion(p.id, {
        originalWish: before.originalWish,
        scenarioHypothesis: '老手 5 分钟出片',
        verificationCriteria: [{text:'3 个用户中 3 个 5 分钟内完成', metric:'完成率', threshold:'3/3'}],
        adjustmentRule: '若无改善则放弃该方向',
        note: '假设翻译错了'
      });
      var vs = window.Reflect.store.getGoalVersions(p.id);
      var cur = window.Reflect.store.getCurrentGoal(p.id);
      var fresh = window.Reflect.store.getProject(p.id);
      var md = window.Reflect.export.buildMarkdown(fresh, window.Reflect.store.getProjects());
      return {versions: vs.length, current: cur.version,
              revisedFrom: vs[vs.length-1].revisedFrom,
              origWish: before.originalWish,
              mdHasOriginal: md.indexOf(before.originalWish) >= 0,
              mdHasRevised: md.indexOf('老手 5 分钟出片') >= 0,
              mdHasSection: md.indexOf('原目标与修正目标对照') >= 0,
              mdHasMarked: md.indexOf('已修正') >= 0,
              mdLen: md.length};
    """)
    check("目标产生版本链", rev["versions"] >= 2, str(rev))
    check("新版本记录 revisedFrom", rev["revisedFrom"] is not None, str(rev))
    check("报告包含原目标", rev["mdHasOriginal"], str(rev))
    check("报告包含修正后目标", rev["mdHasRevised"], str(rev))
    check("报告有原目标与修正目标对照段", rev["mdHasSection"], str(rev))
    check("报告标注已修正", rev["mdHasMarked"], str(rev))

    # ---------- C. 改进没验证结论就不能闭环（验证可延后补录） ----------
    print("\n[C] 改进闭环必须留验证结论")
    close_guard = d.execute("""
      var ps = window.Reflect.store.getProjects();
      var p = ps[0];
      // 验证可以先不填：改进措施先记下来
      var a = window.Reflect.store.addAction(p.id, {title:'优化模板入口'});
      var act0 = null;
      window.Reflect.store.getState().projects.forEach(function(pp){ pp.actions.forEach(function(x){ if (x.id===a.id) act0=x; }); });
      var res = window.Reflect.store.closeAction(a.id, '');
      var act = null;
      window.Reflect.store.getState().projects.forEach(function(pp){ pp.actions.forEach(function(x){ if (x.id===a.id) act=x; }); });
      return {created: !!a, status0: act0 ? act0.status : null,
              hasVerifyMetric: !!(act0 && act0.verifyMetric),
              ok: res.ok, error: res.error || '', status: act ? act.status : null};
    """)
    check("改进措施可以先不填验证直接记下", close_guard["created"] and close_guard["status0"] == "open",
          str(close_guard))
    check("缺少验证结论时拒绝闭环", close_guard["ok"] is False, str(close_guard))
    check("拒绝时给出错误说明", bool(close_guard["error"]), str(close_guard))
    check("状态未被改成已闭环", close_guard["status"] != "verified", str(close_guard))

    close_ok = d.execute("""
      var st = window.Reflect.store.getState();
      var p = st.projects[0];
      var a = p.actions[p.actions.length-1];
      // 事后补录验证结论即可闭环，验证指标可选
      var res = window.Reflect.store.closeAction(a.id, '完成率从 40% 升到 75%');
      var act=null;
      window.Reflect.store.getState().projects.forEach(function(pp){ pp.actions.forEach(function(x){ if (x.id===a.id) act=x; }); });
      return {ok: res.ok, status: act.status, result: act.verifyResult, metric: act.verifyMetric};
    """)
    check("补录验证结论后可闭环", close_ok["ok"] is True and close_ok["status"] == "verified", str(close_ok))
    check("闭环时验证结论被记录", bool(close_ok["result"]), str(close_ok))
    check("验证指标是可选的", close_ok["metric"] == "", str(close_ok))

    # ---------- D. 历史对比高亮重复原因 ----------
    print("\n[D] 历史对比高亮重复问题")
    cmp_res = d.execute("""
      var st = window.Reflect.store.getState();
      var p = st.projects[0];
      var other = window.Reflect.store.createProject({title:'上次复盘', template:'standard', participants:['B']});
      window.Reflect.store.addCause(other.id, {layer:'执行', text:'新手找不到模板入口', factIds:[]});
      window.Reflect.store.addCause(other.id, {layer:'执行', text:'导出流程太慢导致失败率高', factIds:[]});
      // 历史复盘里的改进项：一已验证、一未验证（未生效）
      var a1 = window.Reflect.store.addAction(other.id, {title:'优化模板入口'});
      window.Reflect.store.closeAction(a1.id, '完成率升到 80%');
      window.Reflect.store.addAction(other.id, {title:'加一个导出进度条'});
      var o = window.Reflect.store.getProject(other.id);
      window.Reflect.store.addCause(p.id, {layer:'执行', text:'新手找不到模板入口', factIds:[]});
      window.Reflect.store.addCause(p.id, {layer:'资源', text:'缺少预设模板', factIds:[]});
      var rep = window.Reflect.compare.repeatedCauses(p, o);
      var ineff = window.Reflect.compare.ineffectiveActions(p, o);
      var full = window.Reflect.compare.compareProjects(p.id, other.id);
      return {repCount: rep.length, topScore: rep.length ? rep[0].score : 0,
              repPair: rep.length ? [rep[0].causeA.text, rep[0].causeB.text] : null,
              ineffCount: ineff.length,
              ineffTitles: ineff.map(function(x){return x.action.title;}),
              fullKeys: Object.keys(full)};
    """)
    check("识别出重复原因", cmp_res["repCount"] >= 1, str(cmp_res))
    check("重复原因相似度达阈值", cmp_res["topScore"] >= 0.45, str(cmp_res["topScore"]))
    check("重复原因文本正确配对",
          cmp_res["repPair"] and "模板入口" in cmp_res["repPair"][0] and "模板入口" in cmp_res["repPair"][1],
          str(cmp_res["repPair"]))
    check("识别上次没闭环的改进", cmp_res["ineffCount"] == 1, str(cmp_res))
    check("没闭环的改进只含未闭环项",
          cmp_res["ineffTitles"] == ["加一个导出进度条"], str(cmp_res["ineffTitles"]))
    check("compareProjects 返回完整结构",
          "repeatedCauses" in cmp_res["fullKeys"] and "ineffectiveActions" in cmp_res["fullKeys"],
          str(cmp_res["fullKeys"]))

    # ---------- 导出 ----------
    print("\n[导出]")
    exp = d.execute("""
      var ps = window.Reflect.store.getProjects();
      var md = window.Reflect.export.buildMarkdown(ps[0], ps);
      var sm = window.Reflect.export.buildSummary(ps[0]);
      return {mdLen: md.length, smLen: sm.length, md: md, sm: sm};
    """)
    check("Markdown 报告非空", exp["mdLen"] > 200, str(exp["mdLen"]))
    check("报告含目标/结果/事实/原因/改进各段",
          all(k in exp["md"] for k in ["目标", "结果", "事实", "原因", "改进"]))
    check("报告标注尚未闭环的改进", "尚未闭环" in exp["md"], "")
    check("摘要非空", exp["smLen"] > 20, str(exp["smLen"]))
    open(os.path.join(SHOTS, "report-sample.md"), "w", encoding="utf-8").write(exp["md"])

    # ---------- 全流程 UI 渲染 ----------
    print("\n[UI] 各页面渲染")
    pages = [
        ("#/projects", "p1-projects.png"),
        ("#/project/%s/goal" % exp_id(d), "p2-goal.png"),
        ("#/project/%s/result" % exp_id(d), "p3-result.png"),
        ("#/project/%s/facts" % exp_id(d), "p4-facts.png"),
        ("#/project/%s/causes" % exp_id(d), "p5-causes.png"),
        ("#/project/%s/compare" % exp_id(d), "p6-compare.png"),
        ("#/project/%s/export" % exp_id(d), "p7-export.png"),
    ]
    for hash_, shot in pages:
        d.execute("location.hash = arguments[0]; return true;", [hash_])
        time.sleep(0.55)
        d.screenshot(os.path.join(SHOTS, shot))
        body_len = d.execute("return document.body ? document.body.innerText.trim().length : 0")
        check("页面 %s 有内容渲染" % hash_, body_len > 10, "len=%d" % body_len)

    # ---------- F. 板块精简 ----------
    print("\n[F] 板块精简")

    # 目标：两栏「目标 | 可验证的标准」
    d.execute("location.hash = '#/project/%s/goal';" % exp_id(d))
    time.sleep(0.5)
    goal = d.execute("""
      var view = document.getElementById('view') || document.body;
      var cols = view.querySelectorAll('.cols');
      var heads = [];
      if (cols.length) {
        var hs = cols[0].querySelectorAll('.col-h');
        for (var i=0;i<hs.length;i++) heads.push(hs[i].textContent.trim());
      }
      return {colCount: cols.length, heads: heads,
              hasLayers: view.textContent.indexOf('第 1 层') >= 0 || view.textContent.indexOf('三层') >= 0,
              hasCriteria: view.textContent.indexOf('可验证的标准') >= 0};
    """)
    check("目标为两栏布局", goal["colCount"] == 1, str(goal))
    check("目标两栏分别是「目标」与「可验证的标准」",
          goal["heads"][:2] == ["目标", "可验证的标准"], str(goal["heads"]))
    check("目标不再展示「三层」结构", not goal["hasLayers"], str(goal))
    check("目标展示可验证的标准", goal["hasCriteria"], str(goal))

    # 结果：没有提交人
    d.execute("location.hash = '#/project/%s/result';" % exp_id(d))
    time.sleep(0.5)
    result = d.execute("""
      var view = document.getElementById('view') || document.body;
      return {hasAuthorField: !!view.querySelector('#r-author'),
              hasAuthorText: view.textContent.indexOf('提交人') >= 0,
              hasActual: !!view.querySelector('#r-actual'),
              hasGap: !!view.querySelector('#r-gap')};
    """)
    check("结果板块无提交人输入框", not result["hasAuthorField"], str(result))
    check("结果板块不出现「提交人」字样", not result["hasAuthorText"], str(result))
    check("结果板块保留实际结果与目标差距",
          result["hasActual"] and result["hasGap"], str(result))

    # 事实：两栏「事实 | 关键事实」，时间线保留，其余字段去掉
    d.execute("location.hash = '#/project/%s/facts';" % exp_id(d))
    time.sleep(0.5)
    facts = d.execute("""
      var view = document.getElementById('view') || document.body;
      var cols = view.querySelectorAll('.cols');
      var heads = [];
      if (cols.length) {
        var hs = cols[0].querySelectorAll('.col-h');
        for (var i=0;i<hs.length;i++) heads.push(hs[i].textContent.trim());
      }
      var txt = view.textContent;
      return {colCount: cols.length, heads: heads,
              hasTimeline: !!view.querySelector('.timeline'),
              hasKind: !!view.querySelector('#f-kind'), hasSource: !!view.querySelector('#f-source'),
              hasEvidence: !!view.querySelector('#f-evidence'), hasConf: !!view.querySelector('#f-conf'),
              hasStatus: !!view.querySelector('#f-status'), hasAuthor: !!view.querySelector('#f-author'),
              hasContent: !!view.querySelector('#f-content'),
              mentionsType: txt.indexOf('类型') >= 0,
              mentionsConfidence: txt.indexOf('置信度') >= 0,
              mentionsStatus: txt.indexOf('待验证') >= 0,
              mentionsEvidence: txt.indexOf('证据') >= 0,
              mentionsSource: txt.indexOf('来源') >= 0};
    """)
    check("事实为两栏布局", facts["colCount"] == 1, str(facts))
    check("事实两栏分别是「事实」与「关键事实」",
          len(facts["heads"]) >= 2 and facts["heads"][0].startswith("事实")
          and facts["heads"][1].startswith("关键事实"), str(facts["heads"]))
    check("事实保留时间线", facts["hasTimeline"], str(facts))
    check("事实只保留内容与时间点输入",
          facts["hasContent"] and not facts["hasKind"] and not facts["hasSource"]
          and not facts["hasEvidence"] and not facts["hasConf"] and not facts["hasStatus"]
          and not facts["hasAuthor"], str(facts))
    check("事实不再出现类型/置信度/状态/证据/来源",
          not facts["mentionsType"] and not facts["mentionsConfidence"]
          and not facts["mentionsStatus"] and not facts["mentionsEvidence"]
          and not facts["mentionsSource"], str(facts))

    # 标为关键 → 关键事实栏出现
    d.execute("window.Reflect.store.seedExample(); return true;")
    time.sleep(0.4)
    d.execute("location.hash = '#/project/demo-current-clip/facts'; return true;")
    time.sleep(0.5)
    keyflow = d.execute("""
      var view = document.getElementById('view') || document.body;
      var cols = view.querySelectorAll('.cols');
      function colItems(n){
        var c = cols[0].querySelectorAll('.col')[n];
        return c ? c.querySelectorAll('.fact-item').length : -1;
      }
      var before = colItems(1);
      var btn = view.querySelector('[data-act=toggle-key-fact]');
      if (!btn) return {noBtn: true, before: before};
      btn.click();
      return {noBtn: false, before: before};
    """)
    time.sleep(0.5)
    keyafter = d.execute("""
      var view = document.getElementById('view') || document.body;
      var cols = view.querySelectorAll('.cols');
      var c = cols[0].querySelectorAll('.col')[1];
      return c ? c.querySelectorAll('.fact-item').length : -1;
    """)
    check("事实面板有「标为关键」入口", not keyflow.get("noBtn"), str(keyflow))
    check("标为关键后进入关键事实栏", keyafter != keyflow.get("before"), str((keyflow, keyafter)))

    # 原因与改进：改进板块只保留改进措施
    d.execute("location.hash = '#/project/demo-current-clip/causes'; return true;")
    time.sleep(0.5)
    causes = d.execute("""
      var view = document.getElementById('view') || document.body;
      return {hasTitle: !!view.querySelector('#a-title'),
              hasOwner: !!view.querySelector('#a-owner'), hasDue: !!view.querySelector('#a-due'),
              hasMetric: !!view.querySelector('#a-metric'), hasCauseSel: !!view.querySelector('#a-cause'),
              mentionsOwner: view.textContent.indexOf('负责人') >= 0,
              mentionsDue: view.textContent.indexOf('截止') >= 0,
              mentionsVerifyMetric: view.textContent.indexOf('验证指标') >= 0};
    """)
    check("改进只保留改进措施输入", causes["hasTitle"], str(causes))
    check("改进去掉负责人/截止/验证指标/关联原因",
          not causes["hasOwner"] and not causes["hasDue"] and not causes["hasMetric"]
          and not causes["hasCauseSel"], str(causes))
    check("改进面板不再出现负责人/截止/验证指标",
          not causes["mentionsOwner"] and not causes["mentionsDue"]
          and not causes["mentionsVerifyMetric"], str(causes))

    # 验证延后：改进列表里可以直接补录验证
    d.execute("""
      var p = window.Reflect.store.getProject('demo-current-clip');
      window.Reflect.store.addAction(p.id, {title:'改进措施可先记下'});
      return true;
    """)
    time.sleep(0.4)
    d.execute("location.hash = '#/project/demo-current-clip/causes'; return true;")
    time.sleep(0.5)
    defer = d.execute("""
      var view = document.getElementById('view') || document.body;
      var btns = view.querySelectorAll('[data-act=act-close]');
      return {closeBtns: btns.length,
              text: btns.length ? btns[0].textContent.trim() : '',
              hasFailed: !!view.querySelector('[data-act=act-failed]')};
    """)
    check("改进清单有「补录验证」入口", defer["closeBtns"] >= 1, str(defer))
    check("补录验证按钮文案正确", defer["text"] == "补录验证", str(defer))
    check("改进清单有「未生效」入口", defer["hasFailed"], str(defer))

    # ---------- 控制台错误 ----------
    print("\n[E] 控制台")
    errs = [l for l in d.logs("browser") if l.get("level") in ("SEVERE", "ERROR")]
    check("无 JS 运行时错误", not errs, json.dumps(errs[:3]) if errs else "")

    d.screenshot(os.path.join(SHOTS, "final.png"))
    print("\n" + "=" * 52)
    print("通过 %d / %d" % (len(PASS), len(PASS) + len(FAIL)))
    if FAIL:
        print("失败项:")
        for n, det in FAIL:
            print("  - %s  %s" % (n, det))
        return 1
    print("全部通过")
    return 0


def exp_id(d):
    return d.execute("return window.Reflect.store.getProjects()[0].id;")


if __name__ == "__main__":
    import json
    sys.exit(main())
