/**
 * 붙은 버튼 묶음을 "하나만 고르는" 라디오 묶음으로 만든다(WAI-ARIA radio group).
 * Tab으로는 고른 칸 하나에만 들어오고, 방향키·Home·End로 옮기며 바로 고른다. `select`는 코드에서 고른 칸을 바꿀 때 쓴다.
 */
export function setupRadioGroup(buttons: readonly HTMLButtonElement[], onSelect: (index: number) => void): (index: number) => void {
  function select(index: number): void {
    buttons.forEach((button, i) => {
      button.setAttribute('aria-checked', String(i === index));
      button.tabIndex = i === index ? 0 : -1;
    });
  }
  function choose(index: number, focus: boolean): void {
    if (focus) buttons[index]?.focus();
    onSelect(index);
  }
  buttons.forEach((button, index) => {
    button.setAttribute('role', 'radio');
    button.addEventListener('click', () => choose(index, false));
    button.addEventListener('keydown', (event) => {
      const last = buttons.length - 1;
      const next = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: last }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      choose(next > last ? 0 : next < 0 ? last : next, true);
    });
  });
  select(0);
  return select;
}
