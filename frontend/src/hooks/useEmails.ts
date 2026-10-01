import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import type { CreateCampaignRequest, EmailListType } from '../api/types';

// Scheduled/sent lists poll so status changes show up live without a refresh.
const LIVE_MS = 5000;

export function useEmails(type: EmailListType, page: number) {
  return useQuery({
    queryKey: ['emails', type, page],
    queryFn: () => api.listEmails(type, page),
    refetchInterval: LIVE_MS,
    placeholderData: keepPreviousData,
  });
}

export function useEmailSearch(q: string, type: EmailListType) {
  return useQuery({
    queryKey: ['search', type, q],
    queryFn: () => api.search(q, type),
    enabled: q.trim().length > 0,
    placeholderData: keepPreviousData,
  });
}

export function useStats() {
  return useQuery({ queryKey: ['stats'], queryFn: api.stats, refetchInterval: LIVE_MS });
}

export function useSenders() {
  return useQuery({ queryKey: ['senders'], queryFn: api.senders, refetchInterval: 10_000 });
}

/** Invalidates everything that shows email data. */
function useRefreshEmails() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['emails'] });
    qc.invalidateQueries({ queryKey: ['stats'] });
    qc.invalidateQueries({ queryKey: ['search'] });
    qc.invalidateQueries({ queryKey: ['senders'] });
  };
}

export function useCreateCampaign() {
  const refresh = useRefreshEmails();
  return useMutation({
    mutationFn: ({ body, key }: { body: CreateCampaignRequest; key: string }) => api.createCampaign(body, key),
    onSuccess: (res) => {
      const extra = [
        res.invalid ? `${res.invalid} invalid skipped` : '',
        res.duplicates ? `${res.duplicates} duplicates removed` : '',
      ]
        .filter(Boolean)
        .join(', ');
      toast.success(`Scheduled ${res.scheduled} email${res.scheduled === 1 ? '' : 's'}${extra ? ` (${extra})` : ''}`);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCancelEmail() {
  const refresh = useRefreshEmails();
  return useMutation({
    mutationFn: api.cancelEmail,
    onSuccess: () => {
      toast.success('Email cancelled');
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
