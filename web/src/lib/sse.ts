/**
 * AG-UI SSE 流解析（纯函数）。
 * 语义对齐官方 @ag-ui/client transform/sse.ts：
 * - 帧以 \n\n 分隔（兼容 \r\n\r\n）
 * - 只认 data: 行；多行 data 以 \n 连接
 * - UTF-8 分片由 TextDecoder(stream) 处理
 * - 注释行（: ping 心跳）跳过
 * - 缓冲无上限保护按官方 10MB 兜底
 */

const MAX_BUFFER = 10 * 1024 * 1024

export interface SSEParserState {
  buffer: string
}

export function newSSEParserState(): SSEParserState {
  return { buffer: '' }
}

/**
 * 喂入一个文本 chunk，吐出本 chunk 内完整的事件 JSON 数组。
 * 尾部不完整数据留在 state.buffer。
 */
export function feedSSE(state: SSEParserState, chunk: string): string[] {
  state.buffer += chunk
  if (state.buffer.length > MAX_BUFFER) {
    throw new Error('SSE buffer overflow (10MB) — stream malformed?')
  }
  // 统一换行后按空行分帧；保留 buffer 尾部
  const frames = state.buffer.split(/\n\n|\r\n\r\n/)
  state.buffer = frames.pop() ?? ''
  const out: string[] = []
  for (const frame of frames) {
    const data = parseFrameData(frame)
    if (data !== null) out.push(data)
  }
  return out
}

/** 流结束：缓冲里若还剩一帧完整 data 也吐出（服务端可能没补尾空行）。 */
export function flushSSE(state: SSEParserState): string[] {
  const rest = state.buffer
  state.buffer = ''
  if (!rest.trim()) return []
  const data = parseFrameData(rest)
  return data !== null ? [data] : []
}

function parseFrameData(frame: string): string | null {
  const lines = frame.split(/\r\n|\n/)
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith(':')) continue // 注释/心跳
    if (line.startsWith('data:')) {
      // 冒号后单个可选空格（SSE 规范）
      dataLines.push(line.slice(5).replace(/^ /, ''))
    }
    // event:/id:/retry: 行忽略——type 在 data JSON 里
  }
  if (dataLines.length === 0) return null
  return dataLines.join('\n')
}

/** 解析一条 data JSON 为事件对象；解析失败返回 null（容错跳过）。 */
export function parseAguiEvent(json: string): Record<string, any> | null {
  try {
    const obj = JSON.parse(json)
    if (obj && typeof obj.type === 'string') return obj
    return null
  } catch {
    return null
  }
}
