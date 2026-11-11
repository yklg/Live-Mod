import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// ===== 机制层守卫（壳 v3 · 计划 §6 · G1/G2/G3）=====
// 这三条守的是「**能力不得悄悄回来**」：
//   G1 连接层不得再有 attach→launch 降级重试、不得再有 runtimeEnvState.degrade
//   G2 几何真源不得再有 RAIL_W（图标条常量）、dockFits 只能在 layoutMode==='dock' 分支被调
//   G3 全仓不得再有 forceExternal（强制外部浏览器逃生口）
//
// 为什么用 AST 而不是全仓正则：
//   - 正则会误伤**注释与字符串字面量**里的同名字样（例如文档里提到"强制外部浏览器"）；
//   - 正则也看不出"在哪个分支里调用"（G2 需要分支上下文）。
//   AST 天然只看**代码结构**：注释不是节点、字符串字面量不是标识符。
//
// 三条都配「合法必绿」等价类与「故意写回即红」负向哨兵：
//   - 等价类：用合成片段验证探测器本身是对的（能抓出违规写法，也不误报正常写法）；
//   - 负向哨兵：直接对**真实文件**断言——谁把违规写法写回来，CI 立刻红。

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(here, '../../../..')

/** 解析源码为 AST；解析失败必须响亮报出（不静默放过——静默放过等于守卫失效） */
function parseSource(file: string, text: string): ts.SourceFile {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
  // parseDiagnostics 不在公开类型上，但它是"解析是否成功"的唯一权威信号
  const diagnostics = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] })
    .parseDiagnostics
  if (diagnostics && diagnostics.length > 0) {
    const msgs = diagnostics
      .map(d => ts.flattenDiagnosticMessageText(d.messageText, ' '))
      .join('; ')
    throw new Error(`AST 解析失败（${file}）：${msgs}`)
  }
  return sf
}

function readSource(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8')
}

/** 遍历 AST */
function walk(node: ts.Node, visit: (n: ts.Node) => void) {
  visit(node)
  ts.forEachChild(node, c => walk(c, visit))
}

/** 找标识符（**排除属性名**与字符串字面量——只有变量/属性声明才算引用） */
function findIdentifiers(sf: ts.SourceFile, name: string): ts.Identifier[] {
  const out: ts.Identifier[] = []
  walk(sf, n => {
    if (!ts.isIdentifier(n) || n.text !== name) return
    const parent = n.parent
    // obj.forceExternal 的 forceExternal 是属性名，不是变量引用
    if (ts.isPropertyAccessExpression(parent) && parent.name === n) return
    if (ts.isPropertyAssignment(parent) && parent.name === n) return
    out.push(n)
  })
  return out
}

/** 找 `obj.prop(...)` 形式的调用 */
function findMethodCalls(
  sf: ts.SourceFile,
  objectName: string,
  methodName: string,
): ts.CallExpression[] {
  const out: ts.CallExpression[] = []
  walk(sf, n => {
    if (!ts.isCallExpression(n)) return
    const callee = n.expression
    if (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === objectName &&
      callee.name.text === methodName
    ) {
      out.push(n)
    }
  })
  return out
}

/** 找形如 `{ mode: 'launch' }` 的对象字面量属性（降级重试的典型写法） */
function findLaunchModeLiteral(sf: ts.SourceFile): ts.PropertyAssignment[] {
  const out: ts.PropertyAssignment[] = []
  walk(sf, n => {
    if (!ts.isPropertyAssignment(n)) return
    const key = n.name
    const name = ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : ''
    if (name !== 'mode') return
    const v = n.initializer
    if (ts.isStringLiteral(v) && v.text === 'launch') out.push(n)
  })
  return out
}

/** 找 dockFits 调用点是否落在 layoutMode==='dock' 分支内 */
function findDockFitsOutsideDockBranch(sf: ts.SourceFile): ts.CallExpression[] {
  const offenders: ts.CallExpression[] = []
  walk(sf, n => {
    if (!ts.isCallExpression(n)) return
    const callee = n.expression
    if (!ts.isIdentifier(callee) || callee.text !== 'dockFits') return
    // 向上找包住它的 IfStatement
    let cur: ts.Node | undefined = n
    let guarded = false
    while (cur) {
      if (ts.isIfStatement(cur)) {
        const cond = cur.expression.getText(sf)
        if (cond.includes('layoutMode') && cond.includes("'dock'")) {
          guarded = true
          break
        }
      }
      cur = cur.parent
    }
    if (!guarded) offenders.push(n)
  })
  return offenders
}

/** 递归收集源码目录下的 .ts/.tsx 文件（跳过 node_modules 与隐藏目录） */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = path.join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) collectSourceFiles(full, out)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

