// Vẽ bốn biểu đồ use case (Hình 2.1–2.4) theo ký pháp UML rồi xuất PNG bằng Chrome headless.
// Mermaid không có biểu đồ use case, nên trước đây các hình được giả lập bằng flowchart: tác nhân là ô chữ nhật
// và không có quan hệ tổng quát hoá. Script này vẽ trực tiếp SVG: tác nhân hình người, use case hình elip,
// biên hệ thống, liên kết nét liền, «include»/«extend» nét đứt có mũi tên, tổng quát hoá có tam giác rỗng.
// Toạ độ đặt tay cho từng hình để các đường không cắt qua phần tử khác.
// Dùng: node cong-cu/ve-use-case-uml.mjs <đường-dẫn-chrome.exe>
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const chrome = process.argv[2];
if (!chrome) throw new Error('Dùng: node ve-use-case-uml.mjs <đường-dẫn-chrome.exe>');
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'hinh');

const FONT = "'Times New Roman', serif";
const FS = 16; // cỡ chữ nhãn
const UC_RY = 26; // bán trục đứng của elip use case một dòng
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Ước lượng bề rộng chữ (Times New Roman, chữ thường ≈ 0,5 em) để định cỡ elip và nền nhãn.
const textW = (s, fs = FS) => s.length * fs * 0.5;

// Use case: elip quanh nhãn; nhãn có "\n" thì xuống dòng và elip cao hơn.
function ucGeom(u) {
  const lines = u.label.split('\n');
  const rx = Math.max(...lines.map((l) => textW(l))) / 2 + 26;
  const ry = lines.length > 1 ? UC_RY + 10 : UC_RY;
  return { ...u, lines, rx, ry };
}

// Điểm trên biên của phần tử theo hướng tới điểm (tx, ty), để đường nối dừng đúng ở viền.
function edgePoint(n, tx, ty) {
  if (n.kind === 'uc') {
    const dx = tx - n.x;
    const dy = ty - n.y;
    const t = 1 / Math.sqrt((dx / n.rx) ** 2 + (dy / n.ry) ** 2);
    return [n.x + dx * t, n.y + dy * t];
  }
  // Tác nhân: coi như một hình chữ nhật bao quanh hình người (không gồm nhãn tên bên dưới).
  const cx = n.x;
  const cy = n.y - 8;
  const hw = 20;
  const hh = 34;
  const dx = tx - cx;
  const dy = ty - cy;
  const s = Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9));
  return [cx + dx * s, cy + dy * s];
}

function actorSvg(a) {
  const { x, y } = a;
  const lines = a.label.split('\n');
  const label = lines
    .map(
      (l, i) => `<text x="${x}" y="${y + 48 + i * (FS + 2)}" text-anchor="middle">${esc(l)}</text>`,
    )
    .join('');
  return `<g stroke="#222" stroke-width="1.6" fill="none">
  <circle cx="${x}" cy="${y - 32}" r="9" fill="#fff"/>
  <line x1="${x}" y1="${y - 23}" x2="${x}" y2="${y + 4}"/>
  <line x1="${x - 17}" y1="${y - 13}" x2="${x + 17}" y2="${y - 13}"/>
  <line x1="${x}" y1="${y + 4}" x2="${x - 13}" y2="${y + 24}"/>
  <line x1="${x}" y1="${y + 4}" x2="${x + 13}" y2="${y + 24}"/>
</g><g fill="#111">${label}</g>`;
}

function ucSvg(u) {
  const n = u.lines.length;
  const text = u.lines
    .map(
      (l, i) =>
        `<text x="${u.x}" y="${u.y + 5 + (i - (n - 1) / 2) * (FS + 3)}" text-anchor="middle">${esc(l)}</text>`,
    )
    .join('');
  return `<ellipse cx="${u.x}" cy="${u.y}" rx="${u.rx}" ry="${u.ry}" fill="#f4f4f4" stroke="#222" stroke-width="1.4"/><g fill="#111">${text}</g>`;
}

