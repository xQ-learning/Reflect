"""Reflect 验收测试：用 geckodriver 驱动 Firefox 真实渲染前端，校验三页结构与核心行为。

覆盖：
  A. 三页导航（目标 / 复盘 / 统计）与入口关系
  B. 复盘页目标块：两栏（目标 | 验证标准），填好即可创建，之后四块才出现
  C. 结果 / 事实 / 原因与改进三块的精简形态
  D. 提交复盘后回到目标页
  E. 改进没有验证结论不能闭环（验证可延后补录）
  F. 统计页：总体数字 + 两个目标对比
  G. 导出：单目标报告与全部合集
  H. 控制台无 JS 报错
另加：
  I. 静态约束：无 ES module、无外部网络、无已删除的向导脚本
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

    # 辅助：按块标题取出复盘页上的某一块
    d.execute("""
      window.__block = function (label) {
        var cards = document.getElementById('view').querySelectorAll('.card');
        for (var i = 0; i < cards.length; i++) {
          var h = cards[i].querySelector('.blk-h h2');
          if (h && h.textContent.trim() === label) return cards[i];
        }
        return document.createElement('div');
      };
      return true;
    """)

    # ---------- I. 静态约束 ----------
    print("\n[I] 静态约束")
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

    # ---------- A. 三页导航 ----------
    print("\n[A] 三页导航：目标 / 复盘 / 统计")
    d.execute("window.Reflect.store.seedExample(); return true;")
    time.sleep(0.5)

    d.execute("location.hash = '#/goals'; return true;")
    time.sleep(0.5)
    nav = d.execute("""
      var tabs = document.querySelectorAll('#tabbar .tab');
      var labels = [];
      for (var i=0;i<tabs.length;i++) labels.push(tabs[i].textContent.trim());
      var v = document.getElementById('view');
      return {labels: labels, hasNew: !!v.querySelector('[data-act=new-goal]'),
              cards: v.querySelectorAll('[data-act=view-goal]').length,
              hasSeed: !!v.querySelector('[data-act=seed]'),
              text: v.textContent};
    """)
    check("底部只有三个横向页签", nav["labels"] == ["目标", "复盘", "统计"], str(nav["labels"]))
    check("目标页没有「＋新目标」入口", not nav["hasNew"], str(nav["hasNew"]))
    check("目标页不再有「载入示例」",
          not nav.get("hasSeed"), str(nav.get("hasSeed")))
    check("目标页列出过往目标", nav["cards"] >= 2, str(nav["cards"]))
    check("列表里不出现「复盘项目」字样", "复盘项目" not in nav["text"], "")
    check("页面标题是「目标集」", "目标集" in nav["text"], nav["text"][:40])

    card = d.execute("""
      var c = document.querySelector('.proj-card');
      if (!c) return {no: true};
      return {text: c.textContent,
              hasProgress: !!c.querySelector('.progress'),
              hasKpi: !!c.querySelector('.kpi'),
              hasGear: !!c.querySelector('.gear'),
              hasBoom: c.textContent.indexOf('💥') >= 0,
              hasFire: c.textContent.indexOf('🔥') >= 0};
    """)
    check("目标卡片没有进度条", not card.get("hasProgress"), str(card))
    check("目标卡片有核心数据行", card.get("hasKpi"), str(card))
    check("目标卡片有装备掉落行", card.get("hasGear"), str(card))
    check("目标卡片带 💥 与 🔥", card.get("hasBoom") and card.get("hasFire"), str(card))

    # 点「复盘」页签 = 开一次新的复盘
    d.execute("document.querySelector('#tabbar .tab[data-tab=review]').click(); return true;")
    time.sleep(0.6)
    fresh = d.execute("""
      var v = document.getElementById('view');
      var heads = [];
      var hs = v.querySelectorAll('.blk-h h2, .sec-t');
      for (var i=0;i<hs.length;i++) heads.push(hs[i].textContent.trim());
      var chips = [];
      var cs = v.querySelectorAll('.bstrip .chip');
      for (var j=0;j<cs.length;j++) chips.push(cs[j].textContent.trim());
      return {hash: location.hash, heads: heads, chips: chips,
              hasDesc: !!document.getElementById('g-desc'),
              hasResult: !!document.getElementById('r-actual'),
              hasFact: !!document.getElementById('f-content'),
              hasTime: !!document.getElementById('f-time'),
              moods: v.querySelectorAll('.mood').length,
              hasSubmit: !!v.querySelector('[data-act=submit-review]'),
              tip: v.textContent};
    """)
    check("点复盘页签进入新的复盘", fresh["hash"] == "#/review/new", fresh["hash"])
    check("新复盘直接就是三个模块",
          fresh["heads"] == ["🎯 目标", "📊 结果", "📝 事实与归因"], str(fresh["heads"]))
    check("顶部悬浮步骤条有四步",
          len(fresh["chips"]) == 4 and "🎯" in fresh["chips"][0]
          and "归因与装备" in fresh["chips"][3], str(fresh["chips"]))
    check("三块的内容区都在", fresh["hasDesc"] and fresh["hasResult"] and fresh["hasFact"], str(fresh))
    check("事实时间自动，不再要手填时间", not fresh["hasTime"], str(fresh))
    check("写事实时可以选情绪", fresh["moods"] == 3, str(fresh["moods"]))
    check("还没事实时给出提示而不是空白",
          "还没有事实" in fresh.get("tip", ""), str(fresh.get("tip", ""))[:120])
    check("目标没建好时不显示提交按钮", not fresh["hasSubmit"], str(fresh["hasSubmit"]))
    top_seed = d.execute("""
      var bar = document.getElementById('appbar');
      return {seed: !!bar.querySelector('[data-act=seed]'),
              inView: !!document.getElementById('view').querySelector('[data-act=seed]')};
    """)
    check("「载入示例」挪到复盘页顶部右侧",
          top_seed["seed"] and not top_seed["inView"], str(top_seed))

    # 点目标页的卡片 → 只读审阅页
    d.execute("location.hash = '#/goals'; return true;")
    time.sleep(0.4)
    d.execute("document.querySelector('[data-act=view-goal]').click(); return true;")
    time.sleep(0.6)
    opened = d.execute("""
      var v = document.getElementById('view');
      var bar = document.getElementById('appbar');
      var mods = [];
      var ms = v.querySelectorAll('.mdl-h');
      for (var i=0;i<ms.length;i++) mods.push(ms[i].textContent.trim());
      var firstBtn = bar.querySelector('button');
      return {hash: location.hash, mods: mods,
              hasTable: !!v.querySelector('table'),
              hasTimeline: !!v.querySelector('.timeline'),
              items: v.querySelectorAll('.tl-item').length,
              expLines: v.querySelectorAll('.exp-ln').length,
              hasGood: v.textContent.indexOf('🟢') >= 0,
              hasBad: v.textContent.indexOf('🔴') >= 0,
              hasSlot: v.textContent.indexOf('暂无经验沉淀') >= 0,
              viewActs: v.querySelectorAll('[data-act]').length,
              hasExpect: v.textContent.indexOf('💡 预期') >= 0,
              hasReal: v.textContent.indexOf('⚠️ 现实') >= 0,
              hasGap: v.textContent.indexOf('🔴 差距') >= 0,
              editable: !!v.querySelector('#g-desc') || !!v.querySelector('#r-actual')
                        || !!v.querySelector('#f-content') || !!v.querySelector('.cause-in')
                        || !!v.querySelector('[data-act=save-cause]')
                        || !!v.querySelector('[data-act=del-fact]')
                        || !!v.querySelector('table'),
              barTitle: bar.querySelector('.title').textContent.trim(),
              barLeft: firstBtn ? firstBtn.textContent.trim() : '',
              barEdit: !!bar.querySelector('[data-act=edit-review]'),
              barExport: !!bar.querySelector('[data-act=open-export]'),
              barBack: !!bar.querySelector('[data-act=back]'),
              barRight: bar.lastElementChild ? bar.lastElementChild.textContent.trim() : '',
              tabHidden: getComputedStyle(document.getElementById('tabbar')).display === 'none',
              bodyPad: parseFloat(getComputedStyle(document.body).paddingBottom) || 0,
              text: v.textContent};
    """)
    check("点目标页卡片进入战报回放页", opened["hash"].startswith("#/view/"), opened["hash"])
    check("只有两个模块：预期 vs 现实 / 经验时间线",
          opened["mods"] == ["📊 预期 vs 现实", "🕰️ 经验时间线"], str(opened["mods"]))
    check("顶栏是 < 返回 / 战报回放 / 编辑 >",
          opened["barLeft"] == "< 返回" and "战报回放" in opened["barTitle"]
          and opened["barEdit"] and opened["barRight"] == "编辑 >", str(opened))
    check("战报回放顶栏没有下载按钮", not opened["barExport"], str(opened))
    check("模块一含 预期/现实/差距",
          opened["hasExpect"] and opened["hasReal"] and opened["hasGap"], str(opened))
    check("表格已去掉", not opened["hasTable"], str(opened))
    check("模块二按时间线排布", opened["hasTimeline"], str(opened))
    check("每条事实带原因与装备两行",
          opened["items"] > 0 and opened["expLines"] == opened["items"] * 2, str(opened))
    check("事实有正负标记", opened["hasGood"] and opened["hasBad"], str(opened))
    check("没改进的地方留了只读空位", opened["hasSlot"], str(opened))
    check("战报回放页内容里没有任何可点的操作",
          opened["viewActs"] == 0, str(opened["viewActs"]))
    check("战报回放页完全只读，没有输入框和写操作",
          not opened["editable"], str(opened))
    check("战报回放页铺满到底，导航栏不占位",
          opened["tabHidden"] and opened["bodyPad"] <= 1, str(opened))

    # 点顶部「编辑」→ 进入复盘页
    d.execute("""
      var b = document.getElementById('appbar').querySelector('[data-act=edit-review]');
      if (b) b.click();
      return true;
    """)
    time.sleep(0.6)
    editing = d.execute("""
      var v = document.getElementById('view');
      var heads = [];
      var hs = v.querySelectorAll('.blk-h h2, .sec-t');
      for (var i=0;i<hs.length;i++) heads.push(hs[i].textContent.trim());
      var chips = [];
      var cs = v.querySelectorAll('.bstrip .chip');
      for (var j=0;j<cs.length;j++) chips.push(cs[j].textContent.trim());
      return {hash: location.hash, heads: heads, chips: chips,
              goalCollapsed: !!v.querySelector('#sec-goal .sec-sum'),
              goalForm: !!document.getElementById('g-desc'),
              resultSummary: !!v.querySelector('#sec-result .sec-sum'),
              hasFact: !!document.getElementById('f-content'),
              cards: v.querySelectorAll('.chat-card').length,
              replies: v.querySelectorAll('.reply').length,
              hasSubmit: !!v.querySelector('[data-act=submit-review]')};
    """)
    check("点「编辑」进入复盘页", editing["hash"].startswith("#/review/"), editing["hash"])
    check("复盘页三个模块：目标/结果/事实与归因",
          editing["heads"] == ["🎯 目标", "📊 结果", "📝 事实与归因"], str(editing["heads"]))
    check("填好的模块自动折叠成摘要",
          editing["goalCollapsed"] and editing["resultSummary"] and not editing["goalForm"],
          str(editing))
    check("事实与归因是聊天式时间线",
          editing["cards"] > 0 and editing["replies"] >= editing["cards"] * 2, str(editing))
    check("顶部悬浮步骤条有四步", len(editing["chips"]) == 4, str(editing["chips"]))
    check("能写新事实", editing["hasFact"], str(editing))
    check("已有目标可以提交复盘", editing["hasSubmit"], str(editing["hasSubmit"]))

    # 点折叠的目标卡片 → 展开编辑
    d.execute("""
      var el = document.querySelector('#sec-goal .sec-sum');
      if (el) el.click();
      return true;
    """)
    time.sleep(0.5)
    expanded = d.execute("""
      var v = document.getElementById('view');
      return {form: !!document.getElementById('g-desc'),
              collapsed: !!v.querySelector('#sec-goal .sec-sum')};
    """)
    check("点折叠卡片能展开编辑目标",
          expanded["form"] and not expanded["collapsed"], str(expanded))

    # ---------- B. 目标块：两栏，填好即可创建 ----------
    print("\n[B] 目标块：两栏，填好即可创建")
    d.execute("location.hash = '#/review/new'; return true;")
    time.sleep(0.5)
    form = d.execute("""
      var v = document.getElementById('view');
      var desc = document.getElementById('g-desc');
      var crit = v.querySelector('#g-criteria');
      var dr = desc.getBoundingClientRect();
      var cr = crit.getBoundingClientRect();
      return {colCount: v.querySelectorAll('.cols').length,
              descTop: Math.round(dr.top), critTop: Math.round(cr.top),
              descWidth: Math.round(dr.width), critWidth: Math.round(cr.width),
              hasDesc: !!document.getElementById('g-desc'),
              hasCrit: !!v.querySelector('#g-criteria .g-crit'),
              hasAddCrit: !!v.querySelector('[data-act=add-crit]'),
              hasSave: !!v.querySelector('[data-act=save-goal]'),
              text: v.textContent};
    """)
    check("目标块不是左右两栏", form["colCount"] == 0, str(form["colCount"]))
    check("目标描述在上、验证标准在下", form["descTop"] < form["critTop"],
          "desc=%s crit=%s" % (form["descTop"], form["critTop"]))
    check("上下两块同宽（都占满整行）",
          abs(form["descWidth"] - form["critWidth"]) <= 2,
          "desc=%s crit=%s" % (form["descWidth"], form["critWidth"]))
    check("有目标描述输入", form["hasDesc"], str(form["hasDesc"]))
    check("有验证标准输入", form["hasCrit"], str(form["hasCrit"]))
    check("验证标准可以再加一条", form["hasAddCrit"], str(form["hasAddCrit"]))
    check("有「创建目标」按钮", form["hasSave"], str(form["hasSave"]))

    gone = ["模糊度", "场景假设", "依据", "版本链", "翻译愿望", "生成修订版本", "调整规则"]
    for word in gone:
        check("目标板块不再出现「%s」" % word, word not in form["text"], "")

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

    # 填两条标准 → 创建成功，后面三块出现
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
    time.sleep(0.5)
    check("填好后能创建目标", created["count"] == before + 1, str(created))
    check("创建后进入该目标的复盘", created["id"] in created["hash"], str(created["hash"]))
    check("目标描述落库", "很爽" in created["desc"], str(created["desc"]))
    check("多条验证标准都落库", len(created["criteria"]) == 2, str(created["criteria"]))

    blocks = d.execute("""
      var v = document.getElementById('view');
      var heads = [];
      var hs = v.querySelectorAll('.blk-h h2, .sec-t');
      for (var i=0;i<hs.length;i++) heads.push(hs[i].textContent.trim());
      return {heads: heads,
              result: !!document.getElementById('r-actual'),
              fact: !!document.getElementById('f-content'),
              cause: !!v.querySelector('.cause-in'),
              action: !!v.querySelector('.action-in'),
              submit: !!v.querySelector('[data-act=submit-review]'),
              edit: !!v.querySelector('#sec-goal .sec-sum'),
              form: !!document.getElementById('g-desc')};
    """)
    check("创建后仍是三个模块",
          blocks["heads"] == ["🎯 目标", "📊 结果", "📝 事实与归因"], str(blocks["heads"]))
    check("创建后目标块折叠成摘要，点开可改", blocks["edit"] and not blocks["form"], str(blocks))
    check("创建后可以提交复盘", blocks["submit"], str(blocks["submit"]))

    # 修改即覆盖
    d.execute("document.querySelector('#sec-goal .sec-sum').click(); return true;")
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

    # 没建目标时直接往下记 → 自动先把目标建出来
    d.execute("location.hash = '#/review/new'; return true;")
    time.sleep(0.5)
    d.execute("""
      var ins = document.querySelectorAll('#g-criteria .g-crit');
      ins[0].value = '自动建目标时的验证标准';
      ins[0].dispatchEvent(new Event('input', {bubbles:true}));
      var dd = document.getElementById('g-desc');
      dd.value = '还没建目标就想记结果';
      dd.dispatchEvent(new Event('input', {bubbles:true}));
      var r = document.getElementById('r-actual');
      r.value = '直接记下的实际结果';
      document.querySelector('[data-act=add-result]').click();
      return true;
    """)
    time.sleep(0.9)
    auto_state = d.execute("""
      var gs = window.Reflect.store.getGoals();
      var g = gs[gs.length-1];
      return {count: gs.length, hash: location.hash,
              desc: g.goal.description, results: g.results.length,
              actual: g.results.length ? g.results[0].actual : '',
              criteria: g.goal.criteria};
    """)
    check("没建目标就往下记会自动创建目标", auto_state["count"] == before + 2, str(auto_state["count"]))
    check("自动创建的目标带着描述与验证标准",
          "还没建目标" in auto_state["desc"] and len(auto_state["criteria"]) == 1, str(auto_state))
    check("结果记到了自动创建的目标上",
          auto_state["results"] == 1 and auto_state["actual"] == "直接记下的实际结果", str(auto_state))

    # ---------- C. 其余三块的形态 ----------
    print("\n[C] 结果 / 事实与归因")
    d.execute("location.hash = '#/review/demo-current-clip'; return true;")
    time.sleep(0.6)
    result = d.execute("""
      var v = document.getElementById('view');
      var card = v.querySelector('#sec-result');
      var sum = card ? card.querySelector('.sec-sum') : null;
      return {collapsed: !!sum, text: card ? card.textContent : '',
              hasForm: !!document.getElementById('r-actual')};
    """)
    check("结果块默认折叠成摘要", result["collapsed"] and not result["hasForm"], str(result))
    check("结果摘要里有实际结果与差距",
          "实际" in result["text"] and "差距" in result["text"], result["text"][:120])

    # 展开结果块 → 表单
    d.execute("document.querySelector('#sec-result .sec-sum').click(); return true;")
    time.sleep(0.5)
    result2 = d.execute("""
      var v = document.getElementById('view');
      var b = document.getElementById('sec-result');
      var gap = b.querySelector('#r-gap');
      var met = b.querySelector('#r-metrics');
      var btn = b.querySelector('[data-act=add-metric]');
      function after(a, c) {
        if (!a || !c) return 0;
        return (a.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) ? 1 : 0;
      }
      return {hasAuthor: !!b.querySelector('#r-author'), text: b.textContent,
              hasActual: !!b.querySelector('#r-actual'),
              hasGap: !!gap,
              hasMetrics: !!met, hasMetricBtn: !!btn,
              metricsAfterGap: after(gap, met),
              btnAfterGap: after(gap, btn),
              hasLatest: b.textContent.indexOf('最新提交') >= 0};
    """)
    check("结果块无提交人", not result2["hasAuthor"] and "提交人" not in result2["text"], str(result2))
    check("结果块保留实际结果与目标差距",
          result2["hasActual"] and result2["hasGap"], str(result2))
    check("关键指标在目标差距下面",
          result2["metricsAfterGap"] == 1 and result2["btnAfterGap"] == 1, str(result2))
    check("结果块不再显示「最新提交」", not result2["hasLatest"], str(result2))

    chat = d.execute("""
      var v = document.getElementById('view');
      var b = document.getElementById('sec-facts');
      var cards = b.querySelectorAll('.chat-card');
      var first = cards.length ? cards[0] : null;
      return {cards: cards.length,
              replies: b.querySelectorAll('.reply').length,
              hasMood: b.querySelectorAll('.chat-fact').length,
              delBtns: b.querySelectorAll('.chat-del').length,
              hasStatus: b.querySelectorAll('.st-chip').length,
              hasGhost: b.textContent.indexOf('点击这里补充原因') >= 0,
              hasGearGhost: b.textContent.indexOf('点击这里锻造新装备') >= 0,
              hasTime: b.querySelectorAll('.tl-time').length,
              moods: b.querySelectorAll('.mood').length,
              moodOn: b.querySelectorAll('.mood.on').length,
              hasForm: !!document.getElementById('f-content'),
              hasGapSum: !!b.querySelector('.gap-sum'),
              gapText: b.querySelector('.gap-sum') ? b.querySelector('.gap-sum').textContent : '',
              hasLayer: !!b.querySelector('#c-layer'),
              hasStandaloneCause: !!b.querySelector('#c-text'),
              hasFactPicker: !!b.querySelector('#c-facts'),
              hasStandaloneAction: !!b.querySelector('#a-title'),
              hasOwner: !!b.querySelector('#a-owner'), hasDue: !!b.querySelector('#a-due'),
              hasMetric: !!b.querySelector('#a-metric'),
              firstText: first ? first.textContent : '',
              text: b.textContent};
    """)
    check("事实与归因是聊天卡片", chat["cards"] > 0, str(chat["cards"]))
    check("每条事实带原因与装备两行回复",
          chat["replies"] >= chat["cards"] * 2, str(chat))
    check("每条事实右上角有垃圾桶", chat["delBtns"] == chat["cards"], str(chat))
    check("每条事实带时间", chat["hasTime"] == chat["cards"], str(chat))
    check("装备带状态标记", chat["hasStatus"] > 0, str(chat))
    check("没写的原因和装备留引导占位",
          chat["hasGhost"] and chat["hasGearGhost"], str(chat))
    check("写新事实带情绪选择", chat["moods"] == 3 and chat["moodOn"] == 1, str(chat))
    check("时间线上面有差距汇总",
          chat["hasGapSum"] and "差距汇总" in chat["gapText"], chat["gapText"][:100])
    check("没有独立的添加原因表单和关联事实选择器",
          not chat["hasLayer"] and not chat["hasStandaloneCause"]
          and not chat["hasFactPicker"] and not chat["hasStandaloneAction"], str(chat))
    check("归因面板不出现「负责人」「截止」「验证指标」",
          "负责人" not in chat["text"] and "截止" not in chat["text"]
          and "验证指标" not in chat["text"], "")
    for word in ["目标翻译", "执行（", "资源（", "外部（", "层级", "置信度", "证据"]:
        check("事实与归因不出现「%s」" % word, word not in chat["text"], "")

    noflag = d.execute("return !!document.querySelector('[data-act=toggle-key-fact]');")
    check("没有「标为关键」入口", noflag is False, str(noflag))

    # 在事实下面存原因和改进
    d.execute("location.hash = '#/review/demo-current-clip'; return true;")
    time.sleep(0.6)
    saved = d.execute("""
      var v = document.getElementById('view');
      var reps = v.querySelectorAll('.reply[data-act=edit-cause]');
      for (var i=0;i<reps.length;i++){
        if (reps[i].textContent.indexOf('点击这里补充原因') >= 0){
          reps[i].click();
          return {factId: reps[i].getAttribute('data-fact')};
        }
      }
      return {no: true};
    """)
    time.sleep(0.5)
    saved2 = d.execute("""
      var ci = document.querySelector('.cause-in');
      if (!ci) return {no: true};
      var fi = ci.getAttribute('data-fact');
      ci.value = '这条事实对应的原因';
      ci.dispatchEvent(new Event('input', {bubbles:true}));
      document.querySelector('[data-act=save-cause][data-fact="' + fi + '"]').click();
      var g = window.Reflect.store.getGoal('demo-current-clip');
      var c = null;
      for (var c2=0;c2<g.causes.length;c2++) if (g.causes[c2].factId === fi) c = g.causes[c2];
      return {factId: fi, cause: c ? c.text : '', causeFactId: c ? c.factId : ''};
    """)
    time.sleep(0.7)
    check("在事实下面能存下原因", saved2.get("cause") == "这条事实对应的原因", str(saved2))
    check("原因挂到了那条事实上",
          saved2.get("causeFactId") == saved2.get("factId") and saved2.get("factId"), str(saved2))

    # 存完之后：只读显示 + 可点开再改
    ro = d.execute("""
      var v = document.getElementById('view');
      var reps = v.querySelectorAll('.reply');
      var hit = null;
      for (var i=0;i<reps.length;i++){
        if (reps[i].textContent.indexOf('这条事实对应的原因') >= 0) { hit = reps[i]; break; }
      }
      if (!hit) return {no: true};
      return {hasText: hit.textContent.indexOf('这条事实对应的原因') >= 0,
              readonly: hit.getAttribute('data-act') === 'edit-cause',
              text: hit.textContent};
    """)
    check("存过的原因变成只读文字", ro.get("hasText") and not ro.get("no"), str(ro))
    check("只读的原因可点开再改", ro.get("readonly"), str(ro))

    # 点开回到输入框
    d.execute("""
      var reps = document.querySelectorAll('.reply[data-act=edit-cause]');
      for (var i=0;i<reps.length;i++){
        if (reps[i].textContent.indexOf('这条事实对应的原因') >= 0){ reps[i].click(); return true; }
      }
      return false;
    """)
    time.sleep(0.5)
    back = d.execute("""
      var ins = document.querySelectorAll('.cause-in');
      for (var i=0;i<ins.length;i++){
        if (ins[i].value.indexOf('这条事实对应的原因') >= 0)
          return {back: true, value: ins[i].value};
      }
      return {back: false};
    """)
    check("点只读的原因回到输入框并带回原值", back.get("back"), str(back))

    # 收起编辑态
    d.execute("""
      var ins = document.querySelectorAll('.cause-in');
      for (var i=0;i<ins.length;i++){
        if (ins[i].value.indexOf('这条事实对应的原因') >= 0){
          document.querySelector('[data-act=cancel-cause][data-fact="' + ins[i].getAttribute('data-fact') + '"]').click();
          return true;
        }
      }
      return false;
    """)
    time.sleep(0.5)

    act_saved = d.execute("""
      var reps = document.querySelectorAll('.reply[data-act=edit-action]');
      for (var i=0;i<reps.length;i++){
        if (reps[i].textContent.indexOf('点击这里锻造新装备') >= 0){ reps[i].click(); return true; }
      }
      return false;
    """)
    time.sleep(0.5)
    act_saved2 = d.execute("""
      var ai = document.querySelector('.action-in');
      if (!ai) return {no: true};
      var fi = ai.getAttribute('data-fact');
      ai.value = '这条事实对应的改进';
      ai.dispatchEvent(new Event('input', {bubbles:true}));
      document.querySelector('[data-act=save-action][data-fact="' + fi + '"]').click();
      var g = window.Reflect.store.getGoal('demo-current-clip');
      var a = null;
      for (var i2=0;i2<g.actions.length;i2++) if (g.actions[i2].factId === fi) a = g.actions[i2];
      return {factId: fi, title: a ? a.title : '', actionFactId: a ? a.factId : ''};
    """)
    time.sleep(0.7)
    check("在事实下面能存下改进",
          act_saved2.get("title") == "这条事实对应的改进", str(act_saved2))
    check("改进挂到了那条事实上",
          act_saved2.get("actionFactId") == act_saved2.get("factId")
          and act_saved2.get("factId"), str(act_saved2))

    # ---------- D2. 删除目标 ----------
    print("\n[D2] 目标页删除目标")
    d.execute("""
      window.__tmpGoal = window.Reflect.store.createGoal({description:'待删除的临时目标', criteria:['随便写一条']});
      return true;
    """)
    time.sleep(0.5)
    d.execute("location.hash = '#/goals'; return true;")
    time.sleep(0.6)
    # 卡片上不再有垃圾桶按钮
    no_btn = d.execute("""
      var v = document.getElementById('view');
      return {trash: v.querySelectorAll('[data-act=delete-goal]').length,
              cards: v.querySelectorAll('.proj-card').length,
              tip: v.textContent};
    """)
    check("目标卡片上没有删除按钮", no_btn.get("trash") == 0, str(no_btn))
    check("目标页提示长按可删除", "长按" in no_btn.get("tip", ""), no_btn.get("tip", "")[:120])

    # 短按不该弹出删除菜单
    d.execute("""
      var card = document.querySelector('.proj-card[data-id="' + window.__tmpGoal.id + '"]');
      if (!card) return false;
      card.dispatchEvent(new MouseEvent('mousedown', {bubbles:true}));
      card.dispatchEvent(new MouseEvent('mouseup', {bubbles:true}));
      return true;
    """)
    time.sleep(0.9)
    short_press = d.execute("""
      var m = document.getElementById('modal-root');
      return {menu: !!m.querySelector('[data-act=delete-goal-now]'),
              hash: location.hash};
    """)
    check("短按不弹删除菜单", not short_press.get("menu"), str(short_press))

    # 长按 → 弹出删除菜单
    d.execute("""
      var card = document.querySelector('.proj-card[data-id="' + window.__tmpGoal.id + '"]');
      if (!card) return false;
      card.dispatchEvent(new MouseEvent('mousedown', {bubbles:true}));
      return true;
    """)
    time.sleep(0.9)
    menu = d.execute("""
      var m = document.getElementById('modal-root');
      var btn = m.querySelector('[data-act=delete-goal-now]');
      return {menu: !!btn, text: m.textContent, hasConfirm: !!m.querySelector('[data-act=cf-yes]'),
              before: window.Reflect.store.getGoals().length};
    """)
    check("长按目标弹出删除菜单", menu.get("menu"), str(menu))
    check("删除菜单没有二次确认框", not menu.get("hasConfirm"), str(menu))
    check("删除菜单说明会连带删除", "一起删掉" in menu.get("text", ""), menu.get("text", "")[:120])

    d.execute("""
      var b = document.querySelector('[data-act=delete-goal-now]');
      if (b) b.click();
      return true;
    """)
    time.sleep(0.7)
    del_res = d.execute("""
      var gs = window.Reflect.store.getGoals();
      var still = false;
      for (var i=0;i<gs.length;i++) if (gs[i].id === window.__tmpGoal.id) still = true;
      return {after: gs.length, still: still};
    """)
    check("菜单里点删除，目标被删掉", del_res.get("after") == menu.get("before", 0) - 1, str(del_res))
    check("删掉的目标确实没了", not del_res.get("still"), str(del_res))

    # ---------- D. 提交复盘 ----------
    print("\n[D] 提交复盘后回到目标页")
    d.execute("location.hash = '#/review/' + arguments[0]; return true;", [created["id"]])
    time.sleep(0.6)
    submitted = d.execute("""
      document.querySelector('[data-act=submit-review]').click();
      return true;
    """)
    time.sleep(0.6)
    sub = d.execute("""
      var g = window.Reflect.store.getGoal(arguments[0]);
      return {hash: location.hash, submittedAt: g.submittedAt || 0,
              text: document.getElementById('view').textContent};
    """, [created["id"]])
    check("提交后回到目标页", sub["hash"] == "#/goals", sub["hash"])
    check("提交后打上提交标记", sub["submittedAt"] > 0, str(sub["submittedAt"]))
    check("目标页能看到刚提交的目标", "很快" in sub["text"], "")

    d.execute("location.hash = '#/goals'; return true;")
    time.sleep(0.5)
    badge = d.execute("""
      var v = document.getElementById('view');
      var t = v.textContent;
      return {hasSubmitted: t.indexOf('已提交') >= 0, text: t};
    """)
    check("目标页显示「已提交」状态", badge["hasSubmitted"], "")

    # ---------- E. 改进闭环 ----------
    print("\n[E] 改进闭环必须留验证结论")
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

    # ---------- F. 统计页 ----------
    print("\n[F] 统计页：总体 + 对比")
    d.execute("location.hash = '#/stats'; return true;")
    time.sleep(0.6)
    stats = d.execute("""
      var v = document.getElementById('view');
      var boxes = v.querySelectorAll('.stat-box');
      var labels = [];
      for (var i=0;i<boxes.length;i++) {
        var l = boxes[i].querySelector('.l');
        labels.push(l ? l.textContent.trim() : '');
      }
      return {count: boxes.length, labels: labels,
              hasA: !!document.getElementById('cmp-a'), hasB: !!document.getElementById('cmp-b'),
              hasRun: !!v.querySelector('[data-act=cmp-run]'),
              hasExportAll: !!v.querySelector('[data-act=export-all]'),
              text: v.textContent};
    """)
    check("统计页有四个数字", stats["count"] == 4, str(stats["count"]))
    check("数字是总数/进行中/已闭环/闭环率",
          stats["labels"] == ["目标总数", "进行中", "已闭环", "改进闭环率"], str(stats["labels"]))
    check("有对比的两个下拉", stats["hasA"] and stats["hasB"], str(stats))
    check("有「开始对比」按钮", stats["hasRun"], str(stats["hasRun"]))
    check("有「导出全部报告」按钮", stats["hasExportAll"], str(stats["hasExportAll"]))

    # 造一对有重复原因的目标，再对比
    d.execute("""
      var gs = window.Reflect.store.getGoals();
      var cur = gs[0];
      var other = window.Reflect.store.createGoal({description:'上次的目标', criteria:['耗时 ≤ 30 秒']});
      window.Reflect.store.addCause(other.id, {text:'新手找不到模板入口', factIds:[]});
      var a1 = window.Reflect.store.addAction(other.id, {title:'优化模板入口'});
      window.Reflect.store.closeAction(a1.id, '完成率升到 80%');
      window.Reflect.store.addAction(other.id, {title:'加一个导出进度条'});
      window.Reflect.store.addCause(cur.id, {text:'新手找不到模板入口', factIds:[]});
      return {cur: cur.id, other: other.id};
    """)
    time.sleep(0.4)
    cmp_ui = d.execute("""
      var gs = window.Reflect.store.getGoals();
      var a = document.getElementById('cmp-a');
      var b = document.getElementById('cmp-b');
      a.value = arguments[0]; b.value = arguments[1];
      a.dispatchEvent(new Event('change', {bubbles:true}));
      b.dispatchEvent(new Event('change', {bubbles:true}));
      document.querySelector('[data-act=cmp-run]').click();
      var v = document.getElementById('view');
      return {highlight: v.querySelectorAll('.highlight').length,
              text: v.textContent};
    """, [created["id"], "demo-current-clip"])
    time.sleep(0.6)
    check("对比结果高亮重复原因/未闭环改进", cmp_ui["highlight"] >= 1,
          str(cmp_ui["highlight"]) + " TEXT=" + str(cmp_ui.get("text", ""))[:400])
    check("对比里出现「重复原因」", "重复原因" in cmp_ui["text"], "")
    check("对比里出现「没闭环」", "没闭环" in cmp_ui["text"], "")

    # ---------- G. 导出 ----------
    print("\n[G] 导出")
    exp = d.execute("""
      var gs = window.Reflect.store.getGoals();
      var md = window.Reflect.export.buildMarkdown(gs[0], gs);
      var sm = window.Reflect.export.buildSummary(gs[0]);
      var all = window.Reflect.export.buildAllMarkdown(gs);
      return {mdLen: md.length, smLen: sm.length, allLen: all.length, md: md, sm: sm, all: all};
    """)
    check("Markdown 报告非空", exp["mdLen"] > 200, str(exp["mdLen"]))
    check("报告含目标/结果/事实/原因/改进各段",
          all(k in exp["md"] for k in ["目标", "结果", "事实", "原因", "改进"]))
    check("报告标注尚未闭环的改进", "尚未闭环" in exp["md"], "")
    check("报告不再有版本链/对照段",
          "版本链" not in exp["md"] and "原目标与修正目标对照" not in exp["md"], "")
    check("摘要非空", exp["smLen"] > 20, str(exp["smLen"]))
    check("全部目标合集报告非空且含多个目标",
          exp["allLen"] > exp["mdLen"] and exp["all"].count("# 复盘报告：") >= 2, str(exp["allLen"]))
    open(os.path.join(SHOTS, "report-sample.md"), "w", encoding="utf-8").write(exp["md"])

    # 复盘页的导出弹层
    d.execute("location.hash = '#/review/' + arguments[0]; return true;", [created["id"]])
    time.sleep(0.6)
    d.execute("document.querySelector('[data-act=open-export]').click(); return true;")
    time.sleep(0.5)
    modal = d.execute("""
      var m = document.getElementById('modal-root');
      return {has: !!m.innerHTML.trim(), hasMd: !!m.querySelector('.md'),
              hasSave: !!m.querySelector('[data-act=save-md]'),
              hasShare: !!m.querySelector('[data-act=share-md]')};
    """)
    check("复盘页能打开导出弹层", modal["has"] and modal["hasMd"], str(modal))
    check("导出弹层有写入文件与分享", modal["hasSave"] and modal["hasShare"], str(modal))
    d.execute("document.querySelector('[data-act=cl-cancel]') ? null : null; return true;")

    # ---------- 全流程 UI 渲染 ----------
    print("\n[UI] 各页面渲染")
    pages = [
        ("#/goals", "p1-goals.png"),
        ("#/review/new", "p2-review-new.png"),
        ("#/review/demo-current-clip", "p3-review.png"),
        ("#/stats", "p4-stats.png"),
    ]
    for hash_, shot in pages:
        d.execute("location.hash = arguments[0]; return true;", [hash_])
        time.sleep(0.55)
        d.screenshot(os.path.join(SHOTS, shot))
        body_len = d.execute("return document.body ? document.body.innerText.trim().length : 0")
        check("页面 %s 有内容渲染" % hash_, body_len > 10, "len=%d" % body_len)

    # ---------- 控制台错误 ----------
    print("\n[H] 控制台")
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
