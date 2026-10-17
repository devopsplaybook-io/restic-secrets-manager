const CLEAR_CLIPBOARD_DEFAULT_MS = 30000;

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back to the execCommand path (permission denial, non-secure context)
    }
  }
  return copyViaHiddenTextarea(text);
}

function copyViaHiddenTextarea(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  let copied: boolean;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  document.body.removeChild(textarea);
  return copied;
}

// Sequence guard: when several copies overlap, only the copy of the most
// recent call may clear the clipboard.
let copySequence = 0;
let lastCopiedText = "";

export async function copyTextToClipboardWithAutoClear(
  text: string,
  clearAfterMs: number = CLEAR_CLIPBOARD_DEFAULT_MS,
): Promise<boolean> {
  const sequence = ++copySequence;
  const copied = await copyTextToClipboard(text);
  if (!copied) {
    return false;
  }
  lastCopiedText = text;
  setTimeout(() => {
    if (sequence === copySequence) {
      void clearClipboard(sequence);
    }
  }, clearAfterMs);
  return true;
}

async function clearClipboard(sequence: number): Promise<void> {
  try {
    if (navigator.clipboard?.readText) {
      const current = await navigator.clipboard.readText();
      if (sequence !== copySequence) {
        return;
      }
      // The clipboard changed since the copy (other copy or other app): leave it alone
      if (current !== lastCopiedText) {
        return;
      }
    }
  } catch {
    // readText permission unavailable: clear unconditionally (sequence-guarded)
  }
  if (sequence !== copySequence) {
    return;
  }
  await copyTextToClipboard("");
}
