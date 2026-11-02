// Läuft FamTO in der Android-App? Dann stellt die App window.FamTO bereit (Mikrofon, Widget-Code).
type Native = { code(): string; version(): number; mic(mode: string): void; setup(): void; listen?(): void; setCode?(code: string): void; platform?: 'ios' };
export const native = (): Native | null => (window as unknown as { FamTO?: Native }).FamTO ?? null;
