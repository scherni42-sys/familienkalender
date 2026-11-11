import { Fragment, useState } from 'react';
import { isPro, store, useSnapshot } from '../lib/store';
import { shrinkPhoto } from '../lib/ai';
import { catOf, catRank, cookGuide, openShop, parseShop, readShopPhoto, shopQty, type CookGuide } from '../lib/shop';
import type { ShopItem } from '../lib/types';
import { Badge, Icon, Sheet } from './ui';
import { fail, toast } from './toast';
import { ask } from './ask';

// Rückmeldung nach dem Hinzufügen: was neu ist und was nur in der Menge erhöht wurde
export const shopToast = (r: { added: number; merged: number }, dish = '') =>
  toast(`${dish ? `Zutaten für ${dish}: ` : ''}${r.added ? `${r.added} Artikel dazu` : 'Nichts Neues'}${r.merged ? `, ${r.merged} schon drauf (Menge erhöht)` : ''}.`);

// Der Einkaufszettel der Familie: wie ein Zettel aus Papier. Antippen hakt ab (durchgestrichen), × nimmt den Artikel weg.
export function ShopSheet({ close }: { close: () => void }) {
  const snap = useSnapshot();
  const me = snap.members.find(m => m.id === snap.me);
  const canAct = !!me && me.role !== 'guest' && me.role !== 'child';
  const list = snap.shopping ?? [];
  const [text, setText] = useState(''), [busy, setBusy] = useState(false);

  // Abschnitte: zuerst der normale Zettel, darunter je Gericht die Zutaten. Innerhalb sortiert nach Abteilung (Weg durch den Markt);
  // Abgehaktes bleibt an seinem Platz, damit beim Einkaufen nichts verrutscht
  const dishes = [...new Set(list.map(x => x.dish))].sort((a, b) => a === '' ? -1 : b === '' ? 1 : 0);
  const sorted = (d: string) => list.filter(x => x.dish === d).sort((a, b) => catRank(a) - catRank(b) || a.created_at.localeCompare(b.created_at));
  const done = list.filter(x => x.done);
  const open = openShop(list), left = open.length;
  const who = (id: string | null) => snap.members.find(m => m.id === id);
  // Übernehmen: offene Artikel, die noch niemand übernommen hat (oder schon ich)
  const free = open.filter(x => !x.taker), mine = open.filter(x => x.taker === snap.me);
  const takers = [...new Set(open.map(x => x.taker).filter((t): t is string => !!t))];
  const take = (ids: string[], t: string | null, msg: string) => store.takeShop(ids, t).then(() => toast(msg), fail);

  const add = async () => {
    const items = parseShop(text); if (!items.length || busy) return;
    setBusy(true);
    try { shopToast(await store.addShop(items)); setText(''); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const photo = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    try {
      const r = await readShopPhoto(await shrinkPhoto(f), list);
      if (!r.found) { toast('Auf dem Foto ist kein Einkaufszettel und keine Zutatenliste zu erkennen.'); return; }
      shopToast(await store.addShop(r.items), r.dish);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const toggle = (x: ShopItem) => { if (canAct) store.setShop(x.id, { done: !x.done }).catch(fail); };
  // Personenzahl je Gericht: Mengen rechnen sich um
  const serv = (d: string) => list.find(x => x.dish === d && x.servings)?.servings ?? null;
  const scale = (d: string, n: number) => store.scaleDish(d, n).catch(fail);
  // Kochanleitung zum Gericht (Pro), am schönsten, wenn alles eingekauft ist
  const [guide, setGuide] = useState<{ dish: string; g?: CookGuide } | null>(null);
  const cook = async (d: string) => {
    setGuide({ dish: d });
    try { setGuide({ dish: d, g: await cookGuide(d, serv(d), list.filter(x => x.dish === d)) }); }
    catch (e) { setGuide(null); fail(e); }
  };
  const copyGuide = (d: string, g: CookGuide) => {
    const t = `${g.title} (${serv(d) ?? ''}${serv(d) ? ' Personen, ' : ''}ca. ${g.minutes} Min.)\n\n${g.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}${g.tip ? `\n\nTipp: ${g.tip}` : ''}`;
    navigator.clipboard?.writeText(t).then(() => toast('Kochanleitung kopiert.'), () => toast('Kopieren ging nicht.'));
  };
  const dropDish = async (d: string) => {
    if (await ask(`Alle Zutaten für ${d} vom Zettel nehmen?`, 'Wegnehmen')) store.removeShop(list.filter(x => x.dish === d).map(x => x.id)).catch(fail);
  };

  return (
    <Sheet onClose={close} label="Einkaufszettel">
      <div className="shop-top">
        <h2>Einkaufszettel</h2>
        <span className="shop-n">{left ? `${left} offen` : list.length ? 'alles erledigt' : ''}</span>
        <button type="button" className="shop-x" aria-label="Schließen" onClick={close}>×</button>
      </div>
      {left > 0 && <div className="shop-take">
        {takers.length > 0 && <p>{takers.map(t => { const n = open.filter(x => x.taker === t).length; return <span key={t}><Badge m={who(t)} size={22} /> {t === snap.me ? 'Du kaufst' : `${who(t)?.name ?? 'Jemand'} kauft`} {n === left ? 'alles' : `${n} von ${left}`}</span>; })}</p>}
        {canAct && <div className="btn-row tight">
          {free.length > 0 && <button type="button" className="btn sm" onClick={() => take(free.map(x => x.id), snap.me, free.length === left ? 'Alle sehen: du übernimmst den Einkauf.' : `Alle sehen: du übernimmst die ${free.length} offenen Artikel.`)}>{free.length === left ? 'Ich übernehme den Einkauf' : `Rest übernehmen (${free.length})`}</button>}
          {mine.length > 0 && <button type="button" className="btn ghost sm" onClick={() => take(mine.map(x => x.id), null, 'Abgegeben: die Artikel sind wieder frei.')}>Abgeben ({mine.length})</button>}
        </div>}
      </div>}
      <div className="zettel">
        {!list.length && <p className="zettel-empty">Der Zettel ist leer.<br />Schreib unten auf, was fehlt.</p>}
        {dishes.map(d => <section key={d || '-'}>
          {d && <h3><span>Für {d}</span>{canAct && <button type="button" aria-label={`Zutaten für ${d} wegnehmen`} onClick={() => void dropDish(d)}>×</button>}</h3>}
          {d && serv(d) && <div className="zettel-pers">
            {canAct && <button type="button" aria-label="Eine Person weniger" disabled={serv(d)! <= 1} onClick={() => scale(d, serv(d)! - 1)}>−</button>}
            <span>{serv(d)} {serv(d) === 1 ? 'Person' : 'Personen'}</span>
            {canAct && <button type="button" aria-label="Eine Person mehr" disabled={serv(d)! >= 99} onClick={() => scale(d, serv(d)! + 1)}>+</button>}
          </div>}
          {d && canAct && <div className="zettel-cook">
            <button type="button" className={list.filter(x => x.dish === d).every(x => x.done) ? 'ready' : ''} disabled={guide?.dish === d && !guide.g} onClick={() => guide?.dish === d && guide.g ? setGuide(null) : void cook(d)}>
              🍳 {guide?.dish === d ? (guide.g ? 'Kochanleitung schließen' : 'Claude schreibt …') : list.filter(x => x.dish === d).every(x => x.done) ? 'Alles da: Kochanleitung' : 'Kochanleitung'}
            </button>
          </div>}
          <ul>{sorted(d).map((x, i, all) => <Fragment key={x.id}>
            {(i === 0 || catOf(all[i - 1]) !== catOf(x)) && <li className="zcat">{catOf(x)}</li>}
            <li className={x.done ? 'done' : ''}>
            <button type="button" className="zt" aria-pressed={x.done} disabled={!canAct} onClick={() => toggle(x)}>
              <i className="box">{x.done ? '✓' : ''}</i>
              <span>{shopQty(x) && <b>{shopQty(x)} </b>}{x.name}</span>
              {x.done && x.done_by && <small className="zby">✓ {who(x.done_by)?.name ?? ''}</small>}
            </button>
            {!x.done && (x.taker
              ? <button type="button" className={`ztk on${x.taker === snap.me ? ' me' : ''}`} disabled={!canAct || x.taker !== snap.me} title={`${who(x.taker)?.name ?? ''} kauft das`} aria-label={x.taker === snap.me ? `${x.name}: abgeben` : `${who(x.taker)?.name ?? 'Jemand'} kauft das`} onClick={() => take([x.id], null, `${x.name} ist wieder frei.`)}><Badge m={who(x.taker)} size={24} /></button>
              : canAct && <button type="button" className="ztk" aria-label={`${x.name} übernehme ich`} title="Übernehme ich" onClick={() => take([x.id], snap.me, `Alle sehen: du kaufst ${x.name}.`)}>Ich</button>)}
            {canAct && <button type="button" className="zx" aria-label={`${x.name} wegnehmen`} onClick={() => store.removeShop([x.id]).catch(fail)}>×</button>}
          </li></Fragment>)}</ul>
        </section>)}
      </div>
      {guide?.g && <div className="cook-card">
        <h3>{guide.g.title}<small>{serv(guide.dish) ? `${serv(guide.dish)} Personen · ` : ''}ca. {guide.g.minutes} Min.</small></h3>
        <ol>{guide.g.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        {guide.g.tip && <p className="cook-tip"><b>Tipp:</b> {guide.g.tip}</p>}
        <div className="btn-row tight">
          <button type="button" className="btn ghost sm" onClick={() => copyGuide(guide.dish, guide.g!)}>Kopieren</button>
          <button type="button" className="btn ghost sm" onClick={() => setGuide(null)}>Schließen</button>
        </div>
      </div>}
      {canAct && <>
        <form className="compose" onSubmit={e => { e.preventDefault(); void add(); }}>
          <input value={text} onChange={e => setText(e.target.value)} placeholder="z. B. Milch, 2 Butter, 500 g Hack" maxLength={500} aria-label="Artikel hinzufügen" />
          <button disabled={busy || !text.trim()}>{busy ? '…' : 'Dazu'}</button>
        </form>
        <div className="shop-photo">
          <label className={busy ? 'busy' : ''}><Icon name="camera" /><span>Zettel oder Rezept fotografieren</span>
            <input type="file" accept="image/*" capture="environment" hidden disabled={busy} onChange={e => { void photo(e.target.files?.[0]); e.target.value = ''; }} /></label>
          <label className={`sm${busy ? ' busy' : ''}`} aria-label="Foto aus der Galerie"><Icon name="gallery" />
            <input type="file" accept="image/*" hidden disabled={busy} onChange={e => { void photo(e.target.files?.[0]); e.target.value = ''; }} /></label>
        </div>
        <p className="note">{busy ? 'Einen Moment, Claude liest …' : isPro()
          ? 'Vom Foto liest Claude Handschrift und Zutatenlisten. Was schon draufsteht, wird nicht doppelt aufgeführt, nur die Menge steigt. Zutaten eines Rezepts stehen unten beim Gericht. Über die Zaubertaste kannst du auch einfach ein Gericht nennen.'
          : 'Zettel und Rezepte vom Foto lesen gibt es in FamTO Pro.'}</p>
      </>}
      <div className="btn-row">
        {canAct && done.length > 0 && <button type="button" className="btn ghost" onClick={() => store.removeShop(done.map(x => x.id)).then(() => toast('Abgehakte Artikel entfernt.'), fail)}>Abgehakte entfernen ({done.length})</button>}
        <button type="button" className="btn" onClick={close}>Fertig</button>
      </div>
    </Sheet>
  );
}
