// Next.js Metadata Icons API — generates favicon via ImageResponse
// Avoids committing binary .ico files to the repo
import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        background: '#111111',
        color: '#ffffff',
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 18,
        fontWeight: 700,
        fontFamily: 'sans-serif',
        borderRadius: 6,
      }}
    >
      C
    </div>,
    size,
  );
}
