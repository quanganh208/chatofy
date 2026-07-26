// Synthesizes the spoken turns the realtime harness measures against.
//
// Real speech is what decides whether the early-transcription head start pays
// off: it survives only when a turn contains no pause long enough to look like
// its end. Sine waves cannot answer that question, so the fixtures are actual
// synthesized Vietnamese with the prosody its own punctuation produces.
//
// The limit is worth stating plainly. Synthetic speech pauses where the text
// tells it to and nowhere else; people hesitate, restart, and trail off. These
// numbers are therefore a floor on how often the head start is lost, not an
// estimate of it. Only a recording of someone actually talking settles that.
//
// Writes once and is skipped afterwards; the audio is not committed.
//
//   node benchmarks/realtime/generate-fixtures.mjs
//
// Needs the TTS sidecar: uv run --directory services/local-tts uvicorn app:app --port 8003

import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TTS_URL = process.env.LOCAL_TTS_URL ?? 'http://127.0.0.1:8003';
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/**
 * Turns chosen for the shape of their pauses, not their meaning.
 *
 * `commas` counts the prosodic breaks the synthesizer is being asked for. A
 * turn with none is the case the head start is designed around; the rest are
 * the cases that can take it away, and the point of measuring is to find out
 * how much they do.
 */
const TURNS = [
  { id: 'plain-01', commas: 0, text: 'Xin chào, tôi muốn đặt một bàn cho hai người.' },
  { id: 'plain-02', commas: 0, text: 'Cho tôi hỏi nhà vệ sinh ở đâu ạ.' },
  { id: 'plain-03', commas: 0, text: 'Tôi bị dị ứng với hải sản.' },
  { id: 'plain-04', commas: 0, text: 'Bao nhiêu tiền một đêm vậy anh.' },
  { id: 'plain-05', commas: 0, text: 'Tôi cần đi đến sân bay trước sáu giờ chiều.' },
  { id: 'plain-06', commas: 0, text: 'Ở đây có nhận thẻ tín dụng không.' },
  {
    id: 'pause-01',
    commas: 1,
    text: 'Tôi muốn hỏi một chút, khách sạn này có wifi miễn phí không.',
  },
  { id: 'pause-02', commas: 1, text: 'Nếu được, cho tôi xin thêm một cái chăn nữa.' },
  { id: 'pause-03', commas: 2, text: 'Thật ra, tôi không chắc lắm, để tôi xem lại đã.' },
  { id: 'pause-04', commas: 2, text: 'Anh ơi, cái này bao nhiêu, tôi trả tiền mặt được không.' },
  {
    id: 'long-01',
    commas: 3,
    text: 'Hôm qua tôi có đặt phòng qua mạng, nhưng chưa nhận được xác nhận, nên tôi muốn kiểm tra lại, không biết còn phòng không.',
  },
  {
    id: 'long-02',
    commas: 2,
    text: 'Tôi đến từ Việt Nam, đây là lần đầu tiên tôi tới đây, nên tôi chưa biết đường lắm.',
  },

  // Short turns dominate a real conversation and are the case the latency
  // target is written for; the set needs enough of them to have a p50 that
  // means something.
  { id: 'short-01', commas: 0, text: 'Cảm ơn anh nhiều.' },
  { id: 'short-02', commas: 0, text: 'Bao nhiêu tiền ạ.' },
  { id: 'short-03', commas: 0, text: 'Tôi không hiểu.' },
  { id: 'short-04', commas: 0, text: 'Anh nói lại được không.' },
  { id: 'short-05', commas: 0, text: 'Ở đâu vậy ạ.' },
  { id: 'short-06', commas: 0, text: 'Vâng, được ạ.' },

  { id: 'plain-07', commas: 0, text: 'Cho tôi một ly cà phê đen không đường.' },
  { id: 'plain-08', commas: 0, text: 'Chuyến tàu tiếp theo mấy giờ chạy.' },
  { id: 'plain-09', commas: 0, text: 'Tôi muốn đổi tiền sang đô la Mỹ.' },
  { id: 'plain-10', commas: 0, text: 'Chỗ này chụp ảnh được không ạ.' },
  { id: 'plain-11', commas: 0, text: 'Tôi để quên điện thoại trong phòng.' },
  { id: 'plain-12', commas: 0, text: 'Xin lỗi vì tôi đến muộn.' },

  { id: 'pause-05', commas: 1, text: 'Xin lỗi anh, cho tôi hỏi đường ra bến xe.' },
  { id: 'pause-06', commas: 1, text: 'Nếu trời mưa, mình hoãn sang ngày mai nhé.' },
  {
    id: 'pause-07',
    commas: 2,
    text: 'Tôi nghĩ là được, nhưng để tôi hỏi lại đã, anh đợi một chút.',
  },
  { id: 'pause-08', commas: 2, text: 'Món này ngon lắm, anh thử đi, tôi mời.' },

  // Digits and proper nouns: the case that decided against the speech-to-speech
  // model, so the cascade should keep being measured on it.
  { id: 'digits-01', commas: 1, text: 'Số phòng của tôi là ba trăm linh hai, ở tầng ba.' },
  {
    id: 'digits-02',
    commas: 0,
    text: 'Số điện thoại của tôi là không chín tám, bảy sáu năm, bốn ba hai.',
  },

  {
    id: 'long-03',
    commas: 3,
    text: 'Tôi muốn thuê xe máy trong ba ngày, từ thứ hai đến thứ tư, không biết có cần đặt cọc không, và giá bao nhiêu một ngày.',
  },
  {
    id: 'long-04',
    commas: 2,
    text: 'Bác sĩ nói tôi nên nghỉ ngơi vài hôm, nhưng tôi có vé máy bay ngày kia, không biết có đổi được không.',
  },
];

async function synthesize(text) {
  const response = await fetch(`${TTS_URL}/synthesize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, language: 'vi' }),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

const exists = async (path) =>
  access(path).then(
    () => true,
    () => false,
  );

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const manifest = [];
  for (const turn of TURNS) {
    const file = join(OUT_DIR, `${turn.id}.wav`);
    if (await exists(file)) {
      console.log(`skip  ${turn.id} (already synthesized)`);
    } else {
      const started = Date.now();
      await writeFile(file, await synthesize(turn.text));
      console.log(`write ${turn.id} (${Date.now() - started}ms)`);
    }
    manifest.push({ ...turn, file: `${turn.id}.wav` });
  }

  await writeFile(join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\n${manifest.length} turns in ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(`\nFailed: ${err.message}`);
  console.error(`Is the TTS sidecar up on ${TTS_URL}?`);
  process.exit(1);
});
