# Reflect · 复盘

围绕「目标—结果差距」的轻量复盘工具。把模糊愿望变成可检验假设，把原因变成改进闭环。

原生 Android 应用（APK），数据全部存在本机，离线可用。

---

## 核心模型

| 维度 | 内容 |
|---|---|
| 纵向 | 目标 → 结果 → 事实 → 原因与改进 |
| 横向 | 本次 vs 上次/同类复盘 |
| 目标 | 目标 ↔ 可验证的标准（两栏） |
| 原则 | 目标可修正；事实与判断分开；改进必须闭环 |

流程：发起 → 翻译愿望 → 记结果 → 记事实 → 归因 → 改进 → 闭环 → 下次对比。

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
│  wizard.js   愿望→验证标准 引导向导               │
│  compare.js  中文友好的原因相似度与对比            │
│  export.js   Markdown 报告与摘要                  │
│  ui.js       hash 路由与渲染                      │
└──────────────────────────────────────────────────┘
```

**数据层是唯一的存储出入口**（`Reflect.store`），UI 只调它。
纯本地优先，不带服务端；要加同步时只需在 store 层加一个同步适配器，UI 不用改。

设备间流转通过「导出 Markdown / 导入」。

---

## 功能

- **复盘项目**：创建、轻量/标准模板、参与人、状态（草稿/进行中/已归档）
- **目标**（两栏）：左「目标」（愿望/场景/依据）、右「可验证的标准」；**版本留痕**
- **结果**：实际结果、关键指标（指标名/实际值/目标值）、目标差距
- **事实**（两栏）：左「事实」右「关键事实」，可随手标关键；底部保留**时间线**
- **原因与改进**：原因分层（目标翻译/执行/资源/外部/其他）并关联事实；改进只填一条**改进措施**
- **横向对比**：关联历史复盘，高亮**重复原因**和**上次没闭环的改进**
- **导出**：Markdown 完整报告 + 摘要（可存文件或系统分享）

### 验证为什么可以先不填

总结出来的经验往往不能即时验证，周期长，甚至可能在别的目标下才闭环。
所以**改进措施先记下来**，验证结论可以隔很久再补录；只有写下验证结论才能标记闭环。
没有验证结论的改进，在下次横向对比里会被高亮出来。

### 三条硬性验收

| # | 验收 | 实现 |
|---|---|---|
| A | 「我要很爽」能引导出至少一个验证标准 | 向导第 3 步选指标类型后生成**带阈值**的候选口径，未确认 ≥1 条则「下一步」按钮禁用；写入前 `validateCriteria` 二次校验 |
| B | 目标修改可追溯，报告展示原目标与修正目标 | `goal.versions[]` 保留全部版本并以 `revisedFrom` 串成版本链；报告含「原目标与修正目标对照」表并标注「已修正」 |
| C | 改进没有验证结论不能闭环；历史对比高亮重复问题 | `closeAction()` 在 `verifyResult` 为空时返回 `{ok:false}`，UI 拦截并提示；验证指标本身可选，可事后补录 |

重复原因识别：中文不能靠空格分词，用**字符 bigram 的 Jaccard + 关键词集合重叠**混合打分，阈值 0.45。

---

## 测试

```bash
python3 tools/acceptance_test.py   # 功能与验收测试（88 项）
python3 tools/layout_check.py       # 移动端布局体检（68 项）
```

用 `geckodriver` 驱动 Firefox 真实渲染前端来断言，不是 mock：

- `acceptance_test.py` —— 覆盖三条硬性验收、板块精简后的结构、导出内容、各页面渲染、旧版本数据升级、控制台无报错
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
    js/{store,compare,export,wizard,ui}.js
  res/               图标与主题
  src/com/xlearning/reflect/MainActivity.java
tools/               测试工具
build.sh             构建脚本
```
