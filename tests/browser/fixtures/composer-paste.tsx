import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Composer } from '../../../app/composer';
import { encodeChatFiles } from '../../../app/chat-files';

function Fixture() {
  const variant = new URLSearchParams(location.search).get('variant') === 'thread' ? 'thread' : 'home';
  const [text, setText] = useState('Existing draft');
  const [files, setFiles] = useState<File[]>([]);
  const [sent, setSent] = useState('');
  return <div className="wd"><div className={variant === 'home' ? 'wd-home-layer' : 'wd-front-layer'}>
    <div style={{ padding: 24 }}><p data-testid="files">{files.map(file => file.name).join(', ')}</p><output data-testid="sent">{sent}</output></div>
    <Composer variant={variant} placeholder="Message" value={text} onChange={setText} files={files} onRemoveFile={index => setFiles(current => current.filter((_, i) => i !== index))} fileCount={files.length} fileBytes={files.reduce((total, file) => total + file.size, 0)}
      onFiles={incoming => setFiles(current => [...current, ...incoming])}
      onSend={async message => { setSent(JSON.stringify({ message, files: await encodeChatFiles(files) })); }} />
  </div></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
