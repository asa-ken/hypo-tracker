// リマインダーの「外部AIへの指示(プロンプト)」を表示場所から直接編集できること
const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (l, v) => console.log((v ? '✅' : '❌') + ' ' + l + ' → ' + JSON.stringify(v));

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);

  // プロンプトを持つリマインダーを開く
  const rid = await p.evaluate(() => { const r = DB.reminders.find(x => x.prompt); openReminder(r.id); return r.id; });
  await p.waitForTimeout(250);

  // ---- 1. 表示場所に編集の入口がある ----
  const card = await p.evaluate(() => {
    const lbl = [...document.querySelectorAll('#sheet .lbl')].find(x => /外部AIへ指示するプロンプト/.test(x.textContent));
    if (!lbl) return null;
    const edit = [...lbl.querySelectorAll('span')].find(x => x.textContent.trim() === '編集');
    if (edit) edit.setAttribute('data-t', '1');
    return { hasEdit: !!edit, editH: edit ? Math.round(edit.getBoundingClientRect().height) : 0,
             onclick: edit ? edit.getAttribute('onclick') : null };
  });
  ok('プロンプトの見出しに編集リンクがある', card && card.hasEdit);
  ok('編集リンクは44pxのタップ領域', card.editH >= 44);
  ok('編集リンクは専用シートを開く', /sheetEditPrompt/.test(card.onclick));

  // 全文が省略されず表示される(以前は110字で切られていた)
  const full = await p.evaluate(rid => {
    const r = DB.reminders.find(x => x.id === rid);
    return { stored: r.prompt, shown: document.querySelector('#sheet .mono.clip3').textContent };
  }, rid);
  ok('プロンプト全文が要素に入っている(…で切られない)', full.shown === full.stored && full.stored.length > 110);

  // ---- 2. 編集シートが開き、現在値が入っている ----
  await p.click('[data-t="1"]');
  await p.waitForTimeout(250);
  const sheet = await p.evaluate(() => ({
    title: document.querySelector('#sheet h3').textContent,
    val: document.querySelector('#p_main') ? document.querySelector('#p_main').value : null,
  }));
  ok('「外部AIへの指示」シートが開く', sheet.title === '外部AIへの指示');
  ok('現在のプロンプトが入っている', sheet.val === full.stored);

  // ---- 3. 保存すると反映され、詳細に戻る ----
  await p.evaluate(() => { document.querySelector('#p_main').value = '書き換えたプロンプト。受注残の増減だけを一言で。'; });
  await p.evaluate(rid => saveReminderPrompt(rid), rid);
  await p.waitForTimeout(300);
  const saved = await p.evaluate(rid => ({
    stored: DB.reminders.find(x => x.id === rid).prompt,
    sheetTitle: document.querySelector('#sheet h3').textContent,
    shown: document.querySelector('#sheet .mono.clip3').textContent,
  }), rid);
  ok('保存内容がDBに入る', saved.stored === '書き換えたプロンプト。受注残の増減だけを一言で。');
  ok('保存後はリマインダー詳細に戻る', saved.sheetTitle !== '外部AIへの指示');
  ok('詳細の表示も更新される', saved.shown === saved.stored);

  // リロードしても残る
  await p.reload(); await p.waitForTimeout(400);
  ok('リロードしても保存が残る', await p.evaluate(rid => DB.reminders.find(x => x.id === rid).prompt === '書き換えたプロンプト。受注残の増減だけを一言で。', rid));

  // ---- 4. 頻度変更のプロンプトも同じ画面で直せる ----
  const chRid = await p.evaluate(() => {
    const r = DB.reminders.find(x => (x.changes || []).some(c => c.cond));
    if (!r) return null;
    openReminder(r.id); sheetEditPrompt(r.id); return r.id;
  });
  await p.waitForTimeout(250);
  ok('頻度変更を持つリマインダーがある(テスト前提)', !!chRid);
  const chFields = await p.evaluate(() => ({
    count: document.querySelectorAll('#sheet textarea[id^="p_c"]').length,
    hint: /頻度変更の条件を過ぎたあとに使われる/.test(document.querySelector('#sheet').innerText),
  }));
  ok('変更後プロンプトの入力欄も出る', chFields.count > 0);
  ok('使われ方の説明が出る', chFields.hint);
  await p.evaluate(() => { document.querySelector('#sheet textarea[id^="p_c"]').value = '変更後の新しい指示'; });
  await p.evaluate(rid => saveReminderPrompt(rid), chRid);
  await p.waitForTimeout(300);
  ok('変更後プロンプトも保存される', await p.evaluate(rid => DB.reminders.find(x => x.id === rid).changes.some(c => c.prompt === '変更後の新しい指示'), chRid));
  // 空にすると「変更しない」に戻る
  await p.evaluate(rid => sheetEditPrompt(rid), chRid); await p.waitForTimeout(200);
  await p.evaluate(() => { document.querySelector('#sheet textarea[id^="p_c"]').value = ''; });
  await p.evaluate(rid => saveReminderPrompt(rid), chRid);
  await p.waitForTimeout(300);
  ok('空欄にすると変更後プロンプトが外れる', await p.evaluate(rid => DB.reminders.find(x => x.id === rid).changes.every(c => !c.prompt), chRid));

  // ---- 5. プロンプトが無いリマインダーでも書き足せる ----
  const noRid = await p.evaluate(() => {
    const r = DB.reminders.find(x => !x.prompt) || DB.reminders[0];
    r.prompt = ''; save(); openReminder(r.id); return r.id;
  });
  await p.waitForTimeout(250);
  const empty = await p.evaluate(() => document.querySelector('#sheet').innerText);
  ok('プロンプトが無くてもカードと編集リンクは出る', /外部AIへ指示するプロンプト/.test(empty) && /まだありません/.test(empty));
  await p.evaluate(rid => sheetEditPrompt(rid), noRid); await p.waitForTimeout(200);
  await p.evaluate(() => { document.querySelector('#p_main').value = 'あとから足した指示'; });
  await p.evaluate(rid => saveReminderPrompt(rid), noRid);
  await p.waitForTimeout(300);
  ok('後からプロンプトを足せる', await p.evaluate(rid => DB.reminders.find(x => x.id === rid).prompt === 'あとから足した指示', noRid));

  // ---- 6. 従来の全項目編集からも引き続き直せる ----
  await p.evaluate(rid => sheetEditReminder(rid), noRid); await p.waitForTimeout(250);
  ok('全項目編集にも実行プロンプト欄が残っている', await p.evaluate(() => {
    const el = document.querySelector('#e_prompt'); return !!el && el.value === 'あとから足した指示';
  }));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
