import { cn } from '@/lib/utils'

export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('size-7 shrink-0', className)}
      aria-label="OWiki logo"
    >
      <defs>
        <linearGradient id="owiki-logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="#17131f" />
      {/* 晶体主体：垂直腰线版，顶部切面收小，中轴线略偏左 */}
      <path d="M32 8 L46 18 L46 46 L32 56 L18 46 L18 18 Z" fill="url(#owiki-logo-bg)" />
      {/* 左上切面：受光面 */}
      <path d="M32 8 L30 21 L18 18 Z" fill="#b09cf9" />
      {/* 右上切面：背光面 */}
      <path d="M32 8 L46 18 L30 21 Z" fill="#7d3ce6" />
      {/* 左腰切面：中间调 */}
      <path d="M18 18 L30 21 L30 48 L18 46 Z" fill="#875cf3" />
      {/* 右腰切面：稍暗 */}
      <path d="M46 18 L46 46 L30 48 L30 21 Z" fill="#4c1d95" />
      {/* 底部左切面 */}
      <path d="M18 46 L30 48 L32 56 Z" fill="#6d28d9" />
      {/* 底部右切面 */}
      <path d="M46 46 L32 56 L30 48 Z" fill="#371379" />
    </svg>
  )
}
