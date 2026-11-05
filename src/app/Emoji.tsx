import { useState } from 'react';

// Emoji-Auswahl wie bei WhatsApp: Reiter oben, zuletzt benutzte zuerst. Ohne fremde Bibliothek.
const SETS: [string, string][] = [
  ['😀', '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 😋 😛 😜 🤪 😝 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 💩 🤡 👻 👽 🤖'],
  ['👍', '👍 👎 👌 🤌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💪 🦵 🦶 👂 👃 👀 👁️ 🧠 👶 🧒 👦 👧 🧑 👨 👩 🧓 👴 👵 🙋 🙆 🙅 🤷 🤦 💁 🙇 🏃 🚶 💃 🕺 👪 💑 💏'],
  ['❤️', '❤️ 🧡 💛 💚 💙 💜 🤎 🖤 🤍 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💋 💯 💢 💥 💫 💦 💨 💤 ✨ ⭐ 🌟 🔥 ✅ ❌ ❗ ❓ ⚠️ 🆗 🆒 🆘 ➕ ➖'],
  ['🐶', '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🐤 🦆 🦉 🐴 🦄 🐝 🦋 🐌 🐞 🐢 🐍 🐙 🐠 🐟 🐬 🐳 🦈 🐘 🐑 🐐 🦌 🐕 🐈 🌸 🌹 🌻 🌼 🌷 🌱 🌲 🌳 🍀 🍁 🍂 ☀️ 🌤️ ⛅ 🌧️ ⛈️ ❄️ ☃️ 🌈 🌊'],
  ['🍕', '🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🥦 🥕 🌽 🥔 🥐 🍞 🥨 🧀 🥚 🍳 🥓 🥩 🍗 🍔 🍟 🍕 🌭 🥪 🌮 🍝 🍜 🍲 🍣 🍦 🍰 🎂 🧁 🍫 🍬 🍭 🍪 ☕ 🍵 🥤 🍺 🍻 🥂 🍷 🍾'],
  ['⚽', '⚽ 🏀 🏈 ⚾ 🎾 🏐 🏓 🏸 🥅 ⛳ 🎣 🚴 🏊 ⛵ 🏄 🎿 ⛸️ 🏆 🥇 🎉 🎊 🎈 🎁 🎄 🎃 🎆 🎮 🎲 🎨 🎬 🎤 🎧 🎸 🎹 🚗 🚕 🚌 🚑 🚒 🚲 🛴 ✈️ 🚀 🚂 ⛽ 🏠 🏡 🏫 🏥 ⛪ 🏖️ 🏕️'],
  ['📱', '📱 💻 ⌚ 📷 📞 ⏰ ⌛ 💡 🔋 🔌 💰 💶 💳 📦 ✉️ 📧 📅 📌 📎 ✂️ 🔑 🔒 🔨 🧰 🧹 🧺 🧻 🛒 💊 🩹 🎒 👓 👕 👖 👗 👟 👠 🧦 🧤 🧣 🎩 💍'],
];
const KEY = 'fk-emoji-recent';
const recent = (): string[] => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };

export function EmojiPanel({ pick }: { pick: (e: string) => void }) {
  const [tab, setTab] = useState(() => (recent().length ? -1 : 0));
  const [last, setLast] = useState(recent);
  const list = tab === -1 ? last : SETS[tab][1].split(' ');
  const use = (e: string) => {
    const r = [e, ...last.filter(x => x !== e)].slice(0, 32);
    setLast(r); try { localStorage.setItem(KEY, JSON.stringify(r)); } catch { /* egal */ }
    pick(e);
  };
  return (
    <div className="emo" role="dialog" aria-label="Emoji auswählen">
      <div className="emo-tabs">
        {last.length > 0 && <button type="button" className={tab === -1 ? 'on' : ''} aria-label="Zuletzt benutzt" onClick={() => setTab(-1)}>🕘</button>}
        {SETS.map(([t], i) => <button key={t} type="button" className={tab === i ? 'on' : ''} onClick={() => setTab(i)}>{t}</button>)}
      </div>
      <div className="emo-grid">{list.map(e => <button key={e} type="button" onClick={() => use(e)}>{e}</button>)}</div>
    </div>
  );
}
