// Geräte-Einstellung: App öffnet direkt die Spracheingabe
const MIC_KEY = 'familienkalender-mic-start';
export const micStart = () => { try {
    return localStorage.getItem(MIC_KEY) === '1';
}
catch {
    return false;
} };
export const setMicStart = (on) => { try {
    localStorage.setItem(MIC_KEY, on ? '1' : '0');
}
catch { /* egal */ } };
