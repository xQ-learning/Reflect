"""Reflect 验收测试：用 geckodriver 驱动 Firefox 真实渲染前端，校验目标复盘的核心行为。

覆盖：
  A. 目标板块两栏（目标 | 验证标准），填好即可创建目标；没有版本链
  B. 结果 / 事实 / 原因与改进三个板块按精简后的形态渲染
  C. 改进没有验证结论不能闭环（验证可延后补录）
  D. 历史对比能高亮重复原因与上次没闭环的改进
  E. 控制台无 JS 报错
另加：
  F. 静态约束：无 ES module、无外部网络、无已删除的向导脚本
"""
import json
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
    os.makedirs(SHOTS, exist_ok=True)
    d.new_session(width=430, height=920)
    d.navigate(INDEX)
    time.sleep(1.2)

    # ---------- F. 静态约束 ----------
    print("\n[F] 静态约束")
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
    check("向导脚本已删除", not os.path.exists(os.path.join(assets, "js", "wizard.js"))
          and "wizard.js" not in html)
    check("前端不再引用 Reflect.wizard", "Reflect.wizard" not in all_js and "R.wizard" not in all_js)

    # ---------- 基础环境 ----------
    print("\n[env] 运行环境")
    check("window.Reflect.store 存在", d.execute("return typeof (window.Reflect && window.Reflect.store)") == "object")
    check("window.Reflect.ui 存在", d.execute("return typeof (window.Reflect && window.Reflect.ui)") == "object")
    check("window.Reflect.compare 存在", d.execute("return typeof (window.Reflect && window.Reflect.compare)") == "object")
    check("window.Reflect.export 存在", d.execute("return typeof (window.Reflect && window.Reflect.export)") == "object")
    check("localStorage 可用",
          d.execute("try{localStorage.setItem('__t','1');return localStorage.getItem('__t')==='1'}catch(e){return false}"))

    # ---------- A. 目标板块 ----------
    print("\n[A] 目标板块：两栏，填好即可创建目标")
    d.execute("window.Reflect.store.seedExample(); return true;")
    time.sleep(0.5)

    # 列表页
    d.execute("location.hash = '#/goals'; return true;")
    time.sleep(0.5)
    listpage = d.execute("""
      var v = document.getElementById('view');
      return {hasNew: !!v.querySelector('[data-act=new-goal]'),
              text: v.textContent,
              goals: window.Reflect.store.getGoals().length};
    """)
    check("目标列表页有「创建目标」入口", listpage["hasNew"], str(listpage["hasNew"]))
    check("列表里不再出现「复盘项目」字样", "复盘项目" not in listpage["text"], "")

    # 进入创建表单
    d.execute("document.querySelector('[data-act=new-goal]').click(); return true;")
    time.sleep(0.6)
    form = d.execute("""
      var v = document.getElementById('view');
      var cols = v.querySelectorAll('.cols');
      var heads = [];
      if (cols.length) {
        var hs = cols[0].querySelectorAll('.col-h');
        for (var i=0;i<hs.length;i++) heads.push(hs[i].textContent.trim());
      }
      return {colCount: cols.length, heads: heads,
              hasDesc: !!document.getElementById('g-desc'),
              hasCrit: !!v.querySelector('#g-criteria .g-crit'),
              hasAddCrit: !!v.querySelector('[data-act=add-crit]'),
              hasSave: !!v.querySelector('[data-act=save-goal]'),
              text: v.textContent};
    """)
    check("目标表单是两栏布局", form["colCount"] == 1, str(form["colCount"]))
    check("两栏分别是「目标」与「验证标准」",
          form["heads"][:2] == ["目标", "验证标准"], str(form["heads"]))
    check("左栏是目标描述输入", form["hasDesc"], str(form["hasDesc"]))
    check("右栏是验证标准输入", form["hasCrit"], str(form["hasCrit"]))
    check("验证标准可以再加一条", form["hasAddCrit"], str(form["hasAddCrit"]))
    check("有「创建目标」按钮", form["hasSave"], str(form["hasSave"]))

    # 已删除的东西不该出现
    gone = ["模糊度", "场景假设", "依据", "版本链", "翻译愿望", "生成修订版本", "调整规则"]
    for word in gone:
        check("目标板块不再出现「%s」" % word, word not in form["text"], "")

    # 加第二条验证标准
    d.execute("document.querySelector('[data-act=add-crit]').click(); return true;")
    time.sleep(0.4)
    critcount = d.execute("return document.querySelectorAll('#g-criteria .g-crit').length;")
    check("可以加到多条验证标准", critcount >= 2, "count=%d" % critcount)

    # 没填验证标准 → 不让创建
    d.execute("""
      var d = document.getElementById('g-desc');
      d.value = '我要一个很爽的剪辑工具';
      d.dispatchEvent(new Event('input', {bubbles:true}));
      return true;
    """)
    time.sleep(0.3)
    before = d.execute("return window.Reflect.store.getGoals().length;")
    d.execute("document.querySelector('[data-act=save-goal]').click(); return true;")
    time.sleep(0.4)
    after = d.execute("return window.Reflect.store.getGoals().length;")
    check("没有验证标准时不允许创建目标", after == before, "before=%s after=%s" % (before, after))

    # 填两条标准 → 创建成功
    d.execute("""
      var ins = document.querySelectorAll('#g-criteria .g-crit');
      ins[0].value = '5 个用户中 4 个在 10 分钟内完成剪辑并导出';
      ins[0].dispatchEvent(new Event('input', {bubbles:true}));
      ins[1].value = '导出失败率低于 5%';
      ins[1].dispatchEvent(new Event('input', {bubbles:true}));
      return true;
    """)
    time.sleep(0.3)
    created = d.execute("""
      document.querySelector('[data-act=save-goal]').click();
      var gs = window.Reflect.store.getGoals();
      var g = gs[gs.length-1];
      return {count: gs.length, id: g.id,
              desc: g.goal.description,
              criteria: g.goal.criteria,
              hash: location.hash};
    """)
    time.sleep(0.4)
    check("填好后能创建目标", created["count"] == before + 1, str(created))
    check("创建后进入该目标", created["id"] in created["hash"], str(created["hash"]))
    check("目标描述落库", "很爽" in created["desc"], str(created["desc"]))
    check("多条验证标准都落库", len(created["criteria"]) == 2, str(created["criteria"]))

    # 只读视图 + 修改即覆盖
    d.execute("location.hash = '#/goal/' + arguments[0] + '/goal'; return true;", [created["id"]])
    time.sleep(0.5)
    view = d.execute("""
      var v = document.getElementById('view');
      return {hasEdit: !!v.querySelector('[data-act=edit-goal]'),
              text: v.textContent,
              cols: v.querySelectorAll('.cols').length};
    """)
    check("目标已建好后显示两栏只读视图", view["cols"] == 1, str(view["cols"]))
    check("有「修改」入口", view["hasEdit"], str(view["hasEdit"]))
    for word in gone:
        check("只读视图不出现「%s」" % word, word not in view["text"], "")

    d.execute("document.querySelector('[data-act=edit-goal]').click(); return true;")
    time.sleep(0.5)
    edited = d.execute("""
      var d = document.getElementById('g-desc');
      d.value = '我要一个很快的剪辑工具';
      d.dispatchEvent(new Event('input', {bubbles:true}));
      var ins = document.querySelectorAll('#g-criteria .g-crit');
      ins[0].value = '10 分钟内出片';
      ins[0].dispatchEvent(new Event('input', {bubbles:true}));
      if (ins[1]) { ins[1].value = ''; ins[1].dispatchEvent(new Event('input', {bubbles:true})); }
      document.querySelector('[data-act=save-goal]').click();
      var g = window.Reflect.store.getGoal(arguments[0]);
      return {desc: g.goal.description, criteria: g.goal.criteria, count: window.Reflect.store.getGoals().length};
    """, [created["id"]])
    time.sleep(0.4)
    check("修改后覆盖原目标", "很快" in edited["desc"], str(edited))
    check("修改后验证标准被覆盖", edited["criteria"] == ["10 分钟内出片"], str(edited["criteria"]))
    check("修改不新增目标", edited["count"] == before + 1, str(edited["count"]))

    # ---------- B. 其余板块的形态 ----------
    print("\n[B] 结果 / 事实 / 原因与改进")
    d.execute("location.hash = '#/goal/demo-current-clip/result'; return true;")
    time.sleep(0.5)
    result = d.execute("""
      var v = document.getElementById('view');
      return {hasAuthor: !!v.querySelector('#r-author'), text: v.textContent,
              hasActual: !!v.querySelector('#r-actual'), hasGap: !!v.querySelector('#r-gap')};
    """)
    check("结果板块无提交人", not result["hasAuthor"] and "提交人" not in result["text"], str(result))
    check("结果板块保留实际结果与目标差距",
          result["hasActual"] and result["hasGap"], str(result))

    d.execute("location.hash = '#/goal/demo-current-clip/facts'; return true;")
    time.sleep(0.5)
    facts = d.execute("""
      var v = document.getElementById('view');
      var cols = v.querySelectorAll('.cols');
      return {colCount: cols.length,
              hasTimeline: !!v.querySelector('.timeline'),
              hasContent: !!v.querySelector('#f-content'),
              text: v.textContent};
    """)
    check("事实板块没有两栏布局", facts["colCount"] == 0, str(facts["colCount"]))
    check("事实板块保留时间线", facts["hasTimeline"], str(facts["hasTimeline"]))
    check("事实板块保留内容输入", facts["hasContent"], str(facts["hasContent"]))
    check("事实板块不出现「关键事实」", "关键事实" not in facts["text"], "")
    check("事实板块不出现「关键」", "关键" not in facts["text"], "")
    for word in ["类型", "置信度", "证据", "来源", "待验证"]:
        check("事实板块不出现「%s」" % word, word not in facts["text"], "")

    d.execute("location.hash = '#/goal/demo-current-clip/causes'; return true;")
    time.sleep(0.5)
    causes = d.execute("""
      var v = document.getElementById('view');
      return {hasLayer: !!v.querySelector('#c-layer'),
              hasText: !!v.querySelector('#c-text'),
              hasTitle: !!v.querySelector('#a-title'),
              hasOwner: !!v.querySelector('#a-owner'), hasDue: !!v.querySelector('#a-due'),
              hasMetric: !!v.querySelector('#a-metric'), hasCauseSel: !!v.querySelector('#a-cause'),
              text: v.textContent};
    """)
    check("归因没有层级选择", not causes["hasLayer"], str(causes))
    for word in ["目标翻译", "执行（", "资源（", "外部（", "层级"]:
        check("归因不出现「%s」" % word, word not in causes["text"], "")
    check("改进只保留改进措施输入", causes["hasTitle"], str(causes))
    check("改进去掉负责人/截止/验证指标/关联原因",
          not causes["hasOwner"] and not causes["hasDue"] and not causes["hasMetric"]
          and not causes["hasCauseSel"], str(causes))
    check("改进面板不出现「负责人」「截止」「验证指标」",
          "负责人" not in causes["text"] and "截止" not in causes["text"]
          and "验证指标" not in causes["text"], "")

    # 事实里没有关键事实标记入口
    d.execute("location.hash = '#/goal/demo-current-clip/facts'; return true;")
    time.sleep(0.4)
    noflag = d.execute("return !!document.querySelector('[data-act=toggle-key-fact]');")
    check("没有「标为关键」入口", noflag is False, str(noflag))

    # ---------- C. 改进闭环 ----------
    print("\n[C] 改进闭环必须留验证结论")
    close_guard = d.execute("""
      var gs = window.Reflect.store.getGoals();
      var g = gs[0];
      var a = window.Reflect.store.addAction(g.id, {title:'优化模板入口'});
      var res = window.Reflect.store.closeAction(a.id, '');
      var act = null;
      window.Reflect.store.getState().goals.forEach(function(x){ x.actions.forEach(function(y){ if (y.id===a.id) act=y; }); });
      return {created: !!a, ok: res.ok, error: res.error || '', status: act ? act.status : null};
    """)
    check("改进措施可以先不填验证直接记下", close_guard["created"], str(close_guard))
    check("缺少验证结论时拒绝闭环", close_guard["ok"] is False, str(close_guard))
    check("拒绝时给出错误说明", bool(close_guard["error"]), str(close_guard))
    check("状态未被改成已闭环", close_guard["status"] != "verified", str(close_guard))

    close_ok = d.execute("""
      var gs = window.Reflect.store.getGoals();
      var a = gs[0].actions[gs[0].actions.length-1];
      var res = window.Reflect.store.closeAction(a.id, '完成率从 40% 升到 75%');
      var act=null;
      window.Reflect.store.getState().goals.forEach(function(x){ x.actions.forEach(function(y){ if (y.id===a.id) act=y; }); });
      return {ok: res.ok, status: act.status, result: act.verifyResult};
    """)
    check("补录验证结论后可闭环", close_ok["ok"] is True and close_ok["status"] == "verified", str(close_ok))
    check("闭环时验证结论被记录", bool(close_ok["result"]), str(close_ok))

    # ---------- D. 对比 ----------
    print("\n[D] 对比高亮重复问题")
    cmp_res = d.execute("""
      var gs = window.Reflect.store.getGoals();
      var cur = gs[0];
      var other = window.Reflect.store.createGoal({description:'上次的目标', criteria:['耗时 ≤ 30 秒']});
      window.Reflect.store.addCause(other.id, {text:'新手找不到模板入口', factIds:[]});
      window.Reflect.store.addCause(other.id, {text:'导出流程太慢导致失败率高', factIds:[]});
      var a1 = window.Reflect.store.addAction(other.id, {title:'优化模板入口'});
      window.Reflect.store.closeAction(a1.id, '完成率升到 80%');
      window.Reflect.store.addAction(other.id, {title:'加一个导出进度条'});
      window.Reflect.store.addCause(cur.id, {text:'新手找不到模板入口', factIds:[]});
      window.Reflect.store.addCause(cur.id, {text:'缺少预设模板', factIds:[]});
      window.Reflect.store.linkGoal(cur.id, other.id);
      var c = window.Reflect.store.getGoal(cur.id);
      var o = window.Reflect.store.getGoal(other.id);
      var rep = window.Reflect.compare.repeatedCauses(c, o);
      var ineff = window.Reflect.compare.ineffectiveActions(c, o);
      var full = window.Reflect.compare.compareGoals(cur.id, other.id);
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
    check("compareGoals 返回完整结构",
          "repeatedCauses" in cmp_res["fullKeys"] and "ineffectiveActions" in cmp_res["fullKeys"],
          str(cmp_res["fullKeys"]))

    # ---------- 导出 ----------
    print("\n[导出]")
    exp = d.execute("""
      var gs = window.Reflect.store.getGoals();
      var md = window.Reflect.export.buildMarkdown(gs[0], gs);
      var sm = window.Reflect.export.buildSummary(gs[0]);
      return {mdLen: md.length, smLen: sm.length, md: md, sm: sm};
    """)
    check("Markdown 报告非空", exp["mdLen"] > 200, str(exp["mdLen"]))
    check("报告含目标/结果/事实/原因/改进各段",
          all(k in exp["md"] for k in ["目标", "结果", "事实", "原因", "改进"]))
    check("报告标注尚未闭环的改进", "尚未闭环" in exp["md"], "")
    check("报告不再有版本链/对照段",
          "版本链" not in exp["md"] and "原目标与修正目标对照" not in exp["md"], "")
    check("摘要非空", exp["smLen"] > 20, str(exp["smLen"]))
    open(os.path.join(SHOTS, "report-sample.md"), "w", encoding="utf-8").write(exp["md"])

    # ---------- 全流程 UI 渲染 ----------
    print("\n[UI] 各页面渲染")
    pages = [
        ("#/goals", "p1-goals.png"),
        ("#/goal/demo-current-clip/goal", "p2-goal.png"),
        ("#/goal/demo-current-clip/result", "p3-result.png"),
        ("#/goal/demo-current-clip/facts", "p4-facts.png"),
        ("#/goal/demo-current-clip/causes", "p5-causes.png"),
        ("#/goal/demo-current-clip/compare", "p6-compare.png"),
        ("#/goal/demo-current-clip/export", "p7-export.png"),
        ("#/goal/new/goal", "p8-new-goal.png"),
    ]
    for hash_, shot in pages:
        d.execute("location.hash = arguments[0]; return true;", [hash_])
        time.sleep(0.55)
        d.screenshot(os.path.join(SHOTS, shot))
        body_len = d.execute("return document.body ? document.body.innerText.trim().length : 0")
        check("页面 %s 有内容渲染" % hash_, body_len > 10, "len=%d" % body_len)

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


if __name__ == "__main__":
    sys.exit(main())
