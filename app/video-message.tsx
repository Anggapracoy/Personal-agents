"use client";
import { useState } from "react";
import { MessageMarkdown } from "./message-markdown";

type Video = { id: string; url: string; name: string; description: string };

export function VideoMessage({ videos, caption }: { videos: Video[]; caption?: string }) {
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  return <div className="wd-video-message">
    {videos.map(video => <div className="wd-video-attachment" key={video.id}>
      <div className="wd-video-media">
      <video controls playsInline preload="metadata" src={`${video.url}#t=0.001`} aria-label={video.description}
        onError={() => setFailed(value => ({ ...value, [video.id]: true }))}
        onLoadedData={() => setFailed(value => ({ ...value, [video.id]: false }))}>
        Your browser cannot play this video. Use the download button.
      </video>
        <a className="wd-video-download wd-photo-download" href={`${video.url}?download=1`} download={video.name} aria-label={`Download video: ${video.description}`}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M6 9H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1" /></svg>
        </a>
      </div>
      {failed[video.id] && <p className="wd-video-error" role="status">This video couldn’t play here. Try downloading it to watch.</p>}
    </div>)}
    {caption && <div className="wd-agent"><MessageMarkdown text={caption} /></div>}
  </div>;
}
