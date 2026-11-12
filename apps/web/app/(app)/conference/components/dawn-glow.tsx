import { dawn } from '@chatofy/ui';

/**
 * The brand's dawn trio as one gradient. Decoration only, and never behind text
 * (`docs/design-guidelines.md`, Dawn): it rings the camera-off initials on the
 * pre-join preview and in the call grid, whose own disc is neutral.
 */
export const DAWN_GRADIENT = `linear-gradient(135deg, ${dawn.peach}, ${dawn.lavender}, ${dawn.mint})`;
