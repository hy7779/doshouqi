# 斗兽棋 · 离线单机版

双击 `ai-local.html` 就能玩：不需要 Node、不需要联网、不需要 DSH 在线。
你执红先行，电脑执蓝应招。

## 和原来那版（`ai-doushouqi.html`）的区别

| | 旧版 | 本版 |
| --- | --- | --- |
| 对手是谁 | DSH 这个 agent，经 Turn Gateway 中转落子 | 浏览器内的 alpha-beta 搜索 |
| 运行前提 | 必须先跑 `start.ps1` | 无，双击即可 |
| 联网 | 本地 HTTP + SSE | 不需要 |
| 悔棋 / 棋谱 / 难度 | 无 | 有 |

## 玩法

- 点红方棋子，再点高亮格落子；电脑自动应招。
- **悔棋**一次撤两手（你的一步 + 电脑的一步）。
- **难度**：轻松 / 普通 / 困难 / 大师，会记在 localStorage 里，下次打开还是这个难度。
- 右侧「深度 / 节点 / 评估」是电脑上一手搜索的实况，评估为正表示电脑觉得自己占优。

| 难度 | 搜索上限 | 乱走概率 |
| --- | --- | --- |
| 轻松 | 2 层 | 34% |
| 普通 | 4 层 / 350ms | 8% |
| 困难 | 8 层 / 900ms | 0 |
| 大师 | 12 层 / 1600ms | 0 |

## 文件

| 文件 | 作用 |
| --- | --- |
| `ai-local.html` | **构建产物，唯一需要双击的文件**（规则 + 搜索 + 界面全内联） |
| `page.html` | 页面模板：HTML 结构 + 界面逻辑 |
| `page.css` | 样式，从 `ai-doushouqi.html` 的 `<style>` 里原样抽出 |
| `engine.mjs` | 规则引擎副本，和项目根目录那份一致 |
| `ai-search.mjs` | 搜索：紧凑棋盘走法生成 + alpha-beta + 评估函数 |
| `build.mjs` | 把上面几份内联成 `ai-local.html` |
| `test-diff.mjs` | 差分测试：搜索用的走法生成器 vs `engine.mjs` 的 `movesOf` |
| `test-artifact.mjs` | 产物测试：直接在 Node 里执行 `ai-local.html` 里的内联脚本 |
| `e2e.mjs` | 无头 Edge + CDP，真点鼠标验证落子 / 应招 / 悔棋 / 结算 / 手机布局 |

## 修改流程

```powershell
# 1. 改 page.html / ai-search.mjs / engine.mjs
# 2. 重新生成单文件
node build.mjs
# 3. 跑测试（差分测试最关键）
node test-diff.mjs 400
node test-artifact.mjs
# 4. 双击 ai-local.html 看一眼
```

`e2e.mjs` 需要 Edge 能正常启动（约 1 分钟），会顺手生成
`shot-mid.png` / `shot-play.png` / `shot-mobile.png` 三张截图。

## 两个必须知道的约定

1. **`engine.mjs` 是副本。** 规则改了要先把根目录那份同步过来再 build，
   否则搜索用的规则和实际落子的规则会分叉——`test-diff.mjs` 会把分叉点直接打出来。
2. **搜索只负责“提议走法”。** 棋盘落子始终走 `engine.mjs` 的 `applyMove`，
   所以规则的唯一解释权还在原引擎手里，AI 不可能走出一手规则外的棋。

> 差分测试不是摆设：第一版把陷阱规则写反了（应该是“踩进**对方**陷阱归零”，
> 我写成了自家陷阱），正是它在一个 85,276 个局面的随机对局测试里抓出来的。

## 想发到网上

把 `ai-local.html` 拷到仓库根目录，推 GitHub Pages，然后访问
`https://hy7779.github.io/doshouqi/ai-local.html` 即可。它是单文件，没有任何外部依赖。

## 调难度

`page.html` 里的 `LEVELS`：

```js
const LEVELS = {
  easy:   { timeMs: 150,  depth: 2,  random: 0.34 },
  normal: { timeMs: 350,  depth: 4,  random: 0.08 },
  hard:   { timeMs: 900,  depth: 8,  random: 0 },
  master: { timeMs: 1600, depth: 12, random: 0 }
};
```

`random` 是“这一手直接乱走”的概率，调大就更菜。改完记得 `node build.mjs`。
