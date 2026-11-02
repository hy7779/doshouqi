// 构建：把 page.css / engine.mjs / ai-search.mjs 内联进 page.html，
// 产出一个双击就能玩的单文件 ai-local.html。
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

const template = read('page.html');
const css = read('page.css');

const stripModuleSyntax = (src) =>
  src
    .replace(/^import\s.*$/gm, '')
    .replace(/^export\s+/gm, '')
    .trim();

const rules = stripModuleSyntax(read('engine.mjs'));
const search = stripModuleSyntax(read('ai-search.mjs'));

let out = template
  .split('/*__CSS__*/').join(css)
  .split('/*__RULES__*/').join(rules)
  .split('/*__AI__*/').join(search);

if (out.includes('/*__')) throw new Error('还有没替换的占位符');
if (/<\/script>/i.test(rules) || /<\/script>/i.test(search) || /<\/script>/i.test(css)) {
  throw new Error('内联内容里出现了 </script>，需要转义');
}

// 语法检查：把每个 <script> 块单独编译一遍（只编译，不执行）
const blocks = [...out.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
blocks.forEach((code, i) => {
  try {
    // eslint-disable-next-line no-new-func
    new Function(code);
  } catch (error) {
    throw new Error(`第 ${i + 1} 个 <script> 语法错误：${error.message}`);
  }
});

const target = path.join(root, 'ai-local.html');
fs.writeFileSync(target, out, 'utf8');

const kb = (Buffer.byteLength(out, 'utf8') / 1024).toFixed(1);
console.log(`✓ ${target}`);
console.log(`  ${out.split('\n').length} 行 / ${kb} KB / ${blocks.length} 个内联脚本（语法已校验）`);
