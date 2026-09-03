import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api.ts'
import { useLang } from '@/i18n/LangProvider.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Label } from '@/components/ui/label.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx'

export function CreateNoteDialog({
  vaultId,
  open,
  onOpenChange,
  onCreated,
}: {
  vaultId: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
}) {
  const navigate = useNavigate()
  const { t } = useLang()
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setPath('')
    setError(null)
  }

  const create = async () => {
    if (!path.trim()) {
      setError(t.createNote.pathRequired)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await api.createVaultFile(vaultId, { path: path.trim() })
      reset()
      onOpenChange(false)
      onCreated?.()
      navigate(`/vaults/${vaultId}/files/${res.data.id}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : t.common.createFailed
      if (msg.includes('already exists')) setError(t.createNote.exists)
      else if (msg.includes('invalid path')) setError(t.createNote.invalidPath)
      else setError(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.createNote.title}</DialogTitle>
          <DialogDescription>{t.createNote.desc}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="note-path">{t.createNote.pathLabel}</Label>
            <Input
              id="note-path"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder={t.createNote.pathPlaceholder}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && void create()}
            />
            <p className="text-muted-foreground text-xs">{t.createNote.pathHint}</p>
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.common.cancel}
          </Button>
          <Button disabled={busy} onClick={() => void create()}>
            {busy ? t.common.creating : t.common.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
