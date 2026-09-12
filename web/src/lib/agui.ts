/**
 * AG-UI 事件类型（前端侧）。
 * 与官方 @ag-ui/core 的事件 schema 对齐；我们不用 npm 包（避免 rxjs 全家桶），
 * 这里只声明我们消费的字段。事件来源：
 * - POST /api/chat/sessions/:sid/stream（SSE，data JSON 带 type）
 * - GET  /api/chat/sessions/:sid/events（回放，JSON 数组）
 */

export type AguiEventType =
  | 'RUN_STARTED'
  | 'RUN_FINISHED'
  | 'RUN_ERROR'
  | 'TEXT_MESSAGE_START'
  | 'TEXT_MESSAGE_CONTENT'
  | 'TEXT_MESSAGE_END'
  | 'TOOL_CALL_START'
  | 'TOOL_CALL_ARGS'
  | 'TOOL_CALL_END'
  | 'TOOL_CALL_RESULT'
  | 'REASONING_START'
  | 'REASONING_MESSAGE_START'
  | 'REASONING_MESSAGE_CONTENT'
  | 'REASONING_MESSAGE_END'
  | 'REASONING_END'
  | 'CUSTOM'
  | (string & {}) // CUSTOM 的 name 变体等，宽松收敛

export interface AguiBaseEvent {
  type: AguiEventType
  timestamp?: number
  threadId?: string
  runId?: string
}

export interface AguiTextMessageStart extends AguiBaseEvent {
  type: 'TEXT_MESSAGE_START'
  messageId: string
  role: string
}
export interface AguiTextMessageContent extends AguiBaseEvent {
  type: 'TEXT_MESSAGE_CONTENT'
  messageId: string
  delta: string
}
export interface AguiTextMessageEnd extends AguiBaseEvent {
  type: 'TEXT_MESSAGE_END'
  messageId: string
}

export interface AguiToolCallStart extends AguiBaseEvent {
  type: 'TOOL_CALL_START'
  toolCallId: string
  toolCallName: string
}
export interface AguiToolCallArgs extends AguiBaseEvent {
  type: 'TOOL_CALL_ARGS'
  toolCallId: string
  delta: string
}
export interface AguiToolCallEnd extends AguiBaseEvent {
  type: 'TOOL_CALL_END'
  toolCallId: string
}
export interface AguiToolCallResult extends AguiBaseEvent {
  type: 'TOOL_CALL_RESULT'
  messageId: string
  toolCallId: string
  content: string
}

export interface AguiReasoningStart extends AguiBaseEvent {
  type: 'REASONING_START'
  messageId: string
}
export interface AguiReasoningMessageStart extends AguiBaseEvent {
  type: 'REASONING_MESSAGE_START'
  messageId: string
  role: string
}
export interface AguiReasoningMessageContent extends AguiBaseEvent {
  type: 'REASONING_MESSAGE_CONTENT'
  messageId: string
  delta: string
}
export interface AguiReasoningMessageEnd extends AguiBaseEvent {
  type: 'REASONING_MESSAGE_END'
  messageId: string
}
export interface AguiReasoningEnd extends AguiBaseEvent {
  type: 'REASONING_END'
  messageId: string
}

export interface AguiRunStarted extends AguiBaseEvent {
  type: 'RUN_STARTED'
  threadId: string
  runId: string
}
export interface AguiRunFinished extends AguiBaseEvent {
  type: 'RUN_FINISHED'
  threadId: string
  runId: string
}
export interface AguiRunError extends AguiBaseEvent {
  type: 'RUN_ERROR'
  message: string
  code?: string
}

/** CUSTOM：name=tool_confirm / tool_confirm_result（value 里带载荷） */
export interface AguiCustom<T = Record<string, unknown>> extends AguiBaseEvent {
  type: 'CUSTOM'
  name: string
  value?: T
}

export type AguiEvent =
  | AguiRunStarted
  | AguiRunFinished
  | AguiRunError
  | AguiTextMessageStart
  | AguiTextMessageContent
  | AguiTextMessageEnd
  | AguiToolCallStart
  | AguiToolCallArgs
  | AguiToolCallEnd
  | AguiToolCallResult
  | AguiReasoningStart
  | AguiReasoningMessageStart
  | AguiReasoningMessageContent
  | AguiReasoningMessageEnd
  | AguiReasoningEnd
  | AguiCustom

/** 事件 → 时间线条目。UI 只消费这个模型，不直接碰事件。 */
export type TimelineItem =
  | { kind: 'user'; key: string; text: string }
  | { kind: 'assistant'; key: string; text: string; streaming: boolean }
  | { kind: 'reasoning'; key: string; text: string; open: boolean }
  | {
      kind: 'tool'
      key: string
      toolCallId: string
      name: string
      args: string
      status: 'calling' | 'done' | 'denied'
      result?: string
    }

export interface PendingConfirm {
  runId: string
  confirmId: string
  tool: string
  args: string
}

export interface ChatState {
  items: TimelineItem[]
  error: string | null
  running: boolean
  confirm: PendingConfirm | null
}

export const initialChatState: ChatState = {
  items: [],
  error: null,
  running: false,
  confirm: null,
}

let keySeq = 0
function nextKey(prefix: string): string {
  keySeq += 1
  return `${prefix}-${keySeq}`
}

