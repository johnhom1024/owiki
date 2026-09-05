import { useEffect, useRef } from 'react'

/**
 * 星空背景（仅暗色主题渲染）：
 * - 固定全屏 canvas 置于内容之下（-z-10），不挡交互
 * - 星云：4~6 团紫/靛蓝光云（离屏 sprite，3 个偏移径向渐变叠出不规则形），
 *   加法混合（lighter）缓慢漂移 + 呼吸式明暗，形成有明有暗的天空层次
 * - 星星：随机大小/亮度/颜色（白、品牌紫、少量天蓝），70% 带闪烁
 * - 大星（5%）带径向光晕；全体极慢上浮制造视差层次
 * - 偶发流星：4~11 秒一颗，带渐隐拖尾
 * - prefers-reduced-motion：只画静态一帧，无流星无闪烁
 * - 亮色主题清空画布；页面隐藏时暂停 RAF
 */

interface Star {
  x: number
  y: number
  r: number
  base: number
  twinkle: number // 闪烁深度 0~1，0 = 不闪
  speed: number
  phase: number
  vy: number // 上浮速度 px/s
  color: string
}

interface Meteor {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
}

interface Nebula {
  x: number
  y: number
  r: number
  vx: number
  vy: number
  base: number // 基础不透明度
  breathe: number // 呼吸速度
  phase: number
  sprite: HTMLCanvasElement
}

const STAR_COLORS = ['#eceaf6', '#eceaf6', '#eceaf6', '#c4b5fd', '#c4b5fd', '#a29bc0', '#7dd3fc']
/** 星云色板：品牌紫系 + 靛蓝 + 一丝玫瑰暖调 */
const NEBULA_COLORS = [
  { c: [124, 58, 237] }, // violet
  { c: [139, 92, 246] }, // purple
  { c: [99, 102, 241] }, // indigo
  { c: [109, 40, 217] }, // deep violet
  { c: [251, 113, 133] }, // rose（极低透明度下作暖调点缀）
]

function makeStars(w: number, h: number): Star[] {
  const count = Math.min(240, Math.round((w * h) / 9000))
  const stars: Star[] = []
  for (let i = 0; i < count; i++) {
    const big = Math.random() < 0.05
    stars.push({
      x: Math.random() * w,
      y: Math.random() * h,
      r: big ? 1.4 + Math.random() * 0.5 : 0.4 + Math.random() ** 2 * 1.0,
      base: 0.25 + Math.random() * 0.55,
      twinkle: Math.random() < 0.7 ? 0.25 + Math.random() * 0.45 : 0,
      speed: 0.4 + Math.random() * 1.2,
      phase: Math.random() * Math.PI * 2,
      vy: -(1.5 + Math.random() * 3),
      color: STAR_COLORS[(Math.random() * STAR_COLORS.length) | 0],
    })
  }
  return stars
}

/**
 * 星云 sprite：512px 离屏画布上叠 3 个偏移径向渐变，
 * 得到边界不规则的“云气”而非完美圆斑。
 */
function makeNebulaSprite(rgb: number[]): HTMLCanvasElement {
  const size = 512
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const g = c.getContext('2d')!
  const [r, gg, b] = rgb
  const blob = (cx: number, cy: number, radius: number, alpha: number) => {
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, radius)
    grad.addColorStop(0, `rgba(${r},${gg},${b},${alpha})`)
    grad.addColorStop(0.55, `rgba(${r},${gg},${b},${alpha * 0.42})`)
    grad.addColorStop(1, `rgba(${r},${gg},${b},0)`)
    g.fillStyle = grad
    g.fillRect(0, 0, size, size)
  }
  blob(size * 0.5, size * 0.5, size * 0.5, 0.75)
  blob(size * 0.34, size * 0.6, size * 0.34, 0.5)
  blob(size * 0.66, size * 0.38, size * 0.3, 0.45)
  return c
}

function makeNebulas(w: number, h: number): Nebula[] {
  const count = 4 + Math.floor(Math.random() * 3) // 4~6 团
  const maxDim = Math.max(w, h)
  const nebulas: Nebula[] = []
  for (let i = 0; i < count; i++) {
    const palette = NEBULA_COLORS[i % NEBULA_COLORS.length].c
    // 玫瑰暖调只允许极低透明度
    const warm = palette[0] === 251
    const dir = Math.random() * Math.PI * 2
    const speed = 2 + Math.random() * 5 // px/s，极慢漂移
    nebulas.push({
      x: Math.random() * w,
      y: Math.random() * h,
      r: maxDim * (0.26 + Math.random() * 0.2),
      vx: Math.cos(dir) * speed,
      vy: Math.sin(dir) * speed,
      base: warm ? 0.035 + Math.random() * 0.02 : 0.05 + Math.random() * 0.06,
      breathe: 0.08 + Math.random() * 0.12,
      phase: Math.random() * Math.PI * 2,
      sprite: makeNebulaSprite(palette),
    })
  }
  return nebulas
}

