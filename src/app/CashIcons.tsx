// Grüne Strich-Symbole für das Kassenbuch und eine eigene Kategorie-Auswahl (statt bunter Emojis)
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { CATS } from '../lib/cash';

const P: Record<string, string> = {
  Lebensmittel: '<path d="M3 4h2l2.2 10.5h10.6L20 7H6.2"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>',
  Drogerie: '<path d="M10 3h4v3h-4z"/><path d="M12 6v2"/><path d="M8 11a3 3 0 0 1 3-3h2a3 3 0 0 1 3 3v8a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2z"/><path d="M8 14h8"/>',
  Kraftstoff: '<path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16"/><path d="M3 21h12"/><path d="M7 7h4v4H7z"/><path d="M14 10h2a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V8l-3-3"/>',
  'Essen gehen': '<path d="M7 3v8"/><path d="M4.5 3v5a2.5 2.5 0 0 0 5 0V3"/><path d="M7 11v10"/><path d="M17 21V3c-2.2 1.2-3.5 3.6-3.5 7v3H17"/>',
  Haushalt: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
  Kleidung: '<path d="M9 3l3 2 3-2 5 3-2 4-2-1v12H8V9l-2 1-2-4z"/>',
  Freizeit: '<path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z"/><path d="M14 6v12" stroke-dasharray="2 2"/>',
  Gesundheit: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/>',
  'Kinder/Schule': '<path d="M6 9a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/><path d="M9 5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M6 13h12"/><path d="M10 13v2h4v-2"/>',
  Sonstiges: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4"/><path d="M12 11v10"/>',
  bon: '<path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  rechnung: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h6M9 8h2"/>'
};

export function CatIcon({ c, size = 22 }: { c: string; size?: number }) {
  return <svg className="cat-ic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: P[c] ?? P.Sonstiges }} />;
}

// Kategorie wählen: Taste mit Symbol, öffnet eine Liste mit grünen Symbolen
export function CatPick({ value, set, compact, disabled }: { value: string; set: (c: string) => void; compact?: boolean; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={`catpick-btn${compact ? ' compact' : ''}`} disabled={disabled} aria-label={`Kategorie: ${value}`} onClick={() => setOpen(true)}>
      <CatIcon c={value} />{!compact && <span>{value}</span>}
    </button>
    {open && createPortal(<div className="catpick" onClick={() => setOpen(false)}>
      <div className="catpick-in" role="listbox" aria-label="Kategorie" onClick={e => e.stopPropagation()}>
        {CATS.map(c => <button key={c} type="button" role="option" aria-selected={c === value} className={c === value ? 'on' : ''} onClick={() => { set(c); setOpen(false); }}>
          <CatIcon c={c} size={26} /><span>{c}</span>
        </button>)}
      </div>
    </div>, document.body)}
  </>;
}
