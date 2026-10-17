import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  copyTextToClipboard,
  copyTextToClipboardWithAutoClear,
} from "./clipboard";

const clipboardMock = vi.hoisted(() => ({
  writeText: vi.fn(),
  readText: vi.fn(),
}));

function stubNavigatorClipboard(clipboard: unknown) {
  Object.defineProperty(window.navigator, "clipboard", {
    value: clipboard,
    configurable: true,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  clipboardMock.writeText.mockReset().mockResolvedValue(undefined);
  clipboardMock.readText.mockReset();
  stubNavigatorClipboard(clipboardMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("copyTextToClipboard", () => {
  it("should use the async clipboard API when available", async () => {
    const copied = await copyTextToClipboard("secret");
    expect(copied).toBe(true);
    expect(clipboardMock.writeText).toHaveBeenCalledWith("secret");
  });

  it("should fall back to execCommand when the clipboard API fails", async () => {
    clipboardMock.writeText.mockRejectedValue(new Error("denied"));
    const execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand;
    const copied = await copyTextToClipboard("secret");
    expect(copied).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelectorAll("textarea")).toHaveLength(0);
  });

  it("should fall back to execCommand when the clipboard API is unavailable", async () => {
    stubNavigatorClipboard(undefined);
    const execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand;
    const copied = await copyTextToClipboard("secret");
    expect(copied).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("should return false when every strategy fails", async () => {
    stubNavigatorClipboard(undefined);
    document.execCommand = vi.fn().mockReturnValue(false);
    const copied = await copyTextToClipboard("secret");
    expect(copied).toBe(false);
  });
});

describe("copyTextToClipboardWithAutoClear", () => {
  it("should copy and clear the clipboard after the delay", async () => {
    clipboardMock.readText.mockResolvedValue("secret");
    const copied = await copyTextToClipboardWithAutoClear("secret", 30000);
    expect(copied).toBe(true);
    expect(clipboardMock.writeText).toHaveBeenCalledWith("secret");
    await vi.advanceTimersByTimeAsync(29999);
    expect(clipboardMock.writeText).not.toHaveBeenCalledWith("");
    await vi.advanceTimersByTimeAsync(1);
    expect(clipboardMock.writeText).toHaveBeenLastCalledWith("");
  });

  it("should not clear the clipboard when its content changed in between", async () => {
    clipboardMock.readText.mockResolvedValue("changed-by-someone-else");
    const copied = await copyTextToClipboardWithAutoClear("secret", 30000);
    expect(copied).toBe(true);
    await vi.advanceTimersByTimeAsync(30000);
    expect(clipboardMock.writeText).not.toHaveBeenCalledWith("");
  });

  it("should not clear the clipboard when readText is not permitted", async () => {
    clipboardMock.readText.mockRejectedValue(new Error("not allowed"));
    const copied = await copyTextToClipboardWithAutoClear("secret", 30000);
    expect(copied).toBe(true);
    await vi.advanceTimersByTimeAsync(30000);
    expect(clipboardMock.writeText).toHaveBeenLastCalledWith("");
  });

  it("should only let the most recent copy clear the clipboard", async () => {
    // Simulate a clipboard that holds the most recently written text
    clipboardMock.readText.mockImplementation(async () => {
      const calls = clipboardMock.writeText.mock.calls;
      return calls.length > 0 ? calls[calls.length - 1][0] : "";
    });
    await copyTextToClipboardWithAutoClear("first", 30000);
    await vi.advanceTimersByTimeAsync(10000);
    await copyTextToClipboardWithAutoClear("second", 30000);
    await vi.advanceTimersByTimeAsync(20000);
    // The first copy's timer fired but was superseded by the second copy
    expect(clipboardMock.writeText).not.toHaveBeenCalledWith("");
    await vi.advanceTimersByTimeAsync(10000);
    expect(clipboardMock.writeText).toHaveBeenLastCalledWith("");
  });

  it("should return false and never schedule a clear when the copy fails", async () => {
    stubNavigatorClipboard(undefined);
    document.execCommand = vi.fn().mockReturnValue(false);
    const copied = await copyTextToClipboardWithAutoClear("secret", 30000);
    expect(copied).toBe(false);
    await vi.advanceTimersByTimeAsync(60000);
    expect(clipboardMock.writeText).not.toHaveBeenCalled();
  });
});
