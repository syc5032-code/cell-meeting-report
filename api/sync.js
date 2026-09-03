import crypto from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'GITHUB_TOKEN is not configured' });
  }

  const repo = 'syc5032-code/cell-meeting-report';
  const headers = {
    'Authorization': 'token ' + token,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'Cell-Meeting-Report-Sync'
  };

  try {
    if (req.method === 'POST') {
      const { action, code, data } = req.body || {};
      const cleanCode = (code || '').trim();

      if (!cleanCode) {
        return res.status(400).json({ error: '동기화 코드를 입력해주세요.' });
      }

      // 사용자가 정한 어떤 쉬운 코드(한글/영문/숫자 등)도 안전한 고유 파일명으로 변환
      const hash = crypto.createHash('sha256').update(cleanCode).digest('hex').slice(0, 24);
      const filePath = `sync_data/${hash}.json`;

      // 1. 데이터 저장 (동시성 충돌 방지 지수 백오프 자동 재시도 탑재)
      if (action === 'save') {
        const payloadContent = {
          code: cleanCode,
          updatedAt: new Date().toISOString(),
          data: data || {}
        };
        const base64Content = Buffer.from(JSON.stringify(payloadContent)).toString('base64');

        const MAX_RETRIES = 4;
        let lastError = null;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            // 1) 매 시도마다 최신 sha를 항상 새로 조회 (다른 셀리더의 동시 커밋으로 HEAD가 바뀌었을 때 대비)
            let sha = undefined;
            const checkRes = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, { headers });
            if (checkRes.ok) {
              const fileData = await checkRes.json();
              sha = fileData.sha;
            }

            // 2) 커밋 저장 시도
            const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
              method: 'PUT',
              headers,
              body: JSON.stringify({
                message: `sync: update data for [${cleanCode}]`,
                content: base64Content,
                sha: sha
              })
            });

            if (putRes.ok) {
              return res.status(200).json({ ok: true, code: cleanCode, message: '저장 성공', attempts: attempt });
            }

            // 실패 시(409 Conflict 동시 커밋 충돌 등) 에러 기록 및 백오프 대기
            const errDetail = await putRes.text();
            lastError = { status: putRes.status, detail: errDetail };

            if (attempt < MAX_RETRIES) {
              // 지수 백오프 + 랜덤 지터(Jitter)로 다른 동시 요청과의 타이밍 분산
              const delay = Math.floor(250 * Math.pow(1.5, attempt) + Math.random() * 200);
              await new Promise(r => setTimeout(r, delay));
            }
          } catch (netErr) {
            lastError = { status: 500, detail: netErr.message };
            if (attempt < MAX_RETRIES) {
              await new Promise(r => setTimeout(r, 300));
            }
          }
        }

        return res.status(lastError?.status || 500).json({ 
          error: '동기화 저장에 일시적으로 실패했습니다.', 
          detail: lastError?.detail 
        });
      }

      // 2. 데이터 불러오기
      if (action === 'load') {
        const getRes = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, { headers });
        if (!getRes.ok) {
          return res.status(404).json({ error: `'${cleanCode}' 코드로 저장된 데이터가 없습니다. 먼저 저장해주세요.` });
        }

        const fileData = await getRes.json();
        const decodedStr = Buffer.from(fileData.content, 'base64').toString('utf8');
        const parsed = JSON.parse(decodedStr);

        return res.status(200).json({ ok: true, data: parsed.data, code: cleanCode, updatedAt: parsed.updatedAt });
      }

      // 3. 코드 존재 여부 확인
      if (action === 'check') {
        const checkRes = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, { headers });
        return res.status(200).json({ ok: true, exists: checkRes.ok, code: cleanCode });
      }

      return res.status(400).json({ error: '유효하지 않은 요청입니다.' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Sync API Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
