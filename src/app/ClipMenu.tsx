import { useState } from 'react';
import { Icon } from './ui';

// Büroklammer wie bei WhatsApp/Signal: Dokument (jede Datei, z. B. PDF, Word, Excel), Galerie, Kamera, im Chat auch Standort
export function ClipMenu({ image, doc, place, disabled }: { image: (f: File) => void; doc: (f: File) => void; place?: () => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const take = (fn: (f: File) => void) => (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; e.target.value = ''; setOpen(false); if (f) fn(f); };
  return (
    <span className="clip-m">
      <button type="button" className="ch-i" aria-label="Anhängen" aria-expanded={open} disabled={disabled} onClick={() => setOpen(o => !o)}><Icon name="clip" /></button>
      {open && <>
        <span className="clip-bg" onClick={() => setOpen(false)} />
        <span className="clip-pop" role="menu">
          <label role="menuitem"><span className="rnd"><Icon name="camera" /></span>Kamera<input type="file" accept="image/*" capture="environment" hidden onChange={take(image)} /></label>
          <label role="menuitem"><span className="rnd"><Icon name="gallery" /></span>Galerie<input type="file" accept="image/*" hidden onChange={take(image)} /></label>
          <label role="menuitem"><span className="rnd"><Icon name="clip" /></span>Dokument<input type="file" hidden onChange={take(doc)} /></label>
          {place && <button type="button" role="menuitem" onClick={() => { setOpen(false); place(); }}><span className="rnd"><Icon name="place" /></span>Standort</button>}
        </span>
      </>}
    </span>
  );
}
