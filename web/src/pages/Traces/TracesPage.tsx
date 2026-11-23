import { useQuery, useQueryClient } from '@tanstack/react-query';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { EssaySummary, Trace } from '@shared/types.ts';
import { api, ApiError } from '../../api.ts';
import { formatDayKey, localDay } from '../../lib/format.ts';
import './traces.css';

const TRACES_KEY = ['traces'];
/** The sidebar's width plus its inset, so a place flown to isn't hidden under it. */
const SIDE_PAD = 380;

type Mode = 'browse' | 'placing' | 'form';
type Draft = { id: number | null; lng: number; lat: number; city: string; country: string; day: string; notes: string; essayIds: number[]; files: File[] };

const messageOf = (err: unknown, fallback: string) => (err instanceof ApiError && err.status !== 0 ? err.message : fallback);
const whenOf = (t: { day: string | null }) => (t.day === null ? '' : formatDayKey(t.day));
const placeOf = (t: { city: string; country: string }) => [t.city, t.country].filter(Boolean).join(', ') || 'Somewhere';

/** The city and country at a point, from Mapbox's reverse geocoder; blank where there's none (the sea). */
async function placeAt(token: string, lng: number, lat: number): Promise<{ city: string; country: string }> {
  try {
    const url = `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${lng}&latitude=${lat}&language=en&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    if (!res.ok) return { city: '', country: '' };
    type Named = { name?: string };
    const data = (await res.json()) as { features?: { properties?: { name?: string; feature_type?: string; context?: Record<string, Named> } }[] };
    const props = data.features?.[0]?.properties;
    const c = props?.context ?? {};
    const city = c.place?.name ?? c.locality?.name ?? c.district?.name ?? c.region?.name ?? (props?.feature_type === 'place' ? props.name : undefined) ?? '';
    const country = c.country?.name ?? (props?.feature_type === 'country' ? props.name : undefined) ?? '';
    return { city, country };
  } catch {
    return { city: '', country: '' };
  }
}

/**
 * A pin: the lit dot on the spot, with the day and the city written straight onto the globe above
 * it, the way the skill tracker shows a card's title when zoomed out. No box, no stem.
 */
function pinElement(): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'trace-pin';
  el.innerHTML = '<span class="trace-pin__dot"></span><span class="trace-pin__label"><span class="trace-pin__date num"></span><span class="trace-pin__city"></span></span>';
  return el;
}

/** Hides the map's own city labels for `cities`, on top of each label layer's own filter. */
function hidePinnedPlaceNames(map: mapboxgl.Map, cities: string[], own: Map<string, mapboxgl.FilterSpecification | null>) {
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.type !== 'symbol' || !layer.id.startsWith('settlement')) continue;
    if (!own.has(layer.id)) own.set(layer.id, (map.getFilter(layer.id) as mapboxgl.FilterSpecification | undefined) ?? null);
    const base = own.get(layer.id) ?? null;
    const unpinned: mapboxgl.FilterSpecification = ['!', ['in', ['coalesce', ['get', 'name_en'], ['get', 'name']], ['literal', cities]]];
    map.setFilter(layer.id, cities.length === 0 ? base : base === null ? unpinned : ['all', base, unpinned]);
  }
}

function fillPin(el: HTMLElement, t: { city: string; country: string; day: string | null }, selected: boolean) {
  el.querySelector('.trace-pin__city')!.textContent = t.city || placeOf(t);
  el.querySelector('.trace-pin__date')!.textContent = whenOf(t);
  el.setAttribute('aria-label', [placeOf(t), whenOf(t)].filter(Boolean).join(', '));
  el.classList.toggle('is-selected', selected);
}

/**
 * Traces: a globe of the places something happened. Each pin carries the city, the country and
 * the day; the sidebar lists them as cards and opens one with its photos, what happened and the
 * essays written about it. Add, then tap the globe, pins a new one.
 */
export function TracesPage() {
  const queryClient = useQueryClient();
  const formId = useId();
  const token = useQuery({ queryKey: ['traces', 'map'], queryFn: ({ signal }) => api<{ token: string | null }>('/api/traces/map', { signal }) });
  const list = useQuery({ queryKey: TRACES_KEY, queryFn: ({ signal }) => api<Trace[]>('/api/traces', { signal }) });
  const [mode, setMode] = useState<Mode>('browse');
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const essays = useQuery({
    queryKey: ['essays'],
    queryFn: ({ signal }) => api<EssaySummary[]>('/api/essays', { signal }),
    enabled: mode === 'form',
  });

  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const pins = useRef(new Map<number, mapboxgl.Marker>());
  /** The map's place-name layers' own filters, kept so pinned cities can be taken out and put back. */
  const placeFilters = useRef(new Map<string, mapboxgl.FilterSpecification | null>());
  const draftPin = useRef<mapboxgl.Marker | null>(null);
  // The map's handlers read these, not the render they were made in.
  const live = useRef({ mode, selected, place: (_lng: number, _lat: number) => {}, select: (_id: number) => {} });

  const traces = list.data ?? [];
  const current = traces.find((t) => t.id === selected) ?? null;
  const mapToken = token.data?.token ?? null;

  const flyTo = (lng: number, lat: number) => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 4.2), duration: 1600, essential: true, padding: { left: window.innerWidth > 700 ? SIDE_PAD : 0, top: 0, right: 0, bottom: 0 } });
  };

  const select = (id: number | null) => {
    setSelected(id);
    setConfirming(false);
    setMode('browse');
    const t = traces.find((x) => x.id === id);
    if (t) flyTo(t.lng, t.lat);
  };

  const place = (lng: number, lat: number) => {
    setDraft({ id: null, lng, lat, city: '', country: '', day: localDay(new Date().toISOString()), notes: '', essayIds: [], files: [] });
    setMode('form');
    setSelected(null);
    flyTo(lng, lat);
    if (mapToken) {
      void placeAt(mapToken, lng, lat).then(({ city, country }) =>
        setDraft((d) => (d === null || d.lng !== lng || d.lat !== lat ? d : { ...d, city: d.city || city, country: d.country || country })),
      );
    }
  };

  live.current = { mode, selected, place, select: (id) => select(id) };

  // The globe: dark land under a dusk sky, turning slowly while nothing else is going on.
  useEffect(() => {
    if (!mapToken || !box.current) return;
    mapboxgl.accessToken = mapToken;
    const map = new mapboxgl.Map({
      container: box.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      projection: 'globe',
      center: [15, 28],
      zoom: 1.6,
      attributionControl: false,
    });
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
    map.on('style.load', () => {
      map.setFog({
        color: 'rgb(26, 26, 44)',
        'high-color': 'rgb(88, 96, 170)',
        'horizon-blend': 0.06,
        'space-color': 'rgb(6, 7, 14)',
        'star-intensity': 0.6,
      });
    });
    let holding = false;
    const spin = () => {
      if (holding || live.current.mode !== 'browse' || live.current.selected !== null || map.getZoom() > 3) return;
      const centre = map.getCenter();
      centre.lng -= 2.4;
      map.easeTo({ center: centre, duration: 1000, easing: (n) => n });
    };
    const hold = () => {
      holding = true;
    };
    const release = () => {
      holding = false;
      spin();
    };
    map.on('mousedown', hold);
    map.on('touchstart', hold);
    map.on('mouseup', release);
    map.on('touchend', release);
    map.on('moveend', spin);
    map.on('load', spin);
    map.on('click', (e) => {
      if (live.current.mode === 'placing') live.current.place(e.lngLat.lng, e.lngLat.lat);
    });
    mapRef.current = map;
    setMapReady(true);
    const markers = pins.current;
    return () => {
      map.remove();
      mapRef.current = null;
      markers.clear();
      setMapReady(false);
    };
  }, [mapToken]);

  // One pin per trace, kept in step with the list.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const seen = new Set<number>();
    for (const t of traces) {
      seen.add(t.id);
      const existing = pins.current.get(t.id);
      if (existing) {
        existing.setLngLat([t.lng, t.lat]);
        fillPin(existing.getElement(), t, t.id === selected);
        continue;
      }
      const el = pinElement();
      fillPin(el, t, t.id === selected);
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        live.current.select(t.id);
      });
      pins.current.set(t.id, new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([t.lng, t.lat]).addTo(map));
    }
    for (const [id, marker] of pins.current) {
      if (!seen.has(id)) {
        marker.remove();
        pins.current.delete(id);
      }
    }

    // A pinned city already has its name on its dot; the map's own label for it would say it twice.
    const cities = [...new Set(traces.map((t) => t.city).filter((c) => c !== ''))];
    const hide = () => hidePinnedPlaceNames(map, cities, placeFilters.current);
    if (map.isStyleLoaded()) hide();
    else map.once('style.load', hide);
  }, [traces, selected, mapReady]);

  // The new pin, where the globe was tapped, until it is saved or dropped.
  useEffect(() => {
    const map = mapRef.current;
    draftPin.current?.remove();
    draftPin.current = null;
    if (!map || draft === null || draft.id !== null) return;
    const el = pinElement();
    el.classList.add('is-draft');
    fillPin(el, { city: draft.city || 'New trace', country: draft.country, day: draft.day || null }, true);
    draftPin.current = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([draft.lng, draft.lat]).addTo(map);
  }, [draft, mapReady]);

  // Esc leaves placing, or the form.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (viewing !== null) setViewing(null);
      else if (mode !== 'browse') cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const cancel = () => {
    setMode('browse');
    setDraft(null);
    setError(null);
  };

  const startAdding = () => {
    setError(null);
    setSelected(null);
    setDraft(null);
    setMode((m) => (m === 'placing' ? 'browse' : 'placing'));
  };

  const edit = (t: Trace) => {
    setDraft({ id: t.id, lng: t.lng, lat: t.lat, city: t.city, country: t.country, day: t.day ?? '', notes: t.notes, essayIds: t.essays.map((e) => e.id), files: [] });
    setMode('form');
  };

  const save = async () => {
    if (draft === null) return;
    setSaving(true);
    setError(null);
    try {
      const body = { city: draft.city, country: draft.country, day: draft.day || null, notes: draft.notes, essayIds: draft.essayIds };
      let saved =
        draft.id === null
          ? await api<Trace>('/api/traces', { method: 'POST', json: { ...body, lng: draft.lng, lat: draft.lat } })
          : await api<Trace>(`/api/traces/${draft.id}`, { method: 'PATCH', json: body });
      if (draft.files.length > 0) {
        const form = new FormData();
        for (const f of draft.files) form.append('files', f);
        saved = await api<Trace>(`/api/traces/${saved.id}/photos`, { method: 'POST', body: form });
      }
      queryClient.setQueryData<Trace[]>(TRACES_KEY, (rows) => {
        const rest = (rows ?? []).filter((r) => r.id !== saved.id);
        return [saved, ...rest];
      });
      void queryClient.invalidateQueries({ queryKey: TRACES_KEY });
      setDraft(null);
      setMode('browse');
      setSelected(saved.id);
    } catch (err) {
      setError(messageOf(err, 'Couldn’t save that trace — retry'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (t: Trace) => {
    try {
      await api(`/api/traces/${t.id}`, { method: 'DELETE' });
      queryClient.setQueryData<Trace[]>(TRACES_KEY, (rows) => (rows ?? []).filter((r) => r.id !== t.id));
      setSelected(null);
      setConfirming(false);
    } catch (err) {
      setError(messageOf(err, 'Couldn’t delete that trace — retry'));
    }
  };

  const dropPhoto = async (photoId: number) => {
    try {
      const updated = await api<Trace>(`/api/traces/photos/${photoId}`, { method: 'DELETE' });
      queryClient.setQueryData<Trace[]>(TRACES_KEY, (rows) => (rows ?? []).map((r) => (r.id === updated.id ? updated : r)));
    } catch (err) {
      setError(messageOf(err, 'Couldn’t remove that photo — retry'));
    }
  };

  const countries = new Set(traces.map((t) => t.country).filter(Boolean)).size;
  const editing = draft !== null && draft.id !== null ? traces.find((t) => t.id === draft.id) ?? null : null;

  return (
    <div className={mode === 'placing' ? 'traces is-placing' : 'traces'}>
      <div ref={box} className="traces__globe" aria-label="Globe of traces" role="region" />

      {token.isSuccess && mapToken === null && (
        <p className="traces__setup glass">Add a Mapbox token to config.json under mapbox.token to draw the globe.</p>
      )}

      <button className={mode === 'placing' ? 'btn traces__add is-on' : 'btn traces__add'} type="button" onClick={startAdding}>
        {mode === 'placing' ? 'Cancel' : '+ Add'}
      </button>
      {mode === 'placing' && <p className="traces__hint glass">Tap the globe where it happened · Esc to cancel</p>}

      <aside className="traces__side glass" aria-label="Traces">
        {error !== null && (
          <p className="traces__error" role="alert">
            {error}
          </p>
        )}

        {mode === 'form' && draft !== null ? (
          <form
            className="trace-form"
            aria-labelledby={`${formId}-title`}
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <h2 className="traces__title" id={`${formId}-title`}>
              {draft.id === null ? 'New trace' : 'Edit trace'}
            </h2>
            <div className="trace-form__pair">
              <label className="trace-form__field">
                <span className="trace-form__label">City</span>
                <input className="trace-form__input" value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} placeholder="Finding it…" />
              </label>
              <label className="trace-form__field">
                <span className="trace-form__label">Country</span>
                <input className="trace-form__input" value={draft.country} onChange={(e) => setDraft({ ...draft, country: e.target.value })} />
              </label>
            </div>
            <label className="trace-form__field">
              <span className="trace-form__label">Date</span>
              <input className="trace-form__input" type="date" value={draft.day} onChange={(e) => setDraft({ ...draft, day: e.target.value })} />
            </label>
            <label className="trace-form__field">
              <span className="trace-form__label">What happened</span>
              <textarea className="trace-form__input trace-form__notes" rows={4} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Who you were with, what you saw" />
            </label>

            <div className="trace-form__field">
              <span className="trace-form__label">Photos</span>
              <div className="trace-photos">
                {editing?.photos.map((p) => (
                  <span key={p.id} className="trace-photos__item">
                    <img src={p.url} alt="" />
                    <button className="trace-photos__drop" type="button" aria-label="Remove this photo" onClick={() => void dropPhoto(p.id)}>
                      ×
                    </button>
                  </span>
                ))}
                {draft.files.map((f, i) => (
                  <span key={`${f.name}-${i}`} className="trace-photos__item is-new">
                    <img src={URL.createObjectURL(f)} alt="" />
                    <button className="trace-photos__drop" type="button" aria-label={`Leave out ${f.name}`} onClick={() => setDraft({ ...draft, files: draft.files.filter((_, j) => j !== i) })}>
                      ×
                    </button>
                  </span>
                ))}
                <label className="trace-photos__add">
                  <input
                    className="visually-hidden"
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      e.target.value = '';
                      if (files.length > 0) setDraft({ ...draft, files: [...draft.files, ...files] });
                    }}
                  />
                  <span aria-hidden="true">+</span>
                  <span className="visually-hidden">Add photos</span>
                </label>
              </div>
            </div>

            <fieldset className="trace-form__field trace-form__essays">
              <legend className="trace-form__label">Essays about it</legend>
              {essays.isPending ? (
                <p className="traces__quiet">Reading your essays…</p>
              ) : (essays.data ?? []).length === 0 ? (
                <p className="traces__quiet">No essays yet.</p>
              ) : (
                (essays.data ?? []).map((e) => (
                  <label key={e.id} className="trace-form__check">
                    <input
                      type="checkbox"
                      checked={draft.essayIds.includes(e.id)}
                      onChange={(ev) =>
                        setDraft({ ...draft, essayIds: ev.target.checked ? [...draft.essayIds, e.id] : draft.essayIds.filter((id) => id !== e.id) })
                      }
                    />
                    <span>{e.title || 'Untitled'}</span>
                  </label>
                ))
              )}
            </fieldset>

            <div className="trace-form__acts">
              <button className="btn btn-ghost btn-sm" type="button" onClick={cancel}>
                Cancel
              </button>
              <button className="btn btn-sm" type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        ) : current !== null ? (
          <article className="trace-detail">
            <button className="traces__back" type="button" onClick={() => select(null)}>
              ‹ All traces
            </button>
            <h2 className="traces__title">{current.city || placeOf(current)}</h2>
            <p className="trace-detail__meta">{[current.city ? current.country : '', whenOf(current)].filter(Boolean).join(' · ')}</p>
            {current.photos.length > 0 && (
              <div className="trace-detail__photos">
                {current.photos.map((p) => (
                  <button key={p.id} className="trace-detail__photo" type="button" aria-label="See this photo" onClick={() => setViewing(p.url)}>
                    <img src={p.url} alt="" loading="lazy" />
                  </button>
                ))}
              </div>
            )}
            {current.notes !== '' && <p className="trace-detail__notes">{current.notes}</p>}
            {current.essays.length > 0 && (
              <section className="trace-detail__essays" aria-label="Essays about it">
                <h3 className="trace-form__label">Essays about it</h3>
                {current.essays.map((e) => (
                  <Link key={e.id} className="trace-detail__essay" to={`/essays/${e.id}`}>
                    {e.title || 'Untitled'}
                  </Link>
                ))}
              </section>
            )}
            <div className="trace-form__acts">
              {confirming ? (
                <>
                  <span className="traces__quiet">Delete this trace?</span>
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => void remove(current)}>
                    Yes, delete
                  </button>
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => setConfirming(false)}>
                    Keep
                  </button>
                </>
              ) : (
                <>
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => setConfirming(true)}>
                    Delete
                  </button>
                  <button className="btn btn-sm" type="button" onClick={() => edit(current)}>
                    Edit
                  </button>
                </>
              )}
            </div>
          </article>
        ) : (
          <>
            <header className="traces__head">
              <h1 className="traces__title">Traces</h1>
              <span className="traces__count num">
                {traces.length} {traces.length === 1 ? 'place' : 'places'} · {countries} {countries === 1 ? 'country' : 'countries'}
              </span>
            </header>
            {list.isSuccess && traces.length === 0 ? (
              <p className="traces__quiet">No traces yet. Press Add, then tap the globe where something happened.</p>
            ) : (
              <ul className="trace-cards">
                {traces.map((t) => (
                  <li key={t.id}>
                    <button className="trace-card" type="button" onClick={() => select(t.id)}>
                      <span className="trace-card__cover">
                        {t.photos[0] !== undefined ? <img src={t.photos[0].url} alt="" loading="lazy" /> : <span aria-hidden="true">{(t.city || t.country || '·').slice(0, 1)}</span>}
                      </span>
                      <span className="trace-card__text">
                        <span className="trace-card__city">{t.city || placeOf(t)}</span>
                        <span className="trace-card__meta">{[t.city ? t.country : '', whenOf(t)].filter(Boolean).join(' · ')}</span>
                        {(t.photos.length > 0 || t.essays.length > 0) && (
                          <span className="trace-card__counts">
                            {[t.photos.length > 0 ? `${t.photos.length} ${t.photos.length === 1 ? 'photo' : 'photos'}` : '', t.essays.length > 0 ? `${t.essays.length} ${t.essays.length === 1 ? 'essay' : 'essays'}` : '']
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </aside>

      {viewing !== null && (
        <button className="traces__lightbox" type="button" aria-label="Close the photo" onClick={() => setViewing(null)}>
          <img src={viewing} alt="" />
        </button>
      )}
    </div>
  );
}

export default TracesPage;
