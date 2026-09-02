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

export function CreateVaultDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => Promise<void>
}) {
  const navigate = useNavigate()
  const { t } = useLang()
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setName('')
    setNote('')
    setError(null)
  }

  const create = async () => {
    if (!name.trim()) {
      setError(t.common.nameRequired)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await api.createVault({ name: name.trim(), note: note.trim() })
      reset()
      onOpenChange(false)
      await onCreated()
      navigate(`/vaults/${res.data.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : t.common.createFailed)
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
          <DialogTitle>{t.createVault.title}</DialogTitle>
          <DialogDescription>{t.createVault.desc}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="vault-name">{t.createVault.nameLabel}</Label>
            <Input
              id="vault-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.createVault.namePlaceholder}
              onKeyDown={(e) => e.key === 'Enter' && void create()}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vault-note">{t.createVault.noteLabel}</Label>
            <Input
              id="vault-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t.createVault.notePlaceholder}
            />
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