describe('G1 连接层：不得再有降级回退', () => {
  const CONNECTION = 'electron/main/ipc/connection.ts'

  it('G1 连接文件不含 mode:"launch" 重试字面量', () => {
    const sf = parseSource(CONNECTION, readSource(CONNECTION))
    const offenders = findLaunchModeLiteral(sf)
    expect(
      offenders.map(o => o.getText(sf)),
      '连接层不得再有以 launch 形态重试的降级块',
    ).toEqual([])
  })

  it('G1 连接文件不含 runtimeEnvState.degrade 调用', () => {
    const sf = parseSource(CONNECTION, readSource(CONNECTION))
    const offenders = findMethodCalls(sf, 'runtimeEnvState', 'degrade')
    expect(
      offenders.map(o => o.getText(sf)),
      '降级状态写入点必须清零（降级层已整体下线）',
    ).toEqual([])
  })

  it('G1 等价类：探测器能抓出违规写法，也不误报正常写法', () => {
    const bad = `runtimeEnvState.degrade(platform); await session.connect({ mode: 'launch' })`
    const good = 'await session.connect({ headless, storageState, mode })'
    expect(findMethodCalls(parseSource('bad.ts', bad), 'runtimeEnvState', 'degrade')).toHaveLength(
      1,
    )
    expect(findLaunchModeLiteral(parseSource('bad.ts', bad))).toHaveLength(1)
    expect(
      findMethodCalls(parseSource('good.ts', good), 'runtimeEnvState', 'degrade'),
    ).toHaveLength(0)
    expect(findLaunchModeLiteral(parseSource('good.ts', good))).toHaveLength(0)
  })

  it('G1 负向哨兵：注释与字符串里的同名字样不算违规（只有代码结构才算）', () => {
    const text = `// runtimeEnvState.degrade(platform) 已下线\nconst note = "mode: 'launch'"`
    const sf = parseSource('comment.ts', text)
    expect(findMethodCalls(sf, 'runtimeEnvState', 'degrade')).toHaveLength(0)
    expect(findLaunchModeLiteral(sf)).toHaveLength(0)
  })
})

describe('G2 几何真源：图标条常量不得复活', () => {
  const LAYOUT = 'electron/main/windows/shellLayout.ts'

  it('G2 shellLayout 不含 RAIL_W 标识符', () => {
    const sf = parseSource(LAYOUT, readSource(LAYOUT))
    const offenders = findIdentifiers(sf, 'RAIL_W')
    expect(
      offenders.map(o => o.getText(sf)),
      '56px 图标条常量必须保持删除（D4）',
    ).toEqual([])
  })

  it("G2 dockFits 只在 layoutMode==='dock' 分支被调用", () => {
    const sf = parseSource(LAYOUT, readSource(LAYOUT))
    const offenders = findDockFitsOutsideDockBranch(sf)
    expect(
      offenders.map(o => o.getText(sf)),
      'dockFits 是 dock 分支专属门禁，overlay 分支不得调用',
    ).toEqual([])
  })

  it('G2 等价类：分支判定器能区分「在 dock 分支内」与「在分支外」', () => {
    const inside = `if (layoutMode === 'dock' && dockFits(winW, width)) { return 1 }`
    const outside = 'const fits = dockFits(winW, width)'
    expect(findDockFitsOutsideDockBranch(parseSource('in.ts', inside))).toHaveLength(0)
    expect(findDockFitsOutsideDockBranch(parseSource('out.ts', outside))).toHaveLength(1)
  })
})

describe('G3 全仓：强制外部浏览器逃生口不得复活', () => {
  it('G3 源码中 forceExternal 标识符出现次数 = 0', () => {
    const files = [
      ...collectSourceFiles(path.join(ROOT, 'electron')),
      ...collectSourceFiles(path.join(ROOT, 'src')),
      ...collectSourceFiles(path.join(ROOT, 'shared')),
    ]
    const offenders: string[] = []
    for (const file of files) {
      const rel = path.relative(ROOT, file)
      const sf = parseSource(rel, readFileSync(file, 'utf8'))
      for (const id of findIdentifiers(sf, 'forceExternal')) {
        offenders.push(`${rel}:${sf.getLineAndCharacterOfPosition(id.getStart(sf)).line + 1}`)
      }
    }
    console.log(`[G3] 扫描文件数：${files.length}`)
    expect(offenders, '强制外部浏览器逃生口必须保持删除（壳 v3 · Wave 1）').toEqual([])
  })

  it('G3 等价类：标识符探测器能抓出违规写法，也不误报字符串与属性名', () => {
    const bad = 'const forceExternal = true; context.forceExternal = forceExternal'
    const good = `const label = 'forceExternal'; obj.forceExternal = 1`
    const badSf = parseSource('bad.ts', bad)
    // 声明 1 处 + 右侧引用 1 处（属性名不算）
    expect(findIdentifiers(badSf, 'forceExternal')).toHaveLength(2)
    const goodSf = parseSource('good.ts', good)
    // 字符串字面量不算；属性名（.forceExternal）不算标识符声明
    expect(findIdentifiers(goodSf, 'forceExternal')).toHaveLength(0)
  })
})

// ===== G4 菜单收起信号（菜单项点击无反应回归的机制守卫）=====
// 不变量：菜单收起只能由显式外部输入驱动（page input-event / chrome pointerdown / ESC / 表面迁移）。
// 反例：railView 也是菜单宿主，点击菜单项会让焦点进入 rail；若用 focus/blur 关菜单，
// click 在 mouseup 前就被收起 → 所有菜单项都「点了没反应」。
describe('G4 菜单收起不得使用 focus/blur 推断', () => {
  const detector = (text: string) =>
    /dismissMenuOnFocus|railView\.webContents\.on\('(?:focus|blur)'/.test(text)

  it('G4 真实文件：shellUI 不再用 focus/blur 关菜单', () => {
    const src = readSource('electron/main/windows/shellUI.ts')
    expect(detector(src), '菜单收起不得依赖 rail focus/blur（点击会被提前收起）').toBe(false)
  })

  it('G4 等价类：违规写法命中，合法外部输入信号不误报', () => {
    expect(detector('const dismissMenuOnFocus = () => {}')).toBe(true)
    expect(detector("railView.webContents.on('focus', fn)")).toBe(true)
    expect(detector("chromeView.webContents.on('focus', fn)")).toBe(false)
    expect(detector("view.webContents.on('input-event', fn)")).toBe(false)
  })
})
