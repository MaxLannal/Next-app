import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { Attachment } from '@shared/types.ts';
import { api, ApiError } from '../../../api.ts';

const isNotYetFiled = (err: unknown) => err instanceof ApiError && err.status === 404;

/** What the hub reads for the math in it: photos (HEIC, JPEG, PNG…) and scanned PDFs. */
export const isReadable = (a: Attachment) => (a.kind === 'image' || a.kind === 'pdf') && a.parentId === null;

/** The files on one session, re-read while a reading is still on its way. */
export function useSessionAttachments(sessionId: number) {
  const query = useQuery({
    queryKey: ['attachments', sessionId],
    // Until the hub can list a session's files it answers 404, which reads as none.
    queryFn: ({ signal }) =>
      api<Attachment[]>(`/api/attachments?sessionId=${sessionId}`, { signal }).catch((err: unknown) => {
        if (isNotYetFiled(err)) return [];
        throw err;
      }),
    retry: (failures, err) => !isNotYetFiled(err) && failures < 2,
  });

  const waiting = (query.data ?? []).some((a) => isReadable(a) && a.visionStatus === 'pending');
  const { refetch } = query;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void refetch(), 4000);
    return () => clearInterval(timer);
  }, [waiting, refetch]);

  return query;
}

/** Files onto a session: one `POST /api/attachments` form, any number of files. */
export function useUpload(sessionId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (files: File[]) => {
      const form = new FormData();
      form.set('sessionId', String(sessionId));
      for (const file of files) form.append('files', file, file.name);
      // `api` always reads the reply as text and would parse JSON from it; files come back as JSON here.
      const res = await fetch('/api/attachments', { method: 'POST', body: form, headers: { accept: 'application/json' } });
      const body: unknown = res.ok ? await res.json() : await res.json().catch(() => null);
      if (!res.ok) {
        const error = (body as { error?: unknown } | null)?.error;
        throw new ApiError(res.status, typeof error === 'string' ? error : `The hub answered ${res.status}`, body);
      }
      return body as Attachment[];
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['attachments', sessionId] });
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

/** Saves an edited reading: the derived `.tex` takes the new text. */
export function useEditReading(sessionId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, latex }: { id: number; latex: string }) =>
      api<Attachment>(`/api/attachments/${id}`, { method: 'PATCH', json: { extractedText: latex } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['attachments', sessionId] }),
  });
}

/** Reads a photo again; the sheet picks up the new reading by polling. */
export function useRetryReading(sessionId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (photoId: number) => api<null>(`/api/attachments/${photoId}/vision`, { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['attachments', sessionId] }),
  });
}

/** The derived `.tex` child of a photo or PDF, once its reading is done and the text is there. */
export function latexChild(photo: Attachment, all: Attachment[]): Attachment | null {
  if (!isReadable(photo) || photo.visionStatus !== 'done') return null;
  const child = all.find((a) => a.parentId === photo.id && a.kind === 'latex');
  return child !== undefined && child.extractedText.trim() !== '' ? child : null;
}
