import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

/** 验证平板使用两列、移动端单列，并清除堆叠列的桌面缩进。 */
test("keeps directory breakpoints readable from tablet to mobile", async () => {
  const [component, styles] = await Promise.all([
    readFile(
      new URL("../src/components/DirectoryColumn.astro", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/styles/directory.css", import.meta.url), "utf8"),
  ]);
  const selector = ".directory-column + .directory-column {";
  const tabletBreakpointStart = styles.indexOf(
    "@media (min-width: 761px) and (max-width: 960px)",
  );
  const mobileBreakpointStart = styles.indexOf("@media (max-width: 760px)");
  const desktopRuleStart = styles.indexOf(selector);
  const mobileRuleStart = styles.lastIndexOf(selector);

  assert.match(
    styles,
    /grid-template-rows:\s*repeat\(5, minmax\(1\.5em, auto\)\);/,
  );
  assert.match(styles, /\.directory-more-row\s*\{[^}]*grid-row:\s*5;/s);
  assert.doesNotMatch(styles, /\.column-heading h2 a/);
  assert.doesNotMatch(styles, /directory-column-entry-only/);
  assert.match(
    component,
    /<span class="directory-link-title">\{entry\.title\}<\/span>/,
    "目录应保留完整标题，只在视觉层处理溢出",
  );

  const entryRule = styles.match(
    /\.directory-links \[data-directory-entry\]\s*\{([^}]*)\}/,
  )?.[1];
  const entryAnchorRule = styles.match(
    /\.directory-links \[data-directory-entry\] a\s*\{([^}]*)\}/,
  )?.[1];
  const titleRule = styles.match(/\.directory-link-title\s*\{([^}]*)\}/)?.[1];
  assert.ok(entryRule);
  assert.ok(entryAnchorRule);
  assert.ok(titleRule);
  assert.match(entryRule, /min-width:\s*0;/);
  assert.match(entryAnchorRule, /max-width:\s*100%;/);
  assert.match(entryAnchorRule, /min-width:\s*0;/);
  assert.match(titleRule, /display:\s*block;/);
  assert.match(titleRule, /min-width:\s*0;/);
  assert.match(titleRule, /overflow:\s*hidden;/);
  assert.match(titleRule, /text-overflow:\s*ellipsis;/);
  assert.match(titleRule, /white-space:\s*nowrap;/);
  assert.ok(
    styles.indexOf(".directory-link-title") < tabletBreakpointStart,
    "单行省略规则应在所有响应式断点生效",
  );

  assert.notEqual(desktopRuleStart, -1, "应保留桌面端相邻列分隔规则");
  assert.ok(
    mobileRuleStart > mobileBreakpointStart &&
      mobileBreakpointStart > desktopRuleStart,
    "相邻列缩进必须在移动端媒体查询内归零",
  );

  const mobileRuleEnd = styles.indexOf("}", mobileRuleStart);
  const mobileRule = styles.slice(mobileRuleStart, mobileRuleEnd + 1);
  assert.match(mobileRule, /padding-inline-start:\s*0;/);
  assert.ok(
    tabletBreakpointStart > desktopRuleStart &&
      mobileBreakpointStart > tabletBreakpointStart,
    "两列平板规则必须位于四列桌面规则和单列移动规则之间",
  );
  const tabletRules = styles.slice(tabletBreakpointStart, mobileBreakpointStart);
  assert.match(tabletRules, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(tabletRules, /\.directory-column:nth-child\(odd\)/);
  assert.match(tabletRules, /\.directory-column:nth-child\(n \+ 3\)/);

  // 同时检查 Astro 最终产物，防止 CSS 编译阶段改变响应式覆盖关系。
  const assetNames = await readdir(new URL("../dist/_astro/", import.meta.url));
  const builtStyles = (
    await Promise.all(
      assetNames
        .filter((name) => name.endsWith(".css"))
        .map((name) => readFile(new URL(`../dist/_astro/${name}`, import.meta.url), "utf8")),
    )
  ).join("\n");
  assert.match(
    builtStyles,
    /@media\s*\((?:max-width:760px|width<=760px)\)\{[\s\S]*?\.directory-column\+\.directory-column\{(?=[^}]*padding-inline-start:0)(?=[^}]*border-inline-start:0)[^}]*\}/,
  );
  assert.match(builtStyles, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(builtStyles, /grid-template-rows:repeat\(5,minmax\(1\.5em,auto\)\)/);
  assert.match(builtStyles, /\.directory-more-row\{grid-row:5\}/);
  assert.match(
    builtStyles,
    /\.directory-links \[data-directory-entry\]\{min-width:0\}/,
  );
  assert.match(
    builtStyles,
    /\.directory-links \[data-directory-entry\] a\{(?=[^}]*max-width:100%)(?=[^}]*min-width:0)[^}]*\}/,
  );
  assert.match(
    builtStyles,
    /\.directory-link-title\{(?=[^}]*display:block)(?=[^}]*min-width:0)(?=[^}]*overflow:hidden)(?=[^}]*text-overflow:ellipsis)(?=[^}]*white-space:nowrap)[^}]*\}/,
  );
});
