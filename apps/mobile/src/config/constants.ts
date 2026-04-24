// App-wide constants derived from env or fixed defaults
import { env } from './env';

export const API_BASE_URL = env.EXPO_PUBLIC_API_BASE_URL;
export const WS_URL = env.EXPO_PUBLIC_WS_URL;
export const APP_ENV = env.EXPO_PUBLIC_ENV;

// HTTP client
export const API_TIMEOUT_MS = 15_000;
export const API_RETRY_COUNT = 1;

// Audio pipeline
export const AUDIO_SAMPLE_RATE = 16_000; // 16 kHz — standard for speech recognition
export const AUDIO_FRAME_DURATION_MS = 100; // 100 ms frames → 1600 samples each
export const AUDIO_CHANNELS = 1; // mono
