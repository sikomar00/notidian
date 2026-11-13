import { byId } from '../dom.ts';
import { isViewMode } from '../messages.ts';
import { runS1, runS2, runS3S7, runS4Compare, runS4Snapshot, showReports } from './spike.ts';

const output = byId<HTMLPreElement>('out');
const print = (line: string): void => {
  output.textContent += `${line}\n`;
};

byId('save-token').addEventListener('click', async () => {
  const input = byId<HTMLInputElement>('token');
  await chrome.storage.local.set({ token: input.value.trim() });
  print(`토큰 저장됨 (길이 ${input.value.trim().length}자)`);
  input.value = '';
});

byId('save-mode').addEventListener('click', async () => {
  const mode = byId<HTMLSelectElement>('mode').value;
  if (isViewMode(mode)) await chrome.storage.local.set({ viewMode: mode });
  print(`보기 모드 저장: ${mode}`);
});

const actions: Record<string, (print: (line: string) => void) => Promise<void>> = {
  s1: runS1,
  s2: runS2,
  s3: runS3S7,
  's4-snapshot': runS4Snapshot,
  's4-compare': runS4Compare,
  reports: showReports,
};

for (const [id, action] of Object.entries(actions)) {
  byId(id).addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    try {
      await action(print);
    } finally {
      button.disabled = false;
    }
  });
}

byId('clear').addEventListener('click', () => {
  output.textContent = '';
});
