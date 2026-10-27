'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface PreJoinMedia {
  /** The preview stream; null until opened, or when no device could be opened. */
  stream: MediaStream | null;
  micOn: boolean;
  camOn: boolean;
  setMicOn: (on: boolean) => void;
  setCamOn: (on: boolean) => void;
  mics: MediaDeviceInfo[];
  cams: MediaDeviceInfo[];
  /** The picked device; undefined is the system default. */
  micId?: string;
  camId?: string;
  setMicId: (id?: string) => void;
  setCamId: (id?: string) => void;
  /** Microphone loudness, 0–1, for the meter. 0 while the mic is off. */
  level: number;
  /** Stop every track now, so the call can open the same devices. */
  release: () => void;
}

const constraint = (deviceId: string | undefined) => (deviceId ? { deviceId } : true);

/** Opens camera and mic together, then the mic alone, then gives up quietly. */
async function openPreview(micId?: string, camId?: string): Promise<MediaStream | null> {
  const media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
  if (!media?.getUserMedia) return null;
  try {
    return await media.getUserMedia({ audio: constraint(micId), video: constraint(camId) });
  } catch {
    try {
      return await media.getUserMedia({ audio: constraint(micId), video: false });
    } catch {
      return null;
    }
  }
}

/**
 * The pre-join screen's own camera and microphone.
 *
 * Separate from the call's stream on purpose: the call opens its devices in
 * `acquireLocalMedia` and reopens them on every reconnect, so it cannot borrow a
 * stream this screen owns. This one exists to answer "can they see me, can they
 * hear me" before joining, and is released the moment the user joins.
 */
export function usePreJoinMedia(): PreJoinMedia {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [micOn, setMicOnState] = useState(true);
  const [camOn, setCamOnState] = useState(true);
  const [micId, setMicId] = useState<string | undefined>(undefined);
  const [camId, setCamId] = useState<string | undefined>(undefined);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [level, setLevel] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  // Read when a reopened stream arrives, so a device change keeps the toggles.
  const togglesRef = useRef({ micOn: true, camOn: true });

  const stopCurrent = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const enumerate = useCallback(() => {
    const media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
    void media
      ?.enumerateDevices?.()
      .then((devices) => {
        setMics(devices.filter((device) => device.kind === 'audioinput'));
        setCams(devices.filter((device) => device.kind === 'videoinput'));
      })
      .catch(() => {
        /* no list: the pickers offer the system default only */
      });
  }, []);

  // (Re)open whenever a different device is picked.
  useEffect(() => {
    let cancelled = false;
    void openPreview(micId, camId).then((next) => {
      if (cancelled) {
        next?.getTracks().forEach((track) => track.stop());
        return;
      }
      stopCurrent();
      if (next) {
        next.getAudioTracks().forEach((track) => (track.enabled = togglesRef.current.micOn));
        next.getVideoTracks().forEach((track) => (track.enabled = togglesRef.current.camOn));
      }
      streamRef.current = next;
      setStream(next);
      // Labels are only filled in once permission is granted, which is why the
      // list is read after the first open rather than on mount.
      if (next) enumerate();
    });
    return () => {
      cancelled = true;
    };
  }, [micId, camId, enumerate, stopCurrent]);

  // A device plugged in or out while the user is deciding.
  useEffect(() => {
    const media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
    media?.addEventListener?.('devicechange', enumerate);
    return () => media?.removeEventListener?.('devicechange', enumerate);
  }, [enumerate]);

  // Every track stops when the screen goes away.
  useEffect(() => stopCurrent, [stopCurrent]);

  // Microphone level: RMS of the time-domain signal, set every third frame.
  useEffect(() => {
    const track = stream?.getAudioTracks()[0];
    if (!stream || !track || typeof AudioContext === 'undefined' || !micOn) {
      setLevel(0);
      return;
    }
    const context = new AudioContext();
    // Created before any gesture when the room link opens in a fresh tab, so the
    // autoplay policy may start it suspended — and a suspended context reads
    // silence. The first press or key resumes it.
    const resume = () => {
      if (context.state === 'suspended') void context.resume().catch(() => {});
    };
    window.addEventListener('pointerdown', resume, { once: true });
    window.addEventListener('keydown', resume, { once: true });
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let frame = 0;
    let handle = requestAnimationFrame(function tick() {
      frame += 1;
      if (frame % 3 === 0) {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        setLevel(Math.min(1, Math.sqrt(sum / samples.length) * 4));
      }
      handle = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(handle);
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
      if (context.state !== 'closed') void context.close().catch(() => {});
    };
  }, [stream, micOn]);

  const setMicOn = useCallback((on: boolean) => {
    togglesRef.current.micOn = on;
    streamRef.current?.getAudioTracks().forEach((track) => (track.enabled = on));
    setMicOnState(on);
  }, []);

  const setCamOn = useCallback((on: boolean) => {
    togglesRef.current.camOn = on;
    streamRef.current?.getVideoTracks().forEach((track) => (track.enabled = on));
    setCamOnState(on);
  }, []);

  const release = useCallback(() => {
    stopCurrent();
    // The meter's context closes in its effect's cleanup, which this re-runs.
    setStream(null);
  }, [stopCurrent]);

  return {
    stream,
    micOn,
    camOn,
    setMicOn,
    setCamOn,
    mics,
    cams,
    micId,
    camId,
    setMicId,
    setCamId,
    level,
    release,
  };
}
