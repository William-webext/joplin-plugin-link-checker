export interface LinkResult {
  url: string;
  status: number | 'TIMEOUT' | 'ERROR';
  isDead: boolean;
  failCount: number;
  waybackUrl?: string;
}

const LINK_REGEX = /\[.*?\]\((https?:\/\/[^\s\)]+)\)|(?<!\()(https?:\/\/[^\s\)]+)/g;

export function extractLinks(markdown: string): string[] {
  const links = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = LINK_REGEX.exec(markdown)) !== null) {
    links.add(match[1] || match[2]);
  }
  return Array.from(links);
}

export async function checkLink(
  url: string, 
  currentFailures: number, 
  maxFailures: number, 
  timeoutMs = 5000
): Promise<LinkResult> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Prova prima con richiesta HEAD (leggera), fallback a GET se rifiutata (405)
    let response = await fetch(url, { method: 'HEAD', signal: controller.signal });
    if (response.status === 405) {
      response = await fetch(url, { method: 'GET', signal: controller.signal });
    }
    clearTimeout(id);

    const isHttpError = response.status >= 400;
    const newFailCount = isHttpError ? currentFailures + 1 : 0;
    const isConfirmedDead = newFailCount >= maxFailures;

    const waybackUrl = isConfirmedDead ? await checkWaybackMachine(url) : undefined;

    return { url, status: response.status, isDead: isConfirmedDead, failCount: newFailCount, waybackUrl };
  } catch (err: any) {
    clearTimeout(id);
    const newFailCount = currentFailures + 1;
    const isConfirmedDead = newFailCount >= maxFailures;
    const status = err.name === 'AbortError' ? 'TIMEOUT' : 'ERROR';
    
    const waybackUrl = isConfirmedDead ? await checkWaybackMachine(url) : undefined;

    return { url, status, isDead: isConfirmedDead, failCount: newFailCount, waybackUrl };
  }
}

async function checkWaybackMachine(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    return data.archived_snapshots?.closest?.url;
  } catch {
    return undefined;
  }
}