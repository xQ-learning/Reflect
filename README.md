# Reflect · 目标复盘

围绕「目标—结果差距」的轻量复盘工具。一个目标就是一次复盘：写下要什么、配一条能检验的标准，再把结果、事实、原因和改进攒起来。

原生 Android 应用（APK），数据全部存在本机，离线可用。

---

## 核心模型

主角是**目标**，不是「复盘项目」。一个目标 = 一次复盘。

| 板块 | 内容 |
|---|---|
| 目标 | 两栏：目标 ↔ 验证标准（可一条可多条） |
| 结果 | 实际结果、关键指标（指标名/实际值/目标值）、目标差距 |
| 事实 | 记下发生了什么，按时间排成时间线 |
| 原因与改进 | 原因（关联事实）→ 改进措施 → 验证结论闭环 |
| 对比 | 本次 vs 历史目标，高亮重复原因与上次没闭环的改进 |

流程：定目标 → 记结果 → 记事实 → 归因 → 改进 → 闭环 → 下次对比。

**目标怎么定**：左边写目标描述，右边写验证标准，填好点「创建目标」就完了。
没有版本链、没有修订版本 —— 目标要改就直接改，改完即当前版本。

**验证为什么可以先不填**：总结出来的经验往往不能即时验证，周期长，甚至可能在别的目标下才闭环。
所以改进措施先记下来，验证结论可以隔很久再补录；只有写下验证结论才能标记闭环。
没有闭环的改进，在下次对比里会被高亮出来。

不做：绩效追责、全量日志平台、复杂项目管理；对象轴/层级轴对比后置。

---

## 构建

环境要求：Android SDK（build-tools 34 + platform android-34）、JDK 17。**不需要 Gradle、Node、npm 或 pip。**

```bash
./build.sh                 # 产出 build/reflect.apk（已签名）
adb install -r build/reflect.apk
```

构建流水线是手工串起来的：`aapt2` → `javac` → `d8` → `zipalign` → `apksigner`。

签名密钥在首次构建时自动生成到 `keystore/reflect.jks`（已 gitignore）。
**后续版本必须用同一个密钥签名才能覆盖安装**，请把这个文件备份好。

环境变量可覆盖路径：`ANDROID_HOME`、`BUILD_TOOLS_VERSION`。

---

## 架构

```
┌─ 原生壳 (Java) ─────────────────────────────────┐
│  MainActivity: WebView 承载 assets 前端           │
│  · assets 映射到虚拟域名 https://reflect.local/   │
│    （不用 file:// 是为了让 localStorage 有稳定     │
│     origin，否则数据存不住）                      │
│  · AndroidBridge: saveFile / share / toast        │
│  · 返回键交给前端 Reflect.ui.onBack() 消费        │
└───────────────────┬──────────────────────────────┘
                    │ file:///android_asset 内联
┌───────────────────┴──────────────────────────────┐
│  前端 (原生 JS，无框架 / 无构建 / 无 CDN)          │
│  store.js    数据层，localStorage 持久化          │
│  compare.js  中文友好的原因相似度与对比            │
│  export.js   Markdown 报告与摘要                  │
│  ui.js       hash 路由与渲染                      │
└──────────────────────────────────────────────────┘
```

**数据层是唯一的存储出入口**（`Reflect.store`），UI 只调它。
纯本地优先，不带服务端；要加同步时只需在 store 层加一个同步适配器，UI 不用改。

设备间流转通过「导出 Markdown / 导入」。

---

## 数据模型

localStorage 键 `reflect.v2`：

```
goals[] = {
  id, goal: { description, criteria: [string] },
  results[], facts[], causes[], actions[],
  linkedGoalIds[], createdAt, updatedAt
}
```

- `facts[]`：`{ id, content, timelineAt }`
- `causes[]`：`{ id, text, factIds[] }`
- `actions[]`：`{ id, title, verifyResult, status(open/verified/failed), closedAt }`

---

## 功能

- **目标列表**：列出所有目标，每个带完成度；一个「创建目标」入口
- **目标**：两栏（目标 | 验证标准）；填好即可创建，已建好的可修改（修改即覆盖）
- **结果**：实际结果、关键指标、目标差距
- **事实**：记下发生了什么 + 时间点，按时间排成时间线
- **原因与改进**：原因（可关联事实）；改进只填一条「改进措施」，验证可延后补录
- **对比**：关联历史目标，高亮**重复原因**和**上次没闭环的改进**
- **导出**：Markdown 完整报告 + 摘要（可存文件或系统分享）

### 核心行为

| 行为 | 实现 |
|---|---|
| 目标必须有验证标准才能创建 | `validateCriteria()` 至少 1 条；不满足时按钮拒绝写入并提示 |
| 修改目标即覆盖 | `updateGoal()` 直接写当前目标，没有历史版本 |
| 改进没有验证结论不能闭环 | `closeAction()` 在 `verifyResult` 为空时返回 `{ok:false}`，UI 拦截并提示 |
| 对比高亮重复问题 | 中文不能靠空格分词，用**字符 bigram 的 Jaccard + 关键词集合重叠**混合打分，阈值 0.45 |

---

## 测试

```bash
python3 tools/acceptance_test.py   # 功能与验收测试（92 项）
python3 tools/layout_check.py       # 移动端布局体检（62 项）
```

用 `geckodriver` 驱动 Firefox 真实渲染前端来断言，不是 mock：

- `acceptance_test.py` —— 覆盖目标板块两栏与创建/覆盖流程、各板块形态、改进闭环规则、对比与导出、各页面渲染、控制台无报错
- `layout_check.py` —— 在 360px 手机视口下检查触控目标 ≥40px、横向溢出、内容裁切、Tab 栏遮挡、WCAG AA 对比度

> Firefox 窗口最小宽度 500px，布局测试用 CSS `zoom` 模拟 360px 视口以真实触发窄屏问题。
>
> 本机 Firefox 是 snap 包，受 confinement 限制**读不到 `/tmp`**。测试要在仓库目录或
> `~` 下运行，放到 `/tmp` 会报 `fileNotFound`。构建不受影响。

截图落在 `build/shots/`。

**本机没有 Android 模拟器（无 KVM）也没有连接真机**，所以 APK 未在设备上跑过。
UI 逻辑与布局由上述浏览器测试覆盖，原生壳部分（WebView 承载、导出文件、分享）只做了静态验证 —— 装到手机上后建议实际走一遍导出和分享。

---

## 目录

```
app/
  AndroidManifest.xml
  assets/            前端（会被打进 APK）
    index.html
    css/style.css
    js/{store,compare,export,ui}.js
  res/               图标与主题
  src/com/xlearning/reflect/MainActivity.java
tools/               测试工具
build.sh             构建脚本
```
