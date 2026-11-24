import { describe, expect, it, vi } from 'vitest';
import { detectKind, fetchMeta, fetchSiteIcon, iconLinks, isPrivateHost, type FetchLike } from './resources.ts';

const USER_AGENT = 'Mozilla/5.0 (Macintosh) PersonalHub/1.0';

/** A fake fetch that answers from a map of URL → response, and fails on anything else. */
function fakeFetch(routes: Record<string, () => Response | Promise<Response>>) {
  return vi.fn<FetchLike>(async (url) => {
    const route = routes[url];
    if (!route) throw new Error(`Unexpected fetch: ${url}`);
    return route();
  });
}

const html = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
const pdf = (body: string) => new Response(body, { headers: { 'content-type': 'application/pdf' } });
const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });
const oembedUrl = (url: string) => `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;

describe('detectKind', () => {
  it.each([
    ['https://www.youtube.com/watch?v=fNk_zzaMoSs', 'video'],
    ['https://www.youtube.com/watch?v=fNk_zzaMoSs&list=PLZHQObOWTQDPD3MizzM2xVFitgF8hE_ab', 'video'],
    ['https://youtu.be/fNk_zzaMoSs', 'video'],
    ['https://vimeo.com/76979871', 'video'],
    ['https://www.youtube.com/playlist?list=PLZHQObOWTQDPD3MizzM2xVFitgF8hE_ab', 'course'],
    ['https://www.coursera.org/learn/machine-learning', 'course'],
    ['https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/', 'course'],
    ['https://course.fast.ai/', 'course'],
    ['https://notcoursera.org/learn', 'link'],
    ['https://example.com/notes/ladr.PDF', 'pdf'],
    ['https://ocw.mit.edu/courses/18-06/lecture-1.pdf', 'pdf'],
    ['https://www.youtube.com/@3blue1brown', 'link'],
    ['https://example.com/', 'link'],
  ])('%s is %s', (url, kind) => {
    expect(detectKind(new URL(url))).toBe(kind);
  });

  it('reads a PDF content type', () => {
    expect(detectKind(new URL('https://arxiv.org/pdf/2101.00001'), 'application/pdf')).toBe('pdf');
    expect(detectKind(new URL('https://arxiv.org/abs/2101.00001'), 'text/html')).toBe('link');
  });
});

describe('fetchMeta', () => {
  it('youtube via oembed', async () => {
    const url = 'https://www.youtube.com/watch?v=fNk_zzaMoSs';
    const fetchImpl = fakeFetch({
      [oembedUrl(url)]: () =>
        Response.json({
          title: 'Essence of linear algebra',
          author_name: '3Blue1Brown',
          thumbnail_url: 'https://i.ytimg.com/vi/fNk_zzaMoSs/hqdefault.jpg',
        }),
    });

    expect(await fetchMeta(url, fetchImpl)).toEqual({
      title: 'Essence of linear algebra',
      kind: 'video',
      domain: 'youtube.com',
      thumbnail: 'https://i.ytimg.com/vi/fNk_zzaMoSs/hqdefault.jpg',
    });
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get('user-agent')).toBe(USER_AGENT);
  });

  it('youtube playlist is a course', async () => {
    const url = 'https://www.youtube.com/playlist?list=PLZHQObOWTQDPD3MizzM2xVFitgF8hE_ab';
    const fetchImpl = fakeFetch({
      [oembedUrl(url)]: () => Response.json({ title: 'Essence of linear algebra', thumbnail_url: 'https://i.ytimg.com/a.jpg' }),
    });

    expect(await fetchMeta(url, fetchImpl)).toMatchObject({ title: 'Essence of linear algebra', kind: 'course' });
  });

  it('coursera is a course', async () => {
    const url = 'https://www.coursera.org/learn/machine-learning';
    const fetchImpl = fakeFetch({
      [url]: () => html('<html><head><title>Machine Learning | Coursera</title></head></html>'),
    });

    expect(await fetchMeta(url, fetchImpl)).toEqual({
      title: 'Machine Learning | Coursera',
      kind: 'course',
      domain: 'coursera.org',
      thumbnail: null,
    });
  });

  it('pdf title from Info', async () => {
    const url = 'https://example.com/books/ladr.pdf';
    const fetchImpl = fakeFetch({
      [url]: () => pdf('%PDF-1.4\n1 0 obj << /Title (Linear Algebra Done Right) >> endobj'),
    });

    expect(await fetchMeta(url, fetchImpl)).toEqual({
      title: 'Linear Algebra Done Right',
      kind: 'pdf',
      domain: 'example.com',
      thumbnail: null,
    });
  });

  it('pdf title takes escapes, hex and UTF-16, and skips outline titles', async () => {
    const escaped = 'https://example.com/a.pdf';
    const hex = 'https://example.com/b.pdf';
    const outline = 'https://example.com/c.pdf';
    const fetchImpl = fakeFetch({
      [escaped]: () => pdf('%PDF-1.4\n1 0 obj << /Title (A \\(very\\) good\\040book) >> endobj'),
      // "Axler" in UTF-16BE with its byte-order mark.
      [hex]: () => pdf('%PDF-1.4\n1 0 obj << /Title <FEFF00410078006C00650072> >> endobj'),
      [outline]: () =>
        pdf(
          '%PDF-1.4\n4 0 obj << /Title (Chapter 1) /Parent 3 0 R /Dest [5 0 R /Fit] >> endobj\n' +
            '7 0 obj << /Producer (TeX) /Title (Measure, Integration & Real Analysis) >> endobj\n' +
            'trailer << /Info 7 0 R >>',
        ),
    });

    expect((await fetchMeta(escaped, fetchImpl)).title).toBe('A (very) good book');
    expect((await fetchMeta(hex, fetchImpl)).title).toBe('Axler');
    expect((await fetchMeta(outline, fetchImpl)).title).toBe('Measure, Integration & Real Analysis');
  });

  it('pdf falls back to filename', async () => {
    const url = 'https://example.com/books/Axler%20LADR.pdf';
    const fetchImpl = fakeFetch({ [url]: () => pdf('%PDF-1.4\n%no info dictionary here') });

    expect(await fetchMeta(url, fetchImpl)).toMatchObject({ title: 'Axler LADR', kind: 'pdf' });
  });

  it('pdf by content type without a .pdf path', async () => {
    const url = 'https://arxiv.org/pdf/2101.00001';
    const fetchImpl = fakeFetch({ [url]: () => pdf('%PDF-1.5\n%nothing') });

    expect(await fetchMeta(url, fetchImpl)).toMatchObject({ title: '2101.00001', kind: 'pdf' });
  });

  it('html og:title wins', async () => {
    const url = 'https://example.com/post';
    const fetchImpl = fakeFetch({
      [url]: () =>
        html(
          '<html><head><title>Site name</title>' +
            "<meta content='The real title' property='og:title'></head></html>",
        ),
    });

    expect((await fetchMeta(url, fetchImpl)).title).toBe('The real title');
  });

  it('html entity decode', async () => {
    const url = 'https://example.com/book';
    const fetchImpl = fakeFetch({
      [url]: () => html('<title>\n  Proofs &amp; Fundamentals &#8212; Bloch&#x2019;s &quot;book&quot;\n</title>'),
    });

    expect((await fetchMeta(url, fetchImpl)).title).toBe('Proofs & Fundamentals — Bloch’s "book"');
  });

  it('html title falls back to the URL when the page has none', async () => {
    const url = 'https://example.com/blank';
    const fetchImpl = fakeFetch({ [url]: () => html('<html><body>Hi</body></html>') });

    expect((await fetchMeta(url, fetchImpl)).title).toBe(url);
  });

  it('timeout falls back to the URL', async () => {
    const url = 'https://example.com/slow';
    const fetchImpl = vi.fn<FetchLike>(() => new Promise(() => {}));

    expect(await fetchMeta(url, fetchImpl, 50)).toEqual({ title: url, kind: 'link', domain: 'example.com', thumbnail: null });
    expect(fetchImpl.mock.calls[0]?.[1].signal?.aborted).toBe(true);
  });

  it('a failed fetch falls back to the URL', async () => {
    const url = 'https://example.com/gone.pdf';
    const fetchImpl = fakeFetch({ [url]: () => new Response('Not found', { status: 404 }) });

    expect(await fetchMeta(url, fetchImpl)).toEqual({ title: url, kind: 'pdf', domain: 'example.com', thumbnail: null });
    expect(await fetchMeta(url, vi.fn<FetchLike>(async () => Promise.reject(new TypeError('fetch failed'))))).toMatchObject({
      title: url,
    });
  });

  it('reads at most 512 KB of a page', async () => {
    const url = 'https://example.com/endless';
    let pulled = 0;
    let cancelled = false;
    const chunk = new TextEncoder().encode(`<!-- ${'x'.repeat(16 * 1024 - 9)} -->`);
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += chunk.byteLength;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = fakeFetch({ [url]: () => new Response(endless, { headers: { 'content-type': 'text/html' } }) });

    expect((await fetchMeta(url, fetchImpl)).title).toBe(url);
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThanOrEqual(512 * 1024 + 2 * chunk.byteLength);
  });

  it('follows an http(s) redirect', async () => {
    const url = 'http://example.com/old';
    const fetchImpl = fakeFetch({
      [url]: () => redirect('/new'),
      'http://example.com/new': () => html('<title>Moved here</title>'),
    });

    expect((await fetchMeta(url, fetchImpl)).title).toBe('Moved here');
    expect(fetchImpl.mock.calls[0]?.[1].redirect).toBe('manual');
  });

  it('never follows a redirect to another scheme or a private address', async () => {
    for (const location of ['file:///etc/passwd', 'javascript:alert(1)', 'http://127.0.0.1:4747/api/ping', 'http://[::1]/']) {
      const url = 'https://example.com/jump';
      const fetchImpl = fakeFetch({ [url]: () => redirect(location) });

      expect(await fetchMeta(url, fetchImpl)).toMatchObject({ title: url, kind: 'link' });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it('refuses localhost and private addresses without fetching', async () => {
    const urls = [
      'http://localhost:4747/api/ping',
      'http://127.0.0.1/',
      'http://2130706433/',
      'http://10.0.0.5/admin',
      'http://172.16.3.4/',
      'http://192.168.1.1/router.pdf',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]:4747/',
      'http://[fd12:3456::1]/',
    ];
    for (const url of urls) {
      const fetchImpl = vi.fn<FetchLike>(async () => html('<title>Should not be read</title>'));
      const meta = await fetchMeta(url, fetchImpl);

      expect(meta.title).toBe(url);
      expect(fetchImpl).not.toHaveBeenCalled();
    }
    expect((await fetchMeta('http://192.168.1.1/router.pdf', fakeFetch({}))).kind).toBe('pdf');
  });
});

describe('isPrivateHost', () => {
  it.each([
    ['localhost', true],
    ['LOCALHOST', true],
    ['127.8.9.10', true],
    ['10.255.0.1', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['192.168.0.10', true],
    ['169.254.1.1', true],
    ['0.0.0.0', true],
    ['[::1]', true],
    ['[::ffff:7f00:1]', true],
    ['[fc00::1]', true],
    ['[fdff::1]', true],
    ['172.32.0.1', false],
    ['172.15.255.255', false],
    ['11.0.0.1', false],
    ['192.169.0.1', false],
    ['[2606:4700::1111]', false],
    ['example.com', false],
    ['localhost.example.com', false],
  ])('%s → %s', (host, expected) => {
    expect(isPrivateHost(host)).toBe(expected);
  });
});

describe('site icons', () => {
  const png = (bytes = 'PNGDATA') => new Response(bytes, { headers: { 'content-type': 'image/png' } });

  it('picks the best icon a page names: a touch icon, then the largest, never an SVG', () => {
    const page = `<head>
      <link rel="icon" href="/small.png" sizes="16x16">
      <link rel="icon" type="image/svg+xml" href="/logo.svg">
      <link rel="shortcut icon" href="https://cdn.example.com/fav.ico">
      <link rel="icon" href="/big.png" sizes="96x96">
      <link rel="apple-touch-icon" href="/touch.png">
      <link rel="stylesheet" href="/a.css"></head>`;
    expect(iconLinks(page, new URL('https://example.com/')).map((u) => u.href)).toEqual([
      'https://example.com/touch.png',
      'https://example.com/big.png',
      'https://example.com/small.png',
      'https://cdn.example.com/fav.ico',
    ]);
  });

  it("fetches YouTube's own icon for a youtu.be link", async () => {
    const fetchImpl = fakeFetch({
      'https://www.youtube.com/': () => html('<link rel="icon" href="https://www.youtube.com/s/desktop/favicon_144x144.png" sizes="144x144">'),
      'https://www.youtube.com/s/desktop/favicon_144x144.png': () => png('RED'),
    });
    const icon = await fetchSiteIcon('https://youtu.be/abc', fetchImpl);
    expect(icon?.type).toBe('image/png');
    expect(new TextDecoder().decode(icon!.bytes)).toBe('RED');
  });

  it('falls back to /favicon.ico, and finds none where there is nothing to have', async () => {
    const withIco = fakeFetch({
      'https://plain.org/': () => html('<title>Plain</title>'),
      'https://plain.org/favicon.ico': () => new Response('ICO', { headers: { 'content-type': 'image/vnd.microsoft.icon' } }),
    });
    expect((await fetchSiteIcon('https://plain.org/a/page', withIco))?.type).toBe('image/vnd.microsoft.icon');
    const svgOnly = fakeFetch({
      'https://svg.org/': () => html('<title>S</title>'),
      'https://svg.org/favicon.ico': () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }),
    });
    expect(await fetchSiteIcon('https://svg.org/', svgOnly)).toBeNull();
  });

  it('never asks a private address', async () => {
    const fetchImpl = vi.fn<FetchLike>();
    expect(await fetchSiteIcon('http://127.0.0.1:4747/', fetchImpl)).toBeNull();
    expect(await fetchSiteIcon('http://192.168.1.4/x', fetchImpl)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
