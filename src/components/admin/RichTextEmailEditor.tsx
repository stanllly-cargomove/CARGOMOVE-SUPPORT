import React, { useEffect, useRef } from 'react';
import { Bold, Italic, Link, List, ListOrdered, Redo2, RemoveFormatting, Strikethrough, Underline, Undo2 } from 'lucide-react';

type RichTextEmailEditorProps = {
  value: string;
  onChange: (value: string) => void;
  minHeightClassName?: string;
};

const looksLikeHtml = (value: string) => /<\/?(?:p|div|br|strong|b|em|i|u|s|ul|ol|li|a|h[1-3]|blockquote)\b/i.test(value);

function plainTextToHtml(value: string) {
  const escaped = value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return escaped.split(/\n{2,}/).map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br>') || '<br>'}</p>`).join('');
}

export function RichTextEmailEditor({ value, onChange, minHeightClassName = 'min-h-72' }: RichTextEmailEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const htmlValue = looksLikeHtml(value) ? value : plainTextToHtml(value);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.innerHTML !== htmlValue && document.activeElement !== editor) editor.innerHTML = htmlValue;
  }, [htmlValue]);

  const emitChange = () => onChange(editorRef.current?.innerHTML || '');
  const command = (name: string, commandValue?: string) => {
    editorRef.current?.focus();
    document.execCommand(name, false, commandValue);
    emitChange();
  };
  const addLink = () => {
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    const url = window.prompt('Enter a web or email link (https://… or mailto:…)');
    if (!url) return;
    editorRef.current?.focus();
    if (range && selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    command('createLink', url);
  };

  const buttons = [
    { label: 'Undo', icon: Undo2, action: () => command('undo') },
    { label: 'Redo', icon: Redo2, action: () => command('redo') },
    { label: 'Bold', icon: Bold, action: () => command('bold') },
    { label: 'Italic', icon: Italic, action: () => command('italic') },
    { label: 'Underline', icon: Underline, action: () => command('underline') },
    { label: 'Strikethrough', icon: Strikethrough, action: () => command('strikeThrough') },
    { label: 'Bulleted list', icon: List, action: () => command('insertUnorderedList') },
    { label: 'Numbered list', icon: ListOrdered, action: () => command('insertOrderedList') },
    { label: 'Add link', icon: Link, action: addLink },
    { label: 'Clear formatting', icon: RemoveFormatting, action: () => command('removeFormat') },
  ];

  return (
    <div className="mt-1.5 overflow-hidden rounded-lg border border-slate-300 bg-white">
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 p-2" role="toolbar" aria-label="Email formatting">
        <select
          aria-label="Text style"
          defaultValue="p"
          onChange={(event) => { command('formatBlock', event.target.value); event.target.value = 'p'; }}
          className="mr-1 h-8 rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700"
        >
          <option value="p">Paragraph</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
          <option value="blockquote">Quote</option>
        </select>
        {buttons.map(({ label, icon: Icon, action }) => (
          <button
            key={label}
            type="button"
            title={label}
            aria-label={label}
            onMouseDown={(event) => event.preventDefault()}
            onClick={action}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 hover:bg-slate-200 hover:text-slate-900"
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder="Write the email body…"
        onInput={emitChange}
        onBlur={emitChange}
        className={`rich-email-editor ${minHeightClassName} max-h-[55vh] overflow-y-auto px-4 py-3 text-sm font-normal leading-6 text-slate-800 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500`}
      />
    </div>
  );
}
