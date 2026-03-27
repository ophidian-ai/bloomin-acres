import { createClient } from '@supabase/supabase-js';

// Bakery origin — fallback if not set in site_content
const DEFAULT_ORIGIN_LAT = 39.3072;
const DEFAULT_ORIGIN_LNG = -85.7697;
const DEFAULT_RADIUS_MILES = 15;

export default async function handler(req, res) {
  const allowedOrigin = (process.env.ALLOWED_ORIGIN || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')).trim();
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Google Maps API key not configured' });

  const { address } = req.body;
  if (!address || !address.trim()) return res.status(400).json({ error: 'Address is required' });

  try {
    // Load configurable origin and radius from site_content
    let originLat = DEFAULT_ORIGIN_LAT;
    let originLng = DEFAULT_ORIGIN_LNG;
    let radiusMiles = DEFAULT_RADIUS_MILES;

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && supabaseServiceKey) {
      const sb = createClient(supabaseUrl, supabaseServiceKey);
      const { data: settings } = await sb.from('site_content')
        .select('key, value')
        .in('key', ['geo-fence-origin-lat', 'geo-fence-origin-lng', 'geo-fence-radius-miles']);

      for (const row of (settings || [])) {
        if (row.key === 'geo-fence-origin-lat') originLat = parseFloat(row.value);
        if (row.key === 'geo-fence-origin-lng') originLng = parseFloat(row.value);
        if (row.key === 'geo-fence-radius-miles') radiusMiles = parseFloat(row.value);
      }
    }

    // Geocode the address via Google Maps
    const encoded = encodeURIComponent(address.trim());
    const geoRes = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encoded}&key=${apiKey}`
    );
    const geoData = await geoRes.json();

    if (geoData.status !== 'OK' || !geoData.results?.length) {
      return res.json({ eligible: false, error: 'Could not locate that address. Please check and try again.', distance: null });
    }

    const { lat, lng } = geoData.results[0].geometry.location;
    const distance = haversine(originLat, originLng, lat, lng);
    const eligible = distance <= radiusMiles;

    res.json({
      eligible,
      distance: Math.round(distance * 10) / 10,
      radius: radiusMiles,
      address: geoData.results[0].formatted_address,
      lat,
      lng,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Haversine formula — returns distance in miles between two lat/lng points
function haversine(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // Earth's radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg) { return deg * Math.PI / 180; }
