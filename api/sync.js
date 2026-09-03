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

  const headers = {
    'Authorization': 'token ' + token,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'Cell-Meeting-Report-Sync'
  };

  try {
    if (req.method === 'POST') {
      const { action, syncCode, data, leaderName } = req.body || {};

      if (action === 'create') {
        const createRes = await fetch('https://api.github.com/gists', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            description: 'Cell Report Sync [' + (leaderName || '셀') + ']',
            public: false,
            files: {
              'cell_data.json': {
                content: JSON.stringify(data || {})
              }
            }
          })
        });

        if (!createRes.ok) {
          const err = await createRes.text();
          return res.status(createRes.status).json({ error: 'Failed to create sync gist', detail: err });
        }

        const gist = await createRes.json();
        return res.status(200).json({ ok: true, syncCode: gist.id });
      }

      if (action === 'save') {
        if (!syncCode) return res.status(400).json({ error: 'syncCode is required' });

        const patchRes = await fetch('https://api.github.com/gists/' + syncCode, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            description: 'Cell Report Sync [' + (leaderName || '셀') + ']',
            files: {
              'cell_data.json': {
                content: JSON.stringify(data || {})
              }
            }
          })
        });

        if (!patchRes.ok) {
          const err = await patchRes.text();
          return res.status(patchRes.status).json({ error: 'Failed to update sync gist', detail: err });
        }

        return res.status(200).json({ ok: true });
      }

      if (action === 'load') {
        if (!syncCode) return res.status(400).json({ error: 'syncCode is required' });

        const getRes = await fetch('https://api.github.com/gists/' + syncCode, {
          method: 'GET',
          headers
        });

        if (!getRes.ok) {
          return res.status(404).json({ error: 'Sync code not found or invalid' });
        }

        const gist = await getRes.json();
        const file = gist.files && gist.files['cell_data.json'];
        if (!file || !file.content) {
          return res.status(404).json({ error: 'No data file found in gist' });
        }

        const parsed = JSON.parse(file.content);
        return res.status(200).json({ ok: true, data: parsed });
      }

      return res.status(400).json({ error: 'Invalid action' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Sync API Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
