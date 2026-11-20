import { Caption } from '../types';

export function formatTimeSRT(seconds: number): string {
  const pad = (num: number, size: number = 2) => String(Math.floor(num)).padStart(size, '0');
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

export function formatTimeVTT(seconds: number): string {
  const pad = (num: number, size: number = 2) => String(Math.floor(num)).padStart(size, '0');
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}

export function formatDigitalTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00.0';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds % 1) * 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(m)}:${pad(s)}.${tenths}`;
}

export function exportToSRT(captions: Caption[]): string {
  return captions
    .map((c, index) => {
      return `${index + 1}\n${formatTimeSRT(c.startTime)} --> ${formatTimeSRT(c.endTime)}\n${c.text.trim()}\n`;
    })
    .join('\n');
}

export function exportToVTT(captions: Caption[]): string {
  const body = captions
    .map((c, index) => {
      return `${index + 1}\n${formatTimeVTT(c.startTime)} --> ${formatTimeVTT(c.endTime)}\n${c.text.trim()}\n`;
    })
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

export function exportToTXT(captions: Caption[]): string {
  return captions.map((c) => c.text.trim()).join('\n\n');
}

export function downloadTextBlob(filename: string, content: string, mimeType: string = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
