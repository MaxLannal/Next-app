import { useLayoutEffect, useState, type KeyboardEvent, type RefObject } from 'react';

type ComposerProps = {
  streaming: boolean;
  disabled?: boolean;
  /** The field, so the sidebar can move focus into it. */
  fieldRef: RefObject<HTMLTextAreaElement | null>;
  onSend: (text: string) => void;
  onStop: () => void;
};

const MAX_HEIGHT = 200;

/**
 * Where the user writes: Enter sends, Shift+Enter starts a new line. While an answer streams, Send
 * becomes Stop. The field grows with its text up to a few lines, then scrolls.
 */
export function Composer({ streaming, disabled = false, fieldRef, onSend, onStop }: ComposerProps) {
  const [text, setText] = useState('');

  useLayoutEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [text, fieldRef]);

  const send = () => {
    if (streaming || disabled || text.trim() === '') return;
    onSend(text);
    setText('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    send();
  };

  return (
    <form
      className="chat__composer"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <label className="visually-hidden" htmlFor="chat-field">
        Ask Claude
      </label>
      <textarea
        ref={fieldRef}
        id="chat-field"
        className="chat__field"
        rows={1}
        value={text}
        placeholder="Ask about your hub"
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {streaming ? (
        <button className="btn btn-ghost btn-sm chat__send" type="button" onClick={onStop}>
          Stop
        </button>
      ) : (
        <button className="btn btn-sm chat__send" type="submit" disabled={disabled || text.trim() === ''}>
          Send
        </button>
      )}
    </form>
  );
}
