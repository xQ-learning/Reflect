"""截图助手：真实 Firefox 渲染 + CSS zoom 模拟 360px 手机视口，输出到 build/shots/。

用法： python3 tools/shot.py [输出前缀]
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from webdriver import WebDriver  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = "file://" + os.path.join(ROOT, "app", "assets", "index.html")
SHOTS = os.path.join(ROOT, "build", "shots")
ZOOM = 500.0 / 360.0
PREFIX = sys.argv[1] if len(sys.argv) > 1 else "s"

PAGES = [
    ("#/goals", "goals", None),
    ("#/review/demo-current-clip", "review", None),
    ("#/view/demo-current-clip", "battle", None),
    ("#/stats", "stats", None),
]


def main():
    if not os.path.isdir(SHOTS):
        os.makedirs(SHOTS)
    d = WebDriver().start()
    try:
        d.new_session(width=500, height=900)
        d.navigate(INDEX)
        time.sleep(1.0)
        d.execute("window.Reflect.store.seedExample(); return true;")
        time.sleep(0.4)
        for hash_, name, _ in PAGES:
            d.execute("location.hash = arguments[0]; return true;", [hash_])
            time.sleep(0.5)
            d.execute("document.documentElement.style.zoom = arguments[0]; return true;", [ZOOM])
            time.sleep(0.45)
            d.screenshot(os.path.join(SHOTS, "%s-%s.png" % (PREFIX, name)))
            d.execute("document.documentElement.style.zoom = ''; return true;")
        # 聊天时间线 + 状态胶囊
        d.execute("location.hash = '#/review/demo-current-clip'; return true;")
        time.sleep(0.5)
        d.execute("""
          var st = window.Reflect.store;
          var g = st.getGoal('demo-current-clip');
          st.addAction(g.facts[0].id, {title: '加一个输入前的空态提示', status: 'open'});
          var g2 = st.getGoal('demo-current-clip');
          if (g2.facts[1]) st.addAction(g2.facts[1].id,
            {title: '把导出失败率压到 5% 以下', status: 'verified', verifyResult: '跑了 30 次导出，失败 1 次'});
          return true;
        """)
        time.sleep(0.4)
        d.execute("document.documentElement.style.zoom = arguments[0]; return true;", [ZOOM])
        time.sleep(0.4)
        d.execute("var c = document.querySelector('.st-hit'); if (c) c.scrollIntoView({block:'center'}); return true;")
        time.sleep(0.5)
        d.screenshot(os.path.join(SHOTS, "%s-chip.png" % PREFIX))
    finally:
        d.quit()
        d.stop()
    print("shots ->", SHOTS)


if __name__ == "__main__":
    main()
