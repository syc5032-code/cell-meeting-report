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

      // 1. 데이터 저장 (신규 생성 또는 덮어쓰기)
      if (action === 'save') {
        // 기존 파일이 있는지 확인 (sha 확보)
        let sha = undefined;
        try {
          const checkRes = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, { headers });
          if (checkRes.ok) {
            const fileData = await checkRes.json();
            sha = fileData.sha;
          }
        } catch (e) {
          // 파일 없음
        }

        const payloadContent = {
          code: cleanCode,
          updatedAt: new Date().toISOString(),
          data: data || {}
        };
        const base64Content = Buffer.from(JSON.stringify(payloadContent)).toString('base64');

        const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            message: `sync: update data for [${cleanCode}]`,
            content: base64Content,
            sha: sha
          })
        });

        if (!putRes.ok) {
          const errDetail = await putRes.text();
          return res.status(putRes.status).json({ error: '동기화 저장에 실패했습니다.', detail: errDetail });
        }

        return res.status(200).json({ ok: true, code: cleanCode, message: '저장 성공' });
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
