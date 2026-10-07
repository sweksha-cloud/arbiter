import { ImageResponse } from 'next/og';

/** The link preview (LinkedIn, iMessage, Slack…): the pitch and a swipe card with a match. */
export const alt = 'Arbiter: where should we eat? Everyone sets must-haves privately, then swipes together until you match.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '72px 80px',
          color: '#f6f1ff',
          background: 'linear-gradient(135deg, #3a2340 0%, #211b38 55%, #2d2550 100%)'
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 600 }}>
          <div style={{ display: 'flex', alignItems: 'center', fontSize: 34, fontWeight: 700 }}>
            <div
              style={{
                display: 'flex',
                width: 52,
                height: 52,
                borderRadius: 14,
                marginRight: 16,
                background: '#ff8a6b'
              }}
            />
            Arbiter
          </div>
          <div style={{ display: 'flex', marginTop: 48, fontSize: 76, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }}>
            Where should we eat?
          </div>
          <div style={{ display: 'flex', marginTop: 24, fontSize: 32, lineHeight: 1.35, color: '#ddd4ec' }}>
            Everyone sets their must-haves privately. Then swipe together until you match.
          </div>
        </div>
        <div style={{ display: 'flex', position: 'relative', width: 360, height: 420 }}>
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 30,
              width: 290,
              height: 360,
              borderRadius: 28,
              background: 'linear-gradient(160deg, #ffd27a, #ff9d6b)',
              transform: 'rotate(-8deg)'
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 50,
              top: 20,
              width: 300,
              height: 380,
              display: 'flex',
              flexDirection: 'column',
              borderRadius: 28,
              overflow: 'hidden',
              background: '#342a55',
              border: '2px solid #74649c',
              transform: 'rotate(3deg)'
            }}
          >
            <div style={{ display: 'flex', height: 190, background: 'linear-gradient(135deg, #b38cff, #ff5fa2)' }} />
            <div style={{ display: 'flex', flexDirection: 'column', padding: 24 }}>
              <div style={{ display: 'flex', fontSize: 34, fontWeight: 700 }}>Thai Orchid</div>
              <div style={{ display: 'flex', marginTop: 8, fontSize: 22, color: '#ddd4ec' }}>4.6 rating · $20–30 · 0.4 mi</div>
              <div
                style={{
                  display: 'flex',
                  marginTop: 16,
                  padding: '6px 14px',
                  alignSelf: 'flex-start',
                  borderRadius: 999,
                  fontSize: 20,
                  color: '#7be0b0',
                  background: 'rgba(123, 224, 176, 0.15)'
                }}
              >
                Fits everyone
              </div>
            </div>
          </div>
          <div
            style={{
              position: 'absolute',
              right: -20,
              top: 0,
              display: 'flex',
              padding: '12px 22px',
              borderRadius: 999,
              fontSize: 26,
              fontWeight: 700,
              color: '#211b38',
              background: '#7be0b0',
              transform: 'rotate(-6deg)'
            }}
          >
            It&apos;s a match!
          </div>
        </div>
      </div>
    ),
    size
  );
}
