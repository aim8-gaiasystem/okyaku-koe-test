// お客様の声メモ：画面で共通の部品
window.Koe = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ひとつだけ選べるボタンの並び。もう一度押すと選択を外す（required のときは外さない）
  function chips(el, list, onPick, { required = false, initial = '' } = {}) {
    el.innerHTML = list.map((v) => `<button type="button" data-v="${esc(v)}" class="${v === initial ? 'on' : ''}">${esc(v)}</button>`).join('');
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || !el.contains(b)) return;
      const on = required || !b.classList.contains('on');
      el.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      if (on) b.classList.add('on');
      onPick(on ? b.dataset.v : '');
    });
    return { clear() { el.querySelectorAll('button').forEach((x) => x.classList.remove('on')); } };
  }

  // 音声入力（スマホのブラウザの機能を使う）。使えない端末ではボタンを出さず、案内だけ出す
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  function mic(button, target, hint) {
    if (!Rec) {
      button.style.display = 'none';
      if (hint) hint.textContent = 'キーボードのマイクのボタンでも、話して入力できます';
      return;
    }
    let rec = null;
    const label = button.innerHTML;
    const stop = () => { if (rec) rec.stop(); };
    button.addEventListener('click', () => {
      if (rec) { stop(); return; }
      rec = new Rec();
      rec.lang = 'ja-JP';
      rec.interimResults = true;
      rec.continuous = false;
      const base = target.value ? target.value.replace(/\s*$/, '') + (target.tagName === 'TEXTAREA' ? '\n' : ' ') : '';
      rec.onresult = (e) => {
        let text = '';
        for (const r of e.results) text += r[0].transcript;
        target.value = base + text;
        target.dispatchEvent(new Event('input'));
      };
      rec.onerror = (e) => {
        if (hint) hint.textContent = e.error === 'not-allowed'
          ? 'マイクが許可されていません。ブラウザの設定でマイクを許可してください'
          : 'うまく聞き取れませんでした。もう一度お試しください';
      };
      rec.onend = () => { rec = null; button.classList.remove('rec'); button.innerHTML = label; };
      button.classList.add('rec');
      button.innerHTML = '<span class="dot"></span>聞いています…（押すと終了）';
      if (hint) hint.textContent = '';
      rec.start();
    });
    return { stop };
  }

  // 写真を小さくして（長い辺1280px、JPEG）文字列にする
  async function shrinkPhoto(file, max = 1280) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((ok, ng) => {
        const i = new Image(); i.onload = () => ok(i); i.onerror = () => ng(new Error('この写真は読み込めませんでした')); i.src = url;
      });
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.8);
    } finally { URL.revokeObjectURL(url); }
  }

  async function api(path, method, body, passcode) {
    const res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(passcode !== undefined ? { 'x-passcode': passcode } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(data.error || 'エラーが発生しました'); err.status = res.status; throw err; }
    return data;
  }

  const store = {
    get(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* 保存できない環境では何もしない */ } },
  };

  return { $, esc, chips, mic, shrinkPhoto, api, store };
})();
