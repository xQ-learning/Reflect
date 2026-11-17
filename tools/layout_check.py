"""布局体检：在真实移动端视口下检查触控目标尺寸、溢出、层级、对比度等。"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from webdriver import WebDriver  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = "file://" + os.path.join(ROOT, "app", "assets", "index.html")
SHOTS = os.path.join(ROOT, "build", "shots")

PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print("  %s  %s  %s" % ("PASS" if cond else "FAIL", name, "" if cond else detail))


PROBE = """
  var out = {overflowX: 0, tiny: [], clipped: [], docW: document.documentElement.scrollWidth,
             winW: window.innerWidth, winH: window.innerHeight};
  // zoom 会放大 getBoundingClientRect 的返回值，除回 zoom 得到真实 CSS px
  var Z = parseFloat(document.documentElement.style.zoom) || 1;
  out.zoom = Z;
  out.overflowX = out.docW - out.winW;
  var all = document.querySelectorAll('button, a, input[type=checkbox], [data-act]');
  for (var i=0;i<all.length;i++){
    var e = all[i];
    var r = e.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    // 触控目标（可见交互元素）最小 40px
    var cw = r.width / Z, ch = r.height / Z;
    // 复选框的可点区域包含包裹它的 label
    var effW = cw, effH = ch;
    if (e.tagName === 'INPUT' && e.type === 'checkbox') {
      var lab = e.closest('label');
      if (lab) { var lr = lab.getBoundingClientRect();
                 effW = Math.max(effW, lr.width / Z); effH = Math.max(effH, lr.height / Z); }
    }
    if ((effW < 40 || effH < 40) && e.offsetParent !== null) {
      out.tiny.push((e.getAttribute('data-act')||e.className||e.tagName) + ' ' +
                    Math.round(effW) + 'x' + Math.round(effH));
    }
    // 内容被裁切（文本溢出且不可见）
    if (e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflow === 'hidden'
        && getComputedStyle(e).textOverflow !== 'ellipsis' && e.tagName !== 'TEXTAREA') {
      out.clipped.push((e.getAttribute('data-act')||e.className||e.tagName) +
                       ' sw=' + e.scrollWidth + ' cw=' + e.clientWidth);
    }
  }
  // 底部 tab 栏：项目列表页没有 tab 栏（只有进入项目后才有），此时跳过
  var tb = document.getElementById('tabbar');
  out.hasTabbar = !!(tb && tb.children.length);
  if (out.hasTabbar) {
    var r = tb.getBoundingClientRect();
    out.tabbarBottom = Math.round(r.bottom / Z); out.tabbarH = Math.round(r.height / Z);
    out.tabbarVisible = (r.bottom / Z) <= out.winH + 2 && (r.top / Z) < out.winH && r.height > 0;
    // 内容不被固定 tab 栏遮住：body 的 padding-bottom 需覆盖 tab 栏高度
    var pad = parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
    out.bodyPad = Math.round(pad);
    out.contentClear = pad >= out.tabbarH - 2;
    // tab 可横向滚动，6 个 tab 是否都能通过滚动到达
    out.tabScrollable = tb.scrollWidth > tb.clientWidth;
    out.tabCount = tb.children.length;
    out.tabWidth = Math.round(tb.children[0].getBoundingClientRect().width / Z);
  }
  var ab = document.getElementById('appbar');
  if (ab) { out.appbarH = Math.round(ab.getBoundingClientRect().height / Z); }
  return out;
