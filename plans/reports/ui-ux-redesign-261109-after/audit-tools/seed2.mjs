// break-ui style data: plausible and schema-backed (speaker label <= 120, turn <= 4000 chars,
// <= 4000 turns). One account gets 36 conversations (one is a 300-turn, 6-speaker meeting).
const API = 'http://localhost:3000';
const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: process.env.SEED_EMAIL, password: process.env.UXAUDIT_PASSWORD }),
}).then((r) => r.json());
const token = login.data.token.accessToken;

const NAMES = [
  'Nguyễn Thị Hồng Ngọc Phương Thảo',
  'Trần Quang Minh',
  'Phạm Đặng Khánh Linh (Kế toán trưởng)',
  'Lê Văn Hùng',
  'Võ Nguyễn Thiên Ân',
  'Đỗ Thị Bích Hằng (Phòng Pháp chế và Tuân thủ quốc tế)',
];
const VI = [
  'Chúng ta cần chốt lại tiến độ triển khai trước cuối quý này.',
  'Phần ngân sách cho đợt mở rộng sang thị trường miền Trung vẫn chưa được phê duyệt, anh chị xem giúp em.',
  'Em đề nghị tách hợp đồng thành hai giai đoạn để giảm rủi ro thanh toán.',
  'Vâng, tôi đồng ý, nhưng cần có điều khoản về bảo mật dữ liệu khách hàng.',
  'Cuộc họp tuần sau sẽ dời sang thứ Tư lúc hai giờ chiều theo giờ Hà Nội.',
];
const EN = [
  'We need to lock the rollout schedule before the end of this quarter.',
  'The budget for the expansion into the central region has not been approved yet, could you take a look.',
  'I suggest splitting the contract into two phases to reduce payment risk.',
  'Yes, I agree, but we need a clause on protecting customer data.',
  'Next week meeting moves to Wednesday at two in the afternoon, Hanoi time.',
];
const turn = (i, n) => {
  const b = i % 2 === 1;
  const k = (i + n) % VI.length;
  const rep = 1 + ((i * 7) % 4); // 1-4 sentences, up to a few hundred chars
  const vi = Array(rep).fill(VI[k]).join(' ');
  const en = Array(rep).fill(EN[k]).join(' ');
  return {
    position: i,
    speakerRole: b ? 'speaker_b' : 'speaker_a',
    speakerLabel: NAMES[i % 6],
    sourceText: b ? en : vi,
    displayText: null,
    sourceLanguages: [b ? 'en' : 'vi'],
    translations: b ? { vi } : { en },
    offsetMs: i * 20_000,
  };
};
const base = Date.now() - 22 * 3_600_000;
const iso = (ms) => new Date(ms).toISOString();
const put = async (n, turns, mode) => {
  const id = crypto.randomUUID();
  const started = base + n * 1_800_000;
  const res = await fetch(`${API}/conversations/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      languages: ['vi', 'en'],
      startedAt: iso(started),
      endedAt: iso(started + turns.length * 20_000 + 60_000),
      mode,
      turns,
    }),
  });
  if (res.status !== 200) console.log('PUT', n, res.status, (await res.text()).slice(0, 160));
  return id;
};

const ids = [];
for (let n = 0; n < 36; n++) {
  const count = n === 35 ? 300 : n === 0 ? 1 : 2 + (n % 9);
  const turns = Array.from({ length: count }, (_, i) => turn(i, n));
  ids.push(await put(n, turns, n % 3 === 0 ? 'one-way' : 'two-way'));
  if (n === 27) await new Promise((s) => setTimeout(s, 65_000)); // the route allows 30 writes a minute
}
console.log('seeded', ids.length, 'big=' + ids[35]);