export function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    let w = 0
    let h = 0
    let stars: Star[] = []
    let nebulas: Nebula[] = []
    let meteors: Meteor[] = []
    let meteorTimer = 3 + Math.random() * 4
    let raf = 0
    let last = 0
    let running = false

    const resize = () => {
      const dpr = Math.min(2, devicePixelRatio || 1)
      w = innerWidth
      h = innerHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      stars = makeStars(w, h)
      nebulas = makeNebulas(w, h)
      meteors = []
      if (reduced) drawStatic()
    }

    const hexA = (hex: string, a: number) => `${hex}${Math.round(a * 255).toString(16).padStart(2, '0')}`

    const drawNebulas = (t: number, move: number) => {
      ctx.globalCompositeOperation = 'lighter'
      for (const n of nebulas) {
        if (move > 0) {
          n.x += n.vx * move
          n.y += n.vy * move
          // 越界回绕（多留一个半径，避免边缘突然弹入）
          if (n.x < -n.r) n.x = w + n.r
          else if (n.x > w + n.r) n.x = -n.r
          if (n.y < -n.r) n.y = h + n.r
          else if (n.y > h + n.r) n.y = -n.r
        }
        const a = n.base * (0.72 + 0.28 * Math.sin(t * n.breathe + n.phase))
        ctx.globalAlpha = a
        ctx.drawImage(n.sprite, n.x - n.r, n.y - n.r, n.r * 2, n.r * 2)
      }
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    }

    const drawStar = (s: Star, alpha: number) => {
      if (s.r >= 1.3) {
        // 大星：径向光晕
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 4)
        g.addColorStop(0, hexA(s.color, 0.35 * alpha))
        g.addColorStop(1, hexA(s.color, 0))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r * 4, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = alpha
      ctx.fillStyle = s.color
      ctx.beginPath()
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }

    const drawMeteor = (m: Meteor, p: number) => {
      const mag = Math.hypot(m.vx, m.vy)
      const dx = m.vx / mag
      const dy = m.vy / mag
      const len = 110
      const fade = Math.sin(Math.PI * p)
      const grad = ctx.createLinearGradient(m.x, m.y, m.x - dx * len, m.y - dy * len)
      grad.addColorStop(0, `rgba(236, 234, 246, ${(0.9 * fade).toFixed(3)})`)
      grad.addColorStop(0.3, `rgba(196, 181, 253, ${(0.5 * fade).toFixed(3)})`)
      grad.addColorStop(1, 'rgba(139, 92, 246, 0)')
      ctx.strokeStyle = grad
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.moveTo(m.x, m.y)
      ctx.lineTo(m.x - dx * len, m.y - dy * len)
      ctx.stroke()
      ctx.fillStyle = `rgba(236, 234, 246, ${(0.9 * fade).toFixed(3)})`
      ctx.beginPath()
      ctx.arc(m.x, m.y, 1.6, 0, Math.PI * 2)
      ctx.fill()
    }

    const spawnMeteor = () => {
      const speed = 500 + Math.random() * 350
      // 25°（向右下）或 155°（向左下），略微抖动
      const angle =
        (Math.random() < 0.5 ? 25 : 155) * (Math.PI / 180) + (Math.random() - 0.5) * 0.25
      meteors.push({
        x: Math.random() * w,
        y: -20 + Math.random() * h * 0.3,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        max: 0.7 + Math.random() * 0.5,
      })
    }

    const drawStatic = () => {
      ctx.clearRect(0, 0, w, h)
      drawNebulas(performance.now() / 1000, 0)
      for (const s of stars) drawStar(s, s.base)
    }

    const frame = (now: number) => {
      if (!running) return
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const t = now / 1000
      ctx.clearRect(0, 0, w, h)

      drawNebulas(t, dt)

      for (const s of stars) {
        s.y += s.vy * dt
        if (s.y < -4) {
          s.y = h + 4
          s.x = Math.random() * w
        }
        const a = s.twinkle
          ? s.base * (1 - s.twinkle) +
            s.base * s.twinkle * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase))
          : s.base
        drawStar(s, a)
      }

      meteorTimer -= dt
      if (meteorTimer <= 0) {
        spawnMeteor()
        meteorTimer = 4 + Math.random() * 7
      }
      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i]
        m.life += dt
        if (m.life >= m.max || m.y > h + 40) {
          meteors.splice(i, 1)
          continue
        }
        m.x += m.vx * dt
        m.y += m.vy * dt
        drawMeteor(m, m.life / m.max)
      }

      raf = requestAnimationFrame(frame)
    }

    const start = () => {
      if (running || reduced) {
        if (reduced) drawStatic()
        return
      }
      running = true
      last = performance.now()
      raf = requestAnimationFrame(frame)
    }

    const stop = (clear: boolean) => {
      running = false
      cancelAnimationFrame(raf)
      if (clear) ctx.clearRect(0, 0, w, h)
    }

    const isDark = () => document.documentElement.dataset.theme !== 'light'
    const sync = () => (isDark() ? start() : stop(true))

    const onVisibility = () => {
      if (document.hidden) stop(false)
      else if (isDark()) start()
    }

    resize()
    sync()

    const themeObserver = new MutationObserver(sync)
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    addEventListener('resize', resize)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stop(false)
      themeObserver.disconnect()
      removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10"
    />
  )
}