// Nhãn giữa đường (ví dụ «include»), có nền trắng để không bị nét vẽ cắt qua.
function midLabel(x1, y1, x2, y2, text, at = 0.5) {
  const mx = x1 + (x2 - x1) * at;
  const my = y1 + (y2 - y1) * at;
  const w = textW(text, FS - 2) + 8;
  return `<rect x="${mx - w / 2}" y="${my - 10}" width="${w}" height="18" fill="#fff"/><text x="${mx}" y="${my + 4}" text-anchor="middle" font-size="${FS - 2}" font-style="italic" fill="#111">${esc(text)}</text>`;
}

// Mũi tên: 'open' (đầu nhọn hở, cho include/extend) hoặc 'hollow' (tam giác rỗng, cho tổng quát hoá).
function arrowHead(x1, y1, x2, y2, type) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const L = type === 'hollow' ? 16 : 12;
  const W = type === 'hollow' ? 0.45 : 0.4;
  const p1 = [x2 - L * Math.cos(a - W), y2 - L * Math.sin(a - W)];
  const p2 = [x2 - L * Math.cos(a + W), y2 - L * Math.sin(a + W)];
  if (type === 'hollow') {
    return `<polygon points="${x2},${y2} ${p1} ${p2}" fill="#fff" stroke="#222" stroke-width="1.4"/>`;
  }
  return `<polyline points="${p1} ${x2},${y2} ${p2}" fill="none" stroke="#222" stroke-width="1.4"/>`;
}

// Nhiều tác nhân con cùng tổng quát hoá về một tác nhân cha: một tam giác chung dưới nhãn của cha,
// một thân dọc và các nhánh ngang tới từng con (kiểu "cây" của UML, tránh nhiều tam giác chồng nhau).
// Các con phải nằm bên phải thân và thấp hơn nhãn của cha.
function genTreeSvg(kidIds, parentId, nodes) {
  const parent = nodes[parentId];
  const kids = kidIds.map((id) => nodes[id]);
  const px = parent.x;
  const apex = parent.y + 60;
  const base = apex + 16;
  const lastY = Math.max(...kids.map((k) => k.y - 13));
  const tri = `<polygon points="${px},${apex} ${px - 9},${base} ${px + 9},${base}" fill="#fff" stroke="#222" stroke-width="1.4"/>`;
  const trunk = `<line x1="${px}" y1="${base}" x2="${px}" y2="${lastY}" stroke="#222" stroke-width="1.3"/>`;
  const branches = kids
    .map(
      (k) =>
        `<line x1="${px}" y1="${k.y - 13}" x2="${k.x - 20}" y2="${k.y - 13}" stroke="#222" stroke-width="1.3"/>`,
    )
    .join('');
  return tri + trunk + branches;
}

function edgeSvg(e, nodes) {
  if (e.type === 'genTree') return genTreeSvg(e.from, e.to, nodes);
  const a = nodes[e.from];
  const b = nodes[e.to];
  if (!a || !b) throw new Error(`Thiếu phần tử ${e.from} hoặc ${e.to}`);
  const ac = a.kind === 'uc' ? [a.x, a.y] : [a.x, a.y - 8];
  const bc = b.kind === 'uc' ? [b.x, b.y] : [b.x, b.y - 8];
  let [x1, y1] = edgePoint(a, ...bc);
  const [x2, y2] = edgePoint(b, ...ac);
  // Tổng quát hoá giữa hai tác nhân xếp dọc: bắt đầu dưới nhãn tên của con để nét không đè lên chữ.
  if (e.type === 'gen' && a.kind === 'actor' && b.kind === 'actor' && b.y > a.y) {
    x1 = a.x;
    y1 = a.y + 56 + (a.label.split('\n').length - 1) * (FS + 2);
  }
  if (e.type === 'assoc') {
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#222" stroke-width="1.3"/>`;
  }
  if (e.type === 'gen') {
    // Rút đoạn thẳng lại trước đỉnh tam giác để nét không lộ trong tam giác rỗng.
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const ex = x2 - 14 * Math.cos(ang);
    const ey = y2 - 14 * Math.sin(ang);
    return `<line x1="${x1}" y1="${y1}" x2="${ex}" y2="${ey}" stroke="#222" stroke-width="1.3"/>${arrowHead(x1, y1, x2, y2, 'hollow')}`;
  }
  const label = e.type === 'include' ? '«include»' : '«extend»';
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#222" stroke-width="1.3" stroke-dasharray="7 5"/>${arrowHead(x1, y1, x2, y2, 'open')}${midLabel(x1, y1, x2, y2, label, e.at ?? 0.5)}`;
}

