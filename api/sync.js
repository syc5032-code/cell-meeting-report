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
      const { action, code, password, data } = req.body || {};
      const cleanCode = (code || '').trim();
      const cleanPassword = (password !== undefined && password !== null) ? String(password).trim() : '';

      if (!cleanCode) {
        return res.status(400).json({ error: '동기화 코드를 입력해주세요.' });
      }

      // 사용자가 정한 어떤 쉬운 코드(한글/영문/숫자 등)도 안전한 고유 파일명으로 변환
      const hash = crypto.createHash('sha256').update(cleanCode).digest('hex').slice(0, 24);
      const filePath = `sync_data/${hash}.json`;

      // 1. 데이터 저장 (동시성 충돌 방지 지수 백오프 자동 재시도 탑재 & 비밀번호 보호)
      if (action === 'save') {
        // 기존 파일이 있는지 사전 확인하여 비밀번호 일치 여부 검증
        let existingData = null;
        let initialSha = undefined;
        try {
          const preCheckRes = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, { headers });
          if (preCheckRes.ok) {
            const preCheckJson = await preCheckRes.json();
            initialSha = preCheckJson.sha;
            const decodedStr = Buffer.from(preCheckJson.content, 'base64').toString('utf8');
            existingData = JSON.parse(decodedStr);
          }
        } catch (e) {
          // 신규 파일이거나 파싱 실패 시 패스
        }

        // 기존 파일에 비밀번호가 걸려있는 경우 비밀번호 검증
        if (existingData && existingData.passwordHash) {
          const inputPwHash = cleanPassword ? crypto.createHash('sha256').update(cleanPassword).digest('hex') : '';
          if (inputPwHash !== existingData.passwordHash) {
            return res.status(401).json({ 
              error: '비밀번호가 일치하지 않습니다. 올바른 비밀번호를 입력해주세요.',
              needPassword: true
            });
          }
        }

        // 저장할 비밀번호 해시 결정: 사용자가 입력한 새 비밀번호가 있으면 해시 생성, 없으면 기존 해시 유지
        let targetPasswordHash = existingData?.passwordHash || null;
        if (cleanPassword) {
          targetPasswordHash = crypto.createHash('sha256').update(cleanPassword).digest('hex');
        }

        const payloadContent = {
          code: cleanCode,
          passwordHash: targetPasswordHash,
          updatedAt: new Date().toISOString(),
          data: data || {}
        };
        const base64Content = Buffer.from(JSON.stringify(payloadContent)).toString('base64');

        const MAX_RETRIES = 4;
        let lastError = null;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            // 1) 매 시도마다 최신 sha를 항상 새로 조회 (다른 셀리더의 동시 커밋으로 HEAD가 바뀌었을 때 대비)
            let sha = attempt === 1 ? initialSha : undefined;
            if (attempt > 1 || sha === undefined) {
              const checkRes = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, { headers });
              if (checkRes.ok) {
                const fileData = await checkRes.json();
                sha = fileData.sha;
              }
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
              return res.status(200).json({ 
                ok: true, 
                code: cleanCode, 
                hasPassword: !!targetPasswordHash,
                message: '저장 성공', 
                attempts: attempt 
              });
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

      // 2. 데이터 불러오기 (비밀번호 일치 확인)
      if (action === 'load') {
        const getRes = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, { headers });
        if (!getRes.ok) {
          return res.status(404).json({ error: `'${cleanCode}' 코드로 저장된 데이터가 없습니다. 먼저 저장해주세요.` });
        }

        const fileData = await getRes.json();
        const decodedStr = Buffer.from(fileData.content, 'base64').toString('utf8');
        const parsed = JSON.parse(decodedStr);

        // 비밀번호가 설정된 경우 검증
        if (parsed.passwordHash) {
          const inputPwHash = cleanPassword ? crypto.createHash('sha256').update(cleanPassword).digest('hex') : '';
          if (inputPwHash !== parsed.passwordHash) {
            return res.status(401).json({ 
              error: '비밀번호가 일치하지 않습니다. 올바른 비밀번호를 입력해주세요.',
              needPassword: true 
            });
          }
        }

        return res.status(200).json({ 
          ok: true, 
          data: parsed.data, 
          code: cleanCode, 
          hasPassword: !!parsed.passwordHash,
          updatedAt: parsed.updatedAt 
        });
      }

      // 3. 코드 존재 여부 및 비밀번호 설정 여부 확인
      if (action === 'check') {
        const checkRes = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, { headers });
        let hasPassword = false;
        if (checkRes.ok) {
          try {
            const fileData = await checkRes.json();
            const decodedStr = Buffer.from(fileData.content, 'base64').toString('utf8');
            const parsed = JSON.parse(decodedStr);
            hasPassword = !!parsed.passwordHash;
          } catch (e) {}
        }
        return res.status(200).json({ ok: true, exists: checkRes.ok, hasPassword, code: cleanCode });
      }

      return res.status(400).json({ error: '유효하지 않은 요청입니다.' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Sync API Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
