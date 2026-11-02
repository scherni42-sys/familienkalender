import { useRef, useState } from 'react';
import { store } from '../lib/store';
import type { FileRef } from '../lib/types';
import { native } from '../lib/native';
import { Icon } from './ui';
import { fail, toast } from './toast';

const kb = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

// Dokument öffnen: kurzlebiger Link vom Server; in der Android-App öffnet ihn das passende Programm (PDF-Ansicht, Browser)
export async function openFile(f: FileRef) {
  const app = !!native();
  // Im Browser das Fenster sofort öffnen, sonst blockiert der Popup-Schutz nach dem Warten
  const w = app ? null : window.open('', '_blank');
  try {
    let url = await store.fileUrl(f);
    if (url.startsWith('data:')) { const b = await (await fetch(url)).blob(); url = URL.createObjectURL(b); }
    if (w) w.location.href = url; else location.href = url;
  } catch (x) { w?.close(); fail(x); }
}

// Büroklammer in der Terminliste: großer Tippbereich, öffnet das Dokument (bei mehreren den Termin)
export function Clip({ files, more }: { files?: FileRef[]; more: () => void }) {
  if (!files?.length) return null;
  return <button type="button" className="clip" aria-label={files.length === 1 ? `Dokument ${files[0].name} öffnen` : `${files.length} Dokumente`}
    onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); if (files.length === 1) void openFile(files[0]); else more(); }}>
    <Icon name="clip" />{files.length > 1 && <small>{files.length}</small>}
  </button>;
}

// Liste der angehängten Dokumente mit Öffnen und (wer darf) Entfernen
export function FileList({ files, from, canEdit }: { files?: FileRef[]; from: { event?: string; message?: string }; canEdit: boolean }) {
  const [armed, setArmed] = useState<string | null>(null);
  if (!files?.length) return null;
  return <div className="files">{files.map(f => (
    <div key={f.path} className="file">
      <button type="button" className="file-open" onClick={() => void openFile(f)}><Icon name="clip" /><span><b>{f.name}</b><small>{kb(f.size)}</small></span></button>
      {canEdit && (armed === f.path
        ? <button type="button" className="file-x on" onClick={() => store.removeFile(f, from).then(() => toast('Dokument entfernt.'), fail)}>Entfernen</button>
        : <button type="button" className="file-x" aria-label={`${f.name} entfernen`} onClick={() => setArmed(f.path)}>×</button>)}
    </div>))}</div>;
}

// „Dokument anhängen“: Datei auswählen und hochladen (an einen Termin oder als Board-Nachricht)
export function AttachButton({ to, label = 'Dokument anhängen', className = 'btn ghost sm', done, pick: keep }: { to: { event?: string; text?: string }; label?: string; className?: string; done?: () => void; pick?: (f: { name: string; type: string; data: string }) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file?: File) => {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { toast('Die Datei ist zu groß (höchstens 15 MB).'); return; }
    setBusy(true);
    try {
      const data = await new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = () => no(r.error); r.readAsDataURL(file); });
      const f = { name: file.name, type: file.type || 'application/octet-stream', data };
      // Neuer Termin: Datei merken, hochgeladen wird nach dem Speichern
      if (keep) { keep(f); return; }
      await store.attachFile(f, to);
      toast(to.event ? 'Dokument angehängt.' : 'Dokument hängt jetzt am Board.');
      done?.();
    } catch (x) { fail(x); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  return <>
    <input ref={input} type="file" hidden onChange={e => void pick(e.target.files?.[0])} />
    <button type="button" className={className} disabled={busy} onClick={() => input.current?.click()}><Icon name="clip" /><span>{busy ? 'Lädt hoch …' : label}</span></button>
  </>;
}