/**
 * applyEvent：唯一状态转移入口（纯函数）。
 * 语义对齐官方 @ag-ui/client 的 defaultApplyEvents，砍掉 Observable 层。
 * - TEXT_MESSAGE_CONTENT 按 messageId 追加（找不到开着的消息则忽略——乱序容错）
 * - TOOL_CALL_RESULT 按 toolCallId 精确回填（同名工具不串）
 * - REASONING_* 维护折叠面板
 * - CUSTOM tool_confirm / tool_confirm_result 维护确认条
 */
export function applyEvent(state: ChatState, ev: AguiEvent): ChatState {
  switch (ev.type) {
    case 'RUN_STARTED':
      return { ...state, running: true, error: null }

    case 'RUN_FINISHED':
      return { ...state, running: false }

    case 'RUN_ERROR':
      return { ...state, running: false, error: ev.message || 'unknown error' }

    case 'TEXT_MESSAGE_START':
      return addItem(state, {
        kind: 'assistant',
        key: nextKey('msg'),
        text: '',
        streaming: true,
      })

    case 'TEXT_MESSAGE_CONTENT': {
      const idx = findLast(state.items, (i) => i.kind === 'assistant' && i.streaming)
      if (idx < 0) return state
      const item = state.items[idx]
      if (item.kind !== 'assistant') return state
      const items = state.items.slice()
      items[idx] = { ...item, text: item.text + ev.delta }
      return { ...state, items }
    }

    case 'TEXT_MESSAGE_END': {
      const idx = findLast(state.items, (i) => i.kind === 'assistant' && i.streaming)
      if (idx < 0) return state
      const item = state.items[idx]
      if (item.kind !== 'assistant') return state
      const items = state.items.slice()
      items[idx] = { ...item, streaming: false }
      return { ...state, items }
    }

    case 'TOOL_CALL_START':
      return addItem(state, {
        kind: 'tool',
        key: nextKey('tool'),
        toolCallId: ev.toolCallId,
        name: ev.toolCallName,
        args: '',
        status: 'calling',
      })

    case 'TOOL_CALL_ARGS': {
      // STREAM 帧里 ARGS 一次给整段；分片到达则拼接
      const idx = findTool(state.items, ev.toolCallId)
      if (idx < 0) return state
      const item = state.items[idx]
      if (item.kind !== 'tool') return state
      const items = state.items.slice()
      items[idx] = { ...item, args: item.args + ev.delta }
      return { ...state, items }
    }

    case 'TOOL_CALL_END':
      return state // 状态保持 calling，等 RESULT

    case 'TOOL_CALL_RESULT': {
      const idx = findTool(state.items, ev.toolCallId)
      if (idx < 0) return state
      const item = state.items[idx]
      if (item.kind !== 'tool') return state
      const items = state.items.slice()
      items[idx] = { ...item, status: 'done', result: ev.content }
      return { ...state, items }
    }

    case 'REASONING_START':
    case 'REASONING_MESSAGE_START':
      return state // 条目在首个 CONTENT 时创建（避免空面板闪烁）

    case 'REASONING_MESSAGE_CONTENT': {
      let idx = findLast(state.items, (i) => i.kind === 'reasoning')
      if (idx < 0) {
        state = addItem(state, {
          kind: 'reasoning',
          key: nextKey('reason'),
          text: '',
          open: true,
        })
        idx = state.items.length - 1
      }
      const item = state.items[idx]
      if (item.kind !== 'reasoning') return state
      const items = state.items.slice()
      items[idx] = { ...item, text: item.text + ev.delta }
      return { ...state, items }
    }

    case 'REASONING_MESSAGE_END':
    case 'REASONING_END': {
      const idx = findLast(state.items, (i) => i.kind === 'reasoning')
      if (idx < 0) return state
      const item = state.items[idx]
      if (item.kind !== 'reasoning') return state
      const items = state.items.slice()
      items[idx] = { ...item, open: false }
      return { ...state, items }
    }

    case 'CUSTOM':
      return applyCustom(state, ev)

    default:
      return state
  }
}

function applyCustom(state: ChatState, ev: AguiCustom): ChatState {
  const v = (ev.value ?? {}) as Record<string, any>
  if (ev.name === 'tool_confirm') {
    return {
      ...state,
      confirm: {
        runId: v.runId ?? '',
        confirmId: v.confirmId ?? '',
        tool: v.tool ?? '',
        args: v.args ?? '',
      },
    }
  }
  if (ev.name === 'tool_confirm_result') {
    if (v.approved === false) {
      // 拒绝/超时：calling 中的工具标 denied
      const items = state.items.map((i) =>
        i.kind === 'tool' && i.status === 'calling' ? { ...i, status: 'denied' as const } : i,
      )
      return { ...state, items, confirm: null }
    }
    return { ...state, confirm: null }
  }
  return state
}

export function addUserItem(state: ChatState, text: string): ChatState {
  return addItem(state, { kind: 'user', key: nextKey('user'), text })
}

function addItem(state: ChatState, item: TimelineItem): ChatState {
  return { ...state, items: [...state.items, item] }
}

function findLast(items: TimelineItem[], pred: (i: TimelineItem) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (pred(items[i])) return i
  }
  return -1
}

function findTool(items: TimelineItem[], toolCallId: string): number {
  return findLast(items, (i) => i.kind === 'tool' && i.toolCallId === toolCallId)
}
