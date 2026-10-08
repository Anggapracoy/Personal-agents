"use client";
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MessageMarkdown } from './message-markdown';
import { type NativeWindow, postNativeMessage } from './native-bridge';

type FileAttachment = { id: string; url: string; name: string; mimeType: string; description: string };
const downloadURL = (file: FileAttachment) => file.url.startsWith('blob:') ? file.url : `${file.url}${file.url.includes('?') ? '&' : '?'}download=1`;

export function FileMessage({ files, caption, mine = false }: { files: FileAttachment[]; caption?: string; mine?: boolean }) {
  const [selected, setSelected] = useState<FileAttachment | null>(null);
  return <div className={`wd-file-message${mine ? " is-mine" : ""}`}>
    {files.map(file => <a key={file.id} className="wd-file-attachment" href={downloadURL(file)} download={file.name} aria-label={`Open ${file.name}`} onClick={event => {
      if ((window as NativeWindow).__decisionFeedNativeShell) return;
      event.preventDefault(); setSelected(file);
    }}>
      <FileIcon name={file.name} mimeType={file.mimeType} />
      <span className="wd-file-copy"><strong>{file.name}</strong><small>{file.description}</small></span>
      <svg className="wd-file-download" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
    </a>)}
    {caption && <div className="wd-agent"><MessageMarkdown text={caption} /></div>}
    {selected && <DocumentViewer file={selected} onClose={() => setSelected(null)} />}
  </div>;
}

export function FileIcon({ name = '', mimeType = '' }: { name?: string; mimeType?: string }) {
  const extension = name.split('.').pop()?.toUpperCase();
  const label = mimeType === 'application/pdf' ? 'PDF' : extension && /^[A-Z0-9]{1,5}$/.test(extension) ? extension : 'FILE';
  return <svg className="wd-file-icon" width="32" height="38" viewBox="0 0 32 38" fill="none" aria-hidden="true"><path d="M20 2H6a3 3 0 0 0-3 3v28a3 3 0 0 0 3 3h20a3 3 0 0 0 3-3V11L20 2Z" fill="var(--bg)" stroke="currentColor" strokeWidth="1.5"/><path d="M20 2v9h9" stroke="currentColor" strokeWidth="1.5"/><rect x="0" y="18" width="32" height="13" rx="3" fill={label === 'PDF' ? '#D93636' : 'var(--ink2)'}/><text x="16" y="27" textAnchor="middle" fill="white" fontSize={label.length > 3 ? '7' : '9'} fontWeight="700" fontFamily="system-ui,sans-serif">{label}</text></svg>;
}

function DocumentViewer({ file, onClose }: { file: FileAttachment; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [source, setSource] = useState('');
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const type = file.mimeType.toLowerCase();
  const isText = type.startsWith('text/') || /\.(txt|md|csv|json|log)$/i.test(file.name);
  const isPDF = type === 'application/pdf' || /\.pdf$/i.test(file.name);
  useLayoutEffect(() => { const node = dialog.current!; node.showModal(); return () => node.close(); }, []);
  useLayoutEffect(() => {
    postNativeMessage({version:1,action:'modalOverlayVisibility',payload:{visible:true,hidesNavigation:true}});
    return () => postNativeMessage({version:1,action:'modalOverlayVisibility',payload:{visible:Boolean(document.querySelector(".wd-details-panel")),hidesNavigation:Boolean(document.querySelector(".wd-details-panel"))}});
  }, []);
  useEffect(() => {
    const abort = new AbortController(); let objectURL = ''; setError(''); setSource(''); setText(null);
    void (async () => {
      try {
        const response = await fetch(file.url, {signal:abort.signal});
        if (!response.ok) throw new Error('This file couldn’t be loaded.');
        const blob = await response.blob();
        if (abort.signal.aborted) return;
        if (isText) setText(await blob.text());
        else { objectURL = URL.createObjectURL(new Blob([blob], {type:isPDF ? 'application/pdf' : type})); setSource(objectURL); }
      } catch (error) { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : 'This file couldn’t be loaded.'); }
    })();
    return () => { abort.abort(); if (objectURL) URL.revokeObjectURL(objectURL); };
  }, [file.url, type, isText, isPDF, attempt]);
  return <dialog ref={dialog} className="wd-document-viewer" aria-label={`Document preview: ${file.name}`} onCancel={event => {event.preventDefault(); onClose();}}>
    <header><button type="button" onClick={onClose} aria-label="Close document">✕</button><strong>{file.name}</strong><a href={downloadURL(file)} download={file.name}>Save</a></header>
    <div className="wd-document-content">
      {error ? <div role="alert"><p>{error}</p><button onClick={() => setAttempt(value => value + 1)}>Try again</button></div>
        : text !== null ? <pre>{text}</pre>
        : !source ? <p role="status">Opening document…</p>
        : isPDF ? <iframe title={file.name} src={source} />
        : type.startsWith('image/') ? <img src={source} alt={file.description || file.name} />
        : type.startsWith('audio/') ? <audio controls src={source} />
        : type.startsWith('video/') ? <video controls src={source} />
        : <div><FileIcon name={file.name} mimeType={type}/><p>{file.name}</p><p>This file type can’t be previewed in this browser.</p><a href={downloadURL(file)} download={file.name}>Save file</a></div>}
    </div>
  </dialog>;
}
