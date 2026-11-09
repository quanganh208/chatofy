// Seeds three worst-case conversations through the real PUT /conversations/:id endpoint.
const API = 'http://localhost:3000';
const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: process.env.UXAUDIT_EMAIL ?? 'uxaudit.test@example.com',
    password: process.env.UXAUDIT_PASSWORD ?? '',
  }),
}).then((r) => r.json());
const token = login.data.token.accessToken;

const longVi =
  'Hôm nay chúng ta sẽ trao đổi về kế hoạch triển khai hệ thống dịch thuật thời gian thực cho toàn bộ chi nhánh, bao gồm cả việc đào tạo nhân viên, kiểm thử trên nhiều thiết bị khác nhau, và đảm bảo rằng mọi cuộc họp trực tuyến đều có phụ đề chính xác trong vòng hai giây sau khi người nói kết thúc câu. ';
const longEn =
  'Today we will discuss the rollout plan for the real-time translation system across every branch, including staff training, testing on many different devices, and making sure that every online meeting has accurate captions within two seconds after the speaker finishes the sentence. ';

const turn = (position, role, label, vi, en, offsetMs) => {
  const b = role === 'speaker_b';
  return {
    position,
    speakerRole: role,
    speakerLabel: label,
    sourceText: b ? en : vi,
    displayText: null,
    sourceLanguages: [b ? 'en' : 'vi'],
    translations: b ? { vi } : { en },
    offsetMs,
  };
};

const base = Date.now() - 3_600_000;
const iso = (ms) => new Date(ms).toISOString();

const convs = [
  {
    id: crypto.randomUUID(),
    body: {
      languages: ['vi', 'en'],
      startedAt: iso(base),
      endedAt: iso(base + 15 * 60_000),
      mode: 'two-way',
      turns: Array.from({ length: 24 }, (_, i) =>
        turn(
          i,
          i % 2 ? 'speaker_b' : 'speaker_a',
          i % 2
            ? 'Nguyễn Thị Phương Anh (Trưởng phòng vận hành khu vực miền Nam)'
            : 'Trần Văn Bình',
          longVi.repeat(1 + (i % 3)),
          longEn.repeat(1 + (i % 3)),
          i * 30_000,
        ),
      ),
    },
  },
  {
    id: crypto.randomUUID(),
    body: {
      languages: ['vi', 'en'],
      startedAt: iso(base + 3_600_000 - 600_000),
      endedAt: iso(base + 3_600_000 - 300_000),
      mode: 'one-way',
      turns: [
        turn(
          0,
          'speaker_a',
          'A'.repeat(100),
          'Siêu_dài_không_dấu_cách_' +
            'x'.repeat(180) +
            ' https://example.com/' +
            'path/'.repeat(30),
          'Unbroken_token_' + 'y'.repeat(180) + ' https://example.com/' + 'path/'.repeat(30),
          0,
        ),
        turn(1, 'speaker_a', null, 'Ừ.', 'Yes.', 5000),
      ],
    },
  },
  {
    id: crypto.randomUUID(),
    body: {
      languages: ['vi', 'en'],
      startedAt: iso(base + 7_000_000),
      endedAt: iso(base + 7_005_000),
      mode: 'one-way',
      turns: [turn(0, 'speaker_a', null, 'Xin chào.', 'Hello.', 0)],
    },
  },
];

for (const c of convs) {
  const res = await fetch(`${API}/conversations/${c.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(c.body),
  });
  const j = await res.json();
  console.log(
    c.id,
    res.status,
    j.success ? j.data.conversation.id : JSON.stringify(j.error).slice(0, 300),
  );
}
