export function cleanRut(rut: string): string {
  return rut.replace(/[^0-9kK]/g, '');
}

export function extractTokenFromLink(url: string): string | null {
  const match = url.match(/[?&]token=([^&]+)/);
  return match ? match[1] : null;
}

export function extractElectionId(url: string): string | null {
  const match = url.match(/\/votacion\/(\d+)-/);
  return match ? match[1] : null;
}

export function extractSlug(url: string): string | null {
  const match = url.match(/\/votacion\/([^?]+)/);
  return match ? match[1] : null;
}

export function formatRut(rut: string): string {
  const cleaned = cleanRut(rut);
  if (cleaned.length < 2) return cleaned;
  const dv = cleaned.slice(-1);
  const body = cleaned.slice(0, -1);
  return body.replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1.') + '-' + dv;
}

