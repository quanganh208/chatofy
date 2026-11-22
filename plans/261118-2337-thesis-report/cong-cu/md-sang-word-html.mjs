// Chuyển báo cáo Markdown sang HTML mà Word mở được với đúng style (Normal, Heading 1–3, chú thích hình/bảng).
// Chỉ hỗ trợ đúng tập cú pháp báo cáo đang dùng: tiêu đề #/##/###, đoạn văn, danh sách -, 1., bảng |,
// khối ```, ảnh ![Hình x.y. ...](...), công thức $...$ / $$...$$, **đậm**, *nghiêng*, `mã`, <br> trong ô bảng.
// Dùng: node md-sang-word-html.mjs <file.md> <file.html>
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) throw new Error('Dùng: node md-sang-word-html.mjs <file.md> <file.html>');
const baseDir = dirname(resolve(inPath));

// Khổ chữ: A4, lề trái 3 cm, phải 2 cm → vùng chữ 16 cm. Ảnh rộng tối đa 15,5 cm, cao tối đa 20 cm.
const PX_PER_CM = 96 / 2.54;
const MAX_W = 15.5 * PX_PER_CM;
const MAX_H = 20 * PX_PER_CM;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Công thức trong dòng: chỉ có ký hiệu đơn và chỉ số dưới \text{...}, đổi sang chữ nghiêng + <sub>.
function inlineMath(tex) {
  // Giãn dấu chia trước khi sinh thẻ <sub>, nếu không sẽ làm hỏng thẻ đóng "</sub>".
  let s = tex.replace(/\\text\{([^}]*)\}/g, '$1').replace(/\s*\/\s*/g, ' / ');
  s = s.replace(/_\{([^}]*)\}/g, '<sub>$1</sub>').replace(/_(\w)/g, '<sub>$1</sub>');
  return `<i>${s}</i>`;
}

// Định dạng trong dòng. Mã và công thức được tách ra trước để không bị xử lý đậm/nghiêng nhầm.
function inline(text) {
  const slots = [];
  const keep = (html) => `\u0000${slots.push(html) - 1}\u0000`;
  let s = text.replace(/`([^`]+)`/g, (_, c) => keep(`<code>${esc(c)}</code>`));
  s = s.replace(/\$([^$]+)\$/g, (_, m) => keep(inlineMath(m)));
  s = s.replace(/<br\s*\/?>/gi, () => keep('<br>'));
  // "(*)" là dấu đánh dấu tài liệu cần kiểm, không phải mở chữ nghiêng.
  s = s.replace(/\(\*\)/g, () => keep('(*)'));
  s = esc(s);
  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  s = s.replace(/(?<![\w*])\*(?![\s*])(.+?)(?<![\s*])\*(?![\w*])/g, '<i>$1</i>');
  // Prettier (hook pre-commit) đổi *nghiêng* thành _nghiêng_; không đụng tới tên_có_gạch_dưới.
  s = s.replace(/(?<![\p{L}\p{N}_])_(?![\s_])(.+?)(?<![\s_])_(?![\p{L}\p{N}_])/gu, '<i>$1</i>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]);
}

function pngSize(file) {
  const b = readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

// Sơ đồ render ở tỉ lệ 2x; cho phóng tới 1,5 lần cỡ gốc để chữ trong sơ đồ dễ đọc.
// Ảnh chụp màn hình giữ nguyên rồi thu cho vừa khổ.
function figure(alt, src) {
  const file = resolve(baseDir, src);
  const { w, h } = pngSize(file);
  const natural = src.startsWith('hinh/') ? 0.75 : 1;
  const k = Math.min(natural, MAX_W / w, MAX_H / h);
  const width = Math.round(w * k);
  const height = Math.round(h * k);
  const m = alt.match(/^(Hình \d+\.\d+\.)\s*(.*)$/);
  const caption = m ? `<b>${esc(m[1])}</b> ${inline(m[2])}` : inline(alt);
  return (
    `<p class=AnhGiua><img width=${width} height=${height} src="${pathToFileURL(file).href}" alt="${esc(alt)}"></p>\n` +
    `<p class=ChuThichHinh>${caption}</p>`
  );
}

function table(rows) {
  const cells = (line) =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
  const head = cells(rows[0]);
  const body = rows.slice(2).map(cells);
  const td = (c, tag) => `<${tag}><p class=OBang>${inline(c) || '&nbsp;'}</p></${tag}>`;
  let html = '<table class=Bang border=1 cellspacing=0 cellpadding=0 width="100%">\n';
  html += `<thead><tr>${head.map((c) => td(c, 'th')).join('')}</tr></thead>\n<tbody>\n`;
  for (const r of body) html += `<tr>${r.map((c) => td(c, 'td')).join('')}</tr>\n`;
  return html + '</tbody></table>';
}

const md = readFileSync(inPath, 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/<!--[\s\S]*?-->/g, '');
// Trang bìa trong Markdown chỉ để đọc; bản Word chèn trang bìa theo mẫu (cong-cu/trang-bia.docx) vào dấu @@BIA@@.
const allLines = md.split('\n');
const lines = allLines.slice(allLines.findIndex((l) => l.startsWith('# ')));
const out = ['<p class=MsoNormal>@@BIA@@</p>'];
let frontMatter = true; // trước "MỞ ĐẦU": tiêu đề không vào mục lục
let lastH1 = '';
let signature = false; // khối "Hà Nội, ngày..." tới hết trang: căn phải
let afterFrontTitle = false;

const isBlockStart = (l) => /^(#{1,3} |```|\||- |\$\$|!\[|---\s*$)/.test(l);

