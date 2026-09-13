export function useModalDialog(name: string) {
  const dialogRef = useTemplateRef<HTMLDialogElement>(name);
  const isOpen = ref(false);

  function open() {
    isOpen.value = true;
  }

  function close() {
    dialogRef.value?.close();
  }

  // Native `close` event handler: keeps state in sync when the dialog is
  // dismissed via Esc or closed programmatically
  function onClose() {
    isOpen.value = false;
  }

  watch([dialogRef, isOpen], ([dialog, open]) => {
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  });

  return { dialogRef, isOpen, open, close, onClose };
}
