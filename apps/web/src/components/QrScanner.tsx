import jsQR from 'jsqr';
import { useEffect, useRef, useState } from 'react';

/**
 * Camera view that reads the first QR code it sees. Used on the token screen: an app on the iOS home
 * screen has its own storage, so a login link opened in Safari doesn't log the installed app in.
 */
export function QrScanner({ onCode, onCancel }: { onCode(text: string): void; onCancel(): void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(onCode);
  done.current = onCode;

  useEffect(() => {
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(
      (s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        const v = video.current!;
        v.srcObject = s;
        void v.play();
        // A few frames a second are plenty for a QR code held in front of the camera.
        timer = setInterval(() => {
          if (!v.videoWidth) return;
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
          ctx.drawImage(v, 0, 0);
          const code = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
          if (code?.data) {
            clearInterval(timer);
            done.current(code.data);
          }
        }, 200);
      },
      (e: Error) => setError(e.name === 'NotAllowedError'
        ? 'Camera access was denied. Allow it in the settings, or paste the token instead.'
        : 'No camera available. Paste the token instead.'),
    );
    return () => {
      stopped = true;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="qr-scanner">
      {error ? <div className="form-error" role="alert">{error}</div>
        : <video ref={video} className="qr-video" playsInline muted data-testid="token-scan-video" aria-label="Camera" />}
      <p className="muted">Point the camera at the QR code from <code>just token &lt;target&gt; --qr</code>.</p>
      <button type="button" className="btn g wide" onClick={onCancel}>Cancel</button>
    </div>
  );
}
