import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { parse, compileTemplate } from '@vue/compiler-sfc'
import { compileString } from 'sass'

const root = 'src/renderer/src'
const semantic = /^container_[a-z][a-z0-9-]*_[a-z][a-z0-9-]*_[a-z][a-z0-9-]*_[a-z][a-z0-9-]*$/
const names = new Map(),
  registry = [],
  failures = []

async function files(path) {
  const entries = await readdir(path, { withFileTypes: true })
  return (
    await Promise.all(
      entries.map((entry) => (entry.isDirectory() ? files(join(path, entry.name)) : join(path, entry.name)))
    )
  ).flat()
}

function checkStyles(source, file) {
  // Check expanded SCSS, so nesting cannot conceal invalid selector classes.
  const css = compileString(source, { loadPaths: ['node_modules', join(root, 'styles')] }).css
  for (const match of css.matchAll(/\.([a-zA-Z_][\w-]*)/g)) {
    if (!semantic.test(match[1])) failures.push(`${file}: 非法样式类 .${match[1]}`)
  }
}

function extractDynamicBases(expression) {
  const bases = []
  for (const match of expression.matchAll(/['"]([^'"]+)['"]/g)) {
    const raw = match[1]
    // Ignore non-class string comparisons (e.g. page === 'workspace') unless inside array/object class expressions.
    if (raw.startsWith('container_')) bases.push(raw)
  }
  return bases
}

for (const file of await files(root)) {
  if (file.endsWith('.vue')) {
    const source = await readFile(file, 'utf8')
    const { descriptor } = parse(source)
    if (descriptor.template) {
      const { ast, errors } = compileTemplate({
        source: descriptor.template.content,
        filename: file,
        id: file
      })
      failures.push(...errors.map((error) => `${file}: ${String(error)}`))
      const visited = new WeakSet()
      function walk(node, repeated = false) {
        if (!node || typeof node !== 'object' || visited.has(node)) return
        visited.add(node)
        repeated ||= node.type === 11 || node.props?.some((prop) => prop.type === 7 && prop.name === 'for')
        if (node.type === 1 && node.tagType === 0 && node.tag !== 'template' && node.tag !== 'slot') {
          const staticClass = node.props.find((prop) => prop.type === 6 && prop.name === 'class')
          const dynamicClass = node.props.find(
            (prop) => prop.type === 7 && prop.name === 'bind' && prop.arg?.content === 'class'
          )
          const expression = dynamicClass?.exp?.loc?.source ?? dynamicClass?.exp?.content ?? ''
          const staticBases = staticClass?.value?.content.split(/\s+/).filter(Boolean) ?? []
          const dynamicBases = dynamicClass ? extractDynamicBases(expression) : []
          if (dynamicClass) {
            // Catch non-semantic object keys ({ active: isActive }) or bare class strings in :class.
            for (const keyMatch of expression.matchAll(/([{,]\s*)([a-zA-Z_][\w-]*)\s*:/g)) {
              if (!semantic.test(keyMatch[2])) {
                failures.push(`${file}:${node.loc.start.line}: 动态 :class 包含非法类 ${keyMatch[2]}`)
              }
            }
            for (const strMatch of expression.matchAll(/['"]([a-zA-Z_][\w-]*)['"]/g)) {
              const token = strMatch[1]
              if (token.startsWith('container_') && !semantic.test(token)) {
                failures.push(`${file}:${node.loc.start.line}: 动态 :class 格式错误 ${token}`)
              }
            }
          }
          const bases = [...staticBases, ...dynamicBases]
          if (!bases.length || bases.some((base) => !semantic.test(base)))
            failures.push(`${file}:${node.loc.start.line}: <${node.tag}> 缺少有效语义类`)
          if (repeated) {
            const hasInstanceToken =
              Boolean(dynamicClass) &&
              (expression.includes('instanceClass') || /\bc\(/.test(expression) || /-i\$\{/.test(expression))
            if (!hasInstanceToken)
              failures.push(
                `${file}:${node.loc.start.line}: 重复元素缺少实例类 (${expression || 'no :class'})`
              )
          }
          for (const base of bases) {
            if (names.has(base))
              failures.push(`${file}:${node.loc.start.line}: 语义类重复 ${base} (${names.get(base)})`)
            names.set(base, `${file}:${node.loc.start.line}`)
            registry.push({
              class: base,
              file: relative('.', file).replaceAll('\\', '/'),
              line: node.loc.start.line,
              repeated,
              dynamic: Boolean(dynamicClass)
            })
          }
        }
        if (node.children) node.children.forEach((child) => walk(child, repeated))
        if (node.branches) node.branches.forEach((branch) => walk(branch, repeated))
      }
      walk(ast)
    }
    for (const style of descriptor.styles) checkStyles(style.content, file)
  } else if (
    file.endsWith('.scss') &&
    !file.endsWith('_third-party-adapters.scss') &&
    !file.endsWith('global.scss')
  )
    checkStyles(await readFile(file, 'utf8'), file)
}

// The global stylesheet imports tokens and registered third-party adapters.
const global = (await readFile(join(root, 'styles/global.scss'), 'utf8')).replace(/^@use .*;$/gm, '')
checkStyles(global, 'global.scss')

await mkdir('artifacts', { recursive: true })
await writeFile('artifacts/semantic-classes.json', JSON.stringify(registry, null, 2))
if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else console.log(`语义类检查通过：${registry.length} 个模板角色；已生成 artifacts/semantic-classes.json`)
