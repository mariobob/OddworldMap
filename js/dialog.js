// Shared modal-dialog keyboard behavior: while a dialog is open, keyboard
// input stays inside it — Escape closes, Tab cycles the dialog's controls,
// and the map/search shortcuts underneath never fire.

export function trapDialogKeys(isOpen, panel, close) {
  window.addEventListener(
    "keydown",
    (e) => {
      if (!isOpen()) return;
      if (e.key === "Escape") {
        close();
        e.preventDefault();
      } else if (e.key === "Tab") {
        const items = [...panel.querySelectorAll("button, input")].filter((el) => el.offsetParent);
        if (items.length) {
          e.preventDefault();
          const i = items.indexOf(document.activeElement);
          items[i < 0 ? 0 : (i + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus();
        }
      }
      // immediate: another dialog's trap also listens here, and one Escape
      // must not close two dialogs at once
      e.stopImmediatePropagation();
    },
    { capture: true },
  );
}
