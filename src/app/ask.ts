// Eigene Rückfrage statt window.confirm (das zeigt in der App „Auf der Seite https://… steht:“)
export function ask(text: string, yes = 'OK'): Promise<boolean> {
  return new Promise(done => {
    const bg = document.createElement('div');
    bg.className = 'ask-bg';
    const box = document.createElement('div');
    box.className = 'ask'; box.setAttribute('role', 'alertdialog'); box.setAttribute('aria-modal', 'true');
    const p = document.createElement('p'); p.textContent = text;
    const row = document.createElement('div'); row.className = 'ask-row';
    const no = document.createElement('button'); no.type = 'button'; no.textContent = 'Abbrechen';
    const ok = document.createElement('button'); ok.type = 'button'; ok.textContent = yes; ok.className = 'ask-ok';
    const end = (v: boolean) => { bg.remove(); done(v); };
    no.onclick = () => end(false); ok.onclick = () => end(true);
    bg.onclick = e => { if (e.target === bg) end(false); };
    row.append(no, ok); box.append(p, row); bg.append(box);
    document.body.append(bg); ok.focus();
  });
}