function render(d) {
  const nodes = {};
  for (const [id, a] of Object.entries(d.actors)) nodes[id] = { ...a, kind: 'actor' };
  for (const [id, u] of Object.entries(d.ucs)) nodes[id] = { ...ucGeom(u), kind: 'uc' };
  const edges = d.edges
    .map(([type, from, to, at]) => edgeSvg({ type, from, to, at }, nodes))
    .join('\n');
  const b = d.boundary;
  const body = [
    `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="#fff" stroke="#222" stroke-width="1.6"/>`,
    `<text x="${b.x + b.w / 2}" y="${b.y + 24}" text-anchor="middle" font-weight="bold" fill="#111">${esc(b.title)}</text>`,
    edges,
    ...Object.values(nodes)
      .filter((n) => n.kind === 'uc')
      .map(ucSvg),
    ...Object.values(nodes)
      .filter((n) => n.kind === 'actor')
      .map(actorSvg),
  ].join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${d.w}" height="${d.h}" viewBox="0 0 ${d.w} ${d.h}" font-family="${FONT}" font-size="${FS}"><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`;
}

// ---------------- Hình 2.1: tổng quát ----------------
const row = (i) => 95 + i * 78;
const tongQuat = {
  w: 1120,
  h: 1060,
  boundary: { x: 400, y: 40, w: 480, h: 1005, title: 'Hệ thống Chatofy' },
  actors: {
    khach: { x: 130, y: row(0) + 4, label: 'Khách' },
    nd: { x: 130, y: 420, label: 'Người dùng' },
    tv: { x: 280, y: 640, label: 'Thành viên nhóm' },
    chunhom: { x: 280, y: 750, label: 'Chủ nhóm / Quản trị nhóm' },
    chuphong: { x: 280, y: 860, label: 'Chủ phòng họp' },
    thamgia: { x: 280, y: 970, label: 'Người tham gia họp' },
    tt: { x: 1010, y: row(2) + 4, label: 'Cổng thanh toán' },
    ai: { x: 1010, y: 680, label: 'Dịch vụ AI' },
  },
  ucs: {
    dn: { x: 640, y: row(0), label: 'Đăng ký / Đăng nhập' },
    tk: { x: 640, y: row(1), label: 'Quản lý tài khoản' },
    credit: { x: 640, y: row(2), label: 'Mua credit' },
    ls: { x: 640, y: row(3), label: 'Quản lý lịch sử hội thoại' },
    bb: { x: 640, y: row(4), label: 'Sinh biên bản' },
    dich: { x: 640, y: row(5), label: 'Dịch hội thoại' },
    ext: { x: 640, y: row(6), label: 'Dịch cuộc gọi qua\ntiện ích Chrome' },
    ngucanh: { x: 640, y: row(7), label: 'Quản lý ngữ cảnh dịch và thuật ngữ' },
    thuvien: { x: 640, y: row(8), label: 'Dùng thư viện chung của nhóm' },
    nhom: { x: 640, y: row(9), label: 'Quản lý nhóm' },
    tao: { x: 640, y: row(10), label: 'Tạo phòng họp' },
    hop: { x: 640, y: row(11), label: 'Tham gia họp có dịch' },
  },
  edges: [
    ['assoc', 'khach', 'dn'],
    ...['tk', 'credit', 'ls', 'bb', 'dich', 'ext', 'ngucanh'].map((u) => ['assoc', 'nd', u]),
    ['assoc', 'tv', 'thuvien'],
    ['assoc', 'chunhom', 'nhom'],
    ['assoc', 'chuphong', 'tao'],
    ['assoc', 'thamgia', 'hop'],
    ['assoc', 'credit', 'tt'],
    ...['bb', 'dich', 'ext', 'hop'].map((u) => ['assoc', u, 'ai']),
    ['genTree', ['tv', 'chunhom', 'chuphong', 'thamgia'], 'nd'],
  ],
};