for (let i = 0; i < lines.length;) {
  const line = lines[i];
  if (!line.trim()) {
    i++;
    continue;
  }

  if (line.startsWith('```')) {
    const code = [];
    for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]);
    i++;
    out.push(`<pre>${esc(code.join('\n'))}</pre>`);
    continue;
  }

  if (/^---\s*$/.test(line)) {
    signature = false;
    i++;
    continue;
  }

  const h = line.match(/^(#{1,3}) (.*)$/);
  if (h) {
    const level = h[1].length;
    const text = h[2].trim();
    signature = false;
    if (level === 1) {
      if (text === 'MỞ ĐẦU') frontMatter = false;
      lastH1 = text;
      const brk = out.length ? ' style="page-break-before:always"' : '';
      if (frontMatter) {
        // Các trang "DANH MỤC ..." được liệt kê trong mục lục (theo mẫu), các trang khác thì không.
        const cls = text.startsWith('DANH MỤC') ? 'TieuDeDanhMuc' : 'TieuDeTrang';
        out.push(`<p class=${cls}${brk}>${inline(text)}</p>`);
        afterFrontTitle = true;
      } else out.push(`<h1${brk}>${inline(text)}</h1>`);
    } else out.push(`<h${level}>${inline(text)}</h${level}>`);
    i++;
    continue;
  }

  const disp = line.match(/^\$\$(.+)\$\$\s*$/);
  if (disp) {
    // Word dựng lại thành phương trình (OMath) ở bước PowerShell; ở đây giữ dạng tuyến tính UnicodeMath.
    const unicodeMath = disp[1]
      .replace(/\\text\{([^}]*)\}/g, '"$1"')
      .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)')
      .replace(/\\lVert\s*([^\\]*?)\s*\\rVert/g, '‖$1‖')
      .replace(/\\cdot/g, '⋅')
      .replace(/\\cos\b/g, 'cos')
      .replace(/\s*\\,\s*/g, ' ')
      .replace(/"([A-Z]+)"/g, '$1');
    out.push(`<p class=CongThuc>@@EQ@@${esc(unicodeMath)}</p>`);
    i++;
    continue;
  }

  const img = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
  if (img) {
    out.push(figure(img[1], img[2]));
    i++;
    continue;
  }

  if (line.startsWith('|')) {
    const rows = [];
    while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
    out.push(table(rows));
    continue;
  }

  const listMatch = line.match(/^(- |(\d+)\. )/);
  if (listMatch) {
    const ordered = Boolean(listMatch[2]);
    const marker = ordered ? /^\d+\. / : /^- /;
    const items = [];
    while (i < lines.length) {
      if (!lines[i].trim()) {
        // Dòng trống giữa hai mục vẫn cùng một danh sách.
        let j = i;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j < lines.length && marker.test(lines[j])) {
          i = j;
          continue;
        }
        break;
      }
      if (marker.test(lines[i])) {
        items.push(lines[i].replace(marker, ''));
        i++;
        continue;
      }
      if (isBlockStart(lines[i])) break;
      items[items.length - 1] += ' ' + lines[i].trim();
      i++;
    }
    const start = ordered ? Number(listMatch[2]) : 1;
    const tag = ordered ? 'ol' : 'ul';
    const startAttr = ordered && start !== 1 ? ` start=${start}` : '';
    out.push(
      `<${tag}${startAttr}>${items.map((t) => `<li class=MsoNormal>${inline(t)}</li>`).join('')}</${tag}>`,
    );
    continue;
  }

  // Đoạn văn: nối các dòng bị ngắt cứng.
  const para = [];
  while (i < lines.length && lines[i].trim() && !(para.length && isBlockStart(lines[i])))
    para.push(lines[i++].trim());
  const text = para.join(' ');

  if (/^\[Tạo tự động trong Word/.test(text)) {
    const tag = lastH1 === 'MỤC LỤC' ? 'TOC' : lastH1.includes('HÌNH') ? 'TOF_HINH' : 'TOF_BANG';
    out.push(`<p class=MsoNormal>@@${tag}@@</p>`);
    continue;
  }
  if (/^\[ẢNH \d/.test(text)) {
    out.push(`<p class=ChoAnh>${inline(text)}</p>`);
    continue;
  }
  const cap = text.match(/^\*\*(Bảng \d+\.\d+\.)\s*(.*)\*\*$/);
  if (cap) {
    out.push(`<p class=ChuThichBang><b>${esc(cap[1])}</b> ${inline(cap[2])}</p>`);
    continue;
  }
  if (/^[*_]Hà Nội, ngày/.test(text)) signature = true;

  // Trang nhận xét: dòng kẻ chấm và dòng "Điểm" không lùi đầu dòng; dòng "Điểm" cách khối dòng kẻ một khoảng.
  if (/^\.{20,}$/.test(text)) {
    out.push(`<p class=DongKe>${text}</p>`);
    continue;
  }
  if (/^Điểm:/.test(text)) {
    out.push(`<p class=DongKe style="margin:12pt 0cm 18pt 0cm">${inline(text)}</p>`);
    continue;
  }

  let cls = 'VanBan';
  if (signature) cls = 'KyTen';
  else if (lastH1 === 'TÀI LIỆU THAM KHẢO' && /^\[\d+\]/.test(text)) cls = 'TaiLieu';
  else if (afterFrontTitle && /^\*\*\(.*\)\*\*$/.test(text)) cls = 'PhuDe';
  afterFrontTitle = false;
  out.push(`<p class=${cls}>${inline(text)}</p>`);
}

const css = readFileSync(new URL('./word-styles.css', import.meta.url), 'utf8');
const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>Báo cáo đồ án tốt nghiệp</title>
<style>
${css}
</style></head>
<body lang=VI>
${out.join('\n')}
</body></html>
`;
writeFileSync(outPath, html, 'utf8');
console.log(`ok: ${out.length} khối → ${outPath}`);
