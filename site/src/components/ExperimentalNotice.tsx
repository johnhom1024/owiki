import { AlertTriangle } from 'lucide-react'
import { useLang } from '../i18n/LangProvider'

/**
 * 试验性阶段警告横幅：说明项目未经大规模验证、接入前需额外备份、数据丢失概不负责。
 * 全宽置顶于 Hero 之前，使用 amber 警示色（与 quickstart.note 的警告条一致）。
 */
export function ExperimentalNotice() {
  const { t } = useLang()

  return (
    <div className="mt-16 border-b border-amber/20 bg-amber/[0.07]">
      <div className="mx-auto flex max-w-6xl items-start gap-3 px-5 py-3.5 sm:items-center">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber sm:mt-0" />
        <p className="text-xs leading-relaxed text-amber/90 md:text-sm">
          <span className="font-semibold">{t.notice.title}</span>
          <span className="mx-2 text-amber/40" aria-hidden>
            ·
          </span>
          {t.notice.body}
        </p>
      </div>
    </div>
  )
}