// ---------------- Hình 2.2: dịch hội thoại ----------------
const dichHoiThoai = {
  w: 1180,
  h: 790,
  boundary: { x: 170, y: 30, w: 830, h: 745, title: 'Dịch hội thoại' },
  actors: {
    nd: { x: 75, y: 550, label: 'Người dùng' },
    ai: { x: 1100, y: 400, label: 'Dịch vụ AI' },
  },
  ucs: {
    dich: { x: 560, y: 330, label: 'Dịch hội thoại' },
    mot: { x: 320, y: 230, label: 'Dịch một chiều' },
    hai: { x: 320, y: 470, label: 'Dịch hai chiều\nViệt–Anh' },
    bb: { x: 860, y: 650, label: 'Sinh biên bản' },
    doc: { x: 430, y: 105, label: 'Đọc bản dịch' },
    ngucanh: { x: 690, y: 105, label: 'Áp dụng ngữ cảnh dịch' },
    lid: { x: 590, y: 560, label: 'Tự nhận diện ngôn ngữ' },
    nguoinoi: { x: 320, y: 630, label: 'Gán người nói' },
    nhandang: { x: 860, y: 230, label: 'Nhận dạng tiếng nói' },
    dichvb: { x: 860, y: 340, label: 'Dịch văn bản' },
    luu: { x: 860, y: 450, label: 'Lưu hội thoại' },
  },
  edges: [
    ['assoc', 'nd', 'mot'],
    ['assoc', 'nd', 'hai'],
    ['assoc', 'nd', 'bb'],
    ['gen', 'mot', 'dich'],
    ['gen', 'hai', 'dich'],
    ['include', 'dich', 'nhandang'],
    ['include', 'dich', 'dichvb'],
    ['include', 'dich', 'luu'],
    ['extend', 'doc', 'dich'],
    ['extend', 'ngucanh', 'dich'],
    ['extend', 'lid', 'dich'],
    ['include', 'hai', 'lid'],
    ['include', 'hai', 'nguoinoi'],
    ['assoc', 'nhandang', 'ai'],
    ['assoc', 'dichvb', 'ai'],
    ['assoc', 'bb', 'ai'],
  ],
};

// ---------------- Hình 2.3: họp video ----------------
const hopVideo = {
  w: 1100,
  h: 760,
  boundary: { x: 250, y: 30, w: 620, h: 715, title: 'Họp video' },
  actors: {
    chu: { x: 100, y: 150, label: 'Chủ phòng họp' },
    tv: { x: 100, y: 500, label: 'Người tham gia họp' },
    ai: { x: 1000, y: 470, label: 'Dịch vụ AI' },
  },
  ucs: {
    tao: { x: 410, y: 90, label: 'Tạo phòng họp' },
    ketthuc: { x: 410, y: 175, label: 'Kết thúc họp' },
    xoa: { x: 410, y: 260, label: 'Xoá phòng họp' },
    chiase: { x: 750, y: 90, label: 'Chia sẻ đường dẫn\n/ mã QR' },
    thamgia: { x: 410, y: 365, label: 'Tham gia phòng họp' },
    chonnn: { x: 750, y: 365, label: 'Chọn ngôn ngữ nói' },
    mic: { x: 430, y: 450, label: 'Bật/tắt micro, camera' },
    phude: { x: 520, y: 535, label: 'Nhận phụ đề và giọng dịch' },
    chat: { x: 520, y: 615, label: 'Chat có dịch' },
    bienban: { x: 520, y: 695, label: 'Xem biên bản họp' },
  },
  edges: [
    ['assoc', 'chu', 'tao'],
    ['assoc', 'chu', 'ketthuc'],
    ['assoc', 'chu', 'xoa'],
    ['gen', 'chu', 'tv'],
    ...['thamgia', 'mic', 'phude', 'chat', 'bienban'].map((u) => ['assoc', 'tv', u]),
    ['include', 'tao', 'chiase'],
    ['include', 'thamgia', 'chonnn'],
    ...['phude', 'chat', 'bienban'].map((u) => ['assoc', u, 'ai']),
  ],
};

