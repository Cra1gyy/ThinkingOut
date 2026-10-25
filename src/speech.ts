// Thin wrapper over the browser's Web Speech API (Chrome, Edge, Safari incl. iOS).
// Recognition stops by itself after pauses, so we restart it while the user is
// still "recording" and stitch the final results together.

/* eslint-disable @typescript-eslint/no-explicit-any */
const Recognition: any = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;

export const speechSupported = !!Recognition;

export interface Listener {
  stop(): void;
}

export function listen(opts: {
  onText: (finalText: string, interim: string) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}): Listener {
  let finalText = "";
  let active = true;
  let rec: any;

  const start = () => {
    rec = new Recognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-GB";

    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript.trim() + " ";
        else interim += r[0].transcript;
      }
      opts.onText(finalText, interim);
    };
    rec.onerror = (e: any) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      active = false;
      opts.onError(
        e.error === "not-allowed" ? "Microphone permission was denied." : `Speech recognition error: ${e.error}`,
      );
    };
    rec.onend = () => {
      if (active) {
        try {
          start();
          return;
        } catch {
          active = false;
        }
      }
      opts.onEnd();
    };
    rec.start();
  };

  start();
  return {
    stop() {
      active = false;
      rec?.stop();
    },
  };
}
