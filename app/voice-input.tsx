"use client";

import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from "react";

export type VoiceState = { state: "idle" | "requesting" | "recording" | "transcribing" | "error"; levels: number[]; elapsed: number; error: string };
export const idleVoice: VoiceState = { state: "idle", levels: [], elapsed: 0, error: "" };

function preferredAudioType() {
  return ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find(type => MediaRecorder.isTypeSupported(type)) ?? "";
}
function elapsedLabel(seconds: number) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }

export type VoiceInputControls = { cancel: () => void; toggle: () => void };

/** One recording session owns its stream, meter and upload. Cancel never transcribes. */
export function VoiceInput({ disabled = false, active = true, onTranscript, onStateChange, controls }: {
  controls?: Ref<VoiceInputControls>; disabled?: boolean; active?: boolean; onTranscript: (text: string) => void; onStateChange?: (state: VoiceState) => void;
}) {
  const waveformId = useId();
  const [voice, setVoice] = useState<VoiceState>(idleVoice);
  const session = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const context = useRef<AudioContext | null>(null);
  const meter = useRef<ReturnType<typeof setInterval> | null>(null);
  const upload = useRef<AbortController | null>(null);
  const current = useRef({ onTranscript, onStateChange });
  current.current = { onTranscript, onStateChange };
  useEffect(() => { current.current.onStateChange?.(voice); }, [voice]);

  const release = () => {
    if (meter.current) clearInterval(meter.current);
    meter.current = null;
    const input = stream.current; stream.current = null;
    input?.getTracks().forEach(track => { try { track.stop(); } catch { /* Release the remaining tracks too. */ } });
    void context.current?.close().catch(() => undefined); context.current = null;
  };
  const dispose = () => {
    session.current += 1;
    upload.current?.abort(); upload.current = null;
    const recording = recorder.current; recorder.current = null;
    // WebKit can race a recorder state change with the stop call. The session
    // is already invalidated; always release the microphone and clear the UI.
    try { if (recording && recording.state !== "inactive") recording.stop(); }
    catch { /* Track cleanup below still stops capture. */ }
    finally { release(); }
  };
  const cancel = () => { dispose(); setVoice(idleVoice); };
  useEffect(() => { if (!active) cancel(); }, [active]);
  useEffect(() => () => { dispose(); }, []);

  const transcribe = async (blob: Blob, type: string, id: number) => {
    if (session.current !== id) return;
    const controller = new AbortController(); upload.current = controller;
    setVoice(value => ({ ...value, state: "transcribing" }));
    try {
      const extension = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
      const body = new FormData(); body.set("file", new File([blob], `voice.${extension}`, { type }));
      const response = await fetch("/api/transcribe", { method: "POST", body, signal: controller.signal });
      const result = await response.json().catch(() => ({}));
      if (session.current !== id) return;
      if (!response.ok || typeof result.text !== "string" || !result.text.trim()) throw new Error("Couldn’t transcribe. Try again.");
      setVoice(idleVoice);
      current.current.onTranscript(result.text.trim());
    } catch {
      if (session.current === id) setVoice({ ...idleVoice, state: "error", error: "Couldn’t transcribe. Try again." });
    } finally { if (upload.current === controller) upload.current = null; }
  };
  const finish = () => {
    if (recorder.current?.state !== "recording") return;
    setVoice(value => ({ ...value, state: "transcribing" }));
    recorder.current.stop();
    release();
  };
  const start = async () => {
    if (disabled || !active || ["requesting", "recording", "transcribing"].includes(voice.state)) return;
    const id = ++session.current;
    setVoice({ ...idleVoice, state: "requesting" });
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("Microphone unavailable.");
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      // Resume during the gesture; iOS may suspend an AudioContext created after permission resolves.
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      const audio = AudioContextClass ? new AudioContextClass() : null;
      context.current = audio;
      if (audio) void audio.resume().catch(() => undefined);
      const input = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (id !== session.current) { input.getTracks().forEach(track => track.stop()); return; }
      stream.current = input;
      const type = preferredAudioType();
      const recording = type ? new MediaRecorder(input, { mimeType: type }) : new MediaRecorder(input);
      recorder.current = recording;
      const chunks: Blob[] = [];
      recording.addEventListener("dataavailable", event => { if (event.data.size) chunks.push(event.data); });
      recording.addEventListener("stop", () => {
        if (session.current !== id) return;
        release(); recorder.current = null;
        const mime = recording.mimeType || type || "audio/webm";
        const blob = new Blob(chunks, { type: mime });
        if (blob.size < 256) { setVoice({ ...idleVoice, state: "error", error: "No audio captured. Try again." }); return; }
        void transcribe(blob, mime, id);
      }, { once: true });
      recording.addEventListener("error", () => { if (session.current === id) { dispose(); setVoice({ ...idleVoice, state: "error", error: "Recording stopped. Try again." }); } });
      const analyser = audio?.createAnalyser();
      if (analyser && audio) { analyser.fftSize = 256; audio.createMediaStreamSource(input).connect(analyser); }
      const samples = new Uint8Array(256);
      const levels = Array<number>(40).fill(0);
      const started = Date.now();
      recording.start(250);
      setVoice({ state: "recording", elapsed: 0, levels: [...levels], error: "" });
      // A small audio envelope also reaches the native composer; never stream microphone data over the bridge.
      meter.current = setInterval(() => {
        if (id !== session.current) return;
        let rms = 0;
        if (analyser) { analyser.getByteTimeDomainData(samples); rms = Math.sqrt(samples.reduce((sum, sample) => sum + ((sample - 128) / 128) ** 2, 0) / samples.length); }
        levels.shift(); levels.push(Math.min(1, rms * 5));
        const elapsed = Math.floor((Date.now() - started) / 1000);
        setVoice({ state: "recording", elapsed, levels: [...levels], error: "" });
        if (elapsed >= 300) finish();
      }, 80);
    } catch {
      if (id !== session.current) return;
      dispose(); setVoice({ ...idleVoice, state: "error", error: "Couldn’t access the microphone. Check permissions and try again." });
    }
  };
  useImperativeHandle(controls, () => ({ cancel, toggle: () => { if (recorder.current?.state === "recording") finish(); else void start(); } }));
  const busy = ["requesting", "recording", "transcribing"].includes(voice.state);
  return <div className={`voice-input voice-input-${voice.state}`} data-active={busy || undefined}>
    {!busy ? <button className="voice-input-trigger" type="button" onClick={() => void start()} disabled={disabled} aria-label="Use voice input" title={voice.error || "Use voice input"}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="3" width="8" height="12" rx="4" fill="none" stroke="currentColor" strokeWidth="1.9" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>
    </button> : <div className="voice-input-live">
      <button className="voice-input-cancel" type="button" onClick={cancel} aria-label="Cancel dictation"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg></button>
      <div className="voice-input-meter" data-recording={voice.state === "recording"}>
        <svg className="voice-input-waveform" viewBox="0 0 160 28" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id={waveformId}><stop offset="0%" stopColor="white" stopOpacity="0" /><stop offset="12%" stopColor="white" /><stop offset="88%" stopColor="white" /><stop offset="100%" stopColor="white" stopOpacity="0" /></linearGradient><mask id={`${waveformId}-mask`}><rect width="160" height="28" fill={`url(#${waveformId})`} /></mask></defs>
          <g mask={`url(#${waveformId}-mask)`}>{(voice.levels.length ? voice.levels : Array<number>(40).fill(0)).map((level, index) => <rect key={index} x={index * 4} y="0" width="2" height="28" rx="1" fill="currentColor" style={{ transform: `translateY(14px) scaleY(${Math.max(2 / 28, Math.min(1, level))}) translateY(-14px)` }} />)}</g>
        </svg>
        <span className="voice-input-processing" role="status">{voice.state === "recording" ? "" : voice.state === "requesting" ? "Starting…" : "Transcribing…"}</span>
      </div>
      {voice.state === "recording" && <><time aria-label={`Recording, ${elapsedLabel(voice.elapsed)}`}>{elapsedLabel(voice.elapsed)}</time><button className="voice-input-stop" type="button" onClick={finish} aria-label="Finish dictation"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 12 4 4 8-8" /></svg></button></>}
    </div>}
  </div>;
}
