export function extractLinks(text: string): string[] {
  if (!text) return [];
  // Regex per estrarre URL HTTP/HTTPS ripulendo la formattazione Markdown
  const urlRegex = /https?:\/\/[^\s\)\>\]\'\"]+/g;
  const matches = text.match(urlRegex) || [];
  const cleaned = matches.map(url => url.replace(/[\.\,\)\>\]]+$/, ''));
  return Array.from(new Set(cleaned));
}

// Fetch con AbortController per evitare blocchi infiniti
async function fetchWithTimeout(url: string, options: any = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

export async function checkLink(url: string, currentFailures: number, maxFailures: number) {
  // Intestazioni complete di un browser desktop per superare i filtri Cloudflare/StackOverflow
  const browserHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'max-age=0',
    'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  };

  try {
    // 1. Tenta prima con il metodo HEAD
    let response = await fetchWithTimeout(url, { method: 'HEAD', headers: browserHeaders }, 6000);

    // 2. Se HEAD viene rifiutato (403, 405, 400), passa al metodo GET
    if (response.status === 403 || response.status === 405 || response.status === 400) {
      response = await fetchWithTimeout(url, { method: 'GET', headers: browserHeaders }, 6000);
    }

    // Se il sito risponde con successo (200-299)
    if (response.ok) {
      return { isDead: false, status: response.status, failCount: 0, url };
    }

    // Rilevamento speciale per Cloudflare / Anti-Bot (403 o 503)
    // Se la risposta è 403/503 ma proviene da Cloudflare, il link esiste ed è online
    const serverHeader = (response.headers.get('server') || '').toLowerCase();
    const isCloudflare = serverHeader.includes('cloudflare') || response.headers.has('cf-ray');

    if ((response.status === 403 || response.status === 503) && isCloudflare) {
      return { isDead: false, status: `${response.status} (Protected)`, failCount: 0, url };
    }

    // Se è un errore 404 (Not Found), 410 (Gone) o altro fallimento
    const newFailCount = currentFailures + 1;
    const isDead = newFailCount >= maxFailures;
    const waybackUrl = isDead ? `https://web.archive.org/web/*/${url}` : null;
    return { isDead, status: response.status, failCount: newFailCount, url, waybackUrl };

  } catch (error: any) {
    const newFailCount = currentFailures + 1;
    const isDead = newFailCount >= maxFailures;
    const waybackUrl = isDead ? `https://web.archive.org/web/*/${url}` : null;
    const statusLabel = error.name === 'AbortError' ? 'TIMEOUT' : 'ERROR';
    return { isDead, status: statusLabel, failCount: newFailCount, url, waybackUrl };
  }
}