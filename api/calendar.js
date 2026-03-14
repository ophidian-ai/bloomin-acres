/**
 * api/calendar.js -- Vercel serverless function
 * Fetches events from Christina's Google Calendar for the market schedule.
 * Expects query params: year, month (0-indexed)
 */
export default async function handler(req, res) {
  const allowedOrigin = (
    process.env.ALLOWED_ORIGIN ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  ).trim();
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

  const apiKey = process.env.GOOGLE_CALENDAR_API_KEY;
  const calendarId = process.env.GOOGLE_CALENDAR_ID;

  if (!apiKey || !calendarId) {
    return res.status(500).json({ error: 'Calendar not configured' });
  }

  const year = parseInt(req.query.year, 10);
  const month = parseInt(req.query.month, 10);

  if (isNaN(year) || isNaN(month) || month < 0 || month > 11) {
    return res.status(400).json({ error: 'Invalid year or month' });
  }

  const timeMin = new Date(year, month, 1).toISOString();
  const timeMax = new Date(year, month + 1, 0, 23, 59, 59).toISOString();

  const params = new URLSearchParams({
    key: apiKey,
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '100',
  });

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`;

  try {
    const https = await import('https');
    const data = await new Promise((resolve, reject) => {
      https.default.get(url, (resp) => {
        let body = '';
        resp.on('data', (chunk) => { body += chunk; });
        resp.on('end', () => {
          if (resp.statusCode !== 200) {
            reject(new Error('Google API returned ' + resp.statusCode + ': ' + body));
            return;
          }
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(e); }
        });
      }).on('error', reject);
    });

    const events = (data.items || []).map((item) => {
      const isAllDay = !!item.start.date;
      return {
        id: item.id,
        name: item.summary || 'Untitled',
        description: item.description || '',
        location: item.location || '',
        startDate: item.start.date || item.start.dateTime,
        endDate: item.end.date || item.end.dateTime,
        allDay: isAllDay,
        color: (item.colorId || '').toString(),
      };
    });

    return res.json({ events });
  } catch (err) {
    console.error('Calendar fetch error:', err.message || err);
    return res.status(502).json({ error: 'Failed to fetch calendar', detail: err.message });
  }
}
