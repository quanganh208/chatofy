// Task 6.3 — đếm lần phần ĐÃ CHỐT trên màn hình bị viết lại mà KHÔNG phải neo lại.
//
// Dán vào Console của tab /translate, rồi TẢI LẠI TRANG và dán lại nếu phiên đã
// mở — probe phải bọc WebSocket trước khi nó được tạo.
// Nói xong gõ: copy(chatofyProbe.report())
//
// Vì sao phải đọc cả sự kiện, không chỉ DOM: neo lại là HỢP LỆ. Nó cũng làm
// chuỗi đã chốt đổi theo kiểu không phải nối thêm, nên một probe chỉ nhìn DOM sẽ
// đếm mọi lần sửa đúng thành vi phạm. Vi phạm thật là lần viết lại KHÔNG có neo
// lại nào đi kèm — đó là đường `server.transcript.partial` ghi đè phần chốt, thứ
// task này sinh ra để bắt.
(() => {
  if (window.chatofyProbe) window.chatofyProbe.stop();

  const rewrites = [];
  let appends = 0;
  const seen = new Map(); // <p> -> chuỗi đã chốt lần trước
  const reanchors = new Map(); // sessionId -> reanchors mới nhất
  let lastBump = 0; // tổng số lần reanchors tăng, chưa được dùng để giải thích

  const Native = window.WebSocket;
  function Wrapped(...args) {
    const ws = new Native(...args);
    ws.addEventListener('message', (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m?.type !== 'server.transcript.delta') return;
      const before = reanchors.get(m.sessionId) ?? 0;
      if (m.reanchors > before) lastBump += m.reanchors - before;
      reanchors.set(m.sessionId, m.reanchors);
    });
    return ws;
  }
  Wrapped.prototype = Native.prototype;
  Object.assign(Wrapped, Native);
  window.WebSocket = Wrapped;

  const committedOf = (p) => {
    let out = '';
    for (const n of p.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) out += n.textContent;
      else break; // gặp <span> phần đang đoán là dừng
    }
    return out;
  };

  const check = () => {
    for (const p of document.querySelectorAll('p.text-source.italic')) {
      const now = committedOf(p);
      const before = seen.get(p);
      if (before !== undefined && before !== now) {
        // Server phát `partial` rồi `delta` cho CÙNG một lần đọc, hai khung
        // riêng. Khung đầu chưa có `committedChars` nên view vẽ cả dòng như đã
        // chốt; khung sau sửa thành chưa chốt gì. Đó là một lần đổi từ "vài chữ
        // đầu" về rỗng, xảy ra đúng một lần mỗi lượt, và nó KHÔNG phải chữ đã
        // chốt bị ghi đè — ở lần đọc đầu thì chưa có chữ nào chốt cả.
        // Bản đầu của probe này đếm nó thành 16 vi phạm trong phiên 16 lượt.
        if (now === '') {
          // không tính
        } else if (now.startsWith(before)) {
          appends += 1;
        } else if (lastBump > 0) {
          lastBump -= 1; // một lần neo lại đã giải thích lần viết lại này
        } else {
          rewrites.push({ at: Date.now(), before, now });
        }
      }
      seen.set(p, now);
    }
  };

  const obs = new MutationObserver(check);
  obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  check();

  window.chatofyProbe = {
    stop: () => {
      obs.disconnect();
      window.WebSocket = Native;
    },
    report: () => {
      const out = {
        appends,
        reanchorsSeen: [...reanchors.entries()].map(([s, n]) => ({ session: s, reanchors: n })),
        violations: rewrites.length,
        cases: rewrites,
      };
      console.log(`nối thêm bình thường : ${appends}`);
      console.log(`VI PHẠM (viết lại không có neo lại): ${rewrites.length}`);
      for (const r of rewrites) console.log(`   ${r.before}  ->  ${r.now}`);
      return JSON.stringify(out, null, 2);
    },
  };
  console.log('probe đang chạy — bấm Start rồi nói; xong gõ copy(chatofyProbe.report())');
})();
