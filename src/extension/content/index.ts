const OVERLAY_ID = 'notidian-overlay';

function close(): void {
  document.getElementById(OVERLAY_ID)?.remove();
}

function open(): void {
  const backdrop = document.createElement('div');
  backdrop.id = OVERLAY_ID;
  backdrop.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.4)';
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  const frame = document.createElement('iframe');
  frame.src = chrome.runtime.getURL('graph.html?mode=center');
  frame.title = 'Notidian 그래프';
  frame.style.cssText = 'width:80vw;height:80vh;border:0;border-radius:8px;background:#fff';
  backdrop.append(frame);
  document.body.append(backdrop);
}

chrome.runtime.onMessage.addListener((message: { type?: string }) => {
  if (message.type === 'close-overlay') close();
  if (message.type === 'toggle-overlay') {
    if (document.getElementById(OVERLAY_ID)) close();
    else open();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') close();
});