"""


def main():
    d = WebDriver().start()
    try:
        return run(d)
    finally:
        d.quit()
        d.stop()


def run(d):
    d.new_session(width=500, height=844)
    d.navigate(INDEX)
    time.sleep(1.0)
    d.execute("window.Reflect.store.seedExample(); return true;")
    time.sleep(0.5)

    # Firefox 窗口最小宽度 500px，用 CSS zoom 模拟 360px 手机视口：
    # zoom 会把布局视口按比例缩小，从而真实触发窄屏下的换行/溢出问题
    ZOOM = 500.0 / 360.0

    routes = [
        ("#/projects", "项目列表"),
        ("#/project/demo-prev-template/goal", "目标"),
        ("#/project/demo-prev-template/result", "结果"),
        ("#/project/demo-prev-template/facts", "事实"),
        ("#/project/demo-prev-template/causes", "原因与改进"),
        ("#/project/demo-prev-template/compare", "对比"),
        ("#/project/demo-prev-template/export", "导出"),
        # 当前示例项目数据更全，用来压两栏布局（目标/标准、事实/关键事实）
        ("#/project/demo-current-clip/goal", "目标(全量)"),
        ("#/project/demo-current-clip/facts", "事实(全量)"),
        ("#/project/demo-current-clip/causes", "原因与改进(全量)"),
        ("#/project/demo-current-clip/compare", "对比(全量)"),
    ]
    print("\n[布局] 模拟 360px 手机视口 (zoom=%.2f)" % ZOOM)
    for hash_, label in routes:
        d.execute("location.hash = arguments[0]; return true;", [hash_])
        time.sleep(0.4)
        d.execute("document.documentElement.style.zoom = arguments[0]; return true;", [ZOOM])
        time.sleep(0.4)
        r = d.execute(PROBE)
        d.execute("document.documentElement.style.zoom = ''; return true;")
        print("\n  -- %s (%s)" % (label, hash_))
        check("%s 无横向溢出" % label, r["overflowX"] <= 1, "溢出 %spx" % r["overflowX"])
        check("%s 触控目标均 >=40px" % label, not r["tiny"], str(r["tiny"][:4]))
        check("%s 无内容裁切" % label, not r["clipped"], str(r["clipped"][:3]))
        if r.get("hasTabbar"):
            check("%s 底部 Tab 栏完整可见" % label, r["tabbarVisible"],
                  "bottom=%s winH=%s" % (r.get("tabbarBottom"), r["winH"]))
            check("%s 内容不被 Tab 栏遮挡" % label, r["contentClear"],
                  "bodyPad=%s tabH=%s" % (r.get("bodyPad"), r.get("tabbarH")))
            check("%s Tab 栏可横向滚动" % label, r["tabScrollable"],
                  "count=%s" % r.get("tabCount"))

    # 向导弹层
    print("\n[布局] 向导弹层")
    d.execute("window.Reflect.wizard.open(null, {}); return true;")
    time.sleep(0.6)
    r = d.execute("""
      var m = document.querySelector('.modal');
      if (!m) return {no: true};
      var r = m.getBoundingClientRect();
      return {w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top),
              bottom: Math.round(r.bottom), winH: window.innerHeight, winW: window.innerWidth,
              scrollable: m.scrollHeight > m.clientHeight};
    """)
    check("向导弹层已渲染", not r.get("no"), str(r))
    check("向导弹层宽度不溢出", r["w"] <= r["winW"], str(r))
    check("向导弹层纵向不超出视口", r["bottom"] <= r["winH"] + 2, str(r))
    check("向导弹层内容可滚动", r["scrollable"] or r["h"] <= r["winH"], str(r))

    # 文本对比度抽样
    print("\n[可读性]")
    contrast = d.execute("""
      function lum(c){
        var m = c.match(/[\\d.]+/g); if (!m) return null;
        var f = m.slice(0,3).map(function(x){x=x/255; return x<=0.03928? x/12.92 : Math.pow((x+0.055)/1.055,2.4);});
        return 0.2126*f[0]+0.7152*f[1]+0.0722*f[2];
      }
      function parseBg(el){
        var e = el;
        while (e && e !== document.documentElement){
          var bg = getComputedStyle(e).backgroundColor;
          if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
          e = e.parentElement;
        }
        return 'rgb(14,17,22)';
      }
      var bad = [];
      var els = document.querySelectorAll('.modal-sub, .muted, .kv, .item-t, .badge, .btn, h1,h2,h3, p, li, span');
      for (var i=0;i<els.length && i<80;i++){
        var el = els[i];
        if (!el.textContent.trim() || el.offsetParent === null) continue;
        var cs = getComputedStyle(el);
        var fg = cs.color, bg = parseBg(el);
        var l1 = lum(fg), l2 = lum(bg);
        if (l1 === null || l2 === null) continue;
        var ratio = (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);
        var size = parseFloat(cs.fontSize);
        var large = size >= 18 || (size >= 14 && parseInt(cs.fontWeight) >= 700);
        var need = large ? 3.0 : 4.5;
        if (ratio < need) bad.push(el.className + '|' + cs.color + '|' + bg + '|' + ratio.toFixed(2) + '|' + size);
      }
      return bad;
    """)
    check("文字对比度满足 WCAG AA", not contrast, str(contrast[:4]))

    print("\n" + "=" * 46)
    print("通过 %d / %d" % (len(PASS), len(PASS) + len(FAIL)))
    for n in FAIL:
        print("  FAIL: %s" % n)
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