// ---------------- Hình 2.4: quản lý nhóm ----------------
const quanLyNhom = {
  w: 1000,
  h: 900,
  boundary: { x: 260, y: 30, w: 560, h: 855, title: 'Quản lý nhóm' },
  actors: {
    owner: { x: 110, y: 130, label: 'Chủ nhóm' },
    admin: { x: 110, y: 420, label: 'Quản trị nhóm' },
    member: { x: 110, y: 690, label: 'Thành viên nhóm' },
    moi: { x: 920, y: 760, label: 'Người được mời' },
  },
  ucs: {
    tao: { x: 540, y: 90, label: 'Tạo nhóm' },
    xoa: { x: 540, y: 170, label: 'Xoá nhóm' },
    doiten: { x: 540, y: 255, label: 'Đổi tên nhóm' },
    invite: { x: 540, y: 330, label: 'Mời thành viên qua email' },
    thuhoi: { x: 540, y: 405, label: 'Thu hồi lời mời' },
    vaitro: { x: 540, y: 480, label: 'Đổi vai trò thành viên' },
    xoatv: { x: 540, y: 555, label: 'Xoá thành viên' },
    thuvien: { x: 540, y: 635, label: 'Quản lý ngữ cảnh dịch\nvà thuật ngữ của nhóm' },
    dung: { x: 470, y: 735, label: 'Dùng thư viện nhóm\ntrong phiên dịch' },
    xem: { x: 690, y: 755, label: 'Xem trước lời mời' },
    nhan: { x: 690, y: 835, label: 'Chấp nhận lời mời' },
  },
  edges: [
    ['assoc', 'owner', 'tao'],
    ['assoc', 'owner', 'xoa'],
    ['gen', 'owner', 'admin'],
    ...['doiten', 'invite', 'thuhoi', 'vaitro', 'xoatv', 'thuvien'].map((u) => [
      'assoc',
      'admin',
      u,
    ]),
    ['gen', 'admin', 'member'],
    ['assoc', 'member', 'dung'],
    ['assoc', 'moi', 'xem'],
    ['assoc', 'moi', 'nhan'],
  ],
};

// Cắt PNG về góc trên trái w×h bằng System.Drawing của Windows (không cần thêm thư viện Node).
function cropPng(file, w, h) {
  const ps = `Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Bitmap]::FromFile('${file}')
$dst = $src.Clone([System.Drawing.Rectangle]::new(0, 0, ${w}, ${h}), $src.PixelFormat)
$src.Dispose()
$dst.Save('${file}', [System.Drawing.Imaging.ImageFormat]::Png)
$dst.Dispose()`;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    stdio: 'inherit',
  });
}

const work = mkdtempSync(join(tmpdir(), 'use-case-'));
const figures = [
  ['hinh-2-1-use-case-tong-quat', tongQuat],
  ['hinh-2-2-use-case-dich-hoi-thoai', dichHoiThoai],
  ['hinh-2-3-use-case-hop-video', hopVideo],
  ['hinh-2-4-use-case-quan-ly-nhom', quanLyNhom],
];
for (const [name, d] of figures) {
  const svg = render(d);
  const html = join(work, `${name}.html`);
  writeFileSync(html, `<!doctype html><html><body style="margin:0">${svg}</body></html>`);
  const png = join(outDir, `${name}.png`);
  execFileSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=2',
      // Khung nhìn của Chrome headless thấp hơn --window-size khoảng 90 px, nên chụp dư rồi cắt về đúng cỡ hình.
      `--window-size=${d.w},${d.h + 200}`,
      `--screenshot=${png}`,
      pathToFileURL(html).href,
    ],
    { stdio: 'ignore' },
  );
  cropPng(png, d.w * 2, d.h * 2);
  console.log('Đã vẽ', png);
}
