import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from 'lucide-react'
import { type FileMeta } from '@/lib/api.ts'
import { cn } from '@/lib/utils.ts'

export interface FileTreeNode {
  name: string
  path: string
  kind: 'folder' | 'file'
  file?: FileMeta
  children: FileTreeNode[]
}

/** 把扁平的文件 path（如 Template/sortspec.md）按 / 拆成树 */
export function buildFileTree(files: FileMeta[]): FileTreeNode[] {
  const root: FileTreeNode[] = []
  const map = new Map<string, FileTreeNode>()

  for (const f of files) {
    const parts = f.path.split('/')
    let parentPath = ''
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const fullPath = parentPath ? `${parentPath}/${part}` : part
      const isLast = i === parts.length - 1

      if (isLast) {
        const node: FileTreeNode = { name: part, path: fullPath, kind: 'file', file: f, children: [] }
        map.set(fullPath, node)
        const parent = map.get(parentPath)
        if (parent) parent.children.push(node)
        else root.push(node)
      } else if (!map.has(fullPath)) {
        const node: FileTreeNode = { name: part, path: fullPath, kind: 'folder', children: [] }
        map.set(fullPath, node)
        const parent = map.get(parentPath)
        if (parent) parent.children.push(node)
        else root.push(node)
      }
      parentPath = fullPath
    }
  }

  // 文件夹在前、文件在后，各自按名字排序
  const sortNodes = (nodes: FileTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const n of nodes) sortNodes(n.children)
  }
  sortNodes(root)
  return root
}

export function FileTree({
  files,
  currentPath,
  onOpenFile,
}: {
  files: FileMeta[]
  currentPath?: string
  onOpenFile?: (file: FileMeta) => void
}) {
  const tree = useMemo(() => buildFileTree(files), [files])
  // 默认全部收起：expanded 集合为空表示全部收起
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  if (tree.length === 0) {
    return <p className="text-muted-foreground px-3 py-4 text-xs">还没有文件</p>
  }

  return (
    <div className="space-y-0.5">
      {tree.map((node) => (
        <TreeRow
          key={node.path}
          node={node}
          depth={0}
          expanded={expanded}
          onToggle={toggle}
          currentPath={currentPath}
          onOpenFile={onOpenFile}
        />
      ))}
    </div>
  )
}

function TreeRow({
  node,
  depth,
  expanded,
  onToggle,
  currentPath,
  onOpenFile,
}: {
  node: FileTreeNode
  depth: number
  expanded: Set<string>
  onToggle: (path: string) => void
  currentPath?: string
  onOpenFile?: (file: FileMeta) => void
}) {
  const pad = { paddingLeft: 8 + depth * 12 }

  if (node.kind === 'folder') {
    const isCollapsed = !expanded.has(node.path)
    return (
      <div>
        <button
          onClick={() => onToggle(node.path)}
          style={pad}
          className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex w-full items-center gap-1.5 rounded-md px-2 py-[3px] text-left text-[13px]"
        >
          {isCollapsed ? (
            <ChevronRight className="size-3.5 shrink-0 opacity-60" />
          ) : (
            <ChevronDown className="size-3.5 shrink-0 opacity-60" />
          )}
          {isCollapsed ? (
            <Folder className="size-4 shrink-0 opacity-70" />
          ) : (
            <FolderOpen className="size-4 shrink-0 opacity-70" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {!isCollapsed &&
          node.children.map((c) => (
            <TreeRow
              key={c.path}
              node={c}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              currentPath={currentPath}
              onOpenFile={onOpenFile}
            />
          ))}
      </div>
    )
  }

  const isConflict = node.name.endsWith('.conflict.md')
  const isActive = node.path === currentPath
  return (
    <button
      onClick={() => onOpenFile?.(node.file!)}
      style={pad}
      className={cn(
        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex w-full items-center gap-1.5 rounded-md px-2 py-[3px] text-left text-[13px]',
        isActive && 'bg-sidebar-accent text-sidebar-accent-foreground font-medium',
        isConflict && 'text-muted-foreground/60',
      )}
    >
      <FileText className={cn('size-4 shrink-0', isConflict ? 'opacity-50' : 'opacity-70')} />
      <span className="truncate">{node.name}</span>
    </button>
  )
}
