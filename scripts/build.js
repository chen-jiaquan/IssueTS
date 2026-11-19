// 构建脚本：前端产物 → public/（Windows 便携版与 Docker 镜像构建共用）
// 用法: node scripts/build.js
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function run(cmd, args, cwd) {
  console.log(`> ${cmd} ${args.join(' ')} (cwd=${path.relative(root, cwd) || '.'})`)
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0) {
    console.error('构建失败')
    process.exit(r.status ?? 1)
  }
}

console.log('== 1/2 构建前端 → public/ ==')
run('npm', ['run', 'build'], path.join(root, 'web'))

console.log('== 2/2 完成 ==')
console.log('后续: server 由 Node 直接运行（无编译步骤）；打包 zip 见 scripts/package.js（待开发）')
