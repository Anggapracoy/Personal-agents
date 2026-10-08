import { attachmentPreview } from "./attachment-preview";
import { useEffect, useMemo, useState } from 'react';
import { fileDescription } from '../lib/file-display';
import { FileIcon } from './file-message';

export function DraftAttachments({ files, onRemove }: { files: File[]; onRemove?: (index: number) => void }) {
  const photos = useMemo(() => files.map(file => file.type.startsWith('image/') ? URL.createObjectURL(file) : null), [files]);
  useEffect(() => () => photos.forEach(url => { if (url) URL.revokeObjectURL(url); }), [photos]);
  return <div className="wd-draft-attachments" role="group" aria-label="Attached files">
    <p>Attached files</p>
    <div className="wd-draft-file-list">
      {files.map((file, index) => <div className="wd-draft-file" key={`${index}:${file.name}`}>
        <span className="wd-draft-file-thumb">{photos[index] ? <img src={photos[index]!} alt="" /> : <FileIcon />}</span>
        <span className="wd-file-copy"><strong title={file.name}>{file.name}</strong><small>{fileDescription(file.name, file.type, file.size)}</small></span>
        {onRemove && <button type="button" role="menuitem" className="wd-draft-file-remove" aria-label={`Remove ${file.name}`} onClick={() => onRemove(index)}>×</button>}
      </div>)}
    </div>
  </div>;
}

export function DraftPhotos({ files, onRemove }: { files: File[]; onRemove?: (index: number) => void }) {
  const expanded = files.some(file => file.type.startsWith("image/"));
  const [retained, setRetained] = useState(files);
  useEffect(() => {
    if (expanded) { setRetained(files); return; }
    const timeout = setTimeout(() => setRetained([]), window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 340);
    return () => clearTimeout(timeout);
  }, [files, expanded]);
  const visibleFiles = expanded ? files : retained;
  return <div className={`wd-draft-photo-region${expanded ? " is-expanded" : ""}`} inert={!expanded} aria-hidden={!expanded}>
    <div className="wd-draft-photos" aria-label="Attached photos">{visibleFiles.map((file, index) => file.type.startsWith('image/') && <div className="wd-draft-photo" key={attachmentPreview(file)}>
    <img src={attachmentPreview(file)} alt={file.name} />
    {onRemove && <button type="button" aria-label={`Remove ${file.name}`} onClick={() => onRemove(index)}>×</button>}
  </div>)}</div></div>;
}
